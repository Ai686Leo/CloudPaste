import adoptSchemaMigrations from "./adoptSchemaMigrations.js";
import versionMigrations from "./versions.js";

// 说明：
// - 采用单表 schema_migrations：仅用 app-v01..app-vN 表达版本链
// - 新库初始化与 squash 标记由 adopt 迁移负责
export const sqliteMigrations = [
  adoptSchemaMigrations,
  ...versionMigrations,
];

export default sqliteMigrations;
