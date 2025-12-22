<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import MasonryWall from "@yeger/vue-masonry-wall";
import PasteMasonryCard from "./PasteMasonryCard.vue";
import { usePasteMasonryView } from "../usePasteMasonryView";
import { IconAdjustments, IconArchive, IconGrid, IconRefresh } from "@/components/icons";

/**
 * Paste 瀑布流视图组件
 */
const props = defineProps({
  darkMode: {
    type: Boolean,
    required: true,
  },
  pastes: {
    type: Array,
    required: true,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  selectedPastes: {
    type: Array,
    required: true,
  },
  copiedTexts: {
    type: Object,
    default: () => ({}),
  },
  copiedRawTexts: {
    type: Object,
    default: () => ({}),
  },
});

const emit = defineEmits(["toggle-select-all", "toggle-select-item", "view", "copy-link", "copy-raw-link", "preview", "edit", "delete", "show-qrcode", "quick-edit-content"]);

// 使用瀑布流视图配置
const {
  // 设置状态
  columnCount,
  horizontalGap,
  verticalGap,
  showViewSettings,

  // MasonryWall配置
  baseGap,
  columnWidth,
  minColumns,
  maxColumns,

  // 设置管理
  isDefaultSettings,
  resetMasonrySettings,

  // 工具栏交互
  toggleViewSettings,

  // 初始化和清理方法
  setupWatchers,
  cleanupWatchers,
} = usePasteMasonryView();

// 处理窗口大小变化
const handleResize = () => {
  // MasonryWall会自动响应宽度变化，这里保留以防未来需要
};

// 点击外部关闭菜单
const handleClickOutside = (event) => {
  // 关闭工具栏菜单
  if (!event.target.closest(".paste-masonry-toolbar")) {
    showViewSettings.value = false;
  }
};

// 更新CSS变量以控制垂直间距（水平间距由MasonryWall的gap属性控制）
const updateSpacingCSSVariables = () => {
  const masonryElement = document.querySelector(".paste-masonry-wall");
  if (masonryElement) {
    masonryElement.style.setProperty("--vertical-gap", `${verticalGap.value}px`);
  }
};

// 监听垂直间距变化
watch(
  verticalGap,
  () => {
    updateSpacingCSSVariables();
  },
  { immediate: true }
);

onMounted(() => {
  window.addEventListener("resize", handleResize);
  document.addEventListener("click", handleClickOutside);

  // 设置监听器
  setupWatchers();

  // 初始化CSS变量
  nextTick(() => {
    updateSpacingCSSVariables();
  });
});

onUnmounted(() => {
  window.removeEventListener("resize", handleResize);
  document.removeEventListener("click", handleClickOutside);
  // 清理瀑布流视图的监听器
  cleanupWatchers();
});

/**
 * 处理卡片点击（打开预览模态框）
 * @param {Object} paste - 文本对象
 */
const handleCardClick = (paste) => {
  emit("preview", paste);
};
</script>

<template>
  <div class="paste-masonry-view">
    <!-- 瀑布流工具栏 -->
    <div class="paste-masonry-toolbar mb-4" :class="darkMode ? 'bg-gray-800/80' : 'bg-white/90'">
      <!-- 主工具栏 -->
      <div class="px-3 py-2 border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <div class="flex items-center justify-between">
          <!-- 左侧：统计信息 -->
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2">
              <!-- 瀑布流图标 -->
              <IconGrid class="w-5 h-5" :class="darkMode ? 'text-primary-400' : 'text-primary-600'" />
              <span class="font-medium text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-900'">瀑布流视图</span>
            </div>

            <!-- 分隔符 -->
            <div class="w-px h-4" :class="darkMode ? 'bg-gray-600' : 'bg-gray-300'"></div>

            <!-- 统计信息 -->
            <span class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
              {{ pastes.length }} 条文本
            </span>
          </div>

          <!-- 右侧：设置按钮 -->
          <div class="flex items-center gap-2">
            <!-- 视图设置按钮 -->
            <button
              @click="toggleViewSettings"
              class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors"
              :class="darkMode ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-700'"
            >
              <IconAdjustments class="w-4 h-4" />
              <span class="hidden sm:inline">视图设置</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 展开的视图设置面板 -->
      <div v-if="showViewSettings" class="px-3 py-2 border-b" :class="darkMode ? 'border-gray-700 bg-gray-800/30' : 'border-gray-200 bg-gray-50/50'">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <!-- 列数控制 -->
          <div class="space-y-2">
            <label class="block text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">列数</label>
            <div class="flex items-center gap-2">
              <!-- 自动按钮 -->
              <button
                @click="columnCount = 'auto'"
                class="px-3 py-1.5 text-xs rounded-md transition-colors"
                :class="[
                  columnCount === 'auto'
                    ? darkMode
                      ? 'bg-blue-600 text-white'
                      : 'bg-blue-500 text-white'
                    : darkMode
                    ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300',
                ]"
              >
                自动
              </button>

              <!-- 列数按钮组 -->
              <div class="flex rounded-md overflow-hidden border" :class="darkMode ? 'border-gray-600' : 'border-gray-300'">
                <button
                  v-for="cols in [1, 2, 3, 4]"
                  :key="cols"
                  @click="columnCount = cols.toString()"
                  class="px-2 py-1.5 text-xs transition-colors"
                  :class="[
                    columnCount === cols.toString()
                      ? darkMode
                        ? 'bg-gray-700 text-white'
                        : 'bg-gray-200 text-gray-900'
                      : darkMode
                      ? 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      : 'bg-white text-gray-600 hover:bg-gray-50',
                  ]"
                >
                  {{ cols }}
                </button>
              </div>
            </div>
          </div>

          <!-- 间距控制 -->
          <div class="space-y-3 sm:col-span-2">
            <div class="flex items-center justify-between">
              <label class="block text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">间距</label>
              <button
                @click="resetMasonrySettings"
                :disabled="isDefaultSettings"
                class="text-xs px-2 py-1 rounded transition-colors"
                :class="[
                  isDefaultSettings
                    ? darkMode
                      ? 'text-gray-600 cursor-not-allowed'
                      : 'text-gray-400 cursor-not-allowed'
                    : darkMode
                    ? 'text-gray-400 hover:text-gray-300 hover:bg-gray-700'
                    : 'text-gray-600 hover:text-gray-700 hover:bg-gray-100',
                ]"
                :title="isDefaultSettings ? '已是默认设置' : '重置为默认'"
              >
                重置
              </button>
            </div>

            <!-- 水平排列的间距控制 -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <!-- 水平间距控制 -->
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label class="text-xs font-medium" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">水平间距（列间距）</label>
                  <span class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">{{ horizontalGap }}px</span>
                </div>
                <div class="relative">
                  <input
                    v-model.number="horizontalGap"
                    type="range"
                    min="0"
                    max="48"
                    step="2"
                    class="w-full h-2 rounded-lg appearance-none cursor-pointer spacing-slider horizontal-slider"
                    :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"
                  />
                  <div class="flex justify-between text-xs mt-1" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                    <span>紧凑</span>
                    <span>宽松</span>
                  </div>
                </div>
              </div>

              <!-- 垂直间距控制 -->
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label class="text-xs font-medium" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">垂直间距（行间距）</label>
                  <span class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">{{ verticalGap }}px</span>
                </div>
                <div class="relative">
                  <input
                    v-model.number="verticalGap"
                    type="range"
                    min="0"
                    max="48"
                    step="2"
                    class="w-full h-2 rounded-lg appearance-none cursor-pointer spacing-slider vertical-slider"
                    :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"
                  />
                  <div class="flex justify-between text-xs mt-1" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                    <span>紧凑</span>
                    <span>宽松</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="flex justify-center items-center py-12" :class="darkMode ? 'text-gray-300' : 'text-gray-500'">
      <IconRefresh class="animate-spin h-8 w-8 text-primary-500 mr-3" />
      <span class="text-lg">加载中...</span>
    </div>

    <!-- 空数据状态 -->
    <div v-else-if="pastes.length === 0" class="flex flex-col items-center justify-center py-16" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
      <IconArchive class="h-16 w-16 mb-4 opacity-50" />
      <p class="text-lg font-medium">暂无文本分享数据</p>
      <p class="text-sm mt-2">创建第一个文本分享来开始使用瀑布流视图</p>
    </div>

    <!-- 瀑布流布局 -->
    <MasonryWall
      v-else
      :items="pastes"
      :column-width="columnWidth"
      :gap="baseGap"
      :min-columns="minColumns"
      :max-columns="maxColumns"
      :ssr-columns="1"
      class="paste-masonry-wall"
    >
      <template #default="{ item }">
        <PasteMasonryCard
          :key="item.id"
          :dark-mode="darkMode"
          :paste="item"
          @click="handleCardClick(item)"
          @preview="emit('preview', item)"
          @edit="emit('edit', item)"
          @delete="emit('delete', item.id)"
          @copy-link="emit('copy-link', item.slug)"
          @copy-raw-link="emit('copy-raw-link', item.slug)"
          @show-qrcode="emit('show-qrcode', item.slug)"
          @quick-edit-content="emit('quick-edit-content', $event)"
        />
      </template>
    </MasonryWall>
  </div>
