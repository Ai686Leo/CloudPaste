<template>
  <div
    ref="previewContainerRef"
    class="image-preview rounded-lg overflow-hidden mb-2 w-full relative border border-gray-200 dark:border-gray-700 flex flex-col"
    :class="isFullscreen ? 'h-screen' : ''"
  >
    <PreviewProviderHeader
      :title="filename || t('fileView.preview.image.title')"
      :options="providerOptions"
      :show-select="providerOptions.length > 1"
      :show-fullscreen="true"
      :fullscreen-target="previewContainerRef"
      v-model="selectedProviderKey"
      @fullscreen-change="handleFullscreenChange"
    />

    <!-- 预览内容区域 -->
    <div
      class="flex justify-center items-center bg-gray-50 dark:bg-gray-800"
      :class="isFullscreen ? 'flex-1 min-h-0' : 'h-[calc(100vh-350px)] min-h-[300px]'"
    >
      <!-- Live Photo 预览 -->
      <LivePhotoViewer
        v-if="isLivePhoto && showImage"
        :photo-src="resolvedSrc"
        :video-src="videoUrl"
        :dark-mode="darkMode"
        :max-width="'100%'"
        :show-badge="true"
        :show-badge-text="true"
        :show-progress="true"
        :lazy-load="true"
        :enable-vibration="true"
        class="max-w-full max-h-full"
        @load="handleLoad"
        @error="handleError"
      />
      <!-- 普通图片预览 -->
      <img
        v-else-if="showImage"
        :src="resolvedSrc"
        :alt="filename"
        class="max-w-full max-h-full h-auto object-contain"
        @load="handleLoad"
        @error="handleError"
      />
    </div>

    <!-- 图片加载状态 -->
    <div
      v-if="loading"
      class="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-lg"
    >
      <LoadingIndicator
        :text="t('fileView.preview.image.loading')"
        :dark-mode="darkMode"
        size="2xl"
        :icon-class="darkMode ? 'text-primary-500' : 'text-primary-600'"
        :text-class="darkMode ? 'text-primary-400' : 'text-primary-600'"
      />
    </div>

    <!-- 图片错误状态 -->
    <div
      v-if="error"
      class="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-lg"
    >
      <div class="text-center p-4">
        <IconExclamation class="h-12 w-12 text-red-500 mx-auto mb-2" />
        <p class="text-red-600 dark:text-red-400 mb-2">{{ t("fileView.preview.image.error") }}</p>
        <p class="text-gray-500 dark:text-gray-400 text-sm">{{ t("fileView.preview.downloadToView") }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useI18n } from "vue-i18n";
import { decodeImagePreviewUrlToPngObjectUrl, revokeObjectUrl, shouldAttemptDecodeImagePreview } from "@/utils/imageDecode";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { LivePhotoViewer } from "@/components/common/LivePhoto";
import { isLivePhotoImage } from "@/utils/livePhotoUtils.js";
import { IconExclamation } from "@/components/icons";
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
  filename: {
    type: String,
    required: true,
  },
  // Live Photo 视频 URL
  videoUrl: {
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
  nativeLabel: computed(() => t("fileView.preview.image.browserNative")),
});

// Live Photo 检测
const isLivePhoto = computed(() => {
  return isLivePhotoImage(props.filename) && !!props.videoUrl;
});

const loading = ref(true);
const error = ref(false);
const showImage = ref(false);
const resolvedSrc = ref("");

const decodeAttempted = ref(false);
const decodedObjectUrl = ref("");
const decodeAbortController = ref(null);

const abortDecode = () => {
  if (decodeAbortController.value) {
    decodeAbortController.value.abort();
    decodeAbortController.value = null;
  }
};

const loadPreview = async () => {
  abortDecode();
  revokeObjectUrl(decodedObjectUrl.value);
  decodedObjectUrl.value = "";
  decodeAttempted.value = false;

  loading.value = true;
  error.value = false;
  showImage.value = false;

  const url = currentPreviewUrl.value || "";
  if (!url) {
    loading.value = false;
    error.value = true;
    emit("error");
    return;
  }

  if (shouldAttemptDecodeImagePreview({ filename: props.filename, mimetype: "" })) {
    decodeAttempted.value = true;
    const controller = new AbortController();
    decodeAbortController.value = controller;

    try {
      const decoded = await decodeImagePreviewUrlToPngObjectUrl({
        url,
        filename: props.filename,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      decodedObjectUrl.value = decoded.objectUrl;
      resolvedSrc.value = decoded.objectUrl;
      showImage.value = true;
      return;
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error("图片预览预解码失败:", err);
      loading.value = false;
      error.value = true;
      emit("error");
      return;
    } finally {
      if (decodeAbortController.value === controller) {
        decodeAbortController.value = null;
      }
    }
  }

  // 非 HEIC/HEIF/AVIF：直接交给浏览器渲染
  resolvedSrc.value = url;
  showImage.value = true;
};

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
  loadPreview();
});

watch(
  currentPreviewUrl,
  (nextUrl) => {
    if (!nextUrl) {
      loading.value = false;
      showImage.value = false;
      error.value = true;
      emit("error");
      return;
    }
    loadPreview();
  },
);

onBeforeUnmount(() => {
  abortDecode();
  revokeObjectUrl(decodedObjectUrl.value);
});
</script>

<style scoped>
/* 全屏时预览容器填满屏幕 */
.image-preview :deep(:fullscreen),
.image-preview :deep(:-webkit-full-screen),
.image-preview :deep(:-moz-full-screen) {
  width: 100vw !important;
  height: 100vh !important;
  background: inherit;
}
</style>
