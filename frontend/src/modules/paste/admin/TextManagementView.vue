<script setup>
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { usePasteManagement } from "@/modules/paste";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useCreatorBadge } from "@/composables/admin-management/useCreatorBadge.js";
import { useConfirmDialog } from "@/composables/core/useConfirmDialog.js";

// 导入子组件
import PasteTable from "@/modules/paste/admin/components/PasteTable.vue";
import PasteCardList from "@/modules/paste/admin/components/PasteCardList.vue";
import PasteMasonryView from "@/modules/paste/admin/components/PasteMasonryView.vue";
import PastePreviewModal from "@/modules/paste/admin/components/PastePreviewModal.vue";
import PasteEditModal from "@/modules/paste/admin/components/PasteEditModal.vue";
import CommonPagination from "@/components/common/CommonPagination.vue";
import QRCodeModal from "@/modules/fileshare/admin/components/QRCodeModal.vue";
import GlobalSearchBox from "@/components/common/GlobalSearchBox.vue";
import ConfirmDialog from "@/components/common/dialogs/ConfirmDialog.vue";
import ViewModeToggle from "@/components/common/ViewModeToggle.vue";

/**
 * 使用主题模式 composable
 */
const { isDarkMode: darkMode } = useThemeMode();

// 国际化
const { t } = useI18n();

// 创建者徽章统一逻辑
const { formatCreator } = useCreatorBadge();

// 确认对话框
const { dialogState, confirm, handleConfirm, handleCancel } = useConfirmDialog();

// 创建适配确认函数，用于传递给 composable
const confirmFn = async ({ title, message, confirmType }) => {
  return await confirm({
    title,
    message,
    confirmType,
    confirmText: confirmType === "warning" ? t("common.dialogs.cleanupButton") : t("common.dialogs.deleteButton"),
    darkMode: darkMode.value,
  });
};

// 使用文本管理composable
const {
  // 状态
  loading,
  error,
  selectedItems: selectedPastes,
  lastRefreshTime,
  pagination,
  pageSizeOptions,
  pastes,
  previewPaste,
  editingPaste,
  showPreview,
  showEdit,
  showQRCodeModal,
  qrCodeDataURL,
  qrCodeSlug,
  copiedTexts,
  copiedRawTexts,

  // 视图模式
  viewMode,
  switchViewMode,

  // 权限状态
  isAdmin,
  isApiKeyUser,
  isAuthorized,

  // 方法
  loadPastes,
  searchPastes,
  handleOffsetChange,
  changePageSize,
  deletePaste,
  batchDeletePastes,
  clearExpiredPastes,
  openPreview,
  closePreview,
  openEditModal,
  closeEditModal,
  submitEdit,
  copyLink,
  copyRawLink,
  quickEditContent,
  goToViewPage,
  showQRCode,
  toggleSelectItem,
  toggleSelectAll,
  toggleVisibility,
  clearSelection,
} = usePasteManagement({ confirmFn });

// 别名映射，用于模板中的方法调用
const goToPage = handleOffsetChange;
const deleteSelectedPastes = batchDeletePastes;

// 视图模式选项配置
const viewModeOptions = [
  { value: "table", icon: "table", title: "表格视图" },
  { value: "masonry", icon: "masonry", title: "瀑布流视图" },
];

// 全局搜索状态
const globalSearchValue = ref("");

// 搜索状态
const isSearchMode = ref(false);
const searchResults = ref([]);
const searchLoading = ref(false);



