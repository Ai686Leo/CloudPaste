/**
 * WebDAV路由定义
 */
import { Hono } from "hono";
import { webdavAuthMiddleware, handleWebDAV } from "../webdav/index.js";
import { WEBDAV_BASE_PATH, isReadOperation } from "../webdav/auth/config/WebDAVConfig.js";
import { webdavHeaders } from "../webdav/middlewares/webdavHeaders.js";
import { usePolicy } from "../security/policies/policies.js";

// 创建WebDAV路由处理程序
const webdavRoutes = new Hono();

// WebDAV标准响应头
webdavRoutes.use(WEBDAV_BASE_PATH, webdavHeaders());
webdavRoutes.use(`${WEBDAV_BASE_PATH}/*`, webdavHeaders());

const webdavReadPolicy = usePolicy("webdav.read");
const webdavManagePolicy = usePolicy("webdav.manage");

// WebDAV 每种方法都需要：Basic 认证 → read/manage 策略。
// OPTIONS 走能力发现，不做策略判定。
const buildMiddlewareChain = (method) => {
  const chain = [webdavAuthMiddleware];
  if (method !== "OPTIONS") {
    chain.push(isReadOperation(method) ? webdavReadPolicy : webdavManagePolicy);
  }
  return chain;
};

// 明确定义各种WebDAV方法的处理函数，避免使用all通配符
const webdavMethods = ["GET", "PUT", "DELETE", "OPTIONS", "PROPFIND", "PROPPATCH", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK", "HEAD"];

const wrapWebDAVHandler = () => {
  return (c) => handleWebDAV(c);
};
// 注册WebDAV路由处理器
webdavMethods.forEach((method) => {
  const baseMiddlewares = buildMiddlewareChain(method);
  webdavRoutes.on(method, WEBDAV_BASE_PATH, ...baseMiddlewares, wrapWebDAVHandler());
});

// 处理WebDAV子路径的请求
webdavMethods.forEach((method) => {
  const nestedMiddlewares = buildMiddlewareChain(method);
  webdavRoutes.on(method, `${WEBDAV_BASE_PATH}/*`, ...nestedMiddlewares, wrapWebDAVHandler());
});

export default webdavRoutes;
