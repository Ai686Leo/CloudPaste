import * as fileService from "./fileService.js";
import * as fileViewService from "./fileViewService.js";
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

function ensurePasswordInUrl(url, password, file) {
  if (!url || !password) return url || "";

  // 仅对 share 内容路由（/api/s/:slug?mode=...）追加密码
  // 以及标记为 use_proxy 的文件，避免污染直链/CDN URL
  const shareInfo = fileViewService.parseFileShareUrl(url);
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

export async function getSharedFileById(id) {
  const response = await fileService.getFile(id);
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

  // 预览统一基于 Link JSON 的 rawUrl：
  // - 当 rawUrl 为直链或 url_proxy/Worker 入口时直接使用
  // - 当 rawUrl 为空且 linkType=proxy/use_proxy=1 时才回退到 `/api/s/:slug?mode=inline`
  let url = file.rawUrl || "";

  if (
    !url &&
    file.slug &&
    (file.linkType === "proxy" || file.use_proxy)
  ) {
    // 仅在本地 share 内容路由模式下才回退到 inline 模式
    url = `/api/s/${file.slug}?mode=inline`;
  }

  if (!url) return "";

  return ensurePasswordInUrl(url, password, file);
}

export function buildDownloadUrl(file, options = {}) {
  if (!file) return "";
  const password = resolvePassword(file, options.password);

  // 下载入口按 linkType 分流：
  // - linkType=url_proxy：直接复用 rawUrl（通常为 /proxy/share/:slug）
  // - 其他场景：继续使用 share 内容路由 `/api/s/:slug?mode=attachment`
  let url = "";

  if (file.linkType === "url_proxy" && file.rawUrl) {
    url = file.rawUrl;
  } else if (file.slug) {
    url = fileViewService.buildDownloadUrl(file.slug, password || null);
  }

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
    directUrl: preview.rawUrl || null,
    microsoft: providers.microsoft || "",
    google: providers.google || "",
  };
}

export function parseShareUrl(url) {
  return fileViewService.parseFileShareUrl(url);
}

export function addPasswordToUrl(url, password) {
  return fileViewService.addPasswordToUrl(url, password);
}

export function getFileErrorKey(statusCode) {
  return fileViewService.getErrorKeyByStatus(statusCode);
}
