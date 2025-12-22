/**
 * 文件系统索引管理服务API
 * 提供索引状态查询、重建、增量应用、停止和清空等管理功能
 */

import { get, post } from "../client";

/******************************************************************************
 * 类型定义 (JSDoc)
 ******************************************************************************/

/**
 * @typedef {'not_ready' | 'indexing' | 'ready' | 'error'} IndexStatus
 * 索引状态枚举
 */

/**
 * @typedef {'none' | 'wait' | 'rebuild' | 'apply-dirty'} RecommendedAction
 * 建议操作枚举
 */

/**
 * @typedef {'indexing' | 'index_not_ready' | 'dirty_too_large' | 'dirty_pending' | null} RecommendedReason
 * 建议原因枚举
 */

/**
 * @typedef {'pending' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'} JobStatus
 * 任务状态枚举
 */

/**
 * @typedef {Object} IndexStatusItem
 * @property {string} mountId - 挂载点ID
 * @property {string|null} name - 挂载点名称
 * @property {string|null} mountPath - 挂载路径
 * @property {string|null} storageType - 存储类型
 * @property {IndexStatus} status - 索引状态
 * @property {number|null} lastIndexedMs - 最后索引时间戳(ms)
 * @property {number|null} updatedAtMs - 更新时间戳(ms)
 * @property {string|null} lastError - 最后错误信息
 * @property {number} dirtyCount - 待处理的dirty条目数
 * @property {RecommendedAction} recommendedAction - 建议操作
 * @property {RecommendedReason} recommendedReason - 建议原因
 */

/**
 * @typedef {Object} ApplyDirtyItemResult
 * @property {string} mountId - 挂载点ID
 * @property {string|null} [mountName] - 挂载点名称
 * @property {string|null} [mountPath] - 挂载路径
 * @property {string|null} [storageType] - 存储类型
 * @property {'processing' | 'success' | 'failed' | 'skipped'} status - 处理状态
 * @property {number} [processedDirtyCount] - 处理的脏记录数
 * @property {number} [upsertedCount] - 更新条目数
 * @property {number} [deletedCount] - 删除条目数
 * @property {number} [skippedCount] - 跳过条目数
 * @property {number} [failedCount] - 失败条目数
 * @property {number} [durationMs] - 耗时(ms)
 * @property {string} [error] - 错误信息
 */

/**
 * @typedef {Object} RebuildItemResult
 * @property {string} mountId - 挂载点ID
 * @property {string|null} [mountName] - 挂载点名称
 * @property {string|null} [mountPath] - 挂载路径
 * @property {string|null} [storageType] - 存储类型
 * @property {'processing' | 'success' | 'failed' | 'skipped'} status - 处理状态
 * @property {number} [scannedDirs] - 扫描的目录数
 * @property {number} [discoveredCount] - 发现的文件/目录数
 * @property {number} [upsertedCount] - 写入索引数
 * @property {number} [durationMs] - 耗时(ms)
 * @property {string} [error] - 错误信息
 */

/**
 * @typedef {Object} TaskStats
 * @property {number} totalItems - 总项目数
 * @property {number} processedItems - 已处理项目数
 * @property {number} successCount - 成功数
 * @property {number} failedCount - 失败数
 * @property {number} skippedCount - 跳过数
 * @property {Array<ApplyDirtyItemResult|RebuildItemResult|Object>} [itemResults] - 任务明细（不同任务类型字段不同）
 * @property {string} [currentMountId] - 当前处理的挂载点ID
 * @property {number} [scannedDirs] - 已扫描目录数
 * @property {number} [discoveredCount] - 已发现条目数（遍历过程中累计）
 * @property {number} [pendingCount] - 当前批次待写入条目数（仅用于进度观感）
 * @property {number} [upsertedCount] - 已更新/插入条目数
 * @property {number} [truncatedMounts] - 已清空的挂载点数
 * @property {number} [mountsHint] - 挂载点提示数
 * @property {number} [lastBatch] - 最后批次大小
 * @property {number} [heartbeatAtMs] - 进度心跳时间戳（ms）
 * @property {number} [totalDirtyProcessed] - 增量索引总处理条数
 * @property {number} [totalUpserted] - 增量索引总更新条数
 * @property {number} [totalDeleted] - 增量索引总删除条数
 */

/**
 * @typedef {Object} AllowedActions
 * @property {boolean} canView - 是否可查看
 * @property {boolean} canCancel - 是否可取消
 * @property {boolean} canDelete - 是否可删除
 * @property {boolean} canRetry - 是否可重试
 */

/**
 * @typedef {Object} JobDescriptor
 * @property {string} jobId - 作业ID
 * @property {string} taskType - 任务类型 ('fs_index_rebuild' | 'fs_index_apply_dirty')
 * @property {JobStatus} status - 任务状态
 * @property {TaskStats} stats - 任务统计
 * @property {string} createdAt - 创建时间
 * @property {string} [startedAt] - 开始时间
 * @property {string} [finishedAt] - 完成时间
 * @property {string} [updatedAt] - 更新时间
 * @property {Object} [payload] - 任务载荷
 * @property {AllowedActions} [allowedActions] - 允许的操作
 */

/**
 * @typedef {Object} IndexStatusHints
 * @property {number} minQueryLength - 最小查询长度
 * @property {number} dirtyRebuildThreshold - dirty重建阈值
 */

