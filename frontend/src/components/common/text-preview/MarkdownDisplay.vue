<template>
  <div class="markdown-display" :class="{ 'markdown-display-dark': darkMode }">
    <!-- Markdown容器始终存在 -->
    <div ref="markdownContainer" class="vditor-reset markdown-body" :class="{ 'opacity-0': !rendered }"></div>

    <!-- 加载状态覆盖层 -->
    <div v-if="loading" class="loading-overlay">
      <LoadingIndicator
        :text="$t('textPreview.loadingMarkdown')"
        :dark-mode="darkMode"
        size="xl"
        :icon-class="darkMode ? 'text-primary-500' : 'text-primary-600'"
      />
    </div>

    <!-- 错误状态覆盖层 -->
    <div v-if="error" class="error-overlay">
      <p class="error-text">{{ error }}</p>
      <pre class="fallback-content">{{ content }}</pre>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, onActivated, onDeactivated, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { loadVditor, VDITOR_ASSETS_BASE } from "@/utils/vditorLoader.js";

const { t } = useI18n();

// Props
const props = defineProps({
  content: {
    type: String,
    required: true,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

// Emits
const emit = defineEmits(["load", "error"]);

// 响应式状态
const loading = ref(false);
const error = ref(null);
const rendered = ref(false);
const markdownContainer = ref(null);
const isDestroyed = ref(false);
const isActive = ref(true);
let renderVersion = 0;
let renderTimer = null;

/**
 * 检查组件是否应该继续执行异步操作
 * @param {number} version - 发起操作时的版本号
 * @returns {boolean} - 是否应该继续
 */
const shouldContinue = (version) => {
  return !isDestroyed.value && isActive.value && version === renderVersion;
};

/**
 * 渲染Markdown内容
 */
const renderMarkdown = async () => {
  // 递增版本号，使之前的异步操作失效
  const currentVersion = ++renderVersion;

  if (!props.content || !shouldContinue(currentVersion)) return;

  try {
    loading.value = true;
    error.value = null;
    rendered.value = false;

    // 确保DOM更新后再初始化Vditor
    await nextTick();

    // 更严格的组件状态检查（包含版本检查）
    if (!shouldContinue(currentVersion) || !markdownContainer.value) {
      console.warn("MarkdownDisplay组件已销毁/隐藏或DOM不存在，跳过渲染");
      return;
    }

    // 清空之前的内容
    markdownContainer.value.innerHTML = "";
    markdownContainer.value.classList.remove("vditor-reset--dark", "vditor-reset--light");

    // 加载和验证
    let VditorConstructor;
    try {
      VditorConstructor = await loadVditor();
    } catch (loadError) {
      console.error("Vditor 加载失败:", loadError);
      throw new Error(`Vditor 加载失败: ${loadError.message}`);
    }

    // 再次检查组件状态（包含版本检查）
    if (!shouldContinue(currentVersion) || !markdownContainer.value) {
      console.warn("MarkdownDisplay组件已销毁/隐藏，取消Vditor渲染");
      return;
    }

    // 检查 Vditor 是否有效
    if (!VditorConstructor || typeof VditorConstructor.preview !== "function") {
      throw new Error("Vditor.preview 方法不可用");
    }

    try {
      // 使用 Vditor 的预览 API 渲染内容
      VditorConstructor.preview(markdownContainer.value, props.content, {
        mode: "dark-light", // 支持明暗主题
        theme: {
          current: props.darkMode ? "dark" : "light", // 根据darkMode设置主题
          path: `${VDITOR_ASSETS_BASE}/dist/css/content-theme`,
        },
        cdn: VDITOR_ASSETS_BASE,
        hljs: {
          lineNumber: true, // 代码块显示行号
          style: props.darkMode ? "vs2015" : "github", // 代码高亮样式
        },
        markdown: {
          toc: true, // 启用目录
          mark: true, // 启用标记
          footnotes: true, // 启用脚注
          autoSpace: true, // 自动空格
          media: true, // 启用媒体链接解析
          listStyle: true, // 启用列表样式支持
          task: true, // 启用任务列表
          mermaid: {
            theme: "default",
            useMaxWidth: false,
          },
          flowchart: {
            theme: "default",
          },
        },
        math: {
          engine: "KaTeX",
          inlineDigit: true,
        },
        after: () => {
          // 检查组件是否已被销毁/隐藏，或者是否是过期的渲染操作
          if (!shouldContinue(currentVersion) || !markdownContainer.value) {
            console.warn("MarkdownDisplay组件已销毁/隐藏或渲染已过期，跳过after回调");
            return;
          }

          // 渲染完成后的回调
          console.log("Markdown 内容渲染完成");

          // 强制添加对应主题的类
          if (props.darkMode) {
            markdownContainer.value.classList.add("vditor-reset--dark");
            markdownContainer.value.classList.remove("vditor-reset--light");
          } else {
            markdownContainer.value.classList.add("vditor-reset--light");
            markdownContainer.value.classList.remove("vditor-reset--dark");
          }

          // 设置渲染完成状态
          rendered.value = true;
          loading.value = false;
          emit("load");
        },
      });
    } catch (previewError) {
      console.error("Vditor.preview 调用失败:", previewError);
      throw new Error(`Markdown 渲染失败: ${previewError.message}`);
    }

    console.log("Markdown 预览渲染成功");
  } catch (err) {
    console.error("Markdown 预览渲染失败:", err);
    error.value = err.message || t("textPreview.markdownRenderFailed");
    loading.value = false;
    rendered.value = false;
    emit("error", err);
  }
};

/**
 * 延迟渲染（防抖）
 */
const scheduleRenderMarkdown = () => {
  // 递增版本号，让已经排队/执行中的任务失效
  renderVersion++;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    renderTimer = null;
    renderMarkdown();
  }, 80);
};

// 监听内容变化
watch(() => props.content, scheduleRenderMarkdown);

// 监听暗色模式变化，重新渲染
watch(() => props.darkMode, scheduleRenderMarkdown);

// 组件挂载时渲染
onMounted(() => {
  if (props.content) {
    scheduleRenderMarkdown();
  }
});

// KeepAlive 激活时（如果父组件使用 KeepAlive）
onActivated(() => {
  isActive.value = true;
  if (props.content && !rendered.value) {
    scheduleRenderMarkdown();
  }
});

// KeepAlive 停用时
onDeactivated(() => {
  isActive.value = false;
  renderVersion++;
});

// 组件销毁时清理
onBeforeUnmount(() => {
  isDestroyed.value = true;
  isActive.value = false;
  // 递增版本号，取消正在进行的渲染操作
  renderVersion++;
  clearTimeout(renderTimer);
  renderTimer = null;

  // 清理 DOM
  if (markdownContainer.value) {
    markdownContainer.value.innerHTML = "";
  }
  console.log("MarkdownDisplay组件销毁");
});

defineExpose({
  // 暂停渲染
  pause: () => {
    isActive.value = false;
    renderVersion++;
  },
  // 恢复渲染
  resume: () => {
    isActive.value = true;
    if (props.content && !rendered.value) {
      renderMarkdown();
    }
  },
});
</script>

<style scoped>
.markdown-display {
  width: 100%;
  flex: 1;
  overflow: auto;
  position: relative;
}

.markdown-display-dark {
  background-color: #1f2937;
}

/* 加载状态覆盖层 */
.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background-color: rgba(255, 255, 255, 0.95);
  z-index: 10;
}

