/**
 * SQLite/D1 Provider
 * - 使用 schema_migrations + sqliteMigrations 作为“迁移器”
 * - 将初始化/迁移职责从入口文件移入 provider，便于未来扩展 PG/MySQL
 */

import { sqliteDialect } from "../dialects/sqliteDialect.js";
import { applyMigrations } from "../migrations/runner.js";
import { sqliteMigrations } from "../migrations/sqlite/index.js";

export const sqliteProvider = {
  name: "sqlite",
  dialect: sqliteDialect,

  /**
   * 确保数据库结构可用（初始化/迁移）
   * @param {{ db:any, dialect:any, env:any, providerName:string }} runtime
   */
  async ensureReady(runtime) {
    await applyMigrations(runtime, sqliteMigrations);
  },
};