/**
 * @typedef {Object} IndexStatusResponse
 * @property {IndexStatusItem[]} items - 挂载点索引状态列表
 * @property {JobDescriptor[]} runningJobs - 运行中的任务列表
 * @property {IndexStatusHints} hints - 提示信息
 */

/**
 * @typedef {Object} RebuildOptions
 * @property {number} [batchSize] - 单次upsert批量大小，默认200
 * @property {number|null} [maxDepth] - 最大遍历深度，null表示不限制
 * @property {number|null} [maxMountsPerRun] - 单次作业最多处理的挂载点数量
 * @property {boolean} [refresh] - 是否强制跳过缓存，默认true
 */

/**
 * @typedef {Object} ApplyDirtyOptions
 * @property {number} [batchSize] - 单次拉取dirty条数，默认200
 * @property {number|null} [maxItems] - 单次作业最多处理的dirty条目数量
 * @property {boolean} [rebuildDirectorySubtree] - 目录upsert是否递归重建子树，默认true
 * @property {number|null} [maxDepth] - 目录子树重建的最大深度
 * @property {boolean} [refresh] - 是否强制跳过缓存，默认true
 */

/******************************************************************************
 * API函数
 ******************************************************************************/

/**
 * 获取所有挂载点的索引状态
 * @returns {Promise<{success: boolean, data: IndexStatusResponse, message: string}>}
 */
export async function getIndexStatus() {
  return get("/admin/fs/index/status");
}

/**
 * 创建索引重建作业
 * @param {string[]} [mountIds] - 要重建的挂载点ID列表，不提供则重建所有
 * @param {RebuildOptions} [options] - 重建选项
 * @returns {Promise<{success: boolean, data: {jobId: string, taskType: string}, message: string}>}
 */
export async function rebuildIndex(mountIds, options = {}) {
  const payload = {};

  if (mountIds && mountIds.length > 0) {
    payload.mountIds = mountIds;
  }

  if (Object.keys(options).length > 0) {
    payload.options = options;
  }

  return post("/admin/fs/index/rebuild", payload);
}

/**
 * 创建索引增量应用作业
 * @param {string[]} [mountIds] - 要处理的挂载点ID列表，不提供则处理所有
 * @param {ApplyDirtyOptions} [options] - 增量应用选项
 * @returns {Promise<{success: boolean, data: {jobId: string, taskType: string}, message: string}>}
 */
export async function applyDirty(mountIds, options = {}) {
  const payload = {};

  if (mountIds && mountIds.length > 0) {
    payload.mountIds = mountIds;
  }

  if (Object.keys(options).length > 0) {
    payload.options = options;
  }

  return post("/admin/fs/index/apply-dirty", payload);
}

/**
 * 停止索引作业
 * @param {string} jobId - 要停止的作业ID
 * @returns {Promise<{success: boolean, data: {jobId: string, mountIds: string[]}, message: string}>}
 */
export async function stopIndexJob(jobId) {
  return post("/admin/fs/index/stop", { jobId });
}

/**
 * 清空索引数据
 * @param {string[]} [mountIds] - 要清空的挂载点ID列表，不提供则清空所有
 * @returns {Promise<{success: boolean, data: {scope: 'all' | 'mount', mountIds?: string[]}, message: string}>}
 */
export async function clearIndex(mountIds) {
  const payload = {};

  if (mountIds && mountIds.length > 0) {
    payload.mountIds = mountIds;
  }

  return post("/admin/fs/index/clear", payload);
}

/******************************************************************************
 * 辅助函数
 ******************************************************************************/

/**
 * 获取索引状态的显示文本
 * @param {IndexStatus} status - 索引状态
 * @returns {string} 状态显示文本键名（用于i18n）
 */
export function getStatusTextKey(status) {
  const statusMap = {
    not_ready: "admin.fsIndex.status.notReady",
    indexing: "admin.fsIndex.status.indexing",
    ready: "admin.fsIndex.status.ready",
    error: "admin.fsIndex.status.error",
  };
  return statusMap[status] || "admin.fsIndex.status.unknown";
}

/**
 * 获取索引状态的样式类
 * @param {IndexStatus} status - 索引状态
 * @returns {string} Tailwind CSS类名
 */
export function getStatusBadgeClass(status) {
  const classMap = {
    ready: "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200",
    indexing: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200",
    not_ready: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200",
    error: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200",
  };
  return classMap[status] || "bg-gray-100 text-gray-800 dark:bg-gray-900/50 dark:text-gray-200";
}

/**
 * 计算任务进度百分比
 * @param {TaskStats} stats - 任务统计
 * @returns {number} 进度百分比 (0-100)
 */
export function calculateJobProgress(stats) {
  if (!stats || stats.totalItems === 0) return 0;
  return Math.round((stats.processedItems / stats.totalItems) * 100);
}

/**
 * 格式化时间戳为本地时间字符串
 * @param {number|string|null} timestamp - 时间戳(ms)或ISO字符串
 * @returns {string} 格式化的时间字符串
 */
export function formatTimestamp(timestamp) {
  if (!timestamp) return "-";

  const date = typeof timestamp === "number"
    ? new Date(timestamp)
    : new Date(timestamp);

  if (isNaN(date.getTime())) return "-";

  return date.toLocaleString();
}
