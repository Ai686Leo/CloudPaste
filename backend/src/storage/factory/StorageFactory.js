/**
 * 存储驱动工厂（注册表版）
 * - 通过 registerDriver(type, meta) 注册驱动与tester
 * - createDriver 基于注册信息实例化
 * - validate/test 均可按驱动自定义实现
 */

import { S3StorageDriver } from "../drivers/s3/S3StorageDriver.js";
import { WebDavStorageDriver } from "../drivers/webdav/WebDavStorageDriver.js";
import { LocalStorageDriver } from "../drivers/local/LocalStorageDriver.js";
import { OneDriveStorageDriver } from "../drivers/onedrive/OneDriveStorageDriver.js";
import {
  CAPABILITIES,
  REQUIRED_METHODS_BY_CAPABILITY,
  BASE_REQUIRED_METHODS,
  getObjectCapabilities,
} from "../interfaces/capabilities/index.js";
import { ValidationError, NotFoundError, DriverContractError } from "../../http/errors.js";
import { isCloudflareWorkerEnvironment, isNodeJSEnvironment } from "../../utils/environmentUtils.js";

/**
 * 存储驱动注册表
 * - key: storage_type (例如 'S3' / 'WEBDAV' / 'LOCAL')
 * - value: {
 *     ctor: Function,
 *     tester: Function|null,
 *     displayName: string,
 *     validate: Function|null,
 *     capabilities: string[],
 *     ui?: {
 *       icon?: string,
 *       i18nKey?: string,
 *     },
 *     configSchema?: {
 *       fields: Array<{
 *         name: string,
 *         type: 'string'|'boolean'|'number'|'enum'|'secret',
 *         required?: boolean,
 *         defaultValue?: any,
 *         labelKey?: string,
 *         descriptionKey?: string,
 *         enumValues?: Array<{ value: string, labelKey?: string }>,
 *         validation?: {
 *           rule?: 'url'|'abs_path',
 *         },
 *         ui?: {
 *           fullWidth?: boolean,
 *           placeholderKey?: string,
 *           descriptionKey?: string,
 *         },
 *       }>,
 *       layout?: {
 *         groups?: Array<{
 *           name: string,
 *           titleKey?: string,
 *           fields: Array<string | string[]>,  // string = full-width, string[] = side-by-side
 *         }>,
 *         summaryFields?: string[],
 *       },
 *     },
 *     providerOptions?: Array<{ value: string, labelKey?: string }>,
 *     configProjector?: Function,
 *   }
 */
const registry = new Map();

/**
 * 对驱动实例进行运行时契约校验（类型 / 能力 / 方法实现）
 * - 依赖 registerDriver 时声明的 capabilities 以及 REQUIRED_METHODS_BY_CAPABILITY 映射表
 * - 目标是尽早发现"驱动声明的能力与实际实现不一致"的问题
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

  const detectedCapabilities = getObjectCapabilities(driver);
  const driverCapabilities = Array.from(new Set(rawCaps.length ? rawCaps : detectedCapabilities));

  const extraCapabilities = driverCapabilities.filter((cap) => !registeredCapabilities.includes(cap));
  const missingRegisteredCapabilities = registeredCapabilities.filter((cap) => !driverCapabilities.includes(cap));

  /** @type {Array<{capability: string, method: string}>} */
  const missingMethods = [];
  const missingBaseMethods = [];

  // 校验基础契约（所有驱动必须实现）
  for (const methodName of BASE_REQUIRED_METHODS) {
    if (typeof driver[methodName] !== "function") {
      missingBaseMethods.push(methodName);
    }
  }

  // 仅针对"注册表与驱动都声明"的能力进行方法级校验
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
  // - 某些驱动（如基于 S3 的实现）会根据配置（custom_host 等）在实例上追加能力，这在类型层面是"额外能力"，
  //   但不会破坏既有行为，因而不视为致命错误。
  // - registeredCapabilities 描述的是该存储类型在理想情况下支持的能力集合，具体实例可以是其子集。

  if (typeMismatch || missingBaseMethods.length > 0 || missingMethods.length > 0) {
    throw new DriverContractError("存储驱动契约校验失败", {
      details: {
        storageType,
        registeredType,
        driverType,
        registeredCapabilities,
        driverCapabilities,
        detectedCapabilities,
        extraCapabilities,
        missingRegisteredCapabilities,
        missingBaseMethods,
        missingMethods,
      },
    });
  }
}

