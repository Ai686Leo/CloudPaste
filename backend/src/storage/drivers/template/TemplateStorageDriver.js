/**
 * TemplateStorageDriver
 *
 * 官方存储驱动模板：
 * - 仅作为"如何实现 storage-driver 契约"的示例与脚手架
 * - 不会被 StorageFactory 注册或在生产环境中直接使用
 *
 * 使用方式：
 * - 新增驱动时建议复制本文件，替换类名与 type，并按注释逐个实现方法；
 * - 根据目标后端实际能力调整 this.capabilities（例如是否支持 DIRECT_LINK / PROXY / MULTIPART）；
 *
 * ========== 返回值契约规范（所有驱动必须遵循）==========
 *
 * renameItem: 返回 { success: boolean, source: string, target: string, message?: string }
 * copyItem:   返回 { status: "success"|"skipped"|"failed", source: string, target: string, message?: string, skipped?: boolean, reason?: string }
 * batchRemoveItems: 返回 { success: number, failed: Array<{path, error}>, results?: Array<{path, success, error?}> }
 * uploadFile: 返回 { success: boolean, storagePath: string, message?: string }
 * createDirectory: 返回 { success: boolean, path: string, alreadyExists?: boolean }
 * listDirectory: 返回 { path, type: "directory", isRoot, isVirtual, mount_id?, storage_type?, items: Array<FileInfo> }
 * getFileInfo: 返回 { path, name, isDirectory, size, modified, mimetype?, type, typeName, mount_id?, storage_type? }
 * downloadFile: 返回 StorageStreamDescriptor 对象
 * StreamHandle 结构：
 * - stream: NodeReadable | ReadableStream  - 可读流（Node 环境用 NodeReadable，Worker 用 ReadableStream）
 * - close(): Promise<void>                 - 显式关闭方法
 * - Node 环境下优先使用 NodeReadable（避免 WebStreams 桥接问题）
 * - getRange 为可选实现，未实现时 StorageStreaming 层会降级处理
 *
 * ========== 统一抽象==========
 *
 * 1）FileInfo 构造统一规范（backend/src/storage/utils/FileInfoBuilder.js）
 *   - listDirectory / getFileInfo / search 等场景应通过 buildFileInfo 构造 FileInfo：
 *     - 传入：fsPath、name、isDirectory、size、modified、mimetype、mount、storageType、db
 *     - 禁止在驱动内部手动拼装 { path/name/isDirectory/size/modified/mimetype/type/typeName/mount_id/storage_type }，
 *       所有类型与显示名称推断统一交给 FileInfoBuilder 处理。
 *
 * 2）下载流 StorageStreamDescriptor 统一规范（backend/src/storage/streaming/StreamDescriptorUtils.js）
 *   - 本地文件（Node）：使用 createNodeStreamDescriptor({ openStream, openRangeStream?, size, contentType, etag, lastModified })
 *   - HTTP/WebDAV：使用 createHttpStreamDescriptor({ fetchResponse, size?, contentType?, etag?, lastModified?, supportsRange? })
 *   - Provider SDK 返回 Web ReadableStream（如 S3 / OneDrive / GoogleDrive）：
 *     - 优先使用 createWebStreamDescriptor({ openStream, size?, contentType?, etag?, lastModified? })
 *     - 或按需使用 createGenericStreamDescriptor({ stream, size?, contentType?, etag?, lastModified? })
 *   - downloadFile 只负责调用后端 SDK / HTTP 接口，返回上述工厂函数构造的 StorageStreamDescriptor，
 *     Range / 条件请求 / 软切片等细节统一由 StorageStreaming 层处理。
 */

import { BaseDriver } from "../../interfaces/capabilities/BaseDriver.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";

