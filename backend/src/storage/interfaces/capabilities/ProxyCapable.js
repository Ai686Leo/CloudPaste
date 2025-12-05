/**
 * 代理能力模块
 *
 * 定义存储驱动的代理访问能力检测
 * 支持此能力的驱动可以生成代理 URL，提供无认证的公开访问
 *
 * ========== 契约要求 ==========
 * 驱动必须实现以下方法才能通过 isProxyCapable() 检测：
 *
 * - generateProxyUrl(path, options): Promise<Object>
 *   生成代理 URL，返回对象必须包含：
 *   - url: 可供浏览器/客户端或应用层 302 使用的完整代理 URL（通常为 /api/p 前缀）
 *   - type: 固定为 "proxy"（由上层映射为 StorageLink.kind = "proxy"）
 *   - channel: 可选，用于标记调用场景，例如 "web" | "webdav" | "share"
 *
 * - supportsProxyMode(): boolean
 *   检查是否支持代理模式（只描述能力本身，不依赖挂载策略）
 */

/**
 * 检查对象是否实现了 Proxy 能力
 * @param {Object} obj - 要检查的对象
 * @returns {boolean} 是否具备代理能力
 */
export function isProxyCapable(obj) {
  return (
    obj &&
    typeof obj.generateProxyUrl === "function" &&
    typeof obj.supportsProxyMode === "function"
  );
}

/**
 * Proxy 能力的标识符
 */
export const PROXY_CAPABILITY = "ProxyCapable";
