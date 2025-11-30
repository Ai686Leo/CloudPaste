import { Hono } from "hono";
import { cors } from "hono/cors";
import adminRoutes from "./routes/adminRoutes.js";
import apiKeyRoutes from "./routes/apiKeyRoutes.js";
import { backupRoutes } from "./routes/backupRoutes.js";

import storageConfigRoutes from "./routes/storageConfigRoutes.js";
import systemRoutes from "./routes/systemRoutes.js";
import mountRoutes from "./routes/mountRoutes.js";
import webdavRoutes from "./routes/webdavRoutes.js";
import fsRoutes from "./routes/fsRoutes.js";
import fsMetaRoutes from "./routes/fsMetaRoutes.js";
import { DbTables, ApiStatus, UserType } from "./constants/index.js";
import { createErrorResponse, jsonOk } from "./utils/common.js";
import filesRoutes from "./routes/filesRoutes.js";
import shareUploadRoutes from "./routes/shareUploadRoutes.js";
import pastesRoutes from "./routes/pastesRoutes.js";
import fileViewRoutes from "./routes/fileViewRoutes.js";
import { fsProxyRoutes } from "./routes/fsProxyRoutes.js";
import { proxyLinkRoutes } from "./routes/proxyLinkRoutes.js";
import { securityContext } from "./security/middleware/securityContext.js";
import { withRepositories } from "./utils/repositories.js";
import { errorBoundary } from "./http/middlewares/errorBoundary.js";
import { normalizeError } from "./http/errors.js";

const getTimeSource = () => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return () => performance.now();
  }
  return () => Date.now();
};

const now = getTimeSource();

const generateRequestId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const getAuthSnapshot = (c) => {
  const authResult = c.get("authResult");
  if (!authResult) {
    return { userType: UserType.ANONYMOUS, userId: null };
  }
  if (authResult.isAdmin && authResult.isAdmin()) {
    return { userType: UserType.ADMIN, userId: authResult.getUserId?.() || null };
  }
  if (authResult.keyInfo) {
    return { userType: UserType.API_KEY, userId: authResult.keyInfo.id || authResult.keyInfo.name || null };
  }
  return { userType: UserType.ANONYMOUS, userId: authResult.getUserId?.() || null };
};

const structuredLogger = async (c, next) => {
  const existingReqId = c.get("reqId");
  const reqId = existingReqId ?? generateRequestId();
  if (!existingReqId) {
    c.set("reqId", reqId);
  }

  const started = now();
  let caughtError = null;
  try {
    await next();
  } catch (error) {
    caughtError = error;
    throw error;
  } finally {
    const handledError = c.get("handledError");
    const durationMs = Number((now() - started).toFixed(2));
    const slow = durationMs >= 1000; // 简单慢请求标记（>=1s）
    const { userType, userId } = getAuthSnapshot(c);
    const status = handledError?.status ?? caughtError?.status ?? c.res?.status ?? 200;
    const logPayload = {
      type: "request",
      reqId,
      method: c.req.method,
      path: c.req.path,
      status,
      durationMs,
      slow,
      userType,
      userId,
    };

    const errorForLog = handledError?.originalError ?? caughtError;
    if (errorForLog) {
      logPayload.error = {
        name: errorForLog.name,
        message: handledError?.publicMessage ?? errorForLog.message,
      };
    }

    console.log(JSON.stringify(logPayload));
  }
};

// 创建一个Hono应用实例
const app = new Hono();

// 注册中间件
app.use("*", structuredLogger);
app.use("*", errorBoundary());
app.use("*", withRepositories());
app.use("*", securityContext());
// 导入WebDAV配置
import { WEBDAV_BASE_PATH } from "./webdav/auth/config/WebDAVConfig.js";

