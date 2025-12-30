import { ValidationError } from "../../http/errors.js";
import { ApiStatus, UserType } from "../../constants/index.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { getVirtualDirectoryListing, isVirtualPath } from "../../storage/fs/utils/VirtualDirectory.js";
import { createErrorResponse, getQueryBool, jsonOk } from "../../utils/common.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { LinkService } from "../../storage/link/LinkService.js";
import { resolvePreviewSelection } from "../../services/documentPreviewService.js";
import { StorageStreaming, STREAMING_CHANNELS } from "../../storage/streaming/index.js";
import { normalizePath as normalizeFsPath } from "../../storage/fs/utils/PathResolver.js";
import { FsSearchIndexStore } from "../../storage/fs/search/FsSearchIndexStore.js";
import { fsFolderSummaryCacheManager } from "../../cache/index.js";

const toIsoFromMs = (ms) => {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
};

const isValidSize = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

const isFolderSummaryMissing = (item) => {
  if (!item || !item.isDirectory || item.isVirtual) return false;
  const sizeMissing = typeof item.size !== "number" || !Number.isFinite(item.size) || item.size < 0;
  const modifiedMissing = !item.modified;
  return sizeMissing || modifiedMissing;
};

const ensureFolderSummarySources = (item) => {
  if (!item || !item.isDirectory || item.isVirtual) return;

  if (!item.size_source) {
    item.size_source = isValidSize(item.size) ? "storage" : "none";
  }
  if (!item.modified_source) {
    item.modified_source = item.modified ? "storage" : "none";
  }
};

const normalizeDir = (p) => {
  const raw = typeof p === "string" && p ? p : "/";
  const normalized = normalizeFsPath(raw, true);
  return normalized;
};

const normalizeSummarySource = (raw) => {
  const v = raw ? String(raw) : "";
  if (v === "storage" || v === "index" || v === "compute" || v === "none") return v;
  return null;
};

// 目录摘要计算（compute）singleflight：同一 mount + 同一路径 + 同一用户上下文并发时只算一次。
// 目的：避免 TTL 较短或多人同时刷新导致“递归遍历”被放大成 N 倍。
const inflightFolderSummaryCompute = new Map();

const buildFolderSummaryComputeUserKey = (userIdOrInfo, userType) => {
  const typeKey = userType != null ? String(userType) : "";
  let idKey = "";
  if (typeof userIdOrInfo === "string" || typeof userIdOrInfo === "number") {
    idKey = String(userIdOrInfo);
  } else if (userIdOrInfo && typeof userIdOrInfo === "object" && userIdOrInfo.id != null) {
    idKey = String(userIdOrInfo.id);
  }
  return `${typeKey}:${idKey}`;
};

const computeFolderSummaryByTraversalSingleflight = async (mountId, dirPath, fileSystem, userIdOrInfo, userType, options = {}) => {
  const mountKey = mountId != null ? String(mountId) : "";
  const dirKey = normalizeDir(dirPath);
  const userKey = buildFolderSummaryComputeUserKey(userIdOrInfo, userType);
  const baseKey = `${mountKey}::${userKey}::${dirKey}`;

  // refresh=true 必须“更强”：不能复用 refresh=false 的 inflight（可能是旧的）
  // refresh=false 可以复用 refresh=true 的 inflight（因为更“新”）
  const refreshKey = `${baseKey}::refresh`;
  const normalKey = `${baseKey}::normal`;
  const key = options?.refresh ? refreshKey : inflightFolderSummaryCompute.has(refreshKey) ? refreshKey : normalKey;

  let inflight = inflightFolderSummaryCompute.get(key);
  if (!inflight) {
    inflight = (async () => {
      try {
        return await computeFolderSummaryByTraversal(fileSystem, dirKey, userIdOrInfo, userType, options);
      } finally {
        inflightFolderSummaryCompute.delete(key);
      }
    })();
    inflightFolderSummaryCompute.set(key, inflight);
  }

  return inflight;
};

// computeDirectChildDirSummaries 输出结果依赖 childDirNameToFsPath（它决定“要算哪些子目录”）。
// 因此 key 里必须包含“子目录名集合”的 hash，避免不同请求之间复用错误结果。
const inflightDirectChildDirSummaries = new Map();

