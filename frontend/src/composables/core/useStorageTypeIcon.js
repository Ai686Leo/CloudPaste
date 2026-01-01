/**
 * 存储类型图标 Composable
 * 统一管理所有存储类型的图标、颜色和背景样式
 */
import {
  IconStorageS3,
  IconStorageOneDrive,
  IconStorageGoogleDrive,
  IconStorageGitHub,
  IconStorageWebDAV,
  IconStorageLocal,
  IconStorageTelegram,
  IconStorageDiscord,
  IconStorageHuggingFace,
  IconStorageMirror,
} from "@/components/icons";

/**
 * 存储类型配置映射
 * 集中定义每种存储类型的图标和样式
 */
const STORAGE_TYPE_CONFIG = {
  S3: {
    icon: IconStorageS3,
    lightColor: "text-orange-600",
    darkColor: "text-orange-400",
    lightBg: "bg-orange-100",
    darkBg: "bg-orange-900/30",
  },
  ONEDRIVE: {
    icon: IconStorageOneDrive,
    lightColor: "text-sky-600",
    darkColor: "text-sky-400",
    lightBg: "bg-sky-100",
    darkBg: "bg-sky-900/30",
  },
  GOOGLE_DRIVE: {
    icon: IconStorageGoogleDrive,
    lightColor: "text-red-600",
    darkColor: "text-red-400",
    lightBg: "bg-red-100",
    darkBg: "bg-red-900/30",
  },
  GITHUB_RELEASES: {
    icon: IconStorageGitHub,
    lightColor: "text-gray-700",
    darkColor: "text-gray-300",
    lightBg: "bg-gray-100",
    darkBg: "bg-gray-700",
  },
  GITHUB_API: {
    icon: IconStorageGitHub,
    lightColor: "text-gray-700",
    darkColor: "text-gray-300",
    lightBg: "bg-gray-100",
    darkBg: "bg-gray-700",
  },
  WEBDAV: {
    icon: IconStorageWebDAV,
    lightColor: "text-blue-600",
    darkColor: "text-blue-400",
    lightBg: "bg-blue-100",
    darkBg: "bg-blue-900/30",
  },
  LOCAL: {
    icon: IconStorageLocal,
    lightColor: "text-gray-600",
    darkColor: "text-gray-300",
    lightBg: "bg-gray-100",
    darkBg: "bg-gray-700",
  },
  TELEGRAM: {
    icon: IconStorageTelegram,
    lightColor: "text-sky-500",
    darkColor: "text-sky-400",
    lightBg: "bg-sky-100",
    darkBg: "bg-sky-900/30",
  },
  DISCORD: {
    icon: IconStorageDiscord,
    lightColor: "text-indigo-600",
    darkColor: "text-indigo-400",
    lightBg: "bg-indigo-100",
    darkBg: "bg-indigo-900/30",
  },
  HUGGINGFACE_DATASETS: {
    icon: IconStorageHuggingFace,
    lightColor: "text-yellow-600",
    darkColor: "text-yellow-400",
    lightBg: "bg-yellow-100",
    darkBg: "bg-yellow-900/30",
  },
  MIRROR: {
    icon: IconStorageMirror,
    lightColor: "text-purple-600",
    darkColor: "text-purple-400",
    lightBg: "bg-purple-100",
    darkBg: "bg-purple-900/30",
  },
};

// 默认配置（未知类型）
const DEFAULT_CONFIG = {
  icon: IconStorageS3,
  lightColor: "text-gray-600",
  darkColor: "text-gray-400",
  lightBg: "bg-gray-100",
  darkBg: "bg-gray-700",
};

/**
 * 获取存储类型配置
 * @param {string} storageType - 存储类型
 * @returns {Object} 配置对象
 */
function getConfig(storageType) {
  const type = storageType?.toUpperCase();
  return STORAGE_TYPE_CONFIG[type] || DEFAULT_CONFIG;
}

/**
 * 存储类型图标 Composable
 * @returns {Object} 包含图标和样式获取函数的对象
 */
export function useStorageTypeIcon() {
  /**
   * 获取存储类型图标组件
   * @param {string} storageType - 存储类型
   * @returns {Component} Vue 图标组件
   */
  function getStorageTypeIcon(storageType) {
    return getConfig(storageType).icon;
  }

  /**
   * 获取存储类型图标颜色类
   * @param {string} storageType - 存储类型
   * @param {boolean} isDarkMode - 是否深色模式
   * @returns {string} Tailwind CSS 颜色类
   */
  function getStorageTypeIconClass(storageType, isDarkMode) {
    const config = getConfig(storageType);
    return isDarkMode ? config.darkColor : config.lightColor;
  }

  /**
   * 获取存储类型背景色类
   * @param {string} storageType - 存储类型
   * @param {boolean} isDarkMode - 是否深色模式
   * @returns {string} Tailwind CSS 背景色类
   */
  function getStorageTypeBgClass(storageType, isDarkMode) {
    const config = getConfig(storageType);
    return isDarkMode ? config.darkBg : config.lightBg;
  }

  /**
   * 获取存储类型完整样式配置
   * @param {string} storageType - 存储类型
   * @param {boolean} isDarkMode - 是否深色模式
   * @returns {Object} 包含 icon, colorClass, bgClass 的对象
   */
  function getStorageTypeStyle(storageType, isDarkMode) {
    const config = getConfig(storageType);
    return {
      icon: config.icon,
      colorClass: isDarkMode ? config.darkColor : config.lightColor,
      bgClass: isDarkMode ? config.darkBg : config.lightBg,
    };
  }

  return {
    getStorageTypeIcon,
    getStorageTypeIconClass,
    getStorageTypeBgClass,
    getStorageTypeStyle,
  };
}

export default useStorageTypeIcon;
