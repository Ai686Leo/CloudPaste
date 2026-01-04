import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useLocalStorage } from "@vueuse/core";
import { useAdminBase } from "@/composables/admin-management/useAdminBase.js";
import { useStorageConfigsStore } from "@/stores/storageConfigsStore.js";
import { useAdminStorageConfigService } from "@/modules/admin/services/storageConfigService.js";
import { createLogger } from "@/utils/logger.js";

/**
 * 存储配置管理 composable
 * 提供多存储配置的 CRUD、分页管理、测试等能力
 * @param {Object} options - 可选配置
 * @param {Function} options.confirmFn - 确认对话框函数（必需），接收 {title, message, confirmType}，返回 Promise<boolean>
 */
export function useStorageConfigManagement(options = {}) {
  const { confirmFn } = options;
  if (!confirmFn) {
    throw new Error("useStorageConfigManagement 必须传入 confirmFn（请在 View 里用 useConfirmDialog + createConfirmFn 创建）");
  }

  // 国际化
  const { t } = useI18n();
  const log = createLogger("StorageConfigManagement");

  // 继承基础功能，使用独立的页面标识符
  const base = useAdminBase("storage");
  const storageConfigsStore = useStorageConfigsStore();
  const { getStorageConfigs, getStorageConfigReveal, deleteStorageConfig, setDefaultStorageConfig, testStorageConfig } =
    useAdminStorageConfigService();

  const STORAGE_TYPE_UNKNOWN = "__UNSPECIFIED__";

  const refreshSharedConfigs = async () => {
    try {
      await storageConfigsStore.refreshConfigs();
    } catch (error) {
      log.warn("刷新全局存储配置缓存失败", error);
    }
  };

  // 存储配置状态
  const storageConfigs = ref([]);
  const currentConfig = ref(null);
  const showAddForm = ref(false);
  const showEditForm = ref(false);
  const testResults = ref({});

  // 行级加载状态：正在操作的配置 ID 集合
  const deletingConfigIds = ref(new Set());
  const settingDefaultConfigIds = ref(new Set());

  const storageTypeFilter = ref("all");

  const normalizeStorageTypeValue = (value) => {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    return STORAGE_TYPE_UNKNOWN;
  };

  const availableStorageTypes = computed(() => {
    const set = new Set();
    storageConfigs.value.forEach((config) => {
      set.add(normalizeStorageTypeValue(config.storage_type));
    });
    return Array.from(set);
  });

  const filteredConfigs = computed(() => {
    const filtered = storageTypeFilter.value === "all"
      ? storageConfigs.value
      : storageConfigs.value.filter((config) => normalizeStorageTypeValue(config.storage_type) === storageTypeFilter.value);

    // 前端分页：基于筛选结果切片
    const start = (base.pagination.page - 1) * base.pagination.limit;
    const end = start + base.pagination.limit;
    return filtered.slice(start, end);
  });

  watch(availableStorageTypes, (types) => {
    if (storageTypeFilter.value !== "all" && !types.includes(storageTypeFilter.value)) {
      storageTypeFilter.value = "all";
    }
  });

  // 筛选条件变化时重置到第一页
  watch(storageTypeFilter, () => {
    base.resetPagination();
  });

  // 测试详情模态框状态
  const showTestDetails = ref(false);
  const selectedTestResult = ref(null);
  const showDetailedResults = ref(true);

  // 存储配置分页选项：4、8、12
  const pageSizeOptions = [4, 8, 12];

  // 重写默认页面大小，默认 4 条记录
  const storedPageSizes = useLocalStorage("admin-page-size", {});
  const getDefaultPageSize = () => {
    try {
      const pageSizes = storedPageSizes.value;
      const savedSize =
        pageSizes && typeof pageSizes === "object"
          ? pageSizes["storage"] || 4
          : 4;
      // 确保保存的值在分页选项范围内，否则使用默认值 4
      return pageSizeOptions.includes(savedSize) ? savedSize : 4;
    } catch (error) {
      log.warn("解析存储配置分页设置失败:", error);
    }
    return 4;
  };

  // 重新初始化分页状态
  base.pagination.limit = getDefaultPageSize();

  // 筛选后的总数（用于分页）
  const filteredTotal = computed(() => {
    const filtered = storageTypeFilter.value === "all"
      ? storageConfigs.value
      : storageConfigs.value.filter((config) => normalizeStorageTypeValue(config.storage_type) === storageTypeFilter.value);
    return filtered.length;
  });

  // 监听筛选结果变化，更新分页
  watch([filteredTotal, () => base.pagination.limit], () => {
    base.updatePagination({ total: filteredTotal.value }, "page");
  });

  /**
   * 加载存储配置列表
   * @param {Object} options - 可选配置
   * @param {boolean} options.silent - 是否静默加载（不触发全局 loading 状态）
   */
  const loadStorageConfigs = async (options = {}) => {
    const { silent = false } = options;

    // 静默模式：不触发全局 loading，避免 DOM 重新挂载
    if (silent) {
      try {
        const { items } = await getStorageConfigs();
        storageConfigs.value = items;
        base.updatePagination({ total: filteredTotal.value }, "page");
        base.updateLastRefreshTime();
      } catch (error) {
        log.error("静默加载存储配置列表失败:", error);
        throw error;
      }
      return;
    }

    // 非静默模式：触发全局 loading（用于首次加载或手动刷新）
    return await base.withLoading(async () => {
      try {
        const { items } = await getStorageConfigs();
        storageConfigs.value = items;
        base.updatePagination({ total: filteredTotal.value }, "page");
        base.updateLastRefreshTime();
      } catch (error) {
        log.error("加载存储配置列表失败:", error);
        storageConfigs.value = [];
        throw error;
      }
    });
  };

  /**
   * 处理页码变化
   */
  const handlePageChange = (page) => {
    base.handlePaginationChange(page, "page");
  };

  /**
   * 处理每页数量变化
   */
  const handleLimitChange = (newLimit) => {
    base.changePageSize(newLimit);
  };

  /**
   * 删除存储配置（行级加载状态，不影响全局 loading）
   */
  const handleDeleteConfig = async (configId) => {
    const confirmed = await confirmFn({
      title: t("common.dialogs.deleteTitle"),
      message: t("common.dialogs.deleteItem", { name: t("admin.storage.item", "此存储配置") }),
      confirmType: "danger",
    });

    if (!confirmed) {
      return;
    }

    // 添加到正在删除集合
    deletingConfigIds.value = new Set([...deletingConfigIds.value, configId]);
    try {
      await deleteStorageConfig(configId);
      base.showSuccess("删除成功");
      // 静默刷新列表，避免 DOM 重新挂载
      await loadStorageConfigs({ silent: true });
      await refreshSharedConfigs();
    } catch (err) {
      log.error("删除存储配置失败:", err);
      if (err.message && err.message.includes("有文件正在使用")) {
        base.showError(`无法删除此配置：${err.message}`);
      } else {
        base.showError(err.message || "删除存储配置失败，请稍后再试");
      }
    } finally {
      // 从正在删除集合中移除
      const newSet = new Set(deletingConfigIds.value);
      newSet.delete(configId);
      deletingConfigIds.value = newSet;
    }
  };

  /**
   * 编辑配置（使用 masked 模式加载密钥字段）
   */
  const editConfig = async (config) => {
    try {
      // 使用 masked 模式重新加载配置，显示掩码占位符
      const maskedConfig = await getStorageConfigReveal(config.id, "masked");
      const finalConfig = maskedConfig?.data || maskedConfig || { ...config };

      currentConfig.value = finalConfig;
      showEditForm.value = true;
      showAddForm.value = false;
    } catch (err) {
      log.error("加载配置失败:", err);
      // 降级：使用原始配置
      currentConfig.value = { ...config };
      showEditForm.value = true;
      showAddForm.value = false;
    }
  };

  /**
   * 添加新配置
   */
  const addNewConfig = () => {
    currentConfig.value = null;
    showAddForm.value = true;
    showEditForm.value = false;
  };

  /**
   * 处理表单成功提交
   */
  const handleFormSuccess = async () => {
    showAddForm.value = false;
    showEditForm.value = false;
    await loadStorageConfigs();
    await refreshSharedConfigs();
  };

  /**
   * 设置默认配置（行级加载状态，不影响全局 loading）
   */
  const handleSetDefaultConfig = async (configId) => {
    // 添加到正在设置默认集合
    settingDefaultConfigIds.value = new Set([...settingDefaultConfigIds.value, configId]);
    try {
      await setDefaultStorageConfig(configId);
      base.showSuccess("设置默认配置成功");
      // 静默刷新列表，避免 DOM 重新挂载
      await loadStorageConfigs({ silent: true });
      await refreshSharedConfigs();
    } catch (err) {
      log.error("设置默认存储配置失败:", err);
      base.showError(err.message || "无法设置为默认配置，请稍后再试");
    } finally {
      // 从正在设置默认集合中移除
      const newSet = new Set(settingDefaultConfigIds.value);
      newSet.delete(configId);
      settingDefaultConfigIds.value = newSet;
    }
  };

  /**
   * 测试结果处理器类
   */
  class TestResultProcessor {
    constructor(testData) {
      this.raw = testData || {};
      this.success = this.raw?.success === true;
      this.message = typeof this.raw?.message === "string" ? this.raw.message : "";

      const report = this.raw?.report && typeof this.raw.report === "object" ? this.raw.report : null;
      this.report = report || { version: "", storageType: "", info: {}, checks: [] };
      this.checks = Array.isArray(this.report.checks) ? this.report.checks : [];
    }

    /**
     * 计算测试状态
     */
    calculateStatus() {
      const isFullSuccess = this.success;
      const anyOk = this.checks.some((c) => c && c.success === true);
      const isPartialSuccess = !isFullSuccess && anyOk;
      const isSuccess = isFullSuccess || isPartialSuccess;
      return { isFullSuccess, isPartialSuccess, isSuccess };
    }

    /**
     * 生成状态消息
     */
    generateStatusMessage() {
      if (this.message) return this.message;
      const status = this.calculateStatus();
      if (status.isFullSuccess) return "连接测试成功";
      if (status.isPartialSuccess) return "连接测试部分成功";
      return "连接测试失败";
    }

    /**
     * 生成简洁的状态消息
     */
    generateDetailsMessage() {
      const lines = [];
      for (const c of this.checks) {
        if (!c) continue;
        const label = c.label || c.key || "检查项";
        if (c.skipped) {
          lines.push(`✓ ${label}（已跳过）`);
          continue;
        }
        if (c.success) {
          lines.push(`✓ ${label} 正常`);
        } else {
          lines.push(`✗ ${label} 失败`);
          if (c.error) lines.push(`  ${String(c.error).split("\n")[0]}`);
        }
      }
      return lines.join("\n");
    }
  }

  /**
   * 测试存储配置连接
   */
  const testConnection = async (configId) => {
    try {
      testResults.value[configId] = { loading: true };
      const data = await testStorageConfig(configId);

      // 使用测试结果处理器
      const processor = new TestResultProcessor(data || {});
      const status = processor.calculateStatus();

      testResults.value[configId] = {
        success: status.isFullSuccess,
        partialSuccess: status.isPartialSuccess,
        message: processor.generateStatusMessage(),
        details: processor.generateDetailsMessage(),
        report: processor.report || null,
        loading: false,
      };
    } catch (err) {
      testResults.value[configId] = {
        success: false,
        partialSuccess: false,
        message: "测试连接失败",
        details: err.message || "无法连接到服务器",
        loading: false,
      };
    }
  };

  /**
   * 显示测试结果详情
   */
  const showTestDetailsModal = (configId) => {
    selectedTestResult.value = testResults.value[configId];
    showTestDetails.value = true;
    showDetailedResults.value = true;
  };

  /**
   * 判断配置是否正在删除
   */
  const isConfigDeleting = (configId) => {
    return deletingConfigIds.value.has(configId);
  };

  /**
   * 判断配置是否正在设置为默认
   */
  const isConfigSettingDefault = (configId) => {
    return settingDefaultConfigIds.value.has(configId);
  };

  return {
    // 继承基础功能
    ...base,

    // 重写分页选项
    pageSizeOptions,

    // 存储配置状态
    storageConfigs,
    filteredConfigs,
    storageTypeFilter,
    availableStorageTypes,
    currentConfig,
    showAddForm,
    showEditForm,
    testResults,
    showTestDetails,
    selectedTestResult,
    showDetailedResults,

    // 行级加载状态
    deletingConfigIds,
    settingDefaultConfigIds,
    isConfigDeleting,
    isConfigSettingDefault,

    // 存储配置管理方法
    loadStorageConfigs,
    handlePageChange,
    handleLimitChange,
    handleDeleteConfig,
    editConfig,
    addNewConfig,
    handleFormSuccess,
    handleSetDefaultConfig,

    // 测试功能方法
    testConnection,
    showTestDetailsModal,

    // 工具方法
    normalizeStorageTypeValue,
    STORAGE_TYPE_UNKNOWN,
  };
}
