import { ref, reactive, onMounted, onUnmounted } from "vue";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";
import { formatCurrentTime } from "@/utils/timeUtils.js";

/**
 * 管理功能基础composable
 * 提供通用的状态管理、选择逻辑、消息处理、视图模式、移动端检测等
 *
 * @param {string} pageKey - 页面标识符，用于区分不同页面的分页设置
 * @param {Object} options - 可选配置
 * @param {Object} [options.viewMode] - 视图模式配置
 * @param {string} options.viewMode.storageKey - localStorage 键名
 * @param {string} options.viewMode.defaultMode - 默认视图模式
 * @param {Object} [options.viewMode.responsive] - 响应式配置
 * @param {number} options.viewMode.responsive.breakpoint - 断点宽度
 * @param {string} options.viewMode.responsive.mobileMode - 移动端模式
 * @param {string} options.viewMode.responsive.desktopMode - 桌面端模式
 * @param {Object|boolean} [options.mobileDetect] - 移动端检测配置
 * @param {number} [options.mobileDetect.breakpoint=768] - 断点宽度
 *
 * @example
 * // 基础用法
 * const base = useAdminBase("key-management");
 *
 * @example
 * // 带视图模式切换
 * const base = useAdminBase("tasks", {
 *   viewMode: {
 *     storageKey: 'admin-tasks-view-mode',
 *     defaultMode: 'table',
 *     responsive: { breakpoint: 640, mobileMode: 'card', desktopMode: 'table' }
 *   }
 * });
 *
 * @example
 * // 带移动端检测
 * const base = useAdminBase("key-management", {
 *   mobileDetect: { breakpoint: 768 }
 * });
 *
 * @example
 * // 全部功能
 * const base = useAdminBase("tasks", {
 *   viewMode: { storageKey: 'xxx', defaultMode: 'table' },
 *   mobileDetect: true
 * });
 */
