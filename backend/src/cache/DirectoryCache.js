/**
 * 目录缓存管理器 - 基于BaseCache的目录列表缓存实现
 * 提供目录列表的缓存功能，用于提高频繁访问目录的性能
 */
import { BaseCache } from "./BaseCache.js";
import { normalizePath } from "../storage/fs/utils/PathResolver.js";

class DirectoryCacheManager extends BaseCache {
  /**
   * 构造函数
   * @param {Object} options - 配置选项
   * @param {number} options.maxItems - 最大缓存项数量，默认为300
   * @param {number} options.prunePercentage - 清理时删除的缓存项百分比，默认为20%
   */
  constructor(options = {}) {
    const { maxItems, prunePercentage, defaultTtl } = options;
    super({
      maxItems: maxItems || 300,
      prunePercentage: prunePercentage || 20,
      defaultTtl: defaultTtl || 300,
      name: "DirectoryCache",
    });
  }

  /**
   * 生成安全的缓存键 - 重写基类方法
   * @param {string} mountId - 挂载点ID
   * @param {string} path - 目录路径
   * @returns {string} - 缓存键
   */
  generateKey(mountId, path) {
    // 规范化路径：确保目录路径的一致性
    // 对于目录缓存，统一将路径规范化为目录格式（以/结尾）
    const normalizedPath = normalizePath(path, true);

    // 使用 Base64 编码路径，避免特殊字符问题
    const encodedPath = Buffer.from(normalizedPath).toString("base64");
    return `${mountId}:${encodedPath}`;
  }

  /**
   * 获取缓存的目录列表 - 使用基类方法
   * @param {string} mountId - 挂载点ID
   * @param {string} path - 目录路径
   * @returns {Object|null} - 缓存的目录列表，如果缓存未命中则返回null
   */
  get(mountId, path) {
    return super.get(mountId, path);
  }

  /**
   * 设置目录列表缓存 - 保持原有参数顺序，内部调用基类方法
   * @param {string} mountId - 挂载点ID
   * @param {string} path - 目录路径
   * @param {Object} data - 要缓存的目录列表数据
   * @param {number} ttlSeconds - 缓存的生存时间（秒）
   */
  set(mountId, path, data, ttlSeconds) {
    // 保持原有参数顺序，内部调用基类方法时调整参数顺序
    super.set(data, ttlSeconds, mountId, path);
  }

  /**
   * 使指定目录的缓存失效 - 使用基类方法
   * @param {string} mountId - 挂载点ID
   * @param {string} path - 目录路径
   * @returns {boolean} - 如果缓存项存在并被删除则返回true，否则返回false
   */
  invalidate(mountId, path) {
    const deleted = super.invalidate(mountId, path);
    if (deleted) {
      console.log(`目录缓存已失效 - 挂载点:${mountId}, 路径:${path}`);
    }
    return deleted;
  }

  /**
   * 使指定路径及其所有父路径的缓存失效
   * 例如: 对于路径 /a/b/c，会使 /a/b/c、/a/b 和 /a 的缓存失效
   * @param {string} mountId - 挂载点ID
   * @param {string} path - 目录路径
   * @returns {number} - 被删除的缓存项数量
   */
  invalidatePathAndAncestors(mountId, path) {
    // 确保路径格式标准化
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    let currentPath = normalizedPath;
    let count = 0;

    // 清除当前路径的缓存
    if (this.invalidate(mountId, currentPath)) {
      count++;
    }

    // 逐级向上清除父路径的缓存
    while (currentPath !== "/" && currentPath.includes("/")) {
      // 获取父路径
      currentPath = currentPath.substring(0, currentPath.lastIndexOf("/"));
      if (currentPath === "") currentPath = "/";

      // 清除父路径的缓存
      if (this.invalidate(mountId, currentPath)) {
        count++;
      }

      // 如果已经到达根路径，停止循环
      if (currentPath === "/") break;
    }

    if (count > 0) {
      console.log(`路径及父路径缓存已失效 - 挂载点:${mountId}, 路径:${path}, 删除项:${count}`);
    }

    return count;
  }

  /**
   * 清理指定挂载点的所有缓存
   * @param {string} mountId - 挂载点ID
   * @returns {number} 清理的缓存项数量
   */
  invalidateMount(mountId) {
    let clearedCount = 0;

    // 遍历所有缓存项，删除匹配挂载点的项
    for (const [key, item] of this.cache.entries()) {
      // 缓存键格式：mountId:encodedPath
      if (key.startsWith(`${mountId}:`)) {
        this.cache.delete(key);
        clearedCount++;
      }
    }

    if (clearedCount > 0) {
      this.stats.invalidations += clearedCount;
      console.log(`挂载点缓存已失效 - 挂载点:${mountId}, 删除项:${clearedCount}`);
    }

    return clearedCount;
  }

  // prune() 和 getStats() 方法已由基类提供，无需重复实现
}

// 创建单例实例
const directoryCacheManager = new DirectoryCacheManager();

/**
 * 统一的缓存清理函数 - 可根据挂载点ID或S3配置ID清理缓存
 * @param {Object} options - 清理选项
 * @param {string} [options.mountId] - 要清理的挂载点ID
 * @param {D1Database} [options.db] - 数据库连接（当使用storageConfigId时必需）
 * @param {string} [options.storageConfigId] - 存储配置ID，将清理所有关联的挂载点
 * @returns {Promise<number>} 清除的缓存项数量
 */
// 导出单例实例和类 (单例用于实际应用，类用于测试和特殊场景)
export { directoryCacheManager, DirectoryCacheManager };
