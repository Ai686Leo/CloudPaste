/**
 * useUppyBackendProgress - 基于后端进度的 Uppy 进度修正 Composable
 *
 * 封装以下通用能力：
 * - 为每个 Uppy 文件生成并维护 upload_id（写入 file.meta.upload_id）
 * - 跨前端/后端融合进度：结合浏览器上报与 /api/upload/progress 返回值
 * - 直接更新 Uppy 文件状态，驱动 Dashboard 进度条刷新
 *
 * 调用方需要提供：
 * - uppy: Ref<Uppy | null>
 * - isDirectMode: () => boolean，用于判断当前是否启用直传模式
 */
import { getUploadProgress } from "@/api/services/systemService.js";
import { createLogger } from "@/utils/logger.js";

export function useUppyBackendProgress(options) {
  const log = createLogger("UppyBackendProgress");
  const { uppy, isDirectMode } = options;

  // 后端进度状态与轮询定时器
  const backendProgressState = new Map();
  const backendProgressTimers = new Map();

  const generateUploadId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  };

  /**
   * 确保文件拥有 upload_id，并回传最终的 upload_id
   */
  const ensureUploadIdForFile = (file) => {
    if (!uppy?.value || !file?.id) return null;
    const meta = file.meta || {};
    if (meta.upload_id) {
      return meta.upload_id;
    }
    const uploadId = generateUploadId();
    try {
      uppy.value.setFileMeta(file.id, {
        ...meta,
        upload_id: uploadId,
      });
    } catch (error) {
      log.warn("[useUppyBackendProgress] 设置 upload_id 失败", error);
    }
    return uploadId;
  };

  /**
   * 重置后端进度相关状态
   */
  const resetBackendProgressTracking = () => {
    backendProgressTimers.forEach((timer) => clearInterval(timer));
    backendProgressTimers.clear();
    backendProgressState.clear();
  };

  /**
   * 更新浏览器本地的进度快照，用于与后端进度融合
   * 后端尚未记录任何进度时（例如返回「未找到上传进度记录」的默认结构），不视为有效的远端进度，保持 hasRemote=false，持续抑制本地进度条。
   */
  const updateBrowserProgressState = ({ file, fileId, bytesUploaded, bytesTotal }) => {
    if (!fileId) return;
    const id = fileId;
    const prev = backendProgressState.get(id) || {};
    const next = {
      ...prev,
      file: file || prev.file,
      browserBytesUploaded: typeof bytesUploaded === "number" ? bytesUploaded : prev.browserBytesUploaded || 0,
      browserBytesTotal: typeof bytesTotal === "number" ? bytesTotal : prev.browserBytesTotal || file?.size || 0,
      remoteBytesLoaded: prev.remoteBytesLoaded || 0,
      remoteBytesTotal: prev.remoteBytesTotal || 0,
      currentBytes: prev.currentBytes || 0,
      hasRemote: prev.hasRemote || false,
    };

    if (next.browserBytesUploaded > (next.currentBytes || 0)) {
      next.currentBytes = next.browserBytesUploaded;
    }

    backendProgressState.set(id, next);
  };

  /**
   * 启动后端进度轮询并修正 Uppy 进度
   * 当前版本不再依赖后端进度驱动 Uppy 进度条，
   * 仅保留 upload_id 生成能力，UI 进度完全交由 XHRUpload 等插件管理。
   */
  const startBackendProgressPolling = () => {
    // no-op：保留函数签名以兼容现有调用，但不再启动任何后端进度轮询。
    return;
  };

  return {
    ensureUploadIdForFile,
    resetBackendProgressTracking,
    updateBrowserProgressState,
    startBackendProgressPolling,
  };
}
