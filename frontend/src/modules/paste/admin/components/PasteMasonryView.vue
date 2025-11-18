<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import MasonryWall from "@yeger/vue-masonry-wall";
import PasteMasonryCard from "./PasteMasonryCard.vue";

/**
 * Paste 瀑布流视图组件
 * 使用 @yeger/vue-masonry-wall 实现 Pinterest/Memos 风格的瀑布流布局
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

const emit = defineEmits([
  "toggle-select-all",
  "toggle-select-item",
  "view",
  "copy-link",
  "copy-raw-link",
  "preview",
  "edit",
  "delete",
  "show-qrcode",
]);

// 窗口宽度响应式跟踪
const windowWidth = ref(window.innerWidth);

// 响应式列宽配置
const columnWidth = computed(() => {
  // 桌面端 (>=768px): 320px
  // 移动端 (<768px): 280px
  return windowWidth.value >= 768 ? 320 : 280;
});

// 间距配置 (16px)
const gap = 16;

// 处理窗口大小变化
const handleResize = () => {
  windowWidth.value = window.innerWidth;
};

onMounted(() => {
  window.addEventListener("resize", handleResize);
});

onUnmounted(() => {
  window.removeEventListener("resize", handleResize);
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
    <!-- 加载状态 -->
    <div
      v-if="loading"
      class="flex justify-center items-center py-12"
      :class="darkMode ? 'text-gray-300' : 'text-gray-500'"
    >
      <svg
        class="animate-spin h-8 w-8 text-primary-500 mr-3"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          class="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          stroke-width="4"
        ></circle>
        <path
          class="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        ></path>
      </svg>
      <span class="text-lg">加载中...</span>
    </div>

    <!-- 空数据状态 -->
    <div
      v-else-if="pastes.length === 0"
      class="flex flex-col items-center justify-center py-16"
      :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-16 w-16 mb-4 opacity-50"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      <p class="text-lg font-medium">暂无文本分享数据</p>
      <p class="text-sm mt-2">创建第一个文本分享来开始使用瀑布流视图</p>
    </div>

    <!-- 瀑布流布局 -->
    <MasonryWall
      v-else
      :items="pastes"
      :column-width="columnWidth"
      :gap="gap"
      :ssr-columns="1"
    >
      <template #default="{ item }">
        <PasteMasonryCard
          :dark-mode="darkMode"
          :paste="item"
          @click="handleCardClick(item)"
          @preview="emit('preview', item)"
          @edit="emit('edit', item)"
          @delete="emit('delete', item.id)"
          @copy-link="emit('copy-link', item.slug)"
          @show-qrcode="emit('show-qrcode', item.slug)"
        />
      </template>
    </MasonryWall>
  </div>
</template>

<style scoped>
/* 确保瀑布流容器宽度自适应 */
.paste-masonry-view {
  width: 100%;
  padding: 0 1rem;
}

/* 移动端优化 */
@media (max-width: 768px) {
  .paste-masonry-view {
    padding: 0 0.5rem;
  }
}
</style>
