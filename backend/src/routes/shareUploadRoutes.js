import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ApiStatus, UserType } from "../constants/index.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";
import { getEncryptionSecret } from "../utils/environmentUtils.js";
import { FileShareService } from "../services/fileShareService.js";
import { useRepositories } from "../utils/repositories.js";
import { getQueryBool, getQueryInt } from "../utils/common.js";

const requireFilesAccess = usePolicy("files.manage");

const router = new Hono();


// “直传即分享”
router.put("/api/upload-direct/:filename", requireFilesAccess, async (c) => {
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);

  const { filename } = c.req.param();
  if (!filename) {
    throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少 filename 参数" });
  }

  const principalInfo = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const { type: userType, userId, apiKeyInfo } = principalInfo;
  const userIdOrInfo = userType === UserType.ADMIN ? userId : apiKeyInfo;

  const bodyStream = c.req.raw?.body;
  if (!bodyStream) {
    throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "请求体为空" });
  }

  const declaredLengthHeader = c.req.header("content-length");
  const declaredLength = declaredLengthHeader ? parseInt(declaredLengthHeader, 10) : 0;

  const storageConfigId = c.req.query("storage_config_id") || null;

  const shareParams = {
    storage_config_id: storageConfigId,
    path: c.req.query("path") || null,
    slug: c.req.query("slug") || null,
    remark: c.req.query("remark") || "",
    password: c.req.query("password") || null,
    expiresIn: getQueryInt(c, "expires_in", 0),
    maxViews: getQueryInt(c, "max_views", 0),
    override: getQueryBool(c, "override", false),
    // 仅当显式提供 use_proxy 时才传递，否则交由记录层按系统默认处理
    useProxy: c.req.query("use_proxy") != null ? getQueryBool(c, "use_proxy", true) : undefined,
    originalFilename: getQueryBool(c, "original_filename", false),
    contentType: c.req.header("content-type") || undefined,
    request: c.req.raw,
  };

  const shareService = new FileShareService(db, encryptionSecret, repositoryFactory);

  const result = await shareService.uploadDirectToStorageAndShare(
    filename,
    bodyStream,
    declaredLength,
    userIdOrInfo,
    userType,
    shareParams
  );

  return c.json({ code: ApiStatus.SUCCESS, message: "文件上传成功", data: result, success: true });
});

// 预签名上传（上传即分享）的初始化
router.post("/api/share/presign", requireFilesAccess, async (c) => {
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);
  const body = await c.req.json();

  const principalInfo = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const { type: userType, userId, apiKeyInfo } = principalInfo;
  const userIdOrInfo = userType === UserType.ADMIN ? userId : apiKeyInfo;

  const { filename, fileSize, contentType, path, storage_config_id } = body || {};
  if (!filename) {
    throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少 filename" });
  }

  const shareService = new FileShareService(db, encryptionSecret, repositoryFactory);

  const presign = await shareService.createPresignedShareUpload({
    filename,
    fileSize,
    contentType,
    path: path || null,
    storage_config_id: storage_config_id || null,
    userIdOrInfo,
    userType,
  });

  return c.json({ code: ApiStatus.SUCCESS, message: "生成预签名成功", data: presign, success: true });
});

// 预签名提交（创建分享记录）
router.post("/api/share/commit", requireFilesAccess, async (c) => {
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);
  const body = await c.req.json();

  const principalInfo = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const { type: userType, userId, apiKeyInfo } = principalInfo;
  const userIdOrInfo = userType === UserType.ADMIN ? userId : apiKeyInfo;

  const { key, storage_config_id, filename, size, etag, slug, remark, password, expires_in, max_views, use_proxy, original_filename } = body || {};
  if (!filename) {
    throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少 filename" });
  }

  // 新协议：必须 key + storage_config_id
  const finalKey = key || null;
  const finalStorageConfigId = storage_config_id || null;
  if (!finalKey || !finalStorageConfigId) {
    throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少 key 或 storage_config_id" });
  }

  const shareService = new FileShareService(db, encryptionSecret, repositoryFactory);

  const result = await shareService.commitPresignedShareUpload({
    key: finalKey,
    storage_config_id: finalStorageConfigId,
    filename,
    size,
    etag,
    slug: slug || null,
    remark: remark || "",
    password: password || null,
    expiresIn: Number(expires_in) || 0,
    maxViews: Number(max_views) || 0,
    useProxy: use_proxy !== undefined ? !!use_proxy : undefined,
    originalFilename: !!original_filename,
    userIdOrInfo,
    userType,
    request: c.req.raw,
  });

  return c.json({ code: ApiStatus.SUCCESS, message: "预签名上传提交成功", data: result, success: true });
});

// =============== URL 信息/代理（并入分享上传模块） ===============
const parseJsonBody = async (c, next) => {
  const body = await c.req.json();
  c.set("jsonBody", body);
  await next();
};

router.post("/api/share/url/info", requireFilesAccess, parseJsonBody, async (c) => {
  const db = c.env.DB;
  const body = c.get("jsonBody") || {};

  if (!body.url) {
    throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少URL参数" });
  }

  const encryptionSecret = getEncryptionSecret(c);
  const { FileShareService } = await import("../services/fileShareService.js");
  const shareService = new FileShareService(db, encryptionSecret);
  const metadata = await shareService.validateUrlMetadata(body.url);
  return c.json({ code: ApiStatus.SUCCESS, message: "URL验证成功", data: metadata, success: true });
});

router.get("/api/share/url/proxy", requireFilesAccess, async (c) => {
  const db = c.env.DB;
  const url = c.req.query("url");
  if (!url) {
    throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少URL参数" });
  }

  const encryptionSecret = getEncryptionSecret(c);
  const { FileShareService } = await import("../services/fileShareService.js");
  const shareService = new FileShareService(db, encryptionSecret);
  return await shareService.proxyUrlContent(url);
});

// URL → 预签名：根据URL元信息生成上传预签名
router.post("/api/share/url/presign", requireFilesAccess, parseJsonBody, async (c) => {
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);

  const body = c.get("jsonBody") || {};
  const { url, path = null, storage_config_id = null } = body;
  if (!url) {
    throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少URL参数" });
  }

  const principalInfo = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const { type: userType, userId, apiKeyInfo } = principalInfo;
  const userIdOrInfo = userType === UserType.ADMIN ? userId : apiKeyInfo;

  const shareService = new FileShareService(db, encryptionSecret, repositoryFactory);

  // 1) 元信息（可被调用方覆盖）
  const meta = await shareService.validateUrlMetadata(url);
  const filename = body.filename || meta.filename || "download";
  const contentType = body.contentType || meta.contentType || "application/octet-stream";
  const fileSize = typeof body.fileSize === "number" ? body.fileSize : (meta.size || undefined);

  // 2) 生成预签名
  const presign = await shareService.createPresignedShareUpload({
    filename,
    fileSize,
    contentType,
    path,
    storage_config_id,
    userIdOrInfo,
    userType,
  });

  // 返回给客户端：presign + 元数据 + 提交建议
  const commitSuggestion = {
    key: presign.key,
    storage_config_id: presign.storage_config_id || storage_config_id || null,
    filename,
    size: fileSize || null,
    etag: null, // 客户端 PUT 完成后从响应头获取
  };

  return c.json({
    code: ApiStatus.SUCCESS,
    message: "URL 预签名生成成功",
    data: { presign, metadata: meta, commit_suggestion: commitSuggestion },
    success: true,
  });
});

export default router;
