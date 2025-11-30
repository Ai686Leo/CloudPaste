/**
 * S3存储驱动实现协调各个操作模块提供统一的存储接口
 * 实现所有能力接口
 */

import { BaseDriver } from "../../interfaces/capabilities/BaseDriver.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { ApiStatus } from "../../../constants/index.js";
import { createS3Client, generateCustomHostDirectUrl } from "./utils/s3Utils.js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { normalizeS3SubPath, isCompleteFilePath } from "./utils/S3PathUtils.js";
import { updateMountLastUsed, findMountPointByPath } from "../../fs/utils/MountResolver.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";
import { S3DriverError, AppError } from "../../../http/errors.js";

// 导入各个操作模块
import { S3FileOperations } from "./operations/S3FileOperations.js";
import { S3DirectoryOperations } from "./operations/S3DirectoryOperations.js";
import { S3BatchOperations } from "./operations/S3BatchOperations.js";
import { S3UploadOperations } from "./operations/S3UploadOperations.js";
import { S3SearchOperations } from "./operations/S3SearchOperations.js";

export class S3StorageDriver extends BaseDriver {
  /**
   * 构造函数
   * @param {Object} config - S3配置对象
   * @param {string} encryptionSecret - 加密密钥
   */
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "S3";
    this.encryptionSecret = encryptionSecret;
    this.s3Client = null;
    this.customHost = config.custom_host || null;

    // S3存储驱动支持所有能力
    this.capabilities = [
      CAPABILITIES.READER, // 读取能力：list, get, getInfo
      CAPABILITIES.WRITER, // 写入能力：put, mkdir, remove
      CAPABILITIES.DIRECT_LINK, // 直链能力（custom_host/预签名等）：generateDownloadUrl/generateUploadUrl
      CAPABILITIES.MULTIPART, // 分片上传能力：multipart upload
      CAPABILITIES.ATOMIC, // 原子操作能力：rename, copy
      CAPABILITIES.PROXY, // 代理能力：generateProxyUrl
    ];

