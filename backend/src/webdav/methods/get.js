/**
 * 处理WebDAV GET请求
 * 用于获取文件内容
 */
import { MountManager } from "../../storage/managers/MountManager.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { createWebDAVErrorResponse, withWebDAVErrorHandling } from "../utils/errorUtils.js";
import { addWebDAVHeaders, getStandardWebDAVHeaders } from "../utils/headerUtils.js";
import { getEffectiveMimeType } from "../../utils/fileUtils.js";

/**
 * 从驱动返回结果中提取 URL
 * 当前 WebDAV 场景下，generateDownloadUrl / generateWebDavProxyUrl 约定返回 string 或 { url, presignedUrl? }
 * @param {*} result - 驱动返回的结果
 * @returns {string|null} 提取的 URL 或 null
 */
function extractUrlFromResult(result) {
  if (!result) return null;
  if (typeof result === "string") return result;
  if (typeof result === "object") {
    return result.url || result.presignedUrl || null;
  }
  return null;
}

/**
 * 通过本地代理下载文件（native_proxy）
 * @param {FileSystem} fileSystem - 文件系统实例
 * @param {string} path - 文件路径
 * @param {string} fileName - 文件名
 * @param {Object} c - Hono 上下文
 * @param {string} userId - 用户ID
 * @param {string} userType - 用户类型
 * @param {string} contentType - 内容类型
 * @param {string} lastModifiedStr - 最后修改时间字符串
 * @param {string} etag - ETag
 * @returns {Promise<Response>} WebDAV 响应
 */
async function downloadViaProxy(fileSystem, path, fileName, c, userId, userType, contentType, lastModifiedStr, etag) {
  console.log(`WebDAV GET - 使用本地代理模式: ${path}`);
  const fileResponse = await fileSystem.downloadFile(path, fileName, c.req, userId, userType);

  const updatedHeaders = new Headers(fileResponse.headers);
  updatedHeaders.set("Content-Type", contentType);
  updatedHeaders.set("Last-Modified", lastModifiedStr);
  if (etag) {
    updatedHeaders.set("ETag", etag);
  }
  updatedHeaders.set("Accept-Ranges", "bytes");
  updatedHeaders.set("Cache-Control", "max-age=3600");

  const response = new Response(fileResponse.body, {
    status: fileResponse.status,
    headers: updatedHeaders,
  });

  return addWebDAVHeaders(response);
}

/**
 * 处理GET请求
 * @param {Object} c - Hono上下文
 * @param {string} path - 请求路径
 * @param {string} userId - 用户ID
 * @param {string} userType - 用户类型 (admin 或 apiKey)
 * @param {D1Database} db - D1数据库实例
 */
