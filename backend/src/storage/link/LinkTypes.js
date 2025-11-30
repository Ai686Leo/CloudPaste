// 通用 StorageLink 类型定义与辅助工具
// kind 仅区分 direct/proxy；custom_host / 直链（如预签名）通过附加标记表达

/**
 * @typedef {Object} StorageLink
 * @property {string} url              // 直链或可代理的底层 URL
 * @property {"direct"|"proxy"} kind   // 路由决策依据
 * @property {Record<string,string[]>|undefined} headers // 可选上游 Header 映射（用于 /api/proxy/link → Worker）
 */

/**
 * 创建一个 direct 类型的 StorageLink
 * @param {string} url
 * @param {Object} [options]
 * @returns {StorageLink}
 */
export function createDirectLink(url, options = {}) {
  return {
    url,
    kind: "direct",
    headers: options.headers || undefined,
  };
}

/**
 * 创建一个 proxy 类型的 StorageLink
 * @param {string} url
 * @param {Object} [options]
 * @returns {StorageLink}
 */
export function createProxyLink(url, options = {}) {
  return {
    url,
    kind: "proxy",
    headers: options.headers || undefined,
  };
}
