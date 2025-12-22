/**
 * SQLite/D1 dialect：FTS5 trigram（contains-like）
 * - MATCH 查询用双引号包裹，避免 FTS5 query grammar 被用户输入触发
 * - keyset 分页排序：modified_ms DESC, fs_path ASC, id DESC
 */

import { DbTables } from "../../../../constants/index.js";

function normalizeQuery(q) {
  return String(q || "").trim();
}

function buildTrigramMatchQuery(raw) {
  const q = normalizeQuery(raw);
  const escaped = q.replace(/\"/g, "\"\"");
  return `"${escaped}"`;
}

function buildWhereAndBind(p) {
  const allowedMountIds = Array.isArray(p?.allowedMountIds) ? p.allowedMountIds.filter(Boolean) : [];
  const scope = p?.scope || "global";

  const where = [];
  const bind = [];

  // 权限约束：只能搜索 allowedMountIds
  where.push(`e.mount_id IN (${allowedMountIds.map(() => "?").join(", ")})`);
  bind.push(...allowedMountIds);

  if ((scope === "mount" || scope === "directory") && p?.mountId) {
    where.push(`e.mount_id = ?`);
    bind.push(String(p.mountId));
  }

  // 只要传入 pathPrefix，就强制按路径前缀过滤
  if (p?.pathPrefix) {
    const prefix = String(p.pathPrefix || "").replace(/\/+$/g, "") || "/";
    const like = prefix === "/" ? "/%" : `${prefix}/%`;
    where.push(`e.fs_path LIKE ?`);
    bind.push(like);
  }

  if (p?.cursorObj) {
    const c = p.cursorObj;
    where.push(
      `(e.modified_ms < ? OR (e.modified_ms = ? AND e.fs_path > ?) OR (e.modified_ms = ? AND e.fs_path = ? AND e.id < ?))`,
    );
    bind.push(c.modifiedMs, c.modifiedMs, c.fsPath, c.modifiedMs, c.fsPath, c.id);
  }

  where.push(`${DbTables.FS_SEARCH_INDEX_FTS} MATCH ?`);
  bind.push(buildTrigramMatchQuery(p.query));

  return { whereSql: `WHERE ${where.join(" AND ")}`, bind };
}

export function createSqliteFts5TrigramDialect() {
  return {
    id: "sqlite-fts5-trigram",
    minQueryLength: 3,

    /**
     * 提供建表 SQL（用于验证/文档/手动运维），实际建表仍由 migrations 负责
     */
    buildCreateFtsSql() {
      return `
        CREATE VIRTUAL TABLE ${DbTables.FS_SEARCH_INDEX_FTS}
        USING fts5(
          name,
          fs_path,
          tokenize='trigram',
          content='${DbTables.FS_SEARCH_INDEX_ENTRIES}',
          content_rowid='id'
        )
      `;
    },

    buildSearchSql(p) {
      const { whereSql, bind } = buildWhereAndBind(p);
      const sql = `
        SELECT
          e.id,
          e.mount_id,
          e.fs_path,
          e.name,
          e.is_dir,
          e.size,
          e.modified_ms,
          e.mimetype
        FROM ${DbTables.FS_SEARCH_INDEX_FTS} f
        JOIN ${DbTables.FS_SEARCH_INDEX_ENTRIES} e ON e.id = f.rowid
        ${whereSql}
        ORDER BY e.modified_ms DESC, e.fs_path ASC, e.id DESC
        LIMIT ?
      `;
      return { sql, bind };
    },

    buildCountSql(p) {
      const { whereSql, bind } = buildWhereAndBind(p);
      const sql = `
        SELECT COUNT(1) AS total
        FROM ${DbTables.FS_SEARCH_INDEX_FTS} f
        JOIN ${DbTables.FS_SEARCH_INDEX_ENTRIES} e ON e.id = f.rowid
        ${whereSql}
      `;
      return { sql, bind };
    },
  };
}
