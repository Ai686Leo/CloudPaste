/**
 * 预览规则决策服务
 * 统一根据 preview_providers 生成预览选择结果
 */

import previewSettingsCache from "../cache/PreviewSettingsCache.js";
import { getFileExtension } from "../utils/fileTypeDetector.js";
import { FILE_TYPES } from "../constants/index.js";

const PREVIEW_KINDS = Object.freeze({
  COMPONENT: "component",
  IFRAME: "iframe",
  DOWNLOAD: "download",
});

const TEXT_KEYS = new Set(["text", "code", "markdown", "html"]);
const OFFICE_NATIVE_EXTS = new Set(["docx", "xlsx", "pptx"]);
// providers 里的 "native" 是一个“占位符”，表示走本地/原生预览实现。
const NATIVE_PROVIDER_SUPPORTED_KEYS = new Set(["office", "pdf", "epub"]);

function normalizePreviewKey(key) {
  const v = (key || "").toString().toLowerCase();
  if (TEXT_KEYS.has(v)) return "text";
  return v;
}

/**
 * 统一的预览选择入口
 * @param {Object} fileMeta - 文件元信息（type/typeName/mimetype/filename/size 等）
 * @param {Object} linkJson - Link JSON 视角下的链接信息（previewUrl/downloadUrl/linkType/use_proxy 等）
 * @returns {Promise<{key:string, kind:string, providers?:Record<string,string>, matchedRule?:string}>}
 */
export async function resolvePreviewSelection(fileMeta, linkJson) {
  const filename = fileMeta?.filename || "";
  const extension = getFileExtension(filename);
  const previewUrl = linkJson?.previewUrl || "";
  const downloadUrl = linkJson?.downloadUrl || "";

  const rules = normalizeRules(previewSettingsCache.getPreviewProvidersConfig());
  const context = buildMatchContext(fileMeta, filename, extension);

  for (const rule of rules) {
    if (!matchRule(rule, context)) continue;
    if (!rule.previewKey) continue;

    const previewKey = normalizePreviewKey(rule.previewKey);

    let providers = buildProvidersFromRule(rule.providers, {
      previewUrl,
      downloadUrl,
      name: filename,
    });

    // 清理 providers：
    // - iframe 预览必须是 URL，不能出现 "native" 这种占位符
    // - 其他预览类型只有在“实现端支持解释 native”时才允许保留
    for (const [k, v] of Object.entries(providers)) {
      if (v !== "native") continue;
      if (previewKey === "iframe" || !NATIVE_PROVIDER_SUPPORTED_KEYS.has(previewKey)) {
        delete providers[k];
      }
    }

    // iframe 预览必须提供至少一个可用的 URL（不能依赖 native 这种占位）
    if (previewKey === "iframe" && !Object.keys(providers).length) {
      continue;
    }

    const normalizedProviders =
      previewKey === "office"
        ? injectNativeProviderIfNeeded(providers, extension)
        : providers;

    return {
      key: previewKey,
      kind: previewKey === "iframe" ? PREVIEW_KINDS.IFRAME : PREVIEW_KINDS.COMPONENT,
      providers: normalizedProviders,
      matchedRule: rule.id || "",
    };
  }

  return buildFallbackSelection(fileMeta, filename, extension);
}

function normalizeRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((rule, index) => ({
      ...rule,
      _index: index,
      priority: Number.isFinite(rule?.priority) ? Number(rule.priority) : 0,
    }))
    .sort((a, b) => b.priority - a.priority || a._index - b._index);
}

function buildMatchContext(fileMeta, filename, extension) {
  const typeName = (fileMeta?.typeName || "").toString().toLowerCase();
  const type = fileMeta?.type;

  return {
    filename,
    extension,
    typeName,
    typeCode: type,
    fileType: resolveFileTypeName(type, typeName),
  };
}

function resolveFileTypeName(typeCode, typeName) {
  if (typeName) return typeName;
  switch (typeCode) {
    case FILE_TYPES.TEXT:
      return "text";
    case FILE_TYPES.AUDIO:
      return "audio";
    case FILE_TYPES.VIDEO:
      return "video";
    case FILE_TYPES.IMAGE:
      return "image";
    case FILE_TYPES.OFFICE:
      return "office";
    case FILE_TYPES.DOCUMENT:
      return "document";
    default:
      return "unknown";
  }
}

function matchRule(rule, context) {
  const match = rule?.match || {};
  const extList = normalizeExtList(match.ext || match.exts || match.extensions || rule.ext);
  const regexSource = match.regex || match.pattern;

  if (extList.length && !extList.includes(context.extension)) return false;

  if (regexSource) {
    const regex = toRegex(regexSource);
    if (!regex || !regex.test(context.filename)) return false;
  }

  return true;
}