export class StorageFactory {
  static SUPPORTED_TYPES = {
    S3: "S3",
    WEBDAV: "WEBDAV",
    LOCAL: "LOCAL",
    ONEDRIVE: "ONEDRIVE",
  };

  // 注册驱动
  static registerDriver(
      type,
      {
        ctor,
        tester = null,
        displayName = null,
        validate = null,
        capabilities = [],
        ui = null,
        configSchema = null,
        providerOptions = null,
        configProjector = null,
      } = {},
  ) {
    if (!type || !ctor) throw new ValidationError("registerDriver 需要提供 type 和 ctor");
    registry.set(type, {
      ctor,
      tester,
      displayName: displayName || type,
      validate,
      capabilities: Array.isArray(capabilities) ? capabilities : [],
      ui: ui || null,
      configSchema: configSchema || null,
      providerOptions: Array.isArray(providerOptions) ? providerOptions : null,
      configProjector: typeof configProjector === "function" ? configProjector : null,
    });
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
    const all = Array.from(registry.keys());
    // 在 Cloudflare Worker 或非 Node 环境下隐藏 LOCAL 类型
    const inWorker = isCloudflareWorkerEnvironment();
    const inNode = isNodeJSEnvironment();
    if (inWorker || !inNode) {
      return all.filter((type) => type !== StorageFactory.SUPPORTED_TYPES.LOCAL);
    }
    return all;
  }

  static isTypeSupported(storageType) {
    return registry.has(storageType);
  }

  static getTypeDisplayName(storageType) {
    return registry.get(storageType)?.displayName || storageType;
  }

  /**
   * 获取完整类型元数据（用于前端动态表单等）
   * @param {string} storageType
   */
  static getTypeMetadata(storageType) {
    const entry = registry.get(storageType);
    if (!entry) return null;
    return {
      type: storageType,
      displayName: entry.displayName || storageType,
      capabilities: Array.isArray(entry.capabilities) ? entry.capabilities : [],
      ui: entry.ui || null,
      configSchema: entry.configSchema || null,
      providerOptions: entry.providerOptions || null,
    };
  }

  /**
   * 获取所有类型的元数据列表
   * @returns {Array<object>}
   */
  static getAllTypeMetadata() {
    const inWorker = isCloudflareWorkerEnvironment();
    const inNode = isNodeJSEnvironment();
    const result = [];
    for (const [type, entry] of registry.entries()) {
      // 在 Cloudflare Worker 或非 Node 环境下不暴露 LOCAL 类型的元数据
      if ((inWorker || !inNode) && type === StorageFactory.SUPPORTED_TYPES.LOCAL) {
        continue;
      }
      result.push({
        type,
        displayName: entry.displayName || type,
        capabilities: Array.isArray(entry.capabilities) ? entry.capabilities : [],
        ui: entry.ui || null,
        configSchema: entry.configSchema || null,
        providerOptions: entry.providerOptions || null,
      });
    }
    return result;
  }

  static validateConfig(storageType, config) {
    const entry = registry.get(storageType);
    if (!entry) {
      return { valid: false, errors: [`不支持的存储类型: ${storageType}`] };
    }
    if (typeof entry.validate === "function") {
      return entry.validate(config);
    }
    return { valid: true, errors: [] };
  }

