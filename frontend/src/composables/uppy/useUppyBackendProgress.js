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

export function useUppyBackendProgress(options) {
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
      console.warn("[useUppyBackendProgress] 设置 upload_id 失败", error);
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

    // 仅在直传模式且尚未取得任何后端进度时，覆写 Uppy 的本地进度，避免进度条先到 100%
    if (uppy?.value && isDirectMode?.() && !next.hasRemote) {
      try {
        const currentFile = file || uppy.value.getFile(id);
        if (currentFile) {
          const prevProgress = currentFile.progress || {};
          const total = next.browserBytesTotal || currentFile.size || 0;
          uppy.value.setFileState(currentFile.id, {
            progress: {
              ...prevProgress,
              bytesUploaded: 0,
              bytesTotal: total,
              percentage: 0,
              uploadStarted: prevProgress.uploadStarted || Date.now(),
              uploadComplete: false,
            },
          });
        }
      } catch (error) {
        console.warn("[useUppyBackendProgress] 抑制本地上传进度失败", error);
      }
    }
  };

  /**
   * 启动后端进度轮询并修正 Uppy 进度
   * 仅在 isDirectMode() 为 true 时工作
   */
  const startBackendProgressPolling = () => {
    if (!uppy?.value || !isDirectMode?.()) return;

    const files = uppy.value.getFiles();
    files.forEach((file) => {
      const fileId = file.id;
      if (!fileId || backendProgressTimers.has(fileId)) return;

      const uploadId = file.meta?.upload_id || ensureUploadIdForFile(file);
      if (!uploadId) return;

      const poll = async () => {
        try {
          const resp = await getUploadProgress(uploadId);
          const payload = resp?.data;
          if (!payload) return;

          // 後端尚未記錄任何進度時（例如返回「未找到上传进度记录」的默認結構），
          // 不視為有效的遠端進度，保持 hasRemote=false，持續抑制本地進度條。
          const noRemoteRecord =
            (payload.total == null || typeof payload.total !== "number") &&
            !payload.completed &&
            (!payload.loaded || payload.loaded === 0) &&
            !payload.path &&
            !payload.storageType;
          if (noRemoteRecord) {
            const prev = backendProgressState.get(fileId) || {};
            backendProgressState.set(fileId, {
              ...prev,
              file,
              remoteBytesLoaded: 0,
              remoteBytesTotal: 0,
              browserBytesTotal: prev.browserBytesTotal || file.size || 0,
              browserBytesUploaded: prev.browserBytesUploaded || 0,
              currentBytes: prev.currentBytes || 0,
              hasRemote: false,
            });
            return;
          }

          const totalFromServer = typeof payload.total === "number" ? payload.total : null;
          const loadedFromServer = typeof payload.loaded === "number" ? payload.loaded : 0;
          const completed = !!payload.completed;

          const prev = backendProgressState.get(fileId) || {};
          const bytesTotal = totalFromServer || prev.browserBytesTotal || file.size || 0;
          if (!bytesTotal) {
            backendProgressState.set(fileId, {
              ...prev,
              file,
              remoteBytesLoaded: loadedFromServer,
              remoteBytesTotal: totalFromServer || prev.remoteBytesTotal || 0,
            });
            return;
          }

          const bytesUploaded = Math.max(0, Math.min(bytesTotal, loadedFromServer));
          const percentage = bytesTotal > 0 ? Math.round((bytesUploaded / bytesTotal) * 100) : 0;

          try {
            uppy.value.setFileState(file.id, {
              progress: {
                ...(file.progress || {}),
                bytesUploaded,
                bytesTotal,
                percentage,
                uploadComplete: file.progress?.uploadComplete || completed,
                uploadStarted: file.progress?.uploadStarted || Date.now(),
              },
            });
            uppy.value.emit("upload-progress", file, { bytesUploaded, bytesTotal });
          } catch (error) {
            console.warn("[useUppyBackendProgress] 注入后端上传进度失败", error);
          }

          backendProgressState.set(fileId, {
            ...prev,
            file,
            remoteBytesLoaded: loadedFromServer,
            remoteBytesTotal: totalFromServer || prev.remoteBytesTotal || bytesTotal,
            browserBytesTotal: bytesTotal,
            browserBytesUploaded: prev.browserBytesUploaded || 0,
            currentBytes: bytesUploaded,
            hasRemote: true,
          });

          if (completed || (bytesTotal && loadedFromServer >= bytesTotal)) {
            const timer = backendProgressTimers.get(fileId);
            if (timer) clearInterval(timer);
            backendProgressTimers.delete(fileId);
          }
        } catch (error) {
          console.warn("[useUppyBackendProgress] 查询后端上传进度失败", error);
        }
      };

      const timer = setInterval(poll, 1000);
      backendProgressTimers.set(fileId, timer);
      poll();
    });
  };

  return {
    ensureUploadIdForFile,
    resetBackendProgressTracking,
    updateBrowserProgressState,
    startBackendProgressPolling,
  };
}