// 统一CORS中间件
app.use("*", async (c, next) => {
  const isWebDAVPath = c.req.path === WEBDAV_BASE_PATH || c.req.path.startsWith(WEBDAV_BASE_PATH + "/");
  const isRootPath = c.req.path === "/";

  if (c.req.method === "OPTIONS" && (isWebDAVPath || isRootPath)) {
    // WebDAV OPTIONS请求和根路径OPTIONS请求跳过CORS自动处理
    console.log("WebDAV OPTIONS请求:", c.req.method, c.req.path);
    await next();
    return;
  } else {
    // 其他请求使用标准CORS处理
    const corsMiddleware = cors({
      origin: (origin) => {
        return origin || "*";
      },
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "X-API-KEY",
        "X-FS-Path-Token",
        "Depth",
        "Destination",
        "Overwrite",
        "If-Match",
        "If-None-Match",
        "If-Modified-Since",
        "If-Unmodified-Since",
        "Lock-Token",
        "Content-Length",
        "X-Requested-With",
        // FS / Share 流式上传自定义头
        "X-FS-Filename",
        "X-FS-Options",
        "X-Share-Filename",
        "X-Share-Options",
      ],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PROPFIND", "PROPPATCH", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK", "HEAD"],
      exposeHeaders: ["ETag", "Content-Length", "Content-Disposition", "Content-Range", "Accept-Ranges"],
      maxAge: 86400,
      credentials: true,
    });

    return await corsMiddleware(c, next);
  }
});

// 根路径WebDAV OPTIONS兼容性处理器
// 为1Panel等客户端提供WebDAV能力发现支持
// 必须在其他路由注册之前，确保优先匹配
app.options("/", (c) => {
  // 返回标准WebDAV能力声明，与/dav路径保持一致
  const headers = {
    Allow: "OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, COPY, MOVE, LOCK, UNLOCK, PROPPATCH",
    DAV: "1, 2",
    "MS-Author-Via": "DAV",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, COPY, MOVE, LOCK, UNLOCK, PROPPATCH",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Depth, Destination, If, Lock-Token, Overwrite, X-Custom-Auth-Key",
    "Access-Control-Expose-Headers": "DAV, Lock-Token, MS-Author-Via",
    "Access-Control-Max-Age": "86400",
  };

  console.log("根路径WebDAV OPTIONS请求 - 客户端兼容性支持");
  return new Response("", { status: 200, headers });
});

// 注册路由
app.route("/", adminRoutes);
app.route("/", apiKeyRoutes);
app.route("/", backupRoutes);
app.route("/", fileViewRoutes);
app.route("/", filesRoutes);
app.route("/", shareUploadRoutes);
app.route("/", pastesRoutes);
app.route("/", storageConfigRoutes);
app.route("/", systemRoutes);
app.route("/", mountRoutes);
app.route("/", webdavRoutes);
app.route("/", fsRoutes);
app.route("/", fsMetaRoutes);
app.route("/", fsProxyRoutes);
app.route("/", proxyLinkRoutes);

// 健康检查路由
app.get("/api/health", (c) => {
  return jsonOk(c, { status: "ok", timestamp: new Date().toISOString() });
});

// 全局错误处理
app.onError((err, c) => {
  const normalized = normalizeError(err, {
    method: c.req.method,
    path: c.req.path,
    reqId: c.get("reqId"),
  });
  console.error(`[错误] ${normalized.publicMessage}`, err);
  const reqId = c.get("reqId");
  if (reqId) c.header("X-Request-Id", String(reqId));
  return c.json(
    createErrorResponse(
      normalized.status,
      normalized.expose ? normalized.publicMessage : "服务器内部错误",
      normalized.code
    ),
    normalized.status
  );
});

// 404路由处理
app.notFound((c) => {
  const reqId = c.get("reqId");
  if (reqId) c.header("X-Request-Id", String(reqId));
  return c.json(
    createErrorResponse(ApiStatus.NOT_FOUND, "未找到请求的资源", "NOT_FOUND"),
    ApiStatus.NOT_FOUND
  );
});

// 将应用导出为默认值
export default app;
