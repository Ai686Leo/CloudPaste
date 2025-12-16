/**
 * 文件系统统一抽象层
 * 同时服务于网页端API和WebDAV协议
 * 内部根据存储能力选择最优实现
 */

import { ValidationError, AuthorizationError, DriverError } from "../../http/errors.js";
import { ApiStatus } from "../../constants/index.js";
import { CAPABILITIES } from "../interfaces/capabilities/index.js";
import {
  listDirectory as featureListDirectory,
  getFileInfo as featureGetFileInfo,
  downloadFile as featureDownloadFile,
  exists as featureExists,
} from "./features/read.js";
import {
  generateUploadUrl as featureGenerateUploadUrl,
  generateFileLink as featureGenerateFileLink,
  commitPresignedUpload as featureCommitPresignedUpload,
} from "./features/presign.js";
import { uploadFile as featureUploadFile, uploadDirect as featureUploadDirect, createDirectory as featureCreateDirectory, updateFile as featureUpdateFile } from "./features/write.js";
import { renameItem as featureRenameItem, copyItem as featureCopyItem, batchRemoveItems as featureBatchRemoveItems } from "./features/ops.js";
import {
  initializeFrontendMultipartUpload as featureInitMultipart,
  completeFrontendMultipartUpload as featureCompleteMultipart,
  abortFrontendMultipartUpload as featureAbortMultipart,
  listMultipartUploads as featureListMultipartUploads,
  listMultipartParts as featureListMultipartParts,
  refreshMultipartUrls as featureRefreshMultipartUrls,
} from "./features/multipart.js";
import cacheBus, { CACHE_EVENTS } from "../../cache/cacheBus.js";
import { ensureRepositoryFactory } from "../../utils/repositories.js";
import { getAccessibleMountsForUser } from "../../security/helpers/access.js";
import { UserType } from "../../constants/index.js";
import { FsMetaService } from "../../services/fsMetaService.js";
import { sortSearchResults } from "./utils/SearchUtils.js";
import { TaskPermissionMap, PermissionChecker, Permission } from "../../constants/permissions.js";
import { calculateSubPath, normalizeMountPath } from "./utils/MountResolver.js";
import { normalizePath as normalizeFsPath } from "./utils/PathResolver.js";
/**
 * 模块说明：
 * - 角色：FS 视图的门面层，连接路由/API 与底层存储驱动。
 * - 职责：挂载解析、权限校验、缓存失效、CRUD/分片/预签名/跨存储复制/搜索的调度，具体操作委托 fs/features/*。
 * - 约定：所有驱动调用通过能力检查（CAPABILITIES），不直接依赖具体驱动类型；输入路径均为挂载视图路径。
 */

