<template>
  <div class="epub-preview rounded-lg overflow-hidden mb-2 flex-grow w-full relative border border-gray-200 dark:border-gray-700">
    <!-- 外层工具栏：Provider 切换 + 全屏按钮 -->
    <div class="flex items-center justify-between px-3 py-2 bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
      <span class="text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">EPUB</span>
      <div class="flex items-center gap-2">
        <select
          v-if="providerOptions.length > 1"
          v-model="selectedProviderKey"
          class="text-sm px-2 py-1 rounded border bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"
        >
          <option v-for="opt in providerOptions" :key="opt.key" :value="opt.key">
            {{ opt.label }}
          </option>
        </select>
        <button
          type="button"
          class="flex items-center px-2 py-1 text-sm border rounded transition-colors"
          :class="darkMode ? 'bg-gray-600 hover:bg-gray-500 border-gray-500 text-gray-200' : 'bg-white hover:bg-gray-50 border-gray-300 text-gray-700'"
          @click="toggleFullscreen"
          :title="isFullscreen ? t('fileView.preview.exitFullscreen') : t('fileView.preview.fullscreen')"
        >
          <IconExpand v-if="!isFullscreen" size="sm" class="w-4 h-4" />
          <IconCollapse v-else size="sm" class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- 预览内容 -->
    <div
      ref="previewContainerRef"
      class="relative w-full"
      :class="isFullscreen ? 'h-screen' : 'h-[calc(100vh-350px)] min-h-[300px]'"
    >
      <FoliateEpubView
        v-if="isNativeProvider"
        :src-url="currentNativeUrl"
        :dark-mode="darkMode"
        :loading-text="t('fileView.preview.epub.loading')"
        :error-text="t('fileView.preview.epub.error')"
        class="w-full h-full"
        @load="emit('load')"
        @error="emit('error')"
      />

      <IframePreview
        v-else
        :providers="currentIframeProviders"
        :dark-mode="darkMode"
        :loading-text="t('fileView.preview.loading')"
        :error-text="t('fileView.preview.error')"
        class="w-full h-full"
        @load="emit('load')"
        @error="emit('error')"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import FoliateEpubView from "@/components/common/FoliateEpubView.vue";
import IframePreview from "@/components/common/IframePreview.vue";
import { IconExpand, IconCollapse } from "@/components/icons";
import { useProviderSelector } from "@/composables/file-preview/useProviderSelector.js";
import { useElementFullscreen } from "@/composables/useElementFullscreen.js";

const { t } = useI18n();

const props = defineProps({
  providers: {
    type: Object,
    default: () => ({}),
  },
  // 原生/本地渲染用的 URL（直链 / 代理均可）
  nativeUrl: {
    type: String,
    default: "",
  },
  // 兼容旧调用：如果没传 nativeUrl，就用 previewUrl
  previewUrl: {
    type: String,
    default: "",
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["load", "error"]);

const previewContainerRef = ref(null);

const { isFullscreen, toggleFullscreen } = useElementFullscreen(previewContainerRef);

const resolvedNativeUrl = computed(() => props.nativeUrl || props.previewUrl || "");

const {
  providerOptions,
  selectedKey: selectedProviderKey,
  isNativeProvider,
  currentUrl: currentNativeUrl,
  currentIframeProviders,
} = useProviderSelector({
  providers: computed(() => props.providers || {}),
  nativeUrl: resolvedNativeUrl,
  nativeLabel: computed(() => t("fileView.preview.epub.browserNative")),
});
</script>

<style scoped>
/* 全屏时预览容器填满屏幕 */
.epub-preview :deep(:fullscreen),
.epub-preview :deep(:-webkit-full-screen),
.epub-preview :deep(:-moz-full-screen) {
  width: 100vw !important;
  height: 100vh !important;
  background: inherit;
}

/* 全屏时内部组件填满容器 */
.epub-preview :deep(:fullscreen .foliate-epub-view),
.epub-preview :deep(:-webkit-full-screen .foliate-epub-view),
.epub-preview :deep(:-moz-full-screen .foliate-epub-view) {
  width: 100% !important;
  height: 100% !important;
}
</style>
