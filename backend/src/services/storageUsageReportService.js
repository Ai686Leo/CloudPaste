import { ValidationError } from "../http/errors.js";
import { ensureRepositoryFactory } from "../utils/repositories.js";
const METRICS_SCOPE_STORAGE_CONFIG = "storage_config";
const METRICS_KEY_COMPUTED_USAGE = "computed_usage";

function clampPositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

function clampNonNegativeInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i >= 0 ? i : null;
}

function toIsoOrNullFromMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  try {
    return new Date(n).toISOString();
  } catch {
    return null;
  }
}

function tryParseJson(text) {
  if (!text || typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildComputedUsageFromMetricsRow(row) {
  if (!row) return null;

  const usedBytes = clampNonNegativeInt(row.value_num);
  const source = String(row.value_text || "").trim();
  if (usedBytes == null || !source) return null;

  const snapshotAt = toIsoOrNullFromMs(row.snapshot_at_ms);
  const details = tryParseJson(row.value_json_text);

  return {
    usedBytes,
    source,
    snapshotAt,
    details: details && typeof details === "object" ? details : undefined,
  };
}

/**
 * 获取管理端存储用量报告（后端契约）
 * - configuredLimitBytes：自定义上限（用于拦截）
 * - computedUsage：用量（如果来源是 provider，则 details.quota 内同时包含 total/used 等信息）
 *
 *
 * @param {any} db
 * @param {string} adminId
 * @param {string} encryptionSecret
 * @param {any} [repositoryFactory]
 * @param {any} [env]
 */
export async function getStorageUsageReport(db, adminId, encryptionSecret, repositoryFactory = null, env = null) {
  if (!db) {
    throw new ValidationError("缺少数据库连接");
  }
  if (!adminId) {
    throw new ValidationError("缺少管理员ID");
  }
  if (!encryptionSecret) {
    throw new ValidationError("缺少加密密钥");
  }

  const factory = ensureRepositoryFactory(db, repositoryFactory, env || {});
  const storageRepo = factory.getStorageConfigRepository();
  const metricsRepo = factory.getMetricsCacheRepository?.() || null;

  const configs = await storageRepo.findByAdmin(adminId);

  const storages = [];
  for (const cfg of configs || []) {
    const configuredLimitBytes = clampPositiveInt(cfg?.total_storage_bytes);
    const enableDiskUsage = cfg?.enable_disk_usage === 1;

    // computedUsage：只读快照
    const computedRow = metricsRepo ? await metricsRepo.getEntry(METRICS_SCOPE_STORAGE_CONFIG, String(cfg?.id || ""), METRICS_KEY_COMPUTED_USAGE).catch(() => null) : null;
    const computedUsage = buildComputedUsageFromMetricsRow(computedRow);

    const limitStatus =
      configuredLimitBytes != null && computedUsage?.usedBytes != null
        ? {
            limitBytes: configuredLimitBytes,
            usedBytes: computedUsage.usedBytes,
            remainingBytes: Math.max(0, configuredLimitBytes - computedUsage.usedBytes),
            percentUsed: Math.min(100, Math.max(0, Math.round((computedUsage.usedBytes / configuredLimitBytes) * 100))),
            exceeded: computedUsage.usedBytes > configuredLimitBytes,
          }
        : null;

    storages.push({
      id: String(cfg?.id || ""),
      name: String(cfg?.name || ""),
      storageType: String(cfg?.storage_type || ""),
      providerType: cfg?.provider_type ?? null,
      isPublic: cfg?.is_public === 1 || cfg?.is_public === true,
      isDefault: cfg?.is_default === 1 || cfg?.is_default === true,
      enableDiskUsage,
      configuredLimitBytes,
      computedUsage,
      limitStatus,
    });
  }

  return {
    version: "storage_usage_report_v2",
    storages,
    generatedAt: new Date().toISOString(),
  };
}
