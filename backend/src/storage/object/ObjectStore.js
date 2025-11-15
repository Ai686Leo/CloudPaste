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
    const dir = PathPolicy.composeDirectory(storageConfig.default_folder, directory);
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
    const presign = await driver.uploadOps.generatePresignedUploadUrl(key, {
      fileName: filename,
      fileSize,
      // contentType 由 uploadOps 基于 fileName 推断，传与不传均可
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

  async uploadDirect({ storage_config_id, directory, filename, bodyStream, size, contentType }) {
    const storageConfig = await this._getStorageConfig(storage_config_id);
    if (!storageConfig.storage_type) {
      throw new ValidationError("存储配置缺少 storage_type");
    }
    const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, this.encryptionSecret);

    const key = await this._composeKeyWithStrategy(storageConfig, directory, filename);
    const result = await driver.uploadOps.uploadStream(key, bodyStream, {
      filename,
      contentType,
      contentLength: size,
      useMultipart: false,
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
}

export default ObjectStore;