</template>

<style scoped>
/* 确保瀑布流容器宽度自适应 */
/* 上右下左：顶部和底部都留出呼吸空间 */
.paste-masonry-view {
  width: 100%;
  padding: 1.5rem 1rem 2rem 1rem;
}

/* 移动端优化 */
/* 移动端上下padding稍小 */
@media (max-width: 768px) {
  .paste-masonry-view {
    padding: 1rem 0.5rem 1.5rem 0.5rem;
  }
}

/* 瀑布流工具栏样式 */
.paste-masonry-toolbar {
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  transition: all 0.2s ease;
  position: relative;
  z-index: 10;
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.dark .paste-masonry-toolbar {
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.paste-masonry-toolbar:hover {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
}

.dark .paste-masonry-toolbar:hover {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

/* 工具栏按钮样式 */
.paste-masonry-toolbar button {
  font-weight: 500;
  transition: background-color 0.2s ease, color 0.2s ease;
}

/* 瀑布流容器 - 支持垂直间距CSS变量 */
.paste-masonry-wall {
  width: 100%;
  margin: 0 auto;
  padding: 0;
}

/* 瀑布流卡片容器 - 使用CSS变量控制垂直间距 */
.paste-masonry-wall :deep(.paste-masonry-card) {
  /* 只控制垂直间距，水平间距由MasonryWall的gap属性控制 */
  margin-bottom: var(--vertical-gap, 16px);
}

/* 间距滑块样式 */
.spacing-slider {
  background: linear-gradient(to right, #e5e7eb 0%, #e5e7eb 100%);
  transition: all 0.2s ease;
}

.dark .spacing-slider {
  background: linear-gradient(to right, #374151 0%, #374151 100%);
}

.spacing-slider::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: all 0.2s ease;
}

.horizontal-slider::-webkit-slider-thumb {
  background: #10b981; /* 绿色表示水平 */
}

.vertical-slider::-webkit-slider-thumb {
  background: #3b82f6; /* 蓝色表示垂直 */
}

.dark .horizontal-slider::-webkit-slider-thumb {
  background: #34d399;
  border-color: #1f2937;
}

.dark .vertical-slider::-webkit-slider-thumb {
  background: #60a5fa;
  border-color: #1f2937;
}

.spacing-slider::-webkit-slider-thumb:hover {
  transform: scale(1.1);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
}

/* Firefox 滑块样式 */
.spacing-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: all 0.2s ease;
}

.horizontal-slider::-moz-range-thumb {
  background: #10b981;
}

.vertical-slider::-moz-range-thumb {
  background: #3b82f6;
}

.dark .horizontal-slider::-moz-range-thumb {
  background: #34d399;
  border-color: #1f2937;
}

.dark .vertical-slider::-moz-range-thumb {
  background: #60a5fa;
  border-color: #1f2937;
}
</style>
