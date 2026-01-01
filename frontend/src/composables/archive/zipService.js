/**
 * ZIP文件处理服务
 * 基于zip.js，专门处理ZIP格式文件
 */

/**
 * 情况1：HttpRangeReader成功（无加密）
 * Range检测(484B) → 无加密 → 无缓存 → 流式下载解压
 *
 * 情况2：HttpRangeReader失败（无加密）
 * Range检测失败 → 降级下载+缓存 → 无加密 → 检测到缓存 → 使用缓存解压
 *
 * 情况3：加密文件
 * 检测+缓存 → 有加密 → 使用缓存解压
 */
import {
  ZipReaderStream,
  ZipReader,
  BlobReader,
  BlobWriter,
  HttpRangeReader,
  configure,
  terminateWorkers,
  ERR_ENCRYPTED,
  ERR_CENTRAL_DIRECTORY_NOT_FOUND,
  ERR_INVALID_ENTRY_NAME,
} from "@zip.js/zip.js";
import { ARCHIVE_CONSTANTS, sharedFileBlobCache, getOrDownloadFileBlob } from "./archiveUtils.js";
import { getZipJsDefaultConfig } from "@/utils/zipjsRuntimeUris.js";
import { createLogger } from "@/utils/logger.js";

// 全局配置标志
let isZipJSConfigured = false;
const log = createLogger("ZipService");

/**
 * 初始化zip.js全局配置
 */
function initializeZipJSConfig() {
  if (isZipJSConfigured) return;

  // 2.8+：显式配置 workerURI/wasmURI并统一全局默认参数
  const config = getZipJsDefaultConfig();
  configure(config);

  isZipJSConfigured = true;
  log.debug(`zip.js 全局配置已初始化:
    - chunkSize: ${Math.round((config.chunkSize || 0) / 1024)}KB
    - maxWorkers: ${config.maxWorkers}
    - useWebWorkers: enabled
    - useCompressionStream: enabled
    - workerURI/wasmURI: configured`);
}

/**
 * 标准化错误处理
 */
function handleZipError(error) {
  const errorMessage = error.message || "";

  // 错误常量
  if (errorMessage === ERR_ENCRYPTED) {
    throw new Error("ENCRYPTED_ARCHIVE_DETECTED");
  }
  if (errorMessage === ERR_CENTRAL_DIRECTORY_NOT_FOUND) {
    throw new Error("CORRUPTED_ARCHIVE");
  }
  if (errorMessage === ERR_INVALID_ENTRY_NAME) {
    throw new Error("INVALID_ARCHIVE_STRUCTURE");
  }

  // 密码相关错误
  if (errorMessage.includes("Invalid password") || errorMessage.includes("Wrong password")) {
    throw new Error("INVALID_ARCHIVE_PASSWORD");
  }

  // 错误信息
  log.warn("zip.js 错误:", errorMessage);
  throw error;
}

/**
 * ZIP64支持检测工具类
 */
class ZIP64Detector {
  /**
   * 检测ZIP文件是否为ZIP64格式
   * @param {ZipReader} zipReader - ZIP读取器实例
   * @returns {Promise<Object>} ZIP64检测结果
   */
  static async detectZIP64Support(zipReader) {
    try {
      const entries = await zipReader.getEntries();

      let hasLargeFiles = false;
      let hasManyEntries = false;
      let largestFileSize = 0;
      let largestFileName = "";

      // 检查是否有超过4GB的文件
      for (const entry of entries) {
        const uncompressedSize = entry.uncompressedSize || 0;
        const compressedSize = entry.compressedSize || 0;

        if (uncompressedSize > largestFileSize) {
          largestFileSize = uncompressedSize;
          largestFileName = entry.filename;
        }

        // 4GB = 0xFFFFFFFF (4294967295 bytes)
        if (uncompressedSize > 0xffffffff || compressedSize > 0xffffffff) {
          hasLargeFiles = true;
        }
      }

      // 检查是否有超过65535个条目
      if (entries.length > 0xffff) {
        hasManyEntries = true;
      }

      const isZIP64 = hasLargeFiles || hasManyEntries;

      return {
        isZIP64,
        hasLargeFiles,
        hasManyEntries,
        totalEntries: entries.length,
        largestFileSize,
        largestFileName,
        largestFileSizeMB: (largestFileSize / 1024 / 1024).toFixed(2),
        requiresZIP64: isZIP64,
      };
    } catch (error) {
      log.warn("ZIP64检测失败:", error);
      return {
        isZIP64: false,
        hasLargeFiles: false,
        hasManyEntries: false,
        totalEntries: 0,
        largestFileSize: 0,
        largestFileName: "",
        largestFileSizeMB: "0",
        requiresZIP64: false,
        error: error.message,
      };
    }
  }
}

