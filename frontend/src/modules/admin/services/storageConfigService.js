import { api } from "@/api";

/** @typedef {import("@/types/admin").AdminStorageConfig} AdminStorageConfig */
/** @typedef {import("@/types/api").PaginationInfo} PaginationInfo */

/**
 * Admin 存储配置 Service
 *
 * - 统一封装存储配置相关 API（列表 / 新增 / 更新 / 删除 / 设为默认 / 测试）
 * - 对多种后端返回结构做规范化，前端只看到统一的 DTO
 */
export function useAdminStorageConfigService() {
  /**
   * 获取存储配置列表
   * @param {{page?:number,limit?:number}} [params]
   * @returns {Promise<{items: AdminStorageConfig[], pagination: PaginationInfo}>}
   */
  const getStorageConfigs = async (params = {}) => {
    const resp = await api.admin.getStorageConfigs(params);
    if (!resp) {
      throw new Error("获取存储配置列表失败");
    }

    let payload = resp;
    let total = resp?.total;

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "获取存储配置列表失败");
      }
      payload = resp.data ?? resp;
      if (typeof resp.total === "number") {
        total = resp.total;
      }
    }

    let dataBlock = payload;
    if (!Array.isArray(dataBlock)) {
      dataBlock =
        payload?.data && Array.isArray(payload.data)
          ? payload.data
          : payload?.items && Array.isArray(payload.items)
          ? payload.items
          : payload?.records && Array.isArray(payload.records)
          ? payload.records
          : payload?.data?.items && Array.isArray(payload.data.items)
          ? payload.data.items
          : payload;
    }

    /** @type {AdminStorageConfig[]} */
    const items = Array.isArray(dataBlock) ? dataBlock : [];

    if (typeof total !== "number") {
      total = typeof payload?.total === "number" ? payload.total : items.length;
    }

    const page = typeof params.page === "number" ? params.page : 1;
    const limit = typeof params.limit === "number" ? params.limit : items.length || 10;

    /** @type {PaginationInfo} */
    const pagination = {
      page,
      limit,
      total,
    };

    return {
      items,
      pagination,
    };
  };

  /**
   * 获取存储配置明文/掩码视图
   * @param {number|string} id
   * @param {"masked"|"plain"} mode
   * @returns {Promise<AdminStorageConfig>}
   */
  const getStorageConfigReveal = async (id, mode = "masked") => {
    const resp = await api.storage.getStorageConfigReveal(id, mode);
    if (!resp) {
      throw new Error("获取存储配置详情失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "获取存储配置详情失败");
      }
      return /** @type {AdminStorageConfig} */ (resp.data ?? resp);
    }
    return /** @type {AdminStorageConfig} */ (resp);
  };

  /**
   * 创建存储配置
   * @param {Partial<AdminStorageConfig>} data
   * @returns {Promise<AdminStorageConfig>}
   */
  const createStorageConfig = async (data) => {
    const resp = await api.admin.createStorageConfig(data);
    if (!resp) {
      throw new Error("创建存储配置失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "创建存储配置失败");
      }
      return /** @type {AdminStorageConfig} */ (resp.data ?? data);
    }
    return /** @type {AdminStorageConfig} */ (resp);
  };

  /**
   * 更新存储配置
   * @param {number|string} id
   * @param {Partial<AdminStorageConfig>} data
   * @returns {Promise<AdminStorageConfig>}
   */
  const updateStorageConfig = async (id, data) => {
    const resp = await api.admin.updateStorageConfig(id, data);
    if (!resp) {
      throw new Error("更新存储配置失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "更新存储配置失败");
      }
      return /** @type {AdminStorageConfig} */ (resp.data ?? { id, ...data });
    }
    return /** @type {AdminStorageConfig} */ (resp);
  };

  /**
   * 删除存储配置
   * @param {number|string} id
   * @returns {Promise<true>}
   */
  const deleteStorageConfig = async (id) => {
    const resp = await api.admin.deleteStorageConfig(id);
    if (!resp) {
      throw new Error("删除存储配置失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "删除存储配置失败");
      }
    }
    return true;
  };

  /**
   * 设为默认存储配置
   * @param {number|string} id
   * @returns {Promise<true>}
   */
  const setDefaultStorageConfig = async (id) => {
    const resp = await api.admin.setDefaultStorageConfig(id);
    if (!resp) {
      throw new Error("设置默认存储配置失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "设置默认存储配置失败");
      }
    }
    return true;
  };

  /**
   * 测试存储配置连通性
   * @param {number|string} id
   * @returns {Promise<Object>}
   */
  const testStorageConfig = async (id) => {
    const resp = await api.admin.testStorageConfig(id);
    if (!resp) {
      throw new Error("测试存储配置失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "测试存储配置失败");
      }
      // 通常 data.result 才是真正的测试结果
      return resp.data?.result ?? resp.data ?? {};
    }
    return resp.result ?? resp.data?.result ?? resp;
  };

  return {
    getStorageConfigs,
    getStorageConfigReveal,
    createStorageConfig,
    updateStorageConfig,
    deleteStorageConfig,
    setDefaultStorageConfig,
    testStorageConfig,
  };
}

