/**
 * 文件系统统一抽象层
 * 同时服务于网页端API和WebDAV协议
 * 内部根据存储能力选择最优实现
 */

import { ValidationError, AuthorizationError, DriverError } from "../../http/errors.js";
import { ApiStatus } from "../../constants/index.js";
import { CAPABILITIES } from "../interfaces/capabilities/index.js";
import { listDirectory as featureListDirectory, getFileInfo as featureGetFileInfo, downloadFile as featureDownloadFile, exists as featureExists } from "./features/read.js";
import { generatePresignedUrl as featureGeneratePresignedUrl, commitPresignedUpload as featureCommitPresignedUpload } from "./features/presign.js";
import { uploadFile as featureUploadFile, uploadStream as featureUploadStream, uploadDirect as featureUploadDirect, createDirectory as featureCreateDirectory, updateFile as featureUpdateFile } from "./features/write.js";
import { renameItem as featureRenameItem, copyItem as featureCopyItem, batchRemoveItems as featureBatchRemoveItems, batchCopyItems as featureBatchCopyItems, handleCrossStorageCopy as featureHandleCrossStorageCopy, commitCrossStorageCopy as featureCommitCrossStorageCopy } from "./features/ops.js";
import {
  initializeFrontendMultipartUpload as featureInitMultipart,
  completeFrontendMultipartUpload as featureCompleteMultipart,
  abortFrontendMultipartUpload as featureAbortMultipart,
  listMultipartUploads as featureListMultipartUploads,
  listMultipartParts as featureListMultipartParts,
  refreshMultipartUrls as featureRefreshMultipartUrls,
  abortBackendMultipartUpload as featureAbortBackendMultipart,
} from "./features/multipart.js";
import cacheBus, { CACHE_EVENTS } from "../../cache/cacheBus.js";
import { ensureRepositoryFactory } from "../../utils/repositories.js";
import { getAccessibleMountsForUser } from "../../security/helpers/access.js";
import { UserType } from "../../constants/index.js";
import { FsMetaService } from "../../services/fsMetaService.js";

export class FileSystem {
  /**
   * 构造函数
   * @param {MountManager} mountManager - 挂载管理器实例
   */
  constructor(mountManager) {
    this.mountManager = mountManager;
    this.repositoryFactory = mountManager?.repositoryFactory ?? null;
  }

  /**
   * 列出目录内容
   * @param {string} path - 目录路径
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @param {Object} options - 选项参数
   * @param {boolean} options.refresh - 是否强制刷新，跳过缓存
   * @returns {Promise<Object>} 目录内容
   */
  async listDirectory(path, userIdOrInfo, userType, options = {}) {
    const baseResult = await featureListDirectory(this, path, userIdOrInfo, userType, options);

    try {
      const db = this.mountManager?.db;
      if (!db) {
        return baseResult;
      }

      const metaService = new FsMetaService(db, this.repositoryFactory);
      const resolvedMeta = await metaService.resolveMetaForPath(path);

      // 仅向前端暴露与展示相关的 meta 字段，避免泄露路径密码
      const safeMeta =
        resolvedMeta && (resolvedMeta.headerMarkdown || resolvedMeta.footerMarkdown || (resolvedMeta.hidePatterns?.length ?? 0) > 0)
          ? {
              headerMarkdown: resolvedMeta.headerMarkdown ?? null,
              footerMarkdown: resolvedMeta.footerMarkdown ?? null,
              hidePatterns: resolvedMeta.hidePatterns ?? [],
            }
          : null;

      return {
        ...baseResult,
        meta: safeMeta,
      };
    } catch (error) {
      console.warn("解析 FS Meta 失败，将返回基础目录结果：", error);
      return baseResult;
    }
  }

  /**
   * 获取文件信息
   * @param {string} path - 文件路径
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @param {Request} request - 请求对象（用于构建完整URL）
   * @returns {Promise<Object>} 文件信息
   */
  async getFileInfo(path, userIdOrInfo, userType, request = null) {
    return await featureGetFileInfo(this, path, userIdOrInfo, userType, request);
  }

