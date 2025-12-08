/**
 * 文件预览组合式函数
 * 管理文件预览相关的状态和操作
 * 支持请求取消机制，优化导航体验
 */

import { ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/authStore.js";
import { useFsService } from "@/modules/fs";

export function useFilePreview() {
  const route = useRoute();
  const router = useRouter();
  const authStore = useAuthStore();
  const fsService = useFsService();

  // 状态管理
  const previewFile = ref(null);
  const previewInfo = ref(null);
  const previewConfig = ref(null);
  const isPreviewMode = ref(false);
  const isLoading = ref(false);
  const error = ref(null);

  // 当前正在加载的文件路径（用于防止竞态）
  const currentLoadingFile = ref(null);

  // 计算属性
  const hasPreviewFile = computed(() => !!previewFile.value);

  const canPreview = computed(() => {
    return previewInfo.value?.previewCapability?.canPreview || false;
  });

  const previewType = computed(() => {
    return previewInfo.value?.previewCapability?.previewType || "unknown";
  });

  const previewUrls = computed(() => {
    return previewInfo.value?.previewUrls || {};
  });

  const hasPreviewUrl = computed(() => {
    const urls = previewUrls.value;
    return !!(urls.preview || urls.direct || urls.download);
  });

  /**
   * 开始预览文件（直接调用API）
   * 支持请求取消：当用户快速切换预览时，旧请求会被自动取消
   * @param {Object} file - 文件对象
   * @param {string} currentPath - 当前路径
   */
  const startPreview = async (file, currentPath) => {
    try {
      if (!file || !file.path) {
        throw new Error("无效的文件对象");
      }

      // 记录当前加载的文件路径
      const filePath = file.path;
      currentLoadingFile.value = filePath;

      isLoading.value = true;
      error.value = null;
      previewFile.value = file;
      isPreviewMode.value = true;

      console.log("开始预览文件:", file.name);

      // 通过 FS service 获取文件信息（内部会自动取消之前的请求）
      const fileInfo = await fsService.getFileInfo(filePath);

      // 如果请求被取消，fileInfo 为 null，不更新状态
      if (fileInfo === null) {
        console.log("文件预览请求被取消:", file.name);
        return;
      }

      // 确保响应对应当前请求的文件（防止竞态）
      if (currentLoadingFile.value !== filePath) {
        console.log("文件预览响应已过期，跳过更新:", file.name);
        return;
      }

      previewInfo.value = fileInfo;
      console.log("文件预览信息获取成功:", fileInfo);

      // 更新URL
      updatePreviewUrl(currentPath, file.name);
    } catch (err) {
      // 请求被取消时，静默处理，不显示错误
      if (err?.name === "AbortError" || err?.__aborted) {
        console.log("文件预览请求被取消，静默处理:", file?.name);
        return;
      }

      console.error("开始预览失败:", err);
      error.value = err.message || "预览失败";
      previewFile.value = null;
      previewInfo.value = null;
      previewConfig.value = null;
      isPreviewMode.value = false;
    } finally {
      // 只有当前加载文件匹配时才清除 loading 状态
      if (currentLoadingFile.value === file?.path) {
        isLoading.value = false;
        currentLoadingFile.value = null;
      }
    }
  };

  /**
   * 停止预览
   * 会取消正在进行的文件信息请求
   * @param {boolean} updateUrl - 是否更新URL
   */
  const stopPreview = (updateUrl = true) => {
    // 取消正在进行的文件信息请求
    fsService.cancelFileInfoRequest();
    currentLoadingFile.value = null;

    previewFile.value = null;
    previewInfo.value = null;
    previewConfig.value = null;
    isPreviewMode.value = false;
    isLoading.value = false;
    error.value = null;

    if (updateUrl) {
      clearPreviewUrl();
    }

    console.log("停止文件预览");
  };

  /**
   * 初始化文件预览
   * 直接通过API获取文件信息，不依赖目录列表
   * 支持请求取消：当用户快速导航时，旧请求会被自动取消
   */
  const initializeFilePreview = async (currentPath) => {
    if (!route.query.preview) {
      return;
    }

    const previewFileName = route.query.preview;

    // 如果已经在预览同一个文件，避免重复调用
    if (isPreviewMode.value && previewFile.value && previewFile.value.name === previewFileName) {
      console.log("文件已在预览中，跳过重复初始化:", previewFileName);
      return;
    }

    // 构建完整的文件路径
    let filePath;
    if (currentPath === "/") {
      filePath = "/" + previewFileName;
    } else {
      const normalizedPath = currentPath.replace(/\/+$/, "");
      filePath = normalizedPath + "/" + previewFileName;
    }

    // 记录当前加载的文件路径
    currentLoadingFile.value = filePath;

    try {
      // 开始加载预览内容
      isLoading.value = true;
      error.value = null;

      // 通过 FS service 获取文件信息（内部会自动取消之前的请求）
      const fileInfo = await fsService.getFileInfo(filePath);

      // 如果请求被取消，fileInfo 为 null，不更新状态
      if (fileInfo === null) {
        console.log("文件预览初始化请求被取消:", previewFileName);
        return;
      }

      // 确保响应对应当前请求的文件（防止竞态）
      if (currentLoadingFile.value !== filePath) {
        console.log("文件预览初始化响应已过期，跳过更新:", previewFileName);
        return;
      }

      previewFile.value = fileInfo;
      previewInfo.value = fileInfo;
      isPreviewMode.value = true;

      console.log("文件预览初始化成功:", fileInfo.name);
    } catch (err) {
      // 请求被取消时，静默处理，不显示错误
      if (err?.name === "AbortError" || err?.__aborted) {
        console.log("文件预览初始化请求被取消，静默处理:", previewFileName);
        return;
      }

      console.error("初始化文件预览失败:", err);
      error.value = err.message || "预览失败";
      // 保持预览模式，显示错误状态，不自动重定向
    } finally {
      // 只有当前加载文件匹配时才清除 loading 状态
      if (currentLoadingFile.value === filePath) {
        isLoading.value = false;
        currentLoadingFile.value = null;
      }
    }
  };

  /**
   * 从路由初始化预览
   * @param {string} currentPath - 当前路径
   * @param {Array} directoryItems - 目录项目列表（可选，仅用于优化）
   */
  const initPreviewFromRoute = async (currentPath, directoryItems) => {
    const previewFileName = route.query.preview;

    if (!previewFileName) {
      if (isPreviewMode.value) {
        console.log("路由中无预览参数，停止文件预览");
        stopPreview(false);
      }
      return;
    }

    // 直接通过API获取文件信息，不依赖目录列表
    await initializeFilePreview(currentPath);
  };

  /**
   * 更新预览URL
   * @param {string} currentPath - 当前路径
   * @param {string} fileName - 文件名
   */
  const updatePreviewUrl = (currentPath, fileName) => {
    const newQuery = { ...route.query };
    if (fileName) {
      newQuery.preview = fileName;
    } else {
      delete newQuery.preview;
    }

    router
      .replace({
        path: route.path,
        query: newQuery,
      })
      .catch((err) => {
        console.warn("更新预览URL失败:", err);
      });
  };

  /**
   * 清除预览URL
   */
  const clearPreviewUrl = () => {
    updatePreviewUrl(null, null);
  };

  /**
   * 切换到下一个文件
   * @param {Array} directoryItems - 目录项目列表
   * @param {string} currentPath - 当前路径
   */
  const nextFile = async (directoryItems, currentPath) => {
    if (!previewFile.value || !directoryItems) return;

    const files = directoryItems.filter((item) => !item.isDirectory);
    const currentIndex = files.findIndex((file) => file.name === previewFile.value.name);

    if (currentIndex !== -1 && currentIndex < files.length - 1) {
      const nextFile = files[currentIndex + 1];
      await startPreview(nextFile, currentPath);
    }
  };

  /**
   * 切换到上一个文件
   * @param {Array} directoryItems - 目录项目列表
   * @param {string} currentPath - 当前路径
   */
  const previousFile = async (directoryItems, currentPath) => {
    if (!previewFile.value || !directoryItems) return;

    const files = directoryItems.filter((item) => !item.isDirectory);
    const currentIndex = files.findIndex((file) => file.name === previewFile.value.name);

    if (currentIndex > 0) {
      const prevFile = files[currentIndex - 1];
      await startPreview(prevFile, currentPath);
    }
  };

  /**
   * 获取预览导航信息
   * @param {Array} directoryItems - 目录项目列表
   * @returns {Object} 导航信息
   */
  const getPreviewNavigation = (directoryItems) => {
    if (!previewFile.value || !directoryItems) {
      return { canPrevious: false, canNext: false, current: 0, total: 0 };
    }

    const files = directoryItems.filter((item) => !item.isDirectory);
    const currentIndex = files.findIndex((file) => file.name === previewFile.value.name);

    return {
      canPrevious: currentIndex > 0,
      canNext: currentIndex !== -1 && currentIndex < files.length - 1,
      current: currentIndex + 1,
      total: files.length,
    };
  };

  /**
   * 刷新预览信息
   */
  const refreshPreview = async () => {
    if (!previewFile.value) return;

    try {
      isLoading.value = true;
      error.value = null;

      const result = await filePreviewService.getFilePreviewInfo(previewFile.value.path);

      if (result.success) {
        previewInfo.value = result.data;
        previewConfig.value = filePreviewService.generatePreviewConfig(result.data);
      } else {
        throw new Error(result.message || "刷新预览信息失败");
      }
    } catch (err) {
      console.error("刷新预览失败:", err);
      error.value = err.message || "刷新预览失败";
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * 检查文件是否可以预览
   * @param {Object} file - 文件对象
   * @returns {boolean} 是否可以预览
   */
  const canPreviewFile = (file) => {
    if (!file || file.isDirectory) return false;

    // 简化：基础的权限检查
    return authStore.hasPathPermission(file.path);
  };

  /**
   * 获取预览错误信息
   * @returns {string|null} 错误信息
   */
  const getPreviewError = () => {
    return error.value;
  };

  /**
   * 清除预览错误
   */
  const clearPreviewError = () => {
    error.value = null;
  };

  return {
    // 状态 - 直接返回ref，让Vue在模板中自动解包
    previewFile,
    previewInfo,
    previewConfig,
    isPreviewMode,
    isLoading,
    error,

    // 计算属性
    hasPreviewFile,
    canPreview,
    previewType,
    previewUrls,
    hasPreviewUrl,

    // 方法
    startPreview,
    stopPreview,
    initializeFilePreview,
    initPreviewFromRoute,
    updatePreviewUrl,
    clearPreviewUrl,
    nextFile,
    previousFile,
    getPreviewNavigation,
    refreshPreview,
    canPreviewFile,
    getPreviewError,
    clearPreviewError,
  };
}
