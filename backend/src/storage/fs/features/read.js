import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../../constants/index.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";

export async function listDirectory(fs, path, userIdOrInfo, userType, options = {}) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.READER)) {
    throw new HTTPException(ApiStatus.NOT_IMPLEMENTED, { message: `存储驱动 ${driver.getType()} 不支持读取操作` });
  }

  return await driver.listDirectory(path, {
    mount,
    subPath,
    db: fs.mountManager.db,
    ...options,
  });
}

export async function getFileInfo(fs, path, userIdOrInfo, userType, request = null) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.READER)) {
    throw new HTTPException(ApiStatus.NOT_IMPLEMENTED, { message: `存储驱动 ${driver.getType()} 不支持读取操作` });
  }

  return await driver.getFileInfo(path, {
    mount,
    subPath,
    db: fs.mountManager.db,
    userType,
    userId: userIdOrInfo,
    request,
  });
}

export async function downloadFile(fs, path, fileName, request, userIdOrInfo, userType) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.READER)) {
    throw new HTTPException(ApiStatus.NOT_IMPLEMENTED, { message: `存储驱动 ${driver.getType()} 不支持读取操作` });
  }

  return await driver.downloadFile(path, {
    mount,
    subPath,
    db: fs.mountManager.db,
    request,
    userIdOrInfo,
    userType,
  });
}

export async function exists(fs, path, userIdOrInfo, userType) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);
  return await driver.exists(path, {
    mount,
    subPath,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
  });
}