// 搜索处理函数 - 使用服务端搜索
const handleGlobalSearch = async (searchValue) => {
  globalSearchValue.value = searchValue;

  if (!searchValue || searchValue.trim().length < 2) {
    // 清除搜索，立即回到正常分页模式
    isSearchMode.value = false;
    searchResults.value = [];
    // 立即重新加载原始数据
    await loadPastes();
    console.log("搜索已清除，恢复到原始列表");
    return;
  }

  try {
    searchLoading.value = true;
    isSearchMode.value = true;

    // 重置分页到第一页进行搜索（offset模式，第一页是offset=0）
    const result = await searchPastes(searchValue.trim(), 0);

    if (result && result.results) {
      // 搜索模式下，直接更新主要的pastes状态和分页信息
      pastes.value = result.results;
      // 更新分页信息 - 改为offset模式
      if (result.pagination) {
        pagination.total = result.pagination.total;
        pagination.offset = result.pagination.offset || 0;
        pagination.hasMore = result.pagination.hasMore !== undefined ? result.pagination.hasMore : pagination.offset + pagination.limit < pagination.total;
      }
      console.log(`文本搜索完成: "${searchValue}", 找到 ${result.pagination?.total || result.results.length} 个结果`);
    } else {
      pastes.value = [];
      pagination.total = 0;
      pagination.offset = 0;
      pagination.hasMore = false;
    }
  } catch (error) {
    console.error("文本搜索失败:", error);
    pastes.value = [];
    pagination.total = 0;
    pagination.offset = 0;
    pagination.hasMore = false;
  } finally {
    searchLoading.value = false;
  }
};

const clearGlobalSearch = async () => {
  globalSearchValue.value = "";
  isSearchMode.value = false;
  searchResults.value = [];

  // 立即重新加载正常的文本列表
  try {
    await loadPastes();
    console.log("清除文本搜索，已恢复到原始列表");
  } catch (error) {
    console.error("清除搜索后重新加载失败:", error);
  }
};

// 处理分页变化（支持搜索模式）- 改为offset模式
const handleOffsetChangeWithSearch = async (newOffset) => {
  if (isSearchMode.value && globalSearchValue.value) {
    // 搜索模式下的分页
    try {
      searchLoading.value = true;
      const result = await searchPastes(globalSearchValue.value, newOffset);

      if (result && result.results) {
        pastes.value = result.results;
        // 更新分页信息
        if (result.pagination) {
          pagination.total = result.pagination.total;
          pagination.offset = result.pagination.offset || newOffset;
          pagination.hasMore = result.pagination.hasMore !== undefined ? result.pagination.hasMore : pagination.offset + pagination.limit < pagination.total;
        }
      }
    } catch (error) {
      console.error("搜索分页失败:", error);
    } finally {
      searchLoading.value = false;
    }
  } else {
    // 正常模式下的分页
    handleOffsetChange(newOffset);
  }
};

// 处理每页数量变化
const handlePageSizeChange = (newPageSize) => {
  changePageSize(newPageSize);
  // 如果在搜索模式，重新搜索
  if (isSearchMode.value && globalSearchValue.value) {
    handleGlobalSearch(globalSearchValue.value);
  } else {
    // 否则重新加载文本列表
    loadPastes();
  }
};

// 组件挂载时加载数据
onMounted(() => {
  console.log("TextManagement组件挂载");
  console.log("TextManagement权限状态检查", {
    isAdmin: isAdmin.value,
    isApiKeyUser: isApiKeyUser.value,
  });

  // 加载分享列表
  loadPastes();
});
</script>

