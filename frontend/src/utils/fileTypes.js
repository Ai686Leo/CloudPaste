/**
 * 文件类型处理
 *
 */
import { getPreviewModeFromFilename, PREVIEW_MODES } from "./textUtils.js";
import mimeDb from "mime-db";

/**
 * 前端兼容的MIME类型查找函数
 * 基于mime-db数据库，优先返回更合适的MIME类型
 * @param {string} filename - 文件名
 * @returns {string|false} MIME类型或false
 */
export function lookupMimeType(filename) {
  if (!filename) return false;

  const ext = getExtension(filename);
  if (!ext) return false;

  // 收集所有匹配的MIME类型
  const matchingMimeTypes = [];
  for (const [mimeType, data] of Object.entries(mimeDb)) {
    if (data.extensions && data.extensions.includes(ext)) {
      matchingMimeTypes.push(mimeType);
    }
  }

  if (matchingMimeTypes.length === 0) return false;
  if (matchingMimeTypes.length === 1) return matchingMimeTypes[0];

  // 如果有多个匹配，按优先级选择最合适的
  return selectBestMimeType(matchingMimeTypes);
}

/**
 * 从多个MIME类型中选择最合适的
 * @param {string[]} mimeTypes - 匹配的MIME类型数组
 * @returns {string} 最合适的MIME类型
 */
function selectBestMimeType(mimeTypes) {
  // 定义MIME类型优先级规则
  const priorityRules = [
    // 视频文件优先选择video/*而不是application/*
    { condition: (mime) => mime.startsWith("video/"), priority: 10 },
    // 音频文件优先选择audio/*而不是application/*
    { condition: (mime) => mime.startsWith("audio/"), priority: 9 },
    // 图片文件优先选择image/*
    { condition: (mime) => mime.startsWith("image/"), priority: 8 },
    // 文本文件优先选择text/*
    { condition: (mime) => mime.startsWith("text/"), priority: 7 },
    // application/*类型优先级较低
    { condition: (mime) => mime.startsWith("application/"), priority: 5 },
  ];

  // 计算每个MIME类型的优先级分数
  const scoredMimeTypes = mimeTypes.map((mimeType) => {
    let score = 0;
    for (const rule of priorityRules) {
      if (rule.condition(mimeType)) {
        score = Math.max(score, rule.priority);
      }
    }
    return { mimeType, score };
  });

  // 按分数排序，返回最高分的MIME类型
  scoredMimeTypes.sort((a, b) => b.score - a.score);
  return scoredMimeTypes[0].mimeType;
}

// 文件类型常量（与后端完全一致）
export const FileType = {
  UNKNOWN: 0, // 未知文件
  FOLDER: 1, // 文件夹
  VIDEO: 2, // 视频文件
  AUDIO: 3, // 音频文件
  TEXT: 4, // 文本文件
  IMAGE: 5, // 图片文件
  OFFICE: 6, // Office文档
  DOCUMENT: 7, // 文档文件
};

// 电子书扩展名（foliate-js 支持的主流格式）
const EBOOK_EXTENSIONS = new Set(["epub", "mobi", "azw3", "azw", "fb2", "cbz"]);

/**
 * 获取文件扩展名
 * @param {string} filename - 文件名
 * @returns {string} 扩展名（小写）
 */
