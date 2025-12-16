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
import { GoogleDriveStorageDriver } from "../drivers/googledrive/GoogleDriveStorageDriver.js";
import { GithubReleasesStorageDriver } from "../drivers/github/GithubReleasesStorageDriver.js";
import { GithubApiStorageDriver } from "../drivers/github/GithubApiStorageDriver.js";
import { githubApiTestConnection } from "../drivers/github/tester/GithubApiTester.js";
import { githubReleasesTestConnection } from "../drivers/github/tester/GithubReleasesTester.js";
import { googleDriveTestConnection } from "../drivers/googledrive/tester/GoogleDriveTester.js";
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
    GOOGLE_DRIVE: "GOOGLE_DRIVE",
    GITHUB_RELEASES: "GITHUB_RELEASES",
    GITHUB_API: "GITHUB_API",
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

  static _validateGoogleDriveConfig(config) {
    const errors = [];

    const useOnlineApi = Boolean(config.use_online_api);
    const refreshToken = config.refresh_token;
    const apiAddress = config.api_address;

    // 公共必填：refresh_token
    if (!refreshToken) {
      errors.push("Google Drive 配置缺少必填字段: refresh_token");
    }

    // 在线 API 模式
    if (useOnlineApi) {
      if (!apiAddress) {
        errors.push("启用 use_online_api 时必须配置 api_address");
      } else {
        try {
          const parsed = new URL(apiAddress);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            errors.push("api_address 必须以 http:// 或 https:// 开头");
          }
        } catch {
          errors.push("api_address 格式无效");
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * GitHub Releases 配置校验：
   * - repo_structure 必填，按行配置：
   *   1）owner/repo
   *   2）别名:owner/repo
   *   3）完整仓库 URL：https://github.com/owner/repo（可带 /releases 等后缀）
   * - 可选字段：show_readme/show_all_version/show_source_code/token/gh_proxy/per_page；
   * - gh_proxy 若存在，需为合法 URL。
   * @param {object} config
   * @returns {{valid:boolean,errors:string[]}}
   */
  static _validateGithubReleasesConfig(config) {
    const errors = [];

    const raw = config?.repo_structure;
    if (!raw || typeof raw !== "string" || raw.trim().length === 0) {
      errors.push("GitHub Releases 配置缺少必填字段: repo_structure");
    } else {
      const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));
      if (lines.length === 0) {
        errors.push("GitHub Releases 配置 repo_structure 不能为空");
      } else {
        for (const line of lines) {
          let repoPart = line;

          // 支持三种显式格式：
          // 1）owner/repo
          // 2）别名:owner/repo
          // 3）https://github.com/owner/repo（可带 /releases 等后缀）
          // URL 形式（https://github.com/...）不参与别名分割，避免将 "https:" 误判为别名
          if (!/^https?:\/\/github\.com\//i.test(line)) {
            const idx = line.indexOf(":");
            if (idx >= 0) {
              repoPart = line.slice(idx + 1).trim();
              if (!repoPart) {
                errors.push(
                  `GitHub Releases 配置行格式无效，应为 owner/repo、别名:owner/repo 或 https://github.com/owner/repo: ${line}`,
                );
                continue;
              }
            }
          }

          let normalized = repoPart;
          if (/^https?:\/\/github\.com\//i.test(repoPart)) {
            // 完整 GitHub 仓库或 Releases URL
            normalized = repoPart.replace(/^https?:\/\/github\.com\//i, "");
          }

          // 为了规范输入，不允许以 / 开头的 owner/repo（例如 /owner/repo）
          if (normalized.startsWith("/")) {
            errors.push(
              `GitHub Releases 配置行格式无效，不支持以 / 开头的 owner/repo，请使用 owner/repo 或 别名:owner/repo 或完整仓库 URL: ${line}`,
            );
            continue;
          }

          const segments = normalized.split("/").filter((seg) => seg.length > 0);
          if (segments.length < 2) {
            errors.push(`GitHub Releases 配置行缺少 owner/repo 信息: ${line}`);
          }
        }
      }
    }

    if (config?.gh_proxy) {
      try {
        const parsed = new URL(config.gh_proxy);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("GitHub Releases 配置字段 gh_proxy 必须以 http:// 或 https:// 开头");
        }
      } catch {
        errors.push("GitHub Releases 配置字段 gh_proxy 格式无效");
      }
    }

    if (config?.per_page !== undefined) {
      const value = Number(config.per_page);
      if (!Number.isFinite(value) || value <= 0) {
        errors.push("GitHub Releases 配置字段 per_page 必须是大于 0 的数字");
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * GitHub API（仓库内容）配置校验：
   * - owner/repo/token 必填（写入必须）
   * - ref 可选：默认使用仓库 default_branch；支持 branch/tag/commit sha（仅分支可写）
   * - default_folder 可选：仅作为“文件上传页/分享上传”的默认目录前缀（不影响挂载浏览/FS 操作）
   * - api_base 可选：GitHub Enterprise/自定义 API Base（默认 https://api.github.com）
   * - gh_proxy 可选：用于加速 raw 直链
   * - committer/author 可选：自定义提交者与作者信息（需 name/email 成对出现）
   * @param {object} config
   * @returns {{valid:boolean,errors:string[]}}
   */
  static _validateGithubApiConfig(config) {
    const errors = [];

    if (!config?.owner) errors.push("GitHub API 配置缺少必填字段: owner");
    if (!config?.repo) errors.push("GitHub API 配置缺少必填字段: repo");
    if (!config?.token) errors.push("GitHub API 配置缺少必填字段: token");

    if (config?.ref) {
      const ref = String(config.ref).trim();
      if (ref.startsWith("refs/") && !ref.startsWith("refs/heads/") && !ref.startsWith("refs/tags/")) {
        errors.push("GitHub API 配置字段 ref 仅支持 refs/heads/* 或 refs/tags/*（或直接填写分支/标签/commit sha）");
      }
    }

    if (config?.api_base) {
      try {
        const parsed = new URL(config.api_base);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("GitHub API 配置字段 api_base 必须以 http:// 或 https:// 开头");
        }
      } catch {
        errors.push("GitHub API 配置字段 api_base 格式无效");
      }
    }

    if (config?.gh_proxy) {
      try {
        const parsed = new URL(config.gh_proxy);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("GitHub API 配置字段 gh_proxy 必须以 http:// 或 https:// 开头");
        }
      } catch {
        errors.push("GitHub API 配置字段 gh_proxy 格式无效");
      }
    }

    if (config?.default_folder) {
      const folder = config.default_folder.toString();
      if (folder.includes("..")) {
        errors.push("default_folder 不允许包含 .. 段");
      }
    }

    const committerName = config?.committer_name ? String(config.committer_name).trim() : "";
    const committerEmail = config?.committer_email ? String(config.committer_email).trim() : "";
    if ((committerName && !committerEmail) || (!committerName && committerEmail)) {
      errors.push("GitHub API 配置字段 committer_name 与 committer_email 必须同时填写或同时留空");
    }

    const authorName = config?.author_name ? String(config.author_name).trim() : "";
    const authorEmail = config?.author_email ? String(config.author_email).trim() : "";
    if ((authorName && !authorEmail) || (!authorName && authorEmail)) {
      errors.push("GitHub API 配置字段 author_name 与 author_email 必须同时填写或同时留空");
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

// 注册 Google Drive 驱动
StorageFactory.registerDriver(StorageFactory.SUPPORTED_TYPES.GOOGLE_DRIVE, {
  ctor: GoogleDriveStorageDriver,
  tester: googleDriveTestConnection,
  displayName: "Google Drive 存储",
  validate: (cfg) => StorageFactory._validateGoogleDriveConfig(cfg),
  capabilities: [
    CAPABILITIES.READER,
    CAPABILITIES.WRITER,
    CAPABILITIES.ATOMIC,
    CAPABILITIES.PROXY,
    CAPABILITIES.SEARCH,
    CAPABILITIES.MULTIPART,
  ],
  ui: {
    icon: "storage-googledrive",
    i18nKey: "admin.storage.type.googledrive",
    badgeTheme: "googledrive",
  },
  configProjector(cfg, { withSecrets = false } = {}) {
    const projected = {
      default_folder: cfg?.default_folder ?? "",
      root_id: cfg?.root_id ?? "root",
      enable_disk_usage: !!cfg?.enable_disk_usage,
      use_online_api: cfg?.use_online_api ?? false,
      api_address: cfg?.api_address,
      client_id: cfg?.client_id,
      enable_shared_view: cfg?.enable_shared_view !== false,
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
        name: "use_online_api",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.googledrive.use_online_api",
        ui: {
          descriptionKey: "admin.storage.description.googledrive.use_online_api",
          displayOptions: {
            trueKey: "admin.storage.display.googledrive.use_online_api.enabled",
            falseKey: "admin.storage.display.googledrive.use_online_api.disabled",
          },
        },
      },
      {
        name: "api_address",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.googledrive.api_address",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.googledrive.api_address",
          descriptionKey: "admin.storage.description.googledrive.api_address",
          // 与 OneDrive 行为对齐：仅在 use_online_api 启用时允许填写
          disabledWhen: {
            field: "use_online_api",
            equals: false,
          },
        },
      },
      {
        name: "client_id",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.googledrive.client_id",
        ui: {
          placeholderKey: "admin.storage.placeholder.googledrive.client_id",
          descriptionKey: "admin.storage.description.googledrive.client_id",
        },
      },
      {
        name: "client_secret",
        type: "secret",
        required: false,
        labelKey: "admin.storage.fields.googledrive.client_secret",
        ui: {
          placeholderKey: "admin.storage.placeholder.googledrive.client_secret",
          descriptionKey: "admin.storage.description.googledrive.client_secret",
        },
      },
      {
        name: "refresh_token",
        type: "secret",
        required: true,
        labelKey: "admin.storage.fields.googledrive.refresh_token",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.googledrive.refresh_token",
          descriptionKey: "admin.storage.description.googledrive.refresh_token",
        },
      },
      {
        name: "root_id",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.googledrive.root_id",
        ui: {
          placeholderKey: "admin.storage.placeholder.googledrive.root_id",
          descriptionKey: "admin.storage.description.googledrive.root_id",
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
        name: "enable_disk_usage",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.googledrive.enable_disk_usage",
        ui: {
          descriptionKey: "admin.storage.description.googledrive.enable_disk_usage",
        },
      },
      {
        name: "enable_shared_view",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.googledrive.enable_shared_view",
        ui: {
          descriptionKey: "admin.storage.description.googledrive.enable_shared_view",
          displayOptions: {
            trueKey: "admin.storage.display.googledrive.enable_shared_view.enabled",
            falseKey: "admin.storage.display.googledrive.enable_shared_view.disabled",
          },
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
          fields: [["root_id", "default_folder"]],
        },
        {
          name: "credentials",
          titleKey: "admin.storage.groups.credentials",
          fields: [["client_id", "client_secret"], "refresh_token"],
        },
        {
          name: "advanced",
          titleKey: "admin.storage.groups.advanced",
          fields: [["api_address", "use_online_api"], ["enable_disk_usage", "enable_shared_view"], "url_proxy"],
        },
      ],
      summaryFields: ["root_id", "default_folder", "use_online_api", "enable_disk_usage", "enable_shared_view"],
    },
  },
});

// 注册 GitHub Releases 驱动（只读）
StorageFactory.registerDriver(StorageFactory.SUPPORTED_TYPES.GITHUB_RELEASES, {
  ctor: GithubReleasesStorageDriver,
  tester: githubReleasesTestConnection,
  displayName: "GitHub Releases 存储",
  validate: (cfg) => StorageFactory._validateGithubReleasesConfig(cfg),
  capabilities: [CAPABILITIES.READER, CAPABILITIES.DIRECT_LINK, CAPABILITIES.PROXY],
  ui: {
    icon: "storage-github-releases",
    i18nKey: "admin.storage.type.github_releases",
    badgeTheme: "github",
  },
  configProjector(cfg, { withSecrets = false } = {}) {
    const projected = {
      // GitHub Releases 专用字段
      repo_structure: cfg?.repo_structure,
      show_readme: cfg?.show_readme ?? false,
      show_all_version: cfg?.show_all_version ?? false,
      show_source_code: cfg?.show_source_code ?? false,
      show_release_notes: cfg?.show_release_notes ?? false,
      gh_proxy: cfg?.gh_proxy,
      per_page: cfg?.per_page,
      total_storage_bytes: cfg?.total_storage_bytes,
    };

    if (withSecrets) {
      projected.token = cfg?.token;
    }

    return projected;
  },
  configSchema: {
    fields: [
      {
        name: "repo_structure",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.github_releases.repo_structure",
        ui: {
          fullWidth: true,
          descriptionKey: "admin.storage.description.github_releases.repo_structure",
          placeholderKey: "admin.storage.placeholder.github_releases.repo_structure",
        },
      },
      {
        name: "show_all_version",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.github_releases.show_all_version",
        ui: {
          descriptionKey: "admin.storage.description.github_releases.show_all_version",
        },
      },
      {
        name: "show_source_code",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.github_releases.show_source_code",
        ui: {
          descriptionKey: "admin.storage.description.github_releases.show_source_code",
        },
      },
      {
        name: "show_readme",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.github_releases.show_readme",
        ui: {
          descriptionKey: "admin.storage.description.github_releases.show_readme",
        },
      },
      {
        name: "show_release_notes",
        type: "boolean",
        required: false,
        labelKey: "admin.storage.fields.github_releases.show_release_notes",
        ui: {
          descriptionKey: "admin.storage.description.github_releases.show_release_notes",
        },
      },
      {
        name: "per_page",
        type: "number",
        required: false,
        labelKey: "admin.storage.fields.github_releases.per_page",
        ui: {
          descriptionKey: "admin.storage.description.github_releases.per_page",
        },
      },
      {
        name: "gh_proxy",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.github_releases.gh_proxy",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.github_releases.gh_proxy",
          descriptionKey: "admin.storage.description.github_releases.gh_proxy",
        },
      },
      {
        name: "token",
        type: "secret",
        required: false,
        labelKey: "admin.storage.fields.github_releases.token",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.github_releases.token",
          descriptionKey: "admin.storage.description.github_releases.token",
        },
      },
    ],
    layout: {
      groups: [
        {
          name: "basic",
          titleKey: "admin.storage.groups.basic",
          fields: ["repo_structure"],
        },
        {
          name: "behaviour",
          titleKey: "admin.storage.groups.behaviour",
          fields: [["show_all_version", "show_source_code"], ["show_readme", "show_release_notes"], "per_page"],
        },
        {
          name: "advanced",
          titleKey: "admin.storage.groups.advanced",
          fields: ["gh_proxy", "token"],
        },
      ],
      summaryFields: ["repo_structure", "show_all_version", "show_source_code", "show_release_notes"],
    },
  },
});

