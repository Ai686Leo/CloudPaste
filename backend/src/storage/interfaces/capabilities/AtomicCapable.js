/**
 * 原子操作能力模块
 *
 * 定义存储驱动的原子操作能力检测
 * 支持此能力的驱动可以进行文件和目录的重命名、复制等原子操作
 * 确保操作的原子性和一致性
 *
 * ========== 契约要求 ==========
 * 驱动必须实现以下方法才能通过 isAtomicCapable() 检测：
 *
 * - renameItem(oldPath, newPath, options): Promise<Object>
 *   重命名文件或目录，返回 { success, source, target, message? }
 *
 * - copyItem(sourcePath, targetPath, options): Promise<Object>
 *   复制文件或目录，返回 { status, source, target, message?, skipped?, reason? }
 */

/**
 * 检查对象是否实现了 Atomic 能力
 * @param {Object} obj - 要检查的对象
 * @returns {boolean} 是否具备原子操作能力
 */
export function isAtomicCapable(obj) {
  return (
    obj &&
    typeof obj.renameItem === "function" &&
    typeof obj.copyItem === "function"
  );
}

/**
 * Atomic 能力的标识符
 */
export const ATOMIC_CAPABILITY = "AtomicCapable";
