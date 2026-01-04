<script setup>
import { onMounted, computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStorageConfigManagement } from "@/modules/admin/storage/useStorageConfigManagement.js";
import ConfigForm from "@/modules/admin/components/ConfigForm.vue";
import CommonPagination from "@/components/common/CommonPagination.vue";
import ConfirmDialog from "@/components/common/dialogs/ConfirmDialog.vue";
import { formatDateTimeWithSeconds } from "@/utils/timeUtils.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useConfirmDialog, createConfirmFn } from "@/composables/core/useConfirmDialog.js";
import { useStorageTypePresentation } from "@/modules/admin/storage/useStorageTypePresentation.js";
import { useStorageTypeIcon } from "@/composables/core/useStorageTypeIcon.js";
import { IconArchive, IconCheck, IconCheckCircle, IconChevronRight, IconClose, IconCloud, IconDelete, IconError, IconExclamationSolid, IconFolderPlus, IconLink, IconRefresh, IconRename, IconShieldCheck, IconXCircle } from "@/components/icons";

const { isDarkMode: darkMode } = useThemeMode();

// 国际化
const { t } = useI18n();

// 确认对话框
const { dialogState, confirm, handleConfirm, handleCancel } = useConfirmDialog();

// 创建适配确认函数，用于传递给 composable
const confirmFn = createConfirmFn(confirm, {
  t,
  darkMode,
  getConfirmText: () => t("common.dialogs.deleteButton"),
});

const {
  // 状态
  loading,
  error,
  storageConfigs,
  filteredConfigs,
  storageTypeFilter,
  availableStorageTypes,
  pagination,
  pageSizeOptions,
  currentConfig,
  showAddForm,
  showEditForm,
  testResults,
  showTestDetails,
  selectedTestResult,
  showDetailedResults,

  // 行级加载状态
  isConfigDeleting,
  isConfigSettingDefault,

  // 方法
  loadStorageConfigs,
  handlePageChange,
  handleLimitChange,
  handleDeleteConfig,
  editConfig,
  addNewConfig,
  handleFormSuccess,
  handleSetDefaultConfig,
  testConnection,
  showTestDetailsModal,
  STORAGE_TYPE_UNKNOWN,
} = useStorageConfigManagement({ confirmFn });

// 存储类型图标
const { getStorageTypeIcon, getStorageTypeIconClass } = useStorageTypeIcon();

// 存储类型展示/样式 helper（统一从 /api/storage-types 加载）
const { storageTypesMeta, getTypeMeta, getTypeLabel, getBadgeClass, ensureLoaded } = useStorageTypePresentation();

const formatStorageTypeLabel = (type) => {
  return getTypeLabel(type === STORAGE_TYPE_UNKNOWN ? null : type, t);
};

const getConfigSummaryRows = (config) => {
  if (!config) return [];
  const meta = getTypeMeta(config.storage_type);
  const schema = meta?.configSchema;
  const layout = schema?.layout;
  const summaryFields = layout?.summaryFields;
  if (!schema || !Array.isArray(summaryFields) || summaryFields.length === 0) {
    return [];
  }

  return summaryFields
    .map((fieldName) => {
      const fieldMeta = schema.fields?.find((f) => f.name === fieldName) || null;
      const labelKey = fieldMeta?.labelKey;
      const label = labelKey ? t(labelKey) : fieldName;

      let rawValue = config[fieldName];
      let value = rawValue;
      const ui = fieldMeta?.ui;

      // 布尔类型：优先使用 displayOptions 翻译键（兼容数字0/1）
      const isBooleanField = fieldMeta?.type === "boolean" || typeof rawValue === "boolean";
      if (isBooleanField) {
        const boolValue = rawValue === true || rawValue === 1 || rawValue === "1";
        const displayOpts = ui?.displayOptions;
        if (displayOpts) {
          value = boolValue ? t(displayOpts.trueKey) : t(displayOpts.falseKey);
        } else {
          value = boolValue ? "是" : "否";
        }
      }

      // 计算字段的 displayOptions 处理
      if (fieldMeta?.type === "computed" && ui?.displayOptions) {
        const displayKey = ui.displayOptions[rawValue];
        if (displayKey) {
          value = t(displayKey);
        }
      }

      // 空值处理：使用 emptyTextKey 作为默认显示
      const isEmpty = value === undefined || value === null || String(value).trim().length === 0;
      if (isEmpty && ui?.emptyTextKey) {
        value = t(ui.emptyTextKey);
      }

      const show = !isEmpty || !!ui?.emptyTextKey;

      return {
        key: fieldName,
        label,
        value,
        show,
      };
    })
    .filter((row) => row.show);
};

