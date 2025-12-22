import cacheBus, { CACHE_EVENTS } from "./cacheBus.js";
import { directoryCacheManager } from "./DirectoryCache.js";
import { fsFolderSummaryCacheManager } from "./FsFolderSummaryCache.js";
import { clearUrlCache } from "./UrlCache.js";
import { clearSearchCache } from "./SearchCache.js";
import { previewSettingsCache } from "./PreviewSettingsCache.js";
import { bumpMountsVersion } from "./cacheState.js";

const logEvent = (message, payload) => {
  try {
    const safePayload = JSON.stringify(payload ?? {});
    console.log(`[cacheBus] ${message} -> ${safePayload}`);
  } catch (error) {
    console.log(`[cacheBus] ${message}`);
  }
};

const invalidateDirectoryCache = ({ mountId, paths = [], dirPaths = [] }) => {
  if (!mountId) {
    return;
  }

  if (!paths.length) {
    directoryCacheManager.invalidateMount(mountId);
    fsFolderSummaryCacheManager.invalidateMount(mountId);
    return;
  }

  // 目录级变更（例如删除目录/移动目录/重命名目录）需要清理子树缓存，避免“已删除目录”仍命中旧缓存。
  for (const dirPath of dirPaths) {
    if (typeof dirPath === "string" && dirPath.length > 0) {
      directoryCacheManager.invalidatePathTree(mountId, dirPath);
      fsFolderSummaryCacheManager.invalidatePathTree(mountId, dirPath);
    }
  }

  for (const path of paths) {
    if (typeof path === "string" && path.length > 0) {
      directoryCacheManager.invalidatePathAndAncestors(mountId, path);
      fsFolderSummaryCacheManager.invalidatePathAndAncestors(mountId, path);
    }
  }
};

const resolveMountsByStorageConfig = async (db, storageConfigId) => {
  if (!db || !storageConfigId) {
    return [];
  }

  try {
    const result = await db
      .prepare(
        `SELECT id FROM storage_mounts
         WHERE storage_type = 'S3' AND storage_config_id = ?`
      )
      .bind(storageConfigId)
      .all();
    return result?.results?.map((row) => row.id).filter(Boolean) ?? [];
  } catch (error) {
    console.warn("resolveMountsByS3Config failed", error);
    return [];
  }
};

cacheBus.on(CACHE_EVENTS.INVALIDATE, async (payload = {}) => {
  try {
    const {
      target = "fs",
      mountId = null,
      paths = [],
      dirPaths = [],
      storageConfigId = null,
      userType = null,
      userId = null,
      reason = "unknown",
      invalidateAll = false,
      bumpMountsVersion: shouldBumpVersion = false,
      db = null,
    } = payload;

    if (shouldBumpVersion) {
      bumpMountsVersion();
    }

    if (invalidateAll) {
      directoryCacheManager.invalidateAll();
      fsFolderSummaryCacheManager.invalidateAll();
      await clearUrlCache();
      clearSearchCache();
      logEvent(`缓存全量失效(原因:${reason})`, payload);
      return;
    }

    if (target === "fs") {
      invalidateDirectoryCache({ mountId, paths, dirPaths });
      if (mountId) {
        clearSearchCache({ mountId });
      }
    }

    if (payload.storageConfigId) {
      const relatedMounts = await resolveMountsByStorageConfig(db, payload.storageConfigId);
      for (const relatedMountId of relatedMounts) {
        invalidateDirectoryCache({ mountId: relatedMountId });
        clearSearchCache({ mountId: relatedMountId });
      }
      await clearUrlCache({ storageConfigId: payload.storageConfigId });
    }

    if (target === "preview") {
      try {
        await previewSettingsCache.refresh(payload.db ?? null);
      } catch (error) {
        console.warn("刷新预览设置缓存失败", error);
      }
    }

    logEvent(`缓存事件已处理(原因:${reason})`, payload);
  } catch (error) {
    console.error("处理缓存事件失败", error);
  }
});
