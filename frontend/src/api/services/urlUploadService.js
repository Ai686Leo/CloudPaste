/**
 * URL上传服务API
 * 负责处理URL验证、元信息获取和上传逻辑的前端API接口
 * 支持桌面端和移动端使用，包括分片上传功能
 */

import { post } from "../client";
import { getFullApiUrl } from "../config";
import { completeFileUpload } from "./fileService";

/**
 * 验证URL并获取文件元信息
 * @param {string} url - 要验证的URL
 * @returns {Promise<Object>} 包含文件元信息的响应
 */
export async function validateUrlInfo(url) {
  return await post("share/url/info", { url });
}

/**
 * 获取URL代理地址（用于处理不支持CORS的资源）
 * @param {string} url - 原始URL
 * @returns {string} 代理URL
 */
export function getProxyUrl(url) {
  const params = new URLSearchParams({ url });
  return getFullApiUrl(`share/url/proxy?${params.toString()}`);
}

/**
 * 检查错误是否是跨域(CORS)错误
 * @param {Error} error - 捕获到的错误对象
 * @returns {boolean} - 是否是跨域错误
 */
function isCorsError(error) {
  // 典型的CORS错误特征
  if (error.name === "NetworkError") return true;
  if (error.message.includes("CORS")) return true;
  if (error.message.includes("cross-origin")) return true;
  if (error.message.includes("access-control-allow-origin")) return true;
  if (error.message.includes("NetworkError")) return true;
  // XMLHttpRequest的错误检测
  // 通常CORS错误会导致状态为0和空statusText
  if (error.xhr && error.xhr.status === 0 && error.xhr.statusText === "") return true;

  return false;
}

/**
 * 通用的URL内容获取函数
 * 先尝试直接获取URL内容，如果出现CORS错误或其他网络错误，则切换到使用代理URL
 * @param {Object} options - 获取选项
 * @param {string} options.url - 要获取的URL
 * @param {Function} [options.onProgress] - 进度回调，参数为(progress, loaded, total, phase)
 * @param {Function} [options.setXhr] - 设置xhr引用的回调函数，用于取消请求
 * @param {string} [options.statusText] - 可选的自定义状态文本
 * @returns {Promise<Blob>} 获取到的内容Blob
 */
export async function fetchUrlContent(options) {
  // 首先尝试直接获取URL内容
  try {
    console.log(`尝试直接获取URL: ${options.url}`);
    return await fetchFromUrl(options.url, options.onProgress, options.setXhr, "directDownload");
  } catch (error) {
    // 用户主动取消下载时，直接抛出错误，不尝试代理重试
    if (error.message === "下载已取消") {
      throw error;
    }

    console.warn(`直接获取URL内容失败: ${error.message}`);

    // 检查是否是CORS错误或其他网络错误，如果是则尝试使用代理
    if (isCorsError(error) || error.message.includes("获取URL内容失败")) {
      console.log(`检测到跨域问题，切换到代理模式获取URL: ${options.url}`);
      // 使用代理URL重试
      const proxyUrl = getProxyUrl(options.url);
      return await fetchFromUrl(proxyUrl, options.onProgress, options.setXhr, "proxyDownload");
    }

    // 其他错误则直接抛出
    throw error;
  }
}

/**
 * 内部辅助函数：从指定URL获取内容
 * @param {string} url - 要获取的URL
 * @param {Function} [onProgress] - 进度回调函数
 * @param {Function} [setXhr] - 设置xhr引用的回调函数
 * @param {string} [phaseType] - 下载阶段类型
 * @returns {Promise<Blob>} 获取到的内容Blob
 * @private
 */
function fetchFromUrl(url, onProgress, setXhr, phaseType) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "blob";

    // 如果提供了setXhr回调，则传递xhr引用
    if (setXhr) {
      setXhr(xhr);
    }

    // 进度事件
    xhr.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        // 下载进度从 0% 到 100%
        const progress = Math.round((event.loaded / event.total) * 100);
        onProgress(progress, event.loaded, event.total, "downloading", phaseType);
      }
    };

    xhr.onerror = () => {
      // 将xhr添加到错误对象，方便检测CORS错误
      const error = new Error("获取URL内容失败");
      error.xhr = xhr;
      reject(error);
    };

    xhr.onabort = () => {
      reject(new Error("下载已取消"));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response);
      } else {
        reject(new Error(`获取URL内容失败: HTTP ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.send();
  });
}


