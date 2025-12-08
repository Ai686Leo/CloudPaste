/**
 * 分片上传能力模块
 *
 * 定义存储驱动的「前端驱动分片上传」能力检测，用于大文件上传与断点续传。
 *
 * ========== 契约要求==========
 *
 * 驱动只要实现以下方法，即视为具备 MULTIPART 能力：
 *
 * - initializeFrontendMultipartUpload(subPath, options): Promise<InitResult>
 *
 * - completeFrontendMultipartUpload(subPath, options): Promise<CompleteResult>
 *   完成前端分片上传（合并分片或确认最终对象就绪），至少返回：
 *   {
 *     success: boolean,
 *     storagePath?: string,
 *     message?: string,
 *     // 可附带 etag/publicUrl/driver 原始响应等调试字段
 *   }
 *
 * - abortFrontendMultipartUpload(subPath, options): Promise<Object>
 *   取消前端分片上传，清理已上传的分片或关闭后端会话。
 *
 * - listMultipartUploads(subPath, options): Promise<Object>
 *   列出进行中的分片上传任务（用于断点续传 UI），返回结构由驱动自定义。
 *
 * - listMultipartParts(subPath, uploadId, options): Promise<Object>
 *   列出指定上传任务的已上传分片，用于恢复进度与前端校验。
 *
 * - refreshMultipartUrls(subPath, uploadId, partNumbers, options): Promise<Object>
 *   根据策略刷新上传端点：
 *   - 对于 per_part_url 策略：通常返回新的预签名 URL 列表；
 *   - 对于 single_session 策略：可以返回新的 session 信息，或作为 no-op（前端不调用）。
 *
 * 注意：
 * - 本模块只约束「方法集合」与 InitResult/CompleteResult 的基本字段约定；
 *   具体协议（S3 多分片 / OneDrive uploadSession / 其他云存储）由各驱动自行实现。
 * - FileSystem 与前端只应依赖这些公共字段和 strategy
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
