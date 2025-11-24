/**
 * 存储配置工具类
 * 提供统一的存储配置获取方法，供MountManager、FileService等使用
 * 避免重复代码，保持架构一致性
 */

import { ApiStatus } from "../../constants/index.js";
import { AppError, ValidationError, NotFoundError } from "../../http/errors.js";
import { ensureRepositoryFactory } from "../../utils/repositories.js";

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

    switch (storageType) {
      case "S3":
        return await StorageConfigUtils._getS3Config(db, configId);

      case "WEBDAV":
        return await StorageConfigUtils._getWebDAVConfig(db, configId);

      // case "Local":
      //   return await StorageConfigUtils._getLocalConfig(db, configId);

      default:
        throw new ValidationError(`不支持的存储类型: ${storageType}`);
    }
  }

  /**
   * 获取S3配置
   * @private
   * @param {D1Database} db - 数据库实例
   * @param {string} configId - S3配置ID
   * @returns {Promise<Object>} S3配置对象
   */
  static async _getS3Config(db, configId) {
    // 统一走新的通用存储配置表 + Repository，并且携带密钥字段
    const factory = ensureRepositoryFactory(db);
    const repo = factory.getStorageConfigRepository();
    const config = repo.findByIdWithSecrets
      ? await repo.findByIdWithSecrets(configId)
      : await repo.findById(configId); // 兜底：旧实现不带密钥

    if (!config) {
      throw new NotFoundError("S3配置不存在");
    }

    return config;
  }

  /**
   * 获取WebDAV配置（未来实现）
   * @private
   * @param {D1Database} db - 数据库实例
   * @param {string} configId - WebDAV配置ID
   * @returns {Promise<Object>} WebDAV配置对象
   */
  static async _getWebDAVConfig(db, configId) {
    const factory = ensureRepositoryFactory(db);
    const repo = factory.getStorageConfigRepository();
    const config = repo.findByIdWithSecrets ? await repo.findByIdWithSecrets(configId) : await repo.findById(configId);

    if (!config) {
      throw new NotFoundError("WebDAV配置不存在");
    }

    // 将 config_json 展平，方便驱动直接使用
    const jsonRaw = config.__config_json__ || config.config_json || {};
    const json = typeof jsonRaw === "string" ? JSON.parse(jsonRaw || "{}") : jsonRaw;
    return { ...json, ...config };
  }

  /**
   * 获取本地存储配置（未来实现）
   * @private
   * @param {D1Database} db - 数据库实例
   * @param {string} configId - 本地存储配置ID
   * @returns {Promise<Object>} 本地存储配置对象
   */
  // static async _getLocalConfig(db, configId) {
  //   const config = await db.prepare("SELECT * FROM local_configs WHERE id = ?").bind(configId).first();
  //
  //   if (!config) {
  //     throw new NotFoundError("本地存储配置不存在");
  //   }
  //
  //   return config;
  // }

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
    return ["S3", "WEBDAV"]; // 未来添加 "Local" 等
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
