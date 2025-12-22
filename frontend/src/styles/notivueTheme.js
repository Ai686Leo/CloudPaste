/**
 * CloudPaste Notivue 主题配置
 *
 */

import { lightTheme, darkTheme } from "notivue";

/**
 * 亮色主题
 */
export const cloudPasteLightTheme = {
  ...lightTheme,

  // ===== 布局 =====
  "--nv-width": "380px",
  "--nv-min-width": "320px",
  "--nv-spacing": "16px",
  "--nv-y-align": "flex-start",
  "--nv-y-align-has-title": "flex-start",
  "--nv-radius": "8px", // radius.md
  "--nv-border-width": "1px",
  "--nv-icon-size": "20px",
  "--nv-title-size": "14px",
  "--nv-message-size": "14px",
  "--nv-shadow": "0 4px 12px rgba(0, 0, 0, 0.1)", // elevation[2]
  "--nv-tip-width": "0px", // 不使用左侧色条
  "--nv-progress-height": "3px",

  // ===== 全局颜色 =====
  "--nv-global-bg": "#ffffff", // surface
  "--nv-global-fg": "#111827", // gray-900
  "--nv-global-border": "#e5e7eb", // gray-200

  // ===== Success - 绿色系 =====
  "--nv-success-accent": "#10b981", // emerald-500
  "--nv-success-bg": "#ffffff",
  "--nv-success-fg": "#111827",
  "--nv-success-border": "#d1fae5", // emerald-100

  // ===== Error - 红色系 =====
  "--nv-error-accent": "#dc2626", // red-600
  "--nv-error-bg": "#ffffff",
  "--nv-error-fg": "#111827",
  "--nv-error-border": "#fecaca", // red-200

  // ===== Warning - 黄色系 =====
  "--nv-warning-accent": "#f59e0b", // amber-500
  "--nv-warning-bg": "#ffffff",
  "--nv-warning-fg": "#111827",
  "--nv-warning-border": "#fde68a", // amber-200

  // ===== Info - 蓝色系 (主色调) =====
  "--nv-info-accent": "#3b82f6", // blue-500 (primary)
  "--nv-info-bg": "#ffffff",
  "--nv-info-fg": "#111827",
  "--nv-info-border": "#bfdbfe", // blue-200

  // ===== Promise/Loading - 紫色系 =====
  "--nv-promise-accent": "#8b5cf6", // violet-500 (secondary)
  "--nv-promise-bg": "#ffffff",
  "--nv-promise-fg": "#111827",
  "--nv-promise-border": "#ddd6fe", // violet-200
};

/**
 * 暗色主题
 */
export const cloudPasteDarkTheme = {
  ...darkTheme,

  // ===== 布局 =====
  "--nv-width": "380px",
  "--nv-min-width": "320px",
  "--nv-spacing": "16px",
  "--nv-y-align": "flex-start",
  "--nv-y-align-has-title": "flex-start",
  "--nv-radius": "8px",
  "--nv-border-width": "1px",
  "--nv-icon-size": "20px",
  "--nv-title-size": "14px",
  "--nv-message-size": "14px",
  "--nv-shadow": "0 4px 12px rgba(0, 0, 0, 0.32)", // elevationDark[2]
  "--nv-tip-width": "0px",
  "--nv-progress-height": "3px",

  // ===== 全局颜色 =====
  "--nv-global-bg": "#1f2937", // gray-800 (surface dark)
  "--nv-global-fg": "#f3f4f6", // gray-100
  "--nv-global-border": "#374151", // gray-700

  // ===== Success - 绿色系 =====
  "--nv-success-accent": "#34d399", // emerald-400
  "--nv-success-bg": "#1f2937",
  "--nv-success-fg": "#f3f4f6",
  "--nv-success-border": "#065f46", // emerald-800

  // ===== Error - 红色系 =====
  "--nv-error-accent": "#f87171", // red-400
  "--nv-error-bg": "#1f2937",
  "--nv-error-fg": "#f3f4f6",
  "--nv-error-border": "#991b1b", // red-800

  // ===== Warning - 黄色系 =====
  "--nv-warning-accent": "#fbbf24", // amber-400
  "--nv-warning-bg": "#1f2937",
  "--nv-warning-fg": "#f3f4f6",
  "--nv-warning-border": "#92400e", // amber-800

  // ===== Info - 蓝色系 (主色调) =====
  "--nv-info-accent": "#60a5fa", // blue-400
  "--nv-info-bg": "#1f2937",
  "--nv-info-fg": "#f3f4f6",
  "--nv-info-border": "#1e40af", // blue-800

  // ===== Promise/Loading - 紫色系 =====
  "--nv-promise-accent": "#a78bfa", // violet-400
  "--nv-promise-bg": "#1f2937",
  "--nv-promise-fg": "#f3f4f6",
  "--nv-promise-border": "#5b21b6", // violet-800
};
