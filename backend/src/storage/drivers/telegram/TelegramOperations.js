/**
 * TelegramOperations
 *
 *
 * 1) 工具函数（无副作用）：路径/字符串/JSON
 * 2) 并发阀门：避免并发失控导致 429
 * 3) Bot API 调用：统一“限并发 + 默认只在 429 重试”
 * 4) 索引层 CRUD：rename/copy/delete 只动 vfs_nodes
 *
 */

import { ApiStatus } from "../../../constants/index.js";
import { DriverError, ValidationError } from "../../../http/errors.js";
import { VfsNodesRepository, VFS_ROOT_PARENT_ID } from "../../../repositories/VfsNodesRepository.js";

// =========================
// 1) 工具函数
// =========================

export function normalizeApiBaseUrl(url) {
  const raw = String(url || "").trim();
  const fallback = "https://api.telegram.org";
  if (!raw) return fallback;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

export function toPosixPath(p) {
  if (p == null) return "/";
  let s = String(p).replace(/\\\\/g, "/");
  s = s.replace(/\/+/g, "/");
  if (!s.startsWith("/")) s = `/${s}`;
  return s;
}

export function stripTrailingSlash(p) {
  const s = String(p || "");
  if (s === "/") return "/";
  return s.replace(/\/+$/, "");
}

export function splitDirAndName(posixPath) {
  const p = stripTrailingSlash(toPosixPath(posixPath));
  if (p === "/") return { dirPath: "/", name: "" };
  const idx = p.lastIndexOf("/");
  if (idx <= 0) return { dirPath: "/", name: p.slice(1) };
  const dir = p.slice(0, idx) || "/";
  const name = p.slice(idx + 1);
  return { dirPath: dir || "/", name };
}

/**
 * 解析 Telegram 上传的目录与（可选）文件名：
 * - 当 target 是“目录路径”（以 / 结尾）时，dirPath 应为该目录本身（而不是父目录）
 * - 当 target 是“文件路径”时，按常规 splitDirAndName 解析
 *
 * 说明：前端流式/表单上传会把目录放在 path 里，文件名通过 header/meta 单独传递。
 * 如果后端把目录路径当成文件路径来 split，会导致写索引时把文件挂到根目录。
 */
export function resolveUploadDirAndName(targetPath, { isDirectoryTarget = false } = {}) {
  const normalized = toPosixPath(targetPath);
  const treatAsDir = isDirectoryTarget === true || normalized.endsWith("/");
  if (treatAsDir) {
    const dir = stripTrailingSlash(normalized);
    return { dirPath: dir || "/", name: "" };
  }
  return splitDirAndName(normalized);
}

export function safeJsonParse(text) {
  if (!text) return null;
  if (typeof text === "object") return text;
  try {
    return JSON.parse(String(text));
  } catch {
    return null;
  }
}

export function normalizePartList(manifest) {
  const parts = Array.isArray(manifest?.parts) ? manifest.parts : [];
  return parts
    .map((p) => ({
      partNo: Number(p?.partNo ?? p?.part_no ?? p?.part),
      size: Number(p?.size),
      fileId: p?.file_id ?? p?.fileId ?? null,
      messageId: p?.message_id ?? p?.messageId ?? null,
      chatId: p?.chat_id ?? p?.chatId ?? null,
    }))
    .filter((p) => Number.isFinite(p.partNo) && p.partNo > 0 && p.fileId);
}

// =========================
// 2) 并发阀门（Semaphore）
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

// 同一个 Worker 进程内所有 TelegramStorageDriver 实例共享并发预算
const uploadSemaphores = new Map();

export function getUploadSemaphore(key, max) {
  const k = String(key || "telegram-default");
  let sem = uploadSemaphores.get(k);
  if (!sem) {
    sem = new AsyncSemaphore(max);
    uploadSemaphores.set(k, sem);
    return sem;
  }
  sem.setMax(max);
  return sem;
}

// =========================
// 3) Bot API 调用（限并发 + 重试策略）
// =========================

function getTelegramSemaphoreKey(driver) {
  // 用 storage_config_id 优先：同一个配置（同一个 bot/chat）共享并发预算
  // 兜底用 chatId：避免没有 config.id 时并发失控
  return driver?.config?.id || `${driver?.targetChatId || "unknown-chat"}`;
}

async function withTelegramConcurrency(driver, fn) {
  const sem = getUploadSemaphore(getTelegramSemaphoreKey(driver), driver?.uploadConcurrency);
  const release = await sem.acquire();
  try {
    return await fn();
  } finally {
    try {
      release?.();
    } catch {}
  }
}

function calcTelegramRetryWaitMs({ attempt, retryAfterSec, baseDelayMs }) {
  const retryAfter = Number(retryAfterSec);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    // Telegram 给的 retry_after（秒）是最权威的
    return Math.max(1000, Math.floor(retryAfter * 1000) + 200);
  }
  // 兜底：指数退避（但上限别太大，避免卡住体验）
  return Math.min(10_000, (Number(baseDelayMs) || 900) * Math.pow(2, (Number(attempt) || 1) - 1));
}