export function useAdminBase(pageKey = "default", options = {}) {
  const { viewMode: viewModeConfig = null, mobileDetect: mobileDetectConfig = null } = options;

  const globalMessage = useGlobalMessage();

  // ========== 基础状态管理 ==========
  const loading = ref(false);
  const error = ref("");
  const successMessage = ref("");
  const selectedItems = ref([]);
  const lastRefreshTime = ref("");

  // ========== 分页管理 ==========
  const pageSizeOptions = [10, 20, 30, 50, 100];

  const getDefaultPageSize = () => {
    let saved = null;
    try {
      saved = localStorage.getItem("admin-page-size");
      if (saved) {
        const pageSizes = JSON.parse(saved);
        return pageSizes[pageKey] || 20;
      }
    } catch (error) {
      const oldValue = parseInt(saved, 10) || 20;
      const newFormat = { default: oldValue };
      localStorage.setItem("admin-page-size", JSON.stringify(newFormat));
      return pageKey === "default" ? oldValue : 20;
    }
    return 20;
  };

  const pagination = reactive({
    limit: getDefaultPageSize(),
    total: 0,
    page: 1,
    totalPages: 0,
    offset: 0,
    hasMore: false,
  });

  const updatePagination = (data, mode = "page") => {
    if (mode === "page") {
      pagination.total = data.total || 0;
      pagination.totalPages = Math.ceil(pagination.total / pagination.limit);
    } else {
      pagination.total = data.total || 0;
      pagination.hasMore = data.hasMore !== undefined ? data.hasMore : pagination.offset + pagination.limit < pagination.total;
      if (data.limit !== undefined) pagination.limit = data.limit;
      if (data.offset !== undefined) pagination.offset = data.offset;
    }
  };

  const handlePaginationChange = (value, mode = "page") => {
    if (mode === "page") {
      pagination.page = value;
      pagination.offset = (value - 1) * pagination.limit;
    } else {
      pagination.offset = value;
      pagination.page = Math.floor(value / pagination.limit) + 1;
    }
  };

  const resetPagination = () => {
    pagination.page = 1;
    pagination.offset = 0;
  };

  const changePageSize = (newLimit) => {
    try {
      const saved = localStorage.getItem("admin-page-size");
      const pageSizes = saved ? JSON.parse(saved) : {};
      pageSizes[pageKey] = newLimit;
      localStorage.setItem("admin-page-size", JSON.stringify(pageSizes));
    } catch (error) {
      console.warn("保存分页设置失败:", error);
    }
    pagination.limit = newLimit;
    resetPagination();
  };

  // ========== 选择管理 ==========
  const toggleSelectItem = (id) => {
    const index = selectedItems.value.indexOf(id);
    if (index > -1) {
      selectedItems.value.splice(index, 1);
    } else {
      selectedItems.value.push(id);
    }
  };

  const toggleSelectAll = (allItems, idField = "id") => {
    if (selectedItems.value.length === allItems.length) {
      selectedItems.value = [];
    } else {
      selectedItems.value = allItems.map((item) => item[idField]);
    }
  };

  const clearSelection = () => {
    selectedItems.value = [];
  };

  // ========== 消息管理 ==========
  const showSuccess = (message, duration = 4000) => {
    successMessage.value = message;
    setTimeout(() => {
      successMessage.value = "";
    }, duration);
    globalMessage.showSuccess(message, duration);
  };

  const showError = (message) => {
    error.value = message;
    globalMessage.showError(message);
  };

  const clearMessages = () => {
    error.value = "";
    successMessage.value = "";
  };

  // ========== 刷新时间 ==========
  const updateLastRefreshTime = () => {
    lastRefreshTime.value = formatCurrentTime();
  };

  // ========== 加载包装器 ==========
  const withLoading = async (asyncFn, options = {}) => {
    const { clearMessagesFirst = true, showErrorOnCatch = true } = options;
    loading.value = true;
    if (clearMessagesFirst) clearMessages();

    try {
      const result = await asyncFn();
      return result;
    } catch (err) {
      console.error("操作失败:", err);
      if (showErrorOnCatch) {
        showError(err.message || "操作失败，请重试");
      }
      throw err;
    } finally {
      loading.value = false;
    }
  };

  // ========== 视图模式管理（可选） ==========
  const viewMode = ref(null);
  const userHasChosenView = ref(false);
  let switchViewMode = () => {};

  if (viewModeConfig) {
    const { storageKey, defaultMode, responsive } = viewModeConfig;

    if (!storageKey) {
      throw new Error("useAdminBase: viewMode.storageKey is required");
    }

    const getRecommendedMode = () => {
      if (!responsive) return defaultMode;
      const { breakpoint = 640, mobileMode, desktopMode } = responsive;
      return window.innerWidth < breakpoint ? mobileMode : desktopMode;
    };

    const getInitialMode = () => {
      const saved = localStorage.getItem(storageKey);
      if (saved) return saved;
      return responsive ? getRecommendedMode() : defaultMode;
    };

    viewMode.value = getInitialMode();
    userHasChosenView.value = !!localStorage.getItem(storageKey);

    switchViewMode = (mode) => {
      viewMode.value = mode;
      localStorage.setItem(storageKey, mode);
      userHasChosenView.value = true;
    };

    // 响应式处理
    if (responsive) {
      let lastBreakpointState = window.innerWidth < responsive.breakpoint;

      const handleViewResize = () => {
        const { breakpoint = 640, mobileMode, desktopMode } = responsive;
        const isNowMobile = window.innerWidth < breakpoint;

        // 只在跨越断点时强制切换视图
        if (isNowMobile !== lastBreakpointState) {
          lastBreakpointState = isNowMobile;
          const targetMode = isNowMobile ? mobileMode : desktopMode;
          if (viewMode.value !== targetMode) {
            viewMode.value = targetMode;
          }
        }
      };

      onMounted(() => {
        window.addEventListener("resize", handleViewResize);
      });

      onUnmounted(() => {
        window.removeEventListener("resize", handleViewResize);
      });
    }
  }

  // ========== 移动端检测（可选） ==========
  const isMobile = ref(false);
  let checkMobile = () => {};

  if (mobileDetectConfig) {
    const breakpoint = typeof mobileDetectConfig === "object" ? mobileDetectConfig.breakpoint || 768 : 768;

    checkMobile = () => {
      isMobile.value = window.innerWidth < breakpoint;
    };

    onMounted(() => {
      checkMobile();
      window.addEventListener("resize", checkMobile);
    });

    onUnmounted(() => {
      window.removeEventListener("resize", checkMobile);
    });
  }

  // ========== 返回值 ==========
  return {
    // 基础状态
    loading,
    error,
    successMessage,
    selectedItems,
    lastRefreshTime,
    pagination,
    pageSizeOptions,

    // 分页方法
    updatePagination,
    handlePaginationChange,
    resetPagination,
    changePageSize,

    // 选择方法
    toggleSelectItem,
    toggleSelectAll,
    clearSelection,

    // 消息方法
    showSuccess,
    showError,
    clearMessages,

    // 工具方法
    updateLastRefreshTime,
    withLoading,

    // 视图模式（可选功能）
    viewMode,
    userHasChosenView,
    switchViewMode,

    // 移动端检测（可选功能）
    isMobile,
    checkMobile,
  };
}
