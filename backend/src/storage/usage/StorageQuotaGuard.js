/**
 * StorageQuotaGuard
 *
 * - 限制上限：只看 cfg.total_storage_bytes（管理端配置的自定义上限，来自 storage_configs.config_json）
 * - 已使用：只读 metrics_cache 的用量快照（computed_usage）
 *  上传校验时：查数据库快照，有就校验，没有就放行
 */

import { ValidationError } from "../../http/errors.js";

const METRICS_SCOPE_STORAGE_CONFIG = "storage_config";
const METRICS_KEY_COMPUTED_USAGE = "computed_usage";

function toBytesMb(n) {
  const v = Number(n) || 0;
  return (v / (1024 * 1024)).toFixed(2).replace(/\.00$/g, "");
}

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

export class StorageQuotaGuard {
  /**
   * @param {any} db
   * @param {string} encryptionSecret
   * @param {any} repositoryFactory
   * @param {{ env?: any }} [options]
   */
  constructor(db, encryptionSecret, repositoryFactory, options = {}) {
    this.db = db;
    this.encryptionSecret = encryptionSecret;
    this.repositoryFactory = repositoryFactory;
    this.env = options?.env || null;
  }

  /**
   * 断言：本次写入不会超出自定义上限
   * @param {Object} params
   * @param {string} params.storageConfigId
   * @param {number} params.incomingBytes
   * @param {number|null} [params.oldBytes]
   * @param {string} [params.context] 日志/错误上下文
   */
  async assertCanConsume({ storageConfigId, incomingBytes, oldBytes = null, context = "" }) {
    const storageId = String(storageConfigId || "").trim();
    const incoming = clampPositiveInt(incomingBytes);
    if (!storageId || !incoming) return;

    const repo = this.repositoryFactory?.getStorageConfigRepository?.();
    if (!repo || typeof repo.findById !== "function") return;
    const cfg = await repo.findById(storageId).catch(() => null);
    if (!cfg) return;

    const limit = clampPositiveInt(cfg.total_storage_bytes);
    if (!limit) return; // 未配置上限（或为 0）= 不限额

    // 性能策略：上传拦截只读 metrics_cache（快照），不做同步计算/上游请求/扫盘
    const metricsRepo = this.repositoryFactory?.getMetricsCacheRepository?.();
    if (!metricsRepo || typeof metricsRepo.getEntry !== "function") {
      return;
    }

    const row = await metricsRepo
      .getEntry(METRICS_SCOPE_STORAGE_CONFIG, storageId, METRICS_KEY_COMPUTED_USAGE)
      .catch(() => null);

    const used = clampNonNegativeInt(row?.value_num);
    // 快照缺失/读不到 usedBytes -> 放行不拦截
    if (used == null) return;

    const old = oldBytes != null ? Math.max(0, Math.floor(Number(oldBytes) || 0)) : null;
    const effectiveIncoming = old != null ? Math.max(0, incoming - old) : incoming;

    const after = used + effectiveIncoming;
    if (after <= limit) return;

    const remaining = Math.max(0, limit - used);
    const msg =
      `存储空间不足：剩余 ${toBytesMb(remaining)} MB，本次写入需要 ${toBytesMb(effectiveIncoming)} MB` +
      (context ? `（${context}）` : "");
    throw new ValidationError(msg);
  }
}
