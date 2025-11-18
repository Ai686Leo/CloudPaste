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
  return formatFileSizeUtil(bytes, useChineseUnits);
};

/**
 * 计算剩余可访问次数
 * @param {Object} item - 文件或文本分享对象
 * @param {Function} t - i18n 翻译函数，可选
 * @returns {string|number}
 */
export const getRemainingViews = (item, t = null) => {
  if (!item.max_views || item.max_views === 0) {
    return t ? t("file.unlimited") : "无限制";
  }

  const viewCount = item.view_count !== undefined ? item.view_count : item.views || 0;
  const remaining = item.max_views - viewCount;

  if (remaining <= 0) {
    return t ? t("file.usedUp") : "已用完";
  }

  return remaining;
};

/**
 * 获取剩余访问次数对应的样式类
 * @param {Object} item - 文件或文本分享对象
 * @param {boolean} darkMode - 是否为暗色模式
 * @param {Function} t - i18n 翻译函数，可选
 * @returns {string}
 */
export const getRemainingViewsClass = (item, darkMode = false, t = null) => {
  const remaining = getRemainingViews(item, t);
  const usedUpText = t ? t("file.usedUp") : "已用完";
  const unlimitedText = t ? t("file.unlimited") : "无限制";

  if (remaining === usedUpText) {
    return darkMode ? "text-red-400" : "text-red-600";
  } else if (remaining !== unlimitedText && remaining < 3) {
    return darkMode ? "text-yellow-400" : "text-yellow-600";
  }
  return darkMode ? "text-gray-300" : "text-gray-700";
};

