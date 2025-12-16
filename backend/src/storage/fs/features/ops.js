import { ApiStatus } from "../../../constants/index.js";
import { AppError, DriverError } from "../../../http/errors.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { findMountPointByPath } from "../utils/MountResolver.js";
import { isDirectoryPath, isSelfOrSubPath, normalizePath } from "../utils/PathResolver.js";

export async function renameItem(fs, oldPath, newPath, userIdOrInfo, userType) {
  // 分别解析旧路径和新路径，确保仍在同一挂载下
  const oldCtx = await fs.mountManager.getDriverByPath(oldPath, userIdOrInfo, userType);
  const newCtx = await fs.mountManager.getDriverByPath(newPath, userIdOrInfo, userType);

  const { driver, mount, subPath: oldSubPath } = oldCtx;
  const { mount: newMount, subPath: newSubPath } = newCtx;

  // 重命名只支持同一挂载/同一驱动内的路径
  if (mount.id !== newMount.id || driver.getType() !== newCtx.driver.getType()) {
    throw new DriverError("重命名仅支持同一存储挂载内的路径", {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.CROSS_MOUNT_RENAME_NOT_SUPPORTED",
      expose: true,
    });
  }

  if (!driver.hasCapability(CAPABILITIES.ATOMIC)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持原子操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  const result = await driver.renameItem(oldPath, newPath, {
    mount,
    subPath: oldSubPath,
    oldSubPath,
    newSubPath,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
  });

  fs.emitCacheInvalidation({ mount, paths: [oldPath, newPath], reason: "rename" });
  return result;
}

export async function copyItem(fs, sourcePath, targetPath, userIdOrInfo, userType, options = {}) {
  // 先解析源与目标挂载与驱动，在 FS 层统一做跨存储决策
  const sourceCtx = await fs.mountManager.getDriverByPath(sourcePath, userIdOrInfo, userType);
  const targetCtx = await fs.mountManager.getDriverByPath(targetPath, userIdOrInfo, userType);

  const { driver: sourceDriver, mount: sourceMount, subPath: sourceSubPath } = sourceCtx;
  const { driver: targetDriver, mount: targetMount, subPath: targetSubPath } = targetCtx;

  // 目录判断：用于决定是否走目录级 orchestrator
  const sourceIsDirectory = isDirectoryPath(sourcePath);

  const sameMount = sourceMount.id === targetMount.id;

  // 统一目录自复制防护：同一挂载内，禁止将目录复制到自身或其子目录
  if (sameMount && sourceIsDirectory) {
    const src = sourceSubPath ?? sourcePath;
    const dst = targetSubPath ?? targetPath;
    if (isSelfOrSubPath(src, dst)) {
      return {
        status: "failed",
        source: sourcePath,
        target: targetPath,
        message: "无法将目录复制到自身或其子目录中",
      };
    }
  }

  // ========== 统一 skipExisting 检查（单文件级别） ==========
  // 对于单文件复制，在入口层统一检查目标是否存在，避免下游重复检查
  // 对于目录复制，每个子文件需要单独检查，交由下游 orchestrator 处理
  const { skipExisting = false } = options;
  if (skipExisting && !sourceIsDirectory) {
    try {
      const targetExists = await targetDriver.exists(targetSubPath, {
        mount: targetMount,
        subPath: targetSubPath,
        db: fs.mountManager.db,
        userIdOrInfo,
        userType,
      });
      if (targetExists) {
        return {
          status: "skipped",
          skipped: true,
          reason: "target_exists",
          source: sourcePath,
          target: targetPath,
          contentLength: 0,
        };
      }
    } catch (checkError) {
      // exists 检查失败时继续复制（降级处理）
      console.warn(`[copyItem] skipExisting 检查失败 for ${targetPath}:`, checkError?.message || checkError);
    }
    // 标记已检查，下游无需重复检查
    options = { ...options, _skipExistingChecked: true };
  }

  // 1）同挂载：保持现有语义，完全交给单一驱动处理（可以是 S3 或 WebDAV 等）
  if (sameMount) {
    if (!sourceDriver.hasCapability(CAPABILITIES.ATOMIC)) {
      throw new DriverError(`存储驱动 ${sourceDriver.getType()} 不支持原子操作`, {
        status: ApiStatus.NOT_IMPLEMENTED,
        code: "DRIVER_ERROR.NOT_IMPLEMENTED",
        expose: true,
      });
    }

    const result = await sourceDriver.copyItem(sourcePath, targetPath, {
      mount: sourceMount,
      // 保持旧字段，同时补充明确的源/目标子路径，方便驱动精确映射存储路径
      subPath: sourceSubPath,
      sourceSubPath,
      targetSubPath,
      db: fs.mountManager.db,
      userIdOrInfo,
      userType,
      findMountPointByPath,
      encryptionSecret: fs.mountManager.encryptionSecret,
      ...options,
    });

    // copy 不会改变 sourcePath 所在目录的列表内容；仅失效目标侧目录即可
    fs.emitCacheInvalidation({ mount: sourceMount, paths: [targetPath], reason: "copy" });
    return result;
  }

  // 2）跨挂载：走通用 orchestrator，支持文件和目录
  if (sourceIsDirectory) {
    // 目录：使用目录级 orchestrator，递归复制目录下所有文件
    return await copyDirectoryBetweenDrivers(
      fs,
      sourceCtx,
      targetCtx,
      sourcePath,
      targetPath,
      userIdOrInfo,
      userType,
      options,
    );
  }

  // 文件：使用单文件 orchestrator
  return await copyBetweenDrivers(fs, sourceCtx, targetCtx, sourcePath, targetPath, userIdOrInfo, userType, options);
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

/**
 * 创建字节计数 TransformStream（用于跨存储复制进度监控）
 *
 * @param {function} onProgress - 进度回调 (bytesTransferred: number) => void
 * @returns {TransformStream} 透传流，同时统计字节数
 */
function createProgressStream(onProgress) {
  let bytesTransferred = 0;

  return new TransformStream({
    transform(chunk, controller) {
      bytesTransferred += chunk.byteLength || chunk.length || 0;
      controller.enqueue(chunk);

      // 调用进度回调
      if (typeof onProgress === "function") {
        onProgress(bytesTransferred);
      }
    },
  });
}

/**
 * 通用跨存储复制 orchestrator（单文件粒度）
 * - 仅依赖 READER/WRITER 能力与 downloadFile/uploadFile 方法
 * - 后端流式复制: downloadFile → uploadFile
 * - 支持字节级进度监控 (options.onProgress 回调)
 *
 * @param {object} options.onProgress - 可选进度回调 (bytesTransferred: number) => void
 */
async function copyBetweenDrivers(fs, sourceCtx, targetCtx, sourcePath, targetPath, userIdOrInfo, userType, options = {}) {
  const { driver: sourceDriver, mount: sourceMount, subPath: sourceSubPath } = sourceCtx;
  const { driver: targetDriver, mount: targetMount, subPath: targetSubPath } = targetCtx;
  const { skipExisting = true, _skipExistingChecked = false } = options;

  if (!sourceDriver.hasCapability(CAPABILITIES.READER)) {
    throw new DriverError(`存储驱动 ${sourceDriver.getType()} 不支持读取操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  if (!targetDriver.hasCapability(CAPABILITIES.WRITER)) {
    throw new DriverError(`存储驱动 ${targetDriver.getType()} 不支持写入操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  // skipExisting 检查：在下载前检查目标文件是否已存在
  // 如果入口层已检查（_skipExistingChecked=true），跳过重复检查
  if (skipExisting && !_skipExistingChecked) {
    try {
      const targetExists = await targetDriver.exists(targetSubPath, {
        mount: targetMount,
        subPath: targetSubPath,
        db: fs.mountManager.db,
        userIdOrInfo,
        userType,
      });
      if (targetExists) {
        return {
          status: "skipped",
          skipped: true,
          reason: "target_exists",
          source: sourcePath,
          target: targetPath,
          contentLength: 0,
        };
      }
    } catch (checkError) {
      // exists 检查失败时继续复制（降级处理）
      console.warn(`[copyBetweenDrivers] skipExisting 检查失败 for ${targetPath}:`, checkError?.message || checkError);
    }
  }

  // 用于在 finally 中关闭流
  let streamHandle = null;

  try {
    // 1. 从源驱动以流方式下载
    // downloadFile 返回 StorageStreamDescriptor
    const downloadResult = await sourceDriver.downloadFile(sourcePath, {
      mount: sourceMount,
      subPath: sourceSubPath,
      db: fs.mountManager.db,
      userIdOrInfo,
      userType,
      request: null,
    });

    // 所有驱动现在都返回 StorageStreamDescriptor
    if (typeof downloadResult?.getStream !== "function") {
      throw new DriverError("源存储驱动返回了无效的 StorageStreamDescriptor 结构", {
        status: ApiStatus.INTERNAL_ERROR,
        code: "DRIVER_ERROR.INVALID_STREAM_DESCRIPTOR",
        expose: false,
      });
    }

    streamHandle = await downloadResult.getStream();
    const body = streamHandle.stream;
    const contentType = downloadResult.contentType;
    const contentLength = downloadResult.size;

    if (!body) {
      throw new DriverError("源存储驱动未返回可用的数据流", {
        status: ApiStatus.INTERNAL_ERROR,
        code: "DRIVER_ERROR.CROSS_STORAGE_NO_BODY",
        expose: false,
      });
    }

    // 推导文件名：
    // - FS 视图约定：以 "/" 结尾的是目录，其余视为文件路径
    // - 若 targetPath 为目录路径，则自动复用源文件名；否则使用 targetPath 最后一段作为目标文件名
    const targetSegments = targetPath.split("/").filter(Boolean);
    const sourceSegments = sourcePath.split("/").filter(Boolean);
    const sourceFileName =
      sourceSegments[sourceSegments.length - 1] || "file";
    const targetLeaf = targetSegments[targetSegments.length - 1] || "";
    const targetIsDirectory = isDirectoryPath(targetPath);

    const filename = targetIsDirectory ? sourceFileName : (targetLeaf || sourceFileName);

    // 2. 如果提供了进度回调，包装流以监控字节传输
    let streamToUpload = body;
    if (typeof options.onProgress === "function" && body && typeof body.pipeThrough === "function") {
      const progressStream = createProgressStream(options.onProgress);
      streamToUpload = body.pipeThrough(progressStream);
    }

    // 3. 将流写入目标驱动
    const uploadResult = await targetDriver.uploadFile(targetPath, streamToUpload, {
      mount: targetMount,
      subPath: targetSubPath,
      db: fs.mountManager.db,
      userIdOrInfo,
      userType,
      filename,
      contentType: options.contentType || contentType || undefined,
      contentLength: options.contentLength || contentLength || undefined,
    });

    // 4. 只对目标挂载做缓存失效即可（源挂载未发生写操作）
    fs.emitCacheInvalidation({ mount: targetMount, paths: [targetPath], reason: "cross-storage-copy" });

    return {
      status: "success",
      source: sourcePath,
      target: targetPath,
      uploadResult,
      // 新增: 返回文件大小信息供任务统计使用
      contentLength: contentLength || 0,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new DriverError("跨存储复制失败", {
      status: ApiStatus.INTERNAL_ERROR,
      code: "DRIVER_ERROR.CROSS_STORAGE_FAILED",
      expose: false,
      details: {
        cause: error?.message,
        sourcePath,
        targetPath,
        sourceDriverType: sourceDriver.getType?.() ?? sourceDriver.type,
        targetDriverType: targetDriver.getType?.() ?? targetDriver.type,
      },
    });
  } finally {
    // 确保关闭流句柄
    if (streamHandle && typeof streamHandle.close === "function") {
      try {
        await streamHandle.close();
      } catch (closeError) {
        console.warn(`[copyBetweenDrivers] 关闭流句柄失败:`, closeError?.message || closeError);
      }
    }
  }
}

/**
 * 通用跨存储目录复制 orchestrator
 * - 基于 FileSystem.listDirectory 递归列出源目录下的所有文件
 * - 通过 copyBetweenDrivers 按文件级别执行复制
 */
async function copyDirectoryBetweenDrivers(fs, sourceCtx, targetCtx, sourcePath, targetPath, userIdOrInfo, userType, options = {}) {
  const sourceBase = normalizePath(sourcePath, true);
  const targetBase = normalizePath(targetPath, true);

  let successCount = 0;
  let skippedCount = 0;
  const failedDetails = [];

  // 确保目标根目录存在（忽略“已存在”等非致命错误）
  try {
    await fs.createDirectory(targetBase, userIdOrInfo, userType);
  } catch (e) {
    // 目录已存在或不支持创建目录时忽略，由后续文件写入自行处理
    console.warn(`跨存储目录复制：创建目标根目录失败 ${targetBase}，错误: ${e?.message || e}`);
  }

  // 使用栈进行深度优先遍历目录
  const stack = [sourceBase];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    try {
      const dirResult = await fs.listDirectory(currentDir, userIdOrInfo, userType, { refresh: true });
      const items = Array.isArray(dirResult.items) ? dirResult.items : [];

      for (const item of items) {
        if (!item || !item.path) {
          continue;
        }

        if (item.isDirectory) {
          // 目录：继续递归
          const dirPath = normalizePath(item.path, true);
          if (!dirPath.startsWith(sourceBase)) {
            continue;
          }

          // 计算对应的目标目录路径，并尝试创建
          const relativeDirPath = dirPath.slice(sourceBase.length);
          const dirTargetPath = `${targetBase}${relativeDirPath}`;
          try {
            await fs.createDirectory(dirTargetPath, userIdOrInfo, userType);
          } catch (e) {
            // 创建失败时记录错误并跳过该子目录
            failedDetails.push({
              source: dirPath,
              target: dirTargetPath,
              status: "failed",
              error: e?.message || "创建目标目录失败",
            });
            continue;
          }

          stack.push(dirPath);
        } else {
          // 文件：计算相对路径并复制
          const fileSourcePath = item.path;
          if (!fileSourcePath.startsWith(sourceBase)) {
            // 理论上不应出现，作为安全防护
            continue;
          }
          const relativePath = fileSourcePath.slice(sourceBase.length);
          const fileTargetPath = `${targetBase}${relativePath}`;

          try {
            // 对每一个文件重新解析挂载与子路径，避免沿用目录级上下文导致子路径错误
            const fileSourceCtx = await fs.mountManager.getDriverByPath(fileSourcePath, userIdOrInfo, userType);
            const fileTargetCtx = await fs.mountManager.getDriverByPath(fileTargetPath, userIdOrInfo, userType);

            const fileResult = await copyBetweenDrivers(
              fs,
              fileSourceCtx,
              fileTargetCtx,
              fileSourcePath,
              fileTargetPath,
              userIdOrInfo,
              userType,
              options
            );

            // 处理复制结果：成功、跳过、失败
            if (fileResult?.status === "skipped" || fileResult?.skipped === true) {
              // 文件已存在，被跳过
              skippedCount++;
            } else if (fileResult?.status === "success" || fileResult?.success === true) {
              // 复制成功
              successCount++;
            } else {
              // 复制失败
              failedDetails.push({
                source: fileSourcePath,
                target: fileTargetPath,
                status: fileResult?.status || "failed",
                error: fileResult?.error || fileResult?.message || "复制失败",
              });
            }
          } catch (err) {
            failedDetails.push({
              source: fileSourcePath,
              target: fileTargetPath,
              status: "failed",
              error: err?.message || "复制失败",
            });
          }
        }
      }
    } catch (err) {
      failedDetails.push({
        source: currentDir,
        target: targetBase,
        status: "failed",
        error: err?.message || "列出目录失败",
      });
    }
  }

  const failedCount = failedDetails.length;
  const totalProcessed = successCount + skippedCount + failedCount;

  // 状态判定：
  // - 全部成功（含跳过）：success
  // - 部分成功：partial
  // - 全部失败：failed
  let status = "success";
  if (failedCount > 0) {
    status = successCount > 0 || skippedCount > 0 ? "partial" : "failed";
  }

  return {
    status,
    stats: {
      success: successCount,
      skipped: skippedCount,
      failed: failedCount,
    },
    details: failedDetails,
    source: sourcePath,
    target: targetPath,
  };
}
