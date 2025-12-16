/**
 * SnapDOM 截图封装
 *
 */

import { saveAs } from "file-saver";

const TEMP_EXPORT_STYLE_ID = "temp-export-style";
const DEFAULT_PASTE_URL_PROXY_PREFIX = "/api/paste/url/proxy";

let cachedPasteUrlProxyTicket = "";
let cachedPasteUrlProxyTicketExpiresAtMs = 0;

const VDITOR_EXPORT_CSS = `
  .vditor-reset {
    padding: 20px !important;
    box-sizing: border-box !important;
  }
  .vditor-reset pre {
    white-space: pre-wrap !important;
    word-break: break-all !important;
    overflow: visible !important;
    background-color: #f6f8fa !important;
    border-radius: 4px !important;
    padding: 12px 16px !important;
    margin: 1em 0 !important;
  }
  .vditor-reset pre code {
    font-family: monospace, Consolas, "Courier New", monospace !important;
    font-size: 13px !important;
    line-height: 1.5 !important;
    white-space: pre-wrap !important;
    tab-size: 4 !important;
    word-break: keep-all !important;
  }
  .vditor-reset img {
    max-width: 100% !important;
    image-rendering: auto !important;
  }
  .vditor-reset table {
    display: table !important;
    width: auto !important;
    max-width: 100% !important;
    overflow: visible !important;
    border-collapse: collapse !important;
    margin: 1em 0 !important;
  }
  .vditor-reset table th,
  .vditor-reset table td {
    border: 1px solid #ddd !important;
    padding: 8px 12px !important;
  }
`;

function isDarkBackground(backgroundColor) {
  if (!backgroundColor) return false;
  const color = String(backgroundColor).toLowerCase();
  return color.includes("#1") || color.includes("#2") || color.includes("#3") || color.includes("dark") || color.includes("black");
}

function ensureTempExportStyle() {
  const existing = document.getElementById(TEMP_EXPORT_STYLE_ID);
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }

  const style = document.createElement("style");
  style.id = TEMP_EXPORT_STYLE_ID;
  style.textContent = VDITOR_EXPORT_CSS;
  document.head.appendChild(style);
}

function cleanupTempExportStyle() {
  const style = document.getElementById(TEMP_EXPORT_STYLE_ID);
  if (style && style.parentNode) {
    style.parentNode.removeChild(style);
  }
}

function markImagesCrossOrigin(root) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  const images = root.querySelectorAll("img");
  images.forEach((img) => {
    if (!img.hasAttribute("crossorigin")) {
      img.setAttribute("crossorigin", "anonymous");
    }
  });
}

function hasCrossOriginImages(root) {
  if (!root || typeof root.querySelectorAll !== "function") return false;

  const images = Array.from(root.querySelectorAll("img")).filter((img) => img instanceof HTMLImageElement);
  if (images.length === 0) return false;

  for (const img of images) {
    const rawSrc = img.getAttribute("src") || img.src || "";
    if (!rawSrc) continue;
    if (rawSrc.startsWith("data:") || rawSrc.startsWith("blob:")) continue;

    try {
      const resolved = new URL(rawSrc, window.location.href);
      if (resolved.origin !== window.location.origin) {
        return true;
      }
    } catch {
      // ignore invalid URLs
    }
  }

  return false;
}

async function resolveShareUrlProxyPrefixIfAllowed() {
  try {
    const { useAuthStore } = await import("@/stores/authStore.js");
    const authStore = useAuthStore();
    if (typeof authStore.initialize === "function") {
      await authStore.initialize();
    }
    if (!authStore.isAuthenticated) return "";
    if (!authStore.hasTextSharePermission) return "";

    // SnapDOM useProxy 的资源请求无法携带 Authorization Header：
    // - 先用“正常 API 请求”（可带 Authorization）换取短期 ticket
    // - 再把 ticket 填到 useProxy 前缀里，供浏览器后续 <img src> 请求携带 query 完成校验
    const now = Date.now();
    if (cachedPasteUrlProxyTicket && now < cachedPasteUrlProxyTicketExpiresAtMs - 10_000) {
      return `${DEFAULT_PASTE_URL_PROXY_PREFIX}?ticket=${encodeURIComponent(cachedPasteUrlProxyTicket)}&url=`;
    }

    const { post } = await import("@/api/client.js");
    const ticketResponse = await post("paste/url/proxy-ticket", {});
    const ticket = ticketResponse?.data?.ticket ? String(ticketResponse.data.ticket) : "";
    if (!ticket) return "";

    cachedPasteUrlProxyTicket = ticket;
    const expiresAtSeconds = ticketResponse?.data?.expiresAt ? Number(ticketResponse.data.expiresAt) : 0;
    cachedPasteUrlProxyTicketExpiresAtMs = expiresAtSeconds > 0 ? expiresAtSeconds * 1000 : now + 5 * 60 * 1000;

    return `${DEFAULT_PASTE_URL_PROXY_PREFIX}?ticket=${encodeURIComponent(ticket)}&url=`;
  } catch {
    return "";
  }
}