const storageTypeOptions = computed(() =>
  availableStorageTypes.value.map((type) => ({
    value: type,
    label: formatStorageTypeLabel(type),
  }))
);

const hasAnyConfig = computed(() => storageConfigs.value.length > 0);
const hasFilteredResult = computed(() => filteredConfigs.value.length > 0);

/**
 * 将 camelCase/snake_case 转换为可读的标签
 * 例如: uploadTime -> "Upload Time", endpoint_url -> "Endpoint Url"
 */
const camelToReadable = (str) => {
  if (!str) return str;
  return str
    .replace(/_/g, " ") // snake_case 转空格
    .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase 转空格
    .replace(/\b\w/g, (c) => c.toUpperCase()); // 首字母大写
};

/**
 * 动态获取字段标签
 * 优先级: i18n定义 > 自动转换
 * @param {string} key - 字段键名
 * @param {string} storageType - 存储类型（可选，用于查找特定类型的标签）
 */
const formatLabel = (key, storageType = null) => {
  // 1. 尝试从 i18n 通用字段获取
  const commonKey = `admin.storage.fields.${key}`;
  if (t(commonKey) !== commonKey) {
    return t(commonKey);
  }

  // 2. 如果提供了存储类型，尝试从特定类型字段获取
  if (storageType) {
    const typeKey = `admin.storage.fields.${storageType.toLowerCase()}.${key}`;
    if (t(typeKey) !== typeKey) {
      return t(typeKey);
    }
  }

  // 3. Fallback: 自动转换为可读格式
  return camelToReadable(key);
};

const isPrimitiveValue = (value) => value == null || ["string", "number", "boolean"].includes(typeof value);

const formatJson = (value) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

/**
 * 格式化检查项详情为友好的键值对数组
 * 使用动态 i18n 查找，无需硬编码标签映射
 */
const formatCheckDetails = (details, storageType = null) => {
  if (!details || typeof details !== "object") return [];

  const result = [];
  for (const [key, value] of Object.entries(details)) {
    const label = formatLabel(key, storageType);
    result.push({ key, label, value });
  }
  return result;
};

const isLikelyMsKey = (key) => {
  if (!key) return false;
  const k = String(key);
  if (/_ms$/i.test(k)) return true;
  if (/Ms$/.test(k)) return true;
  if (k === "uploadTime" || k === "responseTime" || k === "totalDuration" || k === "durationMs" || k === "retryAfterMs") {
    return true;
  }
  return false;
};

// 格式化详情值
const formatDetailValue = (value, key = "") => {
  if (value === true) return "✓ 是";
  if (value === false) return "✗ 否";
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    // 仅在“字段名看起来就是毫秒”时才加单位，避免误判
    if (isLikelyMsKey(key)) return `${value} ms`;
    return String(value);
  }
  if (typeof value === "string") return value || "—";
  return null; // 复杂对象返回null，需要特殊处理
};

// 格式化日期 - 使用统一的时间处理工具
const formatDate = (isoDate) => {
  if (!isoDate) return "";
  return formatDateTimeWithSeconds(isoDate);
};

// 组件加载时获取存储类型元数据和配置列表
onMounted(async () => {
  await ensureLoaded();
  await loadStorageConfigs();
});
</script>

