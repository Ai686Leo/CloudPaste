<template>
  <div class="office-preview-container" :style="containerStyle">
    <!-- Header: Provider 选择器（可通过 slot 自定义） -->
    <slot name="header" :providers="normalizedProviders" :selected-provider="selectedProvider" :on-select="handleProviderSelect">
      <div v-if="showProviderSelector && normalizedProviders.length > 1" class="office-header">
        <span class="office-type-label">{{ officeTypeDisplayName }}</span>
        <select v-model="selectedProvider" class="office-provider-select" @change="handleProviderChange">
          <option v-for="opt in normalizedProviders" :key="opt.key" :value="opt.key">
            {{ opt.label }}
          </option>
        </select>
      </div>
    </slot>

    <!-- Content: Native / iframe 预览区 -->
    <div class="office-content bg-white">
      <!-- Native 预览 -->
      <div v-if="isNativeProvider" class="office-native-wrapper">
        <!-- 内联 Native Viewer 逻辑 -->
        <template v-if="contentUrl && filename">
          <DocxViewer
            v-if="nativeViewerType === 'docx'"
            :content-url="contentUrl"
            :filename="filename"
            :is-fullscreen="isFullscreen"
            @load="handleLoad"
            @error="handleError"
          />
          <XlsxViewer
            v-else-if="nativeViewerType === 'xlsx'"
            :content-url="contentUrl"
            :filename="filename"
            :is-fullscreen="isFullscreen"
            @load="handleLoad"
            @error="handleError"
          />
          <PptxViewer
            v-else-if="nativeViewerType === 'pptx'"
            :content-url="contentUrl"
            :filename="filename"
            :is-fullscreen="isFullscreen"
            @load="handleLoad"
            @error="handleError"
          />
          <!-- 不支持的格式 -->
          <div v-else class="office-placeholder">
            <div class="placeholder-content">
              <p class="text-gray-600 mb-2">该文件格式不支持本地预览</p>
              <p class="text-sm text-gray-500">请尝试切换到其他预览渠道</p>
            </div>
          </div>
        </template>

        <!-- 缺少必要参数 -->
        <div v-else class="office-placeholder">
          <slot name="error" :error="nativeErrorMessage" :retry="() => {}">
            <div class="placeholder-content">
              <p class="text-gray-600 mb-2">
                {{ nativeErrorMessage || "本地预览失败" }}
              </p>
              <p class="text-sm text-gray-500">
                请尝试切换到其他预览渠道
              </p>
            </div>
          </slot>
        </div>
      </div>

      <!-- iframe 预览 -->
      <div v-else-if="currentPreviewUrl && currentPreviewUrl !== 'native'" class="office-iframe-wrapper">
        <iframe
          :src="currentPreviewUrl"
          frameborder="0"
          class="office-iframe"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation"
          @load="handleIframeLoad"
          @error="handleIframeError"
        ></iframe>

        <!-- iframe 加载中遮罩 -->
        <div v-if="iframeLoading" class="loading-overlay">
          <LoadingIndicator size="xl" icon-class="text-blue-500" />
        </div>
      </div>

      <!-- 无预览 URL 占位 -->
      <div v-else class="office-placeholder">
        <slot name="error" :error="errorMessage" :retry="() => {}">
          <div class="placeholder-content">
            <IconDocumentText class="placeholder-icon" />
            <p class="text-gray-600 mb-2">无法加载 Office 预览</p>
            <p class="text-sm text-gray-500">{{ errorMessage || "请下载文件后在本地查看" }}</p>
          </div>
        </slot>
      </div>
    </div>

    <!-- Footer: 底部提示（可通过 slot 自定义） -->
    <slot name="footer" :download-url="downloadUrl">
      <div v-if="showFooter" class="office-footer">
        <p v-if="errorMessage" class="text-red-500 mb-1">{{ errorMessage }}</p>
        <p v-if="downloadUrl">
          预览有问题？请尝试切换预览渠道，或
          <a :href="downloadUrl" class="text-blue-500 hover:underline" target="_blank">下载文件</a>
          后在本地查看
        </p>
      </div>
    </slot>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import DocxViewer from "./DocxViewer.vue";