const hashChildDirNameSet = (childDirNameToFsPath) => {
  let hash = 0x811c9dc5;
  const names = Array.from(childDirNameToFsPath?.keys?.() ?? []);
  names.sort();
  for (const name of names) {
    const str = typeof name === "string" ? name : String(name ?? "");
    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
    }
    // separator
    hash ^= 124; // '|'
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return (hash >>> 0).toString(16);
};

const computeDirectChildDirSummariesSingleflight = async (
  mountId,
  relativeSubPath,
  childDirNameToFsPath,
  directoryOps,
  userIdOrInfo,
  userType,
  options = {}
) => {
  const mountKey = mountId != null ? String(mountId) : "";
  const subKey = typeof relativeSubPath === "string" ? relativeSubPath : String(relativeSubPath ?? "");
  const userKey = buildFolderSummaryComputeUserKey(userIdOrInfo, userType);
  const nameSetHash = hashChildDirNameSet(childDirNameToFsPath);
  const baseKey = `${mountKey}::${userKey}::${subKey}::${nameSetHash}`;

  // refresh=true 不能复用 refresh=false 的 inflight（可能是旧的）；refresh=false 可复用 refresh=true 的 inflight（更“新”）
  const refreshKey = `${baseKey}::refresh`;
  const normalKey = `${baseKey}::normal`;
  const key = options?.refresh ? refreshKey : inflightDirectChildDirSummaries.has(refreshKey) ? refreshKey : normalKey;

  let inflight = inflightDirectChildDirSummaries.get(key);
  if (!inflight) {
    inflight = (async () => {
      try {
        if (!directoryOps || typeof directoryOps.computeDirectChildDirSummaries !== "function") {
          return { results: new Map(), completed: false, visited: 0 };
        }
        return await directoryOps.computeDirectChildDirSummaries(subKey, childDirNameToFsPath, options);
      } finally {
        inflightDirectChildDirSummaries.delete(key);
      }
    })();
    inflightDirectChildDirSummaries.set(key, inflight);
  }

  return inflight;
};

/**
 * 递归遍历目录计算摘要（可选能力）
 * - 只用于“目录”的 size/modified 缺失兜底
 * - modified 语义：子孙项 modified 的最大值
 * 存储原生 > 计算 > 索引库本体 > 未知
 */
const computeFolderSummaryByTraversal = async (fileSystem, dirPath, userIdOrInfo, userType, options = {}) => {
  const maxItems = 20000;
  const maxMs = 5000;
  const startedAt = Date.now();

  let totalSize = 0;
  let latestModifiedMs = 0;
  let visited = 0;
  let completed = true;

  const queue = [normalizeDir(dirPath)];

  while (queue.length > 0) {
    if (Date.now() - startedAt > maxMs || visited >= maxItems) {
      completed = false;
      break;
    }

    const current = queue.shift();
    const res = await fileSystem.listDirectory(current, userIdOrInfo, userType, { refresh: !!options.refresh });
    const items = Array.isArray(res?.items) ? res.items : [];

    for (const item of items) {
      visited += 1;
      if (visited >= maxItems) {
        completed = false;
        break;
      }

      if (item?.isVirtual) {
        continue;
      }

      if (item?.isDirectory) {
        queue.push(normalizeDir(item.path));
        // 目录自身 modified 若存在，也可参与“内容更新时间”的估算
        if (item.modified) {
          const ms = Date.parse(String(item.modified));
          if (Number.isFinite(ms) && ms > latestModifiedMs) latestModifiedMs = ms;
        }
        continue;
      }

      if (typeof item.size === "number" && Number.isFinite(item.size) && item.size >= 0) {
        totalSize += item.size;
      }
      if (item.modified) {
        const ms = Date.parse(String(item.modified));
        if (Number.isFinite(ms) && ms > latestModifiedMs) latestModifiedMs = ms;
      }
    }
  }

  return {
    size: totalSize,
    modified: latestModifiedMs > 0 ? new Date(latestModifiedMs).toISOString() : null,
    completed,
    calculatedAt: new Date().toISOString(),
  };
};

