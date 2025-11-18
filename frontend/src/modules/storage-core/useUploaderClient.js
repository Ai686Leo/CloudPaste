import Uppy from "@uppy/core";
import { resolveDriverByConfigId } from "@/modules/storage-core/drivers/registry.js";

const DEFAULT_TYPE = "application/octet-stream";

// 限制进度百分比范围
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

function normalizeProgress(file, progress = {}) {
  const bytesUploaded = progress.bytesUploaded ?? 0;
  const bytesTotal = progress.bytesTotal ?? file?.size ?? file?.data?.size ?? 0;
  const percent = bytesTotal > 0 ? clamp(Math.round((bytesUploaded / bytesTotal) * 100)) : 0;
  return { file, fileId: file?.id, bytesUploaded, bytesTotal, percent };
}

// 附加Uppy生命周期事件
function attachLifecycle(uppy, callbacks = {}) {
  const handlers = [];

  if (callbacks.onFileAdded) {
    const handler = (file) => callbacks.onFileAdded?.(file);
    uppy.on("file-added", handler);
    handlers.push(["file-added", handler]);
  }
  if (callbacks.onProgress) {
    const handler = (file, progress) => callbacks.onProgress?.(normalizeProgress(file, progress));
    uppy.on("upload-progress", handler);
    handlers.push(["upload-progress", handler]);
  }
  if (callbacks.onSuccess) {
    const handler = (file, response) => callbacks.onSuccess?.({ file, response });
    uppy.on("upload-success", handler);
    handlers.push(["upload-success", handler]);
  }
  if (callbacks.onError) {
    const handler = (file, error, response) => callbacks.onError?.({ file, error, response });
    uppy.on("upload-error", handler);
    handlers.push(["upload-error", handler]);
  }
  if (callbacks.onComplete) {
    const handler = (result) => callbacks.onComplete?.(result);
    uppy.on("complete", handler);
    handlers.push(["complete", handler]);
  }
  if (callbacks.onShareRecord) {
    console.debug("[UploaderClient] register share-record listener");
    const handler = (payload) => callbacks.onShareRecord?.(payload);
    uppy.on("share-record", handler);
    handlers.push(["share-record", handler]);
  }

  return () => {
    handlers.forEach(([event, handler]) => {
      try {
        uppy.off?.(event, handler);
      } catch {}
    });
  };
}

// 推断文件名
function inferName(file) {
  if (!file) return "upload-file";
  if (typeof file.name === "string" && file.name.length) return file.name;
  if (file.data && typeof file.data.name === "string" && file.data.name.length) return file.data.name;
  return "upload-file";
}

// 推断文件类型
function inferType(file) {
  if (file?.type) return file.type;
  if (file?.data?.type) return file.data.type;
  return DEFAULT_TYPE;
}

// 创建驱动会话
function createDriverSession({ payload = {}, storageConfigId, installPlugin, events = {}, uppyOptions = {}, uppy: existingUppy }) {
  const configId = storageConfigId ?? payload?.storage_config_id;
  if (!configId) {
    throw new Error("缺少 storage_config_id，无法初始化上传会话");
  }

  const driver = resolveDriverByConfigId(configId);
  const ownsUppy = !existingUppy;
  const uppy = existingUppy || new Uppy({ autoProceed: false, ...uppyOptions });
  const detachLifecycle = attachLifecycle(uppy, events);

  if (typeof installPlugin === "function") {
    installPlugin(driver, uppy, payload, events || {});
  }

  const addFile = (file, meta = {}) => {
    const descriptor = {
      data: file?.data ?? file,
      name: inferName(file),
      type: inferType(file),
      meta,
    };
    const added = uppy.addFile(descriptor);
    return added?.id ?? (Array.isArray(added) ? added[0]?.id : null) ?? uppy.getFiles().slice(-1).pop()?.id ?? null;
  };

  const addFiles = (files = [], buildMeta) => {
    return files.map((file, index) => addFile(file, buildMeta ? buildMeta(file, index) || {} : {}));
  };

  const start = async () => {
    return await uppy.upload();
  };

  const cancel = () => {
    try {
      uppy.cancelAll?.();
    } catch (error) {
      console.warn("UploaderClient: cancelAll 失败", error);
    }
  };

  const destroy = () => {
    detachLifecycle?.();
    if (ownsUppy) {
      try {
        uppy.close?.();
      } catch {}
      try {
        uppy.destroy?.();
      } catch {}
    }
  };

  return { uppy, addFile, addFiles, start, cancel, destroy };
}

// 创建上传客户端
export function useUploaderClient() {
  const createShareUploadSession = ({ payload, events, uppyOptions } = {}) => {
    return createDriverSession({
      payload,
      storageConfigId: payload?.storage_config_id,
      events,
      uppyOptions,
      installPlugin: (driver, uppy, payloadRef, lifecycleEvents = {}) => {
        driver.share.applyShareUploader(uppy, {
          payload: payloadRef,
          onShareRecord: lifecycleEvents.onShareRecord,
        });
      },
    });
  };

  const createUrlUploadSession = ({ payload, events, uppyOptions } = {}) => {
    return createDriverSession({
      payload,
      storageConfigId: payload?.storage_config_id,
      events,
      uppyOptions,
      installPlugin: (driver, uppy, payloadRef, lifecycleEvents = {}) => {
        driver.share.applyUrlUploader(uppy, {
          payload: payloadRef,
          onShareRecord: lifecycleEvents.onShareRecord,
        });
      },
    });
  };

  const createFsUploadSession = ({ storageConfigId, fsOptions = {}, events, uppyOptions, uppy } = {}) => {
    return createDriverSession({
      storageConfigId,
      payload: fsOptions,
      events,
      uppyOptions,
      uppy,
      installPlugin: uppy
        ? null
        : (driver, uppyInstance, options) => {
            driver.fs.applyFsUploader(uppyInstance, options || {});
          },
    });
  };

  return {
    createShareUploadSession,
    createUrlUploadSession,
    createFsUploadSession,
  };
}