export function buildBotApiUrl(driver, method) {
  const base = driver?.apiBaseUrl || "https://api.telegram.org";
  const m = String(method || "").replace(/^\/+/, "");
  return `${base}/bot${driver?.botToken}/${m}`;
}

export function buildBotFileUrl(driver, filePath) {
  const base = driver?.apiBaseUrl || "https://api.telegram.org";
  const fp = String(filePath || "").replace(/^\/+/, "");
  return `${base}/file/bot${driver?.botToken}/${fp}`;
}

/**
 * 统一的 Bot API JSON 请求封装
 *
 * 默认只对 429 重试
 * 可选对 5xx/异常做退避重试
 *
 * 这里会调用 driver._sleep()，driver 有统一的“可取消 sleep”。
 */
export async function callTelegramBotApiJson(driver, url, makeInit, options = {}) {
  const operation = options?.operation || "telegram-bot-api";
  const signal = options?.signal;
  const maxAttempts = Number(options?.maxAttempts) || 1;
  const baseDelayMs = Number(options?.baseDelayMs) || 900;
  const retryOn429 = options?.retryOn429 !== false;
  const retryOn5xx = options?.retryOn5xx === true;
  const retryOnException = options?.retryOnException === true;
  const errorFactory =
    typeof options?.errorFactory === "function"
      ? options.errorFactory
      : (resp, data) =>
          new DriverError(`TELEGRAM 请求失败（${operation}）`, {
            status: ApiStatus.BAD_GATEWAY,
            code: "DRIVER_ERROR.TELEGRAM_API_FAILED",
            expose: false,
            details: { status: resp?.status ?? null, response: data ?? null },
          });

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { resp, data } = await withTelegramConcurrency(driver, async () => {
        const init = (typeof makeInit === "function" ? makeInit(attempt) : makeInit) || {};
        const r = await fetch(url, { ...init, signal });
        const d = await r.json().catch(() => null);
        return { resp: r, data: d };
      });

      if (resp.ok && data?.ok) {
        return { resp, data };
      }

      const errorCode = data?.error_code ?? resp.status ?? 0;
      const retryAfterSec = data?.parameters?.retry_after ?? null;

      if (retryOn429 && (resp.status === 429 || errorCode === 429) && attempt < maxAttempts) {
        const waitMs = calcTelegramRetryWaitMs({ attempt, retryAfterSec, baseDelayMs });
        await driver._sleep(waitMs, { signal });
        continue;
      }

      if (retryOn5xx && resp.status >= 500 && attempt < maxAttempts) {
        const waitMs = calcTelegramRetryWaitMs({ attempt, retryAfterSec: null, baseDelayMs });
        await driver._sleep(waitMs, { signal });
        continue;
      }

      const err = errorFactory(resp, data);
      if (err && typeof err === "object" && typeof err.retryable !== "boolean") {
        err.retryable = false;
      }
      throw err;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts && retryOnException) {
        const waitMs = calcTelegramRetryWaitMs({ attempt, retryAfterSec: null, baseDelayMs });
        await driver._sleep(waitMs, { signal });
        continue;
      }
      break;
    }
  }

  if (lastError) throw lastError;
  throw new DriverError(`TELEGRAM 请求失败（${operation}）`, {
    status: ApiStatus.BAD_GATEWAY,
    code: "DRIVER_ERROR.TELEGRAM_API_FAILED",
    expose: false,
  });
}

export async function getFileInfo(driver, fileId, options = {}) {
  const url = buildBotApiUrl(driver, "getFile");
  const qs = new URLSearchParams();
  qs.set("file_id", String(fileId));
  const full = `${url}?${qs.toString()}`;

  const maxAttempts = 5;
  const baseDelayMs = 900;

  const { data } = await callTelegramBotApiJson(driver, full, () => ({ method: "GET" }), {
    operation: "getFile",
    signal: options?.signal,
    maxAttempts,
    baseDelayMs,
    retryOn429: true,
    retryOn5xx: true,
    retryOnException: true,
    errorFactory: (resp, responseData) =>
      new DriverError("TELEGRAM 获取文件信息失败（getFile）", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.TELEGRAM_GET_FILE_FAILED",
        expose: false,
        details: { status: resp?.status ?? null, response: responseData ?? null },
      }),
  });

  const filePath = data?.result?.file_path || null;
  const fileSize = data?.result?.file_size ?? null;
  if (!filePath) {
    throw new DriverError("TELEGRAM getFile 回执缺少 file_path", {
      status: ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.TELEGRAM_INVALID_RESPONSE",
      expose: false,
      details: { response: data },
    });
  }
  return { filePath, fileSize };
}

