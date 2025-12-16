<template>
  <div
    v-if="visible"
    id="pasteCopyFormatMenu"
    class="vditor-hint vditor-panel--arrow absolute z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg"
    :style="{ top: `${position.y}px`, left: `${position.x}px`, display: 'block' }"
  >
    <div class="px-4 py-2 cursor-pointer flex items-center" @click="copyAsMarkdown">
      <svg class="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 3v4a1 1 0 0 0 1 1h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <path
          d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path d="M9 9h1v6h1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M15 15h-2v-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span>{{ $t("markdown.copyAsMarkdown") }}</span>
    </div>
    <div class="px-4 py-2 cursor-pointer flex items-center" @click="copyAsHTML">
      <svg class="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M9 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4l-4 4z"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path d="M8 9l3 3-3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M16 15l-3-3 3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span>{{ $t("markdown.copyAsHTML") }}</span>
    </div>
    <div class="px-4 py-2 cursor-pointer flex items-center" @click="copyAsPlainText">
      <svg class="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 3v4a1 1 0 0 0 1 1h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <path
          d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path d="M9 9h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M9 13h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M9 17h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span>{{ $t("markdown.copyAsPlainText") }}</span>
    </div>
    <div class="px-4 py-2 cursor-pointer flex items-center" @click="exportWordDocument">
      <svg class="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path d="M14 2v6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M16 13H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M16 17H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M10 9H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span>{{ $t("markdown.exportAsWord") }}</span>
    </div>
    <div class="px-4 py-2 cursor-pointer flex items-center" @click="exportAsPng">
      <svg class="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path d="M17 21v-8h-8v8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M7 3v5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span>{{ $t("markdown.exportAsPng") }}</span>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { copyToClipboard as clipboardCopy } from "@/utils/clipboard";
import markdownToWord from "@/utils/markdownToWord";
import { formatNowForFilename } from "@/utils/timeUtils.js";
import { saveAs } from "file-saver";
import { editorContentToPng as snapdomEditorContentToPng } from "@/utils/snapdomCapture";

const { t } = useI18n();

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
  isPlainTextMode: {
    type: Boolean,
    default: false,
  },
  plainTextContent: {
    type: String,
    default: "",
  },
  documentTitle: {
    type: String,
    default: "CloudPaste文档",
  },
});

const emit = defineEmits(["close", "status-message"]);

const getMarkdownContent = () => {
  if (props.isPlainTextMode) {
    return props.plainTextContent || "";
  }
  if (!props.editor || typeof props.editor.getValue !== "function") {
    return "";
  }
  return props.editor.getValue();
};

const getHtmlContent = () => {
  if (props.isPlainTextMode) {
    return (props.plainTextContent || "").replace(/\n/g, "<br>");
  }
  if (!props.editor || typeof props.editor.getHTML !== "function") {
    return "";
  }
  return props.editor.getHTML();
};

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

const copyAsMarkdown = () => {
  const mdContent = getMarkdownContent();
  if (!mdContent) {
    emit("status-message", t("markdown.messages.contentEmpty"));
    return;
  }
  copyToClipboard(mdContent, t("markdown.markdownCopied"));
  emit("close");
};

const copyAsHTML = () => {
  const htmlContent = getHtmlContent();
  if (!htmlContent) {
    emit("status-message", t("markdown.messages.contentEmpty"));
    return;
  }
  copyToClipboard(htmlContent, t("markdown.htmlCopied"));
  emit("close");
};

const copyAsPlainText = () => {
  if (props.isPlainTextMode) {
    copyToClipboard(props.plainTextContent, t("markdown.plainTextCopied"));
    emit("close");
    return;
  }

  const htmlContent = getHtmlContent();
  if (!htmlContent) {
    emit("status-message", t("markdown.messages.contentEmpty"));
    return;
  }

  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = htmlContent;
  const plainText = tempDiv.textContent || tempDiv.innerText || "";
  copyToClipboard(plainText, t("markdown.plainTextCopied"));
  emit("close");
};

const exportWordDocument = async () => {
  const markdownContent = getMarkdownContent();

  if (!markdownContent) {
    emit("status-message", t("markdown.messages.contentEmpty"));
    return;
  }

  emit("status-message", t("markdown.messages.generatingWord"));

  try {
    const blob = await markdownToWord(markdownContent, {
      title: props.documentTitle || t("markdown.exportDocumentTitle"),
    });

    const timestamp = formatNowForFilename();
    const baseName = props.documentTitle || "markdown";
    const fileName = `${baseName}-${timestamp}.docx`;

    saveAs(blob, fileName);
    emit("status-message", t("markdown.messages.wordExported"));
  } catch (error) {
    console.error("导出Word文档时出错:", error);
    emit("status-message", t("markdown.messages.wordExportFailed"));
  } finally {
    emit("close");
  }
};

const exportAsPng = async () => {
  if (props.isPlainTextMode) {
    emit("status-message", "纯文本模式下无法导出为PNG图片");
    emit("close");
    return;
  }

  if (!props.editor || typeof props.editor.getValue !== "function") {
    console.error("导出PNG失败：编辑器实例不存在");
    emit("status-message", t("markdown.messages.editorNotReady"));
    return;
  }

  emit("status-message", t("markdown.messages.exportingPng"));

  try {
    const timestamp = formatNowForFilename();
    const baseName = props.documentTitle || "markdown";
    const fileName = `${baseName}-${timestamp}.png`;

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
          emit(
            "status-message",
            t("markdown.messages.pngExportFailed") + ": " + (error.message || t("markdown.messages.unknownError")),
          );
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

const handleGlobalClick = (event) => {
  const menu = document.getElementById("pasteCopyFormatMenu");
  if (
    menu &&
    !menu.contains(event.target) &&
    !event.target.closest('.vditor-toolbar button[data-type="copy-formats"]') &&
    props.visible
  ) {
    emit("close");
  }
};

onMounted(() => {
  document.addEventListener("click", handleGlobalClick);
});

onUnmounted(() => {
  document.removeEventListener("click", handleGlobalClick);
});
</script>

<style scoped>
#pasteCopyFormatMenu {
  min-width: 180px;
}
</style>