.loading-text {
  color: #6b7280;
  font-size: 0.875rem;
}

.markdown-display-dark .loading-overlay {
  background-color: rgba(31, 41, 55, 0.95);
}

.markdown-display-dark .loading-text {
  color: #9ca3af;
}

/* 错误状态覆盖层 */
.error-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background-color: rgba(255, 255, 255, 0.95);
  z-index: 10;
}

.error-text {
  color: #ef4444;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.fallback-content {
  white-space: pre-wrap;
  word-wrap: break-word;
  color: #374151;
  background-color: #f9fafb;
  padding: 1rem;
  border-radius: 0.375rem;
  border: 1px solid #e5e7eb;
  text-align: left;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.875rem;
  line-height: 1.5;
}

.markdown-display-dark .error-overlay {
  background-color: rgba(31, 41, 55, 0.95);
}

.markdown-display-dark .fallback-content {
  color: #d4d4d4;
  background-color: #1f2937;
  border-color: #4b5563;
}

/* VditorJS相关样式 */
:deep(.vditor-reset) {
  font-size: 1rem !important;
  line-height: 1.7 !important;
  padding: 0.5rem 1rem !important;
  transition: all 0.3s ease;
  color: v-bind('props.darkMode ? "#d4d4d4" : "#374151"') !important;
  background-color: transparent !important;
}

/* 确保代码块样式正确 */
:deep(.vditor-reset pre) {
  background-color: v-bind('props.darkMode ? "#1f2937" : "#f8f9fa"') !important;
  border: 1px solid v-bind('props.darkMode ? "#374151" : "#e9ecef"');
  border-radius: 0.375rem;
}

:deep(.vditor-reset code) {
  background-color: v-bind('props.darkMode ? "#374151" : "#f1f5f9"') !important;
  color: v-bind('props.darkMode ? "#e2e8f0" : "#1e293b"') !important;
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
  font-size: 0.875em;
}

/* 表格样式 */
:deep(.vditor-reset table) {
  border-color: v-bind('props.darkMode ? "#374151" : "#e5e7eb"') !important;
}

:deep(.vditor-reset th),
:deep(.vditor-reset td) {
  border-color: v-bind('props.darkMode ? "#374151" : "#e5e7eb"') !important;
}

/* 引用块样式 */
:deep(.vditor-reset blockquote) {
  border-left-color: v-bind('props.darkMode ? "#6b7280" : "#d1d5db"') !important;
  background-color: v-bind('props.darkMode ? "#1f2937" : "#f9fafb"') !important;
}

/* 链接样式 */
:deep(.vditor-reset a) {
  color: v-bind('props.darkMode ? "#60a5fa" : "#3b82f6"') !important;
}

:deep(.vditor-reset a:hover) {
  color: v-bind('props.darkMode ? "#93c5fd" : "#1d4ed8"') !important;
}
</style>
