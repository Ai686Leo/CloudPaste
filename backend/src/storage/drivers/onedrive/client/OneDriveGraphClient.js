/**
 * OneDriveGraphClient
 *
 * Microsoft Graph API 客户端
 * - 封装所有 Graph API 调用
 * - 处理路径编码和 API URL 构建
 * - 支持多区域（global/cn/us/de）
 *
 */

import { DriverError } from "../../../../http/errors.js";

/**
 * 区域到 Graph API 基础 URL 的映射
 */
const GRAPH_ENDPOINTS = {
  global: "https://graph.microsoft.com/v1.0",
  cn: "https://microsoftgraph.chinacloudapi.cn/v1.0",
  us: "https://graph.microsoft.us/v1.0",
  de: "https://graph.microsoft.de/v1.0",
};

/**
 * 最大重试次数
 */
const MAX_RETRIES = 3;

export class OneDriveGraphClient {
  /**
   * @param {Object} config 客户端配置
   * @param {string} config.region 区域（global/cn/us/de）
   * @param {Object} config.authManager 认证管理器实例
   */
  constructor(config) {
    this.region = config.region || "global";
    this.authManager = config.authManager;

    // Graph API 基础 URL
    this.baseUrl = GRAPH_ENDPOINTS[this.region] || GRAPH_ENDPOINTS.global;

    // v1 版本使用 /me/drive 路径模型
    this.drivePath = "/me/drive";
  }

  // ========== 目录操作 ==========

  /**
   * 列出目录内容
   * @param {string} path 相对路径
   * @returns {Promise<Array>} driveItem 数组
   */
  async listChildren(path) {
    const normalized = this._normalizePath(path);
    const apiPath = normalized
      ? `${this.drivePath}/root:/${this._encodePath(normalized)}:/children`
      : `${this.drivePath}/root/children`;

    const response = await this._graphRequest(apiPath, {
      params: {
        $top: 1000,
        $orderby: "name",
      },
    });

    return response.value || [];
  }

  /**
   * 获取单个项目信息
   * @param {string} path 相对路径
   * @returns {Promise<Object>} driveItem
   */
  async getItem(path) {
    const normalized = this._normalizePath(path);
    const apiPath = normalized
      ? `${this.drivePath}/root:/${this._encodePath(normalized)}`
      : `${this.drivePath}/root`;

    return await this._graphRequest(apiPath);
  }

  // ========== 文件下载 ==========

