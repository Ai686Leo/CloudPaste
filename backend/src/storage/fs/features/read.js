import { DriverError } from "../../../http/errors.js";
import { ApiStatus } from "../../../constants/index.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { generateFileLink as featureGenerateFileLink } from "./presign.js";

export async function listDirectory(fs, path, userIdOrInfo, userType, options = {}) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.READER)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持读取操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
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
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持读取操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  // 先获取基础文件信息（不关心其中是否包含 previewUrl/downloadUrl）
  const baseInfo = await driver.getFileInfo(path, {
    mount,
    subPath,
    db: fs.mountManager.db,
    userType,
    userId: userIdOrInfo,
    request,
  });

  // 再通过统一的 Link Resolver 生成预览/下载链接，并覆盖或补充 driver 返回的字段
  let previewUrl = baseInfo?.previewUrl;
  let downloadUrl = baseInfo?.downloadUrl;

  try {
    // 预览链接：不强制下载
    const previewLink = await featureGenerateFileLink(fs, path, userIdOrInfo, userType, {
      request,
      forceDownload: false,
    });
    if (previewLink?.url) {
      previewUrl = previewLink.url;
    }

    // 下载链接：强制下载
    const downloadLink = await featureGenerateFileLink(fs, path, userIdOrInfo, userType, {
      request,
      forceDownload: true,
    });
    if (downloadLink?.url) {
      downloadUrl = downloadLink.url;
    }
  } catch (e) {
    // 链接生成失败时保持基础信息不变，由上层决定如何处理
    console.warn("通过统一 Link Resolver 生成文件链接失败，将使用驱动内置链接（如有）:", e?.message || e);
  }

  return {
    ...baseInfo,
    previewUrl,
    downloadUrl,
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


