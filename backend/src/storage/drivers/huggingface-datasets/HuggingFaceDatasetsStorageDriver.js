/**
 * HuggingFaceDatasetsStorageDriver
 *
 * - HuggingFace 的 Dataset 本质是“仓库”
 * - public：可以给出 /resolve/ 直链
 * - private/gated：浏览器拿不到内容（没法带 Authorization 头），必须走 CloudPaste /api/p 代理
 */

import { BaseDriver, CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { ApiStatus } from "../../../constants/index.js";
import { ValidationError, NotFoundError, DriverError } from "../../../http/errors.js";
import { buildFileInfo, inferNameFromPath } from "../../utils/FileInfoBuilder.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";
import { getMimeTypeFromFilename } from "../../../utils/fileUtils.js";
import { createHttpStreamDescriptor } from "../../streaming/StreamDescriptorUtils.js";
import { MasqueradeClient } from "../../../utils/httpMasquerade.js";
import {
  DEFAULT_REVISION,
  GITKEEP_FILENAME,
  MAX_COMMIT_OPERATIONS_PER_BATCH,
  buildAuthHeaders,
  buildCommitApiUrl,
  buildRefsApiUrl,
  buildResolveUrl,
  buildTreeApiUrl,
  buildTreeApiUrlWithQuery,
  buildTreeSizeApiUrl,
  commitHubNdjsonLines,
  commitOperations,
  ensureWritableRevisionByRefs,
  fetchLfsBasicUploadAction,
  fetchBlobFromRepoRelPath,
  fetchTreeEntries,
  fetchTreePage,
  getDatasetAccessInfo,
  getPathsInfoMap,
  getRefs,
  getRevisionKind,
  listFilesRecursive,
  permanentlyDeleteLfsFiles,
  resolveLfsFileOids,
  tryServerSideLfsCopyFile,
} from "./hfHubApi.js";
import {
  normalizeBaseUrl,
  normalizeRepoId,
  splitRepoId,
  normalizeFolderPath,
  normalizeSubPath,
  parseHttpDate,
  parseContentLength,
  isCommitSha,
  chunkArray,
  mapWithConcurrency,
} from "./hfUtils.js";
import { fetchHfLfsUploadInstructions, completeHfLfsMultipartUpload, tryParseAmzExpiresSeconds } from "./hfMultipartOps.js";
import { createUploadSessionRecord, findUploadSessionById, listActiveUploadSessions, updateUploadSessionById } from "../../../utils/uploadSessions.js";
import { decryptIfNeeded } from "../../../utils/crypto.js";

export class HuggingFaceDatasetsStorageDriver extends BaseDriver {
  /**
   * @param {Object} config
   * @param {string} encryptionSecret
   */
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "HUGGINGFACE_DATASETS";
    this.encryptionSecret = encryptionSecret;
    this.capabilities = [CAPABILITIES.READER, CAPABILITIES.DIRECT_LINK, CAPABILITIES.PROXY, CAPABILITIES.PAGED_LIST];

    this._endpointBase = normalizeBaseUrl(config?.endpoint_url);
    this._repo = normalizeRepoId(config?.repo);
    this._repoParts = splitRepoId(this._repo);
    this._revision = String(config?.revision || DEFAULT_REVISION).trim() || DEFAULT_REVISION;
    this._token = String(config?.hf_token || "").trim() || null;
    this._useXet = config?.hf_use_xet === true;
    this._usePathsInfo = config?.hf_use_paths_info === true;
    this._treeLimit = Number.isFinite(Number(config?.hf_tree_limit)) ? Math.floor(Number(config?.hf_tree_limit)) : null;
    this._deleteLfsOnRemove = config?.hf_delete_lfs_on_remove === true;
    this._isOnBranch = false;
    this._treePageCache = new Map();

    // 小缓存：避免每次 list/get 都打一次 dataset-info，降低 429 风险
    this._accessCache = {
      value: null,
      expiresAt: 0,
    };

    // 小缓存：避免频繁查询 refs（分支/标签），降低 429 风险
    this._refsCache = {
      expiresAt: 0,
      branches: new Set(),
      tags: new Set(),
      fetchedAt: null,
    };
    this._refsInflight = null;

    // 小缓存：避免频繁刷新目录导致重复请求 paths-info
    /** @type {Map<string, {expiresAt:number, map: Map<string, any>}>} */
    this._pathsInfoCache = new Map();

    // 目录摘要计算
    // 优先走 HF 官方 treesize，避免递归遍历 N 层目录。
    // 接口：GET /api/datasets/{namespace}/{repo}/treesize/{rev}/{path}
    this.directoryOps = {
      computeDirectChildDirSummaries: async (relativeSubPath, childDirNameToFsPath, options = {}) => {
        this._ensureInitialized();

        // private/gated + 没 token：提前报错（否则会变成一堆 401）
        const access = await this._getDatasetAccessInfo();
        if (access.requiresAuth && !this._token) {
          this._throwMissingToken();
        }

        const startedAt = Date.now();
        const maxMs = 5000;
        const maxDirs = 200;

        const baseDir = normalizeSubPath(relativeSubPath || "/", { asDirectory: true }).replace(/\/+$/g, "") || "/";
        const entries = Array.from(childDirNameToFsPath?.entries?.() ?? []);

        let visited = 0;
        let completed = true;
        const results = new Map();

        const work = entries
          .filter(([name, fsPath]) => typeof name === "string" && name && typeof fsPath === "string" && fsPath)
          .slice(0, maxDirs)
          .map(([name, fsPath]) => ({ name, fsPath }));

        if (entries.length > maxDirs) {
          completed = false;
        }

        const computedList = await mapWithConcurrency(work, 4, async (it) => {
          visited += 1;
          if (Date.now() - startedAt > maxMs) {
            completed = false;
            return { fsPath: it.fsPath, summary: null };
          }

          const childSubPath = normalizeSubPath(`${baseDir}/${it.name}`, { asDirectory: true });
          const repoDirRel = this._toRepoRelDirFromSubPath(childSubPath, { mount: options?.mount || null });
          if (!repoDirRel) return { fsPath: it.fsPath, summary: null };

          const url = this._buildTreeSizeApiUrl(repoDirRel);
          try {
            const json = await this._fetchJson(url, {
              method: "GET",
              headers: this._buildAuthHeaders({ Accept: "application/json" }),
            });

            const size = typeof json?.size === "number" && Number.isFinite(json.size) && json.size >= 0 ? json.size : null;
            return {
              fsPath: it.fsPath,
              summary: {
                size,
                modified: null,
                completed: true,
                calculatedAt: new Date().toISOString(),
              },
            };
          } catch {
            return { fsPath: it.fsPath, summary: null };
          }
        });

        for (const r of computedList) {
          if (!r?.summary) continue;
          results.set(r.fsPath, r.summary);
        }

        return { results, completed, visited };
      },
    };

    // 浏览器伪装客户端
    this._masqueradeClient = new MasqueradeClient({
      deviceCategory: "desktop",
      rotateIP: false,
      rotateUA: false,
    });
  }

  async initialize() {
    if (!this._repo) {
      throw new ValidationError("HuggingFace Datasets 配置缺少 repo（例如 username/dataset）");
    }
    if (!this._repoParts?.namespace || !this._repoParts?.repo) {
      throw new ValidationError("repo 格式无效，应为 username/dataset");
    }

    // token 可能以 encrypted:* 存在（由存储配置 CRUD 统一加密写入）
    const decryptedToken = await decryptIfNeeded(this._token, this.encryptionSecret);
    this._token = typeof decryptedToken === "string" ? decryptedToken.trim() : decryptedToken;
    if (typeof this._token === "string" && this._token.length === 0) {
      this._token = null;
    }

    // 能力动态开关：
    // - 没 token：只读
    // - revision 是 40 位 commit sha：只读（HF 不允许往 commit sha 直接 commit）
    // - 其他情况：先“乐观地”开启写能力；如果 revision 实际是 tag，写入时由 HF 上游返回错误
    this.capabilities = [CAPABILITIES.READER, CAPABILITIES.DIRECT_LINK, CAPABILITIES.PROXY, CAPABILITIES.PAGED_LIST];
    this._isOnBranch = false;
    const candidateWrite = !!this._token && !isCommitSha(this._revision);
    if (candidateWrite) {
      this._isOnBranch = true;
      this.capabilities.push(CAPABILITIES.WRITER, CAPABILITIES.ATOMIC, CAPABILITIES.MULTIPART);
    }

    this.initialized = true;
  }

  // ===== 可选能力：目录分页 =====
  // HF 的 tree 接口天然就是“按页”吐数据的（有 Link rel="next"）。
  supportsDirectoryPagination() {
    return true;
  }

  // Base contract
  async stat(subPath, ctx = {}) {
    return await this.getFileInfo(subPath, ctx);
  }

  async exists(subPath, ctx = {}) {
    try {
      await this.getFileInfo(subPath, ctx);
      return true;
    } catch (e) {
      if (e instanceof NotFoundError) return false;
      if (e instanceof DriverError && (e?.details?.status === 404 || e?.status === 404)) return false;
      throw e;
    }
  }

  _buildMountPath(mount, normalizedSubPath, { asDirectory = true } = {}) {
    const mountPathRaw = String(mount?.mount_path || "").trim() || "/";
    const mountPath = mountPathRaw.startsWith("/") ? mountPathRaw : `/${mountPathRaw}`;
    const base = mountPath.replace(/\/+$/g, "") || "/";

    const sub = normalizeSubPath(normalizedSubPath || "/", { asDirectory });
    if (sub === "/") {
      return asDirectory ? `${base}/` : base;
    }

    const rel = sub.replace(/^\/+/g, "");
    const full = `${base}/${rel}`.replace(/\/+/g, "/");
    if (asDirectory && !full.endsWith("/")) return `${full}/`;
    if (!asDirectory && full.endsWith("/") && full !== "/") return full.replace(/\/+$/g, "");
    return full;
  }

  _joinMountPath(basePath, name, isDirectory) {
    const base = String(basePath || "/").replace(/\/+$/g, "");
    const safeName = String(name || "").replace(/^\/+/g, "");
    const combined = safeName ? `${base}/${safeName}` : base;
    const normalized = combined.replace(/\/+/g, "/");
    return isDirectory ? `${normalized.replace(/\/+$/g, "")}/` : normalized.replace(/\/+$/g, "");
  }

  async _fetchJson(url, init = {}) {
    const method = String(init?.method || "GET").toUpperCase();
    const maxAttempts = method === "GET" ? 2 : 1;
    const headers = init?.headers || {};

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const resp = await fetch(url, {
        ...init,
        headers,
      });

      // 429/5xx：只对 GET 做一次小重试，避免把限流放大
      if (method === "GET" && attempt < maxAttempts && [429, 500, 502, 503, 504].includes(resp.status)) {
        await new Promise((r) => setTimeout(r, 200 * attempt));
        continue;
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

      return await resp.json();
    }

    throw new DriverError("HuggingFace 请求失败（重试耗尽）", { status: ApiStatus.BAD_GATEWAY });
  }

  _buildAuthHeaders(extra = {}, targetUrl = null) {
    const browserHeaders = this._masqueradeClient.buildHeaders({}, targetUrl);
    const authHeaders = buildAuthHeaders(this._token, {});
    return { ...browserHeaders, ...authHeaders, ...extra };
  }

  _buildTreeApiUrl(repoPath) {
    return buildTreeApiUrl({ endpointBase: this._endpointBase, repoId: this._repo, revision: this._revision, repoPath });
  }

  _buildTreeApiUrlWithQuery(repoPath, { expand = false, recursive = false, limit = null, cursor = null } = {}) {
    return buildTreeApiUrlWithQuery(
      { endpointBase: this._endpointBase, repoId: this._repo, revision: this._revision, repoPath },
      { expand, recursive, limit, cursor },
    );
  }

  _buildRefsApiUrl({ includePrs = false } = {}) {
    return buildRefsApiUrl({ endpointBase: this._endpointBase, repoParts: this._repoParts }, { includePrs });
  }

  _buildTreeSizeApiUrl(repoPath) {
    return buildTreeSizeApiUrl({
      endpointBase: this._endpointBase,
      repoParts: this._repoParts,
      revision: this._revision,
      repoPath,
    });
  }

  _buildCommitApiUrl() {
    return buildCommitApiUrl({ endpointBase: this._endpointBase, repoId: this._repo, revision: this._revision });
  }

  _buildResolveUrl(repoPath, { download = false } = {}) {
    return buildResolveUrl(
      { endpointBase: this._endpointBase, repoId: this._repo, revision: this._revision, repoPath },
      { download },
    );
  }

  async _getDatasetAccessInfo() {
    return await getDatasetAccessInfo(this);
  }

  async _getRefs() {
    return await getRefs(this);
  }

  async _getRevisionKind(revision) {
    return await getRevisionKind(this, revision);
  }

  async _ensureWritableRevisionByRefs() {
    await ensureWritableRevisionByRefs(this);
  }

  _throwMissingToken() {
    throw new DriverError("该 HuggingFace 数据集需要配置 HF_TOKEN 才能访问（private/gated）", {
      status: ApiStatus.UNAUTHORIZED,
      code: "DRIVER_ERROR.HUGGINGFACE_TOKEN_REQUIRED",
      expose: true,
    });
  }

  _requireWriteEnabled() {
    if (!this._token) {
      throw new DriverError("写入 HuggingFace 数据集需要配置 HF_TOKEN（需具备写入权限）", {
        status: ApiStatus.UNAUTHORIZED,
        code: "DRIVER_ERROR.HUGGINGFACE_TOKEN_REQUIRED_FOR_WRITE",
        expose: true,
      });
    }
    if (isCommitSha(this._revision)) {
      throw new DriverError("当前 revision 是 commit sha（只能读不能写）。写入需要分支名，例如 main", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.HUGGINGFACE_REVISION_NOT_WRITABLE",
        expose: true,
        details: { revision: this._revision, kind: "commit" },
      });
    }
  }

  _getHubRepoDesignation() {
    return { type: "dataset", name: this._repo };
  }

  async _getPathsInfoMap(paths, { cacheKey = null, expand = true } = {}) {
    return await getPathsInfoMap(this, paths, { cacheKey, expand });
  }

  async _fetchTreePage(repoPath, { expand = false, recursive = false, cursor = null, limitOverride = null, refresh = false } = {}) {
    return await fetchTreePage(this, repoPath, { expand, recursive, cursor, limitOverride, refresh });
  }

  async _fetchTreeEntries(repoPath, { expand = false, recursive = false, limitOverride = null } = {}) {
    return await fetchTreeEntries(this, repoPath, { expand, recursive, limitOverride });
  }

  async _commitHubNdjsonLines(lines) {
    return await commitHubNdjsonLines(this, lines);
  }

  async _tryServerSideLfsCopyFile(fromRel, toRel, { deleteSource = false, title = "" } = {}) {
    return await tryServerSideLfsCopyFile(this, fromRel, toRel, { deleteSource, title });
  }

  /**
   * default_folder 的统一规则：
   * - 文件上传页 / 分享上传（ObjectStore）由 ObjectStore 负责把 default_folder 拼进 key（最终存储路径）
   * - 这个驱动内部不再二次拼 default_folder，避免重复前缀
   */
  _toRepoRelPathFromSubPath(subPath, { asDirectory = false } = {}) {
    const normalized = normalizeSubPath(subPath, { asDirectory });
    return normalizeFolderPath(normalized);
  }

  _toRepoRelDirFromSubPath(subPath) {
    const rel = this._toRepoRelPathFromSubPath(subPath, { asDirectory: true });
    return normalizeFolderPath(rel);
  }

  async _toBlob(input, contentType = null) {
    // Blob/File（浏览器/Worker）
    if (input && typeof input.arrayBuffer === "function" && typeof input.stream === "function") {
      return contentType ? input.slice(0, input.size, contentType) : input;
    }

    // ReadableStream（Worker fetch body）
    if (input && typeof input.getReader === "function") {
      const blob = await new Response(input).blob();
      return contentType ? blob.slice(0, blob.size, contentType) : blob;
    }

    // Node Readable（Docker/Node 本地）
    if (input && typeof input.pipe === "function" && typeof input.on === "function") {
      const chunks = [];
      await new Promise((resolve, reject) => {
        input.on("data", (chunk) => chunks.push(chunk));
        input.on("end", resolve);
        input.on("error", reject);
      });
      const { Buffer } = await import("buffer");
      const buf = Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c))));
      return new Blob([buf], contentType ? { type: contentType } : undefined);
    }

    // Uint8Array / ArrayBuffer / string / number 等：统一用 Blob 包一层
    if (input instanceof ArrayBuffer) {
      return new Blob([input], contentType ? { type: contentType } : undefined);
    }
    if (input && typeof input === "object" && input.buffer instanceof ArrayBuffer) {
      return new Blob([input], contentType ? { type: contentType } : undefined);
    }
    return new Blob([input == null ? "" : input], contentType ? { type: contentType } : undefined);
  }

  async _fetchBlobFromRepoRelPath(repoRelPath) {
    return await fetchBlobFromRepoRelPath(this, repoRelPath);
  }

  async _commitOperations(operations, { title, description } = {}) {
    return await commitOperations(this, operations, { title, description });
  }

  async _listFilesRecursive(repoRelDir) {
    return await listFilesRecursive(this, repoRelDir);
  }

  async listDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, db } = ctx;
    const fsPath = ctx?.path;

    const normalizedSubPath = normalizeSubPath(subPath || "/", { asDirectory: true });
    const repoPath = this._toRepoRelPathFromSubPath(normalizedSubPath, { asDirectory: true, mount });

    const basePath = fsPath;
    const expand = this._usePathsInfo === true;
    const cursor = ctx?.cursor != null && String(ctx.cursor).trim() ? String(ctx.cursor).trim() : null;
    const limitOverride = ctx?.limit != null && ctx.limit !== "" ? Number(ctx.limit) : null;
    const paged = ctx?.paged === true || !!cursor || (limitOverride != null && Number.isFinite(limitOverride) && limitOverride > 0);

    let entries;
    /** @type {string|null} */
    let nextCursor = null;
    if (paged) {
      const page = await this._fetchTreePage(repoPath, {
        expand,
        recursive: false,
        cursor,
        limitOverride,
        refresh: ctx?.refresh === true,
      });
      entries = page?.entries || [];
      nextCursor = page?.nextCursor || null;
    } else {
      entries = await this._fetchTreeEntries(repoPath, { expand, recursive: false, limitOverride });
    }

    const filteredEntries = entries
      // 目录占位文件隐藏
      .filter((it) => {
        const p = String(it?.path || "");
        const name = p.split("/").filter(Boolean).pop() || "";
        return name !== GITKEEP_FILENAME;
      })
      .filter((it) => it && typeof it.path === "string" && typeof it.type === "string");

    const items = await Promise.all(
      filteredEntries.map(async (it) => {
        const isDirectory = it.type === "directory";
        const fullRepoPath = String(it.path || "");
        const name = fullRepoPath.split("/").filter(Boolean).pop() || "";
        const fsPath = this._joinMountPath(basePath, name, isDirectory);
        const mimetype = isDirectory ? "application/x-directory" : getMimeTypeFromFilename(name);
        const size = isDirectory ? null : typeof it.size === "number" ? it.size : null;
        const lastCommitDate = isDirectory || !this._usePathsInfo ? null : it?.lastCommit?.date || null;

        // 文件列表右侧小徽章：Xet / LFS
        // - 仅在 hf_use_paths_info 开启时才显示（否则不会额外请求上游信息）
        // - 只对 “LFS 文件” 才显示（普通文本文件/小文件不显示，避免误导）
        // - Xet 优先：如果 tree 返回 xetHash 就显示 Xet，否则显示 LFS
        let storage_backend = null;
        if (!isDirectory && this._usePathsInfo === true) {
          const isLfs = !!it?.lfs?.oid;
          if (isLfs) {
            const xetHash = it?.xetHash ? String(it.xetHash) : "";
            storage_backend = xetHash ? "xet" : "lfs";
          }
        }

        const info = await buildFileInfo({
          fsPath,
          name,
          isDirectory,
          size,
          modified: lastCommitDate,
          mimetype,
          mount,
          storageType: mount?.storage_type || this.type,
          db,
        });
        return { ...info, isVirtual: false, ...(storage_backend ? { storage_backend } : {}) };
      }),
    );

    return {
      path: fsPath,
      type: "directory",
      isRoot: normalizedSubPath === "/",
      isVirtual: false,
      mount_id: mount?.id,
      storage_type: mount?.storage_type,
      items,
      ...(paged ? { hasMore: !!nextCursor, nextCursor } : {}),
    };
  }

  async getFileInfo(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, db } = ctx;
    const fsPath = ctx?.path;

    // 先按“用户请求的是目录还是文件”来分流：目录用 tree API，文件用 HEAD(/resolve)
    const guessedIsDirectory = typeof subPath === "string" && subPath.endsWith("/");

    const normalizedSubPath = normalizeSubPath(subPath || "/", { asDirectory: guessedIsDirectory });
    const repoPath = this._toRepoRelPathFromSubPath(normalizedSubPath, { asDirectory: guessedIsDirectory, mount });

    // 如果是目录：tree API 成功就算存在
    if (guessedIsDirectory) {
      const access = await this._getDatasetAccessInfo();
      if (access.requiresAuth && !this._token) {
        this._throwMissingToken();
      }

      await this._fetchJson(this._buildTreeApiUrl(repoPath), {
        method: "GET",
        headers: this._buildAuthHeaders({ Accept: "application/json" }),
      });

      const info = await buildFileInfo({
        fsPath,
        name: inferNameFromPath(fsPath, true),
        isDirectory: true,
        size: null,
        modified: null,
        mimetype: "application/x-directory",
        mount,
        storageType: mount?.storage_type || this.type,
        db,
      });
      return info;
    }

    // 开启后这里可以只请求 1 次（paths-info），不需要再 HEAD /resolve。
    if (this._usePathsInfo) {
      try {
        const infoMap = await this._getPathsInfoMap([repoPath], {
          cacheKey: `stat:${repoPath}`,
          expand: true,
        });
        const p = infoMap.get(repoPath) || null;
        if (p && p.type !== "directory") {
          const fileName = inferNameFromPath(fsPath, false);
          const guessedContentType = getMimeTypeFromFilename(fileName) || "application/octet-stream";
          const info = await buildFileInfo({
            fsPath,
            name: fileName,
            isDirectory: false,
            size: typeof p.size === "number" ? p.size : null,
            modified: p?.lastCommit?.date || null,
            mimetype: guessedContentType,
            mount,
            storageType: mount?.storage_type || this.type,
            db,
          });
          return info;
        }
      } catch {
        // 获取失败时，回退到老逻辑（HEAD /resolve）
      }
    }

    // 文件：HEAD /resolve 拿 size/content-type/etag/last-modified（更适合 Range/预览）
    const resolveUrl = this._buildResolveUrl(repoPath, { download: false });
    const headers = this._buildAuthHeaders({ Accept: "*/*" });
    const resp = await fetch(resolveUrl, { method: "HEAD", headers });

    if (resp.status === 401 || resp.status === 403) {
      if (!this._token) {
        this._throwMissingToken();
      }
      throw new DriverError("HuggingFace 访问被拒绝（token 可能无权限，或 gated 未通过）", {
        status: ApiStatus.FORBIDDEN,
        code: "DRIVER_ERROR.HUGGINGFACE_FORBIDDEN",
        expose: true,
      });
    }

    if (resp.status === 404) {
      // 可能是目录（用户没带 /），尝试 tree API 判断
      try {
        const access = await this._getDatasetAccessInfo();
        if (access.requiresAuth && !this._token) {
          this._throwMissingToken();
        }
        await this._fetchJson(this._buildTreeApiUrl(repoPath), {
          method: "GET",
          headers: this._buildAuthHeaders({ Accept: "application/json" }),
        });
        const info = await buildFileInfo({
          fsPath,
          name: inferNameFromPath(fsPath, true),
          isDirectory: true,
          size: null,
          modified: null,
          mimetype: "application/x-directory",
          mount,
          storageType: mount?.storage_type || this.type,
          db,
        });
        return info;
      } catch {
        throw new NotFoundError("路径不存在");
      }
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new DriverError(`获取文件信息失败: HTTP ${resp.status}`, {
        status: resp.status,
        code: "DRIVER_ERROR.HUGGINGFACE_HTTP",
        expose: resp.status < 500,
        details: { url: resolveUrl, response: text?.slice?.(0, 300) || "" },
      });
    }

    const size = parseContentLength(resp.headers.get("content-length"));
    const etag = resp.headers.get("etag") || null;
    const lastModified = parseHttpDate(resp.headers.get("last-modified"));
    const contentType = resp.headers.get("content-type") || getMimeTypeFromFilename(inferNameFromPath(fsPath, false));

    const info = await buildFileInfo({
      fsPath,
      name: inferNameFromPath(fsPath, false),
      isDirectory: false,
      size,
      modified: lastModified ? lastModified.toISOString() : null,
      mimetype: contentType,
      mount,
      storageType: mount?.storage_type || this.type,
      db,
    });

    return { ...info, etag: etag || undefined };
  }

  async downloadFile(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount } = ctx;
    const fsPath = ctx?.path;

    const normalizedSubPath = normalizeSubPath(subPath || "/", { asDirectory: false });
    const repoPath = this._toRepoRelPathFromSubPath(normalizedSubPath, { asDirectory: false, mount });

    // private/gated + 没 token：提前报错
    const access = await this._getDatasetAccessInfo();
    if (access.requiresAuth && !this._token) {
      this._throwMissingToken();
    }

    const url = this._buildResolveUrl(repoPath, { download: false });
    const safeName = inferNameFromPath(fsPath, false) || "file";
    const guessedContentType = getMimeTypeFromFilename(safeName) || "application/octet-stream";

    const headers = this._buildAuthHeaders({
      Accept: "*/*",
    }, url);

    return createHttpStreamDescriptor({
      contentType: guessedContentType,
      fetchResponse: async (signal) => {
        const resp = await fetch(url, { method: "GET", headers, signal });
        if (resp.status === 401 || resp.status === 403) {
          if (!this._token) this._throwMissingToken();
          throw new DriverError("HuggingFace 访问被拒绝（token 可能无权限，或 gated 未通过）", {
            status: ApiStatus.FORBIDDEN,
            code: "DRIVER_ERROR.HUGGINGFACE_FORBIDDEN",
            expose: true,
          });
        }
        if (resp.status === 404) {
          throw new NotFoundError("文件不存在");
        }
        return resp;
      },
      fetchRangeResponse: async (signal, rangeHeader) => {
        const resp = await fetch(url, { method: "GET", headers: { ...headers, Range: rangeHeader }, signal });
        if (resp.status === 401 || resp.status === 403) {
          if (!this._token) this._throwMissingToken();
          throw new DriverError("HuggingFace 访问被拒绝（token 可能无权限，或 gated 未通过）", {
            status: ApiStatus.FORBIDDEN,
            code: "DRIVER_ERROR.HUGGINGFACE_FORBIDDEN",
            expose: true,
          });
        }
        if (resp.status === 404) {
          throw new NotFoundError("文件不存在");
        }
        return resp;
      },
      fetchHeadResponse: async (signal) => {
        return await fetch(url, { method: "HEAD", headers, signal });
      },
    });
  }

  async generateDownloadUrl(subPath, ctx = {}) {
    this._ensureInitialized();
    const fsPath = ctx?.path;
    const { mount, channel = "web" } = ctx;
    const forceDownload = ctx?.forceDownload === true;

    const normalizedSubPath = normalizeSubPath(subPath || "/", { asDirectory: false });
    const repoPath = this._toRepoRelPathFromSubPath(normalizedSubPath, { asDirectory: false, mount });
    const directUrl = this._buildResolveUrl(repoPath, { download: forceDownload });

    // private/gated 不能把直链给浏览器（没法带 Authorization）
    const access = await this._getDatasetAccessInfo();
    if (access.requiresAuth) {
      // 这里必须 fail-fast：generateDownloadUrl 只能返回浏览器可用直链（custom_host/native_direct）
      // 降级为 proxy 的策略由上层（FsLinkStrategy）统一决定，避免“驱动偷偷回退”污染契约。
      throw new DriverError("HuggingFace 数据集需要鉴权：无法生成浏览器可用直链，请走本地代理 /api/p", {
        status: ApiStatus.NOT_IMPLEMENTED,
        code: "DRIVER_ERROR.HUGGINGFACE_DIRECT_LINK_NOT_AVAILABLE",
        expose: true,
        details: { path: fsPath, subPath },
      });
    }

    // 直链类型用 native_direct
    return { url: directUrl, type: "native_direct", channel };
  }

  /**
   * 生成“预签名直传”上传 URL
   *
   * 1) 前端先算好文件 sha256（HF 的 LFS 里叫 oid）
   * 2) 后端用 token 去 HuggingFace 的 LFS batch 接口换一个 uploadUrl
   * 3) 浏览器拿到 uploadUrl 后直接 PUT 上传
   * 4) 上传成功后，前端再调用 /api/fs/presign/commit，让后端把这个 oid 写进仓库（登记到文件树）
   */
  async generateUploadUrl(subPath, ctx = {}) {
    this._ensureInitialized();
    this._requireWriteEnabled();

    const fsPath = ctx?.path;
    const { mount, fileName, fileSize = 0, contentType = "application/octet-stream" } = ctx;
    const sha256 = ctx.sha256 || ctx.oid || null;

    const oid = String(sha256 || "").trim().toLowerCase();
    if (!oid) {
      throw new DriverError("HuggingFace 预签名上传需要 sha256（前端先算好再请求）", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.HUGGINGFACE_PRESIGN_MISSING_SHA256",
        expose: true,
      });
    }

    const size = Number(fileSize);
    if (!Number.isFinite(size) || size < 0) {
      throw new DriverError("HuggingFace 预签名上传失败：文件大小无效", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.HUGGINGFACE_PRESIGN_INVALID_SIZE",
        expose: true,
        details: { fileSize },
      });
    }

    // FS 视图下：subPath 是挂载点内相对路径（包含文件名）
    const normalizedSubPath = normalizeSubPath(subPath || "/", { asDirectory: false });
    const repoRelPath = this._toRepoRelPathFromSubPath(normalizedSubPath, { asDirectory: false, mount });
    if (!repoRelPath) {
      throw new DriverError("HuggingFace 预签名上传失败：目标路径无效", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.HUGGINGFACE_INVALID_PATH",
        expose: true,
        details: { path: fsPath, subPath },
      });
    }

    const action = await fetchLfsBasicUploadAction(this, { oid, size });
    if (action?.isMultipart) {
      // 你现在说“分片先不急”，这里先明确拒绝 multipart，避免前端误以为可以整文件 PUT
      throw new DriverError(
        "HuggingFace 返回了 multipart（分片）上传指令：说明这个文件太大或上游要求分片。当前阶段我们先不做 multipart，请先用小文件验证直传链路。",
        {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.HUGGINGFACE_PRESIGN_REQUIRES_MULTIPART",
          expose: true,
          details: { fileName: fileName || inferNameFromPath(repoRelPath) || "", fileSize: size },
        },
      );
    }
    // Git LFS 协议里 upload action 是“可选”的：如果对象已存在（去重），可能不会给 uploadUrl
    // 这种情况下：跳过 PUT，直接 commit（登记）即可。
    const skipUpload = action?.alreadyUploaded === true;
    if (!skipUpload && !action?.uploadUrl) {
      throw new DriverError("HuggingFace 预签名上传失败：上游没有返回 uploadUrl", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.HUGGINGFACE_PRESIGN_NO_UPLOAD_URL",
        expose: true,
        details: { oid, size },
      });
    }

    // 规范化上游 headers：
    // - DriverContractEnforcer 要求 generateUploadUrl.headers 必须是 { [k]: string }
    const normalizedHeaders = (() => {
      const raw = action?.headers;
      if (!raw || typeof raw !== "object") return undefined;
      /** @type {Record<string,string>} */
      const out = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof k !== "string" || !k) continue;
        if (typeof v === "string") {
          out[k] = v;
          continue;
        }
        if (typeof v === "number" || typeof v === "boolean") {
          out[k] = String(v);
          continue;
        }
        // 其它类型（object/array/null/undefined）直接丢弃，避免产生无效 header
      }
      return Object.keys(out).length > 0 ? out : undefined;
    })();

    return {
      success: true,
      uploadUrl: action.uploadUrl || "",
      headers: normalizedHeaders,
      contentType,
      storagePath: repoRelPath,
      // 透传给 /api/fs/presign/commit
      sha256: oid,
      repoRelPath,
      skipUpload,
    };
  }

  /**
   * 预签名上传完成后的“登记/提交”
   *
   */
  async handleUploadComplete(subPath, ctx = {}) {
    this._ensureInitialized();
    this._requireWriteEnabled();

    const fsPath = ctx?.path;
    const { mount, fileSize = 0 } = ctx;
    const sha256 = ctx.sha256 || ctx.oid || null;

    const oid = String(sha256 || "").trim().toLowerCase();
    if (!oid) {
      throw new DriverError("HuggingFace 提交预签名上传失败：缺少 sha256（oid）", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.HUGGINGFACE_PRESIGN_MISSING_SHA256",
        expose: true,
      });
    }

    const size = Number(fileSize);
    if (!Number.isFinite(size) || size < 0) {
      throw new DriverError("HuggingFace 提交预签名上传失败：文件大小无效", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.HUGGINGFACE_PRESIGN_INVALID_SIZE",
        expose: true,
        details: { fileSize },
      });
    }

    const normalizedSubPath = normalizeSubPath(subPath || "/", { asDirectory: false });
    const repoRelPath = this._toRepoRelPathFromSubPath(normalizedSubPath, { asDirectory: false, mount });
    if (!repoRelPath) {
      throw new DriverError("HuggingFace 提交预签名上传失败：目标路径无效", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.HUGGINGFACE_INVALID_PATH",
        expose: true,
        details: { path: fsPath, subPath },
      });
    }

    const header = {
      key: "header",
      value: {
        summary: `upload (direct): ${repoRelPath}`,
        description: "",
      },
    };
    const lfsFile = {
      key: "lfsFile",
      value: {
        path: repoRelPath,
        algo: "sha256",
        oid,
        size,
      },
    };

    await commitHubNdjsonLines(this, [header, lfsFile].map((x) => JSON.stringify(x)));
    return { success: true, message: "上传完成", storagePath: repoRelPath, publicUrl: null };
  }

  async generateProxyUrl(subPath, ctx = {}) {
    this._ensureInitialized();
    const { request, download = false, channel = "web" } = ctx;
    const fsPath = ctx?.path;
    return { url: buildFullProxyUrl(request || null, fsPath, download), type: "proxy", channel };
  }

  // ===== WRITER / ATOMIC：uploadFile / updateFile / createDirectory / batchRemoveItems / renameItem / copyItem =====

  async uploadFile(subPath, fileOrStream, ctx = {}) {
    this._ensureInitialized();
    this._requireWriteEnabled();

    const fsPath = ctx?.path;
    const { mount, filename, contentType } = ctx;
    const effectiveSubPath = subPath || "/";

    // FS 上传时 fsPath 通常是“目录路径”；真正文件名在 options.filename
    // 但 updateFile 时 filename 可能为空，此时 subPath 就是完整文件路径
    let targetSubPath;
    const looksLikeDir = String(effectiveSubPath || "").endsWith("/") || String(fsPath || "").endsWith("/");

    if (filename && looksLikeDir) {
      const dir = normalizeSubPath(effectiveSubPath, { asDirectory: true }).replace(/\/+$/g, "");
      targetSubPath = normalizeSubPath(`${dir || ""}/${filename}`, { asDirectory: false });
    } else if (filename && (effectiveSubPath === "/" || effectiveSubPath === "")) {
      targetSubPath = normalizeSubPath(`/${filename}`, { asDirectory: false });
    } else {
      targetSubPath = normalizeSubPath(effectiveSubPath, { asDirectory: false });
    }

    const repoRelPath = this._toRepoRelPathFromSubPath(targetSubPath, { asDirectory: false, mount });
    if (!repoRelPath) {
      throw new DriverError("目标路径无效", { status: ApiStatus.BAD_REQUEST, expose: true });
    }

    const blob = await this._toBlob(fileOrStream, contentType || null);

    await this._commitOperations(
      [
        {
          operation: "addOrUpdate",
          path: repoRelPath,
          content: blob,
        },
      ],
      { title: `upload: ${repoRelPath}` },
    );

    // storagePath 语义对齐：
    // - FS（mount 视图）：返回挂载路径（/mount/.../file）
    // - storage-first：返回相对路径（与传入 subPath 语义一致）
    const storagePath = mount ? fsPath : targetSubPath;
    return { success: true, storagePath, message: undefined };
  }

  async updateFile(subPath, content, ctx = {}) {
    this._ensureInitialized();
    this._requireWriteEnabled();

    const fsPath = ctx?.path;
    if (typeof fsPath !== "string" || !fsPath) {
      throw new DriverError("HuggingFace 更新文件缺少 path 上下文（ctx.path）", {
        status: ApiStatus.INTERNAL_ERROR,
        code: "DRIVER_ERROR.HUGGINGFACE_MISSING_FS_PATH",
        expose: false,
        details: { subPath },
      });
    }

    const effectiveSubPath = typeof subPath === "string" ? subPath : "/";
    const result = await this.uploadFile(effectiveSubPath, content, {
      ...ctx,
      path: fsPath,
      subPath: effectiveSubPath,
      filename: undefined,
    });

    return {
      ...result,
      success: !!result?.success,
      path: fsPath,
      message: result?.message || "文件更新成功",
    };
  }

  async createDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    this._requireWriteEnabled();

    const fsPath = ctx?.path;
    const { mount } = ctx;
    const normalizedSubPath = normalizeSubPath(subPath || "/", { asDirectory: true });

    // 禁止对挂载根执行 mkdir
    if (normalizedSubPath === "/" || normalizedSubPath === "") {
      return { success: true, path: fsPath, alreadyExists: true };
    }

    const dirRel = this._toRepoRelDirFromSubPath(normalizedSubPath, { mount });
    if (!dirRel) {
      return { success: true, path: fsPath, alreadyExists: true };
    }

    const keepPath = `${dirRel}/${GITKEEP_FILENAME}`.replace(/\/+/g, "/");
    const empty = new Blob([""]);

    await this._commitOperations(
      [
        {
          operation: "addOrUpdate",
          path: keepPath,
          content: empty,
        },
      ],
      { title: `mkdir: ${dirRel}` },
    );

    return { success: true, path: fsPath, alreadyExists: false };
  }

  async batchRemoveItems(subPaths, ctx = {}) {
    this._ensureInitialized();
    this._requireWriteEnabled();

    const { mount } = ctx;

    if (!Array.isArray(subPaths) || subPaths.length === 0) {
      return { success: 0, failed: [], results: [] };
    }

    if (!Array.isArray(ctx?.paths) || ctx.paths.length !== subPaths.length) {
      throw new DriverError("HuggingFaceDatasets.batchRemoveItems 需要 ctx.paths 与 subPaths 一一对应（不做兼容）", {
        status: ApiStatus.INTERNAL_ERROR,
        expose: false,
        code: "DRIVER_ERROR.HUGGINGFACE_INVALID_BATCH_REMOVE_ARGS",
        details: { pathsLen: ctx?.paths?.length, subPathsLen: subPaths.length },
      });
    }

    const paths = ctx.paths;

    /** @type {Array<{ path: string, success: boolean, error?: string }>} */
    const results = [];

    // repoRelPath -> 关联到哪些“用户请求的 fsPath”
    /** @type {Map<string, Set<string>>} */
    const repoPathToRequestedFsPaths = new Map();
    /** @type {Map<string, Set<string>>} */
    const requestedToRepoPaths = new Map();

    // 1) 先把请求解析成 repo delete 列表（并记录映射关系）
    for (let i = 0; i < paths.length; i += 1) {
      const fsPath = paths[i];
      const sub = subPaths[i];
      if (typeof sub !== "string") {
        results.push({ path: fsPath, success: false, error: "缺少 subPath" });
        continue;
      }

      const normalized = String(sub || "");
      if (normalized === "/" || normalized === "") {
        results.push({ path: fsPath, success: false, error: "禁止删除挂载根目录" });
        continue;
      }

      const looksDir = normalized.endsWith("/");
      if (!looksDir) {
        const rel = this._toRepoRelPathFromSubPath(normalized, { asDirectory: false, mount });
        if (!rel) {
          results.push({ path: fsPath, success: false, error: "路径无效" });
          continue;
        }
        if (!repoPathToRequestedFsPaths.has(rel)) repoPathToRequestedFsPaths.set(rel, new Set());
        repoPathToRequestedFsPaths.get(rel).add(fsPath);
        if (!requestedToRepoPaths.has(fsPath)) requestedToRepoPaths.set(fsPath, new Set());
        requestedToRepoPaths.get(fsPath).add(rel);
        results.push({ path: fsPath, success: true });
        continue;
      }

      const dirRel = this._toRepoRelDirFromSubPath(normalized, { mount });
      if (!dirRel) {
        results.push({ path: fsPath, success: false, error: "禁止删除挂载根目录" });
        continue;
      }

      try {
        const entries = await this._listFilesRecursive(dirRel);
        const fileEntries = entries.filter((e) => e && e.type === "file" && typeof e.path === "string");
        if (fileEntries.length === 0) {
          results.push({ path: fsPath, success: false, error: "路径不存在" });
          continue;
        }
        for (const e of fileEntries) {
          const rel = String(e.path);
          if (!repoPathToRequestedFsPaths.has(rel)) repoPathToRequestedFsPaths.set(rel, new Set());
          repoPathToRequestedFsPaths.get(rel).add(fsPath);
          if (!requestedToRepoPaths.has(fsPath)) requestedToRepoPaths.set(fsPath, new Set());
          requestedToRepoPaths.get(fsPath).add(rel);
        }
        results.push({ path: fsPath, success: true });
      } catch (e) {
        results.push({ path: fsPath, success: false, error: e?.message || "删除目录失败" });
      }
    }

    // 2) 对 repo 路径去重后分批提交 delete
    const deletePaths = Array.from(repoPathToRequestedFsPaths.keys()).filter(Boolean);
    const resultByPath = new Map(results.map((r) => [r.path, r]));

    // 可选：同时清理 HuggingFace “List LFS files” 里的大文件对象（危险操作）
    // - 说明：commit delete 只删指针，不会删除 LFS 对象；这会导致再次上传同内容被判定“已存在”（秒传/skip）
    // - 风险：删除 LFS 对象会影响历史提交（旧 commit 可能无法再下载该文件）；并且同一内容 sha 可能被多个文件复用
    // - 默认：不开启；开启后也默认不 rewrite history（避免每次删除都触发大范围历史重写）
    /** @type {Set<string>} */
    const lfsOidsToDelete = new Set();

    if (deletePaths.length > 0) {
      for (const chunk of chunkArray(deletePaths, MAX_COMMIT_OPERATIONS_PER_BATCH)) {
        // 2.1 先在删除前抓一份 paths-info（删除后就拿不到了），用于推导对应的 LFS oid
        // 只在启用“删除 LFS 对象”时执行，避免无谓的额外请求。
        /** @type {Set<string>} */
        const chunkLfsOids = new Set();
        if (this._deleteLfsOnRemove) {
          try {
            const infoMap = await this._getPathsInfoMap(chunk, { cacheKey: null, expand: true });
            for (const p of chunk) {
              const info = infoMap?.get?.(p) || null;
              const oid = info?.lfs?.oid ? String(info.lfs.oid) : "";
              if (oid) chunkLfsOids.add(oid);
            }
          } catch (e) {
            // 获取 paths-info 失败不应阻断删除主流程（否则用户会觉得“删不掉文件”）
            console.warn("[HuggingFaceDatasets] 删除前获取 paths-info 失败，将跳过 LFS 清理：", e?.message || e);
          }
        }

        try {
          await this._commitOperations(
            chunk.map((p) => ({ operation: "delete", path: p })),
            { title: `delete: ${chunk.length} files` },
          );

          // commit 成功：这批的 LFS oid 才可以进入“候选删除集合”
          if (chunkLfsOids.size > 0) {
            for (const oid of chunkLfsOids) lfsOidsToDelete.add(oid);
          }
        } catch (e) {
          // commit 失败：把关联到的“用户请求 fsPath”标记为失败
          const msg = e?.message || "删除失败";
          for (const repoRelPath of chunk) {
            const requestPaths = repoPathToRequestedFsPaths.get(repoRelPath);
            if (!requestPaths) continue;
            for (const req of requestPaths) {
              const r = resultByPath.get(req);
              if (r && r.success) {
                r.success = false;
                r.error = msg;
              }
            }
          }
        }
      }
    }

    // 3) （可选）清理 HuggingFace 的 LFS 存储对象
    // 说明：这是“危险区”能力，默认不开启；并且就算失败也不影响本次删除结果（只写 warn）
    if (this._deleteLfsOnRemove && lfsOidsToDelete.size > 0) {
      try {
        const { fileOids, unresolved } = await resolveLfsFileOids(this, Array.from(lfsOidsToDelete));
        if (unresolved.length > 0) {
          console.warn("[HuggingFaceDatasets] 有部分 LFS oid 未能映射到 fileOid，将尝试直接按 oid 删除：", unresolved);
        }

        const { deleted } = await permanentlyDeleteLfsFiles(this, fileOids);
        console.log(
          `[HuggingFaceDatasets] LFS 清理完成：候选=${lfsOidsToDelete.size}，请求删除=${fileOids.length}，已删除=${deleted}`,
        );
      } catch (e) {
        console.warn("[HuggingFaceDatasets] LFS 清理失败（不影响文件删除）：", e?.message || e);
      }
    }

    const failed = results.filter((r) => !r.success);
    const success = results.filter((r) => r.success).length;
    return { success, failed, results };
  }

  async renameItem(oldSubPath, newSubPath, ctx = {}) {
    this._ensureInitialized();
    this._requireWriteEnabled();

    const { mount } = ctx;
    const oldPath = ctx?.oldPath;
    const newPath = ctx?.newPath;

    const fromSub = normalizeSubPath(oldSubPath || "/", { asDirectory: String(oldSubPath || "").endsWith("/") });
    const toSub = normalizeSubPath(newSubPath || "/", { asDirectory: String(oldSubPath || "").endsWith("/") });

    if (fromSub === "/" || toSub === "/") {
      throw new DriverError("不支持重命名挂载根目录", { status: ApiStatus.BAD_REQUEST, expose: true });
    }

    const isDir = String(fromSub).endsWith("/");
    const access = await this._getDatasetAccessInfo();
    const requiresAuth = access.requiresAuth;

    // 文件：单 commit = addOrUpdate(new, content=URL(old)) + delete(old)
    if (!isDir) {
      const fromRel = this._toRepoRelPathFromSubPath(fromSub, { asDirectory: false, mount });
      const toRel = this._toRepoRelPathFromSubPath(toSub, { asDirectory: false, mount });
      if (!fromRel || !toRel) {
        throw new DriverError("重命名路径无效", { status: ApiStatus.BAD_REQUEST, expose: true });
      }

      // CommitOperationCopy 仅对 LFS 文件可用（大文件常见）
      // 如果源文件是 LFS，就直接在 HF 服务端完成“复制到新路径 + 删除旧路径”
      // 如果不是 LFS（普通小文件），再回退到“下载+上传”的老办法
      const fast = await this._tryServerSideLfsCopyFile(fromRel, toRel, {
        deleteSource: true,
        title: `rename(lfs): ${fromRel} -> ${toRel}`,
      });
      if (fast.supported) {
        return { success: true, source: oldPath, target: newPath };
      }

      // HF SDK 的 URL->Blob 拉取不带 token（库内部没把 accessToken 传给 createBlobs），
      // private/gated 必须先带 Authorization 拉下来再写回去。
      const content = requiresAuth ? await this._fetchBlobFromRepoRelPath(fromRel) : new URL(this._buildResolveUrl(fromRel, { download: false }));
      await this._commitOperations(
        [
          { operation: "addOrUpdate", path: toRel, content },
          { operation: "delete", path: fromRel },
        ],
        { title: `rename: ${fromRel} -> ${toRel}` },
      );

      return { success: true, source: oldPath, target: newPath };
    }

    // 目录：列出所有文件（递归），批量做 addOrUpdate + delete
    const fromDirRel = this._toRepoRelDirFromSubPath(fromSub, { mount });
    const toDirRel = this._toRepoRelDirFromSubPath(toSub, { mount });
    if (!fromDirRel || !toDirRel) {
      throw new DriverError("重命名目录路径无效", { status: ApiStatus.BAD_REQUEST, expose: true });
    }

    const entries = await this._listFilesRecursive(fromDirRel);
    const files = entries.filter((e) => e && e.type === "file" && typeof e.path === "string");
    if (files.length === 0) {
      // 空目录：只需要移动占位文件（如果存在），这里直接返回成功即可
      return { success: true, source: oldPath, target: newPath };
    }

    // 先尝试对 “LFS 文件” 做服务端 rename（copy + delete）
    const fromPaths = files.map((f) => String(f.path));
    const pathsInfoMap = await this._getPathsInfoMap(fromPaths, { cacheKey: `rename-dir:${fromDirRel}`, expand: false });

    /** @type {Array<{oldFileRel:string,newFileRel:string,oid:string,size?:number}>} */
    const fastLfs = [];
    /** @type {Array<{type:string,path:string,size:number}>} */
    const slow = [];

    for (const f of files) {
      const oldFileRel = String(f.path);
      const suffix = oldFileRel.startsWith(fromDirRel) ? oldFileRel.slice(fromDirRel.length) : oldFileRel;
      const newFileRel = `${toDirRel}${suffix}`.replace(/\/+/g, "/");
      const info = pathsInfoMap.get(oldFileRel);
      const oid = info?.lfs?.oid ? String(info.lfs.oid) : "";
      if (oid) {
        const size = typeof info?.lfs?.size === "number" ? info.lfs.size : typeof info?.size === "number" ? info.size : undefined;
        fastLfs.push({ oldFileRel, newFileRel, oid, ...(typeof size === "number" ? { size } : {}) });
      } else {
        slow.push(f);
      }
    }

    if (fastLfs.length > 0) {
      const opBatches = chunkArray(fastLfs, Math.max(1, Math.floor(MAX_COMMIT_OPERATIONS_PER_BATCH / 2)));
      for (const batch of opBatches) {
        const header = {
          key: "header",
          value: {
            summary: `rename-dir(lfs): ${fromDirRel} -> ${toDirRel}`,
            description: "",
          },
        };
        const ops = [];
        for (const it of batch) {
          ops.push({
            key: "lfsFile",
            value: {
              path: it.newFileRel,
              algo: "sha256",
              oid: it.oid,
              ...(typeof it.size === "number" ? { size: it.size } : {}),
            },
          });
          ops.push({ key: "deletedFile", value: { path: it.oldFileRel } });
        }
        await this._commitHubNdjsonLines([header, ...ops].map((x) => JSON.stringify(x)));
      }
    }

    if (slow.length === 0) {
      return { success: true, source: oldPath, target: newPath };
    }

    // 每个文件对应 2 个操作（addOrUpdate + delete），所以 batch size 用一半更稳
    const fileBatches = chunkArray(slow, Math.max(1, Math.floor(MAX_COMMIT_OPERATIONS_PER_BATCH / 2)));
    for (const batch of fileBatches) {
      const operations = [];

      // public：用 URL 作为 content（库会自己拉取）；private/gated：先拉 Blob 再写入
      if (!requiresAuth) {
        for (const f of batch) {
          const oldFileRel = String(f.path);
          const suffix = oldFileRel.startsWith(fromDirRel) ? oldFileRel.slice(fromDirRel.length) : oldFileRel;
          const newFileRel = `${toDirRel}${suffix}`.replace(/\/+/g, "/");
          const sourceUrl = new URL(this._buildResolveUrl(oldFileRel, { download: false }));
          operations.push({ operation: "addOrUpdate", path: newFileRel, content: sourceUrl });
          operations.push({ operation: "delete", path: oldFileRel });
        }
      } else {
        const prepared = await mapWithConcurrency(batch, 3, async (f) => {
          const oldFileRel = String(f.path);
          const suffix = oldFileRel.startsWith(fromDirRel) ? oldFileRel.slice(fromDirRel.length) : oldFileRel;
          const newFileRel = `${toDirRel}${suffix}`.replace(/\/+/g, "/");
          const blob = await this._fetchBlobFromRepoRelPath(oldFileRel);
          return { oldFileRel, newFileRel, blob };
        });
        for (const p of prepared) {
          operations.push({ operation: "addOrUpdate", path: p.newFileRel, content: p.blob });
          operations.push({ operation: "delete", path: p.oldFileRel });
        }
      }
      await this._commitOperations(operations, { title: `rename-dir: ${fromDirRel} -> ${toDirRel}` });
    }

    return { success: true, source: oldPath, target: newPath };
  }

  async copyItem(sourceSubPath, targetSubPath, ctx = {}) {
    this._ensureInitialized();
    this._requireWriteEnabled();

    const { mount, skipExisting = false, _skipExistingChecked = false } = ctx;
    const sourcePath = ctx?.sourcePath;
    const targetPath = ctx?.targetPath;

    const fromSub = normalizeSubPath(sourceSubPath || "/", { asDirectory: String(sourceSubPath || "").endsWith("/") });
    const toSub = normalizeSubPath(targetSubPath || "/", { asDirectory: String(targetSubPath || "").endsWith("/") });

    if (fromSub === "/" || toSub === "/") {
      throw new DriverError("不支持复制挂载根目录", { status: ApiStatus.BAD_REQUEST, expose: true });
    }

    const isDir = String(fromSub).endsWith("/");
    const access = await this._getDatasetAccessInfo();
    const requiresAuth = access.requiresAuth;

    // 单文件复制：支持 skipExisting
    if (!isDir) {
      const fromRel = this._toRepoRelPathFromSubPath(fromSub, { asDirectory: false, mount });
      const toRel = this._toRepoRelPathFromSubPath(toSub, { asDirectory: false, mount });
      if (!fromRel || !toRel) {
        throw new DriverError("复制路径无效", { status: ApiStatus.BAD_REQUEST, expose: true });
      }

      if (skipExisting && !_skipExistingChecked) {
        try {
          const exists = await this.getFileInfo(targetSubPath, { ...ctx, path: targetPath, subPath: targetSubPath });
          if (exists) {
            return {
              status: "skipped",
              skipped: true,
              reason: "target_exists",
              source: sourcePath,
              target: targetPath,
              contentLength: 0,
            };
          }
        } catch {}
      }

      // 优化点 B：同仓库内复制优先走 “服务端 LFS copy”（不下载不上传）
      // - 仅对 LFS 文件可用；非 LFS 会自动回退到老逻辑
      const fast = await this._tryServerSideLfsCopyFile(fromRel, toRel, { deleteSource: false, title: `copy(lfs): ${fromRel} -> ${toRel}` });
      if (fast.supported) {
        return { status: "success", source: sourcePath, target: targetPath };
      }

      const content = requiresAuth ? await this._fetchBlobFromRepoRelPath(fromRel) : new URL(this._buildResolveUrl(fromRel, { download: false }));
      await this._commitOperations([{ operation: "addOrUpdate", path: toRel, content }], { title: `copy: ${fromRel} -> ${toRel}` });
      return { status: "success", source: sourcePath, target: targetPath };
    }

    // 目录复制：列出所有文件（递归），批量 addOrUpdate
    const fromDirRel = this._toRepoRelDirFromSubPath(fromSub, { mount });
    const toDirRel = this._toRepoRelDirFromSubPath(toSub, { mount });
    if (!fromDirRel || !toDirRel) {
      throw new DriverError("复制目录路径无效", { status: ApiStatus.BAD_REQUEST, expose: true });
    }

    const entries = await this._listFilesRecursive(fromDirRel);
    const files = entries.filter((e) => e && e.type === "file" && typeof e.path === "string");
    if (files.length === 0) {
      return { status: "success", source: sourcePath, target: targetPath };
    }

    // 目录复制：先尽量用 LFS 服务端 copy，剩下的再回退到老逻辑
    const fromPaths = files.map((f) => String(f.path));
    const pathsInfoMap = await this._getPathsInfoMap(fromPaths, { cacheKey: `copy-dir:${fromDirRel}`, expand: false });

    /** @type {Array<{oldFileRel:string,newFileRel:string,oid:string,size?:number}>} */
    const fastLfs = [];
    /** @type {Array<{type:string,path:string,size:number}>} */
    const slow = [];
    for (const f of files) {
      const oldFileRel = String(f.path);
      const suffix = oldFileRel.startsWith(fromDirRel) ? oldFileRel.slice(fromDirRel.length) : oldFileRel;
      const newFileRel = `${toDirRel}${suffix}`.replace(/\/+/g, "/");
      const info = pathsInfoMap.get(oldFileRel);
      const oid = info?.lfs?.oid ? String(info.lfs.oid) : "";
      if (oid) {
        const size = typeof info?.lfs?.size === "number" ? info.lfs.size : typeof info?.size === "number" ? info.size : undefined;
        fastLfs.push({ oldFileRel, newFileRel, oid, ...(typeof size === "number" ? { size } : {}) });
      } else {
        slow.push(f);
      }
    }

    if (fastLfs.length > 0) {
      const opBatches = chunkArray(fastLfs, MAX_COMMIT_OPERATIONS_PER_BATCH);
      for (const batch of opBatches) {
        const header = {
          key: "header",
          value: {
            summary: `copy-dir(lfs): ${fromDirRel} -> ${toDirRel}`,
            description: "",
          },
        };
        const ops = batch.map((it) => ({
          key: "lfsFile",
          value: {
            path: it.newFileRel,
            algo: "sha256",
            oid: it.oid,
            ...(typeof it.size === "number" ? { size: it.size } : {}),
          },
        }));
        await this._commitHubNdjsonLines([header, ...ops].map((x) => JSON.stringify(x)));
      }
    }

    if (slow.length === 0) {
      return { status: "success", source: sourcePath, target: targetPath };
    }

    const fileBatches = chunkArray(slow, MAX_COMMIT_OPERATIONS_PER_BATCH);
    for (const batch of fileBatches) {
      const operations = [];
      if (!requiresAuth) {
        for (const f of batch) {
          const oldFileRel = String(f.path);
          const suffix = oldFileRel.startsWith(fromDirRel) ? oldFileRel.slice(fromDirRel.length) : oldFileRel;
          const newFileRel = `${toDirRel}${suffix}`.replace(/\/+/g, "/");
          const sourceUrl = new URL(this._buildResolveUrl(oldFileRel, { download: false }));
          operations.push({ operation: "addOrUpdate", path: newFileRel, content: sourceUrl });
        }
      } else {
        const prepared = await mapWithConcurrency(batch, 3, async (f) => {
          const oldFileRel = String(f.path);
          const suffix = oldFileRel.startsWith(fromDirRel) ? oldFileRel.slice(fromDirRel.length) : oldFileRel;
          const newFileRel = `${toDirRel}${suffix}`.replace(/\/+/g, "/");
          const blob = await this._fetchBlobFromRepoRelPath(oldFileRel);
          return { newFileRel, blob };
        });
        for (const p of prepared) {
          operations.push({ operation: "addOrUpdate", path: p.newFileRel, content: p.blob });
        }
      }
      await this._commitOperations(operations, { title: `copy-dir: ${fromDirRel} -> ${toDirRel}` });
    }

    return { status: "success", source: sourcePath, target: targetPath };
  }

  // ===== MULTIPART（前端分片上传） =====

  /**
   * 初始化前端分片上传（HuggingFace：LFS multipart/basic）
   * 策略：per_part_url
   * 必须提供 sha256（oid），否则无法从 LFS batch 换取上传指令
   */
  async initializeFrontendMultipartUpload(subPath, options = {}) {
    this._ensureInitialized();
    this._requireWriteEnabled();

    const { fileName, fileSize, mount, db, userIdOrInfo, userType } = options;
    const sha256 = options?.sha256 || options?.oid || null;
    const oid = String(sha256 || "").trim().toLowerCase();

    if (!fileName || typeof fileSize !== "number" || !Number.isFinite(fileSize) || fileSize < 0) {
      throw new DriverError("HuggingFace 分片上传初始化失败：缺少有效的 fileName 或 fileSize", {
        status: ApiStatus.BAD_REQUEST,
        expose: true,
        code: "DRIVER_ERROR.HUGGINGFACE_MULTIPART_INVALID_PARAMS",
      });
    }
    if (!db || !mount?.storage_config_id || !mount?.id) {
      throw new DriverError("HuggingFace 分片上传初始化失败：缺少 db 或 mount 信息", {
        status: ApiStatus.INTERNAL_ERROR,
        expose: true,
        code: "DRIVER_ERROR.HUGGINGFACE_MULTIPART_MISSING_CONTEXT",
      });
    }
    if (!oid) {
      throw new DriverError("HuggingFace 分片上传初始化失败：需要 sha256（前端先算好再请求）", {
        status: ApiStatus.BAD_REQUEST,
        expose: true,
        code: "DRIVER_ERROR.HUGGINGFACE_PRESIGN_MISSING_SHA256",
      });
    }

    // subPath 是目录：拼接 fileName 得到最终文件路径
    const base = normalizeSubPath(subPath || "/", { asDirectory: true }).replace(/\/+$/g, "");
    const targetSubPath = normalizeSubPath(`${base || ""}/${fileName}`, { asDirectory: false });
    const repoRelPath = this._toRepoRelPathFromSubPath(targetSubPath, { asDirectory: false, mount });
    if (!repoRelPath) {
      throw new DriverError("HuggingFace 分片上传初始化失败：目标路径无效", {
        status: ApiStatus.BAD_REQUEST,
        expose: true,
        code: "DRIVER_ERROR.HUGGINGFACE_INVALID_PATH",
        details: { subPath, fileName },
      });
    }

    const instructions = await fetchHfLfsUploadInstructions(this, { oid, size: fileSize });
    const isAlreadyUploaded = instructions.mode === "already_uploaded";

    // 已存在：用“跳过上传”的方式兼容 Uppy multipart 流程
    const presignedUrls = isAlreadyUploaded
      ? [{ partNumber: 1, url: "/__uppy_skip_upload__" }]
      : (instructions.presignedUrls || []);

    if (!Array.isArray(presignedUrls) || presignedUrls.length === 0) {
      throw new DriverError("HuggingFace 分片上传初始化失败：上游未返回分片上传 URL", {
        status: ApiStatus.BAD_GATEWAY,
        expose: true,
        code: "DRIVER_ERROR.HUGGINGFACE_MULTIPART_MISSING_URLS",
      });
    }

    // 记录会话到 upload_sessions
    const fsPath = (() => {
      const basePath = (mount.mount_path || "").replace(/\/+$/g, "") || "/";
      const rel = String(targetSubPath || "").startsWith("/") ? String(targetSubPath) : `/${String(targetSubPath || "")}`;
      return basePath === "/" ? rel : `${basePath}${rel}`;
    })();

    const urlTtlSeconds = !isAlreadyUploaded
      ? tryParseAmzExpiresSeconds(String(presignedUrls?.[0]?.url || ""))
      : null;
    const expiresAt =
      urlTtlSeconds && Number.isFinite(urlTtlSeconds) && urlTtlSeconds > 0
        ? new Date(Date.now() + Number(urlTtlSeconds) * 1000).toISOString()
        : null;

    const providerMeta = JSON.stringify({
      oid,
      repoRelPath,
      fileSize,
      mode: instructions.mode,
      completionUrl: instructions.completionUrl || null,
      partSize: instructions.partSize || null,
      urlTtlSeconds: urlTtlSeconds || null,
      presignedUrls,
      skipUpload: isAlreadyUploaded,
    });

    const { id: uploadId } = await createUploadSessionRecord(db, {
      userIdOrInfo,
      userType: userType || null,
      storageType: this.type,
      storageConfigId: mount.storage_config_id,
      mountId: mount.id ?? null,
      fsPath,
      source: "FS",
      fileName,
      fileSize,
      mimeType: options?.contentType ? String(options.contentType) : null,
      checksum: oid,
      strategy: "per_part_url",
      partSize: isAlreadyUploaded ? fileSize : (instructions.partSize || fileSize),
      totalParts: presignedUrls.length,
      providerUploadId: null,
      providerUploadUrl: instructions.completionUrl || instructions.uploadUrl || null,
      providerMeta,
      status: "initiated",
      expiresAt,
    });

    return {
      success: true,
      uploadId,
      strategy: "per_part_url",
      key: fsPath.replace(/^\/+/, ""),
      presignedUrls,
      partSize: isAlreadyUploaded ? fileSize : (instructions.partSize || fileSize),
      totalParts: presignedUrls.length,
      fileName,
      fileSize,
      skipUpload: isAlreadyUploaded,
      policy: {
        refreshPolicy: "server_decides",
        signingMode: "eager",
        partsLedgerPolicy: "client_keeps",
        ...(urlTtlSeconds ? { urlTtlSeconds: Number(urlTtlSeconds) } : {}),
        retryPolicy: { maxAttempts: 3 },
      },
    };
  }

  async listMultipartUploads(subPath = "", options = {}) {
    this._ensureInitialized();
    const { mount, db, userIdOrInfo, userType } = options;
    if (!db || !mount?.id) {
      return { success: true, uploads: [] };
    }

    let fsPathPrefix = subPath || "";
    if (mount.mount_path) {
      const basePath = (mount.mount_path || "").replace(/\/+$/g, "") || "/";
      const rel = (subPath || "").replace(/^\/+/g, "");
      fsPathPrefix = rel ? `${basePath}/${rel}` : basePath;
    }

    const sessions = await listActiveUploadSessions(db, {
      userIdOrInfo,
      userType,
      storageType: this.type,
      mountId: mount.id ?? null,
      fsPathPrefix,
      limit: 100,
    });

    const uploads = (sessions || []).map((row) => {
      const bytesUploaded = typeof row.bytes_uploaded === "number" ? Number(row.bytes_uploaded) : 0;

      let meta = {};
      try {
        meta = row?.provider_meta ? JSON.parse(String(row.provider_meta)) : {};
      } catch {
        meta = {};
      }
      const ttl = Number(meta?.urlTtlSeconds);

      return {
        key: (row.fs_path || "/").replace(/^\/+/, ""),
        uploadId: row.id,
        initiated: row.created_at,
        fileName: row.file_name,
        fileSize: row.file_size,
        partSize: row.part_size,
        totalParts: row.total_parts ?? null,
        strategy: row.strategy || "per_part_url",
        storageType: row.storage_type,
        sessionId: row.id,
        bytesUploaded,
        policy: {
          refreshPolicy: "server_decides",
          signingMode: "eager",
          partsLedgerPolicy: "client_keeps",
          ...(Number.isFinite(ttl) && ttl > 0 ? { urlTtlSeconds: Math.floor(ttl) } : {}),
          retryPolicy: { maxAttempts: 3 },
        },
      };
    });

    return { success: true, uploads };
  }

  async listMultipartParts(_subPath, uploadId, options = {}) {
    this._ensureInitialized();
    const { mount, db } = options || {};
    if (!db || !mount?.storage_config_id || !uploadId) {
      return { success: true, uploadId: uploadId || null, parts: [], errors: [] };
    }

    let ttl = null;
    try {
      const sessionRow = await findUploadSessionById(db, { id: uploadId });
      if (sessionRow && String(sessionRow.storage_type) === String(this.type)) {
        let meta = {};
        try {
          meta = sessionRow.provider_meta ? JSON.parse(String(sessionRow.provider_meta)) : {};
        } catch {
          meta = {};
        }
        const ttlRaw = Number(meta?.urlTtlSeconds);
        ttl = Number.isFinite(ttlRaw) && ttlRaw > 0 ? Math.floor(ttlRaw) : null;
      }
    } catch {
      ttl = null;
    }
    const policy = {
      refreshPolicy: "server_decides",
      signingMode: "eager",
      partsLedgerPolicy: "client_keeps",
      ...(ttl ? { urlTtlSeconds: ttl } : {}),
      retryPolicy: { maxAttempts: 3 },
    };

    return { success: true, uploadId: uploadId || null, parts: [], errors: [], policy };
  }

  async signMultipartParts(_subPath, uploadId, partNumbers, options = {}) {
    this._ensureInitialized();
    this._requireWriteEnabled();

    const { mount, db } = options || {};
    if (!db || !mount?.storage_config_id || !mount?.id || !uploadId) {
      throw new DriverError("HuggingFace 签名分片URL失败：缺少必要参数", { status: ApiStatus.BAD_REQUEST, expose: true });
    }

    const sessionRow = await findUploadSessionById(db, { id: uploadId });
    if (!sessionRow) {
      throw new DriverError("HuggingFace 签名分片URL失败：未找到 upload_sessions 记录", { status: ApiStatus.BAD_REQUEST, expose: true });
    }
    if (String(sessionRow.storage_type) !== String(this.type)) {
      throw new DriverError("HuggingFace 签名分片URL失败：会话存储类型不匹配", { status: ApiStatus.BAD_REQUEST, expose: true });
    }

    let meta = {};
    try {
      meta = sessionRow.provider_meta ? JSON.parse(String(sessionRow.provider_meta)) : {};
    } catch {
      meta = {};
    }

    const oid = String(meta?.oid || sessionRow.checksum || "").trim().toLowerCase();
    const size = Number(meta?.fileSize || sessionRow.file_size || 0);
    if (!oid || !Number.isFinite(size) || size < 0) {
      throw new DriverError("HuggingFace 签名分片URL失败：会话缺少 oid 或 fileSize", {
        status: ApiStatus.BAD_REQUEST,
        expose: true,
        code: "DRIVER_ERROR.HUGGINGFACE_MULTIPART_SESSION_INVALID",
      });
    }

    const requested = Array.isArray(partNumbers) ? partNumbers.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0) : [];

    // 优先使用会话里保存的 presignedUrls
    const metaPresignedUrls = Array.isArray(meta?.presignedUrls) ? meta.presignedUrls : [];
    if (metaPresignedUrls.length > 0) {
      // URL 过期处理：
      // HF LFS 返回的是“带 uploadId 的 S3 预签名 URL”，过期后通常无法继续沿用同一套 URL
      // 用 upload_sessions.expires_at 做判定：过期则重新请求 LFS batch，视为“会话重置”
      const expiresAtIso = sessionRow.expires_at ? String(sessionRow.expires_at) : "";
      const expiresAtMs = expiresAtIso ? Date.parse(expiresAtIso) : NaN;
      const isExpired = Number.isFinite(expiresAtMs) && expiresAtMs > 0 && Date.now() >= expiresAtMs;

      if (!isExpired) {
      const filtered = requested.length
        ? metaPresignedUrls.filter((x) => requested.includes(Number(x.partNumber)))
        : metaPresignedUrls;

      const ttl = Number(meta?.urlTtlSeconds);
      return {
        success: true,
        uploadId,
        strategy: "per_part_url",
        presignedUrls: filtered,
        partSize: meta?.partSize || sessionRow.part_size || null,
        totalParts: Number(sessionRow.total_parts) || metaPresignedUrls.length,
        policy: {
          refreshPolicy: "server_decides",
          signingMode: "eager",
          partsLedgerPolicy: "client_keeps",
          ...(Number.isFinite(ttl) && ttl > 0 ? { urlTtlSeconds: Math.floor(ttl) } : {}),
          retryPolicy: { maxAttempts: 3 },
        },
      };
      }
    }

    // 兼容旧会话 / URL 过期会话：
    // 重新请求 LFS batch，但这可能会产生新的 provider uploadId。
    // 为了避免 complete 仍使用旧 completionUrl 导致 400：
    // 更新 upload_sessions.provider_meta/completionUrl 为本次新的
    // 清空已记录的 parts
    const instructions = await fetchHfLfsUploadInstructions(this, { oid, size });
    const presignedUrls = Array.isArray(instructions.presignedUrls) ? instructions.presignedUrls : [];
    const refreshedTtlSeconds = tryParseAmzExpiresSeconds(String(presignedUrls?.[0]?.url || ""));
    meta = {
      ...(meta && typeof meta === "object" ? meta : {}),
      mode: instructions.mode,
      completionUrl: instructions.completionUrl || null,
      partSize: instructions.partSize || null,
      presignedUrls,
      urlTtlSeconds: refreshedTtlSeconds || meta?.urlTtlSeconds || null,
      skipUpload: instructions.mode === "already_uploaded",
    };

    try {
      const providerMeta = JSON.stringify(meta);
      const expiresAt =
        refreshedTtlSeconds && Number.isFinite(refreshedTtlSeconds) && refreshedTtlSeconds > 0
          ? new Date(Date.now() + Number(refreshedTtlSeconds) * 1000).toISOString()
          : sessionRow.expires_at || null;
      await updateUploadSessionById(db, {
        id: String(uploadId),
        providerMeta,
        providerUploadUrl: instructions.completionUrl || instructions.uploadUrl || null,
        partSize: instructions.partSize || sessionRow.part_size || null,
        ...(Array.isArray(presignedUrls) ? { totalParts: presignedUrls.length } : {}),
        expiresAt,
      });
    } catch (e) {
      console.warn("[HUGGINGFACE] refresh 更新 upload_sessions 失败（可忽略）:", e?.message || e);
    }

    const filtered = requested.length
      ? presignedUrls.filter((x) => requested.includes(Number(x.partNumber)))
      : presignedUrls;

    return {
      success: true,
      uploadId,
      strategy: "per_part_url",
      presignedUrls: filtered,
      partSize: instructions.partSize || null,
      totalParts: Array.isArray(presignedUrls) ? presignedUrls.length : (sessionRow.total_parts || null),
      resetUploadedParts: true,
      policy: {
        refreshPolicy: "server_decides",
        signingMode: "eager",
        partsLedgerPolicy: "client_keeps",
        ...(refreshedTtlSeconds ? { urlTtlSeconds: Number(refreshedTtlSeconds) } : {}),
        retryPolicy: { maxAttempts: 3 },
      },
    };
  }

  async abortFrontendMultipartUpload(_subPath, options = {}) {
    this._ensureInitialized();
    const { uploadId, fileName, mount, db } = options;
    if (!db || !mount?.storage_config_id || !mount?.id || !uploadId || !fileName) {
      throw new DriverError("HuggingFace 中止分片上传失败：缺少必要参数", { status: ApiStatus.BAD_REQUEST, expose: true });
    }

    try {
      await updateUploadSessionById(db, {
        id: String(uploadId),
        status: "aborted",
      });
    } catch (e) {
      console.warn("[HUGGINGFACE] abort 更新 upload_sessions 状态失败（可忽略）:", e?.message || e);
    }

    return { success: true };
  }

  async completeFrontendMultipartUpload(_subPath, options = {}) {
    this._ensureInitialized();
    this._requireWriteEnabled();

    const { uploadId, parts, mount, db } = options || {};
    if (!db || !mount?.storage_config_id || !mount?.id || !uploadId) {
      throw new DriverError("HuggingFace 完成分片上传失败：缺少必要参数", { status: ApiStatus.BAD_REQUEST, expose: true });
    }

    const sessionRow = await findUploadSessionById(db, { id: uploadId });
    if (!sessionRow) {
      throw new DriverError("HuggingFace 完成分片上传失败：未找到 upload_sessions 记录", { status: ApiStatus.BAD_REQUEST, expose: true });
    }
    if (String(sessionRow.storage_type) !== String(this.type)) {
      throw new DriverError("HuggingFace 完成分片上传失败：会话存储类型不匹配", { status: ApiStatus.BAD_REQUEST, expose: true });
    }

    let meta = {};
    try {
      meta = sessionRow.provider_meta ? JSON.parse(String(sessionRow.provider_meta)) : {};
    } catch {
      meta = {};
    }

    const oid = String(meta?.oid || sessionRow.checksum || "").trim().toLowerCase();
    const repoRelPath = String(meta?.repoRelPath || "").trim();
    const size = Number(meta?.fileSize || sessionRow.file_size || 0);
    const mode = String(meta?.mode || "basic");
    const completionUrl = meta?.completionUrl ? String(meta.completionUrl) : null;
    const skipUpload = meta?.skipUpload === true;

    if (!oid || !repoRelPath || !Number.isFinite(size) || size < 0) {
      throw new DriverError("HuggingFace 完成分片上传失败：会话元信息不完整", {
        status: ApiStatus.BAD_REQUEST,
        expose: true,
        code: "DRIVER_ERROR.HUGGINGFACE_MULTIPART_SESSION_INVALID",
        details: { hasOid: !!oid, hasRepoRelPath: !!repoRelPath, size },
      });
    }

    if (!skipUpload && mode === "multipart" && completionUrl) {
      // 客户端本地保存 parts 账本（ETag 只有浏览器能读到）
      // 因此 complete 必须以“前端传回来的 parts”为准。
      const normalized = (Array.isArray(parts) ? parts : [])
        .map((p) => ({
          partNumber: Number(p?.partNumber ?? p?.PartNumber),
          etag: p?.etag ?? p?.ETag ?? null,
        }))
        .filter((p) => Number.isFinite(p.partNumber) && p.partNumber > 0 && typeof p.etag === "string" && p.etag.length > 0)
        .sort((a, b) => a.partNumber - b.partNumber);

      if (normalized.length === 0) {
        throw new DriverError("HuggingFace multipart 完成失败：缺少有效的 parts（需要 ETag）", {
          status: ApiStatus.BAD_REQUEST,
          expose: true,
          code: "DRIVER_ERROR.HUGGINGFACE_MULTIPART_MISSING_PARTS",
        });
      }

      await completeHfLfsMultipartUpload({ completionUrl, oid, parts: normalized });
    }

    const header = {
      key: "header",
      value: {
        summary: `upload (multipart): ${repoRelPath}`,
        description: "",
      },
    };
    const lfsFile = {
      key: "lfsFile",
      value: {
        path: repoRelPath,
        algo: "sha256",
        oid,
        size,
      },
    };
    await commitHubNdjsonLines(this, [header, lfsFile].map((x) => JSON.stringify(x)));

    try {
      await updateUploadSessionById(db, {
        id: String(uploadId),
        status: "completed",
      });
    } catch (e) {
      console.warn("[HUGGINGFACE] complete 更新 upload_sessions 状态失败（可忽略）:", e?.message || e);
    }

    return { success: true, message: "上传完成", storagePath: repoRelPath, publicUrl: null };
  }
}
