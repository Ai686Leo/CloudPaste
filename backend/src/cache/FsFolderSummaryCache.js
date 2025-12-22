/**
 * FS 目录摘要缓存（内存缓存）
 * - 用途：缓存“目录大小/目录时间(内容更新时间)”的计算/索引兜底结果，避免重复扫描或重复聚合查询
 * - 说明：这是派生数据，重启进程后会丢失（符合“可选计算 + 内存缓存”的定位）
 */
import { BaseCache } from "./BaseCache.js";
import { normalizePath } from "../storage/fs/utils/PathResolver.js";

class FsFolderSummaryCacheManager extends BaseCache {
  constructor(options = {}) {
    const { maxItems, prunePercentage, defaultTtl } = options;
    super({
      maxItems: maxItems || 500,
      prunePercentage: prunePercentage || 20,
      defaultTtl: defaultTtl || 300,
      name: "FsFolderSummaryCache",
    });
  }

  generateKey(mountId, path) {
    const normalizedPath = normalizePath(path, true);
    const encodedPath = Buffer.from(normalizedPath).toString("base64");
    return `${mountId}:${encodedPath}`;
  }

  getAdditionalCacheData(mountId, path) {
    return {
      normalizedPath: normalizePath(path, true),
      mountId: mountId != null ? String(mountId) : "",
    };
  }

  get(mountId, path) {
    return super.get(mountId, path);
  }

  set(mountId, path, data, ttlSeconds) {
    super.set(data, ttlSeconds, mountId, path);
  }

  invalidate(mountId, path) {
    const deleted = super.invalidate(mountId, path);
    if (deleted) {
      console.log(`目录摘要缓存已失效 - 挂载点:${mountId}, 路径:${path}`);
    }
    return deleted;
  }

  invalidatePathAndAncestors(mountId, path) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    let currentPath = normalizedPath;
    let count = 0;

    if (this.invalidate(mountId, currentPath)) {
      count++;
    }

    while (currentPath !== "/" && currentPath.includes("/")) {
      currentPath = currentPath.substring(0, currentPath.lastIndexOf("/"));
      if (currentPath === "") currentPath = "/";

      if (this.invalidate(mountId, currentPath)) {
        count++;
      }

      if (currentPath === "/") break;
    }

    if (count > 0) {
      console.log(`目录摘要路径及父路径缓存已失效 - 挂载点:${mountId}, 路径:${path}, 删除项:${count}`);
    }

    return count;
  }

  invalidatePathTree(mountId, path) {
    if (!mountId) return 0;

    const normalizedPrefix = normalizePath(path, true);
    if (normalizedPrefix === "/") {
      return this.invalidateMount(mountId);
    }

    const decodePathFromKey = (key) => {
      if (typeof key !== "string") return null;
      const idx = key.indexOf(":");
      if (idx <= 0) return null;
      const encoded = key.slice(idx + 1);
      if (!encoded) return null;
      try {
        return Buffer.from(encoded, "base64").toString("utf8");
      } catch (_) {
        return null;
      }
    };

    let clearedCount = 0;
    for (const [key, item] of this.cache.entries()) {
      if (!key.startsWith(`${mountId}:`)) continue;
      const cachedPath = typeof item?.normalizedPath === "string" && item.normalizedPath
        ? item.normalizedPath
        : decodePathFromKey(key);
      if (typeof cachedPath !== "string" || cachedPath.length === 0) continue;
      if (cachedPath === normalizedPrefix || cachedPath.startsWith(normalizedPrefix)) {
        this.cache.delete(key);
        clearedCount++;
      }
    }

    if (clearedCount > 0) {
      this.stats.invalidations += clearedCount;
      console.log(`目录摘要子树缓存已失效 - 挂载点:${mountId}, 路径:${path}, 删除项:${clearedCount}`);
    }

    return clearedCount;
  }

  invalidateMount(mountId) {
    let clearedCount = 0;
    for (const [key] of this.cache.entries()) {
      if (key.startsWith(`${mountId}:`)) {
        this.cache.delete(key);
        clearedCount++;
      }
    }

    if (clearedCount > 0) {
      this.stats.invalidations += clearedCount;
      console.log(`目录摘要挂载点缓存已失效 - 挂载点:${mountId}, 删除项:${clearedCount}`);
    }

    return clearedCount;
  }
}

export { FsFolderSummaryCacheManager };
export const fsFolderSummaryCacheManager = new FsFolderSummaryCacheManager();