    // 操作模块实例
    this.fileOps = null;
    this.directoryOps = null;
    this.batchOps = null;
    this.uploadOps = null;
    this.backendMultipartOps = null;
    this.searchOps = null;
  }

  /**
   * 将底层异常标准化为 S3DriverError（统一 error model）
   * 保留必要上下文，避免泄露敏感值
   */
  _asDriverError(error, message, extra = {}) {
    try {
      const base = {
        provider: this?.config?.provider_type,
        bucket: this?.config?.bucket_name,
        region: this?.config?.region,
        endpoint: this?.config?.endpoint_url,
      };
      return new S3DriverError(message, { details: { ...base, ...extra, cause: error?.message } });
    } catch (_) {
      return new S3DriverError(message);
    }
  }

  _rethrow(error, message, extra = {}) {
    if (error instanceof AppError) {
      return error;
    }
    return this._asDriverError(error, message, extra);
  }

  /**
   * 初始化S3存储驱动
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // 创建S3客户端
      this.s3Client = await createS3Client(this.config, this.encryptionSecret);

      // 初始化各个操作模块
      this.fileOps = new S3FileOperations(this.s3Client, this.config, this.encryptionSecret, this);
      this.directoryOps = new S3DirectoryOperations(this.s3Client, this.config, this.encryptionSecret);
      this.batchOps = new S3BatchOperations(this.s3Client, this.config, this.encryptionSecret);
      this.uploadOps = new S3UploadOperations(this.s3Client, this.config, this.encryptionSecret);
      // this.backendMultipartOps = new S3BackendMultipartOperations(this.s3Client, this.config, this.encryptionSecret); // 已废弃，使用前端分片上传
      this.searchOps = new S3SearchOperations(this.s3Client, this.config, this.encryptionSecret);

      this.initialized = true;
      console.log(`S3存储驱动初始化成功: ${this.config.name} (${this.config.provider_type})`);
    } catch (error) {
      console.error("S3存储驱动初始化失败:", error);
      throw this._rethrow(error, "S3存储驱动初始化失败");
    }
  }

  /**
   * 列出目录内容
   * @param {string} path - 目录路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 目录内容
   */
  async listDirectory(path, options = {}) {
    this._ensureInitialized();

    const { mount, subPath, db } = options;

    // 规范化S3子路径
    const s3SubPath = normalizeS3SubPath(subPath, true);

    // 更新挂载点的最后使用时间
    if (db && mount.id) {
      await updateMountLastUsed(db, mount.id);
    }

    try {
      // 委托给目录操作模块，传递所有选项参数
      return await this.directoryOps.listDirectory(s3SubPath, {
        mount,
        subPath, // 使用正确的子路径用于缓存键生成
        path,
        db,
        ...options,
      });
    } catch (error) {
      throw this._rethrow(error, "列出目录失败");
    }
  }

  /**
   * 获取文件信息
   * @param {string} path - 文件路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 文件信息
   */
  async getFileInfo(path, options = {}) {
    this._ensureInitialized();

    const { mount, subPath, db, userType, userId, request } = options;

    // 规范化S3子路径
    const s3SubPath = normalizeS3SubPath(subPath, false);

    // 更新挂载点的最后使用时间
    if (db && mount.id) {
      await updateMountLastUsed(db, mount.id);
    }

    // 特殊处理：当s3SubPath为空字符串时（访问挂载点根目录），直接作为目录处理，跳过文件检查
    // 因为S3对象Key不能为空字符串，所以空字符串永远不可能是有效的文件
    if (s3SubPath === "") {
      console.log(`getFileInfo - 检测到挂载点根目录访问，直接作为目录处理: ${path}`);
      return await this.directoryOps.getDirectoryInfo(s3SubPath, {
        mount,
        path,
      });
    }

    try {
      // 首先尝试作为文件获取信息
      return await this.fileOps.getFileInfo(s3SubPath, {
        mount,
        path,
        userType,
        userId,
        request,
        db,
      });
    } catch (error) {
      if (error.status === ApiStatus.NOT_FOUND) {
        // 如果文件不存在，尝试作为目录处理
        try {
          return await this.directoryOps.getDirectoryInfo(s3SubPath, {
            mount,
            path,
          });
        } catch (dirError) {
          // 如果目录也不存在，抛出原始错误
          throw this._rethrow(error, "获取资源信息失败");
        }
      }
      throw this._rethrow(error, "获取资源信息失败");
    }
  }

  /**
   * 下载文件
   * @param {string} path - 文件路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Response>} 文件内容响应
   */
  async downloadFile(path, options = {}) {
    this._ensureInitialized();

    const { mount, subPath, db, request } = options;

    // 规范化S3子路径
    const s3SubPath = normalizeS3SubPath(subPath, false);

    // 更新挂载点的最后使用时间（仅在有挂载点上下文时）
    if (db && mount && mount.id) {
      await updateMountLastUsed(db, mount.id);
    }

    // 提取文件名
    const fileName = path.split("/").filter(Boolean).pop() || "file";

    try {
      // 委托给文件操作模块
      return await this.fileOps.downloadFile(s3SubPath, fileName, request);
    } catch (error) {
      throw this._rethrow(error, "下载文件失败");
    }
  }

  /**
   * 统一上传入口（文件 / 流）
   * - 外部只调用此方法，内部根据数据类型选择流式或表单实现
   */
  async uploadFile(path, fileOrStream, options = {}) {
    this._ensureInitialized();

    const isNodeStream = fileOrStream && (typeof fileOrStream.pipe === "function" || fileOrStream.readable);
    const isWebStream = fileOrStream && typeof fileOrStream.getReader === "function";

    // 有 Stream 能力时优先走“流式上传”路径
    if (isNodeStream || isWebStream) {
      return await this.uploadStream(path, fileOrStream, options);
    }

    // 其它情况按“表单上传”（一次性完整缓冲后上传）处理
    return await this.uploadForm(path, fileOrStream, options);
  }

  /**
   * 内部流式上传实现
   */
  async uploadStream(path, stream, options = {}) {
    this._ensureInitialized();

    const { mount, subPath, db, userIdOrInfo, userType, filename, contentType, contentLength, uploadId } = options;

    const s3SubPath = normalizeS3SubPath(subPath, false);
    const s3Key = this._normalizeFilePath(s3SubPath, path, filename);

    // 统一交由 S3UploadOperations.uploadStream 使用 Upload 处理流式上传，
    // 包含自动的单请求/多分片选择和进度回调
    try {
      return await this.uploadOps.uploadStream(s3Key, /** @type {any} */ (stream), {
        mount,
        db,
        userIdOrInfo,
        userType,
        filename,
        contentType,
        contentLength,
        uploadId,
      });
    } catch (error) {
      throw this._rethrow(error, "流式上传失败");
    }
  }

  /**
   * 内部表单上传实现（一次性读入内存）
   */
  async uploadForm(path, fileOrData, options = {}) {
    this._ensureInitialized();

    const { mount, subPath, db, userIdOrInfo, userType, filename, contentType } = options;

    const s3SubPath = normalizeS3SubPath(subPath, false);
    const s3Key = this._normalizeFilePath(s3SubPath, path, filename);

    try {
      return await this.uploadOps.uploadForm(s3Key, /** @type {any} */ (fileOrData), {
        mount,
        db,
        userIdOrInfo,
        userType,
        filename,
        contentType,
      });
    } catch (error) {
      throw this._rethrow(error, "表单上传失败");
    }
  }

  /**
   * 创建目录
   * @param {string} path - 目录路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 创建结果
   */
  async createDirectory(path, options = {}) {
    this._ensureInitialized();

    const { mount, subPath, db } = options;

    // 规范化S3子路径
    const s3SubPath = normalizeS3SubPath(subPath, true);

    // 更新挂载点的最后使用时间
    if (db && mount.id) {
      await updateMountLastUsed(db, mount.id);
    }

    try {
      // 委托给目录操作模块
      return await this.directoryOps.createDirectory(s3SubPath, {
        mount,
        subPath,
        path,
      });
    } catch (error) {
      throw this._rethrow(error, "创建目录失败");
    }
  }

  /**
   * 重命名文件或目录
   * @param {string} oldPath - 原路径
   * @param {string} newPath - 新路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 重命名结果
   */
  async renameItem(oldPath, newPath, options = {}) {
    this._ensureInitialized();

    try {
      // 委托给批量操作模块
      return await this.batchOps.renameItem(oldPath, newPath, {
        ...options,
        findMountPointByPath,
      });
    } catch (error) {
      throw this._rethrow(error, "重命名失败");
    }
  }

  /**
   * 批量删除文件
   * @param {Array<string>} paths - 路径数组
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 批量删除结果
   */
  async batchRemoveItems(paths, options = {}) {
    this._ensureInitialized();

    try {
      // 委托给批量操作模块
      return await this.batchOps.batchRemoveItems(paths, {
        ...options,
        findMountPointByPath,
      });
    } catch (error) {
      throw this._rethrow(error, "批量删除失败");
    }
  }

  /**
   * 通过存储路径直接删除对象（storage-first 场景）
   * @param {string} storagePath - 对象 Key
   * @param {Object} options - 扩展选项（预留）
   * @returns {Promise<Object>} 删除结果
   */
  async deleteObjectByStoragePath(storagePath, options = {}) {
    this._ensureInitialized();

    try {
      const params = {
        Bucket: this.config.bucket_name,
        Key: storagePath,
      };
      const cmd = new DeleteObjectCommand(params);
      await this.s3Client.send(cmd);
      return { success: true };
    } catch (error) {
      throw this._rethrow(error, "删除对象失败");
    }
  }

  /**
   * 复制文件或目录
   * @param {string} sourcePath - 源路径
   * @param {string} targetPath - 目标路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 复制结果
   */
  async copyItem(sourcePath, targetPath, options = {}) {
    this._ensureInitialized();
    try {
      // 委托给批量操作模块
      return await this.batchOps.copyItem(sourcePath, targetPath, {
        ...options,
        findMountPointByPath,
      });
    } catch (error) {
      throw this._rethrow(error, "复制失败");
    }
  }

  /**
   * 批量复制文件
   * @param {Array<Object>} items - 复制项数组
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 批量复制结果
   */
  async batchCopyItems(items, options = {}) {
    this._ensureInitialized();
    try {
      // 委托给批量操作模块
      return await this.batchOps.batchCopyItems(items, {
        ...options,
        findMountPointByPath,
      });
    } catch (error) {
      throw this._rethrow(error, "批量复制失败");
    }
  }

  /**
   * 生成预签名下载URL
   * @param {string} path - 文件路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 预签名URL信息
   */
  async generateDownloadUrl(path, options = {}) {
    this._ensureInitialized();

    const { subPath } = options;
    const s3SubPath = normalizeS3SubPath(subPath, false);

    try {
      const { expiresIn, forceDownload, userType, userId, mount } = options;
      return await this.fileOps.generateDownloadUrl(s3SubPath, {
        expiresIn,
        forceDownload,
        userType,
        userId,
        mount,
      });
    } catch (error) {
      throw this._rethrow(error, "生成下载URL失败");
    }
  }

  /**
   * 上游 HTTP 能力：为 S3 生成可由反向代理/Worker 直接访问的上游请求信息
   * - 基于现有 generateDownloadUrl 生成预签名 URL
   * - headers 通常为空或仅包含补充标头
   * @param {string} path - 文件路径（FS 视图路径或 storage_path）
   * @param {Object} [options] - 选项参数
   * @returns {Promise<{ url: string, headers: Record<string,string[]> }>}
   */
  async generateUpstreamRequest(path, options = {}) {
    this._ensureInitialized();

    const { subPath, expiresIn, forceDownload = true, userType, userId, mount } = options;

    // 对于 FS 场景优先使用 subPath（挂载内相对路径），storage-first 场景则使用传入的 path 作为对象 Key
    const effectiveSubPath = subPath != null ? subPath : path;

    const downloadInfo = await this.generateDownloadUrl(effectiveSubPath, {
      subPath: effectiveSubPath,
      expiresIn,
      forceDownload,
      userType,
      userId,
      mount,
    });

    const url = downloadInfo?.url || null;

    /** @type {Record<string,string[]>} */
    const headers = {};

    return {
      url,
      headers,
    };
  }

  /**
   * 生成预签名上传URL
   * @param {string} path - 目标路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 预签名URL信息
   */
  async generateUploadUrl(path, options = {}) {
    this._ensureInitialized();

    const { mount, subPath, db } = options;
    // 对于 FS 视图，使用 subPath 规范化；对于 ObjectStore 等 storage-first 场景，直接使用传入的 path 作为对象 Key
    const s3SubPath = subPath != null ? normalizeS3SubPath(subPath, false) : path;

    if (db && mount?.id) {
      await updateMountLastUsed(db, mount.id);
    }

    try {
      const { fileName, fileSize, expiresIn } = options;
      return await this.uploadOps.generateUploadUrl(s3SubPath, {
        fileName,
        fileSize,
        expiresIn,
      });
    } catch (error) {
      throw this._rethrow(error, "生成上传URL失败");
    }
  }

  /**
   * 处理上传完成后的逻辑（用于预签名上传后端对齐）
   * @param {string} path - 目标路径
   * @param {Object} options - 选项 { mount, subPath, db, fileName, fileSize, contentType, etag }
   * @returns {Promise<Object>} 处理结果
   */
  async handleUploadComplete(path, options = {}) {
    this._ensureInitialized();

    const { mount, subPath, db, fileName, fileSize, contentType, etag } = options;

    // 规范化S3子路径
    const s3SubPath = normalizeS3SubPath(subPath, false);

    try {
      const result = await this.uploadOps.handleUploadComplete(s3SubPath, {
        mount,
        db,
        fileName,
        fileSize,
        contentType,
        etag,
      });

      // 更新挂载点的最后使用时间
      if (db && mount?.id) {
        await updateMountLastUsed(db, mount.id);
      }

      return result;
    } catch (error) {
      throw this._rethrow(error, "处理上传完成失败");
    }
  }

  /**
   * 更新文件内容
   * @param {string} path - 文件路径
   * @param {string} content - 新内容
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 更新结果
   */
  async updateFile(path, content, options = {}) {
    this._ensureInitialized();

    const { mount, subPath, db } = options;

    // 规范化S3子路径
    const s3SubPath = normalizeS3SubPath(subPath, false);

    // 提取文件名
    const fileName = path.split("/").filter(Boolean).pop() || "file";

    // 委托给文件操作模块
    const result = await this.fileOps.updateFile(s3SubPath, content, {
      fileName,
    });

    // 更新挂载点的最后使用时间
    if (db && mount.id) {
      await updateMountLastUsed(db, mount.id);
    }

    return result;
  }

  /**
   * 处理跨存储复制
   * @param {string} sourcePath - 源路径
   * @param {string} targetPath - 目标路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 跨存储复制结果
   */
  async handleCrossStorageCopy(sourcePath, targetPath, options = {}) {
    this._ensureInitialized();
    try {
      // 委托给批量操作模块
      return await this.batchOps.handleCrossStorageCopy(options.db, sourcePath, targetPath, options.userIdOrInfo, options.userType);
    } catch (error) {
      throw this._rethrow(error, "跨存储复制失败");
    }
  }

  /**
   * 检查路径是否存在
   * @param {string} path - 路径
   * @param {Object} options - 选项参数
   * @returns {Promise<boolean>} 是否存在
   */
  async exists(path, options = {}) {
    this._ensureInitialized();

    const { subPath } = options;

    // 规范化S3子路径
    const s3SubPath = normalizeS3SubPath(subPath, false);

    try {
      // 委托给文件操作模块检查存在性
      return await this.fileOps.exists(s3SubPath);
    } catch (error) {
      throw this._rethrow(error, "存在性检查失败");
    }
  }

  /**
   * 搜索文件
   * @param {string} query - 搜索查询
   * @param {Object} options - 搜索选项
   * @param {Object} options.mount - 挂载点对象
   * @param {string} options.searchPath - 搜索路径范围
   * @param {number} options.maxResults - 最大结果数量
   * @param {D1Database} options.db - 数据库实例
   * @returns {Promise<Array>} 搜索结果数组
   */
  async search(query, options = {}) {
    this._ensureInitialized();
    try {
      // 委托给搜索操作模块
      return await this.searchOps.searchInMount(query, options);
    } catch (error) {
      throw this._rethrow(error, "搜索失败");
    }
  }

  /**
   * 获取存储统计信息
   * @returns {Promise<Object>} 统计信息
   */
  async getStats() {
    this._ensureInitialized();

    return {
      type: this.type,
      provider: this.config.provider_type,
      bucket: this.config.bucket_name,
      endpoint: this.config.endpoint_url,
      region: this.config.region || "auto",
      initialized: this.initialized,
    };
  }

  /**
   * 清理资源
   * @returns {Promise<void>}
   */
  async cleanup() {
    this.s3Client = null;
    this.fileOps = null;
    this.directoryOps = null;
    this.batchOps = null;
    this.uploadOps = null;
    this.initialized = false;
    console.log(`S3存储驱动已清理: ${this.config.name}`);
  }

  /**
   * 初始化前端分片上传（生成预签名URL列表）
   * @param {string} subPath - 子路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 初始化结果
   */
  async initializeFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();

    const { fileName, fileSize, partSize = 5 * 1024 * 1024, partCount, mount, db, userIdOrInfo, userType } = options;

    // 规范化S3子路径
    const s3SubPath = normalizeS3SubPath(subPath, false);

    try {
      // 委托给上传操作模块
      return await this.uploadOps.initializeFrontendMultipartUpload(s3SubPath, {
        fileName,
        fileSize,
        partSize,
        partCount,
        mount,
        db,
        userIdOrInfo,
        userType,
      });
    } catch (error) {
      throw this._rethrow(error, "初始化分片上传失败");
    }
  }

  /**
   * 完成前端分片上传
   * @param {string} subPath - 子路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 完成结果
   */
  async completeFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();

    const { uploadId, parts, fileName, fileSize, mount, db, userIdOrInfo, userType } = options;

    // 规范化S3子路径
    const s3SubPath = normalizeS3SubPath(subPath, false);

    try {
      // 委托给上传操作模块
      return await this.uploadOps.completeFrontendMultipartUpload(s3SubPath, {
        uploadId,
        parts,
        fileName,
        fileSize,
        mount,
        db,
        userIdOrInfo,
        userType,
      });
    } catch (error) {
      throw this._rethrow(error, "完成分片上传失败");
    }
  }

  /**
   * 中止前端分片上传
   * @param {string} subPath - 子路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 中止结果
   */
  async abortFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();

    const { uploadId, fileName, mount, db, userIdOrInfo, userType } = options;

    // 规范化S3子路径
    const s3SubPath = normalizeS3SubPath(subPath, false);

    try {
      // 委托给上传操作模块
      return await this.uploadOps.abortFrontendMultipartUpload(s3SubPath, {
        uploadId,
        fileName,
        mount,
        db,
        userIdOrInfo,
        userType,
      });
    } catch (error) {
      throw this._rethrow(error, "中止分片上传失败");
    }
  }

  /**
   * 列出进行中的分片上传
   * @param {string} subPath - 子路径（可选，用于过滤特定文件的上传）
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 进行中的上传列表
   */
  async listMultipartUploads(subPath = "", options = {}) {
    this._ensureInitialized();

    const { mount, db } = options;

    // 规范化S3子路径
    const s3SubPath = normalizeS3SubPath(subPath, false);

    // 更新挂载点的最后使用时间
    if (db && mount && mount.id) {
      await updateMountLastUsed(db, mount.id);
    }

    try {
      // 委托给上传操作模块
      return await this.uploadOps.listMultipartUploads(s3SubPath, options);
    } catch (error) {
      throw this._rethrow(error, "列出进行中的分片上传失败");
    }
  }

  /**
   * 列出已上传的分片
   * @param {string} subPath - 子路径
   * @param {string} uploadId - 上传ID
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 已上传的分片列表
   */
  async listMultipartParts(subPath, uploadId, options = {}) {
    this._ensureInitialized();

    const { mount, db } = options;

    // 规范化S3子路径
    const s3SubPath = normalizeS3SubPath(subPath, false);

    // 更新挂载点的最后使用时间
    if (db && mount && mount.id) {
      await updateMountLastUsed(db, mount.id);
    }

    try {
      // 委托给上传操作模块
      return await this.uploadOps.listMultipartParts(s3SubPath, uploadId, options);
    } catch (error) {
      throw this._rethrow(error, "列出已上传分片失败");
    }
  }

  /**
   * 为现有上传刷新预签名URL
   * @param {string} subPath - 子路径
   * @param {string} uploadId - 现有的上传ID
   * @param {Array} partNumbers - 需要刷新URL的分片编号数组
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 刷新的预签名URL列表
   */
  async refreshMultipartUrls(subPath, uploadId, partNumbers, options = {}) {
    this._ensureInitialized();

    const { mount, db } = options;

    // 规范化S3子路径
    const s3SubPath = normalizeS3SubPath(subPath, false);

    // 更新挂载点的最后使用时间
    if (db && mount && mount.id) {
      await updateMountLastUsed(db, mount.id);
    }

    try {
      // 委托给上传操作模块
      return await this.uploadOps.refreshMultipartUrls(s3SubPath, uploadId, partNumbers, options);
    } catch (error) {
      throw this._rethrow(error, "刷新分片URL失败");
    }
  }

  /**
   * 规范化文件路径（用于后端分片上传）
   * @param {string} subPath - 子路径
   * @param {string} path - 完整路径，用于提取文件名
   * @param {string} customFilename - 自定义文件名（可选）
   * @returns {string} 规范化后的S3路径
   * @private
   */
  _normalizeFilePath(subPath, path, customFilename) {
    // 规范化S3子路径 (不添加斜杠，因为是文件)
    let s3SubPath = normalizeS3SubPath(subPath, false);

    // 获取文件名，优先使用自定义文件名，其次从路径中提取
    const fileName = customFilename || path.split("/").filter(Boolean).pop() || "unnamed_file";

    // 智能检查s3SubPath是否已经包含完整的文件路径
    if (s3SubPath && isCompleteFilePath(s3SubPath, fileName)) {
      // 添加root_prefix（如果有）
      const rootPrefix = this.config.root_prefix ? (this.config.root_prefix.endsWith("/") ? this.config.root_prefix : this.config.root_prefix + "/") : "";
      return rootPrefix + s3SubPath;
    }

    // 否则，s3SubPath是目录路径，需要拼接文件名
    // 与目录列表逻辑保持一致，只使用root_prefix
    const rootPrefix = this.config.root_prefix ? (this.config.root_prefix.endsWith("/") ? this.config.root_prefix : this.config.root_prefix + "/") : "";

    let fullPrefix = rootPrefix;

    // 添加s3SubPath (如果不是空)
    if (s3SubPath && s3SubPath !== "/") {
      fullPrefix += s3SubPath;
    }

    // 确保前缀总是以斜杠结尾 (如果不为空)
    if (fullPrefix && !fullPrefix.endsWith("/")) {
      fullPrefix += "/";
    }

    // 构建最终路径
    return fullPrefix + fileName;
  }

  /**
   * 生成代理URL（ProxyCapable接口实现）
   * @param {string} path - 文件路径
   * @param {Object} options - 选项参数
   * @param {Object} options.mount - 挂载点信息
   * @param {Request} options.request - 请求对象
   * @param {boolean} options.download - 是否为下载模式
   * @param {Object} options.db - 数据库连接对象
   * @returns {Promise<Object>} 代理URL对象
   */
  async generateProxyUrl(path, options = {}) {
    const { request, download = false, channel = "web" } = options;

    // 驱动层仅负责根据路径构造基础代理URL，不再做签名与策略判断
    const proxyUrl = buildFullProxyUrl(request, path, download);

    return {
      url: proxyUrl,
      type: "proxy",
      channel,
    };
  }

  /**
   * 检查是否支持代理模式（ProxyCapable接口实现）
   * @param {Object} mount - 挂载点信息
   * @returns {boolean} 是否支持代理模式
   */
  supportsProxyMode() {
    return true;
  }

  /**
   * 获取代理配置（ProxyCapable接口实现）
   * @param {Object} mount - 挂载点信息
   * @returns {Object} 代理配置对象
   */
  getProxyConfig() {
    return {
      enabled: this.supportsProxyMode(),
    };
  }

  /**
   * 确保驱动已初始化
   * @private
   */
  _ensureInitialized() {
    if (!this.initialized) {
      throw new S3DriverError("存储驱动未初始化");
    }
  }
}
