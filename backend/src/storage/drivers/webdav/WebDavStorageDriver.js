/**
 * WebDAV 存储驱动
 * 默认支持 Reader/Writer/Proxy/Atomic 能力，不提供存储直链（DirectLink）
 */

import { BaseDriver } from "../../interfaces/capabilities/BaseDriver.js";
/**
 * 模块说明：
 * - 作用：WebDAV 驱动，负责目录/文件的读写、重命名/复制、搜索、代理 URL 生成等。
 * - 能力：声明 READER/WRITER/ATOMIC/PROXY/SEARCH，供 FS/features 按能力路由。
 * - 约定：路径规范化与错误映射封装在 _normalize/_buildDavPath/_wrapError 中，外层无需关心 webdav 客户端细节。
 */
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { ApiStatus, FILE_TYPES } from "../../../constants/index.js";
import { DriverError, NotFoundError, AppError } from "../../../http/errors.js";
import { decryptValue } from "../../../utils/crypto.js";
import { getFileTypeName, GetFileType } from "../../../utils/fileTypeDetector.js";
import { getMimeTypeFromFilename } from "../../../utils/fileUtils.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";
import { createClient } from "webdav";
import { Buffer } from "buffer";
import https from "https";
import { updateUploadProgress, completeUploadProgress } from "../../utils/UploadProgressTracker.js";
import { isNodeJSEnvironment } from "../../../utils/environmentUtils.js";

