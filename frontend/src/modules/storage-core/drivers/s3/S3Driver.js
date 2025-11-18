import { api } from "@/api";
import { createCapabilities, STORAGE_STRATEGIES } from "../types.js";
import AwsS3 from "@uppy/aws-s3";
import { StorageAdapter } from "@/modules/storage-core/uppy/StorageAdapter.js";
import XHRUpload from "@uppy/xhr-upload";
import { getFullApiUrl } from "@/api/config.js";
import { buildAuthHeadersForRequest } from "@/modules/security/index.js";

export class S3Driver {
  constructor(config = {}) {
    this.config = config;
    this.capabilities = createCapabilities({
      share: {
        direct: true,
        url: true,
      },
      fs: {
        backendDirect: true,
        presignedSingle: true,
        multipart: true,
      },
    });

    this.share = {
      applyShareUploader: this.applyShareUploader.bind(this),
      applyUrlUploader: this.applyUrlUploader.bind(this),
    };

    this.fs = {
      // 只读辅助：供断点续传插件查询进行中的上传和已上传分片
      listUploads: this.listUploads.bind(this),
      listParts: this.listParts.bind(this),
      // 在 Uppy 实例上安装合适的上传插件（一次性替换方案的统一入口）
      applyFsUploader: this.applyFsUploader.bind(this),
    };
  }

  get storageConfigId() {
    return this.config?.id ?? null;
  }

  // FS --------------------------------------------------------------------
  /**
   * 在给定的 Uppy 实例上安装 FS 上传所需的 Uppy 插件
   * - presigned-single: 使用 AwsS3 + getUploadParameters（单请求 PUT 直传）
   * - presigned-multipart: 使用 AwsS3 多分片 hooks（create/sign/complete/listParts/abort）
   * @param {object} uppy 已创建的 Uppy 实例
   * @param {object} options { strategy, path }
   */
  applyFsUploader(uppy, { strategy, path } = {}) {
    if (!uppy) throw new Error("applyFsUploader 需要提供 Uppy 实例");

    // 后续如需在同一 Uppy 上切换策略，交由上层重新初始化 Uppy
    if (strategy === STORAGE_STRATEGIES.PRESIGNED_SINGLE || strategy === STORAGE_STRATEGIES.PRESIGNED_MULTIPART) {
      const adapter = new StorageAdapter(path || "/", uppy);

      // 多分片：提供完整 hooks；单请求：仅提供 getUploadParameters 并强制 shouldUseMultipart=false
      const isMultipart = strategy === STORAGE_STRATEGIES.PRESIGNED_MULTIPART;
      const awsS3Opts = {
        id: "AwsS3",
        limit: 3,
        shouldUseMultipart: () => isMultipart,
      };

      if (isMultipart) {
        awsS3Opts.getUploadParameters = adapter.getUploadParameters.bind(adapter);
        awsS3Opts.createMultipartUpload = adapter.createMultipartUpload.bind(adapter);
        awsS3Opts.signPart = adapter.signPart.bind(adapter);
        // 为了兼容暂停/恢复期间的分片上传，显式提供 uploadPartBytes，避免走默认 HTTPCommunicationQueue
        awsS3Opts.uploadPartBytes = adapter.uploadPartBytes.bind(adapter);
        awsS3Opts.completeMultipartUpload = adapter.completeMultipartUpload.bind(adapter);
        awsS3Opts.abortMultipartUpload = adapter.abortMultipartUpload.bind(adapter);
        awsS3Opts.listParts = adapter.listParts.bind(adapter);
      } else {
        // 单文件上传:提供 getUploadParameters 和 uploadPartBytes
        // uploadPartBytes 使用 XMLHttpRequest 可以读取 ETag,避免 CORS 错误
        awsS3Opts.getUploadParameters = adapter.getUploadParameters.bind(adapter);
        awsS3Opts.uploadPartBytes = adapter.uploadSingleFile.bind(adapter);
      }

      uppy.use(AwsS3, awsS3Opts);
      return {
        adapter,
        mode: isMultipart ? STORAGE_STRATEGIES.PRESIGNED_MULTIPART : STORAGE_STRATEGIES.PRESIGNED_SINGLE,
      };
    }

    // S3 后端直传：通过后端网关 /fs/upload 直传（非分片），由 XHRUpload 承载
    if (strategy === STORAGE_STRATEGIES.S3_BACKEND_DIRECT) {
      const headers = buildAuthHeadersForRequest({});

      // 统一注入 path / use_multipart 到所有文件的 meta
      try { uppy.setMeta({ path: path || "/", use_multipart: "false" }); } catch {}

      uppy.use(XHRUpload, {
        id: "S3BackendDirect",
        endpoint: getFullApiUrl("/fs/upload"),
        method: "POST",
        formData: true,
        fieldName: "file",
        limit: 3,
        allowedMetaFields: ["path", "use_multipart"],
        headers,
        // 保持 Uppy 默认响应解析；后端完成最终 commit
      });
      return {
        adapter: null,
        mode: STORAGE_STRATEGIES.S3_BACKEND_DIRECT,
      };
    }

    // 其它驱动若需要自定义实现，可在各自 Driver 层安装插件；此处默认仅处理 S3 系列策略
    return null;
  }

