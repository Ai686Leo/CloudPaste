<template>
  <div ref="previewContainerRef" class="pdf-preview rounded-lg overflow-hidden mb-2 flex-grow w-full relative border border-gray-200 dark:border-gray-700">
    <PreviewProviderHeader
      :title="filename || 'PDF'"
      :options="providerOptions"
      :show-select="providerOptions.length > 1"
      :show-fullscreen="true"
      :fullscreen-target="previewContainerRef"
      v-model="selectedProviderKey"
      @fullscreen-change="handleFullscreenChange"
    />
    <iframe
      :src="currentPreviewUrl"
      allow="fullscreen"
      allowfullscreen
      frameborder="0"
      class="w-full"
      :class="isFullscreen ? 'h-screen' : 'h-[calc(100vh-350px)] min-h-[300px]'"
      @load="handleLoad"
      @error="handleError"
      v-show="!!currentPreviewUrl && !loading && !error"
    ></iframe>
    <!-- PDF加载状态 -->
    <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-lg">
      <LoadingIndicator
        :text="t('fileView.preview.pdf.loading')"
        size="xl"
        icon-class="text-blue-500 dark:text-blue-400"
        text-class="text-blue-600 dark:text-blue-400"
      />
    </div>
    <!-- PDF错误状态 -->
    <div v-if="error" class="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-lg">
      <div class="text-center p-4">
        <IconExclamation class="h-12 w-12 text-red-500 mx-auto mb-2" />
        <p class="text-red-600 dark:text-red-400 mb-2">{{ t("fileView.preview.pdf.error") }}</p>
        <p class="text-gray-500 dark:text-gray-400 text-sm">{{ t("fileView.preview.downloadToView") }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { IconExclamation } from "@/components/icons";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { useProviderSelector } from "@/composables/file-preview/useProviderSelector.js";
import PreviewProviderHeader from "@/components/common/preview/PreviewProviderHeader.vue";

const { t } = useI18n();

const props = defineProps({
  // 为保持兼容保留 previewUrl，但推荐使用 providers + nativeUrl
  previewUrl: {
    type: String,
    default: "",
  },
  // DocumentApp providers，例如 { pdfjs: 'https://...' }
  providers: {
    type: Object,
    default: () => ({}),
  },
  // 原生浏览器预览 URL（直链 / 代理）
  nativeUrl: {
    type: String,
    default: "",
  },
  filename: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["load", "error"]);

const loading = ref(true);
const error = ref(false);
const previewContainerRef = ref(null);
const isFullscreen = ref(false);

const handleFullscreenChange = (val) => {
  isFullscreen.value = val;
};

const resolvedNativeUrl = computed(() => props.nativeUrl || props.previewUrl || "");

const {
  providerOptions,
  selectedKey: selectedProviderKey,
  currentUrl: currentPreviewUrl,
} = useProviderSelector({
  providers: computed(() => props.providers || {}),
  nativeUrl: resolvedNativeUrl,
  nativeLabel: computed(() => t("fileView.preview.pdf.browserNative")),
  labelMap: computed(() => ({
    pdfjs: t("fileView.preview.pdf.pdfjsLabel"),
  })),
});

const handleLoad = () => {
  loading.value = false;
  error.value = false;
  emit("load");
};

const handleError = () => {
  loading.value = false;
  error.value = true;
  emit("error");
};

watch(
  currentPreviewUrl,
  (url) => {
    if (!url) return;
    loading.value = true;
    error.value = false;
  },
  { immediate: false },
);
</script>

<style scoped>
/* 全屏时预览容器填满屏幕 */
.pdf-preview :deep(:fullscreen),
.pdf-preview :deep(:-webkit-full-screen),
.pdf-preview :deep(:-moz-full-screen) {
  width: 100vw !important;
  height: 100vh !important;
  background: inherit;
}
</style>