export class TemplateStorageDriver extends BaseDriver {
  /**
   * @param {Object} config  存储配置对象
   * @param {string} encryptionSecret 加密密钥
   */
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "TEMPLATE";
    this.encryptionSecret = encryptionSecret;
    // 默认模板给出 READER + WRITER 能力示例，开发者可根据需要追加 DIRECT_LINK / PROXY / MULTIPART / ATOMIC 等
    this.capabilities = [CAPABILITIES.READER, CAPABILITIES.WRITER];
  }

  /**
   * 初始化存储驱动（示例）
   * - 在真实驱动中应在此创建底层 client / 连接，并设置 this.initialized = true
   */
  async initialize() {
    // TODO: 在此初始化底层 client/连接（例如 S3Client/WebDAV client 等）
    this.initialized = true;
  }

  // ========== READER 能力：listDirectory / getFileInfo / downloadFile ==========

  /**
   * 列出目录内容
   * @param {string} subPath 挂载内子路径（subPath-only）
   * @param {Object} ctx     上下文选项（mount/path/subPath/db/userType 等）
   */
  async listDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 请在此实现 listDirectory 逻辑（参考 S3/WebDAV 驱动的目录列表实现）");
  }

  /**
   * 获取文件或目录信息
   * @param {string} subPath 挂载内子路径（subPath-only）
   * @param {Object} ctx     上下文选项（mount/path/subPath/db/userType/userId/request 等）
   */
  async getFileInfo(subPath, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 请在此实现 getFileInfo 逻辑（参考 S3/WebDAV 驱动的文件信息实现）");
  }

  /**
   * 下载文件，返回 StorageStreamDescriptor
   * Node 环境下优先使用 NodeReadable（fs.createReadStream 等）
   * Worker 环境下使用 Web ReadableStream
   *
   * @param {string} subPath 挂载内子路径（subPath-only）
   * @param {Object} ctx     上下文选项（mount/path/subPath/db/request 等）
   * @returns {Promise<import('../../streaming/types.js').StorageStreamDescriptor>}
   */
  async downloadFile(subPath, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 请在此实现 downloadFile 逻辑，返回 StorageStreamDescriptor（参考 LocalStorageDriver 的实现）");
  }

  // ========== WRITER 能力：uploadFile / createDirectory / rename / copy / remove ==========

  /**
   * 统一上传入口（文件 / 流）
   * @param {string} subPath       挂载内子路径（subPath-only）
   * @param {any} fileOrStream     数据源（ReadableStream/Node Stream/Buffer/File/Blob/string 等）
   * @param {Object} ctx           上下文选项（mount/path/subPath/db/filename/contentType/contentLength 等）
   */
  async uploadFile(subPath, fileOrStream, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 请在此实现 uploadFile 逻辑（可区分流式上传与表单上传）");
  }

  /**
   * 创建目录
   * @param {string} subPath 挂载内子路径（subPath-only）
   * @param {Object} ctx     上下文选项（mount/path/subPath/db 等）
   */
  async createDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 请在此实现 createDirectory 逻辑");
  }

  /**
   * 重命名文件或目录
   * @param {string} oldSubPath 原子路径（subPath-only）
   * @param {string} newSubPath 新子路径（subPath-only）
   * @param {Object} ctx        上下文选项（oldPath/newPath/oldSubPath/newSubPath/...）
   */
  async renameItem(oldSubPath, newSubPath, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 请在此实现 renameItem 逻辑");
  }

  /**
   * 批量删除文件/目录
   * @param {Array<string>} subPaths 子路径数组（subPath-only）
   * @param {Object} ctx            上下文选项（paths/subPaths/mount/...）
   */
  async batchRemoveItems(subPaths, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 请在此实现 batchRemoveItems 逻辑");
  }

  /**
   * 复制单个文件或目录
   * @param {string} sourceSubPath 源子路径（subPath-only）
   * @param {string} targetSubPath 目标子路径（subPath-only）
   * @param {Object} ctx            上下文选项（sourcePath/targetPath/sourceSubPath/targetSubPath/...）
   */
  async copyItem(sourceSubPath, targetSubPath, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 请在此实现 copyItem 逻辑");
  }

  // ========== 可选方法：search / getStats ==========

  /**
   * 获取存储驱动统计信息（可选实现）
   * @returns {Promise<Object>} 统计信息
   */
  async getStats() {
    this._ensureInitialized();
    return {
      type: this.type,
      capabilities: this.capabilities,
      initialized: this.initialized,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 基础存在性检查（必需契约）
   * - 建议：对象存储用 HeadObject/Stat，WebDAV 用 PROPFIND/exists
   * - 返回 boolean；异常时可选择返回 false 或抛出 DriverError 交由上层处理
   */
  async exists(subPath, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 请实现 exists 逻辑（HEAD/STAT/PROPFIND 等）并返回 boolean");
  }

  // ========== DIRECT_LINK 能力（可选）：generateDownloadUrl ==========

  /**
   * 生成下载直链（DIRECT_LINK 能力）
   * - 最小要求：返回 { url, type }，其中 type 为 "custom_host" 或 "native_direct"
   * - 其余字段（expiresIn/expiresAt 等）视需要扩展
   * @param {string} subPath 挂载内子路径（subPath-only）
   * @param {Object} ctx     上下文选项（path/request/forceDownload/...）
   */
  async generateDownloadUrl(subPath, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 如需支持直链能力，请在此实现 generateDownloadUrl，并返回 { url, type }");
  }

  // ========== PROXY 能力（可选）：generateProxyUrl ==========

  /**
   * 生成代理 URL（PROXY 能力）
   * - 返回 { url, type: \"proxy\", channel? }
   * @param {string} subPath 挂载内子路径（subPath-only）
   * @param {Object} ctx     上下文选项（path/request/download/channel/...）
   */
  async generateProxyUrl(subPath, ctx = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 如需支持代理能力，请在此实现 generateProxyUrl，并返回 { url, type: 'proxy' }");
  }

  // ========== MULTIPART 能力（可选）：前端分片上传生命周期 ==========

  async initializeFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 请在此根据目标后端实现 initializeFrontendMultipartUpload（参考 MultipartCapable 契约文档）");
  }

  async completeFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 请在此根据目标后端实现 completeFrontendMultipartUpload（参考 MultipartCapable 契约文档）");
  }

  async abortFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 请在此根据目标后端实现 abortFrontendMultipartUpload（参考 MultipartCapable 契约文档）");
  }

  async listMultipartUploads(subPath = "", options = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 请在此根据目标后端实现 listMultipartUploads（用于断点续传场景）");
  }

  async listMultipartParts(subPath, uploadId, options = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 请在此根据目标后端实现 listMultipartParts（用于恢复已上传分片）");
  }

  async signMultipartParts(subPath, uploadId, partNumbers, options = {}) {
    this._ensureInitialized();
    throw new Error("TemplateStorageDriver: 请在此根据目标后端实现 signMultipartParts（获取/刷新上传参数或会话信息）");
  }
}
