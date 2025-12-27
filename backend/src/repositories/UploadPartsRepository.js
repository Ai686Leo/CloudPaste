/**
 * UploadPartsRepository
 * - 临时分片账本：一片一行，避免并发写入互相覆盖
 * - complete/abort 后可删除（避免长期膨胀）
 */

import { BaseRepository } from "./BaseRepository.js";
import { DbTables } from "../constants/index.js";
import { ValidationError } from "../http/errors.js";
import { generateUUID } from "../utils/common.js";

const safeJsonStringify = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

export class UploadPartsRepository extends BaseRepository {
  /**
   * 写入/更新分片记录
   * - UNIQUE(upload_id, part_no) 冲突时走 UPDATE
   */
  async upsertPart(params) {
    const {
      uploadId,
      partNo,
      size,
      storageType,
      providerMeta = null,
      providerPartId = null,
      checksumAlgo = null,
      checksum = null,
      byteStart = null,
      byteEnd = null,
      status = "uploaded",
      errorCode = null,
      errorMessage = null,
    } = params || {};

    if (!uploadId || !Number.isFinite(partNo) || partNo <= 0) {
      throw new ValidationError("upsertPart: 缺少 uploadId 或 partNo 无效");
    }
    if (!storageType) {
      throw new ValidationError("upsertPart: 缺少 storageType");
    }
    if (!Number.isFinite(size) || size < 0) {
      throw new ValidationError("upsertPart: 缺少 size 或 size 无效");
    }

    const now = new Date().toISOString();
    const id = `uplp_${generateUUID()}`;

    const providerMetaText = safeJsonStringify(providerMeta);
    const normalizedErrorCode = status === "error" ? (errorCode ? String(errorCode) : null) : null;
    const normalizedErrorMessage = status === "error" ? (errorMessage ? String(errorMessage) : null) : null;

    const sql = `
      INSERT INTO ${DbTables.UPLOAD_PARTS} (
        id,
        upload_id,
        part_no,
        byte_start,
        byte_end,
        size,
        checksum_algo,
        checksum,
        storage_type,
        provider_part_id,
        provider_meta,
        status,
        error_code,
        error_message,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(upload_id, part_no) DO UPDATE SET
        byte_start = excluded.byte_start,
        byte_end = excluded.byte_end,
        size = excluded.size,
        checksum_algo = excluded.checksum_algo,
        checksum = excluded.checksum,
        storage_type = excluded.storage_type,
        provider_part_id = excluded.provider_part_id,
        provider_meta = excluded.provider_meta,
        status = excluded.status,
        error_code = excluded.error_code,
        error_message = excluded.error_message,
        updated_at = excluded.updated_at
    `;

    const result = await this.execute(sql, [
      id,
      uploadId,
      partNo,
      byteStart,
      byteEnd,
      size,
      checksumAlgo,
      checksum,
      storageType,
      providerPartId,
      providerMetaText,
      status,
      normalizedErrorCode,
      normalizedErrorMessage,
      now,
      now,
    ]);

    return {
      id,
      uploadId,
      partNo,
      changes: result?.meta?.changes ?? result?.changes ?? 0,
    };
  }

  /**
   * 标记分片为 error（失败也要落库，方便续传与排查）
   */
  async markPartError(params) {
    const { uploadId, partNo, errorCode = null, errorMessage = null } = params || {};
    if (!uploadId || !Number.isFinite(partNo) || partNo <= 0) {
      throw new ValidationError("markPartError: 缺少 uploadId 或 partNo 无效");
    }
    const now = new Date().toISOString();

    const sql = `
      UPDATE ${DbTables.UPLOAD_PARTS}
      SET
        status = 'error',
        error_code = ?,
        error_message = ?,
        updated_at = ?
      WHERE upload_id = ? AND part_no = ?
    `;

    const result = await this.execute(sql, [errorCode, errorMessage, now, uploadId, partNo]);
    return {
      uploadId,
      partNo,
      changes: result?.meta?.changes ?? result?.changes ?? 0,
    };
  }

  async listParts(uploadId) {
    if (!uploadId) return [];
    const result = await this.query(
      `SELECT * FROM ${DbTables.UPLOAD_PARTS} WHERE upload_id = ? ORDER BY part_no ASC`,
      [uploadId],
    );
    return result?.results || [];
  }

  async listPartNumbers(uploadId) {
    if (!uploadId) return [];
    const result = await this.query(
      `SELECT part_no FROM ${DbTables.UPLOAD_PARTS} WHERE upload_id = ? AND status = 'uploaded' ORDER BY part_no ASC`,
      [uploadId],
    );
    const rows = result?.results || [];
    return rows.map((r) => Number(r.part_no)).filter((n) => Number.isFinite(n) && n > 0);
  }

