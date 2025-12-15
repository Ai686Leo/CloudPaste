import { DbTables } from "../constants/index.js";
import { ValidationError, RepositoryError } from "../http/errors.js";

/**
 * 记录调度作业运行日志
 * @param {D1Database} db
 * @param {{
 *   taskId: string;
 *   status: "success" | "failure" | "skipped";
 *   startedAt?: string;
 *   finishedAt?: string | null;
 *   durationMs?: number | null;
 *   summary?: string | null;
 *   errorMessage?: string | null;
 *   details?: any;
 * }} entry
 */
export async function recordScheduledJobRun(db, entry) {
  try {
    const {
      taskId,
      status,
      triggerType = "auto",
      scheduledAt = null,
      startedAt = new Date().toISOString(),
      finishedAt = new Date().toISOString(),
      durationMs = null,
      summary = null,
      errorMessage = null,
      details = null,
    } = entry;

    const detailsJson =
      details && typeof details === "object" ? JSON.stringify(details) : null;

    await db
      .prepare(
        `
        INSERT INTO ${DbTables.SCHEDULED_JOB_RUNS} (
          task_id,
          status,
          trigger_type,
          scheduled_at,
          started_at,
          finished_at,
          duration_ms,
          summary,
          error_message,
          details_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .bind(
        taskId,
        status,
        triggerType,
        scheduledAt,
        startedAt,
        finishedAt,
        durationMs,
        summary,
        errorMessage,
        detailsJson,
      )
      .run();
  } catch (error) {
    console.error("[scheduledJobRunService] 记录调度作业运行日志失败:", error);
    throw new RepositoryError("记录调度作业运行日志失败", {
      cause: error?.message,
    });
  }
}

/**
 * 列出指定调度任务的运行记录
 * @param {D1Database} db
 * @param {{ taskId: string, limit?: number }} params
 */
export async function listScheduledJobRuns(db, params) {
  const taskId = params?.taskId;
  const limitRaw = params?.limit;

  if (!taskId || typeof taskId !== "string") {
    throw new ValidationError("taskId 必须是非空字符串");
  }

  let limit = Number(limitRaw);
  if (!Number.isFinite(limit) || limit <= 0) {
    limit = 50;
  }
  limit = Math.min(Math.max(limit, 1), 200);

  try {
    const res = await db
      .prepare(
        `
        SELECT
          id,
          task_id,
          status,
          started_at,
          finished_at,
          duration_ms,
          summary,
          error_message,
          details_json
        FROM ${DbTables.SCHEDULED_JOB_RUNS}
        WHERE task_id = ?
        ORDER BY started_at DESC
        LIMIT ?
      `,
      )
      .bind(taskId, limit)
      .all();

    const rows = res?.results || res?.rows || [];

    return rows.map((row) => {
      let details = null;
      if (row.details_json) {
        try {
          details = JSON.parse(row.details_json);
        } catch {
          details = null;
        }
      }

      const totalSessions =
        details && typeof details.totalSessions === "number"
          ? details.totalSessions
          : null;

      return {
        id: row.id,
        taskId: row.task_id,
        status: row.status,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        durationMs:
          typeof row.duration_ms === "number" ? row.duration_ms : null,
        summary: row.summary || null,
        errorMessage: row.error_message || null,
        details,
        totalSessions,
      };
    });
  } catch (error) {
    console.error("[scheduledJobRunService] 列出调度作业运行记录失败:", error);
    throw new RepositoryError("列出调度作业运行记录失败", { cause: error?.message });
  }
}

/**
 * 获取定时任务执行的按小时统计数据（用于热力图等可视化）
 * - 默认统计最近 24 小时所有任务的执行情况
 * - 仅依赖 scheduled_job_runs 表，不区分具体任务
 *
 * @param {D1Database} db
 * @param {{ windowHours?: number }} [options]
 * @returns {Promise<{ windowHours: number, buckets: Array<{
 *   start: string;
 *   end: string;
 *   totalRuns: number;
 *   success: number;
 *   failure: number;
 *   skipped: number;
 * }> }>}
 */
export async function getScheduledJobsHourlyAnalytics(db, options = {}) {
  const windowHoursRaw = options.windowHours;
  let windowHours = Number(windowHoursRaw);
  if (!Number.isFinite(windowHours) || windowHours <= 0) {
    windowHours = 24;
  }
  // 限制窗口大小，避免一次性拉取过多历史数据
  windowHours = Math.min(Math.max(windowHours, 1), 7 * 24);

  // 将当前时间向下取整到整点，确保 SQL 聚合桶和内存中的时间桶对齐
  const now = new Date();
  const endHour = new Date(now.getTime());
  endHour.setMinutes(0, 0, 0); // 当前整点，例如 10:37 -> 10:00

  // 以整点为基准计算窗口起点，例如 windowHours=24 时，从 24 小时前的整点开始
  const windowStart = new Date(
    endHour.getTime() - (windowHours - 1) * 60 * 60 * 1000,
  );
  const windowStartIso = windowStart.toISOString();

  try {
    // 按小时桶聚合执行次数（total / success / failure / skipped）
    const res = await db
      .prepare(
        `
        SELECT
          strftime('%Y-%m-%dT%H:00:00Z', started_at) AS bucket,
          COUNT(*) AS total_runs,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_runs,
          SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) AS failure_runs,
          SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped_runs
        FROM ${DbTables.SCHEDULED_JOB_RUNS}
        WHERE started_at >= ?
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
      )
      .bind(windowStartIso)
      .all();

    const rows = res?.results || res?.rows || [];
    const byBucket = new Map();
    for (const row of rows) {
      const bucket = row.bucket;
      if (!bucket) continue;
      byBucket.set(bucket, {
        bucket,
        totalRuns: Number(row.total_runs) || 0,
        success: Number(row.success_runs) || 0,
        failure: Number(row.failure_runs) || 0,
        skipped: Number(row.skipped_runs) || 0,
      });
    }

    // 为最近 windowHours 小时构建连续的时间桶
    const buckets = [];
    for (let i = 0; i < windowHours; i++) {
      const startDate = new Date(windowStart.getTime() + i * 60 * 60 * 1000);
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

      // 生成与 SQL 中 strftime('%Y-%m-%dT%H:00:00Z', ...) 一致的 bucketKey
      const iso = startDate.toISOString(); // 例如 2025-12-10T08:00:00.000Z
      const bucketKey = `${iso.slice(0, 13)}:00:00Z`; // 截断为 2025-12-10T08:00:00Z
      const agg = byBucket.get(bucketKey);

      buckets.push({
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        totalRuns: agg?.totalRuns || 0,
        success: agg?.success || 0,
        failure: agg?.failure || 0,
        skipped: agg?.skipped || 0,
      });
    }

    return {
      windowHours,
      buckets,
    };
  } catch (error) {
    console.error(
      "[scheduledJobRunService] 获取按小时统计数据失败:",
      error,
    );
    throw new RepositoryError("获取定时任务执行统计失败", {
      cause: error?.message,
    });
  }
}