export class FileSystem {
  /**
   * 构造函数
   * @param {MountManager} mountManager - 挂载管理器实例
   * @param {Object} env - 运行时环境（可选，用于 TaskOrchestrator 初始化）
   */
  constructor(mountManager, env = null) {
    this.mountManager = mountManager;
    this.repositoryFactory = mountManager?.repositoryFactory ?? null;
    this.env = env;
    this._taskOrchestrator = null; // 懒加载的 TaskOrchestrator 实例
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
   * @returns {Promise<import('../streaming/types.js').StorageStreamDescriptor>} 流描述对象
   */
  async downloadFile(path, fileName, request, userIdOrInfo, userType) {
    return await featureDownloadFile(this, path, fileName, request, userIdOrInfo, userType);
  }

  /**
   * 上传文件（统一入口）
   * @param {string} path - 目标路径
   * @param {ReadableStream|ArrayBuffer|Uint8Array|Buffer|File|Blob|string} fileOrStream - 数据源
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @param {Object} options - 选项参数
   * @param {string} options.filename - 文件名
   * @param {string} options.contentType - 内容类型
   * @param {number} options.contentLength - 内容长度
   * @returns {Promise<Object>} 上传结果
   */
  async uploadFile(path, fileOrStream, userIdOrInfo, userType, options = {}) {
    return await featureUploadFile(this, path, fileOrStream, userIdOrInfo, userType, options);
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
   * 生成预签名上传URL（严格模式，仅支持具备 PRESIGNED 能力的驱动）
   * @param {string} path - 文件路径
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 预签名上传URL信息
   */
  async generateUploadUrl(path, userIdOrInfo, userType, options = {}) {
    return await featureGenerateUploadUrl(this, path, userIdOrInfo, userType, options);
  }

  /**
   * 生成通用文件链接（根据驱动能力与挂载配置在预签名与代理之间做决策）
   * @param {string} path - 文件路径
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 文件链接信息 { url, type, expiresIn?, proxyPolicy? }
   */
  async generateFileLink(path, userIdOrInfo, userType, options = {}) {
    return await featureGenerateFileLink(this, path, userIdOrInfo, userType, options);
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

        // 检查驱动是否支持搜索：同时具备 READER + SEARCH 能力，且实现 search 方法
        if (
          !driver.hasCapability(CAPABILITIES.READER) ||
          !driver.hasCapability(CAPABILITIES.SEARCH) ||
          typeof driver.search !== "function"
        ) {
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

    // 排序和分页（使用通用排序工具）
    const sortedResults = sortSearchResults(allResults, query);
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

  emitCacheInvalidation(payload = {}) {
    try {
      const { mount = null, mountId = null, storageConfigId = null, paths = [], reason = "fs_operation" } = payload;
      const resolvedMountId = mount?.id ?? mountId ?? null;
      const resolvedStorageConfigId = mount?.storage_config_id ?? storageConfigId ?? null;
      const rawPaths = Array.isArray(paths) ? paths.filter((path) => typeof path === "string" && path.length > 0) : [];

      // - 若能解析 mount.mount_path，则将 fullPath -> subPath；让 DirectoryCacheManager.invalidatePathAndAncestors 正确命中。
      // - 若无法解析（缺少 mount 或路径不在 mount 内），降级为挂载点级失效（paths=[]），保证一致性优先。
      let normalizedSubPaths = rawPaths;
      if (rawPaths.length > 0) {
        const mountPathRaw = mount?.mount_path || null;
        if (!mountPathRaw) {
          normalizedSubPaths = [];
        } else {
          const mountPath = normalizeMountPath(mountPathRaw);
          const mapped = [];
          let mappingFailed = false;

          for (const p of rawPaths) {
            // NOTE: 是否目录（以 / 结尾）只用于“失效粒度收敛”，不能在 normalizeFsPath 后判断。
            const isDirectoryHint = p.endsWith("/");
            const fullPath = normalizeFsPath(p);
            if (fullPath === mountPath || fullPath === `${mountPath}/` || fullPath.startsWith(`${mountPath}/`)) {
              mapped.push({ subPath: calculateSubPath(fullPath, mountPath), isDirectoryHint });
            } else {
              mappingFailed = true;
              break;
            }
          }

          if (mappingFailed) {
            normalizedSubPaths = [];
          } else {
            // - 目录路径（以 / 结尾的 hint）：失效该目录自身（祖先级联会覆盖父目录）。
            // - 文件路径：失效其父目录。
            const toParentDir = (subPath) => {
              const raw = typeof subPath === "string" && subPath ? subPath : "/";
              const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
              const collapsed = withLeading.replace(/\/{2,}/g, "/");
              if (collapsed === "/") return "/";
              const normalized = collapsed.replace(/\/+$/, "");
              const lastSlash = normalized.lastIndexOf("/");
              if (lastSlash <= 0) return "/";
              return normalized.slice(0, lastSlash) || "/";
            };

            const dirSet = new Set();
            for (const item of mapped) {
              const sp = item?.subPath;
              if (!sp) continue;
              if (item.isDirectoryHint) {
                dirSet.add(sp);
              } else {
                dirSet.add(toParentDir(sp));
              }
            }

            // KISS：超过阈值直接降级为 mount 级失效。
            const MAX_INVALIDATION_DIRS = 200;
            normalizedSubPaths = dirSet.size > MAX_INVALIDATION_DIRS ? [] : Array.from(dirSet);
          }
        }
      }

      cacheBus.emit(CACHE_EVENTS.INVALIDATE, {
        target: "fs",
        mountId: resolvedMountId,
        storageConfigId: resolvedStorageConfigId,
        paths: normalizedSubPaths,
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
      // 安全检查：getStats 是可选方法，不是所有驱动都实现
      if (typeof driver.getStats === "function") {
        return await driver.getStats();
      }
      // 驱动未实现 getStats，返回基本信息
      return {
        type: driver.getType?.() || "unknown",
        supported: false,
        message: "此存储驱动不支持统计信息",
      };
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
   * 获取 TaskOrchestrator 实例（懒加载）
   * @private
   * @returns {Promise<TaskOrchestratorAdapter>} TaskOrchestrator 实例
   */
  async getTaskOrchestrator() {
    if (!this._taskOrchestrator) {
      // 动态导入 TaskOrchestrator 工厂函数
      const { createTaskOrchestrator } = await import('./tasks/index.js');

      // 构建 RuntimeEnv 对象
      const runtimeEnv = {
        // Cloudflare Workers bindings (如果存在)
        JOB_WORKFLOW: this.env?.JOB_WORKFLOW,
        DB: this.env?.DB,

        // Docker/Node.js configuration (由 unified-entry.js 自动设置，复用主数据库)
        TASK_DATABASE_PATH: this.env?.TASK_DATABASE_PATH,
        TASK_WORKER_POOL_SIZE: this.env?.TASK_WORKER_POOL_SIZE,
      };

      this._taskOrchestrator = createTaskOrchestrator(this, runtimeEnv);
    }

    return this._taskOrchestrator;
  }

  /**
   * 创建通用作业 (支持多任务类型)
   * @param {string} taskType - 任务类型 (copy, scheduled-sync, cleanup, etc.)
   * @param {any} payload - 任务载荷 (由 TaskHandler 验证)
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @returns {Promise<Object>} 作业描述符 { jobId, taskType, status, stats, createdAt }
   */
  async createJob(taskType, payload, userIdOrInfo, userType) {
    if (!taskType || typeof taskType !== 'string') {
      throw new ValidationError('请提供有效的任务类型');
    }

    if (!payload) {
      throw new ValidationError('请提供任务载荷');
    }

    const orchestrator = await this.getTaskOrchestrator();

    // 创建作业 (验证逻辑由 TaskHandler 负责)
    const jobDescriptor = await orchestrator.createJob({
      taskType,
      payload,
      userId: typeof userIdOrInfo === 'string' ? userIdOrInfo : userIdOrInfo?.id || userIdOrInfo?.name,
      userType,
    });

    return jobDescriptor;
  }

  /**
   * 计算任务的允许操作
   * @private
   * @param {Object} job - 任务对象
   * @param {number|undefined} userPermissions - 用户权限位标志
   * @param {string} userType - 用户类型
   * @returns {Object} 允许的操作 { canView, canCancel, canDelete, canRetry }
   */
  _computeAllowedActions(job, userPermissions, userType) {
    // 管理员拥有所有操作权限
    if (userType === UserType.ADMIN) {
      return {
        canView: true,
        canCancel: ['pending', 'running'].includes(job.status),
        canDelete: !['pending', 'running'].includes(job.status),
        canRetry: ['failed', 'partial'].includes(job.status),
      };
    }

    // 非管理员：根据任务类型检查权限
    const requiredPermission = TaskPermissionMap[job.taskType];
    const hasTypePermission = requiredPermission && userPermissions !== undefined
      ? PermissionChecker.hasPermission(userPermissions, requiredPermission)
      : false;

    return {
      canView: true,  // 能获取到任务说明有查看权限
      canCancel: hasTypePermission && ['pending', 'running'].includes(job.status),
      canDelete: hasTypePermission && !['pending', 'running'].includes(job.status),
      canRetry: hasTypePermission && ['failed', 'partial'].includes(job.status),
    };
  }

  /**
   * 获取作业状态
   * @param {string} jobId - 作业ID
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @returns {Promise<Object>} 作业状态 { jobId, taskType, status, stats, allowedActions, ... }
   */
  async getJobStatus(jobId, userIdOrInfo, userType) {
    if (!jobId) {
      throw new ValidationError('请提供作业ID');
    }

    const orchestrator = await this.getTaskOrchestrator();
    const jobStatus = await orchestrator.getJobStatus(jobId);

    // 权限验证：只有任务创建者或管理员可以查看
    if (userType !== UserType.ADMIN) {
      const currentUserId = typeof userIdOrInfo === 'string'
        ? userIdOrInfo
        : userIdOrInfo?.id || userIdOrInfo?.name;

      if (jobStatus.userId !== currentUserId) {
        throw new AuthorizationError('无权访问此任务');
      }
    }

    // 计算允许的操作
    const userPermissions = typeof userIdOrInfo === 'object' ? userIdOrInfo?.permissions : undefined;
    const allowedActions = this._computeAllowedActions(jobStatus, userPermissions, userType);

    return {
      ...jobStatus,
      allowedActions,
    };
  }

  /**
   * 取消作业
   * @param {string} jobId - 作业ID
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @returns {Promise<void>}
   */
  async cancelJob(jobId, userIdOrInfo, userType) {
    if (!jobId) {
      throw new ValidationError('请提供作业ID');
    }

    // 先获取任务状态并验证权限（复用 getJobStatus 的权限检查）
    const jobStatus = await this.getJobStatus(jobId, userIdOrInfo, userType);

    // 检查操作权限（基于 allowedActions）
    if (!jobStatus.allowedActions?.canCancel) {
      throw new AuthorizationError('无权取消此任务');
    }

    // 检查任务状态是否可取消
    if (jobStatus.status !== 'pending' && jobStatus.status !== 'running') {
      throw new ValidationError('只能取消待执行或执行中的任务');
    }

    const orchestrator = await this.getTaskOrchestrator();
    await orchestrator.cancelJob(jobId);
  }

  /**
   * 列出作业 (支持任务类型过滤)
   * @param {Object} filter - 过滤条件
   * @param {string} filter.taskType - 任务类型（copy, scheduled-sync, cleanup, etc.）
   * @param {string} filter.status - 作业状态（pending/running/completed/partial/failed/cancelled）
   * @param {string} filter.userId - 用户ID（内部使用，由权限检查逻辑控制）
   * @param {number} filter.limit - 返回数量限制
   * @param {number} filter.offset - 偏移量
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @returns {Promise<Array<Object>>} 作业描述符数组（含 allowedActions）
   */
  async listJobs(filter = {}, userIdOrInfo, userType) {
    // 非管理员用户：强制过滤为只能看到自己的任务
    const finalFilter = { ...filter };

    if (userType !== UserType.ADMIN) {
      const currentUserId = typeof userIdOrInfo === 'string'
        ? userIdOrInfo
        : userIdOrInfo?.id || userIdOrInfo?.name;

      // 强制设置 userId 过滤条件，防止非管理员查看他人任务
      finalFilter.userId = currentUserId;
    }

    const orchestrator = await this.getTaskOrchestrator();
    let jobs = await orchestrator.listJobs(finalFilter);

    // 获取用户权限
    const userPermissions = typeof userIdOrInfo === 'object' ? userIdOrInfo?.permissions : undefined;

    // 非管理员用户：根据任务类型权限过滤任务
    if (userType !== UserType.ADMIN && userPermissions !== undefined) {
      jobs = jobs.filter(job => {
        const requiredPermission = TaskPermissionMap[job.taskType];

        // 如果任务类型没有对应的权限映射，默认不显示
        if (!requiredPermission) {
          return false;
        }

        // 检查用户是否拥有该任务类型所需的权限
        return PermissionChecker.hasPermission(userPermissions, requiredPermission);
      });
    }

    // 为每个任务计算 allowedActions
    const enrichedJobs = jobs.map(job => ({
      ...job,
      allowedActions: this._computeAllowedActions(job, userPermissions, userType),
    }));

    return enrichedJobs;
  }

  /**
   * 删除作业
   * @param {string} jobId - 作业ID
   * @param {string|Object} userIdOrInfo - 用户ID或API密钥信息
   * @param {string} userType - 用户类型
   * @returns {Promise<void>}
   */
  async deleteJob(jobId, userIdOrInfo, userType) {
    if (!jobId) {
      throw new ValidationError('请提供作业ID');
    }

    // 先获取任务状态并验证权限
    const jobStatus = await this.getJobStatus(jobId, userIdOrInfo, userType);

    // 检查操作权限
    if (!jobStatus.allowedActions?.canDelete) {
      throw new AuthorizationError('无权删除此任务');
    }

    // 检查任务状态是否可删除
    if (jobStatus.status === 'pending' || jobStatus.status === 'running') {
      throw new ValidationError('不能删除待执行或执行中的任务，请先取消任务');
    }

    const orchestrator = await this.getTaskOrchestrator();
    await orchestrator.deleteJob(jobId);
  }

  /**
   * 清理资源
   * @returns {Promise<void>}
   */
  async cleanup() {
    // 清理任务编排器资源
    if (this._taskOrchestrator && typeof this._taskOrchestrator.shutdown === 'function') {
      await this._taskOrchestrator.shutdown();
    }

    // 清理挂载管理器的资源
    if (this.mountManager && typeof this.mountManager.cleanup === "function") {
      await this.mountManager.cleanup();
    }
  }
}
