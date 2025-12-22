<template>
  <div class="markdown-preview rounded-lg overflow-hidden mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex-grow flex flex-col w-full">
    <div class="flex items-center justify-between p-2 bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
      <span class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ t("fileView.preview.markdown.title") }}</span>
      <div class="flex items-center gap-3">
        <!-- 统计信息 -->
        <div v-if="textContent" class="text-xs text-gray-500 dark:text-gray-400 flex gap-2">
          <span>{{ lineCount }} L</span>
          <span>{{ characterCount }} Chars</span>
        </div>
        <!-- 编码选择器 -->
        <div v-if="textContent" class="flex items-center gap-1">
          <span class="text-xs text-gray-500 dark:text-gray-400">Enc:</span>
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
      <!-- 使用统一的 TextRenderer 组件，设置为 markdown 模式 -->
      <TextRenderer
        v-if="textContent"
        :content="textContent"
        :mode="'markdown'"
        :language="'markdown'"
        :filename="adaptedFileData?.name || ''"
        :dark-mode="darkMode"
        :show-line-numbers="false"
        :read-only="true"
        :show-stats="false"
        :max-height="'100%'"
        @load="handleLoad"
        @error="handleError"
      />
      <!-- 缺少内容URL或加载失败 -->
      <div v-else-if="urlError" class="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700">
        <p class="text-red-600 dark:text-red-400 text-sm">{{ urlError }}</p>
      </div>
      <!-- Markdown加载状态 -->
      <div v-else class="absolute inset-0 flex items-center justify-center">
        <LoadingIndicator
          :text="t('fileView.preview.markdown.loading')"
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

const { t } = useI18n();

const props = defineProps({
  contentUrl: {
    type: String,
    required: true,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["load", "error"]);

// 响应式数据
const textContent = ref("");
const currentEncoding = ref("utf-8");
const urlError = ref("");

// 统计信息计算
const lineCount = computed(() => {
  if (!textContent.value) return 0;
  return textContent.value.split("\n").length;
});

const characterCount = computed(() => {
  if (!textContent.value) return 0;
  return textContent.value.length;
});

// 使用文本获取 Composable
const { fetchText, reDecodeWithEncoding, availableEncodings } = useFetchText();

// 适配数据结构
const adaptedFileData = computed(() => {
  if (!props.contentUrl) return null;

  return {
    name: "markdown-file.md",
    filename: "markdown-file.md",
    // Markdown 内容统一通过 contentUrl 访问
    contentUrl: props.contentUrl,
    contentType: "text/markdown",
  };
});

// 加载文本内容
const loadTextContent = async () => {
  if (!adaptedFileData.value) {
    console.warn("没有可用的文件数据");
    return;
  }

  try {
    const effectiveUrl = adaptedFileData.value.contentUrl;
    if (!effectiveUrl) {
      console.warn("缺少可用的 Markdown 内容 URL");
      return;
    }

    const result = await fetchText(effectiveUrl, adaptedFileData.value);

    if (result.success) {
      textContent.value = result.text;
      currentEncoding.value = result.encoding || "utf-8";
      urlError.value = "";

      console.log("Markdown加载成功:", {
        encoding: result.encoding,
        textLength: result.text.length,
      });

      emit("load", result);
    } else {
      urlError.value = result.error || "预览 URL 不可用";
      emit("error", result.error);
    }
  } catch (err) {
    console.error("加载Markdown内容失败:", err);
    urlError.value = err.message || "预览 URL 不可用";
    emit("error", err.message);
  }
};

// 处理编码切换
const handleEncodingChange = async () => {
  if (!adaptedFileData.value) return;

  try {
    const result = await reDecodeWithEncoding(currentEncoding.value);

    if (result.success) {
      textContent.value = result.text;

      console.log("编码切换成功:", {
        encoding: currentEncoding.value,
        textLength: result.text.length,
      });
    } else {
      console.error("编码切换失败:", result.error);
    }
  } catch (err) {
    console.error("编码切换失败:", err);
  }
};

// 事件处理
const handleLoad = () => {
  // TextRenderer 的 load 事件，这里不需要额外处理
};

const handleError = (error) => {
  emit("error", error);
};

// 监听内容URL变化
watch(
  () => props.contentUrl,
  (url) => {
    if (!url) {
      urlError.value = "预览 URL 不可用";
      emit("error", urlError.value);
      return;
    }
    urlError.value = "";
    loadTextContent();
  },
  { immediate: true }
);
</script>
