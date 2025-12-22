import { isNodeReadable, isWebReadableStream } from "./types.js";
import { NotFoundError, AppError, DriverError } from "../../http/errors.js";

/**
 * StorageStreamDescriptor 构造工具
 *
 * - 为各驱动提供统一的 StorageStreamDescriptor 构造方式
 * - 封装 NodeReadable / Web ReadableStream 差异
 * - 简化 AbortSignal / 关闭逻辑
 */

/**
 * 基于本地文件路径构造 Node 流描述（通常用于 LocalStorageDriver）
 * @param {Object} params
 * @param {() => Promise<import("stream").Readable>} params.openStream - 打开 NodeReadable 的工厂函数
 * @param {number|null} params.size
 * @param {string|null} params.contentType
 * @param {string|null} [params.etag]
 * @param {Date|null} [params.lastModified]
 * @returns {import("./types.js").StorageStreamDescriptor}
 */
export function createNodeStreamDescriptor({ openStream, openRangeStream, size, contentType, etag = null, lastModified = null }) {
  return {
    size: typeof size === "number" ? size : null,
    contentType: contentType || null,
    etag: etag || null,
    lastModified: lastModified || null,
    async getStream(options = {}) {
      const { signal } = options;
      const stream = await openStream();

      if (signal) {
        signal.addEventListener("abort", () => {
          try {
            if (stream.destroy) {
              stream.destroy();
            }
          } catch {}
        });
      }

      return {
        stream,
        async close() {
          try {
            if (stream.destroy) {
              stream.destroy();
            }
          } catch {}
        },
      };
    },
    async getRange(range, options = {}) {
      if (typeof openRangeStream !== "function") {
        throw new DriverError("当前驱动未实现原生 Range 读取");
      }

      const { signal } = options;
      const stream = await openRangeStream(range);

      if (signal) {
        signal.addEventListener("abort", () => {
          try {
            if (stream.destroy) {
              stream.destroy();
            }
          } catch {}
        });
      }

      return {
        stream,
        async close() {
          try {
            if (stream.destroy) {
              stream.destroy();
            }
          } catch {}
        },
      };
    },
  };
}

/**
 * 基于 fetch/HTTP 响应构造 Web 流描述（WebDAV/OneDrive/GoogleDrive 等）
 * @param {Object} params
 * @param {() => Promise<Response>} params.fetchResponse - 拉取 Response 的工厂函数
 * @param {number|null} [params.size]
 * @param {string|null} [params.contentType]
 * @param {string|null} [params.etag]
 * @param {Date|null} [params.lastModified]
 * @param {boolean} [params.supportsRange] - 若已知服务器支持 Range，可显式传入
 * @returns {import("./types.js").StorageStreamDescriptor & { supportsRange?: boolean }}
 */
