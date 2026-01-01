/**
 * 计算 SHA-256（输出 hex 字符串）
 *
 *   1) 小文件：优先用 WebCrypto（crypto.subtle.digest）
 *   2) 大文件：用 WebWorker + hash-wasm 做增量 update（不把整文件读进内存，也不阻塞 UI）
 *
 */

import { createLogger } from "@/utils/logger.js";

const DEFAULT_MAX_WEBCRYPTO_SIZE = 10_000_000;
const log = createLogger("sha256");

/**
 * ArrayBuffer -> hex
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function bufferToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * 小文件：用 WebCrypto 一次性 digest
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
async function sha256HexViaWebCrypto(blob) {
  if (typeof crypto === "undefined" || !crypto.subtle || typeof crypto.subtle.digest !== "function") {
    throw new Error("sha256HexFromBlob: 当前环境不支持 WebCrypto（crypto.subtle）");
  }
  const ab = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", ab);
  return bufferToHex(digest);
}

/**
 * 大文件：优先用 Worker 计算
 * @param {Blob} blob
 * @param {{ onProgress?: (progress:number)=>void }} [options]
 * @returns {Promise<string>}
 */
async function sha256HexViaWorker(blob, options = {}) {
  if (typeof Worker === "undefined") {
    throw new Error("sha256HexFromBlob: 当前环境不支持 WebWorker");
  }

  const worker = new Worker(new URL("./sha256.worker.js", import.meta.url), { type: "module" });

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      try {
        worker.terminate();
      } catch {}
    };

    worker.addEventListener("message", (event) => {
      const data = event?.data || {};
      if (typeof data.progress === "number") {
        try {
          options.onProgress?.(data.progress);
        } catch {}
      }
      if (data.sha256) {
        cleanup();
        resolve(String(data.sha256));
        return;
      }
      if (data.error) {
        cleanup();
        reject(new Error(String(data.error)));
      }
    });

    worker.addEventListener("error", (event) => {
      cleanup();
      reject(event?.error || new Error("sha256 worker: unknown error"));
    });

    // 直接把 Blob 传给 worker，worker 里用 stream 分块读取
    worker.postMessage({ file: blob });
  });
}

/**
 * 计算 Blob/File 的 sha256（hex 小写）
 * @param {Blob} blob
 * @param {Object} [options]
 * @param {number} [options.maxWebCryptoSize] 小文件阈值（默认 10MB）
 * @param {boolean} [options.useWebWorker] 是否优先用 Worker（默认 true）
 * @param {(progress:number)=>void} [options.onProgress] 进度回调（0~1）
 * @returns {Promise<string>}
 */
export async function sha256HexFromBlob(blob, options = {}) {
  if (!blob || typeof blob.arrayBuffer !== "function") {
    throw new Error("sha256HexFromBlob: blob 无效");
  }

  const maxWebCryptoSize =
    typeof options.maxWebCryptoSize === "number" && Number.isFinite(options.maxWebCryptoSize)
      ? options.maxWebCryptoSize
      : DEFAULT_MAX_WEBCRYPTO_SIZE;

  const useWebWorker = options.useWebWorker !== false;

  // 1) 小文件直接 WebCrypto
  if (blob.size < maxWebCryptoSize) {
    log.debug(`WebCrypto(全量) size=${blob.size} < ${maxWebCryptoSize}`);
    return sha256HexViaWebCrypto(blob);
  }

  // 2) 大文件优先 Worker
  if (useWebWorker) {
    try {
      log.debug(`Worker+hash-wasm(流式分块) size=${blob.size} >= ${maxWebCryptoSize}`);
      return await sha256HexViaWorker(blob, { onProgress: options.onProgress });
    } catch (err) {
      // Worker/wasm/CSP 失败时兜底到 WebCrypto
      log.warn("[sha256] Worker 计算失败，将回退到 WebCrypto：", err);
    }
  }

  // 3) 兜底：WebCrypto
  log.debug(`fallback WebCrypto(全量) size=${blob.size}`);
  return sha256HexViaWebCrypto(blob);
}
