<template>
  <!-- 直接使用 TextRenderer，减少嵌套 -->
  <div class="text-preview-wrapper">
    <TextRenderer
      v-if="textContent"
      :content="textContent"
      :mode="currentMode"
      :language="detectedLanguage"
      :filename="fileData?.name || ''"
      :dark-mode="darkMode"
      :show-line-numbers="true"
      :read-only="currentMode !== 'edit'"
      :show-stats="true"
      :max-height="maxHeight"
      @content-change="handleContentChange"
      @save="handleSave"
    />
    <div v-else class="loading-indicator">
      <div class="loading-spinner" :class="darkMode ? 'border-primary-500' : 'border-primary-600'"></div>
      <p class="loading-text" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">{{ $t("mount.textPreview.loadingText") }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import TextRenderer from "@/components/common/text-preview/TextRenderer.vue";
import { useTextPreview } from "@/composables/text-preview/useTextPreview.js";
import { usePathPassword } from "@/composables/usePathPassword.js";

// Props 定义
const props = defineProps({
  // 文件信息
  file: {
    type: Object,
    required: true,
  },
  // 文本URL
  textUrl: {
    type: String,
    default: null,
  },
  // 是否为深色模式
  darkMode: {
    type: Boolean,
    default: false,
  },
  // 是否为管理员
  isAdmin: {
    type: Boolean,
    default: false,
  },
  // 当前目录路径
  currentPath: {
    type: String,
    default: "",
  },
  // 目录项目列表
  directoryItems: {
    type: Array,
    default: () => [],
  },
  // 初始预览模式
  initialMode: {
    type: String,
    default: "text",
  },
  // 初始编码
  initialEncoding: {
    type: String,
    default: "utf-8",
  },
  // 最大高度
  maxHeight: {
    type: [Number, String],
    default: 600,
  },
});

// Emits 定义
const emit = defineEmits(["load", "error", "encoding-change", "save"]);

// 响应式数据
const currentMode = ref(props.initialMode);
const currentEncoding = ref(props.initialEncoding);

// 当前文件数据（响应式）
const currentFileData = ref(null);

// 使用统一的文本预览逻辑
const {
  textContent,
  detectedLanguage,
  currentEncoding: previewEncoding,
  loading,
  error,
  loadTextContent: loadText,
  handleEncodingChange: changeEncoding,
} = useTextPreview({
  checkCancelled: true,
  emitEncodingChange: true,
});

// 路径密码管理，用于为受保护路径的内容请求附加 token
const pathPassword = usePathPassword();

// 为了兼容性，保留 fileData 计算属性
const fileData = computed(() => currentFileData.value);

const handleEncodingChange = async (newEncoding) => {
  currentEncoding.value = newEncoding;
  console.log("文本编码切换:", newEncoding);

  // 使用统一的编码切换逻辑
  await changeEncoding(newEncoding, emit);
};

const handleContentChange = (newContent) => {
  textContent.value = newContent;
};

const handleSave = (content) => {
  console.log("TextPreview 触发保存事件，交由父级组件处理实际保存逻辑");
  emit("save", {
    content,
    filename: currentFileData.value?.name,
    path: currentFileData.value?.path,
  });
};

// 加载文本内容 - 使用统一逻辑
const loadTextContent = async () => {
  if (!currentFileData.value) {
    console.warn("没有可用的文件数据");
    return;
  }

  // 同步编码状态
  const result = await loadText(currentFileData.value, emit);
  if (result.success) {
    currentEncoding.value = result.result.encoding || "utf-8";
  }
};

// 初始化当前文件数据
const initializeCurrentFile = async () => {
  if (!props.file) {
    console.log("❌ 无法初始化当前文件：文件信息为空");
    return;
  }

  console.log("📄 开始初始化当前文件:", props.file.name);

  const fsPath = props.file.path || props.currentPath || "/";

  // 为预览内容构造统一的同源内容 URL
  let baseContentUrl = `/api/fs/content?path=${encodeURIComponent(fsPath)}`;

  // 非管理员访问时，附加路径密码 token（如果存在）
  if (!props.isAdmin) {
    const token = pathPassword.getPathToken(fsPath);
    if (token) {
      baseContentUrl += `&path_token=${encodeURIComponent(token)}`;
    }
  }

  // 文本/Markdown/代码预览需要通过 fetch 拉取内容：
  // - 对同源或 proxy 链接可直接使用 textUrl
  // - 对跨域 direct 链接禁用外链 fetch，强制走同源 /api/fs/content
  const safeTextUrl = (() => {
    if (!props.textUrl) return null;
    try {
      const resolved = new URL(props.textUrl, window.location.href);
      if (resolved.origin === window.location.origin) {
        return props.textUrl;
      }
      const linkType = (props.file?.linkType || "").toLowerCase();
      if (linkType === "proxy") {
        return props.textUrl;
      }
      return null;
    } catch {
      return null;
    }
  })();

  const previewUrl = safeTextUrl || baseContentUrl;

  if (previewUrl) {
    console.log("📄 使用文本URL:", previewUrl);
    currentFileData.value = {
      name: props.file.name || "unknown",
      filename: props.file.name || "unknown",
      previewUrl: previewUrl,
      contentUrl: baseContentUrl,
      path: fsPath,
      contentType: props.file.contentType,
      size: props.file.size,
      modified: props.file.modified,
      originalFile: props.file,
    };

    // 加载文本内容
    await loadTextContent();
  } else {
    console.error("❌ 没有可用的文本内容 URL");
  }
};

// 监听文件变化
watch(
  () => props.file,
  () => {
    initializeCurrentFile();
  },
  { immediate: true }
);

// 监听URL变化
watch(
  () => props.textUrl,
  () => {
    initializeCurrentFile();
  }
);

// 监听模式变化
watch(
  () => props.initialMode,
  (newMode) => {
    currentMode.value = newMode;
  }
);

// 监听编码变化
watch(
  () => props.initialEncoding,
  (newEncoding) => {
    currentEncoding.value = newEncoding;
  }
);

// 暴露方法供父组件调用
defineExpose({
  // 切换预览模式
  switchMode: (mode) => {
    currentMode.value = mode;
  },
  // 切换编码
  switchEncoding: async (encoding) => {
    await handleEncodingChange(encoding);
  },
  // 获取当前状态
  getCurrentState: () => ({
    mode: currentMode.value,
    encoding: currentEncoding.value,
    file: currentFileData.value,
  }),
  // 获取编辑器内容
  getValue: () => {
    // 无论什么模式都返回当前文本内容
    return textContent.value;
  },
  // 设置编辑器内容
  setValue: (content) => {
    textContent.value = content;
  },
});
</script>

<style scoped>
.text-preview-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.loading-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 200px;
}

.loading-spinner {
  width: 2.5rem;
  height: 2.5rem;
  border: 2px solid transparent;
  border-top: 2px solid currentColor;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 0.5rem;
}

.loading-text {
  font-size: 0.875rem;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
