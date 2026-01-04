/**
 * GithubReleasesStorageDriver
 *
 * 设计目标：
 * - 将 GitHub Releases 映射为只读的文件系统视图；
 * - 支持多仓库挂载（repo_structure），按挂载路径划分“虚拟目录”；
 * - 提供 READER 能力（listDirectory/getFileInfo/downloadFile/exists/stat）；
 * - 提供可选的 DIRECT_LINK 能力（generateDownloadUrl）和 PROXY 能力（generateProxyUrl），方便直链与本地代理访问。
 *
 * 非目标（当前不实现）：
 * - 不支持上传 / 删除 / 修改 Releases 或 Release 资产（不声明 WRITER/MULTIPART/ATOMIC 能力）；
 * - 不做复杂缓存策略，优先保证语义清晰与实现简单，如有需要后续可按需加缓存。
 */

import { BaseDriver } from "../../interfaces/capabilities/BaseDriver.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { ApiStatus } from "../../../constants/index.js";
import { DriverError, NotFoundError, AppError } from "../../../http/errors.js";
import { buildFileInfo } from "../../utils/FileInfoBuilder.js";
import { createHttpStreamDescriptor, createWebStreamDescriptor } from "../../streaming/StreamDescriptorUtils.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";
import { getMimeTypeFromFilename } from "../../../utils/fileUtils.js";
import { MasqueradeClient } from "../../../utils/httpMasquerade.js";
import { decryptIfNeeded } from "../../../utils/crypto.js";

const RELEASE_NOTES_FILENAME = "RELEASE_NOTES.md";

/**
 * @typedef {Object} GithubRepoMapping
 * @property {string} point           挂载内路径前缀（以 / 开头）
 * @property {string} owner           GitHub 仓库 owner
 * @property {string} repo            GitHub 仓库名
 */

export class GithubReleasesStorageDriver extends BaseDriver {
  /**
   * @param {Object} config  存储配置对象
   * @param {string} encryptionSecret 加密密钥（本驱动当前不使用，仅为接口一致）
   */
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "GITHUB_RELEASES";
    this.encryptionSecret = encryptionSecret;

    // 只读 + 直链 + 代理能力
    this.capabilities = [
      CAPABILITIES.READER,
      CAPABILITIES.DIRECT_LINK,
      CAPABILITIES.PROXY,
    ];

    /** @type {GithubRepoMapping[]} */
    this.repos = [];
    this.showReadme = this._toBool(config?.show_readme, false);
    this.showAllVersion = this._toBool(config?.show_all_version, false);
    this.showSourceCode = this._toBool(config?.show_source_code, false);
    this.showReleaseNotes = this._toBool(config?.show_release_notes, false);
    this.token = config?.token || null;
    this.ghProxy = config?.gh_proxy || null;
    this.perPage = Number.isFinite(config?.per_page) && config.per_page > 0 ? config.per_page : 20;

    /**
     * 内存缓存（按 repoKey）
     * @type {Map<string, {
     *   latest?: any,
     *   latestFetchedAt?: number,
     *   releases?: any[],
     *   releasesFetchedAt?: number,
     *   readme?: any,
     *   readmeFetchedAt?: number,
     *   license?: any,
     *   licenseFetchedAt?: number
     * }>}
     */
    this._releaseCache = new Map();
    // 仓库元信息缓存（用于判定 private/public，避免频繁请求 /repos/{owner}/{repo}）
    // key: "owner/repo" -> { meta: any|null, fetchedAt: number }
    this._repoMetaCache = new Map();

    this.apiBase = "https://api.github.com";

