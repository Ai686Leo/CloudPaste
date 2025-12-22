<template>
  <div class="office-native-viewer">
    <div ref="containerRef" class="docx-container"></div>

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
  </div>
</template>

<script setup>
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import { fetchFileBinaryWithAuth } from "@/api/services/fileDownloadService.js";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";

const props = defineProps({
  contentUrl: { type: String, required: true },
  isFullscreen: { type: Boolean, default: false },
});

const emit = defineEmits(["load", "error"]);

const containerRef = ref(null);
const loading = ref(true);
const errorMessage = ref("");

const cleanupContainer = () => {
  if (containerRef.value) {
    containerRef.value.innerHTML = "";
  }
};

onMounted(async () => {
  try {
    loading.value = true;
    errorMessage.value = "";

    if (!props.contentUrl) {
      throw new Error("缺少 contentUrl");
    }

    const [{ buffer }, docxPreview] = await Promise.all([
      fetchFileBinaryWithAuth(props.contentUrl),
      import("docx-preview"),
    ]);

    await nextTick();
    if (!containerRef.value) {
      throw new Error("预览容器未就绪");
    }

    cleanupContainer();

    const renderAsync = docxPreview?.renderAsync;
    if (typeof renderAsync !== "function") {
      throw new Error("docx-preview renderAsync 不可用");
    }

    await renderAsync(buffer, containerRef.value, null, {
      className: "docx-preview",
      breakPages: true,
      ignoreLastRenderedPageBreak: false, // 编辑器插入的分页符
      experimental: true, // 启用实验性功能（tab stops 计算），提升排版准确性
      renderComments: true, // 渲染文档评论（协作批注）
      renderChanges: false, // 渲染修订记录（插入/删除标记）
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      useBase64URL: false, // 使用 URL.createObjectURL 以获得更好的性能
      trimXmlDeclaration: true, // 移除 XML 声明以避免解析问题
    });

    loading.value = false;
    emit("load");
  } catch (err) {
    console.error("DOCX 本地预览失败:", err);
    loading.value = false;
    errorMessage.value = err?.message || String(err);
    emit("error", err);
  }
});

onUnmounted(() => {
  cleanupContainer();
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

.docx-container {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: transparent;
  overscroll-behavior: contain;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.7);
}
</style>