  async getPart(uploadId, partNo) {
    if (!uploadId || !Number.isFinite(partNo) || partNo <= 0) return null;
    return await this.queryFirst(
      `SELECT * FROM ${DbTables.UPLOAD_PARTS} WHERE upload_id = ? AND part_no = ? LIMIT 1`,
      [uploadId, partNo],
    );
  }

  async countUploadedParts(uploadId) {
    if (!uploadId) return 0;
    const row = await this.queryFirst(
      `SELECT COUNT(*) AS cnt FROM ${DbTables.UPLOAD_PARTS} WHERE upload_id = ? AND status = 'uploaded'`,
      [uploadId],
    );
    return Number(row?.cnt) || 0;
  }

  /**
   * 批量统计：每个 uploadId 的“已上传分片数”和“已上传字节数”
   * - 用于前端显示上传进度
   *
   * @param {Array<string>} uploadIds
   * @param {Object} options
   * @returns {Promise<Map<string, { uploadedParts: number, bytesUploaded: number }>>}
   */
  async getUploadedStatsByUploadIds(uploadIds, options = {}) {
    const { batchSize = 200 } = options || {};
    const ids = Array.isArray(uploadIds) ? uploadIds.filter(Boolean) : [];
    const map = new Map();
    if (ids.length === 0) return map;

    const safeBatchSize = Number.isFinite(batchSize) && batchSize > 0 ? Math.min(batchSize, 500) : 200;

    for (let i = 0; i < ids.length; i += safeBatchSize) {
      const batch = ids.slice(i, i + safeBatchSize);
      const placeholders = batch.map(() => "?").join(", ");
      const result = await this.query(
        `
        SELECT upload_id, COUNT(*) AS cnt, COALESCE(SUM(size), 0) AS bytes
        FROM ${DbTables.UPLOAD_PARTS}
        WHERE upload_id IN (${placeholders}) AND status = 'uploaded'
        GROUP BY upload_id
      `,
        batch,
      );

      const rows = result?.results || [];
      for (const row of rows) {
        const uploadId = row?.upload_id ? String(row.upload_id) : null;
        if (!uploadId) continue;
        map.set(uploadId, {
          uploadedParts: Number(row?.cnt) || 0,
          bytesUploaded: Number(row?.bytes) || 0,
        });
      }
    }

    return map;
  }

  async deletePartsByUploadId(uploadId) {
    if (!uploadId) return { changes: 0 };
    const result = await this.execute(
      `DELETE FROM ${DbTables.UPLOAD_PARTS} WHERE upload_id = ?`,
      [uploadId],
    );
    return { changes: result?.meta?.changes ?? result?.changes ?? 0 };
  }

  /**
   * maintenance 批量清理用（自动分批，避免 IN 太大）
   */
  async deletePartsByUploadIds(uploadIds, options = {}) {
    const { batchSize = 200 } = options || {};
    const ids = Array.isArray(uploadIds) ? uploadIds.filter(Boolean) : [];
    if (ids.length === 0) return { changes: 0 };

    const safeBatchSize = Number.isFinite(batchSize) && batchSize > 0 ? Math.min(batchSize, 500) : 200;

    let total = 0;
    for (let i = 0; i < ids.length; i += safeBatchSize) {
      const batch = ids.slice(i, i + safeBatchSize);
      const placeholders = batch.map(() => "?").join(", ");
      const result = await this.execute(
        `DELETE FROM ${DbTables.UPLOAD_PARTS} WHERE upload_id IN (${placeholders})`,
        batch,
      );
      total += result?.meta?.changes ?? result?.changes ?? 0;
    }

    return { changes: total };
  }

  /**
   * 兜底清理异常遗留（可选增强）
   */
  async deletePartsOlderThan(cutoffIso, options = {}) {
    const { batchSize = 200 } = options || {};
    if (!cutoffIso) {
      throw new ValidationError("deletePartsOlderThan: 缺少 cutoffIso");
    }
    const safeBatchSize = Number.isFinite(batchSize) && batchSize > 0 ? Math.min(batchSize, 500) : 200;

    const sql = `
      DELETE FROM ${DbTables.UPLOAD_PARTS}
      WHERE id IN (
        SELECT id
        FROM ${DbTables.UPLOAD_PARTS}
        WHERE updated_at < ?
        LIMIT ?
      )
    `;

    const result = await this.execute(sql, [cutoffIso, safeBatchSize]);
    return { changes: result?.meta?.changes ?? result?.changes ?? 0 };
  }
}
