// 统一的存储配置服务（单表 + JSON）
import { ensureRepositoryFactory } from "../utils/repositories.js";
import { StorageFactory } from "../storage/factory/StorageFactory.js";
import { ApiStatus } from "../constants/index.js";
import { AppError, ValidationError, NotFoundError, DriverError } from "../http/errors.js";
import { encryptValue, buildSecretView } from "../utils/crypto.js";
import { generateStorageConfigId } from "../utils/common.js";

// 列表/查询
export async function getStorageConfigsByAdmin(db, adminId, options = {}, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  if (options.page !== undefined || options.limit !== undefined) {
    return await repo.findByAdminWithPagination(adminId, options);
  }
  const configs = await repo.findByAdmin(adminId);
  return { configs, total: configs.length };
}

export async function getPublicStorageConfigs(db, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  return await repo.findPublic();
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
  } else {
    const { name, storage_type, is_public, is_default, ...rest } = configData;
    configJson = rest || {};
  }
  const createData = {
    id,
    name: configData.name,
    storage_type: configData.storage_type,
    admin_id: adminId,
    is_public: configData.is_public ? 1 : 0,
    is_default: configData.is_default ? 1 : 0,
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

  const topPatch = {};
  if (updateData.name) topPatch.name = updateData.name;
  if (updateData.is_public !== undefined) topPatch.is_public = updateData.is_public ? 1 : 0;
  if (updateData.is_default !== undefined) topPatch.is_default = updateData.is_default ? 1 : 0;
  if (updateData.status) topPatch.status = updateData.status;

  let cfg = {};
  if (exists?.__config_json__ && typeof exists.__config_json__ === "object") {
    cfg = { ...exists.__config_json__ };
  }
  // 合并驱动 JSON 字段
  const boolKeys = new Set(["path_style"]);
  for (const [k, v] of Object.entries(updateData)) {
    if (["name", "storage_type", "is_public", "is_default", "status"].includes(k)) continue;
    if (k === "access_key_id") {
      cfg.access_key_id = await encryptValue(v, encryptionSecret);
    } else if (k === "secret_access_key") {
      cfg.secret_access_key = await encryptValue(v, encryptionSecret);
    } else if (k === "total_storage_bytes") {
      const val = parseInt(v, 10);
      cfg.total_storage_bytes = Number.isFinite(val) && val > 0 ? val : null;
    } else if (k === "signature_expires_in") {
      const se = parseInt(v, 10);
      cfg.signature_expires_in = Number.isFinite(se) ? se : 3600;
    } else {
      cfg[k] = boolKeys.has(k) ? (v ? 1 : 0) : v;
    }
  }
  topPatch.config_json = JSON.stringify(cfg);

  await repo.updateConfig(id, topPatch);
  if (topPatch.is_default === 1) {
    await repo.setAsDefault(id, adminId);
  }
  return;
}

export async function deleteStorageConfig(db, id, adminId, repositoryFactory = null) {
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const repo = factory.getStorageConfigRepository();
  const aclRepo = factory.getPrincipalStorageAclRepository
    ? factory.getPrincipalStorageAclRepository()
    : null;

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

  await repo.deleteConfig(id);
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