/**
 * 并行解压工具类（仅用于密码保护的ZIP文件）
 */
class ParallelExtractionManager {
  constructor(maxConcurrency = navigator.hardwareConcurrency || 2) {
    this.maxConcurrency = Math.min(maxConcurrency, 8); // 最多8个并发
    this.semaphore = new Semaphore(this.maxConcurrency);
  }

  /**
   * 并行解压多个文件条目
   * @param {Array} entries - 文件条目数组
   * @param {Function} progressCallback - 进度回调
   * @returns {Promise<Array>} 解压结果数组
   */
  async extractEntriesInParallel(entries, progressCallback = null) {
    let completedCount = 0;

    log.debug(`开始并行解压 ${entries.length} 个文件，并发数: ${this.maxConcurrency}`);

    const extractPromises = entries.map(async (entry) => {
      await this.semaphore.acquire();

      try {
        const startTime = performance.now();

        // 并行解压单个文件
        const writer = new BlobWriter();
        await entry.getData(writer, {
          onprogress: () => {
            // 进度信息通过 progressCallback 传递给UI层
          },
        });

        const blob = await writer.getData();
        const content = await blob.arrayBuffer();
        const endTime = performance.now();

        completedCount++;

        // 更新总体进度
        if (progressCallback) {
          const overallProgress = (completedCount / entries.length) * 100;
          progressCallback(overallProgress, `并行解压 ${completedCount}/${entries.length}`);
        }

        return {
          name: entry.filename,
          size: entry.uncompressedSize || 0,
          compressedSize: entry.compressedSize || 0,
          isDirectory: false,
          lastModDate: entry.lastModDate || new Date(),
          content,
          extractionTime: endTime - startTime,
          entry: {
            entry: entry,
            type: "zipjs-parallel",
            cachedContent: content,
            async getContent() {
              return this.cachedContent;
            },
          },
        };
      } finally {
        this.semaphore.release();
      }
    });

    // 等待所有文件解压完成
    const extractedFiles = await Promise.all(extractPromises);

    log.debug(`并行解压完成！总计 ${extractedFiles.length} 个文件`);
    return extractedFiles;
  }
}

/**
 * 信号量实现（控制并发数量）
 */
class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release() {
    this.current--;
    if (this.queue.length > 0) {
      const resolve = this.queue.shift();
      this.current++;
      resolve();
    }
  }
}

/**
 * 创建统一的ZipReader配置（官方最佳实践）
 */
function createOptimalZipReaderConfig(options = {}) {
  return {
    useWebWorkers: true, // 启用Web Workers
    useCompressionStream: true, // 使用原生压缩流
    transferStreams: true, // 启用流传输优化
    // 允许特定场景的覆盖
    ...options,
  };
}

/**
 * ZIP文件处理服务类
 */
class ZipService {
  constructor() {
    // 使用共享的文件Blob缓存
    this.fileBlobCache = sharedFileBlobCache;

    // 初始化高级功能组件
    this.zip64Detector = ZIP64Detector;
    this.parallelManager = new ParallelExtractionManager();

    // 初始化全局配置
    initializeZipJSConfig();
  }

  /**
   * 清理zip.js资源
   */
  async cleanup() {
    try {
      await terminateWorkers();
      log.debug("zip.js Workers已终止");
    } catch (error) {
      log.warn("清理zip.js资源时出错:", error);
    }
  }

