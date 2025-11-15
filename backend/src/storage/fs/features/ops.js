import { ApiStatus } from "../../../constants/index.js";
import { AppError, DriverError } from "../../../http/errors.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { findMountPointByPath } from "../utils/MountResolver.js";

export async function renameItem(fs, oldPath, newPath, userIdOrInfo, userType) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(oldPath, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.ATOMIC)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持原子操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  const result = await driver.renameItem(oldPath, newPath, {
    mount,
    subPath,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
  });

  fs.emitCacheInvalidation({ mount, paths: [oldPath, newPath], reason: "rename" });
  return result;
}

export async function copyItem(fs, sourcePath, targetPath, userIdOrInfo, userType, options = {}) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(sourcePath, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.ATOMIC)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持原子操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  const result = await driver.copyItem(sourcePath, targetPath, {
    mount,
    subPath,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
    findMountPointByPath,
    encryptionSecret: fs.mountManager.encryptionSecret,
    ...options,
  });

  fs.emitCacheInvalidation({ mount, paths: [sourcePath, targetPath], reason: "copy" });
  return result;
}

export async function batchRemoveItems(fs, paths, userIdOrInfo, userType) {
  if (!paths || paths.length === 0) {
    return { success: 0, failed: [] };
  }

  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(paths[0], userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.WRITER)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持写入操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  const result = await driver.batchRemoveItems(paths, {
    mount,
    subPath,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
    findMountPointByPath,
  });

  fs.emitCacheInvalidation({ mount, paths, reason: "batch-remove" });
  return result;
}

export async function batchCopyItems(fs, items, userIdOrInfo, userType) {
  const result = {
    success: 0,
    skipped: 0,
    failed: [],
    details: [],
    crossStorageResults: [],
  };

  if (!items || items.length === 0) {
    return result;
  }

  for (const item of items) {
    try {
      if (!item.sourcePath || !item.targetPath) {
        const errorMessage = "源路径或目标路径不能为空";
        console.error(errorMessage, item);
        result.failed.push({
          sourcePath: item.sourcePath || "未指定",
          targetPath: item.targetPath || "未指定",
          error: errorMessage,
        });
        continue;
      }

      let { sourcePath, targetPath } = item;
      const sourceIsDirectory = sourcePath.endsWith("/");
      if (sourceIsDirectory && !targetPath.endsWith("/")) {
        targetPath = targetPath + "/";
        console.log(`自动修正目录路径格式: ${item.sourcePath} -> ${targetPath}`);
      }

      const skipExisting = item.skipExisting !== undefined ? item.skipExisting : true;
      const copyResult = await fs.copyItem(sourcePath, targetPath, userIdOrInfo, userType, { skipExisting });

      if (copyResult.crossStorage) {
        result.crossStorageResults.push(copyResult);
        continue;
      }

      const isSuccess = copyResult.status === "success" || copyResult.success === true;
      const isSkipped = copyResult.skipped === true || copyResult.status === "skipped";

      if (isSuccess || isSkipped) {
        if (isSkipped) {
          result.skipped++;
          console.log(`文件已存在，跳过复制: ${item.sourcePath} -> ${item.targetPath}`);
        } else {
          result.success++;
          console.log(`文件复制成功: ${item.sourcePath} -> ${item.targetPath}`);
        }

        if (copyResult.stats) {
          result.success += copyResult.stats.success || 0;
          result.skipped += copyResult.stats.skipped || 0;

          if (copyResult.stats.failed > 0 && copyResult.details) {
            copyResult.details.forEach((detail) => {
              if (detail.status === "failed") {
                result.failed.push({
                  sourcePath: detail.source,
                  targetPath: detail.target,
                  error: detail.error,
                });
                console.error(`复制子项失败: ${detail.source} -> ${detail.target}, 错误: ${detail.error}`);
              }
            });
          }

          if (copyResult.details) {
            result.details = result.details.concat(copyResult.details);
          }
        } else if (copyResult.details && typeof copyResult.details === "object") {
          const details = copyResult.details;
          if (details.success !== undefined) {
            result.success += details.success;
            console.log(`目录复制统计 - 成功: ${details.success}, 跳过: ${details.skipped}, 失败: ${details.failed}`);
          }
          if (details.skipped !== undefined) {
            result.skipped += details.skipped;
          }
          if (details.failed && details.failed > 0) {
            console.warn(`目录复制中有 ${details.failed} 个文件失败`);
          }
        }
      } else {
        const errorMessage = copyResult.message || copyResult.error || "复制失败";
        console.error(`复制失败: ${item.sourcePath} -> ${item.targetPath}, 错误: ${errorMessage}`);
        result.failed.push({
          sourcePath: item.sourcePath,
          targetPath: item.targetPath,
          error: errorMessage,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof AppError ? error.message : error.message || "未知错误";
      console.error(`复制失败: ${item.sourcePath} -> ${item.targetPath}, 错误: ${errorMessage}`, error);
      result.failed.push({
        sourcePath: item.sourcePath,
        targetPath: item.targetPath,
        error: errorMessage,
      });
    }
  }

  if (result.crossStorageResults.length > 0) {
    result.hasCrossStorageOperations = true;
  }

  return result;
}

export async function handleCrossStorageCopy(fs, sourcePath, targetPath, userIdOrInfo, userType) {
  const { driver } = await fs.mountManager.getDriverByPath(sourcePath, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.ATOMIC)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持原子操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  return await driver.handleCrossStorageCopy(sourcePath, targetPath, {
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
  });
}

export async function commitCrossStorageCopy(fs, mount, files) {
  const results = { success: [], failed: [] };

  if (!Array.isArray(files) || files.length === 0) {
    return results;
  }

  for (const file of files) {
    try {
      const { targetPath, storagePath } = file || {};
      if (!targetPath || !storagePath) {
        results.failed.push({
          targetPath: targetPath || "未指定",
          error: "目标路径和存储路径不能为空",
        });
        continue;
      }
      const fileName = targetPath.split("/").filter(Boolean).pop();
      results.success.push({ targetPath, fileName });
    } catch (err) {
      results.failed.push({ targetPath: file?.targetPath || "未知路径", error: err?.message || "处理文件时出错" });
    }
  }

  fs.emitCacheInvalidation({ mount, reason: "batch-copy-commit", db: fs.mountManager.db });
  return results;
}
