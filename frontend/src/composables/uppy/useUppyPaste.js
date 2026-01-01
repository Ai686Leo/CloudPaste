/**
 * useUppyPaste - Uppy粘贴上传Composable
 */
import { watch } from 'vue';
import { useEventListener } from '@vueuse/core';
import { createLogger } from '@/utils/logger.js';

/**
 * Uppy粘贴上传Composable
 * @param {Object} options - 配置选项
 * @param {import('vue').Ref} options.uppy - Uppy实例ref
 * @param {import('vue').Ref<boolean>} [options.enabled] - 是否启用(如isOpen)
 * @param {Function} [options.onPaste] - 粘贴回调
 * @returns {Object} 粘贴监听功能
 */
export function useUppyPaste(options) {
  const log = createLogger('UppyPaste');
  let pasteHandler = null;
  let stopPasteListener = null;

  /**
   * 设置粘贴监听器
   */
  const setupPasteListener = () => {
    if (typeof stopPasteListener === 'function') {
      stopPasteListener();
      stopPasteListener = null;
    }

    pasteHandler = (event) => {
      // 检查是否启用
      if (options.enabled && !options.enabled.value) return;
      if (!options.uppy?.value) return;

      const items = event.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (!file) continue;

          const ext = file.type.split('/')[1] || 'bin';
          const fileName = file.name || `pasted-${Date.now()}.${ext}`;

          try {
            options.uppy.value.addFile({
              name: fileName,
              type: file.type,
              data: file,
              source: 'clipboard',
            });

            options.onPaste?.(file);
            event.preventDefault();
          } catch (err) {
            log.error('[useUppyPaste] 添加文件失败:', err);
          }
        }
      }
    };

    stopPasteListener = useEventListener(document, 'paste', pasteHandler);

    // 保存清理函数到uppy实例
    if (options.uppy?.value) {
      options.uppy.value._cleanupPaste = cleanupPasteListener;
    }
  };

  /**
   * 清理粘贴监听器
   */
  const cleanupPasteListener = () => {
    if (typeof stopPasteListener === 'function') {
      stopPasteListener();
      stopPasteListener = null;
    }
    pasteHandler = null;
  };

  // 监听uppy实例变化
  watch(
    () => options.uppy?.value,
    (newUppy, oldUppy) => {
      if (oldUppy) cleanupPasteListener();
      if (newUppy) setupPasteListener();
    },
    { immediate: true }
  );

  return {
    setupPasteListener,
    cleanupPasteListener,
  };
}
