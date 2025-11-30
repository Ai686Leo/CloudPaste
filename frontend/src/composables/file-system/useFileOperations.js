/**
 * 文件操作 Composable
 * 基于 FS service 提供统一的下载、重命名、建目录、批量删除、获取直链等 UI 逻辑
 */

import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { copyToClipboard } from "@/utils/clipboard.js";
import { useFsService } from "@/modules/fs";

/** @typedef {import("@/types/fs").FsDirectoryItem} FsDirectoryItem */

/**
 * @typedef {Object} FileOperationResult
 * @property {boolean} success
 * @property {string} message
 * @property {string} [url]
 */

export function useFileOperations() {
  const { t } = useI18n();
  const fsService = useFsService();

  const loading = ref(false);
  const error = ref(/** @type {string | null} */ (null));

  // ===== 下载文件 =====

  /**
   * 下载文件
   * @param {string | FsDirectoryItem} pathOrItem - 文件路径或文件对象
   * @returns {Promise<FileOperationResult>}
   */
  const downloadFile = async (pathOrItem) => {
    /** @type {FsDirectoryItem} */
    const item =
      typeof pathOrItem === "string"
        ? { path: pathOrItem, name: pathOrItem.split("/").pop() || pathOrItem, isDirectory: false }
        : pathOrItem;

    if (!item || item.isDirectory) {
      return { success: false, message: t("mount.messages.cannotDownloadDirectory") };
    }

    try {
      loading.value = true;
      error.value = null;

      // 通过 FS service 调用 Down 路由下载，由后端根据 Link 能力统一决策直链/代理/302
      await fsService.downloadFile(item.path, item.name);

      return { success: true, message: t("mount.messages.downloadStarted", { name: item.name }) };
    } catch (err) {
      console.error("下载文件失败:", err);
      error.value = /** @type {any} */ (err)?.message;
      return { success: false, message: t("mount.messages.downloadFailed", { name: item.name, message: error.value }) };
    } finally {
      loading.value = false;
    }
  };

  // ===== 重命名 =====

  /**
   * 重命名文件或目录
   * @param {string} oldPath
   * @param {string} newPath
   * @returns {Promise<FileOperationResult>}
   */
  const renameItem = async (oldPath, newPath) => {
    try {
      loading.value = true;
      error.value = null;

      await fsService.renameItem(oldPath, newPath);
      return { success: true, message: t("mount.messages.renameSuccess") };
    } catch (err) {
      console.error("重命名失败:", err);
      error.value = /** @type {any} */ (err)?.message;
      return { success: false, message: error.value || "重命名失败" };
    } finally {
      loading.value = false;
    }
  };

  // ===== 创建目录 =====

  /**
   * 创建目录
   * @param {string} parentPath
   * @param {string} folderName
   * @returns {Promise<FileOperationResult>}
   */
  const createFolder = async (parentPath, folderName) => {
    try {
      loading.value = true;
      error.value = null;

      const fullPath = parentPath.endsWith("/") ? `${parentPath}${folderName}/` : `${parentPath}/${folderName}/`;

      await fsService.createDirectory(fullPath);
      return { success: true, message: t("mount.messages.createFolderSuccess") };
    } catch (err) {
      console.error("创建文件夹失败:", err);
      error.value = /** @type {any} */ (err)?.message;
      return { success: false, message: error.value || "创建文件夹失败" };
    } finally {
      loading.value = false;
    }
  };

  // ===== 批量删除 =====

  /**
   * 批量删除文件/目录
   * @param {FsDirectoryItem | FsDirectoryItem[] | string} itemsOrItem
   * @returns {Promise<FileOperationResult>}
   */
  const batchDeleteItems = async (itemsOrItem) => {
    let items;
    if (typeof itemsOrItem === "string") {
      items = [{ path: itemsOrItem, name: itemsOrItem.split("/").pop() || itemsOrItem, isDirectory: false }];
    } else if (Array.isArray(itemsOrItem)) {
      items = itemsOrItem;
    } else {
      items = [itemsOrItem];
    }

    if (!items || items.length === 0) {
      return { success: false, message: t("mount.messages.noItemsToDelete") };
    }

    try {
      loading.value = true;
      error.value = null;

      const paths = items.map((item) => item.path);
      await fsService.batchDeleteItems(paths);

      return {
        success: true,
        message: t("mount.messages.batchDeleteSuccess", { count: items.length }),
      };
    } catch (err) {
      console.error("批量删除失败:", err);
      error.value = /** @type {any} */ (err)?.message;
      return {
        success: false,
        message: t("mount.messages.batchDeleteFailed", { message: error.value }),
      };
    } finally {
      loading.value = false;
    }
  };

  // ===== 获取直链并复制到剪贴板 =====

  /**
   * 获取文件直链并复制到剪贴板
   * @param {FsDirectoryItem} item
   * @param {number|null} [expiresIn]
   * @param {boolean} [forceDownload=true]
   * @returns {Promise<FileOperationResult>}
   */
  const getFileLink = async (item, expiresIn = null, forceDownload = true) => {
    if (item.isDirectory) {
      return {
        success: false,
        message: t("mount.messages.directoryNoLink"),
      };
    }

    try {
      loading.value = true;
      error.value = null;

      const url = await fsService.getFileLink(item.path, expiresIn, forceDownload);

      return {
        success: true,
        message: (await copyToClipboard(url)) ? t("mount.messages.linkCopiedSuccess") : t("mount.messages.copyFailed"),
        url,
      };
    } catch (err) {
      console.error("获取文件直链失败:", err);
      error.value = /** @type {any} */ (err)?.message;
      return {
        success: false,
        message: error.value || t("mount.messages.getFileLinkError"),
      };
    } finally {
      loading.value = false;
    }
  };

  /**
   * 清理错误状态
   */
  const clearError = () => {
    error.value = null;
  };

  return {
    // 状态
    loading,
    error,

    // 操作
    downloadFile,
    renameItem,
    createFolder,
    batchDeleteItems,
    getFileLink,
    clearError,
  };
}