  /**
   * 统一的ZIP文件解压接口
   * @param {Blob|File|string} fileBlobOrUrl - 压缩文件 Blob 对象或URL
   * @param {string} filename - 文件名
   * @param {string} fileUrl - 文件URL（用于缓存键）
   * @param {Function} progressCallback - 进度回调函数 (progress: 0-100)
   * @param {string|null} password - 可选的解压密码
   * @returns {Promise<Array>} 统一格式的文件列表
   */
  async extractArchive(fileBlobOrUrl, filename, fileUrl = "", progressCallback = null, password = null) {
    log.debug(`开始处理 ZIP 格式文件:`, filename);

    // 第一步：检测文件是否加密
    let isEncrypted = false;
    let fileBlob = null;

    if (typeof fileBlobOrUrl === "string" && fileBlobOrUrl.startsWith("http")) {
      // 先用流式检测（不下载完整文件）
      isEncrypted = await this.lightweightEncryptionCheck(fileBlobOrUrl, progressCallback);
    } else {
      // 本地文件：直接检测
      isEncrypted = await this.quickEncryptionCheck(fileBlobOrUrl);
      fileBlob = fileBlobOrUrl;
    }

    if (isEncrypted && !password) {
      throw new Error("ENCRYPTED_ARCHIVE_DETECTED");
    } else if (isEncrypted && password) {
      // 检测到加密且有密码：现在才下载完整文件
      if (!fileBlob && typeof fileBlobOrUrl === "string" && fileBlobOrUrl.startsWith("http")) {
        fileBlob = await getOrDownloadFileBlob(fileBlobOrUrl, progressCallback, 0, 70, "下载中");
      } else if (!fileBlob) {
        fileBlob = fileBlobOrUrl;
        if (progressCallback) progressCallback(70, "准备解压");
      }
      return await this.extractZipWithPassword(fileBlob, password, progressCallback);
    } else {
      // 无加密：检查是否有缓存，优先使用缓存避免重复下载
      // 如果HttpRangeReader失败降级时已缓存文件，直接使用缓存
      if (typeof fileBlobOrUrl === "string" && fileBlobOrUrl.startsWith("http")) {
        const cachedBlob = sharedFileBlobCache.get(fileBlobOrUrl);
        if (cachedBlob) {
          log.debug("使用缓存文件进行流式解压:", fileBlobOrUrl);
          return await this.extractWithZipReaderStream(cachedBlob, progressCallback);
        }
      }
      // 使用流式解压（不需要下载完整文件）
      return await this.extractWithZipReaderStream(fileBlobOrUrl, progressCallback);
    }
  }

  /**
   * 基于Range请求的加密检测
   * @param {string} fileUrl - 远程文件URL
   * @param {Function} progressCallback - 进度回调函数
   * @returns {Promise<boolean>} true表示检测到加密，false表示无加密
   */
  async rangeBasedEncryptionCheck(fileUrl, progressCallback = null) {
    try {
      log.debug("开始HttpRangeReader加密检测:", fileUrl);
      if (progressCallback) progressCallback(20, "Range检测");

      // 使用HttpRangeReader进行智能Range请求
      const httpRangeReader = new HttpRangeReader(fileUrl, {
        useXHR: false,
      });

      // 创建ZipReader（HttpRangeReader已经内置了Range请求支持）
      const zipReader = new ZipReader(httpRangeReader, createOptimalZipReaderConfig());

      if (progressCallback) progressCallback(50, "获取文件列表");

      // 获取ZIP文件条目列表
      const entries = await zipReader.getEntries();

      if (progressCallback) progressCallback(80, "检测加密");

      // 检查前几个文件的加密状态
      const checkCount = Math.min(entries.length, ARCHIVE_CONSTANTS.DETECTION.MAX_CHECK_ENTRIES);
      let hasEncrypted = false;

      for (let i = 0; i < checkCount; i++) {
        const entry = entries[i];
        if (entry.encrypted) {
          hasEncrypted = true;
          break;
        }
      }

      // 关闭reader释放资源
      await zipReader.close();

      log.debug(`HttpRangeReader检测完成: ${hasEncrypted ? "发现加密" : "无加密"}, 检查了${checkCount}个条目`);
      return hasEncrypted;
    } catch (error) {
      log.warn("⚠️ HttpRangeReader检测失败:", error.message);
      // 重新抛出错误，让调用者决定如何处理
      throw error;
    }
  }

