/**
 * 存储配置工具类
 * 提供统一的存储配置获取方法，供MountManager、FileService等使用
 * 避免重复代码，保持架构一致性
 */

import { ApiStatus } from "../../constants/index.js";
import { AppError, ValidationError, NotFoundError } from "../../http/errors.js";
import { ensureRepositoryFactory } from "../../utils/repositories.js";
import { StorageFactory } from "../factory/StorageFactory.js";

export class StorageConfigUtils {
  /**
   * 根据存储类型和配置ID获取存储配置
   * @param {D1Database} db - 数据库实例
   * @param {string} storageType - 存储类型
   * @param {string} configId - 配置ID
   * @returns {Promise<Object>} 存储配置对象
   */
  static async getStorageConfig(db, storageType, configId) {
    if (!storageType) {
      throw new ValidationError("存储类型不能为空");
    }

    if (!configId) {
      throw new ValidationError("配置ID不能为空");
    }

    if (!StorageFactory.isTypeSupported(storageType)) {
      throw new ValidationError(`不支持的存储类型: ${storageType}`);
    }

    // 统一走 StorageConfigRepository，并依赖其内部的 StorageFactory.projectConfig 完成展平
    const factory = ensureRepositoryFactory(db);
    const repo = factory.getStorageConfigRepository();
    const config = repo.findByIdWithSecrets
      ? await repo.findByIdWithSecrets(configId)
      : await repo.findById(configId); // 兜底：旧实现不带密钥

    if (!config) {
      throw new NotFoundError("存储配置不存在");
    }

    if (config.storage_type && config.storage_type !== storageType) {
      throw new ValidationError(`存储配置类型不匹配，期望 ${storageType}，实际 ${config.storage_type}`);
    }

    return config;
  }

  /**
   * 检查存储配置是否存在
   * @param {D1Database} db - 数据库实例
   * @param {string} storageType - 存储类型
   * @param {string} configId - 配置ID
   * @returns {Promise<boolean>} 是否存在
   */
  static async configExists(db, storageType, configId) {
    try {
      await StorageConfigUtils.getStorageConfig(db, storageType, configId);
      return true;
    } catch (error) {
      if (error instanceof AppError && error.status === ApiStatus.NOT_FOUND) {
        return false;
      }
      throw error;
    }
  }

  /**
   * 获取支持的存储类型列表
   * @returns {Array<string>} 支持的存储类型
   */
  static getSupportedStorageTypes() {
    return StorageFactory.getSupportedTypes();
  }

  /**
   * 验证存储类型是否支持
   * @param {string} storageType - 存储类型
   * @returns {boolean} 是否支持
   */
  static isStorageTypeSupported(storageType) {
    return StorageConfigUtils.getSupportedStorageTypes().includes(storageType);
  }
}
