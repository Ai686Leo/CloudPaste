import { mysqlDialect } from "../dialects/mysqlDialect.js";

export const mysqlProvider = {
  name: "mysql",
  dialect: mysqlDialect,
  async ensureReady(_runtime) {
    throw new Error("MySQLProvider: 迁移/初始化尚未实现（需要接入迁移系统后再启用）");
  },
};
