/**
 * 文件系统服务API
 */

import { get, post, del } from "../client";
import { API_BASE_URL } from "../config";
// Legacy StorageMultipartUploader removed. Multipart flows are handled by Uppy AwsS3 plugin or driver engine.

/******************************************************************************
 * 统一文件系统API函数
 ******************************************************************************/

/**
 * 获取目录列表
 * @param {string} path 请求路径
 * @param {Object} options 选项参数
 * @param {boolean} options.refresh 是否强制刷新，跳过缓存
 * @returns {Promise<Object>} 目录列表响应对象
 */
export async function getDirectoryList(path, options = {}) {
  const params = { path };
  if (options.refresh) {
    params.refresh = "true";
  }
  const requestOptions = { params };
  if (options.headers) {
    requestOptions.headers = options.headers;
  }
  return get("/fs/list", requestOptions);
}

/**
 * 获取文件信息
 * @param {string} path 文件路径
 * @param {{ headers?: Record<string,string> }} [options] 可选请求配置（如路径密码token等）
 * @returns {Promise<Object>} 文件信息响应对象
 */
export async function getFileInfo(path, options = {}) {
  /** @type {{ params: Record<string,string>, headers?: Record<string,string> }} */
  const requestOptions = {
    params: { path },
  };
  if (options.headers) {
    requestOptions.headers = options.headers;
  }
  return get("/fs/get", requestOptions);
}

/**
 * 搜索文件
 * @param {string} query 搜索查询字符串
 * @param {Object} searchParams 搜索参数对象
 * @param {string} searchParams.scope 搜索范围 ('global', 'mount', 'directory')
 * @param {string} searchParams.mountId 挂载点ID（当scope为'mount'时）
 * @param {string} searchParams.path 搜索路径（当scope为'directory'时）
 * @param {number} searchParams.limit 结果限制数量，默认50
 * @param {number} searchParams.offset 结果偏移量，默认0
 * @returns {Promise<Object>} 搜索结果响应对象
 */
export async function searchFiles(query, searchParams = {}) {
  const params = {
    q: query,
    scope: searchParams.scope || "global",
    limit: (searchParams.limit || 50).toString(),
    offset: (searchParams.offset || 0).toString(),
  };

  // 添加可选参数
  if (searchParams.mountId) {
    params.mount_id = searchParams.mountId;
  }
  if (searchParams.path) {
    params.path = searchParams.path;
  }

  return get("/fs/search", { params });
}

/**
 * 创建目录
 * @param {string} path 目录路径
 * @returns {Promise<Object>} 创建结果响应对象
 */
export async function createDirectory(path) {
  return post(`/fs/mkdir`, { path });
}

/**
 * 上传文件（通过 /fs/upload，后端根据存储驱动自适应选择流式/表单实现）
 * @param {string} path 目标路径
 * @param {File} file 文件对象
 * @param {Function} onXhrCreated XHR创建后的回调，用于保存引用以便取消请求
 * @returns {Promise<Object>} 上传结果响应对象
 */
export async function uploadFile(path, file, onXhrCreated) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("path", path);

  return post(`/fs/upload`, formData, { onXhrCreated });
}

/**
 * 批量删除文件或目录（统一删除接口）
 * 支持单个路径或路径数组，文件直接删除，目录递归删除
 * @param {string|Array<string>} pathsOrPath 文件路径或路径数组
 * @returns {Promise<Object>} 删除结果响应对象
 */
export async function batchDeleteItems(pathsOrPath) {
  // 统一处理单个路径和路径数组
  const paths = Array.isArray(pathsOrPath) ? pathsOrPath : [pathsOrPath];

  // 统一使用批量删除接口，DELETE 方法带请求体
  return del(`/fs/batch-remove`, { paths });
}

/**
 * 重命名文件或目录
 * @param {string} oldPath 旧路径
 * @param {string} newPath 新路径
 * @returns {Promise<Object>} 重命名结果响应对象
 */
export async function renameItem(oldPath, newPath) {
  return post(`/fs/rename`, { oldPath, newPath });
}

/**
 * 更新文件内容
 * @param {string} path 文件路径
 * @param {string} content 新的文件内容
 * @returns {Promise<Object>} 更新结果响应对象
 */
export async function updateFile(path, content) {
  return post(`/fs/update`, { path, content });
}

/**
 * 获取文件直链
 * @param {string} path 文件路径
 * @param {number|null} expiresIn 过期时间（秒），null表示使用存储配置的默认签名时间
 * @param {boolean} forceDownload 是否强制下载而非预览
 * @returns {Promise<string>} 预签名访问 URL（可能是直链或代理 URL）
 */
