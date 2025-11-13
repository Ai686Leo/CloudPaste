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
        // 下载过程占总进度的49%，保留1%给最终确认步骤
        const progress = Math.round((event.loaded / event.total) * 49);
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

/**
 * 获取URL上传的预签名URL
 * @param {Object} options - 上传选项
 * @param {string} options.url - 要上传的URL
 * @param {string} options.storage_config_id - 存储配置ID
 * @param {Object} [options.metadata] - 可选的文件元数据
 * @param {string} [options.filename] - 可选的自定义文件名
 * @param {string} [options.slug] - 可选的自定义链接
 * @param {string} [options.remark] - 可选的备注
 * @param {string} [options.path] - 可选的存储路径
 * @returns {Promise<Object>} 包含预签名URL和文件ID的响应
 */
export async function getUrlUploadPresignedUrl(options) {
  try {
    const data = {
      url: options.url,
      storage_config_id: options.storage_config_id || null,
      path: options.path || null,
    };

    if (options.filename) data.filename = options.filename;
    if (options.contentType) data.contentType = options.contentType;
    if (options.fileSize !== undefined) data.fileSize = options.fileSize;

    return await post("share/url/presign", data);
  } catch (error) {
    throw new Error(`获取URL上传预签名失败: ${error.message}`);
  }
}

/**
 * 使用预签名URL从原始URL上传文件到指定存储
 * @param {Object} options - 上传选项
 * @param {string} options.url - 源URL
 * @param {string} options.uploadUrl - 预签名上传URL
 * @param {Function} [options.onProgress] - 上传进度回调
 * @param {Function} [options.setXhr] - 设置xhr引用的回调函数，用于取消上传
 * @returns {Promise<Object>} 上传结果
 */
export async function uploadUrlContentToStorage(options) {
  return new Promise(async (resolve, reject) => {
    try {
      // 首先从源URL获取内容，使用通用的URL内容获取函数
      const blob = await fetchUrlContent({
        url: options.url,
        onProgress: options.onProgress,
        setXhr: options.setXhr,
      });

      // 现在将获取的内容上传到目标存储
      const uploadXhr = new XMLHttpRequest();
      uploadXhr.open("PUT", options.uploadUrl);

      // 如果提供了setXhr回调，则更新xhr引用
      if (options.setXhr) {
        options.setXhr(uploadXhr);
      }

      // 上传进度事件
      uploadXhr.upload.onprogress = (event) => {
        if (event.lengthComputable && options.onProgress) {
          // 上传占总进度的49%，从50%开始计算到99%，保留最后1%给完成阶段
          const progress = 50 + Math.round((event.loaded / event.total) * 49);
          options.onProgress(progress, event.loaded, event.total, "uploading");
        }
      };

      uploadXhr.onerror = () => {
        reject(new Error("上传到存储失败"));
      };

      uploadXhr.onload = () => {
        if (uploadXhr.status >= 200 && uploadXhr.status < 300) {
          // 获取ETag
          const etag = uploadXhr.getResponseHeader("ETag");
          const cleanEtag = etag ? etag.replace(/"/g, "") : null;

          if (!etag) {
            console.warn("URL上传成功但未返回ETag，可能是CORS限制导致");
          }

          resolve({
            success: true,
            etag: cleanEtag,
            size: blob.size,
          });
        } else {
          reject(new Error(`上传到存储失败: HTTP ${uploadXhr.status}`));
        }
      };

      uploadXhr.send(blob);
    } catch (error) {
      reject(new Error(`URL上传失败: ${error.message}`));
    }
  });
}

/**
 * 提交URL上传完成信息
 * @param {Object} data - 上传完成数据
 * @param {string} data.file_id - 文件ID
 * @param {string} data.etag - 文件ETag
 * @param {number} [data.size] - 文件大小（字节）
 * @param {string} [data.remark] - 备注
 * @param {string} [data.password] - 密码
 * @param {number} [data.expires_in] - 过期时间（小时）
 * @param {number} [data.max_views] - 最大查看次数
 * @returns {Promise<Object>} 提交响应
 */
export async function commitUrlUpload(data) {
  try {
    // 新协议：优先使用 key + storage_config_id；兼容 commit_suggestion 旧结构
    return await completeFileUpload({
      key: data.key || (data.commit_suggestion && data.commit_suggestion.key) || undefined,
      storage_config_id: data.storage_config_id || (data.commit_suggestion && data.commit_suggestion.storage_config_id) || undefined,
      path: data.path, // 兼容保留
      filename: data.filename,
      size: data.size,
      etag: data.etag,
      slug: data.slug,
      remark: data.remark,
      password: data.password,
      expires_in: data.expires_in,
      max_views: data.max_views,
      use_proxy: data.use_proxy,
      original_filename: data.original_filename ?? false,
    });
  } catch (error) {
    throw new Error(`提交URL上传完成信息失败: ${error.message}`);
  }
}

/******************************************************************************
 * 高级功能API函数
 ******************************************************************************/

