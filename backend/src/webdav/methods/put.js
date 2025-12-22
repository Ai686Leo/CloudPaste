/**
 * 处理WebDAV PUT请求
 * 用于上传文件内容
 */
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { getEffectiveMimeType } from "../../utils/fileUtils.js";
import { withWebDAVErrorHandling } from "../utils/errorUtils.js";
import { getStandardWebDAVHeaders } from "../utils/headerUtils.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { ValidationError } from "../../http/errors.js";
import { getSettingsByGroup } from "../../services/systemService.js";
import { lockManager } from "../utils/LockManager.js";
import { checkLockPermission } from "../utils/lockUtils.js";

/**
 * 获取WebDAV上传模式设置
 * @param {D1Database} db - 数据库实例
 * @returns {Promise<string>} 上传模式 ('single' 或 'chunked')
 */
async function getWebDAVUploadMode(db) {
  try {
    // WebDAV设置组ID为3
    const settings = await getSettingsByGroup(db, 3, false);
    const uploadModeSetting = settings.find((setting) => setting.key === "webdav_upload_mode");
    const raw = uploadModeSetting ? uploadModeSetting.value : "chunked";
    // 仅接受 single / chunked，其它一律按 single 处理
    if (raw === "chunked") return "chunked";
    return "single";
  } catch (error) {
    console.warn("获取WebDAV上传模式设置失败，使用默认值:", error);
    return "single";
  }
}

/**
 * 智能检测是否为真正的空文件
 * @param {number} contentLength - Content-Length头部值
 * @param {string|null} transferEncoding - Transfer-Encoding头部值
 * @returns {boolean} 是否为真正的空文件
 */
function isReallyEmptyFile(contentLength, transferEncoding) {
  // 如果Content-Length大于0，肯定不是空文件
  if (contentLength > 0) {
    return false;
  }

  // 如果有Transfer-Encoding: chunked，不能仅依赖Content-Length判断
  if (transferEncoding && transferEncoding.toLowerCase().includes("chunked")) {
    return false; // 分块传输时，使用流式分片上传
  }

  // Content-Length为0且没有分块传输，才是真正的空文件
  return true;
}

/**
 * 处理PUT请求
 * @param {Object} c - Hono上下文
 * @param {string} path - 请求路径
 * @param {string} userId - 用户ID
 * @param {string} userType - 用户类型 (admin 或 apiKey)
 * @param {D1Database} db - D1数据库实例
 */