    // 浏览器伪装客户端
    this._masqueradeClient = new MasqueradeClient({
      deviceCategory: "desktop",
      rotateIP: false,
      rotateUA: false,
    });
  }

  /**
   * 获取 UTF-8 字节长度（用于虚拟文本文件 size）
   * @param {string} text
   * @returns {number}
   */
  _getUtf8ByteLength(text) {
    if (typeof Buffer !== "undefined" && typeof Buffer.byteLength === "function") {
      return Buffer.byteLength(text, "utf8");
    }
    // Worker / Web runtime
    return new TextEncoder().encode(text).length;
  }

  /**
   * 初始化驱动：
   * - 解析 repo_structure 为内部的 repos 映射表；
   */
  async initialize() {
    // token 可能以 encrypted:* 存在（由存储配置 CRUD 统一加密写入）
    const decryptedToken = await decryptIfNeeded(this.token, this.encryptionSecret);
    this.token = typeof decryptedToken === "string" ? decryptedToken.trim() : decryptedToken;

    this._parseRepoStructure();
    this.initialized = true;
  }

  /**
   * 容错布尔解析：兼容 0/1、"0"/"1"、"true"/"false" 等历史/跨端写入形态
   * @param {any} value
   * @param {boolean} defaultValue
   * @returns {boolean}
   */
  _toBool(value, defaultValue = false) {
    if (value === true) return true;
    if (value === false) return false;
    if (value === 1 || value === "1") return true;
    if (value === 0 || value === "0") return false;
    if (typeof value === "string") {
      const lowered = value.trim().toLowerCase();
      if (lowered === "true" || lowered === "yes" || lowered === "on") return true;
      if (lowered === "false" || lowered === "no" || lowered === "off") return false;
    }
    return defaultValue;
  }

  /**
   * GitHub API 拉取结果的内存缓存 TTL
   * - refresh=true 时强制绕过缓存
   * - 默认 60s；如 mount.cache_ttl 有效则使用 mount.cache_ttl
   * @param {{ mount?: any }} options
   * @returns {number} 毫秒
   */
  _getCacheTtlMs(options = {}) {
    const raw = options?.mount?.cache_ttl;
    const seconds = Number(raw);
    const normalizedSeconds = Number.isFinite(seconds) ? seconds : 60;
    if (normalizedSeconds <= 0) {
      return 0;
    }
    // 上限 1h，避免超长缓存导致“刷新不更新”的错觉
    return Math.min(normalizedSeconds, 3600) * 1000;
  }

  /**
   * 解析 repo_structure 配置为内部结构
   * 配置格式（每行一条，忽略空行与以 # 开头的行）：
   *   owner/repo                    （推荐，目录名自动使用 repo）
   *   alias:owner/repo              （自定义目录名 alias）
   *   https://github.com/owner/repo （可带 /releases 等后缀）
   *
   * 示例：
   *   ling-drag0n/CloudPaste
   *   cloudpaste:ling-drag0n/CloudPaste
   *   https://github.com/ling-drag0n/CloudPaste
   */
  _parseRepoStructure() {
    const raw = this.config?.repo_structure;
    if (!raw || typeof raw !== "string") {
      throw new DriverError("GitHub Releases 配置缺少 repo_structure 字段", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_RELEASES_INVALID_CONFIG",
        expose: true,
      });
    }

    /** @type {GithubRepoMapping[]} */
    const mappings = [];

    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    if (lines.length === 0) {
      throw new DriverError("GitHub Releases 配置 repo_structure 不能为空", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.GITHUB_RELEASES_INVALID_CONFIG",
        expose: true,
      });
    }

    /** @type {Array<{ owner: string, repo: string, alias: string|null, raw: string }>} */
    const parsed = [];

    for (const line of lines) {
      let displayNamePart = null;
      let repoPart = line;

      // 支持三种显式格式：
      // 1）owner/repo（推荐）
      // 2）alias:owner/repo
      // 3）https://github.com/owner/repo（可带 /releases 等后缀）
      // URL 形式（https://github.com/...）不参与别名分割，避免将 "https:" 误判为别名
      if (!/^https?:\/\/github\.com\//i.test(line)) {
        const idx = line.indexOf(":");
        if (idx >= 0) {
          displayNamePart = line.slice(0, idx).trim();
          repoPart = line.slice(idx + 1).trim();
          if (!repoPart) {
            throw new DriverError(
              `GitHub Releases 配置行格式无效，应为 owner/repo、别名:owner/repo 或 https://github.com/owner/repo，当前为: ${line}`,
              {
                status: ApiStatus.BAD_REQUEST,
                code: "DRIVER_ERROR.GITHUB_RELEASES_INVALID_CONFIG",
                expose: true,
              },
            );
          }
        }
      }

      let normalized = repoPart;
      if (/^https?:\/\/github\.com\//i.test(repoPart)) {
        normalized = repoPart.replace(/^https?:\/\/github\.com\//i, "");
      }

      // 为了规范输入，不允许以 / 开头的 owner/repo（例如 /owner/repo）
      if (normalized.startsWith("/")) {
        throw new DriverError(
          `GitHub Releases 配置行格式无效，不支持以 / 开头的 owner/repo，请使用 owner/repo、别名:owner/repo 或完整仓库 URL，当前为: ${line}`,
          {
            status: ApiStatus.BAD_REQUEST,
            code: "DRIVER_ERROR.GITHUB_RELEASES_INVALID_CONFIG",
            expose: true,
          },
        );
      }

      const segments = normalized.split("/").filter((seg) => seg.length > 0);
      if (segments.length < 2) {
        throw new DriverError(`GitHub Releases 配置行缺少 owner/repo 信息: ${line}`, {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.GITHUB_RELEASES_INVALID_CONFIG",
          expose: true,
        });
      }

      const owner = segments[0];
      const repo = segments[1];

      const alias = displayNamePart && displayNamePart.length > 0 ? displayNamePart : null;
      parsed.push({ owner, repo, alias, raw: line });
    }


    // - 单仓库：允许使用 `owner/repo`（无别名）直接挂载到仓库根目录（point = "/"），不会额外产生一层 repo 目录；
    // - 多仓库：必须为每行配置别名（alias:owner/repo），避免多个仓库在 "/" 下相互覆盖。
    if (parsed.length > 1) {
      const noAlias = parsed.filter((item) => !item.alias);
      if (noAlias.length > 0) {
        const examples = noAlias.map((item) => `${item.owner}/${item.repo}`).join(", ");
        throw new DriverError(
          `GitHub Releases 多仓库配置必须为每行指定别名（alias:owner/repo），当前存在无别名项: ${examples}`,
          {
            status: ApiStatus.BAD_REQUEST,
            code: "DRIVER_ERROR.GITHUB_RELEASES_INVALID_CONFIG",
            expose: true,
          },
        );
      }
    }

    for (const item of parsed) {
      let point = "/";
      if (item.alias) {
        point = item.alias;
        if (!point.startsWith("/")) {
          point = "/" + point;
        }
        if (point.length > 1 && point.endsWith("/")) {
          point = point.replace(/\/+$/, "");
        }
      }

      mappings.push({ point, owner: item.owner, repo: item.repo });
    }

    this.repos = mappings;
  }

  /**
   * 规范化子路径：保证以 / 开头；根路径统一为 "/"
   * @param {string} subPath
   * @returns {string}
   */
  _normalizeSubPath(subPath) {
    let value = subPath || "/";
    if (typeof value !== "string") {
      value = String(value);
    }
    if (!value.startsWith("/")) {
      value = "/" + value;
    }
    // 根路径保持为 "/"
    if (value.length > 1 && value.endsWith("/")) {
      value = value.replace(/\/+$/, "");
      if (value === "") {
        value = "/";
      }
    }
    return value;
  }

  /**
   * 获取下一级目录名
   * @param {string} wholePath 目标路径（如 /a/b）
   * @param {string} basePath  基础路径（如 /a）
   * @returns {string} nextDir（如 b），无则返回空串
   */
  _getNextDir(wholePath, basePath) {
    const whole = this._normalizeSubPath(wholePath);
    const base = this._normalizeSubPath(basePath);

    const basePrefix = base === "/" ? "/" : `${base.replace(/\/+$/, "")}/`;
    if (!whole.startsWith(basePrefix)) {
      return "";
    }
    const remaining = whole.slice(basePrefix.length).replace(/^\/+/, "");
    if (!remaining) return "";
    return remaining.split("/")[0] || "";
  }

  /**
   * 根据子路径解析命中的仓库及仓库内相对路径
   * @param {string} subPath 已规范化子路径
   * @returns {{ repo: GithubRepoMapping, repoRelative: string } | null}
   */
  _resolveRepoPath(subPath) {
    const normalized = this._normalizeSubPath(subPath);
    let best = null;

    for (const repoMapping of this.repos) {
      const prefix = this._normalizeSubPath(repoMapping.point);

      // point = "/"：匹配所有路径（更具体的 point 优先）
      if (prefix === "/") {
        const candidate = { repo: repoMapping, repoRelative: normalized, score: 1 };
        if (!best || candidate.score > best.score) {
          best = candidate;
        }
        continue;
      }

      if (normalized === prefix) {
        const candidate = { repo: repoMapping, repoRelative: "/", score: prefix.length };
        if (!best || candidate.score > best.score) {
          best = candidate;
        }
        continue;
      }

      if (normalized.startsWith(prefix + "/")) {
        const rest = normalized.slice(prefix.length);
        const repoRelative = rest.length > 0 ? rest : "/";
        const candidate = { repo: repoMapping, repoRelative, score: prefix.length };
        if (!best || candidate.score > best.score) {
          best = candidate;
        }
      }
    }

    return best ? { repo: best.repo, repoRelative: best.repoRelative } : null;
  }

  /**
   * 构建 GitHub API 请求头
   * @param {Object} extra - 额外的请求头
   * @param {string} targetUrl - 目标 URL，用于生成 Referer
   * @returns {Record<string,string>}
   */
  _buildHeaders(extra = {}, targetUrl = null) {
    const browserHeaders = this._masqueradeClient.buildHeaders({}, targetUrl);
    const headers = {
      ...browserHeaders,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (this.token && typeof this.token === "string" && this.token.trim().length > 0) {
      headers.Authorization = `Bearer ${this.token.trim()}`;
    }
    return { ...headers, ...(extra || {}) };
  }

  /**
   * 调用 GitHub API 并返回 JSON 结果
   * @param {string} url
   * @returns {Promise<any>}
   */
  async _fetchJson(url) {
    try {
      const resp = await fetch(url, {
        method: "GET",
        headers: this._buildHeaders(),
      });

      if (resp.status === 404) {
        return null;
      }

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new DriverError(`GitHub API 请求失败: ${resp.status}`, {
          status: ApiStatus.BAD_GATEWAY,
          code: "DRIVER_ERROR.GITHUB_API",
          expose: false,
          details: { url, status: resp.status, body: text },
        });
      }

      return await resp.json();
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new DriverError("GitHub API 请求异常", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_API",
        expose: false,
        details: { url, cause: error?.message },
      });
    }
  }

  /**
   * 拉取仓库元信息（用于判定私有仓库），带 TTL 缓存
   * @param {GithubRepoMapping} repo
   * @param {{ refresh?: boolean, cacheTtlMs?: number }} options
   * @returns {Promise<any|null>}
   */
  async _fetchRepoMeta(repo, options = {}) {
    const { refresh = false, cacheTtlMs = 0 } = options;
    const key = this._getRepoKey(repo);
    const entry = this._repoMetaCache.get(key) || {};
    const now = Date.now();

    if (
      !refresh &&
      cacheTtlMs > 0 &&
      typeof entry.fetchedAt === "number" &&
      now - entry.fetchedAt < cacheTtlMs
    ) {
      return entry.meta ?? null;
    }

    const url = `${this.apiBase}/repos/${repo.owner}/${repo.repo}`;
    const meta = await this._fetchJson(url);
    this._repoMetaCache.set(key, { meta: meta ?? null, fetchedAt: now });
    return meta ?? null;
  }

  /**
   * 获取 repoKey 标识
   * @param {GithubRepoMapping} repo
   * @returns {string}
   */
  _getRepoKey(repo) {
    return `${repo.owner}/${repo.repo}`;
  }

  /**
   * 获取最新 Release
   * @param {GithubRepoMapping} repo
   * @param {{ refresh?: boolean, cacheTtlMs?: number }} options
   * @returns {Promise<any|null>}
   */
  async _fetchLatestRelease(repo, options = {}) {
    const { refresh = false, cacheTtlMs = 0 } = options;
    const key = this._getRepoKey(repo);
    const entry = this._releaseCache.get(key) || {};
    const now = Date.now();
    if (
      !refresh &&
      cacheTtlMs > 0 &&
      entry.latest &&
      typeof entry.latestFetchedAt === "number" &&
      now - entry.latestFetchedAt < cacheTtlMs
    ) {
      return entry.latest;
    }
    const url = `${this.apiBase}/repos/${repo.owner}/${repo.repo}/releases/latest`;
    const data = await this._fetchJson(url);
    const updated = { ...entry, latest: data, latestFetchedAt: now };
    this._releaseCache.set(key, updated);
    return data;
  }

  /**
   * 获取所有 Releases
   * @param {GithubRepoMapping} repo
   * @param {{ refresh?: boolean, cacheTtlMs?: number }} options
   * @returns {Promise<any[]>}
   */
  async _fetchReleases(repo, options = {}) {
    const { refresh = false, cacheTtlMs = 0 } = options;
    const key = this._getRepoKey(repo);
    const entry = this._releaseCache.get(key) || {};
    const now = Date.now();
    if (
      !refresh &&
      cacheTtlMs > 0 &&
      Array.isArray(entry.releases) &&
      typeof entry.releasesFetchedAt === "number" &&
      now - entry.releasesFetchedAt < cacheTtlMs
    ) {
      return entry.releases;
    }
    const url = `${this.apiBase}/repos/${repo.owner}/${repo.repo}/releases?per_page=${this.perPage}`;
    const data = (await this._fetchJson(url)) || [];
    const updated = { ...entry, releases: data, releasesFetchedAt: now };
    this._releaseCache.set(key, updated);
    return data;
  }

  /**
   * 获取仓库级文本文件（README 或 LICENSE）元数据
   * - kind = \"readme\" 调用 /repos/{owner}/{repo}/readme
   * - kind = \"license\" 调用 /repos/{owner}/{repo}/license
   * - 结果会缓存在 _releaseCache 中，避免重复请求
   * @param {GithubRepoMapping} repo
   * @param {\"readme\"|\"license\"} kind
   * @param {{ refresh?: boolean, cacheTtlMs?: number }} options
   * @returns {Promise<any|null>}
   */
  async _fetchRepoTextFile(repo, kind, options = {}) {
    const { refresh = false, cacheTtlMs = 0 } = options;
    const key = this._getRepoKey(repo);
    const entry = this._releaseCache.get(key) || {};
    const cacheKey = kind === 'readme' ? 'readme' : 'license';

    const now = Date.now();
    const fetchedAtKey = cacheKey === "readme" ? "readmeFetchedAt" : "licenseFetchedAt";
    if (
      !refresh &&
      cacheTtlMs > 0 &&
      Object.prototype.hasOwnProperty.call(entry, cacheKey) &&
      typeof entry[fetchedAtKey] === "number" &&
      now - entry[fetchedAtKey] < cacheTtlMs
    ) {
      return entry[cacheKey] ?? null;
    }

    let url;
    if (kind === 'readme') {
      url = `${this.apiBase}/repos/${repo.owner}/${repo.repo}/readme`;
    } else {
      url = `${this.apiBase}/repos/${repo.owner}/${repo.repo}/license`;
    }

    const data = await this._fetchJson(url);
    const updated = { ...entry, [cacheKey]: data, [fetchedAtKey]: now };
    this._releaseCache.set(key, updated);
    return data;
  }

  /**
   * 根据 tagName 获取指定 Release
   * @param {GithubRepoMapping} repo
   * @param {string} tagName
   * @returns {Promise<any|null>}
   */
  async _fetchReleaseByTag(repo, tagName, options = {}) {
    const releases = await this._fetchReleases(repo, options);
    const found = releases.find((item) => item.tag_name === tagName);
    return found || null;
  }

  /**
   * 如配置了 gh_proxy，则对下载 URL 进行简单代理替换
   * 约定：仅对以 https://github.com 开头的 URL 进行 host 替换。
   * @param {string} url
   * @returns {string}
   */
  _applyProxy(url) {
    if (!this.ghProxy || typeof this.ghProxy !== "string") {
      return url;
    }
    const trimmed = this.ghProxy.trim().replace(/\/+$/, "");
    if (!trimmed) {
      return url;
    }
    return url.replace(/^https:\/\/github\.com/, trimmed);
  }

  /**
   * 构造子文件路径
   * @param {string} baseFsPath 当前目录的挂载视图路径
   * @param {string} name      子项名称
   * @returns {string}
   */
  _joinChildPath(baseFsPath, name) {
    const base = baseFsPath.endsWith("/") ? baseFsPath.replace(/\/+$/, "") : baseFsPath;
    return `${base}/${name}`;
  }

  /**
   * 列出目录内容
   * @param {string} subPath 挂载内子路径（subPath-only）
   * @param {Object} ctx     上下文（mount/path/subPath/db/...）
   */
  async listDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, db, refresh = false } = ctx;
    const normalizedSubPath = this._normalizeSubPath(subPath);
    const currentFsPath = ctx?.path;
    const cacheTtlMs = this._getCacheTtlMs({ mount });

    /** @type {Array<Object>} */
    const items = [];

    // 目录去重：同一路径下不同 repo 可能需要共同创建同名的中间目录
    const dirNameSet = new Set();

    // 记录是否命中任何 repo / 中间目录 / tag 目录（用于 NotFound 判定）
    let matched = false;

    const basePrefix = normalizedSubPath === "/" ? "/" : `${normalizedSubPath.replace(/\/+$/, "")}/`;

    const addVirtualDirectory = async (name) => {
      if (!name || dirNameSet.has(name)) {
        return;
      }
      dirNameSet.add(name);
      const dirPath = this._joinChildPath(currentFsPath, name);
      const info = await buildFileInfo({
        fsPath: dirPath,
        name,
        isDirectory: true,
        size: null,
        modified: null,
        mimetype: "application/x-directory",
        mount,
        storageType: mount?.storage_type,
        db,
      });
      items.push({
        ...info,
        isVirtual: true,
      });
    };

    for (const repoMapping of this.repos) {
      const point = this._normalizeSubPath(repoMapping.point);

      // 1) 当前目录是 repo 根目录：输出 repo 内容
      if (point === normalizedSubPath) {
        matched = true;

        if (this.showAllVersion) {
          const releases = await this._fetchReleases(repoMapping, { refresh, cacheTtlMs });
          const promises = releases.map(async (release) => {
            const dirName = release.tag_name || release.name || `release-${release.id}`;
            const dirPath = this._joinChildPath(currentFsPath, dirName);
            const modified = release.published_at ? new Date(release.published_at) : null;
            const info = await buildFileInfo({
              fsPath: dirPath,
              name: dirName,
              isDirectory: true,
              size: null,
              modified,
              mimetype: "application/x-directory",
              mount,
              storageType: mount?.storage_type,
              db,
            });
            return {
              ...info,
              isVirtual: true,
            };
          });

          for (const item of await Promise.all(promises)) {
            items.push(item);
          }
        } else {
          // 关闭 show_all_version：只展示最新版本的资产列表（扁平文件列表）
          const latest = await this._fetchLatestRelease(repoMapping, { refresh, cacheTtlMs });
          if (latest) {
            const assetInfos = await this._buildAssetsFileInfos(latest, currentFsPath, mount, db);
            for (const entry of assetInfos) {
              items.push(entry);
            }
          }
        }

        if (this.showReadme) {
          const extra = await this._buildReadmeAndLicenseEntries(repoMapping, currentFsPath, mount, db, {
            refresh,
            cacheTtlMs,
          });
          for (const entry of extra) {
            items.push(entry);
          }
        }

        continue;
      }

      // 2) 当前目录是 repo 挂载点的祖先目录：创建中间目录
      if (point.startsWith(basePrefix)) {
        const nextDir = this._getNextDir(point, normalizedSubPath);
        if (nextDir) {
          matched = true;
          await addVirtualDirectory(nextDir);
        }
        continue;
      }

      // 3) showAllVersion 模式：当前目录可能是 tag 目录（repoPoint 的子目录）
      if (this.showAllVersion) {
        const pointPrefix = point === "/" ? "/" : `${point.replace(/\/+$/, "")}/`;
        if (!normalizedSubPath.startsWith(pointPrefix)) {
          continue;
        }
        const repoRelative = point === "/" ? normalizedSubPath : normalizedSubPath.slice(point.length);
        const relativeWithoutSlash = repoRelative.replace(/^\/+/, "");
        const segments = relativeWithoutSlash.split("/").filter(Boolean);
        if (segments.length !== 1) {
          continue;
        }

        const tagName = segments[0];
        const release = await this._fetchReleaseByTag(repoMapping, tagName, { refresh, cacheTtlMs });
        if (!release) {
          continue;
        }

        matched = true;
        const assetInfos = await this._buildAssetsFileInfos(release, currentFsPath, mount, db);
        for (const entry of assetInfos) {
          items.push(entry);
        }
      }
    }

    if (!matched) {
      throw new NotFoundError("目录不存在");
    }

    return {
      path: currentFsPath,
      type: "directory",
      isRoot: normalizedSubPath === "/",
      isVirtual: true,
      mount_id: mount?.id,
      storage_type: mount?.storage_type,
      items,
    };
  }

  /**
   * 构造指定 Release 的资产 FileInfo 列表
   * @param {any} release
   * @param {string} baseFsPath
   * @param {any} mount
   * @param {any} db
   * @returns {Promise<Array<Object>>}
   */
  async _buildAssetsFileInfos(release, baseFsPath, mount, db) {
    const items = [];

    const assets = Array.isArray(release.assets) ? release.assets : [];
    const assetPromises = assets.map(async (asset) => {
      const name = asset.name || "asset";
      const fsPath = this._joinChildPath(baseFsPath, name);
      const size = typeof asset.size === "number" ? asset.size : 0;
      const modified = asset.updated_at ? new Date(asset.updated_at) : null;
      const info = await buildFileInfo({
        fsPath,
        name,
        isDirectory: false,
        size,
        modified,
        mimetype: getMimeTypeFromFilename(name),
        mount,
        storageType: mount?.storage_type,
        db,
      });
      return {
        ...info,
        isVirtual: false,
        // 为后续生成直链提供元数据（不在契约内，但有用）
        _github: {
          downloadUrl: asset.browser_download_url,
        },
      };
    });

    for (const item of await Promise.all(assetPromises)) {
      items.push(item);
    }

    // 可选：将 Source code (zip/tar.gz) 作为虚拟文件挂入目录
    if (this.showSourceCode) {
      const srcItems = await this._buildSourceCodeEntries(release, baseFsPath, mount, db);
      for (const entry of srcItems) {
        items.push(entry);
      }
    }

    // 可选：将 Release Notes 作为虚拟文件挂入目录（避免与同名资产冲突）
    if (this.showReleaseNotes && !assets.some((a) => a && a.name === RELEASE_NOTES_FILENAME)) {
      const notes = await this._buildReleaseNotesEntry(release, baseFsPath, mount, db);
      if (notes) {
        items.push(notes);
      }
    }

    return items;
  }

  /**
   * 构造 Release Notes 伪文件条目
   * - 仅当 release.body 非空时生成，避免出现“空壳文件”造成困惑
   * @param {any} release
   * @param {string} baseFsPath
   * @param {any} mount
   * @param {any} db
   * @returns {Promise<Object|null>}
   */
  async _buildReleaseNotesEntry(release, baseFsPath, mount, db) {
    const body = typeof release?.body === "string" ? release.body : "";
    if (!body || body.trim().length === 0) {
      return null;
    }

    const name = RELEASE_NOTES_FILENAME;
    const fsPath = this._joinChildPath(baseFsPath, name);
    const modified = release?.published_at
      ? new Date(release.published_at)
      : release?.created_at
      ? new Date(release.created_at)
      : null;
    const size = this._getUtf8ByteLength(body);

    const info = await buildFileInfo({
      fsPath,
      name,
      isDirectory: false,
      size,
      modified,
      mimetype: "text/markdown",
      mount,
      storageType: mount?.storage_type,
      db,
    });

    return {
      ...info,
      isVirtual: true,
    };
  }

  /**
   * 构造 Source code 伪文件条目
   * @param {any} release
   * @param {string} baseFsPath
   * @param {any} mount
   * @param {any} db
   * @returns {Promise<Array<Object>>}
   */
  async _buildSourceCodeEntries(release, baseFsPath, mount, db) {
    const results = [];
    const createdAt = release.created_at ? new Date(release.created_at) : null;

    const entries = [
      { name: "Source code (zip)", url: release.zipball_url },
      { name: "Source code (tar.gz)", url: release.tarball_url },
    ].filter((item) => typeof item.url === "string" && item.url.length > 0);

    const promises = entries.map(async (entry) => {
      const fsPath = this._joinChildPath(baseFsPath, entry.name);
      const isZip = entry.name.includes("(zip)");
      const mimetype = isZip ? "application/zip" : "application/gzip";
      const info = await buildFileInfo({
        fsPath,
        name: entry.name,
        isDirectory: false,
        // 无法获得准确大小，统一标记为 1
        size: 1,
        modified: createdAt,
        mimetype,
        mount,
        storageType: mount?.storage_type,
        db,
      });
      return {
        ...info,
        isVirtual: true,
        _github: {
          downloadUrl: entry.url,
        },
      };
    });

    for (const item of await Promise.all(promises)) {
      results.push(item);
    }

    return results;
  }

  /**
   * 构造 README / LICENSE 伪文件条目（仓库级别）
   * @param {GithubRepoMapping} repo
   * @param {string} baseFsPath
   * @param {any} mount
   * @param {any} db
   * @returns {Promise<Array<Object>>}
   */
  async _buildReadmeAndLicenseEntries(repo, baseFsPath, mount, db, options = {}) {
    const { refresh = false, cacheTtlMs = 0 } = options;
    const results = [];

    const [readmeMeta, licenseMeta] = await Promise.all([
      this._fetchRepoTextFile(repo, "readme", { refresh, cacheTtlMs }),
      this._fetchRepoTextFile(repo, "license", { refresh, cacheTtlMs }),
    ]);

    const pushFromMeta = async (meta, fallbackName, mimetype) => {
      if (!meta || typeof meta !== "object" || typeof meta.download_url !== "string") {
        return;
      }
      const name = typeof meta.name === "string" && meta.name.length > 0 ? meta.name : fallbackName;
      const fsPath = this._joinChildPath(baseFsPath, name);
      const size = typeof meta.size === "number" ? meta.size : 0;
      const modified = meta.updated_at ? new Date(meta.updated_at) : null;

      const info = await buildFileInfo({
        fsPath,
        name,
        isDirectory: false,
        size,
        modified,
        mimetype,
        mount,
        storageType: mount?.storage_type,
        db,
      });

      results.push({
        ...info,
        isVirtual: true,
      });
    };

    await pushFromMeta(readmeMeta, "README.md", "text/markdown");
    await pushFromMeta(licenseMeta, "LICENSE", "text/plain");

    return results;
  }

  /**
   * 根据路径解析资产信息（用于 getFileInfo / exists / downloadFile / generateDownloadUrl）
   * @param {string} subPath
   * @param {{ mount?: any, refresh?: boolean }} [options]
   * @returns {Promise<{ repo: GithubRepoMapping, release: any, assetName: string, asset: any|null, isSourceCode: boolean, isReleaseNotes: boolean } | null>}
   */
  async _resolveAssetBySubPath(subPath, options = {}) {
    const { mount, refresh = false } = options;
    const cacheTtlMs = this._getCacheTtlMs({ mount });
    const normalizedSubPath = this._normalizeSubPath(subPath);
    const resolved = this._resolveRepoPath(normalizedSubPath);
    if (!resolved) {
      return null;
    }
    const { repo, repoRelative } = resolved;

    const relativeWithoutSlash = repoRelative.replace(/^\/+/, "");
    if (!relativeWithoutSlash) {
      // 指向仓库根目录，而不是具体文件
      return null;
    }

    const segments = relativeWithoutSlash.split("/").filter(Boolean);

    // 仓库根目录下的 README / LICENSE 虚拟文件解析
    if (this.showReadme && segments.length === 1) {
      const candidate = segments[0];
      const [readmeMeta, licenseMeta] = await Promise.all([
        this._fetchRepoTextFile(repo, "readme", { refresh, cacheTtlMs }),
        this._fetchRepoTextFile(repo, "license", { refresh, cacheTtlMs }),
      ]);

      const matchMeta =
        (readmeMeta && readmeMeta.name === candidate && readmeMeta) ||
        (licenseMeta && licenseMeta.name === candidate && licenseMeta) ||
        null;

      if (matchMeta && typeof matchMeta.download_url === "string") {
        const assetLike = {
          name: candidate,
          browser_download_url: matchMeta.download_url,
          size: typeof matchMeta.size === "number" ? matchMeta.size : 0,
          updated_at: matchMeta.updated_at || null,
        };

        return {
          repo,
          release: null,
          assetName: candidate,
          asset: assetLike,
          isSourceCode: false,
          isReleaseNotes: false,
        };
      }
    }

    let assetName = "";
    let release = null;

    if (this.showAllVersion) {
      // show_all_version：/<tag>/<asset>
      if (segments.length < 2) {
        return null;
      }
      const tagName = segments[0];
      const rest = segments.slice(1);

      assetName = rest.join("/");
      if (!assetName) {
        return null;
      }
      release = await this._fetchReleaseByTag(repo, tagName, { refresh, cacheTtlMs });
      if (!release) {
        return null;
      }
    } else {
      assetName = segments.join("/");
      if (!assetName) {
        return null;
      }
      release = await this._fetchLatestRelease(repo, { refresh, cacheTtlMs });
      if (!release) {
        return null;
      }
    }

    const assets = Array.isArray(release.assets) ? release.assets : [];
    const asset = assets.find((item) => item.name === assetName) || null;

    // Release Notes 伪文件（优先于 Source code 逻辑，避免被误判为“不存在”）
    if (!asset && this.showReleaseNotes && assetName === RELEASE_NOTES_FILENAME) {
      const body = typeof release?.body === "string" ? release.body : "";
      if (!body || body.trim().length === 0) {
        return null;
      }
      return {
        repo,
        release,
        assetName,
        asset: null,
        isSourceCode: false,
        isReleaseNotes: true,
      };
    }

    // Source code 伪文件
    let isSourceCode = false;
    if (!asset && this.showSourceCode) {
      if (assetName === "Source code (zip)" && release.zipball_url) {
        isSourceCode = true;
      } else if (assetName === "Source code (tar.gz)" && release.tarball_url) {
        isSourceCode = true;
      } else {
        return null;
      }
    }

    return {
      repo,
      release,
      assetName,
      asset,
      isSourceCode,
      isReleaseNotes: false,
    };
  }

  /**
   * 获取文件或目录信息
   * @param {string} subPath 挂载内子路径（subPath-only）
   * @param {Object} ctx     上下文（mount/path/subPath/db/...）
   */
  async getFileInfo(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, db } = ctx;
    const path = ctx?.path;
    const normalizedSubPath = this._normalizeSubPath(subPath);

    // 根目录：作为目录处理
    if (normalizedSubPath === "/") {
      const name = this._inferNameFromFsPath(path, true);
      const info = await buildFileInfo({
        fsPath: path,
        name,
        isDirectory: true,
        size: null,
        modified: null,
        mimetype: "application/x-directory",
        mount,
        storageType: mount?.storage_type,
        db,
      });
      return {
        ...info,
        isVirtual: true,
      };
    }

    // repo_structure 中间目录 / repo 根目录：作为虚拟目录处理
    const structuralPrefix = `${normalizedSubPath.replace(/\/+$/, "")}/`;
    const isStructuralDir = this.repos.some((repoMapping) => {
      const point = this._normalizeSubPath(repoMapping.point);
      if (point === normalizedSubPath) return true;
      if (normalizedSubPath !== "/" && point.startsWith(structuralPrefix)) return true;
      return false;
    });

    if (isStructuralDir) {
      const name = this._inferNameFromFsPath(path, true);
      const info = await buildFileInfo({
        fsPath: path,
        name,
        isDirectory: true,
        size: null,
        modified: null,
        mimetype: "application/x-directory",
        mount,
        storageType: mount?.storage_type,
        db,
      });
      return {
        ...info,
        isVirtual: true,
      };
    }

    const resolved = this._resolveRepoPath(normalizedSubPath);
    if (!resolved) {
      throw new NotFoundError("文件或目录不存在");
    }

    const { repo, repoRelative } = resolved;
    const isRepoRoot = repoRelative === "/" || repoRelative === "";
    if (isRepoRoot) {
      const name = this._inferNameFromFsPath(path, true);
      const info = await buildFileInfo({
        fsPath: path,
        name,
        isDirectory: true,
        size: null,
        modified: null,
        mimetype: "application/x-directory",
        mount,
        storageType: mount?.storage_type,
        db,
      });
      return {
        ...info,
        isVirtual: true,
      };
    }

    // showAllVersion 模式：tag 目录视为虚拟目录（按 tagName 命名）
    if (this.showAllVersion) {
      const cacheTtlMs = this._getCacheTtlMs({ mount });
      const relativeWithoutSlash = repoRelative.replace(/^\/+/, "");
      const segments = relativeWithoutSlash.split("/").filter(Boolean);

      if (segments.length === 1) {
        const tagName = segments[0];
        const release = await this._fetchReleaseByTag(repo, tagName, { cacheTtlMs });
        if (release) {
          const modified = release?.published_at ? new Date(release.published_at) : null;
          const info = await buildFileInfo({
            fsPath: path,
            name: tagName,
            isDirectory: true,
            size: null,
            modified,
            mimetype: "application/x-directory",
            mount,
            storageType: mount?.storage_type,
            db,
          });
          return {
            ...info,
            isVirtual: true,
          };
        }
      }
    }

    // 尝试解析为资产
    const assetResolved = await this._resolveAssetBySubPath(normalizedSubPath, { mount });
    if (!assetResolved) {
      throw new NotFoundError("文件不存在");
    }

    const { assetName, asset, release, isSourceCode, isReleaseNotes } = assetResolved;
    const isDirectory = false;
    const size = isReleaseNotes
      ? this._getUtf8ByteLength(typeof release?.body === "string" ? release.body : "")
      : asset && typeof asset.size === "number"
      ? asset.size
      : 0;
    const modified = asset?.updated_at
      ? new Date(asset.updated_at)
      : release?.published_at
      ? new Date(release.published_at)
      : null;

    const info = await buildFileInfo({
      fsPath: path,
      name: assetName,
      isDirectory,
      size,
      modified,
      mimetype: isReleaseNotes ? "text/markdown" : isSourceCode ? (assetName.includes("(zip)") ? "application/zip" : "application/gzip") : getMimeTypeFromFilename(assetName),
      mount,
      storageType: mount?.storage_type,
      db,
    });

    return {
      ...info,
      isVirtual: isSourceCode || isReleaseNotes,
    };
  }

  /**
   * stat 语义与 getFileInfo 保持一致
   * @param {string} subPath
   * @param {Object} ctx
   */
  async stat(subPath, ctx = {}) {
    return await this.getFileInfo(subPath, ctx);
  }

  /**
   * 检查文件或目录是否存在
   * @param {string} subPath
   * @param {Object} ctx
   * @returns {Promise<boolean>}
   */
  async exists(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount } = ctx;
    const normalizedSubPath = this._normalizeSubPath(subPath);

    if (normalizedSubPath === "/") {
      return true;
    }

    // repo_structure 中间目录 / repo 根目录：视为存在
    const structuralPrefix = `${normalizedSubPath.replace(/\/+$/, "")}/`;
    const isStructuralDir = this.repos.some((repoMapping) => {
      const point = this._normalizeSubPath(repoMapping.point);
      if (point === normalizedSubPath) return true;
      if (normalizedSubPath !== "/" && point.startsWith(structuralPrefix)) return true;
      return false;
    });
    if (isStructuralDir) {
      return true;
    }

    const resolved = this._resolveRepoPath(normalizedSubPath);
    if (!resolved) {
      return false;
    }

    const { repo, repoRelative } = resolved;
    if (repoRelative === "/" || repoRelative === "") {
      return true;
    }

    if (this.showAllVersion) {
      const cacheTtlMs = this._getCacheTtlMs({ mount });
      const relativeWithoutSlash = repoRelative.replace(/^\/+/, "");
      const segments = relativeWithoutSlash.split("/").filter(Boolean);

      // tag 目录：/<tag>
      if (segments.length === 1) {
        const tagName = segments[0];
        const release = await this._fetchReleaseByTag(repo, tagName, { cacheTtlMs });
        if (release) {
          return true;
        }
      }
    }

    const assetResolved = await this._resolveAssetBySubPath(normalizedSubPath, { mount });
    return !!assetResolved;
  }

  /**
   * 下载文件，返回 StorageStreamDescriptor
   * @param {string} subPath 挂载内子路径（subPath-only）
   * @param {Object} ctx     上下文（mount/path/subPath/...）
   */
  async downloadFile(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount } = ctx;
    const path = ctx?.path;
    const normalizedSubPath = this._normalizeSubPath(subPath);

    const assetResolved = await this._resolveAssetBySubPath(normalizedSubPath, { mount });
    if (!assetResolved) {
      throw new NotFoundError("文件不存在");
    }

    const { repo, assetName, asset, release, isSourceCode, isReleaseNotes } = assetResolved;

    if (isReleaseNotes) {
      const body = typeof release?.body === "string" ? release.body : "";
      const encoder = new TextEncoder();
      const bytes = encoder.encode(body);
      const lastModified = release?.published_at ? new Date(release.published_at) : null;

      return createWebStreamDescriptor({
        openStream: async () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
        size: bytes.length,
        contentType: "text/markdown; charset=utf-8",
        etag: null,
        lastModified,
      });
    }

    let rawUrl = "";
    // 私有仓库：资产的 browser_download_url 需要登录态（不支持 Bearer token），必须使用 API 资产下载端点
    // - Releases API：GET /repos/{owner}/{repo}/releases/assets/{asset_id}（Accept: application/octet-stream）
    const cacheTtlMs = this._getCacheTtlMs({ mount });
    const repoMeta = await this._fetchRepoMeta(repo, { refresh: false, cacheTtlMs });
    const isPrivateRepo = !!(repoMeta && repoMeta.private === true);

    const hasToken = !!(this.token && typeof this.token === "string" && this.token.trim().length > 0);

    if (asset) {
      // 优先使用 API url（私库必须；公库在有 token 时也可用，但会增加 API 压力，因此默认仍用 browser_download_url）
      if ((isPrivateRepo || hasToken) && asset.url) {
        rawUrl = asset.url;
      } else if (asset.browser_download_url) {
        rawUrl = asset.browser_download_url;
      }
    } else if (isSourceCode) {
      if (assetResolved.assetName === "Source code (zip)" && release.zipball_url) {
        rawUrl = release.zipball_url;
      } else if (assetResolved.assetName === "Source code (tar.gz)" && release.tarball_url) {
        rawUrl = release.tarball_url;
      }
    }

    if (!rawUrl) {
      throw new DriverError("找不到可用的 GitHub 下载地址", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_DOWNLOAD_URL_MISSING",
        expose: false,
      });
    }

    const finalUrl = this._applyProxy(rawUrl);
    const size = asset && typeof asset.size === "number" ? asset.size : null;

    const contentType = isSourceCode
      ? assetName.includes("(zip)")
        ? "application/zip"
        : "application/gzip"
      : getMimeTypeFromFilename(assetName);
    const lastModified = release?.published_at ? new Date(release.published_at) : null;

    const downloadHeaders = (extra = {}) => {
      // 使用 API 资产下载端点时必须 Accept octet-stream，否则会返回 JSON 元信息
      const isAssetApiUrl = /^https?:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/releases\/assets\/\d+/i.test(finalUrl);
      if (isAssetApiUrl) {
        return this._buildHeaders({ Accept: "application/octet-stream", ...extra });
      }
      return this._buildHeaders(extra);
    };

    return createHttpStreamDescriptor({
      fetchResponse: async (signal) => {
        const resp = await fetch(finalUrl, {
          method: "GET",
          headers: downloadHeaders(),
          signal,
        });
        return resp;
      },
      fetchRangeResponse: async (signal, rangeHeader) => {
        const resp = await fetch(finalUrl, {
          method: "GET",
          headers: downloadHeaders({ Range: rangeHeader }),
          signal,
        });
        return resp;
      },
      fetchHeadResponse: async (signal) => {
        const resp = await fetch(finalUrl, {
          method: "HEAD",
          headers: downloadHeaders(),
          signal,
        });
        return resp;
      },
      size,
      contentType,
      etag: null,
      lastModified,
      supportsRange: true,
    });
  }

  /**
   * 生成下载直链（DIRECT_LINK 能力）
   * @param {string} subPath 挂载内子路径（subPath-only）
   * @param {Object} ctx     上下文选项（path/subPath/mount/request/forceDownload/...）
   * @returns {Promise<{url:string,type:string,expiresIn?:number|null}>}
   */
  async generateDownloadUrl(subPath, ctx = {}) {
    this._ensureInitialized();
    const fsPath = ctx?.path;
    const { mount } = ctx;
    const normalizedSubPath = this._normalizeSubPath(subPath);

    const assetResolved = await this._resolveAssetBySubPath(normalizedSubPath, { mount });
    if (!assetResolved) {
      throw new NotFoundError("文件不存在");
    }

    const { repo, asset, release, isSourceCode, isReleaseNotes } = assetResolved;

    // 私有仓库：浏览器侧无法携带 GitHub token（也不应泄露），因此直链不可用，强制走本地 /api/p 代理
    // - 对公共仓库仍保留直链能力，减少后端流量
    const cacheTtlMs = this._getCacheTtlMs({ mount });
    const repoMeta = await this._fetchRepoMeta(repo, { refresh: false, cacheTtlMs });
    if (repoMeta && repoMeta.private === true) {
      // generateDownloadUrl 只能返回浏览器可用直链（custom_host/native_direct）
      // 私有仓库无法给出浏览器可用直链（需要 token），这里必须 fail-fast，交给上层降级到 proxy。
      throw new DriverError("GitHub 私有仓库无法生成浏览器可用直链，请走本地代理 /api/p", {
        status: ApiStatus.NOT_IMPLEMENTED,
        code: "DRIVER_ERROR.GITHUB_RELEASES_DIRECT_LINK_NOT_AVAILABLE",
        expose: true,
        details: { path: fsPath, subPath: normalizedSubPath, owner: repo.owner, repo: repo.repo },
      });
    }

    // Release Notes 属于虚拟文件：不具备 GitHub 侧可用直链
    // - FsLinkStrategy 会捕获异常并自动降级到 PROXY 能力（/api/p）
    if (isReleaseNotes) {
      // 虚拟文件没有上游可直出的 URL：必须 fail-fast，交给上层统一走 proxy
      throw new DriverError("Release Notes 为虚拟文件：无法生成浏览器可用直链，请走本地代理 /api/p", {
        status: ApiStatus.NOT_IMPLEMENTED,
        code: "DRIVER_ERROR.GITHUB_RELEASES_VIRTUAL_FILE_NO_DIRECT_LINK",
        expose: true,
        details: { path: fsPath, subPath: normalizedSubPath },
      });
    }

    let rawUrl = "";
    if (asset && asset.browser_download_url) {
      rawUrl = asset.browser_download_url;
    } else if (isSourceCode) {
      if (assetResolved.assetName === "Source code (zip)" && release.zipball_url) {
        rawUrl = release.zipball_url;
      } else if (assetResolved.assetName === "Source code (tar.gz)" && release.tarball_url) {
        rawUrl = release.tarball_url;
      }
    }

    if (!rawUrl) {
      throw new DriverError("找不到可用的 GitHub 下载地址", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.GITHUB_DOWNLOAD_URL_MISSING",
        expose: false,
      });
    }

    const finalUrl = this._applyProxy(rawUrl);

    return {
      url: finalUrl,
      type: "native_direct",
      expiresIn: ctx.expiresIn || null,
    };
  }

  /**
   * 生成本地 /api/p 代理 URL（PROXY 能力）
   * @param {string} subPath 挂载内子路径（subPath-only）
   * @param {Object} ctx     上下文选项（path/request/download/channel/...）
   * @returns {Promise<{url:string,type:string,channel:string}>}
   */
  async generateProxyUrl(subPath, ctx = {}) {
    const { request, download = false, channel = "web" } = ctx;
    const fsPath = ctx?.path;
    const proxyUrl = buildFullProxyUrl(request || null, fsPath, download);
    return {
      url: proxyUrl,
      type: "proxy",
      channel,
    };
  }

  /**
   * 推断仓库目录展示名称：
   * - 优先使用 point 的最后一段；
   * - 若 point 为根（/），退化为 owner/repo。
   * @param {GithubRepoMapping} repo
   * @returns {string}
   */
  _inferRepoName(repo) {
    if (repo.point && repo.point !== "/") {
      const segments = repo.point.split("/").filter(Boolean);
      if (segments.length > 0) {
        return segments[segments.length - 1];
      }
    }
    return `${repo.owner}/${repo.repo}`;
  }

  /**
   * 从挂载视图路径推断目录名称
   * @param {string} fsPath
   * @param {boolean} isDirectory
   * @returns {string}
   */
  _inferNameFromFsPath(fsPath, isDirectory) {
    if (!fsPath || typeof fsPath !== "string") {
      return isDirectory ? "" : "file";
    }
    let normalized = fsPath;
    if (isDirectory && normalized.endsWith("/")) {
      normalized = normalized.replace(/\/+$/, "");
    }
    const segments = normalized.split("/").filter(Boolean);
    if (segments.length === 0) {
      return isDirectory ? "" : "file";
    }
    return segments[segments.length - 1];
  }
}
