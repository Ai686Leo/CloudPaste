import { getAuthSnapshot } from "@/modules/security/index.js";

/**
 * PWA Offline 模块入口
 *
 * - 统一封装离线操作队列的写入逻辑
 * - 对外提供轻量 API，供 api/client 等模块调用
 */

let offlineOperationLock = false;

/**
 * 根据 endpoint/method 判定离线操作类型
 */
export function getOfflineOperationType(endpoint, method) {
  if (endpoint.includes("/paste") && method === "POST") {
    return { type: "createPaste", description: "离线创建文本分享已加入队列" };
  }

  if (endpoint.includes("/pastes/")) {
    if (method === "PUT") return { type: "updatePaste", description: "离线更新文本分享已加入队列" };
  }

  if (endpoint.includes("/pastes/batch-delete") && method === "DELETE") {
    return { type: "batchDeletePastes", description: "离线批量删除文本分享已加入队列" };
  }

  if (endpoint.includes("/pastes/clear-expired") && method === "POST") {
    return { type: "clearExpiredPastes", description: "离线清理过期文本分享已加入队列" };
  }

  if (endpoint.includes("/admin/settings/group/") && method === "PUT") {
    return { type: "updateGroupSettings", description: "离线分组设置更新已加入队列" };
  }

  if (endpoint.includes("/admin/cache/clear") && method === "POST") {
    return { type: "clearCache", description: "离线缓存清理已加入队列" };
  }

  if (endpoint.includes("/share/verify/") && method === "POST") {
    return { type: "verifyFilePassword", description: "离线文件密码验证已加入队列" };
  }

  return null;
}

/**
 * 将离线操作写入离线队列（IndexedDB）
 * 行为与原 client.js 中的 handleOfflineOperation 保持一致
 */
export async function enqueueOfflineOperation(endpoint, options) {
  if (offlineOperationLock) {
    console.log("[PWA] 离线操作正在处理中，跳过重复操作");
    return;
  }

  console.log(`[PWA] 处理离线操作: ${options.method} ${endpoint}`);
  try {
    offlineOperationLock = true;

    const { pwaUtils } = await import("../../pwa/pwaManager.js");
    if (!pwaUtils || !pwaUtils.storage) {
      console.warn("[PWA] pwaUtils或storage不可用");
      return;
    }

    // 获取当前认证信息
    let authToken = null;
    let authType = null;
    const authState = getAuthSnapshot();

    if (authState) {
      if (authState.authType === "admin" && authState.adminToken) {
        authToken = authState.adminToken;
        authType = "admin";
        console.log(`[PWA] 获取管理员认证信息，token长度: ${authToken.length}`);
      } else if (authState.authType === "apikey" && authState.apiKey) {
        authToken = authState.apiKey;
        authType = "apikey";
        console.log(`[PWA] 获取API密钥认证信息，token长度: ${authToken.length}`);
      }
    }

    const operation = {
      endpoint,
      method: options.method,
      data: options.body,
      authToken,
      authType,
      timestamp: new Date().toISOString(),
      status: "pending",
    };

    const operationType = getOfflineOperationType(endpoint, options.method);
    if (!operationType) {
      console.log(`[PWA] 跳过离线操作（不适合离线处理）: ${options.method} ${endpoint}`);
      return;
    }

    operation.type = operationType.type;
    await pwaUtils.storage.addToOfflineQueue(operation);
    console.log(`[PWA] ${operationType.description}`);

    if (pwaUtils.isBackgroundSyncSupported()) {
      try {
        await pwaUtils.registerBackgroundSync("sync-offline-queue");
        console.log("[PWA] Background Sync 已注册，操作将在网络恢复时自动同步");
      } catch (error) {
        console.warn("[PWA] Background Sync 注册失败:", error);
      }
    }
  } catch (error) {
    console.warn("[PWA] 离线操作处理失败:", error);
  } finally {
    offlineOperationLock = false;
  }
}
