<template>
  <div class="text-preview rounded-lg overflow-hidden mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex-grow flex flex-col w-full">
    <!-- 工具栏：响应式布局 -->
    <div class="flex flex-wrap items-center justify-between gap-2 p-2 bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
      <div class="flex items-center gap-2 min-w-0">
        <!-- 标题：移动端隐藏 -->
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300 truncate hidden sm:inline">{{ effectiveTitle }}</span>
        <!-- 移动端：下拉选择器 -->
        <select
          v-model="currentMode"
          class="sm:hidden text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
        >
          <option v-for="mode in previewModes" :key="mode.value" :value="mode.value">
            {{ mode.label }}
          </option>
        </select>
        <!-- 桌面端：按钮组 -->
        <div class="hidden sm:flex items-center gap-1">
          <button
            v-for="mode in previewModes"
            :key="mode.value"
            type="button"
            class="text-xs px-2 py-0.5 rounded border"
            :class="
              currentMode === mode.value
                ? 'bg-blue-600 text-white border-blue-600'
                : darkMode
                  ? 'bg-gray-800 text-gray-300 border-gray-600 hover:bg-gray-700'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-200'
            "
            @click="switchMode(mode.value)"
          >
            {{ mode.label }}
          </button>
        </div>
      </div>
      <div class="flex items-center gap-2 flex-shrink-0">
        <!-- 统计信息：移动端缩写 -->
        <div v-if="textContent" class="text-xs text-gray-500 dark:text-gray-400 flex gap-1 sm:gap-2">
          <span class="hidden sm:inline">{{ lineCount }} L</span>
          <span class="sm:hidden">{{ lineCount }}L</span>
          <span class="hidden sm:inline">{{ characterCount }} Chars</span>
          <span class="sm:hidden">{{ characterCount }}C</span>
        </div>
        <!-- 编码选择器 -->
        <div v-if="textContent" class="flex items-center gap-1">
          <span class="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline">Enc:</span>
          <select
            v-model="currentEncoding"
            @change="handleEncodingChange"
            class="text-xs px-1 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
          >
            <option v-for="encoding in availableEncodings" :key="encoding.value" :value="encoding.value">
              {{ encoding.label }}
            </option>
          </select>
        </div>
      </div>
    </div>
    <div class="p-4 overflow-auto flex-grow relative" style="max-height: calc(100vh - 350px); min-height: 200px">
      <!-- 使用统一的 TextRenderer 组件 -->
      <TextRenderer
        v-if="textContent"
        :content="textContent"
        :mode="currentMode"
        :language="currentMode === 'code' ? detectedLanguage : ''"
        :filename="adaptedFileData?.name || ''"
        :dark-mode="darkMode"
        :show-line-numbers="currentMode === 'code'"
        :read-only="true"
        :show-stats="false"
        :max-height="'100%'"
        @load="handleLoad"
        @error="handleError"
      />
      <!-- 缺少内容URL或加载失败 -->
      <div v-else-if="displayedError" class="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700">
        <p class="text-red-600 dark:text-red-400 text-sm">{{ displayedError }}</p>
      </div>
      <!-- 加载状态 -->
      <div v-else class="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700">
        <LoadingIndicator
          :text="loadingText || t('fileView.preview.text.loading')"
          :dark-mode="darkMode"
          size="xl"
          icon-class="text-blue-500"
          :text-class="darkMode ? 'text-blue-400' : 'text-blue-600'"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import TextRenderer from "@/components/common/text-preview/TextRenderer.vue";
import { useFetchText } from "@/composables/text-preview/useFetchText.js";
import { useTextPreview } from "@/composables/text-preview/useTextPreview.js";
import { getPreviewModeFromFilename } from "@/utils/textUtils.js";

const { t } = useI18n();

const props = defineProps({
  contentUrl: {
    type: String,
    required: true,
  },
  filename: {
    type: String,
    default: "",
  },
  title: {
    type: String,
    default: "",
  },
  language: {
    type: String,
    default: "",
  },
  loadingText: {
    type: String,
    default: "",
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["load", "error"]);

// 文本预览模式（文本/代码/Markdown/HTML）
const currentMode = ref("text");

// 预览模式选项（用于下拉选择器和按钮组）
const previewModes = computed(() => [
  { value: "text", label: t("fileView.preview.modes.text") },
  { value: "code", label: t("fileView.preview.modes.code") },
  { value: "markdown", label: t("fileView.preview.modes.markdown") },
  { value: "html", label: t("fileView.preview.modes.html") },
]);

const switchMode = (mode) => {
  currentMode.value = mode;
};

const effectiveTitle = computed(() => {
  if (props.title) return props.title;
  if (currentMode.value === "code") return t("fileView.preview.code.title");
  if (currentMode.value === "markdown") return t("fileView.preview.markdown.title");
  if (currentMode.value === "html") return t("fileView.preview.html.title");
  return t("fileView.preview.text.title");
});

// 使用统一的文本预览逻辑
const {
  textContent,
  detectedLanguage,
  currentEncoding,
  loading,
  error,
  loadTextContent: loadText,
  handleEncodingChange: changeEncoding,
} = useTextPreview({
  checkCancelled: false,
  emitEncodingChange: false,
});

const displayedError = computed(() => {
  if (!props.contentUrl) return "预览 URL 不可用";
  return error.value || "";
});

// 统计信息计算
const lineCount = computed(() => {
  if (!textContent.value) return 0;
  return textContent.value.split("\n").length;
});

const characterCount = computed(() => {
  if (!textContent.value) return 0;
  return textContent.value.length;
});

// 使用文本获取 Composable（用于获取可用编码）
const { availableEncodings } = useFetchText();

// 适配数据结构
const adaptedFileData = computed(() => {
  if (!props.contentUrl) return null;

  return {
    name: props.filename || "text-file",
    filename: props.filename || "text-file",
    // 文本内容统一通过 contentUrl 访问
    contentUrl: props.contentUrl,
    contentType: "text/plain",
  };
});

// 加载文本内容 - 使用统一逻辑
const loadTextContent = async () => {
  if (!adaptedFileData.value) {
    console.warn("没有可用的文件数据");
    return;
  }

  await loadText(adaptedFileData.value, emit);
};

// 处理编码切换 - 使用统一逻辑
const handleEncodingChange = async () => {
  if (!adaptedFileData.value) return;

  await changeEncoding(currentEncoding.value, emit);
};

// 事件处理
const handleLoad = () => {
  // TextRenderer 的 load 事件，这里不需要额外处理
};

const handleError = (error) => {
  emit("error", error);
};

// 监听预览URL变化
watch(
  () => props.contentUrl,
  (url) => {
    if (!url) {
      emit("error", "预览 URL 不可用");
      return;
    }
    loadTextContent();
  },
  { immediate: true }
);

// 文件名变化时，自动选择一个更合适的初始模式
watch(
  () => props.filename,
  (name) => {
    currentMode.value = getPreviewModeFromFilename(name || "");
  },
  { immediate: true }
);
</script>
