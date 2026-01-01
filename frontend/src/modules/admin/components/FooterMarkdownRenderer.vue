<template>
  <div 
    ref="contentRef" 
    :class="['footer-markdown-content', darkMode ? 'footer-dark' : 'footer-light']"
  />
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { ensureMermaidPatchedForVditor, loadVditor, mightContainMermaid, VDITOR_ASSETS_BASE } from "@/utils/vditorLoader.js";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("FooterMarkdownRenderer");

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

// Refs
const contentRef = ref(null);

// 组件销毁状态
const isDestroyed = ref(false);
let renderTimer = null;
let renderVersion = 0;

const scheduleIdle = (fn) => {
  if (typeof window === "undefined") return;
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => fn(), { timeout: 1500 });
    return;
  }
  setTimeout(fn, 800);
};

/**
 * - 看起来不像 Markdown：直接按纯文本显示
 * - 看起来像 Markdown：再用 Vditor preview 渲染
 */
const looksLikeMarkdown = (text) => {
  if (!text || typeof text !== "string") return false;
  // 只要出现这些特征，就可能需要 Markdown 解析
  return /(?:```|~~~)|\[[^\]]+\]\([^)]+\)|(^|\n)\s{0,3}#{1,6}\s|\*\*|__|[*_-]{3,}/m.test(text);
};

// 使用 Vditor 渲染 Markdown 内容
const renderContent = async () => {
  const currentVersion = ++renderVersion;
  if (!contentRef.value || !props.content || isDestroyed.value) return;

  try {
    // 确保DOM更新后再渲染
    await nextTick();

    // 再次检查组件状态
    if (isDestroyed.value || !contentRef.value || currentVersion !== renderVersion) {
      return;
    }

    // 清空之前的内容
    contentRef.value.innerHTML = "";

    // 快路径：不像 Markdown 就直接显示文本，避免引入 Vditor/lute 等大脚本
    if (!looksLikeMarkdown(props.content)) {
      contentRef.value.textContent = props.content;
      return;
    }

    // 如果内容里包含 Mermaid，先做同样的补丁，避免 foreignObject 报错
    if (mightContainMermaid(props.content)) {
      try {
        await ensureMermaidPatchedForVditor();
      } catch (e) {
        log.warn("页脚 Mermaid 补丁加载失败（将继续正常渲染）:", e);
      }
    }

    // 通过统一 loader 获取 Vditor 构造函数
    // 性能优化：重的加载放到“浏览器空闲时”再做，避免阻塞首屏
    await new Promise((resolve) => scheduleIdle(resolve));
    if (isDestroyed.value || !contentRef.value || currentVersion !== renderVersion) return;

    const Vditor = await loadVditor();

    // 再次检查组件状态
    if (isDestroyed.value || !contentRef.value || currentVersion !== renderVersion) {
      return;
    }

    // 使用 Vditor 的预览功能渲染 Markdown
    Vditor.preview(contentRef.value, props.content, {
      cdn: VDITOR_ASSETS_BASE,
      theme: {
        current: props.darkMode ? "dark" : "light",
        path: `${VDITOR_ASSETS_BASE}/dist/css/content-theme`,
      },
      hljs: {
        lineNumber: false, // 页脚不需要行号
        style: props.darkMode ? "vs2015" : "github",
      },
      markdown: {
        toc: false, // 页脚不需要目录
        mark: true, // 支持标记
        footnotes: false, // 页脚不需要脚注
        autoSpace: true, // 自动空格
        listStyle: true, // 支持列表样式
        task: true, // 支持任务列表
        paragraphBeginningSpace: true,
        fixTermTypo: true,
        media: false, // 页脚不需要媒体支持
      },
      math: {
        engine: "KaTeX",
        inlineDigit: true,
      },
      after: () => {
        // 渲染完成后的回调
        if (isDestroyed.value || !contentRef.value) {
          return;
        }
        
        // 确保主题类正确应用
        if (props.darkMode) {
          contentRef.value.classList.add("vditor-reset--dark");
          contentRef.value.classList.remove("vditor-reset--light");
        } else {
          contentRef.value.classList.add("vditor-reset--light");
          contentRef.value.classList.remove("vditor-reset--dark");
        }
      },
    });
  } catch (error) {
    log.error("页脚Markdown渲染失败:", error);
    // 渲染失败时显示原始文本
    if (contentRef.value && !isDestroyed.value) {
      contentRef.value.textContent = props.content;
    }
  }
};

// 监听内容变化
watch(
  () => props.content,
  () => {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      renderContent();
    }, 120);
  }
);

// 监听暗色模式变化
watch(
  () => props.darkMode,
  () => {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      renderContent();
    }, 120);
  }
);

// 组件挂载时渲染
onMounted(() => {
  if (props.content) {
    renderContent();
  }
});

// 组件销毁时清理
onBeforeUnmount(() => {
  isDestroyed.value = true;
  renderVersion++;
  clearTimeout(renderTimer);
  renderTimer = null;
  
  // 清理 DOM
  if (contentRef.value) {
    contentRef.value.innerHTML = "";
  }
});
</script>

<style scoped>
.footer-markdown-content {
  /* 页脚特定的样式 */
  font-size: 0.875rem; /* text-sm */
  line-height: 1.25rem;
}

.footer-light {
  color: rgb(107 114 128); /* text-gray-500 */
}

.footer-dark {
  color: rgb(156 163 175); /* text-gray-400 */
}

/* 确保Vditor渲染的内容适配页脚样式 */
.footer-markdown-content :deep(.vditor-reset) {
  font-size: inherit;
  line-height: inherit;
  color: inherit;
}

/* 链接样式适配 */
.footer-markdown-content :deep(.vditor-reset a) {
  color: rgb(59 130 246); /* blue-500 */
  text-decoration: underline;
}

.footer-dark .footer-markdown-content :deep(.vditor-reset a) {
  color: rgb(96 165 250); /* blue-400 */
}

.footer-markdown-content :deep(.vditor-reset a:hover) {
  color: rgb(37 99 235); /* blue-600 */
}

.footer-dark .footer-markdown-content :deep(.vditor-reset a:hover) {
  color: rgb(147 197 253); /* blue-300 */
}

/* 移除不必要的边距 */
.footer-markdown-content :deep(.vditor-reset p) {
  margin: 0;
}

.footer-markdown-content :deep(.vditor-reset) {
  padding: 0;
  margin: 0;
}
</style>
