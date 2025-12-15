import { DbTables } from "../constants/index.js";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  RepositoryError,
} from "../http/errors.js";
import { scheduledTaskRegistry } from "../scheduled/ScheduledTaskRegistry.js";
import { CronExpressionParser } from "cron-parser";

/**
 * 计算未来若干次计划执行时间（仅用于前端可视化预览，不参与真实调度）
 * @param {any} row scheduled_jobs 表行
 * @param {number} [limit=5] 需要预览的最大次数
 * @returns {string[]} ISO 字符串数组
 */
function computePreviewNextRuns(row, limit = 5) {
  const nextRuns = [];

  const enabledNum =
    typeof row.enabled === "boolean"
      ? row.enabled
        ? 1
        : 0
      : Number(row.enabled) || 0;

  if (!enabledNum) return nextRuns;
  if (!row.next_run_after) return nextRuns;

  const scheduleType = (row.schedule_type || "interval").toLowerCase();

  const nextTime = new Date(row.next_run_after);
  if (Number.isNaN(nextTime.getTime())) return nextRuns;

  // 第一个一定是 next_run_after 本身
  nextRuns.push(nextTime.toISOString());

  // 仅按 limit 控制预览次数
  const remainingAllowed = Math.max(0, limit - 1);
  if (remainingAllowed <= 0) return nextRuns;

  if (scheduleType === "interval") {
    const intervalSec = Number(row.interval_sec) || 0;
    if (intervalSec <= 0) return nextRuns;
    const intervalMs = intervalSec * 1000;
    for (let i = 1; i <= remainingAllowed; i++) {
      const future = new Date(nextTime.getTime() + i * intervalMs);
      nextRuns.push(future.toISOString());
    }
    return nextRuns;
  }

  if (scheduleType === "cron" && row.cron_expression) {
    try {
      const expr = CronExpressionParser.parse(row.cron_expression, {
        currentDate: nextTime,
      });
      for (let i = 0; i < remainingAllowed; i++) {
        const future = expr.next().toDate();
        nextRuns.push(future.toISOString());
      }
    } catch (e) {
      console.warn(
        "[scheduledJobService] 解析 cron_expression 失败，无法计算 previewNextRuns:",
        { taskId: row.task_id, cron: row.cron_expression, error: e?.message || e },
      );
    }
  }

  return nextRuns;
}

/**
 * 将 scheduled_jobs 行映射为对前端友好的对象
 * @param {any} row
 */
function mapScheduledJobRow(row) {
  if (!row) return null;

  let config = {};
  if (row.config_json) {
    try {
      config = JSON.parse(row.config_json);
    } catch (e) {
      // 保持健壮性，解析失败时退回空对象
      console.warn(
        "[scheduledJobService] 解析 config_json 失败，将返回空对象:",
        e,
      );
      config = {};
    }
  }

  const enabledNum =
    typeof row.enabled === "boolean"
      ? row.enabled
        ? 1
        : 0
      : Number(row.enabled) || 0;

  // Handler ID（任务类型ID）
  const handlerId = row.handler_id;
  const name = row.name || handlerId;
  const description = row.description || null;

  // 检查 handler 是否仍然存在（用于前端显示\"未知类型\"标签）
  const handlerExists = scheduledTaskRegistry.getHandler(handlerId) !== null;

  // 计算 intervalSec：对于 cron 类型，从表达式推导一个代表性的间隔（仅用于 UI 展示）
  let intervalSec = Number(row.interval_sec) || 0;
  const scheduleType = (row.schedule_type || "interval").toLowerCase();
  
  if (scheduleType === "cron" && row.cron_expression && intervalSec === 0) {
    try {
      const expr = CronExpressionParser.parse(row.cron_expression);
      const next1 = expr.next().toDate();
      const next2 = expr.next().toDate();
      intervalSec = Math.floor((next2.getTime() - next1.getTime()) / 1000);
    } catch (e) {
      console.warn(
        "[scheduledJobService] 解析 cron_expression 失败，无法计算 intervalSec:",
        { taskId: row.task_id, cron: row.cron_expression, error: e?.message || e },
      );
      // 解析失败时保持 intervalSec = 0，前端会从执行历史估算
    }
  }

  const runCount = Number(row.run_count) || 0;
  const failureCount =
    row.failure_count === null || row.failure_count === undefined
      ? 0
      : Number(row.failure_count) || 0;

  // 运行时状态（派生字段，用于前端展示当前任务所处阶段）
  // - disabled: 已禁用
  // - scheduled: 已启用，且未到 next_run_after
  // - pending: 已启用，已到 next_run_after，但当前未持有锁（等待下一次 tick 触发）
  // - running: 已启用，当前持有锁（最近一次 tick 正在或刚刚执行 handler）
  // - idle: 其他情况（例如缺少 next_run_after），作为保底状态
  let runtimeState = "idle";
  const now = new Date();
  const nextRunAfter =
    row.next_run_after != null ? new Date(row.next_run_after) : null;
  const lockUntil =
    row.lock_until != null ? new Date(row.lock_until) : null;

  if (!enabledNum) {
    runtimeState = "disabled";
  } else if (lockUntil && !Number.isNaN(lockUntil.getTime()) && lockUntil > now) {
    // 持有锁优先视为 running —— 即便 next_run_after 在未来，说明正在执行或刚刚执行完一次
    runtimeState = "running";
  } else if (!nextRunAfter || Number.isNaN(nextRunAfter.getTime())) {
    runtimeState = "idle";
  } else if (now < nextRunAfter) {
    runtimeState = "scheduled";
  } else {
    // now >= nextRunAfter 且当前没有有效锁：已到时间，等待下一次 tick 触发
    runtimeState = "pending";
  }

  return {
    taskId: row.task_id,
    handlerId,
    name,
    description,
    enabled: enabledNum === 1,
    scheduleType,
    intervalSec,
    cronExpression: row.cron_expression || null,
    runCount,
    failureCount,
    lastRunStatus: row.last_run_status || null,
    lastRunStartedAt: row.last_run_started_at || null,
    lastRunFinishedAt: row.last_run_finished_at || null,
    nextRunAfter: row.next_run_after || null,
    lockUntil: row.lock_until || null,
    runtimeState,
    config,
    handlerExists,
    previewNextRuns: computePreviewNextRuns(row, 5),
  };
}

