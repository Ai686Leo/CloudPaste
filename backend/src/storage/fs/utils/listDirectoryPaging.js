/**
 * listDirectoryPaging
 *
 * “完整遍历目录”的内部逻辑（例如索引重建/dirty 子树重建）提供一个统一的“按页拉取”迭代器。
 *
 *
 * - fileSystem.listDirectory(path, ..., { paged, cursor, limit }) 返回结果中如果包含：
 *   - hasMore: boolean
 *   - nextCursor: string|null
 *   那么表示还有下一页（cursor 为不透明字符串，交给驱动自己解释）。
 */

/**
 * 按页遍历某个目录的所有子项（不会把所有页一次性堆到内存里）。
 *
 * @param {any} fileSystem FileSystem 实例（需要实现 listDirectory）
 * @param {string} dirPath 目录路径（约定应以 / 结尾）
 * @param {any} userIdOrInfo 用户身份信息
 * @param {any} userType 用户类型
 * @param {{ refresh?: boolean, pageLimit?: number }} options
 */
export async function* iterateListDirectoryItems(fileSystem, dirPath, userIdOrInfo, userType, options = {}) {
  const refresh = options?.refresh === true;
  const limitRaw = options?.pageLimit != null && options.pageLimit !== "" ? Number(options.pageLimit) : null;
  // pageLimit 不提供时，不强行覆盖驱动默认值（例如 HF tree 的 limit 有自己的默认/上限策略）。
  const pageLimit =
    limitRaw != null && Number.isFinite(limitRaw) && limitRaw > 0 ? Math.max(1, Math.floor(limitRaw)) : null;

  let cursor = null;
  let pages = 0;

  while (true) {
    pages += 1;
    // 兜底：避免驱动返回错误的 nextCursor 导致死循环
    if (pages > 20000) {
      throw new Error("listDirectory 分页循环异常：超过 20000 页仍未结束（可能是驱动 nextCursor 逻辑有问题）");
    }

    const listResult = await fileSystem.listDirectory(dirPath, userIdOrInfo, userType, {
      refresh,
      paged: true,
      cursor,
      ...(pageLimit != null ? { limit: pageLimit } : {}),
    });

    const items = Array.isArray(listResult?.items) ? listResult.items : [];
    for (const item of items) {
      yield item;
    }

    const nextCursorRaw =
      listResult?.nextCursor != null && String(listResult.nextCursor).trim() ? String(listResult.nextCursor).trim() : null;
    const hasMoreFlag = listResult?.hasMore === true;
    const shouldContinue = hasMoreFlag || !!nextCursorRaw;

    if (!shouldContinue || !nextCursorRaw) {
      break;
    }

    if (nextCursorRaw === cursor) {
      break;
    }

    cursor = nextCursorRaw;
  }
}
