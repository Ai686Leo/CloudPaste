/**
 * 构建文件下载URL（用于直接链接）
 * @param {string} slug - 文件短链接
 * @param {string} [password] - 文件密码（如果需要）
 * @returns {string} 完整的下载URL
 */
export function buildDownloadUrl(slug, password = null) {
  // 使用 URL API 构建，避免重复 ? 与参数拼接错误
  const baseUrl = window.location.origin;
  const urlObj = new URL(`/api/s/${slug}`, baseUrl);
  urlObj.searchParams.set("mode", "attachment");

  if (password) {
    urlObj.searchParams.set("password", password);
  }

  return urlObj.toString();
}

/**
 * 检查URL是否为文件分享代理URL
 * @param {string} url - 要检查的URL
 * @returns {Object} 检查结果
 */
export function parseFileShareUrl(url) {
  if (!url) return { isFileShare: false };

  // 检查是否为 share 内容路由 URL（/api/s/:slug?mode=...）
  const match = url.match(/\/api\/s\/([^?]+)/);
  if (match) {
    const slug = match[1];
    const urlObj = new URL(url, window.location.origin);
    const password = urlObj.searchParams.get("password");
    const mode = urlObj.searchParams.get("mode") || "inline";

    return {
      isFileShare: true,
      type: mode === "attachment" ? "download" : "preview",
      slug,
      password,
      mode,
    };
  }

  return { isFileShare: false };
}

/**
 * 为现有URL添加密码参数
 * @param {string} url - 原始URL
 * @param {string} password - 要添加的密码
 * @returns {string} 添加密码后的URL
 */
export function addPasswordToUrl(url, password) {
  if (!url || !password) return url;

  // 检查URL中是否已包含密码参数
  if (url.includes("password=")) return url;

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}password=${encodeURIComponent(password)}`;
}

/**
 * 将HTTP状态码映射到国际化错误键
 * @param {number} statusCode - HTTP状态码
 * @returns {string} 国际化错误键
 */
export function getErrorKeyByStatus(statusCode) {
  switch (statusCode) {
    case 401:
      return "fileView.errors.unauthorized";
    case 403:
      return "fileView.errors.forbidden";
    case 404:
      return "fileView.errors.notFound";
    case 410:
      return "fileView.errors.forbidden"; // 文件过期也使用 forbidden
    default:
      return "fileView.errors.serverError";
  }
}
