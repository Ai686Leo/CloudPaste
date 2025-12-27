<template>
  <!-- iframe 预览组件：纯内容渲染，工具栏由父组件通过 PreviewProviderHeader 统一管理 -->
  <div class="iframe-preview flex flex-col h-full w-full relative bg-white dark:bg-gray-800">
    <div class="iframe-container relative flex-grow h-[calc(100vh-350px)] min-h-[300px]">
      <iframe
        :src="currentPreviewUrl"
        allow="fullscreen"
        allowfullscreen
        frameborder="0"
        class="w-full h-full"
        @load="handleLoad"
        @error="handleError"
        v-show="!!currentPreviewUrl && !loading && !error"
      ></iframe>
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700">
        <LoadingIndicator
          :text="loadingText || t('fileView.preview.loading')"
          :dark-mode="darkMode"
          size="xl"
          icon-class="text-blue-500"
          :text-class="darkMode ? 'text-blue-400' : 'text-blue-600'"
        />
      </div>
      <div v-else-if="error" class="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700">
        <p class="text-red-600 dark:text-red-400 text-sm">{{ errorText || t("fileView.preview.error") }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { useProviderSelector } from "@/composables/file-preview/useProviderSelector.js";

const { t } = useI18n();

const props = defineProps({
  /** 预览渠道配置对象，格式：{ key: url } */
  providers: {
    type: Object,
    default: () => ({}),
  },
  /** 暗色模式 */
  darkMode: {
    type: Boolean,
    default: false,
  },
  /** 加载中提示文本 */
  loadingText: {
    type: String,
    default: "",
  },
  /** 错误提示文本 */
  errorText: {
    type: String,
    default: "",
  },
  /** 外部传入的选中渠道 key（可选，用于父组件控制） */
  selectedProvider: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["load", "error", "provider-options"]);

const loading = ref(true);
const error = ref(false);

const { providerOptions, selectedKey: internalSelectedKey, currentUrl: currentPreviewUrl } = useProviderSelector({
  providers: computed(() => props.providers || {}),
  nativeUrl: "",
  filter: ({ url }) => url !== "native",
});

watch(
  () => props.selectedProvider,
  (newKey) => {
    if (newKey && providerOptions.value.some((opt) => opt.key === newKey)) {
      internalSelectedKey.value = newKey;
    }
  },
  { immediate: true }
);

watch(
  providerOptions,
  (options) => {
    emit("provider-options", options);
  },
  { immediate: true }
);

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
  { immediate: true }
);

// 暴露给父组件的方法和状态
defineExpose({
  providerOptions,
  selectedKey: internalSelectedKey,
  currentUrl: currentPreviewUrl,
});
</script>
