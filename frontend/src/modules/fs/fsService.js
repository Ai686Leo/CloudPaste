import { api } from "@/api";

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
  /**
   * 获取目录列表
   * @param {string} path
   * @param {{ refresh?: boolean }} [options]
   * @returns {Promise<FsDirectoryResponse>}
   */
  const getDirectoryList = async (path, options = {}) => {
    const response = await api.fs.getDirectoryList(path, options);
    if (!response?.success) {
      throw new Error(response?.message || "获取目录列表失败");
    }
    return /** @type {FsDirectoryResponse} */ (response.data);
  };

  /**
   * 获取单个文件信息
   * @param {string} path
   * @returns {Promise<FsDirectoryItem>}
   */
  const getFileInfo = async (path) => {
    const response = await api.fs.getFileInfo(path);
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
   * @param {boolean} [skipExisting=true]
   * @param {Object} [options]
   * @returns {Promise<Object>} 原始复制结果，由后端定义结构
   */
  const batchCopyItems = async (items, skipExisting = true, options = {}) => {
    return api.fs.batchCopyItems(items, skipExisting, options);
  };

  /**
   * 获取文件预签名访问链接
   * @param {string} path
   * @param {number|null} [expiresIn]
   * @param {boolean} [forceDownload=true]
   * @returns {Promise<string>}
   */
  const getFileLink = async (path, expiresIn = null, forceDownload = true) => {
    const response = await api.fs.getFileLink(path, expiresIn, forceDownload);
    if (!response?.success || !response.data?.presignedUrl) {
      throw new Error(response?.message || "获取文件直链失败");
    }
    return response.data.presignedUrl;
  };

  return {
    getDirectoryList,
    getFileInfo,
    renameItem,
    createDirectory,
    batchDeleteItems,
    batchCopyItems,
    getFileLink,
  };
}

