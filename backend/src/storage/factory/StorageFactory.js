/**
 * 存储驱动工厂（注册表版）
 * - 通过 registerDriver(type, meta) 注册驱动与tester
 * - createDriver 基于注册信息实例化
 * - validate/test 均可按驱动自定义实现
 */

import { S3StorageDriver } from "../drivers/s3/S3StorageDriver.js";
import { WebDavStorageDriver } from "../drivers/webdav/WebDavStorageDriver.js";
import { CAPABILITIES } from "../interfaces/capabilities/index.js";
import { ValidationError, NotFoundError } from "../../http/errors.js";

const registry = new Map();

export class StorageFactory {
  static SUPPORTED_TYPES = {
    S3: "S3",
    WEBDAV: "WEBDAV",
    // 未来扩展：
    // LOCAL: "Local"
  };

  // 注册驱动
  static registerDriver(type, { ctor, tester = null, displayName = null, validate = null, capabilities = [] } = {}) {
    if (!type || !ctor) throw new ValidationError("registerDriver 需要提供 type 和 ctor");
    registry.set(type, { ctor, tester, displayName: displayName || type, validate, capabilities: Array.isArray(capabilities) ? capabilities : [] });
  }

  // 获取tester
  static getTester(type) {
    return registry.get(type)?.tester || null;
  }

  // 能力查询（基于注册信息）
  static getRegisteredCapabilities(type) {
    return registry.get(type)?.capabilities || [];
  }
  static supportsCapability(type, capability) {
    const caps = StorageFactory.getRegisteredCapabilities(type);
    return caps.includes(capability);
  }
  static supportsAllCapabilities(type, required = []) {
    const caps = StorageFactory.getRegisteredCapabilities(type);
    return required.every((c) => caps.includes(c));
  }

  // 创建驱动
  static async createDriver(storageType, config, encryptionSecret) {
    if (!storageType) throw new ValidationError("存储类型不能为空");
    if (!config) throw new ValidationError("存储配置不能为空");

    const entry = registry.get(storageType);
    if (entry) {
      const instance = new entry.ctor(config, encryptionSecret);
      await instance.initialize?.();
      return instance;
    }

    throw new NotFoundError(`不支持的存储类型: ${storageType}`);
  }

  static getSupportedTypes() {
    return Array.from(registry.keys());
  }

  static isTypeSupported(storageType) {
    return registry.has(storageType);
  }

  static getTypeDisplayName(storageType) {
    return registry.get(storageType)?.displayName || storageType;
  }

  static validateConfig(storageType, config) {
    const entry = registry.get(storageType);
    if (!entry) {
      return { valid: false, errors: [`不支持的存储类型: ${storageType}`] };
    }
    if (typeof entry.validate === "function") {
      return entry.validate(config);
    }
    // 默认的S3验证
    if (storageType === StorageFactory.SUPPORTED_TYPES.S3) {
      return StorageFactory._validateS3Config(config);
    }
    if (storageType === StorageFactory.SUPPORTED_TYPES.WEBDAV) {
      return StorageFactory._validateWebDavConfig(config);
    }
    return { valid: true, errors: [] };
  }

  static _validateS3Config(config) {
    const errors = [];
    const required = ["id", "name", "provider_type", "endpoint_url", "bucket_name", "access_key_id", "secret_access_key"];
    for (const f of required) if (!config[f]) errors.push(`S3配置缺少必填字段: ${f}`);
    if (config.endpoint_url) {
      try {
        new URL(config.endpoint_url);
      } catch {
        errors.push("endpoint_url 格式无效");
      }
    }
    if (config.bucket_name && !/^[a-z0-9.-]+$/.test(config.bucket_name)) {
      errors.push("bucket_name 格式无效，只能包含小写字母、数字、点和连字符");
    }
    return { valid: errors.length === 0, errors };
  }

  static _validateWebDavConfig(config) {
    const errors = [];
    if (!config.endpoint_url) errors.push("WebDAV配置缺少必填字段: endpoint_url");
    if (!config.username) errors.push("WebDAV配置缺少必填字段: username");
    if (!config.password) errors.push("WebDAV配置缺少必填字段: password");

    if (config.endpoint_url) {
      try {
        const parsed = new URL(config.endpoint_url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("endpoint_url 必须以 http:// 或 https:// 开头");
        }
      } catch {
        errors.push("endpoint_url 格式无效");
      }
    }

    if (config.default_folder) {
      const folder = config.default_folder.toString();
      if (folder.includes("..")) {
        errors.push("default_folder 不允许包含 .. 段");
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

// 默认注册 S3 驱动与 tester
import { s3TestConnection } from "../drivers/s3/tester/S3Tester.js";
StorageFactory.registerDriver(StorageFactory.SUPPORTED_TYPES.S3, {
  ctor: S3StorageDriver,
  tester: s3TestConnection,
  displayName: "S3 兼容存储",
  validate: (cfg) => StorageFactory._validateS3Config(cfg),
  capabilities: [
    CAPABILITIES.READER,
    CAPABILITIES.WRITER,
    CAPABILITIES.PRESIGNED,
    CAPABILITIES.MULTIPART,
    CAPABILITIES.ATOMIC,
    CAPABILITIES.PROXY,
  ],
});

// 注册 WebDAV 驱动
import { webDavTestConnection } from "../drivers/webdav/WebDavTester.js";
StorageFactory.registerDriver(StorageFactory.SUPPORTED_TYPES.WEBDAV, {
  ctor: WebDavStorageDriver,
  tester: webDavTestConnection,
  displayName: "WebDAV 存储",
  validate: (cfg) => StorageFactory._validateWebDavConfig(cfg),
  capabilities: [CAPABILITIES.READER, CAPABILITIES.WRITER, CAPABILITIES.ATOMIC, CAPABILITIES.PROXY],
});
