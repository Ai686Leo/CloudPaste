<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- 加载状态 -->
    <div v-if="loading && results.length === 0" class="flex-1 flex items-center justify-center">
      <LoadingIndicator
        :text="t('search.status.searching')"
        :dark-mode="darkMode"
        size="xl"
        icon-class="text-blue-500"
        :text-class="darkMode ? 'text-gray-400' : 'text-gray-500'"
      />
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <IconError size="3xl" class="mx-auto mb-4 text-red-500" aria-hidden="true" />
        <h3 class="text-lg font-medium mb-2" :class="darkMode ? 'text-gray-300' : 'text-gray-900'">
          {{ t("search.status.failed") }}
        </h3>
        <p class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ error }}
        </p>
      </div>
    </div>

    <!-- 搜索结果列表 -->
    <div v-else-if="results.length > 0" class="flex-1 overflow-y-auto custom-scrollbar min-h-0">
      <!-- 结果项列表 - 统一的卡片式布局 -->
      <div class="p-4 space-y-2">
        <div
          v-for="(item, index) in results"
          :key="`${item.mount_id}-${item.s3_key}-${index}`"
          class="result-item p-3 rounded-lg border transition-all duration-200 hover:shadow-md cursor-pointer"
          :class="darkMode ? 'border-gray-700 hover:border-gray-600 bg-gray-800 hover:bg-gray-750' : 'border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50'"
          @click="handleItemClick(item)"
        >
          <div class="flex items-center space-x-3">
            <!-- 文件图标 -->
            <div class="flex-shrink-0">
              <div class="w-8 h-8 flex items-center justify-center" v-html="getFileIcon(item)"></div>
            </div>

            <!-- 文件信息 -->
            <div class="flex-1 min-w-0">
              <!-- 文件名和大小 -->
              <div class="flex items-center gap-2">
                <div class="font-medium truncate" :class="darkMode ? 'text-white' : 'text-gray-900'" :title="item.name" v-html="highlightSearchQuery(item.name, searchQuery)"></div>
                <span
                  class="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium flex-shrink-0"
                  :class="darkMode ? 'bg-blue-900 text-blue-200' : 'bg-blue-100 text-blue-800'"
                >
                  {{ typeof item.size === 'number' ? formatFileSize(item.size) : '-' }}
                </span>
              </div>

              <!-- 文件路径 -->
              <div class="text-xs truncate mt-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" :title="item.path">
                {{ item.path }}
              </div>
            </div>

            <!-- 操作按钮 -->
            <div class="flex-shrink-0 flex space-x-1">
              <button
                @click.stop="copyPath(item)"
                class="p-1.5 rounded-md transition-colors"
                :class="darkMode ? 'text-gray-400 hover:text-green-400 hover:bg-gray-700' : 'text-gray-500 hover:text-green-600 hover:bg-gray-100'"
                :title="t('search.results.item.copyPath')"
              >
                <IconCopy size="sm" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 加载更多按钮 -->
      <div v-if="hasMore" class="p-4 text-center border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <button
          @click="loadMore"
          :disabled="loading"
          class="px-4 py-2 rounded-md border transition-colors"
          :class="
            loading
              ? darkMode
                ? 'bg-gray-700 border-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed'
              : darkMode
              ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
          "
        >
          <span v-if="loading" class="flex items-center">
            <IconRefresh class="animate-spin h-4 w-4 mr-2" aria-hidden="true" />
            {{ t("search.results.loadingMore") }}
          </span>
          <span v-else>{{ t("search.results.loadMore") }}</span>
        </button>
      </div>
    </div>

    <!-- 空状态 - 未开始搜索 -->
    <div v-else-if="!hasPerformedSearch && !hasSearchResults && !loading" class="py-12">
      <div class="text-center">
        <IconSearch size="2xl" class="mx-auto mb-3" :class="darkMode ? 'text-gray-500' : 'text-gray-400'" aria-hidden="true" />
        <h3 class="text-base font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-900'">
          {{ t("search.status.idle") }}
        </h3>
        <p class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ t("search.tips.keywordTips") }}
        </p>
      </div>
    </div>

    <!-- 无结果状态 -->
    <div v-else-if="hasPerformedSearch && !hasSearchResults && !loading" class="flex-1 flex items-center justify-center">
      <div class="text-center max-w-sm mx-auto px-4">
        <!-- 更直观的无结果图标 - 空文件夹 + 搜索 -->
        <div class="relative mx-auto h-16 w-16 mb-6">
          <!-- 空文件夹 -->
          <IconFolderOpen size="4xl" :class="darkMode ? 'text-gray-500' : 'text-gray-400'" aria-hidden="true" />
          <!-- 小搜索图标叠加 -->
          <div class="absolute -bottom-1 -right-1 bg-white dark:bg-gray-800 rounded-full p-1">
            <IconSearch size="sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" aria-hidden="true" />
          </div>
        </div>

        <h3 class="text-lg font-medium mb-2" :class="darkMode ? 'text-gray-300' : 'text-gray-900'">
          {{ t("search.results.noResults") }}
        </h3>
        <p class="text-sm leading-relaxed" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ t("search.results.noResultsHint") }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive } from "vue";
