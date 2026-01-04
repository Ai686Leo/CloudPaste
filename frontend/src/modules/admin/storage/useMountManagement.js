import { ref, computed, watch, onMounted } from "vue";
import { useAdminBase } from "@/composables/admin-management/useAdminBase.js";
import { useAuthStore } from "@/stores/authStore.js";
import { useStorageConfigsStore } from "@/stores/storageConfigsStore.js";
import { useI18n } from "vue-i18n";
import { formatDateTimeWithSeconds, formatDateTime } from "@/utils/timeUtils.js";
import { useAdminMountService } from "@/modules/admin/services/mountService.js";
import { useAdminApiKeyService } from "@/modules/admin/services/apiKeyService.js";
import { useStorageTypePresentation } from "@/modules/admin/storage/useStorageTypePresentation.js";
import { createLogger } from "@/utils/logger.js";

/**
 * 挂载点管理专用composable
 * @param {Object} options - 可选配置
 * @param {Function} options.confirmFn - 确认对话框函数（必需），接收 {title, message, confirmType}，返回 Promise<boolean>
 */
export function useMountManagement(options = {}) {
  const { confirmFn } = options;
  if (!confirmFn) {
    throw new Error("useMountManagement 必须传入 confirmFn（请在 View 里用 useConfirmDialog + createConfirmFn 创建）");
  }

  // 继承基础管理功能（含视图模式切换）
  const base = useAdminBase("mount", {
    viewMode: {
      storageKey: 'mount-view-mode',
      defaultMode: 'grid',
    },
  });
  const { getMountsList, updateMount, createMount, deleteMount } = useAdminMountService();
  const { getAllApiKeys } = useAdminApiKeyService();

  // 国际化
  const { t } = useI18n();
  const log = createLogger("MountManagement");

  // 使用认证Store
  const authStore = useAuthStore();

  // 挂载点管理特有状态
  const mounts = ref([]);
  const storageConfigsStore = useStorageConfigsStore();
  const storageConfigs = computed(() => storageConfigsStore.sortedConfigs);
  const storageConfigsLoading = computed(() => storageConfigsStore.isLoading);
  const apiKeyNames = ref({});
  const showForm = ref(false);
  const currentMount = ref(null);
  const searchQuery = ref("");

  // 行级加载状态：正在操作的挂载点 ID 集合
  const togglingMountIds = ref(new Set());
  const deletingMountIds = ref(new Set());

  // 存储类型展示/样式 helper（用于 UI 主题等行为）
  const { getBadgeClass, ensureLoaded: ensureStorageTypesLoaded } = useStorageTypePresentation();

  // 从 base 获取视图模式（别名 toggleViewMode 保持兼容）
  const { viewMode, switchViewMode: toggleViewMode } = base;

  // 挂载管理专用分页配置：每页默认 6 条，自定义可选项
  const pageSizeOptions = [6, 12, 24, 48, 96];
  if (base.pagination.limit === 20) {
    base.pagination.limit = pageSizeOptions[0];
  }

  // 权限计算属性
  const isAdmin = computed(() => authStore.isAdmin);
  const isApiKeyUser = computed(() => authStore.authType === "apikey" && authStore.hasMountPermission);
  const isAuthorized = computed(() => isAdmin.value || isApiKeyUser.value);

  const apiUpdateMount = (id, mountData) => {
    if (!isAdmin.value) {
      throw new Error("API密钥用户无权限更新挂载点");
    }
    return updateMount(id, mountData);
  };

  const apiDeleteMount = (id) => {
    if (!isAdmin.value) {
      throw new Error("API密钥用户无权限删除挂载点");
    }
    return deleteMount(id);
  };

  /**
   * 搜索过滤计算属性
   */
  const filteredMounts = computed(() => {
    if (!searchQuery.value) {
      return mounts.value;
    }

    const query = searchQuery.value.toLowerCase();
    return mounts.value.filter(
      (mount) =>
        mount.name.toLowerCase().includes(query) ||
        mount.mount_path.toLowerCase().includes(query) ||
        mount.storage_type.toLowerCase().includes(query) ||
        (mount.remark && mount.remark.toLowerCase().includes(query))
    );
  });

  /**
   * 更新分页信息（挂载点专用逻辑）
   */
  const updateMountPagination = () => {
    base.pagination.total = filteredMounts.value.length;
    base.pagination.hasMore = base.pagination.offset + base.pagination.limit < base.pagination.total;
  };

  // 监听过滤结果变化，自动同步分页信息
  watch(
    filteredMounts,
    () => {
      updateMountPagination();
    },
    { immediate: true }
  );

  /**
   * 格式化日期显示（包含时分秒）
   */
  const formatDate = (dateString) => {
    if (!dateString) return "-";
    return formatDateTimeWithSeconds(dateString);
  };


  const formatDateOnly = (dateString) => {
    if (!dateString) return "-";
    return formatDateTime(dateString, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };
  
  /**
   * 加载存储配置列表
   */
  const loadStorageConfigs = async (options = {}) => {
    try {
      if (options.force) {
        await storageConfigsStore.refreshConfigs();
      } else {
        await storageConfigsStore.loadConfigs();
      }
    } catch (err) {
      log.error("加载存储配置列表错误:", err);
    }
  };

  /**
   * 根据ID获取存储配置
   */
  const getStorageConfigById = (configId) => {
    return storageConfigsStore.getConfigById(configId);
  };

  /**
   * 加载API密钥名称列表
   */
  const loadApiKeyNames = async () => {
    try {
      // 根据用户类型选择不同的加载方式
      if (isAdmin.value) {
        // 管理员用户 - 加载所有API密钥
        const keys = await getAllApiKeys();
        const keyMap = {};
        (Array.isArray(keys) ? keys : []).forEach((key) => {
          keyMap[key.id] = key.name;
        });
        apiKeyNames.value = keyMap;
      } else {
        // API密钥用户 - 只加载当前API密钥信息
        const keyInfo = authStore.apiKeyInfo;
        if (keyInfo && keyInfo.id) {
          const keyMap = {};
          keyMap[keyInfo.id] = keyInfo.name || t("admin.mount.currentApiKey");
          apiKeyNames.value = keyMap;
        }
      }
    } catch (err) {
      log.error("加载API密钥列表错误:", err);
    }
  };

  /**
   * 加载挂载点列表
   * 使用统一API，根据用户权限自动返回相应数据
   * @param {Object} options - 可选配置
   * @param {boolean} options.silent - 是否静默加载
   */
  const loadMounts = async (options = {}) => {
    const { silent = false } = options;

    // 静默模式
    // 失败时保留现有数据，不清空列表
    if (silent) {
      try {
        const data = await getMountsList();
        mounts.value = Array.isArray(data) ? data : [];

        if (mounts.value.length > 0) {
          base.updateLastRefreshTime();
        }

        updateMountPagination();

        if (!storageConfigs.value.length) {
          await loadStorageConfigs();
        }

        const needsApiKeys = mounts.value.some(
          (mount) =>
            mount.created_by &&
            (mount.created_by.startsWith("apikey:") || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mount.created_by))
        );

        if (needsApiKeys) {
          await loadApiKeyNames();
        }
      } catch (err) {
        // 静默模式失败：仅记录日志，保留现有数据，不清空列表
        log.error("静默加载挂载点列表失败:", err);
      }
      return;
    }

    // 非静默模式：触发全局 loading（用于首次加载或手动刷新）
    return await base.withLoading(async () => {
      try {
        const data = await getMountsList();
        mounts.value = Array.isArray(data) ? data : [];

        if (mounts.value.length > 0) {
          base.updateLastRefreshTime();
        }

        updateMountPagination();

        if (!storageConfigs.value.length) {
          await loadStorageConfigs();
        }

        const needsApiKeys = mounts.value.some(
          (mount) =>
            mount.created_by &&
            (mount.created_by.startsWith("apikey:") || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mount.created_by))
        );

        if (needsApiKeys) {
          await loadApiKeyNames();
        }
      } catch (err) {
        // 非静默模式失败：显示错误提示，清空列表（首次加载场景）
        log.error("加载挂载点列表错误:", err);
        base.showError(err.message || t("admin.mount.error.loadFailed"));
        mounts.value = [];
      }
    });
  };

  /**
   * 处理分页变化
   */
  const handleOffsetChange = (newOffset) => {
    base.handlePaginationChange(newOffset, "offset");
    // 挂载点列表使用前端分页，这里不需要重新请求后端
  };

  /**
   * 处理每页数量变化
   */
  const handleLimitChange = (newLimit) => {
    base.changePageSize(newLimit);
    // 重置到第一页
    base.handlePaginationChange(0, "offset");
    updateMountPagination();
  };

  // 初始化时确保存储类型元数据加载完成（用于 UI 主题等）
  onMounted(() => {
    ensureStorageTypesLoaded();
  });

  /**
   * 打开新建表单
   */
  const openCreateForm = () => {
    currentMount.value = null;
    showForm.value = true;
  };

  /**
   * 打开编辑表单
   */
  const openEditForm = (mount) => {
    currentMount.value = { ...mount };
    showForm.value = true;
  };

  /**
   * 关闭表单
   */
  const closeForm = () => {
    showForm.value = false;
    currentMount.value = null;
  };

  /**
   * 表单保存成功的处理函数
   */
  const handleFormSaveSuccess = (success = true, message = null) => {
    const wasEdit = !!currentMount.value;
    closeForm();

    // 如果操作失败，显示错误消息
    if (success === false) {
      base.showError(message || t("admin.mount.error.updateFailed"));
      return;
    }

    // 显示成功消息
    base.showSuccess(
      message || (wasEdit ? t("admin.mount.success.updated") : t("admin.mount.success.created")),
    );

    // 重新加载挂载点列表
    loadMounts();
  };

  /**
   * 删除挂载点（行级加载状态，不影响全局 loading）
   */
  const confirmDelete = async (id) => {
    const confirmed = await confirmFn({
      title: t("common.dialogs.deleteTitle"),
      message: t("common.dialogs.deleteItem", { name: t("admin.mount.item", "此挂载点") }),
      confirmType: "danger",
    });

    if (!confirmed) {
      return;
    }

    // 添加到正在删除集合
    deletingMountIds.value = new Set([...deletingMountIds.value, id]);
    try {
      // 根据用户类型调用相应的API函数
      await apiDeleteMount(id);

      base.showSuccess(t("admin.mount.success.deleted"));
      // 静默刷新挂载点列表
      await loadMounts({ silent: true });
    } catch (err) {
      log.error("删除挂载点错误:", err);
      base.showError(err.message || t("admin.mount.error.deleteFailed"));
    } finally {
      // 从正在删除集合中移除
      const newSet = new Set(deletingMountIds.value);
      newSet.delete(id);
      deletingMountIds.value = newSet;
    }
  };

  /**
   * 切换挂载点启用/禁用状态
   */
  const toggleActive = async (mount) => {
    // 确定操作类型（用于提示消息）
    const action = mount.is_active ? t("admin.mount.actions.disable") : t("admin.mount.actions.enable");

    // 只有管理员可以切换挂载点状态
    if (isApiKeyUser.value) {
      base.showError(t("admin.mount.error.apiKeyNoPermission"));
      return;
    }

    // 添加到正在切换集合
    togglingMountIds.value = new Set([...togglingMountIds.value, mount.id]);
    try {
      // 准备更新数据，只包含is_active字段
      const updateData = {
        is_active: !mount.is_active,
      };

      await apiUpdateMount(mount.id, updateData);

      base.showSuccess(mount.is_active ? t("admin.mount.success.disabled") : t("admin.mount.success.enabled"));
      // 静默刷新挂载点列表
      await loadMounts({ silent: true });
    } catch (err) {
      log.error(`${action}挂载点错误:`, err);
      base.showError(err.message || (mount.is_active ? t("admin.mount.error.disableFailed") : t("admin.mount.error.enableFailed")));
    } finally {
      // 从正在切换集合中移除
      const newSet = new Set(togglingMountIds.value);
      newSet.delete(mount.id);
      togglingMountIds.value = newSet;
    }
  };

  const getStorageTypeClass = (storageType, darkModeValue = false) => {
    return getBadgeClass(storageType, darkModeValue);
  };

  /**
   * 获取状态样式类
   */
  const getStatusClass = (isActive, darkModeValue = false) => {
    if (isActive) {
      return darkModeValue ? "bg-green-700 text-green-100" : "bg-green-100 text-green-800";
    } else {
      return darkModeValue ? "bg-red-700 text-red-100" : "bg-red-100 text-red-800";
    }
  };

  /**
   * 获取创建者类型，用于后续格式化和样式计算
   */
  const getCreatorType = (mount) => {
    if (!mount.created_by) {
      return "system";
    }

    if (mount.created_by === "admin") {
      return "admin";
    }

    // 处理带"apikey:"前缀的API密钥ID
    if (typeof mount.created_by === "string" && mount.created_by.startsWith("apikey:")) {
      return "apikey";
    }

    // 检查是否在已知的API密钥列表中的UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mount.created_by) && apiKeyNames.value && apiKeyNames.value[mount.created_by]) {
      return "apikey";
    }

    // UUID格式但不在已知API密钥列表中，则视为管理员
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mount.created_by)) {
      return "admin";
    }

    // 默认为其他类型
    return "other";
  };

  /**
   * 格式化创建者信息显示
   */
  const formatCreator = (mount) => {
    const creatorType = getCreatorType(mount);

    if (creatorType === "system") {
      return t("admin.mount.creators.system", "系统");
    }

    if (creatorType === "admin") {
      return t("admin.mount.creators.admin", "管理员");
    }

    if (creatorType === "apikey") {
      // 获取API密钥ID
      let keyId = mount.created_by;
      if (mount.created_by.startsWith("apikey:")) {
        keyId = mount.created_by.substring(7);
      }

      // 显示API密钥名称或缩略ID
      if (apiKeyNames.value && apiKeyNames.value[keyId]) {
        return `${t("admin.mount.creators.apiKey", "密钥")}：${apiKeyNames.value[keyId]}`;
      } else if (keyId.length > 10) {
        return `${t("admin.mount.creators.apiKey", "密钥")}：${keyId.substring(0, 5)}...`;
      } else {
        return `${t("admin.mount.creators.apiKey", "密钥")}：${keyId}`;
      }
    }

    // 默认直接返回创建者值
    return mount.created_by;
  };

  /**
   * 获取创建者标签的样式类
   */
  const getCreatorClass = (mount, darkModeValue = false) => {
    const creatorType = getCreatorType(mount);

    // 根据创建者类型返回对应样式
    if (creatorType === "system") {
      return darkModeValue ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-700";
    }

    if (creatorType === "admin") {
      return darkModeValue ? "bg-green-900/50 text-green-200 border border-green-800/50" : "bg-green-100 text-green-800 border border-green-200";
    }

    if (creatorType === "apikey") {
      return darkModeValue ? "bg-blue-900/50 text-blue-200 border border-blue-800/50" : "bg-blue-100 text-blue-800 border border-blue-200";
    }

    // 默认样式
    return darkModeValue ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-700";
  };

  /**
   * 获取创建者显示名称（保持向后兼容）
   */
  const getCreatorDisplayName = (createdBy) => {
    if (!createdBy) return t("admin.mount.info.unknownCreator");

    // 如果是API密钥创建的
    if (createdBy.startsWith("apikey:")) {
      const keyId = createdBy.replace("apikey:", "");
      return apiKeyNames.value[keyId] || t("admin.mount.info.unknownApiKey");
    }

    // 如果是UUID格式（API密钥ID）
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(createdBy)) {
      return apiKeyNames.value[createdBy] || t("admin.mount.info.unknownApiKey");
    }

    // 否则认为是管理员创建的
    return t("admin.mount.info.admin");
  };

  /**
   * 格式化存储类型显示
   */
  const formatStorageType = (mount) => {
    // 基本验证
    if (!mount) return "-";

    if (mount.storage_config_id) {
      if (!storageConfigs.value.length && storageConfigsLoading.value) {
        return `${mount.storage_type || "-"} (加载中...)`;
      }

      const config = getStorageConfigById(mount.storage_config_id);
      if (config) {
        return storageConfigsStore.formatProviderLabel(config);
      }

      return `${mount.storage_type || "-"} (ID: ${mount.storage_config_id})`;
    }

    return storageConfigsStore.getStorageTypeLabel(mount.storage_type) || mount.storage_type || "-";
  };

  /**
   * 判断挂载点是否正在切换状态
   */
  const isMountToggling = (mountId) => {
    return togglingMountIds.value.has(mountId);
  };

  /**
   * 判断挂载点是否正在删除
   */
  const isMountDeleting = (mountId) => {
    return deletingMountIds.value.has(mountId);
  };

  return {
    // 继承基础功能
    ...base,

    // 挂载点管理特有状态
    mounts,
    storageConfigs,
    storageConfigsLoading,
    apiKeyNames,
    showForm,
    currentMount,
    searchQuery,
    filteredMounts,
    pageSizeOptions,
    viewMode,

    // 行级加载状态
    togglingMountIds,
    deletingMountIds,
    isMountToggling,
    isMountDeleting,

    // 权限状态
    isAdmin,
    isApiKeyUser,
    isAuthorized,

    // 挂载点管理方法
    loadMounts,
    loadStorageConfigs,
    loadApiKeyNames,
    handleOffsetChange,
    handleLimitChange,
    openCreateForm,
    openEditForm,
    closeForm,
    handleFormSaveSuccess,
    confirmDelete,
    toggleActive,
    toggleViewMode,

    // 工具方法
    formatDate,
    formatDateOnly,
    getStorageConfigById,
    updateMountPagination,
    getStorageTypeClass,
    getStatusClass,
    getCreatorType,
    formatCreator,
    getCreatorClass,
    getCreatorDisplayName,
    formatStorageType,
  };
}