  /**
   * 在 Uppy 上安装用于“文件分享（本地）”的一致上传实现（一次性替换版）
   * - 统一走 AwsS3 单请求（getUploadParameters），暂停=取消、恢复=重传
   * - 在 'upload-success' 内部完成 share/commit
   * @param {object} uppy Uppy 实例
   * @param {object} options { payload }
   */
  applyShareUploader(uppy, { payload, onShareRecord } = {}) {
    if (!uppy) throw new Error("applyShareUploader 需要提供 Uppy 实例");

    const basePayload = this.#withStorageConfig(payload || {});
    const pluginId = "AwsS3Share";

    // 避免重复安装
    if (uppy.getPlugin(pluginId)) return;

    // 创建 StorageAdapter 实例用于单文件上传(使用 XMLHttpRequest 避免 CORS)
    const adapter = new StorageAdapter("/", uppy);

    uppy.use(AwsS3, {
      id: pluginId,
      shouldUseMultipart: () => false,
      limit: 3,
      getUploadParameters: async (file) => {
        // 合并 per-file meta 覆盖（例如 slug）
        const meta = file?.meta || {};
        const merged = {
          ...basePayload,
          slug: meta.slug ?? basePayload.slug,
          path: meta.path ?? basePayload.path,
        };

        const presign = await api.file.getUploadPresignedUrl({
          storage_config_id: merged.storage_config_id,
          filename: meta.filename || file.name,
          mimetype: file.type || "application/octet-stream",
          path: merged.path,
          size: file.size,
        });

        if (!presign?.success || !presign?.data) {
          throw new Error(presign?.message || "获取预签名URL失败");
        }

        const data = presign.data;
        const uploadUrl = data.uploadUrl || data.upload_url;
        // 持久化 commit 所需元数据
        try {
          uppy.setFileMeta(file.id, {
            key: data.key,
            storage_config_id: data.storage_config_id || merged.storage_config_id,
            filename: data.filename || meta.filename || file.name,
            path: merged.path,
            slug: merged.slug,
            password: basePayload.password || meta.password || null,
            expires_in: basePayload.expires_in,
            max_views: basePayload.max_views,
          });
        } catch {}

        return {
          method: "PUT",
          url: uploadUrl,
          headers: data.headers || {},
        };
      },
      // 使用 XMLHttpRequest 避免 CORS 问题
      uploadPartBytes: adapter.uploadSingleFile.bind(adapter),
    });

    // 在成功后执行 commit
    const onSuccess = async (file) => {
      const meta = file?.meta || {};
      try {
        const commitRes = await api.file.completeFileUpload({
          key: meta.key,
          storage_config_id: meta.storage_config_id,
          filename: meta.filename || file.name,
          size: file.size,
          etag: undefined, // ETag 可能因 CORS 不可用，后端兼容
          slug: meta.slug,
          remark: basePayload.remark,
          password: basePayload.password,
          expires_in: basePayload.expires_in,
          max_views: basePayload.max_views,
          use_proxy: basePayload.use_proxy,
          original_filename: basePayload.original_filename ?? false,
          path: meta.path,
        });
        // 暴露 fileId 以便上层需要时可读取
        if (commitRes?.data) {
          const shareRecord = commitRes.data;
          console.debug("[ShareUploader] commit result", shareRecord);
          try {
            uppy.setFileMeta(file.id, {
              fileId: shareRecord.id,
              shareRecord,
            });
          } catch {}
          try {
            uppy.emit("share-record", { file, shareRecord });
          } catch {}
          try {
            onShareRecord?.({ file, shareRecord });
          } catch {}
        }
      } catch (e) {
        // 发出错误事件以便 UI 感知
        try { uppy.emit('upload-error', file, e); } catch {}
      }
    };

    // 避免重复绑定
    uppy.on('upload-success', onSuccess);
  }