function normalizeExtList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(",");
  return list
    .map((ext) => String(ext).trim().toLowerCase())
    .filter((ext) => ext.length > 0);
}

function toRegex(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  // 支持类似 /pattern/flags 的写法（例如 /^(readme|license)$/i）
  // 兼容：/pattern/（无 flags）等价旧逻辑
  if (raw.startsWith("/")) {
    const lastSlash = raw.lastIndexOf("/");
    if (lastSlash > 0) {
      const pattern = raw.slice(1, lastSlash);
      const flags = raw.slice(lastSlash + 1);
      try {
        return new RegExp(pattern, flags);
      } catch (error) {
        console.warn("preview_providers 正则无效，已忽略:", raw, error);
        return null;
      }
    }
  }
  try {
    return new RegExp(raw);
  } catch (error) {
    console.warn("preview_providers 正则无效，已忽略:", raw, error);
    return null;
  }
}

function buildProvidersFromRule(providersConfig, vars) {
  if (!providersConfig || typeof providersConfig !== "object") return {};
  const normalized = normalizeProviders(providersConfig);
  return buildProvidersFromTemplate(normalized, vars);
}

function normalizeProviders(providersConfig) {
  const normalized = {};
  for (const [providerKey, cfg] of Object.entries(providersConfig)) {
    if (!cfg) continue;
    if (typeof cfg === "string") {
      normalized[providerKey] = { urlTemplate: cfg };
    } else if (typeof cfg === "object") {
      normalized[providerKey] = { urlTemplate: cfg.urlTemplate || "" };
    }
  }
  return normalized;
}

function buildProvidersFromTemplate(providersConfig, vars) {
  const result = {};
  const previewUrl = vars.previewUrl || "";
  const downloadUrl = vars.downloadUrl || "";
  const name = vars.name || "";

  const base64EncodeUtf8 = (text) => {
    if (!text) return "";
    return Buffer.from(String(text), "utf8").toString("base64");
  };

  const b64PreviewUrl = previewUrl ? base64EncodeUtf8(previewUrl) : "";
  const b64DownloadUrl = downloadUrl ? base64EncodeUtf8(downloadUrl) : "";

  const valueMap = {
    $name: name,
    $e_name: name ? encodeURIComponent(name) : "",
    $url: previewUrl,
    $e_url: previewUrl ? encodeURIComponent(previewUrl) : "",
    $e_download_url: downloadUrl ? encodeURIComponent(downloadUrl) : "",
    // Base64 + URL-encode
    $b64e_url: b64PreviewUrl ? encodeURIComponent(b64PreviewUrl) : "",
    $b64e_download_url: b64DownloadUrl ? encodeURIComponent(b64DownloadUrl) : "",
  };

  for (const [providerKey, cfg] of Object.entries(providersConfig || {})) {
    if (!cfg || !cfg.urlTemplate) continue;
    if (cfg.urlTemplate === "native") {
      result[providerKey] = "native";
      continue;
    }
    let rendered = cfg.urlTemplate;
    rendered = rendered.replace(
      /\$b64e_download_url|\$b64e_url|\$e_download_url|\$e_url|\$e_name|\$url|\$name/g,
      (token) => valueMap[token] ?? "",
    );
    if (rendered) {
      result[providerKey] = rendered;
    }
  }

  return result;
}

function injectNativeProviderIfNeeded(providers, extension) {
  if (!OFFICE_NATIVE_EXTS.has(extension)) return providers || {};
  if (providers && Object.prototype.hasOwnProperty.call(providers, "native")) return providers;
  return { native: "native", ...(providers || {}) };
}

function buildFallbackSelection(fileMeta, filename, extension) {
  const typeName = resolveFileTypeName(fileMeta?.type, (fileMeta?.typeName || "").toString().toLowerCase());

  if (typeName === "image") return { key: "image", kind: PREVIEW_KINDS.COMPONENT };
  if (typeName === "video") return { key: "video", kind: PREVIEW_KINDS.COMPONENT };
  if (typeName === "audio") return { key: "audio", kind: PREVIEW_KINDS.COMPONENT };
  if (typeName === "document") return { key: "pdf", kind: PREVIEW_KINDS.COMPONENT };
  if (typeName === "office") {
    const providers = injectNativeProviderIfNeeded({}, extension);
    return { key: "office", kind: PREVIEW_KINDS.COMPONENT, providers };
  }

  if (typeName === "text") {
    return { key: "text", kind: PREVIEW_KINDS.COMPONENT };
  }

  return { key: "download", kind: PREVIEW_KINDS.DOWNLOAD };
}