export async function handleGet(c, path, userId, userType, db) {
  const isHead = c.req.method === "HEAD";
  return withWebDAVErrorHandling("GET", async () => {
    // 创建FileSystem实例
    const repositoryFactory = c.get("repos");
    const mountManager = new MountManager(db, getEncryptionSecret(c), repositoryFactory);
    const fileSystem = new FileSystem(mountManager);

    // 获取文件名并统一从文件名推断MIME类型
    const fileName = path.split("/").pop();
    const contentType = getEffectiveMimeType(null, fileName);
    console.log(`WebDAV GET - 从文件名[${fileName}]推断MIME类型: ${contentType}`);

    // 处理条件请求头
    const ifNoneMatch = c.req.header("If-None-Match");
    const ifModifiedSince = c.req.header("If-Modified-Since");
    const ifMatch = c.req.header("If-Match");
    const ifUnmodifiedSince = c.req.header("If-Unmodified-Since");

    // 首先获取文件信息以检查条件请求
    let fileInfo;
    try {
      fileInfo = await fileSystem.getFileInfo(path, userId, userType);
    } catch (error) {
      if (error.status === 404) {
        return createWebDAVErrorResponse("文件不存在", 404);
      }
      throw error;
    }

    // 从文件信息中提取元数据
    const etag = fileInfo.etag ? `"${fileInfo.etag}"` : "";
    const lastModified = fileInfo.modified ? new Date(fileInfo.modified) : new Date();
    const lastModifiedStr = lastModified.toUTCString();
    const contentLength = fileInfo.size || 0;

    // 检查ETag匹配（如果提供了If-None-Match头）
    if (ifNoneMatch && etag) {
      // 移除引号以进行比较
      const clientEtag = ifNoneMatch.replace(/^"(.*)"$/, "$1");
      const serverEtag = etag.replace(/^"(.*)"$/, "$1");

      if (clientEtag === serverEtag || clientEtag === "*") {
        console.log(`GET请求: ETag匹配 ${etag}，返回304 Not Modified`);
        return new Response(null, {
          status: 304, // Not Modified
          headers: {
            ETag: etag,
            "Last-Modified": lastModifiedStr,
            "Cache-Control": "max-age=3600",
          },
        });
      }
    }

    // 检查修改时间（如果提供了If-Modified-Since头且没有If-None-Match头或ETag不匹配）
    if (ifModifiedSince && !ifNoneMatch) {
      try {
        const modifiedSinceDate = new Date(ifModifiedSince);

        // 将时间戳向下取整到秒，因为HTTP日期不包含毫秒
        const modifiedSinceTime = Math.floor(modifiedSinceDate.getTime() / 1000) * 1000;
        const lastModifiedTime = Math.floor(lastModified.getTime() / 1000) * 1000;

        if (lastModifiedTime <= modifiedSinceTime) {
          console.log(`GET请求: 文件未修改，返回304 Not Modified`);
          return new Response(null, {
            status: 304, // Not Modified
            headers: {
              ETag: etag,
              "Last-Modified": lastModifiedStr,
              "Cache-Control": "max-age=3600",
            },
          });
        }
      } catch (dateError) {
        console.warn(`GET请求: If-Modified-Since头格式无效: ${ifModifiedSince}`);
        // 如果日期格式无效，忽略此头，继续处理请求
      }
    }

    // 处理If-Match头（确保资源匹配）
    if (ifMatch && etag) {
      const clientEtag = ifMatch.replace(/^"(.*)"$/, "$1");
      const serverEtag = etag.replace(/^"(.*)"$/, "$1");

      if (clientEtag !== "*" && clientEtag !== serverEtag) {
        console.log(`GET请求: If-Match条件不满足 ${ifMatch} != ${etag}`);
        return createWebDAVErrorResponse("资源已被修改", 412); // Precondition Failed
      }
    }

    // 处理If-Unmodified-Since头
    if (ifUnmodifiedSince) {
      try {
        const unmodifiedSinceDate = new Date(ifUnmodifiedSince);

        // 将时间戳向下取整到秒
        const unmodifiedSinceTime = Math.floor(unmodifiedSinceDate.getTime() / 1000) * 1000;
        const lastModifiedTime = Math.floor(lastModified.getTime() / 1000) * 1000;

        if (lastModifiedTime > unmodifiedSinceTime) {
          console.log(`GET请求: If-Unmodified-Since条件不满足`);
          return createWebDAVErrorResponse("资源已被修改", 412); // Precondition Failed
        }
      } catch (dateError) {
        console.warn(`GET请求: If-Unmodified-Since头格式无效: ${ifUnmodifiedSince}`);
        // 如果日期格式无效，忽略此头，继续处理请求
      }
    }

    // 如果是HEAD请求，返回头信息
    if (isHead) {
      return new Response(null, {
        status: 200,
        headers: {
          "Content-Length": String(contentLength),
          "Content-Type": contentType,
          "Last-Modified": lastModifiedStr,
          ETag: etag,
          "Accept-Ranges": "bytes",
          "Cache-Control": "max-age=3600",
        },
      });
    }

    // 根据挂载点的 webdav_policy 配置决定处理方式
    const { driver, mount, subPath } = await mountManager.getDriverByPath(path, userId, userType);
    const policy = mount.webdav_policy || "native_proxy";

    switch (policy) {
      case "302_redirect": {
        // 策略 1：存储直链重定向（通过驱动自己的 generateDownloadUrl 能力）
        if (typeof driver.generateDownloadUrl === "function") {
          try {
            console.log(`WebDAV GET - 尝试生成存储直链: ${path}`);
            const result = await driver.generateDownloadUrl(path, {
              mount,
              subPath,
              db,
              userId,
              userType,
              forceDownload: false,
            });

            const url = extractUrlFromResult(result);
            if (url) {
              console.log(`WebDAV GET - 302 重定向到存储直链: ${url}`);
              return new Response(null, {
                status: 302,
                headers: getStandardWebDAVHeaders({
                  customHeaders: {
                    Location: url,
                    "Cache-Control": "no-cache",
                  },
                }),
              });
            }
          } catch (error) {
            console.warn(`WebDAV GET - 生成存储直链失败，降级到本地代理:`, error?.message || error);
          }
        }

        console.log(`WebDAV GET - 驱动不支持直链生成或未返回 URL，降级到本地代理`);
        return downloadViaProxy(fileSystem, path, fileName, c, userId, userType, contentType, lastModifiedStr, etag);
      }

      case "use_proxy_url": {
        // 策略 2：自定义域名 / 代理 URL 重定向（custom_host_proxy），由驱动生成 URL
        if (typeof driver.generateWebDavProxyUrl === "function") {
          try {
            const result = await driver.generateWebDavProxyUrl(path, {
              mount,
              subPath,
              db,
              request: c.req.raw,
            });
            const url = extractUrlFromResult(result);
            if (url) {
              console.log(`WebDAV GET - URL代理custom_host_proxy URL: ${url}`);
              return new Response(null, {
                status: 302,
                headers: getStandardWebDAVHeaders({
                  customHeaders: {
                    Location: url,
                    "Cache-Control": "no-cache",
                  },
                }),
              });
            }
          } catch (error) {
            console.warn(`WebDAV GET - 生成 use_proxy_url 代理链接失败，降级到本地代理:`, error?.message || error);
          }
        }

        console.warn(`WebDAV GET - use_proxy_url 策略但未配置 custom_host 或驱动不支持，降级到本地代理`);
        return downloadViaProxy(fileSystem, path, fileName, c, userId, userType, contentType, lastModifiedStr, etag);
      }

      case "native_proxy":
      default: {
        // 策略 3：本地服务器代理（默认兜底）
        return downloadViaProxy(fileSystem, path, fileName, c, userId, userType, contentType, lastModifiedStr, etag);
      }
    }
  });
}
