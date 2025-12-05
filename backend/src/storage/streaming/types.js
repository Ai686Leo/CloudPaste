/**
 * StorageStreaming 类型定义
 * - StorageStreamDescriptor: 驱动层返回的流描述对象
 * - RangeReader: StorageStreaming 层返回的读取器
 * - StreamingChannel: 访问通道枚举
 */

/**
 * 访问通道枚举
 * @typedef {'fs-web' | 'webdav' | 'proxy' | 'share' | 'object-api' | 'preview' | 'internal-job'} StreamingChannel
 */

/**
 * 字节范围
 * @typedef {Object} ByteRange
 * @property {number} start - 起始字节（包含）
 * @property {number} [end] - 结束字节（包含），省略表示到文件末尾
 */

/**
 * 流选项
 * @typedef {Object} StreamOptions
 * @property {AbortSignal} [signal] - AbortSignal 用于取消
 */

/**
 * 流句柄
 * @typedef {Object} StreamHandle
 * @property {import('stream').Readable | ReadableStream<Uint8Array>} stream - 可读流
 * @property {() => Promise<void>} close - 显式关闭方法
 */

/**
 * 存储流描述对象（驱动层返回）
 * @typedef {Object} StorageStreamDescriptor
 * @property {number | null} size - 文件总大小（字节）
 * @property {string | null} contentType - MIME 类型
 * @property {string | null} [etag] - ETag
 * @property {Date | null} [lastModified] - 最后修改时间
 * @property {(options?: StreamOptions) => Promise<StreamHandle>} getStream - 获取完整流
 * @property {(range: ByteRange, options?: StreamOptions) => Promise<StreamHandle>} [getRange] - 获取范围流（可选）
 */

/**
 * RangeReader 选项
 * @typedef {Object} RangeReaderOptions
 * @property {string} path - FS 挂载路径或存储路径
 * @property {StreamingChannel} channel - 访问通道
 * @property {Object} [mount] - 挂载上下文
 * @property {string} [storageConfigId] - 存储配置 ID
 * @property {string} [rangeHeader] - HTTP Range 头值
 * @property {Request} [request] - 原始 HTTP 请求
 * @property {any} [userIdOrInfo] - 用户上下文
 * @property {string} [userType] - 用户类型
 * @property {Object} [db] - 数据库连接
 */

/**
 * RangeReader 接口
 * @typedef {Object} RangeReader
 * @property {number} status - HTTP 状态码
 * @property {Headers} headers - 响应头
 * @property {() => Promise<StreamHandle | null>} getBody - 获取响应体流
 * @property {() => Promise<void>} close - 关闭读取器
 */

export const STREAMING_CHANNELS = {
  FS_WEB: "fs-web",
  WEBDAV: "webdav",
  PROXY: "proxy",
  SHARE: "share",
  OBJECT_API: "object-api",
  PREVIEW: "preview",
  INTERNAL_JOB: "internal-job",
};

/**
 * 检查是否为 Node.js 原生 Readable 流
 * @param {any} stream
 * @returns {boolean}
 */
export function isNodeReadable(stream) {
  return stream && typeof stream.pipe === "function" && typeof stream.on === "function";
}

/**
 * 检查是否为 Web ReadableStream
 * @param {any} stream
 * @returns {boolean}
 */
export function isWebReadableStream(stream) {
  return stream && typeof stream.getReader === "function";
}