export async function getFileLink(path, expiresIn = null, forceDownload = false) {
  const params = {
    path: path,
    force_download: forceDownload.toString(),
  };

  // 只有当expiresIn不为null时才添加expires_in参数
  if (expiresIn !== null) {
    params.expires_in = expiresIn.toString();
  }

  const resp = await get("/fs/file-link", { params });
  if (!resp || resp.success === false) {
    throw new Error(resp?.message || "获取文件直链失败");
  }
  const url = resp?.data?.rawUrl;
  if (!url) {
    throw new Error(resp?.message || "获取文件直链失败");
  }
  return url;
}

/**
 * 校验目录路径密码
 * @param {string} path 目标路径
 * @param {string} password 明文密码
 * @returns {Promise<{ success: boolean; requiresPassword: boolean; verified: boolean; token?: string | null; path?: string }>}
 */
export async function verifyPathPassword(path, password) {
  const response = await post("/fs/meta/password/verify", { path, password });
  if (response && typeof response === "object" && "data" in response) {
    return /** @type {{ verified: boolean; requiresPassword: boolean; token?: string | null; path?: string }} */ (
      response.data
    );
  }
  return response;
}

/******************************************************************************
 * 分片上传相关API函数
 ******************************************************************************/

/**
 * 初始化前端分片上传（生成预签名URL列表）
 * @param {string} path 目标路径
 * @param {string} fileName 文件名
 * @param {number} fileSize 文件大小
 * @param {string} contentType 文件类型（可选，后端会推断）
 * @param {number} partSize 分片大小（默认5MB）
 * @returns {Promise<Object>} 初始化结果响应对象
 */
export async function initMultipartUpload(path, fileName, fileSize, contentType, partSize = 5 * 1024 * 1024) {
  const partCount = Math.ceil(fileSize / partSize);

  return post(`/fs/multipart/init`, {
    path,
    fileName,
    fileSize,
    partSize,
    partCount,
  });
}

/**
 * 完成前端分片上传
 * @param {string} path 文件路径
 * @param {string} uploadId 上传ID
 * @param {Array<{partNumber: number, etag: string}>} parts 所有已上传分片的信息
 * @param {string} fileName 文件名
 * @param {number} fileSize 文件大小（字节）
 * @returns {Promise<Object>} 完成上传结果响应对象
 */
export async function completeMultipartUpload(path, uploadId, parts, fileName, fileSize) {
  return post(`/fs/multipart/complete`, {
    path,
    uploadId,
    parts,
    fileName,
    fileSize,
  });
}

/**
 * 中止前端分片上传
 * @param {string} path 文件路径
 * @param {string} uploadId 上传ID
 * @param {string} fileName 文件名
 * @returns {Promise<Object>} 中止上传结果响应对象
 */
export async function abortMultipartUpload(path, uploadId, fileName) {
  return post(`/fs/multipart/abort`, { path, uploadId, fileName });
}

//============断点续传================

/**
 * 列出进行中的分片上传
 * @param {string} path 目标路径（可选，用于过滤特定文件的上传）
 * @returns {Promise<Object>} 进行中的上传列表响应对象
 */
export async function listMultipartUploads(path = "") {
  return post(`/fs/multipart/list-uploads`, { path });
}

/**
 * 列出已上传的分片
 * @param {string} path 文件路径
 * @param {string} uploadId 上传ID
 * @param {string} fileName 文件名
 * @returns {Promise<Object>} 已上传的分片列表响应对象
 */
export async function listMultipartParts(path, uploadId, fileName) {
  return post(`/fs/multipart/list-parts`, { path, uploadId, fileName });
}

/**
 * 为现有上传刷新预签名URL
 * @param {string} path 文件路径
 * @param {string} uploadId 现有的上传ID
 * @param {Array} partNumbers 需要刷新URL的分片编号数组
 * @returns {Promise<Object>} 刷新的预签名URL列表响应对象
 */
export async function refreshMultipartUrls(path, uploadId, partNumbers) {
  return post(`/fs/multipart/refresh-urls`, { path, uploadId, partNumbers });
}

/******************************************************************************
 * 预签名URL上传相关API函数
 ******************************************************************************/

/**
 * 获取预签名上传URL
 * @param {string} path 目标路径
 * @param {string} fileName 文件名
 * @param {string} contentType 文件类型
 * @param {number} fileSize 文件大小
 * @returns {Promise<Object>} 预签名URL响应对象
 */
export async function getPresignedUploadUrl(path, fileName, contentType, fileSize) {
  return post(`/fs/presign`, {
    path,
    fileName,
    contentType,
    fileSize,
  });
}

