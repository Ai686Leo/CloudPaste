// unified-entry.js - 统一入口
// 在 Cloudflare Workers 环境下导出 { fetch } 处理函数
// 在 Node/Docker 环境下启动基于 Hono 的 HTTP 服务器

// 顶层导入仅包含跨环境可用的模块（Hono 应用与公共工具）
import app from "./src/index.js";
import { ApiStatus } from "./src/constants/index.js";
import { checkAndInitDatabase } from "./src/utils/database.js";
import { registerTaskHandlers } from "./src/storage/fs/tasks/registerHandlers.js";

// 在模块加载时注册所有任务处理器
registerTaskHandlers();

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
        console.warn('JobWorkflow 在 Node 环境下不可用');
      }
      async run() {
        throw new Error('JobWorkflow 仅在 Cloudflare Workers 环境下可用');
      }
    };

// ============ Cloudflare Workers 环境导出 ============ 
// 默认导出 fetch，只在 Workers 环境下由 Cloudflare 调用；
// 在 Node 环境下不会被使用
let isDbInitialized = false;

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

      if (!isDbInitialized) {
        console.log("首次请求，检查数据库状态...");
        isDbInitialized = true;
        try {
          await checkAndInitDatabase(env.DB);
        } catch (error) {
          console.error("数据库初始化出错:", error);
        }
      }

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
    await checkAndInitDatabase(sqliteAdapter);

    const bindings = {
      DB: sqliteAdapter,
      ENCRYPTION_SECRET: process.env.ENCRYPTION_SECRET,
      TASK_DATABASE_PATH: dbPath,
      TASK_WORKER_POOL_SIZE: Number(process.env.TASK_WORKER_POOL_SIZE) || 10,
    };

    if (!bindings.ENCRYPTION_SECRET) {
      throw new Error("ENCRYPTION_SECRET 未设置，请在环境变量中配置安全密钥");
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
        startMemoryMonitoring();
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
function startMemoryMonitoring(interval = 1200000) {
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
      memoryInfo.container = `${Math.round(containerMem.usage / 1024 / 1024)} MB / ${Math.round(
        containerMem.limit / 1024 / 1024
      )} MB`;
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
      shouldGC =
        mem.heapUsed / mem.heapTotal > 0.85 ||
        mem.external > 50 * 1024 * 1024 ||
        (mem.arrayBuffers && mem.arrayBuffers > 50 * 1024 * 1024);
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
