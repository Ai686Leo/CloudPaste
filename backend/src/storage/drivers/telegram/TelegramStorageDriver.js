/**
 * TelegramStorageDriver
 *
 * - share（storage-first）上传后，返回 storagePath = vfs:<vfs_node_id>
 * - share 下载/删除通过 vfs:<id> 反查 vfs_nodes，再按 manifest 下载/删除索引
 *
 * - 本驱动当前不做“真实删除 Telegram 消息/文件”，只做索引层删除
 * - 大文件分片上传/断点续传在 Multipart 阶段（upload_sessions + upload_parts）
 */

import { ApiStatus, UserType } from "../../../constants/index.js";
import { ValidationError, NotFoundError, DriverError } from "../../../http/errors.js";
import { BaseDriver, CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { buildFileInfo, inferNameFromPath } from "../../utils/FileInfoBuilder.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";
import { getEffectiveMimeType } from "../../../utils/fileUtils.js";
import { decryptIfNeeded } from "../../../utils/crypto.js";
import { VfsNodesRepository, VFS_ROOT_PARENT_ID } from "../../../repositories/VfsNodesRepository.js";
import { TelegramMultipartOperations } from "./TelegramMultipartOperations.js";
import { getCachedTelegramFileInfo, setCachedTelegramFileInfo } from "./TelegramFileInfoCache.js";
import {
  batchRemoveItems as telegramBatchRemoveItems,
  buildBotApiUrl as telegramBuildBotApiUrl,
  buildBotFileUrl as telegramBuildBotFileUrl,
  copyItem as telegramCopyItem,
  deleteObjectByStoragePath as telegramDeleteObjectByStoragePath,
  getFileInfo as telegramGetFileInfo,
  normalizeApiBaseUrl,
  normalizePartList,
  renameItem as telegramRenameItem,
  resolveUploadDirAndName,
  safeJsonParse,
  sendDocument as telegramSendDocument,
  splitDirAndName,
  stripTrailingSlash,
  toPosixPath,
} from "./TelegramOperations.js";
import { resolveOwner } from "../../fs/utils/OwnerResolver.js";
import { smartWrapStreamWithByteSlice } from "../../streaming/ByteSliceStream.js";

const VFS_STORAGE_PATH_PREFIX = "vfs:";
// 直传限制（share/表单/非分片 FS 上传）
// - official（未勾选自建）：按“能下载/能预览”的最保守限制走（20MB）
// - self_hosted（勾选自建）：不做硬限制
const TELEGRAM_DIRECT_UPLOAD_MAX_BYTES_OFFICIAL = 20 * 1024 * 1024;

// 调试用：展示TG代理上游地址
function maskTelegramBotTokenInUrl(url) {
  const s = String(url || "");
  if (!s) return s;

  const mask = (tokenLike) => {
    const t = String(tokenLike || "");
    if (!t) return t;
    if (t.length <= 10) return "***";
    return `${t.slice(0, 4)}…${t.slice(-4)}`;
  };

  // 覆盖 /bot<TOKEN>/... 与 /file/bot<TOKEN>/... 等形态
  return s.replace(/(\/bot)([^/]+)/g, (_m, pfx, token) => `${pfx}${mask(token)}`);
}

export class TelegramStorageDriver extends BaseDriver {
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "TELEGRAM";
    this.encryptionSecret = encryptionSecret;
    this.capabilities = [
      CAPABILITIES.READER,
      CAPABILITIES.WRITER,
      CAPABILITIES.PROXY,
      CAPABILITIES.MULTIPART,
      CAPABILITIES.ATOMIC,
    ];

    this.botToken = null;
    this.targetChatId = null;
    this.apiBaseUrl = null;
    this.botApiMode = "official";
    // 分片大小（用于“挂载浏览器”的断点续传/分片上传）
    // - 默认 15MB
    // - 由存储配置 part_size_mb 控制
    this.partSizeBytes = 15 * 1024 * 1024;
    // 直传大小上限（用于 share 流式/表单上传、以及非分片的 FS 上传）
    // - official：限制 20MB
    // - self_hosted：不限制
    this.directUploadMaxBytes = TELEGRAM_DIRECT_UPLOAD_MAX_BYTES_OFFICIAL;
    // 上传并发阀门（限制同一 storage_config 的并发 Telegram API 调用数量）
    this.uploadConcurrency = 2;
    // 上传后校验（发完再 getFile 校验 file_size，避免“回执成功但文件坏/大小不对”）
    this.verifyAfterUpload = true;

    // ========== MULTIPART 能力委托 ==========
    this.uploadOps = new TelegramMultipartOperations(this);
  }

  async initialize() {
    const botTokenEncrypted = this.config?.bot_token || this.config?.botToken;
    const botToken = await decryptIfNeeded(botTokenEncrypted, this.encryptionSecret);
    const rawTargetChatId = this.config?.target_chat_id ?? this.config?.targetChatId;
    const apiBaseUrl = normalizeApiBaseUrl(this.config?.endpoint_url);
    const partSizeMb = Number(this.config?.part_size_mb ?? 15);
    const uploadConcurrency = Number(this.config?.upload_concurrency ?? 2);
    const botApiMode = String(this.config?.bot_api_mode || "official").trim().toLowerCase();
    const verifyAfterUpload = this.config?.verify_after_upload;

    if (!botToken || typeof botToken !== "string") {
      throw new DriverError("TELEGRAM 驱动缺少必填配置 bot_token", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.TELEGRAM_INVALID_CONFIG",
        expose: true,
      });
    }
    if (rawTargetChatId === null || rawTargetChatId === undefined || String(rawTargetChatId).trim() === "") {
      throw new DriverError("TELEGRAM 驱动缺少必填配置 target_chat_id", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.TELEGRAM_INVALID_CONFIG",
        expose: true,
      });
    }
    const targetChatId = String(rawTargetChatId).trim();
    if (!/^-?\d+$/.test(targetChatId)) {
      throw new DriverError("TELEGRAM 驱动 target_chat_id 必须是纯数字字符串（例如 -100...）", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.TELEGRAM_INVALID_CONFIG",
        expose: true,
      });
    }

    this.botToken = botToken.trim();
    this.targetChatId = targetChatId;
    this.apiBaseUrl = apiBaseUrl;
    this.botApiMode = botApiMode === "self_hosted" ? "self_hosted" : "official";
    this.partSizeBytes = Number.isFinite(partSizeMb) && partSizeMb > 0 ? Math.floor(partSizeMb * 1024 * 1024) : 15 * 1024 * 1024;
    this.directUploadMaxBytes = this.botApiMode === "self_hosted" ? Infinity : TELEGRAM_DIRECT_UPLOAD_MAX_BYTES_OFFICIAL;
    this.uploadConcurrency = Number.isFinite(uploadConcurrency) && uploadConcurrency > 0 ? Math.floor(uploadConcurrency) : 2;
    this.verifyAfterUpload = verifyAfterUpload === false ? false : true;

    // 官方托管 Bot API 下，分片太大可能出现“能传不能下”的坑
    // - self_hosted 模式不限制
    if (this.botApiMode !== "self_hosted" && this.partSizeBytes > 20 * 1024 * 1024) {
      throw new DriverError("TELEGRAM 配置不合理：未勾选“自建 Bot API”时（official），part_size_mb 建议 ≤ 20（否则可能出现能上传但无法下载/预览）", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.TELEGRAM_INVALID_CONFIG",
        expose: true,
      });
    }

    this.initialized = true;
  }

  // ===== 基础契约 =====

  async exists(subPath, ctx = {}) {
    try {
      await this.stat(subPath, ctx);
      return true;
    } catch {
      return false;
    }
  }

  async stat(subPath, ctx = {}) {
    // 这里直接复用 getFileInfo 的查找逻辑
    return await this.getFileInfo(subPath, ctx);
  }

  // ===== PROXY 能力 =====

  async generateProxyUrl(subPath, ctx = {}) {
    const { request, download = false, channel = "web" } = ctx;
    const fsPath = ctx?.path;
    return {
      url: buildFullProxyUrl(request || null, fsPath, download),
      type: "proxy",
      channel,
    };
  }

  supportsProxyMode() {
    return true;
  }

  getProxyConfig() {
    return { enabled: true };
  }

  // ===== 内部：VFS scope / path =====

  _getScopeFromOptions(options = {}) {
    // Telegram 的 VFS scope 按 storage_config 维度（无挂载也能写）
    const mount = options?.mount || null;
    const scopeId = mount?.storage_config_id || this.config?.id || null;
    if (!scopeId) {
      throw new ValidationError("TELEGRAM: 缺少 scope_id（storage_config_id）");
    }
    return { scopeType: "storage_config", scopeId: String(scopeId) };
  }

  _getOwnerFromOptions(options = {}) {
    // 兼容：如果上层显式传入 ownerType/ownerId（例如内部调用），仍优先使用。
    const ownerType = options?.ownerType;
    const ownerId = options?.ownerId;
    if (ownerType && ownerId) {
      return { ownerType: String(ownerType), ownerId: String(ownerId) };
    }

    const { mount, userIdOrInfo, userType } = options || {};

    // 目录树归属“storage_config”，不是“挂载”。
    // 因此优先使用 storage_config.admin_id 作为稳定 owner
    // - 没有挂载时上传 -> 以后创建挂载也能看到
    // - 同一个 storage_config 可被多个挂载复用
    const configAdminId = this.config?.admin_id ? String(this.config.admin_id) : null;
    if (configAdminId) {
      return { ownerType: UserType.ADMIN, ownerId: configAdminId };
    }

    // 兜底：如果历史数据/特殊场景下 admin_id 为空，则退回 mount.created_by（挂载通常由管理员创建）
    const isTelegramMount = mount?.storage_type === this.type && !!mount;
    const mountCreatedBy = mount?.created_by ? String(mount.created_by) : null;
    if (isTelegramMount && mountCreatedBy) {
      return { ownerType: UserType.ADMIN, ownerId: mountCreatedBy };
    }

    // 最后兜底：按请求者身份映射
    return resolveOwner(userIdOrInfo, userType);
  }

  _isVfsStoragePath(path) {
    return typeof path === "string" && path.startsWith(VFS_STORAGE_PATH_PREFIX);
  }

  _parseVfsStoragePath(path) {
    if (!this._isVfsStoragePath(path)) return null;
    const id = String(path).slice(VFS_STORAGE_PATH_PREFIX.length).trim();
    return id || null;
  }

  // ===== READER 能力 =====

  async listDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    const db = ctx?.db || null;
    if (!db) throw new ValidationError("TELEGRAM.listDirectory: 缺少 db");

    const { mount } = ctx;
    const fsPath = ctx?.path;
    const normalizedSubPath = toPosixPath(subPath || "/");

    const { ownerType, ownerId } = this._getOwnerFromOptions(ctx);
    const { scopeType, scopeId } = this._getScopeFromOptions(ctx);
    const repo = new VfsNodesRepository(db, null);

    let parentId = VFS_ROOT_PARENT_ID;

    // root 没有节点记录
    if (stripTrailingSlash(normalizedSubPath) !== "/") {
      const node = await repo.resolveNodeByPath({ ownerType, ownerId, scopeType, scopeId, path: normalizedSubPath });
      if (!node) throw new NotFoundError("目录不存在");
      if (node.node_type !== "dir") throw new ValidationError("目标不是目录");
      parentId = String(node.id);
    }

    const children = await repo.listChildrenByParentId({ ownerType, ownerId, scopeType, scopeId, parentId });

    const basePath = fsPath;
    const items = await Promise.all(
      children.map(async (row) => {
        const isDirectory = row.node_type === "dir";
        const childPath = `${basePath.endsWith("/") ? basePath : `${basePath}/`}${row.name}${isDirectory ? "/" : ""}`;
        const info = await buildFileInfo({
          fsPath: childPath,
          name: row.name,
          isDirectory,
          size: row.size,
          modified: row.updated_at || row.created_at || null,
          mimetype: row.mime_type || null,
          mount,
          storageType: mount?.storage_type || this.type,
          db,
        });
        return { ...info, vfs_node_id: row.id };
      }),
    );

    return {
      path: fsPath,
      type: "directory",
      isRoot: stripTrailingSlash(normalizedSubPath) === "/",
      mount_id: mount?.id ?? null,
      storage_type: mount?.storage_type || this.type,
      items,
    };
  }

  async getFileInfo(subPath, ctx = {}) {
    this._ensureInitialized();
    const db = ctx?.db || null;
    if (!db) throw new ValidationError("TELEGRAM.getFileInfo: 缺少 db");

    const { mount } = ctx;
    const fsPath = ctx?.path;
    const normalizedSubPath = toPosixPath(subPath || "/");

    // root：返回虚拟目录信息
    if (stripTrailingSlash(normalizedSubPath) === "/") {
      return await buildFileInfo({
        fsPath,
        name: "",
        isDirectory: true,
        size: null,
        modified: null,
        mimetype: "application/x-directory",
        mount,
        storageType: mount?.storage_type || this.type,
        db,
      });
    }

    const { ownerType, ownerId } = this._getOwnerFromOptions(ctx);
    const { scopeType, scopeId } = this._getScopeFromOptions(ctx);
    const repo = new VfsNodesRepository(db, null);
    const node = await repo.resolveNodeByPath({ ownerType, ownerId, scopeType, scopeId, path: normalizedSubPath });
    if (!node) throw new NotFoundError("路径不存在");

    const isDirectory = node.node_type === "dir";
    return await buildFileInfo({
      fsPath,
      name: node.name || inferNameFromPath(fsPath, isDirectory),
      isDirectory,
      size: node.size,
      modified: node.updated_at || node.created_at || null,
      mimetype: node.mime_type || null,
      mount,
      storageType: mount?.storage_type || this.type,
      db,
    });
  }

  async downloadFile(subPath, ctx = {}) {
    this._ensureInitialized();
    const db = ctx?.db || null;
    if (!db) throw new ValidationError("TELEGRAM.downloadFile: 缺少 db");

    const repo = new VfsNodesRepository(db, null);

    let node = null;

    // storage-first：vfs:<id> 直达
    const vfsNodeId = this._parseVfsStoragePath(subPath);
    if (vfsNodeId) {
      node = await repo.getNodeByIdUnsafe(vfsNodeId);
    } else {
      // FS 挂载：按路径解析（需要 owner/scope）
      const normalizedSubPath = toPosixPath(subPath || "/");

      const { ownerType, ownerId } = this._getOwnerFromOptions(ctx);
      const { scopeType, scopeId } = this._getScopeFromOptions(ctx);
      node = await repo.resolveNodeByPath({ ownerType, ownerId, scopeType, scopeId, path: normalizedSubPath });
    }

    if (!node) throw new NotFoundError("文件不存在");
    if (node.node_type === "dir") throw new ValidationError("不能下载目录");

    const manifest = safeJsonParse(node.content_ref);
    const parts = normalizePartList(manifest);
    if (!parts.length) {
      throw new DriverError("TELEGRAM 文件缺少可用的 manifest（content_ref）", {
        status: ApiStatus.INTERNAL_ERROR,
        code: "DRIVER_ERROR.TELEGRAM_MISSING_MANIFEST",
        expose: false,
      });
    }

    const computedSize = parts.reduce((sum, p) => sum + (Number.isFinite(p.size) ? p.size : 0), 0) || null;
    const size = Number.isFinite(Number(node.size)) ? Number(node.size) : computedSize;
    const contentType = node.mime_type || "application/octet-stream";
    const lastModified = node.updated_at ? new Date(node.updated_at) : null;

    const orderedParts = parts.slice().sort((a, b) => a.partNo - b.partNo);
    const canComputeOffsets =
      orderedParts.length > 0 &&
      orderedParts.every((p) => Number.isFinite(p.size) && Number(p.size) > 0);

    const partOffsets = canComputeOffsets
      ? (() => {
          let offset = 0;
          return orderedParts.map((p) => {
            const startOffset = offset;
            const endOffset = offset + Number(p.size) - 1;
            offset += Number(p.size);
            return { ...p, startOffset, endOffset, size: Number(p.size) };
          });
        })()
      : null;

    const driver = this;

    return {
      size,
      contentType,
      etag: null,
      lastModified,
      async getStream() {
        const aborter = new AbortController();
        const stream = new ReadableStream({
          start(controller) {
            (async () => {
              try {
                for (const part of orderedParts) {
                  if (aborter.signal.aborted) break;

                  const downloadUrl = await driver._getFileDownloadUrl(part.fileId, { signal: aborter.signal });
                  const resp = await driver._fetchTelegramDownloadResponse(
                    downloadUrl,
                    { method: "GET" },
                    { signal: aborter.signal, partNo: part.partNo },
                  );
                  if (!resp.ok || !resp.body) {
                    throw new DriverError("TELEGRAM 下载分片失败", {
                      status: ApiStatus.BAD_GATEWAY,
                      code: "DRIVER_ERROR.TELEGRAM_DOWNLOAD_FAILED",
                      expose: false,
                      details: { status: resp.status, partNo: part.partNo },
                    });
                  }

                  const reader = resp.body.getReader();
                  while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (value) controller.enqueue(value);
                  }
                }
                controller.close();
              } catch (e) {
                controller.error(e);
              }
            })();
          },
          cancel() {
            aborter.abort();
          },
        });

        return {
          stream,
          async close() {
            aborter.abort();
          },
        };
      },
      // 原生 Range（按分片定位 + 分片内软件切片），避免“Range 从头读到尾”导致视频拖动巨卡
      // 只在能够计算每片大小/偏移时开启，否则让 StorageStreaming 回退 ByteSlice
      async getRange(range, options = {}) {
        if (!partOffsets) {
          const handle = await this.getStream(options);
          return { ...handle, supportsRange: false };
        }
        const { start, end } = range || {};
        const startByte = Number(start);
        const endByte = Number.isFinite(Number(end)) ? Number(end) : (Number(size) > 0 ? Number(size) - 1 : Number.MAX_SAFE_INTEGER);

        const aborter = new AbortController();

        const stream = new ReadableStream({
          start(controller) {
            (async () => {
              try {
                const targets = partOffsets.filter((p) => p.endOffset >= startByte && p.startOffset <= endByte);
                for (const part of targets) {
                  if (aborter.signal.aborted) break;
                  const localStart = Math.max(0, startByte - part.startOffset);
                  const localEnd = Math.min(part.size - 1, endByte - part.startOffset);

                  const downloadUrl = await driver._getFileDownloadUrl(part.fileId, { signal: aborter.signal });
                  const headers = new Headers();
                  // 先尝试 Range（如果 Telegram 文件服务支持，会返回 206，省流量）
                  if (localStart > 0 || localEnd < part.size - 1) {
                    headers.set("Range", `bytes=${localStart}-${localEnd}`);
                  }
                  const resp = await driver._fetchTelegramDownloadResponse(
                    downloadUrl,
                    { method: "GET", headers },
                    { signal: aborter.signal, partNo: part.partNo },
                  );
                  if (!resp.ok || !resp.body) {
                    throw new DriverError("TELEGRAM Range 下载分片失败", {
                      status: ApiStatus.BAD_GATEWAY,
                      code: "DRIVER_ERROR.TELEGRAM_DOWNLOAD_FAILED",
                      expose: false,
                      details: { status: resp.status, partNo: part.partNo },
                    });
                  }

                  // Telegram 文件服务可能忽略 Range，仍返回 200 全量，此时用软件切片兜底
                  const bodyStream =
                    (localStart > 0 || localEnd < part.size - 1) && resp.status !== 206
                      ? smartWrapStreamWithByteSlice(resp.body, localStart, localEnd)
                      : resp.body;

                  const reader = bodyStream.getReader();
                  while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (value) controller.enqueue(value);
                  }
                }
                controller.close();
              } catch (e) {
                controller.error(e);
              }
            })();
          },
          cancel() {
            aborter.abort();
          },
        });

        return {
          stream,
          supportsRange: true,
          async close() {
            aborter.abort();
          },
        };
      },
    };
  }

  // ===== WRITER 能力 =====

  async createDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    const db = ctx?.db || null;
    if (!db) throw new ValidationError("TELEGRAM.createDirectory: 缺少 db");

    const { ownerType, ownerId } = this._getOwnerFromOptions(ctx);
    const { scopeType, scopeId } = this._getScopeFromOptions(ctx);
    const repo = new VfsNodesRepository(db, null);

    const fsPath = ctx?.path;
    const normalized = toPosixPath(subPath || "/");

    // root 不占记录，视为已存在
    if (stripTrailingSlash(normalized) === "/") {
      return { success: true, path: fsPath, alreadyExists: true };
    }

    const existing = await repo.resolveNodeByPath({ ownerType, ownerId, scopeType, scopeId, path: normalized });
    if (existing) {
      if (existing.node_type !== "dir") throw new ValidationError("同名节点已存在但不是目录");
      return { success: true, path: fsPath, alreadyExists: true };
    }

    await repo.ensureDirectoryPath({ ownerType, ownerId, scopeType, scopeId, path: normalized });
    return { success: true, path: fsPath, alreadyExists: false };
  }

  async uploadFile(subPath, fileOrStream, ctx = {}) {
    this._ensureInitialized();
    const db = ctx?.db || null;
    if (!db) throw new ValidationError("TELEGRAM.uploadFile: 缺少 db");

    const { ownerType, ownerId } = this._getOwnerFromOptions(ctx);
    const { scopeType, scopeId } = this._getScopeFromOptions(ctx);
    const repo = new VfsNodesRepository(db, null);

    const { mount } = ctx;
    const fsPath = ctx?.path;
    const targetPath = toPosixPath(subPath || fsPath);

    const isDirectoryTarget =
      (typeof fsPath === "string" && fsPath.endsWith("/")) ||
      (typeof subPath === "string" && subPath.endsWith("/"));
    const { dirPath, name: inferredName } = resolveUploadDirAndName(targetPath, { isDirectoryTarget });
    const filename = ctx?.filename || inferredName || inferNameFromPath(fsPath, false) || "upload.bin";
    const contentType = ctx?.contentType || "application/octet-stream";
    const contentLength = Number(ctx?.contentLength ?? ctx?.fileSize ?? 0) || 0;

    // 直传（share/表单/非分片 FS）
    // - official：限制 ≤20MB
    // - self_hosted：不限制
    if (Number.isFinite(this.directUploadMaxBytes) && this.directUploadMaxBytes > 0 && contentLength && contentLength > this.directUploadMaxBytes) {
      throw new DriverError(`TELEGRAM 单次上传过大：未勾选“自建 Bot API”时（official），直传仅支持 ≤${Math.floor(this.directUploadMaxBytes / (1024 * 1024))}MB；更大的文件请使用“挂载浏览器”的分片上传`, {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.TELEGRAM_FILE_TOO_LARGE",
        expose: true,
        details: { contentLength, directUploadMaxBytes: this.directUploadMaxBytes },
      });
    }

    const blob = await this._toBlob(fileOrStream, { contentType, filename });
    if (Number.isFinite(this.directUploadMaxBytes) && this.directUploadMaxBytes > 0 && blob.size > this.directUploadMaxBytes) {
      throw new DriverError(`TELEGRAM 单次上传过大：未勾选“自建 Bot API”时（official），直传仅支持 ≤${Math.floor(this.directUploadMaxBytes / (1024 * 1024))}MB；更大的文件请使用“挂载浏览器”的分片上传`, {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.TELEGRAM_FILE_TOO_LARGE",
        expose: true,
        details: { contentLength: blob.size, directUploadMaxBytes: this.directUploadMaxBytes },
      });
    }

    const sendRes = await this._sendDocument(blob, { filename, contentType });

    const manifest = {
      kind: "telegram_manifest_v1",
      storage_type: this.type,
      target_chat_id: this.targetChatId,
      parts: [
        {
          partNo: 1,
          size: blob.size,
          file_id: sendRes.fileId,
          file_unique_id: sendRes.fileUniqueId || null,
          message_id: sendRes.messageId,
          chat_id: this.targetChatId,
        },
      ],
    };

    // 1) sendDocument 成功后，只允许重试“写索引”（vfs_nodes），不允许重试“再发一次消息”。
    // 2) 对 DB 写入做短暂重试
    // 3) 如果最终还是写失败：明确标记为不可重试（retryable=false），让上层停止自动重试
    const MAX_INDEX_WRITE_ATTEMPTS = 6;
    const BASE_INDEX_BACKOFF_MS = 200;
    let lastIndexError = null;
    let node = null;

    for (let attempt = 1; attempt <= MAX_INDEX_WRITE_ATTEMPTS; attempt++) {
      try {
        // mkdir -p
        const ensured = await repo.ensureDirectoryPath({ ownerType, ownerId, scopeType, scopeId, path: dirPath });
        node = await repo.createOrUpdateFileNode({
          ownerType,
          ownerId,
          scopeType,
          scopeId,
          parentId: ensured?.parentId ?? VFS_ROOT_PARENT_ID,
          name: filename,
          mimeType: contentType,
          size: blob.size,
          storageType: this.type,
          contentRef: manifest,
        });
        lastIndexError = null;
        break;
      } catch (e) {
        lastIndexError = e;

        if (e instanceof ValidationError || e instanceof NotFoundError) {
          break;
        }

        if (attempt < MAX_INDEX_WRITE_ATTEMPTS) {
          const backoffMs = Math.min(2500, BASE_INDEX_BACKOFF_MS * Math.pow(2, attempt - 1));
          console.warn(
            `[TELEGRAM] 写入索引失败，将重试 (${attempt}/${MAX_INDEX_WRITE_ATTEMPTS}) filename=${filename} dir=${dirPath}:`,
            e?.message || e,
          );
          await this._sleep(backoffMs);
          continue;
        }
      }
    }

    if (!node) {
      const err = new DriverError(
        "Telegram 上传已成功，但写入目录索引失败：为避免重复上传，已停止自动重试；请稍后手动重试一次复制/上传。",
        {
          status: ApiStatus.BAD_GATEWAY,
          code: "DRIVER_ERROR.TELEGRAM_INDEX_WRITE_FAILED",
          expose: true,
          details: {
            filename,
            dirPath,
            fileSize: blob.size,
            messageId: sendRes?.messageId ?? null,
            fileId: sendRes?.fileId ?? null,
            cause: lastIndexError?.message || String(lastIndexError || ""),
          },
        },
      );
      err.retryable = false;
      throw err;
    }

    return {
      success: true,
      storagePath: `${VFS_STORAGE_PATH_PREFIX}${node.id}`,
      publicUrl: null,
      etag: null,
      contentType,
    };
  }

  /**
   * 更新文件内容（覆盖写入）
   */
  async updateFile(subPath, content, ctx = {}) {
    this._ensureInitialized();
    const db = ctx?.db || null;
    if (!db) throw new ValidationError("TELEGRAM.updateFile: 缺少 db");

    const fsPath = ctx?.path;
    if (typeof fsPath !== "string" || !fsPath) throw new ValidationError("TELEGRAM.updateFile: 缺少 path");

    const effectiveSubPath = typeof subPath === "string" ? subPath : "/";
    const targetPath = toPosixPath(effectiveSubPath || "/");
    const { name: inferredName } = splitDirAndName(targetPath);
    const filename = inferredName || inferNameFromPath(fsPath, false) || "file.txt";

    const contentType = getEffectiveMimeType(null, filename) || "application/octet-stream";

    const result = await this.uploadFile(effectiveSubPath || "/", content, {
      ...ctx,
      path: fsPath,
      subPath: effectiveSubPath || "/",
      contentType,
      filename,
    });

    return {
      ...result,
      success: !!result?.success,
      path: fsPath,
      message: result?.message || "文件更新成功",
    };
  }

  // ===== MULTIPART 能力（前端分片：single_session + 后端中转） =====

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

  async signMultipartParts(subPath, uploadId, partNumbers, options = {}) {
    this._ensureInitialized();
    return this.uploadOps.signMultipartParts(subPath, uploadId, partNumbers, options);
  }

  async proxyFrontendMultipartChunk(sessionRow, body, options = {}) {
    this._ensureInitialized();
    return this.uploadOps.proxyFrontendMultipartChunk(sessionRow, body, options);
  }

  async renameItem(oldSubPath, newSubPath, ctx = {}) {
    this._ensureInitialized();
    return await telegramRenameItem(this, oldSubPath, newSubPath, ctx);
  }

  async batchRemoveItems(subPaths, ctx = {}) {
    this._ensureInitialized();
    return await telegramBatchRemoveItems(this, subPaths, ctx);
  }

  async copyItem(sourceSubPath, targetSubPath, ctx = {}) {
    this._ensureInitialized();
    return await telegramCopyItem(this, sourceSubPath, targetSubPath, ctx);
  }

  // ===== storage-first：删除对象（用于 /api/files delete_mode=both） =====

  async deleteObjectByStoragePath(storagePath, options = {}) {
    this._ensureInitialized();
    return await telegramDeleteObjectByStoragePath(this, storagePath, options);
  }

  // ===== 内部：TG Bot API） =====

  _buildBotApiUrl(method) {
    return telegramBuildBotApiUrl(this, method);
  }

  _buildBotFileUrl(filePath) {
    return telegramBuildBotFileUrl(this, filePath);
  }

  async _sendDocument(blob, { filename, contentType } = {}) {
    return await telegramSendDocument(this, blob, { filename, contentType });
  }

  async _getFileInfoUncached(fileId, options = {}) {
    return await telegramGetFileInfo(this, fileId, options);
  }

  async _getFileDownloadUrl(fileId, options = {}) {
    const info = await this._getFileInfo(fileId, options);
    const filePath = info?.filePath || null;
    if (!filePath) {
      throw new DriverError("TELEGRAM getFile 回执缺少 file_path", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.TELEGRAM_INVALID_RESPONSE",
        expose: false,
        details: { fileId },
      });
    }
    let downloadUrl = this._buildBotFileUrl(filePath);
    if (this.botApiMode === "self_hosted" && fileId) {
      try {
        const u = new URL(downloadUrl);
        u.searchParams.set("file_id", String(fileId));
        downloadUrl = u.toString();
      } catch {
      }
    }
    return downloadUrl;
  }

  /**
   * Telegram 文件下载（bot file url）的重试：
   * - 只在 429（限流）或“看起来像超时”的错误时重试
   * - 最多重试 2 次（也就是最多 3 次请求）
   */
  async _fetchTelegramDownloadResponse(downloadUrl, init = {}, options = {}) {
    const signal = options?.signal;
    const partNo = options?.partNo;
    const maxRetries = 2;
    const maxAttempts = 1 + maxRetries;

    const isTimeoutLikeError = (error) => {
      if (!error) return false;
      // 如果上游已经主动取消（例如用户关闭预览/断开连接），不要当成“超时”重试
      if (signal?.aborted) return false;

      const name = String(error?.name || "").toUpperCase();
      const code = String(error?.code || "").toUpperCase();
      const message = String(error?.message || "").toUpperCase();

      // Node/Undici 可能出现的超时类型：UND_ERR_CONNECT_TIMEOUT / ETIMEDOUT / TimeoutError
      if (code.includes("UND_ERR_CONNECT_TIMEOUT")) return true;
      if (code.includes("ETIMEDOUT")) return true;
      if (name.includes("TIMEOUT")) return true;
      if (message.includes("TIMEOUT")) return true;

      // AbortError：如果不是主动 abort，一般是平台/请求超时触发
      if (name === "ABORTERROR") return true;

      return false;
    };

    const calcBackoffMs = (attempt, retryAfterSeconds) => {
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        return Math.min(60_000, Math.floor(retryAfterSeconds * 1000));
      }
      // 指数退避
      return Math.min(5_000, 200 * Math.pow(2, Math.max(0, attempt - 1)));
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal?.aborted) {
        throw new DriverError("请求被取消", {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.ABORTED",
          expose: false,
        });
      }

      try {
        if (attempt === 1) {
          console.log(`[TELEGRAM][download] via=${maskTelegramBotTokenInUrl(downloadUrl)}${partNo != null ? ` partNo=${partNo}` : ""}`);
        }
        const resp = await fetch(downloadUrl, { ...init, signal });

        // 只对 429 做重试，其它 HTTP 状态不自动重试
        if (resp?.status === 429 && attempt < maxAttempts) {
          try {
            await resp.body?.cancel?.();
          } catch {}

          const retryAfterHeader = resp.headers?.get?.("retry-after");
          const retryAfterSeconds = retryAfterHeader != null ? Number(retryAfterHeader) : NaN;
          const backoffMs = calcBackoffMs(attempt, retryAfterSeconds);

          console.warn(
            `[TelegramStorageDriver] Telegram 下载被限流(429)，将重试 ${attempt}/${maxAttempts}，等待 ${backoffMs}ms` +
              (partNo != null ? `，partNo=${partNo}` : ""),
          );
          await this._sleep(backoffMs, { signal });
          continue;
        }

        return resp;
      } catch (error) {
        if (isTimeoutLikeError(error) && attempt < maxAttempts) {
          const backoffMs = calcBackoffMs(attempt);
          console.warn(
            `[TelegramStorageDriver] Telegram 下载疑似超时，将重试 ${attempt}/${maxAttempts}，等待 ${backoffMs}ms` +
              (partNo != null ? `，partNo=${partNo}` : "") +
              `: ${error?.message || error}`,
          );
          await this._sleep(backoffMs, { signal });
          continue;
        }
        throw error;
      }
    }

    throw new DriverError("TELEGRAM 下载失败（重试耗尽）", {
      status: ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.TELEGRAM_DOWNLOAD_FAILED",
      expose: false,
    });
  }

  async _getFileInfo(fileId, options = {}) {
    // 先读全局缓存：命中就直接返回，避免重复 getFile（预览/拖动 Range 时特别有用）
    try {
      const cached = getCachedTelegramFileInfo(fileId);
      if (cached?.filePath) {
        return cached;
      }
    } catch {
      // 缓存读取失败不影响主流程
    }

    // 回源 Telegram getFile
    const info = await this._getFileInfoUncached(fileId, options);
    try {
      setCachedTelegramFileInfo(fileId, info);
    } catch {
      // 缓存写入失败不影响主流程
    }
    return info;
  }

  async _sleep(ms, options = {}) {
    const delay = Math.max(0, Number(ms) || 0);
    if (delay <= 0) return;

    const signal = options?.signal;
    if (signal?.aborted) {
      throw new DriverError("请求被取消", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.ABORTED",
        expose: false,
      });
    }

    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, delay);
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(
              new DriverError("请求被取消", {
                status: ApiStatus.BAD_REQUEST,
                code: "DRIVER_ERROR.ABORTED",
                expose: false,
              }),
            );
          },
          { once: true },
        );
      }
    });
  }

  async _toBlob(fileOrStream, { contentType, filename }) {
    // File/Blob
    if (typeof Blob !== "undefined" && fileOrStream instanceof Blob) {
      return fileOrStream;
    }

    // ArrayBuffer / Uint8Array / Buffer
    if (fileOrStream instanceof ArrayBuffer) {
      return new Blob([fileOrStream], { type: contentType || "application/octet-stream" });
    }
    if (fileOrStream instanceof Uint8Array) {
      return new Blob([fileOrStream], { type: contentType || "application/octet-stream" });
    }
    if (typeof Buffer !== "undefined" && Buffer.isBuffer?.(fileOrStream)) {
      return new Blob([fileOrStream], { type: contentType || "application/octet-stream" });
    }

    // Web ReadableStream
    if (fileOrStream && typeof fileOrStream.getReader === "function") {
      const buf = await this._readWebStreamToUint8Array(fileOrStream);
      return new Blob([buf], { type: contentType || "application/octet-stream" });
    }

    // Node Readable（兜底：读入内存）
    if (fileOrStream && typeof fileOrStream[Symbol.asyncIterator] === "function") {
      const chunks = [];
      for await (const chunk of fileOrStream) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const buf = typeof Buffer !== "undefined" ? Buffer.concat(chunks) : new Uint8Array([]);
      return new Blob([buf], { type: contentType || "application/octet-stream" });
    }

    if (typeof fileOrStream === "string") {
      return new Blob([fileOrStream], { type: contentType || "application/octet-stream" });
    }

    throw new ValidationError(`TELEGRAM.uploadFile: 不支持的上传体类型（filename=${filename || ""}）`);
  }

  async _readWebStreamToUint8Array(stream) {
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength || value.length || 0;
      }
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength || c.length || 0;
    }
    return out;
  }
}

export default TelegramStorageDriver;
