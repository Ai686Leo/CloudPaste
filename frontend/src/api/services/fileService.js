/**
 * 文件管理服务API
 * 统一管理所有文件相关的API调用，包括上传、下载、管理等
 */

import { get, post, put, del } from "../client";

/******************************************************************************
 * 文件上传相关API
 ******************************************************************************/

/**
 * 获取更准确的文件MIME类型，特别处理Markdown文件
 * @param {File} file - 文件对象
 * @returns {string} MIME类型
 */
function getAccurateMimeType(file) {
  // 如果是Markdown文件，强制设置正确的MIME类型
  if (file.name && /\.(md|markdown|mdown|mkd|mdwn|mdtxt|mdtext|rmd)$/i.test(file.name)) {
    return "text/markdown";
  }

  // 使用浏览器提供的类型，如果没有则使用通用二进制类型
  return file.type || "application/octet-stream";
}

/**
 * 上传文件（传统方式）
 * @param {File} file - 要上传的文件
 * @param {Object} options - 上传选项
 * @returns {Promise<Object>} 上传响应
 */
export async function uploadFile(file, options = {}) {
  // 统一走直传预签名流程，保持对旧API的兼容
  return directUploadFile(file, options);
}

/**
 * 获取上传预签名URL
 * @param {Object} options - 上传选项
 * @param {string} options.storage_config_id - 存储配置ID
 * @param {string} options.filename - 文件名
 * @param {string} options.mimetype - 文件的MIME类型
 * @param {string} [options.path] - 自定义存储路径
 * @param {string} [options.slug] - 自定义短链接
 * @param {number} [options.size] - 文件大小（字节）
 * @returns {Promise<Object>} 包含预签名URL的响应
 */
export async function getUploadPresignedUrl(options) {
  try {
    const data = {
      filename: options.filename,
      fileSize: options.size ?? options.fileSize ?? options.filesize,
      contentType: options.mimetype,
      path: options.path || null,
      storage_config_id: options.storage_config_id || null,
    };

    return await post("share/presign", data);
  } catch (error) {
    if (error.message && error.message.includes("链接后缀已被占用")) {
      throw new Error("链接后缀已被占用，请尝试其他后缀");
    }

    throw new Error(`获取预签名URL失败: ${error.message}`);
  }
}

/**
 * 完成文件上传（更新文件元数据）
 * @param {Object} data - 上传完成后的元数据
 * @returns {Promise<Object>} 更新响应
 */
export async function completeFileUpload(data) {
  // 新协议优先：key + storage_config_id；兼容旧 path（虚拟路径）
  const payload = {
    key: data.key || undefined,
    storage_config_id: data.storage_config_id || undefined,
    path: data.path || undefined,
    filename: data.filename,
    size: Number(data.size ?? data.fileSize ?? 0),
    etag: data.etag,
    slug: data.slug,
    remark: data.remark,
    password: data.password,
    expires_in: data.expires_in ?? data.expiresIn,
    max_views: data.max_views ?? data.maxViews,
    use_proxy: data.use_proxy ?? data.useProxy,
    original_filename: data.original_filename ?? data.originalFilename ?? false,
  };

  return await post("share/commit", payload);
}

/**
 * 直接上传文件到对象存储（前端直接上传）
 * @param {File} file - 要上传的文件
 * @param {Object} options - 上传选项
 * @param {Function} onProgress - 上传进度回调函数，参数为0-100的进度百分比、已加载字节数和总字节数
 * @param {Function} onXhrReady - 在XHR实例创建后的回调，用于支持取消上传
 * @param {Function} onFileIdReady - 在获取到文件ID后的回调，用于支持取消上传时清理文件记录
 * @returns {Promise<Object>} 上传响应
 */