  /**
   * 下载文件
   * @param {string} path - 文件路径
   * @param {string} fileName - 文件名
   * @param {Request} request - 请求对象
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @returns {Promise<Response>} 文件响应
   */
  async downloadFile(path, fileName, request, userIdOrInfo, userType) {
    return await featureDownloadFile(this, path, fileName, request, userIdOrInfo, userType);
  }

  /**
   * 上传文件
   * @param {string} path - 目标路径
   * @param {File} file - 文件对象
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 上传结果
   */
  async uploadFile(path, file, userIdOrInfo, userType, options = {}) {
    return await featureUploadFile(this, path, file, userIdOrInfo, userType, options);
  }

  /**
   * 上传流式数据
   * @param {string} path - 目标路径
   * @param {ReadableStream} stream - 数据流
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @param {Object} options - 选项参数
   * @param {string} options.filename - 文件名
   * @param {string} options.contentType - 内容类型
   * @param {number} options.contentLength - 内容长度
   * @param {boolean} options.useMultipart - 是否使用分片上传
   * @returns {Promise<Object>} 上传结果
   */
  async uploadStream(path, stream, userIdOrInfo, userType, options = {}) {
    return await featureUploadStream(this, path, stream, userIdOrInfo, userType, options);
  }

  /**
   * 直传二进制数据到存储（与文档的 upload-direct 对齐）
   * @param {string} path - 目标目录或完整文件路径
   * @param {ReadableStream|ArrayBuffer|Uint8Array} body - 原始请求体或内存数据
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @param {Object} options - 选项
   * @param {string} options.filename - 文件名（当 path 为目录时必需）
   * @param {string} options.contentType - 内容类型
   * @param {number} options.contentLength - 内容长度
   * @returns {Promise<Object>} 上传结果
   */
  async uploadDirect(path, body, userIdOrInfo, userType, options = {}) {
    return await featureUploadDirect(this, path, body, userIdOrInfo, userType, options);
  }

  /**
   * 预签名上传完成后的处理（缓存失效/目录时间更新）
   * @param {string} path - 目标目录或完整文件路径
   * @param {string} filename - 文件名（当 path 为目录时必需）
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @param {Object} options - 选项 { fileSize, etag, contentType }
   * @returns {Promise<Object>} 处理结果
   */
  async commitPresignedUpload(path, filename, userIdOrInfo, userType, options = {}) {
    return await featureCommitPresignedUpload(this, path, filename, userIdOrInfo, userType, options);
  }

  /**
   * 创建目录
   * @param {string} path - 目录路径
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 创建结果
   */
  async createDirectory(path, userIdOrInfo, userType) {
    return await featureCreateDirectory(this, path, userIdOrInfo, userType);
  }

  /**
   * 重命名文件或目录
   * @param {string} oldPath - 原路径
   * @param {string} newPath - 新路径
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @returns {Promise<Object>} 重命名结果
   */
  async renameItem(oldPath, newPath, userIdOrInfo, userType) {
    return await featureRenameItem(this, oldPath, newPath, userIdOrInfo, userType);
  }

  /**
   * 复制文件或目录
   * @param {string} sourcePath - 源路径
   * @param {string} targetPath - 目标路径
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 复制结果
   */
  async copyItem(sourcePath, targetPath, userIdOrInfo, userType, options = {}) {
    return await featureCopyItem(this, sourcePath, targetPath, userIdOrInfo, userType, options);
  }

  /**
   * 批量删除文件和目录
   * @param {Array<string>} paths - 路径数组
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @returns {Promise<Object>} 批量删除结果
   */
  async batchRemoveItems(paths, userIdOrInfo, userType) {
    return await featureBatchRemoveItems(this, paths, userIdOrInfo, userType);
  }

