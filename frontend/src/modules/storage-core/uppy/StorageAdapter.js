/**
 * StorageAdapter for Uppy.js
 * 内部模块化，保持对外API不变
 */

import { useAuthStore } from "@/stores/authStore.js";
import * as fsApi from "@/api/services/fsService.js";

// ===== 内部工具类 =====

/**
 * 缓存管理器 - 处理localStorage和内存缓存
 */
class CacheManager {
  constructor(config) {
    this.config = config;
    this.memoryCache = new Map();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  getCachedParts(key) {
    // 先检查内存缓存
    if (this.memoryCache.has(key)) {
      this.cacheHits++;
      const cached = this.memoryCache.get(key);
      if (Date.now() - cached.timestamp < this.config.cacheExpiry) {
        return cached.parts;
      } else {
        this.memoryCache.delete(key);
      }
    }

    // localStorage 缓存
    this.cacheMisses++;
    try {
      const storageKey = this.config.storagePrefix + key;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const data = JSON.parse(stored);
        const now = Date.now();
        if (now - data.timestamp < this.config.cacheExpiry) {
          // 更新内存缓存
          this.memoryCache.set(key, data);
          if (data.parts.length > 0) {
            const partNumbers = data.parts.map((p) => p.PartNumber).sort((a, b) => a - b);
            console.log(`[CacheManager] 缓存命中: [${partNumbers.join(", ")}] <- ${key}`);
          }
          return data.parts;
        } else {
          localStorage.removeItem(storageKey);
          console.log(`[CacheManager] 缓存已过期，已清理: ${key}`);
        }
      }
    } catch (error) {
      console.error(`[CacheManager] 读取缓存失败: ${key}`, error);
    }
    return [];
  }

  setCachedParts(key, parts) {
    const data = {
      parts: parts,
      timestamp: Date.now(),
    };

    try {
      // 更新 localStorage
      const storageKey = this.config.storagePrefix + key;
      localStorage.setItem(storageKey, JSON.stringify(data));

      // 更新内存缓存
      this.memoryCache.set(key, data);

      if (parts.length > 0) {
        const partNumbers = parts.map((p) => p.PartNumber).sort((a, b) => a - b);
        console.log(`[CacheManager] 缓存更新: [${partNumbers.join(", ")}] -> ${key}`);
      }
    } catch (error) {
      console.error(`[CacheManager] 保存缓存失败: ${key}`, error);
    }
  }

  addPartToCache(key, part) {
    const existingParts = this.getCachedParts(key);
    const updatedParts = [...existingParts];

    // 检查是否已存在该分片
    const existingIndex = updatedParts.findIndex((p) => p.PartNumber === part.PartNumber);
    if (existingIndex >= 0) {
      updatedParts[existingIndex] = part;
    } else {
      updatedParts.push(part);
    }

    this.setCachedParts(key, updatedParts);
  }

  getStats() {
    return {
      cacheHitRate: (this.cacheHits / (this.cacheHits + this.cacheMisses)) * 100,
      memoryCacheSize: this.memoryCache.size,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
    };
  }

  clear() {
    this.memoryCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
}

/**
 * 会话管理器 - 处理上传会话的生命周期
 */
class SessionManager {
  constructor(config) {
    this.config = config;
    this.sessions = new Map();
    this.pausedFiles = new Set();

    // 定期清理过期会话
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000); // 5分钟清理一次
  }

  createSession(fileId, sessionData) {
    const session = {
      ...sessionData,
      createdAt: Date.now(),
      lastAccessAt: Date.now(),
    };
    this.sessions.set(fileId, session);
    return session;
  }

  getSession(fileId) {
    const session = this.sessions.get(fileId);
    if (session) {
      session.lastAccessAt = Date.now();
    }
    return session;
  }

  updateSession(fileId, updates) {
    const session = this.sessions.get(fileId);
    if (session) {
      Object.assign(session, updates, { lastAccessAt: Date.now() });
    }
  }

  deleteSession(fileId) {
    return this.sessions.delete(fileId);
  }

  setFilePaused(fileId, paused) {
    if (paused) {
      this.pausedFiles.add(fileId);
      console.log(`[SessionManager] 文件已暂停: ${fileId}`);
    } else {
      this.pausedFiles.delete(fileId);
      console.log(`[SessionManager] 文件已恢复: ${fileId}`);
    }
  }

  isFilePaused(fileId) {
    return this.pausedFiles.has(fileId);
  }

