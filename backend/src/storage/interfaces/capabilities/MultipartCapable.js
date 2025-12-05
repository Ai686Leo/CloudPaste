/**
 * 分片上传能力模块
 *
 * 定义存储驱动的前端分片上传操作能力检测
 * 主要用于 S3 等支持分片上传的存储服务
 * 支持大文件的高效上传和断点续传
 *
 * ========== 契约要求 ==========
 * 驱动必须实现以下方法才能通过 isMultipartCapable() 检测：
 *
 * - initializeFrontendMultipartUpload(subPath, options): Promise<Object>
 *   初始化前端分片上传，返回 uploadId 和预签名 URL 列表
 *
 * - completeFrontendMultipartUpload(subPath, options): Promise<Object>
 *   完成前端分片上传，合并所有分片
 *
 * - abortFrontendMultipartUpload(subPath, options): Promise<Object>
 *   取消前端分片上传，清理已上传的分片
 *
 * - listMultipartUploads(subPath, options): Promise<Object>
 *   列出进行中的分片上传任务
 *
 * - listMultipartParts(subPath, uploadId, options): Promise<Object>
 *   列出指定上传任务的已上传分片
 *
 * - refreshMultipartUrls(subPath, uploadId, partNumbers, options): Promise<Object>
 *   刷新分片上传的预签名 URL（用于 URL 过期续期）
 */

/**
 * 检查对象是否实现了 Multipart 能力
 * @param {Object} obj - 要检查的对象
 * @returns {boolean} 是否具备前端分片上传能力
 */
export function isMultipartCapable(obj) {
  return (
    obj &&
    typeof obj.initializeFrontendMultipartUpload === "function" &&
    typeof obj.completeFrontendMultipartUpload === "function" &&
    typeof obj.abortFrontendMultipartUpload === "function" &&
    typeof obj.listMultipartUploads === "function" &&
    typeof obj.listMultipartParts === "function" &&
    typeof obj.refreshMultipartUrls === "function"
  );
}

/**
 * Multipart 能力的标识符
 */
export const MULTIPART_CAPABILITY = "MultipartCapable";
