import { createDbRuntime } from "./runtime.js";

/**
 * 确保数据库可用（统一入口）
 * - 由 provider 决定初始化/迁移策略
 *
 * @param {{ db:any, env?:any, providerName?:string }} params
 */
export async function ensureDatabaseReady({ db, env = {}, providerName = null }) {
  const runtime = createDbRuntime({ db, env, providerName });
  await runtime.provider.ensureReady(runtime);
  return runtime;
}
