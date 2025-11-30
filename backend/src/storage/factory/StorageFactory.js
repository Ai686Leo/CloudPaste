/**
 * 存储驱动工厂（注册表版）
 * - 通过 registerDriver(type, meta) 注册驱动与tester
 * - createDriver 基于注册信息实例化
 * - validate/test 均可按驱动自定义实现
 */

import { S3StorageDriver } from "../drivers/s3/S3StorageDriver.js";
import { WebDavStorageDriver } from "../drivers/webdav/WebDavStorageDriver.js";
import { CAPABILITIES, REQUIRED_METHODS_BY_CAPABILITY } from "../interfaces/capabilities/index.js";
import { ValidationError, NotFoundError, DriverContractError } from "../../http/errors.js";

const registry = new Map();

/**
 * 对驱动实例进行运行时契约校验（类型 / 能力 / 方法实现）
 * - 依赖 registerDriver 时声明的 capabilities 以及 REQUIRED_METHODS_BY_CAPABILITY 映射表
 * - 目标是尽早发现“驱动声明的能力与实际实现不一致”的问题
 *
 * @param {any} driver - 已初始化的存储驱动实例
 * @param {{ displayName?: string, capabilities?: string[] }} entryMeta - 注册信息
 * @param {string} storageType - 注册时使用的存储类型（例如 'S3' / 'WEBDAV'）
 */
function validateDriverContract(driver, entryMeta, storageType) {
  if (!driver || !entryMeta) {
    throw new DriverContractError("存储驱动契约校验失败：驱动实例或注册元信息缺失", {
      details: { storageType },
    });
  }

  const registeredType = storageType;
  const registeredCapabilities = Array.isArray(entryMeta.capabilities) ? entryMeta.capabilities : [];

  const driverType = typeof driver.getType === "function" ? driver.getType() : driver.type;
  const rawCaps =
    typeof driver.getCapabilities === "function"
      ? driver.getCapabilities() || []
      : Array.isArray(driver.capabilities)
      ? driver.capabilities
      : [];

  const driverCapabilities = Array.from(new Set(rawCaps));

  const extraCapabilities = driverCapabilities.filter((cap) => !registeredCapabilities.includes(cap));
  const missingRegisteredCapabilities = registeredCapabilities.filter((cap) => !driverCapabilities.includes(cap));

  /** @type {Array<{capability: string, method: string}>} */
  const missingMethods = [];

  // 仅针对“注册表与驱动都声明”的能力进行方法级校验
  const effectiveCapabilities = driverCapabilities.filter((cap) => registeredCapabilities.includes(cap));

  for (const cap of effectiveCapabilities) {
    const requiredMethods = REQUIRED_METHODS_BY_CAPABILITY[cap];
    if (!requiredMethods || requiredMethods.length === 0) continue;
    for (const methodName of requiredMethods) {
      if (typeof driver[methodName] !== "function") {
        missingMethods.push({ capability: cap, method: methodName });
      }
    }
  }

  const typeMismatch = driverType && registeredType && driverType !== registeredType;

  // extraCapabilities / missingRegisteredCapabilities 目前仅作为调试信息存在：
  // - 某些驱动（如基于 S3 的实现）会根据配置（custom_host 等）在实例上追加能力，这在类型层面是“额外能力”，
  //   但不会破坏既有行为，因而不视为致命错误。
  // - registeredCapabilities 描述的是该存储类型在理想情况下支持的能力集合，具体实例可以是其子集。

  if (typeMismatch || missingMethods.length > 0) {
    throw new DriverContractError("存储驱动契约校验失败", {
      details: {
        storageType,
        registeredType,
        driverType,
        registeredCapabilities,
        driverCapabilities,
        extraCapabilities,
        missingRegisteredCapabilities,
        missingMethods,
      },
    });
  }
}

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
      // 在实例化完成后执行一次契约校验，确保驱动 type / capabilities / 方法实现与注册信息一致
      validateDriverContract(instance, entry, storageType);
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
    CAPABILITIES.DIRECT_LINK,
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