<template>
  <div class="p-3 sm:p-4 md:p-5 lg:p-6 flex-1 flex flex-col overflow-y-auto">
    <!-- 顶部操作栏 -->
    <div class="flex flex-col space-y-3 mb-4">
      <!-- 标题和操作按钮组 -->
      <div class="flex justify-between items-center">
        <h2 class="text-lg sm:text-xl font-medium" :class="darkMode ? 'text-white' : 'text-gray-900'">文本管理</h2>

        <div class="flex items-center space-x-2">
          <!-- 视图模式切换按钮组 - 移动端 -->
          <ViewModeToggle
            v-model="viewMode"
            :options="viewModeOptions"
            :dark-mode="darkMode"
            size="sm"
            class="md:hidden"
          />
          <!-- 视图模式切换按钮组 - 桌面端 -->
          <ViewModeToggle
            v-model="viewMode"
            :options="viewModeOptions"
            :dark-mode="darkMode"
            size="md"
            class="hidden md:inline-flex"
          />

          <!-- 刷新按钮 - 在所有屏幕尺寸显示 -->
          <button
            class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            @click="loadPastes"
            :disabled="loading"
          >
            <svg xmlns="http://www.w3.org/2000/svg" :class="['h-3 w-3 sm:h-4 sm:w-4 mr-1', loading ? 'animate-spin' : '']" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                v-if="!loading"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
              <circle v-if="loading" class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path
                v-if="loading"
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            <span class="hidden xs:inline">{{ loading ? "刷新中..." : "刷新" }}</span>
            <span class="xs:hidden">{{ loading ? "..." : "刷" }}</span>
          </button>
        </div>
      </div>

      <!-- 搜索框 -->
      <div class="w-full">
        <GlobalSearchBox
          v-model="globalSearchValue"
          placeholder="搜索文本分享（支持链接、备注、内容）"
          :show-hint="true"
          search-hint="服务端搜索，支持模糊匹配"
          size="md"
          :debounce-ms="300"
          @search="handleGlobalSearch"
          @clear="clearGlobalSearch"
        />
      </div>

      <!-- 其他操作按钮行 -->
      <div class="flex flex-wrap gap-1 sm:gap-2">
        <!-- 清理过期按钮 -->
        <button
          class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-xs sm:text-sm font-medium rounded-md shadow-sm text-white bg-amber-600 hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 flex-grow sm:flex-grow-0"
          @click="clearExpiredPastes"
          title="系统会自动删除过期内容，但您也可以通过此功能手动立即清理"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 sm:h-4 sm:w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
          <span class="hidden xs:inline">清理过期</span>
          <span class="xs:hidden">清理</span>
        </button>

        <!-- 批量删除按钮 -->
        <button
          :disabled="selectedPastes.length === 0"
          :class="[
            'inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-xs sm:text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 flex-grow sm:flex-grow-0',
            selectedPastes.length === 0 ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'text-white bg-red-600 hover:bg-red-700 focus:ring-red-500',
          ]"
          @click="deleteSelectedPastes"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 sm:h-4 sm:w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
          <span class="hidden xs:inline">批量删除{{ selectedPastes.length ? `(${selectedPastes.length})` : "" }}</span>
          <span class="xs:hidden">删除{{ selectedPastes.length ? `(${selectedPastes.length})` : "" }}</span>
        </button>
      </div>
    </div>

    <!-- 上次刷新时间显示 -->
    <div class="flex justify-between items-center mb-2 sm:mb-3" v-if="lastRefreshTime">
      <div class="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
        <span class="inline-flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 sm:h-4 sm:w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          上次刷新: {{ lastRefreshTime }}
        </span>
      </div>
    </div>

    <!-- 数据展示区域 -->
    <div class="overflow-visible bg-white dark:bg-gray-800 shadow-md rounded-lg flex-1">
      <div class="flex flex-col h-full">
        <!-- 桌面端 - 表格视图 (中等及以上设备显示) -->
        <div v-if="viewMode === 'table'" class="hidden md:block flex-1 overflow-auto">
          <PasteTable
            :dark-mode="darkMode"
            :pastes="pastes"
            :selectedPastes="selectedPastes"
            :loading="loading || searchLoading"
            :copiedTexts="copiedTexts"
            :copiedRawTexts="copiedRawTexts"
            @toggle-select-all="toggleSelectAll"
            @toggle-select-item="toggleSelectItem"
            @view="goToViewPage"
            @copy-link="copyLink"
            @copy-raw-link="copyRawLink"
            @preview="openPreview"
            @edit="openEditModal"
            @delete="deletePaste"
            @show-qrcode="showQRCode"
            @toggle-visibility="toggleVisibility"
          />
        </div>

        <!-- 桌面端 - 瀑布流视图 (中等及以上设备显示) -->
        <div v-if="viewMode === 'masonry'" class="hidden md:block flex-1 overflow-visible">
          <PasteMasonryView
            :dark-mode="darkMode"
            :pastes="pastes"
            :selectedPastes="selectedPastes"
            :loading="loading || searchLoading"
            :copiedTexts="copiedTexts"
            :copiedRawTexts="copiedRawTexts"
            @toggle-select-all="toggleSelectAll"
            @toggle-select-item="toggleSelectItem"
            @view="goToViewPage"
            @copy-link="copyLink"
            @copy-raw-link="copyRawLink"
            @preview="openPreview"
            @edit="openEditModal"
            @delete="deletePaste"
            @show-qrcode="showQRCode"
            @quick-edit-content="quickEditContent"
          />
        </div>

        <!-- 移动端 - 列表视图 (小于中等设备显示) -->
        <div v-if="viewMode === 'table'" class="md:hidden flex-1 overflow-auto">
          <PasteCardList
            :dark-mode="darkMode"
            :pastes="pastes"
            :selectedPastes="selectedPastes"
            :loading="loading"
            :copiedTexts="copiedTexts"
            :copiedRawTexts="copiedRawTexts"
            @toggle-select-item="toggleSelectItem"
            @view="goToViewPage"
            @copy-link="copyLink"
            @copy-raw-link="copyRawLink"
            @preview="openPreview"
            @edit="openEditModal"
            @delete="deletePaste"
            @show-qrcode="showQRCode"
          />
        </div>

        <!-- 移动端 - 瀑布流视图 (小于中等设备显示) -->
        <div v-if="viewMode === 'masonry'" class="md:hidden flex-1 overflow-visible">
          <PasteMasonryView
            :dark-mode="darkMode"
            :pastes="pastes"
            :selectedPastes="selectedPastes"
            :loading="loading || searchLoading"
            :copiedTexts="copiedTexts"
            :copiedRawTexts="copiedRawTexts"
            @toggle-select-all="toggleSelectAll"
            @toggle-select-item="toggleSelectItem"
            @view="goToViewPage"
            @copy-link="copyLink"
            @copy-raw-link="copyRawLink"
            @preview="openPreview"
            @edit="openEditModal"
            @delete="deletePaste"
            @show-qrcode="showQRCode"
            @quick-edit-content="quickEditContent"
          />
        </div>
      </div>
    </div>

    <!-- 分页组件（搜索和正常模式统一显示） -->
    <div class="mt-2 mb-4 sm:mt-4 sm:mb-0">
      <CommonPagination
        :dark-mode="darkMode"
        :pagination="pagination"
        :page-size-options="pageSizeOptions"
        :search-mode="isSearchMode"
        :search-term="globalSearchValue"
        mode="offset"
        @offset-changed="handleOffsetChangeWithSearch"
        @limit-changed="handlePageSizeChange"
      />
    </div>

    <!-- 预览弹窗组件 -->
    <PastePreviewModal
      :dark-mode="darkMode"
      :show-preview="showPreview"
      :paste="previewPaste"
      :copied-texts="copiedTexts"
      @close="closePreview"
      @view-paste="goToViewPage"
      @copy-link="copyLink"
    />

    <!-- 修改弹窗组件 -->
    <PasteEditModal :dark-mode="darkMode" :show-edit="showEdit" :paste="editingPaste" @close="closeEditModal" @save="submitEdit" />

    <!-- 二维码弹窗组件 -->
    <QRCodeModal v-if="showQRCodeModal" :qr-code-url="qrCodeDataURL" :file-slug="qrCodeSlug" :dark-mode="darkMode" @close="showQRCodeModal = false" />

    <!-- 确认对话框 -->
    <ConfirmDialog
      v-bind="dialogState"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>
