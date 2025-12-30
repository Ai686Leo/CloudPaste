/**
 * HuggingFace Datasets（Hub）驱动 - Hub API 相关工具集合
 *
 * - 常量（limit/缓存 TTL 等）
 * - URL 拼装（tree/refs/treesize/commit/resolve）
 * - 仓库元信息（是否需要 token、refs 缓存、revision 类型）
 * - tree 分页（cursor / Link next）
 * - paths-info 批量与缓存
 * - 写入（commit、NDJSON 提交、LFS 服务端 copy、读取 blob）
 *
 */

import { commit as hfCommit, listFiles as hfListFiles, pathsInfo as hfPathsInfo } from "@huggingface/hub";
import { ApiStatus } from "../../../constants/index.js";
import { DriverError, NotFoundError } from "../../../http/errors.js";
import { chunkArray, encodePathForUrl, isCommitSha, mapWithConcurrency, normalizeFolderPath, parseNextCursorFromLinkHeader } from "./hfUtils.js";

// ====== 常量 ======

// 默认分支（不填 revision 时用）
export const DEFAULT_REVISION = "main";
// 目录占位文件名：我们在文件列表里隐藏它（避免用户看到一堆空目录 .gitkeep）
export const GITKEEP_FILENAME = ".gitkeep";
// 一次 commit 最多包含多少个文件操作（太多容易失败/超时/被上游拒绝）
export const MAX_COMMIT_OPERATIONS_PER_BATCH = 100;

// paths-info 一次最多查多少个路径（请求体太大容易慢/被限流）
const PATHS_INFO_BATCH_SIZE = 200;
// paths-info 结果缓存多久（ms），避免连续刷新重复请求
const PATHS_INFO_CACHE_TTL_MS = 30_000;

// refs（分支/标签）缓存多久（ms），避免频繁探测导致多余请求
const REFS_CACHE_TTL_MS = 60_000;

// tree API 在 expand=true 时的默认每页条数（返回字段更多，响应更重）
const DEFAULT_TREE_LIMIT_WHEN_EXPAND = 100;
// tree API 在 expand=false 时的默认每页条数（响应较轻，可以更大页减少请求数）
const DEFAULT_TREE_LIMIT_WHEN_NO_EXPAND = 1000;
// tree 单页结果缓存多久（ms），防止短时间内重复拉同一页打爆上游
const TREE_PAGE_CACHE_TTL_MS = 10_000;

// ====== URL 拼装 ======

export function buildAuthHeaders(token, extra = {}) {
  const headers = { ...extra };
  const t = String(token || "").trim();
  if (t) headers.Authorization = `Bearer ${t}`;
  return headers;
}

export function buildTreeApiUrl({ endpointBase, repoId, revision, repoPath }) {
  const repo = encodePathForUrl(repoId);
  const rev = encodeURIComponent(String(revision || "").trim());
  // HuggingFace OpenAPI 里 tree 接口是 /tree/{rev}/{path}（path 必填）。
  const p = repoPath ? encodePathForUrl(repoPath) : "";
  return `${endpointBase}/api/datasets/${repo}/tree/${rev}/${p}`;
}

export function buildTreeApiUrlWithQuery(
  { endpointBase, repoId, revision, repoPath },
  { expand = false, recursive = false, limit = null, cursor = null } = {},
) {
  const base = buildTreeApiUrl({ endpointBase, repoId, revision, repoPath });
  const params = new URLSearchParams();
  if (expand) params.set("expand", "true");
  if (recursive) params.set("recursive", "true");
  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) params.set("limit", String(Math.floor(limit)));
  if (cursor) params.set("cursor", String(cursor));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function buildRefsApiUrl({ endpointBase, repoParts }, { includePrs = false } = {}) {
  const ns = encodeURIComponent(String(repoParts?.namespace || ""));
  const repo = encodeURIComponent(String(repoParts?.repo || ""));
  const url = `${endpointBase}/api/datasets/${ns}/${repo}/refs`;
  if (includePrs) return `${url}?include_prs=true`;
  return url;
}

export function buildTreeSizeApiUrl({ endpointBase, repoParts, revision, repoPath }) {
  const ns = encodeURIComponent(String(repoParts?.namespace || ""));
  const repo = encodeURIComponent(String(repoParts?.repo || ""));
  const rev = encodeURIComponent(String(revision || "").trim());
  const p = repoPath ? encodePathForUrl(repoPath) : "";
  return `${endpointBase}/api/datasets/${ns}/${repo}/treesize/${rev}/${p}`;
}

