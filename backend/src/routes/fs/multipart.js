import { ValidationError, AuthenticationError } from "../../http/errors.js";
import { ApiStatus } from "../../constants/index.js";
import { generateFileId, jsonOk } from "../../utils/common.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { usePolicy } from "../../security/policies/policies.js";
import { findUploadSessionById } from "../../utils/uploadSessions.js";

const toAbsoluteUrlIfRelative = (requestUrl, maybeUrl) => {
  if (typeof maybeUrl !== "string" || maybeUrl.length === 0) {
    return maybeUrl;
  }
  if (!maybeUrl.startsWith("/")) {
    return maybeUrl;
  }
  const origin = new URL(requestUrl).origin;
  return new URL(maybeUrl, origin).toString();
};

const ensureAbsoluteSessionUploadUrl = (c, payload) => {
  const session = payload?.session;
  const uploadUrl = session?.uploadUrl;
  const absolute = toAbsoluteUrlIfRelative(c.req.url, uploadUrl);
  if (!session || absolute === uploadUrl) {
    return payload;
  }
  return {
    ...payload,
    session: {
      ...session,
      uploadUrl: absolute,
    },
  };
};

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
    const result = await fileSystem.initializeFrontendMultipartUpload(
      path,
      fileName,
      fileSize,
      userIdOrInfo,
      userType,
      partSize,
      partCount,
    );

    return jsonOk(c, ensureAbsoluteSessionUploadUrl(c, result), "前端分片上传初始化成功");
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

    return jsonOk(c, ensureAbsoluteSessionUploadUrl(c, result), "刷新分片上传预签名URL成功");
  });

  // 前端分片上传中转端点（single_session 场景）
  // 当前主要用于 GOOGLE_DRIVE：前端使用 Uppy + AwsS3 在浏览器中切片，
  // 每个分片通过该端点中转到后端，再由后端转发至 Google Drive resumable 会话。
  router.put("/api/fs/multipart/upload-chunk", usePolicy("fs.upload", { pathCheck: false }), async (c) => {
    const { db, encryptionSecret, repositoryFactory, userIdOrInfo, userType } = requireUserContext(c);

    const uploadId = c.req.query("upload_id");
    if (!uploadId) {
      throw new ValidationError("缺少 upload_id 参数");
    }

    const body = c.req.raw?.body;
    if (!body) {
      throw new ValidationError("请求体为空");
    }

    const contentRange = c.req.header("content-range") || c.req.header("Content-Range") || null;
    if (!contentRange) {
      throw new ValidationError("缺少 Content-Range 头部");
    }

    const contentLengthHeader = c.req.header("content-length") || c.req.header("Content-Length") || null;
    const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) || 0 : 0;

    const sessionRow = await findUploadSessionById(db, { id: uploadId });
    if (!sessionRow) {
      throw new ValidationError("未找到对应的上传会话");
    }

    if (sessionRow.storage_type !== "GOOGLE_DRIVE") {
      throw new ValidationError("当前上传会话的存储类型不支持通过该端点上传分片");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);

    const { driver, mount } = await fileSystem.mountManager.getDriverByPath(
      sessionRow.fs_path,
      userIdOrInfo,
      userType,
    );

    if (driver.getType() !== "GOOGLE_DRIVE") {
      throw new ValidationError("上传会话对应的驱动不是 Google Drive");
    }

    // 委托给 GoogleDriveStorageDriver 进行分片转发
    // 仅 GoogleDriveStorageDriver 实现该方法，其他驱动不会触发此逻辑
    // @ts-ignore
    const result = await driver.proxyFrontendMultipartChunk(sessionRow, /** @type {any} */ (body), {
      contentRange,
      contentLength,
      mount,
      db,
      userIdOrInfo,
      userType,
    });

    return jsonOk(
      c,
      {
        success: true,
        done: result?.done === true,
        status: result?.status ?? 200,
      },
      "分片上传成功",
    );
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

    return jsonOk(
      c,
      {
        presignedUrl: result.uploadUrl,
        fileId,
        storagePath: result.storagePath,
        publicUrl: result.publicUrl || null,
        mountId: mount.id,
        storageConfigId: mount.storage_config_id,
        storageType: mount.storage_type || null,
        targetPath,
        contentType: result.contentType,
        headers: result.headers || undefined,
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

    return jsonOk(c, { ...result, publicUrl: result.publicUrl || null, fileName, targetPath, fileSize }, "文件上传完成");
  });
};