export function getExtension(filename) {
  if (!filename) return "";
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

/**
 * 获取文件图标类型（用于fileTypeIcons.js）
 * @param {Object} fileObject - 文件对象，包含type字段
 * @returns {string} 图标类型
 */
export function getIconType(fileObject) {
  const filename = fileObject?.filename || fileObject?.name || "";
  const ext = getExtension(filename);
  if (EBOOK_EXTENSIONS.has(ext)) {
    return "book";
  }

  const iconMap = {
    [FileType.UNKNOWN]: "file",
    [FileType.FOLDER]: "folder",
    [FileType.VIDEO]: "video",
    [FileType.AUDIO]: "audio",
    [FileType.TEXT]: "text",
    [FileType.IMAGE]: "image",
    [FileType.OFFICE]: "document",
    [FileType.DOCUMENT]: "document",
  };
  return iconMap[fileObject?.type] || iconMap[FileType.UNKNOWN];
}

/**
 * 获取预览组件名称
 * @param {Object} fileObject - 文件对象，包含type和filename字段
 * @returns {string} 预览组件名称
 */
export function getPreviewComponent(fileObject) {
  const type = fileObject?.type;
  const filename = fileObject?.filename || fileObject?.name || "";

  // 直接基于type字段的映射
  if (type === FileType.IMAGE) return "ImagePreview";
  if (type === FileType.VIDEO) return "VideoPreview";
  if (type === FileType.AUDIO) return "AudioPreview";

  // Document类型（可直接预览的文档，如PDF）
  if (type === FileType.DOCUMENT) return "PdfPreview";

  // Office类型
  if (type === FileType.OFFICE) return "OfficeSharePreview";

  // Text类型的细分
  if (type === FileType.TEXT) {
    const mode = getPreviewModeFromFilename(filename);

    if (mode === PREVIEW_MODES.CODE) return "CodePreview";
    if (mode === PREVIEW_MODES.MARKDOWN) return "MarkdownPreview";
    if (mode === PREVIEW_MODES.HTML) return "HtmlPreview";
    return "TextPreview";
  }

  // 默认预览
  return "GenericPreview";
}

/**
 * 检测是否为压缩文件
 * 基于标准MIME类型检测，避免硬编码
 * @param {string} filename - 文件名
 * @returns {boolean} 是否为压缩文件
 */
export function isArchiveFile(filename) {
  if (!filename) return false;

  // 使用前端兼容的MIME类型检测
  const mimeType = lookupMimeType(filename);

  if (!mimeType) return false;

  // 完全基于MIME类型检测压缩文件（基于mime-db数据库）
  let isArchive =
    mimeType.includes("zip") ||
    mimeType.includes("rar") ||
    mimeType.includes("tar") ||
    mimeType.includes("gzip") ||
    mimeType.includes("compress") ||
    mimeType.includes("archive") ||
    mimeType.includes("x-7z") ||
    mimeType.includes("x-bzip") ||
    mimeType.includes("x-xz") ||
    mimeType.includes("x-lzma") ||
    mimeType.includes("x-lz4") ||
    mimeType.includes("x-zstd") ||
    mimeType.includes("x-cpio") ||
    mimeType.includes("x-iso") ||
    mimeType.includes("x-cab") ||
    mimeType.includes("x-lha") ||
    mimeType.includes("x-lzh") ||
    mimeType.includes("x-xar") ||
    mimeType.includes("warc");

  // 特殊处理：当MIME类型为通用类型时，基于文件扩展名判断
  if (!isArchive && mimeType === "application/octet-stream") {
    const ext = getExtension(filename);
    const archiveExtensions = ["iso", "cpio", "xar", "ar", "a", "mtree"];
    isArchive = archiveExtensions.includes(ext);
  }

  return isArchive;
}

/**
 * 获取压缩文件类型信息
 * @param {string} filename - 文件名
 * @returns {Object} 压缩文件类型信息
 */
export function getArchiveType(filename) {
  if (!filename) return null;

  const ext = getExtension(filename);
  const archiveTypes = {
    zip: { name: "ZIP", icon: "IconFolderZip", supported: true, description: "ZIP压缩文件" },
    rar: { name: "RAR", icon: "IconZipBox", supported: true, description: "RAR压缩文件" },
    "7z": { name: "7-Zip", icon: "IconZipBoxOutline", supported: true, description: "7-Zip压缩文件" },
    tar: { name: "TAR", icon: "IconPackageVariant", supported: true, description: "TAR归档文件" },
    gz: { name: "Gzip", icon: "IconArchiveOutline", supported: true, description: "Gzip压缩文件" },
    bz2: { name: "Bzip2", icon: "IconArchiveOutline", supported: true, description: "Bzip2压缩文件" },
    xz: { name: "XZ", icon: "IconArchiveOutline", supported: true, description: "XZ压缩文件" },
    tgz: { name: "TAR.GZ", icon: "IconPackageVariantClosed", supported: true, description: "TAR + Gzip压缩文件" },
    tbz: { name: "TAR.BZ2", icon: "IconPackageVariantClosed", supported: true, description: "TAR + Bzip2压缩文件" },
    tbz2: { name: "TAR.BZ2", icon: "IconPackageVariantClosed", supported: true, description: "TAR + Bzip2压缩文件" },
    txz: { name: "TAR.XZ", icon: "IconPackageVariantClosed", supported: true, description: "TAR + XZ压缩文件" },
    cpio: { name: "CPIO", icon: "IconArchive", supported: true, description: "CPIO归档文件" },
    iso: { name: "ISO", icon: "IconDisc", supported: true, description: "ISO光盘镜像文件" },
    cab: { name: "CAB", icon: "IconZipBox", supported: true, description: "Microsoft CAB压缩文件" },
    xar: { name: "XAR", icon: "IconArchive", supported: true, description: "XAR归档文件" },
    ar: { name: "AR", icon: "IconArchive", supported: true, description: "AR归档文件" },
    a: { name: "AR", icon: "IconArchive", supported: true, description: "AR归档文件" },
    mtree: { name: "MTREE", icon: "IconFileTree", supported: true, description: "mtree文件系统描述" },
  };

  return (
    archiveTypes[ext] || {
      name: ext.toUpperCase(),
      icon: "IconArchive",
      supported: false,
      description: `${ext.toUpperCase()}压缩文件（暂不支持）`,
    }
  );
}

/**
 * 基于标准MIME类型库的文件类型检测
 * 将MIME类型映射到项目的FileType常量系统
 * @param {string} filename - 文件名
 * @returns {number} FileType常量
 */
export function detectFileTypeFromFilename(filename) {
  if (!filename) return FileType.UNKNOWN;

  const ext = getExtension(filename);

  // 优先处理特殊扩展名（无标准MIME类型的文件）
  const specialTextExtensions = ["vue", "tsx", "dockerfile", "makefile", "gitignore", "license", "readme", "conf", "ini", "rs", "vtt", "srt", "ass", "lrc"];
  if (specialTextExtensions.includes(ext)) {
    return FileType.TEXT;
  }

  // 使用前端兼容的MIME类型检测
  const mimeType = lookupMimeType(filename);
  if (!mimeType) return FileType.UNKNOWN;

  // 将MIME类型映射到项目的FileType常量
  return mapMimeTypeToFileType(mimeType, filename);
}

/**
 * 将MIME类型映射到项目的FileType常量
 * @param {string} mimeType - MIME类型
 * @param {string} filename - 文件名（用于特殊情况判断）
 * @returns {number} FileType常量
 */
function mapMimeTypeToFileType(mimeType, filename = "") {
  const ext = getExtension(filename);

  // 文本类型
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/javascript" ||
    mimeType === "application/x-sh" ||
    mimeType === "application/x-python-code" ||
    ["vue", "tsx", "dockerfile", "makefile", "gitignore", "license", "readme", "conf", "ini", "yml", "yaml"].includes(ext)
  ) {
    return FileType.TEXT;
  }

  // 音频类型
  if (mimeType.startsWith("audio/")) {
    return FileType.AUDIO;
  }

  // 视频类型
  if (mimeType.startsWith("video/") || mimeType === "application/mp4") {
    return FileType.VIDEO;
  }

  // 图片类型
  if (mimeType.startsWith("image/")) {
    return FileType.IMAGE;
  }

  // Office文档类型
  if (mimeType.includes("officedocument") || mimeType.includes("ms-excel") || mimeType.includes("ms-powerpoint") || mimeType.includes("msword") || mimeType === "application/rtf") {
    return FileType.OFFICE;
  }

  // PDF文档类型
  if (mimeType === "application/pdf") {
    return FileType.DOCUMENT;
  }

  return FileType.UNKNOWN;
}

