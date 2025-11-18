/**
 * 统一的文件密码解析逻辑
 * 优先级：plain_password > currentPassword > URL参数 > sessionStorage
 * @param {{ file?: any, slug?: string, url?: string }} options
 * @returns {string|null}
 */
export function getFilePassword(options = {}) {
  const file = options.file || {};
  const slug = options.slug || file.slug;

  if (file.plain_password) {
    return file.plain_password;
  }

  if (file.currentPassword) {
    return file.currentPassword;
  }

  if (typeof window !== "undefined") {
    try {
      const currentUrl = new URL(options.url || window.location.href);
      const passwordParam = currentUrl.searchParams.get("password");
      if (passwordParam) {
        return passwordParam;
      }
    } catch (error) {
      console.warn("解析URL密码参数失败:", error);
    }
  }

  if (typeof window !== "undefined" && slug) {
    try {
      const sessionPassword = sessionStorage.getItem(`file_password_${slug}`);
      if (sessionPassword) {
        return sessionPassword;
      }
    } catch (error) {
      console.warn("从会话存储获取密码失败:", error);
    }
  }

  return null;
}
