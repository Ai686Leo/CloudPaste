import { DbTables } from "../../../../constants/index.js";
import {
  deleteLegacySchemaKeysFromSystemSettings,
  getExistingTableSet,
  getLegacySchemaVersionFromSystemSettings,
  looksLikeExistingDatabase,
  makeVersionMigrationId,
  markMigrationsApplied,
  APP_SCHEMA_VERSION,
  REQUIRED_TABLES,
} from "./adoptUtils.js";
import { initDatabase } from "../engine/initDatabase.js";

const ADOPT_ID = "app-adopt-schema-migrations";


export default {
  id: ADOPT_ID,
  async up({ db }) {
    const existingTables = await getExistingTableSet(db);
    const hasSystemSettings = existingTables.has(DbTables.SYSTEM_SETTINGS);

    // 若已执行过 adopt，则直接退出
    try {
      const already = await db.prepare(`SELECT 1 AS ok FROM schema_migrations WHERE id = ?`).bind(ADOPT_ID).first();
      if (already) return false;
    } catch {
      // schema_migrations 不存在时会由 runner 先创建；这里忽略
    }

    // legacyVersion 仅用于“旧库接管”：若旧库有 schema_version，则按其版本上限预标记 app-v01..app-vN
    const legacyVersion = hasSystemSettings ? await getLegacySchemaVersionFromSystemSettings(db) : 0;

    // 新库/缺表库：直接建到最终态，然后 squash 标记 v01..vN
    let needsTablesCreation = false;
    for (const tableName of REQUIRED_TABLES) {
      if (!existingTables.has(tableName)) {
        needsTablesCreation = true;
        break;
      }
    }

    const isExistingDb = await looksLikeExistingDatabase(db, existingTables);

    // 运行时负责 schema + 默认设置/默认数据：
    // - 纯新库（无表） => needsTablesCreation=true
    // - 仅有 schema（例如用 schema.sql 手工创建了表，但无数据）=> isExistingDb=false
    // - 老库（有业务数据）=> isExistingDb=true 且通常 needsTablesCreation=false
    if (needsTablesCreation || !isExistingDb) {
      await initDatabase(db);
    }

    // adopt 标记范围：
    // - 旧库：按 legacy schema_version（上限为当前应用版本）
    // - 新库/缺表库：按当前应用版本（已初始化到最终态）
    const capVersion =
      legacyVersion > 0
        ? Math.min(legacyVersion, APP_SCHEMA_VERSION)
        : needsTablesCreation || !isExistingDb
          ? APP_SCHEMA_VERSION
          : 0;

    if (capVersion <= 0) {
      // 极少数情况：老库存在业务数据，但缺失 schema_version，无法安全推断版本。
      // 这里不做 squash 标记，避免错误接管。
      return false;
    }
    const ids = [];
    for (let v = 1; v <= capVersion; v++) {
      ids.push(makeVersionMigrationId(v));
    }

    await markMigrationsApplied(db, ids);

    if (hasSystemSettings) {
      await deleteLegacySchemaKeysFromSystemSettings(db);
    }

    return true;
  },
};
