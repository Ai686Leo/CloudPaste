import { api } from "@/api";

/**
 * Upload 领域 Service
 *
 * - 提供与上传页相关的辅助数据访问（例如最近上传文件）
 *
 * 不负责：
 * - UI 文案、状态管理与权限判断
 */
export function useUploadService() {
 /**
  * 获取最近上传的文件列表
  *
  * @param {number} limit - 返回的最大条数
  */
  const getRecentFiles = async (limit = 5) => {
    const response = await api.file.getFiles(limit, 0);
    const list = response?.data?.files || [];

    // 与原有 UploadView 保持一致：按 created_at 倒序排序
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  };

  /**
   * 获取系统配置的最大上传大小（单位：MB）
   * 由 API 层负责处理默认值与错误日志，这里直接透传结果
   */
  const getMaxUploadSize = async () => {
    return api.file.getMaxUploadSize();
  };

  return {
    getRecentFiles,
    getMaxUploadSize,
  };
}
