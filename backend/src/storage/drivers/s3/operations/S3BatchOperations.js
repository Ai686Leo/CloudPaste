/**
 * S3批量操作模块
 * 负责批量操作：批量删除、批量复制、批量移动等
 */

import { ApiStatus } from "../../../../constants/index.js";
/**
 * 模块说明：
 * - 作用域：单一 S3 挂载内的批量删除、复制、伪原子重命名，以及目录层级元数据维护。
 * - 输入：仅接受 FS 视图路径，内部统一规范化为 S3 Key；跨挂载/跨存储 orchestrator 由 FS 层处理。
 * - 错误：统一经 S3DriverError / handleFsError 封装，尽量不直接抛出底层 SDK 原始错误。
 */
import { AppError, ValidationError, NotFoundError, ConflictError, AuthenticationError, AuthorizationError, S3DriverError } from "../../../../http/errors.js";
import { S3Client, DeleteObjectCommand, CopyObjectCommand, ListObjectsV2Command, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { applyS3RootPrefix, normalizeS3SubPath } from "../utils/S3PathUtils.js";
import { updateMountLastUsed } from "../../../fs/utils/MountResolver.js";
import { checkDirectoryExists, updateParentDirectoriesModifiedTime } from "../utils/S3DirectoryUtils.js";
import { handleFsError } from "../../../fs/utils/ErrorHandler.js";
import { isDirectoryPath } from "../../../fs/utils/PathResolver.js";

export class S3BatchOperations {
  /**
   * 构造函数
   * @param {S3Client} s3Client - S3客户端
   * @param {Object} config - S3配置
   * @param {string} encryptionSecret - 加密密钥
   * @param {D1Database} db - 数据库实例（用于读取系统设置）
   */
  constructor(s3Client, config, encryptionSecret, db = null) {
    this.s3Client = s3Client;
    this.config = config;
    this.encryptionSecret = encryptionSecret;
    this.db = db;
  }

  _errorFromStatus(status, message) {
    switch (status) {
      case ApiStatus.BAD_REQUEST:
        return new ValidationError(message);
      case ApiStatus.UNAUTHORIZED:
        return new AuthenticationError(message);
      case ApiStatus.FORBIDDEN:
        return new AuthorizationError(message);
      case ApiStatus.NOT_FOUND:
        return new NotFoundError(message);
      case ApiStatus.CONFLICT:
        return new ConflictError(message);
      default:
        return new S3DriverError(message);
    }
  }

  /**
   * 递归删除S3目录
   * @param {S3Client} s3Client - S3客户端实例
   * @param {string} bucketName - 存储桶名称
   * @param {string} prefix - 目录前缀
   * @param {string} storageConfigId - 存储配置ID
   * @returns {Promise<void>}
   */
  async deleteDirectoryRecursive(s3Client, bucketName, prefix, storageConfigId) {
    let continuationToken = undefined;

    try {
      do {
        const listParams = {
          Bucket: bucketName,
          Prefix: prefix,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        };

        const listCommand = new ListObjectsV2Command(listParams);
        const response = await s3Client.send(listCommand);

        if (response.Contents && response.Contents.length > 0) {
          // 批量删除对象
          const deletePromises = response.Contents.map(async (item) => {
            const deleteParams = {
              Bucket: bucketName,
              Key: item.Key,
            };

            const deleteCommand = new DeleteObjectCommand(deleteParams);
            await s3Client.send(deleteCommand);

            // 文件删除完成，无需数据库操作
          });

          await Promise.all(deletePromises);
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      console.log(`成功删除目录: ${prefix}`);
    } catch (error) {
      console.error(`删除目录失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 批量删除文件或目录
   * @param {Array<string>} subPaths - 需要删除的子路径数组（subPath-only）
   * @param {Object} ctx - 上下文（paths/subPaths/mount/db/...）
   * @returns {Promise<Object>} 删除结果
   */
  async batchRemoveItems(subPaths, ctx = {}) {
    const { db, mount } = ctx;

    const result = { success: 0, failed: [] };
    if (!Array.isArray(subPaths) || subPaths.length === 0) {
      return result;
    }

    if (!Array.isArray(ctx?.paths) || ctx.paths.length !== subPaths.length) {
      throw new ValidationError("S3 batchRemoveItems 需要 ctx.paths 与 subPaths 一一对应");
    }

    const fsPaths = ctx.paths;

    for (let i = 0; i < subPaths.length; i += 1) {
      const fsPath = fsPaths[i];
      const itemSubPath = subPaths[i];

      try {
        const isDir = isDirectoryPath(fsPath);
        const s3SubPath = normalizeS3SubPath(itemSubPath, isDir);
        const fullKey = applyS3RootPrefix(this.config, s3SubPath);

        if (isDir) {
          await this.deleteDirectoryRecursive(this.s3Client, this.config.bucket_name, fullKey, mount?.storage_config_id || null);
        } else {
          try {
            const deleteCommand = new DeleteObjectCommand({
              Bucket: this.config.bucket_name,
              Key: fullKey,
            });
            await this.s3Client.send(deleteCommand);
          } catch (error) {
            if (error?.$metadata?.httpStatusCode === 404) {
              result.failed.push({ path: fsPath, error: "文件不存在" });
              continue;
            }
            throw error;
          }
        }

        await updateParentDirectoriesModifiedTime(this.s3Client, this.config.bucket_name, fullKey, this.config.root_prefix, true);
        result.success += 1;
      } catch (error) {
        console.error(`[S3BatchOps] 删除失败: ${fsPath}`, error);
        result.failed.push({ path: fsPath, error: error?.message || "删除失败" });
      }
    }

    if (db && mount?.id) {
      await updateMountLastUsed(db, mount.id);
    }

    return result;
  }

  /**
   * 复制单个文件或目录
   * @param {string} sourceSubPath - 源子路径（subPath-only）
   * @param {string} targetSubPath - 目标子路径（subPath-only）
   * @param {Object} ctx - 上下文（sourcePath/targetPath/mount/db/skipExisting/...）
   * @returns {Promise<Object>} 复制结果
   */
  async copyItem(sourceSubPath, targetSubPath, ctx = {}) {
    const { mount, db } = ctx;
    const sourcePath = ctx?.sourcePath;
    const targetPath = ctx?.targetPath;
    const { skipExisting = false, _skipExistingChecked = false } = ctx;

    return handleFsError(
      async () => {
        if (typeof sourcePath !== "string" || typeof targetPath !== "string") {
          throw new ValidationError("S3 copyItem 需要 ctx.sourcePath/ctx.targetPath（FS 视图路径，不做兼容）");
        }

        const sourceIsDirectory = isDirectoryPath(sourcePath);
        const targetIsDirectory = isDirectoryPath(targetPath);
        if (sourceIsDirectory !== targetIsDirectory) {
          throw new ValidationError("复制操作源/目标路径类型必须一致（文件或目录）");
        }

        const result = await this._handleSameStorageCopy(sourcePath, targetPath, sourceSubPath, targetSubPath, {
          skipExisting,
          _skipExistingChecked,
        });

        if (db && mount?.id) {
          await updateMountLastUsed(db, mount.id);
        }

        return result;
      },
      "复制项目",
      "复制项目失败"
    );
  }

  /**
   * 处理同存储复制
   * @private
   * @param {Object} copyOptions - 复制选项
   * @param {boolean} [copyOptions.skipExisting=false] - 是否跳过已存在的文件
   * @param {boolean} [copyOptions._skipExistingChecked=false] - 入口层是否已检查
   */
  async _handleSameStorageCopy(sourcePath, targetPath, sourceSubPath, targetSubPath, copyOptions = {}) {
    const { skipExisting = false, _skipExistingChecked = false } = copyOptions;

    // subPath-only：同一个 driver 内的复制只使用当前实例的配置（不再从 DB 重新解析挂载点/配置）
    const s3Config = this.config;

    const isDirectory = isDirectoryPath(sourcePath);
    const s3SourcePath = normalizeS3SubPath(sourceSubPath, isDirectory);
    const s3TargetPath = normalizeS3SubPath(targetSubPath, isDirectory);
    const fullS3SourcePath = applyS3RootPrefix(s3Config, s3SourcePath);
    const fullS3TargetPath = applyS3RootPrefix(s3Config, s3TargetPath);

    // 检查源路径是否存在
    try {
      const sourceExists = await this._checkS3ObjectExists(s3Config.bucket_name, fullS3SourcePath);
      if (!sourceExists) {
        // 如果是目录，尝试列出目录内容确认存在性
        if (isDirectory) {
          const listResponse = await this._listS3Directory(s3Config.bucket_name, fullS3SourcePath);

          // 如果没有内容，说明目录不存在或为空
          if (!listResponse.Contents || listResponse.Contents.length === 0) {
            throw new NotFoundError("源路径不存在或为空目录");
          }
        } else {
          throw new NotFoundError("源文件不存在");
        }
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new S3DriverError("检查源路径存在性失败", { details: { cause: error?.message } });
    }

    if (isDirectory) {
      // 目录复制（目录中每个文件需要单独检查，不传递 _skipExistingChecked）
      return await this._copyDirectory(s3Config, fullS3SourcePath, fullS3TargetPath, sourcePath, targetPath, null, { skipExisting });
    } else {
      // 文件复制（传递 _skipExistingChecked 避免重复检查）
      return await this._copyFile(s3Config, fullS3SourcePath, fullS3TargetPath, sourcePath, targetPath, null, { skipExisting, _skipExistingChecked });
    }
  }

  /**
   * 复制单个文件
   * @private
   * @param {Object} copyOptions - 复制选项
   * @param {boolean} [copyOptions.skipExisting=false] - 是否跳过已存在的文件
   * @param {boolean} [copyOptions._skipExistingChecked=false] - 入口层是否已检查
   */
  async _copyFile(s3Config, s3SourcePath, s3TargetPath, sourcePath, targetPath, db = null, copyOptions = {}) {
    const { skipExisting = false, _skipExistingChecked = false } = copyOptions;

    // 根据 skipExisting 参数决定是否检查目标文件存在
    // 如果入口层已检查（_skipExistingChecked=true），跳过重复检查
    if (skipExisting && !_skipExistingChecked && await this._checkItemExists(s3Config.bucket_name, s3TargetPath)) {
      console.log(`[S3BatchOps] 同存储复制目标文件已存在，跳过: ${sourcePath} -> ${targetPath}`);
      return {
        source: sourcePath,
        target: targetPath,
        status: "skipped",
        skipped: true,
        reason: "target_exists",
        message: "文件已存在，跳过复制",
        contentLength: 0,
      };
    }

    // 检查目标父目录是否存在（对于文件复制）
    if (s3TargetPath.includes("/")) {
      // 对于文件，获取其所在目录
      const parentPath = s3TargetPath.substring(0, s3TargetPath.lastIndexOf("/") + 1);

      // 添加验证：确保parentPath不为空
      if (parentPath && parentPath.trim() !== "") {
        const parentExists = await checkDirectoryExists(this.s3Client, s3Config.bucket_name, parentPath);

        if (!parentExists) {
          // 自动创建父目录而不是抛出错误
          console.log(`复制操作: 正在创建目标父目录 "${parentPath}"`);

          try {
            // 创建一个空对象作为目录标记
            const createDirParams = {
              Bucket: s3Config.bucket_name,
              Key: parentPath,
              Body: Buffer.from("", "utf-8"),
              ContentType: "application/x-directory", // 目录内容类型
            };

            const createDirCommand = new PutObjectCommand(createDirParams);
            await this.s3Client.send(createDirCommand);
          } catch (dirError) {
            console.error(`复制操作: 创建目标父目录 "${parentPath}" 失败:`, dirError);
            // 如果创建目录失败，才抛出错误
          throw new ConflictError(`无法创建目标父目录: ${dirError.message}`);
          }
        }
      }
    }

    // 执行复制
    const copyParams = {
      Bucket: s3Config.bucket_name,
      CopySource: encodeURIComponent(s3Config.bucket_name + "/" + s3SourcePath),
      Key: s3TargetPath,
    };

    const copyCommand = new CopyObjectCommand(copyParams);
    await this.s3Client.send(copyCommand);

    // 更新父目录的修改时间
    const rootPrefix = s3Config.root_prefix ? (s3Config.root_prefix.endsWith("/") ? s3Config.root_prefix : s3Config.root_prefix + "/") : "";
    await updateParentDirectoriesModifiedTime(this.s3Client, s3Config.bucket_name, s3TargetPath, rootPrefix);

    return {
      status: "success",
      source: sourcePath,
      target: targetPath,
      message: "文件复制成功",
    };
  }

  /**
   * 递归复制S3目录
   * @param {S3Client} s3Client - S3客户端实例
   * @param {string} bucketName - 存储桶名称
   * @param {string} sourcePrefix - 源目录前缀
   * @param {string} targetPrefix - 目标目录前缀
   * @param {boolean} skipExisting - 是否跳过已存在的文件
   * @returns {Promise<Object>} 复制结果
   */
  async copyDirectoryRecursive(s3Client, bucketName, sourcePrefix, targetPrefix, skipExisting = true) {
    let continuationToken = undefined;
    const result = {
      success: 0,
      skipped: 0,
      failed: 0,
    };

    try {
      do {
        const listParams = {
          Bucket: bucketName,
          Prefix: sourcePrefix,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        };

        const listCommand = new ListObjectsV2Command(listParams);
        const response = await s3Client.send(listCommand);

        if (response.Contents && response.Contents.length > 0) {
          for (const item of response.Contents) {
            try {
              const sourceKey = item.Key;
              const relativePath = sourceKey.substring(sourcePrefix.length);
              const targetKey = targetPrefix + relativePath;

              // 检查目标文件是否已存在
              if (skipExisting) {
                try {
                  const listParams = {
                    Bucket: bucketName,
                    Prefix: targetKey,
                    MaxKeys: 1,
                  };
                  const listCommand = new ListObjectsV2Command(listParams);
                  const listResponse = await s3Client.send(listCommand);

                  // 检查是否找到精确匹配的对象
                  const exactMatch = listResponse.Contents?.find((item) => item.Key === targetKey);
                  if (exactMatch) {
                    // 文件已存在，跳过
                    result.skipped++;
                    console.log(`[S3BatchOps] 文件已存在，跳过复制: ${sourceKey} -> ${targetKey}`);
                    continue;
                  }
                } catch (error) {
                  // ListObjects失败，继续复制
                }
              }

              // 执行复制
              const copyParams = {
                Bucket: bucketName,
                CopySource: encodeURIComponent(bucketName + "/" + sourceKey),
                Key: targetKey,
              };

              const copyCommand = new CopyObjectCommand(copyParams);
              await s3Client.send(copyCommand);

              result.success++;
            } catch (error) {
              console.error(`复制文件失败 ${item.Key}:`, error);
              result.failed++;
            }
          }
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      return result;
    } catch (error) {
      console.error(`复制目录失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 复制目录
   * @private
   */
  async _copyDirectory(s3Config, s3SourcePath, s3TargetPath, sourcePath, targetPath, db = null, copyOptions = {}) {
    void db;
    const { skipExisting = false } = copyOptions;

    // 目录复制：统一用 “以 / 结尾的 prefix” 进行 S3 操作（返回值仍保持 FS 传入的 sourcePath/targetPath）
    const normalizedS3SourcePath = s3SourcePath.endsWith("/") ? s3SourcePath : s3SourcePath + "/";
    const normalizedS3TargetPath = s3TargetPath.endsWith("/") ? s3TargetPath : s3TargetPath + "/";

    // 严格契约：source/target 必须等于输入参数；不做“自动重命名目标目录”的魔法行为
    if (normalizedS3SourcePath === normalizedS3TargetPath) {
      return {
        source: sourcePath,
        target: targetPath,
        status: "skipped",
        skipped: true,
        reason: "same_path",
        message: "源目录与目标目录相同，跳过复制",
        contentLength: 0,
      };
    }

    // skipExisting：如果目标目录（prefix）已存在，则整个目录复制直接跳过
    if (skipExisting) {
      const targetExists = await checkDirectoryExists(this.s3Client, s3Config.bucket_name, normalizedS3TargetPath);
      if (targetExists) {
        return {
          source: sourcePath,
          target: targetPath,
          status: "skipped",
          skipped: true,
          reason: "target_exists",
          message: "目标目录已存在，跳过复制",
          contentLength: 0,
        };
      }
    }

    const details = await this.copyDirectoryRecursive(
      this.s3Client,
      s3Config.bucket_name,
      normalizedS3SourcePath,
      normalizedS3TargetPath,
      false,
    );

    return {
      source: sourcePath,
      target: targetPath,
      status: "success",
      message: "目录复制成功",
      details,
    };
  }


  /**
   * 单个项目重命名（文件或目录）
   * @param {string} oldSubPath - 旧子路径（subPath-only）
   * @param {string} newSubPath - 新子路径（subPath-only）
   * @param {Object} ctx - 上下文（oldPath/newPath/mount/db/...）
   * @returns {Promise<Object>} 重命名结果
   */
  async renameItem(oldSubPath, newSubPath, ctx = {}) {
    const { db, mount } = ctx;
    const oldPath = ctx?.oldPath;
    const newPath = ctx?.newPath;

    return handleFsError(
      async () => {
        if (typeof oldPath !== "string" || typeof newPath !== "string") {
          throw new ValidationError("S3 renameItem 需要 ctx.oldPath/ctx.newPath（FS 视图路径，不做兼容）");
        }

        const oldIsDirectory = isDirectoryPath(oldPath);
        const newIsDirectory = isDirectoryPath(newPath);
        if (oldIsDirectory !== newIsDirectory) {
          throw new ValidationError("源路径和目标路径类型必须一致（文件或目录）");
        }

        const oldS3SubPath = normalizeS3SubPath(oldSubPath, oldIsDirectory);
        const newS3SubPath = normalizeS3SubPath(newSubPath, newIsDirectory);
        const fullOldS3Path = applyS3RootPrefix(this.config, oldS3SubPath);
        const fullNewS3Path = applyS3RootPrefix(this.config, newS3SubPath);

        const bucketName = this.config.bucket_name;

        const sourceExists = oldIsDirectory
          ? await checkDirectoryExists(this.s3Client, bucketName, fullOldS3Path)
          : await this._checkItemExists(bucketName, fullOldS3Path);

        if (!sourceExists) {
          throw new NotFoundError("源文件或目录不存在");
        }

        const targetExists = newIsDirectory
          ? await checkDirectoryExists(this.s3Client, bucketName, fullNewS3Path)
          : await this._checkItemExists(bucketName, fullNewS3Path);

        if (targetExists) {
          throw new ConflictError("目标路径已存在");
        }

        if (oldIsDirectory) {
          await this.copyDirectoryRecursive(this.s3Client, bucketName, fullOldS3Path, fullNewS3Path, false);
          await this.deleteDirectoryRecursive(this.s3Client, bucketName, fullOldS3Path, mount?.storage_config_id || null);
        } else {
          const copyCommand = new CopyObjectCommand({
            Bucket: bucketName,
            CopySource: encodeURIComponent(bucketName + "/" + fullOldS3Path),
            Key: fullNewS3Path,
            MetadataDirective: "COPY",
          });
          await this.s3Client.send(copyCommand);

          const deleteCommand = new DeleteObjectCommand({
            Bucket: bucketName,
            Key: fullOldS3Path,
          });
          await this.s3Client.send(deleteCommand);
        }

        await updateParentDirectoriesModifiedTime(this.s3Client, bucketName, fullOldS3Path, this.config.root_prefix);

        if (db && mount?.id) {
          await updateMountLastUsed(db, mount.id);
        }

        return {
          success: true,
          source: oldPath,
          target: newPath,
          message: oldIsDirectory ? "目录重命名成功" : "文件重命名成功",
        };
      },
      "重命名文件或目录",
      "重命名失败"
    );
  }

  /**
   * 检查S3对象是否存在
   * @private
   * @param {string} bucketName - 存储桶名称
   * @param {string} key - 对象键
   * @returns {Promise<boolean>} 是否存在
   */
  async _checkS3ObjectExists(bucketName, key) {
    try {
      const listParams = {
        Bucket: bucketName,
        Prefix: key,
        MaxKeys: 1,
      };

      const listCommand = new ListObjectsV2Command(listParams);
      const listResponse = await this.s3Client.send(listCommand);

      // 检查是否找到精确匹配的对象
      const exactMatch = listResponse.Contents?.find((item) => item.Key === key);
      return !!exactMatch;
    } catch (error) {
      return false;
    }
  }

  /**
   * 列出S3目录内容
   * @private
   * @param {string} bucketName - 存储桶名称
   * @param {string} prefix - 目录前缀
   * @returns {Promise<Object>} 列表响应
   */
  async _listS3Directory(bucketName, prefix) {
    const listParams = {
      Bucket: bucketName,
      Prefix: prefix,
      MaxKeys: 1, // 只需要检查是否有内容，不需要全部列出
    };

    const listCommand = new ListObjectsV2Command(listParams);
    return await this.s3Client.send(listCommand);
  }

  /**
   * 检查文件是否存在
   * @private
   * @param {string} bucketName - 存储桶名称
   * @param {string} key - 文件路径
   * @returns {Promise<boolean>} 是否存在
   */
  async _checkItemExists(bucketName, key) {
    try {
      const listParams = {
        Bucket: bucketName,
        Prefix: key,
        MaxKeys: 1,
      };

      const listCommand = new ListObjectsV2Command(listParams);
      const listResponse = await this.s3Client.send(listCommand);

      // 检查是否找到精确匹配的对象
      const exactMatch = listResponse.Contents?.find((item) => item.Key === key);
      return !!exactMatch;
    } catch (error) {
      return false;
    }
  }

  /**
   * 解析文件名，提取基础名称、扩展名和目录路径
   * @private
   * @param {string} filePath - 文件路径
   * @returns {Object} 包含 baseName, extension, directory 的对象
   */
  _parseFileName(filePath) {
    // 处理空路径的边界情况
    if (!filePath || filePath.trim() === "") {
      return { baseName: "", extension: "", directory: "" };
    }

    const pathParts = filePath.split("/");
    const fileName = pathParts.pop() || "";
    const directory = pathParts.length > 0 ? pathParts.join("/") + "/" : "";

    // 处理空文件名的边界情况
    if (!fileName) {
      return { baseName: "", extension: "", directory };
    }

    const lastDotIndex = fileName.lastIndexOf(".");
    let baseName, extension;

    // 修复只有扩展名的文件处理（如 ".txt"）
    if (lastDotIndex > 0) {
      // 正常情况：文件名.扩展名
      baseName = fileName.substring(0, lastDotIndex);
      extension = fileName.substring(lastDotIndex);
    } else if (lastDotIndex === 0) {
      // 只有扩展名的情况：.txt
      baseName = "";
      extension = fileName;
    } else {
      // 没有扩展名的情况
      baseName = fileName;
      extension = "";
    }

    // 移除已有的数字后缀 (如果存在) - 支持多层嵌套的数字后缀
    // 例如：folder(1)(1) → folder, document(2)(3) → document
    // 添加循环保护，防止无限循环
    let loopCount = 0;
    const maxLoops = 10; // 最多处理10层嵌套

    while (loopCount < maxLoops && baseName) {
      const numberMatch = baseName.match(/^(.+)\((\d+)\)$/);
      if (numberMatch && numberMatch[1]) {
        baseName = numberMatch[1];
        loopCount++;
      } else {
        break;
      }
    }

    // 确保 baseName 不为空（为空时使用默认值）
    if (!baseName && !extension) {
      baseName = "unnamed";
    }

    return { baseName, extension, directory };
  }



}
