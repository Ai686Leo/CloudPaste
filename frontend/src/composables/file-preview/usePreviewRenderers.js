/**
 * 文件预览渲染器 Composable
 * 专注预览渲染
 */

import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useEventListener } from "@vueuse/core";
import { formatDateTime } from "@/utils/timeUtils.js";
import { formatFileSize as formatFileSizeUtil, FileType, getExtension, isArchiveFile } from "@/utils/fileTypes.js";
import { decodeImagePreviewUrlToPngObjectUrl, revokeObjectUrl, shouldAttemptDecodeImagePreview } from "@/utils/imageDecode.js";
import { createLogger } from "@/utils/logger.js";

const EBOOK_EXTS = new Set(["epub", "mobi", "azw3", "azw", "fb2", "cbz"]);
const EBOOK_MIMES = new Set([
  "application/epub+zip",
  "application/x-mobipocket-ebook",
  "application/vnd.amazon.ebook",
  "application/x-fictionbook+xml",
  "application/vnd.comicbook+zip",
  "application/x-cbz",
]);

export function usePreviewRenderers(file, emit, darkMode) {
  const log = createLogger("Preview");
  // ===== 状态管理 =====

  // 基本状态
  const loadError = ref(false);
  const authenticatedPreviewUrl = ref(null);
  const hasTriedImageDecodeFallback = ref(false);
  const isDecodingImage = ref(false);
  const imageDecodeAbortController = ref(null);

  // Office预览相关
  const officePreviewLoading = ref(false);
  const officePreviewError = ref("");
  const officePreviewTimedOut = ref(false);
  const previewTimeoutId = ref(null);

  // 全屏状态
  const isOfficeFullscreen = ref(false);

  // DOM 引用
  const officePreviewRef = ref(null);

  // ===== 计算属性 =====

  /**
   * 文件类型信息
   */
  const fileTypeInfo = computed(() => {
    if (!file.value) return null;
    const mimeType = file.value.mimetype;
    return {
      mimeType,
      filename: file.value.name,
      displayName: file.value.name || file.value.filename || "",
    };
  });

  // 文件类型判断计算属性 - 直接依赖后端返回的枚举类型
  const isImageFile = computed(() => file.value?.type === FileType.IMAGE);
  const isVideoFile = computed(() => file.value?.type === FileType.VIDEO);
  const isAudioFile = computed(() => file.value?.type === FileType.AUDIO);
  const isOfficeFile = computed(() => file.value?.type === FileType.OFFICE);
  const isTextFile = computed(() => file.value?.type === FileType.TEXT);

  // 基于文件类型的判断
  const isPdfFile = computed(() => file.value?.type === FileType.DOCUMENT);
  const isEbookFile = computed(() => {
    if (!file.value) return false;
    const filename = file.value?.name || file.value?.filename || "";
    const ext = getExtension(filename);
    const mime = String(file.value?.mimetype || "").toLowerCase();
    if (EBOOK_EXTS.has(ext)) return true;
    return EBOOK_MIMES.has(mime);
  });

  /**
   * 预览URL - 基于 Link JSON 中的 previewUrl
   * 在 FS 视图下由后端统一构造为最终可访问的 inline 入口
   */
  const previewUrl = computed(() => {
    if (!file.value) return "";
    return file.value.previewUrl || "";
  });

  /**
   * 获取认证预览URL（保留方法以兼容可能的工具场景）
   * FS 视图下默认直接使用 previewUrl，正常预览不再依赖 Blob 模式
   */
  const fetchAuthenticatedUrl = async () => {
    const url = previewUrl.value;
    if (!url) {
      log.warn("预览URL为空，无法获取认证预览URL");
      return;
    }
    revokeObjectUrl(authenticatedPreviewUrl.value);
    authenticatedPreviewUrl.value = url;
  };

  // ===== Office预览处理 =====

  /**
   * 更新Office预览URLs
   * FS 视图下不再在前端生成 Office 直链，只保留加载/错误状态占位
   */
  const updateOfficePreviewUrls = async () => {
    officePreviewLoading.value = false;
    officePreviewError.value = "";
    officePreviewTimedOut.value = false;
  };

  /**
   * 清除预览加载超时计时器（占位实现）
   */
  const clearPreviewLoadTimeout = () => {
    if (previewTimeoutId.value) {
      clearTimeout(previewTimeoutId.value);
      previewTimeoutId.value = null;
    }
  };

  // ===== 全屏功能 =====

  /**
   * 通用全屏处理函数
   */
  const toggleFullscreen = (elementRef, isFullscreenState, onEnter, onExit) => {
    if (!isFullscreenState.value) {
      // 进入全屏
      if (elementRef.value && document.fullscreenEnabled) {
        elementRef.value
          .requestFullscreen()
          .then(() => {
            isFullscreenState.value = true;
            if (onEnter) onEnter();
            log.debug("进入全屏模式");
          })
          .catch((error) => {
            log.error("进入全屏失败:", error);
            // 降级处理：使用CSS全屏效果
            isFullscreenState.value = true;
            if (onEnter) onEnter();
          });
      } else {
        // 降级处理：使用CSS全屏效果
        isFullscreenState.value = true;
        if (onEnter) onEnter();
      }
    } else {
      // 退出全屏
      if (document.fullscreenElement) {
        document
          .exitFullscreen()
          .then(() => {
            isFullscreenState.value = false;
            if (onExit) onExit();
            log.debug("退出全屏模式");
          })
          .catch((error) => {
            log.error("退出全屏失败:", error);
            isFullscreenState.value = false;
            if (onExit) onExit();
          });
      } else {
        isFullscreenState.value = false;
        if (onExit) onExit();
      }
    }
  };

  /**
   * 切换Office全屏
   */
  const toggleOfficeFullscreen = () => {
    toggleFullscreen(
      officePreviewRef,
      isOfficeFullscreen,
      () => {
        // 进入全屏时的回调
        log.debug("Office预览进入全屏");
      },
      () => {
        // 退出全屏时的回调
        log.debug("Office预览退出全屏");
      }
    );
  };

  // ===== HTML全屏功能已移除 =====

  /**
   * 监听全屏变化事件
   */
  const handleFullscreenChange = () => {
    // 如果不在全屏状态，重置全屏标志
    if (!document.fullscreenElement) {
      isOfficeFullscreen.value = false;
      log.debug("全屏状态已重置");
    }
  };

  /**
   * 监听Esc键退出全屏
   */
  const handleKeyDown = (e) => {
    // 浏览器原生全屏API会自动处理Esc键退出全屏
    // 这里可以添加其他键盘快捷键处理逻辑
    if (e.key === "Escape") {
      log.debug("检测到Esc键，全屏状态将由浏览器处理");
    }
  };
  
  //自动清理
  useEventListener(document, "fullscreenchange", handleFullscreenChange);
  useEventListener(document, "keydown", handleKeyDown);

  // ===== 事件处理 =====

  let lastContentLoadedKey = "";

  const buildContentLoadedKey = () => {
    const f = file.value;
    const fp = f?.path || f?.id || f?.name || "";
    const url = authenticatedPreviewUrl.value || previewUrl.value || "";
    return `${fp}::${url}`;
  };

  /**
   * 处理内容加载完成
   */
  const handleContentLoaded = () => {
    const key = buildContentLoadedKey();
    if (key && key === lastContentLoadedKey) return;
    lastContentLoadedKey = key;
    log.debug("内容加载完成");
    emit("loaded");
  };

  /**
   * 处理内容加载错误
   */
  const handleContentError = async (error) => {
    log.error("内容加载错误:", error);

    const currentFile = file.value;
    const currentUrl = authenticatedPreviewUrl.value || "";
    const filename = currentFile?.name || "";
    const mimetype = currentFile?.mimetype || "";

    // 仅在“图片预览 + 首次加载失败 + 可解码格式”时做解码回退
    if (
      isImageFile.value &&
      !hasTriedImageDecodeFallback.value &&
      shouldAttemptDecodeImagePreview({ filename, mimetype }) &&
      typeof currentUrl === "string" &&
      !currentUrl.startsWith("blob:")
    ) {
      hasTriedImageDecodeFallback.value = true;
      try {
        log.debug("图片解码回退开始:", { filename, mimetype, url: currentUrl });
        const { objectUrl } = await decodeImagePreviewUrlToPngObjectUrl({ url: currentUrl, filename, mimetype });
        revokeObjectUrl(authenticatedPreviewUrl.value);
        authenticatedPreviewUrl.value = objectUrl;
        loadError.value = false;
        log.debug("图片解码回退成功:", { filename, objectUrl });
        return;
      } catch (decodeError) {
        log.error("图片解码回退失败:", decodeError);
        // 继续走通用错误处理
      }
    }

    loadError.value = true;
    emit("error", error);
  };

  // ===== 工具方法 =====

  /**
   * 格式化文件大小
   */
  const formatFileSize = (size) => {
    return formatFileSizeUtil(size);
  };

  /**
   * 格式化日期
   */
  const formatDate = (dateString) => {
    if (!dateString) return "";
    return formatDateTime(dateString);
  };

  // ===== 初始化和清理 =====

  /**
   * 初始化预览（仅保留基本功能）
   */
  const initializePreview = async () => {
    // 文本/代码/Markdown/HTML预览已移除
    // 图片、视频、音频、PDF、Office预览由模板中的条件渲染处理
    log.debug("预览初始化完成");
  };

  /**
   * 为文件初始化
   */
  const initializeForFile = async (newFile) => {
    // 重置基本状态
    loadError.value = false;
    revokeObjectUrl(authenticatedPreviewUrl.value);
    authenticatedPreviewUrl.value = null;
    hasTriedImageDecodeFallback.value = false;

    // 重置Office预览状态
    officePreviewLoading.value = false;
    officePreviewError.value = "";
    officePreviewTimedOut.value = false;
    isOfficeFullscreen.value = false;
    clearPreviewLoadTimeout();

    log.debug("文件预览渲染器已重置，准备预览新文件:", newFile?.name || "无文件");
  };

  /**
   * 重新初始化预览（主题变化时）
   */
  const reinitializePreviewOnThemeChange = async () => {
    // 文本/代码/Markdown/HTML预览已移除
    // 图片、视频、音频、PDF、Office预览不需要主题重新初始化
    log.debug("主题变化预览重新初始化完成");
  };

  // ===== 监听器 =====

  /**
   * 监听暗色模式变化
   */
  watch(
    () => darkMode?.value,
    () => {
      reinitializePreviewOnThemeChange();
    }
  );

  /**
   * 监听文件变化
   */
  watch(
    () => file.value,
    async (newFile) => {
      // 文件变更：允许下一次 loaded 重新触发
      lastContentLoadedKey = "";
      // 重置基本状态
      loadError.value = false;
      revokeObjectUrl(authenticatedPreviewUrl.value);
      authenticatedPreviewUrl.value = null;
      hasTriedImageDecodeFallback.value = false;
      isDecodingImage.value = false;
      if (imageDecodeAbortController.value) {
        imageDecodeAbortController.value.abort();
        imageDecodeAbortController.value = null;
      }

      // 重置Office预览状态
      officePreviewLoading.value = false;
      officePreviewError.value = "";
      officePreviewTimedOut.value = false;
      clearPreviewLoadTimeout();

      // 重置全屏状态
      isOfficeFullscreen.value = false;

      // 只有当文件存在时才初始化预览
      if (newFile) {
        // 添加详细的文件类型判断日志
        log.debug(`文件预览类型分析: ${newFile.name}`);
        log.debug("文件信息:", {
          name: newFile.name,
          mimetype: newFile.mimetype,
          size: newFile.size,
          path: newFile.path,
        });

        // 获取文件类型信息
        const typeInfo = fileTypeInfo.value;
        log.debug("文件类型检测结果:", typeInfo);

        // 显示保留的类型判断结果
        const typeChecks = {
          isImage: isImageFile.value,
          isVideo: isVideoFile.value,
          isAudio: isAudioFile.value,
          isPdf: isPdfFile.value,
          isEbook: isEbookFile.value,
          isOffice: isOfficeFile.value,
          isText: isTextFile.value,
        };
        log.debug("类型判断结果:", typeChecks);

        // 显示最终选择的预览类型
        const selectedType = Object.entries(typeChecks).find(([, value]) => value)?.[0] || "unknown";
        log.debug(`最终预览类型: ${selectedType}`);

        if (typeChecks.isImage) {
          const filename = newFile?.name || "";
          const mimetype = newFile?.mimetype || "";
          const url = previewUrl.value || "";

          if (url && shouldAttemptDecodeImagePreview({ filename, mimetype })) {
            const expectedFileName = filename;
            const controller = new AbortController();
            imageDecodeAbortController.value = controller;
            isDecodingImage.value = true;
            hasTriedImageDecodeFallback.value = true;

            try {
              log.debug("图片预解码开始:", { filename, mimetype, url });
              const decoded = await decodeImagePreviewUrlToPngObjectUrl({
                url,
                filename,
                mimetype,
                signal: controller.signal,
              });

              if (controller.signal.aborted) return;
              if (file.value?.name !== expectedFileName) return;
              
              log.debug("图片预解码成功:", { filename, objectUrl: decoded.objectUrl });

              revokeObjectUrl(authenticatedPreviewUrl.value);
              authenticatedPreviewUrl.value = decoded.objectUrl;
              loadError.value = false;
            } catch (decodeError) {
              if (controller.signal.aborted) return;
              log.error("图片预解码失败:", decodeError);
              loadError.value = true;
              emit("error", decodeError);
            } finally {
              if (!controller.signal.aborted) {
                isDecodingImage.value = false;
              }
              if (imageDecodeAbortController.value === controller) {
                imageDecodeAbortController.value = null;
              }
            }

            return;
          }

          authenticatedPreviewUrl.value = url;
        } else if (
          typeChecks.isVideo ||
          typeChecks.isAudio ||
          typeChecks.isPdf ||
          typeChecks.isEbook ||
          typeChecks.isText ||
          (file.value?.name && isArchiveFile(file.value.name))
        ) {
          // 直接使用 previewUrl 作为预览入口
          authenticatedPreviewUrl.value = previewUrl.value;
        }

        // 如果是Office文件，更新Office预览URL
        if (typeChecks.isOffice) {
          updateOfficePreviewUrls();
        }
      }
    },
    { immediate: true }
  );

  // ===== 生命周期钩子 =====

  /**
   * 组件挂载时的初始化
   */
  onMounted(() => {
    log.debug("文件预览组件已挂载");
  });

  /**
   * 组件卸载时的清理
   */
  onUnmounted(() => {
    // 清理URL资源
    revokeObjectUrl(authenticatedPreviewUrl.value);
    authenticatedPreviewUrl.value = null;
    if (imageDecodeAbortController.value) {
      imageDecodeAbortController.value.abort();
      imageDecodeAbortController.value = null;
    }

    // 清除计时器
    if (previewTimeoutId.value) {
      clearTimeout(previewTimeoutId.value);
      previewTimeoutId.value = null;
    }

    log.debug("文件预览组件已卸载");
  });

  // ===== 扩展功能将在上层集成 =====
  // 移除了对 useFilePreviewExtensions 的直接调用以避免循环依赖

  return {
    // 保留的状态
    loadError,
    authenticatedPreviewUrl,
    officePreviewLoading,
    officePreviewError,
    officePreviewTimedOut,
    previewTimeoutId,
    isOfficeFullscreen,

    // 保留的计算属性
    fileTypeInfo,
    isImage: isImageFile,
    isVideo: isVideoFile,
    isAudio: isAudioFile,
    isPdf: isPdfFile,
    isOffice: isOfficeFile,
    isText: isTextFile,
    previewUrl,

    // 保留的DOM引用
    officePreviewRef,

    // 保留的方法
    fetchAuthenticatedUrl,
    updateOfficePreviewUrls,
    initializePreview,
    toggleFullscreen,
    handleFullscreenChange,
    handleKeyDown,
    handleContentLoaded,
    handleContentError,
    formatFileSize,
    formatDate,
    toggleOfficeFullscreen,
    reinitializePreviewOnThemeChange,
    initializeForFile,

    // 扩展功能将在上层集成
  };
}