export async function getFileDownloadUrl(driver, fileId, options = {}) {
  const info = await getFileInfo(driver, fileId, options);
  return buildBotFileUrl(driver, info.filePath);
}

/**
 * sendDocument（上传一个文件）
 *
 * - 成功一次就会在频道里产生一条消息
 * - Bot API 没有官方幂等机制
 *
 * 只在 429 时重试，其它失败不自动重试。
 */
export async function sendDocument(driver, blob, { filename, contentType } = {}) {
  const url = buildBotApiUrl(driver, "sendDocument");

  const maxAttempts = 4; // 仅用于 429 重试
  const baseDelayMs = 900;
  const safeFilename = filename && String(filename).trim() ? String(filename).trim() : "file.bin";

  try {
    const { data } = await callTelegramBotApiJson(
      driver,
      url,
      () => {
        const form = new FormData();
        form.append("chat_id", driver.targetChatId);
        form.append("document", blob, safeFilename);
        form.append("disable_content_type_detection", "true");
        return { method: "POST", body: form };
      },
      {
        operation: "sendDocument",
        maxAttempts,
        baseDelayMs,
        retryOn429: true,
        retryOn5xx: false,
        retryOnException: false,
        errorFactory: (resp, data0) => {
          const err = new DriverError("TELEGRAM 上传失败（sendDocument）", {
            status: ApiStatus.BAD_GATEWAY,
            code: "DRIVER_ERROR.TELEGRAM_SEND_DOCUMENT_FAILED",
            expose: false,
            details: { status: resp?.status ?? null, response: data0 ?? null },
          });
          err.retryable = false;
          return err;
        },
      }
    );

    const result = data.result || null;
    const messageId = result?.message_id ?? null;

    // 回执里“文件字段”可能在不同位置，做兜底提取
    const photo = Array.isArray(result?.photo) && result.photo.length ? result.photo[result.photo.length - 1] : null;
    const newChatPhoto = Array.isArray(result?.new_chat_photo) && result.new_chat_photo.length ? result.new_chat_photo[result.new_chat_photo.length - 1] : null;
    const gamePhoto = Array.isArray(result?.game?.photo) && result.game.photo.length ? result.game.photo[result.game.photo.length - 1] : null;
    const gameAnimation = result?.game?.animation || null;
    const fileLike =
      result?.document ||
      result?.audio ||
      result?.voice ||
      result?.video ||
      result?.video_note ||
      result?.animation ||
      result?.sticker ||
      photo ||
      newChatPhoto ||
      gameAnimation ||
      gamePhoto ||
      null;

    const fileId = fileLike?.file_id ?? null;
    const fileUniqueId = fileLike?.file_unique_id ?? null;

    if (!messageId || !fileId) {
      const err = new DriverError("TELEGRAM 上传回执缺少 message_id/file_id", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.TELEGRAM_INVALID_RESPONSE",
        expose: false,
        details: {
          response: data,
          resultKeys: result && typeof result === "object" ? Object.keys(result) : null,
        },
      });
      err.retryable = false;
      throw err;
    }

    // 上传后校验：开启后会再调用 getFile 校验大小（更慢但更稳）
    if (driver.verifyAfterUpload) {
      try {
        const info = await getFileInfo(driver, fileId, {});
        const actualSize = Number(info?.fileSize);
        if (Number.isFinite(actualSize) && actualSize >= 0 && actualSize !== blob.size) {
          const err = new DriverError("TELEGRAM 上传后校验失败：文件大小不一致", {
            status: ApiStatus.BAD_GATEWAY,
            code: "DRIVER_ERROR.TELEGRAM_UPLOAD_VERIFY_FAILED",
            expose: false,
            details: { expected: blob.size, actual: actualSize },
          });
          err.retryable = false;
          throw err;
        }
      } catch (verifyError) {
        if (verifyError && verifyError.retryable === false) {
          throw verifyError;
        }
        console.warn("[TELEGRAM] 上传后校验失败（已忽略，不影响本次上传结果）：", verifyError?.message || verifyError);
      }
    }

    void contentType;
    return { messageId, fileId, fileUniqueId };
  } catch (err) {
    // 兜底：sendDocument 任何失败都不要让上层自动重试
    if (err && typeof err === "object" && typeof err.retryable !== "boolean") {
      err.retryable = false;
    }
    throw err;
  }
}