  cleanupExpiredSessions() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [fileId, session] of this.sessions) {
      if (now - session.lastAccessAt > this.config.sessionTimeout) {
        this.sessions.delete(fileId);
        this.pausedFiles.delete(fileId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[SessionManager] 清理了 ${cleanedCount} 个过期会话`);
    }
  }

  getStats() {
    return {
      activeSessions: this.sessions.size,
      pausedFiles: this.pausedFiles.size,
    };
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.sessions.clear();
    this.pausedFiles.clear();
  }
}

/**
 * 认证提供器 - 处理认证相关逻辑
 */
class AuthProvider {
  constructor(authStore) {
    this.authStore = authStore;
  }

  getAuthHeaders() {
    const headers = {};

    // 检查管理员认证
    if (this.authStore.authType === "admin" && this.authStore.adminToken) {
      headers["Authorization"] = `Bearer ${this.authStore.adminToken}`;
    }
    // 检查API密钥/游客认证
    else if (this.authStore.isKeyUser && this.authStore.apiKey) {
      headers["Authorization"] = `ApiKey ${this.authStore.apiKey}`;
    }

    return headers;
  }
}

/**
 * 路径解析器 - 处理路径转换逻辑
 */
class PathResolver {
  constructor(currentPath) {
    this.currentPath = currentPath;
  }

  updatePath(newPath) {
    this.currentPath = newPath;
  }

  buildFullPathFromKey(storageKey) {
    // 如果storage key已经包含完整路径，直接返回
    if (storageKey.startsWith("/")) {
      return storageKey;
    }

    // 规范化当前路径，去掉末尾斜杠
    const normalizedCurrentPath = this.currentPath.replace(/\/+$/, "");

    // 提取文件名
    const fileName = storageKey.split("/").pop();

    // 构建完整路径
    const result = `${normalizedCurrentPath}/${fileName}`;
    console.log(`[PathResolver] 最终路径: ${result}`);

    return result;
  }
}

/**
 * 错误处理器 - 统一错误处理逻辑
 */
class ErrorHandler {
  constructor(config) {
    this.config = config;
  }

  handleError(error, context, fallbackValue = null) {
    const errorMessage = error?.message || "未知错误";
    console.error(`[StorageAdapter] ${context}失败:`, errorMessage, error);

    // 调用自定义错误处理器
    if (this.config.onError && typeof this.config.onError === "function") {
      this.config.onError(error, context);
    }

    return fallbackValue;
  }

  async retryOperation(operation, context = "操作") {
    const maxRetries = this.config.maxRetries || 3;
    const baseDelay = this.config.retryDelay || 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === maxRetries) {
          throw this.handleError(error, `${context}(最终尝试)`);
        }

        const delay = baseDelay * Math.pow(2, attempt - 1); // 指数退避
        console.warn(`[ErrorHandler] ${context}失败，重试 ${attempt}/${maxRetries}，${delay}ms后重试:`, error.message);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}

// ===== 主类 =====

export class StorageAdapter {
  constructor(currentPath, uppyInstance = null, options = {}) {
    // 配置初始化
    this.config = {
      partSize: options.partSize || 5 * 1024 * 1024, // 5MB
      cacheExpiry: options.cacheExpiry || 24 * 60 * 60 * 1000, // 24小时
      storagePrefix: options.storagePrefix || "uppy_multipart_",
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      sessionTimeout: options.sessionTimeout || 60 * 60 * 1000, // 1小时
      onError: options.onError,
      ...options,
    };

    // 基本属性
    this.currentPath = currentPath;
    this.uppyInstance = uppyInstance;
    this.STORAGE_PREFIX = this.config.storagePrefix; // 保持向后兼容

    // 初始化内部模块
    this.cacheManager = new CacheManager(this.config);
    this.sessionManager = new SessionManager(this.config);
    this.authProvider = new AuthProvider(useAuthStore());
    this.pathResolver = new PathResolver(currentPath);
    this.errorHandler = new ErrorHandler(this.config);

    // 向后兼容的属性
    this.uploadSessions = this.sessionManager.sessions;
    this.customPausedFiles = this.sessionManager.pausedFiles;
    this.authStore = this.authProvider.authStore;
  }

  /**
   * 设置Uppy实例引用
   * @param {Object} uppyInstance Uppy实例
   */
  setUppyInstance(uppyInstance) {
    this.uppyInstance = uppyInstance;
  }

  /**
   * 设置文件暂停状态
   * @param {string} fileId 文件ID
   * @param {boolean} paused 是否暂停
   */
  setFilePaused(fileId, paused) {
    this.sessionManager.setFilePaused(fileId, paused);
  }

  /**
   * 获取性能统计信息
   * @returns {Object} 性能统计
   */
  getPerformanceStats() {
    return {
      ...this.cacheManager.getStats(),
      ...this.sessionManager.getStats(),
    };
  }

  /**
   * 更新当前路径
   * @param {string} newPath 新路径
   */
  updatePath(newPath) {
    this.currentPath = newPath;
    this.pathResolver.updatePath(newPath);
  }

  /**
   * 销毁适配器，清理资源
   */
  destroy() {
    this.sessionManager.destroy();
    this.cacheManager.clear();
  }

  /**
   * 批量处理预签名上传的commit阶段
   * @param {Array} successfulFiles 成功上传的文件列表
   * @returns {Promise<{failures: Array}>} commit结果
   */
  async batchCommitPresignedUploads(successfulFiles) {
    if (!successfulFiles || successfulFiles.length === 0) {
      return { failures: [] };
    }

    console.log(`[StorageAdapter] 开始批量commit ${successfulFiles.length} 个文件`);
    const failures = [];

    // 并发处理commit，提高性能
    const commitPromises = successfulFiles.map(async (file) => {
      try {
        await this.commitPresignedUpload(file, file.response);
        return { file, success: true };
      } catch (error) {
        console.error(`[StorageAdapter] ❌ commit失败: ${file.name}`, error);
        failures.push({
          fileName: file.name,
          fileId: file.id,
          error: error.message,
          timestamp: new Date().toISOString(),
        });
        return { file, success: false, error };
      }
    });

    // 等待所有commit操作完成
    const results = await Promise.allSettled(commitPromises);

    // 统计结果
    const successCount = results.filter((r) => r.status === "fulfilled" && r.value.success).length;
    const failureCount = failures.length;

    console.log(`[StorageAdapter] 批量commit完成: ${successCount}成功, ${failureCount}失败`);

    if (failures.length > 0) {
      console.warn(`[StorageAdapter] commit失败详情:`, failures);
    }

    return {
      failures,
      successCount,
      failureCount,
      totalCount: successfulFiles.length,
    };
  }

  /**
   * 检查文件是否被暂停
   * @param {string} fileId 文件ID
   * @returns {boolean} 是否暂停
   */
  isFilePaused(fileId) {
    return this.customPausedFiles.has(fileId);
  }

  /**
   * 从上传URL获取对应的文件ID
   * @param {string} url 上传URL
   * @returns {string|null} 文件ID
   */
  getFileIdFromUrl(url) {
    // 从uploadSessions中查找匹配的文件ID
    for (const [fileId, session] of this.uploadSessions.entries()) {
      if (session.presignedUrls && session.presignedUrls.some((urlInfo) => url.includes(urlInfo.partNumber))) {
        return fileId;
      }
    }
    return null;
  }

  /**
   * 从localStorage获取已上传分片信息
   * @param {string} key storage key
   * @returns {Array} 已上传分片列表
   */
  getUploadedPartsFromStorage(key) {
    return this.cacheManager.getCachedParts(key);
  }

  /**
   * 将已上传分片信息保存到localStorage
   * @param {string} key storage key
   * @param {Array} parts 已上传分片列表
   */
  saveUploadedPartsToStorage(key, parts) {
    this.cacheManager.setCachedParts(key, parts);
  }

  /**
   * 从localStorage删除已上传分片信息
   * @param {string} key storage key
   */
  removeUploadedPartsFromStorage(key) {
    try {
      const storageKey = this.STORAGE_PREFIX + key;
      localStorage.removeItem(storageKey);
      console.log(`[StorageAdapter] 从localStorage删除分片缓存: ${key}`);
    } catch (error) {
      console.warn(`[StorageAdapter] 从localStorage删除失败:`, error);
    }
  }

  /**
   * 添加单个分片到localStorage缓存
   * @param {string} key storage key
   * @param {Object} part 分片信息 {PartNumber, ETag, Size}
   */
  addPartToStorage(key, part) {
    this.cacheManager.addPartToCache(key, part);
  }

  /**
   * 从服务器获取权威的已上传分片信息
   * @param {string} key storage key
   * @param {string} uploadId 上传ID
   * @param {string} fileName 文件名
   * @returns {Promise<Array>} 服务器端的权威分片列表
   */
  async getServerUploadedParts(key, uploadId, fileName) {
    return this.errorHandler
      .retryOperation(async () => {
        // 将storage key转换为完整的挂载点路径
        const fullPath = this.buildFullPathFromKey(key);
        console.log(`[StorageAdapter] 从服务器获取分片信息: ${fullPath}`);

        const response = await fsApi.listMultipartParts(fullPath, uploadId, fileName);

        if (!response.success) {
          throw new Error(`服务器分片查询失败: ${response.message}`);
        }

        const serverParts = (response.data.parts || []).map((part) => ({
          PartNumber: part.partNumber,
          ETag: part.etag,
          Size: part.size,
          LastModified: part.lastModified,
        }));

        console.log(`[StorageAdapter] 服务器返回${serverParts.length}个分片信息`);

        // 更新localStorage缓存为服务器端数据
        this.saveUploadedPartsToStorage(key, serverParts);

        return serverParts;
      }, "获取服务器分片信息")
      .catch((error) => {
        return this.errorHandler.handleError(error, "获取服务器分片信息", []);
      });
  }

  /**
   * 初始化已上传分片缓存（一次性从服务器获取数据）
   * @param {string} key storage key
   * @param {string} uploadId 上传ID
   * @param {string} fileName 文件名
   */
  async initializeUploadedPartsCache(key, uploadId, fileName) {
    try {
      console.log(`[StorageAdapter] 初始化分片缓存: ${key}`);

      // 从服务器获取权威的已上传分片信息
      const serverParts = await this.getServerUploadedParts(key, uploadId, fileName);

      console.log(`[StorageAdapter] 缓存初始化完成，后续uploadPartBytes将直接使用缓存`);
      return serverParts;
    } catch (error) {
      console.error(`[StorageAdapter] 初始化分片缓存失败:`, error);
      // 失败时初始化为空缓存
      this.saveUploadedPartsToStorage(key, []);
      return [];
    }
  }

  /**
   * 更新当前路径
   * @param {string} newPath 新路径
   */
  updatePath(newPath) {
    this.currentPath = newPath;
  }

  /**
   * 获取认证头部 - 用于XHR Upload插件
   * @returns {Object} 认证头部对象
   */
  getAuthHeaders() {
    return this.authProvider.getAuthHeaders();
  }

  /**
   * 单文件上传参数获取 预签名URL上传
   * @param {Object} file Uppy文件对象
   * @param {Object} options 选项
   * @returns {Promise<Object>} {method, url, fields, headers}
   */
  async getUploadParameters(file, options = {}) {
    try {
      console.log(`[StorageAdapter] 获取预签名URL上传参数: ${file.name}`);

      const response = await fsApi.getPresignedUploadUrl(this.currentPath, file.name, file.type, file.size);

      if (!response.success) {
        throw new Error(response.message || "获取预签名URL失败");
      }

      const data = response.data || {};

      // 缓存上传信息，供commit使用
      this.uploadSessions.set(file.id, {
        targetPath: data.targetPath,
        mountId: data.mountId,
        fileId: data.fileId,
        storagePath: data.storagePath,
        publicUrl: data.publicUrl,
        storageConfigId: data.storageConfigId,
        contentType: data.contentType,
        storageType: data.storageType || data.storage_type || null,
      });

      const baseHeaders = data.headers || {};
      const headers = {
        "Content-Type": baseHeaders["Content-Type"] || file.type || "application/octet-stream",
        ...baseHeaders,
      };

      return {
        method: "PUT",
        url: data.presignedUrl,
        fields: {},
        headers,
      };
    } catch (error) {
      console.error("[StorageAdapter] 获取预签名URL上传参数失败:", error);
      throw error;
    }
  }

  /**
   * 创建分片上传
   * @param {Object} file Uppy文件对象
   * @returns {Promise<Object>} {uploadId, key}
   */
  async createMultipartUpload(file) {
    try {
      console.log(`[StorageAdapter] 创建分片上传: ${file.name}`);

      // 检查是否为ServerResume标记的可恢复上传
      if (file.meta.resumable && file.meta.existingUpload && file.meta.serverResume) {
        const existingUpload = file.meta.existingUpload;
        console.log(
          `[StorageAdapter] 尝试恢复现有上传: uploadId=${existingUpload.uploadId}, key=${existingUpload.key}`,
        );

        const existingStrategy = existingUpload.strategy || "per_part_url";

        try {
          // 1. 先验证uploadId有效性 - 使用完整的挂载点路径
          const fullPathForValidation = this.buildFullPathFromKey(existingUpload.key);
          console.log(`[StorageAdapter] 验证uploadId有效性: ${fullPathForValidation}`);
          const listPartsResponse = await fsApi.listMultipartParts(
            fullPathForValidation,
            existingUpload.uploadId,
            file.name,
          );

          if (!listPartsResponse.success) {
            throw new Error(`uploadId已失效: ${listPartsResponse.message}`);
          }

          const uploadedParts = listPartsResponse.data.parts || [];
          console.log(
            `[StorageAdapter] 🔍 服务器返回: 找到${uploadedParts.length}个已上传分片（按驱动语义解析）`,
          );

          // per_part_url 策略（S3 等）：保持原有的预签名URL刷新与本地缓存逻辑
          if (existingStrategy === "per_part_url") {
            const partSize = this.config.partSize || 5 * 1024 * 1024;
            const totalParts = Math.ceil(file.size / partSize);
            const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);

            const fullPath = this.buildFullPathFromKey(existingUpload.key);
            console.log(
              `[StorageAdapter] 路径转换: StorageKey=${existingUpload.key} -> FullPath=${fullPath}`,
            );

            const refreshResponse = await fsApi.refreshMultipartUrls(
              fullPath,
              existingUpload.uploadId,
              partNumbers,
            );

            if (!refreshResponse.success) {
              throw new Error(refreshResponse.message || "刷新预签名URL失败");
            }

            const standardParts = uploadedParts.map((part) => ({
              PartNumber: part.partNumber,
              Size: part.size,
              ETag: part.etag,
            }));

            const uploadedBytes = uploadedParts.reduce((sum, part) => sum + part.size, 0);
            const progressPercent = Math.round((uploadedBytes / file.size) * 100);

            if (standardParts.length > 0) {
              const partNums = standardParts
                .map((p) => p.PartNumber)
                .sort((a, b) => a - b);
              console.log(
                `[StorageAdapter] 服务器已上传分片: [${partNums.join(", ")}] (${progressPercent}%)`,
              );
            }

            this.uploadSessions.set(file.id, {
              strategy: "per_part_url",
              uploadId: existingUpload.uploadId,
              key: existingUpload.key,
              presignedUrls: refreshResponse.data.presignedUrls,
              path: this.currentPath,
              fileName: file.name,
              resumed: true, // 标记为恢复的上传
            });

            const fullPathKey = this.buildFullPathFromKey(existingUpload.key);
            this.saveUploadedPartsToStorage(fullPathKey, standardParts);
            console.log(
              `[StorageAdapter] 缓存到localStorage: ${standardParts.length}个分片 -> ${fullPathKey}`,
            );

            console.log("[StorageAdapter] per_part_url 模式断点续传恢复成功");
            return {
              uploadId: existingUpload.uploadId,
              key: existingUpload.key,
            };
          }

          // single_session 策略（OneDrive 等）：使用单一 uploadUrl + Content-Range
          if (existingStrategy === "single_session") {
            const fullPath = this.buildFullPathFromKey(existingUpload.key);
            console.log(
              `[StorageAdapter] single_session 恢复: StorageKey=${existingUpload.key} -> FullPath=${fullPath}`,
            );

            // 对于 single_session，后端的 refreshMultipartUrls 返回最新的会话信息
            const refreshResponse = await fsApi.refreshMultipartUrls(
              fullPath,
              existingUpload.uploadId,
              [1], // 对于 single_session，partNumbers 仅为参数校验占位
            );

            if (!refreshResponse.success) {
              throw new Error(refreshResponse.message || "刷新会话信息失败");
            }

            const data = refreshResponse.data || {};
            const session = data.session || {};
            const uploadUrl = session.uploadUrl || existingUpload.uploadId;
            const nextExpectedRanges = session.nextExpectedRanges || [];

            let resumeOffset = 0;
            if (Array.isArray(nextExpectedRanges) && nextExpectedRanges.length > 0) {
              const firstRange = String(nextExpectedRanges[0]);
              const startStr = firstRange.split("-")[0];
              const parsed = Number.parseInt(startStr, 10);
              if (Number.isFinite(parsed) && parsed >= 0) {
                resumeOffset = parsed;
              }
            }

            const effectivePartSize =
              existingUpload.partSize || this.config.partSize || 5 * 1024 * 1024;

            // 结合服务器返回的已上传分片列表，推导已完成的分片数量
            // 从1开始连续编号，如果出现空洞则只取最大连续分片号
            let completedParts = 0;
            if (Array.isArray(uploadedParts) && uploadedParts.length > 0) {
              const partNumbers = uploadedParts
                .map((p) => p.partNumber ?? p.PartNumber)
                .filter((n) => typeof n === "number" && Number.isFinite(n) && n > 0)
                .sort((a, b) => a - b);

              let expected = 1;
              for (const n of partNumbers) {
                if (n === expected) {
                  completedParts = n;
                  expected += 1;
                } else {
                  break;
                }
              }
            }

            this.uploadSessions.set(file.id, {
              strategy: "single_session",
              uploadId: existingUpload.uploadId,
              key: existingUpload.key,
              session: {
                uploadUrl,
                nextExpectedRanges,
              },
              path: this.currentPath,
              fileName: file.name,
              fileSize: file.size,
              partSize: effectivePartSize,
              resumed: true,
              resumeOffset,
              completedParts,
            });

            console.log(
              `[StorageAdapter] single_session 模式断点续传恢复成功，resumeOffset=${resumeOffset}，completedParts=${completedParts}`,
            );

            return {
              uploadId: existingUpload.uploadId,
              key: existingUpload.key,
            };
          }

          console.warn(
            `[StorageAdapter] 未知的 existingUpload.strategy=${existingStrategy}，将回退为全新上传`,
          );
        } catch (error) {
          console.warn(`[StorageAdapter] 断点续传失败，创建新上传: ${error.message}`);

          // 清除失效的上传标记
          if (this.uppyInstance) {
            this.uppyInstance.setFileMeta(file.id, {
              resumable: false,
              existingUpload: null,
              serverResume: false,
            });
          }

          // 继续创建新的上传（不要递归调用，直接继续执行下面的代码）
        }
      }

      // 创建新的分片上传（统一走 FS /fs/multipart/init，依据 strategy 分流）
      const partSize = this.config.partSize || 5 * 1024 * 1024; // 5MB
      const response = await fsApi.initMultipartUpload(
        this.currentPath,
        file.name,
        file.size,
        file.type,
        partSize,
      );

      if (!response.success) {
        throw new Error(response.message || "初始化分片上传失败");
      }

      const init = response.data || {};
      const strategy = init.strategy || "per_part_url";
      const uploadId = init.uploadId;
      const key = `${this.currentPath}/${file.name}`.replace(/\/+/g, "/");

      if (!uploadId) {
        throw new Error("初始化分片上传失败：缺少 uploadId");
      }

      if (strategy === "per_part_url") {
        // S3 等 per-part 预签名 URL 策略
        if (!Array.isArray(init.presignedUrls) || init.presignedUrls.length === 0) {
          throw new Error("初始化分片上传失败：per_part_url 策略缺少 presignedUrls");
        }

        this.uploadSessions.set(file.id, {
          strategy,
          uploadId,
          key,
          presignedUrls: init.presignedUrls,
          path: this.currentPath,
          fileName: file.name,
          fileSize: file.size,
          partSize: init.partSize || partSize,
          resumed: false,
        });

        // 对于新上传，也检查一次服务器是否有已上传分片（可能是其他会话的残留）
        const fullPathKey = this.buildFullPathFromKey(key);
        await this.initializeUploadedPartsCache(fullPathKey, uploadId, file.name);
        console.log(`[StorageAdapter] 新上传初始化完成，已检查服务器状态，缓存key=${fullPathKey}`);

        return {
          uploadId,
          key,
        };
      }

      if (strategy === "single_session") {
        // OneDrive 等使用单一 uploadUrl + Content-Range 的策略
        const session = init.session || {};
        if (!session.uploadUrl) {
          throw new Error("初始化分片上传失败：single_session 策略缺少 session.uploadUrl");
        }

        this.uploadSessions.set(file.id, {
          strategy,
          uploadId,
          key,
          session,
          path: this.currentPath,
          fileName: file.name,
          fileSize: file.size,
          partSize: init.partSize || partSize,
          resumed: false,
          resumeOffset: 0,
        });

        console.log("[StorageAdapter] 新的 single_session 分片上传会话已创建（OneDrive/Graph 模式）");

        return {
          uploadId,
          key,
        };
      }

      throw new Error(`不支持的分片上传策略: ${String(strategy)}`);
    } catch (error) {
      console.error("[StorageAdapter] 创建分片上传失败:", error);
      throw error;
    }
  }

  /**
   * 签名分片
   * @param {Object} file Uppy文件对象
   * @param {Object} partData 分片数据 {uploadId, key, partNumber, body}
   * @returns {Promise<Object>} {url, headers}
   */
  async signPart(file, partData) {
    try {
      const session = this.uploadSessions.get(file.id);
      if (!session) {
        throw new Error("找不到上传会话信息");
      }

      console.log(`[StorageAdapter] signPart被调用: 分片${partData.partNumber}`);

      // 不在signPart中处理已上传分片，断点续传由 listParts + uploadPartBytes 内部处理

      if (session.strategy === "single_session") {
        // OneDrive/Graph uploadSession: 所有分片共用一个 uploadUrl，通过 Content-Range 标记区间
        // 这里不使用 resumeOffset，而是始终按全局 partNumber 计算 Range:
        // start = (partNumber - 1) * partSize
        // 已上传的分片通过 listParts 返回的 PartNumber 列表由 HTTPCommunicationQueue 跳过。
        const totalSize = session.fileSize || file.size;
        const partSize = session.partSize || this.config.partSize || 5 * 1024 * 1024;

        const partNumber = partData.partNumber;
        if (typeof partNumber !== "number" || !Number.isFinite(partNumber) || partNumber <= 0) {
          throw new Error(`无效的单会话分片编号: ${partNumber}`);
        }

        const body = partData.body;
        const currentSize =
          (body && (body.size ?? body.byteLength)) != null
            ? body.size ?? body.byteLength
            : null;
        if (currentSize == null || !Number.isFinite(currentSize) || currentSize <= 0) {
          throw new Error("无法确定当前分片大小，用于计算 Content-Range");
        }

        const start = (partNumber - 1) * partSize;
        const end = Math.min(start + currentSize, totalSize) - 1;

        if (start >= totalSize) {
          throw new Error(
            `分片区间超出文件大小: start=${start}, totalSize=${totalSize}, partNumber=${partNumber}`,
          );
        }

        const url = session.session?.uploadUrl || session.uploadId;
        if (!url) {
          throw new Error("single_session 会话缺少有效的 uploadUrl");
        }

        // 对于 single_session（OneDrive / GoogleDrive 后端中转），需要带上认证头，
        const authHeaders = this.authProvider.getAuthHeaders() || {};

        return {
          url,
          headers: {
            ...authHeaders,
            "Content-Type": "application/octet-stream",
            "Content-Range": `bytes ${start}-${end}/${totalSize}`,
          },
          // 标记单会话策略，供 uploadPartBytes 区分处理（不强制要求 ETag）
          strategy: "single_session",
          // 将当前分片编号与文件ID一并传递，方便在 uploadPartBytes 中进行跳过逻辑
          partNumber,
          fileId: file.id,
        };
      }

      // 默认 per_part_url 策略（S3 等）：从缓存的预签名URL列表中找到对应分片
      const urls = Array.isArray(session.presignedUrls) ? session.presignedUrls : [];
      const urlInfo = urls.find((url) => url.partNumber === partData.partNumber);

      if (!urlInfo) {
        throw new Error(`找不到分片 ${partData.partNumber} 的预签名URL`);
      }

      return {
        url: urlInfo.url,
        headers: {
          "Content-Type": "application/octet-stream",
        },
        strategy: "per_part_url",
      };
    } catch (error) {
      console.error("[StorageAdapter] 签名分片失败:", error);
      throw error;
    }
  }

  /**
   * 完成分片上传
   * @param {Object} file Uppy文件对象
   * @param {Object} data {uploadId, key, parts}
   * @returns {Promise<Object>} {location}
   */
  async completeMultipartUpload(file, data) {
    try {
      console.log(`[StorageAdapter] 完成分片上传: ${file.name}`);

      const session = this.uploadSessions.get(file.id);
      if (!session) {
        throw new Error("找不到上传会话信息");
      }

      // 检查Uppy传递的parts格式
      if (!data.parts || !Array.isArray(data.parts)) {
        throw new Error("无效的parts数据");
      }

      // Uppy内部使用AWS标准格式，直接传递即可
      const response = await fsApi.completeMultipartUpload(session.path, data.uploadId, data.parts, session.fileName, file.size);

      if (!response.success) {
        throw new Error(response.message || "完成分片上传失败");
      }

      // 清理上传会话和分片缓存
      this.uploadSessions.delete(file.id);
      if (session.key) {
        const fullPathKey = this.buildFullPathFromKey(session.key);
        this.removeUploadedPartsFromStorage(fullPathKey);
      }

      return {
        location: response.data.url || `${session.path}/${session.fileName}`,
      };
    } catch (error) {
      console.error("[StorageAdapter] 完成分片上传失败:", error);
      throw error;
    }
  }

  /**
   * 中止分片上传
   * @param {Object} file Uppy文件对象
   * @param {Object} data {uploadId, key}
   */
  async abortMultipartUpload(file, data) {
    try {
      console.log(`[StorageAdapter] 中止分片上传: ${file.name}`);

      const session = this.uploadSessions.get(file.id);
      if (session) {
        await fsApi.abortMultipartUpload(session.path, data.uploadId, session.fileName);
        // 清理上传会话和分片缓存
        this.uploadSessions.delete(file.id);
        if (session.key) {
          const fullPathKey = this.buildFullPathFromKey(session.key);
          this.removeUploadedPartsFromStorage(fullPathKey);
        }
      }
    } catch (error) {
      console.error("[StorageAdapter] 中止分片上传失败:", error);
      // 中止操作失败不应该抛出错误，只记录日志
    }
  }

  /**
   * 列出已上传的分片
   * 使用前端缓存，避免重复调用后端API
   * @param {Object} file Uppy文件对象
   * @param {Object} options {uploadId, key}
   * @returns {Promise<Array>} 分片列表
   */
  async listParts(file, { uploadId, key }) {
    try {
      console.log(`[StorageAdapter] listParts被调用: ${file.name}, uploadId: ${uploadId}, key: ${key}`);

      // 始终以服务器返回的状态为准，localStorage 仅作为加速缓存
      console.log(`[StorageAdapter] 回源查询服务器 listMultipartParts`);
      const response = await fsApi.listMultipartParts(key, uploadId, file.name);
      if (!response?.success) {
        throw new Error(response?.message || "listMultipartParts 失败");
      }

      const serverParts = (response.data?.parts || []).map((part) => ({
        PartNumber: part.partNumber ?? part.PartNumber,
        ETag: part.etag ?? part.ETag,
        Size: part.size ?? part.Size ?? 0,
      }));

      // 将服务器状态写入本地缓存，后续 per_part_url 跳过逻辑可以复用
      this.saveUploadedPartsToStorage(key, serverParts);
      console.log(`[StorageAdapter] 服务器返回${serverParts.length}个分片，并已写入缓存`);
      return serverParts;
    } catch (error) {
      console.error("[StorageAdapter] listParts失败:", error);
      return [];
    }
  }

  /**
   * 上传分片字节
   * 控制实际的分片上传过程，在这里处理已上传分片的跳过逻辑
   * @param {Object} options {signature, body, onComplete, size, onProgress, signal}
   * @returns {Promise<Object>} {ETag}
   */
  async uploadPartBytes({ signature, body, onComplete, size, onProgress, signal }) {
    try {
      const { url, headers } = signature;

      if (!url) {
        throw new Error("Cannot upload to an undefined URL");
      }

      console.log(`[StorageAdapter] uploadPartBytes被调用: ${url}`);

      const isSingleSession = signature && signature.strategy === "single_session";

      // 初始从签名中获取分片编号和文件ID（single_session 会显式传递）
      let partNumber = signature && typeof signature.partNumber === "number"
        ? signature.partNumber
        : null;
      let fileId = signature && typeof signature.fileId === "string" ? signature.fileId : null;

      // 解析URL获取key和partNumber（仅对 per_part_url 模式有意义）
      let key = null;
      try {
        const urlObject = new URL(url);
        const pathParts = urlObject.pathname.split("/");
        const storageKey = pathParts.slice(1).join("/"); // 去掉第一个空字符串，获取完整路径
        const partNumberRaw = urlObject.searchParams.get("partNumber");
        if (partNumber == null) {
          partNumber =
            partNumberRaw != null && partNumberRaw !== ""
              ? parseInt(partNumberRaw, 10)
              : null;
        }
        if (storageKey) {
          key = this.buildFullPathFromKey(storageKey);
        }
      } catch {
        // 非 S3 预签名 URL（例如 OneDrive uploadSession），不进行 key/partNumber 解析
        key = null;
      }

      if (partNumber != null) {
        console.log(`[StorageAdapter] 🔄 处理分片${partNumber}上传...`);
      }

      // 针对 single_session（OneDrive 等）执行基于会话状态的跳过逻辑
      if (isSingleSession) {
        const session = fileId ? this.uploadSessions.get(fileId) : null;
        if (
          session &&
          typeof session.completedParts === "number" &&
          session.completedParts > 0 &&
          partNumber != null &&
          partNumber <= session.completedParts
        ) {
          console.log(
            `[StorageAdapter] ✅ single_session 分片${partNumber}已完成，跳过上传（逻辑跳过，不发HTTP请求）`,
          );

          // 模拟一个瞬间完成的上传过程，保持与实际上传一致的回调行为
          return new Promise((resolve) => {
            setTimeout(() => {
              try {
                onProgress(size);
              } catch {}
              const etag = `onedrive-part-${partNumber}`;
              try {
                onComplete(etag);
              } catch {}
              resolve({ ETag: etag });
            }, 0);
          });
        }
      }

      // 针对 per_part_url（S3 等）执行本地缓存与跳过逻辑；single_session 模式不会进入该分支
      if (!isSingleSession && key && partNumber != null) {
        const cachedParts = this.getUploadedPartsFromStorage(key);
        const existingPart = cachedParts.find((part) => part.PartNumber === partNumber);

        if (existingPart) {
          console.log(
            `[StorageAdapter] ✅ 分片${partNumber}已缓存，跳过上传 (ETag: ${existingPart.ETag})`,
          );

          // 模拟一个瞬间完成的上传过程，而不是直接跳过
          return new Promise((resolve) => {
            setTimeout(() => {
              try {
                onProgress(size);
              } catch {}
              try {
                onComplete(existingPart.ETag);
              } catch {}
              resolve({ ETag: existingPart.ETag });
            }, 0);
          });
        }

        // 检查文件是否被自定义暂停（同样仅在 per_part_url 模式下有效）
        const fileId = this.getFileIdFromUrl(url);
        if (fileId && this.isFilePaused(fileId)) {
          console.log(`[StorageAdapter] ⏸️ 分片${partNumber}被暂停，等待恢复...`);

          // 返回一个等待恢复的Promise
          return new Promise((resolve, reject) => {
            const checkResumeInterval = setInterval(() => {
              if (!this.isFilePaused(fileId)) {
                clearInterval(checkResumeInterval);
                console.log(`[StorageAdapter] ▶️ 分片${partNumber}恢复上传`);
                this.uploadPartBytes({
                  signature,
                  body,
                  onComplete,
                  size,
                  onProgress,
                  signal,
                })
                  .then(resolve)
                  .catch(reject);
              }
            }, 100);

            if (signal) {
              signal.addEventListener("abort", () => {
                clearInterval(checkResumeInterval);
                reject(new DOMException("The operation was aborted", "AbortError"));
              });
            }
          });
        }
      }

      // 执行实际的分片上传
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url, true);

        if (headers) {
          Object.keys(headers).forEach((key) => {
            xhr.setRequestHeader(key, headers[key]);
          });
        }

        xhr.responseType = "text";

        // 处理取消信号
        function onabort() {
          xhr.abort();
        }
        function cleanup() {
          if (signal) {
            signal.removeEventListener("abort", onabort);
          }
        }
        if (signal) {
          signal.addEventListener("abort", onabort);
        }

        xhr.onabort = () => {
          cleanup();
          const err = new DOMException("The operation was aborted", "AbortError");
          reject(err);
        };

        const progressHandler = (evt) => {
          try {
            const loaded = evt?.loaded ?? 0;
            const total = evt?.total ?? size;
            onProgress?.({ loaded, total, lengthComputable: true });
          } catch {}
        };
        xhr.upload.addEventListener("progress", progressHandler);

        xhr.addEventListener("load", (ev) => {
          cleanup();
          const target = ev.target;

          if (target.status < 200 || target.status >= 300) {
            // 记录底层返回的详细错误信息，便于调试 OneDrive 等后端预签名直传问题
            try {
              console.error(
                "[StorageAdapter] uploadSingleFile HTTP error",
                {
                  status: target.status,
                  statusText: target.statusText,
                  responseText: target.responseText,
                },
              );
            } catch {}
            const error = new Error(`HTTP ${target.status}: ${target.statusText}`);
            error.source = target;
            reject(error);
            return;
          }

          try { onProgress?.({ loaded: size, total: size, lengthComputable: true }); } catch {}

          // 获取ETag
          let etag = target.getResponseHeader("ETag");

          // 对于 single_session 策略（OneDrive 等），服务器不会返回 ETag 头部，
          // 这里只需要为 Uppy 提供一个占位值即可，后端不会依赖该 ETag 完成合并。
          if (etag === null && isSingleSession) {
            etag = `onedrive-part-${Date.now()}`;
          }

          if (etag === null) {
            reject(
              new Error(
                "Could not read the ETag header. This likely means CORS is not configured correctly.",
              ),
            );
            return;
          }

          // 将成功上传的分片添加到localStorage缓存（仅对 per_part_url 模式有意义）
          if (!isSingleSession && key && partNumber != null) {
            this.addPartToStorage(key, {
              ETag: etag,
              PartNumber: partNumber,
              Size: size,
            });

            console.log(
              `[StorageAdapter] 🚀 分片${partNumber}上传成功，添加到localStorage (ETag: ${etag})`,
            );
          }

          onComplete(etag);
          resolve({ ETag: etag });
        });

        xhr.addEventListener("error", (ev) => {
          cleanup();
          const error = new Error("Upload failed");
          error.source = ev.target;
          reject(error);
        });

        xhr.send(body);
      });
    } catch (error) {
      console.error("[StorageAdapter] uploadPartBytes失败:", error);
      throw error;
    }
  }

  /**
   * 单文件上传 - 使用 XMLHttpRequest 避免 CORS 问题
   * 用于 PRESIGNED_SINGLE 策略,替代 Uppy 默认的 fetch API
   * @param {Object} options {signature, body, onComplete, size, onProgress, signal}
   * @returns {Promise<Object>} {ETag}
   */
  async uploadSingleFile({ signature, body, onComplete, size, onProgress, signal }) {
    try {
      const { url, headers } = signature;

      if (!url) {
        throw new Error("Cannot upload to an undefined URL");
      }

      console.log(`[StorageAdapter] uploadSingleFile 被调用: ${url}`);

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url, true);

        // 设置请求头
        if (headers) {
          Object.keys(headers).forEach((key) => {
            xhr.setRequestHeader(key, headers[key]);
          });
        }

        xhr.responseType = "text";

        // 处理取消信号
        function onabort() {
          xhr.abort();
        }
        function cleanup() {
          if (signal) {
            signal.removeEventListener("abort", onabort);
          }
        }
        if (signal) {
          signal.addEventListener("abort", onabort);
        }

        xhr.onabort = () => {
          cleanup();
          const err = new DOMException("The operation was aborted", "AbortError");
          reject(err);
        };

        // 进度事件
        const progressHandler = (evt) => {
          try {
            const loaded = evt?.loaded ?? 0;
            const total = evt?.total ?? size;
            onProgress?.({ loaded, total, lengthComputable: true });
          } catch {}
        };
        xhr.upload.addEventListener("progress", progressHandler);

        // 上传完成
        xhr.addEventListener("load", (ev) => {
          cleanup();
          const target = ev.target;

          if (target.status < 200 || target.status >= 300) {
            const error = new Error(`HTTP ${target.status}: ${target.statusText}`);
            error.source = target;
            reject(error);
            return;
          }

          try {
            onProgress?.({ loaded: size, total: size, lengthComputable: true });
          } catch {}

          // 获取 ETag
          const etag = target.getResponseHeader("ETag");
          if (etag === null) {
            // 即使读不到 ETag,也不报错,因为文件已经上传成功
            // commit 阶段会由后端通过 HeadObject 获取 ETag
            console.warn("[StorageAdapter] ⚠️ 无法读取 ETag (CORS),将由后端验证");
            onComplete?.(null);
            resolve({ ETag: null });
            return;
          }

          console.log(`[StorageAdapter] ✅ 单文件上传成功 (ETag: ${etag})`);
          onComplete?.(etag);
          resolve({ ETag: etag });
        });

        // 上传失败
        xhr.addEventListener("error", (ev) => {
          cleanup();
          const error = new Error("Upload failed");
          error.source = ev.target;
          reject(error);
        });

        xhr.send(body);
      });
    } catch (error) {
      console.error("[StorageAdapter] uploadSingleFile 失败:", error);
      throw error;
    }
  }

  /**
   * 提交预签名上传完成 - CloudPaste特有功能
   * @param {Object} file Uppy文件对象
   * @param {Object} response 上传响应
   * @returns {Promise<Object>} 提交结果
   */
  async commitPresignedUpload(file, response) {
    try {
      console.log(`[StorageAdapter] 提交预签名上传完成: ${file.name}`);

      // 获取缓存的上传信息
      const uploadInfo = this.uploadSessions.get(file.id);
      if (!uploadInfo) {
        throw new Error("找不到上传会话信息");
      }

      // 从响应中提取ETag（如果有的话）
      const etag = response?.etag || response?.ETag || null;

      // 调用commit接口，使用正确的参数格式
      const commitResponse = await fsApi.commitPresignedUpload(
        {
          targetPath: uploadInfo.targetPath,
          mountId: uploadInfo.mountId,
          fileId: uploadInfo.fileId,
          storagePath: uploadInfo.storagePath,
          publicUrl: uploadInfo.publicUrl,
          storageConfigId: uploadInfo.storageConfigId,
          contentType: uploadInfo.contentType,
        },
        etag,
        uploadInfo.contentType,
        file.size
      );

      if (!commitResponse.success) {
        throw new Error(commitResponse.message || "提交预签名上传失败");
      }

      this.uploadSessions.delete(file.id);

      console.log(`[StorageAdapter] 预签名上传commit成功: ${file.name}`);
      return commitResponse;
    } catch (error) {
      console.error(`[StorageAdapter] 预签名上传commit失败: ${file.name}`, error);
      throw error;
    }
  }

  /**
   * 清理所有上传会话和localStorage分片缓存
   */
  cleanup() {
    this.uploadSessions.clear();
    // 清理所有localStorage中的分片缓存
    this.clearAllUploadedPartsFromStorage();
    console.log(`[StorageAdapter] 清理所有上传会话和localStorage分片缓存`);
  }

  /**
   * 清理所有localStorage中的分片缓存
   */
  clearAllUploadedPartsFromStorage() {
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(this.STORAGE_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
      console.log(`[StorageAdapter] 清理了${keysToRemove.length}个localStorage分片缓存`);
    } catch (error) {
      console.warn(`[StorageAdapter] 清理localStorage失败:`, error);
    }
  }

  /**
   * 从storage key构建完整的挂载点路径
   * @param {string} storageKey 存储的相对路径
   * @returns {string} 完整的挂载点路径
   */
  buildFullPathFromKey(storageKey) {
    return this.pathResolver.buildFullPathFromKey(storageKey);
  }
}