function waitTimeout(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

async function waitForDocumentFonts(timeoutMs) {
  try {
    if (!document?.fonts?.ready) return;
    await Promise.race([document.fonts.ready, waitTimeout(timeoutMs)]);
  } catch {
    // 忽略字体等待异常，导出流程继续
  }
}

async function waitForImages(root, timeoutMs) {
  if (!root || typeof root.querySelectorAll !== "function") return;

  const images = Array.from(root.querySelectorAll("img")).filter((img) => img instanceof HTMLImageElement);
  if (images.length === 0) return;

  const decodeOrLoad = (img) => new Promise((resolve) => {
    if (img.complete && img.naturalWidth > 0) {
      resolve();
      return;
    }

    const cleanup = () => {
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
    };
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      resolve();
    };

    img.addEventListener("load", onLoad, { once: true });
    img.addEventListener("error", onError, { once: true });

    if (typeof img.decode === "function") {
      img.decode().then(() => {
        cleanup();
        resolve();
      }).catch(() => {
        // decode 失败仍然尝试等待 load/error
      });
    }
  });

  await Promise.race([
    Promise.all(images.map(decodeOrLoad)),
    waitTimeout(timeoutMs),
  ]);
}

async function blobToDataUrl(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取 Blob 失败"));
    reader.readAsDataURL(blob);
  });
}

function buildSnapdomPngOptions(imageOptions = {}, snapdomOptions = {}) {
  const pixelRatio = typeof imageOptions.pixelRatio === "number" ? imageOptions.pixelRatio : undefined;
  const canvasWidth = typeof imageOptions.canvasWidth === "number" ? imageOptions.canvasWidth : undefined;
  const canvasHeight = typeof imageOptions.canvasHeight === "number" ? imageOptions.canvasHeight : undefined;

  const base = {
    fast: true,
    cache: "soft",
    embedFonts: true,
    placeholders: true,
    outerTransforms: true,
  };

  const options = {
    ...base,
    ...snapdomOptions,
    type: "png",
    // 导出长图时，浏览器 canvas 尺寸上限是最常见失败原因（canvas.toBlob 返回 null）
    // 这里默认把 dpr 固定为 1，保证“尽可能能导出”；清晰度交给 scale 并在内部做安全降级。
    dpr: snapdomOptions.dpr ?? 1,
    scale: snapdomOptions.scale ?? (typeof pixelRatio === "number" ? Math.min(pixelRatio, 2) : 2),
    width: snapdomOptions.width ?? canvasWidth,
    height: snapdomOptions.height ?? canvasHeight,
    backgroundColor: snapdomOptions.backgroundColor ?? imageOptions.backgroundColor ?? "#ffffff",
  };

  if (typeof imageOptions.filter === "function") {
    options.filter = imageOptions.filter;
  }

  if (typeof snapdomOptions.fallbackURL !== "undefined") {
    options.fallbackURL = snapdomOptions.fallbackURL;
  } else if (typeof imageOptions.imagePlaceholder !== "undefined") {
    options.fallbackURL = imageOptions.imagePlaceholder;
  }

  // 跨域资源兜底：仅在资源被 CORS 阻断时才会走 proxy 前缀（同源或允许 CORS 的资源会跳过）
  // 接入后端代理，可传入：snapdomOptions.useProxy = "/api/paste/url/proxy?ticket=<ticket>&url="
  if (typeof snapdomOptions.useProxy !== "undefined") {
    options.useProxy = snapdomOptions.useProxy;
  } else if (typeof imageOptions.useProxy !== "undefined") {
    options.useProxy = imageOptions.useProxy;
  }

  return options;
}

