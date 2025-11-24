import { ValidationError, AuthenticationError } from "../../http/errors.js";
import { ApiStatus } from "../../constants/index.js";
import { generateFileId, jsonOk } from "../../utils/common.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { invalidateFsCache } from "../../cache/invalidation.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { usePolicy } from "../../security/policies/policies.js";

const parseJsonBody = async (c, next) => {
  const body = await c.req.json();
  c.set("jsonBody", body);
  await next();
};

const jsonPathResolver = (field = "path", options = {}) => {
  const { optional = false } = options;
  return (c) => {
    const body = c.get("jsonBody");
    if (!body) {
      return optional ? "/" : undefined;
    }
    const value = body[field];
    if ((value === undefined || value === null || value === "") && optional) {
      return "/";
    }
    return value;
  };
};

const presignTargetResolver = (c) => {
  const body = c.get("jsonBody");
  if (!body) {
    return undefined;
  }
  const { path, fileName } = body;
  if (!path || !fileName) {
    return undefined;
  }
  return path.endsWith("/") ? `${path}${fileName}` : `${path}/${fileName}`;
};

export const registerMultipartRoutes = (router, helpers) => {
  const { getServiceParams } = helpers;

  const requireUserContext = (c) => {
    const userInfo = c.get("userInfo");
    if (!userInfo) {
      throw new AuthenticationError("未授权访问");
    }
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    return { db: c.env.DB, encryptionSecret: getEncryptionSecret(c), repositoryFactory: c.get("repos"), userInfo, userIdOrInfo, userType };
  };

  router.post("/api/fs/multipart/init", parseJsonBody, usePolicy("fs.upload", { pathResolver: jsonPathResolver() }), async (c) => {
    const { db, encryptionSecret, repositoryFactory, userIdOrInfo, userType } = requireUserContext(c);
    const body = c.get("jsonBody");
    const { path, fileName, fileSize, partSize = 5 * 1024 * 1024, partCount } = body;

    if (!path || !fileName) {
      throw new ValidationError("缺少必要参数");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.initializeFrontendMultipartUpload(path, fileName, fileSize, userIdOrInfo, userType, partSize, partCount);

    return jsonOk(c, result, "前端分片上传初始化成功");
  });

  router.post("/api/fs/multipart/complete", parseJsonBody, usePolicy("fs.upload", { pathResolver: jsonPathResolver() }), async (c) => {
    const { db, encryptionSecret, repositoryFactory, userIdOrInfo, userType } = requireUserContext(c);
    const body = c.get("jsonBody");
    const { path, uploadId, parts, fileName, fileSize } = body;

    if (!path || !uploadId || !Array.isArray(parts) || parts.length === 0) {
      throw new ValidationError("缺少必要参数");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
  const result = await fileSystem.completeFrontendMultipartUpload(path, uploadId, parts, fileName, fileSize, userIdOrInfo, userType);

    return jsonOk(c, { ...result, publicUrl: result.publicUrl || null }, "前端分片上传完成");
  });

  router.post("/api/fs/multipart/abort", parseJsonBody, usePolicy("fs.upload", { pathResolver: jsonPathResolver() }), async (c) => {
    const { db, encryptionSecret, repositoryFactory, userIdOrInfo, userType } = requireUserContext(c);
    const body = c.get("jsonBody");
    const { path, uploadId, fileName } = body;

    if (!path || !uploadId || !fileName) {
      throw new ValidationError("缺少必要参数");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    await fileSystem.abortFrontendMultipartUpload(path, uploadId, fileName, userIdOrInfo, userType);

    return jsonOk(c, undefined, "已中止分片上传");
  });

  router.post("/api/fs/multipart/list-uploads", parseJsonBody, usePolicy("fs.upload", { pathCheck: true, pathResolver: jsonPathResolver("path", { optional: true }) }), async (c) => {
    const { db, encryptionSecret, repositoryFactory, userIdOrInfo, userType } = requireUserContext(c);
    const body = c.get("jsonBody");
    const { path = "" } = body;

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.listMultipartUploads(path, userIdOrInfo, userType);

    return jsonOk(c, result, "列出进行中的分片上传成功");
  });

  router.post("/api/fs/multipart/list-parts", parseJsonBody, usePolicy("fs.upload", { pathResolver: jsonPathResolver() }), async (c) => {
    const { db, encryptionSecret, repositoryFactory, userIdOrInfo, userType } = requireUserContext(c);
    const body = c.get("jsonBody");
    const { path, uploadId, fileName } = body;

    if (!path || !uploadId || !fileName) {
      throw new ValidationError("缺少必要参数");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.listMultipartParts(path, uploadId, fileName, userIdOrInfo, userType);

    return jsonOk(c, result, "列出已上传的分片成功");
  });

  router.post("/api/fs/multipart/refresh-urls", parseJsonBody, usePolicy("fs.upload", { pathResolver: jsonPathResolver() }), async (c) => {
    const { db, encryptionSecret, repositoryFactory, userIdOrInfo, userType } = requireUserContext(c);
    const body = c.get("jsonBody");
    const { path, uploadId, partNumbers } = body;

    if (!path || !uploadId || !Array.isArray(partNumbers) || partNumbers.length === 0) {
      throw new ValidationError("缺少必要参数");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.refreshMultipartUrls(path, uploadId, partNumbers, userIdOrInfo, userType);

    return jsonOk(c, result, "刷新分片上传预签名URL成功");
  });

  router.post("/api/fs/presign", parseJsonBody, usePolicy("fs.upload", { pathResolver: presignTargetResolver }), async (c) => {
    const { db, encryptionSecret, repositoryFactory, userIdOrInfo, userType } = requireUserContext(c);
    const body = c.get("jsonBody");
    const { path, fileName, contentType = "application/octet-stream", fileSize = 0 } = body;

    if (!path || !fileName) {
      throw new ValidationError("请提供上传路径和文件名");
    }

    const targetPath = presignTargetResolver(c);

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const { mount } = await mountManager.getDriverByPath(path, userIdOrInfo, userType);

    if (!mount || !mount.storage_config_id) {
      throw new ValidationError("当前路径不支持预签名URL上传");
    }

    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.generateUploadUrl(targetPath, userIdOrInfo, userType, {
      operation: "upload",
      fileName,
      fileSize,
      contentType,
    });

    const fileId = generateFileId();

  return jsonOk(c, {
        presignedUrl: result.uploadUrl,
        fileId,
        storagePath: result.storagePath,
        publicUrl: result.publicUrl || null,
        mountId: mount.id,
        storageConfigId: mount.storage_config_id,
        targetPath,
        contentType: result.contentType,
      },
      { success: true },
    );
  });

  router.post("/api/fs/presign/commit", parseJsonBody, usePolicy("fs.upload", { pathResolver: jsonPathResolver("targetPath") }), async (c) => {
    const { db, encryptionSecret, repositoryFactory, userIdOrInfo, userType } = requireUserContext(c);
    const body = c.get("jsonBody");
    const targetPath = body.targetPath;
    const mountId = body.mountId;
    const fileSize = body.fileSize || 0;
    const etag = body.etag || null;
    const contentType = body.contentType || undefined;

    if (!targetPath || !mountId) {
      throw new ValidationError("请提供完整的上传信息");
    }

    const fileName = targetPath.split("/").filter(Boolean).pop();

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);

    // 使用 FileSystem 对齐目录标记与缓存逻辑
    const result = await fileSystem.commitPresignedUpload(targetPath, fileName, userIdOrInfo, userType, {
      fileSize,
      etag,
      contentType,
    });

    // 同时触发目录缓存失效（冗余保护，确保一致性）
    invalidateFsCache({ mountId, reason: "presign-commit", db });

    return jsonOk(c, { ...result, publicUrl: result.publicUrl || null, fileName, targetPath, fileSize }, "文件上传完成");
  });
};
