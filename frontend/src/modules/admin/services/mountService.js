import { api } from "@/api";

/** @typedef {import("@/types/admin").MountConfig} MountConfig */

/**
 * Admin 挂载管理 Service
 *
 * - 统一封装挂载点列表 / 创建 / 更新 / 删除
 * - 规整返回结构，前端只使用 MountConfig[]
 */
export function useAdminMountService() {
  /**
   * 获取挂载列表
   * @returns {Promise<MountConfig[]>}
   */
  const getMountsList = async () => {
    const resp = await api.mount.getMountsList();
    if (!resp) {
      throw new Error("获取挂载列表失败");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "获取挂载列表失败");
      }
      const data = resp.data ?? resp.items ?? resp.records ?? [];
      return Array.isArray(data) ? /** @type {MountConfig[]} */ (data) : [];
    }

    if (Array.isArray(resp)) {
      return /** @type {MountConfig[]} */ (resp);
    }
    if (Array.isArray(resp.data)) {
      return /** @type {MountConfig[]} */ (resp.data);
    }

    return [];
  };

  /**
   * 更新挂载配置
   * @param {string|number} id
   * @param {Partial<MountConfig>} payload
   * @returns {Promise<MountConfig>}
   */
  const updateMount = async (id, payload) => {
    const resp = await api.mount.updateMount(id, payload);
    if (!resp) {
      throw new Error("更新挂载失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "更新挂载失败");
      }
      return /** @type {MountConfig} */ (resp.data ?? { id, ...payload });
    }
    return /** @type {MountConfig} */ (resp);
  };

  /**
   * 创建挂载
   * @param {Partial<MountConfig>} payload
   * @returns {Promise<MountConfig>}
   */
  const createMount = async (payload) => {
    const resp = await api.mount.createMount(payload);
    if (!resp) {
      throw new Error("创建挂载失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "创建挂载失败");
      }
      return /** @type {MountConfig} */ (resp.data ?? resp);
    }
    return /** @type {MountConfig} */ (resp);
  };

  /**
   * 删除挂载
   * @param {string|number} id
   * @returns {Promise<true>}
   */
  const deleteMount = async (id) => {
    const resp = await api.mount.deleteMount(id);
    if (!resp) {
      throw new Error("删除挂载失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "删除挂载失败");
      }
    }
    return true;
  };

  return {
    getMountsList,
    updateMount,
    createMount,
    deleteMount,
  };
}

