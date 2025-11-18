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

  // 仅对代理 URL（/api/file-view 或 /api/file-download）追加密码
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

  let url = file.urls?.proxyPreviewUrl || file.previewUrl;
  if (!url && file.slug) {
    url = fileViewService.buildPreviewUrl(file.slug, password || null);
  }

  if (!url) return "";

  return ensurePasswordInUrl(url, password, file);
}

export function buildDownloadUrl(file, options = {}) {
  if (!file) return "";
  const password = resolvePassword(file, options.password);

  let url = file.urls?.proxyDownloadUrl || file.downloadUrl;
  if (!url && file.slug) {
    url = fileViewService.buildDownloadUrl(file.slug, password || null);
  }

  if (!url) return "";

  return ensurePasswordInUrl(url, password, file);
}

export async function getOfficePreviewUrl(file, options = {}) {
  if (!file?.slug) return null;
  const password = resolvePassword(file, options.password);
  return await fileViewService.getOfficePreviewUrl(file.slug, {
    password: password || undefined,
    provider: options.provider || "microsoft",
    returnAll: options.returnAll || false,
  });
}

export async function getOfficePreviewUrlsForDirectUrl(directUrl) {
  if (!directUrl) {
    return null;
  }
  return await fileViewService.getOfficePreviewUrl({ directUrl }, { returnAll: true });
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
