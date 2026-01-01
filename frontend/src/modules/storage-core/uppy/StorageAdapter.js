/**
 * StorageAdapter for Uppy.js
 * 内部模块化，保持对外API不变
 */

import { useAuthStore } from "@/stores/authStore.js";
import * as fsApi from "@/api/services/fsService.js";
import { API_BASE_URL } from "@/api/config.js";
import { sha256HexFromBlob } from "@/utils/sha256.js";
import { createLogger } from "@/utils/logger.js";
import { createPartsLedger, clearAllClientLedgers } from "./storage-adapter/multipart/partsLedger.js";
import { SessionManager, AuthProvider, PathResolver, ErrorHandler } from "./storage-adapter/tools.js";
import { createMultipartUpload as createMultipartUploadImpl } from "./storage-adapter/multipartCreate.js";
import { signPart as signPartImpl, uploadPartBytes as uploadPartBytesImpl } from "./storage-adapter/multipartTransfer.js";

// @uppy/aws-s3 的 getChunkSize() 回调拿到的是 file.data（Blob/File）
// 需要一个 Blob -> fileId 的映射，才能从 blob 反查到 meta.cloudpasteMultipartChunkSize。
const BLOB_FILE_ID_MAP_KEY = Symbol.for("cloudpaste.uppy.blobFileIdMap");
const BLOB_FILE_ID_MAP_BOUND_KEY = Symbol.for("cloudpaste.uppy.blobFileIdMap.bound");
const log = createLogger("StorageAdapter");

/**
 * 分片上传（multipart）前端的两种模式（配合后端 driver 返回的 strategy）
 *
 * 1) per_part_url（前端直传到上游）
 * - init：POST /api/fs/multipart/init → 返回 presignedUrls + partSize
 * - upload：浏览器对每个 presignedUrl 做 PUT，成功后从响应头拿 ETag
 * - complete：POST /api/fs/multipart/complete（把 parts[{PartNumber,ETag}] 交给后端）
 * - 进度/账本：
 *   - A（server_can_list，例如 S3）：服务端可从上游 ListParts 得到已上传分片
 *   - B（client_keeps，例如 HuggingFace）：浏览器 localStorage 作为“续传真相源”，complete 时一次性提交完整 parts
 *   - C（server_records，例如 Telegram）：分片经过后端，后端可以自己记录（需要的话写 DB）
 *
 * 2) single_session（前端切片 + 后端中转到上游）
 * - init：POST /api/fs/multipart/init → 返回 session.uploadUrl（一般是 /api/fs/multipart/upload-chunk?upload_id=...）
 * - upload：浏览器把每片 PUT 到 CloudPaste，后端转发到上游（Drive/OneDrive/Telegram 等）
 * - 进度记录：后端天然知道进度（可以按需记录）
 *
 */

