/**
 * 后台调度作业执行入口
 * - 从 scheduled_jobs 表中选择到期任务
 * - 基于锁机制防止多实例并发执行
 * - 根据 schedule_type(interval/cron) 计算下一次执行时间
 * - 委托给 ScheduledTaskRegistry 中注册的 handler
 */

import { scheduledTaskRegistry } from "./ScheduledTaskRegistry.js";
import { recordScheduledJobRun } from "../services/scheduledJobRunService.js";
import { CronExpressionParser } from "cron-parser";

/**
 * 尝试为指定任务获取锁
 * @param {D1Database} db
 * @param {string} taskId
 * @param {string} nowIso
 * @param {number} lockTimeoutSec
 * @returns {Promise<boolean>}
 */
async function tryAcquireLock(db, taskId, nowIso, lockTimeoutSec) {
  const lockUntil = new Date(Date.now() + lockTimeoutSec * 1000).toISOString();

  const result = await db
    .prepare(
      `
      UPDATE scheduled_jobs
      SET lock_until = ?
      WHERE task_id = ?
        AND enabled = 1
        AND (lock_until IS NULL OR lock_until <= ?)
    `,
    )
    .bind(lockUntil, taskId, nowIso)
    .run();

  const changes = result?.meta?.changes ?? result?.changes ?? 0;
  return changes > 0;
}

/**
 * 计算下一次调度计划
 * @param {any} row - scheduled_jobs 表的行
 * @param {{ status: 'success' | 'failure' | 'skipped', nowIso: string }} ctx
 * @returns {{ nextRunAfter: string | null, enabled: number, runCountDelta: number, failureCountDelta: number }}
 */
function computeNextSchedule(row, ctx) {
  const scheduleType = (row.schedule_type || "interval").toLowerCase();
  const enabledNum =
    typeof row.enabled === "boolean"
      ? row.enabled
        ? 1
        : 0
      : Number(row.enabled) || 0;

  // 若已禁用，保持现状
  if (!enabledNum) {
    return {
      nextRunAfter: row.next_run_after || null,
      enabled: enabledNum,
      runCountDelta: 0,
    };
  }

  const nowIso = ctx.nowIso;
  const status = ctx.status;

  // 统一处理执行次数（只做统计，不再作为禁用条件）
  const currentRunCount = Number(row.run_count) || 0;
  // 统计“尝试执行次数”（成功+失败），skipped 不计入
  const willIncreaseCount = status === "success" || status === "failure";
  const nextRunCount = willIncreaseCount
    ? currentRunCount + 1
    : currentRunCount;

  // interval：基于 interval_sec 计算下一次执行时间
  if (scheduleType === "interval") {
    const intervalSec = Number(row.interval_sec) || 0;
    if (intervalSec <= 0) {
      // 配置异常时禁用任务，避免死循环
      return {
        nextRunAfter: null,
        enabled: 0,
        runCountDelta: willIncreaseCount ? 1 : 0,
        failureCountDelta: status === "failure" ? 1 : 0,
      };
    }
    const nextTime = new Date(
      Date.now() + intervalSec * 1000,
    ).toISOString();
    return {
      nextRunAfter: nextTime,
      enabled: enabledNum,
      runCountDelta: willIncreaseCount ? 1 : 0,
      failureCountDelta: status === "failure" ? 1 : 0,
    };
  }

  // cron：基于 cron_expression 计算下一次执行时间
  if (scheduleType === "cron") {
    const expr = row.cron_expression;
    if (!expr || typeof expr !== "string") {
      return {
        nextRunAfter: null,
        enabled: 0,
        runCountDelta: willIncreaseCount ? 1 : 0,
      };
    }

    try {
      const cronExpr = CronExpressionParser.parse(expr, {
        currentDate: nowIso,
      });
      const nextDate = cronExpr.next().toDate().toISOString();
      return {
        nextRunAfter: nextDate,
        enabled: enabledNum,
        runCountDelta: willIncreaseCount ? 1 : 0,
        failureCountDelta: status === "failure" ? 1 : 0,
      };
    } catch (e) {
      console.warn(
        "[runDueScheduledJobs] 解析 cron_expression 失败，将禁用该任务:",
        { taskId: row.task_id, cron: expr, error: e?.message || e },
      );
      return {
        nextRunAfter: null,
        enabled: 0,
        runCountDelta: willIncreaseCount ? 1 : 0,
      };
    }
  }

  // 未知调度类型：安全起见禁用任务
  console.warn(
    "[runDueScheduledJobs] 未知的 schedule_type，禁用任务:",
    { taskId: row.task_id, scheduleType },
  );
  return {
    nextRunAfter: null,
    enabled: 0,
    runCountDelta: willIncreaseCount ? 1 : 0,
    failureCountDelta: status === "failure" ? 1 : 0,
  };
}

/**
 * 统一更新任务调度状态（成功/失败/跳过后）
 * @param {D1Database} db
 * @param {any} row - scheduled_jobs 行
 * @param {{ status: 'success' | 'failure' | 'skipped', nowIso: string, startedAt?: string, finishedAt?: string }} ctx
 */