export function buildCommitApiUrl({ endpointBase, repoId, revision }) {
  const repo = encodePathForUrl(repoId);
  const branch = encodeURIComponent(String(revision || "").trim());
  return `${endpointBase}/api/datasets/${repo}/commit/${branch}`;
}

export function buildResolveUrl({ endpointBase, repoId, revision, repoPath }, { download = false } = {}) {
  const repo = encodePathForUrl(repoId);
  const rev = encodeURIComponent(String(revision || "").trim());
  const p = repoPath ? encodePathForUrl(repoPath) : "";
  const base = `${endpointBase}/datasets/${repo}/resolve/${rev}/${p}`;
  if (!download) return base;
  return `${base}?download=true`;
}

export function buildLfsBatchApiUrl({ endpointBase, repoDesignation }) {
  const type = repoDesignation?.type || "dataset";
  const name = repoDesignation?.name || "";
  const repo = encodePathForUrl(name);
  // huggingface.js 的实现：`${hubUrl}/${repoId.type === "model" ? "" : repoId.type + "s/"}${repoId.name}.git/info/lfs/objects/batch`
  // dataset => /datasets/{namespace/repo}.git/info/lfs/objects/batch
  const prefix = type === "model" ? "" : `${type}s/`;
  return `${endpointBase}/${prefix}${repo}.git/info/lfs/objects/batch`;
}

/**
 * HuggingFace Hub “危险区”接口：列出/永久删除 LFS 对象
 *
 * - 在仓库里删文件（commit delete）只会删掉“指针文件”（LFS pointer），不会自动把“LFS 大文件对象”从存储里清掉
 * - 所以 HF Settings → Storage → List LFS files 里还会看到它；再次上传同内容会被判定“已存在”（秒传/skip upload）
 * - 需要调用 Hub 的 lfs-files API（这会影响历史 commit，属于危险操作）
 * - GET  /api/{repo_type}s/{repo_id}/lfs-files
 * - POST /api/{repo_type}s/{repo_id}/lfs-files/batch   body: { deletions: { sha: [fileOid...], rewriteHistory: boolean } }
 */
export function buildLfsFilesApiUrl({ endpointBase, repoDesignation }) {
  const type = repoDesignation?.type || "dataset";
  const name = repoDesignation?.name || "";
  const repo = encodePathForUrl(name);
  return `${endpointBase}/api/${type}s/${repo}/lfs-files`;
}

export function buildLfsFilesBatchApiUrl({ endpointBase, repoDesignation }) {
  const type = repoDesignation?.type || "dataset";
  const name = repoDesignation?.name || "";
  const repo = encodePathForUrl(name);
  return `${endpointBase}/api/${type}s/${repo}/lfs-files/batch`;
}

async function fetchOrThrow(url, { method = "GET", headers = {}, body = null, parse = "json" } = {}) {
  let resp;
  try {
    resp = await fetch(url, {
      method,
      headers,
      ...(body != null ? { body } : {}),
      redirect: "follow",
    });
  } catch (e) {
    throw new DriverError(`HuggingFace 请求失败：网络错误（${e?.message || "fetch failed"}）`, {
      status: ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.HUGGINGFACE_UPSTREAM_NETWORK",
      expose: false,
      details: { url, method },
    });
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new DriverError(`HuggingFace 请求失败: HTTP ${resp.status}`, {
      status: resp.status,
      code: "DRIVER_ERROR.HUGGINGFACE_HTTP",
      expose: resp.status < 500,
      details: { url, method, response: text?.slice?.(0, 500) || "" },
    });
  }

  // - /lfs-files: 返回 JSON 数组（需要解析）
  // - /lfs-files/batch: 有些情况下会返回纯文本 "OK"（huggingface_hub 也不会解析 body，只检查状态码）
  if (parse === "none") {
    return { resp, json: null, text: null };
  }
  if (parse === "text") {
    const text = await resp.text().catch(() => "");
    return { resp, json: null, text };
  }
  try {
    const json = await resp.json();
    return { resp, json, text: null };
  } catch (e) {
    const text = await resp.text().catch(() => "");
    throw new DriverError("HuggingFace 响应不是有效 JSON（可能是上游返回了纯文本 OK）", {
      status: ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.HUGGINGFACE_INVALID_JSON",
      expose: false,
      details: { url, method, response: text?.slice?.(0, 200) || "", cause: e?.message || String(e) },
    });
  }
}

/**
 * 列出仓库所有 LFS 对象（分页）。
 *
 * @returns {Promise<Array<any>>} 返回 HuggingFace 的原始条目（字段通常是 camelCase：fileOid/filename/oid/pushedAt/ref/size）
 */
