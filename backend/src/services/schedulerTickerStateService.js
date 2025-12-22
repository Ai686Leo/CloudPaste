import { DbTables } from "../constants/index.js";
import { SETTING_FLAGS, SETTING_GROUPS, SETTING_TYPES } from "../constants/settings.js";
import { CronExpressionParser } from "cron-parser";

// 用于存储“外部触发器（CF/Docker tick）真实触发状态”的固定 key
// - 只维护 1 行（system_settings.key 为主键）
// - value 存 JSON：{ lastMs:number, lastCron:string|null }
export const SCHEDULER_TICK_STATE_SETTING_KEY = "scheduler_tick_state";

/**
 * @typedef {{ lastMs: number|null, lastCron: string|null }} SchedulerTickState
 */

/**
 * 读取“平台触发器”上次真实触发状态（毫秒 + cron）
 * @param {D1Database} db
 * @returns {Promise<SchedulerTickState>}
 */
export async function getSchedulerTickState(db) {
  /** @type {SchedulerTickState} */
  const empty = { lastMs: null, lastCron: null };
  if (!db) return empty;
  try {
    const row = await db
      .prepare(`SELECT value FROM ${DbTables.SYSTEM_SETTINGS} WHERE key = ?`)
      .bind(SCHEDULER_TICK_STATE_SETTING_KEY)
      .first();
    const raw = row?.value;
    if (raw === null || raw === undefined) return empty;

    // 约定：value 为 JSON 字符串
    if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        const ms = Number(parsed?.lastMs);
        const lastMs = Number.isFinite(ms) && ms > 0 ? ms : null;
        const lastCron =
          typeof parsed?.lastCron === "string" && parsed.lastCron.trim()
            ? parsed.lastCron.trim()
            : null;
        return { lastMs, lastCron };
      } catch {
        // ignore
      }
    }

    return empty;
  } catch {
    return empty;
  }
}

/**
 * 写入“平台触发器”上次真实触发状态（毫秒 + cron）
 * - 使用 upsert：不存在则插入，存在则更新
 * - 设计目标：永远只有 1 行数据
 * @param {D1Database} db
 * @param {{ lastMs: number, lastCron: string|null }} state
 * @returns {Promise<void>}
 */
export async function upsertSchedulerTickState(db, state) {
  if (!db) return;
  const ms = Number(state?.lastMs);
  if (!Number.isFinite(ms) || ms <= 0) return;
  const lastCron =
    typeof state?.lastCron === "string" && state.lastCron.trim()
      ? state.lastCron.trim()
      : null;

  try {
    const stateJson = JSON.stringify({ lastMs: ms, lastCron });

    await db
      .prepare(
        `
        INSERT INTO ${DbTables.SYSTEM_SETTINGS} (
          key, value, description, type, group_id, options, sort_order, flags, updated_at
        )
        VALUES (?, ?, ?, ?, ?, NULL, 0, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = CURRENT_TIMESTAMP
      `,
      )
      .bind(
        SCHEDULER_TICK_STATE_SETTING_KEY,
        stateJson,
        "平台触发器上次真实触发状态（毫秒+cron），系统内部使用。",
        SETTING_TYPES.TEXTAREA,
        SETTING_GROUPS.SYSTEM,
        SETTING_FLAGS.READONLY,
      )
      .run();
  } catch (e) {
    // 注意：这里不抛错，避免“记录 tick 时间失败”影响真实调度执行
    console.warn("[schedulerTickerStateService] 写入 scheduler_tick_last_ms 失败:", {
      error: e?.message || String(e),
    });
  }
}

/**
 * 从 cron 估算“触发间隔秒数”
 *
 *
 * 用 cron-parser 连续取两次 next，做差值。
 *
 * @param {string|null} cron
 * @param {string} nowIso
 * @returns {{ intervalSec: number|null, error: string|null }}
 */
export function computeCronIntervalSec(cron, nowIso) {
  const raw = typeof cron === "string" ? cron.trim() : "";
  if (!raw) return { intervalSec: null, error: "cron 为空" };
  try {
    const expr = CronExpressionParser.parse(raw, { currentDate: nowIso });
    const next1 = expr.next().toDate();
    const next2 = expr.next().toDate();
    const diffMs = next2.getTime() - next1.getTime();
    const intervalSec = diffMs > 0 ? Math.floor(diffMs / 1000) : null;
    return { intervalSec, error: null };
  } catch (e) {
    return { intervalSec: null, error: e?.message || String(e) };
  }
}

/**
 * 从 cron 计算下一次“计划触发时间”（UTC ISO）
 * @param {string|null} cron
 * @param {string} nowIso
 * @returns {{ scheduledAt: string|null, error: string|null }}
 */
export function computeNextScheduledAtFromCron(cron, nowIso) {
  const raw = typeof cron === "string" ? cron.trim() : "";
  if (!raw) return { scheduledAt: null, error: "cron 为空" };
  try {
    const expr = CronExpressionParser.parse(raw, { currentDate: nowIso });
    const scheduledAt = expr.next().toDate().toISOString();
    return { scheduledAt, error: null };
  } catch (e) {
    return { scheduledAt: null, error: e?.message || String(e) };
  }
}

/**
 * 计算“平台触发器 ticker”的 nextTick（给 /api/admin/scheduled/ticker 用）
 *
 * - at：给前端倒计时用的预计时间（优先 estimatedAt）
 * - scheduledAt：按 cron 规则算出来的“计划时间”（经常是整分/整 5 分钟）
 * - estimatedAt：按 lastTickMs + intervalSec 推算出来的“体感时间”
 * - intervalSec：从 cron 估算出来的间隔
 *
 * @param {{ activeCron: string|null, nowIso: string, lastTickMs: number|null }} params
 */
export function computeSchedulerTickerNextTick({ activeCron, nowIso, lastTickMs }) {
  const cron = typeof activeCron === "string" && activeCron.trim() ? activeCron.trim() : null;

  const scheduledRes = computeNextScheduledAtFromCron(cron, nowIso);
  const intervalRes = computeCronIntervalSec(cron, nowIso);

  const intervalSec = intervalRes.intervalSec;
  const hasLastTick =
    typeof lastTickMs === "number" && Number.isFinite(lastTickMs) && lastTickMs > 0;

  const canEstimate =
    hasLastTick &&
    typeof intervalSec === "number" &&
    Number.isFinite(intervalSec) &&
    intervalSec > 0;

  const estimatedAt = canEstimate
    ? new Date(lastTickMs + intervalSec * 1000).toISOString()
    : null;

  const at = estimatedAt || scheduledRes.scheduledAt || null;

  const cronParseError = scheduledRes.error || intervalRes.error || null;

  return {
    at,
    scheduledAt: scheduledRes.scheduledAt,
    estimatedAt,
    intervalSec,
    cronParseError,
  };
}
