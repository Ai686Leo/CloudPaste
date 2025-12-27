<template>
  <div>
    <!-- 文件篮按钮 -->
    <button
      @click="toggleBasket"
      class="relative inline-flex items-center justify-center p-2 sm:px-4 sm:py-1.5 rounded-md sm:rounded-full transition-all duration-200 text-xs sm:text-sm font-medium shadow-sm hover:shadow-md active:scale-95"
      :class="darkMode ? 'bg-primary-600/90 hover:bg-primary-600 text-white' : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200'"
      :title="basketTitle"
    >
      <!-- 文件篮图标 -->
      <IconShoppingCart size="sm" class="w-4 h-4 mr-1 sm:mr-1.5" aria-hidden="true" />

      <!-- 按钮文本 -->
      <span class="whitespace-nowrap hidden sm:inline">{{ basketButtonText }}</span>

      <!-- 文件数量徽章 -->
    </button>

    <!-- 文件篮面板 (Popover) -->
    <FileBasketPanel
      v-if="isBasketOpen"
      :is-open="isBasketOpen"
      :dark-mode="darkMode"
      @close="closeBasket"
      @task-created="$emit('task-created', $event)"
      @show-message="$emit('show-message', $event)"
    />
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useFileBasket } from "@/composables/file-system/useFileBasket.js";
import { IconShoppingCart } from "@/components/icons";
import FileBasketPanel from "./FileBasketPanel.vue";

const { t } = useI18n();

const props = defineProps({
  darkMode: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["task-created", "show-message"]);

// 使用文件篮composable
const { collectionCount, hasCollection, directoryCount, basketButtonText, toggleBasket, isBasketOpen, closeBasket } = useFileBasket();

// 文件篮按钮 title 信息
const basketTitle = computed(() => {
  if (!hasCollection.value) {
    return t("fileBasket.panel.empty");
  }
  return t("fileBasket.panel.summary", {
    fileCount: collectionCount.value,
    directoryCount: directoryCount.value,
  });
});
</script>