/**
 * 提交预签名URL上传完成
 * @param {Object} uploadInfo 上传信息对象
 * @param {string} etag ETag
 * @param {string} contentType 文件MIME类型
 * @param {number} fileSize 文件大小
 * @returns {Promise<Object>} 提交结果响应对象
 */
export async function commitPresignedUpload(uploadInfo, etag, contentType, fileSize) {
  return post(`/fs/presign/commit`, {
    ...uploadInfo,
    etag,
    contentType,
    fileSize,
  });
}

/******************************************************************************
 * 复制相关API函数
 ******************************************************************************/

/**
 * 批量复制文件或目录（统一任务模式）
 *
 * 所有复制操作统一创建任务，由后端 CopyTaskHandler 负责执行。
 * 复制策略（同存储/跨存储/S3优化）由后端内部决策。
 *
 * @param {Array<{sourcePath: string, targetPath: string}>} items 要复制的项目数组，每项包含源路径和目标路径
 * @param {Object} options 选项参数
 * @param {boolean} [options.skipExisting=true] 是否跳过已存在的文件
 * @returns {Promise<Object>} 批量复制结果响应对象 { success, data: { jobId, taskType, status, stats, createdAt } }
 */
export async function batchCopyItems(items, options = {}) {
  const skipExisting = options.skipExisting !== false;

  // 统一任务模式：调用 batch-copy API，始终返回 jobId
  // 复制策略由后端 CopyTaskHandler 内部决策
  return post(`/fs/batch-copy`, { items, skipExisting });
}

/**
 * 从文件系统创建分享链接
 * @param {string} path 文件路径
 * @returns {Promise<Object>} 创建结果响应对象
 */
export async function createShareFromFileSystem(path) {
  return post(`/fs/create-share`, { path });
}

/******************************************************************************
 * 辅助上传功能API函数
 ******************************************************************************/

/**
 * 使用预签名URL上传文件
 * @param {string} url 预签名URL
 * @param {File|Blob|ArrayBuffer} data 要上传的数据
 * @param {string} contentType 文件MIME类型
 * @param {Function} onProgress 进度回调函数
 * @param {Function} onCancel 取消检查函数
 * @param {Function} setXhr 设置XHR引用的函数
 * @returns {Promise<Object>} 上传结果，包含etag和size
 */
