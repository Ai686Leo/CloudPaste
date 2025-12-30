/**
 * 目录分页能力（可选）
 *
 * - 有些上游“列目录 API”天然就是分页的，
 *   不分页就拿不全，或者会遇到上游限制/超时。
 * - 这个能力用于“/api/fs/list”自动启用分页返回。
 *
 * ========== 契约要求 ==========
 * 驱动必须实现以下方法才能通过 isPagedListCapable() 检测：
 *
 * - supportsDirectoryPagination(): boolean
 *   返回 true 表示该驱动的 listDirectory 支持 cursor/limit/paged 这些参数，并且可以分页返回。
 *
 */

/**
 * 检查对象是否实现了 PagedList 能力
 * @param {Object} obj - 要检查的对象
 * @returns {boolean} 是否具备目录分页能力
 */
export function isPagedListCapable(obj) {
  try {
    return !!(obj && typeof obj.listDirectory === "function" && typeof obj.supportsDirectoryPagination === "function" && obj.supportsDirectoryPagination());
  } catch {
    return false;
  }
}

/**
 * PagedList 能力的标识符
 */
export const PAGED_LIST_CAPABILITY = "PagedListCapable";

