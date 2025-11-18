/**
 * 文件系统 Pinia Store
 * 负责挂载浏览器中 FS 目录浏览的核心状态
 */

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useAuthStore } from "./authStore.js";
import { useFsService } from "@/modules/fs";

/** @typedef {import("@/types/fs").FsDirectoryResponse} FsDirectoryResponse */
/** @typedef {import("@/types/fs").FsDirectoryItem} FsDirectoryItem */

export const useFileSystemStore = defineStore("fileSystem", () => {
  const fsService = useFsService();
  const authStore = useAuthStore();

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

  // ===== Actions =====

  /**
   * 加载目录内容
   * @param {string} path - 目录路径
   * @param {boolean} [force=false] - 是否强制刷新
   */
  const loadDirectory = async (path, force = false) => {
    const normalizedPath = path || "/";

    // 避免重复请求
    if (!force && currentLoadingPath.value === normalizedPath) {
      console.log(`目录 ${normalizedPath} 正在加载中，跳过重复请求`);
      return;
    }

    // 权限检查
    if (!authStore.hasPathPermission(normalizedPath)) {
      error.value = `无权访问路径: ${normalizedPath}`;
      return;
    }

    try {
      loading.value = true;
      currentLoadingPath.value = normalizedPath;
      error.value = null;

      const data = await fsService.getDirectoryList(normalizedPath, { refresh: force });
      directoryData.value = data;
      currentPath.value = normalizedPath;
    } catch (err) {
      console.error("加载目录失败:", err);
      error.value = /** @type {any} */ (err)?.message || "加载目录失败";
      directoryData.value = null;
    } finally {
      loading.value = false;
      currentLoadingPath.value = null;
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

    // Actions
    loadDirectory,
    refreshDirectory,
    resetState,
  };
});

