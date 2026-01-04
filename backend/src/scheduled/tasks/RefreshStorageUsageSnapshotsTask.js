/**
 * RefreshStorageUsageSnapshotsTask
 * - 定时刷新 metrics_cache 中的存储用量快照（computed_usage）
 *
 * 为什么要做：
 * - 上传校验是热路径，不能每次都扫盘、也不能每次都打上游 API
 * - 所以改成：定时刷新快照；上传时只读快照（快照不存在/读不到就放行）
 *
 * 说明（对标 rclone about 的理解方式）：
 * - 这份“用量快照”只有一份：已用（usedBytes）+（可选）总量（totalBytes）
 * - 如果 storage 开了 enable_disk_usage 且驱动支持，上游会一次返回 total/used（同一次统计时间点）
 * - 否则就按 local_fs / vfs_nodes / fs_index 等来源兜底
 */

import { DbTables } from "../../constants/index.js";
import { RepositoryFactory } from "../../repositories/index.js";
import { StorageUsageService } from "../../storage/usage/StorageUsageService.js";

function nowMs() {
  return Date.now();
}

function getEncryptionSecretFromEnv(env) {
  const secret =
    (env && env.ENCRYPTION_SECRET) ||
    (typeof process !== "undefined" ? process.env?.ENCRYPTION_SECRET : null);
  if (!secret) {
    throw new Error("ENCRYPTION_SECRET 未配置，无法刷新存储用量快照");
  }
  return secret;
}

function clampPositiveInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i > 0 ? i : null;
}

async function runWithConcurrency(items, concurrency, fn) {
  const limit = Math.max(1, Math.min(10, clampPositiveInt(concurrency) || 1));
  const queue = Array.isArray(items) ? items.slice() : [];
  const results = [];

  const workers = Array.from({ length: limit }, async () => {
    while (queue.length) {
      const it = queue.shift();
      // eslint-disable-next-line no-await-in-loop
      const r = await fn(it);
      results.push(r);
    }
  });

  await Promise.all(workers);
  return results;
}

export class RefreshStorageUsageSnapshotsTask {
  constructor() {
    /** @type {string} 作业类型ID（handlerId） */
    this.id = "refresh_storage_usage_snapshots";
    /** @type {string} 名称 */
    this.name = "刷新存储用量快照";
    /** @type {string} 描述 */
    this.description = "定时刷新所有存储配置的用量快照，用于面板配额分析与上传限制校验。";
    /** @type {"maintenance" | "business"} */
    this.category = "maintenance";

    /** @type {Array<any>} */
    this.configSchema = [
      {
        name: "maxItems",
        label: "单次最多刷新多少个存储",
        type: "number",
        defaultValue: 50,
        required: true,
        min: 1,
        max: 500,
        description: "防止一次性刷新过多导致任务跑太久。",
      },
      {
        name: "maxConcurrency",
        label: "并发刷新数",
        type: "number",
        defaultValue: 1,
        required: true,
        min: 1,
        max: 10,
        description: "并发越高越快，但也越容易打到上游限流；默认 1 最稳。",
      },
    ];
  }

  /**
   * @param {{ db: any, env: any, now: string, config: any, scheduledJobId?: string }} ctx
   */
  async run(ctx) {
    const db = ctx?.db;
    const env = ctx?.env || {};
    const config = ctx?.config || {};

    const maxItems = clampPositiveInt(config.maxItems) || 50;
    const maxConcurrency = clampPositiveInt(config.maxConcurrency) || 1;

    const encryptionSecret = getEncryptionSecretFromEnv(env);
    const factory = new RepositoryFactory(db, { env });
    const usage = new StorageUsageService(db, encryptionSecret, factory, { env });

    // 只取 id，避免 inflate 全配置带来额外消耗
    const idsRes = await db
      .prepare(`SELECT id FROM ${DbTables.STORAGE_CONFIGS} ORDER BY updated_at DESC`)
      .all();
    const ids = (idsRes?.results || []).map((r) => r?.id).filter(Boolean).slice(0, maxItems);

    const startedMs = nowMs();

    let okCount = 0;
    let failCount = 0;

    await runWithConcurrency(ids, maxConcurrency, async (id) => {
      try {
        await usage.computeAndPersistSnapshot(String(id));
        okCount += 1;
      } catch (e) {
        failCount += 1;
        console.warn("[RefreshStorageUsageSnapshotsTask] 刷新失败:", { id, error: e?.message || e });
      }
      return null;
    });

    const durationMs = nowMs() - startedMs;
    const summary = `刷新完成：成功 ${okCount} 个，失败 ${failCount} 个，用时 ${durationMs}ms`;
    return {
      summary,
      okCount,
      failCount,
      total: ids.length,
      durationMs,
    };
  }
}
