import { api } from "@/api";
import { useAuthStore } from "@/stores/authStore.js";
import { usePathPassword } from "@/composables/usePathPassword.js";
import { downloadFileWithAuth } from "@/api/services/fileDownloadService.js";

/** @typedef {import("@/types/fs").FsDirectoryResponse} FsDirectoryResponse */
/** @typedef {import("@/types/fs").FsDirectoryItem} FsDirectoryItem */

/**
 * FS 服务封装
 *
 * - 基于 api.fs 提供的底层接口做统一封装
 * - 统一目录/文件信息/批量删除/复制/预签名链接等能力
 *
 * 使用场景
 * - UI 侧通过 DOM 操作创建 <a> 元素触发下载或预览
 */
export function useFsService() {
  const authStore = useAuthStore();
  const pathPassword = usePathPassword();

  /**
   * 获取目录列表
   * @param {string} path
   * @param {{ refresh?: boolean }} [options]
   * @returns {Promise<FsDirectoryResponse>}
   */
  const getDirectoryList = async (path, options = {}) => {
    const normalizedPath = path || "/";
    const isAdmin = authStore.isAdmin;

    /** @type {{ refresh?: boolean; headers?: Record<string,string> }} */
    const requestOptions = { refresh: options.refresh };

    // 非管理员访问时，如果已有 token，则附带在请求头中
    if (!isAdmin) {
      const token = pathPassword.getPathToken(normalizedPath);
      if (token) {
        requestOptions.headers = {
          "X-FS-Path-Token": token,
        };
      }
    }

    try {
      const response = await api.fs.getDirectoryList(normalizedPath, requestOptions);
      if (!response?.success) {
        throw new Error(response?.message || "获取目录列表失败");
      }
      return /** @type {FsDirectoryResponse} */ (response.data);
    } catch (error) {
      // 目录路径密码缺失或失效：触发前端密码验证流程
      if (!isAdmin && error && error.code === "FS_PATH_PASSWORD_REQUIRED") {
        console.warn("目录需要路径密码，触发密码验证流程:", { path: normalizedPath, error });
        // 旧 token 失效，清除后重新走验证
        pathPassword.removePathToken(normalizedPath);
        pathPassword.setPendingPath(normalizedPath);
        pathPassword.openPasswordDialog();

        const friendlyError = new Error(error.message || "目录需要密码访问");
        friendlyError.code = "FS_PATH_PASSWORD_REQUIRED";
        friendlyError.__logged = true;
        throw friendlyError;
      }

      throw error;
    }
  };

  /**
   * 获取单个文件信息
   * @param {string} path
   * @returns {Promise<FsDirectoryItem>}
   */
  const getFileInfo = async (path) => {
    const isAdmin = authStore.isAdmin;

    /** @type {{ headers?: Record<string,string> }} */
    const requestOptions = {};

    // 非管理员访问时，为文件路径附加路径密码 token（如果存在）
    if (!isAdmin) {
      const token = pathPassword.getPathToken(path);
      if (token) {
        requestOptions.headers = {
          "X-FS-Path-Token": token,
        };
      }
    }

    const response = await api.fs.getFileInfo(path, requestOptions);
    if (!response?.success) {
      throw new Error(response?.message || "获取文件信息失败");
    }
    return /** @type {FsDirectoryItem} */ (response.data);
  };

  /**
   * 重命名文件/目录
   * @param {string} oldPath
   * @param {string} newPath
   * @returns {Promise<true>}
   */
  const renameItem = async (oldPath, newPath) => {
    const response = await api.fs.renameItem(oldPath, newPath);
    if (!response?.success) {
      throw new Error(response?.message || "重命名失败");
    }
    return true;
  };

  /**
   * 创建目录
   * @param {string} fullPath
   * @returns {Promise<true>}
   */
  const createDirectory = async (fullPath) => {
    const response = await api.fs.createDirectory(fullPath);
    if (!response?.success) {
      throw new Error(response?.message || "创建目录失败");
    }
    return true;
  };

  /**
   * 批量删除
   * @param {string[]} paths
   * @returns {Promise<{ success: true; raw: any }>}
   */
  const batchDeleteItems = async (paths) => {
    const result = await api.fs.batchDeleteItems(paths);
    if (result.failed && result.failed.length > 0) {
      throw new Error(result.failed[0].error || "批量删除失败");
    }
    return {
      success: true,
      raw: result,
    };
  };

  /**
   * 批量复制文件/目录
   * @param {Array<{sourcePath:string,targetPath:string}>} items
   * @param {Object} [options]
   * @param {boolean} [options.skipExisting=true] 是否跳过已存在的文件
   * @returns {Promise<Object>} 原始复制结果，由后端定义结构
   */
  const batchCopyItems = async (items, options = {}) => {
    return api.fs.batchCopyItems(items, options);
  };

  /**
   * 获取文件预签名访问链接
   * @param {string} path
   * @param {number|null} [expiresIn]
   * @param {boolean} [forceDownload=true]
   * @returns {Promise<string>}
   */
  const getFileLink = async (path, expiresIn = null, forceDownload = true) => {
    const url = await api.fs.getFileLink(path, expiresIn, forceDownload);
    if (!url) {
      throw new Error("获取文件直链失败");
    }
    return url;
  };

  /**
   * 通过 Down 路由下载文件（复用统一带鉴权下载逻辑）
   * @param {string} path
   * @param {string} filename
   * @returns {Promise<void>}
   */
  const downloadFile = async (path, filename) => {
    const normalizedPath = path || "/";
    const isAdmin = authStore.isAdmin;

    /** @type {Record<string,string>|undefined} */
    let headers;
    if (!isAdmin) {
      const token = pathPassword.getPathToken(normalizedPath);
      if (token) {
        headers = {
          "X-FS-Path-Token": token,
        };
      }
    }

    const endpoint = `/api/fs/download?path=${encodeURIComponent(normalizedPath)}`;
    await downloadFileWithAuth(endpoint, filename, headers ? { headers } : {});
  };

  /**
   * 创建通用作业（支持多种任务类型）
   * @param {string} taskType 任务类型（'copy', 'scheduled-sync', 'cleanup' 等）
   * @param {Object} payload 任务载荷
   * @param {Object} [options] 选项参数
   * @returns {Promise<Object>} 作业描述符
   */
  const createJob = async (taskType, payload, options = {}) => {
    return api.fs.createJob(taskType, payload, options);
  };

  /**
   * 获取作业状态
   * @param {string} jobId 作业ID
   * @returns {Promise<Object>} 作业状态信息
   */
  const getJobStatus = async (jobId) => {
    return api.fs.getJobStatus(jobId);
  };

  /**
   * 取消作业
   * @param {string} jobId 作业ID
   * @returns {Promise<Object>} 取消操作结果
   */
  const cancelJob = async (jobId) => {
    return api.fs.cancelJob(jobId);
  };

  /**
   * 列出作业
   * @param {Object} [filter] 过滤条件
   * @returns {Promise<Object>} 作业列表
   */
  const listJobs = async (filter = {}) => {
    return api.fs.listJobs(filter);
  };

  /**
   * 删除作业
   * @param {string} jobId 作业ID
   * @returns {Promise<Object>} 删除结果
   */
  const deleteJob = async (jobId) => {
    return api.fs.deleteJob(jobId);
  };

  return {
    getDirectoryList,
    getFileInfo,
    renameItem,
    createDirectory,
    batchDeleteItems,
    batchCopyItems,
    getFileLink,
    downloadFile,
    createJob,
    getJobStatus,
    cancelJob,
    listJobs,
    deleteJob,
  };
}
