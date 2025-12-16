/**
 * 图片预览解码工具（前端）
 *
 */

import { getExtension } from "@/utils/fileTypes.js";

/** @type {Promise<any>|null} */
let libheifModulePromise = null;

async function loadLibheif() {
  if (!libheifModulePromise) {
    libheifModulePromise = import("libheif-js/wasm-bundle");
  }
  const mod = await libheifModulePromise;
  return mod?.default ?? mod;
}

const createAbortError = () => {
  // DOMException 在部分环境可能不可用
  try {
    return new DOMException("Aborted", "AbortError");
  } catch {
    const err = new Error("Aborted");
    err.name = "AbortError";
    return err;
  }
};

const createSemaphore = (max) => {
  let active = 0;
  /** @type {Array<() => void>} */
  const queue = [];

  const acquire = () => {
    if (active < max) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve)).then(() => {
      active += 1;
    });
  };

  const release = () => {
    active = Math.max(0, active - 1);
    const next = queue.shift();
    if (next) next();
  };

  const run = async (fn) => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };

  return { run };
};

// HEIC/HEIF 解码：
// - 解码在 Worker 内执行，主线程不会被阻塞
// 默认值取 2
const HEIF_DECODE_WORKER_POOL_SIZE = 2;
const heifDecodeSemaphore = createSemaphore(HEIF_DECODE_WORKER_POOL_SIZE);

/** @type {Worker[]|null} */
let heifDecodeWorkers = null;
/** @type {Array<Map<string, { resolve: Function, reject: Function }>>} */
let heifWorkerPendingByIndex = [];
/** @type {Map<string, number>} */
const heifWorkerIndexById = new Map();
let heifWorkerRoundRobin = 0;

const createHeifWorker = (index) => {
  const worker = new Worker(new URL("../workers/heifDecodeWorker.js", import.meta.url), { type: "module" });

  worker.addEventListener("message", (event) => {
    const data = event?.data || {};
    const { id, ok } = data;
    if (!id) return;
    const pendingMap = heifWorkerPendingByIndex[index];
    const pending = pendingMap?.get(id);
    if (!pending) return;
    pendingMap.delete(id);
    heifWorkerIndexById.delete(id);
    if (ok) {
      pending.resolve(data);
    } else {
      const err = new Error(data?.error?.message || "HEIF Worker 解码失败");
      err.name = data?.error?.name || "Error";
      err.code = data?.error?.code;
      pending.reject(err);
    }
  });

  worker.addEventListener("error", (e) => {
    // 单 worker 崩溃：拒绝当前 worker 下全部 pending，并允许后续重建
    const pendingMap = heifWorkerPendingByIndex[index];
    if (pendingMap) {
      pendingMap.forEach(({ reject }, id) => {
        heifWorkerIndexById.delete(id);
        reject(e);
      });
      pendingMap.clear();
    }
    try {
      worker.terminate();
    } catch {
      // ignore
    }
    if (heifDecodeWorkers) {
      heifDecodeWorkers[index] = null;
    }
  });

  return worker;
};

const getHeifDecodeWorkers = () => {
  if (typeof Worker === "undefined") return null;
  if (heifDecodeWorkers && heifDecodeWorkers.length === HEIF_DECODE_WORKER_POOL_SIZE) return heifDecodeWorkers;

  heifDecodeWorkers = new Array(HEIF_DECODE_WORKER_POOL_SIZE);
  heifWorkerPendingByIndex = new Array(HEIF_DECODE_WORKER_POOL_SIZE).fill(null).map(() => new Map());

  for (let i = 0; i < HEIF_DECODE_WORKER_POOL_SIZE; i += 1) {
    heifDecodeWorkers[i] = createHeifWorker(i);
  }

  return heifDecodeWorkers;
};

const pickHeifWorkerIndex = () => {
  const index = heifWorkerRoundRobin % HEIF_DECODE_WORKER_POOL_SIZE;
  heifWorkerRoundRobin += 1;
  return index;
};

const decodeHeifToObjectUrlViaWorker = async ({ url, signal, outputType, quality } = {}) => {
  const workers = getHeifDecodeWorkers();
  if (!workers) {
    const err = new Error("Worker 不可用");
    err.code = "WORKER_UNAVAILABLE";
    throw err;
  }

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const index = pickHeifWorkerIndex();
  const worker = workers[index] || (workers[index] = createHeifWorker(index));

  const abortHandler = () => {
    try {
      worker.postMessage({ type: "abort", id });
    } catch {
      // ignore
    }
    const pendingMap = heifWorkerPendingByIndex[index];
    const pending = pendingMap?.get(id);
    if (!pending) return;
    pendingMap.delete(id);
    heifWorkerIndexById.delete(id);
    pending.reject(createAbortError());
  };

  if (signal?.aborted) {
    throw createAbortError();
  }

  return new Promise((resolve, reject) => {
    heifWorkerIndexById.set(id, index);
    heifWorkerPendingByIndex[index].set(id, { resolve, reject });
    if (signal) signal.addEventListener("abort", abortHandler, { once: true });
    try {
      worker.postMessage({ type: "decode", id, url, outputType, quality });
    } catch (e) {
      heifWorkerIndexById.delete(id);
      heifWorkerPendingByIndex[index].delete(id);
      reject(e);
    }
  }).finally(() => {
    if (signal) {
      try {
        signal.removeEventListener("abort", abortHandler);
      } catch {
        // ignore
      }
    }
  });
};

/**
 * 判断是否为 HEIC/HEIF 图片
 * @param {{ filename?: string; mimetype?: string }} input
 */
