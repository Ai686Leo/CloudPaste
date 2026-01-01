// 统一的存储配置服务（单表 + JSON）
import { ensureRepositoryFactory } from "../utils/repositories.js";
import { StorageFactory } from "../storage/factory/StorageFactory.js";
import { MountManager } from "../storage/managers/MountManager.js";
import { ApiStatus } from "../constants/index.js";
import { AppError, ValidationError, NotFoundError, DriverError } from "../http/errors.js";
import { CAPABILITIES } from "../storage/interfaces/capabilities/index.js";
import { invalidateFsCache } from "../cache/invalidation.js";
import { FsSearchIndexStore } from "../storage/fs/search/FsSearchIndexStore.js";

/**
 * 计算存储配置在 WebDAV 渠道下支持的策略列表
 * 返回值用于前端根据能力渲染可选的 webdav_policy
 * @param {object} cfg
 * @returns {string[]} webdav_supported_policies
 */
function computeWebDavSupportedPolicies(cfg) {
  const policies = [];
  const type = cfg?.storage_type;
  const hasUrlProxy = !!cfg?.url_proxy;

  // 所有存储类型统一支持本地代理（native_proxy）
  policies.push("native_proxy");

  // 只要配置了 url_proxy，就支持 URL 代理（use_proxy_url），与 storage_type 无关
  if (hasUrlProxy) {
    policies.push("use_proxy_url");
  }

  // 仅具备 DirectLink 能力的类型暴露 302_redirect（例如 S3、ONEDRIVE 等）
  if (type && StorageFactory.supportsCapability(type, CAPABILITIES.DIRECT_LINK)) {
    policies.push("302_redirect");
  }

  // 去重
  return Array.from(new Set(policies));
}

/**
 * 判断一个输入值是否像“掩码占位符”（例如 *****1234）
 * - 这是为了防止编辑表单时把 masked 值写回数据库，覆盖真实密钥
 * - 前端应该已做过滤，但后端必须兜底
 * @param {any} value
 * @returns {boolean}
 */
function isMaskedSecretPlaceholder(value) {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (!s) return false;
  // maskSecret 默认会生成很多个 * + 尾部少量可见字符
  // 这里用一个“非常保守但够用”的判定：至少 3 个 * 开头
  return /^\*{3,}.+$/.test(s);
}

function getTypeConfigSchema(storageType) {
  if (!storageType) return null;
  const meta = StorageFactory.getTypeMetadata(storageType);
  return meta?.configSchema || null;
}

function getSecretFieldDefsFromSchema(schema) {
  const fields = schema?.fields;
  if (!Array.isArray(fields)) return [];
  return fields.filter((f) => f && typeof f === "object" && f.type === "secret" && typeof f.name === "string" && f.name);
}

function shouldSkipSecretWrite(value, { allowEmpty = true } = {}) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") {
    const s = value.trim();
    if (allowEmpty && s.length === 0) return true;
    if (isMaskedSecretPlaceholder(s)) return true;
  }
  return false;
}

async function encryptSecretsInConfigJson(storageType, configJson, encryptionSecret, { requireRequiredSecrets = false } = {}) {
  const schema = getTypeConfigSchema(storageType);
  const secretFields = getSecretFieldDefsFromSchema(schema);
  if (!secretFields.length) return configJson;

  for (const f of secretFields) {
    const key = f.name;
    const raw = configJson?.[key];

    // required 校验（仅用于 create）
    if (requireRequiredSecrets) {
      const missing =
        raw === undefined ||
        raw === null ||
        (typeof raw === "string" && raw.trim().length === 0) ||
        isMaskedSecretPlaceholder(raw);
      if (f.required === true && missing) {
        throw new ValidationError(`缺少必填字段: ${key}`);
      }
    }

    // 跳过空值（update 时应“保留原值”）
    if (shouldSkipSecretWrite(raw, { allowEmpty: true })) {
      continue;
    }

    // 明确拒绝 masked 占位符写入（无论 create/update）
    if (isMaskedSecretPlaceholder(raw)) {
      throw new ValidationError(`字段 ${key} 不能是掩码占位符，请重新填写`);
    }

    configJson[key] = await encryptValue(String(raw), encryptionSecret);
  }

  return configJson;
}
import { encryptValue, buildSecretView } from "../utils/crypto.js";
import { generateStorageConfigId } from "../utils/common.js";

