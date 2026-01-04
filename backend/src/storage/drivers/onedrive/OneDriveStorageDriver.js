/**
 * OneDriveStorageDriver
 *
 * Microsoft OneDrive / SharePoint 存储驱动实现
 * - 基于 Microsoft Graph API 实现文件操作
 * - 支持 READER/WRITER/ATOMIC/PROXY/SEARCH 能力（首版）
 * - 可选支持 DIRECT_LINK/MULTIPART 能力（后续扩展）
 *
 *
 * ========== 返回值契约规范（遵循 storage-driver 规范）==========
 *
 * renameItem: 返回 { success: boolean, source: string, target: string, message?: string }
 * copyItem:   返回 { status: "success"|"skipped"|"failed", source: string, target: string, message?: string, skipped?: boolean, reason?: string }
 * batchRemoveItems: 返回 { success: number, failed: Array<{path, error}>, results?: Array<{path, success, error?}> }
 * uploadFile: 返回 { success: boolean, storagePath: string, message?: string }
 * createDirectory: 返回 { success: boolean, path: string, alreadyExists?: boolean }
 * listDirectory: 返回 { path, type: "directory", isRoot, isVirtual, mount_id?, storage_type?, items: Array<FileInfo> }
 * getFileInfo: 返回 { path, name, isDirectory, size, modified, mimetype?, type, typeName, mount_id?, storage_type? }
 * downloadFile: 返回 StorageStreamDescriptor 对象
 */

import { BaseDriver } from "../../interfaces/capabilities/BaseDriver.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { OneDriveAuthManager } from "./auth/OneDriveAuthManager.js";
import { OneDriveGraphClient } from "./client/OneDriveGraphClient.js";
import { DriverError } from "../../../http/errors.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";
import { getMimeTypeFromFilename } from "../../../utils/fileUtils.js";
import { FILE_TYPES, FILE_TYPE_NAMES } from "../../../constants/index.js";
import {
  createUploadSessionRecord,
  listActiveUploadSessions,
  findUploadSessionById,
  updateUploadSessionById,
} from "../../../utils/uploadSessions.js";
import { buildFileInfo } from "../../utils/FileInfoBuilder.js";
import { createHttpStreamDescriptor } from "../../streaming/StreamDescriptorUtils.js";
import { decryptIfNeeded } from "../../../utils/crypto.js";

// 简单上传（Simple Upload）上限：4MB
const SIMPLE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

export class OneDriveStorageDriver extends BaseDriver {
  /**
   * @param {Object} config  存储配置对象
   * @param {string} encryptionSecret 加密密钥
   */
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "ONEDRIVE";
    this.encryptionSecret = encryptionSecret;

    // 能力：READER/WRITER/ATOMIC/PROXY/DIRECT_LINK/MULTIPART
    this.capabilities = [
      CAPABILITIES.READER,
      CAPABILITIES.WRITER,
      CAPABILITIES.ATOMIC,
      CAPABILITIES.PROXY,
      CAPABILITIES.DIRECT_LINK,
      CAPABILITIES.MULTIPART,
      CAPABILITIES.PAGED_LIST,
    ];

    // 配置字段
    this.region = config.region || "global";
    this.clientId = config.client_id;
    this.clientSecret = config.client_secret;
    this.refreshToken = config.refresh_token;
    this.tokenRenewEndpoint = config.token_renew_endpoint || null;
    this.redirectUri = config.redirect_uri || null;
    this.useOnlineApi = config?.use_online_api === 1;
    this.enableDiskUsage = config?.enable_disk_usage === 1;

