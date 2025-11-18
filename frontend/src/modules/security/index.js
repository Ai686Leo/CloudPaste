import { getAuthSnapshot, logoutViaBridge } from "@/stores/authBridge.js";
import { buildAuthHeaders } from "@/api/authHeaders.js";

/**
 * Security 模块入口
 *
 * - 提供统一的认证快照访问（基于 authBridge）
 * - 暴露构造 Authorization 头的工具，供 driver / API client 使用
 */

export { getAuthSnapshot, logoutViaBridge, buildAuthHeaders };

/**
 * 基于当前认证状态构造带 Authorization 的请求头
 * - 如果 baseHeaders 已包含 Authorization，则不会覆盖
 */
export function buildAuthHeadersForRequest(baseHeaders = {}) {
  return buildAuthHeaders(baseHeaders);
}

