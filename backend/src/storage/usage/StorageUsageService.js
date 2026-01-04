/**
 * StorageUsageService
 *
 * 目标（对标 rclone about 的思路）：
 * - 我们只产出一份“用量（Usage）快照”：usedBytes +（可选）totalBytes，并且只有一个更新时间
 * - “自定义限额（total_storage_bytes）”是独立概念：用于上传拦截（StorageQuotaGuard）
 * - 上游如果支持并且 storage 配置勾选了 enable_disk_usage，就在同一次统计里把 total/used 一起拿到
 *
 * 计算顺序（已用 usedBytes）：
 * - LOCAL：local_fs(扫挂载目录实际占用) -> vfs_nodes -> fs_index
 * - 其它：provider.used -> vfs_nodes -> fs_index
 *
 * 重要约束：
 * - 上传拦截是热路径：不能在热路径里扫盘，也不能在热路径里打上游 API
 * - 所以“打上游/扫盘”只允许发生在“刷新快照（computeAndPersistSnapshot）”里
 */

import fs from "fs";
import path from "path";

import { ValidationError } from "../../http/errors.js";
import { StorageFactory } from "../factory/StorageFactory.js";
import { FsSearchIndexStore } from "../fs/search/FsSearchIndexStore.js";
import { isCloudflareWorkerEnvironment, isNodeJSEnvironment } from "../../utils/environmentUtils.js";
import { DbTables } from "../../constants/index.js";

const PROVIDER_QUOTA_CACHE_TTL_MS = 60 * 1000;
const LOCAL_DU_CACHE_TTL_MS = 60 * 1000;
const COMPUTED_USAGE_CACHE_TTL_MS = 10 * 1000;

// 防止 provider 配额接口卡死：默认最多等 6 秒（超时视为“不支持/不可用”，继续走后续层兜底）
const PROVIDER_QUOTA_MAX_MS = 6 * 1000;

// 防止 LOCAL 扫目录卡死：默认 10 秒、最多 50 万个条目
const LOCAL_DU_MAX_MS = 10 * 1000;
const LOCAL_DU_MAX_ENTRIES = 500_000;

// 进程内缓存（跨 StorageUsageService 实例共享）
// - Workers 多实例/冷启动时会丢失，但能显著降低“同一实例内反复读上游 quota”的频率
const providerQuotaCache = new Map(); // key -> { value, expiresAtMs }
const localDuCache = new Map(); // key -> { value, expiresAtMs }
const localDuInFlight = new Map(); // key -> Promise

// 已使用缓存（短 TTL）：避免 multipart/upload-chunk 这类高频入口重复跑 SQL/du
const computedUsageCache = new Map(); // key -> { value, expiresAtMs }

function nowMs() {
  return Date.now();
}

function clampNonNegativeInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i >= 0 ? i : null;
}

function safeString(value) {
  return value == null ? "" : String(value);
}

function clampPercentInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < 0) return 0;
  if (i > 100) return 100;
  return i;
}

function buildProviderQuotaSummary(quota) {
  if (!quota || typeof quota !== "object") return null;

  // 统一对外字段命名（参考 rclone about：Total/Used/Free...）
  const totalBytes = clampNonNegativeInt(quota.totalBytes);
  const usedBytes = clampNonNegativeInt(quota.usedBytes);
  const remainingBytes = clampNonNegativeInt(quota.remainingBytes);
  const deletedBytes = clampNonNegativeInt(quota.deletedBytes);
  const trashBytes = clampNonNegativeInt(quota.trashBytes);
  const driveBytes = clampNonNegativeInt(quota.driveBytes);

  // 各驱动内部可能用 usagePercent/percentUsed，统一成 percentUsed
  const percentUsed = clampPercentInt(quota.percentUsed ?? quota.usagePercent);
  const state = typeof quota.state === "string" && quota.state.trim() ? quota.state.trim() : null;

  const summary = {
    totalBytes,
    usedBytes,
    remainingBytes,
    deletedBytes,
    trashBytes,
    driveBytes,
    percentUsed,
    state,
  };

  // 清掉全空对象，避免前端/存储被无意义字段污染
  const hasAny = Object.values(summary).some((v) => v != null);
  return hasAny ? summary : null;
}

