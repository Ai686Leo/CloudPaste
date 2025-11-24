import { Hono } from "hono";
import { ValidationError } from "../http/errors.js";
import { ApiStatus, UserType } from "../constants/index.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";
import { getEncryptionSecret } from "../utils/environmentUtils.js";
import { FileShareService } from "../services/fileShareService.js";
import { useRepositories } from "../utils/repositories.js";
import { getQueryBool, getQueryInt, jsonOk } from "../utils/common.js";

const requireFilesCreate = usePolicy("files.create");

const router = new Hono();


const parseFormData = async (c, next) => {
  const formData = await c.req.formData();
  c.set("formData", formData);
  await next();
};

// “直传即分享”（storage-first，S3 直传）
router.put("/api/upload-direct/:filename", requireFilesCreate, async (c) => {
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);

  const { filename } = c.req.param();
  if (!filename) {
    throw new ValidationError("缺少 filename 参数");
  }

  const principalInfo = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const { type: userType, userId, apiKeyInfo } = principalInfo;
  const userIdOrInfo = userType === UserType.ADMIN ? userId : apiKeyInfo;

  const bodyStream = c.req.raw?.body;
  if (!bodyStream) {
    throw new ValidationError("请求体为空");
  }

  const declaredLengthHeader = c.req.header("content-length");
  const declaredLength = declaredLengthHeader ? parseInt(declaredLengthHeader, 10) : 0;

  const storageConfigId = c.req.query("storage_config_id") || null;
  const uploadId = c.req.query("upload_id") || null;

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
    { ...shareParams, uploadId: uploadId || null }
  );

  return jsonOk(c, result, "文件上传成功");
});

// 流式分享上传：通过 PUT /api/share/upload 使用原始 body 直传
router.put("/api/share/upload", requireFilesCreate, async (c) => {
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);

  const principalInfo = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const { type: userType, userId, apiKeyInfo } = principalInfo;
  const userIdOrInfo = userType === UserType.ADMIN ? userId : apiKeyInfo;

  const bodyStream = c.req.raw?.body;
  if (!bodyStream) {
    throw new ValidationError("请求体为空");
  }

  const declaredLengthHeader = c.req.header("content-length");
  const declaredLength = declaredLengthHeader ? parseInt(declaredLengthHeader, 10) : 0;

  const filenameHeader = c.req.header("x-share-filename");
  if (!filenameHeader) {
    throw new ValidationError("缺少 x-share-filename 头部");
  }

  let options = {};
  const optionsHeader = c.req.header("x-share-options");
  if (optionsHeader) {
    try {
      const decoded = Buffer.from(optionsHeader, "base64").toString("utf8");
      options = JSON.parse(decoded) || {};
    } catch {
      options = {};
    }
  }

  const storageConfigId = options.storage_config_id || null;
  const uploadId = options.upload_id || null;

  const shareParams = {
    storage_config_id: storageConfigId,
    path: options.path || null,
    slug: options.slug || null,
    remark: options.remark || "",
    password: options.password || null,
    expiresIn: Number(options.expires_in || 0),
    maxViews: Number(options.max_views || 0),
    override: false,
    useProxy: options.use_proxy !== undefined ? !!options.use_proxy : undefined,
    originalFilename: !!options.original_filename,
    contentType: c.req.header("content-type") || undefined,
    request: c.req.raw,
    uploadId: uploadId || null,
  };

  const shareService = new FileShareService(db, encryptionSecret, repositoryFactory);

  const result = await shareService.uploadDirectToStorageAndShare(
    filenameHeader,
    bodyStream,
    declaredLength,
    userIdOrInfo,
    userType,
    shareParams
  );

  return jsonOk(c, result, "文件上传成功");
});