export async function handlePut(c, path, userId, userType, db) {
  return withWebDAVErrorHandling("PUT", async () => {
    // 获取加密密钥
    const encryptionSecret = getEncryptionSecret(c);
    if (!encryptionSecret) {
      throw new ValidationError("缺少加密密钥配置");
    }

    // 创建挂载管理器和文件系统
    const repositoryFactory = c.get("repos");
    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager);

    // 在PUT时自动创建父目录
    const parentPath = path.substring(0, path.lastIndexOf("/"));
    if (parentPath && parentPath !== "/" && parentPath !== "") {
      try {
        console.log(`WebDAV PUT - 确保父目录存在: ${parentPath}`);
        await fileSystem.createDirectory(parentPath, userId, userType);
        console.log(`WebDAV PUT - 父目录已确保存在: ${parentPath}`);
      } catch (error) {
        // 如果目录已存在（409 Conflict），这是正常情况，继续上传
        if (error.status === 409 || error.message?.includes("已存在") || error.message?.includes("exists")) {
          console.log(`WebDAV PUT - 父目录已存在，继续上传: ${parentPath}`);
        } else {
          // 其他错误（如权限不足、存储空间不足等）应该阻止上传
          console.error(`WebDAV PUT - 创建父目录失败: ${error.message}`);
          throw error;
        }
      }
    }

    // 获取WebDAV上传模式设置
    const uploadMode = await getWebDAVUploadMode(db);
    console.log(`WebDAV PUT - 使用配置的上传模式: ${uploadMode}`);

    // 检查锁定状态
    const ifHeader = c.req.header("If");
    const lockConflict = checkLockPermission(lockManager, path, ifHeader, "PUT");
    if (lockConflict) {
      return new Response(lockConflict.message, {
        status: lockConflict.status,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // 获取请求头信息
    const contentLengthHeader = c.req.header("content-length");
    const clientContentType = c.req.header("content-type");
    const transferEncoding = c.req.header("transfer-encoding");
    const declaredContentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

    // 智能MIME类型检测：优先使用文件名推断，客户端类型作为备选
    const contentType = getEffectiveMimeType(clientContentType, path);
    const filename = path.split("/").pop();

    // 使用智能空文件检测（在获取流之前先依赖头部信息判断）
    const isEmptyFile = isReallyEmptyFile(declaredContentLength, transferEncoding);

    console.log(
      `WebDAV PUT - 开始处理: ${path}, 声明大小: ${declaredContentLength} 字节, 类型: ${contentType}, 空文件: ${
        isEmptyFile ? "是" : "否"
      }`
    );

    if (isEmptyFile) {
      console.log(`WebDAV PUT - 确认为空文件，使用FileSystem一次性上传`);

      // 使用 FileSystem 上传一个空文件
      const emptyBody = new Uint8Array(0);
      const result = await fileSystem.uploadFile(path, emptyBody, userId, userType, {
        filename,
        contentType,
        contentLength: 0,
      });

      console.log(`WebDAV PUT - 空文件上传成功，ETag: ${result.etag}`);

      return new Response(null, {
        status: 201, // Created
        headers: getStandardWebDAVHeaders({
          customHeaders: {
            "Content-Type": "text/plain",
            "Content-Length": "0",
          },
        }),
      });
    }

    // 对于非空文件，必须拿到底层请求体流；这里统一使用 raw.body，与 FS 流式上传保持一致
    const bodyStream = c.req.raw?.body || null;
    if (!bodyStream) {
      throw new ValidationError("请求体为空");
    }

    // 直接使用原始流（WebDAV 客户端通常是流式 PUT）
    const processedStream = bodyStream;

    // 对分块传输强制使用 chunked 模式
    let finalUploadMode = uploadMode;
    if (transferEncoding && transferEncoding.toLowerCase().includes("chunked")) {
      finalUploadMode = "chunked";
      console.log(`WebDAV PUT - 检测到分块传输，强制使用分块上传模式`);
    }

    // 根据最终决定的上传模式处理：
    // - single  ：按“表单/一次性”语义处理，先完整缓冲，再走驱动的表单上传路径
    // - chunked ：保持真正的流式上传语义
    if (finalUploadMode === "single") {
      console.log(`WebDAV PUT - 使用单次上传模式（一次性缓冲后上传）`);

      try {
        // 将请求体完整读入内存，作为“表单上传”数据交给 FileSystem
        const buffer = await c.req.arrayBuffer();
        const body = new Uint8Array(buffer);
        const effectiveLength = body.byteLength;

        const startTime = Date.now();
        const result = await fileSystem.uploadFile(path, body, userId, userType, {
          filename,
          contentType,
          contentLength: effectiveLength,
        });
        const duration = Date.now() - startTime;

        const speedMBps = effectiveLength > 0 ? (effectiveLength / 1024 / 1024 / (duration / 1000)).toFixed(2) : "未知";
        console.log(`WebDAV PUT - 单次上传成功，用时: ${duration}ms，速度: ${speedMBps}MB/s，ETag: ${result.etag}`);

        return new Response(null, {
          status: 201, // Created
          headers: getStandardWebDAVHeaders({
            customHeaders: {
              "Content-Type": "text/plain",
              "Content-Length": "0",
              ETag: result.etag || "",
            },
          }),
        });
      } catch (error) {
        console.error(`WebDAV PUT - 单次上传失败: ${error.message}`);
        throw error;
      }
    } else {
      // 使用分块上传模式：保持真正的流式语义，直接传递 Web ReadableStream
      console.log(`WebDAV PUT - 使用分块上传模式（流式上传）`);

      try {
        const startTime = Date.now();
        const result = await fileSystem.uploadFile(path, processedStream, userId, userType, {
          filename,
          contentType,
          contentLength: declaredContentLength,
        });
        const duration = Date.now() - startTime;

        const speedMBps = declaredContentLength > 0 ? (declaredContentLength / 1024 / 1024 / (duration / 1000)).toFixed(2) : "未知";
        console.log(`WebDAV PUT - 分块上传成功，用时: ${duration}ms，速度: ${speedMBps}MB/s，ETag: ${result.etag}`);

        return new Response(null, {
          status: 201, // Created
          headers: getStandardWebDAVHeaders({
            customHeaders: {
              "Content-Type": "text/plain",
              "Content-Length": "0",
              ETag: result.etag || "",
            },
          }),
        });
      } catch (error) {
        console.error(`WebDAV PUT - 分块上传失败: ${error.message}`);
        throw error;
      }
    }
  }, { includeDetails: true });
}

