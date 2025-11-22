/**
 * Repository层统一导出文件
 * 提供所有Repository类的统一入口
 */

export { BaseRepository } from "./BaseRepository.js";
export { FileRepository } from "./FileRepository.js";
export { MountRepository } from "./MountRepository.js";
export { StorageConfigRepository } from "./StorageConfigRepository.js";
export { AdminRepository } from "./AdminRepository.js";
export { ApiKeyRepository } from "./ApiKeyRepository.js";
export { PasteRepository } from "./PasteRepository.js";
export { SystemRepository } from "./SystemRepository.js";
export { PrincipalStorageAclRepository } from "./PrincipalStorageAclRepository.js";
export { FsMetaRepository } from "./FsMetaRepository.js";

// 导入所有Repository类用于工厂类
import { BaseRepository } from "./BaseRepository.js";
import { FileRepository } from "./FileRepository.js";
import { MountRepository } from "./MountRepository.js";
import { StorageConfigRepository } from "./StorageConfigRepository.js";
import { AdminRepository } from "./AdminRepository.js";
import { ApiKeyRepository } from "./ApiKeyRepository.js";
import { PasteRepository } from "./PasteRepository.js";
import { SystemRepository } from "./SystemRepository.js";
import { PrincipalStorageAclRepository } from "./PrincipalStorageAclRepository.js";
import { FsMetaRepository } from "./FsMetaRepository.js";

/**
 * Repository工厂类
 * 用于创建和管理Repository实例
 */
export class RepositoryFactory {
  /**
   * 构造函数
   * @param {D1Database} db - 数据库实例
   */
  constructor(db) {
    this.db = db;
    this._repositories = new Map();
  }

  /**
   * 获取FileRepository实例
   * @returns {FileRepository} FileRepository实例
   */
  getFileRepository() {
    if (!this._repositories.has("file")) {
      this._repositories.set("file", new FileRepository(this.db));
    }
    return this._repositories.get("file");
  }

  /**
   * 获取MountRepository实例
   * @returns {MountRepository} MountRepository实例
   */
  getMountRepository() {
    if (!this._repositories.has("mount")) {
      this._repositories.set("mount", new MountRepository(this.db));
    }
    return this._repositories.get("mount");
  }

  /**
   * 获取StorageConfigRepository实例（通用）
   * @returns {StorageConfigRepository}
   */
  getStorageConfigRepository() {
    if (!this._repositories.has("storageconfig")) {
      this._repositories.set("storageconfig", new StorageConfigRepository(this.db));
    }
    return this._repositories.get("storageconfig");
  }

  /**
   * 获取AdminRepository实例
   * @returns {AdminRepository} AdminRepository实例
   */
  getAdminRepository() {
    if (!this._repositories.has("admin")) {
      this._repositories.set("admin", new AdminRepository(this.db));
    }
    return this._repositories.get("admin");
  }

  /**
   * 获取ApiKeyRepository实例
   * @returns {ApiKeyRepository} ApiKeyRepository实例
   */
  getApiKeyRepository() {
    if (!this._repositories.has("apikey")) {
      this._repositories.set("apikey", new ApiKeyRepository(this.db));
    }
    return this._repositories.get("apikey");
  }

  /**
   * 获取PasteRepository实例
   * @returns {PasteRepository} PasteRepository实例
   */
  getPasteRepository() {
    if (!this._repositories.has("paste")) {
      this._repositories.set("paste", new PasteRepository(this.db));
    }
    return this._repositories.get("paste");
  }

  /**
   * 获取SystemRepository实例
   * @returns {SystemRepository} SystemRepository实例
   */
  getSystemRepository() {
    if (!this._repositories.has("system")) {
      this._repositories.set("system", new SystemRepository(this.db));
    }
    return this._repositories.get("system");
  }

  /**
   * 获取 PrincipalStorageAclRepository 实例
   * @returns {PrincipalStorageAclRepository} PrincipalStorageAclRepository 实例
   */
  getPrincipalStorageAclRepository() {
    if (!this._repositories.has("principalStorageAcl")) {
      this._repositories.set("principalStorageAcl", new PrincipalStorageAclRepository(this.db));
    }
    return this._repositories.get("principalStorageAcl");
  }

  /**
   * 清理所有Repository实例缓存
   */
  clearCache() {
    this._repositories.clear();
  }

  /**
   * 获取所有Repository实例
   * @returns {Object} 包含所有Repository实例的对象
   */
  getAllRepositories() {
    return {
      file: this.getFileRepository(),
      mount: this.getMountRepository(),
      storageConfig: this.getStorageConfigRepository(),
      admin: this.getAdminRepository(),
      apiKey: this.getApiKeyRepository(),
      paste: this.getPasteRepository(),
      system: this.getSystemRepository(),
      principalStorageAcl: this.getPrincipalStorageAclRepository(),
      fsMeta: this.getFsMetaRepository(),
    };
  }

  /**
   * 获取 FsMetaRepository 实例
   * @returns {FsMetaRepository}
   */
  getFsMetaRepository() {
    if (!this._repositories.has("fsMeta")) {
      this._repositories.set("fsMeta", new FsMetaRepository(this.db));
    }
    return this._repositories.get("fsMeta");
  }
}
