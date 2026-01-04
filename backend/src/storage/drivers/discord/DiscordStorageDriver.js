/**
 * DiscordStorageDriver（Bot + 频道附件）
 *
 * Discord 没有“目录/对象Key”的概念，只有“消息 + 附件”；
 * CloudPaste 实现“网盘目录树”，只能把目录结构放进数据库（vfs_nodes）；
 * 分片上传（multipart）：single_session：浏览器切片 → 后端中转 → Discord 逐片消息附件。
 */

import { ApiStatus, UserType } from "../../../constants/index.js";
import { DriverError, NotFoundError, ValidationError } from "../../../http/errors.js";
import { BaseDriver, CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { decryptIfNeeded } from "../../../utils/crypto.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";
import { resolveOwner } from "../../fs/utils/OwnerResolver.js";
import { buildFileInfo, inferNameFromPath } from "../../utils/FileInfoBuilder.js";
import { VfsNodesRepository, VFS_ROOT_PARENT_ID } from "../../../repositories/VfsNodesRepository.js";
import { createHttpStreamDescriptor } from "../../streaming/StreamDescriptorUtils.js";
import { smartWrapStreamWithByteSlice } from "../../streaming/ByteSliceStream.js";
import {
  discordBatchRemoveItems,
  discordCopyItem,
  discordDeleteObjectByStoragePath,
  discordRenameItem,
  safeJsonParse,
  splitDirAndName,
  stripTrailingSlash,
  toPosixPath,
} from "./DiscordOperations.js";
import DiscordMultipartOperations from "./DiscordMultipartOperations.js";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const VFS_STORAGE_PATH_PREFIX = "vfs:";

// Discord 默认上传限制”是 10MiB
const DISCORD_DEFAULT_DIRECT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

// =========================
// 并发阀门（Semaphore）
// =========================

class AsyncSemaphore {
  constructor(max) {
    this.max = Math.max(1, Number(max) || 1);
    this.current = 0;
    this.queue = [];
  }

  setMax(max) {
    const next = Math.max(1, Number(max) || 1);
    this.max = next;
    this._drain();
  }

  _drain() {
    while (this.current < this.max && this.queue.length) {
      this.current += 1;
      const resolve = this.queue.shift();
      resolve(this._release.bind(this));
    }
  }

  _release() {
    this.current = Math.max(0, this.current - 1);
    this._drain();
  }

  async acquire() {
    if (this.current < this.max) {
      this.current += 1;
      return this._release.bind(this);
    }
    return await new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }
}

// 同一个 Worker 进程内所有 DiscordStorageDriver 实例共享并发预算
const apiSemaphores = new Map();

function getDiscordSemaphore(key, max) {
  const k = String(key || "discord-default");
  let sem = apiSemaphores.get(k);
  if (!sem) {
    sem = new AsyncSemaphore(max);
    apiSemaphores.set(k, sem);
    return sem;
  }
  sem.setMax(max);
  return sem;
}

function resolveUploadDirAndName(targetPath, { isDirectoryTarget = false } = {}) {
  const normalized = toPosixPath(targetPath);
  const treatAsDir = isDirectoryTarget === true || normalized.endsWith("/");
  if (treatAsDir) {
    const dir = stripTrailingSlash(normalized);
    return { dirPath: dir || "/", name: "" };
  }
  return splitDirAndName(normalized);
}

function normalizeDiscordApiBaseUrl(value, fallback) {
  const raw = value != null ? String(value).trim() : "";
  const base = raw ? raw.replace(/\/+$/, "") : String(fallback || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  try {
    const parsed = new URL(base);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ValidationError("endpoint_url 必须以 http:// 或 https:// 开头");
    }
  } catch {
    throw new ValidationError("endpoint_url 不是合法的 URL");
  }
  return base;
}

function normalizeDiscordChunkPartList(manifest) {
  const parts = Array.isArray(manifest?.parts) ? manifest.parts : [];
  return parts
    .map((p) => {
      const partNo = Number(p?.partNo ?? p?.part_no ?? p?.part);
      const byteStart = Number.isFinite(Number(p?.byte_start ?? p?.byteStart)) ? Number(p?.byte_start ?? p?.byteStart) : null;
      const byteEnd = Number.isFinite(Number(p?.byte_end ?? p?.byteEnd)) ? Number(p?.byte_end ?? p?.byteEnd) : null;
      const inferredSize = byteStart != null && byteEnd != null && byteEnd >= byteStart ? byteEnd - byteStart + 1 : null;
      const size = Number.isFinite(Number(p?.size)) ? Number(p.size) : inferredSize;

      return {
        partNo,
        size,
        byteStart,
        byteEnd,
        channelId: p?.channel_id ?? p?.channelId ?? manifest?.channel_id ?? manifest?.channelId ?? null,
        messageId: p?.message_id ?? p?.messageId ?? null,
        attachmentId: p?.attachment_id ?? p?.attachmentId ?? null,
        url: p?.url ?? null,
      };
    })
    .filter((p) => Number.isFinite(p.partNo) && p.partNo > 0 && p.messageId && p.attachmentId);
}

export class DiscordStorageDriver extends BaseDriver {
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "DISCORD";
    this.encryptionSecret = encryptionSecret;

    // READER/WRITER/ATOMIC + PROXY + MULTIPART（分片上传）
    this.capabilities = [CAPABILITIES.READER, CAPABILITIES.WRITER, CAPABILITIES.ATOMIC, CAPABILITIES.PROXY, CAPABILITIES.MULTIPART];

    this.botToken = null;
    this.channelId = null;
    this.apiBase = DISCORD_API_BASE;
    this.uploadConcurrency = 1;
    this.urlProxy = null;
    this.directUploadMaxBytes = DISCORD_DEFAULT_DIRECT_UPLOAD_MAX_BYTES;
    this.partSizeBytes = DISCORD_DEFAULT_DIRECT_UPLOAD_MAX_BYTES;

    this.multipartOps = new DiscordMultipartOperations(this);
  }

  async initialize() {
    const botTokenEncrypted = this.config?.bot_token || this.config?.botToken;
    const decryptedToken = await decryptIfNeeded(botTokenEncrypted, this.encryptionSecret);
    const botToken = typeof decryptedToken === "string" ? decryptedToken.trim() : null;

    const channelIdRaw = this.config?.channel_id || this.config?.channelId;
    const channelId = channelIdRaw != null ? String(channelIdRaw).trim() : "";

    const apiBase = normalizeDiscordApiBaseUrl(this.config?.endpoint_url, DISCORD_API_BASE);

    const concurrencyRaw =
      this.config?.upload_concurrency != null && this.config?.upload_concurrency !== "" ? Number(this.config.upload_concurrency) : null;
    const uploadConcurrency = Number.isFinite(concurrencyRaw) && concurrencyRaw > 0 ? Math.floor(concurrencyRaw) : 1;

    const partSizeMbRaw = this.config?.part_size_mb != null && this.config?.part_size_mb !== "" ? Number(this.config.part_size_mb) : null;
    const maxPartSizeMb =
      Number.isFinite(this.directUploadMaxBytes) && this.directUploadMaxBytes > 0
        ? Math.max(1, Math.floor(this.directUploadMaxBytes / (1024 * 1024)))
        : 10;
    let partSizeMb = Number.isFinite(partSizeMbRaw) && partSizeMbRaw > 0 ? Math.floor(partSizeMbRaw) : maxPartSizeMb;
    partSizeMb = Math.max(1, Math.min(maxPartSizeMb, partSizeMb));

    const urlProxy = this.config?.url_proxy ? String(this.config.url_proxy).trim() : "";
    this.urlProxy = urlProxy || null;

    if (!botToken) {
      throw new DriverError("DISCORD 驱动缺少必填配置 bot_token", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.DISCORD_INVALID_CONFIG",
        expose: true,
      });
    }
    if (!channelId) {
      throw new DriverError("DISCORD 驱动缺少必填配置 channel_id", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.DISCORD_INVALID_CONFIG",
        expose: true,
      });
    }
    if (!/^\d+$/.test(channelId)) {
      throw new DriverError("DISCORD 驱动 channel_id 必须是纯数字字符串（Snowflake）", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.DISCORD_INVALID_CONFIG",
        expose: true,
      });
    }

    this.botToken = botToken;
    this.channelId = channelId;
    this.apiBase = apiBase;
    this.uploadConcurrency = uploadConcurrency;
    this.partSizeBytes = partSizeMb * 1024 * 1024;
    this.initialized = true;
  }

  // ===== Base contract =====

  async stat(subPath, ctx = {}) {
    return await this.getFileInfo(subPath, ctx);
  }

  async exists(subPath, ctx = {}) {
    try {
      await this.stat(subPath, ctx);
      return true;
    } catch {
      return false;
    }
  }

  // ===== PROXY capability =====

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
    // Discord 的 VFS scope 按 storage_config 维度
    const mount = options?.mount || null;
    const scopeId = mount?.storage_config_id || this.config?.id || null;
    if (!scopeId) {
      throw new ValidationError("DISCORD: 缺少 scope_id（storage_config_id）");
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
    const configAdminId = this.config?.admin_id ? String(this.config.admin_id) : null;
    if (configAdminId) {
      return { ownerType: UserType.ADMIN, ownerId: configAdminId };
    }

    // 兜底：如果历史数据/特殊场景下 admin_id 为空，则退回 mount.created_by
    const isDiscordMount = mount?.storage_type === this.type && !!mount;
    const mountCreatedBy = mount?.created_by ? String(mount.created_by) : null;
    if (isDiscordMount && mountCreatedBy) {
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

  _buildDiscordApiUrl(pathname) {
    const p = String(pathname || "").replace(/^\//, "");
    return `${this.apiBase}/${p}`;
  }

  _applyUrlProxy(url) {
    if (!this.urlProxy) return url;
    try {
      const proxy = new URL(this.urlProxy);
      const u = new URL(String(url));
      u.protocol = proxy.protocol;
      u.host = proxy.host;
      return u.toString();
    } catch {
      return url;
    }
  }

  async _sleep(ms, { signal } = {}) {
    const delay = Math.max(0, Number(ms) || 0);
    if (delay <= 0) return;
    if (signal?.aborted) {
      throw new DriverError("请求被取消", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.ABORTED",
        expose: false,
      });
    }

    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, delay);
      if (!signal) return;
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
    });
  }

  _getDiscordSemaphoreKey() {
    return this.config?.id || `${this.channelId || "unknown-channel"}`;
  }

  async _withDiscordConcurrency(fn) {
    const sem = getDiscordSemaphore(this._getDiscordSemaphoreKey(), this.uploadConcurrency);
    const release = await sem.acquire();
    try {
      return await fn();
    } finally {
      try {
        release?.();
      } catch {}
    }
  }

  _parseRetryAfterMs(resp, json) {
    // 优先 body 的 retry_after（秒）
    const bodyRetryAfterSec = typeof json?.retry_after === "number" ? json.retry_after : null;
    if (Number.isFinite(bodyRetryAfterSec) && bodyRetryAfterSec >= 0) {
      return Math.max(200, Math.ceil(bodyRetryAfterSec * 1000) + 100);
    }

    // 其次 retry-after header（秒）
    const retryAfterHeader = resp?.headers?.get?.("retry-after");
    const retryAfterHeaderSec = retryAfterHeader != null && retryAfterHeader !== "" ? Number(retryAfterHeader) : null;
    if (Number.isFinite(retryAfterHeaderSec) && retryAfterHeaderSec >= 0) {
      return Math.max(200, Math.ceil(retryAfterHeaderSec * 1000) + 100);
    }

    // 再次 x-ratelimit-reset-after（秒）
    const resetAfter = resp?.headers?.get?.("x-ratelimit-reset-after");
    const resetAfterSec = resetAfter != null && resetAfter !== "" ? Number(resetAfter) : null;
    if (Number.isFinite(resetAfterSec) && resetAfterSec >= 0) {
      return Math.max(200, Math.ceil(resetAfterSec * 1000) + 100);
    }

    return null;
  }

  async _callDiscordApiJson(url, makeInit, options = {}) {
    const operation = options?.operation || "discord-api";
    const signal = options?.signal;
    const maxAttempts = Number(options?.maxAttempts) || 3;
    const retryOn429 = options?.retryOn429 !== false;
    const retryOn5xx = options?.retryOn5xx !== false;
    const retryOnException = options?.retryOnException === true;
    const baseDelayMs = Number(options?.baseDelayMs) || 400;

    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal?.aborted) {
        throw new DriverError("请求被取消", {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.ABORTED",
          expose: false,
        });
      }

      try {
        const init = (typeof makeInit === "function" ? makeInit(attempt) : makeInit) || {};
        const resp = await this._withDiscordConcurrency(async () => await fetch(url, { ...init, signal }));
        const text = await resp.text().catch(() => "");
        const json = text ? safeJsonParse(text) : null;

        if (resp.ok) {
          return { resp, json, text };
        }

        // 429：按官方要求等待 Retry-After / retry_after
        if (retryOn429 && resp.status === 429 && attempt < maxAttempts) {
          const waitMs = this._parseRetryAfterMs(resp, json) ?? Math.min(10_000, baseDelayMs * Math.pow(2, attempt - 1));
          await this._sleep(waitMs, { signal });
          continue;
        }

        // 5xx：退避重试（有限）
        if (retryOn5xx && resp.status >= 500 && attempt < maxAttempts) {
          const waitMs = Math.min(10_000, baseDelayMs * Math.pow(2, attempt - 1));
          await this._sleep(waitMs, { signal });
          continue;
        }

        const message = json?.message || json?.error || text || `HTTP ${resp.status}`;
        throw new DriverError(`DISCORD 请求失败（${operation}）`, {
          status: ApiStatus.BAD_GATEWAY,
          code: "DRIVER_ERROR.DISCORD_API_FAILED",
          expose: false,
          details: { status: resp.status, message, url },
        });
      } catch (e) {
        lastError = e;
        if (attempt < maxAttempts && retryOnException) {
          const waitMs = Math.min(10_000, baseDelayMs * Math.pow(2, attempt - 1));
          await this._sleep(waitMs, { signal });
          continue;
        }
        throw e;
      }
    }

    throw lastError || new DriverError(`DISCORD 请求失败（${operation}）`, { status: ApiStatus.BAD_GATEWAY });
  }

  async _getChannelMessage(channelId, messageId, options = {}) {
    const url = this._buildDiscordApiUrl(`/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`);
    const res = await this._callDiscordApiJson(
      url,
      () => ({
        method: "GET",
        headers: {
          Authorization: `Bot ${this.botToken}`,
          "User-Agent": "CloudPaste-DiscordStorageDriver (https://github.com/ling-drag0n/CloudPaste)",
          Accept: "application/json",
        },
      }),
      { ...options, operation: "get-message", maxAttempts: 3, retryOn5xx: true, retryOn429: true },
    );
    return res?.json;
  }

  async _createMessageWithAttachment(blob, { filename, contentType } = {}) {
    const url = this._buildDiscordApiUrl(`/channels/${encodeURIComponent(this.channelId)}/messages`);

    const res = await this._callDiscordApiJson(
      url,
      () => {
        const form = new FormData();
        // payload_json：Discord 官方文档约定（multipart 里用 payload_json 放 JSON body）
        const payload = {
          content: "",
          // attachments 字段不强依赖，但传上更明确：id=0 对应 files[0]
          attachments: [{ id: 0, filename: filename || "upload.bin" }],
        };
        form.append("payload_json", JSON.stringify(payload));

        // files[0]：上传文件体
        // 注意：不要手动写 Content-Type，否则 boundary 会出错
        form.append("files[0]", blob, filename || "upload.bin");

        return {
          method: "POST",
          headers: {
            Authorization: `Bot ${this.botToken}`,
            "User-Agent": "CloudPaste-DiscordStorageDriver (https://github.com/ling-drag0n/CloudPaste)",
          },
          body: form,
        };
      },
      { operation: "create-message", maxAttempts: 3, retryOn5xx: true, retryOn429: true, retryOnException: true },
    );

    const json = res?.json;
    const messageId = json?.id || null;
    const attachments = Array.isArray(json?.attachments) ? json.attachments : [];
    const att = attachments[0] || null;
    const attachmentId = att?.id || null;
    const urlRaw = att?.url || null;

    if (!messageId || !attachmentId || !urlRaw) {
      throw new DriverError("DISCORD 上传失败：Create Message 回执缺少 attachments 信息", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.DISCORD_INVALID_RESPONSE",
        expose: false,
        details: { messageId, attachmentId, hasUrl: !!urlRaw },
      });
    }

    return {
      messageId: String(messageId),
      attachmentId: String(attachmentId),
      filename: String(att?.filename || filename || "upload.bin"),
      size: typeof att?.size === "number" ? att.size : blob?.size,
      contentType: att?.content_type || contentType || null,
      url: String(urlRaw),
    };
  }

  async _resolveAttachmentUrl({ channelId, messageId, attachmentId }, options = {}) {
    const msg = await this._getChannelMessage(channelId, messageId, options);
    const attachments = Array.isArray(msg?.attachments) ? msg.attachments : [];
    const found = attachments.find((a) => String(a?.id || "") === String(attachmentId || "")) || null;
    const urlRaw = found?.url || null;
    if (!urlRaw) {
      throw new NotFoundError("DISCORD 下载失败：无法在消息里找到对应附件（可能被删了）");
    }
    return {
      url: String(urlRaw),
      contentType: found?.content_type || null,
      size: typeof found?.size === "number" ? found.size : null,
    };
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

    throw new ValidationError(`DISCORD.uploadFile: 不支持的上传体类型（filename=${filename || ""}）`);
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

  // ===== READER 能力 =====

  async listDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    const db = ctx?.db || null;
    if (!db) throw new ValidationError("DISCORD.listDirectory: 缺少 db");

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
    if (!db) throw new ValidationError("DISCORD.getFileInfo: 缺少 db");

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
    if (!db) throw new ValidationError("DISCORD.downloadFile: 缺少 db");

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
    if (node.node_type === "dir") throw new ValidationError("目标是目录，无法下载");

    const manifest = safeJsonParse(node.content_ref) || null;
    if (!manifest || !manifest.kind) {
      throw new DriverError("DISCORD: 文件索引缺少可用的 content_ref", {
        status: ApiStatus.INTERNAL_ERROR,
        code: "DRIVER_ERROR.DISCORD_INVALID_MANIFEST",
        expose: false,
        details: { nodeId: node.id, storageType: node.storage_type },
      });
    }

    // ==========================
    // 1) 普通单附件下载
    // ==========================
    if (manifest.kind === "discord_attachment_v1") {
      const channelId = String(manifest.channel_id || manifest.channelId || this.channelId || "");
      const messageId = String(manifest.message_id || manifest.messageId || "");
      const attachmentId = String(manifest.attachment_id || manifest.attachmentId || "");
      const cachedUrl = manifest.url ? String(manifest.url) : null;

      if (!channelId || !messageId || !attachmentId) {
        throw new DriverError("DISCORD: manifest 缺少 channel_id/message_id/attachment_id", {
          status: ApiStatus.INTERNAL_ERROR,
          code: "DRIVER_ERROR.DISCORD_INVALID_MANIFEST",
          expose: false,
          details: { channelId, messageId, attachmentId, nodeId: node.id },
        });
      }

      let currentUrl = cachedUrl ? this._applyUrlProxy(cachedUrl) : null;

      const resolveFreshUrl = async (signal) => {
        const info = await this._resolveAttachmentUrl({ channelId, messageId, attachmentId }, { signal });
        const u = this._applyUrlProxy(info.url);
        currentUrl = u;
        return info;
      };

      const fetchOnce = async (signal, rangeHeader = null, method = "GET") => {
        if (!currentUrl) {
          await resolveFreshUrl(signal);
        }
        const headers = {};
        if (rangeHeader) headers.Range = rangeHeader;
        const resp = await fetch(currentUrl, { method, headers, signal });
        // 如果 URL 过期/失效，尝试刷新一次
        if ((resp.status === 403 || resp.status === 404) && !signal?.aborted) {
          try {
            await resp?.body?.cancel?.();
          } catch {}
          await resolveFreshUrl(signal);
          return await fetch(currentUrl, { method, headers, signal });
        }
        return resp;
      };

      const size = typeof node.size === "number" ? node.size : typeof manifest.size === "number" ? manifest.size : null;
      const contentType = node.mime_type || manifest.content_type || null;

      return createHttpStreamDescriptor({
        size,
        contentType,
        supportsRange: true,
        fetchResponse: async (signal) => await fetchOnce(signal, null, "GET"),
        fetchRangeResponse: async (signal, rangeHeader) => await fetchOnce(signal, rangeHeader, "GET"),
        fetchHeadResponse: async (signal) => await fetchOnce(signal, null, "HEAD"),
      });
    }

    // ==========================
    // 2) 分片（多附件）下载：拼接输出
    // ==========================
    if (manifest.kind === "discord_chunks_v1") {
      const parts = normalizeDiscordChunkPartList(manifest);
      if (!parts.length) {
        throw new DriverError("DISCORD: 分片文件缺少可用的 parts（content_ref）", {
          status: ApiStatus.INTERNAL_ERROR,
          code: "DRIVER_ERROR.DISCORD_MISSING_MANIFEST",
          expose: false,
          details: { nodeId: node.id, kind: manifest.kind },
        });
      }

      const computedSize = parts.reduce((sum, p) => sum + (Number.isFinite(p.size) ? Number(p.size) : 0), 0) || null;
      const size =
        Number.isFinite(Number(node.size))
          ? Number(node.size)
          : Number.isFinite(Number(manifest.file_size))
            ? Number(manifest.file_size)
            : computedSize;
      const contentType = node.mime_type || manifest.content_type || "application/octet-stream";
      const lastModified = node.updated_at ? new Date(node.updated_at) : null;

      const orderedParts = parts.slice().sort((a, b) => a.partNo - b.partNo);
      const canComputeOffsets = orderedParts.length > 0 && orderedParts.every((p) => Number.isFinite(p.size) && Number(p.size) > 0);

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

      const resolveFreshUrlForPart = async (part, signal) => {
        const channelId = String(part.channelId || manifest.channel_id || manifest.channelId || driver.channelId || "");
        const messageId = String(part.messageId || "");
        const attachmentId = String(part.attachmentId || "");
        const info = await driver._resolveAttachmentUrl({ channelId, messageId, attachmentId }, { signal });
        return driver._applyUrlProxy(info.url);
      };

      const fetchPartOnce = async (part, signal, { rangeHeader = null, method = "GET" } = {}) => {
        let currentUrl = part.url ? driver._applyUrlProxy(String(part.url)) : null;
        if (!currentUrl) {
          currentUrl = await resolveFreshUrlForPart(part, signal);
        }

        const headers = {};
        if (rangeHeader) headers.Range = rangeHeader;
        const resp = await fetch(currentUrl, { method, headers, signal });

        // URL 过期/失效：刷新一次再重试
        if ((resp.status === 403 || resp.status === 404) && !signal?.aborted) {
          try {
            await resp?.body?.cancel?.();
          } catch {}
          currentUrl = await resolveFreshUrlForPart(part, signal);
          return await fetch(currentUrl, { method, headers, signal });
        }

        return resp;
      };

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
                    const resp = await fetchPartOnce(part, aborter.signal, { method: "GET" });
                    if (!resp.ok || !resp.body) {
                      throw new DriverError("DISCORD 下载分片失败", {
                        status: ApiStatus.BAD_GATEWAY,
                        code: "DRIVER_ERROR.DISCORD_DOWNLOAD_FAILED",
                        expose: false,
                        details: { status: resp.status, partNo: part.partNo, messageId: part.messageId },
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

                    const rangeHeader = localStart > 0 || localEnd < part.size - 1 ? `bytes=${localStart}-${localEnd}` : null;
                    const resp = await fetchPartOnce(part, aborter.signal, { method: "GET", rangeHeader });
                    if (!resp.ok || !resp.body) {
                      throw new DriverError("DISCORD Range 下载分片失败", {
                        status: ApiStatus.BAD_GATEWAY,
                        code: "DRIVER_ERROR.DISCORD_DOWNLOAD_FAILED",
                        expose: false,
                        details: { status: resp.status, partNo: part.partNo, messageId: part.messageId },
                      });
                    }

                    // Discord CDN 理论上支持 Range（206），但仍做降级：如果返回 200 全量，就软件切片
                    const bodyStream =
                      rangeHeader && resp.status !== 206 ? smartWrapStreamWithByteSlice(resp.body, localStart, localEnd) : resp.body;

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

    throw new DriverError("DISCORD: 文件索引缺少可用的 content_ref（不支持的格式）", {
      status: ApiStatus.INTERNAL_ERROR,
      code: "DRIVER_ERROR.DISCORD_INVALID_MANIFEST",
      expose: false,
      details: { nodeId: node.id, storageType: node.storage_type, kind: manifest?.kind || null },
    });
  }

  // ===== WRITER 能力 =====

  async createDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    const db = ctx?.db || null;
    if (!db) throw new ValidationError("DISCORD.createDirectory: 缺少 db");

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
    if (!db) throw new ValidationError("DISCORD.uploadFile: 缺少 db");

    const { ownerType, ownerId } = this._getOwnerFromOptions(ctx);
    const { scopeType, scopeId } = this._getScopeFromOptions(ctx);
    const repo = new VfsNodesRepository(db, null);

    const { mount } = ctx;
    const fsPath = ctx?.path;
    const targetPath = toPosixPath(subPath || fsPath);

    const isDirectoryTarget = (typeof fsPath === "string" && fsPath.endsWith("/")) || (typeof subPath === "string" && subPath.endsWith("/"));
    const { dirPath, name: inferredName } = resolveUploadDirAndName(targetPath, { isDirectoryTarget });
    const filename = ctx?.filename || inferredName || inferNameFromPath(fsPath, false) || "upload.bin";
    const contentType = ctx?.contentType || "application/octet-stream";
    const contentLength = Number(ctx?.contentLength ?? ctx?.fileSize ?? 0) || 0;

    if (Number.isFinite(this.directUploadMaxBytes) && this.directUploadMaxBytes > 0 && contentLength && contentLength > this.directUploadMaxBytes) {
      throw new DriverError(
        `DISCORD 单次上传过大：普通上传仅支持 ≤${Math.floor(this.directUploadMaxBytes / (1024 * 1024))}MB（后续再加分片上传）`,
        {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.DISCORD_FILE_TOO_LARGE",
          expose: true,
          details: { contentLength, directUploadMaxBytes: this.directUploadMaxBytes },
        },
      );
    }

    const blob = await this._toBlob(fileOrStream, { contentType, filename });
    if (Number.isFinite(this.directUploadMaxBytes) && this.directUploadMaxBytes > 0 && blob.size > this.directUploadMaxBytes) {
      throw new DriverError(
        `DISCORD 单次上传过大：普通上传仅支持 ≤${Math.floor(this.directUploadMaxBytes / (1024 * 1024))}MB（后续再加分片上传）`,
        {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.DISCORD_FILE_TOO_LARGE",
          expose: true,
          details: { contentLength: blob.size, directUploadMaxBytes: this.directUploadMaxBytes },
        },
      );
    }

    const sendRes = await this._createMessageWithAttachment(blob, { filename, contentType });

    const manifest = {
      kind: "discord_attachment_v1",
      storage_type: this.type,
      channel_id: this.channelId,
      message_id: sendRes.messageId,
      attachment_id: sendRes.attachmentId,
      filename: sendRes.filename || filename,
      size: typeof sendRes.size === "number" ? sendRes.size : blob.size,
      content_type: sendRes.contentType || contentType || null,
      url: sendRes.url || null,
    };

    // 上传已经发生（Discord 里已经有消息了），这里不能“自动重试再发一次消息”。
    // 只允许重试“写索引”（vfs_nodes），避免重复上传。
    const MAX_INDEX_WRITE_ATTEMPTS = 6;
    const BASE_INDEX_BACKOFF_MS = 200;
    let lastIndexError = null;
    let node = null;

    for (let attempt = 1; attempt <= MAX_INDEX_WRITE_ATTEMPTS; attempt++) {
      try {
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
          console.warn(`[DISCORD] 写入索引失败，将重试 (${attempt}/${MAX_INDEX_WRITE_ATTEMPTS}) filename=${filename} dir=${dirPath}:`, e?.message || e);
          await this._sleep(backoffMs);
          continue;
        }
      }
    }

    if (!node) {
      const err = new DriverError(
        "Discord 上传已成功，但写入目录索引失败：为避免重复上传，已停止自动重试；请稍后手动重试一次复制/上传。",
        {
          status: ApiStatus.BAD_GATEWAY,
          code: "DRIVER_ERROR.DISCORD_INDEX_WRITE_FAILED",
          expose: true,
          details: {
            filename,
            dirPath,
            fileSize: blob.size,
            messageId: sendRes?.messageId ?? null,
            attachmentId: sendRes?.attachmentId ?? null,
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

  async renameItem(oldSubPath, newSubPath, ctx = {}) {
    this._ensureInitialized();
    return await discordRenameItem(this, oldSubPath, newSubPath, ctx);
  }

  async batchRemoveItems(subPaths, ctx = {}) {
    this._ensureInitialized();
    return await discordBatchRemoveItems(this, subPaths, ctx);
  }

  async copyItem(sourceSubPath, targetSubPath, ctx = {}) {
    this._ensureInitialized();
    return await discordCopyItem(this, sourceSubPath, targetSubPath, ctx);
  }

  // ===== MULTIPART 能力（前端分片：single_session + 后端中转） =====

  async initializeFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();
    return this.multipartOps.initializeFrontendMultipartUpload(subPath, options);
  }

  async completeFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();
    return this.multipartOps.completeFrontendMultipartUpload(subPath, options);
  }

  async abortFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();
    return this.multipartOps.abortFrontendMultipartUpload(subPath, options);
  }

  async listMultipartUploads(subPath = "", options = {}) {
    this._ensureInitialized();
    return this.multipartOps.listMultipartUploads(subPath, options);
  }

  async listMultipartParts(subPath, uploadId, options = {}) {
    this._ensureInitialized();
    return this.multipartOps.listMultipartParts(subPath, uploadId, options);
  }

  async signMultipartParts(subPath, uploadId, partNumbers, options = {}) {
    this._ensureInitialized();
    return this.multipartOps.signMultipartParts(subPath, uploadId, partNumbers, options);
  }

  async proxyFrontendMultipartChunk(sessionRow, body, options = {}) {
    this._ensureInitialized();
    return this.multipartOps.proxyFrontendMultipartChunk(sessionRow, body, options);
  }

  // ===== storage-first：删除对象（用于 /api/files delete_mode=both） =====
  async deleteObjectByStoragePath(storagePath, options = {}) {
    this._ensureInitialized();
    return await discordDeleteObjectByStoragePath(this, storagePath, options);
  }
}

export default DiscordStorageDriver;
