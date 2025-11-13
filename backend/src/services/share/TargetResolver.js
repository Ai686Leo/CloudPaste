import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../constants/index.js";

export class TargetResolver {
  constructor(db, encryptionSecret, repositoryFactory) {
    this.db = db;
    this.encryptionSecret = encryptionSecret;
    this.repositoryFactory = repositoryFactory;
  }

  async getMountAndSubPath(path, userIdOrInfo, userType) {
    const { MountManager } = await import("../../storage/managers/MountManager.js");
    const mountManager = new MountManager(this.db, this.encryptionSecret, this.repositoryFactory);
    const { mount, subPath } = await mountManager.getDriverByPath(path, userIdOrInfo, userType);
    return { mount, subPath, mountManager };
  }

  async resolveForPresign({ path, storage_config_id }, userIdOrInfo, userType) {
    if (path) {
      const { mount } = await this.getMountAndSubPath(path, userIdOrInfo, userType);
      if (!mount) throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "目标路径未绑定挂载" });
      return { mount, resolvedPath: path };
    }
    if (storage_config_id) {
      const mountRepo = this.repositoryFactory.getMountRepository();
      const sRepo = this.repositoryFactory.getStorageConfigRepository?.();
      const scfg = await sRepo.findById(storage_config_id);
      if (!scfg?.storage_type) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "存储配置缺少 storage_type" });
      }
      const mounts = await mountRepo.findByStorageConfig(storage_config_id, scfg.storage_type);
      if (Array.isArray(mounts) && mounts.length > 0) {
        const chosen = mounts[0];
        return { mount: chosen, resolvedPath: chosen.mount_path };
      }
    }
    throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "该存储未配置挂载，不支持预签名上传，请提供 path 或配置挂载" });
  }

  async resolveForDirect({ path, storage_config_id }, userIdOrInfo, userType) {
    // 复用现有仓库，简化：若传 path 则返回 mount + path；未传 path 则尝试按 storage_config_id 选默认配置，标记 fallback
    const s3ConfigRepo = this.repositoryFactory.getStorageConfigRepository?.();
    if (path) {
      const { mount } = await this.getMountAndSubPath(path, userIdOrInfo, userType);
      return { mount, resolvedPath: path, usedFallback: false, storageConfig: null };
    }
    if (storage_config_id) {
      const storageConfig = await s3ConfigRepo.findById(storage_config_id);
      return { mount: null, resolvedPath: null, usedFallback: true, storageConfig };
    }
    // 未提供则尝试查默认
    let storageConfig = await s3ConfigRepo.findDefault({ requirePublic: true }).catch(() => null);
    if (!storageConfig) {
      const publicConfigs = await s3ConfigRepo.findPublic().catch(() => []);
      storageConfig = Array.isArray(publicConfigs) && publicConfigs.length > 0 ? publicConfigs[0] : null;
    }
    return { mount: null, resolvedPath: null, usedFallback: true, storageConfig };
  }
}
