import { getDbProvider } from "./providers/index.js";

/**
 * 从 env 推导 DB provider 名称
 * - 默认 sqlite（兼容 D1/SQLiteAdapter）
 * - 未来可在 Worker bindings 或 Node env 中设置 DB_PROVIDER=postgres/mysql
 */
export function detectDbProviderName(env = {}) {
  const explicit =
    env?.DB_PROVIDER ||
    env?.DB_DIALECT ||
    (typeof process !== "undefined" ? process.env.DB_PROVIDER || process.env.DB_DIALECT : null);
  return explicit ? String(explicit).toLowerCase() : "sqlite";
}

/**
 * 构建 DB Runtime（db + provider + dialect）
 * @param {{ db:any, env?:any, providerName?:string }} params
 */
export function createDbRuntime({ db, env = {}, providerName = null }) {
  if (!db) {
    throw new Error("createDbRuntime: 缺少 db");
  }
  const resolvedProviderName = providerName || detectDbProviderName(env);
  const provider = getDbProvider(resolvedProviderName);
  return {
    db,
    env,
    provider,
    dialect: provider.dialect,
    providerName: provider.name,
  };
}