    // 内部组件（延迟初始化）
    this.authManager = null;
    this.graphClient = null;
  }

  /**
   * 初始化存储驱动
   * - 创建 AuthManager 和 GraphClient
   * - 验证配置有效性
   */
  async initialize() {
    // secret 字段可能以 encrypted:* 存在（由存储配置 CRUD 统一加密写入）
    const decryptedClientSecret = await decryptIfNeeded(this.clientSecret, this.encryptionSecret);
    this.clientSecret = typeof decryptedClientSecret === "string" ? decryptedClientSecret : this.clientSecret;

    const decryptedRefreshToken = await decryptIfNeeded(this.refreshToken, this.encryptionSecret);
    this.refreshToken = typeof decryptedRefreshToken === "string" ? decryptedRefreshToken : this.refreshToken;

    // 创建认证管理器
    this.authManager = new OneDriveAuthManager({
      region: this.region,
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      refreshToken: this.refreshToken,
      tokenRenewEndpoint: this.tokenRenewEndpoint,
      redirectUri: this.redirectUri,
      useOnlineApi: this.useOnlineApi,
    });

    // 创建 Graph API 客户端
    this.graphClient = new OneDriveGraphClient({
      region: this.region,
      authManager: this.authManager,
    });

    // 验证 token 可用性（尝试获取一次 access token）
    try {
      await this.authManager.getAccessToken();
    } catch (error) {
      const reason = error?.message || "未知错误";
      throw new DriverError(`OneDrive 驱动初始化失败：无法获取访问令牌（${reason}）`, {
        status: 500,
        cause: error,
        details: { region: this.region },
      });
    }

    this.initialized = true;
  }

  /**
   * 规范化 OneDrive 远端路径（相对路径，不带前后斜杠）
   * - 统一处理：去掉开头/结尾的 / 或 \\，并把多余分隔符归一成 /
   * - 只做字符串层面的整理，不做 URL 编码
   */
  _normalizeRemoteBase(value) {
    const raw = typeof value === "string" ? value : "";
    return raw.replace(/^[/\\\\]+|[/\\\\]+$/g, "").replace(/[\\\\/]+/g, "/");
  }

  /**
   * 规范化远端文件路径：目录(base) + 文件名(fileName)
   * - 如果 base 已经以 fileName 结尾（忽略大小写），则不重复拼接
   * - base 允许为空（表示根目录）
   */
  _resolveRemoteFilePath(base, fileName) {
    const normalizedBase = this._normalizeRemoteBase(base);
    const safeName = fileName ? String(fileName) : "";

    if (!safeName) {
      return normalizedBase;
    }
    if (!normalizedBase) {
      return safeName;
    }

    const segments = normalizedBase.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    if (lastSegment.toLowerCase() === safeName.toLowerCase()) {
      return normalizedBase;
    }
    return `${normalizedBase}/${safeName}`;
  }

  // ========== READER 能力：listDirectory / getFileInfo / downloadFile ==========

  /**
   * 列出目录内容
   * @param {string} subPath 挂载内子路径（subPath-only）
   * @param {Object} ctx     上下文选项（mount/path/subPath/db/userType 等）
   */
  async listDirectory(subPath, ctx = {}) {
    this._ensureInitialized();

    const { mount, db } = ctx;
    const fsPath = ctx?.path;
    const remotePath = subPath;

    const cursorRaw = ctx?.cursor != null && String(ctx.cursor).trim() ? String(ctx.cursor).trim() : null;
    const limitRaw = ctx?.limit != null && ctx.limit !== "" ? Number(ctx.limit) : null;
    const limit =
      limitRaw != null && Number.isFinite(limitRaw) && limitRaw > 0 ? Math.max(1, Math.min(999, Math.floor(limitRaw))) : null;
    const paged = ctx?.paged === true || !!cursorRaw || limit != null;

    let pageNextCursor = null;
    let items = [];
    if (paged) {
      const page = await this.graphClient.listChildrenPage(remotePath || "", {
        cursor: cursorRaw,
        limit,
      });
      items = Array.isArray(page?.items) ? page.items : [];
      pageNextCursor = page?.nextCursor ? String(page.nextCursor) : null;
    } else {
      items = await this.graphClient.listChildren(remotePath || "");
    }

    // 转换为标准格式（path 仍然使用挂载视图路径，保证与 FileSystem 约定一致）
    const formattedItems = await Promise.all(
      items.map((item) => this._formatDriveItem(item, fsPath, mount, db)),
    );

    return {
      path: fsPath,
      type: "directory",
      isRoot: !remotePath || remotePath === "/",
      isVirtual: false,
      mount_id: mount?.id,
      storage_type: this.type,
      items: formattedItems,
      ...(paged ? { hasMore: !!pageNextCursor, nextCursor: pageNextCursor } : {}),
    };
  }

  // ===== 可选能力：目录分页 =====
  // OneDrive / Microsoft Graph children 接口是分页返回的（@odata.nextLink）。
  supportsDirectoryPagination() {
    return true;
  }

  /**
   * 获取文件或目录信息
   * @param {string} subPath 挂载内子路径（subPath-only）
   * @param {Object} ctx     上下文选项（mount/path/subPath/db/userType/userId/request 等）
   */
  async getFileInfo(subPath, ctx = {}) {
    this._ensureInitialized();

    const { mount, db } = ctx;
    const fsPath = ctx?.path;
    const remotePath = subPath;

    const item = await this.graphClient.getItem(remotePath || "");

    let parentPath = fsPath;
    if (typeof fsPath === "string") {
      const segments = fsPath.split("/").filter(Boolean);
      if (segments.length > 1) {
        parentPath = `/${segments.slice(0, -1).join("/")}`;
      } else if (mount?.mount_path) {
        parentPath = mount.mount_path;
      } else {
        parentPath = "/";
      }
    }

    return this._formatDriveItem(item, parentPath, mount, db);
  }

  /**
   * 下载文件，返回 StorageStreamDescriptor
   * @param {string} subPath 挂载内子路径（subPath-only）
   * @param {Object} ctx     上下文选项（mount/path/subPath/db/request 等）
   * @returns {Promise<import('../../streaming/types.js').StorageStreamDescriptor>}
   */
  async downloadFile(subPath, ctx = {}) {
    this._ensureInitialized();

    const remotePath = subPath;

    // 获取文件元数据
    const item = await this.graphClient.getItem(remotePath || "");

    if (item.folder) {
      throw new DriverError("无法下载目录", { status: 400 });
    }

    const size = item.size || null;
    const contentType = item.file?.mimeType || getMimeTypeFromFilename(item.name) || "application/octet-stream";
    const etag = item.eTag || null;
    const lastModified = item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null;

    return createHttpStreamDescriptor({
      size,
      contentType,
      etag,
      lastModified,
      supportsRange: true,
      fetchResponse: async (signal) => {
        return await this.graphClient.downloadContentResponse(remotePath || "", { signal });
      },
      fetchRangeResponse: async (signal, rangeHeader) => {
        return await this.graphClient.downloadContentResponse(remotePath || "", { signal, rangeHeader });
      },
    });
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

    const { contentLength, contentType, filename } = ctx;
    const fsPath = ctx?.path;

    // 规范化远端文件路径：目录(subPath) + 文件名
    const remoteBase = subPath;
    const safeName =
      filename ||
      (typeof fsPath === "string"
        ? fsPath.split("/").filter(Boolean).pop() || "upload.bin"
        : "upload.bin");
    const remotePath = this._resolveRemoteFilePath(remoteBase, safeName);

    const effectiveContentType =
      contentType || getMimeTypeFromFilename(safeName) || "application/octet-stream";

    try {
      let item;

      // 小文件：走 Simple Upload（PUT .../content）
      if (
        typeof contentLength === "number" &&
        Number.isFinite(contentLength) &&
        contentLength > 0 &&
        contentLength <= SIMPLE_UPLOAD_MAX_BYTES
      ) {
        console.log(
          `[StorageUpload] type=ONEDRIVE mode=简单上传 status=开始 路径=${fsPath} 子路径=${subPath ?? ""} 远端=${remotePath} 大小=${contentLength}`,
        );

        item = await this.graphClient.uploadSmall(remotePath || "", fileOrStream, {
          contentLength,
          contentType: effectiveContentType,
        });
      } else if (
        typeof contentLength === "number" &&
        Number.isFinite(contentLength) &&
        contentLength > SIMPLE_UPLOAD_MAX_BYTES
      ) {
        // 大文件：使用 Upload Session + 单次 PUT（后端流式上传，不做分片循环）
        console.log(
          `[StorageUpload] type=ONEDRIVE mode=会话上传 status=开始 路径=${fsPath} 子路径=${subPath ?? ""} 远端=${remotePath} 大小=${contentLength}`,
        );

        const session = await this.graphClient.createUploadSession(remotePath || "", {
          conflictBehavior: "rename",
        });
        item = await this.graphClient.uploadSessionSingleChunk(session.uploadUrl, fileOrStream, {
          contentLength,
          contentType: effectiveContentType,
        });
      } else {
        // 未知大小：保守起见使用 Simple Upload，依赖环境自身的大小限制
        console.log(
          `[StorageUpload] type=ONEDRIVE mode=简单上传-未知大小 status=开始 路径=${fsPath} 子路径=${subPath ?? ""} 远端=${remotePath}`,
        );

        item = await this.graphClient.uploadSmall(remotePath || "", fileOrStream, {
          contentLength,
          contentType: effectiveContentType,
        });
      }

      return {
        success: true,
        storagePath: fsPath || (typeof subPath === "string" ? subPath : ""),
        message: "文件上传成功",
        item,
      };
    } catch (error) {
      throw new DriverError(`文件上传失败: ${error.message}`, {
        status: error.status || 500,
        cause: error,
        details: { path: fsPath },
      });
    }
  }

  /**
   * 更新文件内容
   * @param {string} subPath 挂载内子路径（subPath-only）
   * @param {string|Uint8Array|ArrayBuffer} content 新内容
   * @param {Object} ctx 上下文选项（mount/path/subPath/db 等）
   */
  async updateFile(subPath, content, ctx = {}) {
    this._ensureInitialized();

    const fsPath = ctx?.path;
    if (typeof fsPath !== "string" || !fsPath) {
      throw new DriverError("OneDrive 更新文件缺少 path 上下文（ctx.path）", {
        status: 500,
        details: { subPath },
      });
    }

    if (typeof subPath !== "string") {
      throw new DriverError("OneDrive 更新文件缺少子路径上下文（subPath）", {
        status: 500,
        details: { path: fsPath },
      });
    }

    // subPath 已经是挂载内的完整相对路径（包含文件名）
    const remotePath = this._normalizeRemoteBase(subPath);

    const safeName =
      (typeof fsPath === "string"
        ? fsPath.split("/").filter(Boolean).pop()
        : null) || "file";

    const effectiveContentType =
      getMimeTypeFromFilename(safeName) || "text/plain; charset=utf-8";

    // 计算内容长度（仅在字符串时计算，用于大文件判断）
    let contentLength = undefined;
    if (typeof content === "string") {
      contentLength = Buffer.byteLength(content, "utf8");
    }

    try {
      let item;

      console.log(
        `[StorageUpload] type=ONEDRIVE mode=内容更新 status=开始 路径=${fsPath} 子路径=${remotePath} 大小=${contentLength ?? "未知"}`,
      );

      if (
        typeof contentLength === "number" &&
        Number.isFinite(contentLength) &&
        contentLength > SIMPLE_UPLOAD_MAX_BYTES
      ) {
        // 大文件更新：使用 Upload Session 单块覆盖
        const session = await this.graphClient.createUploadSession(remotePath || "", {
          conflictBehavior: "replace",
        });
        item = await this.graphClient.uploadSessionSingleChunk(session.uploadUrl, content, {
          contentLength,
          contentType: effectiveContentType,
        });
      } else {
        // 小文件更新：直接 Simple Upload 覆盖
        item = await this.graphClient.uploadSmall(remotePath || "", content, {
          contentLength,
          contentType: effectiveContentType,
        });
      }

      console.log(
        `[StorageUpload] type=ONEDRIVE mode=内容更新 status=完成 路径=${fsPath} 子路径=${remotePath}`,
      );

      return {
        success: true,
        path: fsPath,
        message: "文件更新成功",
        item,
      };
    } catch (error) {
      throw new DriverError(`更新文件失败: ${error.message}`, {
        status: error.status || 500,
        cause: error,
        details: { path: fsPath, subPath: remotePath },
      });
    }
  }

  /**
   * 生成预签名上传URL（基于 OneDrive 上传会话）
   * - 供 /api/fs/presign 使用，前端通过 StorageAdapter 执行直链上传
   * - 这里使用 Graph createUploadSession + uploadUrl，前端一次性 PUT 完整文件
   * @param {string} subPath 挂载内子路径（subPath-only）
   * @param {Object} ctx     上下文选项（mount/path/subPath/db/fileName/fileSize 等）
   */
  async generateUploadUrl(subPath, ctx = {}) {
    this._ensureInitialized();

    const fsPath = ctx?.path;
    const { fileName, fileSize } = ctx;

    if (!fileName) {
      throw new DriverError("生成上传URL失败: 缺少文件名", { status: 400 });
    }

    // 对于 FS 视图，使用 subPath/targetPath 作为完整远端路径（包含文件名）；
    // 对于 storage-first 场景，则直接使用传入的 path 作为对象 Key。
    const remoteBase = subPath;
    const remotePath =
      typeof remoteBase === "string"
        ? remoteBase
            .replace(/^[/\\]+/, "")
            .replace(/[/\\]+$/, "")
            .replace(/[\\/]+/g, "/")
        : "";
    const safeName = fileName;

    try {
      console.log(
        `[StorageUpload] type=ONEDRIVE mode=预签名上传 status=开始 路径=${fsPath} 子路径=${remotePath} 文件=${safeName} 大小=${fileSize ?? "未知"}`,
      );

      const session = await this.graphClient.createUploadSession(remotePath || "", {
        conflictBehavior: "rename",
      });

      const detectedContentType = getMimeTypeFromFilename(safeName) || "application/octet-stream";

      console.log(
        `[StorageUpload] type=ONEDRIVE mode=预签名上传 status=生成完成 远端=${remotePath}`,
      );

      // OneDrive uploadUrl 本身是预认证 URL，前端通过 PUT + Content-Range 直接上传
      let headers = {};
      if (typeof fileSize === "number" && Number.isFinite(fileSize) && fileSize > 0) {
        const end = fileSize - 1;
        headers["Content-Range"] = `bytes 0-${end}/${fileSize}`;
      }

      return {
        uploadUrl: session.uploadUrl,
        storagePath: remotePath,
        fileName: safeName,
        fileSize: typeof fileSize === "number" ? fileSize : null,
        contentType: detectedContentType,
        // 额外附带会话信息，供需要时使用
        expirationDateTime: session.expirationDateTime || null,
        headers,
      };
    } catch (error) {
      throw new DriverError(`生成上传URL失败: ${error.message}`, {
        status: error.status || 500,
        cause: error,
        details: { path: fsPath, subPath },
      });
    }
  }

  /**
   * 创建目录
   * @param {string} subPath 挂载内子路径（subPath-only）
   * @param {Object} ctx     上下文选项（mount/path/subPath/db 等）
   */
  async createDirectory(subPath, ctx = {}) {
    this._ensureInitialized();

    const fsPath = ctx?.path;
    const rawRemotePath = subPath;
    const remotePath = this._normalizeRemoteBase(rawRemotePath);

    // 特殊处理：挂载点根目录在逻辑上总是存在，
    // 对应的 OneDrive 根目录不需要真正创建，避免向 Graph 发送空名称导致
    // “The item must have a name.” 错误。
    if (!remotePath) {
      console.log(
        `[OneDriveStorageDriver] 跳过创建挂载点根目录（逻辑上总是存在）: ${fsPath}`,
      );
      return {
        success: true,
        path: fsPath,
        alreadyExists: true,
      };
    }

    try {
      const result = await this.graphClient.createFolder(remotePath);
      return {
        success: true,
        path: fsPath,
        alreadyExists: false,
        item: result,
      };
    } catch (error) {
      // 如果目录已存在，返回 alreadyExists: true
      if (error.status === 409 || error.code === "nameAlreadyExists") {
        return {
          success: true,
          path: fsPath,
          alreadyExists: true,
        };
      }
      throw new DriverError(`创建目录失败: ${error.message}`, {
        status: error.status || 500,
        cause: error,
        details: { path: fsPath },
      });
    }
  }

  /**
   * 重命名文件或目录
   * @param {string} oldSubPath 原子路径（subPath-only）
   * @param {string} newSubPath 目标子路径（subPath-only）
   * @param {Object} ctx        上下文选项（oldPath/newPath/oldSubPath/newSubPath/...）
   */
  async renameItem(oldSubPath, newSubPath, ctx = {}) {
    this._ensureInitialized();

    const remoteOldPath = this._normalizeRemoteBase(oldSubPath);
    const remoteNewPath = this._normalizeRemoteBase(newSubPath);

    try {
      await this.graphClient.renameItem(remoteOldPath || "", remoteNewPath || "");
      return {
        success: true,
        source: ctx?.oldPath,
        target: ctx?.newPath,
      };
    } catch (error) {
      throw new DriverError(`重命名失败: ${error.message}`, {
        status: error.status || 500,
        cause: error,
        details: { oldPath: ctx?.oldPath, newPath: ctx?.newPath, remoteOldPath, remoteNewPath },
      });
    }
  }

  /**
   * 批量删除文件/目录
   * @param {Array<string>} subPaths 子路径数组（subPath-only）
   * @param {Object} ctx            上下文选项（paths/subPaths/mount/...）
   */
  async batchRemoveItems(subPaths, ctx = {}) {
    this._ensureInitialized();

    if (!Array.isArray(subPaths) || subPaths.length === 0) {
      return { success: 0, failed: [], results: [] };
    }

    if (!Array.isArray(ctx?.paths) || ctx.paths.length !== subPaths.length) {
      throw new DriverError("OneDrive batchRemoveItems 需要 ctx.paths 与 subPaths 一一对应（不做兼容）", {
        status: 500,
        details: { pathsType: typeof ctx?.paths, pathsLen: ctx?.paths?.length, subPathsLen: subPaths.length },
      });
    }

    const results = [];
    const failed = [];
    let successCount = 0;

    const fsPaths = ctx.paths;

    for (let i = 0; i < subPaths.length; i += 1) {
      const fsPath = fsPaths[i];
      const itemSubPath = subPaths[i];
      const remotePath = this._normalizeRemoteBase(itemSubPath);

      try {
        await this.graphClient.deleteItem(remotePath || "");
        results.push({ path: fsPath, success: true });
        successCount += 1;
      } catch (error) {
        results.push({ path: fsPath, success: false, error: error.message });
        failed.push({ path: fsPath, error: error.message });
      }
    }

    return {
      success: successCount,
      failed,
      results,
    };
  }

  /**
   * 复制单个文件或目录
   * @param {string} sourceSubPath 源子路径（subPath-only）
   * @param {string} targetSubPath 目标子路径（subPath-only）
   * @param {Object} ctx            上下文选项（sourcePath/targetPath/sourceSubPath/targetSubPath/...）
   */
  async copyItem(sourceSubPath, targetSubPath, ctx = {}) {
    this._ensureInitialized();
    const sourcePath = ctx?.sourcePath;
    const targetPath = ctx?.targetPath;

    const remoteSourcePath = this._normalizeRemoteBase(sourceSubPath);
    const remoteTargetPath = this._normalizeRemoteBase(targetSubPath);

    try {
      await this.graphClient.copyItem(remoteSourcePath || "", remoteTargetPath || "");
      return {
        status: "success",
        source: sourcePath,
        target: targetPath,
      };
    } catch (error) {
      if (error.status === 409 || error.code === "nameAlreadyExists") {
        return {
          status: "skipped",
          source: sourcePath,
          target: targetPath,
          skipped: true,
          reason: "目标已存在",
        };
      }
      return {
        status: "failed",
        source: sourcePath,
        target: targetPath,
        message: error.message,
      };
    }
  }

  // ========== SEARCH 能力 ==========

  // ========== DIRECT_LINK 能力 ==========

  /**
   * 生成下载直链（DIRECT_LINK 能力）
   * - 基于 Graph API @microsoft.graph.downloadUrl 生成直链
   * - 返回 { url, type, expiresIn?, expiresAt? }
   * @param {string} subPath 挂载内子路径（subPath-only）
   * @param {Object} ctx     上下文选项（path/request/forceDownload/...）
   */
  async generateDownloadUrl(subPath, ctx = {}) {
    this._ensureInitialized();

    try {
      const remotePath = subPath;

      // 获取文件元数据，包含 downloadUrl
      const item = await this.graphClient.getItem(remotePath || "");

      if (item.folder) {
        throw new DriverError("无法为目录生成下载链接", { status: 400 });
      }

      const downloadUrl = item["@microsoft.graph.downloadUrl"];

      if (!downloadUrl) {
        throw new DriverError("OneDrive 未返回可用的 downloadUrl（无法生成直链）", {
          status: 502,
          expose: false,
          details: { subPath: remotePath },
        });
      }

      // Graph API downloadUrl 通常有效期约 1 小时
      const expiresIn = 3600; // 1 小时（秒）
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      return {
        url: downloadUrl,
        type: "native_direct",
        expiresIn,
        expiresAt,
      };
    } catch (error) {
      // 直链能力失败时，交给上层策略（FsLinkStrategy / LinkService）决定是否降级为 proxy
      throw new DriverError(`OneDrive 获取直链失败: ${error?.message || "unknown"}`, {
        status: error?.status || 502,
        expose: false,
        cause: error,
        details: { subPath },
      });
    }
  }

  // ========== PROXY 能力 ==========

  /**
   * 生成代理 URL（PROXY 能力）
   * - 返回 { url, type: "proxy", channel? }
   * @param {string} subPath 挂载内子路径（subPath-only）
   * @param {Object} ctx     上下文选项（path/request/download/channel/...）
   */
  async generateProxyUrl(subPath, ctx = {}) {
    this._ensureInitialized();

    const { request, download = false, channel = "web" } = ctx;
    const fsPath = ctx?.path;

    // 使用统一的代理 URL 构建器
    const url = buildFullProxyUrl(request, fsPath, download);

    return {
      url,
      type: "proxy",
      channel,
    };
  }

  // ========== MULTIPART 能力：前端分片上传（单会话 uploadUrl + Content-Range） ==========

  /**
   * 初始化前端分片上传（基于 OneDrive Upload Session）
   * - 策略：single_session
   * - 由前端负责将文件切分为多个 chunk，并对同一个 uploadUrl 连续发送带 Content-Range 的 PUT 请求
   *
   * @param {string} subPath 挂载视图下的子路径（目录或完整相对路径）
   * @param {Object} options 选项参数
   * @returns {Promise<Object>} 初始化结果（InitResult）
   */
  async initializeFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();

    const {
      fileName,
      fileSize,
      partSize = 5 * 1024 * 1024,
      partCount,
      mount,
      db,
      userIdOrInfo,
      userType,
    } = options;

    if (!fileName || typeof fileSize !== "number" || !Number.isFinite(fileSize) || fileSize <= 0) {
      throw new DriverError("OneDrive 分片上传初始化失败：缺少有效的 fileName 或 fileSize", {
        status: 400,
      });
    }

    // 规范化远端文件路径：目录(subPath) + 文件名
    const remotePath = this._resolveRemoteFilePath(typeof subPath === "string" ? subPath : "", fileName);

    try {
      const session = await this.graphClient.createUploadSession(remotePath || "", {
        conflictBehavior: "replace",
      });

      const effectivePartSize = partSize || 5 * 1024 * 1024;
      const calculatedPartCount =
        partCount || Math.max(1, Math.ceil(fileSize / effectivePartSize));

      // uploadId 使用 CloudPaste 的 upload_sessions.id（upl_xxx）
      // session.uploadUrl 仍然返回 Graph 的 uploadUrl（浏览器直传 OneDrive）
      // 断点续传统一用 uploadId 查本地会话，再去 Graph 拉取 nextExpectedRanges
      if (!db || !mount?.storage_config_id || !mount?.id) {
        throw new DriverError("OneDrive 分片上传初始化失败：缺少 db 或 mount 信息", {
          status: 400,
          expose: true,
        });
      }
      let uploadId = null;

      // 规范化 FS 视图路径：mount_path + "/" + remotePath
      let fsPath = remotePath || "";
      if (mount?.mount_path) {
        const basePath = (mount.mount_path || "").replace(/\/+$/g, "") || "/";
        const rel = (remotePath || "").replace(/^\/+/g, "");
        fsPath = rel ? `${basePath}/${rel}` : basePath;
      }
      if (!fsPath.startsWith("/")) {
        fsPath = `/${fsPath}`;
      }

      // 将会话写入通用 upload_sessions 表：这是断点续传的“控制面”
      //（Graph uploadUrl 会过期，但我们用 uploadId 作为稳定标识，再通过 sign-parts 去刷新 session 信息） 
      const { id } = await createUploadSessionRecord(db, {
        userIdOrInfo,
        userType: userType || null,
        storageType: this.type,
        storageConfigId: mount.storage_config_id,
        mountId: mount.id ?? null,
        fsPath,
        source: "FS",
        fileName,
        fileSize,
        mimeType: getMimeTypeFromFilename(fileName) || null,
        checksum: null,
        strategy: "single_session",
        partSize: effectivePartSize,
        totalParts: calculatedPartCount,
        bytesUploaded: 0,
        uploadedParts: 0,
        nextExpectedRange:
          Array.isArray(session.nextExpectedRanges) && session.nextExpectedRanges.length > 0
            ? session.nextExpectedRanges[0]
            : "0-",
        providerUploadId: null,
        providerUploadUrl: session.uploadUrl,
        providerMeta: null,
        status: "initiated",
        expiresAt: session.expirationDateTime || null,
      });
      uploadId = id;

      return {
        success: true,
        uploadId,
        strategy: "single_session",
        fileName,
        fileSize,
        partSize: effectivePartSize,
        partCount: calculatedPartCount,
        totalParts: calculatedPartCount,
        key: fsPath.replace(/^\/+/, ""),
        session: {
          uploadUrl: session.uploadUrl,
          expirationDateTime: session.expirationDateTime || null,
          nextExpectedRanges: session.nextExpectedRanges || null,
        },
        policy: {
          refreshPolicy: "server_decides",
          partsLedgerPolicy: "server_records",
          retryPolicy: { maxAttempts: 3 },
        },
        mount_id: mount?.id ?? null,
        path: fsPath,
        storage_type: this.type,
        userType: userType || null,
        userIdOrInfo: userIdOrInfo || null,
      };
    } catch (error) {
      throw new DriverError(`初始化 OneDrive 分片上传失败: ${error.message}`, {
        status: error.status || 500,
        cause: error,
        details: { subPath, fileName },
      });
    }
  }

  /**
   * 完成前端分片上传
   * - 对 OneDrive 而言，最后一个 chunk PUT 成功即视为完成
   * - 这里主要用于对齐 FS 层行为并返回统一结果结构
   *
   * @param {string} subPath 挂载视图下的子路径
   * @param {Object} options 选项参数
   * @returns {Promise<Object>} 完成结果（CompleteResult）
   */
  async completeFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();

    const { uploadId, fileName, fileSize, mount, db, userIdOrInfo, userType, parts } = options;

    // 规范化远端路径（与 initialize 保持一致）
    const remotePath = fileName
      ? this._resolveRemoteFilePath(typeof subPath === "string" ? subPath : "", fileName)
      : this._normalizeRemoteBase(typeof subPath === "string" ? subPath : "");

    try {
      // 尝试获取最终文件信息（非严格必要，仅用于返回更完整的元数据）
      let item = null;
      try {
        item = await this.graphClient.getItem(remotePath || "");
      } catch {
        // 如果获取失败，不影响整体完成逻辑
      }

      const contentType =
        item?.file?.mimeType || (fileName ? getMimeTypeFromFilename(fileName) : null);

      if (db && mount?.storage_config_id && uploadId) {
        try {
          const effectiveSize =
            typeof fileSize === "number" && Number.isFinite(fileSize)
              ? fileSize
              : item?.size ?? null;

          // uploadId 即 upload_sessions.id，直接按 id 更新状态即可。
          await updateUploadSessionById(db, {
            id: String(uploadId),
            storageType: this.type,
            status: "completed",
            bytesUploaded: typeof effectiveSize === "number" && Number.isFinite(effectiveSize) ? effectiveSize : 0,
            uploadedParts: Array.isArray(parts) ? parts.length : 0,
            nextExpectedRange: null,
            errorCode: null,
            errorMessage: null,
          });
        } catch (e) {
          console.warn(
            "[OneDriveStorageDriver] 更新 upload_sessions 状态为 completed 失败:",
            e,
          );
        }
      }

      return {
        success: true,
        fileName: fileName || (remotePath ? remotePath.split("/").pop() : null),
        size: typeof fileSize === "number" ? fileSize : item?.size ?? null,
        contentType: contentType || null,
        storagePath: remotePath || "",
        publicUrl: null,
        etag: item?.eTag || null,
        uploadId: uploadId || null,
        message: "OneDrive 分片上传完成",
      };
    } catch (error) {
      throw new DriverError(`完成 OneDrive 分片上传失败: ${error.message}`, {
        status: error.status || 500,
        cause: error,
        details: { subPath, uploadId, fileName },
      });
    }
  }

  /**
   * 中止前端分片上传
   * - 当前实现不主动调用 Graph 的会话中止接口，依赖 OneDrive 上传会话的过期机制
   * - 若后续需要严格释放资源，可在此处补充调用
   */
  async abortFrontendMultipartUpload(_subPath, options = {}) {
    this._ensureInitialized();

    const { uploadId, db, mount } = options;

    if (db && mount?.storage_config_id && uploadId) {
      try {
        // uploadId 即 upload_sessions.id，直接按 id 更新即可。
        await updateUploadSessionById(db, {
          id: String(uploadId),
          storageType: this.type,
          status: "aborted",
          errorMessage: "aborted_by_client",
        });
      } catch (e) {
        console.warn(
          "[OneDriveStorageDriver] 更新 upload_sessions 状态为 aborted 失败:",
          e,
        );
      }
    }

    // 目前仅返回成功标记，表示后续不再使用该 uploadId
    return {
      success: true,
      uploadId: uploadId || null,
      message: "OneDrive 分片上传已标记为中止（会话将自然过期）",
    };
  }

  /**
   * 列出进行中的分片上传
   */
  async listMultipartUploads(_subPath = "", _options = {}) {
    this._ensureInitialized();

    const { mount, db, userIdOrInfo, userType } = _options || {};

    if (!db || !mount?.id) {
      return {
        success: true,
        uploads: [],
      };
    }

    // 计算 FS 视图下的前缀路径（与 initializeFrontendMultipartUpload 中 fsPath 的计算方式保持一致）
    let fsPathPrefix = mount.mount_path || "/";
    if (typeof _subPath === "string" && _subPath.trim() !== "") {
      const rel = _subPath.replace(/^\/+/g, "");
      const basePath = (fsPathPrefix || "/").replace(/\/+$/g, "") || "/";
      fsPathPrefix = rel ? `${basePath}/${rel}` : basePath;
    }
    if (!fsPathPrefix.startsWith("/")) {
      fsPathPrefix = `/${fsPathPrefix}`;
    }

    const sessions = await listActiveUploadSessions(db, {
      userIdOrInfo,
      userType,
      storageType: this.type,
      mountId: mount.id,
      fsPathPrefix,
      limit: 100,
    });

    const uploads = sessions.map((row) => ({
      key: (row.fs_path || "/").replace(/^\/+/, ""),
      uploadId: row.id,
      initiated: row.created_at,
      storageClass: null,
      owner: null,
      // 额外元数据（当前前端不会直接使用，但便于以后扩展）
      fileName: row.file_name,
      fileSize: row.file_size,
      partSize: row.part_size,
      strategy: row.strategy,
      sessionId: row.id,
      bytesUploaded: Number(row.bytes_uploaded) || 0,
      policy: {
        refreshPolicy: "server_decides",
        partsLedgerPolicy: "server_records",
        retryPolicy: { maxAttempts: 3 },
      },
    }));

    return {
      success: true,
      uploads,
    };
  }

  /**
   * 列出指定上传任务的已上传分片
   * - 由于 OneDrive uploadSession 不暴露 per-part 列表，这里根据 upload_sessions 记录和
   *   Graph uploadSession 的 nextExpectedRanges 估算“已上传的完整分片”数量。
   * - 用于配合 Uppy 的恢复逻辑：仅在存在至少一个完整分片时返回分片信息，最后一块可能是未对齐的部分数据，将始终由前端重新上传。
   */
  async listMultipartParts(_subPath, uploadId, _options = {}) {
    this._ensureInitialized();

    const { mount, db, userIdOrInfo, userType } = _options || {};
    const policy = {
      refreshPolicy: "server_decides",
      partsLedgerPolicy: "server_records",
      retryPolicy: { maxAttempts: 3 },
    };

    if (!uploadId || !db || !mount?.storage_config_id) {
      return {
        success: true,
        uploadId: uploadId || null,
        parts: [],
        policy,
      };
    }

    try {
      // 从本地 upload_sessions 表中获取会话配置信息（文件大小与分片大小）
      const sessionRow = await findUploadSessionById(db, { id: uploadId });

      if (!sessionRow) {
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }
      if (String(sessionRow.storage_type) !== String(this.type)) {
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }

      const providerUploadUrl = sessionRow.provider_upload_url ? String(sessionRow.provider_upload_url) : "";
      if (!providerUploadUrl) {
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }

      const totalSize = Number(sessionRow.file_size) || null;
      const partSize = Number(sessionRow.part_size) || 5 * 1024 * 1024;

      if (!totalSize || !Number.isFinite(partSize) || partSize <= 0) {
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }

      // 调用 Graph 获取最新的 nextExpectedRanges，以推导已上传字节数
      let bytesUploaded = 0;
      try {
        const sessionInfo = await this.graphClient.getUploadSessionInfo(providerUploadUrl);
        const ranges = Array.isArray(sessionInfo.nextExpectedRanges)
          ? sessionInfo.nextExpectedRanges
          : null;
        const firstRange = ranges && ranges.length > 0 ? String(ranges[0]) : null;
        if (firstRange) {
          const startStr = firstRange.split("-")[0];
          const parsed = Number.parseInt(startStr, 10);
          if (Number.isFinite(parsed) && parsed >= 0) {
            bytesUploaded = parsed;
          }
        }
      } catch (error) {
        console.warn(
          "[OneDriveStorageDriver] listMultipartParts 获取 uploadSession 信息失败，将回退为空分片列表:",
          error,
        );
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }

      // 若尚未上传任何字节，直接视为无可恢复分片
      if (!Number.isFinite(bytesUploaded) || bytesUploaded <= 0) {
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }

      // 取整计算“已完成的完整分片”数量，最后一块未对齐的数据将由前端重新上传
      const completedParts = Math.floor(bytesUploaded / partSize);
      if (completedParts <= 0) {
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }

      const parts = [];
      for (let partNumber = 1; partNumber <= completedParts; partNumber += 1) {
        parts.push({
          partNumber,
          size: partSize,
          etag: `onedrive-part-${partNumber}`,
        });
      }

      return {
        success: true,
        uploadId: uploadId || null,
        parts,
        policy,
      };
    } catch (error) {
      console.warn("[OneDriveStorageDriver] listMultipartParts 异常，回退为空分片列表:", error);
      return {
        success: true,
        uploadId: uploadId || null,
        parts: [],
        policy,
      };
    }
  }

  /**
   * 刷新分片上传端点
   * - 对于 single_session 策略，通常直接复用原始 uploadUrl
   * - 当前实现回传 uploadId 及最新的 nextExpectedRanges，调用方可将其视为 uploadUrl + 会话信息
   */
  async signMultipartParts(_subPath, uploadId, _partNumbers, options = {}) {
    this._ensureInitialized();

    const { mount, db } = options || {};
    const policy = {
      refreshPolicy: "server_decides",
      partsLedgerPolicy: "server_records",
      retryPolicy: { maxAttempts: 3 },
    };

    if (!uploadId) {
      throw new DriverError("OneDrive 刷新分片会话失败：缺少 uploadId", {
        status: 400,
        code: "UPLOAD_SESSION_INVALID",
        expose: true,
      });
    }

    // FS 分片上传链路依赖 upload_sessions 表（控制面）
    if (!db || !mount?.storage_config_id) {
      throw new DriverError("OneDrive 刷新分片会话失败：缺少 db/mount 信息", {
        status: 400,
        code: "UPLOAD_SESSION_INVALID",
        expose: true,
        details: { hasDb: !!db, mountId: mount?.id ?? null, storageConfigId: mount?.storage_config_id ?? null },
      });
    }

    const sessionRow = await findUploadSessionById(db, { id: uploadId });
    if (!sessionRow || String(sessionRow.storage_type) !== String(this.type)) {
      throw new DriverError("OneDrive 上传会话不存在或不匹配，无法继续断点续传", {
        status: 404,
        code: "UPLOAD_SESSION_NOT_FOUND",
        expose: true,
      });
    }

    const providerUploadUrl = sessionRow.provider_upload_url ? String(sessionRow.provider_upload_url) : "";
    if (!providerUploadUrl) {
      throw new DriverError("OneDrive 上传会话缺少 provider uploadUrl，无法继续断点续传", {
        status: 400,
        code: "UPLOAD_SESSION_INVALID",
        expose: true,
      });
    }

    let sessionInfo = null;
    try {
      sessionInfo = await this.graphClient.getUploadSessionInfo(providerUploadUrl);
    } catch (error) {
      if (error?.status === 404 || error?.details?.code === "itemNotFound") {
        try {
          await updateUploadSessionById(db, {
            id: String(uploadId),
            storageType: this.type,
            status: "error",
            errorCode: "UPLOAD_SESSION_NOT_FOUND",
            errorMessage: "OneDrive upload session not found or expired",
          });
        } catch (e) {
          console.warn("[OneDriveStorageDriver] 标记 upload_sessions 会话为失效失败:", e);
        }

        throw new DriverError("OneDrive 上传会话不存在或已过期，无法继续断点续传", {
          status: 404,
          code: "UPLOAD_SESSION_NOT_FOUND",
          expose: true,
        });
      }

      console.warn("[OneDriveStorageDriver] 获取 uploadSession 信息失败，将回退为旧会话信息:", error);
      sessionInfo = null;
    }

    try {
      const ranges = Array.isArray(sessionInfo?.nextExpectedRanges) ? sessionInfo.nextExpectedRanges : null;
      const firstRange = ranges && ranges.length > 0 ? String(ranges[0]) : null;
      let bytesUploaded = null;

      if (firstRange) {
        const startStr = firstRange.split("-")[0];
        const parsed = Number.parseInt(startStr, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
          bytesUploaded = parsed;
        }
      }

      const expiresAt = sessionInfo?.expirationDateTime ? String(sessionInfo.expirationDateTime) : null;
      await updateUploadSessionById(db, {
        id: String(uploadId),
        storageType: this.type,
        status: "uploading",
        bytesUploaded: typeof bytesUploaded === "number" && Number.isFinite(bytesUploaded) ? bytesUploaded : (Number(sessionRow.bytes_uploaded) || 0),
        nextExpectedRange: firstRange ?? (sessionRow.next_expected_range || null),
        expiresAt,
      });
    } catch (e) {
      console.warn("[OneDriveStorageDriver] 刷新 upload_sessions 状态失败（可忽略）:", e);
    }

    return {
      success: true,
      uploadId: String(uploadId),
      strategy: "single_session",
      policy,
      session: {
        uploadUrl: providerUploadUrl,
        expirationDateTime: sessionInfo?.expirationDateTime || null,
        nextExpectedRanges: sessionInfo?.nextExpectedRanges || null,
      },
    };
  }

  // ========== 基础方法 ==========

  /**
   * 基础存在性检查
   * @param {string} subPath
   * @param {Object} _ctx 上下文选项（保留用于接口一致性）
   * @returns {Promise<boolean>}
   */
  async exists(subPath, _ctx = {}) {
    this._ensureInitialized();

    const remotePath = subPath;

    try {
      await this.graphClient.getItem(remotePath || "");
      return true;
    } catch (error) {
      if (error.status === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * 获取存储驱动统计信息
   * @returns {Promise<Object>}
   */
  async getStats() {
    this._ensureInitialized();

    const base = {
      type: this.type,
      capabilities: this.capabilities,
      initialized: this.initialized,
      region: this.region,
      timestamp: new Date().toISOString(),
    };

    if (!this.enableDiskUsage) {
      return {
        ...base,
        supported: false,
        message: "OneDrive 磁盘占用统计未启用（enable_disk_usage = false）",
      };
    }

    // 上游配额（quota）读取
    try {
      const drive = await this.graphClient.getDrive({ selectQuotaOnly: true });
      const quota = drive?.quota || null;
      if (!quota || typeof quota !== "object") {
        return {
          ...base,
          supported: false,
          message: "OneDrive 未返回配额信息（quota）",
        };
      }

      const parseQuotaNumber = (value) => {
        if (value == null) return null;
        const n = Number.parseInt(String(value), 10);
        return Number.isFinite(n) && n >= 0 ? n : null;
      };

      const totalBytes = parseQuotaNumber(quota.total);
      const remainingBytes = parseQuotaNumber(quota.remaining);
      const deletedBytes = parseQuotaNumber(quota.deleted);
      const usedBytes = parseQuotaNumber(quota.used) ?? (totalBytes != null && remainingBytes != null ? Math.max(0, totalBytes - remainingBytes) : null);
      const state = quota.state != null ? String(quota.state) : null;

      let usagePercent = null;
      if (totalBytes && usedBytes != null && totalBytes > 0) {
        usagePercent = Math.min(100, Math.round((usedBytes / totalBytes) * 100));
      }

      return {
        ...base,
        supported: true,
        quota: {
          raw: quota,
          totalBytes,
          usedBytes,
          remainingBytes,
          deletedBytes,
          state,
          usagePercent,
        },
      };
    } catch (error) {
      return {
        ...base,
        supported: false,
        message: error?.message || String(error),
      };
    }
  }

  // ========== 私有辅助方法 ==========

  /**
   * 将 Graph driveItem 的 parentReference.path 映射到 FS 视图下的父路径
   * - 利用挂载路径 mountPath 构造统一的 /mount/subDir 形式
   * - 不再依赖 root_folder，直接按 OneDrive 根进行映射
   *
   * @param {Object} item Graph API driveItem
   * @param {string} mountPath 规范化后的挂载路径（无结尾斜杠，至少为 "/"）
   * @param {string|null} scopedBasePath 搜索限定路径（FS 视图下，目录级别，无结尾斜杠）
   * @returns {string|null} FS 视图下的父路径（不含文件名）；若应过滤则返回 null
   */
  _resolveFsParentPathForItem(item, mountPath, scopedBasePath) {
    const parentDrivePath = item?.parentReference?.path || "/drive/root:";
    const prefix = "/drive/root:";
    let relativeDir = "";

    if (parentDrivePath.startsWith(prefix)) {
      // 形如 "/drive/root:/cloudpaste/subdir" → "/cloudpaste/subdir"
      relativeDir = parentDrivePath.slice(prefix.length);
    }

    if (relativeDir) {
      relativeDir = relativeDir.replace(/^\/+|\/+$/g, "").replace(/[\\\/]+/g, "/");
    }

    // 直接以 OneDrive 根为基准映射到挂载路径
    const subPathFromRoot = relativeDir;
    let fsParentPath = mountPath || "/";
    if (subPathFromRoot) {
      fsParentPath = `${fsParentPath}/${subPathFromRoot}`;
    }

    fsParentPath = fsParentPath.replace(/\/+/g, "/");
    if (!fsParentPath.startsWith("/")) {
      fsParentPath = `/${fsParentPath}`;
    }

    if (scopedBasePath) {
      const base = scopedBasePath.replace(/\/+$/g, "") || "/";
      if (!(fsParentPath === base || fsParentPath.startsWith(`${base}/`))) {
        return null;
      }
    }

    return fsParentPath;
  }

  /**
   * 将 Graph API driveItem 转换为标准文件信息格式
   * @param {Object} item Graph API driveItem
   * @param {string} parentPath 父路径
   * @param {Object} mount 挂载信息
   * @param {D1Database} [db] 数据库实例（用于文件类型检测）
   */
  async _formatDriveItem(item, parentPath, mount, db) {
    const isDirectory = !!item.folder;
    const name = item.name;
    const path = parentPath ? `${parentPath}/${name}`.replace(/[\\/]+/g, "/") : name;

    // 统一目录路径约定：目录在 FS 视图中始终以斜杠结尾
    const displayPath =
      isDirectory && typeof path === "string" && !path.endsWith("/") ? `${path}/` : path;

    const size = isDirectory ? null : Number(item.size ?? 0);
    const modified = item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null;
    const mimetype = isDirectory ? null : (item.file?.mimeType || getMimeTypeFromFilename(name));

    const info = await buildFileInfo({
      fsPath: displayPath,
      name,
      isDirectory,
      size,
      modified,
      mimetype,
      mount,
      storageType: this.type,
      db,
    });

    return {
      ...info,
      // OneDrive 特有字段（可选）
      webUrl: item.webUrl || null,
      downloadUrl: item["@microsoft.graph.downloadUrl"] || null,
    };
  }
}