const enrichDirectoryListWithFolderSummaries = async ({ db, fileSystem, result, userIdOrInfo, userType, refresh }) => {
  if (!result || !Array.isArray(result.items) || result.items.length === 0) return;

  // 当前目录列表通常只属于一个 mount，这里优先从 result.mount_id 取
  const mountIdRaw = result.mount_id ?? result.items.find((it) => it?.mount_id != null)?.mount_id ?? null;
  const mountId = mountIdRaw != null ? String(mountIdRaw) : "";
  if (!mountId) return;

  // 计算开关：交给“挂载配置”决定
  const mountRow = await db
    .prepare(
      "SELECT id, mount_path, storage_type, storage_config_id, cache_ttl, enable_folder_summary_compute FROM storage_mounts WHERE id = ?"
    )
    .bind(mountId)
    .first();
  const computeEnabled = !!mountRow?.enable_folder_summary_compute;
  const mountStorageType = mountRow?.storage_type ? String(mountRow.storage_type) : "";
  const mountPath = mountRow?.mount_path ? String(mountRow.mount_path) : "/";
  const folderSummaryCacheTtl =
    typeof mountRow?.cache_ttl === "number" && Number.isFinite(mountRow.cache_ttl) ? mountRow.cache_ttl : Number(mountRow?.cache_ttl || 0);

  // 索引状态（用于决定“索引 vs 计算”的优先级）
  const store = new FsSearchIndexStore(db);
  const states = await store.getIndexStates([mountId]);
  const state = states.get(mountId);
  const isIndexReady = state && String(state.status) === "ready";

  // 目标兜底来源（用于“允许从内存缓存填充”的来源过滤）：
  // 新规则：存储原生 > 计算 > 索引 > 未知
  // - 开启计算：优先用 compute（即使索引 ready）
  // - 未开启计算：若索引 ready 则用 index
  const desiredFallbackSource = computeEnabled ? "compute" : isIndexReady ? "index" : null;

  // refresh 只代表“本次不读缓存”，不做“提前清缓存”
  if (!refresh) {
    // 1) 先用内存缓存填充（但只允许填充“当前 desiredFallbackSource”的字段）
    for (const item of result.items) {
      if (!isFolderSummaryMissing(item)) continue;
      ensureFolderSummarySources(item);
      const cached = fsFolderSummaryCacheManager.get(mountId, item.path);
      if (!cached) continue;

      const cachedSizeSource = normalizeSummarySource(cached.size_source);
      const cachedModifiedSource = normalizeSummarySource(cached.modified_source);

      if (
        desiredFallbackSource &&
        !isValidSize(item.size) &&
        isValidSize(cached.size) &&
        cachedSizeSource === desiredFallbackSource
      ) {
        item.size = cached.size;
        item.size_source = desiredFallbackSource;
      }
      if (desiredFallbackSource && !item.modified && cached.modified && cachedModifiedSource === desiredFallbackSource) {
        item.modified = cached.modified;
        item.modified_source = desiredFallbackSource;
      }
    }
  }

  // 2) 可选计算（优先于索引）：允许递归遍历（或 S3 批量）计算
  if (computeEnabled) {
    // 如果 driver 提供 computeDirectChildDirSummaries，就优先“批量计算当前目录的直接子目录摘要”
    // - S3 会用一次 ListObjects 扫描，避免 N 倍递归
    // - HuggingFace Datasets 用官方 treesize，避免递归遍历
    // 非 refresh 时先用“compute 缓存”填充，避免重复算；refresh 则跳过缓存，强制走本次计算
    const childDirNameToPath = new Map();
    for (const item of result.items) {
      if (!item || !item.isDirectory || item.isVirtual) continue;
      if (!isFolderSummaryMissing(item)) continue;
      ensureFolderSummarySources(item);

      if (!refresh) {
        const cached = fsFolderSummaryCacheManager.get(mountId, item.path);
        if (cached) {
          const cachedSizeSource = normalizeSummarySource(cached.size_source);
          const cachedModifiedSource = normalizeSummarySource(cached.modified_source);
          if (!isValidSize(item.size) && isValidSize(cached.size) && cachedSizeSource === "compute") {
            item.size = cached.size;
            item.size_source = "compute";
          }
          if (!item.modified && cached.modified && cachedModifiedSource === "compute") {
            item.modified = cached.modified;
            item.modified_source = "compute";
          }
        }
      }

      // 仍然缺失的，进入本次批量计算
      if (isFolderSummaryMissing(item)) {
        if (typeof item.name === "string" && item.name) {
          childDirNameToPath.set(item.name, item.path);
        }
      }
    }

    if (childDirNameToPath.size > 0) {
      // 获取 driver
      const driver = await fileSystem.mountManager.getDriver(mountRow);
      const directoryOps = driver?.directoryOps || null;
      if (directoryOps && typeof directoryOps.computeDirectChildDirSummaries === "function") {
        // 计算当前目录在挂载内的相对路径（/ 或 /a/b/）
        const normalizedMountPath = normalizeFsPath(mountPath, true).replace(/\/+$/g, "") || "/";
        const normalizedDirPath = normalizeFsPath(result.path || "/", true);
        const relativeSubPath =
          normalizedMountPath === "/"
            ? normalizedDirPath
            : normalizedDirPath.startsWith(normalizedMountPath)
            ? normalizedDirPath.slice(normalizedMountPath.length) || "/"
            : normalizedDirPath;

        const { results: computedMap } = await computeDirectChildDirSummariesSingleflight(
          mountId,
          relativeSubPath,
          childDirNameToPath,
          directoryOps,
          userIdOrInfo,
          userType,
          { refresh }
        );

        for (const item of result.items) {
          if (!item || !item.isDirectory || item.isVirtual) continue;
          if (!isFolderSummaryMissing(item)) continue;
          const computed = computedMap.get(item.path);
          if (!computed) continue;

          const computedEntry = {
            ...computed,
            size_source: isValidSize(computed.size) ? "compute" : undefined,
            modified_source: computed.modified ? "compute" : undefined,
          };
          if (folderSummaryCacheTtl > 0) {
            fsFolderSummaryCacheManager.set(mountId, item.path, computedEntry, folderSummaryCacheTtl);
          }

          if (!isValidSize(item.size) && isValidSize(computed.size)) {
            item.size = computed.size;
            item.size_source = "compute";
          }
          if (!item.modified && computed.modified) {
            item.modified = computed.modified;
            item.modified_source = "compute";
          }
        }
      }
    }

    for (const item of result.items) {
      if (!isFolderSummaryMissing(item)) continue;
      ensureFolderSummarySources(item);
      if (!refresh) {
        const cached = fsFolderSummaryCacheManager.get(mountId, item.path);
        if (cached) {
          const cachedSizeSource = normalizeSummarySource(cached.size_source);
          const cachedModifiedSource = normalizeSummarySource(cached.modified_source);
          if (!isValidSize(item.size) && isValidSize(cached.size) && cachedSizeSource === "compute") {
            item.size = cached.size;
            item.size_source = "compute";
          }
          if (!item.modified && cached.modified && cachedModifiedSource === "compute") {
            item.modified = cached.modified;
            item.modified_source = "compute";
          }
          continue;
        }
      }

      const computed = await computeFolderSummaryByTraversalSingleflight(mountId, item.path, fileSystem, userIdOrInfo, userType, { refresh });
      const computedEntry = {
        ...computed,
        size_source: isValidSize(computed.size) ? "compute" : undefined,
        modified_source: computed.modified ? "compute" : undefined,
      };
      if (folderSummaryCacheTtl > 0) {
        fsFolderSummaryCacheManager.set(mountId, item.path, computedEntry, folderSummaryCacheTtl);
      }

      if (!isValidSize(item.size) && isValidSize(computed.size)) {
        item.size = computed.size;
        item.size_source = "compute";
      }
      if (!item.modified && computed.modified) {
        item.modified = computed.modified;
        item.modified_source = "compute";
      }
    }
  }

  // 3) 索引兜底（仅当索引 ready）：用于 compute 未覆盖/未完成时补齐
  const remainingDirs = result.items.filter((it) => isFolderSummaryMissing(it));
  if (remainingDirs.length === 0) return;

  if (isIndexReady) {
    const rows = await store.getChildDirectoryAggregates(mountId, result.path);
    const map = new Map();
    for (const row of rows) {
      const dirPath = row?.dir_path ? String(row.dir_path) : "";
      if (!dirPath) continue;
      map.set(dirPath, {
        size: typeof row.total_size === "number" ? row.total_size : Number(row.total_size || 0),
        modified: toIsoFromMs(row.latest_modified_ms),
      });
    }

    for (const item of remainingDirs) {
      if (!isFolderSummaryMissing(item)) continue;
      const summary = map.get(String(item.path));
      if (!summary) continue;
      ensureFolderSummarySources(item);

      const cacheEntry = {
        ...summary,
        size_source: isValidSize(summary.size) ? "index" : undefined,
        modified_source: summary.modified ? "index" : undefined,
      };
      if (folderSummaryCacheTtl > 0) {
        fsFolderSummaryCacheManager.set(mountId, item.path, cacheEntry, folderSummaryCacheTtl);
      }

      if (!isValidSize(item.size) && isValidSize(summary.size)) {
        item.size = summary.size;
        item.size_source = "index";
      }
      if (!item.modified && summary.modified) {
        item.modified = summary.modified;
        item.modified_source = "index";
      }
    }
  }

  // 兜底：如果依然缺失，把来源字段补齐为 none（避免前端判断不一致）
  for (const item of result.items) {
    ensureFolderSummarySources(item);
  }
};

