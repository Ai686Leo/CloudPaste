<script setup>
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";
import MountForm from "@/modules/admin/components/MountForm.vue";
import CommonPagination from "@/components/common/CommonPagination.vue";
import ConfirmDialog from "@/components/common/dialogs/ConfirmDialog.vue";
import ViewModeToggle from "@/components/common/ViewModeToggle.vue";
import { useMountManagement } from "@/modules/admin/storage/useMountManagement.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useConfirmDialog, createConfirmFn } from "@/composables/core/useConfirmDialog.js";
import { IconArchive, IconCalculator, IconCalendar, IconCheckCircle, IconClock, IconDelete, IconEye, IconFolder, IconFolderPlus, IconGlobeAlt, IconInformationCircle, IconRefresh, IconRename, IconSearch, IconShieldCheck, IconUser, IconXCircle } from "@/components/icons";

/**
 * 挂载管理视图
 */

// 组件接收的属性定义
const props = defineProps({
  userType: {
    type: String,
    default: "admin",
    validator: (value) => ["admin", "apikey"].includes(value),
  },
});


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
  showForm,
  currentMount,
  searchQuery,
  filteredMounts,
  pagination,
  lastRefreshTime,
  pageSizeOptions,
  viewMode,

  // 权限状态
  isAdmin,
  isApiKeyUser,

  // 行级加载状态
  isMountToggling,
  isMountDeleting,

  // 方法
  loadMounts,
  loadStorageConfigs,
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
  formatCreator,
  getCreatorClass,
  formatStorageType,
} = useMountManagement({ confirmFn });

// 视图模式选项配置
const viewModeOptions = [
  { value: "grid", icon: "grid", titleKey: "admin.mount.viewMode.grid" },
  { value: "list", icon: "list", titleKey: "admin.mount.viewMode.list" },
];

// 组件挂载时加载数据
onMounted(() => {
  loadStorageConfigs(); // 先加载存储配置列表
  loadMounts(); // 然后加载挂载点列表
});
</script>