/**
 * 简单布尔解析
 * @param {any} value
 * @returns {boolean}
 */
function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on";
  }
  return false;
}

/**
 * 列出调度作业
 * @param {D1Database} db
 * @param {{ taskId?: string, enabled?: boolean }} [filter]
 */
export async function listScheduledJobs(db, filter = {}) {
  try {
    let sql = `
      SELECT
        task_id,
        handler_id,
        name,
        description,
        enabled,
        schedule_type,
        interval_sec,
        cron_expression,
        run_count,
        failure_count,
        last_run_status,
        last_run_started_at,
        last_run_finished_at,
        next_run_after,
        lock_until,
        config_json
      FROM ${DbTables.SCHEDULED_JOBS}
      WHERE 1 = 1
    `;
    const binds = [];

    if (filter.taskId) {
      sql += " AND task_id = ?";
      binds.push(filter.taskId);
    }

    if (typeof filter.enabled === "boolean") {
      sql += " AND enabled = ?";
      binds.push(filter.enabled ? 1 : 0);
    }

    sql += " ORDER BY task_id ASC";

    const stmt = db.prepare(sql);
    const result = binds.length > 0 ? await stmt.bind(...binds).all() : await stmt.all();
    
    // D1 返回格式: { results: [...], success: true, meta: {...} }
    const rows = result?.results || [];

    return rows.map(mapScheduledJobRow);
  } catch (error) {
    console.error("[scheduledJobService] 列出调度作业失败:", error);
    throw new RepositoryError("列出调度作业失败", { cause: error?.message });
  }
}

/**
 * 获取单个调度作业
 * @param {D1Database} db
 * @param {string} taskId
 */
export async function getScheduledJob(db, taskId) {
  if (!taskId || typeof taskId !== "string") {
    throw new ValidationError("taskId 必须是非空字符串");
  }

  try {
    const row = await db
      .prepare(
        `
        SELECT
          task_id,
          handler_id,
          name,
          description,
          enabled,
          schedule_type,
          interval_sec,
          cron_expression,
          run_count,
          failure_count,
          last_run_status,
          last_run_started_at,
          last_run_finished_at,
          next_run_after,
          lock_until,
          config_json
        FROM ${DbTables.SCHEDULED_JOBS}
        WHERE task_id = ?
      `,
      )
      .bind(taskId)
      .first();

    if (!row) {
      throw new NotFoundError("调度作业不存在");
    }

    return mapScheduledJobRow(row);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }
    console.error("[scheduledJobService] 获取调度作业失败:", error);
    throw new RepositoryError("获取调度作业失败", { cause: error?.message });
  }
}

