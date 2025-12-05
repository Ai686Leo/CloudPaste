/**
 * FS Meta 元信息管理 Composable
 *
 * 说明：
 * - 属于 Admin 模块下的业务组合逻辑
 * - 继承 useAdminBase 获取统一的状态管理、分页、消息处理等功能
 * - 仅负责业务逻辑，不直接处理 UI
 */
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useAdminBase } from "@/composables/admin-management/useAdminBase.js";
import {
  getAllFsMeta,
  createFsMeta,
  updateFsMeta,
  deleteFsMeta,
} from "@/api/services/fsMetaService.js";

export function useFsMetaManagement() {
  const { t } = useI18n();

  // 继承 useAdminBase 获取统一功能
  const base = useAdminBase("fsMeta");

  // 业务数据
  const metaList = ref([]);

  // 搜索状态
  const searchQuery = ref("");
  const isSearchMode = ref(false);
  const searchLoading = ref(false);

  // 表单状态
  const showForm = ref(false);
  const currentMeta = ref(null);

  // 删除确认状态
  const showDeleteConfirm = ref(false);
  const metaToDelete = ref(null);

  /**
   * 筛选后的列表 (前端搜索)
   */
  const filteredMetaList = computed(() => {
    if (!isSearchMode.value || !searchQuery.value.trim()) {
      return metaList.value;
    }
    const query = searchQuery.value.trim().toLowerCase();
    return metaList.value.filter((meta) =>
      meta.path.toLowerCase().includes(query)
    );
  });

  /**
   * 当前页数据 (基于分页)
   */
  const paginatedMetaList = computed(() => {
    const start = base.pagination.offset;
    const end = start + base.pagination.limit;
    return filteredMetaList.value.slice(start, end);
  });

  /**
   * 更新分页信息
   */
  const updatePaginationFromList = () => {
    const total = filteredMetaList.value.length;
    base.updatePagination({ total }, "offset");
  };

  /**
   * 加载所有元信息记录
   */
  const loadMetaList = async () => {
    return base.withLoading(async () => {
      const response = await getAllFsMeta();
      metaList.value = response.data || [];
      updatePaginationFromList();
      base.updateLastRefreshTime();
    }, {
      showErrorOnCatch: true,
    }).catch((err) => {
      base.showError(err.message || t("admin.fsMeta.error.loadFailed"));
    });
  };

  /**
   * 创建元信息
   */
  const createMeta = async (data) => {
    return base.withLoading(async () => {
      await createFsMeta(data);
      await loadMetaList();
      base.showSuccess(t("admin.fsMeta.success.created"));
      return true;
    }, {
      showErrorOnCatch: false,
    }).catch((err) => {
      base.showError(err.message || t("admin.fsMeta.error.createFailed"));
      return false;
    });
  };

  /**
   * 更新元信息
   */
  const updateMeta = async (id, data) => {
    return base.withLoading(async () => {
      await updateFsMeta(id, data);
      await loadMetaList();
      base.showSuccess(t("admin.fsMeta.success.updated"));
      return true;
    }, {
      showErrorOnCatch: false,
    }).catch((err) => {
      base.showError(err.message || t("admin.fsMeta.error.updateFailed"));
      return false;
    });
  };

  /**
   * 删除元信息
   */
  const deleteMeta = async (id) => {
    return base.withLoading(async () => {
      await deleteFsMeta(id);
      await loadMetaList();
      base.showSuccess(t("admin.fsMeta.success.deleted"));
      return true;
    }, {
      showErrorOnCatch: false,
    }).catch((err) => {
      base.showError(err.message || t("admin.fsMeta.error.deleteFailed"));
      return false;
    });
  };

  // ========== 搜索功能 ==========

  /**
   * 处理全局搜索
   */
  const handleGlobalSearch = (value) => {
    searchQuery.value = value;

    if (!value || value.trim().length < 2) {
      clearSearch();
      return;
    }

    searchLoading.value = true;
    isSearchMode.value = true;

    // 重置分页到第一页
    base.resetPagination();
    updatePaginationFromList();

    searchLoading.value = false;
  };

  /**
   * 清除搜索
   */
  const clearSearch = () => {
    searchQuery.value = "";
    isSearchMode.value = false;
    base.resetPagination();
    updatePaginationFromList();
  };

  // ========== 表单管理 ==========

  /**
   * 打开创建表单
   */
  const openCreateForm = () => {
    currentMeta.value = null;
    showForm.value = true;
  };

  /**
   * 打开编辑表单
   */
  const openEditForm = (meta) => {
    currentMeta.value = { ...meta };
    showForm.value = true;
  };

  /**
   * 关闭表单
   */
  const closeForm = () => {
    showForm.value = false;
    currentMeta.value = null;
  };

  /**
   * 处理表单保存
   */
  const handleFormSave = async (data) => {
    let success;
    if (currentMeta.value) {
      success = await updateMeta(currentMeta.value.id, data);
    } else {
      success = await createMeta(data);
    }

    if (success) {
      closeForm();
      // 如果在搜索模式，更新筛选结果
      if (isSearchMode.value && searchQuery.value) {
        updatePaginationFromList();
      }
    }
    return success;
  };

  // ========== 删除确认管理 ==========

  /**
   * 确认删除
   */
  const confirmDelete = (meta) => {
    metaToDelete.value = meta;
    showDeleteConfirm.value = true;
  };

  /**
   * 执行删除
   */
  const handleDelete = async () => {
    if (!metaToDelete.value) return false;

    const success = await deleteMeta(metaToDelete.value.id);
    if (success) {
      cancelDelete();
      // 如果在搜索模式，更新筛选结果
      if (isSearchMode.value && searchQuery.value) {
        updatePaginationFromList();
      }
    }
    return success;
  };

  /**
   * 取消删除
   */
  const cancelDelete = () => {
    showDeleteConfirm.value = false;
    metaToDelete.value = null;
  };

  // ========== 分页处理 ==========

  /**
   * 处理分页偏移变化
   */
  const handleOffsetChange = (newOffset) => {
    base.handlePaginationChange(newOffset, "offset");
  };

  /**
   * 处理每页数量变化
   */
  const handlePageSizeChange = (newPageSize) => {
    base.changePageSize(newPageSize);
    updatePaginationFromList();
  };

  return {
    // 来自 useAdminBase 的状态
    loading: base.loading,
    error: base.error,
    pagination: base.pagination,
    pageSizeOptions: base.pageSizeOptions,
    lastRefreshTime: base.lastRefreshTime,

    // 业务数据
    metaList,
    filteredMetaList,
    paginatedMetaList,

    // 搜索状态
    searchQuery,
    isSearchMode,
    searchLoading,

    // 表单状态
    showForm,
    currentMeta,

    // 删除确认状态
    showDeleteConfirm,
    metaToDelete,

    // CRUD 方法
    loadMetaList,
    createMeta,
    updateMeta,
    deleteMeta,

    // 搜索方法
    handleGlobalSearch,
    clearSearch,

    // 表单方法
    openCreateForm,
    openEditForm,
    closeForm,
    handleFormSave,

    // 删除确认方法
    confirmDelete,
    handleDelete,
    cancelDelete,

    // 分页方法
    handleOffsetChange,
    handlePageSizeChange,

    // 工具方法
    showSuccess: base.showSuccess,
    showError: base.showError,
  };
}
