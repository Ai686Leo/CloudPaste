/**
 * 环境检测和配置工具
 * 用于根据部署环境（Cloudflare Worker vs Docker/Server）提供最优配置
 */

/**
 * 检测当前是否运行在Cloudflare Worker环境
 * @returns {boolean} 是否为Worker环境
 */
export function isCloudflareWorkerEnvironment() {
  // Wrangler 开发环境检测
  // 检测 Wrangler 特征：有 caches 和 Response，但仍有 process（wrangler dev --local）
  if (typeof caches !== "undefined" && typeof Response !== "undefined" && typeof window === "undefined" && typeof process !== "undefined") {
    // 进一步检测是否为 Wrangler 环境
    const hasWorkerFeatures = typeof navigator !== "undefined" && typeof globalThis !== "undefined";
    if (hasWorkerFeatures) {
      return true;
    }
  }

  // 标准 Cloudflare Workers 检测
  return typeof caches !== "undefined" && typeof Response !== "undefined" && typeof process === "undefined" && typeof window === "undefined";
}

/**
 * 获取环境自适应的上传配置
 * @returns {Object} 上传配置对象
 */
export function getEnvironmentOptimizedUploadConfig() {
  const isWorker = isCloudflareWorkerEnvironment();

  return isWorker
    ? {
        partSize: 6 * 1024 * 1024, // 6MB - Worker环境内存限制
        queueSize: 1, // 1并发 - 避免CPU时间超限
        environment: "Cloudflare Worker",
        maxConcurrency: 1, // 最大并发数
        bufferSize: 6 * 1024 * 1024, // 缓冲区大小
      }
    : {
        partSize: 8 * 1024 * 1024, // 8MB - Docker环境更大分片
        queueSize: 4, // 4并发
        environment: "Docker/Server",
        maxConcurrency: 4, // 最大并发数
        bufferSize: 32 * 1024 * 1024, // 缓冲区大小
      };
}

/**
 * 获取环境名称
 * @returns {string} 环境名称
 */
export function getEnvironmentName() {
  return isCloudflareWorkerEnvironment() ? "Cloudflare Worker" : "Docker/Server";
}

/**
 * 获取推荐的分片大小
 * @returns {number} 分片大小（字节）
 */
export function getRecommendedPartSize() {
  return isCloudflareWorkerEnvironment() ? 6 * 1024 * 1024 : 8 * 1024 * 1024;
}

/**
 * 获取推荐的并发数
 * @returns {number} 并发数
 */
export function getRecommendedConcurrency() {
  return isCloudflareWorkerEnvironment() ? 1 : 4;
}

/**
 * 获取加密密钥（统一入口）
 * 优先读取环境变量，回退到默认值
 * @param {import('hono').Context} c
 * @returns {string}
 */
export function getEncryptionSecret(c) {
  const secret = (c && c.env && c.env.ENCRYPTION_SECRET) || (typeof process !== "undefined" ? process.env?.ENCRYPTION_SECRET : null);
  if (!secret) {
    throw new Error("ENCRYPTION_SECRET 未配置，请在环境变量中设置一个安全的随机密钥");
  }
  return secret;
}

/**
 * 把各种“真假值”统一转成 boolean
 *
 * @param {any} value
 * @param {boolean} [defaultValue=false]
 */
export function toBool(value, defaultValue = false) {
  if (value === true) return true;
  if (value === false) return false;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true" || lowered === "yes" || lowered === "on") return true;
    if (lowered === "false" || lowered === "no" || lowered === "off") return false;
  }
  return defaultValue;
}

/**
 * 检测当前是否运行在Node.js环境
 * @returns {boolean} 是否为Node.js环境
 */
export function isNodeJSEnvironment() {
  return typeof process !== "undefined" && process.versions && process.versions.node;
}
