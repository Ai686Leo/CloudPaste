/**
 * storage-adapter 工具集合（合并版）
 *
 *
 */

import { API_BASE_URL, API_PREFIX } from "@/api/config.js";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("StorageTools");

/**
 * 把相对 API 路径补成绝对地址
 * - 例："/api/xxx" -> "http://localhost:8787/api/xxx"
 */
export function resolveAbsoluteApiUrl(url) {
  if (!url) return url;
  const s = String(url);
  if (/^https?:\/\//i.test(s)) return s;
  // 标准：以 /api 开头的一律走后端 API_BASE_URL
  if (s.startsWith(API_PREFIX)) return `${API_BASE_URL}${s}`;
  if (s.startsWith(`${API_PREFIX}/`)) return `${API_BASE_URL}${s}`;
  if (s.startsWith("/")) return `${API_BASE_URL}${s}`;
  return `${API_BASE_URL}/${s}`;
}

/**
 * 会话管理器 - 处理上传会话的生命周期
 */
export class SessionManager {
  constructor(config) {
    this.config = config;
    this.sessions = new Map();
    this.pausedFiles = new Set();

    this.cleanupTimer = null;
    const loop = () => {
      try {
        this.cleanupExpiredSessions();
      } finally {
        this.cleanupTimer = setTimeout(loop, 5 * 60 * 1000);
      }
    };
    this.cleanupTimer = setTimeout(loop, 5 * 60 * 1000);
  }

  createSession(fileId, sessionData) {
    const session = { ...sessionData, createdAt: Date.now(), lastAccessAt: Date.now() };
    this.sessions.set(fileId, session);
    return session;
  }

  getSession(fileId) {
    const session = this.sessions.get(fileId);
    if (session) session.lastAccessAt = Date.now();
    return session;
  }

  updateSession(fileId, updates) {
    const session = this.sessions.get(fileId);
    if (session) Object.assign(session, updates, { lastAccessAt: Date.now() });
  }

  deleteSession(fileId) {
    return this.sessions.delete(fileId);
  }

  setFilePaused(fileId, paused) {
    if (paused) {
      this.pausedFiles.add(fileId);
      log.debug(`文件已暂停: ${fileId}`);
    } else {
      this.pausedFiles.delete(fileId);
      log.debug(`文件已恢复: ${fileId}`);
    }
  }

  isFilePaused(fileId) {
    return this.pausedFiles.has(fileId);
  }

  cleanupExpiredSessions() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [fileId, session] of this.sessions) {
      if (now - session.lastAccessAt > this.config.sessionTimeout) {
        this.sessions.delete(fileId);
        this.pausedFiles.delete(fileId);
        cleanedCount += 1;
      }
    }

    if (cleanedCount > 0) {
      log.debug(`清理了 ${cleanedCount} 个过期会话`);
    }
  }

  getStats() {
    return { activeSessions: this.sessions.size, pausedFiles: this.pausedFiles.size };
  }

  destroy() {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
    this.pausedFiles.clear();
  }
}

/**
 * 认证提供器 - 处理认证相关逻辑
 */
export class AuthProvider {
  constructor(authStore) {
    this.authStore = authStore;
  }

  getAuthHeaders() {
    const headers = {};

    if (this.authStore.authType === "admin" && this.authStore.adminToken) {
      headers["Authorization"] = `Bearer ${this.authStore.adminToken}`;
    } else if (this.authStore.isKeyUser && this.authStore.apiKey) {
      headers["Authorization"] = `ApiKey ${this.authStore.apiKey}`;
    }

    return headers;
  }
}

/**
 * 路径解析器 - 处理路径相关逻辑
 */
export class PathResolver {
  constructor(currentPath) {
    this.currentPath = currentPath || "/";
  }

  buildFullPathFromKey(storageKey) {
    const key = String(storageKey || "").replace(/^\/+/, "");
    const path = String(this.currentPath || "/").replace(/\/+$/, "");
    return `${path}/${key}`.replace(/\/+/g, "/");
  }
}

/**
 * 错误处理器 - 统一错误处理逻辑
 */
export class ErrorHandler {
  constructor(onError) {
    this.onError = onError;
  }

  handle(error, context = "") {
    const message = context ? `${context}: ${error?.message || error}` : error?.message || String(error);
    try {
      if (typeof this.onError === "function") this.onError(error, context);
    } catch {}
    return message;
  }
}