  /**
   * 使用注册表中的 configProjector 将 config_json 投影为驱动配置
   * @param {string} storageType - 存储类型
   * @param {object} cfg - config_json 解析后的对象
   * @param {{ withSecrets?: boolean, row?: object }} options
   * @returns {object} 投影后的配置对象
   */
  static projectConfig(storageType, cfg, { withSecrets = false, row = null } = {}) {
    const entry = registry.get(storageType);
    const safeCfg = cfg && typeof cfg === "object" ? cfg : {};

    if (!entry) {
      console.warn(`StorageFactory.projectConfig: 未找到存储类型注册信息: ${storageType}`);
      return { ...safeCfg };
    }

    if (typeof entry.configProjector === "function") {
      return entry.configProjector(safeCfg, { withSecrets, row });
    }

    // 默认：直接返回 cfg 的浅拷贝，方便逐步迁移
    return { ...safeCfg };
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

  static _validateLocalConfig(config) {
    const errors = [];

    const root = config?.root_path;
    if (!root) {
      errors.push("LOCAL 配置缺少必填字段: root_path");
    } else if (typeof root !== "string") {
      errors.push("LOCAL 配置字段 root_path 必须是字符串");
    } else {
      const trimmed = root.trim();
      const isPosixAbs = trimmed.startsWith("/");
      const isWinAbs = /^[a-zA-Z]:[\\/]/.test(trimmed);
      if (!isPosixAbs && !isWinAbs) {
        errors.push("LOCAL 配置字段 root_path 必须是绝对路径");
      }
    }

    // 环境约束：仅在 Node/Docker 且非 Cloudflare Worker 环境下允许配置 LOCAL
    const inWorker = isCloudflareWorkerEnvironment();
    const inNode = isNodeJSEnvironment();
    if (inWorker || !inNode) {
      errors.push("LOCAL 存储仅支持 Node/Docker 环境，当前运行环境不支持 LOCAL");
    }

    return { valid: errors.length === 0, errors };
  }

  static _validateOneDriveConfig(config) {
    const errors = [];

    // redirect_uri 必填（用于标识外部授权回调地址）
    if (!config.redirect_uri) {
      errors.push("OneDrive 配置缺少必填字段: redirect_uri");
    }

    // refresh_token 必填
    if (!config.refresh_token) {
      errors.push("OneDrive 配置缺少必填字段: refresh_token");
    }

    // 当未配置 token_renew_endpoint 时，必须提供 client_id 以便直接调用微软 OAuth 端点刷新 token
    if (!config.token_renew_endpoint && !config.client_id) {
      errors.push("OneDrive 配置缺少 client_id（未配置 token_renew_endpoint 时必填）");
    }

    // region 值域验证
    const validRegions = ["global", "cn", "us", "de"];
    if (config.region && !validRegions.includes(config.region)) {
      errors.push(`OneDrive 配置 region 值无效，必须是: ${validRegions.join(", ")}`);
    }

    // token_renew_endpoint URL 格式验证
    if (config.token_renew_endpoint) {
      try {
        const parsed = new URL(config.token_renew_endpoint);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("token_renew_endpoint 必须以 http:// 或 https:// 开头");
        }
      } catch {
        errors.push("token_renew_endpoint 格式无效");
      }
    }

    // redirect_uri URL 格式验证
    if (config.redirect_uri) {
      try {
        const parsed = new URL(config.redirect_uri);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("redirect_uri 必须以 http:// 或 https:// 开头");
        }
      } catch {
        errors.push("redirect_uri 格式无效");
      }
    }

    // Online API 模式：必须配置 token_renew_endpoint
    if (config.use_online_api && !config.token_renew_endpoint) {
      errors.push("启用 use_online_api 时必须配置 token_renew_endpoint");
    }

