import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ViewState,
  isLoadingState,
  shouldShowDirectory,
  shouldShowFilePreview,
  isErrorState,
  needsPassword as needsPasswordState,
} from '../constants/ViewState';

/**
 * FS模块视图状态机Hook
 *
 * 这个Hook管理整个FS模块的视图状态,包括:
 * - 状态转换逻辑
 * - 请求取消控制
 * - URL变化响应
 * - 数据存储
 *
 * @returns {Object} 状态机实例
 */
export function useViewStateMachine() {
  const route = useRoute();
  const router = useRouter();

  // ==================== 核心状态 ====================
  /**
   * 当前视图状态
   * @type {import('vue').Ref<string>}
   */
  const viewState = ref(ViewState.INITIAL);

  /**
   * 当前路径
   * @type {import('vue').Ref<string>}
   */
  const currentPath = ref('/');

  /**
   * 目录数据
   * @type {import('vue').Ref<Object|null>}
   */
  const directoryData = ref(null);

  /**
   * 文件数据
   * @type {import('vue').Ref<Object|null>}
   */
  const fileData = ref(null);

  /**
   * 错误信息
   * @type {import('vue').Ref<Object|null>}
   */
  const errorInfo = ref(null);

  // ==================== 请求控制 ====================
  /**
   * 目录请求的AbortController
   * @type {AbortController|null}
   */
  let directoryAbortController = null;

  /**
   * 文件请求的AbortController
   * @type {AbortController|null}
   */
  let fileAbortController = null;

  // ==================== 计算属性 ====================
  /**
   * 是否处于加载状态
   */
  const isLoading = computed(() => isLoadingState(viewState.value));

  /**
   * 是否应该显示目录列表
   */
  const showDirectory = computed(() => shouldShowDirectory(viewState.value));

  /**
   * 是否应该显示文件预览
   */
  const showFilePreview = computed(() => isInPreviewMode.value || shouldShowFilePreview(viewState.value));

  /**
   * 是否有错误
   */
  const hasError = computed(() => isErrorState(viewState.value));

  /**
   * 是否需要密码
   */
  const needsPassword = computed(() => needsPasswordState(viewState.value));

  /**
   * 是否在预览模式下(从URL判断)
   */
  const isInPreviewMode = computed(() => !!route.query.preview);

  /**
   * 预览文件名(从URL读取)
   */
  const previewFileName = computed(() => route.query.preview || null);

  // ==================== 状态转换方法 ====================

  /**
   * 开始加载目录
   * @param {string} path - 目录路径
   * @returns {AbortSignal} AbortSignal用于取消请求
   */
  function startLoadingDirectory(path) {
    // 取消之前的目录请求
    if (directoryAbortController) {
      directoryAbortController.abort();
    }

    // 创建新的AbortController
    directoryAbortController = new AbortController();

    // 更新状态
    currentPath.value = path;
    viewState.value = ViewState.LOADING_DIRECTORY;
    errorInfo.value = null;

    return directoryAbortController.signal;
  }

  /**
   * 目录加载完成
   * @param {Object} data - 目录数据
   */
  function onDirectoryLoaded(data) {
    directoryData.value = data;
    viewState.value = ViewState.DIRECTORY_LOADED;
    directoryAbortController = null;
  }

  /**
   * 开始加载文件预览
   * @param {string} fileName - 文件名
   * @param {string} path - 文件所在路径
   * @returns {AbortSignal} AbortSignal用于取消请求
   */
  function startLoadingFile(fileName, path = currentPath.value) {
    // 取消之前的文件请求
    if (fileAbortController) {
      fileAbortController.abort();
    }

    // 创建新的AbortController
    fileAbortController = new AbortController();

    // 更新状态
    currentPath.value = path;
    viewState.value = ViewState.LOADING_FILE;
    errorInfo.value = null;

    return fileAbortController.signal;
  }

  /**
   * 文件预览加载完成
   * @param {Object} data - 文件数据
   */
  function onFileLoaded(data) {
    fileData.value = data;
    viewState.value = ViewState.FILE_LOADED;
    fileAbortController = null;
  }

  /**
   * 关闭文件预览,返回目录视图
   */
  function closeFilePreview() {
    // 清除URL中的preview参数
    const query = { ...route.query };
    delete query.preview;
    router.replace({ query });

    // 重置文件数据
    fileData.value = null;

    // 如果有目录数据,返回目录状态
    if (directoryData.value) {
      viewState.value = ViewState.DIRECTORY_LOADED;
    } else {
      viewState.value = ViewState.INITIAL;
    }
  }

  /**
   * 设置需要密码状态
   */
  function requirePassword() {
    viewState.value = ViewState.PASSWORD_REQUIRED;
    errorInfo.value = null;
  }

  /**
   * 设置错误状态
   * @param {Error|string|Object} error - 错误信息
   */
  function setError(error) {
    viewState.value = ViewState.ERROR;

    // 标准化错误信息
    if (typeof error === 'string') {
      errorInfo.value = { message: error };
    } else if (error instanceof Error) {
      errorInfo.value = { message: error.message, stack: error.stack };
    } else {
      errorInfo.value = error;
    }
  }

  /**
   * 取消所有进行中的请求
   */
  function cancelAllRequests() {
    if (directoryAbortController) {
      directoryAbortController.abort();
      directoryAbortController = null;
    }
    if (fileAbortController) {
      fileAbortController.abort();
      fileAbortController = null;
    }
  }

  /**
   * 重置状态机到初始状态
   */
  function reset() {
    cancelAllRequests();
    viewState.value = ViewState.INITIAL;
    currentPath.value = '/';
    directoryData.value = null;
    fileData.value = null;
    errorInfo.value = null;
  }

  /**
   * 清除错误状态
   */
  function clearError() {
    errorInfo.value = null;
    if (viewState.value === ViewState.ERROR) {
      viewState.value = ViewState.INITIAL;
    }
  }

  // ==================== URL变化监听 ====================
  /**
   * 监听URL中的preview参数变化
   * 当preview参数被移除时,自动关闭预览
   */
  watch(
    () => route.query.preview,
    (newPreview, oldPreview) => {
      // preview参数从有变成无,关闭预览
      if (oldPreview && !newPreview) {
        fileData.value = null;
        if (directoryData.value) {
          viewState.value = ViewState.DIRECTORY_LOADED;
        } else {
          viewState.value = ViewState.INITIAL;
        }
      }
    }
  );

  // ==================== 返回状态机实例 ====================
  return {
    // 状态
    viewState,
    currentPath,
    directoryData,
    fileData,
    errorInfo,

    // 计算属性
    isLoading,
    showDirectory,
    showFilePreview,
    hasError,
    needsPassword,
    isInPreviewMode,
    previewFileName,

    // 状态转换方法
    startLoadingDirectory,
    onDirectoryLoaded,
    startLoadingFile,
    onFileLoaded,
    closeFilePreview,
    requirePassword,
    setError,
    clearError,
    cancelAllRequests,
    reset,
  };
}
