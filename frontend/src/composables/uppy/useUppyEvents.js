/**
 * useUppyEvents - Uppy事件监听Composable
 */
import { ref, watch } from 'vue';

/**
 * Uppy事件监听Composable
 * @param {Object} options - 配置选项
 * @param {import('vue').Ref} options.uppy - Uppy实例ref
 * @param {Function} [options.onFileAdded] - 文件添加回调
 * @param {Function} [options.onFileRemoved] - 文件移除回调
 * @param {Function} [options.onRestrictionFailed] - 限制失败回调
 * @param {Function} [options.onUploadError] - 上传错误回调
 * @param {Function} [options.onError] - 系统错误回调
 * @param {Function} [options.onFileEditComplete] - Dashboard文件编辑完成回调
 * @returns {Object} 事件监听功能
 */
export function useUppyEvents(options) {
  const fileCount = ref(0);
  let eventHandlers = {};

  /**
   * 设置事件监听器
   */
  const setupEvents = () => {
    if (!options.uppy?.value) return;

    const uppy = options.uppy.value;

    // 文件添加
    const onFileAdded = (file) => {
      fileCount.value = uppy.getFiles().length;
      options.onFileAdded?.(file);
    };

    // 文件移除
    const onFileRemoved = (file) => {
      fileCount.value = uppy.getFiles().length;
      options.onFileRemoved?.(file);
    };

    // 限制失败
    const onRestrictionFailed = (file, error) => {
      options.onRestrictionFailed?.(file, error);
    };

    // 上传错误
    const onUploadError = (file, error) => {
      options.onUploadError?.(file, error);
    };

    // 系统错误
    const onError = (error) => {
      options.onError?.(error);
    };

    // Dashboard文件编辑完成
    const onFileEditComplete = (file) => {
      // 关键修复：当用户在Dashboard中编辑文件元数据后，将meta.name同步到file.name
      // 这样XHRUpload等插件才能使用编辑后的文件名
      if (file?.meta?.name && file.meta.name !== file.name) {
        console.log('[useUppyEvents] 同步编辑后的文件名:', file.name, '->', file.meta.name);
        uppy.setFileState(file.id, { name: file.meta.name });
      }
      options.onFileEditComplete?.(file);
    };

    uppy.on('file-added', onFileAdded);
    uppy.on('file-removed', onFileRemoved);
    if (options.onRestrictionFailed) {
      uppy.on('restriction-failed', onRestrictionFailed);
    }
    if (options.onUploadError) {
      uppy.on('upload-error', onUploadError);
    }
    if (options.onError) {
      uppy.on('error', onError);
    }
    // 始终监听文件编辑完成事件，确保文件名修改能够生效
    uppy.on('dashboard:file-edit-complete', onFileEditComplete);

    eventHandlers = {
      'file-added': onFileAdded,
      'file-removed': onFileRemoved,
      'restriction-failed': onRestrictionFailed,
      'upload-error': onUploadError,
      'error': onError,
      'dashboard:file-edit-complete': onFileEditComplete,
    };
  };

  /**
   * 清理事件监听器
   */
  const cleanupEvents = () => {
    if (!options.uppy?.value) return;
    const uppy = options.uppy.value;
    Object.entries(eventHandlers).forEach(([event, handler]) => {
      if (handler) uppy.off(event, handler);
    });
    eventHandlers = {};
  };

  // 监听uppy实例变化,自动重新设置事件
  watch(
    () => options.uppy?.value,
    (newUppy, oldUppy) => {
      if (oldUppy) cleanupEvents();
      if (newUppy) setupEvents();
    },
    { immediate: true }
  );

  return {
    setupEvents,
    cleanupEvents,
    fileCount,
  };
}
