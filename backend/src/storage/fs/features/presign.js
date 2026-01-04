import { ApiStatus } from "../../../constants/index.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { generateFileLink as fsGenerateFileLink } from "../utils/FsLinkStrategy.js";
import { DriverError } from "../../../http/errors.js";

/**
 * 严格的预签名上传URL生成功能：
 * - 仅在驱动具备直链能力（DIRECT_LINK，通常包含预签名能力）时可用
 * - 不再回退到代理逻辑
 * - 主要用于 S3 等具备预签名能力的存储
 */
export async function generateUploadUrl(fs, path, userIdOrInfo, userType, options = {}) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.DIRECT_LINK)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持预签名URL`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  const result = await driver.generateUploadUrl(subPath, {
    path,
    mount,
    subPath,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
    ...options,
  });

  // 对于上传场景，直接返回驱动的结果结构（通常包含 uploadUrl / storagePath 等字段）
  return result;
}

/**
 * 通用文件链接生成（下载用）：
 * - 挂载视图下的 Link Resolver 薄包装，实际策略位于 FsLinkStrategy
 */
export async function generateFileLink(fs, path, userIdOrInfo, userType, options = {}) {
  return await fsGenerateFileLink(fs, path, userIdOrInfo, userType, options);
}

export async function commitPresignedUpload(fs, path, filename, userIdOrInfo, userType, options = {}) {
  const { fileSize, etag, contentType } = options;
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.WRITER)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持写入操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  if (typeof driver.handleUploadComplete === "function") {
    const result = await driver.handleUploadComplete(subPath, {
      path,
      mount,
      subPath,
      db: fs.mountManager.db,
      fileName: filename,
      fileSize,
      contentType,
      etag,
      userIdOrInfo,
      userType,
      ...options,
    });

    fs.emitCacheInvalidation({ mount, paths: [path], reason: "upload-complete" });
    return result;
  }

  fs.emitCacheInvalidation({ mount, paths: [path], reason: "upload-complete" });
  return { success: true, message: "上传完成" };
}

