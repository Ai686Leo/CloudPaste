/**
 * 文件系统 Pinia Store
 * 负责挂载浏览器中 FS 目录浏览的核心状态
 * 支持请求取消机制，优化导航体验
 */

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useAuthStore } from "./authStore.js";
import { useFsService } from "@/modules/fs";
import { createLogger } from "@/utils/logger.js";

/** @typedef {import("@/types/fs").FsDirectoryResponse} FsDirectoryResponse */
/** @typedef {import("@/types/fs").FsDirectoryItem} FsDirectoryItem */
/** @typedef {import("@/types/fs").FsResolvedMeta} FsResolvedMeta */

export const useFileSystemStore = defineStore("fileSystem", () => {
  const fsService = useFsService();
  const authStore = useAuthStore();
  const log = createLogger("FileSystemStore");

  // ===== 状态 =====
  const currentPath = ref("/");
  /** @type {import("vue").Ref<FsDirectoryResponse | null>} */
  const directoryData = ref(/** @type {FsDirectoryResponse | null} */ (null));
  const loading = ref(false);
  const error = ref(/** @type {string | null} */ (null));

  // 当前正在加载的路径（避免重复请求）
  const currentLoadingPath = ref(/** @type {string | null} */ (null));

  // ===== 派生状态 =====

  /**
   * 检查当前路径是否有访问权限
   */
  const hasPermissionForCurrentPath = computed(() => authStore.hasPathPermission(currentPath.value));

  /**
   * 目录条目列表
   * @type {import("vue").ComputedRef<FsDirectoryItem[]>}
   */
  const directoryItems = computed(() => (directoryData.value?.items || []));

  /**
   * 是否为虚拟目录
   */
  const isVirtualDirectory = computed(() => directoryData.value?.isVirtual || false);

  /**
   * 当前目录 Meta 信息
   * @type {import("vue").ComputedRef<FsResolvedMeta | null>}
   */
  const directoryMeta = computed(() => directoryData.value?.meta || null);

  // ===== Actions =====

  /**
   * 加载目录内容
   * 支持请求取消：当用户快速导航时，旧请求会被自动取消
   * @param {string} path - 目录路径
   * @param {boolean} [force=false] - 是否强制刷新
   */
  const loadDirectory = async (path, force = false) => {
    const normalizedPath = path || "/";

    // 避免重复请求（同一路径且非强制刷新）
    if (!force && currentLoadingPath.value === normalizedPath) {
      log.debug(`目录 ${normalizedPath} 正在加载中，跳过重复请求`);
      return;
    }

    // 权限检查
    if (!authStore.hasPathPermission(normalizedPath)) {
      error.value = `无权访问路径: ${normalizedPath}`;
      return;
    }

    // 立即更新当前路径，让 UI 先响应（面包屑等）
    currentPath.value = normalizedPath;

    try {
      loading.value = true;
      currentLoadingPath.value = normalizedPath;
      error.value = null;

      // fsService.getDirectoryList 内部会自动取消之前的请求
      const data = await fsService.getDirectoryList(normalizedPath, { refresh: force });
      
      // 如果请求被取消，data 为 null，不更新状态
      if (data === null) {
        log.debug("目录请求被取消，跳过状态更新:", normalizedPath);
        return;
      }

      // 确保响应对应当前请求的路径（防止竞态）
      if (currentPath.value === normalizedPath) {
        directoryData.value = data;
      }
    } catch (err) {
      // 请求被取消时，静默处理，不显示错误
      if (/** @type {any} */ (err)?.name === "AbortError" || /** @type {any} */ (err)?.__aborted) {
        log.debug("目录请求被取消，静默处理:", normalizedPath);
        return;
      }

      log.error("加载目录失败:", err);
      // 针对路径密码校验失败的场景，不将其视为"普通错误"，交给路径密码弹窗处理
      if (/** @type {any} */ (err)?.code === "FS_PATH_PASSWORD_REQUIRED") {
        directoryData.value = null;
        error.value = null;
      } else {
        error.value = /** @type {any} */ (err)?.message || "加载目录失败";
        directoryData.value = null;
      }
    } finally {
      // 只有当前加载路径匹配时才清除 loading 状态
      if (currentLoadingPath.value === normalizedPath) {
        loading.value = false;
        currentLoadingPath.value = null;
      }
    }
  };

  /**
   * 刷新当前目录
   */
  const refreshDirectory = async () => {
    if (currentPath.value) {
      await loadDirectory(currentPath.value, true);
    }
  };

  /**
   * 重置状态（退出登录 / 切换用户时使用）
   */
  const resetState = () => {
    currentPath.value = "/";
    directoryData.value = null;
    loading.value = false;
    error.value = null;
    currentLoadingPath.value = null;
    fsService.cancelAllRequests();
  };

  return {
    // 状态
    currentPath,
    directoryData,
    loading,
    error,

    // 派生状态
    hasPermissionForCurrentPath,
    directoryItems,
    isVirtualDirectory,
    directoryMeta,

    // Actions
    loadDirectory,
    refreshDirectory,
    resetState,
  };
});
