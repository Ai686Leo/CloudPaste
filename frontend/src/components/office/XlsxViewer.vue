<template>
  <div class="office-native-viewer">
    <!-- 加载状态 -->
    <div v-if="loading" class="loading-overlay">
      <svg class="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="errorMessage" class="loading-overlay">
      <div class="text-center p-4">
        <div class="text-sm text-red-600">{{ errorMessage }}</div>
      </div>
    </div>

    <!-- Excel 内容 -->
    <div v-else class="xlsx-content">
      <VueOfficeExcel v-if="showViewer" :src="objectUrl" class="h-full w-full" @rendered="handleRendered" @error="handleError" />

      <!-- 重挂载加载层 -->
      <div v-if="isRemounting" class="loading-overlay">
        <svg class="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref, watch, nextTick } from "vue";
import { fetchFileBinaryWithAuth } from "@/api/services/fileDownloadService.js";
import VueOfficeExcel from "@vue-office/excel";
import "@vue-office/excel/lib/index.css";

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
  console.error("XLSX 本地预览失败:", err);
  errorMessage.value = "XLSX 本地预览失败";
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

    const { buffer } = await fetchFileBinaryWithAuth(props.contentUrl);
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    objectUrl.value = URL.createObjectURL(blob);

    loading.value = false;
  } catch (err) {
    console.error("XLSX 本地预览加载失败:", err);
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

.xlsx-content {
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

