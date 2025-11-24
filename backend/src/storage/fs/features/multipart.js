import { DriverError } from "../../../http/errors.js";
import { ApiStatus } from "../../../constants/index.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";

export async function initializeFrontendMultipartUpload(fs, path, fileName, fileSize, userIdOrInfo, userType, partSize, partCount) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.MULTIPART)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持分片上传`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  return await driver.initializeFrontendMultipartUpload(subPath, {
    fileName,
    fileSize,
    partSize,
    partCount,
    mount,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
  });
}

export async function completeFrontendMultipartUpload(fs, path, uploadId, parts, fileName, fileSize, userIdOrInfo, userType) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.MULTIPART)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持分片上传`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  const result = await driver.completeFrontendMultipartUpload(subPath, {
    uploadId,
    parts,
    fileName,
    fileSize,
    mount,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
  });

  fs.emitCacheInvalidation({ mount, paths: [path], reason: "multipart-complete" });
  return result;
}

export async function abortFrontendMultipartUpload(fs, path, uploadId, fileName, userIdOrInfo, userType) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.MULTIPART)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持分片上传`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  const result = await driver.abortFrontendMultipartUpload(subPath, {
    uploadId,
    fileName,
    mount,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
  });

  fs.emitCacheInvalidation({ mount, paths: [path], reason: "multipart-abort" });
  return result;
}

export async function listMultipartUploads(fs, path, userIdOrInfo, userType, options = {}) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path || "/", userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.MULTIPART)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持分片上传`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  return await driver.listMultipartUploads(subPath, {
    mount,
    db: fs.mountManager.db,
    ...options,
  });
}

export async function listMultipartParts(fs, path, uploadId, fileName, userIdOrInfo, userType, options = {}) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.MULTIPART)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持分片上传`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  return await driver.listMultipartParts(subPath, uploadId, {
    mount,
    db: fs.mountManager.db,
    fileName,
    ...options,
  });
}

export async function refreshMultipartUrls(fs, path, uploadId, partNumbers, userIdOrInfo, userType, options = {}) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.MULTIPART)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持分片上传`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  return await driver.refreshMultipartUrls(subPath, uploadId, partNumbers, {
    mount,
    db: fs.mountManager.db,
    ...options,
  });
}


