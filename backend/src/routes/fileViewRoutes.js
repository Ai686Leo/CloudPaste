/**
 * 文件查看路由
 * 处理文件分享的查看、下载、预览功能
 */
import { Hono } from "hono";
import { getEncryptionSecret } from "../utils/environmentUtils.js";
import { handleFileDownload, checkAndDeleteExpiredFile } from "../services/fileViewService.js";
import { getFileBySlug, isFileAccessible } from "../services/fileService.js";
import { useRepositories } from "../utils/repositories.js";
import { ApiStatus } from "../constants/index.js";
import { AppError, AuthorizationError, NotFoundError } from "../http/errors.js";
import { verifyPassword } from "../utils/crypto.js";

const app = new Hono();

// ==========================================
// 路由处理器
// ==========================================

// Share 内容路由 /api/s/:slug
// - 统一处理分享视图下的内容访问（预览/下载）
// - 通过 mode=inline|attachment 区分预览与下载行为
app.get("/api/s/:slug", async (c) => {
  const slug = c.req.param("slug");
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);

  // 统一从文件记录出发做密码与过期校验，避免直链路径绕过密码保护
  const file = await getFileBySlug(db, slug, encryptionSecret);
  if (!file) {
    throw new NotFoundError("文件不存在");
  }

  const url = new URL(c.req.url);
  const passwordParam = url.searchParams.get("password");
  const mode = url.searchParams.get("mode") || "inline";
  const forceDownload = mode === "attachment";

  if (file.password) {
    if (!passwordParam) {
      throw new AuthorizationError("需要密码访问此文件");
    }
    const valid = await verifyPassword(passwordParam, file.password);
    if (!valid) {
      throw new AuthorizationError("密码不正确");
    }
  }

  const accessCheck = await isFileAccessible(db, file, encryptionSecret);
  if (!accessCheck.accessible) {
    if (accessCheck.reason === "expired") {
      await checkAndDeleteExpiredFile(db, file, encryptionSecret, repositoryFactory);
      throw new AppError("文件已过期", { status: ApiStatus.GONE, code: "GONE", expose: true });
    }
    throw new AuthorizationError("文件不可访问");
  }

  // 内容交付逻辑统一由 FileViewService 处理：
  // - 当 use_proxy = 1 时，通过 ObjectStore 代理流式返回（share 层本地代理）
  // - 当 use_proxy = 0 时，优先使用存储直链（S3 custom_host / 预签名等 DirectLink 能力），否则返回 501
  return handleFileDownload(slug, db, encryptionSecret, c.req.raw, forceDownload, repositoryFactory);
});

export default app;
