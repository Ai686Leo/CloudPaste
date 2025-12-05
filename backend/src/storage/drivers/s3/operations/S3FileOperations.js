/**
 * S3文件操作模块
 * 负责单个文件的基础操作：获取信息、下载、上传、删除等
 */

import { AppError, NotFoundError, ConflictError, ValidationError, S3DriverError } from "../../../../http/errors.js";
import { generateDownloadUrl, createS3Client } from "../utils/s3Utils.js";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getMimeTypeFromFilename } from "../../../../utils/fileUtils.js";
import { handleFsError } from "../../../fs/utils/ErrorHandler.js";
import { updateParentDirectoriesModifiedTime } from "../utils/S3DirectoryUtils.js";
import { CAPABILITIES } from "../../../interfaces/capabilities/index.js";
import { GetFileType, getFileTypeName } from "../../../../utils/fileTypeDetector.js";
import { FILE_TYPES, FILE_TYPE_NAMES } from "../../../../constants/index.js";

export class S3FileOperations {
  /**
   * 构造函数
   * @param {S3Client} s3Client - S3客户端
   * @param {Object} config - S3配置
   * @param {string} encryptionSecret - 加密密钥
   * @param {Object} driver - 存储驱动实例（用于代理能力）
   */
  constructor(s3Client, config, encryptionSecret, driver = null) {
    this.s3Client = s3Client;
    this.config = config;
    this.encryptionSecret = encryptionSecret;
    this.driver = driver;
  }

  /**
   * 从S3获取文件内容（返回 StorageStreamDescriptor）
   * @param {Object} s3Config - S3配置对象
   * @param {string} s3SubPath - S3子路径
   * @param {string} fileName - 文件名
   * @param {boolean} forceDownload - 是否强制下载（已废弃，由上层处理）
   * @param {string} encryptionSecret - 加密密钥
   * @param {Request} request - 请求对象（已废弃，Range 由上层处理）
   * @returns {Promise<import('../../../streaming/types.js').StorageStreamDescriptor>} 流描述对象
   */
  async getFileFromS3(s3Config, s3SubPath, fileName, forceDownload = false, encryptionSecret, request = null) {
    const s3Client = await createS3Client(s3Config, encryptionSecret);
    const key = s3SubPath.startsWith("/") ? s3SubPath.slice(1) : s3SubPath;

    // 先获取文件元数据
    let metadata;
    try {
      const headCommand = new HeadObjectCommand({
        Bucket: s3Config.bucket_name,
        Key: key,
      });
      metadata = await s3Client.send(headCommand);
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404) {
        throw new NotFoundError("文件不存在");
      }
      throw new S3DriverError("获取文件元数据失败", { details: { cause: error?.message } });
    }

    const contentType = metadata.ContentType || getMimeTypeFromFilename(fileName);
    const size = metadata.ContentLength ?? null;
    const etag = metadata.ETag ?? null;
    const lastModified = metadata.LastModified ? new Date(metadata.LastModified) : null;

