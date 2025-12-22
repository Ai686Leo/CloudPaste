import { FileType, getExtension, isArchiveFile } from "@/utils/fileTypes.js";

export const PREVIEW_KEYS = Object.freeze({
  IMAGE: "image",
  VIDEO: "video",
  AUDIO: "audio",
  PDF: "pdf",
  EPUB: "epub",
  OFFICE: "office",
  TEXT: "text",
  CODE: "code",
  MARKDOWN: "markdown",
  HTML: "html",
  ARCHIVE: "archive",
  IFRAME: "iframe",
  DOWNLOAD: "download",
});

export const PREVIEW_KINDS = Object.freeze({
  COMPONENT: "component",
  IFRAME: "iframe",
  DOWNLOAD: "download",
});

function normalizeTextKey(key) {
  // 文本类预览统一使用 text（具体“文本/代码/Markdown/HTML”的切换由预览组件自己完成）
  if ([PREVIEW_KEYS.TEXT, PREVIEW_KEYS.CODE, PREVIEW_KEYS.MARKDOWN, PREVIEW_KEYS.HTML].includes(key)) {
    return PREVIEW_KEYS.TEXT;
  }
  return key;
}

function normalizeSelection(selection, filename) {
  if (!selection || !selection.key) return null;
  const key = normalizeTextKey(selection.key);
  const providers = selection.providers || {};
  const kind =
    selection.kind ||
    (key === PREVIEW_KEYS.IFRAME ? PREVIEW_KINDS.IFRAME : key === PREVIEW_KEYS.DOWNLOAD ? PREVIEW_KINDS.DOWNLOAD : PREVIEW_KINDS.COMPONENT);

  if (key === PREVIEW_KEYS.IFRAME && !Object.keys(providers).length) {
    return null;
  }

  return {
    ...selection,
    key,
    kind,
  };
}

export function resolvePreviewSelection({ file }) {
  const filename = file?.name || file?.filename || "";
  const extension = getExtension(filename);
  const type = file?.type;

  const normalized = normalizeSelection(file?.previewSelection, filename);
  if (normalized) {
    return normalized;
  }

  if (type === FileType.IMAGE) return { key: PREVIEW_KEYS.IMAGE, kind: PREVIEW_KINDS.COMPONENT };
  if (type === FileType.VIDEO) return { key: PREVIEW_KEYS.VIDEO, kind: PREVIEW_KINDS.COMPONENT };
  if (type === FileType.AUDIO) return { key: PREVIEW_KEYS.AUDIO, kind: PREVIEW_KINDS.COMPONENT };
  if (type === FileType.DOCUMENT) return { key: PREVIEW_KEYS.PDF, kind: PREVIEW_KINDS.COMPONENT };
  if (type === FileType.OFFICE) return { key: PREVIEW_KEYS.OFFICE, kind: PREVIEW_KINDS.COMPONENT };
  if (type === FileType.TEXT) {
    return { key: PREVIEW_KEYS.TEXT, kind: PREVIEW_KINDS.COMPONENT };
  }
  if (isArchiveFile(filename)) {
    return { key: PREVIEW_KEYS.ARCHIVE, kind: PREVIEW_KINDS.COMPONENT };
  }

  if (extension) {
    return { key: PREVIEW_KEYS.DOWNLOAD, kind: PREVIEW_KINDS.DOWNLOAD };
  }

  return { key: PREVIEW_KEYS.DOWNLOAD, kind: PREVIEW_KINDS.DOWNLOAD };
}
