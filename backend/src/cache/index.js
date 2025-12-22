/**
 * 缓存模块统一导出
 * 提供所有缓存相关类和实例的统一入口
 */
import "./cacheListeners.js";
// ==================== 基础缓存类 ====================
export { BaseCache } from "./BaseCache.js";

// ==================== 目录缓存 ====================
export { DirectoryCacheManager, directoryCacheManager } from "./DirectoryCache.js";

// ==================== URL缓存 ====================
export { UrlCacheManager, urlCacheManager, clearUrlCache } from "./UrlCache.js";

// ==================== 搜索缓存 ====================
export { SearchCacheManager, searchCacheManager, clearSearchCache } from "./SearchCache.js";

// ==================== FS 目录摘要缓存 ====================
export { FsFolderSummaryCacheManager, fsFolderSummaryCacheManager } from "./FsFolderSummaryCache.js";

// ==================== 预览设置缓存 ====================
export { PreviewSettingsCache, previewSettingsCache } from "./PreviewSettingsCache.js";

// ==================== 兼容导出 ====================
// 兼容的默认导出
export { default as previewSettingsCacheDefault } from "./PreviewSettingsCache.js";

// ==================== 事件总线与状态 ====================
export { default as cacheBus, CACHE_EVENTS } from "./cacheBus.js";
export { getMountsVersion, bumpMountsVersion } from "./cacheState.js";
export { invalidateFsCache, invalidatePreviewCache, invalidateAllCaches } from "./invalidation.js";
