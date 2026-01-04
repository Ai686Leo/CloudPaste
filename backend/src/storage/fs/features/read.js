import { DriverError } from "../../../http/errors.js";
import { ApiStatus } from "../../../constants/index.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { generateFileLink as featureGenerateFileLink } from "./presign.js";
import { normalizePath } from "../utils/PathResolver.js";
import { directoryCacheManager } from "../../../cache/index.js";

// 同一目录同一时刻只允许一次真实 list（防止并发把存储打爆）
// key = mountId:subPath:(refresh?1:0)
const inflightDirectoryList = new Map();

const cloneDirectoryResult = (result) => {
  if (!result || typeof result !== "object") return result;
  const items = Array.isArray(result.items) ? result.items : [];
  return {
    ...result,
    items: items.map((item) => (item && typeof item === "object" ? { ...item } : item)),
  };
};

export async function listDirectory(fs, path, userIdOrInfo, userType, options = {}) {
  // 目录列表接口的路径语义：目录路径必须以 / 结尾（root 除外）。
  const dirPath = normalizePath(path, true);
  if (typeof path === "string" && path !== dirPath) {
    console.warn("[fs.listDirectory] 输入路径未按目录格式(缺少尾部/)，已自动规范化:", { path, dirPath });
  }

  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(dirPath, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.READER)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持读取操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  const refresh = !!options.refresh;
  const cacheTrace = !!options.cacheTrace;
  const cacheTtl = typeof mount?.cache_ttl === "number" && Number.isFinite(mount.cache_ttl) ? mount.cache_ttl : 0;
  const cacheEnabled = cacheTtl > 0 && !!mount?.id;

  const cacheSubPath = normalizePath(subPath || "/", true);
  // 目录分页支持
  // - cursor：不透明字符串，由上游/驱动定义（例如 HF tree 的 cursor）
  // - limit：每页数量（用于驱动按页返回，而不是一次性全量返回）
  // - autoPaged：仅用于“/api/fs/list 这种 UI 列目录”，允许后端根据驱动能力自动切到分页（内部递归遍历等不要自动分页）
  const autoPaged = options?.autoPaged === true;
  const pagedOpt = options?.paged;
  const pagedProvided = pagedOpt === true || pagedOpt === false;
  let paged = pagedOpt === true;
  const pageCursor = options?.cursor != null && String(options.cursor).trim() ? String(options.cursor).trim() : null;
  const pageLimitRaw = options?.limit != null && options.limit !== "" ? Number(options.limit) : null;
  const pageLimit = pageLimitRaw != null && Number.isFinite(pageLimitRaw) && pageLimitRaw > 0 ? Math.floor(pageLimitRaw) : null;
  if (!pagedProvided && autoPaged) {
    // 客户端没明确说 paged（未传），但这是 UI 列目录：允许自动决定
    // - 如果传了 cursor/limit：必然是分页请求
    // - 否则：看驱动有没有声明 PAGED_LIST 能力
    if (pageCursor || pageLimit != null) {
      paged = true;
    } else if (typeof driver?.hasCapability === "function" && driver.hasCapability(CAPABILITIES.PAGED_LIST)) {
      paged = true;
    }
  }
  const isPagedRequest = paged || !!pageCursor || pageLimit != null;

  const inflightKey = `${mount?.id}:${cacheSubPath}:${refresh ? "1" : "0"}:${isPagedRequest ? "paged" : "full"}:${paged ? "1" : "0"}:${pageCursor || ""}:${pageLimit || ""}`;

  // 1) 不 refresh：先读缓存
  if (cacheEnabled && !refresh && !isPagedRequest) {
    const cached = directoryCacheManager.get(mount.id, cacheSubPath);
    if (cached && Array.isArray(cached.items)) {
      if (cacheTrace) {
        console.log("[DirectoryCache] HIT", {
          mountId: mount?.id,
          path: dirPath,
          subPath: cacheSubPath,
          ttl: cacheTtl,
          items: cached.items.length,
        });
      }
      return cloneDirectoryResult(cached);
    }
    if (cacheTrace) {
      console.log("[DirectoryCache] MISS", { mountId: mount?.id, path: dirPath, subPath: cacheSubPath, ttl: cacheTtl });
    }
  } else if (cacheTrace) {
    console.log("[DirectoryCache] BYPASS", {
      mountId: mount?.id,
      path: dirPath,
      subPath: cacheSubPath,
      ttl: cacheTtl,
      reason: refresh ? "refresh=true" : isPagedRequest ? "paged_request" : "cache_disabled",
    });
  }

  // 2) singleflight 去重：同目录并发只打一次存储
  if (inflightDirectoryList.has(inflightKey)) {
    if (cacheTrace) {
      console.log("[DirectoryCache] INFLIGHT", { mountId: mount?.id, path: dirPath, subPath: cacheSubPath, refresh });
    }
    return await inflightDirectoryList.get(inflightKey);
  }

  const fetchPromise = (async () => {
    const startedAt = Date.now();
    const result = await driver.listDirectory(cacheSubPath, {
      path: dirPath,
      mount,
      subPath: cacheSubPath,
      db: fs.mountManager.db,
      ...options,
      cursor: pageCursor,
      limit: pageLimit,
      userIdOrInfo,
      userType,
      // refresh 只负责“本次请求绕过缓存”，不做“提前清缓存”
      refresh,
    });

    // 3) list 完成后更新缓存（refresh 也会写回缓存）
    if (cacheEnabled && !isPagedRequest) {
      const items = Array.isArray(result?.items) ? result.items : [];
      if (items.length > 0) {
        directoryCacheManager.set(mount.id, cacheSubPath, cloneDirectoryResult(result), cacheTtl);
      } else {
        // 空目录：不缓存空数组，并递归清掉该目录子树缓存，避免“幽灵目录/幽灵文件”残留
        directoryCacheManager.invalidatePathTree(mount.id, cacheSubPath);
      }
    }

    if (cacheTrace) {
      const durationMs = Date.now() - startedAt;
      const items = Array.isArray(result?.items) ? result.items : [];
      console.log("[DirectoryCache] FETCHED", {
        mountId: mount?.id,
        path: dirPath,
        subPath: cacheSubPath,
        refresh,
        cacheEnabled,
        ttl: cacheTtl,
        items: items.length,
        durationMs,
      });
    }

    // 返回值也统一 clone，避免：
    // - 多个并发请求共享同一个 result 引用而互相污染
    // - 上层 enrich/排序直接修改到缓存对象
    return cloneDirectoryResult(result);
  })()
    .finally(() => {
      inflightDirectoryList.delete(inflightKey);
    });

  inflightDirectoryList.set(inflightKey, fetchPromise);
  return await fetchPromise;
}

export async function getFileInfo(fs, path, userIdOrInfo, userType, request = null) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.READER)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持读取操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  // 先获取基础文件信息（不关心其中是否包含任何 legacy 链接字段）
  const baseInfo = await driver.getFileInfo(subPath, {
    path,
    mount,
    subPath,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
    request,
  });

  return {
    ...baseInfo,
  };
}

export async function downloadFile(fs, path, fileName, request, userIdOrInfo, userType) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.READER)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持读取操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  return await driver.downloadFile(subPath, {
    path,
    mount,
    subPath,
    db: fs.mountManager.db,
    request,
    userIdOrInfo,
    userType,
  });
}

export async function exists(fs, path, userIdOrInfo, userType) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);
  return await driver.exists(subPath, {
    path,
    mount,
    subPath,
    db: fs.mountManager.db,
    userIdOrInfo,
    userType,
  });
}
