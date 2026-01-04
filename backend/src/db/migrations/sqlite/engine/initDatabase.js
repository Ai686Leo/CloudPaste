import {
  createAdminTables,
  createFileTables,
  createFsMetaTables,
  createFsSearchIndexTables,
  createIndexes,
  createPasteTables,
  createMigrationTables,
  createScheduledJobRunsTables,
  createScheduledJobsTables,
  createStorageTables,
  createSystemTables,
  createTasksTables,
  createMetricsCacheTables,
  createUploadSessionsTables,
  createUploadPartsTables,
  createVfsTables,
} from "./schema.js";
import {
  addCustomContentSettings,
  addDefaultProxySetting,
  addFileNamingStrategySetting,
  addPreviewSettings,
  addSiteSettings,
  createDefaultAdmin,
  createDefaultGuestApiKey,
  initDefaultSettings,
} from "./seed.js";

/**
 * SQLite/D1 初始化（legacy）
 *
 */
export async function initDatabase(db) {
  console.log("开始初始化数据库表结构...");

  await createPasteTables(db);
  await createAdminTables(db);
  await createStorageTables(db);
  await createFileTables(db);
  await createFsMetaTables(db);
  await createFsSearchIndexTables(db);
  await createMigrationTables(db);
  await createSystemTables(db);
  await createTasksTables(db);
  await createScheduledJobsTables(db);
  await createScheduledJobRunsTables(db);
  await createUploadSessionsTables(db);
  await createVfsTables(db);
  await createMetricsCacheTables(db);
  await createUploadPartsTables(db);

  await createIndexes(db);

  await initDefaultSettings(db);
  await addPreviewSettings(db);
  await addSiteSettings(db);
  await addCustomContentSettings(db);
  await addFileNamingStrategySetting(db);
  await addDefaultProxySetting(db);

  await createDefaultAdmin(db);
  await createDefaultGuestApiKey(db);

  console.log("数据库初始化完成");
}

export default {
  initDatabase,
};