  /**
   * 批量复制文件和目录
   * @param {Array<Object>} items - 复制项数组，每项包含sourcePath和targetPath
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @returns {Promise<Object>} 批量复制结果
   */
  async batchCopyItems(items, userIdOrInfo, userType) {
    return await featureBatchCopyItems(this, items, userIdOrInfo, userType);
  }

  /**
   * 生成预签名URL
   * @param {string} path - 文件路径
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 预签名URL信息
   */
  async generatePresignedUrl(path, userIdOrInfo, userType, options = {}) {
    return await featureGeneratePresignedUrl(this, path, userIdOrInfo, userType, options);
  }

  /**
   * 初始化前端分片上传（生成预签名URL列表）
   * @param {string} path - 完整路径
   * @param {string} fileName - 文件名
   * @param {number} fileSize - 文件大小
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @param {number} partSize - 分片大小，默认5MB
   * @param {number} partCount - 分片数量
   * @returns {Promise<Object>} 初始化结果
   */
  async initializeFrontendMultipartUpload(path, fileName, fileSize, userIdOrInfo, userType, partSize = 5 * 1024 * 1024, partCount) {
    return await featureInitMultipart(this, path, fileName, fileSize, userIdOrInfo, userType, partSize, partCount);
  }

  /**
   * 完成前端分片上传
   * @param {string} path - 完整路径
   * @param {string} uploadId - 上传ID
   * @param {Array} parts - 分片信息
   * @param {string} fileName - 文件名
   * @param {number} fileSize - 文件大小
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @returns {Promise<Object>} 完成结果
   */
  async completeFrontendMultipartUpload(path, uploadId, parts, fileName, fileSize, userIdOrInfo, userType) {
    return await featureCompleteMultipart(this, path, uploadId, parts, fileName, fileSize, userIdOrInfo, userType);
  }

  /**
   * 中止前端分片上传
   * @param {string} path - 完整路径
   * @param {string} uploadId - 上传ID
   * @param {string} fileName - 文件名
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @returns {Promise<Object>} 中止结果
   */
  async abortFrontendMultipartUpload(path, uploadId, fileName, userIdOrInfo, userType) {
    return await featureAbortMultipart(this, path, uploadId, fileName, userIdOrInfo, userType);
  }

  /**
   * 列出进行中的分片上传
   * @param {string} path - 目标路径（可选，用于过滤特定文件的上传）
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 进行中的上传列表
   */
  async listMultipartUploads(path = "", userIdOrInfo, userType, options = {}) {
    return await featureListMultipartUploads(this, path, userIdOrInfo, userType, options);
  }

  /**
   * 列出已上传的分片
   * @param {string} path - 目标路径
   * @param {string} uploadId - 上传ID
   * @param {string} fileName - 文件名
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 已上传的分片列表
   */
  async listMultipartParts(path, uploadId, fileName, userIdOrInfo, userType, options = {}) {
    return await featureListMultipartParts(this, path, uploadId, fileName, userIdOrInfo, userType, options);
  }

  /**
   * 为现有上传刷新预签名URL
   * @param {string} path - 目标路径
   * @param {string} uploadId - 现有的上传ID
   * @param {Array} partNumbers - 需要刷新URL的分片编号数组
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 刷新的预签名URL列表
   */
  async refreshMultipartUrls(path, uploadId, partNumbers, userIdOrInfo, userType, options = {}) {
    return await featureRefreshMultipartUrls(this, path, uploadId, partNumbers, userIdOrInfo, userType, options);
  }

  // /**
  //  * 初始化后端分片上传 - 已废弃，项目使用前端分片上传
  //  * @deprecated 使用前端分片上传 initializeFrontendMultipartUpload 替代
  //  * @param {string} path - 目标路径
  //  * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
  //  * @param {string} userType - 用户类型
  //  * @param {string} contentType - 内容类型
  //  * @param {number} fileSize - 文件大小
  //  * @param {string} filename - 文件名
  //  * @returns {Promise<Object>} 初始化结果
  //  */
  // async initializeBackendMultipartUpload(path, userIdOrInfo, userType, contentType, fileSize, filename) {
  //   const { driver, mount, subPath } = await this.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  //   if (!driver.hasCapability(CAPABILITIES.MULTIPART)) {
  //     throw new DriverError(`存储驱动 ${driver.getType()} 不支持分片上传`, {
  //       status: ApiStatus.NOT_IMPLEMENTED,
  //       expose: true,
  //     });
  //   }