  /**
   * URL 分享：使用 urlUpload presign + AwsS3 单请求 + 在 'upload-success' 提交 commitUrlUpload
   */
  applyUrlUploader(uppy, { payload, onShareRecord } = {}) {
    if (!uppy) throw new Error("applyUrlUploader 需要提供 Uppy 实例");
    const basePayload = this.#withStorageConfig(payload || {});
    const pluginId = "AwsS3UrlShare";
    if (uppy.getPlugin(pluginId)) return;

    // 创建 StorageAdapter 实例用于单文件上传(使用 XMLHttpRequest 避免 CORS)
    const adapter = new StorageAdapter("/", uppy);

    uppy.use(AwsS3, {
      id: pluginId,
      shouldUseMultipart: () => false,
      limit: 3,
      getUploadParameters: async (file) => {
        const meta = file?.meta || {};
        const merged = {
          ...basePayload,
          slug: meta.slug ?? basePayload.slug,
          path: meta.path ?? basePayload.path,
        };
        const presign = await api.urlUpload.getUrlUploadPresignedUrl({
          url: meta.sourceUrl || meta.url, // 允许从 meta 获取源URL
          storage_config_id: merged.storage_config_id,
          path: merged.path,
          filename: meta.filename || file.name,
          contentType: file.type || "application/octet-stream",
          fileSize: file.size,
        });
        if (!presign?.success || !presign?.data) throw new Error(presign?.message || "获取URL上传预签名失败");
        const responseData = presign.data || {};
        const presignData = responseData.presign || responseData;
        const commitSuggestion = responseData.commit_suggestion || responseData.commitSuggestion || {};
        const uploadUrl = presignData.uploadUrl || presignData.upload_url;
        const resolvedKey = commitSuggestion.key || presignData.key;
        const resolvedStorageConfigId = commitSuggestion.storage_config_id || presignData.storage_config_id || merged.storage_config_id;
        const resolvedFilename = commitSuggestion.filename || presignData.filename || meta.filename || file.name;
        if (!uploadUrl || !resolvedKey || !resolvedStorageConfigId) {
          throw new Error("URL上传预签名缺少必要的 key 或上传地址");
        }
        try {
          uppy.setFileMeta(file.id, {
            key: resolvedKey,
            storage_config_id: resolvedStorageConfigId,
            filename: resolvedFilename,
            path: merged.path,
            slug: merged.slug,
            remark: merged.remark,
            password: merged.password,
            expires_in: merged.expires_in,
            max_views: merged.max_views,
          });
        } catch {}
        return { method: "PUT", url: uploadUrl, headers: presignData.headers || {} };
      },
      // 使用 XMLHttpRequest 避免 CORS 问题
      uploadPartBytes: adapter.uploadSingleFile.bind(adapter),
    });

    const onSuccess = async (file) => {
      const meta = file?.meta || {};
      try {
        const commitRes = await api.urlUpload.commitUrlUpload({
          key: meta.key,
          storage_config_id: meta.storage_config_id,
          filename: meta.filename || file.name,
          size: file.size,
          etag: undefined,
          path: meta.path,
          slug: meta.slug,
          remark: meta.remark ?? basePayload.remark,
          password: meta.password ?? basePayload.password,
          expires_in: meta.expires_in ?? basePayload.expires_in,
          max_views: meta.max_views ?? basePayload.max_views,
        });
        if (commitRes?.data) {
          const shareRecord = commitRes.data;
          console.debug("[UrlShareUploader] commit result", shareRecord);
          try {
            uppy.setFileMeta(file.id, {
              fileId: shareRecord.id,
              shareRecord,
            });
          } catch {}
          try {
            uppy.emit("share-record", { file, shareRecord });
          } catch {}
          try {
            onShareRecord?.({ file, shareRecord });
          } catch {}
        }
      } catch (e) {
        try { uppy.emit('upload-error', file, e); } catch {}
      }
    };
    uppy.on('upload-success', onSuccess);
  }

  // Read-only helpers for resume plugin -------------------------------------
  async listUploads({ path } = {}) {
    // 后端接受目录或空字符串，返回该作用域下的未完成上传
    return api.fs.listMultipartUploads(path || "");
  }

  async listParts({ path, uploadId, fileName }) {
    // path 为文件完整路径，后端使用它定位资源；同时需要 uploadId 和 fileName
    return api.fs.listMultipartParts(path, uploadId, fileName);
  }

  // Helpers ---------------------------------------------------------------
  #withStorageConfig(payload) {
    if (payload?.storage_config_id) {
      return payload;
    }
    if (!this.storageConfigId) {
      throw new Error("缺少 storage_config_id，可在 payload 中指定或配置默认值");
    }
    return { ...payload, storage_config_id: this.storageConfigId };
  }
}

export const SUPPORTED_STRATEGIES = [
  STORAGE_STRATEGIES.S3_BACKEND_DIRECT,
  STORAGE_STRATEGIES.PRESIGNED_SINGLE,
  STORAGE_STRATEGIES.PRESIGNED_MULTIPART,
];
