<template>
  <div class="pdf-fs-preview-wrapper h-full">
    <!-- iframe 预览区 -->
    <div v-if="previewUrl" class="pdf-iframe-container h-full relative">
      <iframe
        :src="previewUrl"
        frameborder="0"
        class="w-full h-full"
        @load="handleLoad"
        @error="handleError"
      ></iframe>

      <!-- 加载中遮罩 -->
      <div v-if="loading" class="absolute inset-0 bg-white dark:bg-gray-800 bg-opacity-70 flex items-center justify-center">
        <div class="text-center">
          <svg class="animate-spin h-8 w-8 text-blue-500 mx-auto mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 0 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <p class="text-blue-600 dark:text-blue-400">{{ $t("mount.filePreview.pdfLoading") || "加载 PDF 中..." }}</p>
        </div>
      </div>
    </div>

    <!-- 无预览 URL 时的占位 -->
    <div v-else class="h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg">
      <div class="text-center p-4">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-16 w-16 mx-auto mb-4 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
          />
        </svg>
        <p class="text-gray-600 dark:text-gray-300 mb-2">{{ $t("mount.filePreview.noPdfPreview") || "无法加载 PDF 预览" }}</p>
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ errorMessage || $t("mount.filePreview.downloadToView") || "请下载文件后在本地查看" }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps({
  // 预览 URL
  previewUrl: {
    type: String,
    default: "",
  },
  // 错误信息
  errorMessage: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["load", "error"]);

const loading = ref(true);

const handleLoad = () => {
  loading.value = false;
  emit("load");
};

const handleError = (event) => {
  loading.value = false;
  emit("error", event);
};
</script>

<style scoped>
.pdf-fs-preview-wrapper {
  min-height: 400px;
}

.pdf-iframe-container {
  background-color: white;
}

.dark .pdf-iframe-container {
  background-color: #1f2937;
}
</style>