/**
 * 创建调度作业
 * @param {D1Database} db
 * @param {{
 *   taskId?: string,
 *   handlerId: string,
 *   name?: string,
 *   description?: string,
 *   scheduleType?: 'interval' | 'cron',
 *   intervalSec?: number,
 *   cronExpression?: string,
 *   enabled?: boolean,
   *   config?: any
 * }} payload
 */
export async function createScheduledJob(db, payload) {
  let taskId = (payload?.taskId || "").trim();
  const enabled = payload?.enabled ?? true;
  const config = payload?.config ?? {};
  const scheduleTypeRaw = payload?.scheduleType || "interval";
  const scheduleType = scheduleTypeRaw.toLowerCase();
  const intervalSec =
    payload?.intervalSec !== undefined && payload?.intervalSec !== null
      ? Number(payload.intervalSec)
      : null;
  const cronExpression = payload?.cronExpression || null;

  if (!payload?.handlerId || typeof payload.handlerId !== "string" || !payload.handlerId.trim()) {
    throw new ValidationError("handlerId 必须是非空字符串");
  }
  if (typeof config !== "object" || config === null) {
    throw new ValidationError("config 必须是对象");
  }

  // 校验调度类型与参数
  if (!["interval", "cron"].includes(scheduleType)) {
    throw new ValidationError("scheduleType 必须是 interval/cron 之一");
  }

  if (scheduleType === "interval") {
    if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
      throw new ValidationError("intervalSec 必须是大于 0 的数字（interval 模式）");
    }
  }

  if (scheduleType === "cron") {
    if (!cronExpression || typeof cronExpression !== "string") {
      throw new ValidationError("cronExpression 在 cron 模式下必须是非空字符串");
    }
    try {
      // 仅用于校验表达式是否合法
      CronExpressionParser.parse(cronExpression);
    } catch (e) {
      throw new ValidationError(
        `无效的 cronExpression: ${e?.message || String(e)}`,
      );
    }
  }

  try {
    // 若未显式提供 taskId，则基于 handlerId 自动生成一个作业ID
    if (!taskId) {
      const normalized = payload.handlerId.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase() || "job";
      const suffix = crypto.randomUUID().slice(0, 8);
      taskId = `${normalized}_${suffix}`;
    }

    // 先检查是否已存在
    const existing = await db
      .prepare(
        `SELECT task_id FROM ${DbTables.SCHEDULED_JOBS} WHERE task_id = ?`,
      )
      .bind(taskId)
      .first();

    if (existing) {
      throw new ConflictError("调度作业已存在");
    }

    const enabledNum = toBoolean(enabled) ? 1 : 0;
    const configJson = JSON.stringify(config ?? {});

    // 任务类型 ID 与名称：
    const handlerId = payload?.handlerId;
    const name = payload?.name || handlerId;
    const description =
      typeof payload?.description === "string" ? payload.description : null;

    // 初始调度：根据 scheduleType 计算首个 next_run_after
    const nowIso = new Date().toISOString();
    let firstNextRunIso = null;

    if (scheduleType === "interval") {
      firstNextRunIso = new Date(
        Date.now() + intervalSec * 1000,
      ).toISOString();
    } else if (scheduleType === "cron") {
      const expr = CronExpressionParser.parse(cronExpression, {
        currentDate: nowIso,
      });
      firstNextRunIso = expr.next().toDate().toISOString();
    }
    await db
      .prepare(
        `
        INSERT INTO ${DbTables.SCHEDULED_JOBS} (
          task_id,
          handler_id,
          name,
          description,
          enabled,
          schedule_type,
          interval_sec,
          cron_expression,
          run_count,
          failure_count,
          last_run_status,
          last_run_started_at,
          last_run_finished_at,
          next_run_after,
          lock_until,
          config_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, NULL, ?, NULL, ?)
      `,
      )
      .bind(
        taskId,
        handlerId,
        name,
        description,
        enabledNum,
        scheduleType,
        scheduleType === "interval" ? intervalSec : null,
        scheduleType === "cron" ? cronExpression : null,
        firstNextRunIso,
        configJson,
      )
      .run();

    // 返回创建后的完整对象
    return await getScheduledJob(db, taskId);
  } catch (error) {
    if (
      error instanceof ValidationError ||
      error instanceof ConflictError ||
      error instanceof NotFoundError
    ) {
      throw error;
    }
    console.error("[scheduledJobService] 创建调度作业失败:", error);
    throw new RepositoryError("创建调度作业失败", { cause: error?.message });
  }
}

