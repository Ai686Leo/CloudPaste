/**
 * S3上传操作模块
 * 负责文件上传相关操作：直接上传、分片上传（前端分片）、预签名上传等
 */

import { ApiStatus } from "../../../../constants/index.js";
import { AppError, ValidationError, S3DriverError } from "../../../../http/errors.js";
import { generateUploadUrl, buildS3Url } from "../utils/s3Utils.js";
import { S3Client, PutObjectCommand, ListMultipartUploadsCommand, ListPartsCommand, UploadPartCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { updateMountLastUsed } from "../../../fs/utils/MountResolver.js";
import { getMimeTypeFromFilename } from "../../../../utils/fileUtils.js";
import { handleFsError } from "../../../fs/utils/ErrorHandler.js";
import { updateParentDirectoriesModifiedTime } from "../utils/S3DirectoryUtils.js";
import { getEnvironmentOptimizedUploadConfig, isNodeJSEnvironment } from "../../../../utils/environmentUtils.js";
import { updateUploadProgress } from "../../../utils/UploadProgressTracker.js";
import {
  createUploadSessionRecord,
  computeUploadSessionFingerprintMetaV1,
  updateUploadSessionStatusByFingerprint,
  findUploadSessionByUploadUrl,
} from "../../../../utils/uploadSessions.js";

export class S3UploadOperations {
  /**
   * 构造函数
   * @param {S3Client} s3Client - S3客户端
   * @param {Object} config - S3配置
   * @param {string} encryptionSecret - 加密密钥
   */
  constructor(s3Client, config, encryptionSecret) {
    this.s3Client = s3Client;
    this.config = config;
    this.encryptionSecret = encryptionSecret;
  }

  /**
   * 上传流式数据
   * @param {string} s3SubPath - S3子路径
   * @param {ReadableStream} stream - 数据流
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 上传结果
   */
  async uploadStream(s3SubPath, stream, options = {}) {
    const { mount, db, filename, contentType, contentLength } = options;

    return handleFsError(
      async () => {
        // 1. 规范化最终 Key
        let finalS3Path;
        const { isCompleteFilePath } = await import("../utils/S3PathUtils.js");
        if (s3SubPath && isCompleteFilePath(s3SubPath, filename)) {
          finalS3Path = s3SubPath;
        } else if (s3SubPath && !s3SubPath.endsWith("/")) {
          finalS3Path = s3SubPath + "/" + filename;
        } else {
          finalS3Path = s3SubPath + filename;
        }

        let result;
        let etag;
        const progressId = options.uploadId || finalS3Path;

        // 2. 构造适配当前环境的 Body，并统一使用 Upload（lib-storage）
        const { Upload } = await import("@aws-sdk/lib-storage");
        const uploadConfig = getEnvironmentOptimizedUploadConfig();
        console.log(
          `[StorageUpload] type=S3 mode=流式分片 status=开始 路径=${finalS3Path}`
        );

        /** @type {any} */
        let bodyForUpload = stream;

        // 在 Node.js/Docker 环境中，如果收到的是 Web ReadableStream，
        // 使用 Readable.fromWeb 转换为 Node.js Readable 流式。
        if (isNodeJSEnvironment() && stream && typeof stream.getReader === "function") {
          try {
            const { Readable } = await import("stream");
            if (typeof Readable.fromWeb === "function") {
              bodyForUpload = Readable.fromWeb(stream);
            }
          } catch (e) {
            console.warn("S3 流式上传: Readable.fromWeb 转换失败，回退为原始流:", e?.message || e);
            bodyForUpload = stream;
          }
        }

        const upload = new Upload({
          client: this.s3Client,
          params: {
            Bucket: this.config.bucket_name,
            Key: finalS3Path,
            Body: bodyForUpload,
            ContentType: contentType,
          },
          queueSize: uploadConfig.queueSize,
          partSize: uploadConfig.partSize,
          leavePartsOnError: false,
        });

        // 3. 只从 Upload 的 httpUploadProgress 里拿整体进度
        let lastProgressLog = 0;
        upload.on("httpUploadProgress", (progress) => {
          const { loaded = 0, total = contentLength } = progress;
          const REDUCED_LOG_INTERVAL = 50 * 1024 * 1024;
          const shouldLog = total > 0 ? loaded === total || loaded - lastProgressLog >= REDUCED_LOG_INTERVAL : loaded - lastProgressLog >= REDUCED_LOG_INTERVAL;

          if (shouldLog) {
            const progressMB = (loaded / (1024 * 1024)).toFixed(2);
            const totalMB = total > 0 ? (total / (1024 * 1024)).toFixed(2) : "未知";
            const percentage = total > 0 ? ((loaded / total) * 100).toFixed(1) : "未知";
            console.log(
              `[StorageUpload] type=S3 mode=流式分片 status=进度 已传=${progressMB}MB 总=${totalMB}MB 进度=${percentage}% 路径=${finalS3Path}`
            );
            lastProgressLog = loaded;
          }

          try {
            updateUploadProgress(progressId, {
              loaded,
              total,
              path: finalS3Path,
              storageType: "S3",
            });
          } catch {}
        });

        // 4. 等 Upload 完成，然后统一做目录更新时间等收尾
        const startTime = Date.now();
        result = await upload.done();
        const duration = Date.now() - startTime;
        const speedMBps = contentLength > 0 ? (contentLength / 1024 / 1024 / (duration / 1000)).toFixed(2) : "未知";

        console.log(
          `[StorageUpload] type=S3 mode=流式分片 status=完成 用时=${duration}ms 速度=${speedMBps}MB/s 路径=${finalS3Path}`
        );
        etag = result.ETag ? result.ETag.replace(/"/g, "") : undefined;

        await updateParentDirectoriesModifiedTime(this.s3Client, this.config.bucket_name, finalS3Path);
        if (db && mount && mount.id) {
          await updateMountLastUsed(db, mount.id);
        }

        const s3Url = buildS3Url(this.config, finalS3Path);

        console.log(
          `[StorageUpload] type=S3 mode=流式分片 status=成功 路径=${finalS3Path}`
        );
        return {
          success: true,
          message: "S3_STREAM_UPLOAD",
          storagePath: finalS3Path,
          publicUrl: s3Url,
          etag,
          contentType,
        };
      },
      "流式上传",
      "流式上传失败"
    );
  }

  /**
   * 表单上传（一次性读取全部数据）
   * @param {string} s3SubPath - S3子路径
   * @param {File|Blob|Uint8Array|ArrayBuffer|Buffer|string} data - 完整数据源
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 上传结果
   */
  async uploadForm(s3SubPath, data, options = {}) {
    const { mount, db, filename, contentType } = options;

    return handleFsError(
      async () => {
        // 构建最终的S3路径
        let finalS3Path;
        const { isCompleteFilePath } = await import("../utils/S3PathUtils.js");
        if (s3SubPath && isCompleteFilePath(s3SubPath, filename)) {
          finalS3Path = s3SubPath;
        } else if (s3SubPath && !s3SubPath.endsWith("/")) {
          finalS3Path = s3SubPath + "/" + filename;
        } else {
          finalS3Path = s3SubPath + filename;
        }

        // 推断 MIME 类型
        const effectiveContentType = contentType || getMimeTypeFromFilename(filename);

        // 规范化 Body 与长度
        let body;
        let size = 0;

        if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
          body = data;
          size = data.length;
        } else if (data instanceof Uint8Array) {
          body = data;
          size = data.byteLength;
        } else if (data instanceof ArrayBuffer) {
          body = new Uint8Array(data);
          size = body.byteLength;
        } else if (data && typeof data.arrayBuffer === "function") {
          const buf = await data.arrayBuffer();
          body = new Uint8Array(buf);
          size = body.byteLength;
        } else if (typeof data === "string") {
          body = typeof Buffer !== "undefined" ? Buffer.from(data) : new TextEncoder().encode(data);
          size = body.length ?? body.byteLength ?? 0;
        } else {
          throw new ValidationError("不支持的表单上传数据类型");
        }

        const putParams = {
          Bucket: this.config.bucket_name,
          Key: finalS3Path,
          Body: body,
          ContentType: effectiveContentType,
          ContentLength: size,
        };

        const putCommand = new PutObjectCommand(putParams);
        const result = await this.s3Client.send(putCommand);

        // 更新父目录的修改时间
        await updateParentDirectoriesModifiedTime(this.s3Client, this.config.bucket_name, finalS3Path);

        // 更新最后使用时间
        if (db && mount && mount.id) {
          await updateMountLastUsed(db, mount.id);
        }

        const s3Url = buildS3Url(this.config, finalS3Path);

        console.log(
          `[StorageUpload] type=S3 mode=表单上传 status=成功 路径=${finalS3Path} 大小=${size}`
        );
        return {
          success: true,
          message: "S3_FORM_UPLOAD",
          storagePath: finalS3Path,
          publicUrl: s3Url,
          etag: result.ETag ? result.ETag.replace(/\"/g, "") : null,
          contentType: effectiveContentType,
        };
      },
      "表单上传",
      "表单上传失败"
    );
  }

  /**
   * 生成预签名上传URL
   * @param {string} s3SubPath - S3子路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 预签名上传URL信息
   */
  async generateUploadUrl(s3SubPath, options = {}) {
    const { fileName, fileSize, expiresIn = 3600 } = options;

    return handleFsError(
      async () => {
        // 推断MIME类型
        const contentType = getMimeTypeFromFilename(fileName);

        // 构建最终的 S3 对象 Key（与直接上传逻辑保持一致）
        let finalS3Path;
        const { isCompleteFilePath } = await import("../utils/S3PathUtils.js");
        if (s3SubPath && isCompleteFilePath(s3SubPath, fileName)) {
          // s3SubPath 已包含完整文件路径
          finalS3Path = s3SubPath;
        } else if (s3SubPath && !s3SubPath.endsWith("/")) {
          finalS3Path = `${s3SubPath}/${fileName}`;
        } else {
          finalS3Path = `${s3SubPath || ""}${fileName}`;
        }

        const presignedUrl = await generateUploadUrl(this.config, finalS3Path, contentType, this.encryptionSecret, expiresIn);

        // 生成 S3 直接访问 URL
        const s3Url = buildS3Url(this.config, finalS3Path);

        return {
          success: true,
          uploadUrl: presignedUrl,
          publicUrl: s3Url,
          contentType: contentType,
          expiresIn: expiresIn,
          storagePath: finalS3Path,
          fileName: fileName,
          fileSize: fileSize,
        };
      },
      "生成预签名上传URL",
      "生成预签名上传URL失败"
    );
  }

  /**
   * 处理上传完成后的操作
   * @param {string} s3SubPath - S3子路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 处理结果
   */
  async handleUploadComplete(s3SubPath, options = {}) {
    const { mount, db, fileName, fileSize, contentType, etag } = options;

    try {
      // 后端验证文件是否真实存在并获取元数据
      let verifiedETag = etag;
      let verifiedSize = fileSize;
      let verifiedContentType = contentType;

      try {
        const headParams = {
          Bucket: this.config.bucket_name,
          Key: s3SubPath,
        };
        const headCommand = new HeadObjectCommand(headParams);
        const headResult = await this.s3Client.send(headCommand);

        // 使用后端获取的真实元数据
        verifiedETag = headResult.ETag ? headResult.ETag.replace(/"/g, "") : verifiedETag;
        verifiedSize = headResult.ContentLength || verifiedSize;
        verifiedContentType = headResult.ContentType || verifiedContentType;

        console.log(`✅ 后端验证上传成功 - 文件[${s3SubPath}], ETag[${verifiedETag}], 大小[${verifiedSize}]`);
      } catch (headError) {
        // 如果 HeadObject 失败,说明文件不存在,上传实际失败
        console.error(`❌ 后端验证失败 - 文件[${s3SubPath}]不存在:`, headError);
        throw new ValidationError("文件上传失败:文件不存在于存储桶中");
      }

      // 更新父目录的修改时间
      const rootPrefix = this.config.root_prefix ? (this.config.root_prefix.endsWith("/") ? this.config.root_prefix : this.config.root_prefix + "/") : "";
      await updateParentDirectoriesModifiedTime(this.s3Client, this.config.bucket_name, s3SubPath, rootPrefix);

      // 更新最后使用时间
      if (db && mount && mount.id) {
        await updateMountLastUsed(db, mount.id);
      }

      // 构建公共URL
      const s3Url = buildS3Url(this.config, s3SubPath);

      return {
        success: true,
        message: "上传完成处理成功",
        fileName: fileName,
        size: verifiedSize,
        contentType: verifiedContentType,
        storagePath: s3SubPath,
        publicUrl: s3Url,
        etag: verifiedETag,
      };
    } catch (error) {
      console.error("处理上传完成失败:", error);

      // 如果已经是 AppError，直接抛出
      if (error instanceof AppError) {
        throw error;
      }

      throw new S3DriverError("处理上传完成失败", { details: { cause: error?.message } });
    }
  }

  /**
   * 取消上传操作
   * @param {string} s3SubPath - S3子路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 取消结果
   */
  async cancelUpload(s3SubPath, options = {}) {
    const { uploadId } = options;

    try {
      if (uploadId) {
        // 取消分片上传
        const { AbortMultipartUploadCommand } = await import("@aws-sdk/client-s3");
        const abortParams = {
          Bucket: this.config.bucket_name,
          Key: s3SubPath,
          UploadId: uploadId,
        };

        const abortCommand = new AbortMultipartUploadCommand(abortParams);
        await this.s3Client.send(abortCommand);
      }

      return {
        success: true,
        message: "上传已取消",
      };
    } catch (error) {
      console.error("取消上传失败:", error);
      throw new S3DriverError("取消上传失败", { details: { cause: error?.message } });
    }
  }

  /**
   * 初始化前端分片上传（生成预签名URL列表）
   * @param {string} s3SubPath - S3子路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 初始化结果
   */
  async initializeFrontendMultipartUpload(s3SubPath, options = {}) {
    const {
      fileName,
      fileSize,
      partSize = 5 * 1024 * 1024,
      partCount,
      mount,
      db,
      userIdOrInfo,
      userType,
    } = options;

    console.log("[S3UploadOperations] 初始化分片上传", {
      fileName,
      fileSize,
      mountId: mount?.id,
    });

    return handleFsError(
      async () => {
        // 推断MIME类型
        const contentType = getMimeTypeFromFilename(fileName);
        console.log(`初始化前端分片上传：从文件名[${fileName}]推断MIME类型: ${contentType}`);

        // 构建最终的S3路径
        let finalS3Path;

        // 智能检查s3SubPath是否已经包含完整的文件路径
        const { isCompleteFilePath } = await import("../utils/S3PathUtils.js");
        if (s3SubPath && isCompleteFilePath(s3SubPath, fileName)) {
          // s3SubPath已经是完整的文件路径，直接使用
          finalS3Path = s3SubPath;
        } else if (s3SubPath && !s3SubPath.endsWith("/")) {
          // s3SubPath是目录路径，需要拼接文件名
          finalS3Path = s3SubPath + "/" + fileName;
        } else {
          // s3SubPath为空或以斜杠结尾，直接拼接文件名
          finalS3Path = s3SubPath + fileName;
        }

        // 基本参数校验
        if (
          !fileName ||
          typeof fileSize !== "number" ||
          !Number.isFinite(fileSize) ||
          fileSize <= 0
        ) {
          throw new ValidationError("S3 分片上传初始化失败：缺少有效的 fileName 或 fileSize");
        }

        // S3 官方约束：
        // - 单个对象最大 5TB
        // - 单个分片最小 5MB（最后一片可以更小）
        // - 单个分片最大 5GB
        // - 分片总数最多 10000
        const MIN_PART_SIZE = 5 * 1024 * 1024; // 5MB
        const MAX_PART_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
        const MAX_PARTS = 10000;
        const MAX_OBJECT_SIZE = MAX_PART_SIZE * MAX_PARTS; // 5GB * 10000 = 5TB

        if (fileSize > MAX_OBJECT_SIZE) {
          throw new ValidationError(
            "S3 分片上传初始化失败：文件大小超过 S3 单对象最大限制（约 5TB）",
          );
        }

        // 计算基础分片大小：
        // - 如果调用方显式传入 partSize，则在合法范围内 clamp；
        // - 否则按文件大小自动推导：ceil(fileSize / MAX_PARTS)，再 clamp 到 [MIN_PART_SIZE, MAX_PART_SIZE]。
        let basePartSize;
        if (Number.isFinite(partSize) && partSize > 0) {
          basePartSize = Number(partSize);
        } else {
          basePartSize = Math.ceil(fileSize / MAX_PARTS);
        }

        if (!Number.isFinite(basePartSize) || basePartSize < MIN_PART_SIZE) {
          basePartSize = MIN_PART_SIZE;
        }
        if (basePartSize > MAX_PART_SIZE) {
          basePartSize = MAX_PART_SIZE;
        }

        const effectivePartSize = basePartSize;
        const estimatedParts = partCount || Math.ceil(fileSize / effectivePartSize);

        if (!Number.isFinite(estimatedParts) || estimatedParts <= 0) {
          throw new ValidationError("S3 分片上传初始化失败：无法计算分片数量");
        }
        if (estimatedParts > MAX_PARTS) {
          throw new ValidationError(
            `S3 分片上传初始化失败：分片数量超过上限（${MAX_PARTS}），请增大分片大小或限制文件尺寸`,
          );
        }

        // 创建分片上传
        const { CreateMultipartUploadCommand } = await import("@aws-sdk/client-s3");
        const createCommand = new CreateMultipartUploadCommand({
          Bucket: this.config.bucket_name,
          Key: finalS3Path,
          ContentType: contentType,
        });

        const createResponse = await this.s3Client.send(createCommand);
        const uploadId = createResponse.UploadId;

        // 计算分片数量
        const calculatedPartCount = estimatedParts;

        // 生成预签名URL列表（per_part_url 策略下的分片端点）
        const presignedUrls = [];
        const { UploadPartCommand } = await import("@aws-sdk/client-s3");

        for (let partNumber = 1; partNumber <= calculatedPartCount; partNumber++) {
          const uploadPartCommand = new UploadPartCommand({
            Bucket: this.config.bucket_name,
            Key: finalS3Path,
            UploadId: uploadId,
            PartNumber: partNumber,
          });

          // 生成预签名URL
          const presignedUrl = await getSignedUrl(this.s3Client, uploadPartCommand, {
            expiresIn: this.config.signature_expires_in || 3600,
          });

          presignedUrls.push({
            partNumber: partNumber,
            url: presignedUrl,
          });
        }

        // 更新最后使用时间
        if (db && mount && mount.id) {
          await updateMountLastUsed(db, mount.id);
        }

        // 记录到通用 upload_sessions 表（控制面会话），便于统一管理与 UI 展示
        if (db && mount?.storage_config_id) {
          try {
            // 规范化 FS 视图路径：mount_path + s3SubPath
            let fsPath = s3SubPath || "";
            if (mount.mount_path) {
              const basePath = (mount.mount_path || "").replace(/\/+$/g, "") || "/";
              const rel = (s3SubPath || "").replace(/^\/+/g, "");
              fsPath = rel ? `${basePath}/${rel}` : basePath;
            }
            if (!fsPath.startsWith("/")) {
              fsPath = `/${fsPath}`;
            }

            const fingerprint = computeUploadSessionFingerprintMetaV1({
              userIdOrInfo,
              userType: userType || null,
              storageType: "S3",
              storageConfigId: mount.storage_config_id,
              mountId: mount.id ?? null,
              fsPath,
              fileName,
              fileSize,
            });

            const sessionPayload = {
              userIdOrInfo,
              userType: userType || null,
              storageType: "S3",
              storageConfigId: mount.storage_config_id,
              mountId: mount.id ?? null,
              fsPath,
              source: "FS",
              fileName,
              fileSize,
              mimeType: contentType || null,
              checksum: null,
              fingerprintAlgo: fingerprint.algo,
              fingerprintValue: fingerprint.value,
              strategy: "per_part_url",
              partSize: effectivePartSize,
              totalParts: calculatedPartCount,
              bytesUploaded: 0,
              uploadedParts: 0,
              nextExpectedRange: null,
              // 对于 S3，用 UploadId 作为 provider 会话标识，同时写入 upload_url 字段以复用现有工具函数
              providerUploadId: uploadId,
              providerUploadUrl: uploadId,
              providerMeta: null,
              status: "active",
              expiresAt: null,
            };

            await createUploadSessionRecord(db, sessionPayload);
          } catch (e) {
            console.warn(
              "[S3UploadOperations] 创建 upload_sessions 记录失败，将不影响分片上传流程:",
              e,
            );
          }
        }

        return {
          // 通用字段
          uploadId: uploadId,
          strategy: "per_part_url",
          fileName,
          fileSize,
          partSize: effectivePartSize,
          partCount: calculatedPartCount,
          // S3 专用字段
          bucket: this.config.bucket_name,
          key: finalS3Path,
          presignedUrls,
          mount_id: mount ? mount.id : null,
          path: mount ? mount.mount_path + s3SubPath : s3SubPath,
          storage_type: mount ? mount.storage_type : "S3",
        };
      },
      "初始化前端分片上传",
      "初始化前端分片上传失败"
    );
  }

  /**
   * 完成前端分片上传
   * @param {string} s3SubPath - S3子路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 完成结果
   */
  async completeFrontendMultipartUpload(s3SubPath, options = {}) {
    const { uploadId, parts, fileName, fileSize, mount, db, userIdOrInfo, userType } = options;

    console.log("[S3UploadOperations] 完成分片上传", {
      fileName,
      fileSize,
      mountId: mount?.id,
    });

    return handleFsError(
      async () => {
        // 构建最终的S3路径
        let finalS3Path;

        // 智能检查s3SubPath是否已经包含完整的文件路径
        const { isCompleteFilePath } = await import("../utils/S3PathUtils.js");
        if (s3SubPath && isCompleteFilePath(s3SubPath, fileName)) {
          // s3SubPath已经是完整的文件路径，直接使用
          finalS3Path = s3SubPath;
        } else if (s3SubPath && !s3SubPath.endsWith("/")) {
          // s3SubPath是目录路径，需要拼接文件名
          finalS3Path = s3SubPath + "/" + fileName;
        } else {
          // s3SubPath为空或以斜杠结尾，直接拼接文件名
          finalS3Path = s3SubPath + fileName;
        }

        // 验证parts格式
        const validatedParts = parts.map((part) => {
          if (!part.PartNumber || !part.ETag) {
            throw new ValidationError(`分片数据不完整: PartNumber=${part.PartNumber}, ETag=${part.ETag}`);
          }

          return {
            PartNumber: part.PartNumber,
            ETag: part.ETag,
          };
        });

        // 确保parts按照PartNumber排序
        const sortedParts = [...validatedParts].sort((a, b) => a.PartNumber - b.PartNumber);

        // 完成分片上传
        const { CompleteMultipartUploadCommand } = await import("@aws-sdk/client-s3");
        const completeCommand = new CompleteMultipartUploadCommand({
          Bucket: this.config.bucket_name,
          Key: finalS3Path,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: sortedParts,
          },
        });

        const completeResponse = await this.s3Client.send(completeCommand);

        // 更新最后使用时间
        if (db && mount && mount.id) {
          await updateMountLastUsed(db, mount.id);
        }

        // 推断MIME类型
        const contentType = getMimeTypeFromFilename(fileName);

        // 构建公共URL
        const s3Url = buildS3Url(this.config, finalS3Path);

        // 文件上传完成后，尽量更新通用 upload_sessions 状态（不影响主流程）
        if (db && mount?.storage_config_id && uploadId) {
          try {
            // 重新计算与初始化阶段一致的 FS 视图路径与指纹
            let fsPath = s3SubPath || "";
            if (mount.mount_path) {
              const basePath = (mount.mount_path || "").replace(/\/+$/g, "") || "/";
              const rel = (s3SubPath || "").replace(/^\/+/g, "");
              fsPath = rel ? `${basePath}/${rel}` : basePath;
            }
            if (!fsPath.startsWith("/")) {
              fsPath = `/${fsPath}`;
            }

            const fingerprint = computeUploadSessionFingerprintMetaV1({
              userIdOrInfo,
              userType,
              storageType: "S3",
              storageConfigId: mount.storage_config_id,
              mountId: mount.id ?? null,
              fsPath,
              fileName,
              fileSize,
            });

            await updateUploadSessionStatusByFingerprint(db, {
              userIdOrInfo,
              userType,
              storageType: "S3",
              storageConfigId: mount.storage_config_id,
              mountId: mount.id ?? null,
              fsPath,
              fileName,
              fileSize,
              status: "completed",
              bytesUploaded: fileSize,
              uploadedParts: Array.isArray(sortedParts) ? sortedParts.length : null,
              nextExpectedRange: null,
              errorCode: null,
              errorMessage: null,
            });
          } catch (e) {
            console.warn(
              "[S3UploadOperations] 更新 upload_sessions 状态为 completed 失败:",
              e,
            );
          }
        }

        return {
          success: true,
          fileName: fileName,
          size: fileSize,
          contentType: contentType,
          storagePath: finalS3Path,
          publicUrl: s3Url,
          etag: completeResponse.ETag ? completeResponse.ETag.replace(/"/g, "") : null,
          location: completeResponse.Location,
          message: "前端分片上传完成",
        };
      },
      "完成前端分片上传",
      "完成前端分片上传失败"
    );
  }

  /**
   * 中止前端分片上传
   * @param {string} s3SubPath - S3子路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 中止结果
   */
  async abortFrontendMultipartUpload(s3SubPath, options = {}) {
    const { uploadId, fileName, mount, db, userIdOrInfo, userType } = options;

    return handleFsError(
      async () => {
        // 构建最终的S3路径（包含文件名）
        let finalS3Path;
        // 智能检查s3SubPath是否已经包含完整的文件路径
        const { isCompleteFilePath } = await import("../utils/S3PathUtils.js");
        if (s3SubPath && isCompleteFilePath(s3SubPath, fileName)) {
          finalS3Path = s3SubPath;
        } else if (s3SubPath && !s3SubPath.endsWith("/")) {
          finalS3Path = s3SubPath + "/" + fileName;
        } else {
          finalS3Path = s3SubPath + fileName;
        }

        console.log(`中止前端分片上传: Bucket=${this.config.bucket_name}, Key=${finalS3Path}, UploadId=${uploadId}`);

        // 中止分片上传
        const { AbortMultipartUploadCommand } = await import("@aws-sdk/client-s3");
        const abortCommand = new AbortMultipartUploadCommand({
          Bucket: this.config.bucket_name,
          Key: finalS3Path,
          UploadId: uploadId,
        });

        try {
          await this.s3Client.send(abortCommand);
        } catch (error) {
          const code = error?.Code || error?.name;
          if (code === "AccessDenied" || code === "NoSuchUpload") {
            const friendly = new Error(`当前存储不支持清除分片：${code}`);
            friendly.code = code;
            throw friendly;
          }
          throw error;
        }

        // 更新最后使用时间
        if (db && mount && mount.id) {
          await updateMountLastUsed(db, mount.id);
        }

        // 更新 upload_sessions 状态为 aborted（不影响主流程）
        if (db && mount?.storage_config_id && uploadId) {
          try {
            // 通过 UploadId 查找会话记录，再按指纹进行统一更新
            const sessionRow = await findUploadSessionByUploadUrl(db, {
              uploadUrl: uploadId,
              storageType: "S3",
              userIdOrInfo,
              userType,
            });

            if (sessionRow) {
              await updateUploadSessionStatusByFingerprint(db, {
                userIdOrInfo,
                userType,
                storageType: "S3",
                storageConfigId: sessionRow.storage_config_id,
                mountId: sessionRow.mount_id ?? mount.id ?? null,
                fsPath: sessionRow.fs_path,
                fileName: sessionRow.file_name,
                fileSize: sessionRow.file_size,
                status: "aborted",
                errorCode: null,
                errorMessage: "aborted_by_client",
              });
            } else {
              console.warn(
                "[S3UploadOperations] 未找到对应的 upload_sessions 记录（abort），uploadId:",
                uploadId,
              );
            }
          } catch (e) {
            console.warn(
              "[S3UploadOperations] 更新 upload_sessions 状态为 aborted 失败:",
              e,
            );
          }
        }

        return {
          success: true,
          message: "前端分片上传已中止",
        };
      },
      "中止前端分片上传",
      "中止前端分片上传失败"
    );
  }

  /**
   * 列出进行中的分片上传
   * @param {string} s3SubPath - S3子路径（可选，用于过滤特定文件的上传）
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 进行中的上传列表
   */
  async listMultipartUploads(s3SubPath = "", options = {}) {
    const { maxUploads = 1000, keyMarker, uploadIdMarker } = options;

    return handleFsError(
      async () => {
        const listCommand = new ListMultipartUploadsCommand({
          Bucket: this.config.bucket_name,
          Prefix: s3SubPath,
          MaxUploads: maxUploads,
          KeyMarker: keyMarker,
          UploadIdMarker: uploadIdMarker,
        });

        const response = await this.s3Client.send(listCommand);

        // 格式化响应数据
        const uploads = (response.Uploads || []).map((upload) => ({
          key: upload.Key,
          uploadId: upload.UploadId,
          initiated: upload.Initiated,
          storageClass: upload.StorageClass,
          owner: upload.Owner,
        }));

        return {
          success: true,
          uploads: uploads,
          bucket: response.Bucket,
          keyMarker: response.KeyMarker,
          uploadIdMarker: response.UploadIdMarker,
          nextKeyMarker: response.NextKeyMarker,
          nextUploadIdMarker: response.NextUploadIdMarker,
          maxUploads: response.MaxUploads,
          isTruncated: response.IsTruncated,
          prefix: response.Prefix,
        };
      },
      "列出进行中的分片上传",
      "列出进行中的分片上传失败"
    );
  }

  /**
   * 列出已上传的分片
   * @param {string} s3SubPath - S3子路径
   * @param {string} uploadId - 上传ID
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 已上传的分片列表
   */
  async listMultipartParts(s3SubPath, uploadId, options = {}) {
    const { maxParts = 1000, partNumberMarker } = options;

    try {
      const listCommand = new ListPartsCommand({
        Bucket: this.config.bucket_name,
        Key: s3SubPath,
        UploadId: uploadId,
        MaxParts: maxParts,
        PartNumberMarker: partNumberMarker,
      });

      const response = await this.s3Client.send(listCommand);

      // 格式化响应数据
      const parts = (response.Parts || []).map((part) => ({
        partNumber: part.PartNumber,
        lastModified: part.LastModified,
        etag: part.ETag,
        size: part.Size,
      }));

      return {
        success: true,
        parts: parts,
        bucket: response.Bucket,
        key: response.Key,
        uploadId: response.UploadId,
        partNumberMarker: response.PartNumberMarker,
        nextPartNumberMarker: response.NextPartNumberMarker,
        maxParts: response.MaxParts,
        isTruncated: response.IsTruncated,
        storageClass: response.StorageClass,
        owner: response.Owner,
      };
    } catch (error) {
      // 特殊处理NoSuchUpload错误 - 这是S3生命周期策略清理导致的正常业务场景
      if (error.name === "NoSuchUpload" || (error.message && error.message.includes("The specified multipart upload does not exist"))) {
        console.log(`[S3UploadOperations] NoSuchUpload - uploadId已被S3生命周期策略清理: ${uploadId}`);

        // 返回空分片列表，这是正常的业务场景，不应该报错
        return {
          success: true,
          parts: [],
          bucket: this.config.bucket_name,
          key: s3SubPath,
          uploadId: uploadId,
          partNumberMarker: partNumberMarker,
          nextPartNumberMarker: null,
          maxParts: maxParts,
          isTruncated: false,
          storageClass: null,
          owner: null,
          uploadNotFound: true,
          message: "多部分上传已被S3生命周期策略清理",
        };
      }

      // 其他错误继续抛出
      throw new S3DriverError("列出已上传的分片失败", { details: { cause: error?.message } });
    }
  }

  /**
   * 为现有上传刷新预签名URL
   * @param {string} s3SubPath - S3子路径
   * @param {string} uploadId - 现有的上传ID
   * @param {Array} partNumbers - 需要刷新URL的分片编号数组
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 刷新的预签名URL列表
   */
  async refreshMultipartUrls(s3SubPath, uploadId, partNumbers, options = {}) {
    const { expiresIn = 3600 } = options; // 默认1小时过期

    return handleFsError(
      async () => {
        const presignedUrls = [];

        // 为每个分片生成预签名URL
        for (const partNumber of partNumbers) {
          const command = new UploadPartCommand({
            Bucket: this.config.bucket_name,
            Key: s3SubPath,
            UploadId: uploadId,
            PartNumber: partNumber,
          });

          const presignedUrl = await getSignedUrl(this.s3Client, command, {
            expiresIn: expiresIn,
          });

          presignedUrls.push({
            partNumber: partNumber,
            url: presignedUrl,
          });
        }

        return {
          success: true,
          uploadId,
          strategy: "per_part_url",
          presignedUrls,
          expiresIn,
        };
      },
      "刷新分片上传预签名URL",
      "刷新分片上传预签名URL失败"
    );
  }
}
