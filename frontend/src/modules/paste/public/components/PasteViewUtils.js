// PasteViewUtils.js - 文本查看页面的通用工具方法
// - 提供 PasteView* 系列组件共享的工具函数（调试日志、过期时间格式化等）
// - 不直接依赖具体组件状态，只依赖传入参数和全局工具

import { formatExpiry as formatExpiryUtil } from "@/utils/timeUtils.js";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("PasteView");

/**
 * 统一的调试日志输出函数
 * @param {boolean} enableDebug - 是否启用调试开关（来自组件 props 或本地 state）
 * @param {boolean} isDev - 是否为开发环境（import.meta.env.DEV）
 * @param  {...any} args - 要输出的内容
 */
export function debugLog(enableDebug, isDev, ...args) {
  if (!enableDebug) return;
  if (!isDev) return;

  // 统一带上前缀，便于在控制台过滤（还需要本地开启 cloudpaste_debug=paste 或 cloudpaste_debug=1）
  log.debug(...args);
}

/**
 * 文本过期时间格式化封装
 *
 * 说明：
 * - 实际逻辑委托给全局 timeUtils.formatExpiry，保证 admin 视图与 public 视图展示一致
 * - 这里保留一个简单的包装，方便未来在不影响其他调用方的前提下调整展示文案
 *
 * @param {string|null} expiryDateString - 过期时间字符串（UTC ISO）
 * @returns {string}
 */
export function formatExpiry(expiryDateString) {
  return formatExpiryUtil(expiryDateString);
}

/**
 * 根据暗色/亮色模式返回统一的输入框样式类
 * 仅用于 PasteView 编辑/查看页面的表单控件，避免在各组件内重复拼接 class 字符串
 *
 * @param {boolean} darkMode
 * @returns {string}
 */
export function getInputClasses(darkMode) {
  if (darkMode) {
    return "bg-gray-800 border-gray-700 text-gray-100 placeholder-gray-500 focus:ring-primary-500 focus:border-primary-500";
  }
  return "bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:ring-primary-500 focus:border-primary-500";
}
