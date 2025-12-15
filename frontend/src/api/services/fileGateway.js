import * as fileService from "./fileService.js";
import { getFilePassword } from "@/utils/filePasswordUtils.js";

function normalizeListResponse(response, limit, offset) {
  const payload = response?.data ?? response?.files ?? response;
  const files = Array.isArray(payload?.files) ? payload.files : Array.isArray(payload) ? payload : [];
  const rawPagination = payload?.pagination;
  const pagination = rawPagination
    ? {
        total: rawPagination.total ?? files.length,
        limit: rawPagination.limit ?? limit,
        offset: rawPagination.offset ?? offset,
        hasMore: rawPagination.hasMore ?? rawPagination.has_more ?? false,
      }
    : { total: files.length, limit, offset, hasMore: false };
  return { files, pagination };
}

/**
 * 检查URL是否为文件分享代理URL
 * @param {string} url - 要检查的URL
 * @returns {{ isFileShare: boolean, type?: "preview"|"download", slug?: string, password?: string|null, mode?: "inline"|"attachment" }}
 */
function parseFileShareUrl(url) {
  if (!url) return { isFileShare: false };

  // Share 文本内容口：/api/share/content/:slug
  const contentMatch = url.match(/\/api\/share\/content\/([^?]+)/);
  if (contentMatch) {
    const slug = contentMatch[1];
    const urlObj = new URL(url, window.location.origin);
    const password = urlObj.searchParams.get("password");
    return {
      isFileShare: true,
      type: "preview",
      slug,
      password,
      mode: "inline",
    };
  }

  // Share 本地代理入口：/api/s/:slug
  const legacyMatch = url.match(/\/api\/s\/([^?]+)/);
  if (legacyMatch) {
    const slug = legacyMatch[1];
    const urlObj = new URL(url, window.location.origin);
    const password = urlObj.searchParams.get("password");
    const down = urlObj.searchParams.get("down");
    const mode = urlObj.searchParams.get("mode") || "inline";
    const isDownload =
      (down && down !== "0" && down !== "false") ||
      mode === "attachment" ||
      mode === "download";

    return {
      isFileShare: true,
      type: isDownload ? "download" : "preview",
      slug,
      password,
      mode: isDownload ? "attachment" : "inline",
    };
  }

  return { isFileShare: false };
}

function ensurePasswordInUrl(url, password, file) {
  if (!url || !password) return url || "";

  // 仅对 share 同源路由（/api/share/content/:slug 或 /api/s/:slug）追加密码
  // 以及标记为 use_proxy 的文件，避免污染直链/CDN URL
  const shareInfo = parseFileShareUrl(url);
  const isProxy = shareInfo.isFileShare || file?.use_proxy;

  if (!isProxy) return url;
  if (url.includes("password=")) return url;

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}password=${encodeURIComponent(password)}`;
}

function resolvePassword(file, explicitPassword) {
  if (explicitPassword !== undefined) return explicitPassword;
  return getFilePassword({ file });
}

export async function listSharedFiles(limit = 50, offset = 0, options = {}) {
  const response = await fileService.getFiles(limit, offset, options);
  if (!response?.success) {
    throw new Error(response?.message || "加载文件列表失败");
  }
  return normalizeListResponse(response, limit, offset);
}

export async function getSharedFileById(id, options = {}) {
  const response = await fileService.getFile(id, options);
  if (!response?.success) {
    throw new Error(response?.message || "获取文件详情失败");
  }
  return response.data;
}

export async function getSharedFileBySlug(slug) {
  const response = await fileService.getPublicFile(slug);
  if (!response?.success) {
    throw new Error(response?.message || "获取文件详情失败");
  }
  return response.data;
}

export function buildPreviewUrl(file, options = {}) {
  if (!file) return "";
  const password = resolvePassword(file, options.password);

  // 预览统一基于 Link JSON 的 previewUrl（已由后端决策为 inline 语义入口）
  let url = file.previewUrl || "";

  if (!url) return "";

  return ensurePasswordInUrl(url, password, file);
}

/**
 * 构建“内容访问” URL（用于文本类预览 / 编码检测）
 * - 语义：始终通过 share 内容路由 /api/share/content/:slug 访问（同源），避免直链 CORS
 * - 与 buildPreviewUrl 的区别：buildPreviewUrl 更偏向“外部预览入口”（新窗口/嵌入），这里专注于同源内容访问
 * @param {FileshareItem} file
 * @param {{ password?: string }} [options]
 * @returns {string}
 */
export function buildContentUrl(file, options = {}) {
  if (!file || !file.slug) return "";
  const password = resolvePassword(file, options.password);

  // 文本/编码检测专用同源内容口
  let url = `/api/share/content/${file.slug}`;

  // 仅在文件分享场景或 use_proxy=1 时追加密码参数
  url = ensurePasswordInUrl(url, password, file);

  return url;
}

export function buildDownloadUrl(file, options = {}) {
  if (!file) return "";
  const password = resolvePassword(file, options.password);

  // 下载统一基于 Link JSON 的 downloadUrl
  let url = file.downloadUrl || "";

  if (!url) return "";

  return ensurePasswordInUrl(url, password, file);
}

export async function getOfficePreviewUrl(file, options = {}) {
  const preview = file?.documentPreview;

  // 未提供 documentPreview 或不支持预览时直接返回 null
  const providers = preview?.providers || {};
  if (!preview || !Object.keys(providers).length) {
    return null;
  }

  const returnAll = options.returnAll || false;

  if (!returnAll) {
    // 默认使用 providers 中的 microsoft 作为推荐入口
    return providers.microsoft || null;
  }

  // 返回所有可用的预览 URL（如果服务端提供了 providers）
  return {
    directUrl: buildPreviewUrl(file, options) || null,
    microsoft: providers.microsoft || "",
    google: providers.google || "",
  };
}

export function parseShareUrl(url) {
  return parseFileShareUrl(url);
}

export function addPasswordToUrl(url, password) {
  if (!url || !password) return url;

  if (url.includes("password=")) return url;

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}password=${encodeURIComponent(password)}`;
}

export function getFileErrorKey(statusCode) {
  switch (statusCode) {
    case 401:
      return "fileView.errors.unauthorized";
    case 403:
      return "fileView.errors.forbidden";
    case 404:
      return "fileView.errors.notFound";
    case 410:
      return "fileView.errors.forbidden";
    default:
      return "fileView.errors.serverError";
  }
}
