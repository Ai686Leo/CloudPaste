<template>
  <div class="image-preview rounded-lg overflow-hidden mb-2 flex justify-center relative">
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
      class="max-w-full max-h-[calc(100vh-350px)]"
      @load="handleLoad"
      @error="handleError"
    />
    <!-- 普通图片预览 -->
    <img
      v-else-if="showImage"
      :src="resolvedSrc"
      :alt="filename"
      class="max-w-full max-h-[calc(100vh-350px)] h-auto object-contain"
      @load="handleLoad"
      @error="handleError"
    />
    <!-- 图片加载状态 -->
    <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-lg">
      <div class="text-center">
        <div class="animate-spin rounded-full h-10 w-10 border-b-2 mx-auto mb-2 border-primary-600 dark:border-primary-500"></div>
        <p class="text-primary-600 dark:text-primary-400">{{ t("fileView.preview.image.loading") }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useI18n } from "vue-i18n";
import { decodeImagePreviewUrlToPngObjectUrl, revokeObjectUrl, shouldAttemptDecodeImagePreview } from "@/utils/imageDecode";
import { LivePhotoViewer } from "@/components/common/LivePhoto";
import { isLivePhotoImage } from "@/utils/livePhotoUtils.js";

const { t } = useI18n();

const props = defineProps({
  previewUrl: {
    type: String,
    required: true,
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

// Live Photo 检测
const isLivePhoto = computed(() => {
  return isLivePhotoImage(props.filename) && !!props.videoUrl;
});

const emit = defineEmits(["load", "error"]);

const loading = ref(true);
const showImage = ref(false);
const resolvedSrc = ref(props.previewUrl);

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
  showImage.value = false;

  const url = props.previewUrl || "";
  if (!url) {
    loading.value = false;
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
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("图片预览预解码失败:", error);
      loading.value = false;
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
  emit("load");
};

const handleError = async () => {
  loading.value = false;
  emit("error");
};

onMounted(() => {
  loadPreview();
});

watch(
  () => props.previewUrl,
  (nextUrl) => {
    if (!nextUrl) {
      loading.value = false;
      showImage.value = false;
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
