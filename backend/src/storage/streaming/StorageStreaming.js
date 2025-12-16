/**
 * StorageStreaming - 统一的存储内容访问层
 *
 * - 作为所有内容访问路径的唯一入口（FS/WebDAV/Proxy/Share/Object/Preview）
 * - 调用驱动获取 StorageStreamDescriptor
 * - 处理 Range/条件请求
 * - 返回 RangeReader 供协议层构造 HTTP 响应
 * - 驱动层不再构造 HTTP Response
 * - Node/Worker 运行时差异在此层处理
 * - 统一的错误映射和日志
 */

import { parseRangeHeader, evaluateConditionalHeaders, buildResponseHeaders, mapDriverErrorToHttpStatus } from "./utils.js";
import { STREAMING_CHANNELS } from "./types.js";
import { NotFoundError, DriverError } from "../../http/errors.js";
import { ApiStatus } from "../../constants/index.js";
import { smartWrapStreamWithByteSlice } from "./ByteSliceStream.js";

/**
 * @typedef {import('./types.js').StorageStreamDescriptor} StorageStreamDescriptor
 * @typedef {import('./types.js').RangeReader} RangeReader
 * @typedef {import('./types.js').RangeReaderOptions} RangeReaderOptions
 * @typedef {import('./types.js').StreamHandle} StreamHandle
 */

export class StorageStreaming {
  /**
   * @param {Object} options
   * @param {Object} options.mountManager - MountManager 实例
   * @param {Object} options.storageFactory - StorageFactory 类
   * @param {string} options.encryptionSecret - 加密密钥
   */
  constructor({ mountManager, storageFactory, encryptionSecret }) {
    this.mountManager = mountManager;
    this.storageFactory = storageFactory;
    this.encryptionSecret = encryptionSecret;
  }

