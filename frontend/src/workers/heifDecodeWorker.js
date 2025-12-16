/**
 * HEIC/HEIF 解码 Worker
 * - 使用 libheif-js/wasm-bundle
 * - 通过 OffscreenCanvas 生成 Blob
 */

import libheifModule from "libheif-js/wasm-bundle";

// 统一 default interop（兼容不同打包/导出形态）
const libheif = libheifModule?.default ?? libheifModule;

/** @type {Map<string, AbortController>} */
const abortControllers = new Map();

const ensureOffscreenCanvas = () => {
  if (typeof OffscreenCanvas === "undefined") {
    const err = new Error("当前环境不支持 OffscreenCanvas");
    // 用 code 便于主线程做降级策略
    err.code = "OFFSCREENCANVAS_UNSUPPORTED";
    throw err;
  }
};

/** @param {ImageData} imageData */
const imageDataToBlob = async (imageData, { outputType, quality }) => {
  ensureOffscreenCanvas();

  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const err = new Error("OffscreenCanvas 2D 上下文不可用");
    err.code = "OFFSCREENCANVAS_CONTEXT_UNAVAILABLE";
    throw err;
  }

  ctx.putImageData(imageData, 0, 0);

  if (typeof canvas.convertToBlob !== "function") {
    const err = new Error("OffscreenCanvas.convertToBlob 不可用");
    err.code = "OFFSCREENCANVAS_CONVERT_TO_BLOB_UNSUPPORTED";
    throw err;
  }

  const requestedType = outputType || "image/png";
  const requestedQuality = typeof quality === "number" ? quality : undefined;

  try {
    return await canvas.convertToBlob({
      type: requestedType,
      quality: requestedQuality,
    });
  } catch (e) {
    // 兼容性兜底：部分环境对 OffscreenCanvas 的 WebP/AVIF 等支持不稳定，降级 JPEG
    if (requestedType !== "image/jpeg" && requestedType !== "image/png") {
      return canvas.convertToBlob({
        type: "image/jpeg",
        quality: requestedQuality ?? 0.9,
      });
    }
    throw e;
  }
};

const decodeHeifToBlob = async ({ id, url, outputType, quality }) => {
  const controller = new AbortController();
  abortControllers.set(id, controller);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`获取 HEIC/HEIF 数据失败: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();

    const decoder = new libheif.HeifDecoder();
    const images = decoder.decode(new Uint8Array(arrayBuffer));
    const image = Array.isArray(images) && images.length > 0 ? images[0] : null;
    if (!image) {
      throw new Error("HEIC/HEIF 解码失败：未获取到图像帧");
    }

    const width = image.get_width();
    const height = image.get_height();

    // Worker 环境通常可直接创建 ImageData
    const imageData = new ImageData(width, height);

    await new Promise((resolve, reject) => {
      image.display(imageData, (displayData) => {
        if (!displayData) {
          reject(new Error("HEIC/HEIF 处理失败（display 返回空）"));
          return;
        }
        resolve();
      });
    });

    // 尽量释放底层资源
    try {
      if (typeof image.free === "function") image.free();
      if (typeof decoder.free === "function") decoder.free();
    } catch {
      // 忽略释放失败
    }

    const blob = await imageDataToBlob(imageData, { outputType, quality });

    return { blob, width, height };
  } finally {
    abortControllers.delete(id);
  }
};

self.addEventListener("message", async (event) => {
  const data = event?.data || {};
  const { type = "decode", id } = data;
  if (!id) return;

  if (type === "abort") {
    const controller = abortControllers.get(id);
    controller?.abort();
    abortControllers.delete(id);
    return;
  }

  try {
    const { url, outputType, quality } = data;
    const result = await decodeHeifToBlob({ id, url, outputType, quality });
    self.postMessage({ id, ok: true, ...result });
  } catch (e) {
    const name = e?.name || "Error";
    const message = e?.message || String(e);
    const code = e?.code || undefined;
    self.postMessage({ id, ok: false, error: { name, message, code } });
  }
});
