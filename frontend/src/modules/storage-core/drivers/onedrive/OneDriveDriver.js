import XHRUpload from "@uppy/xhr-upload";
import AwsS3 from "@uppy/aws-s3";
import { api } from "@/api";
import { createCapabilities, STORAGE_STRATEGIES } from "../types.js";
import { getFullApiUrl } from "@/api/config.js";
import { buildAuthHeadersForRequest } from "@/modules/security/index.js";
import { StorageAdapter } from "@/modules/storage-core/uppy/StorageAdapter.js";

/**
 * OneDriveDriver
 *
 */
export class OneDriveDriver {
  constructor(config = {}) {
    this.config = config;
    this.capabilities = createCapabilities({
      share: {
        backendStream: true,
        backendForm: true,
        presigned: true,
        url: false,
      },
      fs: {
        backendStream: true,
        backendForm: true,
        presignedSingle: true,
        multipart: true,
      },
    });

    this.share = {
      // 预签名分享上传（/share/presign + /share/commit）
      applyShareUploader: this.applyShareUploader.bind(this),
      // 直传分享上传（/share/upload）
      applyDirectShareUploader: this.applyDirectShareUploader.bind(this),
      // URL 分享暂不支持
      applyUrlUploader: () => {
        throw new Error("OneDrive 暂不支持外链拉取上传");
      },
    };

    this.fs = {
      applyFsUploader: this.applyFsUploader.bind(this),
      // 供 ServerResumePlugin 使用的只读查询能力
      listUploads: this.listUploads.bind(this),
      listParts: this.listParts.bind(this),
    };
  }

  get storageConfigId() {
    return this.config?.id ?? null;
  }

  // Share ------------------------------------------------------------------

  /**
   * 预签名分享上传（单请求 PUT）
   * - 使用 /api/share/presign 获取上传 URL 与 key
   * - 使用 StorageAdapter + AwsS3 执行单请求上传（底层实际走 XMLHttpRequest）
   * - 在 upload-success 中调用 /api/share/commit 创建分享记录
   */
  applyShareUploader(uppy, { payload, onShareRecord } = {}) {
    if (!uppy) throw new Error("applyShareUploader 需要提供 Uppy 实例");

    const basePayload = this.#withStorageConfig(payload || {});
    const pluginId = "OneDriveSharePresigned";

    // 避免重复安装
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

        const presign = await api.file.getUploadPresignedUrl({
          storage_config_id: merged.storage_config_id,
          filename: meta.name || file.name,
          mimetype: file.type || "application/octet-stream",
          path: merged.path,
          size: file.size,
        });

        if (!presign?.success || !presign?.data) {
          throw new Error(presign?.message || "获取预签名URL失败");
        }

        const data = presign.data;
        const uploadUrl = data.uploadUrl || data.upload_url;

        // 计算基础请求头：始终带上 Content-Type，避免依赖后端
        const headers = {
          ...(data.headers || {}),
        };
        if (!headers["Content-Type"]) {
          headers["Content-Type"] = file.type || "application/octet-stream";
        }

        // 如果后端暂未透传 OneDrive 的 Content-Range，则在前端兜底一次
        const providerType = (data.provider_type || "").toUpperCase();
        const isOneDrive = providerType === "ONEDRIVE";
        if (
          isOneDrive &&
          typeof file.size === "number" &&
          file.size >= 0 &&
          !headers["Content-Range"]
        ) {
          const total = file.size;
          const end = total > 0 ? total - 1 : 0;
          headers["Content-Range"] = `bytes 0-${end}/${total}`;
        }

        // 持久化 commit 所需元数据
        try {
          uppy.setFileMeta(file.id, {
            key: data.key,
            storage_config_id: data.storage_config_id || merged.storage_config_id,
            filename: data.filename || meta.name || file.name,
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
          headers,
        };
      },
      // 使用 XMLHttpRequest 避免 CORS 问题
      uploadPartBytes: adapter.uploadSingleFile.bind(adapter),
    });

    // 在成功后执行 commit（创建分享记录）
    const onSuccess = async (file) => {
      const meta = file?.meta || {};
      try {
        const commitRes = await api.file.completeFileUpload({
          key: meta.key,
          storage_config_id: meta.storage_config_id,
          filename: meta.name || file.name,
          size: file.size,
          etag: undefined,
          slug: meta.slug,
          remark: basePayload.remark,
          password: basePayload.password,
          expires_in: basePayload.expires_in,
          max_views: basePayload.max_views,
          use_proxy: basePayload.use_proxy,
          original_filename: basePayload.original_filename ?? false,
          path: meta.path,
        });

        if (commitRes?.data) {
          const shareRecord = commitRes.data;
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
        try {
          uppy.emit("upload-error", file, e);
        } catch {}
      }
    };

    uppy.on("upload-success", onSuccess);
  }

