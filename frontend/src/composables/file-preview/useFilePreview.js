/**
 * 文件预览组合式函数
 * 管理文件预览相关的状态和操作
 * 支持请求取消机制，优化导航体验
 */

import { ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useFsService } from "@/modules/fs";

export function useFilePreview() {
  const route = useRoute();
  const router = useRouter();
  const fsService = useFsService();

  // 状态管理
  const previewFile = ref(null);
  const previewInfo = ref(null);
  const isLoading = ref(false);
  const error = ref(null);

  // 当前正在加载的文件路径（用于防止竞态）
  const currentLoadingFile = ref(null);

  // 计算属性
  const hasPreviewFile = computed(() => !!previewFile.value);

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
    if (previewFile.value && previewFile.value.name === previewFileName) {
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
      if (previewFile.value || isLoading.value || error.value || currentLoadingFile.value) {
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

  return {
    // 状态 - 直接返回ref，让Vue在模板中自动解包
    previewFile,
    previewInfo,
    isLoading,
    error,

    // 计算属性
    hasPreviewFile,

    // 方法
    stopPreview,
    initializeFilePreview,
    initPreviewFromRoute,
    updatePreviewUrl,
    clearPreviewUrl,
  };
}
