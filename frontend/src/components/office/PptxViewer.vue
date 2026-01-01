<template>
  <div class="office-native-viewer">
    <!-- 加载状态 -->
    <div v-if="loading" class="loading-overlay">
      <LoadingIndicator size="xl" icon-class="text-blue-500" />
    </div>

    <!-- 错误状态 -->
    <div v-else-if="errorMessage" class="loading-overlay">
      <div class="text-center p-4">
        <div class="text-sm text-red-600">{{ errorMessage }}</div>
      </div>
    </div>

    <!-- PPT 内容 -->
    <div v-else class="pptx-content">
      <component
        :is="OfficePptxComponent"
        v-if="showViewer && OfficePptxComponent"
        :src="objectUrl"
        class="h-full w-full"
        @rendered="handleRendered"
        @error="handleError"
      />

      <!-- 重挂载加载层 -->
      <div v-if="isRemounting" class="loading-overlay">
        <LoadingIndicator size="xl" icon-class="text-blue-500" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref, watch, nextTick, shallowRef } from "vue";
import { fetchFileBinaryWithAuth } from "@/api/services/fileDownloadService.js";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("PptxViewer");

const props = defineProps({
  contentUrl: { type: String, required: true },
  isFullscreen: { type: Boolean, default: false },
});

const emit = defineEmits(["load", "error"]);

const loading = ref(true);
const errorMessage = ref("");
const objectUrl = ref("");
const showViewer = ref(true);
const isRemounting = ref(false);

// 性能优化：@vue-office “用到才加载”
const OfficePptxComponent = shallowRef(null);
let officePptxLoadingPromise = null;
const ensureOfficePptxLoaded = async () => {
  if (OfficePptxComponent.value) return;
  if (officePptxLoadingPromise) return officePptxLoadingPromise;

  officePptxLoadingPromise = (async () => {
    const mod = await import("@vue-office/pptx/lib/v3/index.js");
    OfficePptxComponent.value = mod?.default || mod;
  })();

  try {
    await officePptxLoadingPromise;
  } finally {
    officePptxLoadingPromise = null;
  }
};

const revokeObjectUrl = () => {
  if (objectUrl.value) {
    URL.revokeObjectURL(objectUrl.value);
    objectUrl.value = "";
  }
};

const handleRendered = () => {
  isRemounting.value = false;
  emit("load");
};

const handleError = (err) => {
  log.error("PPTX 本地预览失败:", err);
  errorMessage.value = "PPTX 本地预览失败";
  isRemounting.value = false;
  emit("error", err);
};

watch(() => props.isFullscreen, async (isFullscreen, oldValue) => {
  if (isFullscreen !== oldValue && objectUrl.value) {
    isRemounting.value = true;
    showViewer.value = false;
    await nextTick();
    await new Promise(resolve => setTimeout(resolve, 300));
    showViewer.value = true;
  }
});

onMounted(async () => {
  try {
    loading.value = true;
    errorMessage.value = "";

    const [{ buffer }] = await Promise.all([
      fetchFileBinaryWithAuth(props.contentUrl),
      ensureOfficePptxLoaded(),
    ]);
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
    objectUrl.value = URL.createObjectURL(blob);

    loading.value = false;
  } catch (err) {
    log.error("PPTX 本地预览加载失败:", err);
    loading.value = false;
    errorMessage.value = err?.message || String(err);
    emit("error", err);
  }
});

onUnmounted(() => {
  revokeObjectUrl();
});
</script>

<style scoped>
.office-native-viewer {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  background: #ffffff;
}

.pptx-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

/* 加载/错误覆盖层 - 绝对定位居中 */
.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.7);
}
</style>
