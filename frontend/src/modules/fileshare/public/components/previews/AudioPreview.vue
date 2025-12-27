<template>
  <div
    ref="previewContainerRef"
    class="audio-preview rounded-lg overflow-hidden mb-2 w-full relative border border-gray-200 dark:border-gray-700"
    :class="isFullscreen ? 'flex flex-col h-screen' : ''"
  >
    <PreviewProviderHeader
      :title="filename || t('fileView.preview.audio.title')"
      :options="providerOptions"
      :show-select="providerOptions.length > 1"
      :show-fullscreen="true"
      :fullscreen-target="previewContainerRef"
      v-model="selectedProviderKey"
      @fullscreen-change="handleFullscreenChange"
    />

    <!-- 音频预览内容：紧凑设计，内容驱动 -->
    <div
      class="bg-gray-100 dark:bg-gray-700"
      :class="isFullscreen ? 'flex-1 flex items-center justify-center px-6' : 'py-3 px-4'"
    >
      <div class="w-full max-w-2xl mx-auto">
        <audio
          controls
          class="w-full"
          @loadeddata="handleLoad"
          @error="handleError"
        >
          <source :src="currentPreviewUrl" :type="mimetype" />
          {{ t("fileView.preview.audio.notSupported") }}
        </audio>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useProviderSelector } from "@/composables/file-preview/useProviderSelector.js";
import PreviewProviderHeader from "@/components/common/preview/PreviewProviderHeader.vue";

const { t } = useI18n();

const props = defineProps({
  // 多源预览架构
  providers: {
    type: Object,
    default: () => ({}),
  },
  nativeUrl: {
    type: String,
    default: "",
  },
  // 兼容旧调用
  previewUrl: {
    type: String,
    default: "",
  },
  mimetype: {
    type: String,
    required: true,
  },
  filename: {
    type: String,
    default: "",
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["load", "error"]);

// 容器 ref 和全屏状态
const previewContainerRef = ref(null);
const isFullscreen = ref(false);

const handleFullscreenChange = (val) => {
  isFullscreen.value = val;
};

// 解析 nativeUrl
const resolvedNativeUrl = computed(() => props.nativeUrl || props.previewUrl || "");

// 使用统一的 provider 选择器
const {
  providerOptions,
  selectedKey: selectedProviderKey,
  currentUrl: currentPreviewUrl,
} = useProviderSelector({
  providers: computed(() => props.providers || {}),
  nativeUrl: resolvedNativeUrl,
  nativeLabel: computed(() => t("fileView.preview.audio.browserNative")),
});

const handleLoad = () => {
  emit("load");
};

const handleError = () => {
  emit("error");
};
</script>

<style scoped>
/* 全屏时预览容器填满屏幕 */
.audio-preview :deep(:fullscreen),
.audio-preview :deep(:-webkit-full-screen),
.audio-preview :deep(:-moz-full-screen) {
  width: 100vw !important;
  height: 100vh !important;
  background: inherit;
}
</style>
