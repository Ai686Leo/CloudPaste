import { DriverError } from "../../../http/errors.js";
import { ApiStatus } from "../../../constants/index.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { generateFileLink as featureGenerateFileLink } from "./presign.js";
import { normalizePath } from "../utils/PathResolver.js";

export async function listDirectory(fs, path, userIdOrInfo, userType, options = {}) {
  // 目录列表接口的路径语义：目录路径必须以 / 结尾（root 除外）。
  const dirPath = normalizePath(path, true);
  if (typeof path === "string" && path !== dirPath) {
    console.warn("[fs.listDirectory] 输入路径未按目录格式(缺少尾部/)，已自动规范化:", { path, dirPath });
  }

  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(dirPath, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.READER)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持读取操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  return await driver.listDirectory(dirPath, {
    mount,
    subPath,
    db: fs.mountManager.db,
    ...options,
  });
}

export async function getFileInfo(fs, path, userIdOrInfo, userType, request = null) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.READER)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持读取操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  // 先获取基础文件信息（不关心其中是否包含任何 legacy 链接字段）
  const baseInfo = await driver.getFileInfo(path, {
    mount,
    subPath,
    db: fs.mountManager.db,
    userType,
    userId: userIdOrInfo,
    request,
  });

  return {
    ...baseInfo,
  };
}

export async function downloadFile(fs, path, fileName, request, userIdOrInfo, userType) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.READER)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持读取操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
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