async function elementToPng(element, options = {}) {
  const defaultOptions = {
    filename: "download.png",
    imageOptions: {},
    snapdomOptions: {},
    autoSave: true,
    // 当未显式传 useProxy 时：如果当前为登录态且具备 TEXT_SHARE（文本创建权限），则自动启用 /api/paste/url/proxy（Query Ticket）作为 CORS fallback
    autoUseProxy: false,
    // 可选：严格模式下预热资源，降低“图片/字体没来得及加载导致空白”的概率（会增加导出耗时）
    preCache: false,
    // 可选：等待 document.fonts 收敛（默认开启；超时后继续导出）
    waitForFonts: true,
    // 可选：等待图片 decode/load（默认关闭；超时后继续导出）
    waitForImages: false,
    // waitForFonts/waitForImages/preCache 的最长等待时间
    waitTimeoutMs: 1500,
    beforeCapture: null,
    afterCapture: null,
    onSuccess: null,
    onError: null,
  };

  const mergedOptions = { ...defaultOptions, ...options };
  const {
    filename,
    imageOptions,
    snapdomOptions,
    autoSave,
    autoUseProxy,
    preCache: preCacheEnabled,
    waitForFonts: waitForFontsEnabled,
    waitForImages: waitForImagesEnabled,
    waitTimeoutMs,
    beforeCapture,
    afterCapture,
    onSuccess,
    onError,
  } = mergedOptions;

  let targetElement = null;
  const warnings = [];

  try {
    targetElement = typeof element === "string" ? document.querySelector(element) : element;
    if (!targetElement) {
      throw new Error("目标元素不存在");
    }

    if (typeof beforeCapture === "function") {
      await beforeCapture(targetElement);
    }

    const snapdomModule = await import("@zumer/snapdom");
    const { snapdom, preCache } = snapdomModule;
    const basePngOptions = buildSnapdomPngOptions(imageOptions, snapdomOptions);

    // useProxy 仅在 CORS 阻断时作为 fallback 使用，但你的后端接口有权限校验；
    // 因此：仅在“已登录且有 TEXT_SHARE 权限”时自动开启，匿名/无权限保持关闭，并给出提示。
    const hasExplicitUseProxy = typeof snapdomOptions.useProxy !== "undefined" || typeof imageOptions.useProxy !== "undefined";
    if (!hasExplicitUseProxy && autoUseProxy === true) {
      const prefix = await resolveShareUrlProxyPrefixIfAllowed();
      if (prefix) {
        basePngOptions.useProxy = prefix;
      } else if (hasCrossOriginImages(targetElement)) {
        warnings.push({
          code: "proxy_unavailable",
          message:
            "检测到跨域图片资源，但当前未登录或缺少 TEXT_SHARE 权限，或无法获取 proxy ticket，无法使用 /api/paste/url/proxy；导出将使用占位符或跳过跨域资源。",
        });
      }
    }

    const resolvedWaitTimeoutMs = typeof waitTimeoutMs === "number" && waitTimeoutMs > 0 ? waitTimeoutMs : 1500;
    if (preCacheEnabled && typeof preCache === "function") {
      try {
        await preCache(targetElement, {
          embedFonts: basePngOptions.embedFonts,
          localFonts: basePngOptions.localFonts,
          iconFonts: basePngOptions.iconFonts,
          useProxy: basePngOptions.useProxy,
          cache: basePngOptions.cache,
        });
      } catch (e) {
        // 预热失败不应阻塞导出，直接继续
        console.warn("snapdom preCache 预热失败，将继续导出:", e?.message || e);
      }
    }
    if (waitForFontsEnabled !== false) {
      await waitForDocumentFonts(resolvedWaitTimeoutMs);
    }
    if (waitForImagesEnabled === true) {
      await waitForImages(targetElement, resolvedWaitTimeoutMs);
    }

    // 基于内容尺寸估算可行 scale，避免超长内容触发浏览器 canvas 尺寸上限导致 toBlob 返回 null。
    // 多数浏览器 canvas 单边上限在 16k~32k，这里按 16384 做保守处理。
    const MAX_CANVAS_DIMENSION = 16384;
    const rect = targetElement.getBoundingClientRect();
    const measuredWidth = Math.max(Number(rect.width) || 0, Number(targetElement.scrollWidth) || 0, Number(targetElement.offsetWidth) || 0);
    const measuredHeight = Math.max(Number(rect.height) || 0, Number(targetElement.scrollHeight) || 0, Number(targetElement.offsetHeight) || 0);
    const dpr = typeof basePngOptions.dpr === "number" && basePngOptions.dpr > 0 ? basePngOptions.dpr : 1;
    const maxScaleFromWidth = measuredWidth > 0 ? MAX_CANVAS_DIMENSION / (measuredWidth * dpr) : 1;
    const maxScaleFromHeight = measuredHeight > 0 ? MAX_CANVAS_DIMENSION / (measuredHeight * dpr) : 1;
    const HARD_MAX_SCALE = 4;
    const maxSafeScale = Math.max(0.1, Math.min(maxScaleFromWidth, maxScaleFromHeight, HARD_MAX_SCALE));
    const scaleCandidates = [];
    if (typeof basePngOptions.scale === "number") {
      scaleCandidates.push(basePngOptions.scale);
    }
    // 兜底：如果 canvas 太大导致 toBlob 返回 null，逐级降低 scale 重试
    scaleCandidates.push(2, 1, 0.75, 0.5);
    const uniqueScaleCandidates = Array.from(new Set(scaleCandidates))
      .filter((v) => typeof v === "number" && v > 0)
      .map((v) => Math.min(v, maxSafeScale));

    let blob = null;
    for (const scale of uniqueScaleCandidates) {
      const pngOptions = { ...basePngOptions, scale };
      const candidate = await (typeof snapdom.toBlob === "function"
        ? snapdom.toBlob(targetElement, pngOptions)
        : (async () => {
            const result = await snapdom(targetElement, pngOptions);
            return await result.toBlob();
          })());

      if (candidate instanceof Blob) {
        blob = candidate;
        break;
      }
    }

    if (!(blob instanceof Blob)) {
      throw new TypeError(
        "snapdom.toBlob 未返回 Blob（可能是内容过长导致 Canvas 超出浏览器限制，canvas.toBlob 返回 null）；建议降低清晰度(scale/pixelRatio)或改用分段导出。",
      );
    }

    const dataUrl = await blobToDataUrl(blob);

    if (typeof afterCapture === "function") {
      await afterCapture(targetElement);
    }

    if (autoSave) {
      saveAs(blob, filename);
    }

    if (typeof onSuccess === "function") {
      onSuccess(dataUrl, blob);
    }

    return { success: true, dataUrl, blob, warnings };
  } catch (error) {
    console.error("使用 snapdom 转换HTML为PNG时出错:", error);

    if (typeof onError === "function") {
      onError(error);
    }

    try {
      if (targetElement && typeof options.afterCapture === "function") {
        await options.afterCapture(targetElement);
      }
    } catch (cleanupError) {
      console.warn("snapdom 截图失败后的清理(afterCapture)执行异常:", cleanupError?.message || cleanupError);
    }

    return { success: false, error, warnings };
  }
}