async function updateTaskSchedule(db, row, ctx) {
  const { nextRunAfter, enabled, runCountDelta, failureCountDelta } = computeNextSchedule(
    row,
    ctx,
  );

  const sets = ["lock_until = NULL"];
  const binds = [];

  // 统一记录最近一次执行的状态与时间
  sets.push("last_run_status = ?");
  binds.push(ctx.status);

  if (ctx.startedAt) {
    sets.push("last_run_started_at = ?");
    binds.push(ctx.startedAt);
  }
  if (ctx.finishedAt) {
    sets.push("last_run_finished_at = ?");
    binds.push(ctx.finishedAt);
  }

  if (nextRunAfter !== undefined) {
    sets.push("next_run_after = ?");
    binds.push(nextRunAfter);
  }

  if (enabled !== undefined) {
    sets.push("enabled = ?");
    binds.push(enabled);
  }

  if (runCountDelta) {
    sets.push("run_count = run_count + ?");
    binds.push(runCountDelta);
  }

  if (failureCountDelta) {
    sets.push("failure_count = failure_count + ?");
    binds.push(failureCountDelta);
  }

  const sql = `
      UPDATE scheduled_jobs
      SET ${sets.join(", ")}
      WHERE task_id = ?
    `;
  binds.push(row.task_id);

  await db.prepare(sql).bind(...binds).run();
}



/**
 * 执行到期的后台调度作业
 * @param {D1Database} db
 * @param {any} env Workers/Docker 环境绑定，用于传递给 handler
 * @param {{ lockTimeoutSec?: number }} [options]
 * @returns {Promise<{
 *   dueCount: number,
 *   executedCount: number,
 *   skippedCount: number,
 *   failedCount: number
 * } | void>}
 */
export async function runDueScheduledJobs(db, env, options = {}) {
  if (!db) {
    console.warn("[runDueScheduledJobs] 未提供 db 实例，跳过执行");
    return;
  }

  const lockTimeoutSec = Number(options.lockTimeoutSec) || 300; // 默认 5 分钟锁过期
  const nowIso = new Date().toISOString();

  // 1. 查询到期且启用的作业
  const result = await db
    .prepare(
      `
      SELECT
        task_id,
        handler_id,
        enabled,
        schedule_type,
        interval_sec,
        cron_expression,
        run_count,
        next_run_after,
        lock_until,
        config_json
      FROM scheduled_jobs
      WHERE enabled = 1
        AND (next_run_after IS NULL OR next_run_after <= ?)
    `,
    )
    .bind(nowIso)
    .all();

  const rows = result?.results || [];
  if (!rows.length) {
    return {
      dueCount: 0,
      executedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };
  }

  /** @type {{ dueCount: number, executedCount: number, skippedCount: number, failedCount: number }} */
  const stats = {
    dueCount: rows.length,
    executedCount: 0,
    skippedCount: 0,
    failedCount: 0,
  };

  for (const row of rows) {
    const taskId = row.task_id; // 作业ID（jobId）
    const handlerId = row.handler_id; // Handler ID（任务类型ID）
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();

    // 2. 获取锁，避免多实例并发执行
    const acquired = await tryAcquireLock(db, taskId, nowIso, lockTimeoutSec);
    if (!acquired) {
      stats.skippedCount += 1;
      continue;
    }

    const handler = scheduledTaskRegistry.getHandler(handlerId);
    if (!handler) {
      console.warn(
        `[runDueScheduledJobs] 未找到对应的调度任务处理器，taskId=${taskId}`,
      );
      const finishedAt = new Date().toISOString();
      await updateTaskSchedule(db, row, {
        status: "skipped",
        nowIso,
        startedAt,
        finishedAt,
      });
      await recordScheduledJobRun(db, {
        taskId,
        status: "skipped",
        startedAt,
        finishedAt,
        durationMs: Date.now() - startedMs,
        summary: "未找到对应的调度任务处理器",
      });
      stats.skippedCount += 1;
      continue;
    }

    let config = {};
    if (row.config_json) {
      try {
        config = JSON.parse(row.config_json);
      } catch (e) {
        console.warn(
        `[runDueScheduledJobs] 解析 config_json 失败，taskId=${taskId}`,
          e,
        );
      }
    }

    try {
      const handlerResult = await handler.run({
        db,
        env,
        now: nowIso,
        config,
      });
      const finishedAt = new Date().toISOString();
      await updateTaskSchedule(db, row, {
        status: "success",
        nowIso,
        startedAt,
        finishedAt,
      });

      const durationMs = Date.now() - startedMs;
      const summary =
        handlerResult &&
        typeof handlerResult === "object" &&
        typeof handlerResult.summary === "string"
          ? handlerResult.summary
          : null;

      await recordScheduledJobRun(db, {
        taskId,
        status: "success",
        startedAt,
        finishedAt,
        durationMs,
        summary,
        details: handlerResult && typeof handlerResult === "object" ? handlerResult : null,
      });
      stats.executedCount += 1;
    } catch (error) {
      console.warn(
        `[runDueScheduledJobs] 执行调度任务失败，taskId=${taskId}:`,
        error,
      );
      const finishedAt = new Date().toISOString();
      await updateTaskSchedule(db, row, {
        status: "failure",
        nowIso,
        startedAt,
        finishedAt,
      });
      await recordScheduledJobRun(db, {
        taskId,
        status: "failure",
        startedAt,
        finishedAt,
        durationMs: Date.now() - startedMs,
        summary: null,
        errorMessage: error?.message || String(error),
      });
      stats.failedCount += 1;
    }
  }

  return stats;
}