export async function directUploadFile(file, options = {}, onProgress, onXhrReady, onFileIdReady) {
  try {
    const accurateMimeType = getAccurateMimeType(file);

    const presignedData = await getUploadPresignedUrl({
      storage_config_id: options.storage_config_id,
      filename: file.name,
      mimetype: accurateMimeType,
      path: options.path,
      size: file.size,
    });

    if (!presignedData?.success || !presignedData?.data) {
      const message = presignedData?.message || "获取预签名URL失败";
      throw new Error(message);
    }

    const presignPayload = presignedData.data;
    const uploadUrl = presignPayload.uploadUrl || presignPayload.upload_url;
    const commitKey = presignPayload.key || null;
    const storageConfigId = presignPayload.storage_config_id || options.storage_config_id || null;
    const resolvedFilename = presignPayload.filename || presignPayload.fileName || file.name;
    const providerType = presignPayload.provider_type || presignPayload.providerType;
    const inferredContentType = presignPayload.contentType || presignPayload.mimetype || accurateMimeType;

    if (!uploadUrl || !commitKey || !storageConfigId) {
      throw new Error("预签名响应缺少必要的上传信息（key 或 storage_config_id）");
    }

    const uploadResult = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      const cleanup = () => {
        xhr.upload?.removeEventListener("progress", progressHandler);
        xhr.removeEventListener("load", loadHandler);
        xhr.removeEventListener("error", errorHandler);
        xhr.removeEventListener("abort", abortHandler);
      };

      if (typeof onXhrReady === "function") {
        onXhrReady(xhr);
      }

      const progressHandler = (event) => {
        if (event.lengthComputable && typeof onProgress === "function") {
          const progress = Math.round((event.loaded / event.total) * 100);
          onProgress(progress, event.loaded, event.total);
        }
      };

      const loadHandler = () => {
        cleanup();
        if (xhr.status >= 200 && xhr.status < 300) {
          const etag = xhr.getResponseHeader("ETag");
          resolve({
            success: true,
            etag: etag ? etag.replace(/"/g, "") : null,
          });
        } else {
          reject(new Error(`上传失败: ${xhr.status} ${xhr.statusText}`));
        }
      };

      const errorHandler = (e) => {
        cleanup();
        console.error("上传错误:", e);
        reject(new Error("上传过程中发生网络错误"));
      };

      const abortHandler = () => {
        cleanup();
        reject(new Error("上传被取消"));
      };

      xhr.upload.addEventListener("progress", progressHandler);
      xhr.addEventListener("load", loadHandler);
      xhr.addEventListener("error", errorHandler);
      xhr.addEventListener("abort", abortHandler);

      xhr.open("PUT", uploadUrl, true);
      xhr.setRequestHeader("Content-Type", inferredContentType);

      if (providerType === "Backblaze B2") {
        xhr.setRequestHeader("X-Bz-Content-Sha1", "do_not_verify");
        xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
      }

      xhr.send(file);
    });

    const completeData = await completeFileUpload({
      key: commitKey,
      storage_config_id: storageConfigId,
      filename: resolvedFilename,
      size: file.size,
      etag: uploadResult.etag,
      slug: options.slug,
      remark: options.remark,
      password: options.password,
      expires_in: options.expires_in,
      max_views: options.max_views,
      use_proxy: options.use_proxy,
      original_filename: options.original_filename ?? false,
    });

    if (typeof onFileIdReady === "function" && completeData?.data?.id) {
      onFileIdReady(completeData.data.id);
    }

    console.log("文件上传完成，提交的元数据:", {
      key: commitKey,
      storage_config_id: storageConfigId,
      filename: resolvedFilename,
      size: file.size,
      etag: uploadResult.etag,
    });

    return completeData;
  } catch (error) {
    console.error("直接上传文件到存储失败:", error);
    throw error;
  }
}

/******************************************************************************
 * 统一文件管理API
 ******************************************************************************/

/**
 * 获取文件列表（统一接口，自动根据认证信息处理）
 * @param {number} limit - 每页条数
 * @param {number} offset - 偏移量
 * @param {Object} options - 额外查询选项（管理员可用）
 * @returns {Promise<Object>} 文件列表响应
 */
export async function getFiles(limit = 50, offset = 0, options = {}) {
  const params = { limit, offset, ...options };
  return await get("files", { params });
}

/**
 * 获取单个文件详情（统一接口，自动根据认证信息处理）
 * @param {string} id - 文件ID
 * @returns {Promise<Object>} 文件详情响应
 */
export async function getFile(id) {
  return await get(`files/${id}`);
}

/**
 * 更新文件元数据（统一接口，自动根据认证信息处理）
 * @param {string} id - 文件ID
 * @param {Object} metadata - 更新的文件元数据
 * @returns {Promise<Object>} 更新响应
 */
export async function updateFile(id, metadata) {
  return await put(`files/${id}`, metadata);
}

/**
 * 批量删除文件（统一接口，自动根据认证信息处理）
 * @param {Array<string>} ids - 文件ID数组
 * @param {string} deleteMode - 删除模式：'record_only' 仅删除记录，'both' 同时删除文件（默认）
 * @returns {Promise<Object>} 批量删除响应
 */
export async function batchDeleteFiles(ids, deleteMode = "both") {
  return await del(`files/batch-delete`, { ids, delete_mode: deleteMode });
}

/******************************************************************************
 * 公共文件访问API
 ******************************************************************************/

/**
 * 获取公开文件信息
 * @param {string} slug - 文件短链接
 * @returns {Promise<Object>} 文件信息响应
 */
export async function getPublicFile(slug) {
  return await get(`public/files/${slug}`);
}

/**
 * 验证文件密码
 * @param {string} slug - 文件短链接
 * @param {string} password - 文件密码
 * @returns {Promise<Object>} 验证响应
 */
export async function verifyFilePassword(slug, password) {
  return await post(`public/files/${slug}/verify`, { password });
}