export async function uploadWithPresignedUrl(url, data, contentType, onProgress, onCancel, setXhr) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (setXhr) {
      setXhr(xhr);
    }

    // 设置进度监听
    if (onProgress) {
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          onProgress(progress, event.loaded, event.total);
        }
      });
    }

    xhr.onload = function () {
      if (cancelChecker) {
        clearInterval(cancelChecker);
      }

      if (xhr.status === 200) {
        const etag = xhr.getResponseHeader("ETag");
        resolve({
          etag: etag ? etag.replace(/"/g, "") : null,
          size: data.size || data.byteLength || 0,
        });
      } else {
        reject(new Error(`上传失败: HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = function () {
      if (cancelChecker) {
        clearInterval(cancelChecker);
      }
      reject(new Error("上传过程中发生网络错误"));
    };

    xhr.onabort = function () {
      if (cancelChecker) {
        clearInterval(cancelChecker);
      }
      reject(new Error("上传已取消"));
    };

    // 定期检查取消状态
    let cancelChecker = null;
    if (onCancel) {
      cancelChecker = setInterval(() => {
        if (onCancel()) {
          if (cancelChecker) {
            clearInterval(cancelChecker);
          }
          xhr.abort();
        }
      }, 100);
    }

    // 开始上传
    xhr.open("PUT", url);
    // 设置Content-Type头部，使用后端推断的正确MIME类型
    if (contentType && contentType !== null) {
      xhr.setRequestHeader("Content-Type", contentType);
    }
    xhr.send(data);
  });
}

/**
 * 获取文件内容
 * @param {Object} options 获取选项
 * @param {string} options.url 文件URL
 * @param {Function} [options.onProgress] 进度回调函数
 * @param {Function} [options.onCancel] 取消检查函数
 * @param {Function} [options.setXhr] 设置XHR引用的函数
 * @returns {Promise<ArrayBuffer>} 文件内容
 */
export async function fetchFileContent(options) {
  const { url, onProgress, onCancel, setXhr } = options;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (setXhr) {
      setXhr(xhr);
    }

    // 设置响应类型为ArrayBuffer
    xhr.responseType = "arraybuffer";

    // 设置进度监听
    if (onProgress) {
      xhr.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          onProgress(progress, event.loaded, event.total);
        }
      });
    }

    // 设置状态变化监听
    xhr.addEventListener("readystatechange", () => {
      if (xhr.readyState === XMLHttpRequest.DONE) {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response);
        } else {
          reject(new Error(`下载失败: ${xhr.status} ${xhr.statusText}`));
        }
      }
    });

    // 设置错误监听
    xhr.addEventListener("error", () => {
      reject(new Error("网络错误"));
    });

    // 设置中止监听
    xhr.addEventListener("abort", () => {
      reject(new Error("下载已取消"));
    });

    // 定期检查取消状态
    if (onCancel) {
      const checkCancel = () => {
        if (onCancel()) {
          xhr.abort();
          return;
        }
        if (xhr.readyState !== XMLHttpRequest.DONE) {
          setTimeout(checkCancel, 100);
        }
      };
      setTimeout(checkCancel, 100);
    }

    // 开始下载
    xhr.open("GET", url);
    xhr.send();
  });
}

/**
 * 上传到预签名URL
 * @param {Object} options 上传选项
 * @param {string} options.url 预签名URL
 * @param {ArrayBuffer|Blob} options.data 要上传的数据
 * @param {string} options.contentType 文件MIME类型
 * @param {Function} [options.onProgress] 进度回调函数
 * @param {Function} [options.onCancel] 取消检查函数
 * @param {Function} [options.setXhr] 设置XHR引用的函数
 * @returns {Promise<Object>} 上传结果，包含etag和size
 */
export async function uploadToPresignedUrl(options) {
  const { url, data, contentType, onProgress, onCancel, setXhr } = options;
  return uploadWithPresignedUrl(url, data, contentType, onProgress, onCancel, setXhr);
}

/******************************************************************************
 * 高级功能API函数
 ******************************************************************************/


/**
 * 执行预签名URL上传的完整流程
 * @param {File} file 要上传的文件
 * @param {string} path 目标路径
 * @param {Function} onProgress 进度回调函数
 * @param {Function} onCancel 取消检查函数
 * @param {Function} onXhrCreated xhr创建回调函数
 * @returns {Promise<Object>} 上传结果
 */
/** @deprecated 旧版 FS 预签名上传流程，已被 Uppy + StorageAdapter 方案取代 */


/******************************************************************************
 * 通用作业（Generic Jobs）API函数
 ******************************************************************************/

/**
 * 创建通用作业（支持多种任务类型的异步后台处理）
 * @param {string} taskType 任务类型（'copy', 'scheduled-sync', 'cleanup' 等）
 * @param {Object} payload 任务载荷（由具体任务类型决定）
 * @param {Object} options 选项参数
 * @param {boolean} [options.skipExisting=true] 是否跳过已存在的文件（适用于复制任务）
 * @param {number} [options.maxConcurrency=10] 最大并发数
 * @param {Object} [options.retryPolicy] 重试策略
 * @returns {Promise<Object>} 作业描述符 { jobId, taskType, status, stats, createdAt }
 */
export async function createJob(taskType, payload, options = {}) {
  return post('/fs/jobs', {
    taskType,
    items: payload.items || payload, // 兼容直接传 items 数组的情况
    skipExisting: options.skipExisting !== false,
    maxConcurrency: options.maxConcurrency || 10,
    retryPolicy: options.retryPolicy,
  });
}

/**
 * 获取作业状态
 * @param {string} jobId 作业ID
 * @returns {Promise<Object>} 作业状态 { jobId, taskType, status, stats, createdAt, startedAt?, finishedAt?, errorMessage? }
 */
export async function getJobStatus(jobId) {
  return get(`/fs/jobs/${jobId}`);
}

/**
 * 取消作业
 * @param {string} jobId 作业ID
 * @returns {Promise<Object>} 取消结果
 */
export async function cancelJob(jobId) {
  return post(`/fs/jobs/${jobId}/cancel`);
}

/**
 * 列出作业
 * @param {Object} filter 过滤条件
 * @param {string} [filter.taskType] 任务类型（'copy', 'scheduled-sync' 等）
 * @param {string} [filter.status] 作业状态（pending/running/completed/partial/failed/cancelled）
 * @param {number} [filter.limit=20] 返回数量限制
 * @param {number} [filter.offset=0] 偏移量
 * @returns {Promise<Object>} 作业列表 { jobs, total, limit, offset }
 */
export async function listJobs(filter = {}) {
  const params = {
    limit: (filter.limit || 20).toString(),
    offset: (filter.offset || 0).toString(),
  };

  if (filter.taskType) {
    params.taskType = filter.taskType;
  }

  if (filter.status) {
    params.status = filter.status;
  }

  return get('/fs/jobs', { params });
}

/**
 * 删除作业
 * @param {string} jobId 作业ID
 * @returns {Promise<Object>} 删除结果
 */
export async function deleteJob(jobId) {
  return del(`/fs/jobs/${jobId}`);
}

