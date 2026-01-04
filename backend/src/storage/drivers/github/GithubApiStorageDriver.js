/**
 * GithubApiStorageDriver
 * - GitHub 仓库映射为可读写文件系统（全 CRUD）
 * - 读：Contents API
 * - 写：Git Database API（blobs/trees/commits/refs）
 */

import { BaseDriver } from "../../interfaces/capabilities/BaseDriver.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { ApiStatus } from "../../../constants/index.js";
import { DriverError, NotFoundError, ValidationError } from "../../../http/errors.js";
import { buildFileInfo } from "../../utils/FileInfoBuilder.js";
import { createHttpStreamDescriptor } from "../../streaming/StreamDescriptorUtils.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";
import { getMimeTypeFromFilename } from "../../../utils/fileUtils.js";
import { MasqueradeClient } from "../../../utils/httpMasquerade.js";
import { Buffer } from "buffer";
import { decryptIfNeeded } from "../../../utils/crypto.js";

const DEFAULT_API_BASE = "https://api.github.com";
// GitHub Contents API 本身不提供“最后修改时间”，目录列表阶段不额外请求 commits（避免 N 次请求导致限流）
const DEFAULT_FILE_MODE = "100644";
const GITKEEP_FILENAME = ".gitkeep";
// GitHub Git Database API 单个 blob 上限（官方限制）：100MB
const MAX_GITHUB_BLOB_BYTES = 100 * 1024 * 1024;
const MODIFIED_CACHE_LIMIT = 1000;
const SUBMODULE_MIMETYPE = "application/x-git-submodule";

export class GithubApiStorageDriver extends BaseDriver {
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "GITHUB_API";
    this.encryptionSecret = encryptionSecret;
    this.capabilities = [CAPABILITIES.READER, CAPABILITIES.PROXY, CAPABILITIES.DIRECT_LINK];

    this.owner = config?.owner || "";
    this.repo = config?.repo || "";
    this.token = config?.token || null;
    this.ref = config?.ref || null;
    this.defaultFolder = config?.default_folder || "";
    this.apiBase = config?.endpoint_url || DEFAULT_API_BASE;
    this.ghProxy = config?.gh_proxy || null;

    this.committerName = config?.committer_name || null;
    this.committerEmail = config?.committer_email || null;
    this.authorName = config?.author_name || null;
    this.authorEmail = config?.author_email || null;

    //不在 Schema 中暴露，使用默认值
    this.writeThrottleMs = Number.isFinite(Number(config?.write_throttle_ms)) ? Number(config.write_throttle_ms) : 1000;
    this.retryMaxAttempts = Number.isFinite(Number(config?.retry_max_attempts)) ? Math.max(1, Number(config.retry_max_attempts)) : 4;
    this.retryBaseDelayMs = Number.isFinite(Number(config?.retry_base_delay_ms)) ? Math.max(0, Number(config.retry_base_delay_ms)) : 500;
    this.retryMaxDelayMs = Number.isFinite(Number(config?.retry_max_delay_ms)) ? Math.max(0, Number(config.retry_max_delay_ms)) : 10_000;

    this._resolvedRef = null; // Contents API / raw 直链使用（branch/tag/commit sha 均可）
    this._branchName = null; // 仅当 ref 解析为分支时存在
    this._isOnBranch = false;
    this._repoIsEmpty = false;
    this._repoPrivate = false;
    this._commitQueue = Promise.resolve();
    /** @type {Map<string, string>} */
    this._modifiedCache = new Map();
    this._lastWriteAtMs = 0;
    /** @type {Map<string, string>} */
    this._treeShaCache = new Map();