// 通用分享上传：通过 ObjectStore + File，多存储通用
router.post("/api/share/upload", requireFilesCreate, parseFormData, async (c) => {
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);

  const formData = c.get("formData");
  const file = formData.get("file");
  if (!file) {
    throw new ValidationError("缺少文件参数");
  }

  const storageConfigId = formData.get("storage_config_id") || null;
  const path = formData.get("path") || null;
  const slug = formData.get("slug") || null;
  const remark = formData.get("remark") || "";
  const password = formData.get("password") || null;
  const expiresIn = Number(formData.get("expires_in") || 0);
  const maxViews = Number(formData.get("max_views") || 0);
  const useProxyRaw = formData.get("use_proxy");
  const originalFilenameRaw = formData.get("original_filename");
  const uploadId = formData.get("upload_id") || null;

  const principalInfo = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const { type: userType, userId, apiKeyInfo } = principalInfo;
  const userIdOrInfo = userType === UserType.ADMIN ? userId : apiKeyInfo;

  const shareService = new FileShareService(db, encryptionSecret, repositoryFactory);

  const shareParams = {
    storage_config_id: storageConfigId,
    path: path || null,
    slug: slug || null,
    remark,
    password,
    expiresIn,
    maxViews,
    override: false,
    useProxy:useProxyRaw === "true"? true: useProxyRaw === "false"? false: undefined,
    originalFilename: originalFilenameRaw === "true",
    contentType: file.type || undefined,
    request: c.req.raw,
    uploadId: uploadId || null,
  };

  const result = await shareService.uploadFileViaObjectStoreAndShare(
    file,
    userIdOrInfo,
    userType,
    shareParams
  );

  return jsonOk(c, result, "文件上传成功");
});

// 预签名上传（上传即分享）的初始化
router.post("/api/share/presign", requireFilesCreate, async (c) => {
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);
  const body = await c.req.json();

  const principalInfo = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const { type: userType, userId, apiKeyInfo } = principalInfo;
  const userIdOrInfo = userType === UserType.ADMIN ? userId : apiKeyInfo;

  const { filename, fileSize, contentType, path, storage_config_id } = body || {};
  if (!filename) {
    throw new ValidationError("缺少 filename");
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

  return jsonOk(c, presign, "生成预签名成功");
});

// 预签名提交（创建分享记录）
router.post("/api/share/commit", requireFilesCreate, async (c) => {
  const db = c.env.DB;
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);
  const body = await c.req.json();

  const principalInfo = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const { type: userType, userId, apiKeyInfo } = principalInfo;
  const userIdOrInfo = userType === UserType.ADMIN ? userId : apiKeyInfo;

  const { key, storage_config_id, filename, size, etag, slug, remark, password, expires_in, max_views, use_proxy, original_filename } = body || {};
  if (!filename) {
    throw new ValidationError("缺少 filename");
  }

  // 新协议：必须 key + storage_config_id
  const finalKey = key || null;
  const finalStorageConfigId = storage_config_id || null;
  if (!finalKey || !finalStorageConfigId) {
    throw new ValidationError("缺少 key 或 storage_config_id");
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

  return jsonOk(c, result, "预签名上传提交成功");
});

// =============== URL 信息/代理（并入分享上传模块） ===============
const parseJsonBody = async (c, next) => {
  const body = await c.req.json();
  c.set("jsonBody", body);
  await next();
};

router.post("/api/share/url/info", requireFilesCreate, parseJsonBody, async (c) => {
  const db = c.env.DB;
  const body = c.get("jsonBody") || {};

  if (!body.url) {
    throw new ValidationError("缺少URL参数");
  }

  const encryptionSecret = getEncryptionSecret(c);
  const { FileShareService } = await import("../services/fileShareService.js");
  const shareService = new FileShareService(db, encryptionSecret);
  const metadata = await shareService.validateUrlMetadata(body.url);
  return jsonOk(c, metadata, "URL验证成功");
});

router.get("/api/share/url/proxy", requireFilesCreate, async (c) => {
  const db = c.env.DB;
  const url = c.req.query("url");
  if (!url) {
    throw new ValidationError("缺少URL参数");
  }

  const encryptionSecret = getEncryptionSecret(c);
  const { FileShareService } = await import("../services/fileShareService.js");
  const shareService = new FileShareService(db, encryptionSecret);
  return await shareService.proxyUrlContent(url);
});

// URL → 预签名：根据URL元信息生成上传预签名
export default router;
