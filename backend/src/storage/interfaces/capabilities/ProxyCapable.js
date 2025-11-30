/**
 * 代理能力接口
 * 定义存储驱动的代理访问能力
 * 支持此能力的驱动可以生成代理URL，提供无认证的公开访问
 *
 * 约定：
 * - generateProxyUrl 必须返回一个对象，其中：
 *   - url: 可供浏览器/客户端或应用层 302 使用的完整代理 URL（通常为 /api/p 前缀）；
 *   - type: 固定为 "proxy"（由上层映射为 StorageLink.kind = "proxy"）；
 *   - channel: 可选，用于标记调用场景，例如 "web" | "webdav" | "share"。
 */

export class ProxyCapable {
  /**
   * 生成代理URL
   * @param {string} path - 文件路径
   * @param {Object} options - 选项参数
   * @param {Object} options.mount - 挂载点信息（可选，僅作上下文透传，不應包含策略判斷）
   * @param {Request} options.request - 请求对象（用于构建完整URL）
   * @param {boolean} options.download - 是否为下载模式
   * @param {string} [options.channel] - 使用通道標記，例如 \"web\" | \"webdav\" | \"share\"
   * @returns {Promise<Object>} 代理URL对象
   */
  async generateProxyUrl(path, options = {}) {
    throw new Error("generateProxyUrl方法必须在实现ProxyCapable的类中实现");
  }

  /**
   * 检查是否支持代理模式
   * @returns {boolean} 是否支持代理模式
   */
  supportsProxyMode() {
    // 默认实现：只描述能力本身，不依赖挂载策略
    return true;
  }

  /**
   * 获取代理配置
   * @returns {Object} 代理配置对象
   */
  getProxyConfig() {
    return {
      enabled: this.supportsProxyMode(),
    };
  }
}

/**
 * 检查对象是否实现了ProxyCapable接口
 * @param {Object} obj - 要检查的对象
 * @returns {boolean} 是否实现了ProxyCapable接口
 */
export function isProxyCapable(obj) {
  return obj && typeof obj.generateProxyUrl === "function" && typeof obj.supportsProxyMode === "function";
}

/**
 * ProxyCapable能力的标识符
 */
export const PROXY_CAPABILITY = "ProxyCapable";
