import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../constants/index.js";

const DEFAULT_MAX_UPLOAD_SIZE_MB = 100;

export class LimitGuard {
  constructor(repositoryFactory) {
    this.repositoryFactory = repositoryFactory;
  }

  async check(fileSize) {
    if (!fileSize || fileSize <= 0) return;
    const systemRepo = this.repositoryFactory?.getSystemRepository?.();
    if (!systemRepo) return;

    const setting = await systemRepo.getSettingMetadata("max_upload_size").catch(() => null);
    const limitMb = setting?.value ? parseInt(setting.value, 10) : DEFAULT_MAX_UPLOAD_SIZE_MB;
    const limitBytes = Number.isFinite(limitMb) ? limitMb * 1024 * 1024 : DEFAULT_MAX_UPLOAD_SIZE_MB * 1024 * 1024;
    if (limitBytes > 0 && fileSize > limitBytes) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, {
        message: `文件大小超出系统限制（最大 ${limitMb} MB）`,
      });
    }
  }

  async checkStorageQuota(storageConfigId, incomingBytes, options = {}) {
    const { excludeFileId = null } = options;
    if (!storageConfigId || !incomingBytes || incomingBytes <= 0) return;
    const s3Repo = this.repositoryFactory?.getStorageConfigRepository?.();
    const fileRepo = this.repositoryFactory?.getFileRepository?.();
    if (!s3Repo || !fileRepo) return;

    const cfg = await s3Repo.findById(storageConfigId).catch(() => null);
    if (!cfg) return;
    const storageType = cfg.storage_type;
    if (!storageType) return;
    const cap = parseInt(cfg.total_storage_bytes || 0, 10);
    if (!Number.isFinite(cap) || cap <= 0) return; // 0或无值表示不限额

    let used = await fileRepo.getTotalSize({ storage_type: storageType, storage_config_id: storageConfigId }).catch(() => 0);
    // 当覆盖同一路径的已有文件时，可排除该文件记录的体积，避免误判
    if (excludeFileId) {
      const excluded = await fileRepo.getTotalSizeByStorageConfigExcludingFile(storageConfigId, excludeFileId, storageType).catch(() => ({ total_used: used }));
      if (excluded && Number.isFinite(excluded.total_used)) {
        used = excluded.total_used;
      }
    }
    const remaining = cap - used;
    if (remaining < incomingBytes) {
      const toMB = (n) => (n / (1024 * 1024)).toFixed(2);
      throw new HTTPException(ApiStatus.BAD_REQUEST, {
        message: `存储空间不足：剩余 ${toMB(Math.max(remaining, 0))} MB，上传需要 ${toMB(incomingBytes)} MB`.
          replace(/\.00 MB/g, " MB"),
      });
    }
  }
}
