/**
 * 路径密码管理 Composable
 * 负责密码验证 token 的存储和管理
 */

import { ref, reactive } from "vue";
import { useSessionStorage } from "@vueuse/core";
import { normalizeFsPath } from "@/utils/fsPathUtils.js";
import { createLogger } from "@/utils/logger.js";

const STORAGE_KEY = "fs_path_tokens_v1";
const log = createLogger("PathPassword");

// 全局密码 token 存储（按规范化路径存储）
const pathTokens = reactive(new Map());

// sessionStorage 持久化
const storedTokens = typeof window === "undefined" ? ref({}) : useSessionStorage(STORAGE_KEY, {});

const loadTokensFromStorage = () => {
  if (typeof window === "undefined") return;
  try {
    const data = storedTokens.value;
    if (!data || typeof data !== "object") return;
    Object.entries(data).forEach(([path, token]) => {
      if (typeof path === "string" && typeof token === "string" && token) {
        const normalized = normalizeFsPath(path);
        pathTokens.set(normalized, token);
      }
    });
  } catch (error) {
    log.warn("恢复路径密码 token 失败，将仅使用内存存储:", error);
  }
};

const persistTokensToStorage = () => {
  if (typeof window === "undefined") return;
  try {
    const obj = {};
    pathTokens.forEach((token, path) => {
      if (typeof token === "string" && token) {
        obj[path] = token;
      }
    });
    storedTokens.value = obj;
  } catch (error) {
    log.warn("持久化路径密码 token 失败:", error);
  }
};

// 初始化时从 sessionStorage 恢复一次
loadTokensFromStorage();

// 当前正在验证的路径
const pendingPath = ref(null);

// 是否正在显示密码弹窗
const showPasswordDialog = ref(false);

export function usePathPassword() {
  /**
   * 检查路径是否已验证
   * @param {string} path - 路径
   * @returns {boolean}
   */
  const hasPathToken = (path) => {
    const normalized = normalizeFsPath(path);
    // 从当前路径向上查找最近的有 token 的 ownerPath
    let current = normalized;
    while (true) {
      if (pathTokens.has(current)) {
        return true;
      }
      if (current === "/") {
        break;
      }
      const segments = current.split("/").filter(Boolean);
      if (segments.length === 0) {
        current = "/";
      } else {
        segments.pop();
        current = segments.length > 0 ? `/${segments.join("/")}` : "/";
      }
    }
    return false;
  };

  /**
   * 获取路径的验证 token
   * @param {string} path - 路径
   * @returns {string|null}
   */
  const getPathToken = (path) => {
    const normalized = normalizeFsPath(path);
    // 优先使用距离当前路径最近的密码域 token
    let current = normalized;
    while (true) {
      const token = pathTokens.get(current);
      if (token) {
        return token;
      }
      if (current === "/") {
        break;
      }
      const segments = current.split("/").filter(Boolean);
      if (segments.length === 0) {
        current = "/";
      } else {
        segments.pop();
        current = segments.length > 0 ? `/${segments.join("/")}` : "/";
      }
    }
    return null;
  };

  /**
   * 获取全部路径密码 token（用于搜索等需要汇总的场景）
   * @returns {string[]}
   */
  const getAllPathTokens = () => {
    const tokens = [];
    pathTokens.forEach((token) => {
      if (typeof token === "string" && token) {
        tokens.push(token);
      }
    });
    return tokens;
  };

  /**
   * 保存路径验证 token
   * @param {string} path - 路径
   * @param {string} token - 验证token
   */
  const savePathToken = (path, token) => {
    const normalized = normalizeFsPath(path);
    pathTokens.set(normalized, token);
    // 注意：不要把 token 内容打到控制台（可能被截图/上报），只记录长度用于排查
    log.debug("保存路径密码token", { path: normalized, tokenLength: String(token || "").length });
    persistTokensToStorage();
  };

  /**
   * 移除路径验证 token
   * @param {string} path - 路径
   */
  const removePathToken = (path) => {
    pathTokens.delete(normalizeFsPath(path));
    persistTokensToStorage();
  };

  /**
   * 清除所有验证 token
   */
  const clearAllTokens = () => {
    pathTokens.clear();
    persistTokensToStorage();
  };

  /**
   * 设置待验证路径
   * @param {string} path - 路径
   */
  const setPendingPath = (path) => {
    pendingPath.value = normalizeFsPath(path);
  };

  /**
   * 清除待验证路径
   */
  const clearPendingPath = () => {
    pendingPath.value = null;
  };

  /**
   * 显示密码弹窗
   */
  const openPasswordDialog = () => {
    showPasswordDialog.value = true;
  };

  /**
   * 关闭密码弹窗
   */
  const closePasswordDialog = () => {
    showPasswordDialog.value = false;
  };

  /**
   * 请求路径密码验证
   * @param {string} path - 需要验证的路径
   */
  const requestPasswordVerification = (path) => {
    setPendingPath(path);
    openPasswordDialog();
  };

  return {
    // 状态
    pendingPath,
    showPasswordDialog,

    // Token 管理
    hasPathToken,
    getPathToken,
    getAllPathTokens,
    savePathToken,
    removePathToken,
    clearAllTokens,

    // 弹窗控制
    setPendingPath,
    clearPendingPath,
    openPasswordDialog,
    closePasswordDialog,
    requestPasswordVerification,
  };
}