  /**
   * 直传分享上传：通过 Uppy + XHRUpload 调用后端 /share/upload（ObjectStore 多存储通用）
   * - 与 S3/WebDAV 一致，由后端处理写入 OneDrive 并创建分享记录
   * @param {object} uppy
   * @param {object} options { payload, onShareRecord, shareMode }
   */
  applyDirectShareUploader(uppy, { payload, onShareRecord, shareMode } = {}) {
    if (!uppy) throw new Error("applyDirectShareUploader 需要提供 Uppy 实例");

    const basePayload = this.#withStorageConfig(payload || {});
    const mode = (shareMode || "stream").toLowerCase();

    const baseMeta = {
      storage_config_id: basePayload.storage_config_id,
      path: basePayload.path || "",
      slug: basePayload.slug || "",
      remark: basePayload.remark || "",
      password: basePayload.password || "",
      expires_in: basePayload.expires_in || "0",
      max_views: basePayload.max_views ?? 0,
      use_proxy: basePayload.use_proxy,
      original_filename: basePayload.original_filename,
    };

    const authHeaders = buildAuthHeadersForRequest({});
    try {
      uppy.setMeta(baseMeta);
    } catch {}

    if (mode === "stream") {
      // 流式分享：PUT /share/upload + 原始 body，参数通过头部传递
      uppy.use(XHRUpload, {
        id: "OneDriveShareUploadStream",
        endpoint: getFullApiUrl("/share/upload"),
        method: "PUT",
        formData: false,
        limit: 3,
        headers: (file) => {
          const meta = file.meta || {};
          const options = {
            storage_config_id: meta.storage_config_id,
            path: meta.path,
            slug: meta.slug,
            remark: meta.remark,
            password: meta.password,
            expires_in: meta.expires_in,
            max_views: meta.max_views,
            use_proxy: meta.use_proxy,
            original_filename: meta.original_filename,
            upload_id: meta.upload_id,
          };
          let encodedOptions = "";
          try {
            encodedOptions = btoa(JSON.stringify(options));
          } catch {
            encodedOptions = "";
          }
          const rawName = meta.name || file.name || "upload-file";
          const encodedName = encodeURIComponent(rawName);
          return {
            ...authHeaders,
            "x-share-filename": encodedName,
            ...(encodedOptions ? { "x-share-options": encodedOptions } : {}),
          };
        },
      });
    } else {
      // 表单分享：POST /share/upload multipart/form-data
      uppy.use(XHRUpload, {
        id: "OneDriveShareUploadDirect",
        endpoint: getFullApiUrl("/share/upload"),
        method: "POST",
        formData: true,
        fieldName: "file",
        limit: 3,
        allowedMetaFields: [
          "storage_config_id",
          "path",
          "slug",
          "remark",
          "password",
          "expires_in",
          "max_views",
          "use_proxy",
          "original_filename",
          "upload_id",
        ],
        headers: authHeaders,
      });
    }

    // 在上传前同步用户修改的文件名
    uppy.on("upload", () => {
      const files = uppy.getFiles();
      files.forEach((file) => {
        if (file.meta?.name && file.meta.name !== file.name) {
          uppy.setFileState(file.id, { name: file.meta.name });
        }
      });
    });

    const onSuccess = (file, response) => {
      try {
        const body = response && (response.body || response);
        if (!body || body.success !== true) return;
        const shareRecord = body.data;
        if (!shareRecord) return;

        try {
          uppy.setFileMeta(file.id, {
            ...(file.meta || {}),
            shareRecord,
            fileId: shareRecord.id,
          });
        } catch {}

        try {
          uppy.emit("share-record", { file, shareRecord });
        } catch {}

        try {
          onShareRecord?.({ file, shareRecord });
        } catch {}
      } catch {}
    };

    uppy.on("upload-success", onSuccess);
  }

  /**
   * 返回当前驱动在 FS 场景下推荐的上传策略
   * - 由于 OneDrive 的 API 更适合后端中转，我们这里选择 backend-stream
   */
  getDefaultFsStrategy() {
    return STORAGE_STRATEGIES.BACKEND_STREAM;
  }