export async function listLfsFiles(driver, { stopWhenFoundOids = null, maxPages = 200 } = {}) {
  const baseUrl = buildLfsFilesApiUrl({ endpointBase: driver._endpointBase, repoDesignation: driver._getHubRepoDesignation() });
  const wanted = Array.isArray(stopWhenFoundOids) ? new Set(stopWhenFoundOids.filter(Boolean).map(String)) : null;

  /** @type {Array<any>} */
  const items = [];

  let pageUrl = baseUrl;
  let pages = 0;
  while (pageUrl) {
    pages += 1;
    if (pages > maxPages) {
      break;
    }

    const { resp, json } = await fetchOrThrow(pageUrl, {
      method: "GET",
      headers: buildAuthHeaders(driver._token, { Accept: "application/json" }),
      parse: "json",
    });

    if (!Array.isArray(json)) {
      throw new DriverError("HuggingFace LFS 列表返回格式异常（预期数组）", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.HUGGINGFACE_LFS_LIST_INVALID",
        expose: false,
        details: { url: pageUrl },
      });
    }

    for (const it of json) {
      items.push(it);
      if (wanted) {
        const fileOid = it?.fileOid ? String(it.fileOid) : "";
        const oid = it?.oid ? String(it.oid) : "";
        if (fileOid && wanted.has(fileOid)) wanted.delete(fileOid);
        if (oid && wanted.has(oid)) wanted.delete(oid);
      }
    }

    if (wanted && wanted.size === 0) {
      break;
    }

    const link = resp.headers?.get?.("Link") || resp.headers?.get?.("link") || "";
    const nextCursor = parseNextCursorFromLinkHeader(link);
    if (!nextCursor) {
      break;
    }
    pageUrl = `${baseUrl}?cursor=${encodeURIComponent(nextCursor)}`;
  }

  return items;
}

/**
 * 永久删除 LFS 对象（危险操作）
 *
 * HuggingFace 的 delete API 使用的是 `fileOid`（不是文件路径）。而你通常拿到的是 `pathsInfo().lfs.oid`。
 * 所以这里提供一个“先 list，再把 oid -> fileOid 对齐”的解析能力，避免传错。
 */
