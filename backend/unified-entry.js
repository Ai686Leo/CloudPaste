// unified-entry.js - 统一入口
// 在 Cloudflare Workers 环境下导出 { fetch } 处理函数
// 在 Node/Docker 环境下启动基于 Hono 的 HTTP 服务器

// 顶层导入仅包含跨环境可用的模块（Hono 应用与公共工具）
import app from "./src/index.js";
import { ApiStatus } from "./src/constants/index.js";
import { ensureDatabaseReady } from "./src/db/index.js";
import { registerTaskHandlers } from "./src/storage/fs/tasks/registerHandlers.js";
import { registerJobTypes, validateJobTypesConsistency } from "./src/storage/fs/tasks/registerJobTypes.js";
import { registerScheduledHandlers } from "./src/scheduled/ScheduledTaskRegistry.js";
import { runDueScheduledJobs } from "./src/scheduled/runDueScheduledJobs.js";
import { upsertSchedulerTickState } from "./src/services/schedulerTickerStateService.js";

// 在模块加载时注册所有任务处理器和调度任务处理器
registerTaskHandlers();
registerJobTypes();
validateJobTypesConsistency();
registerScheduledHandlers();

// 运行时环境检测：通过 caches.default 判断是否为 Cloudflare Workers
const isCloudflareWorkers = (() => {
  try {
    return typeof caches !== "undefined" && typeof caches.default !== "undefined";
  } catch {
    return false;
  }
})();

// Cloudflare Workflows 条件导出（仅在 Workers 环境下实际使用）
export const JobWorkflow = isCloudflareWorkers
  ? (await import("./src/workflows/JobWorkflow.ts")).JobWorkflow
  : class JobWorkflow {
      constructor() {
        console.warn("JobWorkflow 在 Node 环境下不可用");
      }
      async run() {
        throw new Error("JobWorkflow 仅在 Cloudflare Workers 环境下可用");
      }
    };

// ============ Cloudflare Workers 环境导出 ============
// 默认导出 fetch，只在 Workers 环境下由 Cloudflare 调用；
// 在 Node 环境下不会被使用
let dbInitPromise = null;

async function ensureDbReadyOnce(env) {
  if (dbInitPromise) return dbInitPromise;
  if (!env?.DB) {
    throw new Error("DB 未绑定，请在 Cloudflare 绑定中配置 D1 数据库");
  }

  dbInitPromise = ensureDatabaseReady({ db: env.DB, env });
  try {
    await dbInitPromise;
  } catch (error) {
    // 初始化失败时允许后续请求重试，避免一次失败后永久跳过
    dbInitPromise = null;
    throw error;
  }
  return dbInitPromise;
}