import { useI18n } from "vue-i18n";
import { IconCopy, IconError, IconFolderOpen, IconRefresh, IconSearch } from "@/components/icons";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { getFileIcon as getFileIconUtil } from "@/utils/fileTypeIcons.js";
import { formatFileSize } from "@/utils/fileUtils.js";
import { formatDateTime } from "@/utils/timeUtils.js";

// 组件属性
const props = defineProps({
  results: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
  error: {
    type: String,
    default: null,
  },
  hasMore: {
    type: Boolean,
    default: false,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  hasSearchQuery: {
    type: Boolean,
    default: false,
  },
  hasSearchResults: {
    type: Boolean,
    default: false,
  },
  searchQuery: {
    type: String,
    default: "",
  },
  hasPerformedSearch: {
    type: Boolean,
    default: false,
  },
});

// 组件事件
const emit = defineEmits(["item-click", "load-more"]);

// 组合式函数
const { t } = useI18n();

// 复制状态管理 - 复用现有文件列表的模式
const copiedPaths = reactive({});

// 获取文件图标 - 复用现有文件列表的图标获取模式
const getFileIcon = (item) => {
  return getFileIconUtil(
    {
      name: item.name,
      type: item.type,
      isDirectory: item.isDirectory || false,
      isMount: false,
    },
    props.darkMode
  );
};

// 高亮搜索关键词
const highlightSearchQuery = (text, query) => {
  if (!query || !text) {
    return text;
  }

  // 转义特殊字符，防止正则表达式错误
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // 创建不区分大小写的正则表达式
  const regex = new RegExp(`(${escapedQuery})`, "gi");

  // 替换匹配的文本，添加高亮样式
  return text.replace(regex, '<mark class="search-highlight">$1</mark>');
};

// 处理项目点击
const handleItemClick = (item) => {
  emit("item-click", item);
};

// 加载更多
const loadMore = () => {
  if (!props.loading && props.hasMore) {
    emit("load-more");
  }
};

// 复制路径 - 复用现有文件列表的复制功能
const copyPath = async (item) => {
  try {
    await navigator.clipboard.writeText(item.path);

    // 设置复制状态
    copiedPaths[item.s3_key] = true;

    // 2秒后重置状态
    setTimeout(() => {
      copiedPaths[item.s3_key] = false;
    }, 2000);

    console.log("路径已复制:", item.path);
  } catch (error) {
    console.error("复制路径失败:", error);

    // 降级方案：使用传统的复制方法
    try {
      const textArea = document.createElement("textarea");
      textArea.value = item.path;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);

      // 设置复制状态
      copiedPaths[item.s3_key] = true;
      setTimeout(() => {
        copiedPaths[item.s3_key] = false;
      }, 2000);

      console.log("路径已复制（降级方案）:", item.path);
    } catch (fallbackError) {
      console.error("复制路径失败（降级方案）:", fallbackError);
    }
  }
};
</script>

<style scoped>
/* 搜索结果网格布局 */
.md\:grid-cols-search-result {
  grid-template-columns: 2fr 1fr 1fr 1.5fr auto;
}

.md\:grid-cols-search-result-simple {
  grid-template-columns: 2fr 1fr auto;
}

/* 结果项悬停效果 */
.result-item:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

/* 暗色模式下的悬停效果 */
.dark .result-item:hover {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

/* 自定义滚动条样式 */
.custom-scrollbar {
  /* 确保滚动功能在所有浏览器中都能工作 */
  scrollbar-width: thin;
  scrollbar-color: rgba(156, 163, 175, 0.5) transparent;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 8px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
  border-radius: 4px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: rgba(156, 163, 175, 0.7);
}

/* 暗色模式滚动条 */
.dark .custom-scrollbar {
  scrollbar-color: rgba(75, 85, 99, 0.5) transparent;
}

.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(75, 85, 99, 0.5);
}

.dark .custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: rgba(75, 85, 99, 0.7);
}

/* 强制确保滚动容器的高度约束 */
.custom-scrollbar {
  /* 确保容器可以收缩 */
  min-height: 0;
  /* 确保内容溢出时显示滚动条 */
  overflow-y: auto !important;
}

/* 卡片悬停效果增强 */
.result-item {
  transition: all 0.2s ease-in-out;
}

.result-item:hover {
  transform: translateY(-1px);
}

/* 暗色模式下的灰色750 */
.hover\:bg-gray-750:hover {
  background-color: #374151;
}

/* 搜索关键词高亮样式 */
.search-highlight {
  background-color: #fbbf24; /* 黄色背景 */
  color: #1f2937; /* 深色文字 */
  padding: 1px 2px;
  border-radius: 2px;
  font-weight: 600;
}

/* 暗色模式下的高亮样式 */
.dark .search-highlight {
  background-color: #f59e0b; /* 更深的黄色 */
  color: #111827; /* 更深的文字 */
}
</style>