// ===== 内部工具类=====

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
      requireSha256ForPresign: options.requireSha256ForPresign === true,
      // 分片预初始化：在真正开始上传前，先请求一次 /fs/multipart/init 拿到“真实 partSize”，
      // 然后把 chunkSize 写入 file.meta，让 Uppy(AwsS3) 用正确的大小切片”。
      enableMultipartPreinit: options.enableMultipartPreinit === true,
      onError: options.onError,
      ...options,
    };

    // 基本属性
    this.currentPath = currentPath;
    this.uppyInstance = uppyInstance;
    this.STORAGE_PREFIX = this.config.storagePrefix;

    // 初始化内部模块
    this.sessionManager = new SessionManager(this.config);
    this.authProvider = new AuthProvider(useAuthStore());
    this.pathResolver = new PathResolver(currentPath);
    this.errorHandler = new ErrorHandler(this.config);

    // 向后兼容的属性
    this.uploadSessions = this.sessionManager.sessions;
    this.customPausedFiles = this.sessionManager.pausedFiles;
    this.authStore = this.authProvider.authStore;

    // 可选：安装“分片预初始化”预处理器
    this._multipartPreinitInstalled = false;
    this._multipartPreinitCacheKey = "cloudpasteMultipartInit";
    this._multipartChunkSizeKey = "cloudpasteMultipartChunkSize";
    this._multipartPreinit = this._multipartPreinit.bind(this);
    this._ensureBlobFileIdMap();
    if (this.config.enableMultipartPreinit && this.uppyInstance) {
      this.installMultipartPreinit();
    }
  }

  /**
   * 维护一个 Blob/File -> Uppy fileId 的 WeakMap
   * - 解决 AwsS3.getChunkSize(blob) 无法直接拿到 file.meta 的问题
   * - 这个映射挂在 uppyInstance 上，避免多个 StorageAdapter 重复绑定事件
   */
  _ensureBlobFileIdMap() {
    const uppy = this.uppyInstance;
    if (!uppy) return null;

    if (!uppy[BLOB_FILE_ID_MAP_KEY]) {
      uppy[BLOB_FILE_ID_MAP_KEY] = new WeakMap();
    }
    const map = uppy[BLOB_FILE_ID_MAP_KEY];

    // 只绑定一次事件
    if (!uppy[BLOB_FILE_ID_MAP_BOUND_KEY]) {
      uppy[BLOB_FILE_ID_MAP_BOUND_KEY] = true;
      uppy.on?.("file-added", (file) => {
        try {
          if (file?.data && typeof file.data === "object") {
            map.set(file.data, file.id);
          }
        } catch {}
      });
      uppy.on?.("file-removed", (file) => {
        try {
          if (file?.data && typeof file.data === "object") {
            map.delete(file.data);
          }
        } catch {}
      });
    }

    // 兜底：如果 adapter 创建时 Uppy 已经有文件了，补一遍映射
    try {
      const files = typeof uppy.getFiles === "function" ? uppy.getFiles() : [];
      for (const f of files) {
        if (f?.data && typeof f.data === "object" && f?.id) {
          map.set(f.data, f.id);
        }
      }
    } catch {}

    return map;
  }

  /**
   * @uppy/aws-s3 的 getChunkSize(data) 使用：
   * - data 是 Blob/File
   * - 需要反查到 Uppy file，然后读 meta.cloudpasteMultipartChunkSize
   * @param {any} data Blob/File
   * @returns {number} chunkSize（字节）
   */
  getChunkSizeForAwsS3(data) {
    try {
      if (!data || typeof data !== "object") return this.config.partSize || 5 * 1024 * 1024;
      const uppy = this.uppyInstance;
      if (!uppy) return this.config.partSize || 5 * 1024 * 1024;

      const map = uppy[BLOB_FILE_ID_MAP_KEY];
      const fileId = map?.get?.(data);
      if (!fileId) return this.config.partSize || 5 * 1024 * 1024;

      const uppyFile = typeof uppy.getFile === "function" ? uppy.getFile(fileId) : null;
      const n = Number(uppyFile?.meta?.[this._multipartChunkSizeKey]);
      if (Number.isFinite(n) && n > 0) return Math.floor(n);

      // 断点续传：优先使用服务器会话的 partSize（listUploads 返回 existingUpload）
      const resumePartSize = Number(uppyFile?.meta?.existingUpload?.partSize);
      if (Number.isFinite(resumePartSize) && resumePartSize > 0) {
        return Math.floor(resumePartSize);
      }

      return this.config.partSize || 5 * 1024 * 1024;
    } catch {
      return this.config.partSize || 5 * 1024 * 1024;
    }
  }

  /**
   * 创建“分片账本”（PartsLedger）
   * 统一管理已上传分片
   */
  _createPartsLedger(policy, storageKey) {
    return createPartsLedger({
      policy: policy || null,
      storageKey,
      storagePrefix: this.config.storagePrefix,
      cacheExpiry: this.config.cacheExpiry,
    });
  }

  /**
   * 安装分片预初始化预处理器
   * - 只在“前端直传分片（per_part_url）”模式下需要：S3/HuggingFace
   * - 目的：提前拿到后端返回的 partSize，并写到 file.meta 上（再由 getChunkSizeForAwsS3(blob) 反查读取）
   */
  installMultipartPreinit() {
    if (!this.uppyInstance || this._multipartPreinitInstalled) return;
    try {
      this.uppyInstance.addPreProcessor(this._multipartPreinit);
      this._multipartPreinitInstalled = true;
    } catch (e) {
      log.warn("[StorageAdapter] 安装 multipart 预初始化预处理器失败（可忽略）:", e?.message || e);
    }
  }

  /**
   * 分片预初始化（Uppy preProcessor）
   * - 在 AwsS3 构造 MultipartUploader 前执行
   * - 写入 file.meta.cloudpasteMultipartInit + file.meta.cloudpasteMultipartChunkSize
   */
  async _multipartPreinit(fileIDs = []) {
    if (!this.config.enableMultipartPreinit || !this.uppyInstance) return;

    const promises = (fileIDs || []).map(async (fileID) => {
      const file = this.uppyInstance.getFile(fileID);
      if (!file) return;

      // 只处理本地文件（remote 不走这里）
      const blob = file?.data instanceof Blob ? file.data : null;
      if (!blob) return;

      const meta = file?.meta || {};

      // 断点续传：如果 ServerResumePlugin 已经标记了 existingUpload，
      // 把原会话的 partSize 写入 blob，让 Uppy 按同样大小切片即可。
      if (meta?.resumable && meta?.existingUpload && meta?.serverResume) {
        const existing = meta.existingUpload;
        const existingPartSize = Number(existing?.partSize ?? existing?.part_size ?? 0);
        if (Number.isFinite(existingPartSize) && existingPartSize > 0) {
          try {
            this.uppyInstance.setFileMeta(fileID, { [this._multipartChunkSizeKey]: Math.floor(existingPartSize) });
          } catch {}
        }
        return;
      }

      const cached = meta?.[this._multipartPreinitCacheKey];
      if (cached && typeof cached === "object" && cached.uploadId) {
        const cachedSize = Number(cached.partSize || cached.part_size || meta?.[this._multipartChunkSizeKey] || 0);
        if (Number.isFinite(cachedSize) && cachedSize > 0) {
          try {
            this.uppyInstance.setFileMeta(fileID, { [this._multipartChunkSizeKey]: Math.floor(cachedSize) });
          } catch {}
        }
        return;
      }

      // 需要 sha256 的场景
      let sha256 = null;
      if (this.config.requireSha256ForPresign) {
        if (typeof meta?.cloudpasteSha256 === "string" && meta.cloudpasteSha256) {
          sha256 = meta.cloudpasteSha256;
        } else if (typeof meta?.sha256 === "string" && meta.sha256) {
          sha256 = meta.sha256;
        } else {
          throw new Error("分片上传预初始化失败：缺少 sha256（请先等待 SHA-256 计算完成）");
        }
        if (!sha256) {
          throw new Error("分片上传预初始化失败：缺少 sha256（HuggingFace 需要先算 sha256 才能拿到分片URL）");
        }
      }

      const initMessage = "初始化上传会话（获取分片参数）...";
      try {
        this.uppyInstance.emit("preprocess-progress", file, {
          mode: "indeterminate",
          message: initMessage,
          value: 0,
        });
      } catch {}

      let response;
      try {
        response = await fsApi.initMultipartUpload(
          this.currentPath,
          file.name,
          file.size,
          file.type,
          this.config.partSize || 5 * 1024 * 1024,
          sha256 ? { sha256 } : {},
        );
      } finally {
        try {
          this.uppyInstance.emit("preprocess-complete", file);
        } catch {}
      }

      if (!response?.success) {
        throw new Error(response?.message || "分片上传预初始化失败：initMultipartUpload 返回失败");
      }

      const init = response.data || {};
      const chunkSize = Number(init.partSize || init.part_size || 0);
      if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
        throw new Error("分片上传预初始化失败：后端没有返回有效的 partSize");
      }

      this.uppyInstance.setFileMeta(fileID, {
        [this._multipartPreinitCacheKey]: init,
        [this._multipartChunkSizeKey]: chunkSize,
      });
    });

    await Promise.all(promises);
  }

  /**
   * 设置Uppy实例引用
   * @param {Object} uppyInstance Uppy实例
   */
  setUppyInstance(uppyInstance) {
    this.uppyInstance = uppyInstance;
    this._ensureBlobFileIdMap();
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
      ...this.sessionManager.getStats(),
    };
  }

  /**
   * 获取某个文件的上传会话信息（用于 UI 提示 / commit 阶段 / 调试）。
   * 注意：这里返回的是“本次上传流程”的会话，不代表存储侧的真实状态。
   * @param {string} fileId
   * @returns {any|null}
   */
  getUploadSession(fileId) {
    return this.uploadSessions.get(fileId) || null;
  }

  /**
   * 判断某个文件是否触发了“跳过上传”（例如：对象存储侧已存在内容，秒传/去重）。
   * @param {string} fileId
   * @returns {boolean}
   */
  isUploadSkipped(fileId) {
    const session = this.getUploadSession(fileId);
    return session?.skipUpload === true;
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

    log.debug(`开始批量commit ${successfulFiles.length} 个文件`);
    const failures = [];

    // 并发处理commit，提高性能
    const commitPromises = successfulFiles.map(async (file) => {
      try {
        await this.commitPresignedUpload(file, file.response);
        return { file, success: true };
      } catch (error) {
        log.error(`[StorageAdapter] ❌ commit失败: ${file.name}`, error);
        failures.push({
          fileName: file.name,
          fileId: file.id,
          error: error instanceof Error ? error.message : String(error),
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

    log.debug(`批量commit完成: ${successCount}成功, ${failureCount}失败`);

    if (failures.length > 0) {
      log.warn(`[StorageAdapter] commit失败详情:`, failures);
    }

    return {
      failures,
      successCount,
      failureCount,
      totalCount: successfulFiles.length,
    };
  }

  /**
   * 从 Uppy 的 response 里尽量提取 ETag
   * - ETag 在后端 commit 阶段是可选的：拿不到也不要阻断上传完成
   * @param {any} uploadResponse
   * @returns {string|null}
   */
  _extractEtagFromUploadResponse(uploadResponse) {
    try {
      // 允许直接传字符串
      if (typeof uploadResponse === "string") {
        const s = uploadResponse.trim();
        return s ? s : null;
      }

      const candidates = [
        uploadResponse?.etag,
        uploadResponse?.ETag,
        uploadResponse?.headers?.etag,
        uploadResponse?.headers?.ETag,
        uploadResponse?.body?.etag,
        uploadResponse?.body?.ETag,
        uploadResponse?.body?.headers?.etag,
        uploadResponse?.body?.headers?.ETag,
      ];

      for (const value of candidates) {
        if (typeof value === "string") {
          const s = value.trim();
          if (s) return s;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * 预签名单文件上传（presigned-single）的 commit 阶段
   * - 前端 PUT 直传完成后，还需要调用后端 /api/fs/presign/commit 做“登记/落库/刷新目录缓存”
   * - HuggingFace LFS 场景：commit 需要 sha256（oid），ETag 不强依赖
   * @param {Object} file Uppy file
   * @param {any} uploadResponse Uppy file.response
   */
  async commitPresignedUpload(file, uploadResponse) {
    const fileId = file?.id;
    if (!fileId) {
      throw new Error("提交预签名上传失败：缺少 file.id");
    }

    const session = this.uploadSessions.get(fileId);
    if (!session) {
      throw new Error("提交预签名上传失败：找不到上传会话信息（可能已被清理）");
    }

    const targetPath = session?.targetPath;
    const mountId = session?.mountId;
    if (!targetPath || !mountId) {
      throw new Error("提交预签名上传失败：缺少 targetPath 或 mountId");
    }

    const contentType = session?.contentType || file?.type || "application/octet-stream";
    const fileSize = Number(file?.size ?? 0);

    // ETag：优先使用 uploadPartBytes 里缓存到 session 的值；再尝试从 uploadResponse 里解析；最后允许为空
    let etag = null;
    if (session?.skipUpload === true) {
      etag = null;
    } else if (typeof session?.etag === "string" && session.etag.trim()) {
      etag = session.etag.trim();
    } else {
      etag = this._extractEtagFromUploadResponse(uploadResponse);
    }

    const uploadInfo = {
      targetPath,
      mountId,
      storageConfigId: session?.storageConfigId ?? null,
      fileId: session?.fileId ?? null,
      storagePath: session?.storagePath ?? null,
      sha256: session?.sha256 ?? null,
    };

    const response = await fsApi.commitPresignedUpload(uploadInfo, etag, contentType, fileSize);
    if (!response?.success) {
      throw new Error(response?.message || "提交预签名上传失败");
    }

    // commit 成功后清理会话
    this.uploadSessions.delete(fileId);

    return response?.data || response;
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
      log.debug(`获取预签名URL上传参数: ${file.name}`);

      const requireSha256ForPresign = this.config.requireSha256ForPresign === true;
      const blob = file?.data instanceof Blob ? file.data : null;
      const metaSha256 =
        (typeof file?.meta?.cloudpasteSha256 === "string" && file.meta.cloudpasteSha256) ||
        (typeof file?.meta?.sha256 === "string" && file.meta.sha256) ||
        null;
      // sha256 取值顺序：
      // 1) Uppy preprocess 写入的 file.meta.cloudpasteSha256（最推荐）
      // 2) 兜底：本次直接用 blob 现算一次
      let sha256 = null;
      if (requireSha256ForPresign) {
        if (typeof metaSha256 === "string" && metaSha256) {
          sha256 = metaSha256;
        } else if (blob) {
          sha256 = await sha256HexFromBlob(blob);
        }
        if (!sha256) {
          throw new Error("预签名上传需要 sha256，但当前文件无法计算 sha256（请重试或换一种上传方式）");
        }
      }

      const response = await fsApi.getPresignedUploadUrl(
        this.currentPath,
        file.name,
        file.type,
        file.size,
        sha256,
      );

      if (!response.success) {
        throw new Error(response.message || "获取预签名URL失败");
      }

      const data = response.data || {};

      // 对“需要 sha256 的预签名上传”，后端必须回传 sha256（便于 commit 阶段对齐）
      if (requireSha256ForPresign && (!data.sha256 || typeof data.sha256 !== "string")) {
        throw new Error("预签名上传失败：后端没有返回 sha256（无法进入 commit 阶段）");
      }

      // 统一一次 sha256 的“最终值”（用于 commit / UI 展示）
      let canonicalSha256 = null;
      if (typeof data.sha256 === "string" && data.sha256) {
        canonicalSha256 = data.sha256;
      } else if (typeof sha256 === "string" && sha256) {
        canonicalSha256 = sha256;
      } else if (typeof metaSha256 === "string" && metaSha256) {
        canonicalSha256 = metaSha256;
      }

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
        sha256: canonicalSha256,
        skipUpload: data.skipUpload === true,
      });

      // 用于 UI 在上传完成后统计“跳过上传（秒传/去重）”数量
      try {
        if (this.uppyInstance) {
          this.uppyInstance.setFileMeta(file.id, { cloudpasteSkipUpload: data.skipUpload === true });
        }
      } catch {}

      const baseHeaders = data.headers || {};
      const headers = {
        "Content-Type": baseHeaders["Content-Type"] || file.type || "application/octet-stream",
        ...baseHeaders,
      };

      const skipUpload = data.skipUpload === true;

      // HuggingFace LFS “去重”场景：上游可能不给 uploadUrl（表示对象已存在，无需再次上传）
      if (skipUpload) {
        headers["x-cloudpaste-skip-upload"] = "1";
      }

      return {
        method: "PUT",
        url: skipUpload ? `${API_BASE_URL}/__uppy_skip_upload__` : data.presignedUrl,
        fields: {},
        headers,
        skipUpload,
        fileId: file.id,
      };
    } catch (error) {
      log.error("[StorageAdapter] 获取预签名URL上传参数失败:", error);
      throw error;
    }
  }

  /**
   * 创建分片上传
   * @param {Object} file Uppy文件对象
   * @returns {Promise<Object>} {uploadId, key}
   */
  async createMultipartUpload(file) {
    return createMultipartUploadImpl.call(this, file);
  }

  /**
   * 签名分片
   * @param {Object} file Uppy文件对象
   * @param {Object} partData 分片数据 {uploadId, key, partNumber, body}
   * @returns {Promise<Object>} {url, headers}
   */
  async signPart(file, partData) {
    return signPartImpl.call(this, file, partData);
  }

  /**
   * 完成分片上传
   * @param {Object} file Uppy文件对象
   * @param {Object} data {uploadId, key, parts}
   * @returns {Promise<Object>} {location}
   */
  async completeMultipartUpload(file, data) {
    try {
      log.debug(`完成分片上传: ${file.name}`);

      const session = this.uploadSessions.get(file.id);
      if (!session) {
        throw new Error("找不到上传会话信息");
      }

      const incomingParts = Array.isArray(data?.parts) ? data.parts : [];
      let partsToSend = incomingParts;

      // HuggingFace LFS 去重：skipUpload=true 表示对象已存在，不需要真实上传，也不需要 ETag。
      // 后端会基于 session.provider_meta.skipUpload 跳过 multipart completion，只做 lfsFile commit 并标记会话 completed。
      if (session?.skipUpload === true) {
        partsToSend = [];
      }

      // per_part_url：complete 必须提交完整 parts（PartNumber + ETag）。
      // - client_keeps：刷新页面后 Uppy 只知道“本次页面上传的 parts”，必须和本地账本合并
      // - server_can_list：断点续传时 Uppy 也可能只带“本次页面上传的 parts”，需要合并“恢复时已存在的分片”
      try {
        if (session?.skipUpload !== true && session?.key) {
          const storageKey = String(session.key || "").replace(/^\/+/, "");
          const partsLedger =
            session?.partsLedger || this._createPartsLedger(session?.policy || null, storageKey);
          if (!session.partsLedger) session.partsLedger = partsLedger;
          try {
            await partsLedger.load?.();
          } catch {}

          const mergedAll = partsLedger.mergeIncomingParts(incomingParts);
          const completeParts = (Array.isArray(mergedAll) ? mergedAll : [])
            .filter((p) => typeof p?.ETag === "string" && p.ETag.length > 0)
            .map((p) => ({ PartNumber: Number(p.PartNumber), ETag: p.ETag }))
            .filter((p) => Number.isFinite(p.PartNumber) && p.PartNumber > 0);

          if (completeParts.length > 0) {
            partsToSend = completeParts;
          } else if (Array.isArray(mergedAll) && mergedAll.length > 0) {
            throw new Error("完成分片上传失败：本地账本里缺少 ETag（请重试或重新开始上传）");
          }
        }
      } catch (e) {
        throw e;
      }

      const response = await fsApi.completeMultipartUpload(
        session.path,
        data.uploadId,
        partsToSend,
        session.fileName,
        file.size,
      );

      if (!response.success) {
        throw new Error(response.message || "完成分片上传失败");
      }

      // 清理上传会话和分片缓存
      this.uploadSessions.delete(file.id);
      try {
        session?.partsLedger?.clearPersistent?.();
      } catch {}

      return {
        location: response.data.url || `${session.path}/${session.fileName}`,
      };
    } catch (error) {
      log.error("[StorageAdapter] 完成分片上传失败:", error);
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
      log.debug(`中止分片上传: ${file.name}`);

      const session = this.uploadSessions.get(file.id);
      if (session) {
        await fsApi.abortMultipartUpload(session.path, data.uploadId, session.fileName);
        // 清理上传会话和分片缓存
        this.uploadSessions.delete(file.id);
        try {
          session?.partsLedger?.clearPersistent?.();
        } catch {}
      }
    } catch (error) {
      log.error("[StorageAdapter] 中止分片上传失败:", error);
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
      log.debug(`listParts被调用: ${file.name}, uploadId: ${uploadId}, key: ${key}`);

      // key 是 storageKey（无前导 /），API 的 path 是 fsPath（以 / 开头）
      const storageKey = String(key || "").replace(/^\/+/, "");
      const fsPath = this.buildFullPathFromKey(storageKey);

      const session = this.uploadSessions.get(file.id) || null;
      const basePolicy = session?.policy || null;

      // client_keeps 会持久化；其它只用内存（避免 S3 写 localStorage）
      let partsLedger = session?.partsLedger || this._createPartsLedger(basePolicy, storageKey);
      if (session && !session.partsLedger) session.partsLedger = partsLedger;
      try {
        await partsLedger.load?.();
      } catch {}

      // client_keeps：服务端 list-parts 永远是空，直接信本地账本
      if (partsLedger.ledgerPolicy === "client_keeps") {
        const cached = partsLedger.toAwsPartsArray();
        log.debug(`client_keeps：使用本地账本（${cached.length}片）`);
        return cached;
      }

      log.debug(`回源查询服务器 listMultipartParts`);
      const response = await fsApi.listMultipartParts(fsPath, uploadId, file.name);
      if (!response?.success) {
        throw new Error(response?.message || "listMultipartParts 失败");
      }

      // 服务端回传 policy 时：如果是 client_keeps，就切换到本地账本
      const policyFromServer = response?.data?.policy || null;
      const ledgerPolicyFromServerRaw =
        policyFromServer?.partsLedgerPolicy ?? policyFromServer?.parts_ledger_policy ?? null;
      const ledgerPolicyFromServer = String(ledgerPolicyFromServerRaw || "");

      if (ledgerPolicyFromServer === "client_keeps") {
        partsLedger = this._createPartsLedger(policyFromServer, storageKey);
        try {
          await partsLedger.load?.();
        } catch {}
        if (session) session.partsLedger = partsLedger;
        const cached = partsLedger.toAwsPartsArray();
        log.debug(`client_keeps：服务端标记后切换到本地账本（${cached.length}片）`);
        return cached;
      }

      const serverParts = Array.isArray(response?.data?.parts) ? response.data.parts : [];
      partsLedger.replaceAll(serverParts);
      const normalized = partsLedger.toAwsPartsArray();
      log.debug(`服务器返回${normalized.length}个分片（已写入内存账本）`);
      return normalized;
    } catch (error) {
      log.error("[StorageAdapter] listParts失败:", error);
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
    return uploadPartBytesImpl.call(this, { signature, body, onComplete, size, onProgress, signal });
  }

  /**
   * 单文件直传（presigned-single）适配
   */
  async uploadSingleFile({ signature, body, onComplete, size, onProgress, signal }) {
    return await this.uploadPartBytes({ signature, body, onComplete, size, onProgress, signal });
  }

  cleanup() {
    this.uploadSessions.clear();
    const removed = clearAllClientLedgers({ storagePrefix: this.config.storagePrefix });
    log.debug(`清理所有上传会话与客户端账本：removed=${removed}`);
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