async function withTimeout(promise, timeoutMs, timeoutMessage) {
  const ms = Number(timeoutMs) || 0;
  if (!ms || ms <= 0) {
    return await promise;
  }

  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutMessage || "操作超时"));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildQuotaSupportedFalse(base, message) {
  return {
    ...base,
    supported: false,
    message: typeof message === "string" && message.trim() ? message.trim() : "配额信息不可用",
    error: base?.error ?? null,
  };
}

export class StorageUsageService {
  /**
   * @param {any} db D1Database / SQLiteAdapter
   * @param {string} encryptionSecret
   * @param {any} repositoryFactory
   * @param {{ env?: any }} [options]
   */
  constructor(db, encryptionSecret, repositoryFactory, options = {}) {
    if (!db) {
      throw new ValidationError("StorageUsageService: 缺少 db");
    }
    this.db = db;
    this.encryptionSecret = encryptionSecret;
    this.repositoryFactory = repositoryFactory;
    this.env = options?.env || null;
  }

  /**
   * 刷新并写入“用量快照（Usage）”
   * - 对标 rclone about：如果上游支持，则 details.quota 同时带 total/used
   * - 注意：这是“写入缓存”的方法，不要在上传热路径直接调用
   *
   * @param {string} storageConfigId
   * @param {{
   *   allowProviderInUsage?: boolean
   * }} [options]
   */
  async computeAndPersistSnapshot(storageConfigId, options = {}) {
    const id = safeString(storageConfigId).trim();
    if (!id) {
      return { ok: false, message: "缺少 storageConfigId" };
    }

    // 说明（按你最新确认的“简单理念”）：
    // - 上传校验只看“数据库里有没有快照值”，不再引入“过期”概念
    // - 是否及时更新由定时任务频率/手动刷新决定
    const allowProviderInUsage = options?.allowProviderInUsage !== false;

    const metricsRepo = this.repositoryFactory?.getMetricsCacheRepository?.();
    if (!metricsRepo) {
      return { ok: false, message: "MetricsCacheRepository 不可用" };
    }

    const now = nowMs();

    const computed = await this.computeUsage(id, { allowProvider: allowProviderInUsage }).catch(() => null);
    if (computed && clampNonNegativeInt(computed.usedBytes) != null && safeString(computed.source).trim()) {
      const detailsJsonText =
        computed.details && typeof computed.details === "object" ? JSON.stringify(computed.details) : null;

      await metricsRepo.upsertEntry({
        scopeType: "storage_config",
        scopeId: id,
        metricKey: "computed_usage",
        valueNum: clampNonNegativeInt(computed.usedBytes),
        valueText: safeString(computed.source).trim(),
        valueJsonText: detailsJsonText,
        snapshotAtMs: now,
        updatedAtMs: now,
        errorMessage: null,
      });

      return { ok: true, message: "快照刷新成功", computed };
    }

    // 算不出来：不清空旧快照（避免“之前还有数据，突然变没了”）
    const existing = await metricsRepo.getEntry("storage_config", id, "computed_usage").catch(() => null);

    await metricsRepo.upsertEntry({
      scopeType: "storage_config",
      scopeId: id,
      metricKey: "computed_usage",
      valueNum: existing?.value_num ?? null,
      valueText: existing?.value_text ?? null,
      valueJsonText: existing?.value_json_text ?? null,
      snapshotAtMs: existing?.snapshot_at_ms ?? null,
      updatedAtMs: now,
      errorMessage: "无法计算用量（所有来源均不可用）",
    });

    return { ok: true, message: "快照已刷新，但未能计算用量", computed: null };
  }

  /**
   * 读取 storage_config（含 secrets，便于 driver 初始化）
   * @param {string} storageConfigId
   */
  async _getStorageConfigWithSecrets(storageConfigId) {
    const repo = this.repositoryFactory?.getStorageConfigRepository?.();
    if (!repo || typeof repo.findByIdWithSecrets !== "function") {
      throw new ValidationError("StorageUsageService: StorageConfigRepository 不可用");
    }
    const cfg = await repo.findByIdWithSecrets(storageConfigId).catch(() => null);
    if (!cfg) {
      throw new ValidationError("存储配置不存在");
    }
    return cfg;
  }

