import { DEFAULT_MAX_UPLOAD_SIZE_MB } from "../constants/index.js";
import { AuthenticationError, RepositoryError } from "../http/errors.js";
import { SETTING_GROUPS } from "../constants/settings.js";
import { ensureRepositoryFactory } from "../utils/repositories.js";
import { previewSettingsCache } from "../cache/index.js";
import { processWeeklyData } from "../utils/common.js";

const resolveRepositoryFactory = ensureRepositoryFactory;

/**
 * 获取最大上传文件大小限制
 * @param {D1Database} db - D1数据库实例
 * @returns {Promise<number>} 最大上传大小(MB)
 */
export async function getMaxUploadSize(db, repositoryFactory) {
  try {
    // 使用 SystemRepository 的新方法
    const factory = resolveRepositoryFactory(db, repositoryFactory);
    const systemRepository = factory.getSystemRepository();

    // 使用 getSettingMetadata 获取最大上传大小设置
    const setting = await systemRepository.getSettingMetadata("max_upload_size");

    // 返回默认值或数据库中的值
    return setting ? parseInt(setting.value) : DEFAULT_MAX_UPLOAD_SIZE_MB;
  } catch (error) {
    console.error("获取最大上传大小错误:", error);
    // 发生错误时返回默认值
    return DEFAULT_MAX_UPLOAD_SIZE_MB;
  }
}

/**
 * 获取仪表盘统计数据
 * @param {D1Database} db - D1数据库实例
 * @param {string} adminId - 管理员ID
 * @returns {Promise<Object>} 仪表盘统计数据
 */
export async function getDashboardStats(db, adminId, repositoryFactory) {
  try {
    if (!adminId) {
      throw new AuthenticationError("未授权");
    }

    // 使用 SystemRepository
    const factory = resolveRepositoryFactory(db, repositoryFactory);
    const systemRepository = factory.getSystemRepository();

    // 获取基础统计数据
    const basicStats = await systemRepository.getDashboardStats();

    // 获取最近一周的趋势数据
    const weeklyTrends = await systemRepository.getWeeklyTrends();

    // 处理每日数据，补全缺失的日期
    const lastWeekPastes = processWeeklyData(weeklyTrends.pastes);
    const lastWeekFiles = processWeeklyData(weeklyTrends.files);

    return {
      totalPastes: basicStats.totalPastes,
      totalFiles: basicStats.totalFiles,
      totalApiKeys: basicStats.totalApiKeys,
      totalStorageConfigs: basicStats.totalStorageConfigs ?? basicStats.totalS3Configs ?? 0,
      lastWeekPastes,
      lastWeekFiles,
    };
  } catch (error) {
    console.error("获取仪表盘统计数据失败:", error);
    if (error.status && error.code) throw error;
    throw new RepositoryError("获取仪表盘统计数据失败", { cause: error?.message });
  }
}

// ==================== 新增：分组设置管理服务方法 ====================

/**
 * 按分组获取设置项
 * @param {D1Database} db - D1数据库实例
 * @param {number} groupId - 分组ID
 * @param {boolean} includeMetadata - 是否包含元数据
 * @returns {Promise<Array>} 设置项列表
 */
export async function getSettingsByGroup(db, groupId, includeMetadata = true, repositoryFactory) {
  try {
    const factory = resolveRepositoryFactory(db, repositoryFactory);
    const systemRepository = factory.getSystemRepository();

    return await systemRepository.getSettingsByGroup(groupId, includeMetadata);
  } catch (error) {
    console.error("按分组获取设置错误:", error);
    if (error.status && error.code) throw error;
    throw new RepositoryError("按分组获取设置失败", { cause: error?.message });
  }
}

/**
 * 获取所有分组的设置项
 * @param {D1Database} db - D1数据库实例
 * @param {boolean} includeSystemGroup - 是否包含系统内部分组
 * @returns {Promise<Object>} 按分组组织的设置项
 */
export async function getAllSettingsByGroups(db, includeSystemGroup = false, repositoryFactory) {
  try {
    const factory = resolveRepositoryFactory(db, repositoryFactory);
    const systemRepository = factory.getSystemRepository();

    return await systemRepository.getAllSettingsByGroups(includeSystemGroup);
  } catch (error) {
    console.error("获取分组设置错误:", error);
    if (error.status && error.code) throw error;
    throw new RepositoryError("获取分组设置失败", { cause: error?.message });
  }
}

/**
 * 获取分组列表和统计信息
 * @param {D1Database} db - D1数据库实例
 * @returns {Promise<Array>} 分组信息列表
 */
export async function getGroupsInfo(db, repositoryFactory) {
  try {
    const factory = resolveRepositoryFactory(db, repositoryFactory);
    const systemRepository = factory.getSystemRepository();

    return await systemRepository.getGroupsInfo();
  } catch (error) {
    console.error("获取分组信息错误:", error);
    if (error.status && error.code) throw error;
    throw new RepositoryError("获取分组信息失败", { cause: error?.message });
  }
}

/**
 * 批量更新分组设置
 * @param {D1Database} db - D1数据库实例
 * @param {number} groupId - 分组ID
 * @param {Object} settings - 设置键值对
 * @param {Object} options - 选项
 * @returns {Promise<Object>} 操作结果
 */
export async function updateGroupSettings(db, groupId, settings, options = {}, repositoryFactory) {
  try {
    const factory = resolveRepositoryFactory(db, repositoryFactory);
    const systemRepository = factory.getSystemRepository();

    const result = await systemRepository.updateGroupSettings(groupId, settings, options);

    // 如果是预览设置分组，刷新预览设置缓存
    if (groupId === SETTING_GROUPS.PREVIEW) {
      try {
        await previewSettingsCache.refresh(db);
        console.log("预览设置缓存已自动刷新");
      } catch (cacheError) {
        console.error("刷新预览设置缓存失败:", cacheError);
        // 缓存刷新失败不影响设置更新的成功
      }
    }

    return result;
  } catch (error) {
    console.error("批量更新分组设置错误:", error);
    if (error.status && error.code) throw error;
    throw new RepositoryError("批量更新分组设置失败", { cause: error?.message });
  }
}

/**
 * 获取设置项元数据
 * @param {D1Database} db - D1数据库实例
 * @param {string} key - 设置键名
 * @returns {Promise<Object|null>} 设置项元数据
 */
export async function getSettingMetadata(db, key, repositoryFactory) {
  try {
    const factory = resolveRepositoryFactory(db, repositoryFactory);
    const systemRepository = factory.getSystemRepository();

    return await systemRepository.getSettingMetadata(key);
  } catch (error) {
    console.error("获取设置元数据错误:", error);
    if (error.status && error.code) throw error;
    throw new RepositoryError("获取设置元数据失败", { cause: error?.message });
  }
}
