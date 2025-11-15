import { DriverError } from "../../../http/errors.js";
import { ApiStatus } from "../../../constants/index.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";

export async function generatePresignedUrl(fs, path, userIdOrInfo, userType, options = {}) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.PRESIGNED)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持预签名URL`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  return await driver.generatePresignedUrl(path, {
    mount,
    subPath,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
    ...options,
  });
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
    const result = await driver.handleUploadComplete(path, {
      mount,
      subPath,
      db: fs.mountManager.db,
      fileName: filename,
      fileSize,
      contentType,
      etag,
    });

    fs.emitCacheInvalidation({ mount, paths: [path], reason: "upload-complete" });
    return result;
  }

  fs.emitCacheInvalidation({ mount, paths: [path], reason: "upload-complete" });
  return { success: true, message: "上传完成" };
}