export async function permanentlyDeleteLfsFiles(driver, fileOids) {
  const url = buildLfsFilesBatchApiUrl({ endpointBase: driver._endpointBase, repoDesignation: driver._getHubRepoDesignation() });
  const list = Array.isArray(fileOids) ? fileOids.filter(Boolean).map(String) : [];
  if (list.length === 0) return { deleted: 0 };

  let deleted = 0;
  for (const chunk of chunkArray(list, 1000)) {
    const payload = JSON.stringify({
      deletions: {
        sha: chunk,
        rewriteHistory: false,
      },
    });

    await fetchOrThrow(url, {
      method: "POST",
      headers: buildAuthHeaders(driver._token, {
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: payload,
      parse: "none",
    });

    deleted += chunk.length;
  }

  return { deleted };
}

/**
 * 把 “pathsInfo().lfs.oid” 映射成 “lfs-files API 需要的 fileOid”。
 * - 如果找不到映射（上游字段差异），会回退：直接把输入 oid 当作 fileOid
 */
export async function resolveLfsFileOids(driver, lfsOids) {
  const wanted = Array.isArray(lfsOids) ? lfsOids.filter(Boolean).map(String) : [];
  const wantedSet = new Set(wanted);
  if (wantedSet.size === 0) return { fileOids: [], unresolved: [] };

  const items = await listLfsFiles(driver, { stopWhenFoundOids: wanted, maxPages: 200 });

  /** @type {Map<string, string>} */
  const oidToFileOid = new Map();
  for (const it of items) {
    const fileOid = it?.fileOid ? String(it.fileOid) : "";
    const oid = it?.oid ? String(it.oid) : "";
    if (fileOid) {
      oidToFileOid.set(fileOid, fileOid);
    }
    if (oid && fileOid) {
      oidToFileOid.set(oid, fileOid);
    }
  }

  const fileOids = [];
  const unresolved = [];
  for (const oid of wantedSet) {
    const mapped = oidToFileOid.get(oid);
    if (mapped) {
      fileOids.push(mapped);
    } else {
      unresolved.push(oid);
      fileOids.push(oid);
    }
  }

  return { fileOids: Array.from(new Set(fileOids)), unresolved };
}

// ====== 仓库元信息（access / refs / revision kind） ======

export async function getDatasetAccessInfo(driver) {
  const now = Date.now();
  if (driver._accessCache?.value && driver._accessCache.expiresAt > now) {
    return driver._accessCache.value;
  }

  const repo = encodePathForUrl(driver._repo);
  const url = `${driver._endpointBase}/api/datasets/${repo}`;

  /** @type {{ requiresAuth: boolean, isPrivate: boolean, isGated: boolean }} */
  let info = { requiresAuth: false, isPrivate: false, isGated: false };

  try {
    const json = await driver._fetchJson(url, {
      method: "GET",
      headers: buildAuthHeaders(driver._token, { Accept: "application/json" }),
    });

    const isPrivate = json?.private === true;
    // gated 的字段名在不同版本可能叫 gated / gated_dataset / gatedRepo，这里做容错
    const isGated =
      json?.gated === true ||
      json?.gated_dataset === true ||
      json?.gatedRepo === true ||
      json?.gated_repo === true;

    info = {
      requiresAuth: isPrivate || isGated,
      isPrivate,
      isGated,
    };
  } catch (e) {
    const status = e?.status || e?.details?.status;
    if (status === 401 || status === 403) {
      info = { requiresAuth: true, isPrivate: true, isGated: false };
    } else if (status === 404) {
      throw new NotFoundError("HuggingFace 数据集不存在或无权限访问");
    }
  }

  driver._accessCache.value = info;
  driver._accessCache.expiresAt = now + 60_000; // 60 秒
  return info;
}

export async function getRefs(driver) {
  const now = Date.now();
  if (driver._refsCache && driver._refsCache.expiresAt > now) {
    return { branches: driver._refsCache.branches, tags: driver._refsCache.tags };
  }
  if (driver._refsInflight) return await driver._refsInflight;

  driver._refsInflight = (async () => {
    try {
      const url = buildRefsApiUrl({ endpointBase: driver._endpointBase, repoParts: driver._repoParts }, { includePrs: false });
      const json = await driver._fetchJson(url, {
        method: "GET",
        headers: buildAuthHeaders(driver._token, { Accept: "application/json" }),
      });

      const branches = new Set();
      const tags = new Set();

      const rawBranches = Array.isArray(json?.branches) ? json.branches : [];
      const rawTags = Array.isArray(json?.tags) ? json.tags : [];

      for (const b of rawBranches) {
        const name = b?.name ? String(b.name) : "";
        if (name) branches.add(name);
      }
      for (const t of rawTags) {
        const name = t?.name ? String(t.name) : "";
        if (name) tags.add(name);
      }

      driver._refsCache = {
        expiresAt: now + REFS_CACHE_TTL_MS,
        branches,
        tags,
        fetchedAt: new Date().toISOString(),
      };

      return { branches, tags };
    } finally {
      driver._refsInflight = null;
    }
  })();

  return await driver._refsInflight;
}

export async function getRevisionKind(driver, revision) {
  const rev = String(revision || "").trim();
  if (!rev) return "unknown";
  if (isCommitSha(rev)) return "commit";

  const { branches, tags } = await getRefs(driver);
  if (branches && branches.has(rev)) return "branch";
  if (tags && tags.has(rev)) return "tag";
  return "unknown";
}

export async function ensureWritableRevisionByRefs(driver) {
  // 大白话：写入必须是“分支名”，tag/commit 只能读。
  if (!driver._token) return; // 具体报错由 _requireWriteEnabled 负责
  if (isCommitSha(driver._revision)) return;

  try {
    const kind = await getRevisionKind(driver, driver._revision);
    if (kind !== "branch") {
      driver._isOnBranch = false;
      throw new DriverError("当前 revision 不是可写分支（写入需要分支名，例如 main；tag/commit 只能读）", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.HUGGINGFACE_REVISION_NOT_WRITABLE",
        expose: true,
        details: { revision: driver._revision, kind },
      });
    }
    driver._isOnBranch = true;
  } catch (e) {
    // refs 接口失败时，不能直接把整条写入链路卡死（可能只是临时网络抖动）
    // 这里选择“尽量继续”，最终如果真的不可写，HF 上游会在 commit 阶段返回错误。
    if (e instanceof DriverError && e.code === "DRIVER_ERROR.HUGGINGFACE_REVISION_NOT_WRITABLE") {
      throw e;
    }
  }
}

// ====== paths-info（批量 + 小缓存） ======

export async function getPathsInfoMap(driver, paths, { cacheKey = null, expand = true } = {}) {
  const raw = Array.isArray(paths) ? paths : [];
  const unique = Array.from(
    new Set(
      raw
        .map((p) => String(p || "").trim())
        .filter(Boolean),
    ),
  );
  if (unique.length === 0) return new Map();

  const now = Date.now();
  const key = cacheKey
    ? `${driver._repo}@${driver._revision}:${cacheKey}:${expand ? "expand1" : "expand0"}:${driver._token ? "auth" : "anon"}`
    : null;

  if (key) {
    const cached = driver._pathsInfoCache.get(key);
    if (cached && cached.expiresAt > now && cached.map instanceof Map) {
      return cached.map;
    }
  }

  const batches = chunkArray(unique, PATHS_INFO_BATCH_SIZE);
  const results = await mapWithConcurrency(batches, 2, async (batch) => {
    try {
      return await hfPathsInfo({
        repo: driver._getHubRepoDesignation(),
        paths: batch,
        expand,
        revision: driver._revision,
        hubUrl: driver._endpointBase,
        accessToken: driver._token || undefined,
        fetch,
      });
    } catch {
      return [];
    }
  });

  const map = new Map();
  for (const arr of results) {
    if (!Array.isArray(arr)) continue;
    for (const info of arr) {
      const p = info?.path ? String(info.path) : "";
      if (p) map.set(p, info);
    }
  }

  if (key) {
    driver._pathsInfoCache.set(key, { expiresAt: now + PATHS_INFO_CACHE_TTL_MS, map });
  }
  return map;
}

// ====== tree API（分页） ======

function buildTreePageCacheKey(repoPath, { expand = false, recursive = false, limit = 0, cursor = null } = {}) {
  const c = cursor != null && String(cursor).trim() ? String(cursor).trim() : "";
  return `${repoPath}|e=${expand ? "1" : "0"}|r=${recursive ? "1" : "0"}|l=${String(limit || 0)}|c=${c}`;
}

function resolveTreeLimit(driver, { expand = false, limitOverride = null } = {}) {
  const override = limitOverride != null && Number.isFinite(Number(limitOverride)) ? Math.floor(Number(limitOverride)) : null;
  const desired = driver._treeLimit && Number.isFinite(driver._treeLimit) && driver._treeLimit > 0 ? driver._treeLimit : null;
  const picked =
    override && override > 0
      ? override
      : desired && desired > 0
        ? desired
        : expand
          ? DEFAULT_TREE_LIMIT_WHEN_EXPAND
          : DEFAULT_TREE_LIMIT_WHEN_NO_EXPAND;
  return Math.max(1, picked);
}

export async function fetchTreePage(driver, repoPath, { expand = false, recursive = false, cursor = null, limitOverride = null, refresh = false } = {}) {
  // 如果明显是 private/gated 且没 token，提前给清晰错误
  const access = await getDatasetAccessInfo(driver);
  if (access.requiresAuth && !driver._token) {
    driver._throwMissingToken();
  }

  const limit = resolveTreeLimit(driver, { expand, limitOverride });
  const cursorValue = cursor != null && String(cursor).trim() ? String(cursor).trim() : null;

  // 小缓存：避免用户“反复刷新/反复点加载更多”时把 HF API 打爆
  if (!refresh) {
    const key = buildTreePageCacheKey(repoPath, { expand, recursive, limit, cursor: cursorValue });
    const cached = driver._treePageCache.get(key) || null;
    if (cached && cached.expiresAt > Date.now() && cached.value) {
      return cached.value;
    }
  }

  const url = buildTreeApiUrlWithQuery(
    { endpointBase: driver._endpointBase, repoId: driver._repo, revision: driver._revision, repoPath },
    { expand, recursive, limit, cursor: cursorValue },
  );
  const resp = await fetch(url, {
    method: "GET",
    headers: buildAuthHeaders(driver._token, { Accept: "application/json" }),
  });

  if (resp.status === 401 || resp.status === 403) {
    if (!driver._token) driver._throwMissingToken();
    throw new DriverError("HuggingFace 访问被拒绝（token 可能无权限，或 gated 未通过）", {
      status: ApiStatus.FORBIDDEN,
      code: "DRIVER_ERROR.HUGGINGFACE_FORBIDDEN",
      expose: true,
      details: { url },
    });
  }

  if (resp.status === 404) {
    throw new NotFoundError("路径不存在");
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    if (resp.status === 400 && String(text).includes("Invalid limit for index tree pagination")) {
      throw new DriverError(
        `HuggingFace 列目录失败：服务端拒绝了该 limit（limit=${limit}）。原始错误：${String(text).slice(0, 200)}`,
        {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.HUGGINGFACE_INVALID_TREE_LIMIT",
          expose: true,
          details: { url, response: text?.slice?.(0, 500) || "", expand, limit },
        },
      );
    }
    throw new DriverError(`HuggingFace 请求失败: HTTP ${resp.status}`, {
      status: resp.status >= 500 ? ApiStatus.BAD_GATEWAY : resp.status,
      code: "DRIVER_ERROR.HUGGINGFACE_HTTP",
      expose: resp.status < 500,
      details: { url, response: text?.slice?.(0, 500) || "" },
    });
  }

  const json = await resp.json().catch(() => []);
  const entries = Array.isArray(json) ? json : [];

  const link = resp.headers.get("link") || resp.headers.get("Link") || "";
  const nextCursor = parseNextCursorFromLinkHeader(link);

  const value = { entries, nextCursor, limit };
  if (!refresh) {
    const key = buildTreePageCacheKey(repoPath, { expand, recursive, limit, cursor: cursorValue });
    driver._treePageCache.set(key, { expiresAt: Date.now() + TREE_PAGE_CACHE_TTL_MS, value });
  }
  return value;
}

export async function fetchTreeEntries(driver, repoPath, { expand = false, recursive = false, limitOverride = null } = {}) {
  const limit = resolveTreeLimit(driver, { expand, limitOverride });
  let cursor = null;

  /** @type {any[]} */
  const all = [];
  while (true) {
    const { entries, nextCursor } = await fetchTreePage(driver, repoPath, {
      expand,
      recursive,
      cursor,
      limitOverride: limit,
      refresh: true,
    });
    all.push(...(Array.isArray(entries) ? entries : []));
    if (!nextCursor) break;
    if (nextCursor === cursor) break;
    cursor = nextCursor;
  }

  return all;
}

// ====== 写入（commit / NDJSON / LFS 服务端 copy / 读取 blob） ======

/**
 * 获取 Git LFS “basic 上传”（预签名直传 URL）
 *
 * - 文件 sha256（oid）+ 大小（size）
 * - HuggingFace 会返回一个 upload.href，客户端直接 PUT 到这个 href 即可
 *
 */
export async function fetchLfsBasicUploadAction(driver, { oid, size } = {}) {
  driver._requireWriteEnabled();

  const o = String(oid || "").trim();
  const s = Number(size);
  if (!o) {
    throw new DriverError("HuggingFace 预签名上传失败：缺少 sha256（oid）", {
      status: ApiStatus.BAD_REQUEST,
      code: "DRIVER_ERROR.HUGGINGFACE_PRESIGN_MISSING_SHA256",
      expose: true,
    });
  }
  if (!Number.isFinite(s) || s < 0) {
    throw new DriverError("HuggingFace 预签名上传失败：文件大小无效", {
      status: ApiStatus.BAD_REQUEST,
      code: "DRIVER_ERROR.HUGGINGFACE_PRESIGN_INVALID_SIZE",
      expose: true,
      details: { size },
    });
  }

  const url = buildLfsBatchApiUrl({ endpointBase: driver._endpointBase, repoDesignation: driver._getHubRepoDesignation() });

  /** @type {any} */
  const payload = {
    operation: "upload",
    // 这里只要 basic（单次 PUT），先不启用 multipart（分片）以便你先验证直传链路
    transfers: ["basic"],
    hash_algo: "sha_256",
    objects: [{ oid: o, size: s }],
  };

  const rev = String(driver._revision || "").trim();
  if (rev && !isCommitSha(rev)) {
    payload.ref = { name: `refs/heads/${rev}` };
  }

  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: buildAuthHeaders(driver._token, {
        Accept: "application/vnd.git-lfs+json",
        "Content-Type": "application/vnd.git-lfs+json",
      }),
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new DriverError(`HuggingFace 预签名上传失败：网络错误（${e?.message || "fetch failed"}）`, {
      status: ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.HUGGINGFACE_UPSTREAM_NETWORK",
      expose: false,
      details: { url },
    });
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new DriverError("HuggingFace 预签名上传失败：没有权限（请检查 token 是否有写入权限）", {
      status: ApiStatus.FORBIDDEN,
      code: "DRIVER_ERROR.HUGGINGFACE_FORBIDDEN",
      expose: true,
      details: { url },
    });
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new DriverError(`HuggingFace 预签名上传失败: HTTP ${resp.status}`, {
      status: resp.status >= 500 ? ApiStatus.BAD_GATEWAY : resp.status,
      code: "DRIVER_ERROR.HUGGINGFACE_HTTP",
      expose: resp.status < 500,
      details: { url, response: text?.slice?.(0, 800) || "" },
    });
  }

  /** @type {any} */
  const json = await resp.json().catch(() => ({}));
  const objects = Array.isArray(json?.objects) ? json.objects : [];
  const item = objects.find((x) => String(x?.oid || "") === o) || objects[0] || null;
  if (!item) {
    return {
      oid: o,
      size: s,
      uploadUrl: null,
      headers: null,
      isMultipart: false,
      alreadyUploaded: false,
      raw: json,
    };
  }

  // Git LFS Batch API 约定：即使单个对象失败，HTTP 也可能仍然是 200，并在对象内返回 error
  if (item?.error?.message) {
    const code = Number(item?.error?.code);
    throw new DriverError(`HuggingFace 预签名上传失败：${String(item.error.message)}`, {
      status: Number.isFinite(code) && code >= 400 ? code : ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.HUGGINGFACE_HTTP",
      expose: true,
      details: { lfsError: item.error, oid: o, size: s },
    });
  }

  const upload = item?.actions?.upload || null;
  const href = upload?.href ? String(upload.href) : "";
  const header = upload?.header && typeof upload.header === "object" ? upload.header : null;
  const isMultipart = !!(header && header.chunk_size);

  const alreadyUploaded = !href && !isMultipart;

  return {
    oid: o,
    size: s,
    uploadUrl: href || null,
    headers: header || null,
    isMultipart,
    alreadyUploaded,
  };
}