  /**
   * ProviderQuota：从 driver.getStats().quota 抽取（best-effort）
   * @param {string} storageConfigId
   * @param {{ ignoreEnableDiskUsage?: boolean }} [options]
   * @returns {Promise<{supported:boolean, quota?:any, message?:string, snapshotAt?:string}>}
   */
  async getProviderQuota(storageConfigId, options = {}) {
    const id = safeString(storageConfigId).trim();
    if (!id) {
      return buildQuotaSupportedFalse({}, "缺少 storage_config_id");
    }

    const cacheKey = id;
    const cached = providerQuotaCache.get(cacheKey);
    if (cached && cached.expiresAtMs > nowMs()) {
      return cached.value;
    }

    // 只用缓存：上传拦截等场景不允许因为“拉上游 quota”而阻塞
    if (options?.cacheOnly === true) {
      return buildQuotaSupportedFalse({ type: null }, "上游配额未缓存（cacheOnly）");
    }

    const cfg = await this._getStorageConfigWithSecrets(id);

    // 约定：上游 quota 必须显式开启 enable_disk_usage 才会去请求上游
    const enableDiskUsage = cfg?.enable_disk_usage === 1;
    if (options?.ignoreEnableDiskUsage !== true && !enableDiskUsage) {
      const value = buildQuotaSupportedFalse(
        {
          type: cfg.storage_type,
          initialized: true,
          capabilities: [],
          timestamp: new Date().toISOString(),
        },
        "磁盘占用统计未启用（enable_disk_usage = false）",
      );
      providerQuotaCache.set(cacheKey, { value, expiresAtMs: nowMs() + PROVIDER_QUOTA_CACHE_TTL_MS });
      return value;
    }

    try {
      const driver = await StorageFactory.createDriver(cfg.storage_type, cfg, this.encryptionSecret);
      if (!driver || typeof driver.getStats !== "function") {
        const value = buildQuotaSupportedFalse({ type: cfg.storage_type }, "驱动未实现 getStats，无法读取配额");
        providerQuotaCache.set(cacheKey, { value, expiresAtMs: nowMs() + PROVIDER_QUOTA_CACHE_TTL_MS });
        return value;
      }

      const stats = await withTimeout(
        driver.getStats(),
        PROVIDER_QUOTA_MAX_MS,
        `读取上游配额超时（>${Math.round(PROVIDER_QUOTA_MAX_MS / 1000)}s）`,
      );
      const quota = stats?.quota || null;
      const supported = stats?.supported === true;

      const value = supported
        ? {
            supported: true,
            quota,
            snapshotAt: new Date().toISOString(),
          }
        : buildQuotaSupportedFalse(
            { type: cfg.storage_type },
            typeof stats?.message === "string" ? stats.message : "上游未提供配额信息",
          );

      providerQuotaCache.set(cacheKey, { value, expiresAtMs: nowMs() + PROVIDER_QUOTA_CACHE_TTL_MS });
      return value;
    } catch (error) {
      const value = buildQuotaSupportedFalse(
        { type: cfg.storage_type, error: error?.message ? String(error.message) : String(error) },
        error?.message ? `读取上游配额失败：${error.message}` : "读取上游配额失败",
      );
      providerQuotaCache.set(cacheKey, { value, expiresAtMs: nowMs() + PROVIDER_QUOTA_CACHE_TTL_MS });
      return value;
    }
  }

  /**
   * vfs_nodes used（storage_config scope）
   * @param {string} storageConfigId
   * @returns {Promise<number|null>}
   */
  async getVfsNodesUsedBytes(storageConfigId) {
    const id = safeString(storageConfigId).trim();
    if (!id) return null;

    // 只统计“文件节点”的 size；目录 size 为 null
    // 注意：如果一个 storage_config 完全没有任何 vfs 文件节点，
    // 说明 vfs_nodes 并不是它的事实来源，此时应该返回 null，让后续层（local/fs_index）继续兜底。
    const row = await this.db
      .prepare(
        `
        SELECT
          COUNT(1) AS file_count,
          COALESCE(SUM(COALESCE(size, 0)), 0) AS total_size
        FROM ${DbTables.VFS_NODES}
        WHERE scope_type = 'storage_config'
          AND scope_id = ?
          AND node_type = 'file'
          AND status = 'active'
      `,
      )
      .bind(id)
      .first()
      .catch(() => null);

    const fileCount = clampNonNegativeInt(row?.file_count);
    if (!fileCount) {
      return null;
    }
    const n = clampNonNegativeInt(row?.total_size);
    return n != null ? n : null;
  }

