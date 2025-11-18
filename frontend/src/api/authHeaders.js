/**
 * 统一的认证请求头构造工具
 * 基于 authBridge 的快照生成 Authorization 头
 */

import { getAuthSnapshot } from "@/stores/authBridge.js";

/**
 * 根据当前认证状态构造带 Authorization 的 headers
 * 如果 baseHeaders 已提供 Authorization，则不会覆盖
 * @param {Object} baseHeaders
 * @returns {Object}
 */
export function buildAuthHeaders(baseHeaders = {}) {
  // 调用方已明确设置 Authorization，尊重调用方
  if (baseHeaders.Authorization) {
    return baseHeaders;
  }

  const headers = { ...baseHeaders };
  const authState = getAuthSnapshot();

  // 只要 bridge 中存在有效的认证凭据，就注入到请求头中
  if (authState) {
    if (authState.authType === "admin" && authState.adminToken) {
      headers.Authorization = `Bearer ${authState.adminToken}`;
    } else if (authState.authType === "apikey" && authState.apiKey) {
      headers.Authorization = `ApiKey ${authState.apiKey}`;
    }
  }

  return headers;
}