  /**
   * 轻量级加密检测（智能检测，适用于远程文件）
   * 优先使用HttpRangeReader进行部分下载检测，失败时降级到缓存下载检测
   * 降级时会缓存完整文件，避免后续extractArchive重复下载
   * @param {string} fileUrl - 远程文件URL
   * @param {Function} progressCallback - 进度回调函数
   * @returns {Promise<boolean>} true表示检测到加密，false表示无加密
   */
  async lightweightEncryptionCheck(fileUrl, progressCallback = null) {
    try {
      log.debug("开始加密检测:", fileUrl);
      if (progressCallback) progressCallback(10, "开始检测");

      // 优先尝试HttpRangeReader方式（真正的部分下载）
      try {
        const hasEncrypted = await this.rangeBasedEncryptionCheck(fileUrl, progressCallback);

        if (progressCallback) {
          progressCallback(100, hasEncrypted ? "发现加密" : "无加密");
        }

        log.debug(`HttpRangeReader检测成功: ${hasEncrypted ? "发现加密" : "无加密"}`);
        return hasEncrypted;
      } catch (rangeError) {
        log.warn("⚠️ HttpRangeReader检测失败，降级到缓存下载检测:", rangeError.message);
        if (progressCallback) progressCallback(30, "降级检测");
      }

      // 降级方案：下载完整文件并缓存，避免后续重复下载
      log.debug("降级使用缓存下载检测方式...");
      if (progressCallback) progressCallback(40, "下载检测");

      // 使用getOrDownloadFileBlob确保文件被缓存
      // 这样后续的extractArchive可以直接使用缓存，避免重复下载
      const fileBlob = await getOrDownloadFileBlob(fileUrl, progressCallback, 40, 80, "下载中");

      if (progressCallback) progressCallback(90, "检测加密");

      // 使用quickEncryptionCheck进行检测
      const hasEncrypted = await this.quickEncryptionCheck(fileBlob);

      if (progressCallback) {
        progressCallback(100, hasEncrypted ? "发现加密" : "无加密");
      }

      log.debug(`缓存下载检测完成: ${hasEncrypted ? "发现加密" : "无加密"}`);
      return hasEncrypted;
    } catch (error) {
      log.warn("⚠️ 加密检测失败:", error.message);
      // 统一使用标准化错误处理
      try {
        handleZipError(error);
      } catch (handledError) {
        // 如果是已知的严重错误（如文件损坏），重新抛出
        if (handledError.message.includes("CORRUPTED_ARCHIVE")) {
          throw handledError;
        }
      }
      // 检测失败时保守处理：假设无加密
      return false;
    }
  }

  /**
   * 快速加密检测（纯检测，无下载）
   * @param {Blob} fileBlob - 已下载的文件Blob
   * @returns {Promise<boolean>} true表示检测到加密，false表示无加密
   */
  async quickEncryptionCheck(fileBlob) {
    try {
      log.debug("开始加密检测blob...");
      const zipReader = new ZipReader(new BlobReader(fileBlob));
      const entries = await zipReader.getEntries();

      const checkCount = Math.min(entries.length, ARCHIVE_CONSTANTS.DETECTION.MAX_CHECK_ENTRIES);
      for (let i = 0; i < checkCount; i++) {
        const entry = entries[i];
        if (entry.encrypted) {
          await zipReader.close();
          return true;
        }
      }

      await zipReader.close();
      return false;
    } catch (error) {
      log.warn("⚠️ 快速加密检测失败:", error.message);
      // 检测失败时保守处理：假设无加密
      return false;
    }
  }

