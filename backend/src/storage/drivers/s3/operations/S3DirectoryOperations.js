/**
 * S3目录操作模块
 * 负责目录相关操作：列出内容、创建目录、删除目录等
 */

import { NotFoundError } from "../../../../http/errors.js";
import { S3Client, ListObjectsV2Command, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { checkDirectoryExists, updateParentDirectoriesModifiedTime } from "../utils/S3DirectoryUtils.js";
import { applyS3RootPrefix, isMountRootPath, normalizeS3SubPath } from "../utils/S3PathUtils.js";
import { handleFsError } from "../../../fs/utils/ErrorHandler.js";
import { buildFileInfo } from "../../../utils/FileInfoBuilder.js";

export class S3DirectoryOperations {
  /**
   * 构造函数
   * @param {S3Client} s3Client - S3客户端
   * @param {Object} config - S3配置
   * @param {string} encryptionSecret - 加密密钥
   */
  constructor(s3Client, config, encryptionSecret) {
    this.s3Client = s3Client;
    this.config = config;
    this.encryptionSecret = encryptionSecret;
  }

  /**
   * 获取S3目录的修改时间（仅从目录标记对象获取）
   *
   * @param {S3Client} s3Client - S3客户端实例
   * @param {string} bucketName - 存储桶名称
   * @param {string} prefix - 目录前缀
   * @returns {Promise<string|null>} 目录修改时间的ISO字符串；未知返回 null
   */
  async getS3DirectoryModifiedTime(s3Client, bucketName, prefix) {
    try {
      // 检查是否存在目录标记对象
      const headParams = {
        Bucket: bucketName,
        Key: prefix, // prefix 应该已经以 '/' 结尾
      };

      const headCommand = new HeadObjectCommand(headParams);
      const headResponse = await s3Client.send(headCommand);

      // 如果目录标记对象存在，使用其修改时间
      if (headResponse.LastModified) {
        return headResponse.LastModified.toISOString();
      }
    } catch (error) {
      // 如果目录标记对象不存在：目录时间未知
      if (error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }

    return null;
  }

  /**
   * S3 专用：一次扫描当前目录 prefix 下的所有对象，批量得到“当前目录的直接子目录”的摘要（size / modified）
   * - 目标：避免对每个子目录分别递归 list，导致 N 倍放大（S3 大目录会非常慢/贵）
   * - 只统计“子目录内的文件对象”（忽略以 / 结尾的目录标记对象），更贴近“内容大小/内容更新时间”的语义
   * - modified 取该子目录下所有文件的 LastModified 最大值；如果子目录完全没有文件，则 modified=null
   *
   * @param {string} relativeSubPath - 当前目录在挂载内的相对路径（例如 / 或 /a/b/）
   * @param {Map<string, string>} childDirNameToFsPath - 直接子目录名 => FS 路径（/mount/child/）
   * @param {{refresh?: boolean}} options - 选项
   * @returns {Promise<{results: Map<string, {size:number, modified:(string|null), completed:boolean, calculatedAt:string}>, completed:boolean, visited:number}>}
   */
  async computeDirectChildDirSummaries(relativeSubPath, childDirNameToFsPath, options = {}) {
    const maxItems = 20000;
    const maxMs = 5000;
    const startedAt = Date.now();

    const childNames = Array.from(childDirNameToFsPath?.keys?.() ?? []);
    const totals = new Map();
    for (const name of childNames) {
      const dirPath = childDirNameToFsPath.get(name);
      if (!dirPath) continue;
      totals.set(dirPath, { size: 0, latestModifiedMs: 0 });
    }

    let visited = 0;
    let completed = true;
    let continuationToken = undefined;

    const s3SubPath = normalizeS3SubPath(relativeSubPath, true);
    let fullPrefix = applyS3RootPrefix(this.config, s3SubPath);
    if (fullPrefix && !fullPrefix.endsWith("/")) fullPrefix += "/";
    const effectivePrefix = fullPrefix ? String(fullPrefix) : "";

    while (true) {
      if (Date.now() - startedAt > maxMs || visited >= maxItems) {
        completed = false;
        break;
      }

      const cmd = new ListObjectsV2Command({
        Bucket: this.config.bucket_name,
        Prefix: effectivePrefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      });
      const resp = await this.s3Client.send(cmd);
      const objects = Array.isArray(resp?.Contents) ? resp.Contents : [];

      for (const obj of objects) {
        visited += 1;
        if (visited >= maxItems) {
          completed = false;
          break;
        }

        const key = typeof obj?.Key === "string" ? obj.Key : "";
        if (!key) continue;

        // 忽略目录标记对象（key 以 / 结尾）
        if (key.endsWith("/")) {
          continue;
        }

        // 取出当前目录 prefix 之后的相对路径
        const relative = effectivePrefix ? key.slice(effectivePrefix.length) : key;
        if (!relative) continue;

        // 只关心属于“直接子目录”的对象：relative 形如 "child/xxx"
        const slashIdx = relative.indexOf("/");
        if (slashIdx <= 0) {
          // 文件直接在当前目录下，不属于任何子目录
          continue;
        }

        const childName = relative.slice(0, slashIdx);
        const childDirPath = childDirNameToFsPath.get(childName) || null;
        if (!childDirPath) continue;

        const entry = totals.get(childDirPath);
        if (!entry) continue;

        const size = typeof obj?.Size === "number" && Number.isFinite(obj.Size) && obj.Size >= 0 ? obj.Size : 0;
        entry.size += size;

        const lm = obj?.LastModified instanceof Date ? obj.LastModified : obj?.LastModified ? new Date(obj.LastModified) : null;
        const ms = lm ? lm.getTime() : 0;
        if (Number.isFinite(ms) && ms > entry.latestModifiedMs) {
          entry.latestModifiedMs = ms;
        }
      }

      if (!resp?.IsTruncated) {
        break;
      }
      if (!resp?.NextContinuationToken) {
        break;
      }
      continuationToken = resp.NextContinuationToken;
    }

    const results = new Map();
    for (const [dirPath, entry] of totals.entries()) {
      results.set(dirPath, {
        size: entry.size,
        modified: entry.latestModifiedMs > 0 ? new Date(entry.latestModifiedMs).toISOString() : null,
        completed,
        calculatedAt: new Date().toISOString(),
      });
    }

    return { results, completed, visited };
  }

  /**
   * 列出目录内容
   * @param {string} s3SubPath - S3子路径
   * @param {Object} options - 选项参数
   * @param {boolean} options.refresh - 是否强制刷新，跳过缓存
   * @returns {Promise<Object>} 目录内容
   */
  async listDirectory(s3SubPath, options = {}) {
    const { mount, subPath, db, refresh = false, path } = options;

    return handleFsError(
      async () => {
        // 目录分页（可选）
        // - cursor：ContinuationToken（不透明字符串）
        // - limit：单页最多数量（S3 上限 1000）
        const cursorRaw = options?.cursor != null && String(options.cursor).trim() ? String(options.cursor).trim() : null;
        const limitRaw = options?.limit != null && options.limit !== "" ? Number(options.limit) : null;
        const limit =
          limitRaw != null && Number.isFinite(limitRaw) && limitRaw > 0 ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : null;
        const paged = options?.paged === true || !!cursorRaw || limit != null;

        // 构造返回结果结构
        const result = {
          path,
          type: "directory",
          isRoot: false,
          isVirtual: false,
          mount_id: mount.id,
          storage_type: mount.storage_type,
          items: [],
        };

        let fullPrefix = applyS3RootPrefix(this.config, s3SubPath);
        if (fullPrefix && !fullPrefix.endsWith("/")) fullPrefix += "/";

        const prefixLength = fullPrefix.length;
        const separator = subPath.endsWith("/") ? "" : "/";

        // 去重：ContinuationToken 分页下理论上不重复，但稳妥起见做一次去重
        const seenPaths = new Set();

        const appendFromResponse = async (response) => {
          // 处理公共前缀（目录）
          if (response?.CommonPrefixes) {
            for (const prefix of response.CommonPrefixes) {
              const prefixKey = prefix?.Prefix;
              if (!prefixKey || typeof prefixKey !== "string") continue;
              const relativePath = prefixKey.substring(prefixLength);
              const dirName = relativePath.replace(/\/$/, "");
              if (!dirName) continue;

              // S3 没有“目录”的原生元数据（CommonPrefixes 不包含 LastModified/Size）。
              // 这里不做递归计算/额外 HEAD，把目录 size/modified 交给上层兜底：
              // storage(本驱动返回 null) > compute(可选) > index > -
              const directoryModified = null;
              const directorySize = null;

              const dirPath = mount.mount_path + subPath + separator + dirName + "/";
              if (seenPaths.has(dirPath)) continue;
              seenPaths.add(dirPath);

              const dirInfo = await buildFileInfo({
                fsPath: dirPath,
                name: dirName,
                isDirectory: true,
                size: directorySize,
                modified: directoryModified,
                mimetype: "application/x-directory",
                mount,
                storageType: mount.storage_type,
                db,
              });

              result.items.push({ ...dirInfo, isVirtual: false });
            }
          }

          // 处理内容（文件）
          if (response?.Contents) {
            for (const content of response.Contents) {
              const key = content?.Key;
              if (!key || typeof key !== "string") continue;

              // 跳过作为目录标记的对象
              if (key === fullPrefix || key === fullPrefix + "/") continue;

              // 从S3 key中提取相对路径和名称
              const relativePath = key.substring(prefixLength);
              if (!relativePath) continue;

              // 跳过嵌套在子目录中的文件
              if (relativePath.includes("/")) continue;

              const itemPath = mount.mount_path + subPath + separator + relativePath;
              if (seenPaths.has(itemPath)) continue;
              seenPaths.add(itemPath);

              const info = await buildFileInfo({
                fsPath: itemPath,
                name: relativePath,
                isDirectory: false,
                size: content.Size,
                modified: content.LastModified ? content.LastModified : null,
                mimetype: null,
                mount,
                storageType: mount.storage_type,
                db,
              });

              result.items.push({
                ...info,
                etag: content.ETag ? content.ETag.replace(/"/g, "") : undefined,
              });
            }
          }
        };

        const fetchPage = async (continuationToken) => {
          const listParams = {
            Bucket: this.config.bucket_name,
            Prefix: fullPrefix,
            Delimiter: "/",
            MaxKeys: limit ?? 1000,
            ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
          };
          const listCommand = new ListObjectsV2Command(listParams);
          return await this.s3Client.send(listCommand);
        };

        let continuationToken = cursorRaw;
        let nextCursor = null;
        let hasMore = false;

        if (paged) {
          const response = await fetchPage(continuationToken);
          await appendFromResponse(response);
          nextCursor = response?.NextContinuationToken ? String(response.NextContinuationToken) : null;
          hasMore = !!(response?.IsTruncated && nextCursor);
        } else {
          while (true) {
            const response = await fetchPage(continuationToken);
            await appendFromResponse(response);

            nextCursor = response?.NextContinuationToken ? String(response.NextContinuationToken) : null;
            if (!response?.IsTruncated || !nextCursor) break;
            if (nextCursor === continuationToken) break;
            continuationToken = nextCursor;
          }
        }

        // 按名称排序
        result.items.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });

        return {
          ...result,
          ...(paged ? { hasMore, nextCursor: hasMore ? nextCursor : null } : {}),
        };
      },
      "列出目录",
      "列出目录失败"
    );
  }

  /**
   * 创建目录
   * @param {string} s3SubPath - S3子路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 创建结果
   */
  async createDirectory(s3SubPath, options = {}) {
    const { mount, subPath, path, db } = options;

    return handleFsError(
      async () => {
        // 特殊处理：如果s3SubPath为挂载点根目录，直接返回成功
        // 因为挂载点根目录在逻辑上总是存在的，不需要在S3中创建
        if (isMountRootPath(s3SubPath)) {
          console.log(`跳过创建挂载点根目录（逻辑上总是存在）: "${s3SubPath}"`);
          return {
            success: true,
            path: path,
            message: "挂载点根目录总是存在",
          };
        }

        // nginx风格的递归创建功能：自动创建所有需要的中间目录
        // 参考nginx WebDAV模块的create_full_put_path功能
        console.log(`开始递归创建目录: ${s3SubPath}`);
        await this._ensureParentDirectoriesExist(s3SubPath);


        return {
          success: true,
          path: path,
          message: "目录创建成功",
        };
      },
      "创建目录",
      "创建目录失败"
    );
  }

  /**
   * 确保父目录存在，如果不存在则递归创建
   * @param {string} s3SubPath - S3子路径
   * @private
   */
  async _ensureParentDirectoriesExist(s3SubPath) {
    const pathParts = s3SubPath.split("/").filter(Boolean);

    // 如果是根目录或只有一级目录，不需要检查父目录
    if (pathParts.length <= 1) {
      return await this._createSingleDirectory(s3SubPath);
    }

    // 递归创建所有父目录
    let currentPath = "";
    for (let i = 0; i < pathParts.length; i++) {
      currentPath += pathParts[i] + "/";

      // 检查当前目录是否存在
      const currentKey = applyS3RootPrefix(this.config, currentPath);
      const exists = await checkDirectoryExists(this.s3Client, this.config.bucket_name, currentKey);

      if (!exists) {
        console.log(`递归创建目录 - 创建中间目录: ${currentKey}`);
        await this._createSingleDirectory(currentPath);
      }
    }
  }

  /**
   * 创建单个目录（不检查父目录）
   * @param {string} s3SubPath - S3子路径
   * @private
   */
  async _createSingleDirectory(s3SubPath) {
    // 特殊处理：如果s3SubPath为挂载点根目录，直接返回成功
    // 因为S3中不能创建空Key的对象，而挂载点根目录在逻辑上总是存在的
    if (isMountRootPath(s3SubPath)) {
      console.log(`跳过创建挂载点根目录（S3不支持空Key）: "${s3SubPath}"`);
      return {
        success: true,
        message: "挂载点根目录总是存在",
      };
    }

    const fullKey = applyS3RootPrefix(this.config, s3SubPath);

    // 检查目录是否已存在
    try {
      const headParams = {
        Bucket: this.config.bucket_name,
        Key: fullKey,
      };

      const headCommand = new HeadObjectCommand(headParams);
      await this.s3Client.send(headCommand);

      // 如果没有抛出异常，说明目录已存在，直接返回成功
      console.log(`目录已存在，跳过创建: ${fullKey}`);
      return {
        success: true,
        message: "目录已存在",
      };
    } catch (error) {
      if (error.$metadata && error.$metadata.httpStatusCode === 404) {
        // 目录不存在，可以创建
        const putParams = {
          Bucket: this.config.bucket_name,
          Key: fullKey,
          Body: Buffer.from("", "utf-8"),
          ContentType: "application/x-directory",
        };

      const putCommand = new PutObjectCommand(putParams);
      await this.s3Client.send(putCommand);

      // 更新父目录的修改时间
        await updateParentDirectoriesModifiedTime(this.s3Client, this.config.bucket_name, fullKey, this.config.root_prefix);

        console.log(`成功创建目录: ${fullKey}`);
        return {
          success: true,
          message: "目录创建成功",
        };
      }

      // 其他错误则抛出
      throw error;
    }
  }

  /**
   * 递归删除S3目录
   * @param {S3Client} s3Client - S3客户端实例
   * @param {string} bucketName - 存储桶名称
   * @param {string} prefix - 目录前缀
   * @param {string} storageConfigId - 存储配置ID
   * @returns {Promise<void>}
   */
  async deleteDirectoryRecursive(s3Client, bucketName, prefix, storageConfigId) {
    let continuationToken = undefined;

    try {
      do {
        const listParams = {
          Bucket: bucketName,
          Prefix: prefix,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        };

        const listCommand = new ListObjectsV2Command(listParams);
        const response = await s3Client.send(listCommand);

        if (response.Contents && response.Contents.length > 0) {
          // 批量删除对象
          const deletePromises = response.Contents.map(async (item) => {
            const deleteParams = {
              Bucket: bucketName,
              Key: item.Key,
            };

            const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
            const deleteCommand = new DeleteObjectCommand(deleteParams);
            await s3Client.send(deleteCommand);

            // 文件删除完成，无需数据库操作
          });

          await Promise.all(deletePromises);
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      console.log(`成功删除目录: ${prefix}`);
    } catch (error) {
      console.error(`删除目录失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查目录是否存在
   * @param {string} s3SubPath - S3子路径
   * @returns {Promise<boolean>} 是否存在
   */
  async directoryExists(s3SubPath) {
    const key = applyS3RootPrefix(this.config, s3SubPath);
    return await checkDirectoryExists(this.s3Client, this.config.bucket_name, key);
  }

  /**
   * 获取目录信息（作为目录处理）
   * @param {string} s3SubPath - S3子路径
   * @param {Object} options - 选项参数
   * @returns {Promise<Object>} 目录信息
   */
  async getDirectoryInfo(s3SubPath, options = {}) {
    const { mount, path } = options;

    // 特殊处理：挂载点根目录（空路径）总是存在
    if (s3SubPath === "" || s3SubPath === "/") {
      console.log(`getDirectoryInfo - 挂载点根目录总是存在: ${path}`);
      const info = await buildFileInfo({
        fsPath: path,
        name: path.split("/").filter(Boolean).pop() || "/",
        isDirectory: true,
        size: null,
        modified: null,
        mimetype: "application/x-directory",
        mount,
        storageType: mount.storage_type,
        db: null,
      });
      return info;
    }

    // 尝试作为目录处理
    const dirPath = s3SubPath.endsWith("/") ? s3SubPath : s3SubPath + "/";
    const fullDirPath = applyS3RootPrefix(this.config, dirPath);

    const listParams = {
      Bucket: this.config.bucket_name,
      Prefix: fullDirPath,
      MaxKeys: 1,
    };

    const listCommand = new ListObjectsV2Command(listParams);
    const listResponse = await this.s3Client.send(listCommand);

    // 如果有内容，说明是目录
    if (listResponse.Contents && listResponse.Contents.length > 0) {
      // 获取目录的真实修改时间
      let directoryModified = null;
      try {
        directoryModified = await this.getS3DirectoryModifiedTime(this.s3Client, this.config.bucket_name, fullDirPath);
      } catch (error) {
        console.warn(`获取目录修改时间失败:`, error);
      }

      const info = await buildFileInfo({
        fsPath: path,
        name: path.split("/").filter(Boolean).pop() || "/",
        isDirectory: true,
        size: null,
        modified: directoryModified ? new Date(directoryModified) : null,
        mimetype: "application/x-directory",
        mount,
        storageType: mount.storage_type,
        db: null,
      });
      return info;
    }

    throw new NotFoundError("目录不存在");
  }
}
