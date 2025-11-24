/**
 * useUppyCore - Uppy实例创建与配置Composable
 */
import { shallowRef } from 'vue';
import Uppy from '@uppy/core';
import ChineseLocale from '@uppy/locales/lib/zh_CN';
import EnglishLocale from '@uppy/locales/lib/en_US';

/**
 * 根据语言代码获取Uppy locale
 */
const getUppyLocale = (locale) => {
  return locale === 'zh-CN' ? ChineseLocale : EnglishLocale;
};

/**
 * Uppy核心Composable
 * @returns {Object} Uppy核心功能
 */
export function useUppyCore() {
  const uppyInstance = shallowRef(null);

  /**
   * 初始化Uppy实例
   * @param {Object} options - 配置选项
   * @param {string} options.id - Uppy实例ID
   * @param {string} [options.locale='zh-CN'] - 语言代码
   * @param {number|null} [options.maxFileSize=null] - 最大文件大小(bytes)
   * @param {boolean} [options.autoProceed=false] - 是否自动开始上传
   * @param {boolean} [options.allowMultipleUploadBatches=true] - 允许多批次上传
   * @param {Function} [options.onStateChanged] - 状态变化回调
   */
  const initializeUppy = async (options) => {
    if (uppyInstance.value) {
      destroyUppy();
    }

    uppyInstance.value = new Uppy({
      id: options.id,
      autoProceed: options.autoProceed ?? false,
      allowMultipleUploadBatches: options.allowMultipleUploadBatches ?? true,
      debug: import.meta.env.DEV,
      locale: getUppyLocale(options.locale || 'zh-CN'),
      restrictions: {
        maxFileSize: options.maxFileSize || null,
      },
    });

    if (options.onStateChanged) {
      uppyInstance.value.on('state-update', options.onStateChanged);
    }
  };

  /**
   * 销毁Uppy实例
   */
  const destroyUppy = () => {
    if (uppyInstance.value) {
      // 清理粘贴监听器
      if (uppyInstance.value._cleanupPaste) {
        uppyInstance.value._cleanupPaste();
      }
      uppyInstance.value.destroy();
      uppyInstance.value = null;
    }
  };

  /**
   * 重新初始化Uppy实例
   * @param {Object} options - 配置选项
   */
  const reinitializeUppy = async (options) => {
    destroyUppy();
    await initializeUppy(options);
  };

  /**
   * 获取文件快照(用于重新初始化时保留文件)
   */
  const snapshotFiles = () => {
    if (!uppyInstance.value) return [];
    return uppyInstance.value.getFiles().map((file) => ({
      data: file.data || file,
      name: file.name,
      type: file.type,
      meta: { ...file.meta },
      source: file.source || 'local',
    }));
  };

  /**
   * 恢复文件到Uppy实例
   * @param {Array} files - 文件快照数组
   */
  const restoreFiles = (files = []) => {
    if (!uppyInstance.value || !files.length) return;
    files.forEach((file) => {
      try {
        uppyInstance.value.addFile({
          name: file.name,
          type: file.type,
          data: file.data,
          source: file.source,
          meta: file.meta || {},
        });
      } catch (error) {
        console.warn('[useUppyCore] 恢复文件失败', error);
      }
    });
  };

  return {
    uppyInstance,
    initializeUppy,
    destroyUppy,
    reinitializeUppy,
    snapshotFiles,
    restoreFiles,
  };
}