  /**
   * ZIP密码解压（纯解压，无下载）
   * @param {Blob} fileBlob - 已下载的文件Blob
   * @param {string} password - 解压密码
   * @param {Function} progressCallback - 进度回调函数
   * @returns {Promise<Array>} 统一格式的文件列表
   */
  async extractZipWithPassword(fileBlob, password, progressCallback = null) {
    try {
      log.debug("开始ZipReader进行密码解压...");
      if (progressCallback) progressCallback(75, "解析中");

      // 使用ZipReader进行密码解压
      const zipReader = new ZipReader(new BlobReader(fileBlob), {
        password,
      });

      const entries = await zipReader.getEntries({
        // 获取条目列表时的进度回调
        onprogress: (progress, total) => {
          if (progressCallback && total > 0) {
            const percentage = 75 + (progress / total) * 5; // 75-80%
            progressCallback(percentage, "扫描文件");
          }
        },
      });

      // ZIP64支持检测
      const zip64Info = await this.zip64Detector.detectZIP64Support(zipReader);
      if (zip64Info.isZIP64) {
        log.debug(`ZIP64格式: ${zip64Info.totalEntries}个文件, 最大${zip64Info.largestFileSizeMB}MB (${zip64Info.largestFileName})`);
      }

      // 智能选择解压策略
      const shouldUseParallel = this.shouldUseParallelExtraction(entries, zip64Info);

      if (shouldUseParallel) {
        log.debug("使用并行解压策略");
        if (progressCallback) progressCallback(80, "并行解压中");

        // 过滤出非目录文件进行并行解压
        const fileEntries = entries.filter((entry) => !entry.directory);
        const directoryEntries = entries.filter((entry) => entry.directory);

        // 并行解压文件
        const parallelResults = await this.parallelManager.extractEntriesInParallel(fileEntries, (progress, status) => {
          if (progressCallback) {
            const adjustedProgress = 80 + progress * 0.15; // 80-95%
            progressCallback(adjustedProgress, status);
          }
        });

        // 添加目录条目（不需要解压内容）
        const directoryResults = directoryEntries.map((entry) => ({
          name: entry.filename,
          size: 0,
          compressedSize: 0,
          isDirectory: true,
          lastModDate: entry.lastModDate || new Date(),
          entry: {
            entry: entry,
            type: "zipjs-reader",
            async getContent() {
              throw new Error("Cannot extract directory");
            },
          },
        }));

        const result = [...parallelResults, ...directoryResults];
        await zipReader.close();

        if (progressCallback) progressCallback(100, "完成");
        log.debug(`并行解压完成，处理了 ${entries.length} 个条目`);
        return result;
      }

      // 传统顺序解压
      log.debug("使用传统顺序解压策略");
      const result = [];
      let processedEntries = 0;

      for (const entry of entries) {
        if (entry.directory) {
          // 目录条目
          result.push({
            name: entry.filename,
            size: 0,
            compressedSize: 0,
            isDirectory: true,
            lastModDate: entry.lastModDate || new Date(),
            entry: {
              entry: entry,
              type: "zipjs-reader",
              async getContent() {
                throw new Error("Cannot extract directory");
              },
            },
          });
        } else {
          // 文件条目 - 立即解密内容

          let cachedContent;
          try {
            const writer = new BlobWriter();
            // 使用官方的进度回调进行文件解压
            await entry.getData(writer, {
              onprogress: (index, max) => {
                if (progressCallback && max > 0) {
                  const fileProgress = (index / max) * 100;
                  const overallProgress = 80 + (processedEntries / entries.length) * 15 + (fileProgress / entries.length) * 0.15;
                  progressCallback(Math.min(overallProgress, 95), `解压 ${entry.filename}`);
                }
              },
            });
            // BlobWriter.getData() 返回Promise，需要await
            const blob = await writer.getData();
            cachedContent = await blob.arrayBuffer();
          } catch (error) {
            // 统一使用标准化错误处理
            handleZipError(error);
          }

          result.push({
            name: entry.filename,
            size: entry.uncompressedSize || 0,
            compressedSize: entry.compressedSize || 0,
            isDirectory: false,
            lastModDate: entry.lastModDate || new Date(),
            entry: {
              entry: entry,
              type: "zipjs-reader",
              cachedContent,
              async getContent() {
                // 直接返回缓存的ArrayBuffer
                return this.cachedContent;
              },
            },
          });
        }

        processedEntries++;

        // 解压进度：75-100%
        if (progressCallback) {
          const extractProgress = 75 + (processedEntries / entries.length) * 25;
          progressCallback(Math.min(extractProgress, 100), "解压中");
        }
      }

      await zipReader.close();

      if (progressCallback) progressCallback(100, "完成");

      log.debug(`ZipReader 密码解压完成，处理了 ${entries.length} 个条目`);
      return result;
    } catch (error) {
      log.error("ZIP密码解压失败:", error);
      // 统一使用标准化错误处理
      handleZipError(error);
    }
  }

