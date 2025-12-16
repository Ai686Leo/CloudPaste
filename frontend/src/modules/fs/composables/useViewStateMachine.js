import { ref, computed } from 'vue';
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
  // ==================== 核心状态 ====================
  /**
   * 当前视图状态
   * @type {import('vue').Ref<string>}
   */
  const viewState = ref(ViewState.INITIAL);

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
  const showFilePreview = computed(() => shouldShowFilePreview(viewState.value));

  /**
   * 是否有错误
   */
  const hasError = computed(() => isErrorState(viewState.value));

  /**
   * 是否需要密码
   */
  const needsPassword = computed(() => needsPasswordState(viewState.value));

  /**
   * 当前预览文件名（从已加载的 fileData 推导）
   * @type {import('vue').ComputedRef<string|null>}
   */
  const previewFileName = computed(() => fileData.value?.name || null);

  // ==================== 状态转换方法 ====================

  /**
   * 开始加载目录
   * @param {string} path - 目录路径
   */
  function startLoadingDirectory(path) {
    // 更新状态
    viewState.value = ViewState.LOADING_DIRECTORY;
    errorInfo.value = null;
  }

  /**
   * 目录加载完成
   * @param {Object} data - 目录数据
   */
  function onDirectoryLoaded(data) {
    directoryData.value = data;
    viewState.value = ViewState.DIRECTORY_LOADED;
  }

  /**
   * 开始加载文件预览
   * @param {string} filePath - 文件路径（不以 / 结尾）
   * @param {string} path - 文件所在目录路径（以 / 结尾）
   */
  function startLoadingFile(filePath, path) {
    // 更新状态
    viewState.value = ViewState.LOADING_FILE;
    errorInfo.value = null;
  }

  /**
   * 文件预览加载完成
   * @param {Object} data - 文件数据
   */
  function onFileLoaded(data) {
    fileData.value = data;
    viewState.value = ViewState.FILE_LOADED;
  }

  /**
   * 关闭文件预览,返回目录视图
   */
  function closeFilePreview() {
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
   * 重置状态机到初始状态
   */
  function reset() {
    viewState.value = ViewState.INITIAL;
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
  // 注意：URL 的变化由 controller 统一驱动；状态机本身不直接依赖路由。

  // ==================== 返回状态机实例 ====================
  return {
    // 状态
    viewState,
    directoryData,
    fileData,
    errorInfo,

    // 计算属性
    isLoading,
    showDirectory,
    showFilePreview,
    hasError,
    needsPassword,
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
    reset,
  };
}