// 列表/查询
export async function getStorageConfigsByAdmin(db, adminId, options = {}, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  if (options.page !== undefined || options.limit !== undefined) {
    const result = await repo.findByAdminWithPagination(adminId, options);
    const configs = Array.isArray(result.configs) ? result.configs : [];
    const enhanced = configs.map((cfg) => ({
      ...cfg,
      webdav_supported_policies: computeWebDavSupportedPolicies(cfg),
    }));
    return { ...result, configs: enhanced, total: result.total ?? enhanced.length };
  }
  const configs = await repo.findByAdmin(adminId);
  const enhanced = Array.isArray(configs)
    ? configs.map((cfg) => ({
        ...cfg,
        webdav_supported_policies: computeWebDavSupportedPolicies(cfg),
      }))
    : [];
  return { configs: enhanced, total: enhanced.length };
}

export async function getPublicStorageConfigs(db, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  const configs = await repo.findPublic();
  return Array.isArray(configs)
    ? configs.map((cfg) => ({
        ...cfg,
        webdav_supported_policies: computeWebDavSupportedPolicies(cfg),
      }))
    : configs;
}

export async function getStorageConfigByIdForAdmin(db, id, adminId, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  const cfg = await repo.findByIdAndAdmin(id, adminId);
  if (!cfg) throw new NotFoundError("存储配置不存在");
  return cfg;
}

export async function getPublicStorageConfigById(db, id, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  const cfg = await repo.findPublicById(id);
  if (!cfg) throw new NotFoundError("存储配置不存在");
  return cfg;
}

/**
 * 显示密钥明文（受控）：仅管理员、仅单次请求按需解密
 * 返回时可选择 masked/plain
 */
export async function getStorageConfigByIdForAdminReveal(db, id, adminId, encryptionSecret, mode = "plain", repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  const cfg = await repo.findByIdAndAdminWithSecrets(id, adminId);
  if (!cfg) throw new NotFoundError("存储配置不存在");
  // 仅构建展示，不改变存量
  const view = await buildSecretView(cfg, encryptionSecret, { mode });
  return view;
}

// CRUD（使用 config_json 存储驱动私有配置）
export async function createStorageConfig(db, configData, adminId, encryptionSecret, repositoryFactory = null) {
  if (!configData?.name) {
    throw new ValidationError("缺少必填字段: name");
  }
  if (!configData?.storage_type) {
    throw new ValidationError("缺少必填字段: storage_type");
  }
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();

  const id = generateStorageConfigId();
  let configJson = {};
  if (configData.storage_type === "S3") {
    const requiredS3 = ["provider_type", "endpoint_url", "bucket_name", "access_key_id", "secret_access_key"];
    for (const f of requiredS3) {
      if (!configData[f]) throw new ValidationError(`缺少必填字段: ${f}`);
    }
    if (isMaskedSecretPlaceholder(configData.access_key_id) || isMaskedSecretPlaceholder(configData.secret_access_key)) {
      throw new ValidationError("S3 密钥字段疑似为掩码占位符（*****1234），请重新填写真实值");
    }
    const encryptedAccessKey = await encryptValue(configData.access_key_id, encryptionSecret);
    const encryptedSecretKey = await encryptValue(configData.secret_access_key, encryptionSecret);
    configJson = {
      provider_type: configData.provider_type,
      endpoint_url: configData.endpoint_url,
      bucket_name: configData.bucket_name,
      region: configData.region || "",
      path_style: configData.path_style === true ? 1 : 0,
      default_folder: configData.default_folder || "",
      total_storage_bytes: configData.total_storage_bytes ? parseInt(configData.total_storage_bytes, 10) : null,
      custom_host: configData.custom_host || null,
      signature_expires_in: parseInt(configData.signature_expires_in, 10) || 3600,
      access_key_id: encryptedAccessKey,
      secret_access_key: encryptedSecretKey,
    };
  } else if (configData.storage_type === "WEBDAV") {
    const requiredWebDav = ["endpoint_url", "username", "password"];
    for (const f of requiredWebDav) {
      if (!configData[f]) throw new ValidationError(`缺少必填字段: ${f}`);
    }
    if (isMaskedSecretPlaceholder(configData.password)) {
      throw new ValidationError("WebDAV 密码字段疑似为掩码占位符（*****1234），请重新填写真实值");
    }

    let endpoint_url = String(configData.endpoint_url).trim();
    try {
      const parsed = new URL(endpoint_url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new ValidationError("endpoint_url 格式无效，必须以 http:// 或 https:// 开头");
      }
    } catch {
      throw new ValidationError("endpoint_url 不是合法的 URL");
    }
    if (!endpoint_url.endsWith("/")) {
      endpoint_url += "/";
    }

    const encryptedPassword = await encryptValue(configData.password, encryptionSecret);

    let defaultFolder = (configData.default_folder || "").toString().trim();
    defaultFolder = defaultFolder.replace(/^\/+/, "");

    let totalStorageBytes = null;
    if (configData.total_storage_bytes) {
      const val = parseInt(configData.total_storage_bytes, 10);
      totalStorageBytes = Number.isFinite(val) && val > 0 ? val : null;
    }

    configJson = {
      endpoint_url,
      username: configData.username,
      password: encryptedPassword,
      default_folder: defaultFolder,
      tls_insecure_skip_verify: configData.tls_insecure_skip_verify ? 1 : 0,
      total_storage_bytes: totalStorageBytes,
    };
  } else {
    const { name, storage_type, is_public, is_default, remark, url_proxy, ...rest } = configData;
    configJson = rest || {};
    await encryptSecretsInConfigJson(configData.storage_type, configJson, encryptionSecret, { requireRequiredSecrets: true });
  }
  const createData = {
    id,
    name: configData.name,
    storage_type: configData.storage_type,
    admin_id: adminId,
    is_public: configData.is_public ? 1 : 0,
    is_default: configData.is_default ? 1 : 0,
     remark: configData.remark ?? null,
     url_proxy: configData.url_proxy || null,
    status: "ENABLED",
    config_json: JSON.stringify(configJson),
  };

  await repo.createConfig(createData);
  // 如果设置为默认，复用仓储层的原子更新
  if (createData.is_default === 1) {
    await repo.setAsDefault(id, adminId);
  }
  return await repo.findByIdAndAdmin(id, adminId);
}

