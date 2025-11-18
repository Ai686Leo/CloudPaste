/**
 * 文件下载与预览服务
 * 统一处理带认证头的下载与 S3 预签名预览等场景
 */

import { buildAuthHeaders } from "../authHeaders.js";

/**
 * 使用 fetch 下载文件并触发浏览器下载
 * @param {string} url - 文件 URL（可以是后端代理或预签名 URL）
 * @param {string} filename - 下载文件名
 * @returns {Promise<void>}
 */
export async function downloadFileWithAuth(url, filename) {
  try {
    console.log("请求下载URL:", url);

    const response = await fetch(url, {
      headers: buildAuthHeaders({}),
      mode: "cors",
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`下载失败: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();

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

    const response = await fetch(url, {
      mode: "cors",
    });

    if (!response.ok) {
      throw new Error(`预览加载失败: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    return window.URL.createObjectURL(blob);
  } catch (error) {
    console.error("预览URL创建失败:", error);
    throw error;
  }
}

