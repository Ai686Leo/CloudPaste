/**
 * 写入能力模块
 *
 * 定义存储驱动的写入操作能力检测
 * 支持此能力的驱动可以进行文件和目录的创建、更新、删除操作
 *
 * ========== 契约要求 ==========
 * 驱动必须实现以下方法才能通过 isWriterCapable() 检测：
 *
 * - uploadFile(path, fileOrStream, options): Promise<Object>
 *   上传文件，返回 { success, storagePath, message? }
 *
 * - createDirectory(path, options): Promise<Object>
 *   创建目录，返回 { success, path, alreadyExists? }
 *
 * - batchRemoveItems(paths, options): Promise<Object>
 *   批量删除，返回 { success: number, failed: Array<{path, error}> }
 *
 * - renameItem(oldPath, newPath, options): Promise<Object>
 *   重命名，返回 { success, source, target, message? }
 *
 * - copyItem(sourcePath, targetPath, options): Promise<Object>
 *   复制，返回 { status, source, target, message?, skipped?, reason? }
 */

/**
 * 检查对象是否实现了 Writer 能力
 * @param {Object} obj - 要检查的对象
 * @returns {boolean} 是否具备写入能力
 */
export function isWriterCapable(obj) {
  return (
    obj &&
    typeof obj.uploadFile === "function" &&
    typeof obj.createDirectory === "function" &&
    typeof obj.batchRemoveItems === "function" &&
    typeof obj.renameItem === "function" &&
    typeof obj.copyItem === "function"
  );
}

/**
 * Writer 能力的标识符
 */
export const WRITER_CAPABILITY = "WriterCapable";
