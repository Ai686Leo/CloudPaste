import { DB_SCHEMA_VERSION } from "../engine/version.js";
import { runLegacyMigrationByVersion } from "../engine/migrations.js";
import { pad2 } from "./adoptUtils.js";

function createVersionMigration(version) {
  return {
    id: `app-v${pad2(version)}`,
    async up({ db }) {
      await runLegacyMigrationByVersion(db, version);
      return true;
    },
  };
}

/**
 * v01..vN 版本迁移列表（SQLite/D1）
 * - 新增版本时：只需把 DB_SCHEMA_VERSION（engine/version.js）增大，并在 engine/migrations.js 添加对应 case
 */
export const versionMigrations = Array.from(
  { length: DB_SCHEMA_VERSION },
  (_, idx) => createVersionMigration(idx + 1),
);

export default versionMigrations;
