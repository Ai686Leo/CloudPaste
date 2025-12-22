// legacy key：线上旧库中曾用于存储迁移元数据的 system_settings.key
// 说明：当前主线以 schema_migrations（迁移执行历史表）作为权威迁移状态来源，
// 仍用这两个 key 名从旧库 system_settings 导入/接管。

export const LEGACY_SCHEMA_VERSION_KEY = "schema_version";
export const LEGACY_DB_INITIALIZED_KEY = "db_initialized";

// 仅用于兼容旧迁移逻辑的 legacy 表名
export const LegacyDbTables = {
  S3_CONFIGS: "s3_configs",
};