/**
 * 创建模拟的文件对象，用于与现有图标和预览系统兼容
 * @param {Object} fileEntry - 文件条目（可以是压缩文件内容或其他来源）
 * @returns {Object} 模拟的文件对象
 */
export function createMockFileObject(fileEntry) {
  if (!fileEntry) return null;

  const type = fileEntry.isDirectory ? FileType.FOLDER : detectFileTypeFromFilename(fileEntry.name);

  return {
    name: fileEntry.name,
    filename: fileEntry.name,
    isDirectory: fileEntry.isDirectory,
    type: type,
    size: fileEntry.size || 0,
    isMount: false,
  };
}

/**
 * 判断文件是否可以预览
 * 压缩文件内支持更多类型的预览（除了Office文件）
 * @param {Object} fileEntry - 文件条目
 * @param {boolean} isInArchive - 是否在压缩文件内（默认false）
 * @returns {boolean} 是否可以预览
 */
export function canPreviewFile(fileEntry, isInArchive = false) {
  if (!fileEntry || fileEntry.isDirectory) return false;

  const type = detectFileTypeFromFilename(fileEntry.name);

  if (isInArchive) {
    // 压缩文件内支持：TEXT, IMAGE, DOCUMENT(PDF), VIDEO, AUDIO
    // 不支持：OFFICE（需要在线转换，在压缩文件内不合适）
    return type === FileType.TEXT || type === FileType.IMAGE || type === FileType.DOCUMENT || type === FileType.VIDEO || type === FileType.AUDIO;
  }

  // 普通文件预览（保持原有逻辑）
  return type === FileType.TEXT || type === FileType.IMAGE;
}

/**
 * 获取文件的MIME类型描述
 * @param {Object} fileEntry - 文件条目
 * @returns {string} MIME类型或简单描述
 */
export function getMimeTypeDescription(fileEntry) {
  if (!fileEntry) return "Unknown";
  if (fileEntry.isDirectory) return "Directory";

  const mimeType = lookupMimeType(fileEntry.name);
  if (mimeType) {
    return mimeType;
  }
  const ext = getExtension(fileEntry.name);
  return ext ? `${ext.toUpperCase()}` : "Unknown";
}

/**
 * 获取文件路径部分（不包含文件名）
 * @param {string} fullPath - 完整路径
 * @returns {string} 路径部分
 */
export function getFilePath(fullPath) {
  if (!fullPath) return "";
  const parts = fullPath.split("/");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

/**
 * 获取文件名部分（不包含路径）
 * @param {string} fullPath - 完整路径
 * @returns {string} 文件名部分
 */
export function getFileName(fullPath) {
  if (!fullPath) return "";
  const parts = fullPath.split("/");
  return parts[parts.length - 1];
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的大小
 */
export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * 获取文件显示名称（去除扩展名）
 * @param {string} filename - 文件名
 * @returns {string} 显示名称
 */
export function getDisplayName(filename) {
  if (!filename) return "";
  const lastDotIndex = filename.lastIndexOf(".");
  if (lastDotIndex === -1) return filename;
  return filename.slice(0, lastDotIndex);
}