export async function commitHubNdjsonLines(driver, lines) {
  driver._requireWriteEnabled();
  await ensureWritableRevisionByRefs(driver);
  const url = buildCommitApiUrl({ endpointBase: driver._endpointBase, repoId: driver._repo, revision: driver._revision });
  const body = Array.isArray(lines) ? lines.filter(Boolean).join("\n") : "";

  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: buildAuthHeaders(driver._token, {
        "Content-Type": "application/x-ndjson",
        Accept: "application/json",
      }),
      body,
    });
  } catch (e) {
    throw new DriverError(`HuggingFace 提交失败：网络错误（${e?.message || "fetch failed"}）`, {
      status: ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.HUGGINGFACE_UPSTREAM_NETWORK",
      expose: false,
      details: { url },
    });
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new DriverError("HuggingFace 提交失败：没有权限（请检查 token 是否有写入权限）", {
      status: ApiStatus.FORBIDDEN,
      code: "DRIVER_ERROR.HUGGINGFACE_FORBIDDEN",
      expose: true,
      details: { url },
    });
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new DriverError(`HuggingFace 提交失败: HTTP ${resp.status}`, {
      status: resp.status >= 500 ? ApiStatus.BAD_GATEWAY : resp.status,
      code: "DRIVER_ERROR.HUGGINGFACE_WRITE_FAILED",
      expose: resp.status < 500,
      details: { url, response: text?.slice?.(0, 600) || "" },
    });
  }

  return await resp.json().catch(() => ({}));
}