<template>
  <div class="p-4 flex-1 flex flex-col">
    <!-- 顶部操作栏 -->
    <div class="flex flex-col sm:flex-row sm:justify-between mb-4">
      <div class="mb-2 sm:mb-0">
        <h2 class="text-lg font-semibold" :class="darkMode ? 'text-white' : 'text-gray-900'">
          {{ isApiKeyUser ? $t("admin.mount.accessibleMounts") : $t("admin.mount.title") }}
        </h2>
      </div>
      <div class="flex flex-wrap gap-2">
        <!-- 只有管理员可以添加挂载点 -->
        <button
          v-if="isAdmin"
          @click="openCreateForm"
          class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-200 shadow-sm hover:shadow"
          :class="darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'"
          :disabled="loading"
        >
          <span class="flex items-center">
            <IconFolderPlus class="h-4 w-4 mr-1.5" />
            {{ $t("admin.mount.createMount") }}
          </span>
        </button>
        <button
          @click="loadMounts"
          class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-200 shadow-sm hover:shadow"
          :class="darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'"
        >
          <span class="flex items-center">
            <IconRefresh class="h-4 w-4 mr-1.5" />
            {{ $t("admin.mount.refresh") }}
          </span>
        </button>
      </div>
    </div>

    <!-- 错误消息提示 -->
    <div v-if="error" class="mb-4 p-3 bg-red-100 text-red-600 rounded-md dark:bg-red-900/50 dark:text-red-200 dark:border dark:border-red-800">
      <p>{{ error }}</p>
    </div>

    <!-- 上次刷新时间显示 -->
    <div class="flex justify-between items-center mb-3 sm:mb-4" v-if="lastRefreshTime">
      <div class="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
        <span class="inline-flex items-center">
          <IconClock class="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
          {{ $t("admin.mount.info.lastRefresh") }}: {{ lastRefreshTime }}
        </span>
      </div>

      <!-- 右侧：搜索框 + 视图切换 -->
      <div class="flex items-center gap-2">
        <!-- 搜索框 -->
        <div class="max-w-md">
          <div class="relative rounded-md shadow-sm">
            <input
              type="text"
              v-model="searchQuery"
              :placeholder="$t('admin.mount.search')"
              class="w-full px-3 py-1.5 rounded-md focus:outline-none focus:ring-2"
              :class="
                darkMode
                  ? 'bg-gray-700 text-white placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 border border-gray-600'
                  : 'bg-white text-gray-700 placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 border border-gray-300'
              "
            />
            <div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <IconSearch class="h-4 w-4" :class="darkMode ? 'text-gray-400' : 'text-gray-400'" />
            </div>
          </div>
        </div>

        <!-- 视图切换按钮组 -->
        <ViewModeToggle
          v-model="viewMode"
          :options="viewModeOptions"
          :dark-mode="darkMode"
          size="md"
        />
      </div>
    </div>

    <!-- 加载中指示器 -->
    <div v-if="loading" class="flex justify-center my-8">
      <IconRefresh class="animate-spin h-8 w-8" :class="darkMode ? 'text-blue-400' : 'text-blue-500'" />
    </div>

    <!-- 挂载点列表为空 -->
    <div v-else-if="filteredMounts.length === 0" class="flex-grow flex items-center justify-center p-6">
      <div class="text-center">
        <IconArchive class="mx-auto h-12 w-12 mb-4" :class="darkMode ? 'text-gray-500' : 'text-gray-400'" />
        <h3 class="text-lg font-medium mb-2" :class="darkMode ? 'text-white' : 'text-gray-900'">
          {{ searchQuery ? $t("admin.mount.searchResults.noResults") : isApiKeyUser ? $t("admin.mount.empty.title") : $t("admin.mount.empty.title") }}
        </h3>
        <p class="text-sm mb-4" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ searchQuery ? "尝试使用不同的搜索条件" : isApiKeyUser ? "当前API密钥没有可访问的挂载点，请联系管理员配置权限" : $t("admin.mount.empty.description") }}
        </p>
        <button
          v-if="searchQuery"
          @click="searchQuery = ''"
          class="inline-flex items-center px-3 py-2 border rounded-md shadow-sm text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors duration-200"
          :class="
            darkMode
              ? 'border-gray-600 bg-gray-700 text-gray-200 hover:bg-gray-600 focus:ring-blue-500 focus:ring-offset-gray-800'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:ring-blue-500'
          "
        >
          {{ $t("admin.mount.searchResults.clearSearch") }}
        </button>
      </div>
    </div>

    <!-- 挂载点列表 -->
    <div v-else class="flex-grow overflow-auto">
      <!-- 列表视图 -->
      <div v-if="viewMode === 'list'">
        <!-- 桌面端表格 -->
        <div class="hidden md:block overflow-x-auto">
          <table class="min-w-full divide-y" :class="darkMode ? 'divide-gray-700' : 'divide-gray-200'">
            <thead :class="darkMode ? 'bg-gray-800' : 'bg-gray-50'">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
                  {{ $t("admin.mount.form.name") }}
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
                  {{ $t("admin.mount.form.mountPath") }}
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
                  {{ $t("admin.mount.form.storageType") }}
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
                  {{ $t("admin.mount.form.remark") }}
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
                  {{ $t("admin.mount.status.proxySign") }}
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
                  {{ $t("admin.mount.info.createdAt") }}
                </th>
                <th class="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
                  {{ $t("common.actions") }}
                </th>
              </tr>
            </thead>
            <tbody :class="darkMode ? 'bg-gray-900 divide-gray-800' : 'bg-white divide-gray-200'" class="divide-y">
              <tr v-for="mount in filteredMounts.slice(pagination.offset, pagination.offset + pagination.limit)"
                  :key="mount.id"
                  :class="darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-50'"
                  class="transition-colors">
                <!-- 名称 + 状态 -->
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="flex items-center">
                    <span class="w-2 h-2 rounded-full mr-2" :class="mount.is_active ? 'bg-green-400' : 'bg-gray-400'"></span>
                    <span class="text-sm font-medium" :class="darkMode ? 'text-white' : 'text-gray-900'">{{ mount.name }}</span>
                  </div>
                </td>
                <!-- 挂载路径 -->
                <td class="px-6 py-4">
                  <div class="text-sm font-mono" :class="darkMode ? 'text-gray-300' : 'text-gray-600'" :title="mount.mount_path">
                    <span class="inline-block max-w-xs truncate">{{ mount.mount_path }}</span>
                  </div>
                </td>
                <!-- 存储类型 -->
                <td class="px-6 py-4 whitespace-nowrap">
                  <span class="text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">{{ formatStorageType(mount) }}</span>
                </td>
                <!-- 备注 -->
                <td class="px-6 py-4">
                  <span class="text-sm inline-block max-w-xs truncate" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" :title="mount.remark || '-'">
                    {{ mount.remark || '-' }}
                  </span>
                </td>
                <!-- 代理/签名状态 -->
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="flex flex-wrap gap-1">
                    <span v-if="mount.web_proxy" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                          :class="darkMode ? 'bg-blue-900/50 text-blue-200' : 'bg-blue-100 text-blue-800'">
                      {{ $t("admin.mount.status.proxy") }}
                    </span>
                    <span v-if="mount.enable_sign" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                          :class="darkMode ? 'bg-green-900/50 text-green-200' : 'bg-green-100 text-green-800'">
                      {{ $t("admin.mount.status.signature") }}
                    </span>
                    <span v-if="mount.enable_folder_summary_compute" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                          :class="darkMode ? 'bg-purple-900/50 text-purple-200' : 'bg-purple-100 text-purple-800'">
                      {{ $t("admin.mount.status.folderSummary") }}
                    </span>
                    <span v-if="!mount.web_proxy && !mount.enable_sign && !mount.enable_folder_summary_compute" class="text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">-</span>
                  </div>
                </td>
                <!-- 创建时间 -->
                <td class="px-6 py-4 whitespace-nowrap">
                  <span class="text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                    {{ formatDateOnly(mount.created_at) }}
                  </span>
                </td>
                <!-- 操作按钮 -->
                <td class="px-6 py-4 whitespace-nowrap text-center">
                  <div class="flex justify-center space-x-2">
                    <template v-if="isAdmin">
                      <!-- 编辑按钮 -->
                      <button
                        @click="openEditForm(mount)"
                        class="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        :class="darkMode ? 'text-indigo-400 hover:text-indigo-300' : 'text-indigo-600 hover:text-indigo-900'"
                        :title="$t('admin.mount.actions.edit')">
                        <IconRename class="h-5 w-5" />
                      </button>
                      <!-- 启用/禁用按钮 -->
                      <button
                        @click="toggleActive(mount)"
                        :disabled="isMountToggling(mount.id)"
                        class="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        :class="mount.is_active
                          ? (darkMode ? 'text-yellow-400 hover:text-yellow-300' : 'text-yellow-600 hover:text-yellow-900')
                          : (darkMode ? 'text-green-400 hover:text-green-300' : 'text-green-600 hover:text-green-900')"
                        :title="mount.is_active ? $t('admin.mount.actions.disable') : $t('admin.mount.actions.enable')">
                        <IconRefresh v-if="isMountToggling(mount.id)" class="h-5 w-5 animate-spin" />
                        <IconXCircle v-else-if="mount.is_active" class="h-5 w-5" />
                        <IconCheckCircle v-else class="h-5 w-5" />
                      </button>
                      <!-- 删除按钮 -->
                      <button
                        @click="confirmDelete(mount.id)"
                        :disabled="isMountDeleting(mount.id)"
                        class="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        :class="darkMode ? 'text-red-400 hover:text-red-300' : 'text-red-600 hover:text-red-900'"
                        :title="$t('admin.mount.actions.delete')">
                        <IconRefresh v-if="isMountDeleting(mount.id)" class="h-5 w-5 animate-spin" />
                        <IconDelete v-else class="h-5 w-5" />
                      </button>
                    </template>
                    <template v-else>
                      <span class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ $t("admin.mount.actions.view") }}</span>
                    </template>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 移动端网格卡片 (复用现有网格) -->
        <div class="md:hidden grid grid-cols-1 gap-4">
          <div
            v-for="mount in filteredMounts.slice(pagination.offset, pagination.offset + pagination.limit)"
            :key="mount.id"
            class="rounded-lg shadow-md overflow-hidden transition-all duration-200 hover:shadow-lg flex flex-col"
            :class="darkMode ? 'bg-gray-700 border border-gray-600' : 'bg-white border border-gray-200'"
          >
            <div class="px-4 py-4 flex-1 flex flex-col justify-between">
              <div>
                <div class="flex justify-between items-start mb-3">
                  <h3 class="text-base font-medium truncate" :class="darkMode ? 'text-white' : 'text-gray-900'" :title="mount.name">{{ mount.name }}</h3>
                  <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                        :class="mount.is_active
                          ? (darkMode ? 'bg-green-900/50 text-green-200' : 'bg-green-100 text-green-800')
                          : (darkMode ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-800')">
                    <span class="w-1.5 h-1.5 rounded-full mr-1" :class="mount.is_active ? 'bg-green-400' : 'bg-gray-400'"></span>
                    {{ mount.is_active ? $t("admin.mount.status.enabled") : $t("admin.mount.status.disabled") }}
                  </span>
                </div>
                <div class="mb-2 text-sm font-mono" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">{{ mount.mount_path }}</div>
                <div class="mb-2 text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">{{ formatStorageType(mount) }}</div>
                <div v-if="mount.remark" class="mb-2 text-sm truncate" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" :title="mount.remark">{{ mount.remark }}</div>
                <div v-if="mount.web_proxy || mount.enable_sign || mount.enable_folder_summary_compute" class="mb-2 flex flex-wrap gap-1">
                  <span v-if="mount.web_proxy" class="inline-flex items-center px-2 py-0.5 rounded text-xs"
                        :class="darkMode ? 'bg-blue-900/50 text-blue-200' : 'bg-blue-100 text-blue-800'">{{ $t("admin.mount.status.proxy") }}</span>
                  <span v-if="mount.enable_sign" class="inline-flex items-center px-2 py-0.5 rounded text-xs"
                        :class="darkMode ? 'bg-green-900/50 text-green-200' : 'bg-green-100 text-green-800'">{{ $t("admin.mount.status.signature") }}</span>
                  <span v-if="mount.enable_folder_summary_compute" class="inline-flex items-center px-2 py-0.5 rounded text-xs"
                        :class="darkMode ? 'bg-purple-900/50 text-purple-200' : 'bg-purple-100 text-purple-800'">{{ $t("admin.mount.status.folderSummary") }}</span>
                </div>
              </div>
              <div class="flex justify-end space-x-2 mt-3">
                <template v-if="isAdmin">
                  <button @click="openEditForm(mount)" class="px-2.5 py-1.5 rounded-md text-xs transition-colors"
                          :class="darkMode ? 'bg-gray-600 hover:bg-gray-500 text-gray-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'">
                    {{ $t("admin.mount.actions.edit") }}
                  </button>
                  <button @click="toggleActive(mount)"
                          :disabled="isMountToggling(mount.id)"
                          class="px-2.5 py-1.5 rounded-md text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center"
                          :class="mount.is_active
                            ? (darkMode ? 'bg-yellow-700 hover:bg-yellow-600 text-yellow-100' : 'bg-yellow-100 hover:bg-yellow-200 text-yellow-800')
                            : (darkMode ? 'bg-green-700 hover:bg-green-600 text-green-100' : 'bg-green-100 hover:bg-green-200 text-green-800')">
                    <IconRefresh v-if="isMountToggling(mount.id)" class="h-3 w-3 mr-1 animate-spin" />
                    {{ mount.is_active ? $t("admin.mount.actions.disable") : $t("admin.mount.actions.enable") }}
                  </button>
                  <button @click="confirmDelete(mount.id)"
                          :disabled="isMountDeleting(mount.id)"
                          class="px-2.5 py-1.5 rounded-md text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center"
                          :class="darkMode ? 'bg-red-700 hover:bg-red-600 text-red-100' : 'bg-red-100 hover:bg-red-200 text-red-800'">
                    <IconRefresh v-if="isMountDeleting(mount.id)" class="h-3 w-3 mr-1 animate-spin" />
                    {{ $t("admin.mount.actions.delete") }}
                  </button>
                </template>
                <template v-else>
                  <span class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ $t("admin.mount.actions.view") }}</span>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 网格视图 (保持原有布局) -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <!-- 分页显示的挂载点 -->
        <div
          v-for="mount in filteredMounts.slice(pagination.offset, pagination.offset + pagination.limit)"
          :key="mount.id"
          class="rounded-lg shadow-md overflow-hidden transition-all duration-200 hover:shadow-lg flex flex-col"
          :class="darkMode ? 'bg-gray-700 border border-gray-600 hover:border-blue-500/50' : 'bg-white border border-gray-200 hover:border-blue-400/50'"
        >
          <!-- 卡片内容区域 - 使用flex-col布局 -->
          <div class="px-4 py-4 flex-1 flex flex-col justify-between">
            <!-- 卡片顶部信息区 -->
            <div>
              <!-- 挂载点标题和状态 -->
              <div class="flex justify-between items-start mb-3">
                <h3 class="text-base font-medium truncate" :class="darkMode ? 'text-white' : 'text-gray-900'" :title="mount.name">
                  {{ mount.name }}
                </h3>
                <span
                  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors duration-200"
                  :class="
                    mount.is_active
                      ? darkMode
                        ? 'bg-green-900/50 text-green-200 border border-green-800/50'
                        : 'bg-green-100 text-green-800 border border-green-200'
                      : darkMode
                      ? 'bg-gray-800 text-gray-300 border border-gray-700'
                      : 'bg-gray-100 text-gray-800 border border-gray-200'
                  "
                >
                  <span class="flex items-center">
                    <span class="w-1.5 h-1.5 rounded-full mr-1" :class="mount.is_active ? 'bg-green-400' : 'bg-gray-400'"></span>
                    {{ mount.is_active ? $t("admin.mount.status.enabled") : $t("admin.mount.status.disabled") }}
                  </span>
                </span>
              </div>

              <!-- 挂载路径 - 改进显示 -->
              <div class="mb-3">
                <div class="flex items-center">
                  <IconFolder
                    class="flex-shrink-0 mr-1.5 h-4 w-4"
                    :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
                  />
                  <p class="text-sm font-mono truncate" :class="darkMode ? 'text-gray-300' : 'text-gray-600'" :title="mount.mount_path">
                    {{ mount.mount_path }}
                  </p>
                </div>
              </div>

              <!-- 存储类型和配置 - 改进显示 -->
              <div class="mb-3">
                <div class="flex items-center text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                  <IconArchive
                    class="flex-shrink-0 mr-1.5 h-4 w-4"
                    :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
                  />
                  <span class="truncate" :title="formatStorageType(mount)">{{ formatStorageType(mount) }}</span>
                </div>
              </div>

              <!-- 备注说明 - 固定高度确保对齐 -->
              <div class="mb-3 min-h-[24px]">
                <div v-if="mount.remark" class="flex items-start">
                  <IconInformationCircle
                    class="flex-shrink-0 mr-1.5 h-4 w-4 mt-0.5"
                    :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
                  />
                  <p class="text-sm truncate" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" :title="mount.remark">
                    {{ mount.remark }}
                  </p>
                </div>
              </div>
            </div>

            <!-- 卡片底部信息区 -->
            <div>
              <!-- 代理和签名状态 -->
              <div v-if="mount.web_proxy || mount.enable_folder_summary_compute" class="mb-2 flex flex-wrap gap-1">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  :class="darkMode ? 'bg-blue-900/50 text-blue-200 border border-blue-800/50' : 'bg-blue-100 text-blue-800 border border-blue-200'"
                >
                  <IconGlobeAlt class="w-3 h-3 mr-1" />
                  {{ $t("admin.mount.status.proxy") }}
                </span>
                <span
                  v-if="mount.enable_sign"
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  :class="darkMode ? 'bg-green-900/50 text-green-200 border border-green-800/50' : 'bg-green-100 text-green-800 border border-green-200'"
                >
                  <IconShieldCheck class="w-3 h-3 mr-1" />
                  {{ $t("admin.mount.status.signature") }}
                </span>
                <span
                  v-if="mount.enable_folder_summary_compute"
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  :class="darkMode ? 'bg-purple-900/50 text-purple-200 border border-purple-800/50' : 'bg-purple-100 text-purple-800 border border-purple-200'"
                >
                  <IconCalculator class="w-3 h-3 mr-1" />
                  {{ $t("admin.mount.status.folderSummary") }}
                </span>
              </div>

              <!-- 创建时间 -->
              <div class="text-xs mb-3" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                <div class="flex items-center">
                  <IconCalendar
                    class="flex-shrink-0 mr-1.5 h-3.5 w-3.5"
                    :class="darkMode ? 'text-gray-500' : 'text-gray-400'"
                  />
                  <span>{{ $t("admin.mount.info.createdAt") }}: {{ formatDate(mount.created_at) }}</span>
                </div>
              </div>

              <!-- 创建者信息 -->
              <div class="text-xs mb-3" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                <div class="flex items-center">
                  <IconUser
                    class="flex-shrink-0 mr-1.5 h-3.5 w-3.5"
                    :class="darkMode ? 'text-gray-500' : 'text-gray-400'"
                  />
                  <span>{{ $t("admin.mount.info.createdBy") }}: </span>
                  <span class="ml-1 px-1.5 py-0.5 text-xs rounded" :class="getCreatorClass(mount)">
                    {{ formatCreator(mount) }}
                  </span>
                </div>
              </div>

              <!-- 操作按钮组 - 根据用户类型显示不同按钮 -->
              <div class="flex justify-end space-x-2">
                <!-- 管理员可以进行所有操作 -->
                <template v-if="isAdmin">
                  <button
                    @click="openEditForm(mount)"
                    class="inline-flex items-center px-2.5 py-1.5 rounded-md text-xs font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1"
                    :class="
                      darkMode
                        ? 'bg-gray-600 hover:bg-gray-500 text-gray-200 focus:ring-blue-500 focus:ring-offset-gray-800'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700 focus:ring-blue-500 focus:ring-offset-white'
                    "
                  >
                    <IconRename class="h-3.5 w-3.5 mr-1" />
                    {{ $t("admin.mount.actions.edit") }}
                  </button>
                  <!-- 启用/禁用切换按钮 -->
                  <button
                    @click="toggleActive(mount)"
                    :disabled="isMountToggling(mount.id)"
                    class="inline-flex items-center px-2.5 py-1.5 rounded-md text-xs font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    :class="
                      darkMode
                        ? mount.is_active
                          ? 'bg-yellow-700 hover:bg-yellow-600 text-yellow-100 focus:ring-yellow-500 focus:ring-offset-gray-800'
                          : 'bg-green-700 hover:bg-green-600 text-green-100 focus:ring-green-500 focus:ring-offset-gray-800'
                        : mount.is_active
                        ? 'bg-yellow-100 hover:bg-yellow-200 text-yellow-800 focus:ring-yellow-500 focus:ring-offset-white'
                        : 'bg-green-100 hover:bg-green-200 text-green-800 focus:ring-green-500 focus:ring-offset-white'
                    "
                  >
                    <IconRefresh v-if="isMountToggling(mount.id)" class="h-3.5 w-3.5 mr-1 animate-spin" />
                    <IconXCircle v-else-if="mount.is_active" class="h-3.5 w-3.5 mr-1" />
                    <IconCheckCircle v-else class="h-3.5 w-3.5 mr-1" />
                    {{ mount.is_active ? $t("admin.mount.actions.disable") : $t("admin.mount.actions.enable") }}
                  </button>
                  <button
                    @click="confirmDelete(mount.id)"
                    :disabled="isMountDeleting(mount.id)"
                    class="inline-flex items-center px-2.5 py-1.5 rounded-md text-xs font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    :class="
                      darkMode
                        ? 'bg-red-700 hover:bg-red-600 text-red-100 focus:ring-red-500 focus:ring-offset-gray-800'
                        : 'bg-red-100 hover:bg-red-200 text-red-800 focus:ring-red-500 focus:ring-offset-white'
                    "
                  >
                    <IconRefresh v-if="isMountDeleting(mount.id)" class="h-3.5 w-3.5 mr-1 animate-spin" />
                    <IconDelete v-else class="h-3.5 w-3.5 mr-1" />
                    {{ $t("admin.mount.actions.delete") }}
                  </button>
                </template>
                <!-- API密钥用户只能查看，显示只读提示 -->
                <template v-else>
                  <span class="inline-flex items-center px-2.5 py-1.5 rounded-md text-xs font-medium" :class="darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-500'">
                    <IconEye class="h-3.5 w-3.5 mr-1" />
                    {{ $t("admin.mount.actions.view") }}
                  </span>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 分页组件 -->
    <div class="mt-2 mb-4 sm:mt-4 sm:mb-0">
      <CommonPagination
        :dark-mode="darkMode"
        :pagination="pagination"
        :page-size-options="pageSizeOptions"
        mode="offset"
        @offset-changed="handleOffsetChange"
        @limit-changed="handleLimitChange"
      />
    </div>

    <!-- 新建/编辑挂载点表单 -->
    <MountForm v-if="showForm" :dark-mode="darkMode" :mount="currentMount" :user-type="userType" @close="closeForm" @save-success="handleFormSaveSuccess" />

    <!-- 确认对话框 -->
    <ConfirmDialog
      v-bind="dialogState"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>

<style scoped>
/* 自定义滚动条样式 */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
  border-radius: 4px;
}
.dark ::-webkit-scrollbar-thumb {
  background-color: rgba(75, 85, 99, 0.5);
}
::-webkit-scrollbar-thumb:hover {
  background-color: rgba(107, 114, 128, 0.5);
}
.dark ::-webkit-scrollbar-thumb:hover {
  background-color: rgba(107, 114, 128, 0.5);
}

/* 卡片过渡效果 */
.mount-card-enter-active,
.mount-card-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}
.mount-card-enter-from,
.mount-card-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