  /**
   * 下载文件内容
   * @param {string} path 相对路径
   * @param {Object} options 选项
   * @returns {Promise<ReadableStream>} 文件内容流
   */
  async downloadContent(path, options = {}) {
    const { signal } = options;
    const normalized = this._normalizePath(path);
    const apiPath = `${this.drivePath}/root:/${this._encodePath(normalized)}:/content`;

    const accessToken = await this.authManager.getAccessToken();
    const url = `${this.baseUrl}${apiPath}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal,
      redirect: "follow",
    });

    if (!response.ok) {
      await this._handleErrorResponse(response, path);
    }

    return response.body;
  }

  // ========== 文件上传 ==========

  /**
   * 小文件上传（< 4MB）
   * @param {string} path 目标路径
   * @param {any} content 文件内容
   * @param {Object} options 选项
   * @returns {Promise<Object>} 创建的 driveItem
   */
  async uploadSmall(path, content, options = {}) {
    const { contentType = "application/octet-stream" } = options;
    const normalized = this._normalizePath(path);
    const apiPath = `${this.drivePath}/root:/${this._encodePath(normalized)}:/content`;

    const accessToken = await this.authManager.getAccessToken();
    const url = `${this.baseUrl}${apiPath}`;

    // 将内容转换为可用于 fetch 的格式
    let body = content;
    if (content instanceof ReadableStream) {
      // 对于 ReadableStream，直接传递
      body = content;
    } else if (typeof content === "string") {
      body = content;
    } else if (content instanceof ArrayBuffer || content instanceof Uint8Array) {
      body = content;
    }

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": contentType,
      },
      body,
    });

    if (!response.ok) {
      await this._handleErrorResponse(response, path);
    }

    return await response.json();
  }

  /**
   * 使用上传会话 URL 单次上传完整文件
   * - 适用于后端流式上传大文件但暂不做分片循环的场景
   * - 要求提供 contentLength 以构造 Content-Range 头
   * @param {string} uploadUrl 上传会话返回的 uploadUrl
   * @param {any} content 文件内容（ReadableStream/Buffer/ArrayBuffer/Uint8Array/string 等）
   * @param {Object} options 选项
   * @param {number} options.contentLength 文件总大小（字节）
   * @param {string} [options.contentType] MIME 类型
   * @returns {Promise<Object|null>} 最终的 driveItem 信息（若有）
   */
  async uploadSessionSingleChunk(uploadUrl, content, options = {}) {
    const { contentLength, contentType = "application/octet-stream" } = options;

    if (typeof contentLength !== "number" || !Number.isFinite(contentLength) || contentLength <= 0) {
      throw new DriverError("OneDrive uploadSessionSingleChunk 需要有效的 contentLength", {
        status: 400,
      });
    }

    // 将内容转换为可用于 fetch 的格式（与 uploadSmall 保持一致）
    let body = content;
    if (content instanceof ReadableStream) {
      body = content;
    } else if (typeof content === "string") {
      body = content;
    } else if (content instanceof ArrayBuffer || content instanceof Uint8Array) {
      body = content;
    }

    const end = contentLength - 1;
    const headers = {
      "Content-Type": contentType,
      "Content-Range": `bytes 0-${end}/${contentLength}`,
    };

    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers,
      body,
    });

    if (!response.ok) {
      await this._handleErrorResponse(response, uploadUrl);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  /**
   * 创建上传会话（用于可恢复/直传上传）
   * - 基于 Graph driveItem createUploadSession 接口
   * - 返回 uploadUrl 供后续 PUT 使用
   * @param {string} path 相对路径（包含文件名）
   * @param {Object} options 选项
   * @param {"rename"|"fail"} [options.conflictBehavior] 冲突行为
   * @returns {Promise<{ uploadUrl: string, expirationDateTime?: string|null, nextExpectedRanges?: string[]|null, raw: any }>}
   */
  async createUploadSession(path, options = {}) {
    const { conflictBehavior = "rename" } = options;

    const normalized = this._normalizePath(path);
    const apiPath = `${this.drivePath}/root:/${this._encodePath(normalized)}:/createUploadSession`;

    const body = {
      item: {
        "@microsoft.graph.conflictBehavior": conflictBehavior,
      },
    };

    const response = await this._graphRequest(apiPath, {
      method: "POST",
      body,
    });

    const uploadUrl = response?.uploadUrl || response?.upload_url;
    if (!uploadUrl) {
      throw new DriverError("OneDrive createUploadSession 未返回 uploadUrl", {
        status: 500,
        details: { path: fullPath },
      });
    }

    return {
      uploadUrl,
      expirationDateTime: response.expirationDateTime || null,
      nextExpectedRanges: response.nextExpectedRanges || null,
      raw: response,
    };
  }

  /**
   * 获取上传会话信息（用于断点续传场景）
   * - 基于 uploadSession 返回的 uploadUrl 直接请求
   * - 返回 expirationDateTime 与 nextExpectedRanges
   * @param {string} uploadUrl 上传会话返回的 uploadUrl
   * @returns {Promise<{ expirationDateTime: string|null, nextExpectedRanges: string[]|null, raw: any }>}
   */
  async getUploadSessionInfo(uploadUrl) {
    if (!uploadUrl) {
      throw new DriverError("OneDrive getUploadSessionInfo 需要有效的 uploadUrl", {
        status: 400,
      });
    }

    const response = await fetch(uploadUrl, {
      method: "GET",
    });

    if (!response.ok) {
      await this._handleErrorResponse(response, uploadUrl);
    }

    const json = await response.json();

    return {
      expirationDateTime: json.expirationDateTime || null,
      nextExpectedRanges: json.nextExpectedRanges || null,
      raw: json,
    };
  }

  // ========== 目录创建 ==========

  /**
   * 创建目录
   * @param {string} path 目录路径
   * @returns {Promise<Object>} 创建的 driveItem
   */
  async createFolder(path) {
    const normalized = this._normalizePath(path);
    const parentPath = this._getParentPath(normalized);
    const folderName = this._getFileName(normalized);

    const apiPath = parentPath
      ? `${this.drivePath}/root:/${this._encodePath(parentPath)}:/children`
      : `${this.drivePath}/root/children`;

    return await this._graphRequest(apiPath, {
      method: "POST",
      body: {
        name: folderName,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      },
    });
  }

  // ========== 重命名/移动 ==========

  /**
   * 重命名项目
   * @param {string} oldPath 原路径
   * @param {string} newPath 新路径
   * @returns {Promise<Object>} 更新后的 driveItem
   */
  async renameItem(oldPath, newPath) {
    const fullOldPath = this._normalizePath(oldPath);
    const fullNewPath = this._normalizePath(newPath);

    const oldParent = this._getParentPath(fullOldPath);
    const newParent = this._getParentPath(fullNewPath);
    const newName = this._getFileName(fullNewPath);

    const apiPath = `${this.drivePath}/root:/${this._encodePath(fullOldPath)}`;

    const patchBody = { name: newName };

    // 如果父目录不同，需要移动
    if (oldParent !== newParent) {
      const parentItem = await this.getItem(newParent || "");
      patchBody.parentReference = { id: parentItem.id };
    }

    return await this._graphRequest(apiPath, {
      method: "PATCH",
      body: patchBody,
    });
  }

  // ========== 删除 ==========

  /**
   * 删除项目
   * @param {string} path 路径
   */
  async deleteItem(path) {
    const normalized = this._normalizePath(path);
    const apiPath = `${this.drivePath}/root:/${this._encodePath(normalized)}`;

    await this._graphRequest(apiPath, {
      method: "DELETE",
    });
  }

  // ========== 复制 ==========

  /**
   * 复制项目
   * @param {string} sourcePath 源路径
   * @param {string} targetPath 目标路径
   * @returns {Promise<void>}
   */
  async copyItem(sourcePath, targetPath) {
    const fullSourcePath = this._normalizePath(sourcePath);
    const fullTargetPath = this._normalizePath(targetPath);

    const targetParent = this._getParentPath(fullTargetPath);
    const targetName = this._getFileName(fullTargetPath);

    // 获取目标父目录的 driveItem
    const parentItem = await this.getItem(targetParent || "");

    const apiPath = `${this.drivePath}/root:/${this._encodePath(fullSourcePath)}:/copy`;

    await this._graphRequest(apiPath, {
      method: "POST",
      body: {
        parentReference: { driveId: parentItem.parentReference?.driveId, id: parentItem.id },
        name: targetName,
      },
    });
  }

  // ========== 搜索 ==========

  /**
   * 搜索文件
   * @param {string} query 搜索关键词
   * @param {Object} options 选项
   * @returns {Promise<Array>} driveItem 数组
   */
  async search(query, options = {}) {
    const { maxResults = 50 } = options;

    // 使用 Graph API 搜索
    const apiPath = `${this.drivePath}/root/search(q='${encodeURIComponent(query)}')`;

    const response = await this._graphRequest(apiPath, {
      params: {
        $top: maxResults,
      },
    });

    return response.value || [];
  }

  // ========== 私有辅助方法 ==========

  /**
   * 发送 Graph API 请求
   * @private
   */
  async _graphRequest(apiPath, options = {}) {
    const { method = "GET", body, params } = options;

    const accessToken = await this.authManager.getAccessToken();

    let url = `${this.baseUrl}${apiPath}`;
    if (params) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
    };

    const fetchOptions = {
      method,
      headers,
    };

    if (body) {
      headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(body);
    }

    // 带重试的请求
    let lastError;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, fetchOptions);

        // 处理 429 限流
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get("Retry-After") || "5", 10);
          await this._sleep(retryAfter * 1000);
          continue;
        }

        // DELETE 请求成功返回 204 No Content
        if (method === "DELETE" && response.status === 204) {
          return null;
        }

        if (!response.ok) {
          await this._handleErrorResponse(response, apiPath);
        }

        // 某些请求可能返回空响应
        const text = await response.text();
        return text ? JSON.parse(text) : null;
      } catch (error) {
        lastError = error;
        if (attempt < MAX_RETRIES - 1) {
          await this._sleep(1000 * (attempt + 1)); // 指数退避
        }
      }
    }

    throw lastError;
  }

  /**
   * 处理错误响应
   * @private
   */
  async _handleErrorResponse(response, context) {
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      errorData = {};
    }

    const errorCode = errorData.error?.code || "unknown";
    const errorMessage = errorData.error?.message || response.statusText;

    // 映射 Graph API 错误到 HTTP 状态码
    let status = response.status;
    if (errorCode === "itemNotFound") {
      status = 404;
    } else if (errorCode === "accessDenied") {
      status = 403;
    } else if (errorCode === "nameAlreadyExists") {
      status = 409;
    }

    throw new DriverError(`Graph API 错误: ${errorMessage}`, {
      status,
      details: { code: errorCode, context },
    });
  }

  /**
   * 规范化路径
   * @private
   */
  _normalizePath(path) {
    if (!path) return "";
    return path.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
  }

  /**
   * 编码路径用于 Graph API URL
   * @private
   */
  _encodePath(path) {
    if (!path) return "";
    // 对每个路径段进行 URL 编码，但保留斜杠
    return path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }

  /**
   * 获取父路径
   * @private
   */
  _getParentPath(path) {
    if (!path) return "";
    const parts = path.split("/");
    parts.pop();
    return parts.join("/");
  }

  /**
   * 获取文件名
   * @private
   */
  _getFileName(path) {
    if (!path) return "";
    const parts = path.split("/");
    return parts[parts.length - 1];
  }

  /**
   * 延迟函数
   * @private
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
