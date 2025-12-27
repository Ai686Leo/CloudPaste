/**
 * CloudPaste Notivue 主题配置
 * 基于 pastelTheme，仅自定义颜色
 */

import { pastelTheme, darkTheme } from "notivue";

/**
 * 亮色主题 - 基于 pastel
 */
export const cloudPasteLightTheme = {
  ...pastelTheme,

  // ===== Success - 绿色系 =====
  "--nv-success-accent": "#10b981",
  "--nv-success-border": "#d1fae5",

  // ===== Error - 红色系 =====
  "--nv-error-accent": "#dc2626",
  "--nv-error-border": "#fecaca",

  // ===== Warning - 黄色系 =====
  "--nv-warning-accent": "#f59e0b",
  "--nv-warning-border": "#fde68a",

  // ===== Info - 蓝色系 =====
  "--nv-info-accent": "#3b82f6",
  "--nv-info-border": "#bfdbfe",

  // ===== Promise/Loading - 紫色系 =====
  "--nv-promise-accent": "#8b5cf6",
  "--nv-promise-border": "#ddd6fe",
};

/**
 * 暗色主题 - 仅颜色自定义
 */
export const cloudPasteDarkTheme = {
  ...darkTheme,

  // ===== 暗色背景适配 =====
  "--nv-global-bg": "#1f2937",
  "--nv-global-fg": "#f3f4f6",
  "--nv-global-border": "#374151",

  // ===== Success - 绿色系 =====
  "--nv-success-accent": "#34d399",
  "--nv-success-bg": "#1f2937",
  "--nv-success-fg": "#f3f4f6",
  "--nv-success-border": "#065f46",

  // ===== Error - 红色系 =====
  "--nv-error-accent": "#f87171",
  "--nv-error-bg": "#1f2937",
  "--nv-error-fg": "#f3f4f6",
  "--nv-error-border": "#991b1b",

  // ===== Warning - 黄色系 =====
  "--nv-warning-accent": "#fbbf24",
  "--nv-warning-bg": "#1f2937",
  "--nv-warning-fg": "#f3f4f6",
  "--nv-warning-border": "#92400e",

  // ===== Info - 蓝色系 =====
  "--nv-info-accent": "#60a5fa",
  "--nv-info-bg": "#1f2937",
  "--nv-info-fg": "#f3f4f6",
  "--nv-info-border": "#1e40af",

  // ===== Promise/Loading - 紫色系 =====
  "--nv-promise-accent": "#a78bfa",
  "--nv-promise-bg": "#1f2937",
  "--nv-promise-fg": "#f3f4f6",
  "--nv-promise-border": "#5b21b6",
};