/**
 * 更新调度作业
 * - 支持部分字段更新：
 *   - 调度相关：scheduleType / intervalSec / cronExpression
 *   - 其他：enabled / config / name / description
 * - 当调度配置或 enabled 从禁用改为启用时，重置 next_run_after
 * @param {D1Database} db
 * @param {string} taskId
 * @param {{
 *   scheduleType?: 'interval' | 'cron',
 *   intervalSec?: number,
 *   cronExpression?: string,
 *   enabled?: boolean,
 *   config?: any,
 *   name?: string,
 *   description?: string
 * }} payload
 */
export async function updateScheduledJob(db, taskId, payload) {
  if (!taskId || typeof taskId !== "string") {
    throw new ValidationError("taskId 必须是非空字符串");
  }
  if (!payload || typeof payload !== "object") {
    throw new ValidationError("请求体必须是对象");
  }

  // 仅当 intervalSec 有有效值时才视为“要更新间隔”
  const intervalProvided =
    Object.prototype.hasOwnProperty.call(payload, "intervalSec") &&
    payload.intervalSec !== undefined &&
    payload.intervalSec !== null &&
    payload.intervalSec !== "";

  const hasEnabled = Object.prototype.hasOwnProperty.call(payload, "enabled");
  const hasConfig = Object.prototype.hasOwnProperty.call(payload, "config");
  const hasName = Object.prototype.hasOwnProperty.call(payload, "name");
  const hasDescription = Object.prototype.hasOwnProperty.call(payload, "description");
  const hasScheduleType = Object.prototype.hasOwnProperty.call(payload, "scheduleType");
  const hasCronExpression = Object.prototype.hasOwnProperty.call(payload, "cronExpression");

  if (
    !intervalProvided &&
    !hasEnabled &&
    !hasConfig &&
    !hasName &&
    !hasDescription &&
    !hasScheduleType &&
    !hasCronExpression
  ) {
    throw new ValidationError("至少需要提供一个可更新字段");
  }

  try {
    const row = await db
      .prepare(
        `SELECT task_id, enabled, schedule_type, interval_sec, cron_expression, run_count
         FROM ${DbTables.SCHEDULED_JOBS} WHERE task_id = ?`,
      )
      .bind(taskId)
      .first();

    if (!row) {
      throw new NotFoundError("调度作业不存在");
    }

    const currentEnabledNum =
      typeof row.enabled === "boolean"
        ? row.enabled
          ? 1
          : 0
        : Number(row.enabled) || 0;

    // 现有调度配置
    let nextScheduleType = (row.schedule_type || "interval").toLowerCase();
    let nextIntervalSec = row.interval_sec === null ? null : Number(row.interval_sec) || 0;
    let nextCronExpression = row.cron_expression || null;

    // 更新 scheduleType
    if (hasScheduleType && payload.scheduleType) {
      const st = payload.scheduleType.toLowerCase();
      if (!["interval", "cron"].includes(st)) {
        throw new ValidationError("scheduleType 必须是 interval/cron 之一");
      }
      nextScheduleType = st;
    }

    // 更新 intervalSec
    if (intervalProvided) {
      const newInterval = Number(payload.intervalSec);
      if (!Number.isFinite(newInterval) || newInterval <= 0) {
        throw new ValidationError("intervalSec 必须是大于 0 的数字");
      }
      nextIntervalSec = newInterval;
    }

    // 更新 cronExpression
    if (hasCronExpression) {
      nextCronExpression = payload.cronExpression || null;
    }

    // 根据调度类型做一次校验
    if (nextScheduleType === "interval") {
      if (!Number.isFinite(nextIntervalSec) || nextIntervalSec <= 0) {
        throw new ValidationError("intervalSec 必须在 interval 模式下为大于 0 的数字");
      }
      nextCronExpression = null;
    } else if (nextScheduleType === "cron") {
      if (!nextCronExpression || typeof nextCronExpression !== "string") {
        throw new ValidationError("cronExpression 在 cron 模式下必须是非空字符串");
      }
      try {
        // 仅用于校验表达式是否合法
        CronExpressionParser.parse(nextCronExpression);
      } catch (e) {
        throw new ValidationError(
          `无效的 cronExpression: ${e?.message || String(e)}`,
        );
      }
      nextIntervalSec = null;
    }

    let nextEnabledNum = currentEnabledNum;
    if (hasEnabled) {
      nextEnabledNum = toBoolean(payload.enabled) ? 1 : 0;
    }

    let nextConfigJson = null;
    if (hasConfig) {
      if (typeof payload.config !== "object" || payload.config === null) {
        throw new ValidationError("config 必须是对象");
      }
      nextConfigJson = JSON.stringify(payload.config ?? {});
    }

    // 是否需要重置 next_run_after:
    // - 调度类型或参数改变
    // - enabled 从 0 -> 1
    const shouldResetSchedule =
      hasScheduleType ||
      intervalProvided ||
      hasCronExpression ||
      (hasEnabled && currentEnabledNum === 0 && nextEnabledNum === 1);

    let nextRunAfter = null;
    if (shouldResetSchedule) {
      const nowIso = new Date().toISOString();
      if (nextScheduleType === "interval") {
        nextRunAfter = new Date(
          Date.now() + nextIntervalSec * 1000,
        ).toISOString();
      } else if (nextScheduleType === "cron") {
        const expr = CronExpressionParser.parse(nextCronExpression, {
          currentDate: nowIso,
        });
        nextRunAfter = expr.next().toDate().toISOString();
      }
    }

    const sets = [];
    const binds = [];

    if (hasScheduleType) {
      sets.push("schedule_type = ?");
      binds.push(nextScheduleType);
    }
    if (intervalProvided || nextScheduleType === "interval") {
      sets.push("interval_sec = ?");
      binds.push(nextScheduleType === "interval" ? nextIntervalSec : null);
    }
    if (hasCronExpression || nextScheduleType === "cron") {
      sets.push("cron_expression = ?");
      binds.push(nextScheduleType === "cron" ? nextCronExpression : null);
    }
    if (intervalProvided) {
      // 已在上方处理 interval_sec，这里不重复
    }
    if (hasEnabled) {
      sets.push("enabled = ?");
      binds.push(nextEnabledNum);
    }
    if (hasConfig) {
      sets.push("config_json = ?");
      binds.push(nextConfigJson);
    }
    if (hasName) {
      sets.push("name = ?");
      binds.push(payload.name ?? null);
    }
    if (hasDescription) {
      sets.push("description = ?");
      binds.push(payload.description ?? null);
    }
    if (shouldResetSchedule) {
      sets.push("next_run_after = ?");
      binds.push(nextRunAfter);
    }

    if (!sets.length) {
      // 理论上不会走到这里，前面已校验
      throw new ValidationError("没有有效的更新字段");
    }

    const sql = `
      UPDATE ${DbTables.SCHEDULED_JOBS}
      SET ${sets.join(", ")}
      WHERE task_id = ?
    `;
    binds.push(taskId);

    await db.prepare(sql).bind(...binds).run();

    return await getScheduledJob(db, taskId);
  } catch (error) {
    if (
      error instanceof ValidationError ||
      error instanceof NotFoundError ||
      error instanceof ConflictError
    ) {
      throw error;
    }
    console.error("[scheduledJobService] 更新调度作业失败:", error);
    throw new RepositoryError("更新调度作业失败", { cause: error?.message });
  }
}

/**
 * 删除调度作业
 * @param {D1Database} db
 * @param {string} taskId
 */
export async function deleteScheduledJob(db, taskId) {
  if (!taskId || typeof taskId !== "string") {
    throw new ValidationError("taskId 必须是非空字符串");
  }

  try {
    // 先删除运行历史，再删除调度作业本身
    await db
      .prepare(
        `DELETE FROM ${DbTables.SCHEDULED_JOB_RUNS} WHERE task_id = ?`,
      )
      .bind(taskId)
      .run();

    const res = await db
      .prepare(
        `DELETE FROM ${DbTables.SCHEDULED_JOBS} WHERE task_id = ?`,
      )
      .bind(taskId)
      .run();

    const changes = res?.meta?.changes ?? res?.changes ?? 0;
    if (!changes) {
      throw new NotFoundError("调度作业不存在");
    }
  } catch (error) {
    if (error instanceof ValidationError || error instanceof NotFoundError) {
      throw error;
    }
    console.error("[scheduledJobService] 删除调度作业失败:", error);
    throw new RepositoryError("删除调度作业失败", { cause: error?.message });
  }
}
