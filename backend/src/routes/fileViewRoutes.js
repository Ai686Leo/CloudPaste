/**
 * 文件查看路由
 * 处理文件分享的查看、下载、预览功能
 */
import { Hono } from "hono";
import { useRepositories } from "../utils/repositories.js";
import { getEncryptionSecret } from "../utils/environmentUtils.js";
import { verifyPassword } from "../utils/crypto.js";
import { generateFileDownloadUrl } from "../services/fileService.js";
import { isOfficeFile } from "../utils/fileUtils.js";
import { handleFileDownload } from "../services/fileViewService.js";
import { getFileBySlug, isFileAccessible } from "../services/fileService.js";
import { ApiStatus } from "../constants/index.js";
import { AppError, NotFoundError, AuthenticationError, AuthorizationError, ValidationError, DriverError } from "../http/errors.js";
import { jsonOk } from "../utils/common.js";

const app = new Hono();

// ==========================================
// 路由处理器
// ==========================================

// 处理API路径下的文件下载请求 /api/file-download/:slug
app.get("/api/file-download/:slug", async (c) => {
  const slug = c.req.param("slug");
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);
  return handleFileDownload(slug, db, encryptionSecret, c.req.raw, true, repositoryFactory); // 强制下载
});

// 处理API路径下的文件预览请求 /api/file-view/:slug
app.get("/api/file-view/:slug", async (c) => {
  const slug = c.req.param("slug");
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);
  return handleFileDownload(slug, db, encryptionSecret, c.req.raw, false, repositoryFactory); // 预览
});

// 处理Office文件直接预览URL请求 /api/office-preview/:slug
app.get("/api/office-preview/:slug", async (c) => {
  const slug = c.req.param("slug");
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);

  // 查询文件详情
  const file = await getFileBySlug(db, slug, encryptionSecret);
  if (!file) {
    throw new NotFoundError("文件不存在");
  }

  // 校验密码
  if (file.password) {
    const url = new URL(c.req.url);
    const passwordParam = url.searchParams.get("password");
    if (!passwordParam) {
      throw new AuthenticationError("需要密码访问此文件");
    }
    const passwordValid = await verifyPassword(passwordParam, file.password);
    if (!passwordValid) {
      throw new AuthenticationError("密码错误");
    }
  }

  const accessCheck = await isFileAccessible(db, file, encryptionSecret);
  if (!accessCheck.accessible) {
    if (accessCheck.reason === "expired") {
      throw new AppError("文件已过期", { status: ApiStatus.GONE, code: "GONE", expose: true });
    }
    throw new AuthorizationError("文件不可访问");
  }

  if (!isOfficeFile(file.mimetype, file.filename)) {
    throw new ValidationError("不是Office文件类型");
  }

  if (!file.storage_config_id || !file.storage_path || !file.storage_type) {
    throw new NotFoundError("文件存储信息不完整");
  }

  // 统一依赖通用 URL 生成逻辑，无存储类型分支

  if (file.max_views && file.max_views > 0 && file.views >= file.max_views) {
    throw new AppError("文件已达到最大查看次数", { status: ApiStatus.GONE, code: "GONE", expose: true });
  }

  const urlsObj = await generateFileDownloadUrl(db, file, encryptionSecret, c.req.raw).catch((error) => {
    console.error("生成Office预览URL失败:", error);
    throw new DriverError("生成预览URL失败", { details: { cause: error?.message } });
  });
  const presignedUrl = urlsObj?.previewUrl;

  return jsonOk(c, {
    url: presignedUrl,
    filename: file.filename,
    mimetype: file.mimetype,
    is_temporary: true,
  }, "获取预览URL成功");
});

export default app;
