/**
 * ObjectStore: 独立于挂载系统的“存储直传”服务层
 * 只负责以 storage-first 方式对接底层驱动（S3 等）以完成：预签名、直传、提交
 * 不做权限判定、记录建档，这些由上层服务处理
 */

import { StorageFactory } from "../factory/StorageFactory.js";
import { invalidateFsCache } from "../../cache/invalidation.js";
import { shouldUseRandomSuffix, getFileNameAndExt, generateShortId } from "../../utils/common.js";
import { ValidationError, NotFoundError } from "../../http/errors.js";
import { ApiStatus } from "../../constants/index.js";
import { PathPolicy } from "../../services/share/PathPolicy.js";
import { resolveStorageLinks } from "./ObjectLinkStrategy.js";
import { CAPABILITIES } from "../interfaces/capabilities/index.js";

export class ObjectStore {
  constructor(db, encryptionSecret, repositoryFactory) {
    this.db = db;
    this.encryptionSecret = encryptionSecret;
    this.repositoryFactory = repositoryFactory;
    this.storageConfigRepo = repositoryFactory.getStorageConfigRepository?.();
  }

  async _getStorageConfig(storage_config_id) {
    if (!storage_config_id) {
      throw new ValidationError("缺少 storage_config_id");
    }
    // 优先读取带密钥版本，确保驱动初始化可用
    let storageConfig = null;
    if (this.storageConfigRepo?.findByIdWithSecrets) {
      storageConfig = await this.storageConfigRepo.findByIdWithSecrets(storage_config_id);
    } else {
      storageConfig = await this.storageConfigRepo.findById(storage_config_id);
    }
    if (!storageConfig) {
      throw new NotFoundError("存储配置不存在");
    }
    return storageConfig;
  }

  async _composeKeyWithStrategy(storageConfig, directory, filename) {
    // 对于 S3 等对象存储，key 中需要包含 default_folder；
    // 对于 WebDAV 等驱动，default_folder 由驱动内部处理，这里只使用目录参数。
    const baseDefaultFolder = storageConfig.storage_type === "WEBDAV" ? null : storageConfig.default_folder;
    const dir = PathPolicy.composeDirectory(baseDefaultFolder, directory);
    let key = dir ? `${dir}/${filename}` : filename;

    // 命名策略：随机后缀模式时，如发生冲突，则为对象Key加短ID后缀（DB层冲突检测）
    try {
      const useRandom = await shouldUseRandomSuffix(this.db).catch(() => false);
      if (useRandom) {
        const fileRepo = this.repositoryFactory.getFileRepository();
        if (!storageConfig.storage_type) throw new ValidationError("存储配置缺少 storage_type");
        const exists = await fileRepo.findByStoragePath(storageConfig.id, key, storageConfig.storage_type);
        if (exists) {
          const { name, ext } = getFileNameAndExt(filename);
          const shortId = generateShortId();
          const dirOnly = dir ? `${dir}/` : "";
          key = `${dirOnly}${name}-${shortId}${ext}`;
        }
      }
    } catch {}

    return key;
  }

  // 公开：根据策略返回计划使用的对象Key（不产生副作用）
  async getPlannedKey(storage_config_id, directory, filename) {
    const storageConfig = await this._getStorageConfig(storage_config_id);
    return await this._composeKeyWithStrategy(storageConfig, directory, filename);
  }

  async presignUpload({ storage_config_id, directory, filename, fileSize, contentType }) {
    const storageConfig = await this._getStorageConfig(storage_config_id);
    if (!storageConfig.storage_type) {
      throw new ValidationError("存储配置缺少 storage_type");
    }
    const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, this.encryptionSecret);

    const key = await this._composeKeyWithStrategy(storageConfig, directory, filename);
    if (typeof driver.generateUploadUrl !== "function" || (typeof driver.hasCapability === "function" && !driver.hasCapability(CAPABILITIES.PRESIGNED))) {
      throw new ValidationError("当前存储驱动不支持预签名上传");
    }

    const presign = await driver.generateUploadUrl(key, {
      fileName: filename,
      fileSize,
      contentType,
    });

