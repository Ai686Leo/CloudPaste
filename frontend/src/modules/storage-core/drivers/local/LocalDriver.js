import XHRUpload from "@uppy/xhr-upload";
import { createCapabilities, STORAGE_STRATEGIES } from "../types.js";
import { getFullApiUrl } from "@/api/config.js";
import { buildAuthHeadersForRequest } from "@/modules/security/index.js";

/**
 * LOCAL 存储驱动（前端）
 *
 * 语义与 WebDAV 前端驱动基本一致：
 * - FS：通过 Uppy + XHRUpload 直传到 /fs/upload（支持流式与表单两种模式）
 * - Share：通过 Uppy + XHRUpload 直传到 /share/upload，由后端根据 storage_config_id / path 写入本地存储并创建分享记录
 *
 * 注意：
 * - 不支持预签名上传 / 分片上传，前端仅暴露“流式 / 表单”两种方式（与 WebDAV 保持一致）。
 */
export class LocalDriver {
  constructor(config = {}) {
    this.config = config;
    this.capabilities = createCapabilities({
      share: {
        backendStream: true,
        backendForm: true,
        presigned: false,
        url: false,
      },
      fs: {
        backendStream: true,
        backendForm: true,
        presignedSingle: false,
        multipart: false,
      },
    });

    this.share = {
      // 直接分享上传（多存储通用，通过 /share/upload）
      applyShareUploader: this.applyShareUploader.bind(this),
      // LOCAL 不支持预签名 URL 拉取上传
      applyUrlUploader: () => {
        throw new Error("LOCAL 暂不支持外链拉取上传");
      },
      // 为 direct share 模式提供显式入口（与 S3/WebDAV 对齐）
      applyDirectShareUploader: this.applyShareUploader.bind(this),
    };

    this.fs = {
      applyFsUploader: this.applyFsUploader.bind(this),
    };
  }

  get storageConfigId() {
    return this.config?.id ?? null;
  }

  /**
   * LOCAL 分享上传：通过 Uppy + XHRUpload 调用后端 /api/share/upload
   * 与 WebDAV/S3 的分享上传保持一致：统一走 Uppy 管线
   */
  applyShareUploader(uppy, { payload, onShareRecord, shareMode } = {}) {
    if (!uppy) {
      throw new Error("applyShareUploader 需要提供 Uppy 实例");
    }

    const storageConfigId = payload?.storage_config_id || this.storageConfigId;
    if (!storageConfigId) {
      throw new Error("缺少 storage_config_id，无法初始化 LOCAL 分享上传");
    }

    const baseMeta = {
      storage_config_id: storageConfigId,
      path: payload?.path || "",
      slug: payload?.slug || "",
      remark: payload?.remark || "",
      password: payload?.password || "",
      expires_in: payload?.expires_in || "0",
      max_views: payload?.max_views ?? 0,
      use_proxy: payload?.use_proxy,
      original_filename: payload?.original_filename,
    };

    const authHeaders = buildAuthHeadersForRequest({});
    try {
      uppy.setMeta(baseMeta);
    } catch {}

    const mode = (shareMode || "stream").toLowerCase();

    if (mode === "stream") {
      // 流式分享：PUT /share/upload + 原始 body，参数通过头部传递
      uppy.use(XHRUpload, {
        id: "LocalShareUploadStream",
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
        id: "LocalShareUpload",
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

    // 监听 upload-success，从响应中提取分享记录并透传给上层
    const handleSuccess = (file, response) => {
      try {
        const body = response && (response.body || response);
        const payloadBody = body && typeof body === "object" ? body : null;
        if (!payloadBody || payloadBody.success !== true) return;
        const shareRecord = payloadBody.data;
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
      } catch {
        // 响应解析失败时静默忽略，由上层根据 success/message 处理错误
      }
    };

    uppy.on("upload-success", handleSuccess);
  }

  /**
   * LOCAL FS 上传：
   * - 流式模式：通过 PUT /fs/upload 使用原始 body 直传
   * - 表单模式：通过 POST /fs/upload multipart/form-data
   */
  applyFsUploader(uppy, { strategy, path } = {}) {
    if (!uppy) {
      throw new Error("applyFsUploader 需要提供 Uppy 实例");
    }

    const headers = buildAuthHeadersForRequest({});
    try {
      uppy.setMeta({ path: path || "/", use_multipart: "false" });
    } catch {}

    // 表单模式：multipart/form-data
    if (strategy === STORAGE_STRATEGIES.BACKEND_FORM) {
      uppy.use(XHRUpload, {
        id: "LocalBackendForm",
        endpoint: getFullApiUrl("/fs/upload"),
        method: "POST",
        formData: true,
        fieldName: "file",
        limit: 3,
        allowedMetaFields: ["path", "use_multipart", "upload_id"],
        headers,
      });
    } else {
      // 流式模式：PUT + 原始 body，路径通过 query/header 传递
      uppy.use(XHRUpload, {
        id: "LocalBackendStream",
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
      mode: strategy || null,
    };
  }
}