  /**
   * 智能解压策略选择
   * @param {Array} entries - 文件条目数组
   * @param {Object} zip64Info - ZIP64检测信息
   * @returns {boolean} 是否应该使用并行解压
   */
  shouldUseParallelExtraction(entries, zip64Info) {
    const fileEntries = entries.filter((entry) => !entry.directory);
    const totalFiles = fileEntries.length;

    // 基础条件检查（合并策略1-4）
    const hasVeryLargeFiles = fileEntries.some(
      (entry) => (entry.uncompressedSize || 0) > 50 * 1024 * 1024 // 50MB
    );
    const totalUncompressedSize = fileEntries.reduce((sum, entry) => sum + (entry.uncompressedSize || 0), 0);
    const cpuCores = navigator.hardwareConcurrency || 2;

    // 快速排除条件（不适合并行解压）
    if (totalFiles < 3) {
      log.debug(`使用顺序解压: 文件数量少(${totalFiles}个)`);
      return false;
    }
    if (hasVeryLargeFiles) {
      log.debug("使用顺序解压: 检测到超大文件(>50MB)");
      return false;
    }
    if (totalUncompressedSize > 200 * 1024 * 1024) {
      log.debug(`使用顺序解压: 总体积过大(${(totalUncompressedSize / 1024 / 1024).toFixed(0)}MB)`);
      return false;
    }
    if (cpuCores < 4) {
      log.debug(`使用顺序解压: CPU核心不足(${cpuCores}核)`);
      return false;
    }

    // ZIP64特殊处理
    if (zip64Info.isZIP64) {
      if (zip64Info.hasLargeFiles && !zip64Info.hasManyEntries) {
        log.debug("ZIP64大文件格式 → 顺序解压");
        return false;
      } else if (zip64Info.hasManyEntries && !zip64Info.hasLargeFiles) {
        if (totalFiles >= 10 && totalFiles <= 200 && cpuCores >= 4) {
          log.debug("ZIP64大量文件格式 → 并行解压");
          return true;
        }
      } else if (zip64Info.hasLargeFiles && zip64Info.hasManyEntries) {
        if (cpuCores >= 8 && totalFiles <= 50) {
          log.debug("ZIP64复合格式 → 高性能并行解压");
          return true;
        }
        log.debug("ZIP64复合格式 → 顺序解压");
        return false;
      }
    }

    // 最终判断：文件数量与CPU核心数匹配
    if (totalFiles >= 4 && totalFiles <= 50) {
      log.debug(`使用并行解压: ${totalFiles}个文件，${cpuCores}核CPU`);
      return true;
    }

    // 默认策略
    log.debug("使用默认顺序解压策略");
    return false;
  }

