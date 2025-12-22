import { api } from "@/api";
import { useAuthStore } from "@/stores/authStore.js";
import { usePathPassword } from "@/composables/usePathPassword.js";
import { useExplorerSettings } from "@/composables/useExplorerSettings.js";

/** @typedef {import("@/types/fs").FsDirectoryResponse} FsDirectoryResponse */
/** @typedef {import("@/types/fs").FsDirectoryItem} FsDirectoryItem */

/**
 * FS 服务封装
 *
 * - 基于 api.fs 提供的底层接口做统一封装
 * - 统一目录/文件信息/批量删除/复制/预签名链接等能力
 * - 支持请求取消（AbortController）以优化导航体验
 *
 * 使用场景
 * - UI 侧通过 DOM 操作创建 <a> 元素触发下载或预览
 */
export function useFsService() {
  const authStore = useAuthStore();
  const pathPassword = usePathPassword();
  const explorerSettings = useExplorerSettings();

  // 目录列表条件请求缓存（强一致性路线：依赖后端 ETag；前端仅做“可验证缓存”）
  const DIRECTORY_LIST_CACHE_LIMIT = 50;
  /** @type {Map<string, { etag: string, data: FsDirectoryResponse }>} */
  const directoryListCache = new Map();
  const setDirectoryListCache = (key, value) => {
    directoryListCache.set(key, value);
    if (directoryListCache.size <= DIRECTORY_LIST_CACHE_LIMIT) return;
    const firstKey = directoryListCache.keys().next().value;
    if (firstKey) {
      directoryListCache.delete(firstKey);
    }
  };

  // 请求取消控制器管理
  /** @type {{ directory: AbortController | null, fileInfo: AbortController | null }} */
  const abortControllers = {
    directory: null,
    fileInfo: null,
  };

  /**
   * 取消目录列表请求
   * 在发起新请求前调用，避免旧请求的响应覆盖新数据
   */
  const cancelDirectoryRequest = () => {
    if (abortControllers.directory) {
      abortControllers.directory.abort();
      abortControllers.directory = null;
    }
  };

  /**
   * 取消文件信息请求
   * 在发起新请求前调用，避免旧请求的响应覆盖新数据
   */
  const cancelFileInfoRequest = () => {
    if (abortControllers.fileInfo) {
      abortControllers.fileInfo.abort();
      abortControllers.fileInfo = null;
    }
  };

  /**
   * 取消所有进行中的请求
   * 用于路由切换、组件卸载等场景
   */
  const cancelAllRequests = () => {
    cancelDirectoryRequest();
    cancelFileInfoRequest();
  };

  const normalizeDirApiPath = (path) => {
    const raw = typeof path === "string" && path ? path : "/";
    const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
    const collapsed = withLeading.replace(/\/{2,}/g, "/");
    if (collapsed === "/") return "/";
    return collapsed.endsWith("/") ? collapsed : `${collapsed}/`;
  };

  const clearDirectoryListCache = () => {
    directoryListCache.clear();
  };

  /**
   * 获取目录列表
   * @param {string} path
   * @param {{ refresh?: boolean }} [options]
   * @returns {Promise<FsDirectoryResponse>}
   */
  const getDirectoryList = async (path, options = {}) => {
    const normalizedPath = normalizeDirApiPath(path || "/");
    const isAdmin = authStore.isAdmin;

    // 取消之前的目录请求，避免竞态条件
    cancelDirectoryRequest();

    // 创建新的 AbortController
    const controller = new AbortController();
    abortControllers.directory = controller;

    /** @type {{ refresh?: boolean; headers?: Record<string,string>; signal?: AbortSignal }} */
    const requestOptions = {
      refresh: options.refresh,
      signal: controller.signal,
    };

    const cached = directoryListCache.get(normalizedPath) || null;
    const shouldUseConditional = !options.refresh && !!cached?.etag;

    // 非管理员访问时，如果已有 token，则附带在请求头中
    if (!isAdmin) {
      const token = pathPassword.getPathToken(normalizedPath);
      if (token) {
        requestOptions.headers = {
          ...(requestOptions.headers || {}),
          "X-FS-Path-Token": token,
        };
      }
    }

    if (shouldUseConditional) {
      requestOptions.headers = {
        ...(requestOptions.headers || {}),
        "If-None-Match": cached.etag,
      };
    }

    try {
      const response = await api.fs.getDirectoryList(normalizedPath, requestOptions);
      if (response?.notModified) {
        if (cached?.data) {
          return cached.data;
        }
        // 理论上不会发生：只有命中缓存才会发 If-None-Match
        throw new Error("目录缓存缺失（304 Not Modified 但本地无可用缓存）");
      }
      if (!response?.success) {
        throw new Error(response?.message || "获取目录列表失败");
      }

      const data = /** @type {FsDirectoryResponse} */ (response.data);
      const etag = typeof data?.dirEtag === "string" && data.dirEtag ? data.dirEtag : null;
      if (etag && data) {
        setDirectoryListCache(normalizedPath, { etag, data });
      }
      return data;
    } catch (error) {
      // 请求被取消时，静默处理，不抛出错误
      if (error.name === "AbortError") {
        console.log("目录请求已取消:", normalizedPath);
        return null;
      }

      // 目录路径密码缺失或失效：触发前端密码验证流程
      if (!isAdmin && error && error.code === "FS_PATH_PASSWORD_REQUIRED") {
        console.warn("目录需要路径密码，触发密码验证流程:", { path: normalizedPath, error });
        // 旧 token 失效，清除后重新走验证
        pathPassword.removePathToken(normalizedPath);
        pathPassword.setPendingPath(normalizedPath);
        pathPassword.openPasswordDialog();

        const friendlyError = new Error(error.message || "目录需要密码访问");
        friendlyError.code = "FS_PATH_PASSWORD_REQUIRED";
        friendlyError.__logged = true;
        throw friendlyError;
      }

      throw error;
    } finally {
      // 清理 controller 引用
      if (abortControllers.directory === controller) {
        abortControllers.directory = null;
      }
    }
  };

  /**
   * 获取单个文件信息
   * @param {string} path
   * @param {{ headers?: Record<string,string>; signal?: AbortSignal; cancelPrevious?: boolean }} [options]
   * - cancelPrevious=true：保持旧行为（新的请求会取消上一条 fileInfo 请求），适合“单文件预览/详情面板”
   * - cancelPrevious=false：允许并发请求，适合“图廊懒加载/批量预取”
   * @returns {Promise<FsDirectoryItem|null>}
   */
  const getFileInfo = async (path, options = {}) => {
    const isAdmin = authStore.isAdmin;
    const normalizedPath = path || "/";

    // 创建新的 AbortController
    const controller = new AbortController();
    const shouldCancelPrevious = options.cancelPrevious !== false;
    if (shouldCancelPrevious) {
      cancelFileInfoRequest();
      abortControllers.fileInfo = controller;
    }

    /** @type {{ headers?: Record<string,string>; signal?: AbortSignal }} */
    const requestOptions = {
      signal: options.signal || controller.signal,
    };

    // 非管理员访问时，为文件路径附加路径密码 token（如果存在）
    if (!isAdmin) {
      const token = pathPassword.getPathToken(path);
      if (token) {
        requestOptions.headers = {
          "X-FS-Path-Token": token,
        };
      }
    }

    // 允许调用方追加 headers（如自定义 token/trace 等）
    if (options.headers) {
      requestOptions.headers = {
        ...(requestOptions.headers || {}),
        ...options.headers,
      };
    }

    try {
      const response = await api.fs.getFileInfo(path, requestOptions);
      if (!response?.success) {
        throw new Error(response?.message || "获取文件信息失败");
      }
      return /** @type {FsDirectoryItem} */ (response.data);
    } catch (error) {
      // 请求被取消时，静默处理，不抛出错误
      if (error.name === "AbortError") {
        console.log("文件信息请求已取消:", path);
        return null;
      }

      // 文件路径也可能受“路径密码”保护：沿用目录列表的交互，触发密码弹窗
      if (!isAdmin && error && error.code === "FS_PATH_PASSWORD_REQUIRED") {
        // 文件的密码域通常属于其父目录，统一按父目录触发验证
        const parentDir =
          normalizedPath && normalizedPath !== "/" ? `${normalizedPath.replace(/\/+$/, "").split("/").slice(0, -1).join("/")}/` : "/";
        const ownerPath = parentDir.startsWith("/") ? parentDir : `/${parentDir}`;

        console.warn("文件需要路径密码，触发密码验证流程:", { path: normalizedPath, ownerPath, error });

        // 旧 token 失效，清除后重新走验证
        pathPassword.removePathToken(ownerPath);
        pathPassword.setPendingPath(ownerPath);
        pathPassword.openPasswordDialog();

        const friendlyError = new Error(error.message || "目录需要密码访问");
        friendlyError.code = "FS_PATH_PASSWORD_REQUIRED";
        friendlyError.__logged = true;
        throw friendlyError;
      }

      throw error;
    } finally {
      // 清理 controller 引用
      if (abortControllers.fileInfo === controller) {
        abortControllers.fileInfo = null;
      }
    }
  };

  /**
   * 预热目录列表（不取消当前目录请求）
   * - 用于面包屑 hover 等场景
   * - 不写入内部 abortControllers.directory，避免影响主导航
   * @param {string} path
   * @param {{ refresh?: boolean; returnNullOnNotModified?: boolean }} [options]
   * @returns {Promise<FsDirectoryResponse|null>}
   */
  const prefetchDirectoryList = async (path, options = {}) => {
    const normalizedPath = normalizeDirApiPath(path || "/");
    const isAdmin = authStore.isAdmin;

    const controller = new AbortController();

    /** @type {{ refresh?: boolean; headers?: Record<string,string>; signal?: AbortSignal }} */
    const requestOptions = {
      refresh: options.refresh ?? false,
      signal: controller.signal,
    };

    if (!isAdmin) {
      const token = pathPassword.getPathToken(normalizedPath);
      if (token) {
        requestOptions.headers = {
          "X-FS-Path-Token": token,
        };
      }
    }

    try {
      const cached = directoryListCache.get(normalizedPath) || null;
      if (!options.refresh && cached?.etag) {
        requestOptions.headers = {
          ...(requestOptions.headers || {}),
          "If-None-Match": cached.etag,
        };
      }

      const response = await api.fs.getDirectoryList(normalizedPath, requestOptions);
      if (response?.notModified) {
        // 某些调用方（如后台无感 revalidate）不希望在 304 时回写 data（避免重复赋值引发微小闪烁）
        if (options.returnNullOnNotModified) {
          return null;
        }
        return cached?.data || null;
      }
      if (!response?.success) {
        throw new Error(response?.message || "获取目录列表失败");
      }
      const data = /** @type {FsDirectoryResponse} */ (response.data);
      const etag = typeof data?.dirEtag === "string" && data.dirEtag ? data.dirEtag : null;
      if (etag && data) {
        setDirectoryListCache(normalizedPath, { etag, data });
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") {
        return null;
      }
      return null;
    }
  };

  /**
   * 重命名文件/目录
   * @param {string} oldPath
   * @param {string} newPath
   * @returns {Promise<true>}
   */
  const renameItem = async (oldPath, newPath) => {
    const response = await api.fs.renameItem(oldPath, newPath);
    if (!response?.success) {
      throw new Error(response?.message || "重命名失败");
    }
    return true;
  };

  /**
   * 创建目录
   * @param {string} fullPath
   * @returns {Promise<true>}
   */
  const createDirectory = async (fullPath) => {
    const response = await api.fs.createDirectory(fullPath);
    if (!response?.success) {
      throw new Error(response?.message || "创建目录失败");
    }
    return true;
  };

  /**
   * 批量删除
   * @param {string[]} paths
   * @returns {Promise<{ success: true; raw: any }>}
   */
  const batchDeleteItems = async (paths) => {
    const response = await api.fs.batchDeleteItems(paths);
    const payload = response && typeof response === "object" && "data" in response ? response.data : response;

    if (payload && Array.isArray(payload.failed) && payload.failed.length > 0) {
      throw new Error(payload.failed[0].error || "批量删除失败");
    }

    return {
      success: true,
      raw: payload,
    };
  };

  /**
   * 批量复制文件/目录
   * @param {Array<{sourcePath:string,targetPath:string}>} items
   * @param {Object} [options]
   * @param {boolean} [options.skipExisting=true] 是否跳过已存在的文件
   * @returns {Promise<Object>} 原始复制结果，由后端定义结构
   */
  const batchCopyItems = async (items, options = {}) => {
    return api.fs.batchCopyItems(items, options);
  };

  /**
   * 获取文件预签名访问链接
   * @param {string} path
   * @param {number|null} [expiresIn]
   * @param {boolean} [forceDownload=true]
   * @returns {Promise<string>}
   */
  const getFileLink = async (path, expiresIn = null, forceDownload = true) => {
    const isAdmin = authStore.isAdmin;
    const normalizedPath = path || "/";

    /** @type {{ headers?: Record<string,string> }} */
    const requestOptions = {};

    // 非管理员访问时，附带路径密码 token（如果存在）
    if (!isAdmin) {
      const token = pathPassword.getPathToken(normalizedPath);
      if (token) {
        requestOptions.headers = {
          "X-FS-Path-Token": token,
        };
      }
    }

    const url = await api.fs.getFileLink(normalizedPath, expiresIn, forceDownload, requestOptions);
    if (!url) {
      throw new Error("获取文件直链失败");
    }
    return url;
  };

  /**
   * 下载文件（通过获取直链并让浏览器直接导航）
   * @param {string} path
   * @param {string} filename
   * @returns {Promise<void>}
   */
  const downloadFile = async (path, filename) => {
    const normalizedPath = path || "/";
    const url = await getFileLink(normalizedPath, null, true);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename || "";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /**
   * 创建通用作业（支持多种任务类型）
   * @param {string} taskType 任务类型（'copy', 'scheduled-sync', 'cleanup' 等）
   * @param {Object} payload 任务载荷
   * @param {Object} [options] 选项参数
   * @returns {Promise<Object>} 作业描述符
   */
  const createJob = async (taskType, payload, options = {}) => {
    return api.fs.createJob(taskType, payload, options);
  };

  /**
   * 获取作业状态
   * @param {string} jobId 作业ID
   * @returns {Promise<Object>} 作业状态信息
   */
  const getJobStatus = async (jobId) => {
    return api.fs.getJobStatus(jobId);
  };

  /**
   * 取消作业
   * @param {string} jobId 作业ID
   * @returns {Promise<Object>} 取消操作结果
   */
  const cancelJob = async (jobId) => {
    return api.fs.cancelJob(jobId);
  };

  /**
   * 列出作业
   * @param {Object} [filter] 过滤条件
   * @returns {Promise<Object>} 作业列表
   */
  const listJobs = async (filter = {}) => {
    return api.fs.listJobs(filter);
  };

  /**
   * 删除作业
   * @param {string} jobId 作业ID
   * @returns {Promise<Object>} 删除结果
   */
  const deleteJob = async (jobId) => {
    return api.fs.deleteJob(jobId);
  };

  return {
    getDirectoryList,
    getFileInfo,
    prefetchDirectoryList,
    clearDirectoryListCache,
    renameItem,
    createDirectory,
    batchDeleteItems,
    batchCopyItems,
    getFileLink,
    downloadFile,
    createJob,
    getJobStatus,
    cancelJob,
    listJobs,
    deleteJob,
    // 请求取消方法
    cancelDirectoryRequest,
    cancelFileInfoRequest,
    cancelAllRequests,
  };
}
