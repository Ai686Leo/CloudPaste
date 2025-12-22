<template>
  <div
    v-if="visible"
    id="copyFormatMenu"
    class="vditor-hint vditor-panel--arrow absolute z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg"
    :style="{ top: `${position.y}px`, left: `${position.x}px`, display: 'block' }"
  >
    <div class="px-4 py-2 cursor-pointer flex items-center" @click="copyAsMarkdown">
      <IconDocumentText size="sm" class="mr-2" aria-hidden="true" />
      <span>{{ $t("markdown.copyAsMarkdown") }}</span>
    </div>
    <div class="px-4 py-2 cursor-pointer flex items-center" @click="copyAsHTML">
      <IconCode size="sm" class="mr-2" aria-hidden="true" />
      <span>{{ $t("markdown.copyAsHTML") }}</span>
    </div>
    <div class="px-4 py-2 cursor-pointer flex items-center" @click="copyAsPlainText">
      <IconDocumentText size="sm" class="mr-2" aria-hidden="true" />
      <span>{{ $t("markdown.copyAsPlainText") }}</span>
    </div>
    <div class="px-4 py-2 cursor-pointer flex items-center" @click="exportWordDocument">
      <IconDocumentText size="sm" class="mr-2" aria-hidden="true" />
      <span>{{ $t("markdown.exportAsWord") }}</span>
    </div>
    <div class="px-4 py-2 cursor-pointer flex items-center" @click="exportAsPng">
      <IconDownload size="sm" class="mr-2" aria-hidden="true" />
      <span>{{ $t("markdown.exportAsPng") }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { copyToClipboard as clipboardCopy } from "@/utils/clipboard";
import markdownToWord from "@/utils/markdownToWord";
import { formatNowForFilename } from "@/utils/timeUtils.js";
import { saveAs } from "file-saver";
import { editorContentToPng as snapdomEditorContentToPng } from "@/utils/snapdomCapture";
import { IconCode, IconDocumentText, IconDownload } from "@/components/icons";

const { t } = useI18n();

// Props
const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  position: {
    type: Object,
    default: () => ({ x: 0, y: 0 }),
  },
  editor: {
    type: Object,
    default: null,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

// Emits
const emit = defineEmits(["close", "status-message"]);

// 复制为Markdown格式
const copyAsMarkdown = () => {
  if (!props.editor || typeof props.editor.getValue !== "function") {
    emit("status-message", t("markdown.messages.editorNotReady"));
    return;
  }
  const mdContent = props.editor.getValue();
  copyToClipboard(mdContent, t("markdown.markdownCopied"));
  emit("close");
};

// 复制为HTML格式
const copyAsHTML = () => {
  if (!props.editor || typeof props.editor.getHTML !== "function") {
    emit("status-message", t("markdown.messages.editorNotReady"));
    return;
  }
  const htmlContent = props.editor.getHTML();
  copyToClipboard(htmlContent, t("markdown.htmlCopied"));
  emit("close");
};

// 复制为纯文本格式
const copyAsPlainText = () => {
  if (!props.editor || typeof props.editor.getHTML !== "function") {
    emit("status-message", t("markdown.messages.editorNotReady"));
    return;
  }
  const htmlContent = props.editor.getHTML();
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = htmlContent;
  const plainText = tempDiv.textContent || tempDiv.innerText || "";
  copyToClipboard(plainText, t("markdown.plainTextCopied"));
  emit("close");
};

// 导出为Word文档
const exportWordDocument = async () => {
  if (!props.editor || typeof props.editor.getValue !== "function") {
    emit("status-message", t("markdown.messages.editorNotReady"));
    return;
  }

  emit("status-message", t("markdown.messages.generatingWord"));

  try {
    const markdownContent = props.editor.getValue();

    if (!markdownContent) {
      emit("status-message", t("markdown.messages.contentEmpty"));
      return;
    }

    const blob = await markdownToWord(markdownContent, {
      title: t("markdown.exportDocumentTitle"),
    });

    const timestamp = formatNowForFilename();
    const fileName = `markdown-${timestamp}.docx`;

    saveAs(blob, fileName);
    emit("status-message", t("markdown.messages.wordExported"));
  } catch (error) {
    console.error("导出Word文档时出错:", error);
    emit("status-message", t("markdown.messages.wordExportFailed"));
  } finally {
    emit("close");
  }
};

// 导出为PNG图片
const exportAsPng = async () => {
  if (!props.editor || typeof props.editor.getValue !== "function") {
    console.error("导出PNG失败：编辑器实例不存在");
    emit("status-message", t("markdown.messages.editorNotReady"));
    return;
  }

  emit("status-message", t("markdown.messages.exportingPng"));

  try {
    const timestamp = formatNowForFilename();
    const fileName = `markdown-${timestamp}.png`;

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const result = await snapdomEditorContentToPng(props.editor, {
      filename: fileName,
      autoUseProxy: true,
      snapdomOptions: {
        backgroundColor: props.darkMode ? "#1e1e1e" : "#ffffff",
        cache: "auto",
        embedFonts: true,
        placeholders: true,
        outerTransforms: true,
      },
      onSuccess: (dataUrl, blob) => {
        emit("status-message", t("markdown.messages.pngExported"));
      },
      onError: (error) => {
        console.error("导出PNG图片时出错:", error);

        if (error instanceof Event && error.type === "error" && error.target instanceof HTMLImageElement) {
          emit("status-message", t("markdown.messages.corsImageError"));
        } else {
          emit("status-message", t("markdown.messages.pngExportFailed") + ": " + (error.message || t("markdown.messages.unknownError")));
        }
      },
    });

    if (!result || !result.success) {
      const errorMsg =
        result && result.error instanceof Event && result.error.type === "error" && result.error.target instanceof HTMLImageElement
          ? t("markdown.messages.corsImageError")
          : t("markdown.messages.pngExportFailed");

      throw result?.error || new Error(errorMsg);
    }

    if (Array.isArray(result.warnings) && result.warnings.length > 0) {
      const proxyWarn = result.warnings.find((w) => w && w.code === "proxy_unavailable");
      if (proxyWarn) {
        emit("status-message", proxyWarn.message);
      }
    }
  } catch (error) {
    console.error("导出PNG图片过程中发生错误:", error);

    if (error instanceof Event && error.type === "error") {
      emit("status-message", t("markdown.messages.corsImageError"));
    } else {
      emit("status-message", t("markdown.messages.pngExportFailed"));
    }
  } finally {
    emit("close");
  }
};

// 通用复制到剪贴板函数
const copyToClipboard = async (text, successMessage) => {
  if (!text) {
    emit("status-message", t("markdown.messages.contentEmpty"));
    return;
  }

  try {
    const success = await clipboardCopy(text);

    if (success) {
      emit("status-message", successMessage);
    } else {
      throw new Error(t("markdown.copyFailed"));
    }
  } catch (e) {
    console.error("复制失败:", e);
    emit("status-message", t("markdown.copyFailed"));
  }
};

// 全局点击事件处理
const handleGlobalClick = (event) => {
  const menu = document.getElementById("copyFormatMenu");
  if (menu && !menu.contains(event.target) && !event.target.closest('.vditor-toolbar button[data-type="copy-formats"]') && props.visible) {
    emit("close");
  }
};

// 组件挂载
onMounted(() => {
  document.addEventListener("click", handleGlobalClick);
});

// 组件卸载
onUnmounted(() => {
  document.removeEventListener("click", handleGlobalClick);
});
</script>

<style scoped>
#copyFormatMenu {
  min-width: 180px;
}
</style>
