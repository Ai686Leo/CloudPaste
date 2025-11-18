import BackupService from "@/api/services/backupService.js";

/**
 * Admin 备份 Service
 *
 * - 封装所有后台备份 / 恢复相关的 API 调用
 * - 为 BackupView 等视图提供语义化方法
 *
 * 不负责：
 * - UI 文案、通知、文件下载 DOM 操作（这些留给视图层处理）
 */
export function useAdminBackupService() {
  /**
   * 获取可备份模块信息
   */
  const getModules = () => {
    return BackupService.getModules();
  };

  /**
   * 创建备份（完整 / 指定模块）
   * 直接返回后端的 Blob 响应，由调用方负责下载与解析
   */
  const createBackup = (options) => {
    return BackupService.createBackup(options);
  };

  /**
   * 恢复备份
   */
  const restoreBackup = (file, mode = "overwrite") => {
    return BackupService.restoreBackup(file, mode);
  };

  return {
    getModules,
    createBackup,
    restoreBackup,
  };
}

