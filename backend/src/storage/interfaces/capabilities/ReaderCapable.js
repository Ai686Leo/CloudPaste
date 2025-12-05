/**
 * 读取能力模块
 *
 * 定义存储驱动的读取操作能力检测
 * 支持此能力的驱动可以进行文件和目录的读取操作
 *
 * ========== 契约要求 ==========
 * 驱动必须实现以下方法才能通过 isReaderCapable() 检测：
 *
 * - listDirectory(path, options): Promise<Object>
 *   列出目录内容，返回 { path, type, isRoot, isVirtual, items: Array<FileInfo> }
 *
 * - downloadFile(path, options): Promise<StorageStreamDescriptor>
 *   下载文件，返回 StorageStreamDescriptor 对象
 *   StorageStreamDescriptor 结构：
 *   {
 *     size: number | null,           // 文件大小（字节）
 *     contentType: string | null,    // MIME 类型
 *     etag?: string | null,          // ETag
 *     lastModified?: Date | null,    // 最后修改时间
 *     getStream(options?): Promise<StreamHandle>,  // 获取完整流
 *     getRange?(range, options?): Promise<StreamHandle>  // 获取范围流（可选）
 *   }
 *   StreamHandle 结构：{ stream: NodeReadable | ReadableStream, close(): Promise<void> }
 *
 * - getFileInfo(path, options): Promise<Object>
 *   获取文件信息，返回 { path, name, isDirectory, size, modified, mimetype?, type, typeName }
 *
 */

/**
 * 检查对象是否实现了 Reader 能力
 * @param {Object} obj - 要检查的对象
 * @returns {boolean} 是否具备读取能力
 */
export function isReaderCapable(obj) {
  return (
    obj &&
    typeof obj.listDirectory === "function" &&
    typeof obj.downloadFile === "function" &&
    typeof obj.getFileInfo === "function"
  );
}

/**
 * Reader 能力的标识符
 */
export const READER_CAPABILITY = "ReaderCapable";