    // default_folder 路径验证（仅作为存储内默认上传前缀）
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
    CAPABILITIES.SEARCH,
  ],
  ui: {
    icon: "storage-s3",
    i18nKey: "admin.storage.type.s3",
    badgeTheme: "s3",
  },
  configProjector(cfg, { withSecrets = false } = {}) {
    const projected = {
      // 通用字段
      default_folder: cfg?.default_folder,
      custom_host: cfg?.custom_host,
      signature_expires_in: cfg?.signature_expires_in,
      total_storage_bytes: cfg?.total_storage_bytes,
      // S3 专用字段
      provider_type: cfg?.provider_type,
      endpoint_url: cfg?.endpoint_url,
      bucket_name: cfg?.bucket_name,
      region: cfg?.region,
      path_style: cfg?.path_style,
    };

    if (withSecrets) {
      projected.access_key_id = cfg?.access_key_id;
      projected.secret_access_key = cfg?.secret_access_key;
    }

    return projected;
  },
  configSchema: {
    fields: [
      {
        name: "provider_type",
        type: "enum",
        required: true,
        labelKey: "admin.storage.fields.provider_type",
        enumValues: [
          { value: "Cloudflare R2", labelKey: "admin.storage.s3.provider.cloudflare_r2" },
          { value: "Backblaze B2", labelKey: "admin.storage.s3.provider.backblaze_b2" },
          { value: "AWS S3", labelKey: "admin.storage.s3.provider.aws_s3" },
          { value: "Aliyun OSS", labelKey: "admin.storage.s3.provider.aliyun_oss" },
          { value: "Other", labelKey: "admin.storage.s3.provider.other" },
        ],
      },
      {
        name: "bucket_name",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.bucket_name",
        ui: { placeholderKey: "admin.storage.placeholder.bucket_name" },
      },
      {
        name: "endpoint_url",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.endpoint_url",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.endpoint_url",
          descriptionKey: "admin.storage.description.endpoint_url",
        },
      },
      {
        name: "region",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.region",
        ui: { placeholderKey: "admin.storage.placeholder.region" },
      },
      {
        name: "path_style",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.path_style",
        ui: {
          descriptionKey: "admin.storage.description.path_style",
          displayOptions: {
            trueKey: "admin.storage.display.path_style.path",
            falseKey: "admin.storage.display.path_style.virtual_host",
          },
        },
      },
      {
        name: "access_key_id",
        type: "secret",
        required: false,
        labelKey: "admin.storage.fields.access_key_id",
        ui: { placeholderKey: "admin.storage.placeholder.access_key_id" },
      },
      {
        name: "secret_access_key",
        type: "secret",
        required: false,
        labelKey: "admin.storage.fields.secret_access_key",
        ui: { placeholderKey: "admin.storage.placeholder.secret_access_key" },
      },
      {
        name: "default_folder",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.default_folder",
        ui: {
          placeholderKey: "admin.storage.placeholder.default_folder",
          emptyTextKey: "admin.storage.display.default_folder.root",
        },
      },
      {
        name: "signature_expires_in",
        type: "number",
        required: false,
        labelKey: "admin.storage.fields.signature_expires_in",
        defaultValue: 3600,
        ui: { descriptionKey: "admin.storage.description.signature_expires_in" },
      },
      {
        name: "custom_host",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.custom_host",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.custom_host",
          descriptionKey: "admin.storage.description.custom_host",
        },
      },
      {
        name: "url_proxy",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.url_proxy",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.url_proxy",
          descriptionKey: "admin.storage.description.url_proxy",
        },
      },
    ],
    layout: {
      groups: [
        {
          name: "basic",
          titleKey: "admin.storage.groups.basic",
          fields: [["provider_type", "bucket_name"]],
        },
        {
          name: "connection",
          titleKey: "admin.storage.groups.connection",
          fields: ["endpoint_url", ["region", "default_folder"]],
        },
        {
          name: "credentials",
          titleKey: "admin.storage.groups.credentials",
          fields: [["access_key_id", "secret_access_key"]],
        },
        {
          name: "advanced",
          titleKey: "admin.storage.groups.advanced",
          fields: ["custom_host", "url_proxy", ["signature_expires_in", "path_style"]],
        },
      ],
      summaryFields: ["bucket_name", "region", "default_folder", "path_style"],
    },
  },
  providerOptions: [
    { value: "Cloudflare R2", labelKey: "admin.storage.s3.provider.cloudflare_r2" },
    { value: "Backblaze B2", labelKey: "admin.storage.s3.provider.backblaze_b2" },
    { value: "AWS S3", labelKey: "admin.storage.s3.provider.aws_s3" },
    { value: "Aliyun OSS", labelKey: "admin.storage.s3.provider.aliyun_oss" },
    { value: "Other", labelKey: "admin.storage.s3.provider.other" },
  ],
});

