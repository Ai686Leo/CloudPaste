/**
 * FS 搜索索引存储（Index-only）
 * - 运行时：Workers(D1) + Docker(SQLiteAdapter) 通用
 * - 全文语义：FTS5 trigram（contains-like），因此最小 query 长度统一为 3
 * - 分页：cursor/keyset（modified_ms DESC, fs_path ASC, id DESC）
 * - 本模块只负责“索引表读写 + 查询”，不负责驱动遍历。
 * - 索引属于派生数据，备份/恢复不应作为事实来源；应通过重建恢复。
 */

import { DbTables } from "../../../constants/index.js";
import { ValidationError } from "../../../http/errors.js";
import { decodeSearchCursor, encodeSearchCursor } from "./FsSearchCursor.js";
import { createSqliteFts5TrigramDialect } from "./dialects/sqliteFts5TrigramDialect.js";

function nowMs() {
  return Date.now();
}

function normalizeQuery(q) {
  return String(q || "").trim();
}

function toMsFromIso(iso) {
  const ms = Date.parse(String(iso || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function toIsoFromMs(ms) {
  const n = Number(ms);
  // 索引里的 modified_ms 为 0/无效时，代表“未知”
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
}

function buildTrigramMatchQuery(raw) {
  // FTS5 query grammar：用双引号包裹，避免用户输入触发操作符解析。
  // 内部双引号用 "" 转义。
  const q = normalizeQuery(raw);
  const escaped = q.replace(/"/g, '""');
  return `"${escaped}"`;
}

export class FsSearchIndexStore {
  /**
   * @param {any} db D1Database / SQLiteAdapter
   */
  constructor(db) {
    if (!db) {
      throw new ValidationError("FsSearchIndexStore: 缺少 db");
    }
    this.db = db;
    this.dialect = createSqliteFts5TrigramDialect();
  }

  /**
   * 读取挂载点索引状态
   * @param {string[]} mountIds
   */
  async getIndexStates(mountIds) {
    const ids = Array.isArray(mountIds) ? mountIds.filter(Boolean) : [];
    if (ids.length === 0) return new Map();

    const placeholders = ids.map(() => "?").join(", ");
    const sql = `
      SELECT mount_id, status, last_indexed_ms, updated_at_ms, last_error
      FROM ${DbTables.FS_SEARCH_INDEX_STATE}
      WHERE mount_id IN (${placeholders})
    `;
    const resp = await this.db.prepare(sql).bind(...ids).all();
    const rows = Array.isArray(resp?.results) ? resp.results : [];
    const map = new Map();
    for (const row of rows) {
      if (row?.mount_id) map.set(String(row.mount_id), row);
    }
    return map;
  }

  /**
   * 获取“当前目录的直接子目录”的聚合摘要（基于索引）
   * - 用于挂载浏览：当存储驱动无法给出目录 size/modified 时，用索引兜底
   * - 注意：这里的 modified 更接近“目录内容更新时间”（子孙项的最大 modified_ms）
   *
   * @param {string} mountId
   * @param {string} parentDirFsPath 目录路径（建议以 / 结尾；会在内部做规范化）
   * @returns {Promise<Array<{ dir_path: string, total_size: number, latest_modified_ms: number, entry_count: number }>>}
   */
  async getChildDirectoryAggregates(mountId, parentDirFsPath) {
    const id = String(mountId || "").trim();
    if (!id) return [];

    let parent = String(parentDirFsPath || "").trim();
    if (!parent) return [];
    if (parent !== "/" && !parent.endsWith("/")) parent = `${parent}/`;

    // SQLite substr 是 1-based；这里取 parent 后面的相对路径
    const startPos = parent.length + 1;
    const likePrefix = `${parent}%`;

    const sql = `
      WITH scoped AS (
        SELECT
          fs_path,
          is_dir,
          size,
          modified_ms,
          substr(fs_path, ?) AS rel
        FROM ${DbTables.FS_SEARCH_INDEX_ENTRIES}
        WHERE mount_id = ? AND fs_path LIKE ?
      )
      SELECT
        (? || substr(rel, 1, instr(rel, '/'))) AS dir_path,
        COALESCE(SUM(CASE WHEN is_dir = 0 THEN size ELSE 0 END), 0) AS total_size,
        COALESCE(MAX(modified_ms), 0) AS latest_modified_ms,
        COUNT(*) AS entry_count
      FROM scoped
      WHERE instr(rel, '/') > 0
      GROUP BY dir_path
    `;

    const resp = await this.db.prepare(sql).bind(startPos, id, likePrefix, parent).all();
    return Array.isArray(resp?.results) ? resp.results : [];
  }

  /**
   * 读取 dirty 数量（按挂载点聚合）
   * @param {string[]} mountIds
   * @returns {Promise<Map<string, number>>}
   */
  async getDirtyCounts(mountIds) {
    const ids = Array.isArray(mountIds) ? mountIds.filter(Boolean) : [];
    if (ids.length === 0) return new Map();

    const placeholders = ids.map(() => "?").join(", ");
    const resp = await this.db
      .prepare(
        `SELECT mount_id, COUNT(1) AS dirty_count FROM ${DbTables.FS_SEARCH_INDEX_DIRTY} WHERE mount_id IN (${placeholders}) GROUP BY mount_id`,
      )
      .bind(...ids)
      .all();
    const rows = Array.isArray(resp?.results) ? resp.results : [];
    return new Map(rows.map((r) => [String(r?.mount_id || ""), Number(r?.dirty_count || 0)]));
  }

  /**
   * 标记 mount 为 indexing
   * @param {string} mountId
   * @param {{ jobId?: string|null }} [options]
   */
  async markIndexing(mountId, options = {}) {
    const now = nowMs();
    const jobId = options?.jobId ? String(options.jobId) : null;
    // jobId 目前不入表（避免 schema 漫延）；如需追踪可落到 tasks 表或 future change 扩展字段
    await this.db
      .prepare(
        `
        INSERT INTO ${DbTables.FS_SEARCH_INDEX_STATE} (mount_id, status, last_indexed_ms, updated_at_ms, last_error)
        VALUES (?, 'indexing', NULL, ?, NULL)
        ON CONFLICT(mount_id) DO UPDATE SET
          status='indexing',
          updated_at_ms=excluded.updated_at_ms,
          last_error=NULL
      `,
      )
      .bind(mountId, now)
      .run();
    void jobId;
  }

  /**
   * 标记 mount 为 ready
   * @param {string} mountId
   * @param {number} indexedAtMs
   */
  async markReady(mountId, indexedAtMs) {
    const now = nowMs();
    const lastIndexedMs = Number.isFinite(indexedAtMs) ? Number(indexedAtMs) : now;
    await this.db
      .prepare(
        `
        INSERT INTO ${DbTables.FS_SEARCH_INDEX_STATE} (mount_id, status, last_indexed_ms, updated_at_ms, last_error)
        VALUES (?, 'ready', ?, ?, NULL)
        ON CONFLICT(mount_id) DO UPDATE SET
          status='ready',
          last_indexed_ms=excluded.last_indexed_ms,
          updated_at_ms=excluded.updated_at_ms,
          last_error=NULL
      `,
      )
      .bind(mountId, lastIndexedMs, now)
      .run();
  }

  /**
   * 标记 mount 为 error
   * @param {string} mountId
   * @param {string} errorMessage
   */
  async markError(mountId, errorMessage) {
    const now = nowMs();
    const msg = String(errorMessage || "").slice(0, 2000);
    await this.db
      .prepare(
        `
        INSERT INTO ${DbTables.FS_SEARCH_INDEX_STATE} (mount_id, status, last_indexed_ms, updated_at_ms, last_error)
        VALUES (?, 'error', NULL, ?, ?)
        ON CONFLICT(mount_id) DO UPDATE SET
          status='error',
          updated_at_ms=excluded.updated_at_ms,
          last_error=excluded.last_error
      `,
      )
      .bind(mountId, now, msg)
      .run();
  }

  /**
   * 标记 mount 为 not_ready（清空/恢复后）
   * @param {string} mountId
   */
  async markNotReady(mountId) {
    const now = nowMs();
    await this.db
      .prepare(
        `
        INSERT INTO ${DbTables.FS_SEARCH_INDEX_STATE} (mount_id, status, last_indexed_ms, updated_at_ms, last_error)
        VALUES (?, 'not_ready', NULL, ?, NULL)
        ON CONFLICT(mount_id) DO UPDATE SET
          status='not_ready',
          last_indexed_ms=NULL,
          updated_at_ms=excluded.updated_at_ms,
          last_error=NULL
      `,
      )
      .bind(mountId, now)
      .run();
  }

  /**
   * 批量 upsert 索引条目
   * @param {Array<{mountId:string, fsPath:string, name:string, isDir:boolean, size:number, modifiedIso?:string, modifiedMs?:number, mimetype?:string|null}>} items
   * @param {{ indexRunId?: string|null }} [options]
   */
  async upsertEntries(items, options = {}) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return;

    const ts = nowMs();
    const indexRunId = options?.indexRunId ? String(options.indexRunId) : null;
    const statements = [];

    for (const item of list) {
      const mountId = item?.mountId ? String(item.mountId) : "";
      const fsPath = item?.fsPath ? String(item.fsPath) : "";
      const name = item?.name ? String(item.name) : "";
      if (!mountId || !fsPath) continue;

      const isDir = item?.isDir ? 1 : 0;
      const size = Number.isFinite(item?.size) && Number(item.size) >= 0 ? Number(item.size) : 0;
      const modifiedMs = Number.isFinite(item?.modifiedMs)
        ? Number(item.modifiedMs)
        : toMsFromIso(item?.modifiedIso);
      const mimetype = item?.mimetype ?? null;

      statements.push(
        this.db
          .prepare(
            `
            INSERT INTO ${DbTables.FS_SEARCH_INDEX_ENTRIES} (
              mount_id, fs_path, name, is_dir, size, modified_ms, mimetype, index_run_id, updated_at_ms
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(mount_id, fs_path) DO UPDATE SET
              name=excluded.name,
              is_dir=excluded.is_dir,
              size=excluded.size,
              modified_ms=excluded.modified_ms,
              mimetype=excluded.mimetype,
              index_run_id=excluded.index_run_id,
              updated_at_ms=excluded.updated_at_ms
          `,
          )
          .bind(mountId, fsPath, name, isDir, size, modifiedMs, mimetype, indexRunId, ts),
      );
    }

    if (statements.length === 0) return;
    await this.db.batch(statements);
  }

  /**
   * 删除某 mount 下“非本轮 runId”的旧条目（无停机重建的收尾步骤）
   * @param {string} mountId
   * @param {string} indexRunId
   */
  async cleanupMountByRunId(mountId, indexRunId) {
    if (!mountId || !indexRunId) return;
    await this.db
      .prepare(
        `DELETE FROM ${DbTables.FS_SEARCH_INDEX_ENTRIES} WHERE mount_id = ? AND (index_run_id IS NULL OR index_run_id != ?)` ,
      )
      .bind(mountId, indexRunId)
      .run();
  }

  /**
   * 清空指定 mount 的索引条目（仅用于“管理员 clear”或极端兜底）
   * @param {string} mountId
   */
  async clearMount(mountId) {
    if (!mountId) return;
    await this.db
      .prepare(`DELETE FROM ${DbTables.FS_SEARCH_INDEX_ENTRIES} WHERE mount_id = ?`)
      .bind(mountId)
      .run();
  }

  /**
   * 清空指定 mount 的 dirty 队列
   * @param {string} mountId
   */
  async clearDirtyByMount(mountId) {
    if (!mountId) return;
    await this.db
      .prepare(`DELETE FROM ${DbTables.FS_SEARCH_INDEX_DIRTY} WHERE mount_id = ?`)
      .bind(mountId)
      .run();
  }

  /**
   * 拉取指定 mount 的 dirty 记录（按时间升序）
   * @param {string} mountId
   * @param {number} limit
   */
  async listDirtyBatch(mountId, limit = 200) {
    const id = mountId ? String(mountId) : "";
    if (!id) return [];
    const n = Number(limit);
    const l = Number.isFinite(n) && n > 0 ? Math.min(Math.trunc(n), 2000) : 200;

    const resp = await this.db
      .prepare(
        `SELECT mount_id, fs_path, op, created_at_ms, dedupe_key FROM ${DbTables.FS_SEARCH_INDEX_DIRTY} WHERE mount_id = ? ORDER BY created_at_ms ASC LIMIT ?`,
      )
      .bind(id, l)
      .all();
    return Array.isArray(resp?.results) ? resp.results : [];
  }

  /**
   * 删除一批 dirty 记录（按 dedupe_key）
   * @param {string[]} keys
   */
  async deleteDirtyByKeys(keys) {
    const list = Array.isArray(keys) ? keys.map((k) => String(k || "").trim()).filter(Boolean) : [];
    if (list.length === 0) return;
    const placeholders = list.map(() => "?").join(", ");
    await this.db
      .prepare(`DELETE FROM ${DbTables.FS_SEARCH_INDEX_DIRTY} WHERE dedupe_key IN (${placeholders})`)
      .bind(...list)
      .run();
  }

  /**
   * 删除单个条目
   * @param {string} mountId
   * @param {string} fsPath
   */
  async deleteEntry(mountId, fsPath) {
    const id = mountId ? String(mountId) : "";
    const path = fsPath ? String(fsPath) : "";
    if (!id || !path) return;
    await this.db
      .prepare(`DELETE FROM ${DbTables.FS_SEARCH_INDEX_ENTRIES} WHERE mount_id = ? AND fs_path = ?`)
      .bind(id, path)
      .run();
  }

  /**
   * 删除某目录及其子树（前缀删除）
   * @param {string} mountId
   * @param {string} dirPath
   */
  async deleteByPathPrefix(mountId, dirPath) {
    const id = mountId ? String(mountId) : "";
    const prefix = dirPath ? String(dirPath) : "";
    if (!id || !prefix) return;
    const like = prefix.endsWith("/") ? `${prefix}%` : `${prefix}/%`;
    await this.db
      .prepare(
        `DELETE FROM ${DbTables.FS_SEARCH_INDEX_ENTRIES} WHERE mount_id = ? AND (fs_path = ? OR fs_path LIKE ?)`,
      )
      .bind(id, prefix, like)
      .run();
  }

  /**
   * 删除某目录前缀下“非本轮 runId”的旧条目（子树无停机重建）
   * @param {string} mountId
   * @param {string} dirPath
   * @param {string} indexRunId
   */
  async cleanupPrefixByRunId(mountId, dirPath, indexRunId) {
    if (!mountId || !dirPath || !indexRunId) return;
    const prefix = String(dirPath);
    const like = prefix.endsWith("/") ? `${prefix}%` : `${prefix}/%`;
    await this.db
      .prepare(
        `DELETE FROM ${DbTables.FS_SEARCH_INDEX_ENTRIES} WHERE mount_id = ? AND (fs_path = ? OR fs_path LIKE ?) AND (index_run_id IS NULL OR index_run_id != ?)`,
      )
      .bind(String(mountId), prefix, like, String(indexRunId))
      .run();
  }

  /**
   * 写入 dirty 记录（去重）
   * @param {{ mountId:string, fsPath:string, op:"upsert"|"delete" }} item
   */
  async upsertDirty(item) {
    const mountId = item?.mountId ? String(item.mountId) : "";
    const fsPath = item?.fsPath ? String(item.fsPath) : "";
    const op = item?.op ? String(item.op) : "";
    if (!mountId || !fsPath || (op !== "upsert" && op !== "delete")) return;

    const ts = nowMs();
    const dedupeKey = `${mountId}:${fsPath}`;

    await this.db
      .prepare(
        `
        INSERT INTO ${DbTables.FS_SEARCH_INDEX_DIRTY} (mount_id, fs_path, op, created_at_ms, dedupe_key)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(dedupe_key) DO UPDATE SET
          op=excluded.op,
          created_at_ms=excluded.created_at_ms
      `,
      )
      .bind(mountId, fsPath, op, ts, dedupeKey)
      .run();
  }

  /**
   * 索引查询（FTS + keyset pagination）
   * @param {Object} params
   * @param {string} params.query
   * @param {string[]} params.allowedMountIds
   * @param {"global"|"mount"|"directory"} params.scope
   * @param {string} [params.mountId]
   * @param {string|null} [params.pathPrefix]
   * @param {number} params.limit
   * @param {string|null} [params.cursor]
   */
  async search(params) {
    const query = normalizeQuery(params?.query);
    if (query.length < this.dialect.minQueryLength) {
      throw new ValidationError("搜索查询至少需要3个字符");
    }

    const scope = params?.scope || "global";
    const limit = Number(params?.limit) || 50;
    if (limit < 1 || limit > 200) {
      throw new ValidationError("limit参数必须在1-200之间");
    }

    const allowedMountIds = Array.isArray(params?.allowedMountIds)
      ? params.allowedMountIds.filter(Boolean)
      : [];
    if (allowedMountIds.length === 0) {
      return { results: [], total: 0, hasMore: false, nextCursor: null };
    }

    const cursorObj = params?.cursor ? decodeSearchCursor(params.cursor) : null;
    if (params?.cursor && !cursorObj) {
      throw new ValidationError("cursor 无效");
    }
    if (cursorObj) {
      // 一致性校验：避免用户拿错 cursor 导致分页错乱
      const mountId = String(params?.mountId || "");
      const pathPrefix = params?.pathPrefix ? String(params.pathPrefix) : "";
      if (
        cursorObj.q !== query ||
        cursorObj.scope !== scope ||
        cursorObj.mountId !== mountId ||
        cursorObj.pathPrefix !== pathPrefix
      ) {
        throw new ValidationError("cursor 与当前查询条件不匹配");
      }
    }

    const { sql: querySql, bind } = this.dialect.buildSearchSql({
      query,
      allowedMountIds,
      scope,
      mountId: params?.mountId ? String(params.mountId) : "",
      pathPrefix: params?.pathPrefix ? String(params.pathPrefix) : "",
      cursorObj,
    });

    const rowsResp = await this.db
      .prepare(querySql)
      .bind(...bind, limit + 1)
      .all();
    const rows = Array.isArray(rowsResp?.results) ? rowsResp.results : [];

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const results = pageRows.map((r) => ({
      path: String(r.fs_path || ""),
      name: String(r.name || ""),
      isDirectory: !!r.is_dir,
      size: Number(r.size || 0),
      modified: toIsoFromMs(Number(r.modified_ms || 0)),
      mimetype: r.mimetype ?? null,
      mount_id: String(r.mount_id || ""),
    }));

    const { sql: countSql, bind: countBind } = this.dialect.buildCountSql({
      query,
      allowedMountIds,
      scope,
      mountId: params?.mountId ? String(params.mountId) : "",
      pathPrefix: params?.pathPrefix ? String(params.pathPrefix) : "",
      cursorObj,
    });
    const countRow = await this.db.prepare(countSql).bind(...countBind).first();
    const total = Number(countRow?.total || 0);

    const last = pageRows.length > 0 ? pageRows[pageRows.length - 1] : null;
    const nextCursor =
      hasMore && last
        ? encodeSearchCursor({
            modifiedMs: Number(last.modified_ms || 0),
            fsPath: String(last.fs_path || ""),
            id: Number(last.id || 0),
            q: query,
            scope,
            mountId: String(params?.mountId || ""),
            pathPrefix: params?.pathPrefix ? String(params.pathPrefix) : "",
          })
        : null;

    return {
      results,
      total,
      hasMore,
      nextCursor,
    };
  }
}
