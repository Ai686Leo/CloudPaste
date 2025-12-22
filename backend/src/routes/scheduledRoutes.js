import { Hono } from "hono";
import { ApiStatus, DbTables } from "../constants/index.js";
import { createErrorResponse, jsonOk } from "../utils/common.js";
import { usePolicy } from "../security/policies/policies.js";
import { NotFoundError } from "../http/errors.js";
import {
  listScheduledJobs,
  getScheduledJob,
  createScheduledJob,
  updateScheduledJob,
  deleteScheduledJob,
} from "../services/scheduledJobService.js";
import {
  listScheduledJobRuns,
  recordScheduledJobRun,
  getScheduledJobsHourlyAnalytics,
} from "../services/scheduledJobRunService.js";
import { scheduledTaskRegistry } from "../scheduled/ScheduledTaskRegistry.js";
import { isCloudflareWorkerEnvironment } from "../utils/environmentUtils.js";
import { computeSchedulerTickerNextTick, getSchedulerTickState } from "../services/schedulerTickerStateService.js";

// 调度任务相关路由（仅 Docker/Node 环境使用 + 管理员配置）
const scheduledRoutes = new Hono();
const requireAdmin = usePolicy("admin.all");

// ==================== Handler 类型 API ====================

// 获取所有 handler 类型列表（管理员）
scheduledRoutes.get("/api/admin/scheduled/types", requireAdmin, async (c) => {
  const handlerTypes = scheduledTaskRegistry.getHandlerTypes();
  return jsonOk(c, { items: handlerTypes }, "获取调度handler类型列表成功");
});

// 获取单个 handler 类型详情（管理员）
scheduledRoutes.get("/api/admin/scheduled/types/:taskId", requireAdmin, async (c) => {
  const taskId = c.req.param("taskId");
  const handlerType = scheduledTaskRegistry.getHandlerType(taskId);

  if (!handlerType) {
    throw new NotFoundError("调度handler类型不存在");
  }

  return jsonOk(c, handlerType, "获取调度handler类型详情成功");
});

// ==================== 调度作业管理 API ====================

// 列出调度作业（管理员）
scheduledRoutes.get("/api/admin/scheduled/jobs", requireAdmin, async (c) => {
  const db = c.env.DB;
  const taskId = c.req.query("taskId") || c.req.query("task_id") || undefined;
  const enabledRaw = c.req.query("enabled");

  let enabledFilter;
  if (typeof enabledRaw === "string") {
    const v = enabledRaw.trim().toLowerCase();
    if (v === "true" || v === "1" || v === "yes" || v === "on") {
      enabledFilter = true;
    } else if (v === "false" || v === "0" || v === "no" || v === "off") {
      enabledFilter = false;
    }
  }

  const jobs = await listScheduledJobs(db, {
    taskId,
    enabled: enabledFilter,
  });

  return jsonOk(c, { items: jobs }, "获取调度作业列表成功");
});

// 获取单个调度作业详情（管理员）
scheduledRoutes.get("/api/admin/scheduled/jobs/:taskId", requireAdmin, async (c) => {
  const db = c.env.DB;
  const taskId = c.req.param("taskId");

  const job = await getScheduledJob(db, taskId);
  return jsonOk(c, job, "获取调度作业详情成功");
});

// 创建调度作业（管理员）
scheduledRoutes.post("/api/admin/scheduled/jobs", requireAdmin, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();

  const payload = {
    // 作业ID（jobId），用于唯一标识此调度作业
    taskId: body.taskId ?? body.task_id,
    // 任务处理器类型 ID（Handler ID），默认与 taskId 相同，便于兼容旧客户端
    handlerId: body.handlerId ?? body.handler_id ?? body.taskId ?? body.task_id,
    // 作业名称与描述（可选），默认使用 handlerId
    name: body.name ?? null,
    description: body.description ?? null,
    scheduleType: body.scheduleType ?? body.schedule_type,
    intervalSec: body.intervalSec ?? body.interval_sec,
    cronExpression: body.cronExpression ?? body.cron_expression,
    enabled: body.enabled,
  };
  // 仅当请求体中显式提供 config 时才传递，未提供则由 service 使用默认 {}
  if (Object.prototype.hasOwnProperty.call(body, "config")) {
    payload.config = body.config;
  }

  const created = await createScheduledJob(db, payload);

  return jsonOk(c, created, "创建调度作业成功");
});

