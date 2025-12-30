import AwsS3 from "@uppy/aws-s3";
import { StorageAdapter } from "@/modules/storage-core/uppy/StorageAdapter.js";
import Sha256PreprocessPlugin from "@/modules/storage-core/uppy/plugins/Sha256PreprocessPlugin.js";
import { sha256HexFromBlob } from "@/utils/sha256.js";
import { API_BASE_URL } from "@/api/config.js";
import { api } from "@/api";
import { LocalDriver } from "@/modules/storage-core/drivers/local/LocalDriver.js";
import { createCapabilities, STORAGE_STRATEGIES } from "@/modules/storage-core/drivers/types.js";

/**
 * HuggingFace Datasets 存储驱动（前端）
 *
 */
export class HuggingFaceDatasetsDriver extends LocalDriver {
  constructor(config = {}) {
    super(config);

    // 预签名上传
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

    this.share.applyDirectShareUploader = this.applyDirectShareUploader.bind(this);

    // Read-only helpers for resume plugin（对齐 S3）：让前端能列出进行中的上传 / 已上传分片
    this.fs.listUploads = this.listUploads.bind(this);
    this.fs.listParts = this.listParts.bind(this);
  }

  /**
   * FS 上传插件安装
   * - presigned-single：走 /api/fs/presign，拿到 uploadUrl 后直传
   */
  applyFsUploader(uppy, { strategy, path } = {}) {
    if (!uppy) throw new Error("applyFsUploader 需要提供 Uppy 实例");

    if (strategy === STORAGE_STRATEGIES.PRESIGNED_SINGLE || strategy === STORAGE_STRATEGIES.PRESIGNED_MULTIPART) {
      const isMultipart = strategy === STORAGE_STRATEGIES.PRESIGNED_MULTIPART;

      // HuggingFace LFS：预签名（无论单文件还是分片）都必须先算 sha256（oid）
      // “先算 sha256（有进度）→ 再 /multipart/init（拿分片URL/partSize）” 的顺序稳定。
      const shaPlugin = uppy.getPlugin("Sha256PreprocessPlugin");
      const shaOpts = { enabled: true, maxWebCryptoSize: 10_000_000, metaKey: "cloudpasteSha256" };
      if (shaPlugin) {
        try {
          shaPlugin.setOptions(shaOpts);
        } catch {}
      } else {
        uppy.use(Sha256PreprocessPlugin, shaOpts);
      }

      // HF LFS 必须要 sha256（oid）才能拿到 upload 指令（无论是 basic 还是 multipart）
      const adapter = new StorageAdapter(path || "/", uppy, {
        requireSha256ForPresign: true,
        enableMultipartPreinit: isMultipart,
      });

      const limitFromConfig = Number(this.config?.hf_multipart_concurrency);
      const multipartLimit = Number.isFinite(limitFromConfig) && limitFromConfig > 0 ? Math.floor(limitFromConfig) : 5;

      const awsS3Opts = {
        id: "AwsS3",
        limit: isMultipart ? multipartLimit : 3,
        shouldUseMultipart: () => isMultipart,
        // 让 Uppy(AwsS3) 用后端返回的 partSize 切片
        // AwsS3.getChunkSize() 实际拿到的是 file.data（Blob/File），不是 Uppy 的 file 对象。
        getChunkSize: (data) => adapter.getChunkSizeForAwsS3(data),
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
      return { adapter, mode: isMultipart ? STORAGE_STRATEGIES.PRESIGNED_MULTIPART : STORAGE_STRATEGIES.PRESIGNED_SINGLE };
    }

    // 其它策略（stream/form）走后端中转
    return super.applyFsUploader(uppy, { strategy, path });
  }

  // Read-only helpers for resume plugin -------------------------------------
  async listUploads({ path } = {}) {
    return api.fs.listMultipartUploads(path || "");
  }

  async listParts({ path, uploadId, fileName }) {
    return api.fs.listMultipartParts(path, uploadId, fileName);
  }

  /**
   * Share 预签名上传（上传即分享）
   * - /api/share/presign：拿到 uploadUrl（HF 实际返回的是 S3 presigned URL）
   * - 浏览器 PUT 到 uploadUrl（不经过你的 Worker）
   * - /api/share/commit：后端完成“登记/提交”，并创建 share 记录
   */
  applyShareUploader(uppy, { payload, onShareRecord } = {}) {
    if (!uppy) throw new Error("applyShareUploader 需要提供 Uppy 实例");

    const storageConfigId = payload?.storage_config_id || this.storageConfigId;
    if (!storageConfigId) throw new Error("缺少 storage_config_id，无法初始化 HuggingFace 分享上传");

    const basePayload = {
      ...(payload || {}),
      storage_config_id: storageConfigId,
    };

    const pluginId = "AwsS3ShareHuggingFaceDatasets";
    if (uppy.getPlugin(pluginId)) return;

    // HF LFS 必须要 sha256 才能换到 uploadUrl，所以这里强制开启“上传前算 sha256”
    const shaPlugin = uppy.getPlugin("Sha256PreprocessPlugin");
    const shaOpts = { enabled: true, maxWebCryptoSize: 10_000_000, metaKey: "cloudpasteSha256" };
    if (shaPlugin) {
      try {
        shaPlugin.setOptions(shaOpts);
      } catch {}
    } else {
      uppy.use(Sha256PreprocessPlugin, shaOpts);
    }

    // 复用 StorageAdapter 的 uploadSingleFile（内部用 XHR，且支持 skipUpload）
    const adapter = new StorageAdapter("/", uppy);

    uppy.use(AwsS3, {
      id: pluginId,
      shouldUseMultipart: () => false,
      limit: 3,
      getUploadParameters: async (file) => {
        const meta = file?.meta || {};
        // 文件名取值顺序：
        // 1) Uppy Dashboard 里用户改过的 meta.name
        // 2) 否则用 file.name
        const fileName = typeof meta?.name === "string" && meta.name ? meta.name : file.name;
        const blob = file?.data instanceof Blob ? file.data : null;
        // sha256 取值顺序（HF LFS 预签名必须要）：
        // 1) 预处理插件写入的 meta.cloudpasteSha256
        // 2) 兜底：本次直接计算一次
        let sha256 = null;
        if (typeof meta?.cloudpasteSha256 === "string" && meta.cloudpasteSha256) {
          sha256 = meta.cloudpasteSha256;
        } else if (typeof meta?.sha256 === "string" && meta.sha256) {
          sha256 = meta.sha256;
        } else if (blob) {
          sha256 = await sha256HexFromBlob(blob);
        }
        if (!sha256) {
          throw new Error("HuggingFace 预签名上传需要 sha256，但当前文件无法计算 sha256");
        }

        const presign = await api.file.getUploadPresignedUrl({
          storage_config_id: basePayload.storage_config_id,
          filename: fileName,
          mimetype: file.type || "application/octet-stream",
          path: meta.path ?? basePayload.path,
          size: file.size,
          sha256,
        });

        if (!presign?.success || !presign?.data) {
          throw new Error(presign?.message || "获取预签名URL失败");
        }

        const data = presign.data || {};
        const uploadUrl = data.uploadUrl || data.upload_url || "";
        const skipUpload = data.skipUpload === true || !uploadUrl;

        // 后端回传的 sha256 是“本次上传会话的最终值”，优先使用
        const canonicalSha256 =
          typeof data.sha256 === "string" && data.sha256 ? data.sha256 : sha256;

        // 持久化 commit 所需元数据（给 /api/share/commit 用）
        try {
          uppy.setFileMeta(file.id, {
            key: data.key,
            storage_config_id: data.storage_config_id || basePayload.storage_config_id,
            filename: typeof data.filename === "string" && data.filename ? data.filename : fileName,
            path: meta.path ?? basePayload.path,
            slug: meta.slug ?? basePayload.slug,
            password: basePayload.password || meta.password || null,
            expires_in: basePayload.expires_in,
            max_views: basePayload.max_views,
            sha256: canonicalSha256,
            skipUpload,
          });
        } catch {}

        const headers = { ...(data.headers || {}) };
        if (skipUpload) {
          headers["x-cloudpaste-skip-upload"] = "1";
        }

        return {
          method: "PUT",
          url: skipUpload ? `${API_BASE_URL}/__uppy_skip_upload__` : uploadUrl,
          headers,
          skipUpload,
        };
      },
      uploadPartBytes: adapter.uploadSingleFile.bind(adapter),
    });

    // 成功后执行 commit（创建分享记录 + HF 仓库登记）
    const onSuccess = async (file) => {
      const meta = file?.meta || {};
      try {
        const commitRes = await api.file.completeFileUpload({
          key: meta.key,
          storage_config_id: meta.storage_config_id,
          filename:
            typeof meta?.filename === "string" && meta.filename
              ? meta.filename
              : typeof meta?.name === "string" && meta.name
                ? meta.name
                : file.name,
          size: file.size,
          etag: undefined,
          sha256: typeof meta?.sha256 === "string" && meta.sha256 ? meta.sha256 : null,
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
            uppy.setFileMeta(file.id, { fileId: shareRecord.id, shareRecord, skipUpload: meta.skipUpload === true });
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
   * Share 直传（stream/form）
   */
  applyDirectShareUploader(uppy, { payload, onShareRecord, shareMode } = {}) {
    return LocalDriver.prototype.applyShareUploader.call(this, uppy, { payload, onShareRecord, shareMode });
  }
}