    // 返回 StorageStreamDescriptor
    return {
      size,
      contentType,
      etag,
      lastModified,

      /**
       * 获取完整文件流
       * @param {{ signal?: AbortSignal }} [streamOptions]
       * @returns {Promise<{ stream: ReadableStream, close: () => Promise<void> }>}
       */
      async getStream(streamOptions = {}) {
        const { signal } = streamOptions;
        try {
          const getCommand = new GetObjectCommand({
            Bucket: s3Config.bucket_name,
            Key: key,
          });
          const response = await s3Client.send(getCommand, signal ? { abortSignal: signal } : undefined);

          // AWS SDK v3 返回的 Body 是 Web ReadableStream
          const stream = response.Body;

          return {
            stream,
            async close() {
              // AWS SDK 的流会自动关闭，但我们可以尝试取消
              if (stream && typeof stream.cancel === "function") {
                try {
                  await stream.cancel();
                } catch {
                  // 忽略取消错误
                }
              }
            },
          };
        } catch (error) {
          if (error instanceof AppError) {
            throw error;
          }
          if (error?.$metadata?.httpStatusCode === 404) {
            throw new NotFoundError("文件不存在");
          }
          throw new S3DriverError("获取文件流失败", { details: { cause: error?.message } });
        }
      },

      /**
       * 获取指定范围的流（S3 原生支持 Range）
       * @param {{ start: number, end?: number }} range
       * @param {{ signal?: AbortSignal }} [streamOptions]
       * @returns {Promise<{ stream: ReadableStream, close: () => Promise<void> }>}
       */
      async getRange(range, streamOptions = {}) {
        const { signal } = streamOptions;
        const { start, end } = range;

        // 构建 Range 头
        const rangeHeader = end !== undefined ? `bytes=${start}-${end}` : `bytes=${start}-`;

        try {
          const getCommand = new GetObjectCommand({
            Bucket: s3Config.bucket_name,
            Key: key,
            Range: rangeHeader,
          });
          const response = await s3Client.send(getCommand, signal ? { abortSignal: signal } : undefined);

          const stream = response.Body;

          return {
            stream,
            async close() {
              if (stream && typeof stream.cancel === "function") {
                try {
                  await stream.cancel();
                } catch {
                  // 忽略取消错误
                }
              }
            },
          };
        } catch (error) {
          if (error instanceof AppError) {
            throw error;
          }
          if (error?.$metadata?.httpStatusCode === 404) {
            throw new NotFoundError("文件不存在");
          }
          throw new S3DriverError("获取文件范围流失败", { details: { cause: error?.message } });
        }
      },
    };
  }

  /**
   * 获取文件信息
   * @param {string} s3SubPath - S3子路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 文件信息
   */
  async getFileInfo(s3SubPath, options = {}) {
    const { mount, path, userType, userId, request, db } = options;

    return handleFsError(
      async () => {
        // 使用 ListObjectsV2Command 获取文件信息
        console.log(`getFileInfo - 使用 ListObjects 查询文件: ${s3SubPath}`);

        const listParams = {
          Bucket: this.config.bucket_name,
          Prefix: s3SubPath,
          MaxKeys: 1,
        };

        try {
          const listCommand = new ListObjectsV2Command(listParams);
          const listResponse = await this.s3Client.send(listCommand);

          // 检查是否找到精确匹配的文件
          const exactMatch = listResponse.Contents?.find((item) => item.Key === s3SubPath);

          if (!exactMatch) {
            throw new NotFoundError("文件不存在");
          }

          // 构建文件信息对象
          const fileName = path.split("/").filter(Boolean).pop() || "/";

          // 检查是否为目录：基于Key是否以'/'结尾判断
          const isDirectory = exactMatch.Key.endsWith("/");

          const fileType = isDirectory ? FILE_TYPES.FOLDER : await GetFileType(fileName, db);
          const fileTypeName = isDirectory ? FILE_TYPE_NAMES[FILE_TYPES.FOLDER] : await getFileTypeName(fileName, db);
          const detectedMimeType = isDirectory ? "application/x-directory" : getMimeTypeFromFilename(fileName);

          const result = {
            path: path,
            name: fileName,
            isDirectory: isDirectory,
            size: isDirectory ? 0 : exactMatch.Size || 0, // 目录大小为0
            modified: exactMatch.LastModified ? exactMatch.LastModified.toISOString() : new Date().toISOString(),
            mimetype: detectedMimeType,
            etag: exactMatch.ETag ? exactMatch.ETag.replace(/"/g, "") : undefined,
            mount_id: mount.id,
            storage_type: mount.storage_type,
            type: fileType, // 整数类型常量 (0-6)
            typeName: fileTypeName, // 类型名称（用于调试）
          };

          console.log(`getFileInfo - ListObjects 成功获取文件信息: ${result.name}`);
          return result;
        } catch (listError) {
          // 如果 ListObjects 失败，fallback 到 GET 方法
          console.log(`getFileInfo - ListObjects 失败，fallback 到 GET 方法: ${listError.message}`);

          try {
            const getParams = {
              Bucket: this.config.bucket_name,
              Key: s3SubPath,
              Range: "bytes=0-0", // 只获取第一个字节来检查文件存在性
            };

            const getCommand = new GetObjectCommand(getParams);
            const getResponse = await this.s3Client.send(getCommand);

            const fileName = path.split("/").filter(Boolean).pop() || "/";

            // 检查是否为目录：基于ContentType判断
            const isDirectory = getResponse.ContentType === "application/x-directory";

            const fileType = isDirectory ? FILE_TYPES.FOLDER : await GetFileType(fileName, db);
            const fileTypeName = isDirectory ? FILE_TYPE_NAMES[FILE_TYPES.FOLDER] : await getFileTypeName(fileName, db);

            const result = {
              path: path,
              name: fileName,
              isDirectory: isDirectory,
              size: isDirectory ? 0 : getResponse.ContentLength || 0, // 目录大小为0
              modified: getResponse.LastModified ? getResponse.LastModified.toISOString() : new Date().toISOString(),
              mimetype: getResponse.ContentType || "application/octet-stream", // 统一使用mimetype字段名
              etag: getResponse.ETag ? getResponse.ETag.replace(/"/g, "") : undefined,
              mount_id: mount.id,
              storage_type: mount.storage_type,
              type: fileType, // 整数类型常量 (0-6)
              typeName: fileTypeName, // 类型名称（用于调试）
            };

            console.log(`getFileInfo(GET) - 文件[${result.name}], S3 ContentType[${getResponse.ContentType}]`);
            return result;
          } catch (getError) {
            // 检查是否是NotFound错误，转换为AppError
            if (getError.$metadata?.httpStatusCode === 404 || getError.name === "NotFound") {
              throw new NotFoundError("文件不存在");
            }

            throw getError;
          }
        }
      },
      "获取文件信息",
      "获取文件信息失败"
    );
  }

  /**
   * 下载文件
   * @param {string} s3SubPath - S3子路径
   * @param {string} fileName - 文件名
   * @param {Request} request - 请求对象（已废弃，Range 由上层处理）
   * @returns {Promise<import('../../../streaming/types.js').StorageStreamDescriptor>} 流描述对象
   */
  async downloadFile(s3SubPath, fileName, request = null) {
    return handleFsError(
      async () => {
        // 使用现有的getFileFromS3函数
        return await this.getFileFromS3(this.config, s3SubPath, fileName, false, this.encryptionSecret, request);
      },
      "下载文件",
      "下载文件失败"
    );
  }

  /**
   * 生成文件预签名下载URL
   * @param {string} s3SubPath - S3子路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 预签名URL信息
   */
  async generateDownloadUrl(s3SubPath, options = {}) {
    const { expiresIn = 604800, forceDownload = false, userType, userId, mount } = options;

    return handleFsError(
      async () => {
        const cacheOptions = {
          userType,
          userId,
          enableCache: mount?.cache_ttl > 0,
        };

        const presignedUrl = await generateDownloadUrl(
          this.config,
          s3SubPath,
          this.encryptionSecret,
          expiresIn,
          forceDownload,
          null,
          cacheOptions,
        );

        // 提取文件名
        const fileName = s3SubPath.split("/").filter(Boolean).pop() || "file";

        // 统一在驱动层使用 canonical 字段 url，供上层 LinkStrategy/LinkService 消费
        const url = presignedUrl;
        const type = this.config.custom_host ? "custom_host" : "native_direct";

        return {
          success: true,
          url,
          type,
          name: fileName,
          expiresIn: expiresIn,
          expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
          forceDownload: forceDownload,
        };
      },
      "获取文件下载预签名URL",
      "获取文件下载预签名URL失败"
    );
  }

  /**
   * 检查文件是否存在
   * @param {string} s3SubPath - S3子路径
   * @returns {Promise<boolean>} 是否存在
   */
  async exists(s3SubPath) {
    const key = s3SubPath.startsWith("/") ? s3SubPath.slice(1) : s3SubPath;
    const isDirectory = key === "" || key.endsWith("/");

    // 文件优先使用 HEAD，避免 List 前缀误判
    if (!isDirectory) {
      try {
        const headCommand = new HeadObjectCommand({
          Bucket: this.config.bucket_name,
          Key: key,
        });
        await this.s3Client.send(headCommand);
        return true;
      } catch (error) {
        const status = error?.$metadata?.httpStatusCode;
        const code = error?.name || error?.Code;
        const notFound = status === 404 || code === "NotFound" || code === "NoSuchKey";
        if (!notFound) {
          // 非 404 级错误时降级为前缀检查，避免硬失败
          console.warn("[S3FileOperations.exists] headObject fallback", error?.message || error);
        }
      }
    }

    // 目录或 Head 未命中的情况下，使用前缀列举兜底
    try {
      const prefix = isDirectory ? key : `${key}/`;
      const listParams = {
        Bucket: this.config.bucket_name,
        Prefix: prefix,
        MaxKeys: 1,
      };

      const listCommand = new ListObjectsV2Command(listParams);
      const listResponse = await this.s3Client.send(listCommand);

      const hasObject = (listResponse.Contents?.length || 0) > 0;
      const hasPrefix = (listResponse.CommonPrefixes?.length || 0) > 0;
      return hasObject || hasPrefix;
    } catch (error) {
      console.warn("[S3FileOperations.exists] listObjects fallback failed", error?.message || error);
      return false;
    }
  }

  /**
   * 更新文件内容
   * @param {string} s3SubPath - S3子路径
   * @param {string|ArrayBuffer} content - 新内容
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 更新结果
   */
  async updateFile(s3SubPath, content, options = {}) {
    const { fileName } = options;

    return handleFsError(
      async () => {
        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

        // 检查内容大小
        if (typeof content === "string" && content.length > MAX_FILE_SIZE) {
          throw new ValidationError("文件内容过大，超过最大限制(10MB)");
        } else if (content instanceof ArrayBuffer && content.byteLength > MAX_FILE_SIZE) {
          throw new ValidationError("文件内容过大，超过最大限制(10MB)");
        }

        // 推断MIME类型
        const contentType = getMimeTypeFromFilename(fileName || s3SubPath);

        // 首先检查文件是否存在，获取原始元数据
        let originalMetadata = null;
        try {
          const listParams = {
            Bucket: this.config.bucket_name,
            Prefix: s3SubPath,
            MaxKeys: 1,
          };
          const listCommand = new ListObjectsV2Command(listParams);
          const listResponse = await this.s3Client.send(listCommand);

          // 检查是否找到精确匹配的文件
          const exactMatch = listResponse.Contents?.find((item) => item.Key === s3SubPath);
          if (exactMatch) {
            originalMetadata = {
              LastModified: exactMatch.LastModified,
              ETag: exactMatch.ETag,
              Size: exactMatch.Size,
            };
          }
        } catch (error) {
          console.warn(`获取原始文件元数据失败: ${error.message}`);
          // 错误表示无法获取元数据，这是正常的（创建新文件）
        }

        const putParams = {
          Bucket: this.config.bucket_name,
          Key: s3SubPath,
          Body: content,
          ContentType: contentType,
        };

        console.log(`准备更新S3对象: ${s3SubPath}, 内容类型: ${contentType}`);
        const putCommand = new PutObjectCommand(putParams);
        const result = await this.s3Client.send(putCommand);

        // 更新父目录的修改时间
        await updateParentDirectoriesModifiedTime(this.s3Client, this.config.bucket_name, s3SubPath);

        return {
          success: true,
          path: s3SubPath,
          etag: result.ETag ? result.ETag.replace(/"/g, "") : undefined,
          mimetype: contentType,
          message: "文件更新成功",
          isNewFile: !originalMetadata,
        };
      },
      "更新文件",
      "更新文件失败"
    );
  }

  /**
   * 重命名文件
   * @param {string} oldS3SubPath - 原S3子路径
   * @param {string} newS3SubPath - 新S3子路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 重命名结果
   */
  async renameFile(oldS3SubPath, newS3SubPath, options = {}) {
    return handleFsError(
      async () => {
        // 检查源文件是否存在
        const sourceExists = await this.exists(oldS3SubPath);
        if (!sourceExists) {
          throw new NotFoundError("源文件不存在");
        }

        // 检查目标文件是否已存在
        const targetExists = await this.exists(newS3SubPath);
        if (targetExists) {
          throw new ConflictError("目标文件已存在");
        }

        // 复制文件到新位置
        const copyParams = {
          Bucket: this.config.bucket_name,
          CopySource: encodeURIComponent(this.config.bucket_name + "/" + oldS3SubPath),
          Key: newS3SubPath,
        };

        const copyCommand = new CopyObjectCommand(copyParams);
        await this.s3Client.send(copyCommand);

        // 删除原文件
        const deleteParams = {
          Bucket: this.config.bucket_name,
          Key: oldS3SubPath,
        };

        const deleteCommand = new DeleteObjectCommand(deleteParams);
        await this.s3Client.send(deleteCommand);

        return {
          success: true,
          oldPath: oldS3SubPath,
          newPath: newS3SubPath,
          message: "文件重命名成功",
        };
      },
      "重命名文件",
      "重命名文件失败"
    );
  }

  /**
   * 复制单个文件
   * @param {string} sourceS3SubPath - 源S3子路径
   * @param {string} targetS3SubPath - 目标S3子路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 复制结果
   */
  async copyFile(sourceS3SubPath, targetS3SubPath, options = {}) {
    const { skipExisting = true } = options;

    try {
      // 检查源文件是否存在
      const sourceExists = await this.exists(sourceS3SubPath);
      if (!sourceExists) {
        throw new NotFoundError("源文件不存在");
      }

      // 检查目标文件是否已存在
      if (skipExisting) {
        const targetExists = await this.exists(targetS3SubPath);
        if (targetExists) {
          // 文件已存在，跳过
          return {
            success: true,
            skipped: true,
            source: sourceS3SubPath,
            target: targetS3SubPath,
            message: "文件已存在，跳过复制",
          };
        }
      }

      // 执行复制
      const copyParams = {
        Bucket: this.config.bucket_name,
        CopySource: encodeURIComponent(this.config.bucket_name + "/" + sourceS3SubPath),
        Key: targetS3SubPath,
        MetadataDirective: "COPY", // 保持原有元数据
      };

      const copyCommand = new CopyObjectCommand(copyParams);
      await this.s3Client.send(copyCommand);

      // 更新父目录的修改时间
      await updateParentDirectoriesModifiedTime(this.s3Client, this.config.bucket_name, targetS3SubPath);

      return {
        success: true,
        skipped: false,
        source: sourceS3SubPath,
        target: targetS3SubPath,
        message: "文件复制成功",
      };
    } catch (error) {
      console.error("复制文件失败:", error);

      if (error.$metadata?.httpStatusCode === 404) {
        throw new NotFoundError("源文件不存在");
      }

      throw new S3DriverError("复制文件失败", { details: { cause: error?.message, source: sourceS3SubPath, target: targetS3SubPath } });
    }
  }
}
