import { postgresDialect } from "../dialects/postgresDialect.js";

export const postgresProvider = {
  name: "postgres",
  dialect: postgresDialect,
  async ensureReady(_runtime) {
    throw new Error("PostgresProvider: 迁移/初始化尚未实现（需要接入迁移系统后再启用）");
  },
};