// 注册 WebDAV 驱动
import { webDavTestConnection } from "../drivers/webdav/WebDavTester.js";
StorageFactory.registerDriver(StorageFactory.SUPPORTED_TYPES.WEBDAV, {
  ctor: WebDavStorageDriver,
  tester: webDavTestConnection,
  displayName: "WebDAV 存储",
  validate: (cfg) => StorageFactory._validateWebDavConfig(cfg),
  capabilities: [CAPABILITIES.READER, CAPABILITIES.WRITER, CAPABILITIES.ATOMIC, CAPABILITIES.PROXY, CAPABILITIES.SEARCH],
  ui: {
    icon: "storage-webdav",
    i18nKey: "admin.storage.type.webdav",
    badgeTheme: "webdav",
  },
  configProjector(cfg, { withSecrets = false } = {}) {
    const projected = {
      // 通用字段
      default_folder: cfg?.default_folder,
      custom_host: cfg?.custom_host,
      signature_expires_in: cfg?.signature_expires_in,
      total_storage_bytes: cfg?.total_storage_bytes,
      // WebDAV 专用字段
      endpoint_url: cfg?.endpoint_url,
      username: cfg?.username,
      tls_insecure_skip_verify: cfg?.tls_insecure_skip_verify,
    };

    if (withSecrets) {
      projected.password = cfg?.password;
    }

    return projected;
  },
  configSchema: {
    fields: [
      {
        name: "endpoint_url",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.endpoint_url",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.webdav_endpoint",
          descriptionKey: "admin.storage.description.webdav_endpoint",
        },
      },
      {
        name: "username",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.username",
        ui: { placeholderKey: "admin.storage.placeholder.username" },
      },
      {
        name: "password",
        type: "secret",
        required: false,
        labelKey: "admin.storage.fields.password",
        ui: { placeholderKey: "admin.storage.placeholder.password" },
      },
      {
        name: "default_folder",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.default_folder",
        ui: {
          placeholderKey: "admin.storage.placeholder.default_folder",
          emptyTextKey: "admin.storage.display.default_folder.root",
        },
      },
      {
        name: "tls_insecure_skip_verify",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.tls_insecure_skip_verify",
        ui: { descriptionKey: "admin.storage.description.tls_insecure_skip_verify" },
      },
      {
        name: "url_proxy",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.url_proxy",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.url_proxy",
          descriptionKey: "admin.storage.description.url_proxy",
        },
      },
    ],
    layout: {
      groups: [
        {
          name: "connection",
          titleKey: "admin.storage.groups.connection",
          fields: ["endpoint_url", ["username", "default_folder"]],
        },
        {
          name: "credentials",
          titleKey: "admin.storage.groups.credentials",
          fields: ["password"],
        },
        {
          name: "advanced",
          titleKey: "admin.storage.groups.advanced",
          fields: ["url_proxy", "tls_insecure_skip_verify"],
        },
      ],
      summaryFields: ["endpoint_url", "username", "default_folder"],
    },
  },
});