  /**
   * 使用 ZipReaderStream 统一流式解压 ZIP 文件（支持URL和Blob输入）
   * @param {string|Blob|File} fileBlobOrUrl - ZIP 文件URL或Blob对象
   * @param {Function} progressCallback - 进度回调函数 (progress: 0-100)
   * @returns {Promise<Array>} 统一格式的文件列表
   */
  async extractWithZipReaderStream(fileBlobOrUrl, progressCallback = null) {
    try {
      let readableStream;
      let totalSize = 0;
      let loaded = 0;
      let isRemoteFile = false;

      // 统一获取ReadableStream
      if (typeof fileBlobOrUrl === "string" && fileBlobOrUrl.startsWith("http")) {
        // 远程文件：fetch获取stream
        log.debug("ZipReaderStream 处理远程ZIP文件:", fileBlobOrUrl);
        isRemoteFile = true;

        const response = await fetch(fileBlobOrUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentLength = response.headers.get("content-length");
        totalSize = contentLength ? parseInt(contentLength, 10) : 0;
        readableStream = response.body;

        log.debug(`远程ZIP文件大小: ${totalSize ? (totalSize / 1024 / 1024).toFixed(2) + "MB" : "未知"}`);
      } else {
        // 本地Blob：使用Blob.stream()转换为ReadableStream
        log.debug("ZipReaderStream 处理本地ZIP文件");
        const blob = fileBlobOrUrl;
        totalSize = blob.size;
        readableStream = blob.stream();

        log.debug(`本地ZIP文件大小: ${(totalSize / 1024 / 1024).toFixed(2)}MB`);
      }

      // 创建进度监控的TransformStream（统一处理）
      const progressMonitorStream = new TransformStream({
        transform(chunk, controller) {
          loaded += chunk.length;

          if (totalSize > 0 && progressCallback) {
            // 下载/读取进度占70%，解压进度占30%
            const readProgress = (loaded / totalSize) * ARCHIVE_CONSTANTS.PROGRESS.DOWNLOAD_RATIO;
            const stage = isRemoteFile ? "下载中" : "读取中";
            progressCallback(Math.min(readProgress, ARCHIVE_CONSTANTS.PROGRESS.DOWNLOAD_RATIO), stage);
          }

          controller.enqueue(chunk);
        },
      });

      const result = [];
      let processedEntries = 0;
      let estimatedTotalEntries = ARCHIVE_CONSTANTS.ESTIMATION.INITIAL_ENTRIES; // 初始估算值，会动态调整

      // 使用统一配置的 ZipReaderStream 流式处理（chunkSize由全局configure()控制）
      const zipReaderStream = new ZipReaderStream(createOptimalZipReaderConfig());

      log.debug("开始流式解析ZIP条目...");

      // ReadableStream → 进度监控 → ZIP解析（统一处理）
      for await (const entry of readableStream.pipeThrough(progressMonitorStream).pipeThrough(zipReaderStream)) {
        // 转换为统一格式
        const fileInfo = {
          name: entry.filename,
          size: entry.uncompressedSize || 0,
          compressedSize: entry.compressedSize || 0,
          isDirectory: entry.directory,
          lastModDate: entry.lastModDate || new Date(),
          entry: {
            entry: entry,
            type: "zipjs-stream",
            async getContent() {
              // 使用Response API
              if (!entry.readable) {
                throw new Error(`Entry "${entry.filename}" readable stream is not available`);
              }

              // Response构造函数接受ReadableStream
              return new Response(entry.readable).arrayBuffer();
            },
          },
        };

        result.push(fileInfo);
        processedEntries++;

        // 动态调整估算的总条目数
        if (processedEntries > estimatedTotalEntries * 0.8) {
          estimatedTotalEntries = Math.ceil(processedEntries * 1.5);
        }

        // 解压进度：70-100%（基于动态估算的总条目数）
        if (progressCallback) {
          const extractProgress = ARCHIVE_CONSTANTS.PROGRESS.DOWNLOAD_RATIO + (processedEntries / estimatedTotalEntries) * ARCHIVE_CONSTANTS.PROGRESS.EXTRACT_RATIO;
          progressCallback(Math.min(extractProgress, 95), "解压中");
        }
      }

      // 确保进度达到100%
      if (progressCallback) {
        progressCallback(100, "完成");
      }

      log.debug(`ZipReaderStream 流式解压完成: ${result.length}个文件 (${(loaded / 1024 / 1024).toFixed(1)}MB)`);
      return result;
    } catch (error) {
      log.error("ZipReaderStream 流式解压失败:", error);
      throw error;
    }
  }

  /**
   * 清除文件Blob缓存
   * @param {string} fileUrl - 文件URL
   */
  clearFileBlobCache(fileUrl) {
    // 共享缓存由archiveUtils管理
    if (!fileUrl) return;

    this.fileBlobCache.delete(fileUrl);
    log.debug("已清除ZIP服务文件Blob缓存:", fileUrl);
  }
}

// 导出单例实例
export const zipService = new ZipService();

// 导出全局清理函数（用于应用关闭时调用）
export const cleanupZipJS = async () => {
  await zipService.cleanup();
};

export default zipService;
