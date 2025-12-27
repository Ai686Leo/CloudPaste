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

// 复用相同的 id，提前加载并对 mermaid.initialize 打“补丁”，用于规避 foreignObject 宽度出现极小负数导致的控制台报错。
const VDITOR_MERMAID_SCRIPT_ID = "vditorMermaidScript";
const VDITOR_MERMAID_VERSION = "11.6.0";
const VDITOR_MERMAID_SCRIPT_SRC = `${VDITOR_ASSETS_BASE}/dist/js/mermaid/mermaid.min.js?v=${VDITOR_MERMAID_VERSION}`;

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

/**
 * 判断 Markdown 文本里是否“可能包含 Mermaid 图”
 * - 只做快速判断，避免每次 preview 都提前加载 mermaid 资源
 * @param {string} markdown
 * @returns {boolean}
 */
export const mightContainMermaid = (markdown) => {
  if (!markdown || typeof markdown !== "string") return false;
  // 支持 ```mermaid 和 ~~~mermaid
  return /(?:```|~~~)\s*mermaid\b/i.test(markdown);
};

/**
 * 确保 Mermaid 脚本已加载（复用 Vditor 的 script id，避免重复插入）
 * @returns {Promise<any>} - window.mermaid
 */
export const ensureVditorMermaidLoaded = async () => {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  if (window.mermaid) return window.mermaid;

  const existing = document.getElementById(VDITOR_MERMAID_SCRIPT_ID);
  if (!existing) {
    const script = document.createElement("script");
    script.id = VDITOR_MERMAID_SCRIPT_ID;
    script.src = VDITOR_MERMAID_SCRIPT_SRC;
    document.head.appendChild(script);
  }

  // 简单轮询：最多等 1 秒（10 次 * 100ms），和 loadVditor 的逻辑保持一致
  const maxRetries = 10;
  const checkInterval = 100;
  let retryCount = 0;

  await new Promise((resolve, reject) => {
    const checkReady = () => {
      if (window.mermaid) {
        resolve();
        return;
      }
      retryCount += 1;
      if (retryCount >= maxRetries) {
        reject(new Error("Mermaid API 不可用（超时）"));
        return;
      }
      setTimeout(checkReady, checkInterval);
    };
    checkReady();
  });

  return window.mermaid;
};

/**
 * 给 Mermaid.initialize 打补丁：强制 flowchart.htmlLabels=false
 * 目的：避免 Mermaid 用 foreignObject 渲染边标签时出现极小负数 width，触发浏览器控制台报错。
 *
 * 说明：Mermaid 官方配置里 flowchart.htmlLabels 默认是 true。
 * 但在某些布局/字体/缩放场景下，foreignObject 的 width 可能被算成 -2.7e-7 这类“接近 0 的负数”，浏览器会报错。
 *
 * @returns {Promise<void>}
 */
export const ensureMermaidPatchedForVditor = async () => {
  const mermaid = await ensureVditorMermaidLoaded();
  if (!mermaid) return;
  if (mermaid.__cloudpastePatchedForVditor === true) return;
  if (typeof mermaid.initialize !== "function") return;

  const originalInitialize = mermaid.initialize.bind(mermaid);

  mermaid.initialize = (config) => {
    try {
      if (config && typeof config === "object") {
        const nextFlowchart = { ...(config.flowchart || {}) };
        // 关键点：只要有人想打开 htmlLabels，就强制关掉（避免 foreignObject）
        if (nextFlowchart.htmlLabels === true) {
          nextFlowchart.htmlLabels = false;
        }
        config = { ...config, flowchart: nextFlowchart };
      }
    } catch {
      // 忽略：补丁失败也不能影响正常渲染
    }
    return originalInitialize(config);
  };

  mermaid.__cloudpastePatchedForVditor = true;
};
