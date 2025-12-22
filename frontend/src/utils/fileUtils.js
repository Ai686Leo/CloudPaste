/**
 * 文件相关展示工具函数
 * 统一处理文件大小与剩余访问次数的格式化
 */

import { formatFileSize as formatFileSizeUtil } from "./fileTypes.js";

/**
 * 格式化文件大小
 * @param {number} bytes - 文件大小（字节）
 * @param {boolean} useChineseUnits - 是否使用中文单位
 * @returns {string}
 */
export const formatFileSize = (bytes, useChineseUnits = false) => {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return "-";
  }
  return formatFileSizeUtil(bytes, useChineseUnits);
};

/**
 * 计算剩余可访问次数
 * @param {Object} item - 文件或文本分享对象
 * @returns {number} - Infinity 表示无限制，0 表示已用完，正整数表示剩余次数
 */
export const getRemainingViews = (item) => {
  if (!item || !item.max_views || item.max_views === 0) {
    // 无限制
    return Infinity;
  }

  // 兼容不同字段：优先使用后端提供的 view_count，其次是 views
  const viewCount = item.view_count !== undefined ? item.view_count : item.views || 0;
  const remaining = item.max_views - viewCount;

  // 已用完
  if (remaining <= 0) {
    return 0;
  }

  // 返回剩余次数
  return remaining;
};

/**
 * 获取剩余访问次数对应的样式类（基于数值模型）
 * @param {number} remaining - 剩余次数（Infinity 表示无限制，0 表示已用完）
 * @param {boolean} darkMode - 是否为暗色模式
 * @returns {string}
 */
export const getRemainingViewsClass = (remaining, darkMode = false) => {
  if (remaining === 0) {
    // 已用完：红色高亮
    return darkMode ? "text-red-400" : "text-red-600";
  }

  if (remaining !== Infinity && remaining < 10) {
    // 剩余次数很少（<10）：黄色提醒
    return darkMode ? "text-yellow-400" : "text-yellow-600";
  }

  // 正常状态
  return darkMode ? "text-gray-300" : "text-gray-700";
};