export async function updateStorageConfig(db, id, updateData, adminId, encryptionSecret, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  const exists = await repo.findByIdAndAdminWithSecrets(id, adminId);
  if (!exists) throw new NotFoundError("存储配置不存在");

  // 是否有“驱动私有配置”字段变化（比如 endpoint/bucket/token 等）
  // - 仅改 name/remark/is_public/is_default/status 这种“展示/开关”字段，不需要清索引
  // - 一旦改了驱动配置，旧索引可能对应的是“旧数据源/旧路径”，必须标记 not_ready 让你重建
  let driverConfigChanged = false;
  const topPatch = {};
  if (updateData.name) topPatch.name = updateData.name;
  if (updateData.is_public !== undefined) topPatch.is_public = updateData.is_public ? 1 : 0;
  if (updateData.is_default !== undefined) topPatch.is_default = updateData.is_default ? 1 : 0;
  if (updateData.status) topPatch.status = updateData.status;
  if (updateData.remark !== undefined) topPatch.remark = updateData.remark;
  if (updateData.url_proxy !== undefined) topPatch.url_proxy = updateData.url_proxy || null;

  let cfg = {};
  if (exists?.__config_json__ && typeof exists.__config_json__ === "object") {
    cfg = { ...exists.__config_json__ };
  }

  // 本类型 schema 中声明的 secret 字段集合
  const schema = getTypeConfigSchema(exists.storage_type);
  const secretFieldSet = new Set(getSecretFieldDefsFromSchema(schema).map((f) => f.name));

  // 合并驱动 JSON 字段
  const boolKeys = new Set(["path_style", "tls_insecure_skip_verify"]);
  for (const [k, v] of Object.entries(updateData)) {
    if (["name", "storage_type", "is_public", "is_default", "status", "remark", "url_proxy"].includes(k)) continue;

    // secret：空值/掩码占位符 -> 不提交（保留原值）；真实值 -> 加密写入
    if (secretFieldSet.has(k)) {
      if (shouldSkipSecretWrite(v, { allowEmpty: true })) {
        continue;
      }
      // shouldSkipSecretWrite 已涵盖 masked，这里再次兜底
      if (isMaskedSecretPlaceholder(v)) {
        continue;
      }
      cfg[k] = await encryptValue(String(v), encryptionSecret);
      driverConfigChanged = true;
      continue;
    }

    driverConfigChanged = true;
    if (k === "total_storage_bytes") {
      const val = parseInt(v, 10);
      cfg.total_storage_bytes = Number.isFinite(val) && val > 0 ? val : null;
    } else if (k === "signature_expires_in") {
      const se = parseInt(v, 10);
      cfg.signature_expires_in = Number.isFinite(se) ? se : 3600;
    } else if (k === "endpoint_url") {
      let endpoint_url = String(v).trim();
      try {
        const parsed = new URL(endpoint_url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new ValidationError("endpoint_url 格式无效，必须以 http:// 或 https:// 开头");
        }
      } catch {
        throw new ValidationError("endpoint_url 不是合法的 URL");
      }
      if (!endpoint_url.endsWith("/")) {
        endpoint_url += "/";
      }
      cfg.endpoint_url = endpoint_url;
    } else if (k === "default_folder") {
      let folder = (v || "").toString().trim();
      folder = folder.replace(/^\/+/, "");
      cfg.default_folder = folder;
    } else {
      cfg[k] = boolKeys.has(k) ? (v ? 1 : 0) : v;
    }
  }
  topPatch.config_json = JSON.stringify(cfg);

  await repo.updateConfig(id, topPatch);
  if (topPatch.is_default === 1) {
    await repo.setAsDefault(id, adminId);
  }

  try {
    const mountManager = new MountManager(db, encryptionSecret, factory);
    await mountManager.clearConfigCache(exists.storage_type, id);
  } catch {}

  // 如果驱动配置变化：把依赖此存储配置的挂载点索引清掉 + 标记 not_ready
  if (driverConfigChanged) {
    try {
      const mountRepo = factory.getMountRepository();
      const mounts = await mountRepo.findByStorageConfig(id, exists.storage_type);
      const store = new FsSearchIndexStore(db);
      for (const m of mounts || []) {
        const mountId = String(m?.id || "").trim();
        if (!mountId) continue;
        await store.clearDerivedByMount(mountId, { keepState: true });
      }
      invalidateFsCache({ storageConfigId: id, reason: "storage-config-update", bumpMountsVersion: true, db });
    } catch (e) {
      console.warn("updateStorageConfig: 清理相关挂载点索引失败（将继续返回更新成功）：", e);
    }
  }
}

