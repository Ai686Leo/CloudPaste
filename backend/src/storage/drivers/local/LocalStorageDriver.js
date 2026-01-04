/**
 * LocalStorageDriver
 *
 * 本地文件系统存储驱动：
 * - 仅在 Node/Docker 环境下可用（依赖 Node.js fs/path 能力）
 * - 通过 root_path 作为监狱根目录，所有操作必须限制在该目录内
 * - 严格遵守 storage-driver READER / WRITER / ATOMIC 契约与返回结构
 */

import fs from "fs";
import path from "path";

import { BaseDriver, CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { ApiStatus, FILE_TYPES } from "../../../constants/index.js";
import { DriverError, AppError, NotFoundError, ValidationError } from "../../../http/errors.js";
import { isCloudflareWorkerEnvironment, isNodeJSEnvironment } from "../../../utils/environmentUtils.js";
import { getEffectiveMimeType } from "../../../utils/fileUtils.js";
import { buildFileInfo } from "../../utils/FileInfoBuilder.js";
import { createNodeStreamDescriptor } from "../../streaming/StreamDescriptorUtils.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";

export class LocalStorageDriver extends BaseDriver {
  /**
   * @param {Object} config  存储配置对象（应包含 root_path 等字段）
   * @param {string} encryptionSecret 加密密钥（为保持接口一致，LOCAL 当前不使用）
   */
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "LOCAL";
    this.encryptionSecret = encryptionSecret;
    this.capabilities = [
      CAPABILITIES.READER,
      CAPABILITIES.WRITER,
      CAPABILITIES.ATOMIC,
      CAPABILITIES.PROXY,
    ];

    /** @type {string|null} root_path 规范化后的监狱根目录 */
    this.rootPath = null;

    // 是否启用“磁盘配额读取”
    this.enableDiskUsage = config?.enable_disk_usage === 1;
  }

  /**
   * 初始化 LocalStorageDriver
   * - 校验运行环境（必须是 Node.js 且非 Cloudflare Worker）
   * - 校验并规范化 root_path
   */
  async initialize() {
    const inWorker = isCloudflareWorkerEnvironment();
    const inNode = isNodeJSEnvironment();

    if (inWorker || !inNode) {
      throw new DriverError("LOCAL 驱动仅在 Node/Docker 环境可用", {
        status: ApiStatus.INTERNAL_ERROR,
        code: "DRIVER_ERROR.LOCAL_UNSUPPORTED_ENV",
        expose: false,
        details: {
          isCloudflareWorkerEnvironment: inWorker,
          isNodeJSEnvironment: inNode,
        },
      });
    }

    const rootPathRaw = this.config?.root_path;
    if (!rootPathRaw || typeof rootPathRaw !== "string") {
      throw new DriverError("LOCAL 驱动缺少必填配置 root_path", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.LOCAL_INVALID_CONFIG",
        expose: true,
      });
    }

    if (!path.isAbsolute(rootPathRaw)) {
      throw new DriverError("LOCAL 驱动 root_path 必须是绝对路径", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.LOCAL_INVALID_ROOT_PATH",
        expose: true,
      });
    }

    const resolvedRoot = path.resolve(rootPathRaw);

    // 解析权限配置（八进制字符串 -> 整数）
    // 仅使用单一配置 dir_permission，同时应用于目录与文件，默认 0777（主要面向单机自托管场景）
    const basePermission = this._parseOctalPermission(this.config?.dir_permission, 0o777);
    // 是否允许在根目录不存在时自动创建（默认关闭，保持显式运维语义）
    const autoCreateRoot =
      this.config && Object.prototype.hasOwnProperty.call(this.config, "auto_create_root")
        ? this.config.auto_create_root === 1
        : false;

    let stat;
    try {
      stat = await fs.promises.stat(resolvedRoot);
    } catch (error) {
      if (error?.code === "ENOENT") {
        // 根目录不存在时，根据 auto_create_root 决定是否自动创建
        if (!autoCreateRoot) {
          throw new DriverError("LOCAL 驱动 root_path 不存在，请先在宿主机上手动创建该目录", {
            status: ApiStatus.BAD_REQUEST,
            code: "DRIVER_ERROR.LOCAL_ROOT_NOT_FOUND",
            expose: true,
            details: { path: resolvedRoot },
          });
        }

        try {
          await fs.promises.mkdir(resolvedRoot, { recursive: true, mode: basePermission });
          stat = await fs.promises.stat(resolvedRoot);
        } catch (createError) {
          throw new DriverError("LOCAL 驱动 root_path 不存在且自动创建失败", {
            status: ApiStatus.INTERNAL_ERROR,
            code: "DRIVER_ERROR.LOCAL_ROOT_CREATE_FAILED",
            expose: true,
            details: { path: resolvedRoot, cause: createError?.message },
          });
        }
      } else {
        throw new DriverError("LOCAL 驱动 root_path 不存在或不可访问", {
          status: ApiStatus.INTERNAL_ERROR,
          code: "DRIVER_ERROR.LOCAL_ROOT_NOT_ACCESSIBLE",
          expose: false,
          details: { path: resolvedRoot, cause: error?.message },
        });
      }
    }

    if (!stat.isDirectory()) {
      throw new DriverError("LOCAL 驱动 root_path 必须是目录", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.LOCAL_ROOT_NOT_DIRECTORY",
        expose: true,
      });
    }

    // 可读检查
    try {
      await fs.promises.access(resolvedRoot, fs.constants.R_OK);
    } catch (error) {
      throw new DriverError("LOCAL 驱动 root_path 不可读", {
        status: ApiStatus.FORBIDDEN,
        code: "DRIVER_ERROR.LOCAL_ROOT_NOT_READABLE",
        expose: true,
        details: { path: resolvedRoot, cause: error?.message },
      });
    }

    // 写入能力只在非只读配置下强制检查
    if (!this.config?.readonly) {
      try {
        await fs.promises.access(resolvedRoot, fs.constants.W_OK);
      } catch (error) {
        throw new DriverError("LOCAL 驱动 root_path 不可写", {
          status: ApiStatus.FORBIDDEN,
          code: "DRIVER_ERROR.LOCAL_ROOT_NOT_WRITABLE",
          expose: true,
          details: { path: resolvedRoot, cause: error?.message },
        });
      }
    }

    this.rootPath = resolvedRoot;

    // 将统一的权限配置应用到目录与文件
    this.dirPermission = basePermission;
    this.filePermission = basePermission;

    // 解析回收站路径配置
    this.trashPath = null;
    if (this.config?.trash_path) {
      const trashPathRaw = this.config.trash_path;
      // 支持相对路径（相对于 root_path）和绝对路径
      const resolvedTrash = path.isAbsolute(trashPathRaw)
        ? path.resolve(trashPathRaw)
        : path.resolve(resolvedRoot, trashPathRaw);
      this.trashPath = resolvedTrash;
    }

    this.initialized = true;
  }

  /**
   * 获取存储驱动统计信息（可选实现）
   * - 对 LOCAL：这里返回的是“宿主机磁盘/分区”的总量与可用量（类似 df），不是“目录占用”
   * - 目录占用（local_fs）属于 computed_usage 的来源，由 StorageUsageService 扫 root_path 计算
   *
   * @returns {Promise<Object>}
   */
  async getStats() {
    this._ensureInitialized();

    const base = {
      type: this.type,
      capabilities: this.capabilities,
      initialized: this.initialized,
      rootPath: this.rootPath,
      timestamp: new Date().toISOString(),
      enableDiskUsage: this.enableDiskUsage,
    };

    if (!this.enableDiskUsage) {
      return {
        ...base,
        supported: false,
        message: "LOCAL 磁盘占用统计未启用（enable_disk_usage = false）",
      };
    }

    // Node.js 18+ 支持 fs.promises.statfs；用于读取文件系统容量（Windows/Linux/macOS）
    if (typeof fs.promises.statfs !== "function") {
      return {
        ...base,
        supported: false,
        message: "当前 Node.js 版本不支持 statfs，无法读取磁盘容量信息",
      };
    }

    try {
      const st = await fs.promises.statfs(this.rootPath);
      const frsize = Number(st?.frsize || st?.bsize || 0);
      const blocks = Number(st?.blocks || 0);
      const bavail = Number(st?.bavail || 0);
      if (!Number.isFinite(frsize) || !Number.isFinite(blocks) || frsize <= 0 || blocks <= 0) {
        return {
          ...base,
          supported: false,
          message: "读取磁盘容量信息失败（statfs 返回值无效）",
        };
      }

      const totalBytes = Math.max(0, Math.trunc(frsize * blocks));
      const remainingBytes = Math.max(0, Math.trunc(frsize * bavail));
      const usedBytes = totalBytes > 0 ? Math.max(0, totalBytes - remainingBytes) : null;

      let usagePercent = null;
      if (totalBytes > 0 && usedBytes != null) {
        usagePercent = Math.min(100, Math.round((usedBytes / totalBytes) * 100));
      }

      return {
        ...base,
        supported: true,
        quota: {
          raw: st,
          totalBytes,
          usedBytes,
          remainingBytes,
          usagePercent,
        },
      };
    } catch (error) {
      return {
        ...base,
        supported: false,
        message: error?.message || String(error),
      };
    }
  }

  /**
   * 解析八进制权限字符串
   * @param {string|undefined} value - 权限字符串（如 "0755"）
   * @param {number} defaultValue - 默认值
   * @returns {number} 解析后的权限整数
   */
  _parseOctalPermission(value, defaultValue) {
    if (!value) return defaultValue;
    const parsed = parseInt(String(value), 8);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * 确保当前配置允许写操作（非只读）
   * - 只读模式下所有写入/删除类操作应立即失败
   */
  _ensureWritable() {
    if (this.config?.readonly) {
      throw new DriverError("LOCAL 存储当前为只读模式，禁止写入和删除操作", {
        status: ApiStatus.FORBIDDEN,
        code: "DRIVER_ERROR.LOCAL_READONLY",
        expose: true,
      });
    }
  }

  /**
   * 将文件/目录移动到回收站
   * @param {string} sourcePath - 源文件/目录的完整 OS 路径
   * @param {boolean} isDirectory - 是否为目录
   */
  async _moveToTrash(sourcePath, isDirectory) {
    this._ensureWritable();
    if (!this.trashPath) {
      throw new DriverError("回收站路径未配置", {
        status: ApiStatus.INTERNAL_ERROR,
        code: "DRIVER_ERROR.LOCAL_TRASH_NOT_CONFIGURED",
        expose: false,
      });
    }

    // 确保回收站目录存在
    try {
      await fs.promises.mkdir(this.trashPath, { recursive: true, mode: this.dirPermission });
    } catch (error) {
      throw new DriverError("创建回收站目录失败", {
        status: ApiStatus.INTERNAL_ERROR,
        code: "DRIVER_ERROR.LOCAL_TRASH_CREATE_FAILED",
        expose: false,
        details: { path: this.trashPath, cause: error?.message },
      });
    }

    // 生成回收站内的唯一文件名（原名 + 时间戳）
    const baseName = path.basename(sourcePath);
    const timestamp = Date.now();
    const trashName = `${baseName}.${timestamp}`;
    const trashTarget = path.join(this.trashPath, trashName);

    try {
      // 尝试使用 rename（同一文件系统内高效移动）
      await fs.promises.rename(sourcePath, trashTarget);
    } catch (renameError) {
      // 如果 rename 失败（跨文件系统），回退到复制+删除
      if (renameError.code === "EXDEV") {
        if (isDirectory) {
          await this._copyDirectoryRecursive(sourcePath, trashTarget);
          await fs.promises.rm(sourcePath, { recursive: true, force: true });
        } else {
          await fs.promises.copyFile(sourcePath, trashTarget);
          await fs.promises.rm(sourcePath, { force: true });
        }
      } else {
        throw new DriverError("移动到回收站失败", {
          status: ApiStatus.INTERNAL_ERROR,
          code: "DRIVER_ERROR.LOCAL_TRASH_MOVE_FAILED",
          expose: false,
          details: { source: sourcePath, target: trashTarget, cause: renameError?.message },
        });
      }
    }
  }

  // ========== READER 能力：listDirectory / getFileInfo / downloadFile ==========

  /**
   * 列出目录内容
   * @param {string} subPath  挂载内子路径（以 / 开头，目录以 / 结尾）
   * @param {Object} ctx      上下文（mount/path/subPath/db 等）
   */
  async listDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, path: fsPath, db } = ctx;

    const effectiveSubPath = subPath || "/";
    const { fullPath } = await this._resolveLocalPath(effectiveSubPath, { mustBeDirectory: true });

    let entries;
    try {
      entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
    } catch (error) {
      throw this._wrapFsError(error, "列出目录失败");
    }

    const basePath = fsPath;

    const items = await Promise.all(
      entries.map(async (dirent) => {
        const name = dirent.name;
        const sub = this._joinSubPath(effectiveSubPath, name, dirent.isDirectory());

        // 统一通过 _resolveLocalPath 做越界与 symlink 检查
        const { fullPath: entryOsPath, stat } = await this._resolveLocalPath(sub || "/", {
          mustBeDirectory: dirent.isDirectory(),
        });

        const isDirectory = stat.isDirectory();
        const size = isDirectory ? null : stat.size || 0;
        const modified = stat.mtime ? new Date(stat.mtime) : null;

        const itemMountPath = this._joinMountPath(basePath, name, isDirectory);

        const info = await buildFileInfo({
          fsPath: itemMountPath,
          name,
          isDirectory,
          size,
          modified,
          mimetype: isDirectory ? "application/x-directory" : undefined,
          mount,
          storageType: mount?.storage_type,
          db,
        });

        return {
          ...info,
          isVirtual: false,
        };
      })
    );

    return {
      path: fsPath,
      type: "directory",
      isRoot: effectiveSubPath === "" || effectiveSubPath === "/",
      isVirtual: false,
      mount_id: mount?.id,
      storage_type: mount?.storage_type,
      items,
    };
  }

  /**
   * 获取文件或目录信息
   * @param {string} subPath 挂载内子路径（以 / 开头）
   * @param {Object} ctx     上下文（mount/path/subPath/db 等）
   */
  async getFileInfo(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, path: fsPath, db } = ctx;

    const effectiveSubPath = subPath || "/";
    const { fullPath, stat } = await this._resolveLocalPath(effectiveSubPath, { mustBeDirectory: false });

    const isDirectory = stat.isDirectory();
    const name = this._basename(fsPath);
    const size = isDirectory ? null : stat.size || 0;
    const modified = stat.mtime ? new Date(stat.mtime) : null;
    const mimetype = isDirectory ? "application/x-directory" : undefined;

    // fullPath 当前未直接暴露，仅用于调试时可从 details 中取
    void fullPath;

    return await buildFileInfo({
      fsPath,
      name,
      isDirectory,
      size,
      modified,
      mimetype,
      mount,
      storageType: mount?.storage_type,
      db,
    });
  }

  /**
   * 下载文件 - 返回 StorageStreamDescriptor
   * @param {string} subPath 挂载内子路径
   * @param {Object} ctx     上下文（mount/path/subPath/request 等）
   * @returns {Promise<import('../../streaming/types.js').StorageStreamDescriptor>}
   */
  async downloadFile(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, path: fsPath } = ctx;

    const effectiveSubPath = subPath || "/";
    const { fullPath, stat } = await this._resolveLocalPath(effectiveSubPath, { mustBeDirectory: false });

    if (stat.isDirectory()) {
      throw new DriverError("无法直接下载目录", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.LOCAL_IS_DIRECTORY",
        expose: true,
      });
    }

    const fileName = this._basename(fsPath) || "file";
    const contentType = getEffectiveMimeType(null, fileName) || "application/octet-stream";
    const size = stat.size ?? 0;
    const lastModified = stat.mtime ? new Date(stat.mtime) : new Date();
    const etag = `"${lastModified.getTime()}-${size}"`;

    // 保存 fullPath 供流工厂使用
    const filePath = fullPath;

    return createNodeStreamDescriptor({
      size,
      contentType,
      etag,
      lastModified,
      async openStream() {
        return fs.createReadStream(filePath);
      },
      async openRangeStream(range) {
        const { start, end } = range;
        return fs.createReadStream(filePath, {
          start,
          end: end !== undefined ? end : undefined,
        });
      },
    });
  }

  // ========== WRITER / ATOMIC 能力：uploadFile / createDirectory / updateFile / batchRemoveItems / renameItem / copyItem ==========

  /**
   * 统一上传入口（文件 / 流）
   * @param {string} subPath       目标子路径（挂载内）
   * @param {any}    fileOrStream  数据源（ReadableStream/Node Stream/Buffer/File/Blob/string 等）
   * @param {Object} ctx           上下文（mount/path/subPath/db/filename/contentType/contentLength 等）
   */
  async uploadFile(subPath, fileOrStream, ctx = {}) {
    this._ensureInitialized();
    this._ensureWritable();

    const { mount, path: fsPath, filename } = ctx;
    const effectiveSubPath = subPath ?? "";
    const name = filename || this._basename(fsPath);

    const targetSubPath = this._resolveTargetSubPath(effectiveSubPath, name);
    const targetOsPath = await this._buildTargetPath(targetSubPath);

    try {
      await this._writeBodyToFile(targetOsPath, fileOrStream);
      // storagePath 语义对齐：
      // - FS（mount 视图）：返回挂载路径（/mount/.../file）
      // - storage-first（ObjectStore / ShareUpload）：返回对象 key（相对 root_path 的子路径）
      const storagePath = mount ? this._buildMountPath(mount, targetSubPath) : targetSubPath;
      return { success: true, storagePath, message: undefined };
    } catch (error) {
      throw this._wrapFsError(error, "上传文件失败");
    }
  }

  /**
   * 更新文件内容（覆盖写入，语义与 uploadFile 一致）
   * @param {string} subPath  子路径（subPath-only）
   * @param {string|Uint8Array|ArrayBuffer|ReadableStream|Blob|File} content 新内容
   * @param {Object} ctx      上下文（mount/path/subPath/db 等）
   */
  async updateFile(subPath, content, ctx = {}) {
    this._ensureInitialized();
    this._ensureWritable();
    const fsPath = ctx?.path;
    if (typeof fsPath !== "string") {
      throw new ValidationError("LOCAL.updateFile: 缺少 ctx.path（FS 视图路径）", { status: ApiStatus.INTERNAL_ERROR });
    }

    const effectiveSubPath = subPath || "";
    const targetSubPath = this._resolveTargetSubPath(effectiveSubPath, this._basename(fsPath));
    const targetOsPath = await this._buildTargetPath(targetSubPath);

    try {
      await this._writeBodyToFile(targetOsPath, content);
      return {
        success: true,
        path: fsPath,
        message: "文件更新成功",
      };
    } catch (error) {
      throw this._wrapFsError(error, "更新文件失败");
    }
  }

  /**
   * 创建目录
   * @param {string} subPath  目录子路径（挂载内）
   * @param {Object} ctx      上下文（mount/path/subPath 等）
   */
  async createDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    this._ensureWritable();
    const { path: fsPath } = ctx;

    const effectiveSubPath = subPath ?? "";
    const targetOsPath = await this._buildTargetPath(effectiveSubPath || "/");

    try {
      let alreadyExists = false;
      try {
        const stat = await fs.promises.stat(targetOsPath);
        if (stat.isDirectory()) {
          alreadyExists = true;
        }
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }

      if (!alreadyExists) {
        await fs.promises.mkdir(targetOsPath, { recursive: true, mode: this.dirPermission });
      }

      return { success: true, path: fsPath, alreadyExists };
    } catch (error) {
      throw this._wrapFsError(error, "创建目录失败");
    }
  }

  /**
   * 批量删除文件/目录
   * @param {Array<string>} subPaths 子路径数组（挂载内）
   * @param {Object} ctx           上下文（mount/paths 等）
   */
  async batchRemoveItems(subPaths, ctx = {}) {
    this._ensureInitialized();
    this._ensureWritable();
    const { paths } = ctx;

    const result = {
      success: 0,
      failed: [],
      results: [],
    };

    if (!Array.isArray(subPaths) || subPaths.length === 0) {
      return result;
    }

    for (let i = 0; i < subPaths.length; i++) {
      const sub = subPaths[i];
      const p = Array.isArray(paths) ? paths[i] : null;
      try {
        const { fullPath, stat } = await this._resolveLocalPath(sub || "/", { mustBeDirectory: false });

        // 如果配置了回收站路径，移动到回收站而非永久删除
        if (this.trashPath) {
          await this._moveToTrash(fullPath, stat.isDirectory());
        } else {
          // 无回收站配置，直接永久删除
          if (stat.isDirectory()) {
            await fs.promises.rm(fullPath, { recursive: true, force: true });
          } else {
            await fs.promises.rm(fullPath, { force: true });
          }
        }
        result.success += 1;
        result.results.push({ path: p || sub, success: true });
      } catch (error) {
        const wrapped =
          error instanceof AppError || error instanceof DriverError ? error : this._wrapFsError(error, "删除失败");
        result.failed.push({ path: p || sub, error: wrapped.message });
        result.results.push({ path: p || sub, success: false, error: wrapped.message });
      }
    }

    return result;
  }

  /**
   * 重命名文件或目录（同挂载内）
   * @param {string} oldSubPath 原子路径（挂载内）
   * @param {string} newSubPath 新子路径（挂载内）
   * @param {Object} ctx 上下文（mount/oldPath/newPath 等）
   */
  async renameItem(oldSubPath, newSubPath, ctx = {}) {
    this._ensureInitialized();
    this._ensureWritable();
    const { oldPath, newPath } = ctx;

    try {
      const { fullPath: sourceOsPath } = await this._resolveLocalPath(oldSubPath || "/", { mustBeDirectory: false });
      const targetOsPath = await this._buildTargetPath(newSubPath || "/");

      await fs.promises.mkdir(path.dirname(targetOsPath), { recursive: true });
      await fs.promises.rename(sourceOsPath, targetOsPath);

      return {
        success: true,
        source: oldPath,
        target: newPath,
        message: undefined,
      };
    } catch (error) {
      const wrapped = this._wrapFsError(error, "重命名失败");
      return {
        success: false,
        source: oldPath,
        target: newPath,
        message: wrapped.message,
      };
    }
  }

  /**
   * 复制单个文件或目录（同挂载内）
   * @param {string} sourceSubPath 源子路径（挂载内）
   * @param {string} targetSubPath 目标子路径（挂载内）
   * @param {Object} ctx           上下文（mount/sourcePath/targetPath/skipExisting 等）
   * @returns {Promise<{status:string, source:string, target:string, message?:string, skipped?:boolean, reason?:string}>}
   */
  async copyItem(sourceSubPath, targetSubPath, ctx = {}) {
    this._ensureInitialized();
    this._ensureWritable();
    const { sourcePath, targetPath, skipExisting = false } = ctx;

    try {
      const { fullPath: sourceOsPath, stat } = await this._resolveLocalPath(sourceSubPath || "/", {
        mustBeDirectory: false,
      });
      const targetOsPath = await this._buildTargetPath(targetSubPath || "/");

      let targetExists = false;
      try {
        const tStat = await fs.promises.stat(targetOsPath);
        if (tStat && (tStat.isFile() || tStat.isDirectory())) {
          targetExists = true;
        }
      } catch {
        targetExists = false;
      }

      if (targetExists && skipExisting) {
        return {
          status: "skipped",
          source: sourcePath,
          target: targetPath,
          skipped: true,
          reason: "目标已存在且 skipExisting=true",
        };
      }

      if (stat.isDirectory()) {
        await this._copyDirectoryRecursive(sourceOsPath, targetOsPath);
      } else {
        await fs.promises.mkdir(path.dirname(targetOsPath), { recursive: true });
        await fs.promises.copyFile(sourceOsPath, targetOsPath);
      }

      return {
        status: "success",
        source: sourcePath,
        target: targetPath,
        skipped: false,
      };
    } catch (error) {
      const wrapped = this._wrapFsError(error, "复制文件或目录失败");
      return {
        status: "failed",
        source: sourcePath,
        target: targetPath,
        skipped: false,
        message: wrapped.message,
      };
    }
  }

  // ========== BaseDriver 必需方法：stat / exists ==========

  /**
   * 获取文件或目录状态信息
   * @param {string} subPath  挂载内子路径（subPath-only）
   * @param {Object} ctx      上下文选项（mount/path/subPath/...）
   */
  async stat(subPath, ctx = {}) {
    return await this.getFileInfo(subPath, ctx);
  }

  /**
   * 检查文件或目录是否存在
   * @param {string} subPath  挂载内子路径（subPath-only）
   * @param {Object} ctx      上下文选项（mount/path/subPath/...）
   */
  async exists(subPath, ctx = {}) {
    try {
      await this.getFileInfo(subPath, ctx);
      return true;
    } catch (error) {
      if (error instanceof NotFoundError) {
        return false;
      }
      throw error;
    }
  }

  // ========== PROXY 能力：generateProxyUrl / supportsProxyMode / getProxyConfig ==========

  /**
   * 生成本地 /api/p 代理 URL
   * @param {string} subPath  挂载内子路径（subPath-only）
   * @param {Object} ctx      选项（path/request/download/channel/...）
   * @param {Request} [ctx.request] 当前请求对象（用于构建绝对 URL）
   * @param {boolean} [ctx.download=false] 是否为下载模式
   * @param {string} [ctx.channel=\"web\"] 调用场景标记
   * @returns {Promise<{url:string,type:string,channel:string}>}
   */
  async generateProxyUrl(subPath, ctx = {}) {
    const { request, download = false, channel = "web" } = ctx;
    const fsPath = ctx?.path;
    // 对 LOCAL 来说，代理 URL 始终是本地 /api/p + 挂载视图路径
    const proxyUrl = buildFullProxyUrl(request || null, fsPath, download);
    return {
      url: proxyUrl,
      type: "proxy",
      channel,
    };
  }

  /**
   * LOCAL 驱动始终支持代理模式（通过本地 /api/p 网关）
   * @returns {boolean}
   */
  supportsProxyMode() {
    return true;
  }

  /**
   * 返回代理配置（当前仅暴露 enabled 字段，与 S3/WebDAV 对齐）
   * @returns {{enabled:boolean}}
   */
  getProxyConfig() {
    return {
      enabled: this.supportsProxyMode(),
    };
  }

  // ========== 内部工具方法 ==========

  /**
   * 规范化 FS 视图子路径为 posix 相对路径
   * @param {string} subPath
   * @returns {string}
   */
  _normalizeSubPath(subPath) {
    if (!subPath) return "";
    let normalized = String(subPath).replace(/\\/g, "/");
    normalized = normalized.replace(/\/+/g, "/");
    if (normalized.startsWith("/")) {
      normalized = normalized.slice(1);
    }
    if (!normalized) return "";
    normalized = normalized === "." ? "" : normalized;
    return normalized;
  }

  /**
   * 写入路径安全校验：
   * - 保证 lexical 上在 root_path 内
   * - 逐级检查已存在路径段上的符号链接是否逃逸出 root_path
   * @param {string} fullPath 目标 OS 路径
   * @private
   */
  async _assertSafePathForWrite(fullPath) {
    const rel = path.relative(this.rootPath, fullPath);
    const segments = rel.split(path.sep).filter(Boolean);

    let current = this.rootPath;
    for (const segment of segments) {
      current = path.join(current, segment);

      let stat;
      try {
        stat = await fs.promises.lstat(current);
      } catch (error) {
        if (error?.code === "ENOENT") {
          // 从第一个不存在的路径段开始，后续目录/文件将由驱动创建，不再存在已有符号链接可逃逸
          break;
        }
        throw this._wrapFsError(error, "访问本地文件系统失败");
      }

      if (!stat.isSymbolicLink()) continue;

      let real;
      try {
        real = await fs.promises.realpath(current);
      } catch (error) {
        throw new DriverError("解析符号链接失败", {
          status: ApiStatus.FORBIDDEN,
          code: "DRIVER_ERROR.LOCAL_SYMLINK_INVALID",
          expose: true,
          details: { path: current, cause: error?.message },
        });
      }

      const realRel = path.relative(this.rootPath, real);
      if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
        throw new DriverError("符号链接指向 root_path 之外，已被禁止访问", {
          status: ApiStatus.FORBIDDEN,
          code: "DRIVER_ERROR.LOCAL_SYMLINK_OUT_OF_ROOT",
          expose: true,
        });
      }
    }
  }

  /**
   * 构造写入目标 OS 路径（不要求路径已存在），并做越界与符号链接逃逸检查
   * @param {string} subPath FS 视图子路径
   * @returns {Promise<string>} OS 路径
   */
  async _buildTargetPath(subPath = "") {
    this._ensureInitialized();
    const safeSubPath = this._normalizeSubPath(subPath);
    const fullPath = path.resolve(this.rootPath, safeSubPath || ".");
    const rel = path.relative(this.rootPath, fullPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new DriverError("路径越界，已超出 root_path 范围", {
        status: ApiStatus.FORBIDDEN,
        code: "DRIVER_ERROR.LOCAL_PATH_OUT_OF_ROOT",
        expose: true,
      });
    }
    await this._assertSafePathForWrite(fullPath);
    return fullPath;
  }

  /**
   * 解析并校验本地路径（包含符号链接越界检查）
   * @param {string} subPath           FS 视图子路径
   * @param {Object} options
   * @param {boolean} options.mustBeDirectory 是否要求为目录
   * @returns {Promise<{fullPath:string, stat:import('fs').Stats}>}
   */
  async _resolveLocalPath(subPath, { mustBeDirectory = false } = {}) {
    this._ensureInitialized();
    const safeSubPath = this._normalizeSubPath(subPath);
    let joined = path.resolve(this.rootPath, safeSubPath || ".");

    const rel = path.relative(this.rootPath, joined);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new DriverError("路径越界，已超出 root_path 范围", {
        status: ApiStatus.FORBIDDEN,
        code: "DRIVER_ERROR.LOCAL_PATH_OUT_OF_ROOT",
        expose: true,
      });
    }

    let stat;
    try {
      stat = await fs.promises.lstat(joined);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw this._wrapFsError(error, "访问本地文件系统失败");
      }
      throw new NotFoundError("文件或目录不存在");
    }

    // 符号链接：解析真实路径并再次检查是否仍在 root_path 内
    if (stat.isSymbolicLink()) {
      let real;
      try {
        real = await fs.promises.realpath(joined);
      } catch (error) {
        throw new DriverError("解析符号链接失败", {
          status: ApiStatus.FORBIDDEN,
          code: "DRIVER_ERROR.LOCAL_SYMLINK_INVALID",
          expose: true,
          details: { path: joined, cause: error?.message },
        });
      }
      const realRel = path.relative(this.rootPath, real);
      if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
        throw new DriverError("符号链接指向 root_path 之外，已被禁止访问", {
          status: ApiStatus.FORBIDDEN,
          code: "DRIVER_ERROR.LOCAL_SYMLINK_OUT_OF_ROOT",
          expose: true,
        });
      }
      const realStat = await fs.promises.stat(real);
      if (mustBeDirectory && !realStat.isDirectory()) {
        throw new DriverError("目标路径不是目录", {
          status: ApiStatus.BAD_REQUEST,
          code: "DRIVER_ERROR.LOCAL_NOT_DIRECTORY",
          expose: true,
        });
      }
      return { fullPath: real, stat: realStat };
    }

    if (mustBeDirectory && !stat.isDirectory()) {
      throw new DriverError("目标路径不是目录", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.LOCAL_NOT_DIRECTORY",
        expose: true,
      });
    }

    return { fullPath: joined, stat };
  }

  /**
   * 解析写入目标的子路径：
   * - subPath 可能已经是完整文件路径（末段等于文件名）
   * - 也可能只是目录路径，此时需要再拼接文件名
   * 该方法用于 uploadFile / updateFile，避免出现「foo.txt/foo.txt」这类重复文件名路径
   * @param {string} subPath 原始子路径（可能为目录或完整文件路径）
   * @param {string} name    文件名
   * @returns {string}       规范化后的目标子路径（相对于 root_path）
   */
  _resolveTargetSubPath(subPath, name) {
    const safeName = String(name || "").trim();
    const normalized = this._normalizeSubPath(subPath || "");

    // 没有文件名时，直接返回目录语义（用于极少数特殊调用场景）
    if (!safeName) {
      return normalized || "";
    }

    // 如果 normalized 的最后一段已经等于文件名，说明上层已经给的是完整文件路径
    if (normalized) {
      const segments = normalized.split("/").filter(Boolean);
      const last = segments[segments.length - 1] || "";
      if (last === safeName) {
        return normalized;
      }
    }

    // 否则视为目录路径，在其后拼接文件名
    if (!normalized) {
      return safeName;
    }
    return `${normalized}/${safeName}`;
  }

  /**
   * 组合 FS 视图子路径与名称
   * @param {string} subPath 当前子路径
   * @param {string} name    项名称
   * @param {boolean} isDirectory 是否目录
   * @returns {string} 新子路径
   */
  _joinSubPath(subPath, name, isDirectory) {
    const base = subPath && subPath !== "/" ? subPath : "";
    const prefix = base ? (base.startsWith("/") ? base : `/${base}`) : "";
    const full = `${prefix}/${name}`;
    return isDirectory ? `${full}/` : full;
  }

  /**
   * 构造挂载视图下的目录路径
   * @param {Object} mount 挂载对象
   * @param {string} subPath 子路径
   * @returns {string}
   */
  _buildMountPath(mount, subPath = "") {
    const mountRoot = mount?.mount_path || "/";
    const normalized = subPath.startsWith("/") ? subPath : `/${subPath}`;
    const compact = normalized.replace(/\/+/g, "/");
    return mountRoot.endsWith("/")
      ? `${mountRoot.replace(/\/+$/, "")}${compact}`
      : `${mountRoot}${compact}`;
  }

  /**
   * 拼接挂载视图下的完整路径
   * @param {string} basePath 挂载根路径（含子路径）
   * @param {string} name     项名称
   * @param {boolean} isDirectory 是否目录
   */
  _joinMountPath(basePath, name, isDirectory) {
    const normalizedBase = basePath.endsWith("/") ? basePath : basePath + "/";
    return `${normalizedBase}${name}${isDirectory ? "/" : ""}`;
  }

  /**
   * 文件路径 basename 辅助
   * @param {string} p
   * @returns {string}
   */
  _basename(p) {
    const parts = (p || "").split("/").filter(Boolean);
    return parts.pop() || "";
  }

  /**
   * 统一包装 FS 异常为 DriverError
   * @param {Error} error
   * @param {string} message
   */
  _wrapFsError(error, message, status = ApiStatus.INTERNAL_ERROR) {
    if (error instanceof DriverError || error instanceof AppError) return error;
    return new DriverError(message, {
      status,
      expose: status < 500,
      details: { cause: error?.message },
    });
  }

  /**
   * 将上传体写入本地文件
   * - 支持 Node Stream / Web ReadableStream / Buffer / Uint8Array / ArrayBuffer / Blob/File / string
   * @param {string} targetPath OS 目标路径
   * @param {any} fileOrStream  上传体
   */
  async _writeBodyToFile(targetPath, fileOrStream) {
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true, mode: this.dirPermission });

    const isNodeStream = fileOrStream && (typeof fileOrStream.pipe === "function" || fileOrStream.readable);
    const isWebStream = fileOrStream && typeof fileOrStream.getReader === "function";

    if (isNodeStream) {
      await new Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(targetPath);
        fileOrStream.on("error", (err) => {
          writeStream.destroy(err);
          reject(err);
        });
        writeStream.on("error", reject);
        writeStream.on("finish", resolve);
        fileOrStream.pipe(writeStream);
      });
      // 应用文件权限
      await fs.promises.chmod(targetPath, this.filePermission);
      return;
    }

    let buffer;

    // Web ReadableStream -> Buffer
    if (isWebStream) {
      buffer = await this._readWebStreamToBuffer(fileOrStream);
    } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(fileOrStream)) {
      buffer = fileOrStream;
    } else if (fileOrStream instanceof Uint8Array) {
      buffer = Buffer.from(fileOrStream);
    } else if (fileOrStream instanceof ArrayBuffer) {
      buffer = Buffer.from(fileOrStream);
    } else if (fileOrStream && typeof fileOrStream.arrayBuffer === "function") {
      const ab = await fileOrStream.arrayBuffer();
      buffer = Buffer.from(ab);
    } else if (typeof fileOrStream === "string") {
      buffer = Buffer.from(fileOrStream);
    } else {
      throw new DriverError("不支持的上传体类型", {
        status: ApiStatus.BAD_REQUEST,
        code: "DRIVER_ERROR.LOCAL_UNSUPPORTED_BODY",
        expose: true,
      });
    }

    await fs.promises.writeFile(targetPath, buffer);
    // 应用文件权限
    await fs.promises.chmod(targetPath, this.filePermission);
  }

  /**
   * 将 Web ReadableStream 读入 Buffer
   * @param {ReadableStream} stream
   * @returns {Promise<Buffer|Uint8Array>}
   */
  async _readWebStreamToBuffer(stream) {
    const reader = stream.getReader();
    const chunks = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(typeof Buffer !== "undefined" ? Buffer.from(value) : value);
      }
    }

    if (typeof Buffer !== "undefined") {
      return Buffer.concat(chunks);
    }
    // 在极少数无 Buffer 环境下退化为 Uint8Array 连接
    let totalLength = 0;
    for (const chunk of chunks) {
      totalLength += chunk.length;
    }
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }

  /**
   * 递归复制目录内容
   * @param {string} sourceDir 源目录 OS 路径
   * @param {string} targetDir 目标目录 OS 路径
   */
  async _copyDirectoryRecursive(sourceDir, targetDir) {
    await fs.promises.mkdir(targetDir, { recursive: true });
    const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      const src = path.join(sourceDir, entry.name);
      const dst = path.join(targetDir, entry.name);

      if (entry.isDirectory()) {
        await this._copyDirectoryRecursive(src, dst);
      } else if (entry.isSymbolicLink()) {
        // 为避免 symlink 逃逸，这里不复制符号链接，直接跳过
        continue;
      } else {
        await fs.promises.copyFile(src, dst);
      }
    }
  }
}