  /**
   * fs_search_index_entries used（按 storage_config 聚合其所有 mounts）
   * - 这是派生数据，可能滞后
   *
   * @param {string} storageConfigId
   * @param {string} storageType
   * @returns {Promise<{usedBytes:number|null, staleMountIds:string[]}>}
   */
  async getFsIndexUsedBytes(storageConfigId, storageType) {
    const id = safeString(storageConfigId).trim();
    const type = safeString(storageType).trim();
    if (!id || !type) return { usedBytes: null, staleMountIds: [] };

    const mountRepo = this.repositoryFactory?.getMountRepository?.();
    if (!mountRepo || typeof mountRepo.findByStorageConfig !== "function") {
      return { usedBytes: null, staleMountIds: [] };
    }

    const mounts = await mountRepo.findByStorageConfig(id, type).catch(() => []);
    const mountIds = Array.isArray(mounts)
      ? mounts
          .map((m) => (m?.id ? String(m.id) : ""))
          .filter((m) => m && m.trim())
      : [];

    if (mountIds.length === 0) {
      return { usedBytes: null, staleMountIds: [] };
    }

    const store = new FsSearchIndexStore(this.db);
    const states = await store.getIndexStates(mountIds);
    const dirties = await store.getDirtyCounts(mountIds);

    // 只统计 ready 的挂载点（否则索引根本不存在/未完成）
    const readyMountIds = mountIds.filter((mid) => {
      const st = states.get(mid);
      return String(st?.status || "") === "ready";
    });
    if (readyMountIds.length === 0) {
      return { usedBytes: null, staleMountIds: [] };
    }

    // 标记可能滞后：dirty>0 的挂载点
    const staleMountIds = readyMountIds.filter((mid) => {
      const d = dirties.get(mid);
      return Number(d || 0) > 0;
    });

    const placeholders = readyMountIds.map(() => "?").join(", ");
    const sql = `
      SELECT mount_id, COALESCE(SUM(CASE WHEN is_dir = 0 THEN size ELSE 0 END), 0) AS total_size
      FROM ${DbTables.FS_SEARCH_INDEX_ENTRIES}
      WHERE mount_id IN (${placeholders})
      GROUP BY mount_id
    `;
    const resp = await this.db.prepare(sql).bind(...readyMountIds).all().catch(() => null);
    const rows = Array.isArray(resp?.results) ? resp.results : [];
    const sum = rows.reduce((acc, r) => acc + (clampNonNegativeInt(r?.total_size) || 0), 0);
    return { usedBytes: clampNonNegativeInt(sum) ?? null, staleMountIds };
  }

  /**
   * local_fs used：扫 root_path 实际占用（du）
   * @param {any} storageConfig
   * @returns {Promise<number|null>}
   */
  async getLocalFsUsedBytes(storageConfig) {
    if (!storageConfig || String(storageConfig.storage_type) !== "LOCAL") return null;

    const inWorker = isCloudflareWorkerEnvironment();
    const inNode = isNodeJSEnvironment();
    if (inWorker || !inNode) {
      return null;
    }

    const rootPathRaw = storageConfig?.root_path;
    if (!rootPathRaw || typeof rootPathRaw !== "string") return null;
    if (!path.isAbsolute(rootPathRaw)) return null;

    const rootPath = path.resolve(rootPathRaw);
    const cacheKey = rootPath;
    const cached = localDuCache.get(cacheKey);
    if (cached && cached.expiresAtMs > nowMs()) {
      return cached.value;
    }

    const inFlight = localDuInFlight.get(cacheKey);
    if (inFlight) {
      return await inFlight.catch(() => null);
    }

    const promise = this._scanDirectoryDu(rootPath)
      .then((bytes) => {
        const value = bytes != null ? bytes : null;
        localDuCache.set(cacheKey, { value, expiresAtMs: nowMs() + LOCAL_DU_CACHE_TTL_MS });
        return value;
      })
      .finally(() => {
        localDuInFlight.delete(cacheKey);
      });

    localDuInFlight.set(cacheKey, promise);
    return await promise.catch(() => null);
  }

