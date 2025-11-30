/**
 * 文件下载与预览服务
 * 统一处理带认证头的下载与 S3 预签名预览等场景
 */

import { getFullApiUrl } from "../config.js";
import { fetchApi } from "../client.js";

/**
 * 使用 fetch 下载文件并触发浏览器下载
 * @param {string} url - 文件 URL（可以是后端代理或预签名 URL）
 * @param {string} filename - 下载文件名
 * @param {{ signal?: AbortSignal; timeout?: number; maxSize?: number; headers?: Record<string,string> }} [options]
 * @returns {Promise<void>}
 */
export async function downloadFileWithAuth(url, filename, options = {}) {
  try {
    console.log("请求下载URL:", url);

    // 复用统一的带鉴权二进制获取逻辑，避免各处自己处理认证头
    const { buffer } = await fetchFileBinaryWithAuth(url, options);
    const blob = new Blob([buffer]);

    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = filename;

    document.body.appendChild(link);
    link.click();

    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    console.error("文件下载出错:", error);
    throw error;
  }
}

/**
 * 创建预览用的 Blob URL
 * 主要用于需要先拉取再本地预览的场景
 * @param {string} url - 文件预览 URL（通常为 S3 预签名或后端代理 URL）
 * @returns {Promise<string>} 可用于 <img>/<video> 等标签的 Blob URL
 */
export async function createAuthenticatedPreviewUrl(url) {
  try {
    console.log("请求预览URL:", url);

    if (!url) {
      throw new Error("预览URL为空");
    }

    // 对本服务的 API（/api/...）使用统一的 fetchApi，复用认证/错误处理逻辑；
    // 对外部直链（http/https）保持最小封装，直接 fetch。
    let blob;
    if (url.startsWith("/api/")) {
      // 去掉 /api 前缀，交给 fetchApi 处理（包含 Authorization 头与统一超时/错误处理）
      const endpoint = url.slice(5); // 去掉前导 "/api/"
      blob = await fetchApi(endpoint, { method: "GET", responseType: "blob" });
    } else if (!url.startsWith("http")) {
      // 相对端点（不带 /api 前缀），通过 getFullApiUrl 构建完整地址，但不做认证处理
      const finalUrl = getFullApiUrl(url);
      const response = await fetch(finalUrl, { mode: "cors", credentials: "omit" });
      if (!response.ok) {
        throw new Error(`预览加载失败: ${response.status} ${response.statusText}`);
      }
      blob = await response.blob();
    } else {
      // 绝对外部直链（例如 S3 预签名），直接 fetch，不携带本服务的认证信息
      const response = await fetch(url, { mode: "cors", credentials: "omit" });
      if (!response.ok) {
        throw new Error(`预览加载失败: ${response.status} ${response.statusText}`);
      }
      blob = await response.blob();
    }

    return window.URL.createObjectURL(blob);
  } catch (error) {
    console.error("预览URL创建失败:", error);
    throw error;
  }
}

/**
 * 获取文件的二进制数据（带鉴权）
 * - 对 /api/ 开头的 URL 统一通过 fetchApi 复用认证与错误处理
 * - 对其他 URL 使用原生 fetch，保持最小封装
 * @param {string} url - 文件 URL（可以是 Down 路由或直链）
 * @param {Object} options - 选项
 * @param {AbortSignal} [options.signal] - 取消信号
 * @param {number} [options.timeout] - 超时时间（毫秒），仅在未提供 signal 时用于原生 fetch
 * @param {number} [options.maxSize] - 最大允许大小（字节），超出则抛出错误
 * @param {Record<string,string>} [options.headers] - 额外请求头（例如路径密码 token）
 * @returns {Promise<{ buffer: ArrayBuffer, size: number }>}
 */
export async function fetchFileBinaryWithAuth(url, options = {}) {
  if (!url) {
    throw new Error("URL不能为空");
  }

  const { signal, timeout, maxSize, headers } = options;

  // 对本服务的 API 路径统一走 fetchApi，复用认证与错误处理
  if (url.startsWith("/api/")) {
    const endpoint = url.slice(5);

    const blob = await fetchApi(endpoint, {
      method: "GET",
      responseType: "blob",
      signal,
      timeout,
      headers,
    });

    if (maxSize && blob.size > maxSize) {
      throw new Error(
        `文件过大: ${Math.round(
          blob.size / 1024 / 1024,
        )}MB，超过限制 ${Math.round(maxSize / 1024 / 1024)}MB`,
      );
    }

    const buffer = await blob.arrayBuffer();

    return {
      buffer,
      size: buffer.byteLength,
    };
  }

  // 其他 URL（直链或相对路径）：保持最小封装，按需添加超时控制
  const effectiveTimeout = timeout ?? 30000;

  let controller = null;
  let finalSignal = signal;

  if (!finalSignal) {
    controller = new AbortController();
    finalSignal = controller.signal;
    setTimeout(() => {
      if (controller) {
        controller.abort();
      }
    }, effectiveTimeout);
  }

  const response = await fetch(url, {
    method: "GET",
    signal: finalSignal,
    headers,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentLength = response.headers.get("content-length");
  if (maxSize && contentLength && parseInt(contentLength, 10) > maxSize) {
    throw new Error(
      `文件过大: ${Math.round(
        parseInt(contentLength, 10) / 1024 / 1024,
      )}MB，超过限制 ${Math.round(maxSize / 1024 / 1024)}MB`,
    );
  }

  const buffer = await response.arrayBuffer();

  if (maxSize && buffer.byteLength > maxSize) {
    throw new Error(
      `文件过大: ${Math.round(
        buffer.byteLength / 1024 / 1024,
      )}MB，超过限制 ${Math.round(maxSize / 1024 / 1024)}MB`,
    );
  }

  return {
    buffer,
    size: buffer.byteLength,
  };
}
