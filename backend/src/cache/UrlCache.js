/**
 * 通用预签名/公共URL缓存管理器
 */
import { BaseCache } from "./BaseCache.js";
import { ValidationError } from "../http/errors.js";

class UrlCacheManager extends BaseCache {
  constructor(options = {}) {
    super({
      maxItems: options.maxItems || 1000,
      prunePercentage: options.prunePercentage || 20,
      defaultTtl: options.defaultTtl || 3600,
      name: "UrlCache",
      ...options,
    });
    this.config = {
      customHostTtl: options.customHostTtl || 86400 * 7,
    };

    // - 通过版本号让旧缓存自动失效（不需要手动清缓存）
    this.keyVersion = options.keyVersion || "v3";
  }

  generateKey(storageConfigId, storagePath, forceDownload, userType, userId) {
    if (!storageConfigId || !storagePath || !userType || !userId) {
      throw new ValidationError(`缓存键生成失败：缺少必要参数 storageConfigId=${storageConfigId}, storagePath=${storagePath}, userType=${userType}, userId=${userId}`);
    }
    const userScope = `${userType}:${userId}`;
    const downloadFlag = forceDownload ? "dl" : "pv";
    const encodedPath = Buffer.from(storagePath).toString("base64");
    return `url:${this.keyVersion}:${storageConfigId}:${userScope}:${downloadFlag}:${encodedPath}`;
  }

  get(storageConfigId, storagePath, forceDownload, userType, userId) {
    try {
      const key = this.generateKey(storageConfigId, storagePath, forceDownload, userType, userId);
      const cacheItem = this.cache.get(key);
      if (!cacheItem) {
        this.stats.misses++;
        return null;
      }
      if (Date.now() > cacheItem.expiresAt) {
        this.cache.delete(key);
        this.stats.expired++;
        return null;
      }
      cacheItem.lastAccessed = Date.now();
      this.cache.set(key, cacheItem);
      this.stats.hits++;
      return cacheItem.url;
    } catch (error) {
      console.warn("URL缓存获取失败:", error.message);
      this.stats.misses++;
      return null;
    }
  }

  set(storageConfigId, storagePath, forceDownload, userType, userId, url, storageConfig) {
    try {
      const key = this.generateKey(storageConfigId, storagePath, forceDownload, userType, userId);
      const now = Date.now();
      let ttl;
      const isCustomHostPreview = storageConfig?.custom_host && !forceDownload;
      if (isCustomHostPreview) {
        ttl = this.config.customHostTtl;
      } else {
        const configTtl = storageConfig?.signature_expires_in || this.config.defaultTtl;
        ttl = Math.floor(configTtl * 0.9);
      }
      const expiresAt = now + ttl * 1000;
      this.checkSizeAndPrune();
      this.cache.set(key, {
        url,
        expiresAt,
        lastAccessed: now,
        storageConfigId,
        userType,
        userId,
        isCustomHost: isCustomHostPreview,
      });
    } catch (error) {
      console.warn("URL缓存设置失败:", error.message);
    }
  }

  invalidateStorageConfig(storageConfigId) {
    let clearedCount = 0;
    for (const [key, item] of this.cache.entries()) {
      if (item.storageConfigId === storageConfigId) {
        this.cache.delete(key);
        clearedCount++;
      }
    }
    this.stats.invalidations += clearedCount;
    return clearedCount;
  }
}

const urlCacheManager = new UrlCacheManager();

export async function clearUrlCache(options = {}) {
  const { storageConfigId, userType, userId } = options;
  let totalCleared = 0;
  try {
    if (storageConfigId) {
      totalCleared = urlCacheManager.invalidateStorageConfig(storageConfigId);
      console.log(`已清理存储配置 ${storageConfigId} 的URL缓存，共 ${totalCleared} 项`);
    } else if (userType && userId) {
      for (const [key, item] of urlCacheManager.cache.entries()) {
        if (item.userType === userType && item.userId === userId) {
          urlCacheManager.cache.delete(key);
          totalCleared++;
        }
      }
      urlCacheManager.stats.invalidations += totalCleared;
      console.log(`已清理用户 ${userType}:${userId} 的URL缓存，共 ${totalCleared} 项`);
    } else {
      totalCleared = urlCacheManager.invalidateAll();
      console.log(`已清理所有URL缓存，共 ${totalCleared} 项`);
    }
    return totalCleared;
  } catch (error) {
    console.error("清理URL缓存时出错:", error);
    return 0;
  }
}

export { urlCacheManager, UrlCacheManager };