<template>
  <div class="p-4 flex-1 flex flex-col overflow-y-auto">
    <h2 class="text-lg sm:text-xl font-medium mb-4" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">存储管理</h2>

    <div class="flex flex-wrap gap-3 mb-5 items-center">
      <button @click="addNewConfig" class="px-3 py-2 rounded-md flex items-center space-x-1 bg-primary-500 hover:bg-primary-600 text-white font-medium transition text-sm">
        <IconFolderPlus class="h-4 w-4" />
        <span>添加新配置</span>
      </button>

      <button
        @click="loadStorageConfigs"
        class="px-3 py-2 rounded-md flex items-center space-x-1 font-medium transition text-sm"
        :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'"
      >
        <IconRefresh class="h-4 w-4" />
        <span>刷新列表</span>
      </button>

      <div
        v-if="storageTypeOptions.length > 0"
        class="flex items-center gap-2 text-sm ml-auto"
        :class="darkMode ? 'text-gray-300' : 'text-gray-600'"
      >
        <span>存储类型</span>
        <select
          v-model="storageTypeFilter"
          class="px-2 py-1 rounded-md border text-sm"
          :class="darkMode ? 'bg-gray-800 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-800'"
        >
          <option value="all">全部</option>
          <option v-for="option in storageTypeOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="mb-4 p-3 rounded-md text-sm" :class="darkMode ? 'bg-red-900/40 border border-red-800 text-red-200' : 'bg-red-50 text-red-800 border border-red-200'">
      <div class="flex justify-between items-start">
        <div class="flex items-start">
          <IconError class="h-5 w-5 text-red-400 mr-2 mt-0.5 flex-shrink-0" />
          <div>
            <div class="font-medium">操作失败</div>
            <div class="mt-1">{{ error }}</div>
          </div>
        </div>
        <button @click="error = ''" class="text-red-400 hover:text-red-500" :class="darkMode ? 'hover:text-red-300' : 'hover:text-red-600'">
          <IconClose class="h-5 w-5" />
        </button>
      </div>
    </div>

    <!-- 内容区域 -->
    <div class="flex-1 flex flex-col">
      <!-- 加载状态 -->
      <div v-if="loading" class="flex justify-center items-center h-40">
        <IconRefresh class="animate-spin h-8 w-8 text-primary-500" />
      </div>

      <!-- 存储配置列表 -->
      <template v-else-if="hasAnyConfig">
        <!-- 有筛选结果时显示配置列表 -->
        <div v-if="hasFilteredResult" class="bg-white dark:bg-gray-800 shadow-md rounded-lg p-0 sm:p-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-3 sm:gap-4">
            <div
              v-for="config in filteredConfigs"
              :key="config.id"
              class="rounded-lg shadow-md overflow-hidden transition-colors duration-200 border relative"
              :class="[
                darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200',
                config.is_default ? (darkMode ? 'ring-3 ring-primary-500 border-primary-500 shadow-lg' : 'ring-3 ring-primary-500 border-primary-500 shadow-lg') : '',
              ]"
            >
              <div class="px-2 py-2 sm:px-3 sm:py-2.5 flex flex-wrap justify-between items-center gap-2 border-b" :class="darkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-200'">
                <div class="flex items-center gap-1 sm:gap-2 flex-wrap min-w-0">
                  <component
                    :is="getStorageTypeIcon(config.storage_type)"
                    :class="['h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0', getStorageTypeIconClass(config.storage_type, darkMode)]"
                  />
                  <h3 class="font-medium text-sm" :class="[darkMode ? 'text-gray-100' : 'text-gray-900', config.is_default ? 'font-semibold' : '']">
                    {{ config.name }}
                  </h3>
                  <span
                    v-if="config.is_default"
                    class="text-xs px-1.5 sm:px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                    :class="darkMode ? 'bg-primary-600 text-white' : 'bg-primary-500 text-white'"
                  >
                    默认
                  </span>
                  <span
                    v-if="config.url_proxy"
                    class="text-xs px-1.5 sm:px-2 py-0.5 rounded-full font-medium flex items-center gap-0.5 sm:gap-1 flex-shrink-0"
                    :class="darkMode ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30' : 'bg-blue-100 text-blue-700 border border-blue-200'"
                    :title="`代理URL: ${config.url_proxy}`"
                  >
                    <IconLink class="h-3 w-3" />
                    <span class="hidden sm:inline">代理</span>
                  </span>
                </div>
                <div class="flex items-center gap-1 sm:gap-2 flex-wrap flex-shrink-0">
                  <span
                    v-if="config.provider_type"
                    class="text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full font-medium whitespace-nowrap"
                    :class="darkMode ? 'bg-primary-900/40 text-primary-200' : 'bg-primary-100 text-primary-800'"
                  >
                    {{ config.provider_type }}
                  </span>
                  <span
                    class="text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full font-medium whitespace-nowrap"
                    :class="getBadgeClass(config.storage_type, darkMode)"
                  >
                    {{ formatStorageTypeLabel(config.storage_type) }}
                  </span>
                </div>
              </div>

              <div class="p-3 sm:p-4">
                <div :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                  <!-- 类型特定字段：使用策略生成摘要 -->
                  <div v-if="getConfigSummaryRows(config).length" class="grid grid-cols-1 gap-2 text-sm">
                    <div
                      v-for="row in getConfigSummaryRows(config)"
                      :key="row.key"
                      class="flex justify-between"
                    >
                      <span class="font-medium">{{ row.label }}:</span>
                      <span
                        v-if="row.key === 'endpoint_url'"
                        class="truncate ml-2 max-w-[60%] text-right"
                        :title="row.value"
                      >
                        {{ row.value }}
                      </span>
                      <span v-else>{{ row.value }}</span>
                    </div>
                  </div>

                  <!-- 通用字段 -->
                  <div
                    class="grid grid-cols-1 gap-2 text-sm mt-2 pt-2 border-t"
                    :class="darkMode ? 'border-gray-600' : 'border-gray-200'"
                  >

                    <div class="flex justify-between">
                      <span class="font-medium">API密钥可见:</span>
                      <span class="flex items-center">
                        <IconCheckCircle v-if="config.is_public" class="h-4 w-4 mr-1 text-green-500" />
                        <IconXCircle v-else class="h-4 w-4 mr-1 text-gray-400" />
                        {{ config.is_public ? "允许" : "禁止" }}
                      </span>
                    </div>

                    <div class="flex justify-between">
                      <span class="font-medium">上次使用:</span>
                      <span>{{ config.last_used ? formatDate(config.last_used) : "从未使用" }}</span>
                    </div>

                    <div class="flex justify-between">
                      <span class="font-medium">创建时间:</span>
                      <span>{{ formatDate(config.created_at) }}</span>
                    </div>
                  </div>

                  <!-- 测试结果 -->
                  <div class="mt-3" v-if="testResults[config.id] && !testResults[config.id].loading">
                    <div
                      class="p-3 rounded-lg border flex items-start gap-2.5 transition-all"
                      :class="[
                        testResults[config.id].success
                          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700/50'
                          : testResults[config.id].partialSuccess
                          ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/50'
                          : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/50',
                      ]"
                    >
                      <!-- 状态图标 -->
                      <IconCheckCircle
                        v-if="testResults[config.id].success"
                        class="h-5 w-5 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5"
                      />
                      <IconExclamationSolid
                        v-else-if="testResults[config.id].partialSuccess"
                        class="h-5 w-5 text-amber-500 dark:text-amber-400 flex-shrink-0 mt-0.5"
                      />
                      <IconXCircle
                        v-else
                        class="h-5 w-5 text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5"
                      />

                      <div class="flex-1 min-w-0">
                        <div
                          class="font-semibold text-sm"
                          :class="[
                            testResults[config.id].success
                              ? 'text-green-700 dark:text-green-300'
                              : testResults[config.id].partialSuccess
                              ? 'text-amber-700 dark:text-amber-300'
                              : 'text-red-700 dark:text-red-300',
                          ]"
                        >
                          {{ testResults[config.id].message }}
                        </div>

                        <div
                          v-if="testResults[config.id].details"
                          class="mt-1.5 text-xs whitespace-pre-line leading-relaxed"
                          :class="[
                            testResults[config.id].success
                              ? 'text-green-600 dark:text-green-400/80'
                              : testResults[config.id].partialSuccess
                              ? 'text-amber-600 dark:text-amber-400/80'
                              : 'text-red-600 dark:text-red-400/80',
                          ]"
                        >
                          {{ testResults[config.id].details }}
                        </div>

                        <!-- 查看详情按钮 -->
                        <button
                          v-if="testResults[config.id].report"
                          @click="showTestDetailsModal(config.id)"
                          class="mt-2 inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded transition-colors"
                          :class="[
                            testResults[config.id].success
                              ? 'text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-800/30 hover:bg-green-200 dark:hover:bg-green-800/50'
                              : testResults[config.id].partialSuccess
                              ? 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-800/30 hover:bg-amber-200 dark:hover:bg-amber-800/50'
                              : 'text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-800/30 hover:bg-red-200 dark:hover:bg-red-800/50',
                          ]"
                        >
                          <IconChevronRight class="h-3 w-3" />
                          查看详细信息
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="mt-4 flex flex-wrap gap-2">
                  <button
                    v-if="!config.is_default"
                    @click="handleSetDefaultConfig(config.id)"
                    :disabled="isConfigSettingDefault(config.id)"
                    class="flex items-center px-3 py-1.5 rounded text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                    :class="darkMode ? 'bg-primary-600 hover:bg-primary-700 text-white' : 'bg-primary-100 hover:bg-primary-200 text-primary-800'"
                  >
                    <IconRefresh v-if="isConfigSettingDefault(config.id)" class="animate-spin h-4 w-4 mr-1.5" />
                    <IconCheck v-else class="h-4 w-4 mr-1.5" />
                    {{ isConfigSettingDefault(config.id) ? '设置中...' : '设为默认' }}
                  </button>

                  <button
                    @click="testConnection(config.id)"
                    class="flex items-center px-3 py-1.5 rounded text-sm font-medium transition"
                    :class="
                      testResults[config.id]?.loading
                        ? 'opacity-50 cursor-wait'
                        : darkMode
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'bg-blue-100 hover:bg-blue-200 text-blue-800'
                    "
                    :disabled="testResults[config.id]?.loading"
                  >
                    <template v-if="testResults[config.id]?.loading">
                      <IconRefresh class="animate-spin h-4 w-4 mr-1.5" />
                      测试中...
                    </template>
                    <template v-else>
                      <IconShieldCheck class="h-4 w-4 mr-1.5" />
                      测试连接
                    </template>
                  </button>

                  <button
                    @click="editConfig(config)"
                    class="flex items-center px-3 py-1.5 rounded text-sm font-medium transition"
                    :class="darkMode ? 'bg-gray-600 hover:bg-gray-700 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-800'"
                  >
                    <IconRename class="h-4 w-4 mr-1.5" />
                    编辑
                  </button>

                  <button
                    @click="handleDeleteConfig(config.id)"
                    :disabled="isConfigDeleting(config.id)"
                    class="flex items-center px-3 py-1.5 rounded text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                    :class="darkMode ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-red-100 hover:bg-red-200 text-red-800'"
                  >
                    <IconRefresh v-if="isConfigDeleting(config.id)" class="animate-spin h-4 w-4 mr-1.5" />
                    <IconDelete v-else class="h-4 w-4 mr-1.5" />
                    {{ isConfigDeleting(config.id) ? '删除中...' : '删除' }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 分页组件 - 只在有筛选结果时显示 -->
          <div class="mt-4">
            <CommonPagination
              :dark-mode="darkMode"
              :pagination="pagination"
              :page-size-options="pageSizeOptions"
              mode="page"
              @page-changed="handlePageChange"
              @limit-changed="handleLimitChange"
            />
          </div>
        </div>

        <!-- 无筛选结果时显示提示 - 使用v-if而非v-else -->
        <div v-if="!hasFilteredResult" class="bg-white dark:bg-gray-800 shadow-md rounded-lg p-6 text-center text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
          <p>没有符合当前筛选条件的存储配置。</p>
        </div>
      </template>

      <!-- 空状态 -->
      <div
        v-else-if="!loading"
        class="rounded-lg p-6 text-center transition-colors duration-200 flex-1 flex flex-col justify-center items-center bg-white dark:bg-gray-800 shadow-md"
        :class="darkMode ? 'text-gray-300' : 'text-gray-600'"
      >
        <IconCloud class="mx-auto h-16 w-16 mb-4 text-gray-400" />
        <h3 class="text-lg font-medium mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">尚未配置任何存储</h3>
        <p class="mb-5 text-sm max-w-md">添加您的第一个存储配置，支持多种对象存储或 WebDAV 服务。</p>
        <button @click="addNewConfig" class="px-4 py-2 rounded-md bg-primary-500 hover:bg-primary-600 text-white font-medium transition inline-flex items-center">
          <IconFolderPlus class="h-5 w-5 mr-1.5" />
          添加配置
        </button>
      </div>
    </div>

    <!-- 添加/编辑表单弹窗 -->
    <ConfigForm
      v-if="showAddForm || showEditForm"
      :dark-mode="darkMode"
      :config="currentConfig"
      :is-edit="showEditForm"
      @close="
        showAddForm = false;
        showEditForm = false;
      "
      @success="handleFormSuccess"
    />

    <!-- 测试结果详情模态框 -->
    <div
      v-if="showTestDetails && selectedTestResult"
      class="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black bg-opacity-50 overflow-y-auto"
      @click="showTestDetails = false"
    >
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg overflow-hidden" @click.stop>
        <!-- 头部 -->
        <div class="px-4 py-3 border-b flex justify-between items-center" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
          <h3 class="text-base sm:text-lg font-medium" :class="darkMode ? 'text-white' : 'text-gray-900'">存储连接测试结果</h3>
          <button @click="showTestDetails = false" class="text-gray-400 hover:text-gray-500">
            <IconClose class="h-5 w-5" />
          </button>
        </div>

        <div class="p-4 max-h-[70vh] overflow-y-auto">
          <!-- 连接总结 -->
          <div
            class="mb-4 p-3 rounded-lg border flex items-start gap-2.5"
            :class="[
              selectedTestResult.success
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50'
                : selectedTestResult.partialSuccess
                ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50'
                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50',
            ]"
          >
            <IconCheckCircle
              v-if="selectedTestResult.success"
              class="h-5 w-5 text-green-500 dark:text-green-400 flex-shrink-0 mt-0.5"
            />
            <IconExclamationSolid
              v-else-if="selectedTestResult.partialSuccess"
              class="h-5 w-5 text-amber-500 dark:text-amber-400 flex-shrink-0 mt-0.5"
            />
            <IconXCircle
              v-else
              class="h-5 w-5 text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5"
            />
            <div class="flex-1 min-w-0">
              <div
                class="font-semibold"
                :class="[
                  selectedTestResult.success
                    ? 'text-green-700 dark:text-green-300'
                    : selectedTestResult.partialSuccess
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-red-700 dark:text-red-300',
                ]"
              >
                {{ selectedTestResult.message }}
              </div>
              <div v-if="selectedTestResult.details" class="mt-1 text-sm text-gray-600 dark:text-gray-400 whitespace-pre-line">
                {{ selectedTestResult.details }}
              </div>
            </div>
          </div>

          <!-- 折叠/展开控制 -->
          <div class="mb-3">
            <button
              @click="showDetailedResults = !showDetailedResults"
              class="text-sm flex items-center gap-1 px-2 py-1.5 rounded transition-colors"
              :class="darkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'"
            >
              <IconChevronRight class="h-4 w-4 transition-transform duration-200" :class="showDetailedResults ? 'rotate-90' : ''" />
              {{ showDetailedResults ? "隐藏详细结果" : "显示详细结果" }}
              <span
                v-if="selectedTestResult.report?.checks?.length"
                class="text-xs px-1.5 py-0.5 rounded-full ml-1"
                :class="darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'"
              >
                {{ selectedTestResult.report.checks.length }}
              </span>
            </button>
          </div>

          <div v-if="showDetailedResults && selectedTestResult.report" class="space-y-4">
            <!-- 通用展示：report.info -->
            <div class="mb-3" v-if="selectedTestResult.report?.info">
              <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">连接信息</h4>
              <div class="bg-gray-50 dark:bg-gray-900/50 rounded p-3 text-xs sm:text-sm">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                  <div v-for="(value, key) in selectedTestResult.report.info" :key="key" class="flex flex-col">
                    <span class="text-gray-500 dark:text-gray-400 text-xs font-medium">{{ formatLabel(String(key)) }}</span>
                    <span v-if="isPrimitiveValue(value)" class="text-gray-900 dark:text-gray-200 break-all">
                      {{ value == null || value === '' ? "未设置" : String(value) }}
                    </span>
                    <pre v-else class="bg-gray-100 dark:bg-gray-800 rounded p-1 text-xs overflow-auto max-h-24 mt-0.5">{{ formatJson(value) }}</pre>
                  </div>
                </div>
              </div>
            </div>

            <!-- 通用展示：report.checks -->
            <div class="mb-3" v-if="selectedTestResult.report?.checks?.length">
              <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">检查项</h4>
              <div class="bg-gray-50 dark:bg-gray-900/50 rounded p-3 space-y-2.5">
                <div
                  v-for="(check, idx) in selectedTestResult.report.checks"
                  :key="check.key || idx"
                  class="flex items-start gap-2"
                >
                  <!-- 状态图标 -->
                  <IconCheck v-if="check.success && !check.skipped" class="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                  <IconClose v-else-if="!check.success && !check.skipped" class="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <span v-else class="h-4 w-4 flex items-center justify-center text-xs text-gray-400 flex-shrink-0 mt-0.5">—</span>

                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span
                        class="font-medium text-sm"
                        :class="[
                          check.skipped
                            ? 'text-gray-500 dark:text-gray-400'
                            : check.success
                            ? 'text-green-700 dark:text-green-400'
                            : 'text-red-700 dark:text-red-400',
                        ]"
                      >
                        {{ check.label || check.key || `检查项${idx + 1}` }}
                      </span>
                      <span
                        v-if="check.skipped"
                        class="text-xs text-gray-400 dark:text-gray-500"
                      >
                        (已跳过)
                      </span>
                    </div>

                    <!-- Note 提示 -->
                    <div v-if="check.note" class="mt-1 text-xs text-gray-500 dark:text-gray-400 italic">
                      {{ check.note }}
                    </div>

                    <!-- 错误信息 -->
                    <div v-if="check.error" class="mt-1.5">
                      <div class="bg-red-50 dark:bg-red-900/20 p-2 rounded text-xs text-red-600 dark:text-red-400 max-h-20 overflow-auto">
                        {{ check.error }}
                      </div>
                    </div>

                    <!-- 详细信息 - 优先展示 tester 提供的 items -->
                    <div v-if="Array.isArray(check.items) && check.items.length" class="mt-2 pl-0.5">
                      <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        <template v-for="item in check.items" :key="item.key || item.label">
                          <template v-if="formatDetailValue(item.value, item.key) !== null">
                            <span class="text-gray-500 dark:text-gray-400">{{ item.label || formatLabel(String(item.key || '')) }}</span>
                            <span class="text-gray-700 dark:text-gray-300 break-all">{{ formatDetailValue(item.value, item.key) }}</span>
                          </template>
                          <template v-else>
                            <span class="text-gray-500 dark:text-gray-400 col-span-2">{{ item.label || formatLabel(String(item.key || '')) }}</span>
                            <pre class="col-span-2 bg-gray-100 dark:bg-gray-800 rounded p-1.5 text-xs overflow-auto max-h-24 -mt-0.5">{{ formatJson(item.value) }}</pre>
                          </template>
                        </template>
                      </div>
                    </div>

                    <!-- 兼容：仍可展示 details（对象形式） -->
                    <div v-else-if="check.details && typeof check.details === 'object' && Object.keys(check.details).length" class="mt-2 pl-0.5">
                      <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        <template v-for="item in formatCheckDetails(check.details, selectedTestResult?.report?.storageType)" :key="item.key">
                          <template v-if="formatDetailValue(item.value, item.key) !== null">
                            <span class="text-gray-500 dark:text-gray-400">{{ item.label }}</span>
                            <span class="text-gray-700 dark:text-gray-300 break-all">{{ formatDetailValue(item.value, item.key) }}</span>
                          </template>
                          <template v-else>
                            <span class="text-gray-500 dark:text-gray-400 col-span-2">{{ item.label }}</span>
                            <pre class="col-span-2 bg-gray-100 dark:bg-gray-800 rounded p-1.5 text-xs overflow-auto max-h-24 -mt-0.5">{{ formatJson(item.value) }}</pre>
                          </template>
                        </template>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="mb-3" v-if="selectedTestResult.report?.diagnostics">
              <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center">
                诊断信息
                <span class="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-400">辅助</span>
              </h4>
              <div class="bg-gray-50 dark:bg-gray-900/50 rounded p-2 sm:p-3 text-xs sm:text-sm">
                <pre class="bg-gray-100 dark:bg-gray-800 rounded p-1 text-xs overflow-auto max-h-56">{{ formatJson(selectedTestResult.report.diagnostics) }}</pre>
              </div>
            </div>

            <div class="mb-3" v-if="selectedTestResult.report?.timing?.durationMs != null">
              <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">耗时</h4>
              <div class="bg-gray-50 dark:bg-gray-900/50 rounded p-2 sm:p-3 text-xs sm:text-sm text-gray-700 dark:text-gray-300">
                {{ selectedTestResult.report.timing.durationMs }}ms
              </div>
            </div>
          </div>

          <div v-if="showDetailedResults && !selectedTestResult.report" class="space-y-4">
            <div class="text-sm text-gray-600 dark:text-gray-400">
              后端没有返回详细报告（report），只能显示上面的摘要信息。
            </div>
          </div>
        </div>

        <div class="p-3 sm:p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button
            @click="showTestDetails = false"
            class="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-sm"
          >
            关闭
          </button>
        </div>
      </div>
    </div>

    <!-- 确认对话框 -->
    <ConfirmDialog
      v-bind="dialogState"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>

<style scoped>
.break-all {
  word-break: break-all;
}

.overflow-wrap-anywhere {
  overflow-wrap: anywhere;
  word-wrap: break-word; /* 兼容旧浏览器 */
  -ms-word-break: break-all; /* 兼容IE */
  word-break: break-word; /* 更现代的属性，尽量在合适的位置换行 */
  hyphens: auto; /* 在必要时添加连字符 */
}

/* 连接信息项目样式 - 现代化设计 */
.connection-info-item {
  padding: 0.5rem 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.1);
}

.connection-info-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.connection-info-item:first-child {
  padding-top: 0;
}

/* 终端节点URL特殊样式 */
.endpoint-url {
  font-family: monospace;
  padding: 0.25rem 0.5rem;
  background-color: rgba(0, 0, 0, 0.03);
  border-radius: 0.25rem;
  margin-top: 0.125rem;
  border-left: 2px solid rgba(59, 130, 246, 0.5);
}

/* 暗黑模式下的终端节点样式 */
:deep(.dark .endpoint-url),
.dark .endpoint-url {
  background-color: rgba(255, 255, 255, 0.05);
  border-left-color: rgba(59, 130, 246, 0.7);
}

</style>