// =========================
// 4) 索引层 CRUD（只动 vfs_nodes）
// =========================

export async function renameItem(driver, oldSubPath, newSubPath, ctx = {}) {
  driver._ensureInitialized();
  const db = ctx?.db || null;
  if (!db) throw new ValidationError("TELEGRAM.renameItem: 缺少 db");

  const oldPath = ctx?.oldPath;
  const newPath = ctx?.newPath;

  const { ownerType, ownerId } = driver._getOwnerFromOptions(ctx);
  const { scopeType, scopeId } = driver._getScopeFromOptions(ctx);
  const repo = new VfsNodesRepository(db, null);

  const oldSub = toPosixPath(oldSubPath || "/");
  const newSub = toPosixPath(newSubPath || "/");

  const node = await repo.resolveNodeByPath({ ownerType, ownerId, scopeType, scopeId, path: oldSub });
  if (!node) {
    return { success: false, source: oldPath, target: newPath, message: "源路径不存在" };
  }

  const { dirPath: newDirPath, name: newName } = splitDirAndName(newSub);
  if (!newName) {
    return { success: false, source: oldPath, target: newPath, message: "目标名称为空" };
  }

  // 确保目标父目录存在
  const ensured = await repo.ensureDirectoryPath({ ownerType, ownerId, scopeType, scopeId, path: newDirPath });
  const targetParentId = ensured?.parentId ?? VFS_ROOT_PARENT_ID;

  // 先改名，再移动
  let current = node;
  if (String(current.name) !== String(newName)) {
    current = await repo.renameNode({ ownerType, ownerId, scopeType, scopeId, nodeId: String(current.id), newName });
  }

  if (String(current.parent_id) !== String(targetParentId)) {
    current = await repo.moveNode({
      ownerType,
      ownerId,
      scopeType,
      scopeId,
      nodeId: String(current.id),
      newParentId: targetParentId,
    });
  }

  return { success: true, source: oldPath, target: newPath, message: undefined };
}

export async function batchRemoveItems(driver, subPaths, ctx = {}) {
  driver._ensureInitialized();
  const db = ctx?.db || null;
  if (!db) throw new ValidationError("TELEGRAM.batchRemoveItems: 缺少 db");

  if (!Array.isArray(subPaths) || subPaths.length === 0) {
    return { success: 0, failed: [] };
  }

  if (!Array.isArray(ctx?.paths) || ctx.paths.length !== subPaths.length) {
    throw new ValidationError("TELEGRAM.batchRemoveItems 需要 ctx.paths 与 subPaths 一一对应（不做兼容）");
  }

  const { ownerType, ownerId } = driver._getOwnerFromOptions(ctx);
  const { scopeType, scopeId } = driver._getScopeFromOptions(ctx);
  const repo = new VfsNodesRepository(db, null);

  const fsPaths = ctx.paths;
  const failed = [];
  let success = 0;

  for (let i = 0; i < subPaths.length; i += 1) {
    const fsPath = fsPaths[i];
    const sub = toPosixPath(subPaths[i] || "/");

    try {
      const node = await repo.resolveNodeByPath({ ownerType, ownerId, scopeType, scopeId, path: sub });
      if (!node) {
        success += 1;
        continue;
      }

      // Telegram：只删索引，不删 Telegram 内容
      await repo.deleteNode({ ownerType, ownerId, scopeType, scopeId, nodeId: String(node.id), mode: "hard" });
      success += 1;
    } catch (e) {
      failed.push({ path: fsPath, error: e?.message || String(e) });
    }
  }

  return { success, failed };
}

async function copyDirectoryTree(driver, repo, { ownerType, ownerId, scopeType, scopeId, sourceDirId, targetDirId }) {
  const children = await repo.listChildrenByParentId({ ownerType, ownerId, scopeType, scopeId, parentId: sourceDirId });
  for (const row of children) {
    if (row.node_type === "dir") {
      const newDir = await repo
        .createDirectory({
          ownerType,
          ownerId,
          scopeType,
          scopeId,
          parentId: targetDirId,
          name: row.name,
        })
        .catch(async () => {
          const existsDir = await repo.getChildByName({
            ownerType,
            ownerId,
            scopeType,
            scopeId,
            parentId: targetDirId,
            name: row.name,
          });
          if (!existsDir || existsDir.node_type !== "dir") throw new ValidationError("目录复制冲突：目标同名不是目录");
          return existsDir;
        });

      await copyDirectoryTree(driver, repo, {
        ownerType,
        ownerId,
        scopeType,
        scopeId,
        sourceDirId: String(row.id),
        targetDirId: String(newDir.id),
      });
      continue;
    }

    await repo.createOrUpdateFileNode({
      ownerType,
      ownerId,
      scopeType,
      scopeId,
      parentId: targetDirId,
      name: row.name,
      mimeType: row.mime_type || null,
      size: row.size || null,
      storageType: row.storage_type || driver.type,
      contentRef: safeJsonParse(row.content_ref) || row.content_ref,
    });
  }
}