export async function commitOperations(driver, operations, { title, description } = {}) {
  driver._requireWriteEnabled();
  await ensureWritableRevisionByRefs(driver);

  // - `useXet` 是 HuggingFace 官方 SDK 的一个上传路线开关（默认更偏向 Xet）
  // - 但在 Cloudflare Worker 这类环境里，Xet 的 wasm 可能会触发“禁止运行时编译 wasm”的报错
  const useXet = driver._useXet === true;

  try {
    return await hfCommit({
      accessToken: driver._token,
      repo: driver._getHubRepoDesignation(),
      operations,
      title: title || "CloudPaste commit",
      description,
      hubUrl: driver._endpointBase,
      branch: driver._revision,
      useXet,
      fetch,
    });
  } catch (e) {
    const msg = e?.message || String(e);
    const status = e?.status || e?.statusCode || null;

    if (String(msg).includes("Wasm code generation disallowed") || String(msg).includes("WebAssembly.compile")) {
      throw new DriverError(
        "HuggingFace 写入失败：当前运行环境禁止运行时编译 WebAssembly（一般是 hf_use_xet=true 走 Xet 导致）。你可以在存储配置里关闭 hf_use_xet（改走 LFS 路线）再试。",
        {
          status: ApiStatus.BAD_GATEWAY,
          code: "DRIVER_ERROR.HUGGINGFACE_WASM_DISALLOWED",
          expose: true,
          details: { message: msg, useXet },
        },
      );
    }

    if (String(msg).includes("401") || String(msg).toLowerCase().includes("unauthorized")) {
      throw new DriverError("HuggingFace 写入失败：token 无效或无权限（请检查 token 是否有 write 权限）", {
        status: ApiStatus.UNAUTHORIZED,
        code: "DRIVER_ERROR.HUGGINGFACE_FORBIDDEN",
        expose: true,
      });
    }
    if (String(msg).includes("403") || String(msg).toLowerCase().includes("forbidden")) {
      throw new DriverError("HuggingFace 写入失败：没有权限（可能是 gated 未通过或 token 权限不足）", {
        status: ApiStatus.FORBIDDEN,
        code: "DRIVER_ERROR.HUGGINGFACE_FORBIDDEN",
        expose: true,
      });
    }
    if (String(msg).includes("404")) {
      throw new DriverError("HuggingFace 写入失败：仓库/分支不存在或路径无效", {
        status: ApiStatus.NOT_FOUND,
        code: "DRIVER_ERROR.HUGGINGFACE_NOT_FOUND",
        expose: true,
      });
    }

    throw new DriverError(`HuggingFace 写入失败：${msg}`, {
      status: status || ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.HUGGINGFACE_WRITE_FAILED",
      expose: true,
    });
  }
}

