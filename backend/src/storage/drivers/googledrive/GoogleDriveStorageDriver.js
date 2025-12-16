/**
 * GoogleDriveStorageDriver
 *
 * Google Drive 存储驱动实现
 * - 基于 Google Drive v3 API 实现文件操作
 * - 支持 READER/WRITER/ATOMIC/PROXY/SEARCH/DIRECT_LINK 能力（首版）
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
import { GoogleDriveAuthManager } from "./GoogleDriveAuthManager.js";
import { GoogleDriveApiClient } from "./GoogleDriveApiClient.js";
import { DriverError, ValidationError } from "../../../http/errors.js";
import { FILE_TYPES, FILE_TYPE_NAMES } from "../../../constants/index.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";
import { isDirectoryPath } from "../../fs/utils/PathResolver.js";
import { GoogleDriveUploadOperations } from "./GoogleDriveUploadOperations.js";
import { buildFileInfo } from "../../utils/FileInfoBuilder.js";
import { createHttpStreamDescriptor } from "../../streaming/StreamDescriptorUtils.js";
import {
  SHARED_WITH_ME_SEGMENT,
  isSharedWithMePath,
  resolveSharedWithMePath,
  listSharedWithMeDirectory,
  injectSharedWithMeEntry,
} from "./GoogleDriveSharedView.js";


export class GoogleDriveStorageDriver extends BaseDriver {
  /**
   * @param {Object} config  存储配置对象
   * @param {string} encryptionSecret 加密密钥
   */
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "GOOGLE_DRIVE";
    this.encryptionSecret = encryptionSecret;

    // 能力：READER/WRITER/ATOMIC/PROXY/SEARCH/MULTIPART
    this.capabilities = [
      CAPABILITIES.READER,
      CAPABILITIES.WRITER,
      CAPABILITIES.ATOMIC,
      CAPABILITIES.PROXY,
      CAPABILITIES.SEARCH,
      CAPABILITIES.MULTIPART,
    ];

    // 配置字段
    this.rootId = config.root_id || "root";
    this.enableDiskUsage = Boolean(config.enable_disk_usage);
    this.useOnlineApi = Boolean(config.use_online_api);
    this.apiAddress = config.api_address || null;
    this.clientId = config.client_id || null;
    this.clientSecret = config.client_secret || null;
    this.refreshToken = config.refresh_token || "";
    this.enableSharedView = config.enable_shared_view !== false;

    // 内部组件（延迟初始化）
    this.authManager = null;
    this.apiClient = null;
    this.uploadOps = null;
  }

  /**
   * 初始化存储驱动
   * - 创建 AuthManager 和 ApiClient
   * - 验证 token 可用性
   */
  async initialize() {
    this.authManager = new GoogleDriveAuthManager({
      useOnlineApi: this.useOnlineApi,
      apiAddress: this.apiAddress,
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      refreshToken: this.refreshToken,
      rootId: this.rootId,
      disableDiskUsage: !this.enableDiskUsage,
      logger: console,
    });

    this.apiClient = new GoogleDriveApiClient({
      authManager: this.authManager,
    });

    try {
      await this.authManager.getAccessToken();
    } catch (error) {
      const reason = error?.message || "未知错误";
      throw new DriverError(`Google Drive 驱动初始化失败：无法获取访问令牌（${reason}）`, {
        status: 500,
        cause: error,
      });
    }

    // 初始化上传操作模块（分片上传相关逻辑委托给该模块）
    this.uploadOps = new GoogleDriveUploadOperations(this);

    this.initialized = true;
  }

  // ========== 路径与 Drive ID 映射辅助 ==========

  /**
   * 将挂载视图路径映射为 Drive 内部路径片段数组
   * - 按照 "/" 切分并过滤空片段
   * @param {string} path
   * @returns {string[]}
   */
  _splitPath(path) {
    if (!path) return [];
    return path.split("/").filter(Boolean);
  }

  /**
   * 通过路径解析到最终 fileId
   * - rootId 对应挂载根目录
   * - 其余片段依次通过 listFiles(name = segment) 方式向下解析
   * - 该实现假设同一目录下名称唯一（与大多数场景一致）
   *
   * @param {string} path 挂载视图下的路径
   * @param {Object} options 上下文选项（mount/subPath）
   * @returns {Promise<{ fileId: string, isDirectory: boolean, name: string, driveItem: any | null }>}
   */
  async _resolvePathToFileId(path, options = {}) {
    this._ensureInitialized();
    const { subPath } = options;
    const effectivePath = typeof subPath === "string" ? subPath : path;

    const segments = this._splitPath(effectivePath || "");

    // sharedWithMe 虚拟视图路径：交由独立模块解析，便于按需开启/删除
    if (this.enableSharedView && isSharedWithMePath(segments)) {
      const resolved = await resolveSharedWithMePath(segments, this.apiClient);
      if (resolved) {
        return resolved;
      }
    }

    // 默认路径解析逻辑：从 rootId 出发按名称逐级向下解析
    const segmentsForNormal = segments;
    let currentId = this.rootId || "root";
    let lastItem = null;

    // 根路径特殊处理：不调用 /files/root，直接返回目录信息
    if (segmentsForNormal.length === 0) {
      return {
        fileId: currentId,
        isDirectory: true,
        name: "",
        driveItem: null,
      };
    }

    for (const segment of segmentsForNormal) {
      const q = `'${currentId}' in parents and name = '${segment.replace(/'/g, "\\'")}' and trashed = false`;
      const res = await this.apiClient.listFiles(currentId, { q, pageSize: 2 });
      const files = Array.isArray(res.files) ? res.files : [];
      if (files.length === 0) {
        throw new DriverError(`指定路径不存在: ${effectivePath}`, {
          status: 404,
          code: "DRIVER_ERROR.GDRIVE.NOT_FOUND",
        });
      }
      lastItem = files[0];
      currentId = lastItem.id;
    }

    const isDirectory = lastItem.mimeType === "application/vnd.google-apps.folder";
    return {
      fileId: currentId,
      isDirectory,
      name: lastItem.name,
      driveItem: lastItem,
    };
  }

  /**
   * 在 storage-first 场景下，按给定子路径确保目录链存在
   * - 仅用于对象存储视角（分享上传等），不会影响 FS 挂载视图
   * - 从 rootId 出发，逐级查找/创建子目录
   * @param {string} dirSubPath 目录子路径（如 /foo/bar）
   * @returns {Promise<string>} 最终目录的 fileId
   */
  async _ensureDirectoryChainForStorage(dirSubPath) {
    this._ensureInitialized();
    const segments = this._splitPath(dirSubPath || "");
    if (segments.length === 0) {
      return this.rootId || "root";
    }

    let currentId = this.rootId || "root";
    for (const segment of segments) {
      const q = `'${currentId}' in parents and name = '${segment.replace(/'/g, "\\'")}' and trashed = false`;
      const res = await this.apiClient.listFiles(currentId, { q, pageSize: 2 });
      const files = Array.isArray(res.files) ? res.files : [];

      if (files.length === 0) {
        // 不存在则创建目录
        const folder = await this.apiClient.createFolder(currentId, segment);
        currentId = folder.id;
      } else {
        const item = files[0];
        const isDir = item.mimeType === "application/vnd.google-apps.folder";
        if (!isDir) {
          throw new DriverError("目标父路径不是目录", { status: 400 });
        }
        currentId = item.id;
      }
    }

    return currentId;
  }

  // ========== READER 能力：listDirectory / getFileInfo / downloadFile ==========

  /**
   * 列出目录内容
   * @param {string} path    挂载视图下的路径
   * @param {Object} options 上下文选项（mount/subPath/db/userType 等）
   */
  async listDirectory(path, options = {}) {
    this._ensureInitialized();
    const { mount, subPath, db } = options;
    const effectivePath = typeof subPath === "string" ? subPath : path;

    const segments = this._splitPath(effectivePath || "");

    // sharedWithMe 虚拟目录：路径以 __shared_with_me__ 开头时走专用分支
    if (this.enableSharedView && isSharedWithMePath(segments)) {
      return await listSharedWithMeDirectory({
        path,
        segments,
        apiClient: this.apiClient,
        mount,
        db,
      });
    }

    const { fileId, isDirectory } = await this._resolvePathToFileId(effectivePath || "", options);
    if (!isDirectory) {
      throw new DriverError("目标路径不是目录", { status: 400 });
    }

    const res = await this.apiClient.listFiles(fileId, { pageSize: 1000 });
    const files = Array.isArray(res.files) ? res.files : [];

    const formattedItems = await Promise.all(
      files.map(async (item) => {
        const isDir = item.mimeType === "application/vnd.google-apps.folder";
        const name = item.name;

        // 使用挂载视图路径作为父路径，保证子项 path 始终带上挂载前缀（例如 /google/xxx）
        const parentPath =
          typeof path === "string" && path.length > 0 ? path.replace(/\/+$/, "") : "";
        let childPath = `${parentPath}/${name}`.replace(/[\\/+]+/g, "/");
        if (isDir && typeof childPath === "string" && !childPath.endsWith("/")) {
          childPath = `${childPath}/`;
        }

        const size = isDir ? 0 : Number(item.size || 0);
        const modified = item.modifiedTime ? new Date(item.modifiedTime) : null;
        const mimetype = isDir ? "application/x-directory" : item.mimeType || null;

        const info = await buildFileInfo({
          fsPath: childPath,
          name,
          isDirectory: isDir,
          size,
          modified,
          mimetype,
          mount,
          storageType: this.type,
          db,
        });

        return info;
      }),
    );

    const isRoot = !effectivePath || effectivePath === "/" || effectivePath === "";

    // 在挂载根目录下注入一个虚拟的 sharedWithMe 目录入口
    if (isRoot && this.enableSharedView) {
      injectSharedWithMeEntry({ path, mount, items: formattedItems });
    }

    return {
      path,
      type: "directory",
      isRoot,
      isVirtual: false,
      mount_id: mount?.id,
      storage_type: this.type,
      items: formattedItems,
    };
  }

  /**
   * 获取文件或目录信息
   * @param {string} path    挂载视图下的路径
   * @param {Object} options 上下文选项（mount/subPath/db/userType/userId/request 等）
   */
  async getFileInfo(path, options = {}) {
    this._ensureInitialized();
    const { mount, subPath, db } = options;
    const effectivePath = typeof subPath === "string" ? subPath : path;

    const { driveItem, name, isDirectory } = await this._resolvePathToFileId(effectivePath || "", options);

    // 根路径场景下 driveItem 可能为 null，此时构造一个虚拟目录信息
    const effectiveName = name || (mount?.mount_path ? mount.mount_path.replace(/^\/+/, "") || "root" : "root");
    const isDir = isDirectory;
    const finalPath =
      isDir && typeof path === "string" && !path.endsWith("/") ? `${path}/` : path;

    const size = isDir ? 0 : Number(driveItem?.size || 0);
    const modified = driveItem?.modifiedTime ? new Date(driveItem.modifiedTime) : null;
    const mimetype = isDir ? "application/x-directory" : driveItem?.mimeType || null;

    return await buildFileInfo({
      fsPath: finalPath,
      name: effectiveName,
      isDirectory: isDir,
      size,
      modified,
      mimetype,
      mount,
      storageType: this.type,
      db,
    });
  }

  /**
   * 下载文件，返回 StorageStreamDescriptor
   * @param {string} path    挂载视图下的路径
   * @param {Object} options 上下文选项（mount/subPath/db/request 等）
   * @returns {Promise<import("../../streaming/types.js").StorageStreamDescriptor>}
   */
  async downloadFile(path, options = {}) {
    this._ensureInitialized();
    const { subPath } = options;
    const effectivePath = typeof subPath === "string" ? subPath : path;

    const { fileId, isDirectory, driveItem } = await this._resolvePathToFileId(effectivePath || "", options);
    if (isDirectory) {
      throw new DriverError("无法下载目录", { status: 400 });
    }

    const size = driveItem.size ? Number(driveItem.size) : null;
    const contentType = driveItem.mimeType || "application/octet-stream";
    const etag = driveItem.etag || null;
    const lastModified = driveItem.modifiedTime ? new Date(driveItem.modifiedTime) : null;

    return createHttpStreamDescriptor({
      size,
      contentType,
      etag,
      lastModified,
      supportsRange: true,
      fetchResponse: async (signal) => {
        return await this.apiClient.downloadFileResponse(fileId, { signal });
      },
      fetchRangeResponse: async (signal, rangeHeader) => {
        return await this.apiClient.downloadFileResponse(fileId, { signal, rangeHeader });
      },
    });
  }

  // ========== WRITER / ATOMIC 能力：uploadFile / createDirectory / remove / rename / copy ==========

  /**
   * 统一上传入口（文件 / 流）
   * @param {string} path          目标路径（挂载视图或 storage-first 视图）
   * @param {any} fileOrStream     数据源（ReadableStream/Node Stream/Buffer/File/Blob/string 等）
   * @param {Object} options       上下文选项（mount/subPath/db/filename/contentType/contentLength 等）
   */
  async uploadFile(path, fileOrStream, options = {}) {
    this._ensureInitialized();
    const { subPath, mount, contentType, contentLength, filename } = options;

    // 统一从 subPath 推导目录与文件名：
    // - subPath 为空或 "/" 视为根目录
    // - subPath 以 "/" 结尾视为目录路径
    // - 其它情况视为完整文件路径，目录为其父路径
    let dirSubPath = "/";
    if (typeof subPath === "string") {
      const normalized = subPath || "/";
      if (normalized === "/") {
        dirSubPath = "/";
      } else if (normalized.endsWith("/")) {
        dirSubPath = normalized;
      } else {
        const segments = normalized.split("/").filter(Boolean);
        dirSubPath = segments.length <= 1 ? "/" : `/${segments.slice(0, -1).join("/")}`;
      }
    }

    const fileName =
      filename ||
      (typeof subPath === "string" && !subPath.endsWith("/")
        ? subPath.split("/").filter(Boolean).pop() || "unnamed"
        : typeof path === "string"
          ? path.split("/").filter(Boolean).pop() || "unnamed"
          : "unnamed");

    // 目录子路径为空或根时，parentId 指向 rootId，否则解析为对应目录
    let parentId = this.rootId || "root";
    if (dirSubPath && dirSubPath !== "/" && dirSubPath !== "") {
      if (mount) {
        // FS 挂载视图：严格要求目录已存在
        const { fileId, isDirectory } = await this._resolvePathToFileId(dirSubPath, {
          subPath: dirSubPath,
          mount,
        });
        if (!isDirectory) {
          throw new DriverError("目标父路径不是目录", { status: 400 });
        }
        parentId = fileId;
      } else {
        // storage-first 视图（分享上传等）：按目录链自动创建缺失目录
        parentId = await this._ensureDirectoryChainForStorage(dirSubPath);
      }
    }

    const metadata = {
      name: fileName,
      parents: [parentId],
      mimeType: contentType || "application/octet-stream",
    };

    // 存储路径使用挂载视图路径 + 文件名，便于前端后续刷新
    const storagePath =
      typeof path === "string" && path.length > 0
        ? (isDirectoryPath(path) ? `${path}${fileName}` : `${path}/${fileName}`)
        : `/${fileName}`;

    // 特殊处理：空文件（contentLength === 0）直接通过 metadata 创建
    if (typeof contentLength === "number" && Number.isFinite(contentLength) && contentLength === 0) {
      const createUrl = new URL("files", "https://www.googleapis.com/drive/v3/");
      createUrl.searchParams.set("supportsAllDrives", "true");
      createUrl.searchParams.set("includeItemsFromAllDrives", "true");

      const json = await this.authManager.withAccessToken(async (token) => {
        const res = await fetch(createUrl.toString(), {
          method: "POST",
          redirect: "follow",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(metadata),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new DriverError("Google Drive 创建空文件失败", {
            status: res.status,
            details: { response: text },
          });
        }

        const text = await res.text();
        return text ? JSON.parse(text) : null;
      });

      return {
        success: true,
        storagePath,
        message: json?.id ? `created-empty:${json.id}` : undefined,
      };
    }

    // 其余情况：统一采用 resumable upload + 单次 PUT
    const initUrl = new URL("files", "https://www.googleapis.com/upload/drive/v3/");
    initUrl.searchParams.set("uploadType", "resumable");
    initUrl.searchParams.set("supportsAllDrives", "true");
    initUrl.searchParams.set("includeItemsFromAllDrives", "true");

    const uploadUrl = await this.authManager.withAccessToken(async (token) => {
      const res = await fetch(initUrl.toString(), {
        method: "POST",
        redirect: "follow",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Upload-Content-Type": metadata.mimeType,
        },
        body: JSON.stringify(metadata),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new DriverError("初始化 Google Drive 上传会话失败", {
          status: res.status,
          details: { response: text },
        });
      }

      const location = res.headers.get("location") || res.headers.get("Location");
      if (!location) {
        throw new DriverError("Google Drive 上传会话未返回 Location", { status: 500 });
      }
      return location;
    });

    if (typeof contentLength !== "number" || !Number.isFinite(contentLength) || contentLength < 0) {
      throw new DriverError("GoogleDriveStorageDriver.uploadFile 需要有效的 contentLength", {
        status: 400,
      });
    }

    const body = fileOrStream;
    const end = contentLength - 1;

    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(contentLength),
        "Content-Range": `bytes 0-${end}/${contentLength}`,
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new DriverError("Google Drive 上传文件失败", {
        status: res.status,
        details: { response: text },
      });
    }

    const text = await res.text();
    const json = text ? JSON.parse(text) : null;

    return {
      success: true,
      storagePath,
      message: json?.id ? `uploaded:${json.id}` : undefined,
    };
  }

  /**
   * - 基于 Google Drive v3 files.update + uploadType=media 实现
   * @param {string} path          文件路径（挂载视图）
   * @param {string|Uint8Array|ArrayBuffer} content 新内容
   * @param {Object} options       上下文选项（mount/subPath/db/userIdOrInfo/userType/contentType 等）
   */
  async updateFile(path, content, options = {}) {
    this._ensureInitialized();
    const { subPath } = options;
    const effectivePath = typeof subPath === "string" ? subPath : path;

    const { fileId, isDirectory, driveItem } = await this._resolvePathToFileId(
      effectivePath || "",
      options,
    );
    if (isDirectory) {
      throw new DriverError("无法更新目录内容", { status: 400 });
    }

    if (
      typeof content !== "string" &&
      !(content instanceof Uint8Array) &&
      !(content instanceof ArrayBuffer)
    ) {
      throw new DriverError("GoogleDriveStorageDriver.updateFile 仅支持字符串或二进制缓冲区内容", {
        status: 400,
      });
    }

    const body =
      typeof content === "string"
        ? content
        : content instanceof Uint8Array
          ? content
          : new Uint8Array(content);

    const contentType =
      options.contentType || driveItem?.mimeType || "application/octet-stream";

    const uploadUrl = new URL(
      `files/${encodeURIComponent(fileId)}`,
      "https://www.googleapis.com/upload/drive/v3/",
    );
    uploadUrl.searchParams.set("uploadType", "media");
    uploadUrl.searchParams.set("supportsAllDrives", "true");
    uploadUrl.searchParams.set("includeItemsFromAllDrives", "true");

    await this.authManager.withAccessToken(async (token) => {
      const res = await fetch(uploadUrl.toString(), {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": contentType,
        },
        body,
        redirect: "follow",
      });

      if (!res.ok) {
        const text = await res.text();
        throw new DriverError("Google Drive 更新文件内容失败", {
          status: res.status,
          details: { response: text },
        });
      }
    });

    return {
      success: true,
      path,
      message: "Google Drive 文件内容已更新",
    };
  }

  /**
   * 创建目录
   * @param {string} path    目录路径
   * @param {Object} options 上下文选项（mount/subPath/db 等）
   */
  async createDirectory(path, options = {}) {
    this._ensureInitialized();
    const { subPath } = options;
    const effectivePath = typeof subPath === "string" ? subPath : path;

    const segments = this._splitPath(effectivePath || "");
    if (segments.length === 0) {
      // 根目录视为总是存在
      return { success: true, path, alreadyExists: true };
    }

    const parentSegments = segments.slice(0, -1);
    const dirName = segments[segments.length - 1];
    const parentPath = parentSegments.length > 0 ? `/${parentSegments.join("/")}` : "/";

    const { fileId: parentId, isDirectory } = await this._resolvePathToFileId(parentPath, {
      subPath: parentPath,
    });
    if (!isDirectory) {
      throw new DriverError("目标父路径不是目录", { status: 400 });
    }

    try {
      await this.apiClient.createFolder(parentId, dirName);
      return {
        success: true,
        path,
        alreadyExists: false,
      };
    } catch (error) {
      // 当目录已存在或命名冲突时，GoogleDriveApiClient 会抛出 GoogleDriveApiError
      // 视为目录已存在并返回 alreadyExists: true
      const status = typeof error?.status === "number" ? error.status : undefined;
      const code = error?.code;

      if (
        status === 409 ||
        code === "GOOGLE_DRIVE_API_ERROR" ||
        code === "fileAlreadyExists" ||
        code === "alreadyExists"
      ) {
        return {
          success: true,
          path,
          alreadyExists: true,
        };
      }

      throw new DriverError(error?.message || "创建目录失败", {
        status: status || 500,
        cause: error,
        details: { path, parentPath, dirName },
      });
    }
  }

  /**
   * 删除单个路径
   * @param {string} path
   * @param {Object} options
   */
  async remove(path, options = {}) {
    this._ensureInitialized();
    const { subPath } = options;
    const effectivePath = typeof subPath === "string" ? subPath : path;

    const { fileId } = await this._resolvePathToFileId(effectivePath || "", options);
    await this.apiClient.deleteFile(fileId);
    return { success: true };
  }

  /**
   * 批量删除路径
   * @param {string[]} paths 需要删除的路径数组（挂载视图路径）
   * @param {Object} options 上下文选项（mount/subPath/db 等）
   */
  async batchRemoveItems(paths, options = {}) {
    this._ensureInitialized();

    if (!Array.isArray(paths) || paths.length === 0) {
      return { success: 0, failed: [], results: [] };
    }

    const results = [];
    const failed = [];
    let successCount = 0;

    const { mount, subPath } = options;

    for (const fsPath of paths) {
      try {
        // 这里需要为每个 FS 视图路径单独计算挂载内子路径，避免所有条目共用同一个 subPath
        const perSubPath = mount ? this._extractSubPath(fsPath, mount) : subPath || fsPath;

        await this.remove(fsPath, {
          ...options,
          subPath: perSubPath,
        });
        successCount += 1;
        results.push({ path: fsPath, success: true });
      } catch (error) {
        const message = error?.message || String(error);
        failed.push({ path: fsPath, error: message });
        results.push({ path: fsPath, success: false, error: message });
      }
    }

    return { success: successCount, failed, results };
  }

  /**
   * 从挂载视图完整路径中提取挂载内子路径
   * @param {string} fullPath 挂载视图完整路径（例如 /google/foo/bar.txt）
   * @param {Object} mount    挂载对象（包含 mount_path）
   * @returns {string} 子路径（以 / 开头）
   */
  _extractSubPath(fullPath, mount) {
    if (!fullPath) return "";
    if (mount?.mount_path && fullPath.startsWith(mount.mount_path)) {
      return fullPath.slice(mount.mount_path.length) || "/";
    }
    return fullPath.startsWith("/") ? fullPath : `/${fullPath}`;
  }

  /**
   * 基础存在性检查
   * - 用于上层在执行 copy/rename 等操作时进行 skipExisting 判断
   * - 若路径不存在或发生错误时返回 false，避免影响主流程
   * @param {string} path
   * @param {Object} options
   * @returns {Promise<boolean>}
   */
  async exists(path, options = {}) {
    this._ensureInitialized();
    const { subPath } = options;
    const effectivePath = typeof subPath === "string" ? subPath : path;

    // 挂载根路径视为始终存在
    if (!effectivePath || effectivePath === "/" || effectivePath === "") {
      return true;
    }

    try {
      await this._resolvePathToFileId(effectivePath || "", options);
      return true;
    } catch (error) {
      const status = typeof error?.status === "number" ? error.status : undefined;
      const code = error?.code;

      // _resolvePathToFileId 针对不存在路径会抛出 404 + DRIVER_ERROR.GDRIVE.NOT_FOUND
      if (status === 404 || code === "DRIVER_ERROR.GDRIVE.NOT_FOUND") {
        return false;
      }

      // 其它异常默认视为不存在，避免中断 skipExisting 流程
      return false;
    }
  }

  /**
   * stat 接口
   * @param {string} path
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async stat(path, options = {}) {
    return await this.getFileInfo(path, options);
  }

  /**
   * 重命名文件或目录
   */
  async renameItem(oldPath, newPath, options = {}) {
    this._ensureInitialized();
    const { subPath } = options;
    const effectiveOldPath = typeof subPath === "string" ? subPath : oldPath;

    const { fileId, driveItem } = await this._resolvePathToFileId(effectiveOldPath || "", options);
    const segments = this._splitPath(newPath || "");
    const newName = segments.length > 0 ? segments[segments.length - 1] : driveItem.name;

    await this.apiClient.updateMetadata(fileId, { name: newName });

    return {
      success: true,
      source: oldPath,
      target: newPath,
    };
  }

  /**
   * 复制单个文件/目录
   * @param {string} sourcePath 源路径（挂载视图路径）
   * @param {string} targetPath 目标路径（挂载视图路径）
   * @param {Object} options    上下文选项（mount/sourceSubPath/targetSubPath/db/userIdOrInfo/userType/...）
   */
  async copyItem(sourcePath, targetPath, options = {}) {
    this._ensureInitialized();

    const { mount, sourceSubPath, targetSubPath, db } = options;

    if (typeof sourceSubPath !== "string" || typeof targetSubPath !== "string") {
      throw new DriverError("Google Drive 复制缺少子路径上下文（sourceSubPath/targetSubPath）", {
        status: 500,
        details: { sourcePath, targetPath },
      });
    }

    const normalize = (p) =>
      (p || "")
        .replace(/^[/\\]+|[/\\]+$/g, "")
        .replace(/[\\/]+/g, "/");

    const srcSub = normalize(sourceSubPath);
    const dstSub = normalize(targetSubPath);

    const srcPathForResolve = srcSub ? `/${srcSub}` : "/";
    const { fileId: sourceFileId, isDirectory } = await this._resolvePathToFileId(srcPathForResolve, {
      subPath: srcPathForResolve,
      mount,
    });

    // 目录复制：在同一挂载的 Google Drive 内，直接通过 Drive API 递归复制目录结构
    if (isDirectory) {
      const targetSegments = dstSub.split("/").filter(Boolean);
      if (targetSegments.length === 0) {
        return {
          status: "failed",
          source: sourcePath,
          target: targetPath,
          message: "目标路径无效",
        };
      }

      const dirName = targetSegments[targetSegments.length - 1];
      const parentSegs = targetSegments.slice(0, -1);
      const parentSubPath = parentSegs.length > 0 ? `/${parentSegs.join("/")}` : "/";

      const { fileId: parentId, isDirectory: parentIsDir } = await this._resolvePathToFileId(parentSubPath, {
        subPath: parentSubPath,
        mount,
      });

      if (!parentIsDir) {
        return {
          status: "failed",
          source: sourcePath,
          target: targetPath,
          message: "目标父路径不是目录",
        };
      }

      try {
        await this._copyDriveDirectoryRecursive({
          sourceDirId: sourceFileId,
          targetParentId: parentId,
          targetDirName: dirName,
        });

        return {
          status: "success",
          source: sourcePath,
          target: targetPath,
        };
      } catch (error) {
        return {
          status: "failed",
          source: sourcePath,
          target: targetPath,
          message: error?.message || String(error),
        };
      }
    }

    const segments = dstSub.split("/").filter(Boolean);
    if (segments.length === 0) {
      return {
        status: "failed",
        source: sourcePath,
        target: targetPath,
        message: "目标路径无效",
      };
    }

    const newName = segments[segments.length - 1];
    const parentSegs = segments.slice(0, -1);
    const parentSubPath = parentSegs.length > 0 ? `/${parentSegs.join("/")}` : "/";

    const { fileId: parentId, isDirectory: parentIsDir } = await this._resolvePathToFileId(parentSubPath, {
      subPath: parentSubPath,
      mount,
    });

    if (!parentIsDir) {
      return {
        status: "failed",
        source: sourcePath,
        target: targetPath,
        message: "目标父路径不是目录",
      };
    }

    try {
      await this.apiClient.copyFile(sourceFileId, {
        newName,
        parentId,
      });
      return {
        status: "success",
        source: sourcePath,
        target: targetPath,
      };
    } catch (error) {
      // 目标已存在或命名冲突等，返回 skipped 以便任务统计
      if (error?.status === 409 || error?.code === "conflict") {
        return {
          status: "skipped",
          source: sourcePath,
          target: targetPath,
          skipped: true,
          reason: "目标已存在或命名冲突",
        };
      }

      return {
        status: "failed",
        source: sourcePath,
        target: targetPath,
        message: error?.message || String(error),
      };
    }
  }

  /**
   * 递归复制 Google Drive 目录
   * - 在目标父目录下创建同名目录，并递归复制其中所有子目录与文件
   * @param {{ sourceDirId: string, targetParentId: string, targetDirName: string }} params
   */
  async _copyDriveDirectoryRecursive(params) {
    const { sourceDirId, targetParentId, targetDirName } = params;

    // 在目标父目录下创建根目录
    const created = await this.apiClient.createFolder(targetParentId, targetDirName);
    const targetDirId = created.id;

    // 深度优先遍历源目录
    let pageToken = undefined;
    while (true) {
      const res = await this.apiClient.listFiles(sourceDirId, {
        pageSize: 1000,
        pageToken,
      });
      const files = Array.isArray(res.files) ? res.files : [];

      for (const item of files) {
        const isDir = item.mimeType === "application/vnd.google-apps.folder";
        if (isDir) {
          await this._copyDriveDirectoryRecursive({
            sourceDirId: item.id,
            targetParentId: targetDirId,
            targetDirName: item.name,
          });
        } else {
          await this.apiClient.copyFile(item.id, {
            newName: item.name,
            parentId: targetDirId,
          });
        }
      }

      pageToken = res.nextPageToken;
      if (!pageToken) {
        break;
      }
    }
  }

  // ========== SEARCH 能力 ==========

  /**
   * 根据 Drive 文件项构造 FS 视图路径
   * - 利用 parents 链向上遍历到 rootId/root，并映射到挂载路径
   * @param {any} item
   * @param {Object} mount
   * @param {Map<string,string>} folderPathCache folderId -> FS 路径（目录）
   * @returns {Promise<string>} FS 视图路径（不保证目录以 / 结尾）
   */
  async _buildFsPathFromDriveItem(item, mount, folderPathCache) {
    const mountPath = (mount?.mount_path || "/").replace(/\/+$/g, "") || "/";
    const names = [item.name];
    let parentId =
      Array.isArray(item.parents) && item.parents.length > 0 ? item.parents[0] : null;

    // 向上遍历 parents 链，直到配置的 rootId 或顶层（My Drive / 共享盘根）
    while (parentId) {
      const cached = folderPathCache.get(parentId);
      if (cached) {
        const base = cached.replace(/\/+$/g, "") || "/";
        const rel = names.join("/");
        return `${base}/${rel}`.replace(/[\\/+]+/g, "/");
      }

      const parent = await this.apiClient.getFile(parentId, {
        fields: "id,name,parents",
      });

      const isConfiguredRoot =
        this.rootId && parent.id && String(parent.id) === String(this.rootId);
      const hasNoParents =
        !Array.isArray(parent.parents) || parent.parents.length === 0;

      // 到达 rootId 或顶层（如 My Drive 根目录）时停止，但不把该层名称加入路径
      if (isConfiguredRoot || hasNoParents) {
        break;
      }

      names.unshift(parent.name);
      parentId =
        Array.isArray(parent.parents) && parent.parents.length > 0
          ? parent.parents[0]
          : null;
    }

    const relPath = names.join("/");
    const full = `${mountPath}/${relPath}`.replace(/[\\/+]+/g, "/");
    return full;
  }

  /**
   * 搜索文件/目录
   * @param {string} query
   * @param {Object} options
   */
  async search(query, options = {}) {
    this._ensureInitialized();
    const { mount, searchPath = null, maxResults = 1000, db } = options;

    if (!mount) {
      throw new ValidationError("Google Drive 搜索需要提供挂载点信息");
    }

    const trimmedQuery = String(query || "").trim();
    if (!trimmedQuery) {
      throw new ValidationError("搜索关键字不能为空");
    }

    const q = `name contains '${trimmedQuery.replace(/'/g, "\\'")}' and trashed = false`;
    const res = await this.apiClient.listFiles(this.rootId, { q, pageSize: maxResults });
    const files = Array.isArray(res.files) ? res.files : [];

    const folderPathCache = new Map();
    const normalizedSearchPath = searchPath
      ? (searchPath.replace(/\/+$/g, "") || "/")
      : null;

    const results = [];

    for (const item of files) {
      const isDirectory = item.mimeType === "application/vnd.google-apps.folder";
      const name = item.name;
      const size = isDirectory ? 0 : Number(item.size || 0);
      const modified = item.modifiedTime ? new Date(item.modifiedTime) : null;
      const mimetype = isDirectory ? "application/x-directory" : item.mimeType || null;

      const rawFsPath = await this._buildFsPathFromDriveItem(
        item,
        mount,
        folderPathCache,
      );
      let finalPath = rawFsPath;
      if (isDirectory && !finalPath.endsWith("/")) {
        finalPath = `${finalPath}/`;
      }

      if (
        normalizedSearchPath &&
        !finalPath.startsWith(
          normalizedSearchPath === "/" ? normalizedSearchPath : `${normalizedSearchPath}/`,
        )
      ) {
        continue;
      }

      const info = await buildFileInfo({
        fsPath: finalPath,
        name,
        isDirectory,
        size,
        modified,
        mimetype,
        mount,
        storageType: this.type,
        db,
      });

      results.push(info);
    }

    return results;
  }

  // ========== MULTIPART 能力委托（thin wrapper，委托给 GoogleDriveUploadOperations） ==========

  async initializeFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();
    return this.uploadOps.initializeFrontendMultipartUpload(subPath, options);
  }

  async completeFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();
    return this.uploadOps.completeFrontendMultipartUpload(subPath, options);
  }

  async abortFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();
    return this.uploadOps.abortFrontendMultipartUpload(subPath, options);
  }

  async listMultipartUploads(subPath = "", options = {}) {
    this._ensureInitialized();
    return this.uploadOps.listMultipartUploads(subPath, options);
  }

  async listMultipartParts(subPath, uploadId, options = {}) {
    this._ensureInitialized();
    return this.uploadOps.listMultipartParts(subPath, uploadId, options);
  }

  async refreshMultipartUrls(subPath, uploadId, partNumbers, options = {}) {
    this._ensureInitialized();
    return this.uploadOps.refreshMultipartUrls(subPath, uploadId, partNumbers, options);
  }

  async proxyFrontendMultipartChunk(sessionRow, body, options = {}) {
    this._ensureInitialized();
    return this.uploadOps.proxyFrontendMultipartChunk(sessionRow, body, options);
  }

  // ========== DIRECT_LINK / PROXY 能力 ==========

  async generateDownloadUrl(path, options = {}) {
    // 出于安全考虑，一般不直接暴露 webContentLink，此处仅返回内部使用的 alt=media URL
    const { subPath } = options;
    const effectivePath = typeof subPath === "string" ? subPath : path;
    const { fileId, isDirectory } = await this._resolvePathToFileId(effectivePath || "", options);
    if (isDirectory) {
      throw new DriverError("无法为目录生成直链", { status: 400 });
    }

    const url = new URL(`files/${encodeURIComponent(fileId)}`, "https://www.googleapis.com/drive/v3/");
    url.searchParams.set("alt", "media");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    // 官方文档：在可能被标记为存在风险的文件上，显式确认风险并允许下载
    url.searchParams.set("acknowledgeAbuse", "true");
    return {
      url: url.toString(),
      type: "direct",
    };
  }

  async generateProxyUrl(path, options = {}) {
    const { request, download = false, channel = "web" } = options;

    // 使用统一的代理 URL 构建逻辑，与 OneDrive/S3 等驱动保持一致
    const url = buildFullProxyUrl(request, path, download);
    return {
      url,
      type: "proxy",
      channel,
    };
  }

  // ========== 可选方法：存储统计信息 ==========

  /**
   * 获取存储驱动统计信息（可选实现）
   * - 对标 Google Drive about.get(storageQuota) 接口
   * - 当 disable_disk_usage = true 时，仅返回基础信息并标记不支持
   * @returns {Promise<Object>} 统计信息
   */
  async getStats() {
    this._ensureInitialized();

    const base = {
      type: this.type,
      capabilities: this.capabilities,
      initialized: this.initialized,
      rootId: this.rootId,
      enableDiskUsage: this.enableDiskUsage,
      useOnlineApi: this.useOnlineApi,
    };

    if (!this.enableDiskUsage) {
      return {
        ...base,
        supported: false,
        message: "Google Drive 磁盘占用统计未启用（enable_disk_usage = false）",
      };
    }

    try {
      const quota = await this.apiClient.getQuota();
      if (!quota) {
        return {
          ...base,
          supported: false,
          message: "Google Drive 未返回存储配额信息",
        };
      }

      const parseQuotaNumber = (value) => {
        if (value == null) return null;
        const n = Number.parseInt(String(value), 10);
        return Number.isFinite(n) && n >= 0 ? n : null;
      };

      const totalBytes = parseQuotaNumber(quota.limit);
      const usedBytes = parseQuotaNumber(quota.usage) ?? parseQuotaNumber(quota.usageInDrive);
      const driveBytes = parseQuotaNumber(quota.usageInDrive);
      const trashBytes = parseQuotaNumber(quota.usageInDriveTrash);

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
          driveBytes,
          trashBytes,
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
}