const fnv1a32Init = () => 0x811c9dc5;

const fnv1a32Update = (hash, input) => {
  const str = typeof input === "string" ? input : String(input ?? "");
  let next = hash >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    next ^= str.charCodeAt(i);
    // 32-bit FNV-1a: next *= 16777619
    next = (next + ((next << 1) + (next << 4) + (next << 7) + (next << 8) + (next << 24))) >>> 0;
  }
  return next >>> 0;
};

const computeDirectoryListEtag = (result) => {
  // 如果目录结果来自服务端缓存，可能已携带上次计算出的 ETag（避免重复 O(n) 扫描）。
  if (result && typeof result.dirEtag === "string" && result.dirEtag.length > 0) {
    return result.dirEtag;
  }

  if (!result || !Array.isArray(result.items)) {
    return null;
  }

  const mountId = result.mount_id ?? "";
  const dirPath = result.path ?? "";

  // 强一致性优先：ETag 需要随目录条目变化而变化。
  // - 使用轻量 hash（FNV-1a 32）
  // - 参与字段：path/isDirectory/size/modified/etag（若存在）
  // - 不依赖条目对象引用，确保跨缓存一致
  let hash = fnv1a32Init();
  hash = fnv1a32Update(hash, mountId);
  hash = fnv1a32Update(hash, "|");
  hash = fnv1a32Update(hash, dirPath);
  hash = fnv1a32Update(hash, "|");
  hash = fnv1a32Update(hash, result.type ?? "");
  hash = fnv1a32Update(hash, "|");
  hash = fnv1a32Update(hash, String(result.items.length));

  for (const item of result.items) {
    hash = fnv1a32Update(hash, "|");
    hash = fnv1a32Update(hash, item?.path ?? "");
    hash = fnv1a32Update(hash, ":");
    hash = fnv1a32Update(hash, item?.isDirectory ? "1" : "0");
    hash = fnv1a32Update(hash, ":");
    hash = fnv1a32Update(hash, typeof item?.size === "number" ? String(item.size) : "");
    hash = fnv1a32Update(hash, ":");
    hash = fnv1a32Update(hash, item?.modified ? String(item.modified) : "");
    hash = fnv1a32Update(hash, ":");
    hash = fnv1a32Update(hash, item?.etag ? String(item.etag) : "");
  }

  const hex = (hash >>> 0).toString(16);
  // 弱 ETag：目录列表是“派生视图”，避免中间层对比语义过强
  return `W/"${mountId}:${hex}"`;
};

