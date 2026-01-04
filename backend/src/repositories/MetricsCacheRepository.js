/**
 * MetricsCacheRepository
 * - 统一读写 metrics_cache（派生数据/快照缓存）
 *
 */

import { BaseRepository } from "./BaseRepository.js";
import { DbTables } from "../constants/index.js";

function safeString(v) {
  return String(v || "").trim();
}

function toIntOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export class MetricsCacheRepository extends BaseRepository {
  /**
   * 读取单条指标缓存
   * @param {string} scopeType
   * @param {string} scopeId
   * @param {string} metricKey
   * @returns {Promise<null|{scope_type:string,scope_id:string,metric_key:string,value_num:any,value_text:any,value_json_text:any,snapshot_at_ms:any,updated_at_ms:any,error_message:any}>}
   */
  async getEntry(scopeType, scopeId, metricKey) {
    const st = safeString(scopeType);
    const sid = safeString(scopeId);
    const key = safeString(metricKey);
    if (!st || !sid || !key) return null;

    const row = await this.queryFirst(
      `SELECT * FROM ${DbTables.METRICS_CACHE} WHERE scope_type = ? AND scope_id = ? AND metric_key = ?`,
      [st, sid, key],
    );
    return row || null;
  }

  /**
   * Upsert 指标缓存
   * @param {object} params
   * @param {string} params.scopeType
   * @param {string} params.scopeId
   * @param {string} params.metricKey
   * @param {number|null} [params.valueNum]
   * @param {string|null} [params.valueText]
   * @param {string|null} [params.valueJsonText]
   * @param {number|null} [params.snapshotAtMs]
   * @param {string|null} [params.errorMessage]
   * @param {number|null} [params.updatedAtMs]
   */
  async upsertEntry(params) {
    const st = safeString(params?.scopeType);
    const sid = safeString(params?.scopeId);
    const key = safeString(params?.metricKey);
    if (!st || !sid || !key) {
      return { changes: 0 };
    }

    const updatedAtMs = toIntOrNull(params?.updatedAtMs) ?? Date.now();

    const bind = [
      st,
      sid,
      key,
      toIntOrNull(params?.valueNum),
      params?.valueText ?? null,
      params?.valueJsonText ?? null,
      toIntOrNull(params?.snapshotAtMs),
      updatedAtMs,
      params?.errorMessage ?? null,
    ];

    const sql = `
      INSERT INTO ${DbTables.METRICS_CACHE} (
        scope_type, scope_id, metric_key,
        value_num, value_text, value_json_text,
        snapshot_at_ms, updated_at_ms,
        error_message
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_type, scope_id, metric_key) DO UPDATE SET
        value_num = excluded.value_num,
        value_text = excluded.value_text,
        value_json_text = excluded.value_json_text,
        snapshot_at_ms = excluded.snapshot_at_ms,
        updated_at_ms = excluded.updated_at_ms,
        error_message = excluded.error_message
    `;

    const result = await this.db.prepare(sql).bind(...bind).run();
    return { changes: result?.meta?.changes ?? result?.changes ?? 0 };
  }

  /**
   * 删除一条指标缓存
   * @param {string} scopeType
   * @param {string} scopeId
   * @param {string} metricKey
   */
  async deleteEntry(scopeType, scopeId, metricKey) {
    const st = safeString(scopeType);
    const sid = safeString(scopeId);
    const key = safeString(metricKey);
    if (!st || !sid || !key) return { changes: 0 };

    const result = await this.db
      .prepare(`DELETE FROM ${DbTables.METRICS_CACHE} WHERE scope_type = ? AND scope_id = ? AND metric_key = ?`)
      .bind(st, sid, key)
      .run();

    return { changes: result?.meta?.changes ?? result?.changes ?? 0 };
  }
}