    return {
      uploadUrl: presign.uploadUrl,
      key,
      filename,
      contentType: presign.contentType,
      expiresIn: presign.expiresIn,
      storage_config_id,
      provider_type: storageConfig.provider_type,
    };
  }

  async uploadDirect({ storage_config_id, directory, filename, bodyStream, size, contentType, uploadId = null }) {
    const storageConfig = await this._getStorageConfig(storage_config_id);
    if (!storageConfig.storage_type) {
      throw new ValidationError("存储配置缺少 storage_type");
    }
    const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, this.encryptionSecret);

    // 仅允许具备写入能力且支持文件上传的驱动使用 upload-direct
    if (typeof driver.hasCapability === "function" && !driver.hasCapability(CAPABILITIES.WRITER)) {
      throw new ValidationError("当前存储驱动不具备写入能力，无法使用 upload-direct 接口");
    }
    if (typeof driver.uploadFile !== "function") {
      throw new ValidationError("当前存储驱动不支持文件直传");
    }

    const key = await this._composeKeyWithStrategy(storageConfig, directory, filename);

    const result = await driver.uploadFile(key, /** @type {any} */ (bodyStream), {
      subPath: key,
      db: this.db,
      filename,
      contentType,
      contentLength: size,
      uploadId: uploadId || undefined,
    });

    // 触发与存储配置相关的缓存失效（清理URL缓存，联动关联挂载目录缓存）
    try {
      invalidateFsCache({ storageConfigId: storage_config_id, reason: "upload-direct", db: this.db });
    } catch {}

    return {
      key,
      storagePath: result.storagePath || key,
      publicUrl: result.publicUrl || null,
      etag: result.etag || null,
      contentType: result.contentType || contentType,
      storage_config_id,
    };
  }

  /**
   * 基于 File/Blob 的统一上传（用于分享上传，多存储通用，默认按“表单上传”语义处理）
   * @param {Object} params
   * @param {string} params.storage_config_id
   * @param {string|null} params.directory
   * @param {string} params.filename
   * @param {File|Blob|ArrayBuffer|Uint8Array|Buffer|string} params.file
   * @param {number} params.size
   * @param {string|null} params.contentType
   */
  async uploadFileForShare({ storage_config_id, directory, filename, file, size, contentType, uploadId = null }) {
    const storageConfig = await this._getStorageConfig(storage_config_id);
    if (!storageConfig.storage_type) {
      throw new ValidationError("存储配置缺少 storage_type");
    }
    const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, this.encryptionSecret);

    if (typeof driver.hasCapability === "function" && !driver.hasCapability(CAPABILITIES.WRITER)) {
      throw new ValidationError("当前存储驱动不具备写入能力");
    }
    if (typeof driver.uploadFile !== "function") {
      throw new ValidationError("当前存储驱动不支持文件上传");
    }

    const key = await this._composeKeyWithStrategy(storageConfig, directory, filename);

    // 分享上传通过 /share/upload 走表单(multipart)通道，这里保持 File/Blob 语义，交由驱动走表单上传路径
    const result = await driver.uploadFile(key, file, {
      subPath: key,
      db: this.db,
      filename,
      contentType: contentType || undefined,
      contentLength: size,
      uploadId: uploadId || undefined,
    });

    try {
      invalidateFsCache({ storageConfigId: storage_config_id, reason: "upload-share-file", db: this.db });
    } catch {}

    return {
      key,
      storagePath: result.storagePath || key,
      publicUrl: result.publicUrl || null,
      etag: result.etag || null,
      contentType: result.contentType || contentType,
      storage_config_id,
    };
  }

  async commitUpload({ storage_config_id, key, filename, size, etag }) {
    // 对象存储提交阶段无需再与 S3 交互（驱动在直传/预签名 PUT 阶段已完成写入）
    // 这里仅将必要信息汇总给上层记录建档
    // 通知缓存失效（上传完成）
    try {
      invalidateFsCache({ storageConfigId: storage_config_id, reason: "upload-complete", db: this.db });
    } catch {}

    return {
      key,
      uploadResult: {
        storagePath: key,
        publicUrl: null,
        etag: etag || null,
      },
      filename,
      size: Number(size) || 0,
      storage_config_id,
    };
  }

  // 生成预览/下载链接（storage-first 场景）
  async generateLinksByStoragePath(storage_config_id, key, options = {}) {
    const storageConfig = await this._getStorageConfig(storage_config_id);
    if (!storageConfig.storage_type) {
      throw new ValidationError("存储配置缺少 storage_type");
    }
    const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, this.encryptionSecret);

    const links = await resolveStorageLinks({
      driver,
      storageConfig,
      path: key,
      request: options.request || null,
      forceDownload: options.forceDownload || false,
      userType: options.userType || null,
      userId: options.userId || null,
    });

    return {
      preview: links.preview,
      download: links.download,
      proxyPolicy: links.proxyPolicy || null,
    };
  }

  /**
   * 按存储路径进行真实文件下载代理
   * - storage-first 视图下的“本机代理”能力
   * - 封装 driver 初始化与 downloadFile 调用，供分享层复用
   */
  async downloadByStoragePath(storage_config_id, key, options = {}) {
    const storageConfig = await this._getStorageConfig(storage_config_id);
    if (!storageConfig.storage_type) {
      throw new ValidationError("存储配置缺少 storage_type");
    }
    const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, this.encryptionSecret);

    if (typeof driver.downloadFile !== "function") {
      throw new ValidationError("当前驱动不支持按存储路径下载");
    }

    const request = options.request || null;

    return await driver.downloadFile(key, {
      subPath: key,
      db: this.db,
      request,
    });
  }

  // 删除存储对象（storage-first）
  async deleteByStoragePath(storage_config_id, key, options = {}) {
    const storageConfig = await this._getStorageConfig(storage_config_id);
    if (!storageConfig.storage_type) {
      throw new ValidationError("存储配置缺少 storage_type");
    }
    const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, this.encryptionSecret);

    if (typeof driver.deleteObjectByStoragePath === "function") {
      await driver.deleteObjectByStoragePath(key, options);
      invalidateFsCache({ storageConfigId: storage_config_id, reason: "delete-object", db: this.db });
      return { success: true };
    }

    if (typeof driver.batchRemoveItems === "function") {
      await driver.batchRemoveItems([key], { subPath: key, db: this.db, ...options });
      invalidateFsCache({ storageConfigId: storage_config_id, reason: "delete-object", db: this.db });
      return { success: true };
    }

    throw new ValidationError("当前驱动不支持按存储路径删除");
  }
}

export default ObjectStore;
