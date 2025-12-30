/**
 * HuggingFace Datasets（Hub）驱动 - 工具函数
 *
 * 路径规范化、URL 编码、日期/长度解析、数组分片、并发控制、分页 cursor 解析等。
 */

export const DEFAULT_ENDPOINT_BASE = "https://huggingface.co";

export function normalizeBaseUrl(url) {
  const raw = String(url || "").trim();
  const base = raw || DEFAULT_ENDPOINT_BASE;
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

export function normalizeRepoId(repo) {
  const raw = String(repo || "").trim();
  if (!raw) return "";
  // 允许用户误输入 https://huggingface.co/datasets/user/name 这类链接
  const cleaned = raw
    .replace(/^https?:\/\/huggingface\.co\/datasets\//i, "")
    .replace(/^datasets\//i, "")
    .replace(/^\/+|\/+$/g, "");
  return cleaned;
}

export function splitRepoId(repoId) {
  const cleaned = String(repoId || "").trim().replace(/^\/+|\/+$/g, "");
  const idx = cleaned.indexOf("/");
  if (idx <= 0) return { namespace: "", repo: "" };
  return {
    namespace: cleaned.slice(0, idx),
    repo: cleaned.slice(idx + 1),
  };
}

export function normalizeFolderPath(p) {
  const raw = String(p || "").trim();
  if (!raw) return "";
  return raw.replace(/^\/+|\/+$/g, "").replace(/[\\]+/g, "/").replace(/\/+/g, "/");
}

export function normalizeSubPath(subPath, { asDirectory = false } = {}) {
  const raw = subPath == null ? "" : String(subPath);
  let s = raw.replace(/[\\]+/g, "/").replace(/\/+/g, "/");
  if (!s.startsWith("/")) s = `/${s}`;
  if (asDirectory) {
    if (!s.endsWith("/")) s += "/";
  } else {
    // 文件路径不要尾随 /
    if (s.length > 1) s = s.replace(/\/+$/g, "");
  }
  return s;
}

export function encodePathForUrl(p) {
  const s = String(p || "");
  if (!s) return "";
  // 只对每一段做 encode，保留斜杠
  return s
    .split("/")
    .filter((seg) => seg !== "")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

export function parseHttpDate(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

export function parseContentLength(value) {
  if (!value) return null;
  const n = Number(String(value));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function isCommitSha(revision) {
  const r = String(revision || "").trim();
  return /^[0-9a-f]{40}$/i.test(r);
}

export function chunkArray(items, chunkSize) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(chunkSize) || 1);
  const result = [];
  for (let i = 0; i < list.length; i += size) {
    result.push(list.slice(i, i + size));
  }
  return result;
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  const limit = Math.max(1, Number(concurrency) || 1);
  const list = Array.isArray(items) ? items : [];
  /** @type {any[]} */
  const results = new Array(list.length);
  let cursor = 0;

  // 并发跑 mapper，但最多同时跑 limit 个，避免一次性把 Worker 打爆
  const workers = new Array(Math.min(limit, list.length)).fill(0).map(async () => {
    while (true) {
      const current = cursor++;
      if (current >= list.length) return;
      results[current] = await mapper(list[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * 从 Link header 里解析下一页 cursor（HF tree API 用）
 * 形态示例：<...&cursor=xxx>; rel="next"
 */
export function parseNextCursorFromLinkHeader(linkHeader) {
  const raw = String(linkHeader || "").trim();
  if (!raw) return null;
  const parts = raw.split(",").map((s) => s.trim());
  for (const part of parts) {
    if (!/rel=\"?next\"?/i.test(part)) continue;
    const m = part.match(/<([^>]+)>/);
    if (!m) continue;
    try {
      const url = new URL(m[1]);
      const cursor = url.searchParams.get("cursor");
      return cursor ? String(cursor) : null;
    } catch {
      return null;
    }
  }
  return null;
}
