<template>
  <div class="p-3 sm:p-4 md:p-5 lg:p-6 flex-1 flex flex-col overflow-y-auto">
    <!-- 顶部操作栏 -->
    <div class="flex flex-col space-y-3 mb-4">
      <!-- 标题和刷新按钮 -->
      <div class="flex justify-between items-center">
        <h2 class="text-lg font-medium text-gray-900 dark:text-white">文件管理</h2>
        <!-- 刷新按钮 - 在所有屏幕尺寸显示 -->
        <button
          type="button"
          class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          @click.prevent="refreshFiles"
          :disabled="loading || searchLoading"
        >
          <IconRefresh class="h-3 w-3 sm:h-4 sm:w-4 mr-1" :class="loading || searchLoading ? 'animate-spin' : ''" />
          <span class="hidden xs:inline">刷新</span>
          <span class="xs:hidden">刷新</span>
        </button>
      </div>

      <!-- 搜索框 -->
      <div class="w-full">
        <GlobalSearchBox
          v-model="searchQuery"
          placeholder="搜索文件（支持文件名、链接、备注）"
          :show-hint="true"
          search-hint="服务端搜索，支持模糊匹配"
          size="md"
          :debounce-ms="300"
          @search="handleGlobalSearch"
          @clear="clearSearch"
        />
      </div>

      <!-- 统计信息和操作按钮 -->
      <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center space-y-2 sm:space-y-0">
        <div class="text-sm text-gray-600 dark:text-gray-400">
          共 {{ pagination.total }} 个文件
          <span v-if="selectedFiles.length > 0" class="ml-2"> (已选择 {{ selectedFiles.length }} 个) </span>
        </div>
        <div class="flex flex-wrap gap-1 sm:gap-2">
          <!-- 删除模式开关 -->
          <div
            class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-xs sm:text-sm font-medium rounded-md shadow-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 flex-grow sm:flex-grow-0"
          >
            <span class="mr-2">仅删除记录</span>
            <button
              type="button"
              @click.prevent="deleteSettingsStore.toggleDeleteMode"
              class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              :class="deleteSettingsStore.deleteRecordOnly ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'"
            >
              <span
                class="inline-block h-3 w-3 transform rounded-full bg-white transition-transform"
                :class="deleteSettingsStore.deleteRecordOnly ? 'translate-x-5' : 'translate-x-1'"
              ></span>
            </button>
          </div>

          <!-- 批量删除按钮 -->
          <button
            type="button"
            @click.prevent="handleBatchDelete"
            :disabled="selectedFiles.length === 0"
            :class="[
              'inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-xs sm:text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 flex-grow sm:flex-grow-0',
              selectedFiles.length === 0 ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'text-white bg-red-600 hover:bg-red-700 focus:ring-red-500',
            ]"
          >
            <IconDelete class="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
            <span class="hidden xs:inline">批量删除{{ selectedFiles.length ? ` (${selectedFiles.length})` : "" }}</span>
            <span class="xs:hidden">删除{{ selectedFiles.length ? ` (${selectedFiles.length})` : "" }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 上次刷新时间显示 -->
    <div class="flex justify-between items-center mb-2 sm:mb-3" v-if="lastRefreshTime">
      <div class="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
        <span class="inline-flex items-center">
          <IconClock class="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
          上次刷新: {{ lastRefreshTime }}
        </span>
      </div>
    </div>

    <!-- 加载中指示器 -->
    <div v-if="loading" class="flex justify-center my-8">
      <IconRefresh class="animate-spin h-8 w-8" :class="darkMode ? 'text-blue-400' : 'text-blue-500'" />
    </div>

    <!-- 数据展示区域 -->
    <div v-if="!loading" class="overflow-hidden bg-white dark:bg-gray-800 shadow-md rounded-lg flex-1">
      <div class="flex flex-col h-full">
        <FileTable
          :files="files"
          :dark-mode="darkMode"
          :selected-files="selectedFiles"
          :user-type="props.userType"
          :loading="loading || searchLoading"
          @toggle-select="toggleSelectItem"
          @toggle-select-all="toggleSelectAll"
          @edit="openEditModal"
          @preview="openPreviewModal"
          @delete="handleFileDelete"
          @generate-qr="(file) => generateQRCode(file, darkMode)"
          @copy-link="copyFileLink"
          @copy-permanent-link="copyPermanentLink"
          @error="showError"
        />
      </div>
    </div>

    <!-- 分页组件（搜索和正常模式统一显示） -->
    <div class="mt-2 mb-4 sm:mt-4 sm:mb-0">
      <CommonPagination
        :dark-mode="darkMode"
        :pagination="pagination"
        :page-size-options="pageSizeOptions"
        :search-mode="isSearchMode"
        :search-term="searchQuery"
        mode="offset"
        @offset-changed="handleOffsetChangeWithSearch"
        @limit-changed="handlePageSizeChange"
      />
    </div>

    <!-- 编辑文件元数据弹窗 -->
    <FileEditModal v-if="showEdit" :file="editingFile" :dark-mode="darkMode" @close="showEdit = false" @save="updateFileMetadata" />

    <!-- 文件预览弹窗 -->
    <FilePreviewModal
      v-if="showPreview"
      :file="previewFile"
      :dark-mode="darkMode"
      @close="showPreview = false"
      @preview-file="previewFileInNewWindow"
      @download-file="downloadFileDirectly"
    />

    <!-- 二维码弹窗 -->
    <QRCodeModal v-if="showQRCodeModal" :qr-code-url="qrCodeDataURL" :file-slug="qrCodeSlug" :dark-mode="darkMode" @close="showQRCodeModal = false" />

    <!-- 确认对话框 -->
    <ConfirmDialog
      v-bind="dialogState"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>

<script setup>
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useFileManagement } from "@/modules/fileshare/admin/useFileManagement.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useConfirmDialog, createConfirmFn } from "@/composables/core/useConfirmDialog.js";
import { IconClock, IconDelete, IconRefresh } from "@/components/icons";
import { useDeleteSettingsStore } from "@/stores/deleteSettingsStore.js";