export function isHeifImage({ filename = "", mimetype = "" } = {}) {
  const ext = getExtension(filename);
  if (ext === "heic" || ext === "heif") return true;
  if (typeof mimetype === "string" && mimetype.toLowerCase().includes("heic")) return true;
  if (typeof mimetype === "string" && mimetype.toLowerCase().includes("heif")) return true;
  return false;
}

/**
 * 判断是否为 AVIF 图片
 * @param {{ filename?: string; mimetype?: string }} input
 */
export function isAvifImage({ filename = "", mimetype = "" } = {}) {
  const ext = getExtension(filename);
  if (ext === "avif") return true;
  if (typeof mimetype === "string" && mimetype.toLowerCase().includes("avif")) return true;
  return false;
}

/**
 * 是否应该尝试做“图片预览解码”
 * @param {{ filename?: string; mimetype?: string }} input
 */
export function shouldAttemptDecodeImagePreview({ filename = "", mimetype = "" } = {}) {
  // 仅对 HEIC/HEIF 做前端 wasm 解码：
  return isHeifImage({ filename, mimetype });
}

/**
 * @typedef {Object} DecodedPreview
 * @property {string} objectUrl
 * @property {number} width
 * @property {number} height
 */

/**
 * 将 HEIC/HEIF/AVIF 的预览 URL 解码为图片 objectURL
 *
 * @param {{ url: string; filename?: string; mimetype?: string; signal?: AbortSignal; outputType?: string; quality?: number }} input
 * @returns {Promise<DecodedPreview>}
 */
export async function decodeImagePreviewUrlToObjectUrl({ url, filename = "", mimetype = "", signal, outputType = "image/png", quality } = {}) {
  if (!url) {
    throw new Error("缺少图片预览 URL，无法解码");
  }

  if (isHeifImage({ filename, mimetype })) {
    return decodeHeifToObjectUrl({ url, signal, outputType, quality });
  }

  if (isAvifImage({ filename, mimetype })) {
    throw new Error("当前前端解码器不支持 AVIF（请走浏览器原生渲染路径）");
  }

  throw new Error(`不支持的解码格式: ${filename || mimetype || "unknown"}`);
}

/**
 * 兼容旧调用：默认输出 PNG
 * @param {{ url: string; filename?: string; mimetype?: string; signal?: AbortSignal }} input
 */
export async function decodeImagePreviewUrlToPngObjectUrl({ url, filename = "", mimetype = "", signal } = {}) {
  return decodeImagePreviewUrlToObjectUrl({ url, filename, mimetype, signal, outputType: "image/png" });
}

/**
 * 解码 HEIC/HEIF 为图片 objectURL
 * - 优先使用 Worker + OffscreenCanvas
 * - Worker 不可用时降级到主线程解码
 *
 * @param {{ url: string; signal?: AbortSignal; outputType?: string; quality?: number }} input
 * @returns {Promise<DecodedPreview>}
 */
export async function decodeHeifToObjectUrl({ url, signal, outputType = "image/png", quality } = {}) {
  return heifDecodeSemaphore.run(async () => {
    if (signal?.aborted) throw createAbortError();

    // 优先走 Worker
    try {
      const data = await decodeHeifToObjectUrlViaWorker({ url, signal, outputType, quality });
      const blob = data?.blob;
      if (!blob) {
        throw new Error("HEIF Worker 返回数据缺失（blob）");
      }
      const objectUrl = URL.createObjectURL(blob);
      return { objectUrl, width: data.width, height: data.height };
    } catch (e) {
      // Abort 直接抛出
      if (e?.name === "AbortError") throw e;
      // OffscreenCanvas/Worker 不支持等场景：降级主线程
      return decodeHeifToPngObjectUrlMainThread({ url, signal, outputType, quality });
    }
  });
}

/**
 * 主线程降级解码（保留旧逻辑）
 * @param {{ url: string; signal?: AbortSignal; outputType?: string; quality?: number }} input
 */
async function decodeHeifToPngObjectUrlMainThread({ url, signal, outputType = "image/png", quality } = {}) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`获取 HEIC/HEIF 数据失败: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();

  // 同时兼容 CJS/ESM 的 default interop
  const libheif = await loadLibheif();

  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(new Uint8Array(arrayBuffer));
  const image = Array.isArray(images) && images.length > 0 ? images[0] : null;
  if (!image) {
    throw new Error("HEIC/HEIF 解码失败：未获取到图像帧");
  }

  const width = image.get_width();
  const height = image.get_height();

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D 上下文不可用");
  }

  const imageData = ctx.createImageData(width, height);
  await new Promise((resolve, reject) => {
    image.display(imageData, (displayData) => {
      if (!displayData) {
        reject(new Error("HEIC/HEIF 处理失败（display 返回空）"));
        return;
      }
      resolve();
    });
  });

  ctx.putImageData(imageData, 0, 0);

  // 尽量释放底层资源（若 API 存在）
  try {
    if (typeof image.free === "function") image.free();
    if (typeof decoder.free === "function") decoder.free();
  } catch {
    // 忽略释放失败（不影响结果）
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) {
          reject(new Error("Canvas 转换 PNG 失败（toBlob 返回空）"));
          return;
        }
        resolve(b);
      },
      outputType,
      typeof quality === "number" ? quality : 1,
    );
  });

  const objectUrl = URL.createObjectURL(blob);
  return { objectUrl, width, height };
}

/**
 * 释放 objectURL（工具函数）
 * @param {string|null|undefined} objectUrl
 */
export function revokeObjectUrl(objectUrl) {
  if (!objectUrl) return;
  if (typeof objectUrl !== "string") return;
  if (!objectUrl.startsWith("blob:")) return;
  URL.revokeObjectURL(objectUrl);
}