export function createHttpStreamDescriptor({
  fetchResponse,
  fetchRangeResponse,
  fetchHeadResponse,
  size = null,
  contentType = null,
  etag = null,
  lastModified = null,
  supportsRange,
}) {
  let currentSize = typeof size === "number" ? size : null;

  const RETRYABLE_HTTP_STATUS = new Set([429, 500, 502, 503, 504]);

  const isAbortError = (error) => error?.name === "AbortError";

  const sleep = async (ms, signal) => {
    if (!ms || ms <= 0) return;
    if (signal?.aborted) {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      throw abortError;
    }

    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      if (!signal) return;
      const onAbort = () => {
        clearTimeout(timer);
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        reject(abortError);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  };

  const fetchWithRetry = async (label, fn, { signal } = {}) => {
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const resp = await fn();
        const retryable = resp && RETRYABLE_HTTP_STATUS.has(resp.status);

        if (retryable && attempt < maxAttempts) {
          console.warn(`[StreamDescriptorUtils] ${label} HTTP ${resp.status}，将重试 (${attempt}/${maxAttempts})`);
          await sleep(200 * attempt, signal);
          continue;
        }

        return resp;
      } catch (error) {
        if (isAbortError(error) || attempt >= maxAttempts) throw error;
        console.warn(`[StreamDescriptorUtils] ${label} fetch 失败，将重试 (${attempt}/${maxAttempts}):`, error?.message || error);
        await sleep(200 * attempt, signal);
      }
    }

    throw new DriverError(`${label} fetch 失败（重试耗尽）`);
  };

  const tryInferSizeFromResponse = (resp) => {
    if (!resp || !resp.headers) return null;
    const contentRange = resp.headers.get("content-range");
    if (contentRange) {
      const match = String(contentRange).match(/\/(\d+)\s*$/);
      if (match && match[1]) {
        const parsed = Number(match[1]);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }
    }
    const contentLength = resp.headers.get("content-length");
    if (contentLength) {
      const parsed = Number(contentLength);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    return null;
  };

  const descriptor = {
    get size() {
      return currentSize;
    },
    contentType: contentType || null,
    etag: etag || null,
    lastModified: lastModified || null,
    supportsRange,
    async probeSize(options = {}) {
      if (typeof currentSize === "number" && currentSize >= 0) return currentSize;
      if (typeof fetchHeadResponse !== "function") return currentSize;

      const { signal } = options;
      const resp = await fetchWithRetry("HEAD", () => fetchHeadResponse(signal), { signal });
      if (!resp) return currentSize;
      if (!resp.ok) return currentSize;

      const inferred = tryInferSizeFromResponse(resp);
      if (typeof inferred === "number") {
        currentSize = inferred;
      }
      return currentSize;
    },
    async getStream(options = {}) {
      const { signal } = options;
      const resp = await fetchWithRetry("GET", () => fetchResponse(signal), { signal });

      if (!resp.ok) {
        if (resp.status === 404) {
          throw new NotFoundError("文件不存在");
        }
        throw new DriverError(`下载失败: HTTP ${resp.status}`);
      }

      if (currentSize === null) {
        const inferred = tryInferSizeFromResponse(resp);
        if (typeof inferred === "number") currentSize = inferred;
      }

      const stream = resp.body;

      return {
        stream,
        async close() {
          if (stream && typeof stream.cancel === "function") {
            try {
              await stream.cancel();
            } catch {}
          }
        },
      };
    },
  };

  // 仅当上游提供了 Range 拉取函数时，才暴露 getRange
  // - 避免调用方误判“支持 getRange”，导致 Range 请求抛错而不是回退软件切片
  if (typeof fetchRangeResponse === "function") {
    descriptor.getRange = async (range, options = {}) => {
      const { signal } = options;
      const rangeHeader = `bytes=${range.start}-${range.end}`;
      const resp = await fetchWithRetry("GET(Range)", () => fetchRangeResponse(signal, rangeHeader, range), { signal });

      if (!resp.ok) {
        if (resp.status === 404) {
          throw new NotFoundError("文件不存在");
        }
        throw new DriverError(`下载失败: HTTP ${resp.status}`);
      }

      if (currentSize === null) {
        const inferred = tryInferSizeFromResponse(resp);
        if (typeof inferred === "number") currentSize = inferred;
      }

      const stream = resp.body;
      const isPartial = resp.status === 206 && !!resp.headers.get("content-range");

      return {
        stream,
        supportsRange: isPartial,
        async close() {
          if (stream && typeof stream.cancel === "function") {
            try {
              await stream.cancel();
            } catch {}
          }
        },
      };
    };
  }

  return descriptor;
}

/**
 * 基于 Web ReadableStream 构造流描述（GoogleDrive/OneDrive 等）
 * @param {Object} params
 * @param {(signal?: AbortSignal) => Promise<ReadableStream<Uint8Array>>} params.openStream
 * @param {number|null} [params.size]
 * @param {string|null} [params.contentType]
 * @param {string|null} [params.etag]
 * @param {Date|null} [params.lastModified]
 * @returns {import("./types.js").StorageStreamDescriptor}
 */
export function createWebStreamDescriptor({ openStream, size = null, contentType = null, etag = null, lastModified = null }) {
  return {
    size: typeof size === "number" ? size : null,
    contentType: contentType || null,
    etag: etag || null,
    lastModified: lastModified || null,
    async getStream(options = {}) {
      const { signal } = options;
      const stream = await openStream(signal);

      return {
        stream,
        async close() {
          if (stream && stream.locked === false && typeof stream.cancel === "function") {
            try {
              await stream.cancel();
            } catch {}
          }
        },
      };
    },
  };
}

/**
 * 从已知的底层流构造通用 StorageStreamDescriptor
 * - 适用于 provider SDK 已经返回 NodeReadable 或 Web ReadableStream 的场景
 * @param {Object} params
 * @param {import('stream').Readable|ReadableStream<Uint8Array>} params.stream
 * @param {number|null} [params.size]
 * @param {string|null} [params.contentType]
 * @param {string|null} [params.etag]
 * @param {Date|null} [params.lastModified]
 * @returns {import("./types.js").StorageStreamDescriptor}
 */
export function createGenericStreamDescriptor({ stream, size = null, contentType = null, etag = null, lastModified = null }) {
  const isNode = isNodeReadable(stream);
  const isWeb = !isNode && isWebReadableStream(stream);

  return {
    size: typeof size === "number" ? size : null,
    contentType: contentType || null,
    etag: etag || null,
    lastModified: lastModified || null,
    async getStream() {
      return {
        stream,
        async close() {
          try {
            if (isNode && stream.destroy) {
              stream.destroy();
            } else if (isWeb && typeof stream.cancel === "function") {
              await stream.cancel();
            }
          } catch {}
        },
      };
    },
  };
}

export default {
  createNodeStreamDescriptor,
  createHttpStreamDescriptor,
  createGenericStreamDescriptor,
};