export async function deleteStorageConfig(db, id, adminId, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  const aclRepo = factory.getPrincipalStorageAclRepository ? factory.getPrincipalStorageAclRepository() : null;

  const exists = await repo.findByIdAndAdmin(id, adminId);
  if (!exists) throw new NotFoundError("存储配置不存在");

  // 先清理与该存储配置相关的 ACL 绑定
  if (aclRepo) {
    try {
      await aclRepo.deleteByStorageConfigId(id);
    } catch (error) {
      console.warn("删除存储配置关联的存储 ACL 失败，将继续删除存储配置本身：", error);
    }
  }

  // 删除存储配置前：先把依赖它的挂载点与索引派生数据清掉
  // 否则会留下“挂载点指向不存在的存储配置”+ “索引残留”的脏数据
  try {
    const mountRepo = factory.getMountRepository();
    const mounts = await mountRepo.findByStorageConfig(id, exists.storage_type);
    const store = new FsSearchIndexStore(db);
    for (const m of mounts || []) {
      const mountId = String(m?.id || "").trim();
      if (!mountId) continue;
      await store.clearDerivedByMount(mountId, { keepState: false });
      await mountRepo.deleteMount(mountId);
      invalidateFsCache({ mountId, storageConfigId: id, reason: "mount-delete-by-storage-config", bumpMountsVersion: true, db });
    }
  } catch (error) {
    console.warn("deleteStorageConfig: 清理挂载点/索引失败，将继续删除存储配置本身：", error);
  }

  await repo.deleteConfig(id);
  invalidateFsCache({ storageConfigId: id, reason: "storage-config-delete", bumpMountsVersion: true, db });
}

export async function setDefaultStorageConfig(db, id, adminId, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  const exists = await repo.findByIdAndAdmin(id, adminId);
  if (!exists) throw new NotFoundError("存储配置不存在");
  await repo.setAsDefault(id, adminId);
}

export async function getStorageConfigsWithUsage(db, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  return await repo.findAllWithUsage();
}

// 驱动侧连接测试（优先）
export async function testStorageConnection(db, id, adminId, encryptionSecret, requestOrigin = null, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  // 带密钥读取（测试需要）
  const cfg = await repo.findByIdAndAdminWithSecrets(id, adminId);
  if (!cfg) {
    throw new NotFoundError("存储配置不存在");
  }
  const type = cfg.storage_type;
  if (!type) {
    throw new ValidationError("存储配置缺少 storage_type");
  }
  const tester = StorageFactory.getTester(type);
  if (typeof tester === "function") {
    try {
      const res = await tester(cfg, encryptionSecret, requestOrigin);
      // 标记最后使用时间
      try {
        await repo.updateLastUsed(id);
      } catch {}
      return res;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      const message = error?.message || "存储连通性测试失败";
      throw new DriverError(message, { details: { cause: error?.message } });
    }
  }
  throw new NotFoundError(`未找到存储类型的测试实现: ${type}`);
}