  //   return await driver.initializeBackendMultipartUpload(path, {
  //     mount,
  //     subPath,
  //     db: this.mountManager.db,
  //     contentType,
  //     fileSize,
  //     filename,
  //   });
  // }

  // /**
  //  * 上传后端分片 - 已废弃，项目使用前端分片上传
  //  * @deprecated 使用前端分片上传替代
  //  * @param {string} path - 目标路径
  //  * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
  //  * @param {string} userType - 用户类型
  //  * @param {string} uploadId - 上传ID
  //  * @param {number} partNumber - 分片编号
  //  * @param {ArrayBuffer} partData - 分片数据
  //  * @param {string} s3Key - S3键（可选）
  //  * @returns {Promise<Object>} 上传结果
  //  */
  // async uploadBackendPart(path, userIdOrInfo, userType, uploadId, partNumber, partData, s3Key = null) {
  //   const { driver, mount, subPath } = await this.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  //   if (!driver.hasCapability(CAPABILITIES.MULTIPART)) {
  //     throw new DriverError(`存储驱动 ${driver.getType()} 不支持分片上传`, {
  //       status: ApiStatus.NOT_IMPLEMENTED,
  //       expose: true,
  //     });
  //   }

  //   return await driver.uploadBackendPart(path, {
  //     mount,
  //     subPath,
  //     db: this.mountManager.db,
  //     uploadId,
  //     partNumber,
  //     partData,
  //     s3Key,
  //   });
  // }

  // /**
  //  * 完成后端分片上传 - 已废弃，项目使用前端分片上传
  //  * @deprecated 使用前端分片上传 completeFrontendMultipartUpload 替代
  //  * @param {string} path - 目标路径
  //  * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
  //  * @param {string} userType - 用户类型
  //  * @param {string} uploadId - 上传ID
  //  * @param {Array} parts - 分片信息
  //  * @param {string} contentType - 内容类型
  //  * @param {number} fileSize - 文件大小
  //  * @param {string} s3Key - S3键（可选）
  //  * @returns {Promise<Object>} 完成结果
  //  */
  // async completeBackendMultipartUpload(path, userIdOrInfo, userType, uploadId, parts, contentType, fileSize, s3Key = null) {
  //   const { driver, mount, subPath } = await this.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  //   if (!driver.hasCapability(CAPABILITIES.MULTIPART)) {
  //     throw new DriverError(`存储驱动 ${driver.getType()} 不支持分片上传`, {
  //       status: ApiStatus.NOT_IMPLEMENTED,
  //       expose: true,
  //     });
  //   }

  //   return await driver.completeBackendMultipartUpload(path, {
  //     mount,
  //     subPath,
  //     db: this.mountManager.db,
  //     uploadId,
  //     parts,
  //     contentType,
  //     fileSize,
  //     userIdOrInfo,
  //     userType,
  //     s3Key,
  //   });
  // }

  /**
   * 中止后端分片上传
   * @param {string} path - 目标路径
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @param {string} uploadId - 上传ID
   * @param {string} s3Key - S3键（可选）
   * @returns {Promise<Object>} 中止结果
   */
  async abortBackendMultipartUpload(path, userIdOrInfo, userType, uploadId, s3Key = null) {
    return await featureAbortBackendMultipart(this, path, userIdOrInfo, userType, uploadId, s3Key);
  }

  /**
   * 检查文件或目录是否存在
   * @param {string} path - 文件或目录路径
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @returns {Promise<boolean>} 是否存在
   */
  async exists(path, userIdOrInfo, userType) {
    return await featureExists(this, path, userIdOrInfo, userType);
  }

