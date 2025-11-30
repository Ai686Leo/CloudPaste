/**
 * 直链能力接口（下载/上传）
 * 定义存储驱动生成“可直接对外访问 URL”的能力
 * - 对于 S3 等对象存储：通常表现为预签名 URL
 * - 对于有 custom_host 的存储：可以是 custom_host 直链
 *
 * 注意：
 * - storage-driver 能力规范中，DIRECT_LINK 的“最小要求”是实现 generateDownloadUrl(path, options)
 *   且返回对象需包含 canonical 字段：
 *   - url: 最终可供浏览器/客户端使用的直链
 *   - type: 直链类型标记（例如 "custom_host" | "native_direct"）
 *   其余字段（expiresIn/expiresAt 等）为可选扩展。
 * - generateUploadUrl / generatePresignedUrl 仅在支持预签名上传的驱动上实现（如 S3/R2），
 *   WebDAV 等只提供下载直链的驱动可以不实现上传相关方法。
 */

export class DirectLinkCapable {
  /**
   * 生成预签名下载URL
   * @param {string} path - 文件路径
   * @param {Object} options - 选项参数
   * @param {number} options.expiresIn - URL过期时间（秒），默认3600秒
   * @param {boolean} options.forceDownload - 是否强制下载
   * @param {string} options.responseContentType - 响应内容类型
   * @param {string} options.responseContentDisposition - 响应内容处置
   * @returns {Promise<Object>} 预签名下载URL信息
   */
  async generateDownloadUrl(path, options = {}) {
    throw new Error("generateDownloadUrl方法必须在实现DirectLinkCapable的类中实现");
  }

  /**
   * 生成预签名上传URL
   * @param {string} path - 目标路径
   * @param {Object} options - 选项参数
   * @param {number} options.expiresIn - URL过期时间（秒），默认3600秒
   * @param {string} options.contentType - 内容类型
   * @param {number} options.contentLength - 内容长度限制
   * @param {Object} options.metadata - 文件元数据
   * @returns {Promise<Object>} 预签名上传URL信息
   */
  async generateUploadUrl(path, options = {}) {
    throw new Error("generateUploadUrl方法必须在实现DirectLinkCapable的类中实现");
  }

  /**
   * 生成预签名URL（通用方法）
   * @param {string} path - 文件路径
   * @param {string} operation - 操作类型：'download' 或 'upload'
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 预签名URL信息
   */
  async generatePresignedUrl(path, operation, options = {}) {
    switch (operation) {
      case "download":
        return await this.generateDownloadUrl(path, options);
      case "upload":
        return await this.generateUploadUrl(path, options);
      default:
        throw new ValidationError(`不支持的预签名URL操作类型: ${operation}`);
    }
  }

  /**
   * 批量生成预签名下载URL
   * @param {Array<string>} paths - 文件路径数组
   * @param {Object} options - 选项参数
   * @returns {Promise<Array>} 预签名URL信息数组
   */
  async batchGenerateDownloadUrls(paths, options = {}) {
    // 默认实现：逐个生成
    const results = [];
    const errors = [];

    for (const path of paths) {
      try {
        const result = await this.generateDownloadUrl(path, options);
        results.push({ path, success: true, ...result });
      } catch (error) {
        errors.push({ path, success: false, error: error.message });
        if (!options.continueOnError) {
          throw error;
        }
      }
    }

    return {
      success: errors.length === 0,
      results,
      errors,
      total: paths.length,
      succeeded: results.length,
      failed: errors.length,
    };
  }

  /**
   * 验证预签名URL是否有效
   * @param {string} url - 预签名URL
   * @param {Object} options - 选项参数
   * @returns {Promise<boolean>} 是否有效
   */
  async validatePresignedUrl(url, options = {}) {
    // 默认实现：简单的URL格式检查
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === "https:" || urlObj.protocol === "http:";
    } catch {
      return false;
    }
  }
}

/**
 * 检查对象是否实现了 DirectLinkCapable 接口
 * @param {Object} obj - 要检查的对象
 * @returns {boolean} 是否实现了PresignedCapable接口
 */
export function isDirectLinkCapable(obj) {
  // 对于“能力探测”场景，最小判断标准统一为：存在 generateDownloadUrl 方法即可
  // 上传相关方法（generateUploadUrl/generatePresignedUrl）为可选扩展能力，
  // 由具体使用场景（例如 ObjectStore 预签名上传）在调用前自行做 typeof 检查。
  return obj && typeof obj.generateDownloadUrl === "function";
}

/**
 * DirectLinkCapable 能力的标识符
 */
export const DIRECT_LINK_CAPABILITY = "DirectLinkCapable";
import { ValidationError } from "../../../http/errors.js";