    // 浏览器伪装客户端
    this._masqueradeClient = new MasqueradeClient({
      deviceCategory: "desktop",
      rotateIP: false,
      rotateUA: false,
    });
  }

  async initialize() {
    // token 可能以 encrypted:* 存在（由存储配置 CRUD 统一加密写入）
    const decryptedToken = await decryptIfNeeded(this.token, this.encryptionSecret);
    this.token = typeof decryptedToken === "string" ? decryptedToken.trim() : decryptedToken;

    const errors = [];
    if (!this.owner) errors.push("GitHub API 配置缺少必填字段: owner");
    if (!this.repo) errors.push("GitHub API 配置缺少必填字段: repo");
    if (!this.token) errors.push("GitHub API 配置缺少必填字段: token（写入必须）");
    // endpoint_url 可选：未配置时默认 https://api.github.com
    // - 若用户显式配置了 endpoint_url，则校验 URL 合法性
    if (this.config?.endpoint_url) {
      try {
        const parsed = new URL(String(this.config.endpoint_url));
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.push("endpoint_url 必须以 http:// 或 https:// 开头");
        }
      } catch {
        errors.push("endpoint_url 不是合法的 URL");
      }
    }
    if (this.defaultFolder) {
      const folder = String(this.defaultFolder).trim();
      if (folder.includes("..")) {
        errors.push("default_folder 不允许包含 .. 段");
      }
    }
    if (errors.length) {
      throw new DriverError(errors.join("；"), {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_INVALID_CONFIG",
        expose: true,
      });
    }

    const repoMeta = await this._fetchJson(this._buildRepoApiUrl());
    this._repoPrivate = !!repoMeta?.private;
    const defaultBranch = repoMeta?.default_branch || null;
    const refName = this.ref && String(this.ref).trim().length > 0 ? String(this.ref).trim() : defaultBranch;
    if (!refName) {
      throw new DriverError("无法解析 GitHub 仓库默认分支，请显式配置 ref", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_INVALID_CONFIG",
        expose: true,
      });
    }

    const parsedRef = this._parseRefInput(refName);
    if (!parsedRef.value) {
      throw new DriverError("ref 不能为空", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_INVALID_CONFIG",
        expose: true,
      });
    }
    if (parsedRef.kind === "unsupported") {
      throw new DriverError("ref 仅支持分支/标签/commit sha（refs/heads/*、heads/*、refs/tags/*、tags/* 或直接填写值）", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_INVALID_CONFIG",
        expose: true,
      });
    }

    this._resolvedRef = parsedRef.value;
    this._modifiedCache.clear();
    this._repoIsEmpty = false;

    // ref 可为 branch/tag/commit sha；仅分支可写
    if (parsedRef.kind === "branch") {
      const exists = await this._branchExists(parsedRef.value);
      if (!exists) {
        const isEmpty = await this._isRepoEmpty();
        if (!isEmpty) {
          throw new DriverError(`分支不存在：${parsedRef.value}`, {
            status: ApiStatus.BAD_REQUEST,
            code: "DRIVER_ERROR.GITHUB_API_INVALID_CONFIG",
            expose: true,
          });
        }
        // 空仓库：允许“分支尚未创建”，写入时自动初始化（创建首个 commit + refs）
        this._branchName = parsedRef.value;
        this._isOnBranch = true;
        this._repoIsEmpty = true;
      }
      if (!this._branchName) {
        this._branchName = parsedRef.value;
        this._isOnBranch = true;
      }
    } else if (parsedRef.kind === "any") {
      const exists = await this._branchExists(parsedRef.value);
      if (exists) {
        this._branchName = parsedRef.value;
        this._isOnBranch = true;
      } else {
        // 空仓库：任何 ref（无 tags/sha 可用）默认按“将要创建的分支名”处理
        const isEmpty = await this._isRepoEmpty();
        if (isEmpty) {
          this._branchName = parsedRef.value;
          this._isOnBranch = true;
          this._repoIsEmpty = true;
        }
      }
    }

    this.capabilities = [CAPABILITIES.READER, CAPABILITIES.PROXY, CAPABILITIES.DIRECT_LINK];
    if (this._isOnBranch) {
      this.capabilities.push(CAPABILITIES.WRITER, CAPABILITIES.ATOMIC);
    }

    this.initialized = true;
  }

  async listDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, path, db } = ctx;
    const normalizedSubPath = this._normalizeSubPath(subPath);
    const repoPath = this._toRepoPath(normalizedSubPath);
    let listing = null;
    try {
      listing = await this._getDirectoryListing(repoPath);
    } catch (e) {
      // 空仓库：根目录视为“空目录”，不报 404
      if (
        this._repoIsEmpty &&
        normalizedSubPath === "/" &&
        (e instanceof NotFoundError || (e instanceof DriverError && e?.details?.status === 409))
      ) {
        listing = { sha: null, entries: [] };
      } else {
        throw e;
      }
    }
    const basePath = path;
    /** @type {any[]} */
    let entries = Array.isArray(listing?.entries) ? listing.entries : [];

    // 大目录优化：当 entries 达到上限（>=1000）时优先走 git/trees，避免 Contents API 列表过大或被截断
    // 说明：object+json 目录响应通常包含 sha（tree sha），可直接作为 trees/{sha} 的输入
    if (entries.length >= 1000) {
      const treeSha = listing?.sha || (await this._resolveTreeShaByRepoPath(repoPath));
      const tree = await this._getTree(treeSha, { recursive: false });
      const trees = Array.isArray(tree?.tree) ? tree.tree : [];
      entries = trees
        .filter((t) => t && typeof t.path === "string" && !t.path.includes("/"))
        .map((t) => ({
          name: t.path,
          type: t.type === "tree" ? "dir" : t.type === "commit" ? "submodule" : "file",
          sha: t.sha,
          size: typeof t.size === "number" ? t.size : 0,
        }));
    }

    const items = await Promise.all(
      entries
        .filter((item) => item?.name && item.name !== GITKEEP_FILENAME)
        .map(async (item) => {
          const isDirectory = item.type === "dir";
          const isSubmodule = item.type === "submodule";
          const name = item.name;
          // 约定：目录列表不拉取 modified（避免 N 次 commits 请求导致性能/限流问题）
          // modified 在 getFileInfo（右侧详情/单文件信息）中按需 best-effort 获取；这里返回 null，让前端显示 "-"
          const modified = null;
          const mimetype = isSubmodule ? SUBMODULE_MIMETYPE : isDirectory ? "application/x-directory" : getMimeTypeFromFilename(name);
          const fsPath = this._joinMountPath(basePath, name, isDirectory);
          const info = await buildFileInfo({
            fsPath,
            name,
            isDirectory,
            // 目录/子模块大小通常无法可靠获取；未知就返回 null（前端显示 “-”，由上层按需 index/compute 兜底）
            size: isDirectory || isSubmodule ? null : Number(item.size) || 0,
            modified,
            mimetype,
            mount,
            storageType: mount?.storage_type,
            db,
          });
          return { ...info, etag: item.sha || undefined, isVirtual: false };
        }),
    );

    return {
      path,
      type: "directory",
      isRoot: normalizedSubPath === "/" || normalizedSubPath === "",
      isVirtual: false,
      mount_id: mount?.id,
      storage_type: mount?.storage_type,
      items,
    };
  }

  async getFileInfo(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, path, db } = ctx;
    const normalizedSubPath = this._normalizeSubPath(subPath);
    // 空仓库：根目录视为存在的“空目录”
    if (this._repoIsEmpty && normalizedSubPath === "/") {
      const info = await buildFileInfo({
        fsPath: path,
        name: this._basename(path, true),
        isDirectory: true,
        size: null,
        modified: null,
        mimetype: null,
        mount,
        storageType: mount?.storage_type,
        db,
      });
      return { ...info, etag: undefined };
    }
    const repoPath = this._toRepoPath(normalizedSubPath);
    const content = await this._getContents(repoPath, { asObjectList: true, allowArray: true });
    const isDirectory = Array.isArray(content);
    if (!isDirectory && content?.type === "submodule") {
      throw new DriverError("不支持访问 Git submodule（子模块）", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_SUBMODULE_UNSUPPORTED",
        expose: true,
        details: { subPath: normalizedSubPath },
      });
    }
    const name = this._basename(path, isDirectory);
    const repoRelPath = this._toRepoRelPath(normalizedSubPath);
    const modified = !isDirectory && repoRelPath ? await this._getLastModifiedIso(repoRelPath) : null;
    const mimetype = isDirectory ? "application/x-directory" : getMimeTypeFromFilename(name);
    const info = await buildFileInfo({
      fsPath: path,
      name,
      isDirectory,
      size: isDirectory ? null : Number(content?.size) || 0,
      modified,
      mimetype: content?.type === "submodule" ? SUBMODULE_MIMETYPE : mimetype,
      mount,
      storageType: mount?.storage_type,
      db,
    });
    return { ...info, etag: isDirectory ? undefined : content?.sha || undefined };
  }

  async downloadFile(subPath, ctx = {}) {
    this._ensureInitialized();
    const { path } = ctx;
    const normalizedSubPath = this._normalizeSubPath(subPath);
    const repoPath = this._toRepoPath(normalizedSubPath);
    const contentsUrl = this._buildContentsApiUrl(repoPath, { ref: this._resolvedRef });
    const rel = this._toRepoRelPath(normalizedSubPath);
    const encodedRef = this._encodeGitRefPath(this._resolvedRef);
    const rawUrl = rel ? this._applyProxy(`https://raw.githubusercontent.com/${this.owner}/${this.repo}/${encodedRef}/${this._encodeRawPath(rel)}`) : null;
    const filename = this._basename(path, false) || (rel ? rel.split("/").filter(Boolean).pop() : "") || "file";
    const contentType = getMimeTypeFromFilename(filename);
    let knownSize = null;

    // 私有仓库：提前拉取元信息用于 submodule 判定 + size 推断（避免 Range 时 size=null 导致降级为 200）
    if (this._repoPrivate || !rawUrl) {
      const meta = await this._fetchJson(contentsUrl, { headers: { Accept: "application/vnd.github+json" } });
      if (meta?.type === "submodule") {
        throw new DriverError("不支持下载 Git submodule（子模块）", {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.GITHUB_API_SUBMODULE_UNSUPPORTED",
          expose: true,
          details: { subPath: normalizedSubPath },
        });
      }
      if (meta && typeof meta.size === "number" && Number.isFinite(meta.size) && meta.size >= 0) {
        knownSize = meta.size;
      }
    }

    return createHttpStreamDescriptor({
      fetchResponse: async (signal) => {
        // 私有仓库：必须走 Contents API（raw.githubusercontent.com 不带鉴权）
        if (this._repoPrivate || !rawUrl) {
          return await fetch(contentsUrl, {
            method: "GET",
            headers: this._buildHeaders({ Accept: "application/vnd.github.raw" }),
            signal,
          });
        }

        // 公共仓库：优先走 raw.githubusercontent.com
        const resp = await fetch(rawUrl, { method: "GET", signal });
        if (resp.status === 404) {
          // raw 的 404：再用 Contents 元信息区分“文件不存在”还是“submodule”
          try {
            const meta = await this._fetchJson(contentsUrl, { headers: { Accept: "application/vnd.github+json" } });
            if (meta?.type === "submodule") {
              throw new DriverError("不支持下载 Git submodule（子模块）", {
                status: ApiStatus.BAD_REQUEST,
                code: "DRIVER_ERROR.GITHUB_API_SUBMODULE_UNSUPPORTED",
                expose: true,
                details: { subPath: normalizedSubPath },
              });
            }
          } catch (e) {
            if (e instanceof DriverError && e.code === "DRIVER_ERROR.GITHUB_API_SUBMODULE_UNSUPPORTED") {
              throw e;
            }
          }
        }
        return resp;
      },
      fetchRangeResponse: async (signal, rangeHeader) => {
        // 私有仓库：Range 走 Contents raw
        if (this._repoPrivate || !rawUrl) {
          return await fetch(contentsUrl, {
            method: "GET",
            headers: this._buildHeaders({ Accept: "application/vnd.github.raw", Range: rangeHeader }),
            signal,
          });
        }

        // 公共仓库：Range 走 raw.githubusercontent.com
        const resp = await fetch(rawUrl, { method: "GET", headers: { Range: rangeHeader }, signal });
        if (resp.status === 404) {
          // raw 的 404：再用 Contents 元信息区分“文件不存在”还是“submodule”
          try {
            const meta = await this._fetchJson(contentsUrl, { headers: { Accept: "application/vnd.github+json" } });
            if (meta?.type === "submodule") {
              throw new DriverError("不支持下载 Git submodule（子模块）", {
                status: ApiStatus.BAD_REQUEST,
                code: "DRIVER_ERROR.GITHUB_API_SUBMODULE_UNSUPPORTED",
                expose: true,
                details: { subPath: normalizedSubPath },
              });
            }
          } catch (e) {
            if (e instanceof DriverError && e.code === "DRIVER_ERROR.GITHUB_API_SUBMODULE_UNSUPPORTED") {
              throw e;
            }
          }
        }
        return resp;
      },
      fetchHeadResponse: async (signal) => {
        // 优先对“最终下载 URL”执行 HEAD，用于 Range 场景探测 size
        if (this._repoPrivate || !rawUrl) {
          try {
            return await fetch(contentsUrl, {
              method: "HEAD",
              headers: this._buildHeaders({ Accept: "application/vnd.github.raw" }),
              signal,
            });
          } catch {
            return null;
          }
        }
        try {
          return await fetch(rawUrl, { method: "HEAD", signal });
        } catch {
          return null;
        }
      },
      size: knownSize,
      contentType,
      supportsRange: true,
    });
  }

  async exists(subPath, ctx = {}) {
    try {
      await this.getFileInfo(subPath, ctx);
      return true;
    } catch (e) {
      if (e instanceof NotFoundError) return false;
      return false;
    }
  }

  async stat(subPath, ctx = {}) {
    return await this.getFileInfo(subPath, ctx);
  }

  async uploadFile(subPath, fileOrStream, ctx = {}) {
    this._ensureInitialized();
    const { path: fsPath, filename, contentLength, mount } = ctx;

    const normalizedSubPath = this._normalizeSubPath(subPath);
    const targetSubPath = this._resolveTargetSubPath(normalizedSubPath, fsPath, filename);
    const repoRelPath = this._toRepoRelPath(targetSubPath);

    // 上传：优先走“边读边写”的 blob 创建，降低内存峰值
    this._assertBlobSizeAllowed({ contentLength, bytesLength: null, filename: filename || null });
    const sha = await this._createBlobFromInput(fileOrStream, { contentLength, filename: filename || null });

    await this._withCommitLock(async () => {
      await this._commitTreeChanges(
        [{ kind: "upsert", path: repoRelPath, sha }],
        `upload: ${repoRelPath}`,
      );
    });

    // storagePath 语义对齐：
    // - FS（mount 视图）：返回挂载路径（/mount/.../file）
    // - storage-first（ObjectStore/分享上传/直传）：返回传入的 subPath（避免出现 file/file）
    const storagePath = mount
      ? this._buildMountPath(mount, targetSubPath)
      : typeof subPath === "string" && subPath
        ? subPath
        : targetSubPath;

    return { success: true, storagePath, message: "GITHUB_API_UPLOAD" };
  }

  async updateFile(subPath, content, ctx = {}) {
    this._ensureInitialized();
    const { path: fsPath } = ctx;

    const normalizedSubPath = this._normalizeSubPath(subPath);
    const repoRelPath = this._toRepoRelPath(normalizedSubPath);
    const bytes = await this._readAllBytes(content);
    this._assertBlobSizeAllowed({ contentLength: null, bytesLength: bytes.length, filename: null });

    await this._withCommitLock(async () => {
      await this._commitTreeChanges(
        [{ kind: "upsert", path: repoRelPath, bytes }],
        `update: ${repoRelPath}`,
      );
    });

    return { success: true, path: fsPath, message: "文件更新成功" };
  }

  async createDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    const { path: fsPath } = ctx;

    const normalizedSubPath = this._normalizeSubPath(subPath);
    if (normalizedSubPath === "/" || normalizedSubPath === "") {
      return { success: true, path: fsPath, alreadyExists: true };
    }

    const dirRel = this._toRepoRelPath(normalizedSubPath);
    if (!dirRel) {
      return { success: true, path: fsPath, alreadyExists: true };
    }

    const keepPath = `${dirRel}/${GITKEEP_FILENAME}`;

    await this._withCommitLock(async () => {
      await this._commitTreeChanges(
        [{ kind: "upsert", path: keepPath, bytes: Buffer.from("", "utf8") }],
        `mkdir: ${dirRel}`,
      );
    });

    return { success: true, path: fsPath, alreadyExists: false };
  }

  async renameItem(oldSubPath, newSubPath, ctx = {}) {
    this._ensureInitialized();
    const { oldPath, newPath } = ctx;

    const fromSub = this._normalizeSubPath(oldSubPath);
    const toSub = this._normalizeSubPath(newSubPath);

    // 禁止对挂载根执行重命名（可能导致整库移动）
    if (fromSub === "/" || toSub === "/") {
      throw new DriverError("不支持重命名挂载根目录", { status: ApiStatus.BAD_REQUEST, expose: true });
    }

    const fromRel = this._toRepoRelPath(fromSub);
    const toRel = this._toRepoRelPath(toSub);

    await this._withCommitLock(async () => {
      const planned = await this._planMoveOrCopy({ fromRel, toRel, mode: "move" });
      await this._commitPlannedChanges(planned, `rename: ${fromRel} -> ${toRel}`);
    });

    return { success: true, source: oldPath, target: newPath };
  }

  async copyItem(sourceSubPath, targetSubPath, ctx = {}) {
    this._ensureInitialized();
    const { sourcePath, targetPath, skipExisting = false, _skipExistingChecked = false } = ctx;

    const fromSub = this._normalizeSubPath(sourceSubPath);
    const toSub = this._normalizeSubPath(targetSubPath);

    if (fromSub === "/" || toSub === "/") {
      throw new DriverError("不支持复制挂载根目录", { status: ApiStatus.BAD_REQUEST, expose: true });
    }

    const fromRel = this._toRepoRelPath(fromSub);
    const toRel = this._toRepoRelPath(toSub);

    // 单文件复制的 skipExisting：入口层未检查时，做一次轻量存在性判断（失败则继续）
    if (skipExisting && !_skipExistingChecked) {
      try {
        const exists = await this._pathExists(toRel);
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

    await this._withCommitLock(async () => {
      const planned = await this._planMoveOrCopy({ fromRel, toRel, mode: "copy" });
      await this._commitPlannedChanges(planned, `copy: ${fromRel} -> ${toRel}`);
    });

    return { status: "success", source: sourcePath, target: targetPath };
  }

  async batchRemoveItems(subPaths, ctx = {}) {
    this._ensureInitialized();
    const { paths } = ctx;

    if (!Array.isArray(subPaths) || subPaths.length === 0) {
      return { success: 0, failed: [], results: [] };
    }

    const results = [];

    const head = await this._getHead();
    const tree = await this._getTreeRecursive(head.treeSha);
    const index = this._indexTree(tree);

    const deleteSet = new Set();

    for (let i = 0; i < subPaths.length; i++) {
      const fsPath = Array.isArray(paths) ? paths[i] : subPaths[i];
      const sub = this._normalizeSubPath(subPaths[i]);
      if (sub === "/") {
        results.push({ path: fsPath, success: false, error: "不支持删除挂载根目录" });
        continue;
      }

      const rel = this._toRepoRelPath(sub);
      const direct = index.get(rel);
      if (direct && direct.type === "commit") {
        results.push({ path: fsPath, success: false, error: "不支持删除 Git submodule（子模块）" });
        continue;
      }
      if (direct && direct.type === "blob") {
        deleteSet.add(rel);
        results.push({ path: fsPath, success: true });
        continue;
      }

      // 目录：删除其下全部 blob（包括 .gitkeep）
      const prefix = `${rel}/`;
      const blobs = (tree.tree || []).filter((e) => e?.type === "blob" && typeof e.path === "string" && e.path.startsWith(prefix));
      const commits = (tree.tree || []).filter((e) => e?.type === "commit" && typeof e.path === "string" && e.path.startsWith(prefix));
      if (commits.length > 0) {
        results.push({ path: fsPath, success: false, error: "不支持删除包含 Git submodule（子模块）的目录" });
        continue;
      }
      if (blobs.length === 0) {
        results.push({ path: fsPath, success: false, error: "路径不存在" });
        continue;
      }

      for (const e of blobs) {
        deleteSet.add(e.path);
      }
      results.push({ path: fsPath, success: true });
    }

    const deletePaths = Array.from(deleteSet).filter((p) => index.has(p));
    if (deletePaths.length > 0) {
      await this._withCommitLock(async () => {
        await this._commitTreeChanges(
          deletePaths.map((p) => ({ kind: "delete", path: p })),
          `remove: ${deletePaths.length} item(s)`,
        );
      });
    }

    const failed = results.filter((r) => !r.success);
    const success = results.filter((r) => r.success).length;
    return { success, failed, results };
  }

  async generateDownloadUrl(subPath, ctx = {}) {
    this._ensureInitialized();
    const fsPath = ctx?.path;
    const { request, forceDownload = false } = ctx;
    const rel = this._toRepoRelPath(this._normalizeSubPath(subPath || "/"));
    if (this._repoPrivate) {
      throw new DriverError("GitHub 私有仓库无法生成浏览器可用的直链，请走本地代理 /api/p", {
        status: ApiStatus.NOT_IMPLEMENTED,
        code: "DRIVER_ERROR.GITHUB_DIRECT_LINK_NOT_AVAILABLE",
        expose: true,
        details: { path: fsPath, subPath },
      });
    }
    const encodedRef = this._encodeGitRefPath(this._resolvedRef);
    const rawUrl = `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${encodedRef}/${this._encodeRawPath(rel)}`;
    return { url: this._applyProxy(rawUrl), type: "native_direct", expiresIn: ctx.expiresIn || null };
  }

  async generateProxyUrl(subPath, ctx = {}) {
    const { request, download = false, channel = "web" } = ctx;
    const fsPath = ctx?.path;
    return { url: buildFullProxyUrl(request || null, fsPath, download), type: "proxy", channel };
  }

  // ========== Git 提交流程（blobs/trees/commits/refs） ==========

  async _withCommitLock(fn) {
    this._ensureWritable();
    const prev = this._commitQueue;
    let release = null;
    this._commitQueue = new Promise((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      // 写入节流：对齐 GitHub Best Practices，降低 secondary rate limit 风险
      await this._applyWriteThrottle();
      return await fn();
    } finally {
      try {
        release?.();
      } catch {}
    }
  }

  async _getHead() {
    this._ensureWritable();
    await this._ensureRepoInitialized();
    const branch = this._branchName;
    if (!branch) {
      throw new DriverError("当前 ref 非分支（tag/commit sha），仅支持只读操作", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_READONLY_REF",
        expose: true,
      });
    }

    const ref = await this._fetchJson(this._buildGitApiUrl(`/ref/heads/${this._encodeGitRefPath(branch)}`));
    const commitSha = ref?.object?.sha || null;
    if (!commitSha) {
      throw new DriverError("无法解析 GitHub 分支 HEAD", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API_HEAD_MISSING",
        expose: false,
      });
    }

    const commit = await this._fetchJson(this._buildGitApiUrl(`/commits/${commitSha}`));
    const treeSha = commit?.tree?.sha || null;
    if (!treeSha) {
      throw new DriverError("无法解析 GitHub commit tree", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API_TREE_MISSING",
        expose: false,
      });
    }

    return { commitSha, treeSha };
  }

  async _getTree(treeSha, { recursive = false } = {}) {
    const suffix = recursive ? `?recursive=1` : "";
    const url = this._buildGitApiUrl(`/trees/${treeSha}${suffix}`);
    const data = await this._fetchJson(url);
    if (!data || !Array.isArray(data.tree)) {
      throw new DriverError("GitHub trees 响应格式异常", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API_TREE_INVALID",
        expose: false,
        details: { treeSha, recursive },
      });
    }
    // GitHub：递归 trees 可能被截断（truncated=true）。
    // 截断意味着缺少部分条目，若继续执行目录级 copy/move/remove 将导致漏拷/漏删，必须失败。
    if (data?.truncated) {
      throw new DriverError("GitHub trees 响应被截断（truncated=true），无法保证目录操作一致性", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_TREE_TRUNCATED",
        expose: true,
        details: { treeSha, recursive: !!recursive },
      });
    }
    return data;
  }

  async _getTreeRecursive(treeSha) {
    return await this._getTree(treeSha, { recursive: true });
  }

  _indexTree(tree) {
    const map = new Map();
    for (const entry of tree?.tree || []) {
      if (!entry || typeof entry.path !== "string") continue;
      map.set(entry.path, entry);
    }
    return map;
  }

  async _createBlob(bytes) {
    this._assertBlobSizeAllowed({ contentLength: null, bytesLength: bytes?.length || 0, filename: null });
    const url = this._buildGitApiUrl("/blobs");
    const payload = {
      content: Buffer.from(bytes).toString("base64"),
      encoding: "base64",
    };
    const data = await this._fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!data?.sha) {
      throw new DriverError("创建 GitHub blob 失败", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API_CREATE_BLOB_FAILED",
        expose: false,
      });
    }
    return data.sha;
  }

  /**
   * 边读边写创建 blob（避免把整个文件读入内存）
   * - GitHub 要求 JSON body，无法真正“二进制直传”，但可通过流式拼接 JSON + base64 来降低内存峰值
   */
  async _createBlobFromInput(input, { contentLength, filename } = {}) {
    // 已知大小时先做硬校验，避免无意义读取
    this._assertBlobSizeAllowed({ contentLength, bytesLength: null, filename: filename || null });

    // 小对象/编辑内容：仍走内存路径，保持简单
    if (Buffer.isBuffer(input) || input instanceof Uint8Array || input instanceof ArrayBuffer || typeof input === "string") {
      const bytes = await this._readAllBytes(input);
      this._assertBlobSizeAllowed({ contentLength: null, bytesLength: bytes.length, filename: filename || null });
      return await this._createBlob(bytes);
    }

    // Blob/File：优先 stream()（边读边写）
    if (input && typeof input.stream === "function") {
      return await this._createBlobFromByteStream(input.stream(), { contentLength, filename: filename || null });
    }

    // Web ReadableStream / Node Readable：边读边写
    if (
      input &&
      (typeof input.getReader === "function" ||
        typeof input.pipe === "function" ||
        input.readable ||
        typeof input[Symbol.asyncIterator] === "function")
    ) {
      return await this._createBlobFromByteStream(input, { contentLength, filename: filename || null });
    }

    // 兜底：最后尝试 arrayBuffer（可能会把数据读入内存）
    if (input && typeof input.arrayBuffer === "function") {
      const bytes = await this._readAllBytes(input);
      this._assertBlobSizeAllowed({ contentLength: null, bytesLength: bytes.length, filename: filename || null });
      return await this._createBlob(bytes);
    }

    throw new DriverError("不支持的上传数据类型", {
      status: ApiStatus.BAD_REQUEST,
      code: "DRIVER_ERROR.GITHUB_API_UNSUPPORTED_BODY",
      expose: true,
    });
  }

  async _createBlobFromByteStream(streamLike, { contentLength, filename } = {}) {
    const url = this._buildGitApiUrl("/blobs");

    const encoder = new TextEncoder();
    const prefix = encoder.encode(`{"content":"`);
    const suffix = encoder.encode(`","encoding":"base64"}`);

    const base64Iter = this._encodeBase64Stream(streamLike, {
      maxBytes: MAX_GITHUB_BLOB_BYTES,
      filename: filename || null,
      contentLength,
    });

    const iter = (async function* () {
      yield prefix;
      for await (const s of base64Iter) {
        yield encoder.encode(s);
      }
      yield suffix;
    })();

    const body = new ReadableStream({
      async pull(controller) {
        try {
          const { value, done } = await iter.next();
          if (done) {
            controller.close();
            return;
          }
          controller.enqueue(value);
        } catch (e) {
          controller.error(e);
        }
      },
    });

    const data = await this._fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!data?.sha) {
      throw new DriverError("创建 GitHub blob 失败", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API_CREATE_BLOB_FAILED",
        expose: false,
      });
    }
    return data.sha;
  }

  async *_iterateBytes(input) {
    // Web ReadableStream
    if (input && typeof input.getReader === "function") {
      const reader = input.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value == null) continue;
        yield Buffer.isBuffer(value) ? value : Buffer.from(value);
      }
      return;
    }

    // Node Readable / async iterator
    if (input && (typeof input.pipe === "function" || input.readable || typeof input[Symbol.asyncIterator] === "function")) {
      for await (const chunk of input) {
        if (chunk == null) continue;
        if (Buffer.isBuffer(chunk)) yield chunk;
        else if (chunk instanceof Uint8Array) yield Buffer.from(chunk);
        else if (chunk instanceof ArrayBuffer) yield Buffer.from(new Uint8Array(chunk));
        else yield Buffer.from(chunk);
      }
      return;
    }

    // 其他：兜底为一次性 Buffer
    const bytes = await this._readAllBytes(input);
    yield bytes;
  }

  async *_encodeBase64Stream(input, { maxBytes, filename, contentLength } = {}) {
    // 已知大小时先校验（减少无意义读取）
    if (typeof contentLength === "number" && Number.isFinite(contentLength) && contentLength > 0) {
      this._assertBlobSizeAllowed({ contentLength, bytesLength: null, filename: filename || null });
    }

    let carry = Buffer.alloc(0);
    let total = 0;

    for await (const chunk of this._iterateBytes(input)) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (typeof maxBytes === "number" && Number.isFinite(maxBytes) && total > maxBytes) {
        throw new DriverError(`文件过大，GitHub 单文件上限为 ${Math.floor(MAX_GITHUB_BLOB_BYTES / (1024 * 1024))}MB`, {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.GITHUB_API_FILE_TOO_LARGE",
          expose: true,
          details: { filename: filename || null, bytesLength: total, limit: MAX_GITHUB_BLOB_BYTES },
        });
      }

      const combined = carry.length ? Buffer.concat([carry, buf]) : buf;
      const usableLen = combined.length - (combined.length % 3);
      if (usableLen > 0) {
        yield combined.subarray(0, usableLen).toString("base64");
      }
      carry = combined.subarray(usableLen);
    }

    if (carry.length) {
      yield carry.toString("base64");
    }
  }

  async _createTree(baseTreeSha, treeEntries) {
    const url = this._buildGitApiUrl("/trees");
    const payload = { tree: treeEntries };
    if (baseTreeSha) payload.base_tree = baseTreeSha;
    const data = await this._fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!data?.sha) {
      throw new DriverError("创建 GitHub tree 失败", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API_CREATE_TREE_FAILED",
        expose: false,
      });
    }
    return data.sha;
  }

  async _createCommit(message, treeSha, parentSha) {
    const url = this._buildGitApiUrl("/commits");
    const payload = {
      message,
      tree: treeSha,
      parents: parentSha ? [parentSha] : [],
    };

    const now = new Date().toISOString();
    if (this.committerName && this.committerEmail) {
      payload.committer = { name: this.committerName, email: this.committerEmail, date: now };
    }
    if (this.authorName && this.authorEmail) {
      payload.author = { name: this.authorName, email: this.authorEmail, date: now };
    }

    const data = await this._fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!data?.sha) {
      throw new DriverError("创建 GitHub commit 失败", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API_CREATE_COMMIT_FAILED",
        expose: false,
      });
    }
    return data.sha;
  }

  async _updateRef(commitSha) {
    this._ensureWritable();
    const branch = this._branchName;
    if (!branch) {
      throw new DriverError("当前 ref 非分支（tag/commit sha），仅支持只读操作", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_READONLY_REF",
        expose: true,
      });
    }

    const url = this._buildGitApiUrl(`/refs/heads/${this._encodeGitRefPath(branch)}`);
    const payload = { sha: commitSha, force: false };
    await this._fetchJson(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async _createBranchRef(commitSha) {
    this._ensureWritable();
    const branch = this._branchName;
    if (!branch) {
      throw new DriverError("当前 ref 非分支（tag/commit sha），仅支持只读操作", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_READONLY_REF",
        expose: true,
      });
    }
    const url = this._buildGitApiUrl("/refs");
    const payload = { ref: `refs/heads/${branch}`, sha: commitSha };
    await this._fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async _ensureRepoInitialized() {
    if (!this._repoIsEmpty) return;
    const branch = this._branchName;
    if (!branch) return;

    // 空仓库：Git Database API（/git/blobs 等）在 GitHub 上可能直接返回 409（Git Repository is empty）
    // 因此初始化提交使用 Contents API 创建首个文件来引导生成首个 commit + 分支引用。
    // 空仓库初始化应尽量“不污染用户默认上传目录选择”，因此总是在仓库根目录写入 .gitkeep
    const rel = GITKEEP_FILENAME;
    const repoPath = `/${rel}`;
    const url = this._buildContentsApiUrl(repoPath);
    const payload = {
      message: `init: ${rel}`,
      // 避免空字符串在部分实现中被视为无效内容，写入一个换行作为 .gitkeep 内容
      content: Buffer.from("\n", "utf8").toString("base64"),
      branch,
    };
    const now = new Date().toISOString();
    if (this.committerName && this.committerEmail) {
      payload.committer = { name: this.committerName, email: this.committerEmail, date: now };
    }
    if (this.authorName && this.authorEmail) {
      payload.author = { name: this.authorName, email: this.authorEmail, date: now };
    }
    await this._fetchJson(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    this._repoIsEmpty = false;
    this._modifiedCache.clear();
  }

  async _isRepoEmpty() {
    const url = this._buildCommitsApiUrl({ perPage: 1 });
    const resp = await fetch(url, { method: "GET", headers: this._buildHeaders() });
    // GitHub：空仓库常见返回 409（Git Repository is empty）
    if (resp.status === 409) return true;
    if (!resp.ok) return false;
    try {
      const data = await resp.json();
      return Array.isArray(data) && data.length === 0;
    } catch {
      return false;
    }
  }

  async _commitTreeChanges(changes, message) {
    const head = await this._getHead();

    const treeEntries = [];
    for (const change of changes || []) {
      if (!change) continue;
      if (change.kind === "upsert") {
        const sha = change.sha || (await this._createBlob(change.bytes));
        treeEntries.push({ path: change.path, mode: DEFAULT_FILE_MODE, type: "blob", sha });
      } else if (change.kind === "delete") {
        treeEntries.push({ path: change.path, mode: DEFAULT_FILE_MODE, type: "blob", sha: null });
      }
    }

    if (treeEntries.length === 0) return { success: true, skipped: true };

    const newTreeSha = await this._createTree(head.treeSha, treeEntries);
    const commitSha = await this._createCommit(message, newTreeSha, head.commitSha);
    await this._updateRef(commitSha);
    // 写入后：清空 modified cache，避免目录/文件时间滞后
    this._modifiedCache.clear();
    return { success: true, commitSha };
  }

  async _pathExists(relPath) {
    const head = await this._getHead();
    const tree = await this._getTreeRecursive(head.treeSha);
    const index = this._indexTree(tree);
    return index.has(relPath);
  }

  async _planMoveOrCopy({ fromRel, toRel, mode }) {
    const head = await this._getHead();
    const tree = await this._getTreeRecursive(head.treeSha);
    const index = this._indexTree(tree);

    const direct = index.get(fromRel);
    if (direct && direct.type === "commit") {
      throw new DriverError("不支持复制/移动 Git submodule（子模块）", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_SUBMODULE_UNSUPPORTED",
        expose: true,
        details: { fromRel, toRel, mode },
      });
    }
    if (direct && direct.type === "blob") {
      return {
        head,
        actions: [
          ...(mode === "move" ? [{ kind: "delete", path: fromRel }] : []),
          { kind: "reuse", from: fromRel, to: toRel, sha: direct.sha },
        ],
      };
    }

    const prefix = `${fromRel}/`;
    const blobs = (tree.tree || []).filter((e) => e?.type === "blob" && typeof e.path === "string" && e.path.startsWith(prefix));
    const commits = (tree.tree || []).filter((e) => e?.type === "commit" && typeof e.path === "string" && e.path.startsWith(prefix));
    if (commits.length > 0) {
      throw new DriverError("不支持复制/移动包含 Git submodule（子模块）的目录", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_SUBMODULE_UNSUPPORTED",
        expose: true,
        details: { fromRel, toRel, mode, count: commits.length },
      });
    }
    if (blobs.length === 0) {
      throw new NotFoundError("路径不存在");
    }

    const actions = [];
    for (const entry of blobs) {
      const rest = entry.path.slice(prefix.length);
      const target = `${toRel}/${rest}`;
      if (mode === "move") {
        actions.push({ kind: "delete", path: entry.path });
      }
      actions.push({ kind: "reuse", from: entry.path, to: target, sha: entry.sha });
    }

    return { head, actions };
  }

  async _commitPlannedChanges(planned, message) {
    const head = planned?.head;
    const actions = planned?.actions || [];
    if (!head) {
      throw new DriverError("内部错误：缺少 head", { status: ApiStatus.INTERNAL_ERROR, expose: false });
    }

    const treeEntries = [];
    for (const action of actions) {
      if (action.kind === "delete") {
        treeEntries.push({ path: action.path, mode: DEFAULT_FILE_MODE, type: "blob", sha: null });
      } else if (action.kind === "reuse") {
        treeEntries.push({ path: action.to, mode: DEFAULT_FILE_MODE, type: "blob", sha: action.sha });
      }
    }

    if (treeEntries.length === 0) return { success: true, skipped: true };

    const newTreeSha = await this._createTree(head.treeSha, treeEntries);
    const commitSha = await this._createCommit(message, newTreeSha, head.commitSha);
    await this._updateRef(commitSha);
    this._modifiedCache.clear();
    return { success: true, commitSha };
  }

  _buildRepoApiUrl() {
    return `${this.apiBase.replace(/\/+$/, "")}/repos/${this.owner}/${this.repo}`;
  }

  _buildCommitsApiUrl({ path, sha, perPage = 1 } = {}) {
    const base = `${this.apiBase.replace(/\/+$/, "")}/repos/${this.owner}/${this.repo}/commits`;
    const url = new URL(base);
    if (path) url.searchParams.set("path", path);
    if (sha) url.searchParams.set("sha", sha);
    url.searchParams.set("per_page", String(perPage));
    return url.toString();
  }

  _buildRepoCommitApiUrl(ref) {
    const base = `${this.apiBase.replace(/\/+$/, "")}/repos/${this.owner}/${this.repo}/commits`;
    const encoded = encodeURIComponent(String(ref || ""));
    return `${base}/${encoded}`;
  }

  async _sleep(ms) {
    const delay = Number(ms) || 0;
    if (delay <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  async _applyWriteThrottle() {
    const ms = Number(this.writeThrottleMs) || 0;
    if (ms <= 0) return;
    const now = Date.now();
    const elapsed = now - (Number(this._lastWriteAtMs) || 0);
    if (elapsed < ms) {
      await this._sleep(ms - elapsed);
    }
    this._lastWriteAtMs = Date.now();
  }

  _setModifiedCache(key, value) {
    this._modifiedCache.set(key, value);
    if (this._modifiedCache.size <= MODIFIED_CACHE_LIMIT) return;
    const firstKey = this._modifiedCache.keys().next().value;
    if (firstKey) {
      this._modifiedCache.delete(firstKey);
    }
  }

  async _getLastModifiedIso(repoRelPath) {
    const rel = String(repoRelPath || "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!rel) return null;

    const cacheKey = `${this._resolvedRef || ""}|${rel}`;
    const cached = this._modifiedCache.get(cacheKey) || null;
    if (cached) return cached;

    try {
      const url = this._buildCommitsApiUrl({ path: rel, sha: this._resolvedRef || undefined, perPage: 1 });
      const data = await this._fetchJson(url);
      const first = Array.isArray(data) ? data[0] : null;
      const iso = first?.commit?.committer?.date || first?.commit?.author?.date || null;
      const finalIso = iso ? String(iso) : null;
      if (finalIso) {
        this._setModifiedCache(cacheKey, finalIso);
      }
      return finalIso;
    } catch {
      // best-effort：时间获取失败不影响目录展示
      return null;
    }
  }

  _getTreeShaCache(key) {
    if (!key) return null;
    return this._treeShaCache.get(key) || null;
  }

  _setTreeShaCache(key, value) {
    if (!key) return;
    if (value == null) return;
    this._treeShaCache.set(key, String(value));
    // 简单 FIFO 限制，避免无界增长
    if (this._treeShaCache.size <= 500) return;
    const firstKey = this._treeShaCache.keys().next().value;
    if (firstKey) this._treeShaCache.delete(firstKey);
  }

  async _getRootTreeShaForResolvedRef() {
    const cacheKey = `${this._resolvedRef || ""}|/`;
    const cached = this._getTreeShaCache(cacheKey);
    if (cached) return cached;

    // 使用 Repo Commits API：ref 可为 branch/tag/sha，避免额外 ref 解析
    const url = this._buildRepoCommitApiUrl(this._resolvedRef);
    const data = await this._fetchJson(url);
    const sha = data?.commit?.tree?.sha || data?.tree?.sha || null;
    if (!sha) {
      throw new DriverError("无法解析 GitHub 仓库根 tree sha", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API_TREE_MISSING",
        expose: false,
        details: { url },
      });
    }
    this._setTreeShaCache(cacheKey, sha);
    return sha;
  }

  async _resolveTreeShaByRepoPath(repoPath) {
    const normalized = String(repoPath || "/");
    const rel = normalized.replace(/^\/+/, "").replace(/\/+$/, "");
    const cacheKey = `${this._resolvedRef || ""}|/${rel}`;
    const cached = this._getTreeShaCache(cacheKey);
    if (cached) return cached;

    let currentSha = await this._getRootTreeShaForResolvedRef();
    if (!rel) {
      this._setTreeShaCache(cacheKey, currentSha);
      return currentSha;
    }

    const segments = rel.split("/").filter(Boolean);
    for (const seg of segments) {
      const tree = await this._getTree(currentSha, { recursive: false });
      const entry = Array.isArray(tree?.tree) ? tree.tree.find((t) => t && t.path === seg) : null;
      if (!entry || !entry.sha) {
        throw new NotFoundError("资源不存在", { repoPath: normalized });
      }
      if (entry.type === "commit") {
        throw new DriverError("不支持访问 Git submodule（子模块）", {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.GITHUB_API_SUBMODULE_UNSUPPORTED",
          expose: true,
          details: { repoPath: normalized },
        });
      }
      if (entry.type !== "tree") {
        throw new ValidationError("目标不是目录");
      }
      currentSha = entry.sha;
    }

    this._setTreeShaCache(cacheKey, currentSha);
    return currentSha;
  }

  _joinRepoRelPath(baseRel, name) {
    const b = String(baseRel || "").replace(/^\/+/, "").replace(/\/+$/, "");
    const n = String(name || "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!b) return n;
    if (!n) return b;
    return `${b}/${n}`;
  }

  _buildContentsApiUrl(repoPath, { ref } = {}) {
    const base = `${this.apiBase.replace(/\/+$/, "")}/repos/${this.owner}/${this.repo}/contents`;
    const encoded = this._encodePath(repoPath);
    // GitHub Contents API 端点为 /contents/{path}
    // 根目录需要显式以 `/contents/` 访问，避免 `/contents` 在部分场景下返回 404
    const url = new URL(encoded ? `${base}${encoded}` : `${base}/`);
    if (ref) url.searchParams.set("ref", ref);
    return url.toString();
  }

  _buildGitApiUrl(pathname) {
    const base = `${this.apiBase.replace(/\/+$/, "")}/repos/${this.owner}/${this.repo}/git`;
    return `${base}${pathname.startsWith("/") ? "" : "/"}${pathname}`;
  }

  _buildHeaders(extra = {}, targetUrl = null) {
    const browserHeaders = this._masqueradeClient.buildHeaders({}, targetUrl);
    const headers = {
      ...browserHeaders,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...extra,
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  async _fetchJson(url, init = {}) {
    const method = String(init?.method || "GET").toUpperCase();
    const maxAttempts = this.retryMaxAttempts || 1;

    // 写请求不做“网络错误重试/5xx重试”，避免重复提交导致多 commit；仅对“明确未执行”的限流响应做等待重试
    const isSafeToRetryNetwork = method === "GET";
    const isSafeToRetry5xx = method === "GET";

    const readRetryHeaders = (resp) => {
      const retryAfterRaw = resp.headers?.get?.("retry-after") || resp.headers?.get?.("Retry-After") || null;
      const resetRaw = resp.headers?.get?.("x-ratelimit-reset") || resp.headers?.get?.("X-RateLimit-Reset") || null;
      const remainingRaw = resp.headers?.get?.("x-ratelimit-remaining") || resp.headers?.get?.("X-RateLimit-Remaining") || null;
      const retryAfter = retryAfterRaw != null && String(retryAfterRaw).trim() !== "" ? Number(retryAfterRaw) : null;
      const reset = resetRaw != null && String(resetRaw).trim() !== "" ? Number(resetRaw) : null;
      const remaining = remainingRaw != null && String(remainingRaw).trim() !== "" ? Number(remainingRaw) : null;
      return { retryAfter, reset, remaining };
    };

    const computeDelayMs = ({ attempt, retryAfterSeconds, resetEpochSeconds }) => {
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
        return Math.max(0, retryAfterSeconds * 1000);
      }
      if (Number.isFinite(resetEpochSeconds) && resetEpochSeconds > 0) {
        const until = resetEpochSeconds * 1000 - Date.now();
        // GitHub 可能提前/延后，给一个小缓冲
        return Math.max(0, until + 250);
      }
      const base = Number(this.retryBaseDelayMs) || 0;
      const max = Number(this.retryMaxDelayMs) || 0;
      const exp = base > 0 ? base * Math.pow(2, Math.max(0, attempt - 1)) : 0;
      const capped = max > 0 ? Math.min(exp, max) : exp;
      return Math.max(0, capped);
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let resp = null;
      try {
        resp = await fetch(url, { ...init, headers: this._buildHeaders(init.headers || {}) });
      } catch (e) {
        if (attempt < maxAttempts && isSafeToRetryNetwork) {
          const delay = computeDelayMs({ attempt });
          await this._sleep(delay);
          continue;
        }
        throw new DriverError("GitHub API 请求失败: 网络错误", {
          status: ApiStatus.BAD_GATEWAY,
          code: "DRIVER_ERROR.GITHUB_API_REQUEST_FAILED",
          expose: false,
          details: { url, cause: e?.message || String(e) },
        });
      }

      if (resp.status === 404) throw new NotFoundError("资源不存在", { url });

      if (resp.ok) {
        try {
          return await resp.json();
        } catch {
          // 极少数场景下上游返回空 body
          return null;
        }
      }

      const { retryAfter, reset, remaining } = readRetryHeaders(resp);
      const rateLimited = resp.status === 429 || (resp.status === 403 && (retryAfter != null || remaining === 0));
      const retryable5xx = resp.status === 502 || resp.status === 503 || resp.status === 504;
      const canRetry =
        attempt < maxAttempts &&
        (rateLimited || (retryable5xx && isSafeToRetry5xx));

      if (canRetry) {
        const delay = computeDelayMs({ attempt, retryAfterSeconds: retryAfter, resetEpochSeconds: reset });
        await this._sleep(delay);
        continue;
      }

      let text = null;
      try {
        text = await resp.text();
      } catch {
        text = null;
      }

      throw new DriverError(`GitHub API 请求失败: HTTP ${resp.status}`, {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API_REQUEST_FAILED",
        expose: false,
        details: {
          url,
          status: resp.status,
          body: text,
          retryAfter,
          rateLimitRemaining: remaining,
          rateLimitReset: reset,
        },
      });
    }

    throw new DriverError("GitHub API 请求失败: 超出重试次数", {
      status: ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.GITHUB_API_REQUEST_FAILED",
      expose: false,
      details: { url, method, maxAttempts },
    });
  }

  async _getContents(repoPath, { asObjectList = true, allowArray = false } = {}) {
    const url = this._buildContentsApiUrl(repoPath, { ref: this._resolvedRef });
    const accept = asObjectList ? "application/vnd.github.object+json" : "application/vnd.github+json";
    const data = await this._fetchJson(url, { headers: { Accept: accept } });
    // object+json 在不同文档版本中可能返回两种形态：
    // 1) 目录：直接返回数组
    // 2) 目录：返回 { entries: [...] }
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.entries)) return data.entries;
    if (allowArray) return data;
    if (data && data.type && data.type !== "dir") {
      throw new ValidationError("目标不是目录");
    }
    return data;
  }

  async _getDirectoryListing(repoPath) {
    const url = this._buildContentsApiUrl(repoPath, { ref: this._resolvedRef });
    const data = await this._fetchJson(url, { headers: { Accept: "application/vnd.github.object+json" } });

    // object+json 在不同文档版本中可能返回两种形态：
    // 1) 目录：直接返回数组（无目录 sha）
    // 2) 目录：返回 { sha, entries: [...] }
    if (Array.isArray(data)) {
      return { sha: null, entries: data };
    }

    if (data && Array.isArray(data.entries)) {
      return { sha: data.sha || null, entries: data.entries };
    }

    if (data && data.type && data.type !== "dir") {
      throw new ValidationError("目标不是目录");
    }

    return { sha: data?.sha || null, entries: [] };
  }

  _parseRefInput(input) {
    const raw = String(input || "").trim();
    if (!raw) return { kind: "empty", value: null };
    if (raw.startsWith("refs/heads/")) return { kind: "branch", value: raw.slice("refs/heads/".length) };
    if (raw.startsWith("heads/")) return { kind: "branch", value: raw.slice("heads/".length) };
    if (raw.startsWith("refs/tags/")) return { kind: "tag", value: raw.slice("refs/tags/".length) };
    if (raw.startsWith("tags/")) return { kind: "tag", value: raw.slice("tags/".length) };
    if (raw.startsWith("refs/")) return { kind: "unsupported", value: raw };
    return { kind: "any", value: raw };
  }

  _encodeGitRefPath(refName) {
    return String(refName || "")
      .split("/")
      .filter((seg) => seg.length > 0)
      .map((seg) => encodeURIComponent(seg))
      .join("/");
  }

  async _branchExists(branchName) {
    try {
      await this._fetchJson(this._buildGitApiUrl(`/ref/heads/${this._encodeGitRefPath(branchName)}`));
      return true;
    } catch (e) {
      if (e instanceof NotFoundError) return false;
      // 空仓库：GitHub 对 refs/heads/* 可能返回 409 "Git Repository is empty."
      // 视为“分支尚不存在”，后续由初始化逻辑创建首个 commit + refs
      if (e instanceof DriverError && e?.details?.status === 409) return false;
      throw e;
    }
  }

  _ensureWritable() {
    this._ensureInitialized();
    if (!this._isOnBranch) {
      throw new DriverError("当前 ref 非分支（tag/commit sha），仅支持只读操作", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_API_READONLY_REF",
        expose: true,
      });
    }
  }

  _applyProxy(url) {
    if (!this.ghProxy || typeof this.ghProxy !== "string") return url;
    const trimmed = this.ghProxy.trim().replace(/\/+$/, "");
    if (!trimmed) return url;
    return url.replace(/^https:\/\/raw\.githubusercontent\.com/, trimmed);
  }

  _encodePath(repoPath) {
    if (!repoPath || repoPath === "/") return "";
    const normalized = String(repoPath).replace(/\/+$/, "").replace(/^\/+/, "");
    if (!normalized) return "";
    const encoded = normalized
      .split("/")
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    return `/${encoded}`;
  }

  _encodeRawPath(relPath) {
    if (!relPath) return "";
    return relPath
      .split("/")
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join("/");
  }

  _normalizeSubPath(subPath) {
    const raw = subPath == null ? "/" : String(subPath);
    let p = raw.trim();
    if (!p) p = "/";
    if (!p.startsWith("/")) p = `/${p}`;
    // 兼容 Windows 反斜杠路径，并合并重复的 /
    p = p.replace(/\\+/g, "/");
    p = p.replace(/\/+/g, "/");
    if (p.length > 1) p = p.replace(/\/+$/, "");
    if (p.includes("..")) {
      throw new DriverError("路径不允许包含 .. 段", { status: ApiStatus.BAD_REQUEST, expose: true });
    }
    return p;
  }

  _normalizeFolderPrefix(folder) {
    if (!folder) return "";
    let f = String(folder).trim().replace(/\\+/g, "/");
    f = f.replace(/\/+/g, "/");
    f = f.replace(/^\/+/, "").replace(/\/+$/, "");
    return f;
  }

  _toRepoPath(subPath) {
    const sp = this._normalizeSubPath(subPath);
    // 约定：storage_config.default_folder 仅用于“文件上传页/分享上传”的默认目录，不影响挂载浏览根目录。
    // 因此 GitHub FS 驱动的 repoPath 映射不应用 default_folder 前缀。
    return sp;
  }

  _toRepoRelPath(subPath) {
    const repoPath = this._toRepoPath(subPath);
    return repoPath.replace(/^\/+/, "").replace(/\/+$/, "");
  }

  _buildMountPath(mount, subPath) {
    const mountPath = mount?.mount_path || "";
    const sp = this._normalizeSubPath(subPath);
    if (!mountPath) return sp;
    if (sp === "/" || sp === "") return mountPath;
    return `${mountPath.replace(/\/+$/, "")}${sp}`;
  }

  _joinMountPath(baseFsPath, name, isDirectory) {
    const base = baseFsPath.endsWith("/") ? baseFsPath.replace(/\/+$/, "") : baseFsPath;
    const next = `${base}/${name}`;
    return isDirectory ? `${next}/` : next;
  }

  _basename(fsPath, isDirectory) {
    let p = String(fsPath || "");
    if (isDirectory) p = p.replace(/\/+$/, "");
    const segs = p.split("/").filter(Boolean);
    return segs.length ? segs[segs.length - 1] : "";
  }

  _resolveTargetSubPath(subPath, fsPath, filename) {
    const sp = this._normalizeSubPath(subPath);
    const name = filename || null;

    // 后端 /api/fs/upload（流式与表单）默认将 path 作为“目标目录”，文件名通过 filename 传入
    // 因此只要带 filename，就一律按“目录 + 文件名”语义拼接
    if (name) {
      const base = sp === "/" ? "" : sp.replace(/\/+$/, "");
      return `${base}/${name}`.replace(/\/+/g, "/");
    }

    // 无 filename：认为 subPath 已是完整文件路径
    return sp;
  }

  async _readAllBytes(input) {
    if (input == null) {
      return Buffer.from("", "utf8");
    }

    if (Buffer.isBuffer(input)) {
      return input;
    }
    if (input instanceof Uint8Array) {
      return Buffer.from(input);
    }
    if (input instanceof ArrayBuffer) {
      return Buffer.from(new Uint8Array(input));
    }

    if (typeof input === "string") {
      return Buffer.from(input, "utf8");
    }

    // Blob/File：浏览器/Worker/Node18+ fetch 的 File/Blob 都支持 arrayBuffer()
    if (typeof input.arrayBuffer === "function") {
      const ab = await input.arrayBuffer();
      return Buffer.from(new Uint8Array(ab));
    }

    // Web ReadableStream
    if (typeof input.getReader === "function") {
      const reader = input.getReader();
      const chunks = [];
      let total = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.from(value);
        chunks.push(buf);
        total += buf.length;
      }
      return Buffer.concat(chunks, total);
    }

    // Node.js Readable（async iterator）
    if (typeof input.pipe === "function" || input.readable) {
      const chunks = [];
      let total = 0;
      for await (const chunk of input) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(buf);
        total += buf.length;
      }
      return Buffer.concat(chunks, total);
    }

    throw new DriverError("不支持的上传数据类型", {
      status: ApiStatus.BAD_REQUEST,
      code: "DRIVER_ERROR.GITHUB_API_UNSUPPORTED_BODY",
      expose: true,
    });
  }

  _resolveMountForPath(fsPath, mount, findMountPointByPath) {
    if (!mount) return null;

    // 注意：此处不可直接调用后端的 findMountPointByPath(db, path, ...)。
    // batchRemoveItems 的 paths 是“挂载视图路径”，因此只需基于 mount.mount_path 做纯字符串解析即可（避免签名不一致导致误判跨挂载）。
    const normalizedFsPath = this._normalizeFullFsPath(fsPath);
    const normalizedMountPath = this._normalizeMountPath(mount?.mount_path || "");
    if (!normalizedMountPath) {
      return { mount, subPath: normalizedFsPath || "/" };
    }

    if (normalizedFsPath === normalizedMountPath || normalizedFsPath === `${normalizedMountPath}/`) {
      return { mount, subPath: "/" };
    }
    if (normalizedFsPath.startsWith(`${normalizedMountPath}/`)) {
      const subPath = normalizedFsPath.slice(normalizedMountPath.length) || "/";
      return { mount, subPath };
    }

    return null;
  }

  _normalizeMountPath(mountPath) {
    let p = String(mountPath || "").trim();
    if (!p) return "";
    p = p.replace(/\\+/g, "/");
    p = p.replace(/\/+/g, "/");
    if (!p.startsWith("/")) p = `/${p}`;
    if (p.length > 1) p = p.replace(/\/+$/, "");
    return p;
  }

  _normalizeFullFsPath(fsPath) {
    let p = String(fsPath || "").trim();
    if (!p) return "/";
    p = p.replace(/\\+/g, "/");
    p = p.replace(/\/+/g, "/");
    if (!p.startsWith("/")) p = `/${p}`;
    return p;
  }

  _assertBlobSizeAllowed({ contentLength, bytesLength, filename }) {
    const len = Number.isFinite(contentLength) ? Number(contentLength) : null;
    if (len != null && len > MAX_GITHUB_BLOB_BYTES) {
      throw new DriverError(
        `文件过大：GitHub 单文件最大 100MB（当前约 ${(len / 1024 / 1024).toFixed(2)}MB）。请改用更小文件、Git LFS，或更换存储类型。`,
        {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.GITHUB_API_FILE_TOO_LARGE",
          expose: true,
          details: { filename: filename || undefined, contentLength: len, maxBytes: MAX_GITHUB_BLOB_BYTES },
        },
      );
    }

    const actual = Number.isFinite(bytesLength) ? Number(bytesLength) : null;
    if (actual != null && actual > MAX_GITHUB_BLOB_BYTES) {
      throw new DriverError(
        `文件过大：GitHub 单文件最大 100MB（当前约 ${(actual / 1024 / 1024).toFixed(2)}MB）。请改用更小文件、Git LFS，或更换存储类型。`,
        {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.GITHUB_API_FILE_TOO_LARGE",
          expose: true,
          details: { filename: filename || undefined, contentLength: actual, maxBytes: MAX_GITHUB_BLOB_BYTES },
        },
      );
    }
  }
}