export async function copyItem(driver, sourceSubPath, targetSubPath, ctx = {}) {
  driver._ensureInitialized();
  const db = ctx?.db || null;
  if (!db) throw new ValidationError("TELEGRAM.copyItem: 缺少 db");

  const sourcePath = ctx?.sourcePath;
  const targetPath = ctx?.targetPath;

  const { ownerType, ownerId } = driver._getOwnerFromOptions(ctx);
  const { scopeType, scopeId } = driver._getScopeFromOptions(ctx);
  const repo = new VfsNodesRepository(db, null);

  const skipExisting = !!ctx?.skipExisting;

  const sourceSub = toPosixPath(sourceSubPath || "/");
  const targetSub = toPosixPath(targetSubPath || "/");

  const src = await repo.resolveNodeByPath({ ownerType, ownerId, scopeType, scopeId, path: sourceSub });
  if (!src) {
    return { status: "failed", source: sourcePath, target: targetPath, message: "源路径不存在" };
  }

  const { dirPath: targetDirPath, name: targetName } = splitDirAndName(targetSub);
  if (!targetName) {
    return { status: "failed", source: sourcePath, target: targetPath, message: "目标名称为空" };
  }

  // 确保目标父目录存在
  const ensured = await repo.ensureDirectoryPath({ ownerType, ownerId, scopeType, scopeId, path: targetDirPath });
  const targetParentId = ensured?.parentId ?? VFS_ROOT_PARENT_ID;

  // skipExisting：如果目标已存在，直接跳过
  if (skipExisting) {
    const exists = await repo.getChildByName({ ownerType, ownerId, scopeType, scopeId, parentId: targetParentId, name: targetName });
    if (exists) {
      return { status: "skipped", source: sourcePath, target: targetPath, skipped: true, reason: "target_exists" };
    }
  }

  if (src.node_type === "dir") {
    const targetDirNode = await repo.createDirectory({ ownerType, ownerId, scopeType, scopeId, parentId: targetParentId, name: targetName }).catch(async () => {
      const existsDir = await repo.getChildByName({
        ownerType,
        ownerId,
        scopeType,
        scopeId,
        parentId: targetParentId,
        name: targetName,
      });
      if (!existsDir || existsDir.node_type !== "dir") throw new ValidationError("目标已存在但不是目录");
      return existsDir;
    });

    await copyDirectoryTree(driver, repo, {
      ownerType,
      ownerId,
      scopeType,
      scopeId,
      sourceDirId: String(src.id),
      targetDirId: String(targetDirNode.id),
    });
    return { status: "success", source: sourcePath, target: targetPath, skipped: false };
  }

  // 文件复制：复用 content_ref（manifest）
  await repo.createOrUpdateFileNode({
    ownerType,
    ownerId,
    scopeType,
    scopeId,
    parentId: targetParentId,
    name: targetName,
    mimeType: src.mime_type || null,
    size: src.size || null,
    storageType: src.storage_type || driver.type,
    contentRef: safeJsonParse(src.content_ref) || src.content_ref,
  });

  return { status: "success", source: sourcePath, target: targetPath, skipped: false };
}

export async function deleteObjectByStoragePath(driver, storagePath, options = {}) {
  driver._ensureInitialized();
  const db = options?.db || null;
  if (!db) throw new ValidationError("TELEGRAM.deleteObjectByStoragePath: 缺少 db");

  const nodeId = driver._parseVfsStoragePath(storagePath);
  if (!nodeId) {
    throw new ValidationError("TELEGRAM.deleteObjectByStoragePath: 仅支持 vfs:<id> 形式的 storagePath");
  }

  const repo = new VfsNodesRepository(db, null);
  const node = await repo.getNodeByIdUnsafe(nodeId);
  if (!node) return { success: true };

  await repo.deleteNode({
    ownerType: node.owner_type,
    ownerId: node.owner_id,
    scopeType: node.scope_type,
    scopeId: node.scope_id,
    nodeId: String(node.id),
    mode: "hard",
  });

  return { success: true };
}
