/**
 * 上传进度跟踪工具（后端通用）
 * 目前仅用于内部记录和日志，后续可扩展为对外查询接口
 */

/** @type {Map<string, { id: string; loaded: number; total: number|null; path?: string|null; storageType?: string|null; updatedAt: number; completed: boolean }>} */
const progressStore = new Map();

/**
 * 更新上传进度
 * @param {string} id - 进度ID（可使用 uploadId 或存储路径）
 * @param {{ loaded: number; total?: number|null; path?: string|null; storageType?: string|null; completed?: boolean }} payload
 */
export function updateUploadProgress(id, payload) {
  if (!id) return;
  const prev = progressStore.get(id);
  const loaded = typeof payload.loaded === "number" ? payload.loaded : prev?.loaded ?? 0;
  const total =
    typeof payload.total === "number"
      ? payload.total
      : payload.total === null
      ? null
      : prev?.total ?? null;

  progressStore.set(id, {
    id,
    loaded,
    total,
    path: payload.path ?? prev?.path ?? null,
    storageType: payload.storageType ?? prev?.storageType ?? null,
    updatedAt: Date.now(),
    completed: payload.completed ?? prev?.completed ?? false,
  });
}

/**
 * 标记上传完成
 * @param {string} id
 */
export function completeUploadProgress(id) {
  if (!id || !progressStore.has(id)) return;
  const prev = progressStore.get(id);
  if (!prev) return;
  progressStore.set(id, {
    ...prev,
    completed: true,
    updatedAt: Date.now(),
  });
}

/**
 * 获取上传进度
 * @param {string} id
 * @returns {{ id: string; loaded: number; total: number|null; path?: string|null; storageType?: string|null; updatedAt: number; completed: boolean }|null}
 */
export function getUploadProgress(id) {
  return id ? progressStore.get(id) ?? null : null;
}

/**
 * 删除上传进度（可用于清理完成或过期记录）
 * @param {string} id
 */
export function removeUploadProgress(id) {
  if (!id) return;
  progressStore.delete(id);
}

