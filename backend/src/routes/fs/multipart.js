import { ValidationError, AuthenticationError } from "../../http/errors.js";
import { ApiStatus } from "../../constants/index.js";
import { generateFileId, jsonOk } from "../../utils/common.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { usePolicy } from "../../security/policies/policies.js";
import { findUploadSessionById, normalizeUploadSessionUserId, updateUploadSessionById } from "../../utils/uploadSessions.js";
import { validateFsItemName } from "../../storage/fs/utils/FsInputValidator.js";
import { StorageQuotaGuard } from "../../storage/usage/StorageQuotaGuard.js";

/**
 * 分片上传（multipart）
 *
 * 1) per_part_url：后端返回每一片的预签名 URL，浏览器直传到上游（S3/HuggingFace 等）
 * 2) single_session：后端返回一个会话 uploadUrl，浏览器把每片 PUT 给 CloudPaste，再由后端转发（GoogleDrive/OneDrive/Telegram 等）
 *
 * - per_part_url：后端看不到每片 PUT 的响应（拿不到 ETag），因此“已上传分片”必须由策略（policy）定义：
 *   - server_can_list：服务端可向上游 ListParts（S3/R2）
 *   - client_keeps：客户端本地保存 parts（HuggingFace）
 * - single_session：每片都经过后端，后端可记录进度（server_records）
 *
 */

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

  const assertUploadSessionOwnedByUser = (sessionRow, userIdOrInfo, userType) => {
    if (!sessionRow) {
      throw new ValidationError("未找到对应的上传会话");
    }

    const expectedUserId = normalizeUploadSessionUserId(userIdOrInfo, userType);
    const rowUserId = String(sessionRow.user_id || "");
    const rowUserType = String(sessionRow.user_type || "");

    // 必须至少匹配 user_id；user_type 为空时视为兼容旧数据（不做强校验）
    const idMatches = rowUserId === String(expectedUserId || "");
    const typeMatches = !rowUserType || rowUserType === String(userType || "");

    if (!idMatches || !typeMatches) {
      throw new AuthenticationError("上传会话不属于当前用户，拒绝访问");
    }
  };

  const assertValidFileName = (fileName) => {
    const result = validateFsItemName(fileName);
    if (result.valid) return;
    throw new ValidationError(result.message);
  };

  const resolveTargetPath = (basePath, fileName) => {
    const p = String(basePath || "");
    const n = String(fileName || "");
    if (!p || !n) return "";
    return p.endsWith("/") ? `${p}${n}` : `${p}/${n}`;
  };

  const tryGetOldBytes = async (fileSystem, targetPath, userIdOrInfo, userType) => {
    try {
      const existing = await fileSystem.getFileInfo(targetPath, userIdOrInfo, userType);
      if (existing && existing.isDirectory !== true && typeof existing.size === "number" && existing.size >= 0) {
        return existing.size;
      }
    } catch {
      // ignore
    }
    return null;
  };

  const assertStorageQuota = async ({
    mountManager,
    fileSystem,
    quota,
    pathForResolve,
    storageConfigId,
    targetPath,
    userIdOrInfo,
    userType,
    incomingBytes,
    withOldBytes = false,
    context,
  }) => {
    const normalizedIncoming = Number(incomingBytes) || 0;
    if (normalizedIncoming <= 0) return;

    let finalStorageConfigId = storageConfigId || null;
    if (!finalStorageConfigId && mountManager && pathForResolve) {
      const { mount } = await mountManager.getDriverByPath(pathForResolve, userIdOrInfo, userType);
      finalStorageConfigId = mount?.storage_config_id || null;
    }
    if (!finalStorageConfigId) return;

    const oldBytes = withOldBytes && targetPath ? await tryGetOldBytes(fileSystem, targetPath, userIdOrInfo, userType) : null;
    await quota.assertCanConsume({
      storageConfigId: finalStorageConfigId,
      incomingBytes: normalizedIncoming,
      oldBytes,
      context: context || "fs",
    });
  };

  // =====================================================================
  // == FS 分片上传（multipart）：初始化 / 完成 / 中止（通用生命周期接口） ==
  // =====================================================================

  router.post("/api/fs/multipart/init", parseJsonBody, usePolicy("fs.upload", { pathResolver: jsonPathResolver() }), async (c) => {
    const { db, encryptionSecret, repositoryFactory, userIdOrInfo, userType } = requireUserContext(c);
    const body = c.get("jsonBody");
    const { path, fileName, fileSize, partSize = 5 * 1024 * 1024, partCount } = body;
    const sha256 = body?.sha256 || body?.oid || null;
    const contentType = body?.contentType || body?.mimetype || null;

    if (!path || !fileName) {
      throw new ValidationError("缺少必要参数");
    }

    assertValidFileName(fileName);

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);
    const quota = new StorageQuotaGuard(db, encryptionSecret, repositoryFactory, { env: c.env });

    await assertStorageQuota({
      mountManager,
      fileSystem,
      quota,
      pathForResolve: path,
      targetPath: resolveTargetPath(path, fileName),
      userIdOrInfo,
      userType,
      incomingBytes: fileSize,
      withOldBytes: true,
      context: "fs-multipart-init",
    });

    const result = await fileSystem.initializeFrontendMultipartUpload(
      path,
      fileName,
      fileSize,
      userIdOrInfo,
      userType,
      partSize,
      partCount,
      { sha256, contentType },
    );

    return jsonOk(c, ensureAbsoluteSessionUploadUrl(c, result), "前端分片上传初始化成功");
  });

  router.post("/api/fs/multipart/complete", parseJsonBody, usePolicy("fs.upload", { pathResolver: jsonPathResolver() }), async (c) => {
    const { db, encryptionSecret, repositoryFactory, userIdOrInfo, userType } = requireUserContext(c);
    const body = c.get("jsonBody");
    const { path, uploadId, parts, fileName, fileSize } = body;

    if (!path || !uploadId) {
      throw new ValidationError("缺少必要参数");
    }
    if (parts != null && !Array.isArray(parts)) {
      throw new ValidationError("parts 参数无效");
    }

    if (fileName) {
      assertValidFileName(fileName);
    }

    const sessionRow = await findUploadSessionById(db, { id: uploadId });
    assertUploadSessionOwnedByUser(sessionRow, userIdOrInfo, userType);

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);
    const quota = new StorageQuotaGuard(db, encryptionSecret, repositoryFactory, { env: c.env });

    // 兜底：complete 阶段再做一次自定义容量检查（防止绕过 init/或 init 时 size=0）
    const finalFileSize = Math.max(Number(sessionRow?.file_size) || 0, Number(fileSize) || 0);
    await assertStorageQuota({
      mountManager,
      fileSystem,
      quota,
      storageConfigId: sessionRow?.storage_config_id || null,
      pathForResolve: path,
      targetPath: fileName ? resolveTargetPath(path, fileName) : "",
      userIdOrInfo,
      userType,
      incomingBytes: finalFileSize,
      withOldBytes: !!fileName,
      context: "fs-multipart-complete",
    });
    const safeParts = Array.isArray(parts) ? parts : [];
    const result = await fileSystem.completeFrontendMultipartUpload(path, uploadId, safeParts, fileName, fileSize, userIdOrInfo, userType);

    return jsonOk(c, { ...result, publicUrl: result.publicUrl || null }, "前端分片上传完成");
  });

  router.post("/api/fs/multipart/abort", parseJsonBody, usePolicy("fs.upload", { pathResolver: jsonPathResolver() }), async (c) => {
    const { db, encryptionSecret, repositoryFactory, userIdOrInfo, userType } = requireUserContext(c);
    const body = c.get("jsonBody");
    const { path, uploadId, fileName } = body;

    if (!path || !uploadId || !fileName) {
      throw new ValidationError("缺少必要参数");
    }

    assertValidFileName(fileName);

    const sessionRow = await findUploadSessionById(db, { id: uploadId });
    assertUploadSessionOwnedByUser(sessionRow, userIdOrInfo, userType);

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);
    await fileSystem.abortFrontendMultipartUpload(path, uploadId, fileName, userIdOrInfo, userType);

    return jsonOk(c, undefined, "已中止分片上传");
  });

  // =====================================================================
  // == FS 分片上传（multipart）：断点续传 / 进度查询 / 刷新 URL（通用） ==
  // =====================================================================

  router.post("/api/fs/multipart/list-uploads", parseJsonBody, usePolicy("fs.upload", { pathCheck: true, pathResolver: jsonPathResolver("path", { optional: true }) }), async (c) => {
    const { db, encryptionSecret, repositoryFactory, userIdOrInfo, userType } = requireUserContext(c);
    const body = c.get("jsonBody");
    const { path = "" } = body;

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
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

    assertValidFileName(fileName);

    const sessionRow = await findUploadSessionById(db, { id: uploadId });
    assertUploadSessionOwnedByUser(sessionRow, userIdOrInfo, userType);

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.listMultipartParts(path, uploadId, fileName, userIdOrInfo, userType);

    return jsonOk(c, result, "列出已上传的分片成功");
  });

  //签名/刷新分片 URL
  router.post("/api/fs/multipart/sign-parts", parseJsonBody, usePolicy("fs.upload", { pathResolver: jsonPathResolver() }), async (c) => {
    const { db, encryptionSecret, repositoryFactory, userIdOrInfo, userType } = requireUserContext(c);
    const body = c.get("jsonBody");
    const { path, uploadId, partNumbers } = body;

    if (!path || !uploadId) {
      throw new ValidationError("缺少必要参数");
    }

    const safePartNumbers = Array.isArray(partNumbers) ? partNumbers : [];

    const sessionRow = await findUploadSessionById(db, { id: uploadId });
    assertUploadSessionOwnedByUser(sessionRow, userIdOrInfo, userType);

    // 状态机推进：请求分片 URL 视为“开始上传”
    try {
      await updateUploadSessionById(db, {
        id: String(uploadId),
        status: "uploading",
        expectedStatus: "initiated",
      });
    } catch (e) {
      console.warn("[multipart] sign-parts 更新 upload_sessions.status=uploading 失败（可忽略）:", e?.message || e);
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.signMultipartParts(path, uploadId, safePartNumbers, userIdOrInfo, userType);

    return jsonOk(c, ensureAbsoluteSessionUploadUrl(c, result), "签名分片上传参数成功");
  });

  // =====================================================================
  // == FS 分片上传（multipart）：后端中转端点（single_session 专用）     ==
  // =====================================================================

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
    assertUploadSessionOwnedByUser(sessionRow, userIdOrInfo, userType);

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);
    const quota = new StorageQuotaGuard(db, encryptionSecret, repositoryFactory, { env: c.env });

    // 自定义容量限制
    // - init 阶段通常已校验，但为了避免“绕过 init / init 时 file_size=0”的边界，这里做一次兜底。
    // - 只在 initiated 状态时校验一次，避免每片都重复计算/查询。
    if (String(sessionRow?.status || "") === "initiated") {
      await assertStorageQuota({
        mountManager,
        fileSystem,
        quota,
        storageConfigId: sessionRow?.storage_config_id || null,
        pathForResolve: sessionRow?.fs_path || "",
        targetPath: resolveTargetPath(sessionRow?.fs_path || "", sessionRow?.file_name || ""),
        userIdOrInfo,
        userType,
        incomingBytes: sessionRow?.file_size || 0,
        withOldBytes: true,
        context: "fs-multipart-upload-chunk",
      });
    }

    const { driver, mount } = await fileSystem.mountManager.getDriverByPath(
      sessionRow.fs_path,
      userIdOrInfo,
      userType,
    );

    if (String(driver.getType()) !== String(sessionRow.storage_type)) {
      throw new ValidationError("上传会话对应的驱动类型与会话记录不一致");
    }

    if (typeof driver.proxyFrontendMultipartChunk !== "function") {
      throw new ValidationError("当前上传会话的存储类型不支持通过该端点上传分片");
    }

    // 委托给 driver 自己实现“分片中转”
    // - GoogleDrive：后端转发到 Google Drive resumable session
    // - Telegram：后端上传该分片到 Telegram，并写入 upload_parts
    // @ts-ignore
    const result = await driver.proxyFrontendMultipartChunk(sessionRow, /** @type {any} */ (body), {
      contentRange,
      contentLength,
      mount,
      db,
      userIdOrInfo,
      userType,
    });

    // 状态机推进：single_session 只要开始收到分片请求，就视为 uploading
    try {
      await updateUploadSessionById(db, {
        id: String(uploadId),
        status: "uploading",
        expectedStatus: "initiated",
      });
    } catch (e) {
      console.warn("[multipart] upload-chunk 更新 upload_sessions.status=uploading 失败（可忽略）:", e?.message || e);
    }

    return jsonOk(
      c,
      {
        success: true,
        done: result?.done === true,
        status: result?.status ?? 200,
        skipped: result?.skipped === true,
      },
      "分片上传成功",
    );
  });

  // =====================================================================
  // == FS 预签名直传（单文件）：/presign + /presign/commit（非分片）     ==
  // =====================================================================

  router.post("/api/fs/presign", parseJsonBody, usePolicy("fs.upload", { pathResolver: presignTargetResolver }), async (c) => {
    const { db, encryptionSecret, repositoryFactory, userIdOrInfo, userType } = requireUserContext(c);
    const body = c.get("jsonBody");
    const { path, fileName, contentType = "application/octet-stream", fileSize = 0, sha256 = null } = body;

    if (!path || !fileName) {
      throw new ValidationError("请提供上传路径和文件名");
    }

    assertValidFileName(fileName);

    const targetPath = presignTargetResolver(c);

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const { mount } = await mountManager.getDriverByPath(path, userIdOrInfo, userType);

    if (!mount || !mount.storage_config_id) {
      throw new ValidationError("当前路径不支持预签名URL上传");
    }

    const fileSystem = new FileSystem(mountManager);
    const quota = new StorageQuotaGuard(db, encryptionSecret, repositoryFactory, { env: c.env });

    // 自定义容量限制：在发放预签名 URL 前拦截
    await assertStorageQuota({
      mountManager,
      fileSystem,
      quota,
      storageConfigId: mount.storage_config_id,
      pathForResolve: path,
      targetPath,
      userIdOrInfo,
      userType,
      incomingBytes: fileSize,
      withOldBytes: true,
      context: "fs-presign",
    });

    const result = await fileSystem.generateUploadUrl(targetPath, userIdOrInfo, userType, {
      operation: "upload",
      fileName,
      fileSize,
      contentType,
      sha256,
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
        sha256: result.sha256 || sha256 || null,
        repoRelPath: result.repoRelPath || result.storagePath || null,
        // 透传：如果上游判定对象已存在（去重），可以跳过 PUT，直接 commit 登记
        skipUpload: result.skipUpload === true,
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
    const sha256 = body.sha256 || body.oid || null;

    if (!targetPath || !mountId) {
      throw new ValidationError("请提供完整的上传信息");
    }

    const fileName = targetPath.split("/").filter(Boolean).pop();
    if (!fileName) {
      throw new ValidationError("无效的目标路径：缺少文件名");
    }
    assertValidFileName(fileName);

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);
    const quota = new StorageQuotaGuard(db, encryptionSecret, repositoryFactory, { env: c.env });

    // 自定义容量限制：commit 阶段兜底校验
    await assertStorageQuota({
      mountManager,
      fileSystem,
      quota,
      pathForResolve: targetPath,
      targetPath,
      userIdOrInfo,
      userType,
      incomingBytes: fileSize,
      withOldBytes: true,
      context: "fs-presign-commit",
    });

    // 使用 FileSystem 对齐目录标记与缓存逻辑
    const result = await fileSystem.commitPresignedUpload(targetPath, fileName, userIdOrInfo, userType, {
      fileSize,
      etag,
      contentType,
      sha256,
    });

    return jsonOk(c, { ...result, publicUrl: result.publicUrl || null, fileName, targetPath, fileSize }, "文件上传完成");
  });
};
