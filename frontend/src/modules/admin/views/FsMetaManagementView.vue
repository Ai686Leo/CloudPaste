<script setup>
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useFsMetaManagement } from "@/modules/admin/composables/useFsMetaManagement.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";

// 导入子组件
import FsMetaTable from "@/modules/admin/components/FsMetaTable.vue";
import FsMetaForm from "@/modules/admin/components/FsMetaForm.vue";
import CommonPagination from "@/components/common/CommonPagination.vue";
import GlobalSearchBox from "@/components/common/GlobalSearchBox.vue";

/**
 * 使用主题模式 composable
 */
const { isDarkMode: darkMode } = useThemeMode();
const { t } = useI18n();
const {
  metaList,
  loading,
  error,
  loadMetaList,
  createMeta,
  updateMeta,
  deleteMeta,
} = useFsMetaManagement();
// 本地状态
const showForm = ref(false);
const currentMeta = ref(null);
const showDeleteConfirm = ref(false);
const metaToDelete = ref(null);
const lastRefreshTime = ref("");

// 搜索状态
const globalSearchValue = ref("");
const isSearchMode = ref(false);
const searchLoading = ref(false);
const filteredMetaList = ref([]);

// 分页状态
const pagination = ref({
  offset: 0,
  limit: 20,
  total: 0,
  hasMore: false,
});

const pageSizeOptions = ref([10, 20, 50, 100]);

// 更新分页信息
const updatePagination = (list) => {
  const total = list.length;
  pagination.value.total = total;
  pagination.value.hasMore = pagination.value.offset + pagination.value.limit < total;
};

// 获取当前页数据
const getCurrentPageData = () => {
  const start = pagination.value.offset;
  const end = start + pagination.value.limit;
  const sourceList = isSearchMode.value ? filteredMetaList.value : metaList.value;
  return sourceList.slice(start, end);
};

// 加载数据
const loadData = async () => {
  loading.value = true;
  try {
    await loadMetaList();
    updatePagination(metaList.value);
    const locale = navigator.language || "zh-CN";
    lastRefreshTime.value = new Date().toLocaleString(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } finally {
    loading.value = false;
  }
};

// 全局搜索处理
const handleGlobalSearch = (searchValue) => {
  globalSearchValue.value = searchValue;

  if (!searchValue || searchValue.trim().length < 2) {
    // 清除搜索
    isSearchMode.value = false;
    filteredMetaList.value = [];
    pagination.value.offset = 0;
    updatePagination(metaList.value);
    return;
  }

  try {
    searchLoading.value = true;
    isSearchMode.value = true;

    // 客户端搜索（根据路径过滤）
    const query = searchValue.trim().toLowerCase();
    filteredMetaList.value = metaList.value.filter((meta) => meta.path.toLowerCase().includes(query));

    // 重置分页到第一页
    pagination.value.offset = 0;
    updatePagination(filteredMetaList.value);
  } finally {
    searchLoading.value = false;
  }
};

// 清除搜索
const clearGlobalSearch = () => {
  globalSearchValue.value = "";
  isSearchMode.value = false;
  filteredMetaList.value = [];
  pagination.value.offset = 0;
  updatePagination(metaList.value);
};

// 处理分页变化
const handleOffsetChange = (newOffset) => {
  pagination.value.offset = newOffset;
};

// 处理每页数量变化
const handlePageSizeChange = (newPageSize) => {
  pagination.value.limit = newPageSize;
  pagination.value.offset = 0; // 重置到第一页
  const sourceList = isSearchMode.value ? filteredMetaList.value : metaList.value;
  updatePagination(sourceList);
};

// 打开创建表单
const openCreateForm = () => {
  currentMeta.value = null;
  showForm.value = true;
};

// 打开编辑表单
const openEditForm = (meta) => {
  currentMeta.value = { ...meta };
  showForm.value = true;
};

// 关闭表单
const closeForm = () => {
  showForm.value = false;
  currentMeta.value = null;
};

// 处理表单保存
const handleFormSave = async (data) => {
  let success;
  if (currentMeta.value) {
    // 编辑模式
    success = await updateMeta(currentMeta.value.id, data);
  } else {
    // 创建模式
    success = await createMeta(data);
  }

  if (success) {
    closeForm();
    // 重新加载数据
    await loadData();
    // 如果在搜索模式，重新搜索
    if (isSearchMode.value && globalSearchValue.value) {
      handleGlobalSearch(globalSearchValue.value);
    }
  }
};

// 确认删除
const confirmDelete = (meta) => {
  metaToDelete.value = meta;
  showDeleteConfirm.value = true;
};

// 执行删除
const handleDelete = async () => {
  if (!metaToDelete.value) return;

  const success = await deleteMeta(metaToDelete.value.id);
  if (success) {
    showDeleteConfirm.value = false;
    metaToDelete.value = null;
    // 重新加载数据
    await loadData();
    // 如果在搜索模式，重新搜索
    if (isSearchMode.value && globalSearchValue.value) {
      handleGlobalSearch(globalSearchValue.value);
    }
  }
};

// 取消删除
const cancelDelete = () => {
  showDeleteConfirm.value = false;
  metaToDelete.value = null;
};

// 组件挂载时加载数据
onMounted(() => {
  loadData();
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
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 sm:h-4 sm:w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            <span class="hidden xs:inline">{{ $t("admin.fsMeta.toolbar.create") }}</span>
            <span class="xs:hidden">{{ $t("admin.fsMeta.toolbar.createShort") }}</span>
          </button>

          <!-- 刷新按钮 -->
          <button
            class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            @click="loadData"
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
            <span class="hidden xs:inline">{{ loading ? $t("admin.fsMeta.toolbar.refreshing") : $t("admin.fsMeta.toolbar.refresh") }}</span>
            <span class="xs:hidden">{{ loading ? "..." : $t("admin.fsMeta.toolbar.refreshShort") }}</span>
          </button>
        </div>
      </div>

      <!-- 搜索框 -->
      <div class="w-full">
        <GlobalSearchBox
          v-model="globalSearchValue"
          :placeholder="$t('admin.fsMeta.search.placeholder')"
          :show-hint="true"
          :search-hint="$t('admin.fsMeta.search.hint')"
          size="md"
          :debounce-ms="300"
          @search="handleGlobalSearch"
          @clear="clearGlobalSearch"
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
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 sm:h-4 sm:w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {{ $t("admin.fsMeta.lastRefresh") }}: {{ lastRefreshTime }}
        </span>
      </div>
    </div>

    <!-- 加载中指示器 -->
    <div v-if="loading && !metaList.length" class="flex justify-center my-8">
      <svg class="animate-spin h-8 w-8" :class="darkMode ? 'text-blue-400' : 'text-blue-500'" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    </div>

    <!-- 数据展示区域 -->
    <div v-if="!loading || metaList.length" class="overflow-hidden bg-white dark:bg-gray-800 shadow-md rounded-lg flex-1">
      <div class="flex flex-col h-full">
        <FsMetaTable :dark-mode="darkMode" :meta-list="getCurrentPageData()" :loading="loading || searchLoading" @edit="openEditForm" @delete="confirmDelete" />
      </div>
    </div>

    <!-- 空状态 -->
    <div
      v-if="!loading && pagination.total === 0"
      class="flex flex-col items-center justify-center py-12 bg-white dark:bg-gray-800 shadow-md rounded-lg"
      :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
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
        :search-term="globalSearchValue"
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
