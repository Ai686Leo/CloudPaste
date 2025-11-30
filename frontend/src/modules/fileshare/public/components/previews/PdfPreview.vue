<template>
  <div class="pdf-preview rounded-lg overflow-hidden mb-2 flex-grow w-full relative">
    <div class="flex items-center justify-end px-2 py-1 bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
      <!-- 多渠道时允许用户选择预览方式（Browser Native / pdfjs 等） -->
      <select
        v-if="providerOptions.length > 1"
        v-model="selectedProviderKey"
        class="text-xs px-2 py-1 rounded border bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"
      >
        <option v-for="opt in providerOptions" :key="opt.key" :value="opt.key">
          {{ opt.label }}
        </option>
      </select>
    </div>
    <iframe
      :src="currentPreviewUrl"
      frameborder="0"
      class="w-full h-[calc(100vh-350px)] min-h-[300px]"
      @load="handleLoad"
      @error="handleError"
      v-show="!!currentPreviewUrl && !loading && !error"
    ></iframe>
    <!-- PDF加载状态 -->
    <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-lg">
      <div class="text-center">
        <svg class="animate-spin h-8 w-8 text-blue-500 mx-auto mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 0 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
        <p class="text-blue-600 dark:text-blue-400">{{ t("fileView.preview.pdf.loading") }}</p>
      </div>
    </div>
    <!-- PDF错误状态 -->
    <div v-if="error" class="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-lg">
      <div class="text-center p-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-red-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <p class="text-red-600 dark:text-red-400 mb-2">{{ t("fileView.preview.pdf.error") }}</p>
        <p class="text-gray-500 dark:text-gray-400 text-sm">{{ t("fileView.preview.downloadToView") }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";

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
});

const emit = defineEmits(["load", "error"]);

const loading = ref(true);
const error = ref(false);

// 可用预览渠道（包含原生）
const providerOptions = computed(() => {
  const options = [];

  if (props.nativeUrl || props.previewUrl) {
    options.push({
      key: "native",
      label: t("fileView.preview.pdf.browserNative"),
      url: props.nativeUrl || props.previewUrl,
    });
  }

  const providers = props.providers || {};
  for (const key of Object.keys(providers)) {
    options.push({
      key,
      label: key,
      url: providers[key],
    });
  }

  return options;
});

const selectedProviderKey = ref("native");

const currentPreviewUrl = computed(() => {
  const options = providerOptions.value;
  if (!options.length) return "";
  const current = options.find((opt) => opt.key === selectedProviderKey.value) || options[0];
  return current.url || "";
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

onMounted(() => {
  const opts = providerOptions.value;
  if (opts.length) {
    // 默认优先使用浏览器原生预览
    selectedProviderKey.value = "native";
  }
});
</script>
