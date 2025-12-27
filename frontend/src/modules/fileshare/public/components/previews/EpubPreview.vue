<template>
  <div ref="previewContainerRef" class="epub-preview rounded-lg overflow-hidden mb-2 flex-grow w-full relative border border-gray-200 dark:border-gray-700">
    <PreviewProviderHeader
      :title="filename || 'EPUB'"
      :options="providerOptions"
      v-model="selectedProviderKey"
      :show-select="providerOptions.length > 1"
      :show-fullscreen="true"
      :fullscreen-target="previewContainerRef"
      @fullscreen-change="handleFullscreenChange"
    />

    <!-- 预览内容 -->
    <div
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
import { useProviderSelector } from "@/composables/file-preview/useProviderSelector.js";
import PreviewProviderHeader from "@/components/common/preview/PreviewProviderHeader.vue";

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
  filename: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["load", "error"]);

const previewContainerRef = ref(null);
const isFullscreen = ref(false);

const handleFullscreenChange = (val) => {
  isFullscreen.value = val;
};

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
