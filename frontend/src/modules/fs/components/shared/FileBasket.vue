<template>
  <div>
    <!-- 文件篮按钮 -->
    <button
      @click="toggleBasket"
      class="relative inline-flex items-center px-2 sm:px-3 py-1.5 rounded-md transition-colors text-xs sm:text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white shadow-md"
      :title="basketTitle"
    >
      <!-- 文件篮图标 -->
      <IconShoppingCart size="sm" class="w-4 h-4 mr-1 sm:mr-1.5" aria-hidden="true" />

      <!-- 按钮文本 -->
      <span class="whitespace-nowrap">{{ basketButtonText }}</span>

      <!-- 文件数量徽章 -->
    </button>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useFileBasket } from "@/composables/file-system/useFileBasket.js";
import { IconShoppingCart } from "@/components/icons";

const { t } = useI18n();

const props = defineProps({
  darkMode: {
    type: Boolean,
    default: false,
  },
});

// 使用文件篮composable
const { collectionCount, hasCollection, directoryCount, basketButtonText, toggleBasket } = useFileBasket();


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