export default {
  async fetch(request, env, ctx) {
    try {
      if (!env || !env.ENCRYPTION_SECRET) {
        throw new Error("ENCRYPTION_SECRET 未配置，请在Cloudflare绑定中设置安全密钥");
      }

      const bindings = {
        ...env,
        DB: env.DB,
        ENCRYPTION_SECRET: env.ENCRYPTION_SECRET,
      };

      await ensureDbReadyOnce(env);

      return app.fetch(request, bindings, ctx);
    } catch (error) {
      console.error("处理请求时发生错误:", error);
      return new Response(
        JSON.stringify({
          code: ApiStatus.INTERNAL_ERROR,
          message: "服务器内部错误",
          error: error.message,
          success: false,
          data: null,
        }),
        {
          status: ApiStatus.INTERNAL_ERROR,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  },

  async scheduled(controller, env, ctx) {
    try {
      if (!env || !env.DB) {
        console.warn("[scheduled] 缺少 DB 绑定，跳过维护任务执行");
        return;
      }

      console.log("[scheduled] Cloudflare scheduled 触发，开始检查到期后台任务...", new Date().toISOString());

      await ensureDbReadyOnce(env);
      // 记录“真实触发发生”的证据
      await upsertSchedulerTickState(env.DB, {
        lastMs: Date.now(),
        lastCron: controller?.cron ? String(controller.cron) : null,
      });
      await runDueScheduledJobs(env.DB, env);
    } catch (error) {
      console.error("[scheduled] 执行维护任务时发生错误:", error);
    }
  },
};

// ============ Node/Docker 环境启动逻辑 ============
if (!isCloudflareWorkers) {
  const bootstrap = async () => {
    const [{ serve }, { default: path }, { default: fs }, { fileURLToPath }, { createSQLiteAdapter }] = await Promise.all([
      import("@hono/node-server"),
      import("path"),
      import("fs"),
      import("url"),
      // 动态字符串拼接避免 Wrangler esbuild 静态分析,Workers 环境不会执行此分支
      import(`${"."}/src/adapters/SQLiteAdapter.js`),
    ]);

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const port = Number(process.env.PORT) || 8787;
    const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, "cloudpaste.db");

    const sqliteAdapter = await createSQLiteAdapter(dbPath);
    await ensureDatabaseReady({ db: sqliteAdapter, env: process.env });

    const bindings = {
      DB: sqliteAdapter,
      ENCRYPTION_SECRET: process.env.ENCRYPTION_SECRET,
      TASK_DATABASE_PATH: dbPath,
      TASK_WORKER_POOL_SIZE: Number(process.env.TASK_WORKER_POOL_SIZE) || 10,
    };

    if (!bindings.ENCRYPTION_SECRET) {
      throw new Error("ENCRYPTION_SECRET 未设置，请在环境变量中配置安全密钥");
    }

    // 启动 Node/Docker 环境内部调度器：
    // - 使用 node-schedule 定期触发 runDueScheduledJobs
    // - cron 表达式可以通过环境变量 SCHEDULED_TICK_CRON 覆盖，默认每分钟一次
    const cronExpr = process.env.SCHEDULED_TICK_CRON || "*/1 * * * *";
    const { scheduleJob } = await import("node-schedule");
    try {
      scheduleJob(cronExpr, async () => {
        const tickStartedAt = new Date();
        const tickStartedIso = tickStartedAt.toISOString();
        console.log("[scheduled] node-schedule tick 触发", { time: tickStartedIso, cron: cronExpr });

        const startedMs = Date.now();
        try {
          // 记录“真实触发发生”的证据
          await upsertSchedulerTickState(sqliteAdapter, {
            lastMs: startedMs,
            lastCron: cronExpr,
          });
          await runDueScheduledJobs(sqliteAdapter, bindings);
        } catch (error) {
          const durationMs = Date.now() - startedMs;
          console.error("[scheduled] node-schedule tick 执行失败:", {
            time: new Date().toISOString(),
            durationMs,
            error,
          });
        }
      });
      console.log(`[scheduled] 已在 Node/Docker 环境启动内部调度器，cron=${cronExpr}`);
    } catch (error) {
      console.error("[scheduled] 启动内部调度器失败:", error);
    }

    // 使用 @hono/node-server 启动 Node 服务器
    serve(
      {
        fetch: (request) => app.fetch(request, bindings),
        port,
        // 保持默认的 overrideGlobalObjects/autoCleanupIncoming 配置
      },
      (info) => {
        console.log(`CloudPaste 后端服务运行在 http://0.0.0.0:${info.port}`);
        // 启动 Docker/Node 环境内存监控（包括容器内存检测）
        startMemoryMonitoring(fs);
      }
    );
  };

  // 直接在 Node 环境中启动
  bootstrap();
}

/**
 * 启动内存使用监控：
 * - 周期性输出 Node 进程内存使用情况
 * - 如在容器内运行，尝试读取 cgroup v2/v1 的内存使用与上限
 * - 在内存使用率较高时尝试触发一次 GC（如果启用了 --expose-gc）
 */
function startMemoryMonitoring(fs, interval = 1200000) {
  // 读取容器内存使用情况（优先 cgroup v2，其次 v1）
  const getContainerMemory = () => {
    try {
      let usage = null;
      let limit = null;

      // cgroup v2
      if (fs.existsSync("/sys/fs/cgroup/memory.current")) {
        usage = parseInt(fs.readFileSync("/sys/fs/cgroup/memory.current", "utf8"));
        const maxContent = fs.readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim();
        if (maxContent !== "max") {
          limit = parseInt(maxContent);
        }
      }
      // cgroup v1
      else if (fs.existsSync("/sys/fs/cgroup/memory/memory.usage_in_bytes")) {
        usage = parseInt(fs.readFileSync("/sys/fs/cgroup/memory/memory.usage_in_bytes", "utf8"));
        const limitValue = parseInt(fs.readFileSync("/sys/fs/cgroup/memory/memory.limit_in_bytes", "utf8"));
        if (Number.isFinite(limitValue) && limitValue < Number.MAX_SAFE_INTEGER) {
          limit = limitValue;
        }
      }

      return usage && limit ? { usage, limit } : null;
    } catch {
      // 非容器环境或无权限时静默忽略
      return null;
    }
  };

  const logMemoryUsage = () => {
    const mem = process.memoryUsage();
    const containerMem = getContainerMemory();

    const memoryInfo = {
      rss: `${Math.round(mem.rss / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)} MB`,
      external: `${Math.round(mem.external / 1024 / 1024)} MB`,
      arrayBuffers: mem.arrayBuffers ? `${Math.round(mem.arrayBuffers / 1024 / 1024)} MB` : "N/A",
    };

    if (containerMem) {
      memoryInfo.container = `${Math.round(containerMem.usage / 1024 / 1024)} MB / ${Math.round(containerMem.limit / 1024 / 1024)} MB`;
      memoryInfo.containerUsage = `${Math.round((containerMem.usage / containerMem.limit) * 100)}%`;
    }

    console.log("内存使用情况:", memoryInfo);

    // 简单的高占用检测逻辑
    let shouldGC = false;
    if (containerMem) {
      // 容器内存使用率超过 85% 时尝试 GC
      shouldGC = containerMem.usage / containerMem.limit > 0.85;
    } else {
      // 非容器环境回退到进程内存判断
      shouldGC = mem.heapUsed / mem.heapTotal > 0.85 || mem.external > 50 * 1024 * 1024 || (mem.arrayBuffers && mem.arrayBuffers > 50 * 1024 * 1024);
    }

    if (global.gc && shouldGC) {
      console.log("检测到内存使用较高，尝试手动垃圾回收");
      try {
        global.gc();
      } catch (e) {
        console.warn("手动垃圾回收失败:", e?.message || e);
      }
    }
  };

  // 立即输出一次
  logMemoryUsage();

  // 周期性输出
  const intervalId = setInterval(logMemoryUsage, interval);

  // 防止定时器阻止进程退出
  process.on("exit", () => {
    clearInterval(intervalId);
  });

  return {
    stop: () => clearInterval(intervalId),
    logNow: () => logMemoryUsage(),
  };
}
