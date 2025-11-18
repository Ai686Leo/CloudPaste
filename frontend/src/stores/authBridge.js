// 统一的认证状态桥接器，允许跨模块安全访问认证信息而不引入循环依赖
let authStateAccessor = null;
let logoutHandler = null;

/**
 * 注册认证状态访问器与登出处理
 * @param {{ getSnapshot: () => { authType: string, adminToken: string|null, apiKey: string|null, isAuthenticated: boolean }, logout: () => Promise<void> }} bridge
 */
export function registerAuthBridge({ getSnapshot, logout }) {
  authStateAccessor = getSnapshot;
  logoutHandler = logout;
}

/**
 * 获取当前认证快照（无依赖）
 * @returns {{ authType: string, adminToken: string|null, apiKey: string|null, isAuthenticated: boolean }|null}
 */
export function getAuthSnapshot() {
  return typeof authStateAccessor === "function" ? authStateAccessor() : null;
}

/**
 * 通过桥接执行登出
 */
export async function logoutViaBridge() {
  if (typeof logoutHandler === "function") {
    await logoutHandler();
  }
}
