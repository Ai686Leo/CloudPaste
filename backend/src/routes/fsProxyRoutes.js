/**
 * 文件系统代理路由
 * 处理/p/*路径的文件访问请求
 * 专门用于web_proxy功能的文件代理访问
 */

import { Hono } from "hono";
import { AppError, AuthenticationError, DriverError } from "../http/errors.js";
import { ApiStatus } from "../constants/index.js";
import { MountManager } from "../storage/managers/MountManager.js";
import { FileSystem } from "../storage/fs/FileSystem.js";
import { findMountPointByPathForProxy } from "../storage/fs/utils/MountResolver.js";
import { PROXY_CONFIG, safeDecodeProxyPath } from "../constants/proxy.js";
import { ProxySignatureService } from "../services/ProxySignatureService.js";
import { getEncryptionSecret } from "../utils/environmentUtils.js";
import { getQueryBool } from "../utils/common.js";
import { CAPABILITIES } from "../storage/interfaces/capabilities/index.js";

// 签名代理路径不会走 RBAC，因此这里用结构化日志补充最少可观测性。
const emitProxyAudit = (c, details) => {
  const payload = {
    type: "proxy.audit",
    reqId: c.get?.("reqId") ?? null,
    path: details.path,
    decision: details.decision,
    reason: details.reason ?? null,
    signatureRequired: details.signatureRequired ?? false,
    signatureProvided: details.signatureProvided ?? false,
    mountId: details.mountId ?? null,
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(payload));
};

const fsProxyRoutes = new Hono();

/**
 * 处理OPTIONS预检请求 - 代理路由
 */
fsProxyRoutes.options(`${PROXY_CONFIG.ROUTE_PREFIX}/*`, (c) => {
  // CORS头部将由全局CORS中间件自动处理
  return c.text("", 204); // No Content
});

/**
 * 处理文件代理访问
 * 路径格式：/p/mount/path/file.ext?download=true
 *
 */
fsProxyRoutes.get(`${PROXY_CONFIG.ROUTE_PREFIX}/*`, async (c) => {
  const run = async () => {
    const url = new URL(c.req.url);
    const fullPath = url.pathname;
    const rawPath = fullPath.replace(new RegExp(`^${PROXY_CONFIG.ROUTE_PREFIX}`), "") || "/";
    const path = safeDecodeProxyPath(rawPath);
    const download = getQueryBool(c, "download", false);
    const db = c.env.DB;
    const encryptionSecret = getEncryptionSecret(c);

    console.log(`[fsProxy] 代理访问: ${path}`);

    // 查找挂载点（已在MountResolver中验证web_proxy配置）
    const mountResult = await findMountPointByPathForProxy(db, path);

    if (mountResult.error) {
      console.warn(`代理访问失败 - 挂载点查找失败: ${mountResult.error.message}`);
      emitProxyAudit(c, {
        path,
        decision: "deny",
        reason: "mount_lookup_failed",
        signatureRequired: false,
        signatureProvided: Boolean(c.req.query(PROXY_CONFIG.SIGN_PARAM)),
      });
      const status = mountResult.error.status;
      const code = status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : "PROXY_ERROR";
      throw new AppError(mountResult.error.message, { status, code, expose: true });
    }

    // 挂载点验证成功，mountResult包含mount和subPath信息

    // 检查是否需要签名验证
    const repositoryFactory = c.get("repos");
    const signatureService = new ProxySignatureService(db, encryptionSecret, repositoryFactory);
    const signatureNeed = await signatureService.needsSignature(mountResult.mount);

    if (signatureNeed.required) {
      const signature = c.req.query(PROXY_CONFIG.SIGN_PARAM);

      if (!signature) {
        console.warn(`代理访问失败 - 缺少签名: ${path} (${signatureNeed.reason})`);
        emitProxyAudit(c, {
          path,
          decision: "deny",
          reason: "missing_signature",
          signatureRequired: true,
          signatureProvided: false,
          mountId: mountResult.mount.id,
        });
        throw new AuthenticationError(`此文件需要签名访问 (${signatureNeed.description})`);
      }

      const verifyResult = signatureService.verifyStorageSignature(path, signature);
      if (!verifyResult.valid) {
        console.warn(`代理访问失败 - 签名验证失败: ${path} (${verifyResult.reason})`);
        emitProxyAudit(c, {
          path,
          decision: "deny",
          reason: "invalid_signature",
          signatureRequired: true,
          signatureProvided: true,
          mountId: mountResult.mount.id,
        });
        throw new AuthenticationError(`签名验证失败: ${verifyResult.reason}`);
      }

      console.log(`[fsProxy] 签名验证成功: ${path}`);
    }

    // 创建FileSystem实例进行文件访问
    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const driver = await mountManager.getDriver(mountResult.mount);
    if (!driver.hasCapability(CAPABILITIES.PROXY)) {
      throw new AppError("当前存储驱动不支持代理访问", { status: ApiStatus.NOT_IMPLEMENTED, code: "PROXY_NOT_SUPPORTED", expose: true });
    }
    const fileSystem = new FileSystem(mountManager);

    // 获取文件名用于下载
    const fileName = path.split("/").filter(Boolean).pop() || "file";

    // 代理访问使用特殊的用户类型（因为已通过挂载点配置验证）
    const fileResponse = await fileSystem.downloadFile(path, fileName, c.req.raw, PROXY_CONFIG.USER_TYPE, PROXY_CONFIG.USER_TYPE);

    // 创建新的Headers对象，确保所有重要头部都被正确传递
    const responseHeaders = new Headers();

    // 复制所有原始响应头部
    for (const [key, value] of fileResponse.headers.entries()) {
      // 跳过一些可能冲突的头部，让Hono和CORS中间件处理
      if (!["access-control-allow-origin", "access-control-allow-credentials", "access-control-expose-headers"].includes(key.toLowerCase())) {
        responseHeaders.set(key, value);
        c.header(key, value); // 同时设置到Hono context以便CORS中间件处理
      }
    }

    // 如果是下载模式，覆盖Content-Disposition头
    if (download) {
      const downloadDisposition = `attachment; filename="${encodeURIComponent(fileName)}"`;
      responseHeaders.set("Content-Disposition", downloadDisposition);
      c.header("Content-Disposition", downloadDisposition);
    }

    // 仅在非200状态码时记录详细信息
    if (fileResponse.status !== 200) {
      console.log(`[fsProxy] 响应状态: ${fileResponse.status} -> ${path}`);
    }

    const response = new Response(fileResponse.body, {
      status: fileResponse.status,
      headers: responseHeaders, // 使用完整的响应头而不是c.res.headers
    });

    emitProxyAudit(c, {
      path,
      decision: "allow",
      reason: signatureNeed.required ? "signature_valid" : "signature_not_required",
      signatureRequired: signatureNeed.required,
      signatureProvided: signatureNeed.required ? Boolean(c.req.query(PROXY_CONFIG.SIGN_PARAM)) : false,
      mountId: mountResult.mount.id,
    });

    return response;
  };

  return run().catch((error) => {
    console.error("文件系统代理访问错误:", error);

    if (!(error instanceof AppError)) {
      const signatureParam = typeof c.req?.query === "function" ? c.req.query(PROXY_CONFIG.SIGN_PARAM) : null;
      emitProxyAudit(c, {
        path: c.req?.path ?? null,
        decision: "deny",
        reason: "internal_error",
        signatureRequired: false,
        signatureProvided: Boolean(signatureParam),
      });
      throw new DriverError("代理访问失败", { details: { cause: error?.message } });
    }

    throw error;
  });
});

export { fsProxyRoutes };