  /**
   * 更新文件内容
   * @param {string} path - 文件路径
   * @param {string} content - 新内容
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @returns {Promise<Object>} 更新结果
   */
  async updateFile(path, content, userIdOrInfo, userType) {
    return await featureUpdateFile(this, path, content, userIdOrInfo, userType);
  }

  /**
   * 跨存储复制文件
   * @param {string} sourcePath - 源路径
   * @param {string} targetPath - 目标路径
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @returns {Promise<Object>} 跨存储复制结果
   */
  async handleCrossStorageCopy(sourcePath, targetPath, userIdOrInfo, userType) {
    return await featureHandleCrossStorageCopy(this, sourcePath, targetPath, userIdOrInfo, userType);
  }

  /**
   * 搜索文件
   * @param {string} query - 搜索查询
   * @param {Object} searchParams - 搜索参数
   * @param {string} searchParams.scope - 搜索范围 ('global', 'mount', 'directory')
   * @param {string} searchParams.mountId - 挂载点ID（当scope为'mount'时）
   * @param {string} searchParams.path - 搜索路径（当scope为'directory'时）
   * @param {number} searchParams.limit - 结果限制数量，默认50
   * @param {number} searchParams.offset - 结果偏移量，默认0
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @param {Array<Object>} accessibleMounts - 可访问挂载点列表（可选，未提供则内部查询）
   * @returns {Promise<Object>} 搜索结果
   */
  async searchFiles(query, searchParams, userIdOrInfo, userType, accessibleMounts = null) {
    const { scope = "global", mountId, path, limit = 50, offset = 0 } = searchParams;

    // 参数验证
    if (!query || query.trim().length < 2) {
      throw new ValidationError("搜索查询至少需要2个字符");
    }

    // 验证搜索范围
    if (!["global", "mount", "directory"].includes(scope)) {
      throw new ValidationError("无效的搜索范围");
    }

    // 验证分页参数
    if (limit < 1 || limit > 200) {
      throw new ValidationError("limit参数必须在1-200之间");
    }

    if (offset < 0) {
      throw new ValidationError("offset参数不能为负数");
    }

    // 检查搜索缓存
    const { searchCacheManager } = await import("../../cache/SearchCache.js");
    const cachedResult = searchCacheManager.get(query, searchParams, userType, userIdOrInfo);
    if (cachedResult) {
      console.log(`搜索缓存命中 - 查询: ${query}, 用户类型: ${userType}`);
      return cachedResult;
    }

    // 获取可访问的挂载点 - 为安全起见，这里也做兜底
    let resolvedMounts = accessibleMounts;
    if (!resolvedMounts) {
      try {
        if (userType === UserType.ADMIN) {
          const factory = this.repositoryFactory ?? ensureRepositoryFactory(this.mountManager.db);
          const mountRepository = factory.getMountRepository();
          resolvedMounts = await mountRepository.findAll(false); // 管理员：全部活跃挂载
        } else if (userType === UserType.API_KEY) {
          // API密钥用户：严格限制在其可访问挂载集合内
          const factory = this.repositoryFactory ?? ensureRepositoryFactory(this.mountManager.db);
          resolvedMounts = await getAccessibleMountsForUser(this.mountManager.db, userIdOrInfo, userType, factory);
        } else {
          resolvedMounts = [];
        }
      } catch (error) {
        throw new DriverError("获取可访问挂载失败");
      }
    }

    if (!resolvedMounts || resolvedMounts.length === 0) {
      return {
        results: [],
        total: 0,
        hasMore: false,
        searchParams: searchParams,
      };
    }

    // 根据搜索范围过滤挂载点
    let targetMounts = resolvedMounts;
    if ((scope === "mount" || scope === "directory") && mountId) {
      targetMounts = resolvedMounts.filter((mount) => mount.id === mountId);
      if (targetMounts.length === 0) {
        throw new AuthorizationError("没有权限访问指定的挂载点");
      }
    }

    // 并行搜索各个挂载点
    const searchPromises = targetMounts.map(async (mount) => {
      try {
        const driver = await this.mountManager.getDriver(mount);

        // 检查驱动是否支持搜索（通过ReaderCapable）
        if (!driver.hasCapability(CAPABILITIES.READER)) {
          return [];
        }

        return await driver.search(query, {
          mount,
          searchPath: scope === "directory" ? path : null,
          maxResults: 1000,
          db: this.mountManager.db,
        });
      } catch (error) {
        console.warn(`挂载点 ${mount.id} 搜索失败:`, error);
        return [];
      }
    });

    const mountResults = await Promise.allSettled(searchPromises);

    // 聚合搜索结果
    const allResults = [];
    for (const result of mountResults) {
      if (result.status === "fulfilled" && result.value) {
        allResults.push(...result.value);
      }
    }

    // 排序和分页
    const { S3SearchOperations } = await import("../drivers/s3/operations/S3SearchOperations.js");
    const sortedResults = S3SearchOperations.sortSearchResults(allResults, query);
    const total = sortedResults.length;
    const paginatedResults = sortedResults.slice(offset, offset + limit);

    const searchResult = {
      results: paginatedResults,
      total: total,
      hasMore: offset + limit < total,
      searchParams: searchParams,
      mountsSearched: targetMounts.length,
    };

    // 缓存搜索结果（仅当结果不为空时缓存）
    if (total > 0) {
      const mountIds = targetMounts.map((mount) => mount.id).filter(Boolean);
      searchCacheManager.set(query, searchParams, userType, userIdOrInfo, searchResult, 300, { mountIds }); // 5分钟缓存
      console.log(`搜索结果已缓存 - 查询: ${query}, 结果数: ${total}, 用户类型: ${userType}`);
    }

    return searchResult;
  }

