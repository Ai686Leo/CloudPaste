<script setup>
import { onMounted } from "vue";
import { useFsMetaManagement } from "@/modules/admin/composables/useFsMetaManagement.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { IconArchive, IconClock, IconFolderPlus, IconRefresh } from "@/components/icons";

// 导入子组件
import FsMetaTable from "@/modules/admin/components/FsMetaTable.vue";
import FsMetaForm from "@/modules/admin/components/FsMetaForm.vue";
import CommonPagination from "@/components/common/CommonPagination.vue";
import GlobalSearchBox from "@/components/common/GlobalSearchBox.vue";

/**
 * 使用主题模式 composable
 */
const { isDarkMode: darkMode } = useThemeMode();

// 使用重构后的 FsMeta 管理 composable (已继承 useAdminBase)
const {
  // 状态
  loading,
  error,
  pagination,
  pageSizeOptions,
  lastRefreshTime,

  // 业务数据
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
} = useFsMetaManagement();

// 组件挂载时加载数据
onMounted(() => {
  loadMetaList();
});
</script>

<template>
  <div class="p-3 sm:p-4 md:p-5 lg:p-6 flex-1 flex flex-col overflow-y-auto">
    <!-- 顶部操作栏 -->
      <div class="flex flex-col space-y-3 mb-4">
      <!-- 标题和操作按钮组 -->
      <div class="flex justify-between items-center">
        <h2 class="text-lg sm:text-xl font-medium" :class="darkMode ? 'text-white' : 'text-gray-900'">
          {{ $t("admin.fsMeta.title") }}
        </h2>

        <div class="flex items-center space-x-2">
          <!-- 创建按钮 -->
          <button
            @click="openCreateForm"
            class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <IconFolderPlus class="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
            <span class="hidden xs:inline">{{ $t("admin.fsMeta.toolbar.create") }}</span>
            <span class="xs:hidden">{{ $t("admin.fsMeta.toolbar.createShort") }}</span>
          </button>

          <!-- 刷新按钮 -->
          <button
            class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            @click="loadMetaList"
            :disabled="loading"
          >
            <IconRefresh class="h-3 w-3 sm:h-4 sm:w-4 mr-1" :class="loading ? 'animate-spin' : ''" />
            <span class="hidden xs:inline">{{ loading ? $t("admin.fsMeta.toolbar.refreshing") : $t("admin.fsMeta.toolbar.refresh") }}</span>
            <span class="xs:hidden">{{ loading ? "..." : $t("admin.fsMeta.toolbar.refreshShort") }}</span>
          </button>
        </div>
      </div>

      <!-- 搜索框 -->
      <div class="w-full">
        <GlobalSearchBox
          v-model="searchQuery"
          :placeholder="$t('admin.fsMeta.search.placeholder')"
          :show-hint="true"
          :search-hint="$t('admin.fsMeta.search.hint')"
          size="md"
          :debounce-ms="300"
          @search="handleGlobalSearch"
          @clear="clearSearch"
        />
      </div>

      <!-- 统计信息 -->
      <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center space-y-2 sm:space-y-0">
        <div class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
          {{ $t("admin.fsMeta.stats.total", { count: pagination.total }) }}
          <span v-if="isSearchMode" class="ml-2 text-blue-600 dark:text-blue-400">{{ $t("admin.fsMeta.stats.searchResultTag") }}</span>
        </div>
      </div>
    </div>

    <!-- 错误消息提示 -->
    <div v-if="error" class="mb-4 p-3 rounded-lg" :class="darkMode ? 'bg-red-900/20 text-red-400' : 'bg-red-100 text-red-600'">
      <p>{{ error }}</p>
    </div>

    <!-- 上次刷新时间显示 -->
    <div class="flex justify-between items-center mb-2 sm:mb-3" v-if="lastRefreshTime">
      <div class="text-xs sm:text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
        <span class="inline-flex items-center">
          <IconClock class="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
          {{ $t("admin.fsMeta.lastRefresh") }}: {{ lastRefreshTime }}
        </span>
      </div>
    </div>

    <!-- 加载中指示器 -->
    <div v-if="loading && !paginatedMetaList.length" class="flex justify-center items-center py-12 bg-white dark:bg-gray-800 shadow-md rounded-lg flex-1">
      <IconRefresh class="animate-spin h-8 w-8" :class="darkMode ? 'text-blue-400' : 'text-blue-500'" />
    </div>

    <!-- 数据展示区域 -->
    <div v-else-if="pagination.total > 0" class="overflow-hidden bg-white dark:bg-gray-800 shadow-md rounded-lg flex-1">
      <div class="flex flex-col h-full">
        <FsMetaTable :dark-mode="darkMode" :meta-list="paginatedMetaList" :loading="loading || searchLoading" @edit="openEditForm" @delete="confirmDelete" />
      </div>
    </div>

    <!-- 空状态 -->
    <div
      v-else
      class="flex flex-col items-center justify-center py-12 bg-white dark:bg-gray-800 shadow-md rounded-lg flex-1"
      :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
    >
      <IconArchive class="h-16 w-16 mb-4 opacity-50" />
      <p class="mb-4">
        {{
          isSearchMode
            ? $t("admin.fsMeta.empty.noSearchResults")
            : $t("admin.fsMeta.empty.noData")
        }}
      </p>
      <button
        v-if="!isSearchMode"
        @click="openCreateForm"
        class="px-4 py-2 rounded-lg font-medium transition-colors"
        :class="darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'"
      >
        {{ $t("admin.fsMeta.empty.createFirst") }}
      </button>
    </div>

    <!-- 分页组件 -->
    <div class="mt-2 mb-4 sm:mt-4 sm:mb-0" v-if="pagination.total > 0">
      <CommonPagination
        :dark-mode="darkMode"
        :pagination="pagination"
        :page-size-options="pageSizeOptions"
        :search-mode="isSearchMode"
        :search-term="searchQuery"
        mode="offset"
        @offset-changed="handleOffsetChange"
        @limit-changed="handlePageSizeChange"
      />
    </div>

    <!-- 编辑/创建表单模态框 -->
    <FsMetaForm v-if="showForm" :dark-mode="darkMode" :meta="currentMeta" @save="handleFormSave" @close="closeForm" />

    <!-- 删除确认对话框 -->
    <div v-if="showDeleteConfirm" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="cancelDelete">
      <div class="rounded-lg p-6 max-w-md w-full mx-4" :class="darkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'">
        <h3 class="text-lg font-semibold mb-4">{{ $t("admin.fsMeta.confirmDelete.title") }}</h3>
        <p class="mb-6">
          {{
            $t("admin.fsMeta.confirmDelete.message", {
              path: metaToDelete?.path ?? "",
            })
          }}
        </p>
        <div class="flex justify-end gap-2">
          <button
            @click="cancelDelete"
            class="px-4 py-2 rounded-lg transition-colors"
            :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'"
          >
            {{ $t("admin.fsMeta.confirmDelete.cancel") }}
          </button>
          <button @click="handleDelete" class="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors">
            {{ $t("admin.fsMeta.confirmDelete.confirm") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
