/**
 * Telegram 文件信息缓存（内存）
 *
 * 减少 Telegram Bot API 的 getFile 调用次数。
 * 缓存：file_id -> { filePath, fileSize }
 */

const CACHE_TTL_MS = 10 * 60 * 1000; // 10分钟
const CACHE_MAX_ITEMS = 500;

/** @type {Map<string, { filePath: string, fileSize: number|null, cachedAtMs: number }>} */
const fileInfoCache = new Map();

const shouldLog = () => {
  // 只做调试日志：默认关闭
  try {
    if (typeof process !== "undefined" && process?.env?.DEBUG_TG_FILEINFO_CACHE === "1") return true;
  } catch {}
  try {
    if (typeof globalThis !== "undefined" && globalThis?.DEBUG_TG_FILEINFO_CACHE === true) return true;
  } catch {}
  return false;
};

export function clearTelegramFileInfoCache() {
  fileInfoCache.clear();
  if (shouldLog()) {
    console.log("[TG fileInfoCache] cleared");
  }
}

export function getCachedTelegramFileInfo(fileId) {
  const key = fileId ? String(fileId) : "";
  if (!key) return null;

  const cached = fileInfoCache.get(key) || null;
  if (!cached) return null;

  const cachedAtMs = Number(cached.cachedAtMs) || 0;
  if (cachedAtMs <= 0 || Date.now() - cachedAtMs > CACHE_TTL_MS) {
    fileInfoCache.delete(key);
    return null;
  }

  // LRU：刷新顺序（Map 的插入顺序）
  fileInfoCache.delete(key);
  fileInfoCache.set(key, cached);

  if (shouldLog()) {
    console.log(`[TG fileInfoCache] hit fileId=${key}`);
  }
  return { filePath: cached.filePath, fileSize: cached.fileSize ?? null };
}

export function setCachedTelegramFileInfo(fileId, info) {
  const key = fileId ? String(fileId) : "";
  if (!key) return;

  const filePath = info?.filePath || null;
  if (!filePath) return;

  fileInfoCache.set(key, {
    filePath: String(filePath),
    fileSize: info?.fileSize ?? null,
    cachedAtMs: Date.now(),
  });

  // 超限时淘汰最旧
  while (fileInfoCache.size > CACHE_MAX_ITEMS) {
    const oldestKey = fileInfoCache.keys().next().value;
    if (!oldestKey) break;
    fileInfoCache.delete(oldestKey);
  }
}
