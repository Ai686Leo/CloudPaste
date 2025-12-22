import { DbTables } from "../../../../constants/index.js";
import { APP_SCHEMA_VERSION } from "../engine/version.js";
import { LEGACY_DB_INITIALIZED_KEY, LEGACY_SCHEMA_VERSION_KEY } from "../engine/legacyKeys.js";

export const MIGRATIONS_TABLE = "schema_migrations";

// adopt 阶段用于“缺表判定”的表集合：
// - 以 `DbTables` 作为单一事实来源
export const REQUIRED_TABLES = Array.from(new Set([...Object.values(DbTables), MIGRATIONS_TABLE]));

export { APP_SCHEMA_VERSION };

export async function getExistingTableSet(db) {
  const existingTables = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
  const rows = existingTables?.results || [];
  return new Set(rows.map((t) => t.name).filter(Boolean));
}

async function tableHasAnyRow(db, tableName) {
  try {
    const row = await db.prepare(`SELECT 1 AS ok FROM ${tableName} LIMIT 1`).first();
    return !!row;
  } catch {
    return false;
  }
}

export async function looksLikeExistingDatabase(db, existingTables) {
  // 目的：区分“全新库”与“老库缺少部分表/版本号”的情况。
  // 策略：只要核心业务表里存在任意数据，即视为老库。
  const candidateTables = [DbTables.FILES, DbTables.PASTES, DbTables.ADMINS, DbTables.API_KEYS];
  for (const tableName of candidateTables) {
    if (!existingTables.has(tableName)) continue;
    if (await tableHasAnyRow(db, tableName)) return true;
  }
  return false;
}

export function makeVersionMigrationId(version) {
  return `app-v${pad2(version)}`;
}

export async function markMigrationsApplied(db, ids) {
  const now = new Date().toISOString();
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  for (const id of list) {
    await db
      .prepare(`INSERT OR IGNORE INTO ${MIGRATIONS_TABLE} (id, applied_at) VALUES (?, ?)`)
      .bind(id, now)
      .run();
  }
}

export async function getLegacySchemaVersionFromSystemSettings(db) {
  try {
    const row = await db
      .prepare(`SELECT value FROM ${DbTables.SYSTEM_SETTINGS} WHERE key = ?`)
      .bind(LEGACY_SCHEMA_VERSION_KEY)
      .first();
    return row ? Number.parseInt(row.value, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

export async function deleteLegacySchemaKeysFromSystemSettings(db) {
  try {
    await db
      .prepare(`DELETE FROM ${DbTables.SYSTEM_SETTINGS} WHERE key IN (?, ?)`)
      .bind(LEGACY_SCHEMA_VERSION_KEY, LEGACY_DB_INITIALIZED_KEY)
      .run();
  } catch {
    // system_settings 不存在/不可用时忽略
  }
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}
