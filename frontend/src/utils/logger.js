/* eslint-disable no-console */
/**
 * 统一前端日志工具
 *
 * 默认不刷屏：debug/info 需要“开开关”才会输出
 * warn/error 永远输出
 *
 * 开关规则：
 * 1) 运行时（推荐，随时开关）：浏览器控制台执行：
 *    - 开启全部调试：localStorage.setItem('cloudpaste_debug', '1')
 *    - 关闭：        localStorage.removeItem('cloudpaste_debug')
 * 2) 构建时（需要重新构建）：Vite 环境变量 `VITE_DEBUG`
 *    - VITE_DEBUG=1        → 开启全部调试
 *
 */

const DEBUG_KEY = "cloudpaste_debug";

const readEnvDebugValue = () => {
  try {
    return String(import.meta?.env?.VITE_DEBUG || "").trim();
  } catch {
    return "";
  }
};

const readLocalDebugValue = () => {
  try {
    if (typeof window === "undefined") return "";
    return String(window.localStorage?.getItem(DEBUG_KEY) || "").trim();
  } catch {
    return "";
  }
};

const readDebugValue = () => {
  // localStorage 优先（运行时随时可改），env 兜底（构建时决定）
  const local = readLocalDebugValue();
  if (local) return local;
  return readEnvDebugValue();
};

const isAllDebugValue = (raw) => {
  const v = String(raw || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "all" || v === "yes" || v === "on";
};

/**
 * 是否开启“全局调试输出”
 *
 * - localStorage: cloudpaste_debug=1
 * - env: VITE_DEBUG=1
 */
export function isDebugEnabled() {
  const raw = readDebugValue();
  if (!raw) return false;
  if (isAllDebugValue(raw)) return true;
  return false;
}

const normalizePrefix = (prefix) => {
  const raw = String(prefix || "").trim();
  if (!raw) return "";
  if (raw.startsWith("[") && raw.endsWith("]")) return raw;
  return `[${raw}]`;
};

/**
 * 创建一个“带前缀的 logger”
 * @param {string} prefix - 控制台前缀，比如 "API" / "Router" / "Upload"
 */
export function createLogger(prefix) {
  const tag = normalizePrefix(prefix || "log");

  const debug = (...args) => {
    if (!isDebugEnabled()) return;
    console.debug(tag, ...args);
  };

  const info = (...args) => {
    if (!isDebugEnabled()) return;
    console.info(tag, ...args);
  };

  const warn = (...args) => {
    console.warn(tag, ...args);
  };

  const error = (...args) => {
    console.error(tag, ...args);
  };

  return { debug, info, warn, error };
}