  /**
   * 提交跨存储复制（客户端已完成复制后，通知后端进行缓存失效等收尾）
   * @param {Object} mount - 目标挂载点对象
   * @param {Array<Object>} files - 提交的文件列表，包含 targetPath 与 storagePath
   * @returns {Promise<{success: Array, failed: Array}>}
   */
  async commitCrossStorageCopy(mount, files) {
    return await featureCommitCrossStorageCopy(this, mount, files);
  }

  emitCacheInvalidation(payload = {}) {
    try {
      const { mount = null, mountId = null, storageConfigId = null, paths = [], reason = "fs_operation" } = payload;
      const resolvedMountId = mount?.id ?? mountId ?? null;
      const resolvedStorageConfigId = mount?.storage_config_id ?? storageConfigId ?? null;
      const normalizedPaths = Array.isArray(paths) ? paths.filter((path) => typeof path === "string" && path.length > 0) : [];
      cacheBus.emit(CACHE_EVENTS.INVALIDATE, {
        target: "fs",
        mountId: resolvedMountId,
        storageConfigId: resolvedStorageConfigId,
        paths: normalizedPaths,
        reason,
        db: this.mountManager.db,
      });
    } catch (error) {
      console.warn("cache.invalidate emit failed", error);
    }
  }

  /**
   * 获取存储统计信息
   * @param {string} path - 路径（可选，用于特定挂载点的统计）
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @returns {Promise<Object>} 统计信息
   */
  async getStats(path, userIdOrInfo, userType) {
    if (path) {
      const { driver } = await this.mountManager.getDriverByPath(path, userIdOrInfo, userType);
      return await driver.getStats();
    } else {
      // 返回整个文件系统的统计信息
      return {
        type: "FileSystem",
        mountManager: this.mountManager.constructor.name,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 清理资源
   * @returns {Promise<void>}
   */
  async cleanup() {
    // 清理挂载管理器的资源
    if (this.mountManager && typeof this.mountManager.cleanup === "function") {
      await this.mountManager.cleanup();
    }
  }
}
