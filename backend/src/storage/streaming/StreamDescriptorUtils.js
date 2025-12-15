import { isNodeReadable, isWebReadableStream } from "./types.js";
import { NotFoundError, AppError, DriverError } from "../../http/errors.js";

/**
 * StorageStreamDescriptor 构造工具
 *
 * 目标：
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
export function createNodeStreamDescriptor({
  openStream,
  openRangeStream,
  size,
  contentType,
  etag = null,
  lastModified = null,
}) {
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
  size = null,
  contentType = null,
  etag = null,
  lastModified = null,
  supportsRange,
}) {
  return {
    size: typeof size === "number" ? size : null,
    contentType: contentType || null,
    etag: etag || null,
    lastModified: lastModified || null,
    supportsRange,
    async getStream(options = {}) {
      const { signal } = options;
      const resp = await fetchResponse(signal);

      if (!resp.ok) {
        if (resp.status === 404) {
          throw new NotFoundError("文件不存在");
        }
        throw new DriverError(`下载失败: HTTP ${resp.status}`);
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
export function createWebStreamDescriptor({
  openStream,
  size = null,
  contentType = null,
  etag = null,
  lastModified = null,
}) {
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