// 注册 LOCAL 驱动
import { localTestConnection } from "../drivers/local/tester/LocalTester.js";
StorageFactory.registerDriver(StorageFactory.SUPPORTED_TYPES.LOCAL, {
  ctor: LocalStorageDriver,
  tester: localTestConnection,
  displayName: "本地文件系统",
  validate: (cfg) => StorageFactory._validateLocalConfig(cfg),
  capabilities: [CAPABILITIES.READER, CAPABILITIES.WRITER, CAPABILITIES.ATOMIC, CAPABILITIES.SEARCH, CAPABILITIES.PROXY],
  ui: {
    icon: "storage-local",
    i18nKey: "admin.storage.type.local",
    badgeTheme: "local",
  },
  configProjector(cfg) {
    return {
      // 通用字段
      default_folder: cfg?.default_folder,
      custom_host: cfg?.custom_host,
      signature_expires_in: cfg?.signature_expires_in,
      total_storage_bytes: cfg?.total_storage_bytes,
      // LOCAL 专用字段
      root_path: cfg?.root_path,
      auto_create_root: cfg?.auto_create_root,
      readonly: cfg?.readonly,
      trash_path: cfg?.trash_path,
      dir_permission: cfg?.dir_permission,
    };
  },
  configSchema: {
    fields: [
      {
        name: "root_path",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.local.root_path",
        validation: { rule: "abs_path" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.root_path",
          descriptionKey: "admin.storage.description.root_path",
        },
      },
      {
        name: "auto_create_root",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.local.auto_create_root",
        ui: {
          descriptionKey: "admin.storage.description.auto_create_root",
        },
      },
      {
        name: "default_folder",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.default_folder",
        ui: {
          placeholderKey: "admin.storage.placeholder.default_folder",
          emptyTextKey: "admin.storage.display.default_folder.root",
        },
      },
      {
        name: "readonly",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.local.readonly",
        ui: { descriptionKey: "admin.storage.description.readonly" },
      },
      {
        name: "url_proxy",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.url_proxy",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.url_proxy",
          descriptionKey: "admin.storage.description.url_proxy",
        },
      },
      {
        name: "trash_path",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.local.trash_path",
        ui: {
          placeholderKey: "admin.storage.placeholder.trash_path",
          descriptionKey: "admin.storage.description.trash_path",
        },
      },
      {
        name: "dir_permission",
        type: "string",
        required: false,
        defaultValue: "0777",
        labelKey: "admin.storage.fields.local.dir_permission",
        validation: { rule: "octal_permission" },
        ui: {
          placeholderKey: "admin.storage.placeholder.dir_permission",
          descriptionKey: "admin.storage.description.dir_permission",
        },
      },
    ],
    layout: {
      groups: [
        {
          name: "basic",
          titleKey: "admin.storage.groups.basic",
          // 第一行：root_path 与 auto_create_root 并排显示；第二行：default_folder 与 trash_path 并排
          fields: [["root_path", "auto_create_root"], ["default_folder", "trash_path"]],
        },
        {
          name: "permissions",
          titleKey: "admin.storage.groups.permissions",
          // 左：目录/文件权限；右：只读模式勾选
          fields: [["dir_permission", "readonly"]],
        },
        {
          name: "advanced",
          titleKey: "admin.storage.groups.advanced",
          fields: ["url_proxy"],
        },
      ],
      // 卡片摘要显示：根目录、默认目录以及关键行为开关
      summaryFields: ["root_path", "default_folder", "readonly", "trash_path"],
    },
  },
});