import XlsxViewer from "./XlsxViewer.vue";
import PptxViewer from "./PptxViewer.vue";
import { IconDocumentText } from "@/components/icons";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";

const { t } = useI18n();

const props = defineProps({
  // Native 渲染内容 URL（同源）
  contentUrl: {
    type: String,
    default: "",
  },
  // 文件名（用于判断文件类型）
  filename: {
    type: String,
    required: true,
  },
  // 全屏模式
  isFullscreen: {
    type: Boolean,
    default: false,
  },
  // 预览渠道映射：{ native: 'native', microsoft: 'url', google: 'url' }
  providers: {
    type: Object,
    default: () => ({}),
  },
  // 默认选中的渠道 key
  defaultProvider: {
    type: String,
    default: "",
  },
  // 高度模式: 'fixed' (65vh) / 'flex' (flex: 1) / 'auto' (内容决定)
  heightMode: {
    type: String,
    default: "fixed",
    validator: (v) => ["fixed", "flex", "auto"].includes(v),
  },
  // 是否显示渠道选择器
  showProviderSelector: {
    type: Boolean,
    default: true,
  },
  // 是否显示底部提示
  showFooter: {
    type: Boolean,
    default: true,
  },
  // 下载链接（用于底部提示）
  downloadUrl: {
    type: String,
    default: "",
  },
  // 错误消息
  errorMessage: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["load", "error", "provider-change"]);

// 内部状态
const selectedProvider = ref("");
const iframeLoading = ref(true);
const nativeErrorMessage = ref("");

// 标准化 providers 为数组格式
const normalizedProviders = computed(() => {
  const options = [];
  const providers = props.providers || {};

  for (const [key, url] of Object.entries(providers)) {
    const labelKey = `mount.filePreview.officeProvider.${key}`;
    const translated = t(labelKey);
    options.push({
      key,
      label: translated === labelKey ? key : translated,
      url,
    });
  }

  return options;
});

// 当前选中的预览 URL
const currentPreviewUrl = computed(() => {
  const options = normalizedProviders.value;
  if (!options.length) return "";
  const current = options.find((opt) => opt.key === selectedProvider.value) || options[0];
  return current?.url || "";
});

// 是否为 Native 渠道
const isNativeProvider = computed(() => {
  return selectedProvider.value === "native" || currentPreviewUrl.value === "native";
});

// Native Viewer 类型（根据文件扩展名判断）
const nativeViewerType = computed(() => {
  const parts = (props.filename || "").split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
  if (ext === "docx") return "docx";
  if (ext === "xlsx") return "xlsx";
  if (ext === "pptx") return "pptx";
  return "";
});

// Office 类型显示名称
const officeTypeDisplayName = computed(() => {
  const filename = props.filename || "";
  const ext = filename.split(".").pop()?.toLowerCase() || "";

  // Word 文档
  if (["doc", "docx", "odt", "rtf"].includes(ext)) {
    return t("mount.filePreview.wordPreview") || "Word 文档";
  }
  // Excel 表格
  if (["xls", "xlsx", "ods", "csv"].includes(ext)) {
    return t("mount.filePreview.excelPreview") || "Excel 表格";
  }
  // PowerPoint 演示文稿
  if (["ppt", "pptx", "odp"].includes(ext)) {
    return t("mount.filePreview.powerpointPreview") || "PowerPoint";
  }

  return t("mount.filePreview.officePreview") || "Office 文档";
});

// 容器样式（根据 heightMode 和 isFullscreen 计算）
const containerStyle = computed(() => {
  if (props.isFullscreen) {
    return { height: "100%" };
  }

  switch (props.heightMode) {
    case "flex":
      return { flex: "1", minHeight: "0" };
    case "auto":
      return { minHeight: "400px" };
    case "fixed":
    default:
      return {
        height: "65vh",
        minHeight: "400px",
        maxHeight: "800px",
      };
  }
});

// Provider 选择处理
const handleProviderSelect = (key) => {
  selectedProvider.value = key;
  emit("provider-change", key);
};

const handleProviderChange = () => {
  // 切换渠道时重置加载状态
  if (!isNativeProvider.value) {
    iframeLoading.value = true;
  }
  emit("provider-change", selectedProvider.value);
};

// 加载/错误事件处理
const handleLoad = () => {
  nativeErrorMessage.value = "";
  emit("load");
};

const handleError = (err) => {
  console.error("Office 预览错误:", err);
  nativeErrorMessage.value = err?.message || String(err);
  emit("error", err);
};

const handleIframeLoad = () => {
  iframeLoading.value = false;
  emit("load");
};

const handleIframeError = (event) => {
  iframeLoading.value = false;
  emit("error", event);
};

// 初始化选中的 Provider
watch(
  normalizedProviders,
  (options) => {
    if (!options.length) {
      selectedProvider.value = "";
      return;
    }

    // 优先使用 defaultProvider，否则选第一个
    if (props.defaultProvider && options.some((opt) => opt.key === props.defaultProvider)) {
      selectedProvider.value = props.defaultProvider;
    } else if (!options.some((opt) => opt.key === selectedProvider.value)) {
      selectedProvider.value = options[0].key;
    }
  },
  { immediate: true }
);

// 监听 previewUrl 变化重置 iframe 加载状态
watch(
  currentPreviewUrl,
  () => {
    if (!isNativeProvider.value) {
      iframeLoading.value = true;
    }
  }
);

onMounted(() => {
  // 初始化时如果有 iframe 预览则开始加载
  if (currentPreviewUrl.value && !isNativeProvider.value) {
    iframeLoading.value = true;
  }
});
</script>

<style scoped>
/* 容器基础样式 */
.office-preview-container {
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-radius: 0.5rem;
  overflow: hidden;
}

/* Header 样式 */
.office-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  background-color: #f3f4f6;
  border-bottom: 1px solid #e5e7eb;
}