// 注册 GitHub API 驱动（可读写）
StorageFactory.registerDriver(StorageFactory.SUPPORTED_TYPES.GITHUB_API, {
  ctor: GithubApiStorageDriver,
  tester: githubApiTestConnection,
  displayName: "GitHub API 存储",
  validate: (cfg) => StorageFactory._validateGithubApiConfig(cfg),
  capabilities: [CAPABILITIES.READER, CAPABILITIES.WRITER, CAPABILITIES.ATOMIC, CAPABILITIES.PROXY, CAPABILITIES.DIRECT_LINK],
  ui: {
    icon: "storage-github-api",
    i18nKey: "admin.storage.type.github_api",
    badgeTheme: "github",
  },
  configProjector(cfg, { withSecrets = false } = {}) {
    const projected = {
      owner: cfg?.owner,
      repo: cfg?.repo,
      ref: cfg?.ref,
      default_folder: cfg?.default_folder,
      api_base: cfg?.api_base,
      gh_proxy: cfg?.gh_proxy,
      committer_name: cfg?.committer_name,
      committer_email: cfg?.committer_email,
      author_name: cfg?.author_name,
      author_email: cfg?.author_email,
      total_storage_bytes: cfg?.total_storage_bytes,
    };

    if (withSecrets) {
      projected.token = cfg?.token;
    }

    return projected;
  },
  configSchema: {
    fields: [
      {
        name: "owner",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.github_api.owner",
        ui: { placeholderKey: "admin.storage.placeholder.github_api.owner" },
      },
      {
        name: "repo",
        type: "string",
        required: true,
        labelKey: "admin.storage.fields.github_api.repo",
        ui: { placeholderKey: "admin.storage.placeholder.github_api.repo" },
      },
      {
        name: "ref",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.github_api.ref",
        ui: {
          placeholderKey: "admin.storage.placeholder.github_api.ref",
          descriptionKey: "admin.storage.description.github_api.ref",
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
        name: "api_base",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.github_api.api_base",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.github_api.api_base",
          descriptionKey: "admin.storage.description.github_api.api_base",
        },
      },
      {
        name: "gh_proxy",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.github_api.gh_proxy",
        validation: { rule: "url" },
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.github_api.gh_proxy",
          descriptionKey: "admin.storage.description.github_api.gh_proxy",
        },
      },
      {
        name: "committer_name",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.github_api.committer_name",
        ui: { placeholderKey: "admin.storage.placeholder.github_api.committer_name" },
      },
      {
        name: "committer_email",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.github_api.committer_email",
        ui: { placeholderKey: "admin.storage.placeholder.github_api.committer_email" },
      },
      {
        name: "author_name",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.github_api.author_name",
        ui: { placeholderKey: "admin.storage.placeholder.github_api.author_name" },
      },
      {
        name: "author_email",
        type: "string",
        required: false,
        labelKey: "admin.storage.fields.github_api.author_email",
        ui: { placeholderKey: "admin.storage.placeholder.github_api.author_email" },
      },
      {
        name: "token",
        type: "secret",
        required: true,
        labelKey: "admin.storage.fields.github_api.token",
        ui: {
          fullWidth: true,
          placeholderKey: "admin.storage.placeholder.github_api.token",
          descriptionKey: "admin.storage.description.github_api.token",
        },
      },
    ],
    layout: {
      groups: [
        {
          name: "basic",
          titleKey: "admin.storage.groups.basic",
          fields: [["owner", "repo"], ["ref", "default_folder"]],
        },
        {
          name: "advanced",
          titleKey: "admin.storage.groups.advanced",
          fields: ["token", "api_base", "gh_proxy", ["committer_name", "committer_email"], ["author_name", "author_email"]],
        },
      ],
      summaryFields: ["owner", "repo", "ref", "default_folder"],
    },
  },
});