  /**
   * OneDrive FS 上传：
   * - 预签名单文件：通过 /fs/presign + 直传（PRESIGNED_SINGLE）
   * - 预签名多分片：通过 /fs/multipart/* + Uppy AwsS3 分片（PRESIGNED_MULTIPART，Graph uploadSession）
   * - 流式模式：通过 PUT /fs/upload 使用原始 body 直传（BACKEND_STREAM）
   * - 表单模式：通过 POST /fs/upload multipart/form-data（BACKEND_FORM）
   */
  applyFsUploader(uppy, { strategy, path } = {}) {
    if (!uppy) {
      throw new Error("applyFsUploader 需要提供 Uppy 实例");
    }

    // 预签名直传：复用 StorageAdapter + AwsS3
    // - PRESIGNED_SINGLE: 单请求 PUT（getUploadParameters + uploadSingleFile）
    // - PRESIGNED_MULTIPART: Uppy 多分片（create/sign/uploadPartBytes/complete/abort/listParts）
    if (
      strategy === STORAGE_STRATEGIES.PRESIGNED_SINGLE ||
      strategy === STORAGE_STRATEGIES.PRESIGNED_MULTIPART
    ) {
      const adapter = new StorageAdapter(path || "/", uppy);

      const isMultipart = strategy === STORAGE_STRATEGIES.PRESIGNED_MULTIPART;
      const awsS3Opts = {
        id: "OneDriveFsPresigned",
        // 对于 OneDrive 上传会话，强制串行上传，避免 Range 不一致问题
        limit: 1,
        shouldUseMultipart: () => isMultipart,
      };

      if (isMultipart) {
        awsS3Opts.getUploadParameters = adapter.getUploadParameters.bind(adapter);
        awsS3Opts.createMultipartUpload = adapter.createMultipartUpload.bind(adapter);
        awsS3Opts.signPart = adapter.signPart.bind(adapter);
        awsS3Opts.uploadPartBytes = adapter.uploadPartBytes.bind(adapter);
        awsS3Opts.completeMultipartUpload = adapter.completeMultipartUpload.bind(adapter);
        awsS3Opts.abortMultipartUpload = adapter.abortMultipartUpload.bind(adapter);
        awsS3Opts.listParts = adapter.listParts.bind(adapter);
      } else {
        awsS3Opts.getUploadParameters = adapter.getUploadParameters.bind(adapter);
        awsS3Opts.uploadPartBytes = adapter.uploadSingleFile.bind(adapter);
      }

      uppy.use(AwsS3, awsS3Opts);
      return {
        adapter,
        mode: isMultipart ? STORAGE_STRATEGIES.PRESIGNED_MULTIPART : STORAGE_STRATEGIES.PRESIGNED_SINGLE,
      };
    }

    const headers = buildAuthHeadersForRequest({});
    try {
      uppy.setMeta({ path: path || "/", use_multipart: "false" });
    } catch {}

    if (strategy === STORAGE_STRATEGIES.BACKEND_FORM) {
      // 表单模式：multipart/form-data
      uppy.use(XHRUpload, {
        id: "OneDriveBackendForm",
        endpoint: getFullApiUrl("/fs/upload"),
        method: "POST",
        formData: true,
        fieldName: "file",
        limit: 3,
        allowedMetaFields: ["path", "use_multipart", "upload_id"],
        headers,
      });
    } else {
      // 流式模式：PUT + 原始 body，参数通过 query/header 传递
      uppy.use(XHRUpload, {
        id: "OneDriveBackendStream",
        endpoint: (file) => {
          const meta = file.meta || {};
          const basePath = meta.path || path || "/";
          const uploadId = meta.upload_id;
          const params = new URLSearchParams();
          params.set("path", basePath);
          if (uploadId) {
            params.set("upload_id", uploadId);
          }
          return `${getFullApiUrl("/fs/upload")}?${params.toString()}`;
        },
        method: "PUT",
        formData: false,
        limit: 3,
        headers: (file) => {
          const meta = file.meta || {};
          const uploadOptions = {
            overwrite: !!meta.overwrite,
            originalFilename: !!meta.original_filename,
          };
          const rawName = meta.name || file.name || "upload-file";
          const encodedName = encodeURIComponent(rawName);
          return {
            ...headers,
            "x-fs-filename": encodedName,
            "x-fs-options": btoa(JSON.stringify(uploadOptions)),
          };
        },
      });
    }

    // 在上传前同步用户修改的文件名
    uppy.on("upload", () => {
      const files = uppy.getFiles();
      files.forEach((file) => {
        if (file.meta?.name && file.meta.name !== file.name) {
          uppy.setFileState(file.id, { name: file.meta.name });
        }
      });
    });

    return {
      adapter: null,
      mode: strategy,
    };
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

  // Read-only helpers for resume plugin -------------------------------------

  async listUploads({ path } = {}) {
    // 后端接受目录或空字符串，返回该作用域下的未完成上传
    return api.fs.listMultipartUploads(path || "");
  }

  async listParts({ path, uploadId, fileName }) {
    // path 为文件完整路径，后端使用它定位资源；同时需要 uploadId 和 fileName
    return api.fs.listMultipartParts(path, uploadId, fileName);
  }
}
