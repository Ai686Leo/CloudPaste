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
        <LoadingIndicator
          :text="$t('mount.filePreview.pdfLoading') || '加载 PDF 中...'"
          size="xl"
          icon-class="text-blue-500 dark:text-blue-400"
          text-class="text-blue-600 dark:text-blue-400"
        />
      </div>
    </div>

    <!-- 无预览 URL 时的占位 -->
    <div v-else class="h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg">
      <div class="text-center p-4">
        <IconDocument size="4xl" class="mx-auto mb-4 text-gray-400" aria-hidden="true" />
        <p class="text-gray-600 dark:text-gray-300 mb-2">{{ $t("mount.filePreview.noPdfPreview") || "无法加载 PDF 预览" }}</p>
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ errorMessage || $t("mount.filePreview.downloadToView") || "请下载文件后在本地查看" }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { IconDocument } from "@/components/icons";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";

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
