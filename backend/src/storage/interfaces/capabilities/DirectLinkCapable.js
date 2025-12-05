/**
 * 直链能力模块
 *
 * 定义存储驱动生成"可直接对外访问 URL"的能力检测
 * - 对于 S3 等对象存储：通常表现为预签名 URL
 * - 对于有 custom_host 的存储：可以是 custom_host 直链
 *
 * ========== 契约要求 ==========
 * 驱动必须实现以下方法才能通过 isDirectLinkCapable() 检测：
 *
 * - generateDownloadUrl(path, options): Promise<Object>
 *   生成下载直链，返回对象必须包含：
 *   - url: 最终可供浏览器/客户端使用的直链
 *   - type: 直链类型标记（例如 "custom_host" | "native_direct"）
 *   其余字段（expiresIn/expiresAt 等）为可选扩展
 *
 * 可选扩展方法（由具体使用场景在调用前自行做 typeof 检查）：
 * - generateUploadUrl(path, options): 生成预签名上传 URL
 * - generatePresignedUrl(path, operation, options): 通用预签名 URL 生成
 */

/**
 * 检查对象是否实现了 DirectLink 能力
 * @param {Object} obj - 要检查的对象
 * @returns {boolean} 是否具备直链能力
 */
export function isDirectLinkCapable(obj) {
  // 最小判断标准：存在 generateDownloadUrl 方法即可
  // 上传相关方法为可选扩展能力
  return obj && typeof obj.generateDownloadUrl === "function";
}

/**
 * DirectLink 能力的标识符
 */
export const DIRECT_LINK_CAPABILITY = "DirectLinkCapable";
