/**
 * 文件二进制获取服务
 * 统一处理带认证头的二进制拉取（文本编码检测/本地解码等场景）
 */

import { fetchApi } from "../client.js";

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
