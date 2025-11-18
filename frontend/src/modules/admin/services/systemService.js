import { api } from "@/api";

/**
 * Admin 系统相关 Service
 *
 * - 统一封装所有 api.system 相关调用
 * - 为 settings / dashboard 等视图提供数据访问接口
 *
 * 约定：
 * - 成功返回“领域数据”（数组 / 对象 / 布尔）
 * - 失败抛出 Error，由调用方统一处理
 */
export function useAdminSystemService() {
  /**
   * 按分组获取系统设置
   *
   * @param {number} groupId 分组 ID
   * @param {boolean} [includeSecrets=true] 是否包含敏感字段
   * @returns {Promise<Array<{key:string,value:string}>>}
   */
  const getSettingsByGroup = async (groupId, includeSecrets = true) => {
    const resp = await api.system.getSettingsByGroup(groupId, includeSecrets);
    if (!resp) {
      throw new Error("获取系统设置失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "获取系统设置失败");
      }
      return Array.isArray(resp.data) ? resp.data : [];
    }
    return Array.isArray(resp) ? resp : [];
  };

  /**
   * 按分组批量更新系统设置
   *
   * @param {number} groupId 分组 ID
   * @param {Object} data 设置键值对
   * @param {boolean} [includeSecrets] 是否包含敏感字段
   * @returns {Promise<void>}
   */
  const updateGroupSettings = async (groupId, data, includeSecrets) => {
    const resp = await api.system.updateGroupSettings(groupId, data, includeSecrets);
    if (!resp) {
      throw new Error("更新系统设置失败");
    }
    if (typeof resp === "object" && "success" in resp && !resp.success) {
      throw new Error(resp.message || "更新系统设置失败");
    }
  };

  /**
   * 获取缓存统计信息
   * @returns {Promise<Object>} cache 统计对象
   */
  const getCacheStats = async () => {
    const resp = await api.system.getCacheStats();
    if (!resp) {
      throw new Error("获取缓存统计信息失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "获取缓存统计信息失败");
      }
      return resp.data ?? {};
    }
    return resp;
  };

  /**
   * 获取系统版本与环境信息
   * @returns {Promise<Object>} version 信息对象
   */
  const getVersionInfo = async () => {
    const resp = await api.system.getVersionInfo();
    if (!resp) {
      throw new Error("获取版本信息失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "获取版本信息失败");
      }
      return resp.data ?? {};
    }
    return resp;
  };

  /**
   * 清理缓存（无参数 = 清理全部缓存）
   * @returns {Promise<Object>} 清理结果（用于展示统计）
   */
  const clearCache = async () => {
    const resp = await api.admin.clearCache();
    if (!resp) {
      throw new Error("清理缓存失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "清理缓存失败");
      }
      return resp.data ?? {};
    }
    return resp;
  };

  /**
   * Global Settings（分组 ID = 1）
   */
  const getGlobalSettings = () => getSettingsByGroup(1, true);
  const updateGlobalSettings = (data) => updateGroupSettings(1, data, true);

  /**
   * Preview Settings（分组 ID = 2）
   */
  const getPreviewSettings = () => getSettingsByGroup(2, true);
  const updatePreviewSettings = (data) => updateGroupSettings(2, data, true);

  /**
   * WebDAV Settings（分组 ID = 3）
   */
  const getWebdavSettings = () => getSettingsByGroup(3, true);
  const updateWebdavSettings = (data) => updateGroupSettings(3, data, true);

  /**
   * Site Settings（分组 ID = 4）
   */
  const getSiteSettings = () => getSettingsByGroup(4, true);
  const updateSiteSettings = (data) => updateGroupSettings(4, data);

  return {
    getSettingsByGroup,
    updateGroupSettings,
    getCacheStats,
    getVersionInfo,
    clearCache,
    getGlobalSettings,
    updateGlobalSettings,
    getPreviewSettings,
    updatePreviewSettings,
    getWebdavSettings,
    updateWebdavSettings,
    getSiteSettings,
    updateSiteSettings,
  };
}