.office-type-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #374151;
}

.office-provider-select {
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  border: 1px solid #d1d5db;
  background-color: #ffffff;
  color: #374151;
}

/* Content 区域样式 */
.office-content {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}

/* Native 预览包装器 */
.office-native-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* iframe 预览包装器 */
.office-iframe-wrapper {
  flex: 1;
  min-height: 0;
  position: relative;
}

.office-iframe {
  width: 100%;
  height: 100%;
  border: none;
}

/* 占位符样式 */
.office-placeholder {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.placeholder-content {
  text-align: center;
  padding: 1rem;
}

.placeholder-icon {
  width: 4rem;
  height: 4rem;
  margin: 0 auto 1rem;
  color: #9ca3af;
}

/* 加载遮罩 */
.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.7);
}

/* Footer 样式 */
.office-footer {
  padding: 0.5rem;
  background-color: #f9fafb;
  font-size: 0.75rem;
  color: #6b7280;
  text-align: center;
}
</style>

<!-- Dark Mode 适配 - 非 scoped 样式以正确匹配 html.dark -->
<style>
.dark .office-preview-container {
  background: #1f2937;
}

.dark .office-header {
  background-color: #374151;
  border-bottom-color: #4b5563;
}

.dark .office-type-label {
  color: #e5e7eb;
}

.dark .office-provider-select {
  background-color: #1f2937;
  border-color: #4b5563;
  color: #e5e7eb;
}

.dark .office-footer {
  background-color: #374151;
  color: #9ca3af;
}

.dark .office-placeholder .placeholder-content p {
  color: #9ca3af;
}

.dark .loading-overlay {
  background: rgba(31, 41, 55, 0.7);
}
</style>
