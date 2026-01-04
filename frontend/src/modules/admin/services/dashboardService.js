import { api } from "@/api";

/**
 * Admin 仪表盘 Service
 *
 * - 封装 dashboard 统计相关 API 调用
 *
 * 不负责：
 * - 图表配置、文案、展示逻辑
 */
export function useDashboardService() {
  /**
   * 获取仪表盘统计数据
   */
  const getDashboardStats = async () => {
    const resp = await api.admin.getDashboardStats();
    if (!resp) {
      throw new Error("获取仪表盘统计数据失败");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "获取仪表盘统计数据失败");
      }
      return resp.data ?? {};
    }

    return resp;
  };

  /**
   * 获取存储用量报告
   */
  const getStorageUsageReport = async () => {
    const resp = await api.admin.getStorageUsageReport();
    if (!resp) {
      throw new Error("获取存储用量报告失败");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "获取存储用量报告失败");
      }
      return resp.data ?? {};
    }

    return resp;
  };

  /**
   * 主动刷新存储用量快照
   */
  const refreshStorageUsageSnapshots = async (options = {}) => {
    const resp = await api.admin.refreshStorageUsageSnapshots(options);
    if (!resp) {
      throw new Error("刷新存储用量快照失败");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "刷新存储用量快照失败");
      }
      return resp.data ?? {};
    }

    return resp;
  };

  return {
    getDashboardStats,
    getStorageUsageReport,
    refreshStorageUsageSnapshots,
  };
}