// 导入子组件
import FileTable from "@/modules/fileshare/admin/components/FileTable.vue";
import CommonPagination from "@/components/common/CommonPagination.vue";
import FileEditModal from "@/components/file/FileEditModal.vue";
import FilePreviewModal from "@/modules/fileshare/admin/components/FilePreviewModal.vue";
import QRCodeModal from "@/modules/fileshare/admin/components/QRCodeModal.vue";
import GlobalSearchBox from "@/components/common/GlobalSearchBox.vue";
import ConfirmDialog from "@/components/common/dialogs/ConfirmDialog.vue";

/**
 * 组件接收的属性定义
 * userType: 用户类型，'admin'或'apikey'
 */
const props = defineProps({
  userType: {
    type: String,
    default: "admin", // 默认为管理员
    validator: (value) => ["admin", "apikey"].includes(value),
  },
});

/**
 * 使用主题模式 composable
 */
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

// 使用文件管理composable
const {
  // 状态
  loading,
  selectedItems: selectedFiles,
  lastRefreshTime,
  pagination,
  pageSizeOptions,
  files,
  editingFile,
  previewFile,
  showEdit,
  showPreview,
  showQRCodeModal,
  qrCodeDataURL,
  qrCodeSlug,
  searchQuery,
  isSearchMode,
  searchLoading,

  // 方法
  loadFiles,
  refreshFiles,
  handleGlobalSearch,
  clearSearch,
  handleOffsetChangeWithSearch,
  handlePageSizeChange,
  handleFileDelete,
  handleBatchDelete,
  openEditModal,
  updateFileMetadata,
  openPreviewModal,
  generateQRCode,
  copyFileLink,
  copyPermanentLink,
  showError,
  previewFileInNewWindow,
  downloadFileDirectly,
  toggleSelectItem,
  toggleSelectAll,
} = useFileManagement(props.userType, { confirmFn });

// 需要在模板中使用的删除设置store
const deleteSettingsStore = useDeleteSettingsStore();

// 组件挂载时加载文件列表
onMounted(loadFiles);
</script>