/**
 * 从 Vditor 编辑器获取内容并使用 snapdom 导出 PNG
 * - 优先捕获“已渲染后的预览 DOM”
 */
export async function editorContentToPng(editor, options = {}) {
  if (!editor) {
    return { success: false, error: new Error("编辑器实例不存在") };
  }

  const currentMode = editor.vditor?.currentMode;

  let targetElement = null;
  let tempContainer = null;
  let hiddenParentContainer = null;
  let previewScrollContainer = null;
  let previewScrollContainerStyleBackup = null;

  const originalBeforeCapture = options.beforeCapture;
  const originalAfterCapture = options.afterCapture;
  const imageOptions = options.imageOptions || {};
  const snapdomOptions = options.snapdomOptions || {};
  const backgroundColor = snapdomOptions.backgroundColor ?? imageOptions.backgroundColor;
  const darkModeDetected = isDarkBackground(backgroundColor);

  try {
    const editorContainer = document.getElementById("vditor");

    const canUseDetachedHtml = Boolean(editorContainer && typeof editor.getHTML === "function");
    const preferDetached = options.preferDetached !== false;
    const preferRenderedPreview = options.preferRenderedPreview !== false;

    const livePreviewScrollContainer = editorContainer?.querySelector?.(".vditor-preview") || null;
    const livePreviewRoot = livePreviewScrollContainer?.querySelector?.(".vditor-reset") || null;

    // 优先使用“已渲染的预览 DOM”，图表/脑图等往往依赖运行时渲染
    if (preferRenderedPreview && livePreviewRoot) {
      previewScrollContainer = livePreviewScrollContainer;
      targetElement = livePreviewRoot;
    } else if (preferDetached && canUseDetachedHtml) {
      hiddenParentContainer = document.createElement("div");
      hiddenParentContainer.style.height = "0";
      hiddenParentContainer.style.overflow = "hidden";
      hiddenParentContainer.style.position = "absolute";
      hiddenParentContainer.style.left = "-9999px";
      hiddenParentContainer.style.top = "0";
      hiddenParentContainer.id = "vditor-snapdom-hidden-container";

      tempContainer = document.createElement("div");
      tempContainer.style.maxWidth = "100%";
      tempContainer.style.width = `${editorContainer?.offsetWidth || imageOptions.canvasWidth || 0}px`;
      tempContainer.style.backgroundColor = darkModeDetected ? "#1e1e1e" : "#ffffff";
      tempContainer.style.color = darkModeDetected ? "#d4d4d4" : "#24292e";

      const htmlContainer = document.createElement("div");
      htmlContainer.innerHTML = editor.getHTML();
      htmlContainer.className = "vditor-reset";
      htmlContainer.style.padding = "20px";
      htmlContainer.style.maxWidth = "100%";
      htmlContainer.style.overflow = "visible";
      htmlContainer.style.width = "100%";

      tempContainer.appendChild(htmlContainer);
      hiddenParentContainer.appendChild(tempContainer);
      document.body.appendChild(hiddenParentContainer);

      targetElement = htmlContainer;
    } else {
      if (editorContainer && (currentMode === "preview" || currentMode === "both")) {
        previewScrollContainer = editorContainer.querySelector(".vditor-preview");
        targetElement = previewScrollContainer?.querySelector(".vditor-reset") || previewScrollContainer;
      }

      if (!targetElement) {
        targetElement =
          document.querySelector(".vditor-preview .vditor-reset") ||
          document.querySelector(".vditor-preview") ||
          document.querySelector(".vditor-wysiwyg") ||
          document.querySelector(".vditor-ir") ||
          document.querySelector(".vditor-sv");
      }
    }

    if (!previewScrollContainer) {
      previewScrollContainer = targetElement?.closest?.(".vditor-preview") || null;
    }

    if (!targetElement) {
      throw new Error("无法找到编辑器内容元素");
    }

    const enhancedOptions = {
      ...options,
      beforeCapture: async (el) => {
        ensureTempExportStyle();
        markImagesCrossOrigin(el);
        await new Promise((resolve) => setTimeout(resolve, 200));

        const expandScrollContainer = options.expandScrollContainer === true;
        if (expandScrollContainer && previewScrollContainer && !previewScrollContainerStyleBackup) {
          previewScrollContainerStyleBackup = {
            overflow: previewScrollContainer.style.overflow,
            height: previewScrollContainer.style.height,
            maxHeight: previewScrollContainer.style.maxHeight,
          };
          previewScrollContainer.style.overflow = "visible";
          previewScrollContainer.style.height = "auto";
          previewScrollContainer.style.maxHeight = "none";
        }

        if (typeof originalBeforeCapture === "function") {
          await originalBeforeCapture(el);
        }
      },
      afterCapture: async (el) => {
        if (typeof originalAfterCapture === "function") {
          await originalAfterCapture(el);
        }
        cleanupTempExportStyle();
        if (previewScrollContainer && previewScrollContainerStyleBackup) {
          previewScrollContainer.style.overflow = previewScrollContainerStyleBackup.overflow;
          previewScrollContainer.style.height = previewScrollContainerStyleBackup.height;
          previewScrollContainer.style.maxHeight = previewScrollContainerStyleBackup.maxHeight;
          previewScrollContainerStyleBackup = null;
        }
        if (hiddenParentContainer && document.body.contains(hiddenParentContainer)) {
          document.body.removeChild(hiddenParentContainer);
        } else if (tempContainer && document.body.contains(tempContainer)) {
          document.body.removeChild(tempContainer);
        }
      },
    };

    return await elementToPng(targetElement, enhancedOptions);
  } catch (error) {
    console.error("snapdom 导出PNG过程中发生错误:", error);

    if (hiddenParentContainer && document.body.contains(hiddenParentContainer)) {
      document.body.removeChild(hiddenParentContainer);
    } else if (tempContainer && document.body.contains(tempContainer)) {
      document.body.removeChild(tempContainer);
    }
    cleanupTempExportStyle();

    return { success: false, error };
  }
}
