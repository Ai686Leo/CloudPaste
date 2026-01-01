/**
 * 统一的文件密码解析逻辑
 * 优先级：plain_password > currentPassword > URL参数 > sessionStorage
 * @param {{ file?: any, slug?: string, url?: string }} options
 * @returns {string|null}
 */

import { useSessionStorage } from "@vueuse/core";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("FilePasswordUtils");

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
      log.warn("解析URL密码参数失败:", error);
    }
  }

  if (typeof window !== "undefined" && slug) {
    try {
      const stored = useSessionStorage(`file_password_${slug}`, "");
      return stored.value || null;
    } catch (error) {
      log.warn("从会话存储获取密码失败:", error);
    }
  }

  return null;
}

/**
 * 统一的文件密码写入逻辑（写入 sessionStorage）
 * @param {string} slug
 * @param {string} password
 */
export function setFilePassword(slug, password) {
  if (typeof window === "undefined" || !slug) return;
  try {
    const stored = useSessionStorage(`file_password_${slug}`, "");
    stored.value = password || "";
  } catch (error) {
    log.warn("写入会话存储密码失败:", error);
  }
}
