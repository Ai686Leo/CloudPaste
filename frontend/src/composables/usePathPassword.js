/**
 * 路径密码管理 Composable
 * 负责密码验证 token 的存储和管理
 */

import { ref, reactive } from "vue";

// 路径规范化：与后端 FsMetaService 保持一致的规则
const normalizePath = (path) => {
  if (!path || path === "/") {
    return "/";
  }
  const trimmed = path.replace(/\/+$/, "") || "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const STORAGE_KEY = "fs_path_tokens_v1";

// 全局密码 token 存储（按规范化路径存储）
const pathTokens = reactive(new Map());

const loadTokensFromStorage = () => {
  if (typeof window === "undefined") return;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return;
    Object.entries(data).forEach(([path, token]) => {
      if (typeof path === "string" && typeof token === "string" && token) {
        const normalized = normalizePath(path);
        pathTokens.set(normalized, token);
      }
    });
  } catch (error) {
    console.warn("恢复路径密码 token 失败，将仅使用内存存储:", error);
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
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch (error) {
    console.warn("持久化路径密码 token 失败:", error);
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
    const normalized = normalizePath(path);
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
    const normalized = normalizePath(path);
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
   * 保存路径验证 token
   * @param {string} path - 路径
   * @param {string} token - 验证token
   */
  const savePathToken = (path, token) => {
    const normalized = normalizePath(path);
    pathTokens.set(normalized, token);
    console.log("保存路径密码token:", { path: normalized, token });
    persistTokensToStorage();
  };

  /**
   * 移除路径验证 token
   * @param {string} path - 路径
   */
  const removePathToken = (path) => {
    pathTokens.delete(normalizePath(path));
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
    pendingPath.value = normalizePath(path);
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