export async function listFilesRecursive(driver, repoRelDir) {
  driver._requireWriteEnabled();
  await ensureWritableRevisionByRefs(driver);
  const dir = normalizeFolderPath(repoRelDir);

  /** @type {Array<{type:string,path:string,size:number}>} */
  const items = [];
  const iterator = hfListFiles({
    accessToken: driver._token,
    repo: driver._getHubRepoDesignation(),
    hubUrl: driver._endpointBase,
    revision: driver._revision,
    path: dir || undefined,
    recursive: true,
    fetch,
  });

  for await (const entry of iterator) {
    items.push(entry);
  }
  return items;
}

export async function tryServerSideLfsCopyFile(driver, fromRel, toRel, { deleteSource = false, title = "" } = {}) {
  const arr = await hfPathsInfo({
    repo: driver._getHubRepoDesignation(),
    paths: [fromRel],
    expand: false,
    revision: driver._revision,
    hubUrl: driver._endpointBase,
    accessToken: driver._token || undefined,
    fetch,
  });

  const info = Array.isArray(arr) ? arr[0] : null;
  const oid = info?.lfs?.oid ? String(info.lfs.oid) : "";
  if (!oid) {
    return { supported: false };
  }

  const size = typeof info?.lfs?.size === "number" ? info.lfs.size : typeof info?.size === "number" ? info.size : undefined;

  const header = {
    key: "header",
    value: {
      summary: title || (deleteSource ? "rename (server-side lfs copy)" : "copy (server-side lfs copy)"),
      description: "",
    },
  };

  const operations = [
    {
      key: "lfsFile",
      value: {
        path: toRel,
        algo: "sha256",
        oid,
        ...(typeof size === "number" ? { size } : {}),
      },
    },
    ...(deleteSource ? [{ key: "deletedFile", value: { path: fromRel } }] : []),
  ];

  const lines = [header, ...operations].map((x) => JSON.stringify(x));
  await commitHubNdjsonLines(driver, lines);
  return { supported: true };
}