  /**
   * 获取 RangeReader（主入口）
   * @param {RangeReaderOptions} options
   * @returns {Promise<RangeReader>}
   */
  async getRangeReader(options) {
    const { path, channel, mount, storageConfigId, rangeHeader, request, userIdOrInfo, userType, db } = options;

    const logPrefix = `[StorageStreaming][${channel}]`;
    console.log(`${logPrefix} 开始处理: ${path}`);

    try {
      // 1. 解析路径到驱动
      const { driver, resolvedMount, subPath } = await this._resolveDriver(options);

      // 2. 获取 StorageStreamDescriptor
      const downloadResult = await driver.downloadFile(path, {
        mount: resolvedMount,
        subPath,
        db,
        request,
        userIdOrInfo,
        userType,
      });

      // 验证返回结构
      /** @type {StorageStreamDescriptor} */
      const descriptor = this._adaptToDescriptor(downloadResult);

      // 3. 评估条件请求
      const { shouldReturn304, shouldReturn412 } = evaluateConditionalHeaders(request, descriptor.etag, descriptor.lastModified);

      if (shouldReturn304) {
        console.log(`${logPrefix} 返回 304 Not Modified`);
        return this._create304Reader(descriptor, channel);
      }

      if (shouldReturn412) {
        console.log(`${logPrefix} 返回 412 Precondition Failed`);
        return this._create412Reader(descriptor, channel);
      }

      // 解析 Range 请求
      // Range 场景：若文件大小未知但描述符提供 probeSize，则优先探测 size 后再解析 Range
      if (rangeHeader && (descriptor.size === null || descriptor.size <= 0) && typeof descriptor.probeSize === "function") {
        try {
          // 不将探测失败视为致命错误，失败则回退为 200 全量响应
          await descriptor.probeSize({ signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
        } catch (e) {
          console.warn(`${logPrefix} Range size 探测失败，将回退为 200: ${e?.message || String(e)}`);
        }
      }

      const range = parseRangeHeader(rangeHeader, descriptor.size);

      // 文件大小未知（例如 WebDAV HEAD 未返回 Content-Length）时，
      // 无法构造符合规范的 206/416（缺少 Content-Range），统一降级为 200 全量响应。
      if (range && range.unknownSize) {
        console.log(`${logPrefix} 文件大小未知，忽略 Range，返回 200 OK: ${range.start}-${range.end}`);
        return this._create200Reader(descriptor, channel);
      }

      if (range && !range.isValid) {
        console.log(`${logPrefix} Range 格式无效`);
        return this._create200Reader(descriptor, channel);
      }

      if (range && !range.isSatisfiable) {
        console.log(`${logPrefix} 返回 416 Range Not Satisfiable`);
        return this._create416Reader(descriptor, channel);
      }

      if (range && range.isSatisfiable) {
        console.log(`${logPrefix} 返回 206 Partial Content: ${range.start}-${range.end}`);
        return this._create206Reader(descriptor, range, channel);
      }

      // 5. 正常 200 响应
      console.log(`${logPrefix} 返回 200 OK`);
      return this._create200Reader(descriptor, channel);
    } catch (error) {
      console.error(`${logPrefix} 错误:`, error?.message || error);
      throw error;
    }
  }

  /**
   * 便捷方法：直接构造 HTTP Response
   * @param {RangeReaderOptions} options
   * @returns {Promise<Response>}
   */
  async createResponse(options) {
    try {
      const reader = await this.getRangeReader(options);
      const { status, headers } = reader;

      // 304/412 无响应体
      if (status === 304 || status === 412 || status === 416) {
        return new Response(null, { status, headers });
      }

      const handle = await reader.getBody();
      if (!handle) {
        return new Response(null, { status, headers });
      }

      const { stream } = handle;

      // 对于 WebReadableStream（有 getReader 方法），直接作为 Response body 交给运行时处理
      if (stream && typeof stream.getReader === "function") {
        return new Response(stream, { status, headers });
      }

      // 对于 Node Readable（本地存储等场景），在 Node 环境存在 WebStreams 桥接 bug，
      // 这里采用一次性缓冲到内存的方式构造 Response，避免 ReadableStream 已关闭异常。
      if (stream && typeof stream[Symbol.asyncIterator] === "function") {
        const chunks = [];
        for await (const chunk of stream) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        const body = Buffer.concat(chunks);
        return new Response(body, { status, headers });
      }

      // 兜底：未知类型，直接交给 Response 处理
      return new Response(stream, { status, headers });
    } catch (error) {
      // 统一将驱动/流层错误映射为标准 HTTP 响应，便于前端获取 code/message
      const { status, message } = mapDriverErrorToHttpStatus(error);
      const code = error?.code || "STREAMING_ERROR";

      const body = JSON.stringify({
        success: false,
        code,
        message,
      });

      const headers = new Headers();
      headers.set("Content-Type", "application/json; charset=utf-8");

      return new Response(body, { status, headers });
    }
  }

  /**
   * 验证驱动返回的 StorageStreamDescriptor 结构
   * @param {any} result - 驱动返回的结果
   * @returns {import('./types.js').StorageStreamDescriptor}
   * @private
   */
  _adaptToDescriptor(result) {
    // 验证是否为有效的 StorageStreamDescriptor
    if (typeof result?.getStream === "function") {
      return result;
    }

    // 无法识别的结构，抛出错误
    throw new DriverError("驱动返回了无效的 StorageStreamDescriptor 结构，缺少 getStream 方法", {
      status: ApiStatus.INTERNAL_ERROR,
      code: "STREAMING_ERROR.INVALID_DOWNLOAD_RESULT",
    });
  }

  /**
   * 解析路径到驱动
   * @private
   */
  async _resolveDriver(options) {
    const { path, mount, storageConfigId, userIdOrInfo, userType, db, repositoryFactory } = options;

    // 如果提供了 storageConfigId，通过存储配置创建驱动（存储路径模式）
    if (storageConfigId && db) {
      // 获取存储配置
      const storageConfigRepo = repositoryFactory?.getStorageConfigRepository?.();
      let storageConfig = null;

      if (storageConfigRepo?.findByIdWithSecrets) {
        storageConfig = await storageConfigRepo.findByIdWithSecrets(storageConfigId);
      } else if (storageConfigRepo?.findById) {
        storageConfig = await storageConfigRepo.findById(storageConfigId);
      }

      if (!storageConfig) {
        throw new NotFoundError("存储配置不存在");
      }

      if (!storageConfig.storage_type) {
        throw new DriverError("存储配置缺少 storage_type", {
          status: ApiStatus.INTERNAL_ERROR,
          code: "STREAMING_ERROR.INVALID_CONFIG",
        });
      }

      // 使用 StorageFactory 创建驱动
      const { StorageFactory } = await import("../factory/StorageFactory.js");
      const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, this.encryptionSecret);
      return { driver, resolvedMount: null, subPath: path };
    }

    // 否则通过 MountManager 解析（FS 路径模式）
    if (this.mountManager) {
      const { driver, mount: resolvedMount, subPath } = await this.mountManager.getDriverByPath(path, userIdOrInfo, userType);
      return { driver, resolvedMount, subPath };
    }

    throw new DriverError("无法解析存储路径：缺少 mountManager 或 storageConfigId", {
      status: ApiStatus.INTERNAL_ERROR,
      code: "STREAMING_ERROR.NO_RESOLVER",
    });
  }

  /**
   * 创建 200 OK RangeReader
   * @private
   */
  _create200Reader(descriptor, channel) {
    const headers = buildResponseHeaders(descriptor, null, channel);
    let streamHandle = null;
    let closed = false;

    return {
      status: 200,
      headers,
      async getBody() {
        if (closed) return null;
        streamHandle = await descriptor.getStream();
        return streamHandle;
      },
      async close() {
        if (closed) return;
        closed = true;
        if (streamHandle) {
          await streamHandle.close();
        }
      },
    };
  }

  /**
   * 创建 206 Partial Content RangeReader
   *
   * 核心逻辑：
   * 1. 优先使用驱动原生 getRange 方法
   * 2. 检测驱动是否真正返回了部分内容（supportsRange 标记）
   * 3. 如果驱动返回完整流（200 而非 206），使用 ByteSliceStream 进行软件切片
   * 4. 如果驱动不支持 getRange，直接使用 ByteSliceStream 包装完整流
   *
   * @private
   */
  _create206Reader(descriptor, range, channel) {
    let streamHandle = null;
    let closed = false;
    const { start, end } = range;

    // 这里 range 已由 parseRangeHeader 基于 descriptor.size 解析并校验，
    // start/end 均为有限整数且在文件范围内，可直接用于构造响应头与字节切片。
    const headers = buildResponseHeaders(descriptor, range, channel);

    return {
      status: 206,
      headers,
      async getBody() {
        if (closed) return null;

        // 优先使用驱动原生 Range 支持
        if (typeof descriptor.getRange === "function") {
          streamHandle = await descriptor.getRange(range);

          // 关键检测：驱动是否真正支持 Range 请求
          // 部分 WebDAV 服务器会忽略 Range 头，返回完整内容
          const supportsRange = streamHandle.supportsRange !== false;

          if (!supportsRange) {
            // 驱动返回了完整流（200），需要在此层进行软件字节切片
            console.log(
              `[StorageStreaming] 检测到驱动不支持 Range，使用 ByteSliceStream 切片: ${start}-${end}`,
            );

            const originalStream = streamHandle.stream;
            const originalClose = streamHandle.close;

            // 使用 ByteSliceStream 包装
            const slicedStream = smartWrapStreamWithByteSlice(originalStream, start, end);

            return {
              stream: slicedStream,
              async close() {
                // 关闭原始流
                if (originalClose) {
                  await originalClose();
                }
              },
            };
          }

          // 驱动原生支持 Range，直接返回
          return streamHandle;
        }

        // 驱动不支持 getRange 方法，降级使用 ByteSliceStream
        console.log(
          `[StorageStreaming] 驱动不支持 getRange 方法，使用 ByteSliceStream 切片: ${start}-${end}`,
        );

        streamHandle = await descriptor.getStream();
        const originalStream = streamHandle.stream;
        const originalClose = streamHandle.close;

        // 使用 ByteSliceStream 包装完整流
        const slicedStream = smartWrapStreamWithByteSlice(originalStream, start, end);

        return {
          stream: slicedStream,
          async close() {
            if (originalClose) {
              await originalClose();
            }
          },
        };
      },
      async close() {
        if (closed) return;
        closed = true;
        if (streamHandle) {
          await streamHandle.close();
        }
      },
    };
  }

  /**
   * 创建 304 Not Modified RangeReader
   * @private
   */
  _create304Reader(descriptor, channel) {
    const headers = new Headers();
    if (descriptor.etag) headers.set("ETag", descriptor.etag);
    if (descriptor.lastModified) headers.set("Last-Modified", descriptor.lastModified.toUTCString());

    return {
      status: 304,
      headers,
      async getBody() {
        return null;
      },
      async close() {},
    };
  }

  /**
   * 创建 412 Precondition Failed RangeReader
   * @private
   */
  _create412Reader(descriptor, channel) {
    const headers = new Headers();
    if (descriptor.etag) headers.set("ETag", descriptor.etag);
    if (descriptor.lastModified) headers.set("Last-Modified", descriptor.lastModified.toUTCString());

    return {
      status: 412,
      headers,
      async getBody() {
        return null;
      },
      async close() {},
    };
  }

  /**
   * 创建 416 Range Not Satisfiable RangeReader
   * @private
   */
  _create416Reader(descriptor, channel) {
    const headers = new Headers();
    if (descriptor.size !== null) {
      headers.set("Content-Range", `bytes */${descriptor.size}`);
    }

    return {
      status: 416,
      headers,
      async getBody() {
        return null;
      },
      async close() {},
    };
  }
}

export { STREAMING_CHANNELS };
