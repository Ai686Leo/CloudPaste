import { DriverError } from "../../../http/errors.js";
import { ApiStatus } from "../../../constants/index.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";

export async function uploadFile(fs, path, fileOrStream, userIdOrInfo, userType, options = {}) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.WRITER)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持写入操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  if (!driver.uploadFile) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持文件上传`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  const result = await driver.uploadFile(path, fileOrStream, {
    mount,
    subPath,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
    ...options,
  });

  fs.emitCacheInvalidation({ mount, paths: [path], reason: "upload-stream" });
  return result;
}

export async function uploadDirect(fs, path, body, userIdOrInfo, userType, options = {}) {
  const { filename, contentType, contentLength } = options;
  return await fs.uploadFile(path, /** @type {any} */ (body), userIdOrInfo, userType, {
    filename,
    contentType,
    contentLength,
  });
}

export async function createDirectory(fs, path, userIdOrInfo, userType) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.WRITER)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持写入操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  const result = await driver.createDirectory(path, {
    mount,
    subPath,
    db: fs.mountManager.db,
  });

  fs.emitCacheInvalidation({ mount, paths: [path], reason: "mkdir" });
  return result;
}

export async function updateFile(fs, path, content, userIdOrInfo, userType) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.WRITER)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持写入操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  const result = await driver.updateFile(path, content, {
    mount,
    subPath,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
  });

  fs.emitCacheInvalidation({ mount, paths: [path], reason: "update-file" });
  return result;
}