// 注册 OneDrive 驱动
import { oneDriveTestConnection } from "../drivers/onedrive/tester/OneDriveTester.js";
StorageFactory.registerDriver(StorageFactory.SUPPORTED_TYPES.ONEDRIVE, {
  ctor: OneDriveStorageDriver,
  tester: oneDriveTestConnection,
  displayName: "OneDrive 存储",
  validate: (cfg) => StorageFactory._validateOneDriveConfig(cfg),
  capabilities: [CAPABILITIES.READER, CAPABILITIES.WRITER, CAPABILITIES.ATOMIC, CAPABILITIES.PROXY, CAPABILITIES.SEARCH, CAPABILITIES.DIRECT_LINK],
  ui: {
    icon: "storage-onedrive",
    i18nKey: "admin.storage.type.onedrive",
    badgeTheme: "onedrive",
  },
  configProjector(cfg, { withSecrets = false } = {}) {
    const projected = {
      // 通用字段
      default_folder: cfg?.default_folder ?? cfg?.root_folder ?? "",
      custom_host: cfg?.custom_host,
      url_proxy: cfg?.url_proxy,
      signature_expires_in: cfg?.signature_expires_in,
      total_storage_bytes: cfg?.total_storage_bytes,
      // OneDrive 专用字段
      region: cfg?.region,
      client_id: cfg?.client_id,
      token_renew_endpoint: cfg?.token_renew_endpoint,
      redirect_uri: cfg?.redirect_uri,
      use_online_api: cfg?.use_online_api,
      has_refresh_token: !!(cfg?.refresh_token && String(cfg.refresh_token).trim().length > 0),
    };

    if (withSecrets) {
      projected.client_secret = cfg?.client_secret;
      projected.refresh_token = cfg?.refresh_token;
    }

    return projected;
  },
  configSchema: {
    fields: [
      {
        name: "region",
        type: "enum",
        required: false,
        defaultValue: "global",
        labelKey: "admin.storage.fields.onedrive.region",
        enumValues: [
          { value: "global", labelKey: "admin.storage.onedrive.region.global" },
          { value: "cn", labelKey: "admin.storage.onedrive.region.cn" },
          { value: "us", labelKey: "admin.storage.onedrive.region.us" },
          { value: "de", labelKey: "admin.storage.onedrive.region.de" },
        ],
        ui: {
          descriptionKey: "admin.storage.description.onedrive.region",
        },
      },
      {
        name: "client_id",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.onedrive.client_id",
        ui: {
          placeholderKey: "admin.storage.placeholder.onedrive.client_id",
          descriptionKey: "admin.storage.description.onedrive.client_id",
        },
      },
      {
        name: "client_secret",
        type: "secret",
        required: false,
        labelKey: "admin.storage.fields.onedrive.client_secret",
        ui: {
          placeholderKey: "admin.storage.placeholder.onedrive.client_secret",
          descriptionKey: "admin.storage.description.onedrive.client_secret",
        },
      },
      {
        name: "refresh_token",
        type: "secret",
        required: true,
        labelKey: "admin.storage.fields.onedrive.refresh_token",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.onedrive.refresh_token",
          descriptionKey: "admin.storage.description.onedrive.refresh_token",
        },
      },
      {
        name: "default_folder",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.default_folder",
        ui: {
          placeholderKey: "admin.storage.placeholder.default_folder",
          emptyTextKey: "admin.storage.display.default_folder.root",
          descriptionKey: "admin.storage.description.onedrive.root_folder",
        },
      },
      {
        name: "url_proxy",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.url_proxy",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.url_proxy",
          descriptionKey: "admin.storage.description.url_proxy",
        },
      },
      {
        name: "token_renew_endpoint",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.onedrive.token_renew_endpoint",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.onedrive.token_renew_endpoint",
          descriptionKey: "admin.storage.description.onedrive.token_renew_endpoint",
        },
      },
      {
        name: "redirect_uri",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.onedrive.redirect_uri",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.onedrive.redirect_uri",
          descriptionKey: "admin.storage.description.onedrive.redirect_uri",
        },
      },
      {
        name: "use_online_api",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.onedrive.use_online_api",
        ui: {
          descriptionKey: "admin.storage.description.onedrive.use_online_api",
          displayOptions: {
            trueKey: "admin.storage.display.onedrive.use_online_api.enabled",
            falseKey: "admin.storage.display.onedrive.use_online_api.disabled",
          },
        },
      },
    ],
    layout: {
      groups: [
        {
          name: "basic",
          titleKey: "admin.storage.groups.basic",
          fields: [["region", "default_folder"]],
        },
        {
          name: "credentials",
          titleKey: "admin.storage.groups.credentials",
          fields: [["client_id", "client_secret"], "refresh_token"],
        },
        {
          name: "advanced",
          titleKey: "admin.storage.groups.advanced",
          fields: ["redirect_uri", ["token_renew_endpoint", "use_online_api"], "url_proxy"],
        },
      ],
      summaryFields: ["region", "default_folder", "use_online_api"],
    },
  },
  providerOptions: [
    { value: "global", labelKey: "admin.storage.onedrive.region.global" },
    { value: "cn", labelKey: "admin.storage.onedrive.region.cn" },
  ],
});