// 更新调度作业（管理员）
scheduledRoutes.put("/api/admin/scheduled/jobs/:taskId", requireAdmin, async (c) => {
  const db = c.env.DB;
  const taskId = c.req.param("taskId");
  const body = await c.req.json();

  const payload = {};

  // 名称与描述（可选）
  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    payload.name = body.name;
  }
  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    payload.description = body.description ?? null;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "scheduleType") ||
    Object.prototype.hasOwnProperty.call(body, "schedule_type")
  ) {
    payload.scheduleType = body.scheduleType ?? body.schedule_type;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "intervalSec") ||
    Object.prototype.hasOwnProperty.call(body, "interval_sec")
  ) {
    payload.intervalSec = body.intervalSec ?? body.interval_sec;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "cronExpression") ||
    Object.prototype.hasOwnProperty.call(body, "cron_expression")
  ) {
    payload.cronExpression = body.cronExpression ?? body.cron_expression;
  }

  if (Object.prototype.hasOwnProperty.call(body, "enabled")) {
    payload.enabled = body.enabled;
  }

  // 仅在请求体中显式提供 config 时才尝试更新配置
  if (Object.prototype.hasOwnProperty.call(body, "config")) {
    payload.config = body.config;
  }

  const updated = await updateScheduledJob(db, taskId, payload);

  return jsonOk(c, updated, "更新调度作业成功");
});

// 删除调度作业（管理员）
scheduledRoutes.delete("/api/admin/scheduled/jobs/:taskId", requireAdmin, async (c) => {
  const db = c.env.DB;
  const taskId = c.req.param("taskId");

  await deleteScheduledJob(db, taskId);
  return jsonOk(c, { taskId }, "删除调度作业成功");
});

// 获取调度作业运行记录列表（管理员）
scheduledRoutes.get("/api/admin/scheduled/jobs/:taskId/runs", requireAdmin, async (c) => {
  const db = c.env.DB;
  const taskId = c.req.param("taskId");
  const limitRaw = c.req.query("limit");

  const runs = await listScheduledJobRuns(db, {
    taskId,
    limit: limitRaw ? Number(limitRaw) : undefined,
  });

  return jsonOk(c, { items: runs }, "获取调度作业运行记录成功");
});

// 获取定时任务执行的按小时统计数据（管理员）
scheduledRoutes.get("/api/admin/scheduled/analytics", requireAdmin, async (c) => {
  const db = c.env.DB;
  const windowHoursRaw = c.req.query("windowHours");

  const analytics = await getScheduledJobsHourlyAnalytics(db, {
    windowHours: windowHoursRaw ? Number(windowHoursRaw) : undefined,
  });

  return jsonOk(c, analytics, "获取定时任务执行统计成功");
});

