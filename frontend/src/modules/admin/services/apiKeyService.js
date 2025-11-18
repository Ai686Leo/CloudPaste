import { api } from "@/api";

/**
 * Admin API Key 管理 Service
 *
 * - 封装 API Key 的增删改查
 *
 * 约定：
 * - 成功：返回领域数据（列表 / 单个密钥 / true）
 * - 失败：抛出 Error，由上层统一处理
 */
export function useAdminApiKeyService() {
  /**
   * 获取全部 API 密钥列表
   * @returns {Promise<Array>} API 密钥数组
   */
  const getAllApiKeys = async () => {
    const resp = await api.admin.getAllApiKeys();
    if (!resp) {
      throw new Error("获取 API 密钥列表失败");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "获取 API 密钥列表失败");
      }
      return Array.isArray(resp.data) ? resp.data : [];
    }

    if (Array.isArray(resp)) {
      return resp;
    }
    if (Array.isArray(resp.data)) {
      return resp.data;
    }

    return [];
  };

  /**
   * 删除单个 API 密钥
   * @param {string|number} id
   * @returns {Promise<true>}
   */
  const deleteApiKey = async (id) => {
    const resp = await api.admin.deleteApiKey(id);
    if (!resp) {
      throw new Error("删除 API 密钥失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "删除 API 密钥失败");
      }
    }
    return true;
  };

  /**
   * 更新 API 密钥
   * @param {string|number} id
   * @param {Object} data
   * @returns {Promise<Object>} 更新后的密钥对象
   */
  const updateApiKey = async (id, data) => {
    const resp = await api.admin.updateApiKey(id, data);
    if (!resp) {
      throw new Error("更新 API 密钥失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "更新 API 密钥失败");
      }
      return resp.data ?? { id, ...data };
    }
    return resp;
  };

  /**
   * 创建 API 密钥
   * @returns {Promise<Object>} 新建的密钥对象
   */
  const createApiKey = async (name, expiresAt, permissionsBitFlag, keyType, customKeyValue, basicPath, readOnly = false) => {
    const resp = await api.admin.createApiKey(name, expiresAt, permissionsBitFlag, keyType, customKeyValue, basicPath, readOnly);
    if (!resp) {
      throw new Error("创建 API 密钥失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "创建 API 密钥失败");
      }
      return resp.data ?? resp;
    }
    return resp;
  };

  /**
   * 获取指定 API 密钥的存储 ACL（storage_config_id 列表）
   * @param {string} id - API 密钥 ID
   * @returns {Promise<string[]>}
   */
  const getApiKeyStorageAcl = async (id) => {
    const resp = await api.admin.getApiKeyStorageAcl(id);
    if (!resp) {
      throw new Error("获取存储 ACL 失败");
    }

    let payload = resp;
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "获取存储 ACL 失败");
      }
      payload = resp.data ?? resp;
    }

    const ids = payload?.storage_config_ids ?? payload?.storageConfigIds ?? [];
    return Array.isArray(ids) ? ids : [];
  };

  /**
   * 更新指定 API 密钥的存储 ACL（整体替换）
   * @param {string} id - API 密钥 ID
   * @param {string[]} storageConfigIds - 允许访问的 storage_config_id 列表
   * @returns {Promise<string[]>} 更新后的 storage_config_id 列表
   */
  const updateApiKeyStorageAcl = async (id, storageConfigIds) => {
    const resp = await api.admin.updateApiKeyStorageAcl(id, storageConfigIds);
    if (!resp) {
      throw new Error("更新存储 ACL 失败");
    }

    let payload = resp;
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "更新存储 ACL 失败");
      }
      payload = resp.data ?? resp;
    }

    const ids = payload?.storage_config_ids ?? payload?.storageConfigIds ?? [];
    return Array.isArray(ids) ? ids : [];
  };

  return {
    getAllApiKeys,
    deleteApiKey,
    updateApiKey,
    createApiKey,
    getApiKeyStorageAcl,
    updateApiKeyStorageAcl,
  };
}