export class WebDavStorageDriver extends BaseDriver {
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "WEBDAV";
    this.encryptionSecret = encryptionSecret;
    this.capabilities = [CAPABILITIES.READER, CAPABILITIES.WRITER, CAPABILITIES.ATOMIC, CAPABILITIES.PROXY, CAPABILITIES.SEARCH];
    this.client = null;
    this.defaultFolder = config.default_folder || "";
    this.endpoint = config.endpoint_url || "";
    this.username = config.username || "";
    this.passwordEncrypted = config.password || "";
    this.urlProxy = config.url_proxy || null;
    this.tlsSkipVerify = !!config.tls_insecure_skip_verify;
  }

  /**
   * 初始化 WebDAV 客户端
   */
  async initialize() {
    try {
      const password = await decryptValue(this.passwordEncrypted, this.encryptionSecret);
      if (!password) {
        throw new DriverError("WebDAV 凭据不可用", { status: ApiStatus.FORBIDDEN });
      }
      const agent = this.endpoint.startsWith("https://") && this.tlsSkipVerify ? new https.Agent({ rejectUnauthorized: false }) : undefined;
      const clientOptions = agent ? { httpsAgent: agent } : {};
      this.client = createClient(this.endpoint, {
        username: this.username,
        password,
        ...clientOptions,
      });
      this.initialized = true;
      this.decryptedPassword = password;
      console.log(`WebDAV 驱动初始化完成: ${this.endpoint}`);
    } catch (error) {
      console.error("WebDAV 驱动初始化失败", error);
      throw this._wrapError(error, "WebDAV 驱动初始化失败", ApiStatus.INTERNAL_ERROR);
    }
  }

  /**
   * 目录列表
   */
  async listDirectory(path, options = {}) {
    this._ensureInitialized();
    const { mount, subPath = "", refresh = false, db } = options;
    const davPath = this._buildDavPath(subPath, true);
    try {
      const entries = await this.client.getDirectoryContents(davPath, { deep: false, glob: "*" });
      const basePath = this._buildMountPath(mount, subPath);
      const items = await Promise.all(
        entries.map(async (item) => {
          const isDirectory = item.type === "directory";
          const rawName = item.basename || this._basename(item.filename);
          const name = this._decodeComponent(rawName);
          const mountPath = this._joinMountPath(basePath, name, isDirectory);
          const type = isDirectory ? FILE_TYPES.FOLDER : await GetFileType(name, db);
          const typeName = isDirectory ? "folder" : await getFileTypeName(name, db);

          // 无 MIME 时根据文件名推断
          const rawMime = item.mime || null;
          let mimetype = null;
          if (isDirectory) {
            mimetype = "application/x-directory";
          } else if (rawMime && rawMime !== "httpd/unix-directory") {
            mimetype = rawMime;
          } else {
            // WebDAV 服务器未返回有效 MIME，根据文件名推断
            mimetype = getMimeTypeFromFilename(name);
          }

          let size = 0;
          let modified = new Date().toISOString();

          if (isDirectory) {
            size = 0;
            if (item.lastmod) {
              modified = new Date(item.lastmod).toISOString();
            }
          } else {
            // 默认使用目录列表中的 size
            size = typeof item.size === "number" ? item.size : 0;
            if (item.lastmod) {
              modified = new Date(item.lastmod).toISOString();
            }

            // 部分 WebDAV 服务在目录列表中返回错误 size（如恒为 2），
            // 仅在明显异常时再发起一次 stat 精准获取大小，避免每个文件都额外请求。
            if (!Number.isFinite(size) || size <= 2) {
              try {
                const rel = subPath
                  ? `${subPath.replace(/^\\\\\+/, "")}/${rawName}`
                  : rawName;
                const fileDavPath = this._buildDavPath(rel, false);
                const stat = await this.client.stat(fileDavPath);
                if (stat && typeof stat.size === "number" && stat.size >= 0) {
                  size = stat.size;
                }
                if (stat?.lastmod) {
                  modified = new Date(stat.lastmod).toISOString();
                }
              } catch {
                // stat 失败时保持原始 size，交由上层决定如何展示
              }
            }
          }

          return {
            name,
            path: mountPath,
            isDirectory,
            isVirtual: false,
            size,
            modified,
            mimetype,
            type,
            typeName,
          };
        })
      );

      return {
        path: basePath,
        type: "directory",
        isRoot: subPath === "" || subPath === "/",
        isVirtual: false,
        mount_id: mount?.id,
        storage_type: mount?.storage_type,
        items,
      };
    } catch (error) {
      throw this._wrapError(error, "列出目录失败", this._statusFromError(error));
    }
  }

  /**
   * 文件信息
   */
  async getFileInfo(path, options = {}) {
    this._ensureInitialized();
    const { mount, subPath = "", db, request = null, userType = null, userId = null } = options;
    const davPath = this._buildDavPath(subPath, false);
    try {
      const stat = await this.client.stat(davPath);
      const isDirectory = stat.type === "directory";
      const name = this._decodeComponent(this._basename(path));
      const type = isDirectory ? FILE_TYPES.FOLDER : await GetFileType(name, db);
      const typeName = isDirectory ? "folder" : await getFileTypeName(name, db);
      const rawMime = stat.mime || null;
      // 处理 WebDAV 常见的错误 MIME 类型，并在无 MIME 时根据文件名推断
      let effectiveMime = null;
      if (isDirectory) {
        effectiveMime = "application/x-directory";
      } else if (rawMime && rawMime !== "httpd/unix-directory") {
        effectiveMime = rawMime;
      } else {
        // WebDAV 服务器未返回有效 MIME，根据文件名推断
        effectiveMime = getMimeTypeFromFilename(name);
      }
      const result = {
        path,
        name,
        isDirectory,
        size: isDirectory ? 0 : stat.size || 0,
        modified: stat.lastmod ? new Date(stat.lastmod).toISOString() : new Date().toISOString(),
        mimetype: effectiveMime,
        etag: stat.etag || undefined,
        mount_id: mount?.id,
        storage_type: mount?.storage_type,
        type,
        typeName,
      };
      return result;
    } catch (error) {
      if (this._isNotFound(error)) {
        throw new NotFoundError("文件不存在");
      }
      throw this._wrapError(error, "获取文件信息失败", this._statusFromError(error));
    }
  }

  /**
   * 下载文件（返回 StorageStreamDescriptor）
   * @param {string} path - 文件路径
   * @param {Object} options - 选项参数
   * @returns {Promise<import('../../streaming/types.js').StorageStreamDescriptor>} 流描述对象
   */
  async downloadFile(path, options = {}) {
    this._ensureInitialized();
    const davPath = this._buildDavPath(options.subPath || path, false);
    const url = this._buildRequestUrl(davPath);

    // 先获取文件元数据（HEAD 请求）
    let metadata;
    try {
      const headResp = await fetch(url, {
        method: "HEAD",
        headers: { Authorization: this._basicAuthHeader() },
      });
      if (!headResp.ok) {
        if (headResp.status === 404) {
          throw new NotFoundError("文件不存在");
        }
        throw this._wrapError(new Error(`HTTP ${headResp.status}`), "获取文件元数据失败", headResp.status);
      }
        metadata = {
          contentType: headResp.headers.get("content-type") || "application/octet-stream",
          contentLength: headResp.headers.get("content-length"),
          etag: headResp.headers.get("etag"),
          lastModified: headResp.headers.get("last-modified"),
        };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw this._wrapError(error, "获取文件元数据失败", this._statusFromError(error));
    }

    // 优先使用 HEAD 的 Content-Length；部分 WebDAV 服务不会返回该头，需降级为 stat
    let size = metadata.contentLength ? parseInt(metadata.contentLength, 10) : null;
    let contentType = metadata.contentType;
    let etag = metadata.etag || null;
    let lastModified = metadata.lastModified ? new Date(metadata.lastModified) : null;

    // 当 HEAD 未返回 Content-Length 或返回值明显异常时，尝试通过 WebDAV stat 精准获取文件大小
    if (size === null || !Number.isFinite(size) || size <= 0) {
      try {
        const stat = await this.client.stat(davPath);

        if (stat && typeof stat.size === "number" && stat.size >= 0) {
          size = stat.size;
        }

        // 仅在 HEAD 未提供对应元数据时，使用 stat 结果进行补全，避免覆盖上游更准确的 HTTP 头信息
        if (!contentType) {
          const rawMime = stat.mime || null;
          if (rawMime && rawMime !== "httpd/unix-directory") {
            contentType = rawMime;
          }
        }
        if (!etag && stat.etag) {
          etag = stat.etag;
        }
        if (!lastModified && stat.lastmod) {
          lastModified = new Date(stat.lastmod);
        }
      } catch (error) {
        // stat 404 统一视为文件不存在，其余错误仅记录，保持 HEAD 信息，由上层决定是否降级为 200
        if (this._isNotFound(error)) {
          throw new NotFoundError("文件不存在");
        }
      }
    }

    // 保存 url 和 auth 供闭包使用
    const fileUrl = url;
    const authHeader = this._basicAuthHeader();
    const wrapError = this._wrapError.bind(this);
    const statusFromError = this._statusFromError.bind(this);

    // 返回 StorageStreamDescriptor
    return {
      size,
      contentType,
      etag,
      lastModified,

      /**
       * 获取完整文件流
       * @param {{ signal?: AbortSignal }} [streamOptions]
       * @returns {Promise<{ stream: ReadableStream, close: () => Promise<void> }>}
       */
      async getStream(streamOptions = {}) {
        const { signal } = streamOptions;
        try {
          const resp = await fetch(fileUrl, {
            headers: { Authorization: authHeader },
            signal,
          });
          if (!resp.ok) {
            if (resp.status === 404) {
              throw new NotFoundError("文件不存在");
            }
            throw wrapError(new Error(`HTTP ${resp.status}`), "下载失败", resp.status);
          }

          const stream = resp.body;

          return {
            stream,
            async close() {
              if (stream && typeof stream.cancel === "function") {
                try {
                  await stream.cancel();
                } catch {
                  // 忽略取消错误
                }
              }
            },
          };
        } catch (error) {
          if (error instanceof AppError) {
            throw error;
          }
          throw wrapError(error, "下载文件失败", statusFromError(error));
        }
      },

      /**
       * 获取指定范围的流（WebDAV 原生支持 Range）
       *
       * 重要：部分 WebDAV 服务器不支持 Range 请求，会返回 200 而非 206。
       * 此方法会检测响应状态码，并通过 `supportsRange` 标记告知上层是否获得了真正的部分内容。
       * 如果服务器返回 200，上层需要使用 ByteSliceStream 进行软件切片。
       *
       * @param {{ start: number, end?: number }} range
       * @param {{ signal?: AbortSignal }} [streamOptions]
       * @returns {Promise<{ stream: ReadableStream, close: () => Promise<void>, supportsRange: boolean }>}
       */
      async getRange(range, streamOptions = {}) {
        const { signal } = streamOptions;
        const { start, end } = range;

        // 构建 Range 头
        const rangeHeader = end !== undefined && end !== Infinity ? `bytes=${start}-${end}` : `bytes=${start}-`;

        try {
          const resp = await fetch(fileUrl, {
            headers: {
              Authorization: authHeader,
              Range: rangeHeader,
            },
            signal,
          });

          // 404 错误
          if (resp.status === 404) {
            throw new NotFoundError("文件不存在");
          }

          // 其他非成功状态码（排除 200 和 206）
          if (!resp.ok && resp.status !== 206) {
            throw wrapError(new Error(`HTTP ${resp.status}`), "下载失败", resp.status);
          }

          const stream = resp.body;

          // 关键检测：服务器是否真正支持 Range 请求
          // 206 = 支持 Range，返回部分内容
          // 200 = 不支持 Range 或忽略了 Range 头，返回完整内容
          const supportsRange = resp.status === 206;

          // 如果服务器返回 200，记录警告日志，由上层通过 ByteSliceStream 做软件切片
          if (!supportsRange) {
            console.warn(
              `[WebDAV] 服务器不支持 Range 请求，返回 ${resp.status}，将在上层使用 ByteSliceStream 切片`,
            );
          }

          return {
            stream,
            supportsRange,
            async close() {
              if (stream && typeof stream.cancel === "function") {
                try {
                  await stream.cancel();
                } catch {
                  // 忽略取消错误
                }
              }
            },
          };
        } catch (error) {
          if (error instanceof AppError) {
            throw error;
          }
          throw wrapError(error, "下载文件失败", statusFromError(error));
        }
      },
    };
  }

  /**
   * 统一上传入口（文件 / 流）
   * - 外部统一调用此方法，内部根据数据类型选择流式或表单实现
   */
  async uploadFile(path, fileOrStream, options = {}) {
    this._ensureInitialized();
    const isWebStream = fileOrStream && typeof fileOrStream.getReader === "function";

    if (isWebStream) {
      // WebDAV 协议入口等场景：优先走真正的流式上传
      return await this.uploadStream(path, fileOrStream, options);
    }

    // 其它场景统一视为“表单/一次性上传”（读取到 Buffer 再写入）
    return await this.uploadForm(path, fileOrStream, options);
  }

  /**
   * 内部流式上传实现（主要用于 Web ReadableStream）
   */
  async uploadStream(path, stream, options = {}) {
    this._ensureInitialized();
    const davPath = this._resolveTargetDavPath(options.subPath, path, stream, options);
    const url = this._buildRequestUrl(davPath);
    const headers = {};
    const contentType = options.contentType || null;
    if (contentType) {
      headers["Content-Type"] = contentType;
    }
    headers["Authorization"] = this._basicAuthHeader();

    // 为流式上传添加简单的进度统计（仅在 Web ReadableStream 环境下生效）
    /** @type {ReadableStream<any>} */
    let body = stream;
    try {
      const hasGetReader = stream && typeof stream.getReader === "function";
      if (hasGetReader) {
        const total = options.contentLength || options.fileSize || null;
        const reader = stream.getReader();
        let loaded = 0;
        let lastLogged = 0;
        const LOG_INTERVAL = 50 * 1024 * 1024; // 每 50MB 打印一次，避免刷屏

        const progressId = options.uploadId || davPath;

        body = new ReadableStream({
          async pull(controller) {
            const { done, value } = await reader.read();
              if (done) {
                controller.close();
                // 结束时再打印一次总进度
                if (loaded > 0 && total) {
                  const percentage = ((loaded / total) * 100).toFixed(1);
                  console.log(
                    `[StorageUpload] type=WEBDAV mode=STREAM event=completed loaded=${loaded} total=${total} percent=${percentage} path=${davPath}`
                  );
                }
                try {
                  completeUploadProgress(progressId);
                } catch {}
                return;
              }

            const chunkSize = value?.byteLength ?? value?.length ?? 0;
            loaded += chunkSize;

            const shouldLog =
              total != null
                ? loaded === total || loaded - lastLogged >= LOG_INTERVAL
                : loaded - lastLogged >= LOG_INTERVAL;

              if (shouldLog) {
                const percentage = total ? ((loaded / total) * 100).toFixed(1) : "未知";
                const totalLabel = total ?? "未知";
                console.log(
                  `[StorageUpload] type=WEBDAV mode=流式上传 status=进度 已传=${loaded} 总=${totalLabel} 进度=${percentage}% 路径=${davPath}`
                );
                lastLogged = loaded;
              }

            try {
              updateUploadProgress(progressId, {
                loaded,
                total,
                path: davPath,
                storageType: "WEBDAV",
              });
            } catch {}

            controller.enqueue(value);
          },
          cancel(reason) {
            try {
              reader.cancel(reason);
            } catch {
              // 取消失败时静默忽略
            }
          },
        });
      }
    } catch {
      // 若包装失败，退回原始 stream，避免影响主流程
      body = stream;
    }

    try {
      await this._ensureParentDirectories(davPath);
      /** @type {RequestInit} */
      const init = {
        method: "PUT",
        headers,
        body,
      };
      // Node.js 原生 fetch 在使用可读流作为 body 时必须显式设置 duplex
      if (isNodeJSEnvironment() && body != null) {
        // @ts-ignore
        init.duplex = "half";
      }
      const resp = await fetch(url, init);
      if (!resp.ok && resp.status !== 201 && resp.status !== 204) {
        throw this._wrapError(new Error(`HTTP ${resp.status}`), "上传文件失败", resp.status);
      }
      console.log(
        `[StorageUpload] type=WEBDAV mode=流式上传 status=成功 路径=${davPath}`
      );
      return { success: true, storagePath: davPath, message: "WEBDAV_STREAM_UPLOAD" };
    } catch (error) {
      throw this._wrapError(error, "上传文件失败", this._statusFromError(error));
    }
  }

  /**
   * 内部表单上传实现（一次性缓冲，适用于 Buffer / Uint8Array / ArrayBuffer / File / Blob / string 等）
   */
  async uploadForm(path, fileOrData, options = {}) {
    this._ensureInitialized();
    const davPath = this._resolveTargetDavPath(options.subPath, path, fileOrData, options);
    const { body, length, contentType } = await this._normalizeBody(fileOrData, options);

    try {
      await this._ensureParentDirectories(davPath);
      await this.client.putFileContents(davPath, body, {
        overwrite: true,
        contentLength: length,
        contentType,
      });
      console.log(
        `[StorageUpload] type=WEBDAV mode=表单上传 status=成功 路径=${davPath} 大小=${length}`
      );

      return { success: true, storagePath: davPath, message: "WEBDAV_FORM_UPLOAD" };
    } catch (error) {
      throw this._wrapError(error, "上传文件失败", this._statusFromError(error));
    }
  }

  async createDirectory(path, options = {}) {
    this._ensureInitialized();
    const davSubPath = options.mount ? (options.subPath || "") : (options.subPath || path);
    const davPath = this._buildDavPath(davSubPath, true);
    try {
      await this.client.createDirectory(davPath);
    } catch (error) {
      const status = this._statusFromError(error);
      // 部分 WebDAV 服务对已存在目录或根目录返回 405/501，视为目录已存在即可
      if (this._isConflict(error) || status === ApiStatus.NOT_IMPLEMENTED) {
        return { success: true, path: davPath, alreadyExists: true };
      }
      throw this._wrapError(error, "创建目录失败", status);
    }
    return { success: true, path: davPath };
  }

  async updateFile(path, content, options = {}) {
    return await this.uploadFile(path, content, options);
  }

  /**
   * 搜索当前挂载内的文件/目录（名称模糊匹配）
   * @param {string} query - 搜索关键字
   * @param {Object} options - 搜索选项
   * @param {Object} options.mount - 挂载点对象
   * @param {string|null} options.searchPath - 搜索范围路径（FS 视图路径，可为空表示全挂载）
   * @param {number} options.maxResults - 最大结果数量
   * @param {D1Database} options.db - 数据库实例
   * @returns {Promise<Array<Object>>} 搜索结果
   */
  async search(query, options = {}) {
    this._ensureInitialized();
    const { mount, searchPath = null, maxResults = 1000, db } = options;

    if (!mount) {
      throw new DriverError("WebDAV 搜索需要挂载点信息", { status: ApiStatus.BAD_REQUEST, expose: true });
    }

    // 从 FS 路径还原到 WebDAV 子路径
    let subPath = "";
    if (searchPath) {
      subPath = this._extractSubPath(searchPath, mount) || "";
    }
    const davPath = this._buildDavPath(subPath, true);

    try {
      const q = (query || "").toLowerCase();
      const results = [];
      const base = this._normalize(this.defaultFolder || "");
      const queue = [davPath];

      while (queue.length > 0 && results.length < maxResults) {
        const currentDavPath = queue.shift();
        let raw;
        try {
          raw = await this.client.getDirectoryContents(currentDavPath, { deep: false, glob: "*" });
        } catch (e) {
          const status = this._statusFromError(e);
          // 部分服务对某些路径返回 403/501，这里跳过该分支避免整个搜索失败
          if (status === ApiStatus.FORBIDDEN || status === ApiStatus.NOT_IMPLEMENTED) {
            continue;
          }
          throw e;
        }

        const entries = Array.isArray(raw) ? raw : raw?.data || [];

        for (const item of entries) {
          if (results.length >= maxResults) break;

          const filename = item.filename || "";
          const rawBasename = item.basename || this._basename(filename);
          const basename = this._decodeComponent(rawBasename);
          if (!basename) continue;

          const isDirectory = item.type === "directory";

          // 名称模糊匹配
          if (basename.toLowerCase().includes(q)) {
            // 还原相对于 default_folder 的子路径
            const decodedFilename = this._decodeComponent(filename);
            const normalizedFilename = this._normalize(decodedFilename);
            let relative = normalizedFilename;
            if (base && normalizedFilename.startsWith(base)) {
              relative = normalizedFilename.slice(base.length);
            }
            if (relative && !relative.startsWith("/")) {
              relative = "/" + relative;
            }

            const mountRoot = (mount.mount_path || "/").replace(/\/+$/, "") || "/";
            const fullPath = `${mountRoot}${relative || "/"}`.replace(/\/+/, "/");

            const type = isDirectory ? FILE_TYPES.FOLDER : await GetFileType(basename, db);
            const typeName = isDirectory ? "folder" : await getFileTypeName(basename, db);
            const rawMime = item.mime || null;
            const mime = !isDirectory && rawMime === "httpd/unix-directory" ? null : rawMime;

            results.push({
              name: basename,
              path: fullPath,
              size: isDirectory ? 0 : item.size || 0,
              modified: item.lastmod ? new Date(item.lastmod).toISOString() : new Date().toISOString(),
              isDirectory,
              mimetype: mime || (isDirectory ? "application/x-directory" : undefined),
              type,
              typeName,
              mount_id: mount.id,
              mount_name: mount.name,
              storage_type: mount.storage_type,
            });
          }

          // 收集子目录，使用浅层 PROPFIND 递归遍历
          if (isDirectory) {
            const nextPath = item.filename || filename;
            if (nextPath) {
              const normalizedNext = nextPath.endsWith("/") ? nextPath : `${nextPath}/`;
              queue.push(normalizedNext);
            }
          }
        }
      }

      return results;
    } catch (error) {
      throw this._wrapError(error, "WebDAV 搜索失败", this._statusFromError(error));
    }
  }

  /**
   * 获取存储驱动统计信息
   * @returns {Promise<Object>} 统计信息
   */
  async getStats() {
    this._ensureInitialized();
    return {
      type: this.type,
      endpoint: this.endpoint,
      defaultFolder: this.defaultFolder || "/",
      capabilities: this.capabilities,
      initialized: this.initialized,
      timestamp: new Date().toISOString(),
    };
  }

  async renameItem(oldPath, newPath, options = {}) {
    this._ensureInitialized();
    const { mount } = options;
    const fromSubPath = options.mount ? (options.subPath || "") : (options.subPath || oldPath);
    const from = this._buildDavPath(fromSubPath, false);
    const to = this._buildDavPath(this._relativeTargetPath(newPath, mount), false);
    try {
      await this.client.moveFile(from, to, { overwrite: false });
      return { success: true, source: from, target: to };
    } catch (error) {
      if (this._isNotSupported(error)) {
        throw new DriverError("WebDAV 不支持移动操作", { status: ApiStatus.NOT_IMPLEMENTED, expose: true });
      }
      throw this._wrapError(error, "重命名失败", this._statusFromError(error));
    }
  }

  async copyItem(sourcePath, targetPath, options = {}) {
    this._ensureInitialized();
    const { mount, skipExisting = false, _skipExistingChecked = false } = options;
    const fromSubPath = options.mount ? (options.subPath || "") : (options.subPath || sourcePath);
    const from = this._buildDavPath(fromSubPath, false);
    const to = this._buildDavPath(this._relativeTargetPath(targetPath, mount), false);

    // skipExisting 检查：在复制前检查目标文件是否已存在
    // 如果入口层已检查（_skipExistingChecked=true），跳过重复检查
    if (skipExisting && !_skipExistingChecked) {
      try {
        const targetExists = await this.client.exists(to);
        if (targetExists) {
          return {
            status: "skipped",
            skipped: true,
            reason: "target_exists",
            source: from,
            target: to,
            contentLength: 0,
          };
        }
      } catch (checkError) {
        // exists 检查失败时继续复制（降级处理）
        console.warn(`[WebDAV copyItem] skipExisting 检查失败 for ${to}:`, checkError?.message || checkError);
      }
    }

    try {
      await this.client.copyFile(from, to, { overwrite: false });
      return { status: "success", success: true, source: from, target: to };
    } catch (error) {
      if (this._isNotSupported(error)) {
        throw new DriverError("WebDAV 不支持复制操作", { status: ApiStatus.NOT_IMPLEMENTED, expose: true });
      }
      throw this._wrapError(error, "复制失败", this._statusFromError(error));
    }
  }

  async batchRemoveItems(paths, options = {}) {
    this._ensureInitialized();
    const results = [];
    for (const p of paths) {
      const sub = options.mount ? this._extractSubPath(p, options.mount) : options.subPath || p;
      const davPath = this._buildDavPath(sub, false);
      try {
        await this.client.deleteFile(davPath);
        results.push({ path: p, success: true });
      } catch (error) {
        results.push({ path: p, success: false, error: error?.message || "删除失败" });
      }
    }
    return {
      success: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success),
      results,
    };
  }

  async exists(path, options = {}) {
    this._ensureInitialized();
    const sub = options.mount ? (options.subPath || "") : (options.subPath || path);
    const davPath = this._buildDavPath(sub, false);
    try {
      return await this.client.exists(davPath);
    } catch {
      return false;
    }
  }

  async stat(path, options = {}) {
    const sub = options.mount ? (options.subPath || "") : (options.subPath || path);
    return await this.client.stat(this._buildDavPath(sub, false));
  }

  async generatePresignedUrl() {
    throw new DriverError("WebDAV 不支持预签名直链", { status: ApiStatus.NOT_IMPLEMENTED, expose: true });
  }

  /**
   * WebDAV 不提供存储直链能力（DirectLink），所有直链/代理决策由上层通过 url_proxy 或 native_proxy 处理。
   */
  async generateDownloadUrl(path, options = {}) {
    this._ensureInitialized();
    throw new DriverError("WebDAV 不支持存储直链 URL", {
      status: ApiStatus.NOT_IMPLEMENTED,
      expose: true,
    });
  }

  async generateProxyUrl(path, options = {}) {
    const { request, download = false, channel = "web" } = options;

    // 驱动层仅负责根据路径构造基础代理URL，不再做签名与策略判断
    const proxyUrl = buildFullProxyUrl(request, path, download);

    return {
      url: proxyUrl,
      type: "proxy",
      channel,
    };
  }

  /**
   * 上游 HTTP 能力：为 WebDAV 生成可由反向代理/Worker 直接访问的上游请求信息
   * - 返回值仅描述 data plane 访问方式，不做权限与签名判断
   * - headers 中只包含访问 WebDAV 必需的认证头，由外层按需附加 Range 等业务头
   * @param {string} path 挂载视图下的完整路径
   * @param {Object} [options]
   * @param {string} [options.subPath] 挂载内相对路径（优先使用）
   * @returns {Promise<{ url: string, headers: Record<string,string[]> }>}
   */
  async generateUpstreamRequest(path, options = {}) {
    this._ensureInitialized();

    const { subPath } = options;
    const relativePath = subPath || path;
    const davPath = this._buildDavPath(relativePath, false);
    const url = this._buildRequestUrl(davPath);

    /** @type {Record<string,string[]>} */
    const headers = {};
    const auth = this._basicAuthHeader();
    if (auth) {
      headers["Authorization"] = [auth];
    }

    return {
      url,
      headers,
    };
  }

  supportsProxyMode() {
    return true;
  }

  getProxyConfig() {
    return {
      enabled: this.supportsProxyMode(),
    };
  }

  /**
   * 构建 WebDAV 路径
   * - 仅基于挂载视图下的 subPath
   * - 远端根目录由 endpoint_url 本身的路径决定
   */
  _buildDavPath(subPath, ensureDir = false) {
    let raw = subPath || "";
    try {
      raw = decodeURI(raw);
    } catch {}
    const cleaned = this._normalize(raw);
    let full = cleaned;

    if (full && !full.startsWith("/")) {
      full = `/${full}`;
    }

    if (ensureDir) {
      if (!full) {
        full = "/";
      }
      if (!full.endsWith("/")) {
        full += "/";
      }
    }

    if (!full) {
      return "/";
    }

    return full;
  }

  _normalize(p) {
    const normalized = p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");
    const parts = normalized.split("/").filter(Boolean);
    for (const seg of parts) {
      if (seg === "..") {
        throw new DriverError("路径不允许包含 ..", { status: ApiStatus.FORBIDDEN, expose: true });
      }
    }
    return parts.join("/");
  }

  _decodeComponent(value) {
    if (!value) return value;
    try {
      return decodeURIComponent(value);
    } catch {
      try {
        return decodeURI(value);
      } catch {
        return value;
      }
    }
  }

  _joinMountPath(basePath, name, isDirectory) {
    const normalizedBase = basePath.endsWith("/") ? basePath : basePath + "/";
    return `${normalizedBase}${name}${isDirectory ? "/" : ""}`;
  }

  _buildMountPath(mount, subPath = "") {
    const mountRoot = mount?.mount_path || "/";
    const normalized = subPath.startsWith("/") ? subPath : `/${subPath}`;
    const compact = normalized.replace(/\/+/g, "/");
    return mountRoot.endsWith("/") ? `${mountRoot.replace(/\/+$/, "")}${compact}` : `${mountRoot}${compact}`;
  }

  _relativeTargetPath(targetPath, mount) {
    if (!targetPath) return targetPath;
    let relative = targetPath;
    if (mount?.mount_path && targetPath.startsWith(mount.mount_path)) {
      relative = targetPath.slice(mount.mount_path.length);
    }
    relative = relative.startsWith("/") ? relative.slice(1) : relative;
    return relative;
  }

  _basename(p) {
    const parts = (p || "").split("/").filter(Boolean);
    return parts.pop() || "";
  }

  _buildRequestUrl(davPath) {
    const base = this.endpoint.endsWith("/") ? this.endpoint.slice(0, -1) : this.endpoint;
    return `${base}${davPath}`;
  }

  _extractSubPath(fullPath, mount) {
    if (!fullPath) return "";
    if (mount?.mount_path && fullPath.startsWith(mount.mount_path)) {
      return fullPath.slice(mount.mount_path.length);
    }
    return fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
  }

  _basicAuthHeader() {
    const raw = `${this.username}:${this.decryptedPassword || ""}`;
    const encoded =
      typeof btoa === "function"
        ? btoa(raw)
        : Buffer.from(raw).toString("base64");
    return `Basic ${encoded}`;
  }

  _isNotFound(error) {
    const msg = error?.message || "";
    return msg.includes("404") || msg.includes("not found");
  }

  _isNotSupported(error) {
    const msg = error?.message?.toString?.() || "";
    return msg.includes("405") || msg.includes("501");
  }

  _isConflict(error) {
    const msg = error?.message?.toString?.() || "";
    return error?.statusCode === 409 || msg.includes("409");
  }

  _statusFromError(error) {
    const msg = error?.message || "";
    if (msg.includes("401") || msg.includes("403")) return ApiStatus.FORBIDDEN;
    if (msg.includes("404")) return ApiStatus.NOT_FOUND;
    if (msg.includes("405") || msg.includes("501")) return ApiStatus.NOT_IMPLEMENTED;
    return ApiStatus.INTERNAL_ERROR;
  }

  _wrapError(error, message, status = ApiStatus.INTERNAL_ERROR) {
    if (error instanceof DriverError || error instanceof AppError) return error;
    return new DriverError(message, { status, expose: status < 500, details: { cause: error?.message } });
  }

  async _normalizeBody(file, options = {}) {
    // 处理 Blob/File/ArrayBuffer/Uint8Array/Buffer/ReadableStream（Node 或 Web API）
    if (file === null || file === undefined) {
      throw new DriverError("上传体为空", { status: ApiStatus.BAD_REQUEST, expose: true });
    }

    // Buffer 或 Uint8Array
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(file)) {
      return { body: file, length: file.length, contentType: options.contentType || null };
    }
    if (file instanceof Uint8Array) {
      return { body: file, length: file.byteLength, contentType: options.contentType || null };
    }

    // ArrayBuffer
    if (file instanceof ArrayBuffer) {
      const buf = Buffer.from(file);
      return { body: buf, length: buf.length, contentType: options.contentType || null };
    }

    // Web File/Blob
    if (typeof file.arrayBuffer === "function") {
      const buf = Buffer.from(await file.arrayBuffer());
      const length = file.size ?? buf.length;
      const type = options.contentType || file.type || null;
      return { body: buf, length, contentType: type };
    }

    // ReadableStream (Node 流或 Web API ReadableStream，例如 Cloudflare/Hono 请求体)
    const isNodeStream = file && (typeof file.pipe === "function" || file.readable);
    const isWebStream = file && typeof file.getReader === "function";
    if (isNodeStream || isWebStream) {
      // Node 流在 Node 环境下可以直接传递，由 webdav 客户端负责消费
      if (isNodeStream && !isWebStream) {
        const length = options.fileSize || options.contentLength || null;
        const type = options.contentType || null;
        return { body: file, length, contentType: type };
      }

      // Web API ReadableStream（Cloudflare/Hono 环境）：
      // 为避免 webdav 客户端与 WebStream 兼容性问题，这里统一读取为 Buffer 再上传，
      // 以确保上游存储端能够收到完整内容。
      try {
        const reader = file.getReader();
        /** @type {Uint8Array[]} */
        const chunks = [];
        let total = 0;
        // 按 Web Streams 标准逐块读取
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.length) {
            chunks.push(value);
            total += value.length;
          }
        }
        const buf = Buffer.allocUnsafe(total);
        let offset = 0;
        for (const chunk of chunks) {
          buf.set(chunk, offset);
          offset += chunk.length;
        }
        const length = total;
        const type = options.contentType || null;
        return { body: buf, length, contentType: type };
      } catch (e) {
        throw new DriverError("读取上传流失败", {
          status: ApiStatus.INTERNAL_ERROR,
          expose: false,
          details: { cause: e?.message || String(e) },
        });
      }
    }

    // 字符串
    if (typeof file === "string") {
      const buf = Buffer.from(file);
      return { body: buf, length: buf.length, contentType: options.contentType || "text/plain" };
    }

    throw new DriverError("不支持的上传数据类型", { status: ApiStatus.BAD_REQUEST, expose: true });
  }

  async _ensureParentDirectories(davPath) {
    // davPath like /a/b/c.txt -> need ensure /a and /a/b
    const trimmed = davPath.endsWith("/") ? davPath.slice(0, -1) : davPath;
    const parts = trimmed.split("/").filter(Boolean);
    if (parts.length <= 1) return;
    const dirs = [];
    for (let i = 0; i < parts.length - 1; i++) {
      const prefix = "/" + parts.slice(0, i + 1).join("/") + "/";
      dirs.push(prefix);
    }
    for (const dir of dirs) {
      try {
        await this.client.createDirectory(dir);
      } catch (e) {
        // 如果目录已存在则忽略
        if (this._isConflict(e) || this._isNotFound(e) || this._isNotSupported(e)) {
          // _isNotFound 对某些服务返回 409/404 混用，_isNotSupported 对 405/501，均视为无害
          continue;
        }
        throw e;
      }
    }
  }

  /**
   * 解析目标路径：当传入目录时自动拼接文件名
   */
  _resolveTargetDavPath(subPath, path, file, options = {}) {
    const fileName =
      options.filename ||
      options.fileName ||
      file?.name ||
      path.split("/").filter(Boolean).pop() ||
      "unnamed_file";

    const normalizedSub = this._normalize(subPath || "");
    const base = this._normalize(this.defaultFolder || "");

    const isFilePath = this._isCompleteFilePath(normalizedSub, fileName);
    let joined = "";
    if (base) joined = base;
    if (normalizedSub) joined = joined ? `${joined}/${normalizedSub}` : normalizedSub;

    if (!isFilePath) {
      joined = joined ? `${joined}/${fileName}` : fileName;
    }

    const withPrefix = joined.startsWith("/") ? joined : `/${joined}`;
    return withPrefix;
  }

  _isCompleteFilePath(relativePath, originalFileName) {
    if (!relativePath || !originalFileName) return false;
    const relLast = relativePath.split("/").filter(Boolean).pop();
    if (!relLast) return false;
    const rel = this._splitName(relLast);
    const ori = this._splitName(originalFileName);
    if (!rel.ext) {
      return rel.name === ori.name;
    }
    return rel.ext === ori.ext && rel.name === ori.name;
  }

  _splitName(name = "") {
    const idx = name.lastIndexOf(".");
    if (idx <= 0) {
      return { name, ext: "" };
    }
    return { name: name.slice(0, idx), ext: name.slice(idx) };
  }
}