// 获取“平台触发器 tick”的状态（管理员）
// - 这个 tick 是 Cloudflare Cron Trigger 或 Docker node-schedule 触发 scheduled 扫描的“外部触发器”
// - 管理面板用它来显示：cron 规则 + 下次触发倒计时 + 上次触发时间
scheduledRoutes.get("/api/admin/scheduled/ticker", requireAdmin, async (c) => {
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  // 当前运行环境与“本地配置 cron”
  // Docker/Node：cron 通过环境变量 SCHEDULED_TICK_CRON 配置（默认每分钟一次）
  // Workers：使用“真实触发时记录的 lastCron”
  const runtime = isCloudflareWorkerEnvironment() ? "cloudflare" : "docker";
  const processEnv =
    typeof process !== "undefined" && process?.env ? process.env : {};
  const configuredCronRaw =
    runtime === "docker" ? processEnv.SCHEDULED_TICK_CRON || null : null;
  const configuredCron =
    typeof configuredCronRaw === "string" && configuredCronRaw.trim()
      ? configuredCronRaw.trim()
      : runtime === "docker"
        ? "*/1 * * * *"
        : null;

  const cronSource =
    typeof configuredCronRaw === "string" && configuredCronRaw.trim()
      ? "env"
      : runtime === "docker"
        ? "default"
        : "missing";

  const tickState = await getSchedulerTickState(c.env.DB);
  const observedCron = tickState.lastCron || null;
  // 1) lastCron（来自“真实触发”的 cron）
  // 2) Docker 环境回退到 configuredCron（因为 Docker 的触发器就是靠它配置的）
  // 3) Workers 环境没有 lastCron 前，无法计算 next（只能等待首次真实触发）
  const activeCron = observedCron || (runtime === "docker" ? configuredCron : null);

  const lastTickMs = tickState.lastMs;
  const lastTickAt = lastTickMs ? new Date(lastTickMs).toISOString() : null;
  const nextTick = computeSchedulerTickerNextTick({ activeCron, nowIso, lastTickMs });

  return jsonOk(
    c,
    {
      now: nowIso,
      nowMs,
      runtime,
      cron: {
        configured: configuredCron,
        source: cronSource,
        active: activeCron,
        lastSeen: observedCron,
      },
      lastTick: {
        ms: lastTickMs,
        at: lastTickAt,
        source: lastTickMs ? "system_settings" : null,
      },
      nextTick: {
        at: nextTick.at,
        scheduledAt: nextTick.scheduledAt,
        estimatedAt: nextTick.estimatedAt,
        intervalSec: nextTick.intervalSec,
        cronParseError: nextTick.cronParseError,
      },
      note:
        runtime === "cloudflare" && !observedCron
          ? "尚未观察到平台触发器的首次真实触发：暂时无法计算预计下次触发时间；首次触发后会自动显示。"
          : "提示：at 优先按“上次真实触发 + 间隔”估算（可能包含延迟）；scheduledAt 是 cron 的计划时间（通常是整分/整 5 分钟）。到点后可点右下角刷新校准。",
    },
    "获取平台触发器状态成功",
  );
});

// 立即执行调度作业（管理员）
scheduledRoutes.post("/api/admin/scheduled/jobs/:taskId/run", requireAdmin, async (c) => {
  const db = c.env.DB;
  const taskId = c.req.param("taskId");

  // 获取任务配置
  const job = await getScheduledJob(db, taskId);
  
  // 获取handler（根据 handlerId 调度具体任务类型）
  const handler = scheduledTaskRegistry.getHandler(job.handlerId);
  if (!handler) {
    throw new NotFoundError("任务处理器不存在");
  }

  // 立即执行
  const startTime = Date.now();
  let status = "success";
  let errorMessage = null;
  let summary = null;
  let handlerResult = null;

  try {
    // 构造handler期望的上下文对象
    const ctx = {
      db,
      env: c.env,
      now: new Date().toISOString(),
      config: job.config || {},
    };
    handlerResult = await handler.run(ctx);
    summary = handlerResult?.summary || "手动执行成功";
  } catch (error) {
    status = "failure";
    errorMessage = error.message || "执行失败";
    console.error(`[scheduledRoutes] 手动执行任务 ${taskId} 失败:`, error);
  }

  const durationMs = Date.now() - startTime;
  const finishedAt = new Date().toISOString();
  const startedAtIso = new Date(startTime).toISOString();

  // 记录执行历史
  await recordScheduledJobRun(db, {
    taskId,
    status,
    startedAt: startedAtIso,
    finishedAt,
    durationMs,
    summary,
    errorMessage,
    details:
      handlerResult && typeof handlerResult === "object" ? handlerResult : null,
    triggerType: "manual",
  });

  // 手动执行完成后，同步更新 scheduled_jobs 汇总字段
  const sets = [
    "run_count = run_count + 1",
    "last_run_status = ?",
    "last_run_started_at = ?",
    "last_run_finished_at = ?",
  ];
  const binds = [status, startedAtIso, finishedAt];
  if (status === "failure") {
    sets.push("failure_count = failure_count + 1");
  }
  const sql = `
    UPDATE ${DbTables.SCHEDULED_JOBS}
    SET ${sets.join(", ")}
    WHERE task_id = ?
  `;
  binds.push(taskId);
  await db.prepare(sql).bind(...binds).run();

  return jsonOk(
    c,
    {
      taskId,
      status,
      durationMs,
      summary,
      errorMessage,
    },
    status === "success" ? "任务执行成功" : "任务执行失败"
  );
});

export default scheduledRoutes;