export const registerBrowseRoutes = (router, helpers) => {
  const { getAccessibleMounts, getServiceParams, verifyPathPasswordToken } = helpers;

  router.get("/api/fs/list", async (c) => {
    const db = c.env.DB;
    const rawPath = c.req.query("path") || "/";
    const path = normalizeFsPath(rawPath, true);
    const refresh = getQueryBool(c, "refresh", false);
    // 目录分页（可选）
    // - cursor：不透明字符串，由后端/驱动定义（例如 HF tree 的 cursor）
    // - limit：每页数量（正整数）
    // - paged：是否启用分页模式（即使 cursor=null 也只返回一页）
    const pagedRaw = c.req.query("paged");
    const pagedProvided = pagedRaw !== undefined;
    const paged = getQueryBool(c, "paged", false);
    const cursorRaw = c.req.query("cursor");
    const cursor = typeof cursorRaw === "string" && cursorRaw.trim() ? cursorRaw.trim() : null;
    const limitRaw = c.req.query("limit");
    const parsedLimit = limitRaw != null && limitRaw !== "" ? Number.parseInt(String(limitRaw), 10) : null;
    const limit = parsedLimit != null && Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;
    // 调试用：输出缓存命中日志（默认关闭）
    // - 环境变量：DEBUG_DRIVER_CACHE=true/false
    // - 单次请求：debug_cache=true（query param）
    // - 默认 false：不打印，环境变量为 true：全局打印
    // - debug_cache=true：仅本次请求打印（即使环境变量为 false）
    const debugDriverCacheEnv = MountManager.resolveDebugDriverCache({ env: c.env });
    const debugCacheQuery = getQueryBool(c, "debug_cache", false);
    const cacheTrace = debugDriverCacheEnv || debugCacheQuery;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");

    if (refresh) {
      console.log("[后端路由] 收到强制刷新请求:", { path, refresh });
    }

    // 管理员不受路径密码限制；仅对非管理员用户应用路径密码控制
    if (userType !== UserType.ADMIN && typeof verifyPathPasswordToken === "function") {
      const pathToken = c.req.header("x-fs-path-token") || c.req.query("path_token") || null;
      const verification = await verifyPathPasswordToken(db, path, pathToken, encryptionSecret);

      if (verification.requiresPassword && !verification.verified) {
        return c.json(
          {
            ...createErrorResponse(
              ApiStatus.FORBIDDEN,
              verification.error === "PASSWORD_CHANGED"
                ? "目录路径密码已更新，请重新输入"
                : "该目录需要密码访问",
              "FS_PATH_PASSWORD_REQUIRED",
            ),
            data: {
              path,
              requiresPassword: true,
            },
          },
          ApiStatus.FORBIDDEN,
        );
      }
    }

    const mounts = await getAccessibleMounts(db, userIdOrInfo, userType);

    if (isVirtualPath(path, mounts)) {
      const basicPath = userType === UserType.API_KEY ? userIdOrInfo.basicPath : null;
      const result = await getVirtualDirectoryListing(mounts, path, basicPath);

      const etag = computeDirectoryListEtag(result);
      if (etag) {
        const ifNoneMatch = c.req.header("if-none-match") || null;
        c.header("ETag", etag);
        c.header("Cache-Control", "private, no-cache");
        c.header("Vary", "Authorization, X-FS-Path-Token");

        if (!refresh && ifNoneMatch === etag) {
          return c.body(null, 304);
        }

        result.dirEtag = etag;
      }

      return jsonOk(c, result, "获取目录列表成功");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);
    // 目录分页默认策略：
    // - 如果客户端显式传了 paged：按客户端的来
    // - 如果客户端没传 paged：让 FS 层基于“驱动能力 + cursor/limit”自动决定是否按页返回
    const result = await fileSystem.listDirectory(path, userIdOrInfo, userType, {
      refresh,
      cacheTrace,
      ...(pagedProvided ? { paged } : {}),
      autoPaged: !pagedProvided,
      cursor,
      limit,
    });

    await enrichDirectoryListWithFolderSummaries({
      db,
      fileSystem,
      result,
      userIdOrInfo,
      userType,
      refresh,
    });

    if (cacheTrace) {
      try {
        const items = Array.isArray(result?.items) ? result.items : [];
        const dirItems = items.filter((it) => it?.isDirectory && !it?.isVirtual);

        const countBy = (key) => {
          const map = new Map();
          for (const it of dirItems) {
            const v = it?.[key] ? String(it[key]) : "none";
            map.set(v, (map.get(v) || 0) + 1);
          }
          return Object.fromEntries(map.entries());
        };

        console.log("[FolderSummary] SOURCES", {
          mountId: result?.mount_id ?? null,
          path: result?.path ?? path,
          refresh,
          totalItems: items.length,
          dirs: dirItems.length,
          size_source: countBy("size_source"),
          modified_source: countBy("modified_source"),
        });
      } catch (error) {
        console.warn("[FolderSummary] SOURCES log failed", error);
      }
    }

    const etag = computeDirectoryListEtag(result);
    if (etag) {
      const ifNoneMatch = c.req.header("if-none-match") || null;
      c.header("ETag", etag);
      c.header("Cache-Control", "private, no-cache");
      c.header("Vary", "Authorization, X-FS-Path-Token");

      if (!refresh && ifNoneMatch === etag) {
        return c.body(null, 304);
      }

      result.dirEtag = etag;
    }

    return jsonOk(c, result, "获取目录列表成功");
  });

  router.get("/api/fs/get", async (c) => {
    const db = c.env.DB;
    const path = c.req.query("path");
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");

    if (!path) {
      throw new ValidationError("请提供文件路径");
    }

    // 对受路径密码保护的文件路径应用与目录列表相同的校验逻辑
    if (userType !== UserType.ADMIN && typeof verifyPathPasswordToken === "function") {
      const pathToken = c.req.header("x-fs-path-token") || c.req.query("path_token") || null;
      const verification = await verifyPathPasswordToken(db, path, pathToken, encryptionSecret);

      if (verification.requiresPassword && !verification.verified) {
        return c.json(
          {
            ...createErrorResponse(
              ApiStatus.FORBIDDEN,
              verification.error === "PASSWORD_CHANGED"
                ? "目录路径密码已更新，请重新输入"
                : "该目录需要密码访问",
              "FS_PATH_PASSWORD_REQUIRED",
            ),
            data: {
              path,
              requiresPassword: true,
            },
          },
          ApiStatus.FORBIDDEN,
        );
      }
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.getFileInfo(path, userIdOrInfo, userType, c.req.raw);

    // 目录不生成直链
    let previewLink = { url: null, kind: null };
    let downloadLink = { url: null, kind: null };
    if (!result?.isDirectory) {
      // 通过 LinkService 生成语义清晰的预览/下载入口
      const linkService = new LinkService(db, encryptionSecret, repositoryFactory);
      previewLink = await linkService.getFsExternalLink(path, userIdOrInfo, userType, {
        forceDownload: false,
        request: c.req.raw,
      });

      downloadLink = await linkService.getFsExternalLink(path, userIdOrInfo, userType, {
        forceDownload: true,
        request: c.req.raw,
      });
    }

    const previewUrl = previewLink?.url || null;
    const downloadUrl = downloadLink?.url || null;
    const linkType = previewLink?.kind || null;

    const responsePayload = {
      ...result,
      previewUrl,
      downloadUrl,
      linkType,
    };

    const previewSelection = result?.isDirectory
      ? null
      : await resolvePreviewSelection(
          {
            type: responsePayload.type,
            typeName: responsePayload.typeName,
            mimetype: responsePayload.mimetype,
            filename: responsePayload.name,
            name: responsePayload.name,
            size: responsePayload.size,
          },
          {
            previewUrl,
            downloadUrl,
            linkType,
            use_proxy: responsePayload.use_proxy ?? 0,
          },
        );

    return jsonOk(
      c,
      {
        ...responsePayload,
        previewSelection,
      },
      "获取文件信息成功",
    );
  });

  //内部
  router.get("/api/fs/download", async (c) => {
    const db = c.env.DB;
    const path = c.req.query("path");
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");

    if (!path) {
      throw new ValidationError("请提供文件路径");
    }

    // 下载路由与元数据路由共享相同的路径密码校验规则
    if (userType !== UserType.ADMIN && typeof verifyPathPasswordToken === "function") {
      const pathToken = c.req.header("x-fs-path-token") || c.req.query("path_token") || null;
      const verification = await verifyPathPasswordToken(db, path, pathToken, encryptionSecret);

      if (verification.requiresPassword && !verification.verified) {
        return c.json(
          {
            ...createErrorResponse(
              ApiStatus.FORBIDDEN,
              verification.error === "PASSWORD_CHANGED"
                ? "目录路径密码已更新，请重新输入"
                : "该目录需要密码访问",
              "FS_PATH_PASSWORD_REQUIRED",
            ),
            data: {
              path,
              requiresPassword: true,
            },
          },
          ApiStatus.FORBIDDEN,
        );
      }
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);
    const fileInfo = await fileSystem.getFileInfo(path, userIdOrInfo, userType, c.req.raw);
    if (fileInfo?.isDirectory) {
      throw new ValidationError("目录不支持下载");
    }

    const linkService = new LinkService(db, encryptionSecret, repositoryFactory);
    const link = await linkService.getFsExternalLink(path, userIdOrInfo, userType, {
      forceDownload: true,
      request: c.req.raw,
    });

    if (link.url) {
      // 无论直链还是代理 / Worker 入口，只要给出了 URL，一律通过 302 交给下游处理
      return c.redirect(link.url, 302);
    }

    // 未能生成任何 URL 时兜底：使用 StorageStreaming 层做服务端流式下载
    const streaming = new StorageStreaming({
      mountManager,
      storageFactory: null,
      encryptionSecret,
    });

    const rangeHeader = c.req.header("Range") || null;
    const response = await streaming.createResponse({
      path,
      channel: STREAMING_CHANNELS.FS_WEB,
      rangeHeader,
      request: c.req.raw,
      userIdOrInfo,
      userType,
      db,
    });
    return response;
  });

  /**
   * 文件内容访问接口（统一内容 API）
   * - 语义：返回指定 FS 路径下文件的原始内容，用于前端预览、编码检测等场景
   * - 特点：始终由 CloudPaste 后端代理访问上游存储，避免前端直接对第三方直链发起跨域请求
   * - 与 /api/fs/download 的区别：content 更偏“读取内容”，download 更偏“触发下载（可 302 直链）”
   */
  router.get("/api/fs/content", async (c) => {
    const db = c.env.DB;
    const path = c.req.query("path");
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");

    if (!path) {
      throw new ValidationError("请提供文件路径");
    }

    // 路径密码校验规则与 /list /get /download 保持一致
    if (userType !== UserType.ADMIN && typeof verifyPathPasswordToken === "function") {
      const pathToken = c.req.header("x-fs-path-token") || c.req.query("path_token") || null;
      const verification = await verifyPathPasswordToken(db, path, pathToken, encryptionSecret);

      if (verification.requiresPassword && !verification.verified) {
        return c.json(
          {
            ...createErrorResponse(
              ApiStatus.FORBIDDEN,
              verification.error === "PASSWORD_CHANGED"
                ? "目录路径密码已更新，请重新输入"
                : "该目录需要密码访问",
              "FS_PATH_PASSWORD_REQUIRED",
            ),
            data: {
              path,
              requiresPassword: true,
            },
          },
          ApiStatus.FORBIDDEN,
        );
      }
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const streaming = new StorageStreaming({
      mountManager,
      storageFactory: null,
      encryptionSecret,
    });

    const rangeHeader = c.req.header("Range") || null;
    const response = await streaming.createResponse({
      path,
      channel: STREAMING_CHANNELS.FS_WEB,
      rangeHeader,
      request: c.req.raw,
      userIdOrInfo,
      userType,
      db,
    });

    return response;
  });

  router.get("/api/fs/file-link", async (c) => {
    const db = c.env.DB;
    const path = c.req.query("path");
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const expiresInParam = c.req.query("expires_in");
    const parsedExpiresIn =
      expiresInParam === undefined || expiresInParam === "null" ? null : parseInt(expiresInParam, 10);
    const expiresIn = parsedExpiresIn !== null && Number.isNaN(parsedExpiresIn) ? null : parsedExpiresIn;
    const forceDownload = getQueryBool(c, "force_download", false);

    if (!path) {
      throw new ValidationError("请提供文件路径");
    }

    // 与目录列表/文件信息/下载保持一致：对受路径密码保护的路径进行校验
    if (userType !== UserType.ADMIN && typeof verifyPathPasswordToken === "function") {
      const pathToken = c.req.header("x-fs-path-token") || c.req.query("path_token") || null;
      const verification = await verifyPathPasswordToken(db, path, pathToken, encryptionSecret);

      if (verification.requiresPassword && !verification.verified) {
        return c.json(
          {
            ...createErrorResponse(
              ApiStatus.FORBIDDEN,
              verification.error === "PASSWORD_CHANGED"
                ? "目录路径密码已更新，请重新输入"
                : "该目录需要密码访问",
              "FS_PATH_PASSWORD_REQUIRED",
            ),
            data: {
              path,
              requiresPassword: true,
            },
          },
          ApiStatus.FORBIDDEN,
        );
      }
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);
    const fileInfo = await fileSystem.getFileInfo(path, userIdOrInfo, userType, c.req.raw);
    if (fileInfo?.isDirectory) {
      throw new ValidationError("目录不支持生成文件直链");
    }

    const linkService = new LinkService(db, encryptionSecret, repositoryFactory);
    const link = await linkService.getFsExternalLink(path, userIdOrInfo, userType, {
      expiresIn,
      forceDownload,
      request: c.req.raw,
    });

    const responsePayload = {
      url: link.url,
      linkType: link.kind,
    };

    return jsonOk(c, responsePayload, "获取文件直链成功");
  });
};