  async _scanDirectoryDu(rootPath) {
    const startedAt = nowMs();
    let total = 0;
    let entries = 0;
    /** @type {string[]} */
    const stack = [rootPath];

    while (stack.length) {
      if (nowMs() - startedAt > LOCAL_DU_MAX_MS) {
        return null;
      }
      if (entries > LOCAL_DU_MAX_ENTRIES) {
        return null;
      }

      const current = stack.pop();
      if (!current) continue;

      let dirents;
      try {
        dirents = await fs.promises.readdir(current, { withFileTypes: true });
      } catch {
        // 目录不可读：直接跳过（best-effort）
        continue;
      }

      for (const d of dirents) {
        entries += 1;
        if (entries > LOCAL_DU_MAX_ENTRIES) {
          return null;
        }
        if (nowMs() - startedAt > LOCAL_DU_MAX_MS) {
          return null;
        }

        const full = path.join(current, d.name);
        if (d.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (d.isFile()) {
          try {
            const st = await fs.promises.stat(full);
            const sz = clampNonNegativeInt(st?.size);
            if (sz != null) total += sz;
          } catch {
            // 文件不可 stat：跳过
          }
        }
      }
    }

    return clampNonNegativeInt(total);
  }

  /**
   * 计算 ComputedUsage（用于展示/拦截）
   * 顺序（你最新的分层选择）：
   * - LOCAL：local_fs(扫挂载目录实际占用) -> vfs_nodes -> fs_index
   * - 其它：provider.used -> vfs_nodes -> fs_index
   *
   * @param {string} storageConfigId
   * @param {{ allowProvider?: boolean }} [options]
   * @returns {Promise<{usedBytes:number, source:"provider"|"vfs_nodes"|"local_fs"|"fs_index", details?:any}|null>}
   */
  async computeUsage(storageConfigId, options = {}) {
    const cacheKey = `${safeString(storageConfigId).trim()}|${String(options?.allowProvider ?? true)}`;
    const cached = computedUsageCache.get(cacheKey);
    if (cached && cached.expiresAtMs > nowMs()) {
      return cached.value;
    }

    const cfg = await this._getStorageConfigWithSecrets(storageConfigId);
    const storageType = String(cfg?.storage_type || "").toUpperCase();
    const isLocal = storageType === "LOCAL";
    const enableDiskUsage = cfg?.enable_disk_usage === 1;

    // 1) LOCAL：local_fs（扫目录实际占用）
    // 约定：只有启用了 enable_disk_usage 才会扫盘（否则走 vfs_nodes / fs_index，避免无谓 IO）
    if (isLocal && enableDiskUsage) {
      const localUsed = await this.getLocalFsUsedBytes(cfg).catch(() => null);
      if (localUsed != null) {
        const value = { usedBytes: localUsed, source: "local_fs" };
        computedUsageCache.set(cacheKey, { value, expiresAtMs: nowMs() + COMPUTED_USAGE_CACHE_TTL_MS });
        return value;
      }
    }

    // 2) 其它存储：provider.used（上游提供）
    if (!isLocal) {
      const allowProviderMode = options?.allowProvider ?? true; // true | false | "cached"
      if (allowProviderMode !== false) {
        const provider = await this.getProviderQuota(storageConfigId, { cacheOnly: allowProviderMode === "cached" }).catch(() => null);
        const providerQuota = buildProviderQuotaSummary(provider?.quota);
        const providerUsed = clampNonNegativeInt(providerQuota?.usedBytes);
        if (provider && provider.supported === true && providerUsed != null) {
          const value = {
            usedBytes: providerUsed,
            source: "provider",
            details: providerQuota ? { quota: providerQuota } : undefined,
          };
          computedUsageCache.set(cacheKey, { value, expiresAtMs: nowMs() + COMPUTED_USAGE_CACHE_TTL_MS });
          return value;
        }
      }
    }

    // 3) vfs_nodes（事实索引）
    const vfsUsed = await this.getVfsNodesUsedBytes(storageConfigId).catch(() => null);
    if (vfsUsed != null) {
      const value = { usedBytes: vfsUsed, source: "vfs_nodes" };
      computedUsageCache.set(cacheKey, { value, expiresAtMs: nowMs() + COMPUTED_USAGE_CACHE_TTL_MS });
      return value;
    }

    // 4) fs_index（派生索引）
    const indexRes = await this.getFsIndexUsedBytes(storageConfigId, cfg.storage_type).catch(() => ({ usedBytes: null, staleMountIds: [] }));
    const idxUsed = clampNonNegativeInt(indexRes?.usedBytes);
    if (idxUsed != null) {
      const value = { usedBytes: idxUsed, source: "fs_index", details: { staleMountIds: indexRes?.staleMountIds || [] } };
      computedUsageCache.set(cacheKey, { value, expiresAtMs: nowMs() + COMPUTED_USAGE_CACHE_TTL_MS });
      return value;
    }

    computedUsageCache.set(cacheKey, { value: null, expiresAtMs: nowMs() + COMPUTED_USAGE_CACHE_TTL_MS });
    return null;
  }
}
