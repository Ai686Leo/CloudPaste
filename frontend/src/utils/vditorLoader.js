/**
 * Vditor 资源懒加载工具
 *
 * - 版本号常量：VDITOR_VERSION
 * - 资源基础路径：VDITOR_ASSETS_BASE
 *   - ${VDITOR_ASSETS_BASE}/dist/index.css
 *   - ${VDITOR_ASSETS_BASE}/dist/index.min.js
 *
 */

// Vditor 版本常量（与静态资源版本对应，用于后续升级）
export const VDITOR_VERSION = "3.11.1";

// Vditor 静态资源基础路径
// 目录结构：public/assets/vditor/<版本>/dist/**
export const VDITOR_ASSETS_BASE = `/assets/vditor/${VDITOR_VERSION}`;

let VditorClass = null;
let vditorCSSLoaded = false;
let vditorLoading = false;
let vditorLoadFailed = false;
let pendingResolvers = [];

const VDITOR_SCRIPT_SRC = `${VDITOR_ASSETS_BASE}/dist/index.min.js`;
const VDITOR_CSS_HREF = `${VDITOR_ASSETS_BASE}/dist/index.css`;

/**
 * 加载 Vditor CSS（幂等）
 */
export const loadVditorCSS = async () => {
  if (vditorCSSLoaded) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = VDITOR_CSS_HREF;
  document.head.appendChild(link);

  vditorCSSLoaded = true;
};

/**
 * 懒加载 Vditor JS 单例
 */
export const loadVditor = async () => {
  // 已有实例，直接返回
  if (VditorClass) {
    return VditorClass;
  }

  if (vditorLoading) {
    return new Promise((resolve, reject) => {
      pendingResolvers.push({ resolve, reject });
    });
  }

  if (vditorLoadFailed) {
    vditorLoadFailed = false;
  }

  vditorLoading = true;

  try {
    await loadVditorCSS();

    const script = document.createElement("script");
    script.src = VDITOR_SCRIPT_SRC;

    await new Promise((resolve, reject) => {
      script.onload = () => {
        // 重试机制：10次重试，每次100ms，总等待1秒
        const maxRetries = 10;
        const checkInterval = 100;
        let retryCount = 0;

        const checkReady = () => {
          if (window.Vditor) {
            VditorClass = window.Vditor;
            resolve(VditorClass);
            return;
          }

          retryCount += 1;
          if (retryCount >= maxRetries) {
            reject(new Error("Vditor API 不可用（超时）"));
            return;
          }

          setTimeout(checkReady, checkInterval);
        };

        checkReady();
      };

      script.onerror = () => {
        reject(new Error("Vditor 脚本加载失败"));
      };

      document.head.appendChild(script);
    });

    // 加载成功，通知调用者
    pendingResolvers.forEach(({ resolve }) => resolve(VditorClass));
    pendingResolvers = [];
  } catch (error) {
    vditorLoadFailed = true;
    pendingResolvers.forEach(({ reject }) => reject(error));
    pendingResolvers = [];
    throw error;
  } finally {
    vditorLoading = false;
  }

  return VditorClass;
};