export async function fetchBlobFromRepoRelPath(driver, repoRelPath) {
  const rel = normalizeFolderPath(repoRelPath);
  if (!rel) {
    throw new DriverError("源文件路径无效", { status: ApiStatus.BAD_REQUEST, expose: true });
  }

  const url = buildResolveUrl(
    { endpointBase: driver._endpointBase, repoId: driver._repo, revision: driver._revision, repoPath: rel },
    { download: false },
  );
  let resp;
  try {
    resp = await fetch(url, { method: "GET", headers: buildAuthHeaders(driver._token), redirect: "follow" });
  } catch (e) {
    throw new DriverError(`读取源文件失败：网络错误（${e?.message || "fetch failed"}）`, {
      status: ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.HUGGINGFACE_UPSTREAM_NETWORK",
      expose: false,
    });
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new DriverError("读取源文件失败：没有权限（请检查 token 是否有访问该数据集/文件的权限）", {
      status: ApiStatus.FORBIDDEN,
      code: "DRIVER_ERROR.HUGGINGFACE_FORBIDDEN",
      expose: true,
    });
  }
  if (resp.status === 404) {
    throw new NotFoundError("源文件不存在");
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new DriverError(`读取源文件失败: HTTP ${resp.status}`, {
      status: ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.HUGGINGFACE_HTTP",
      expose: false,
      details: { url, response: text?.slice?.(0, 500) || "" },
    });
  }

  return await resp.blob();
}
