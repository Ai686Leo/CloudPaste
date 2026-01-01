/**
 * 处理文件保存相关的逻辑，使用统一的文件系统API
 */

import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { api } from "@/api";
import { createLogger } from "@/utils/logger.js";

export function useFileSave() {
  const { t } = useI18n();
  const log = createLogger("FileSave");

  // 保存状态
  const isSaving = ref(false);
  const saveError = ref(null);

  /**
   * 保存文件内容
   * @param {string} filePath - 文件路径
   * @param {string} fileName - 文件名
   * @param {string} content - 文件内容
   * @param {string} currentPath - 当前目录路径
   * @returns {Promise<Object>} 保存结果
   */
  const saveFile = async (filePath, fileName, content, currentPath) => {
    try {
      isSaving.value = true;
      saveError.value = null;

      log.debug("保存文件:", {
        filePath,
        fileName,
        contentLength: content.length,
        currentPath,
      });

      const response = await api.fs.updateFile(filePath, content);

      if (response && response.success) {
        log.debug("文件保存成功:", response);

        return {
          success: true,
          message: t("mount.messages.fileSaveSuccess", { name: fileName }),
          data: response.data
        };
      } else {
        throw new Error(response?.message || t("mount.messages.fileSaveFailed"));
      }
      
    } catch (error) {
      log.error("保存文件失败:", error);
      saveError.value = error.message || t("mount.messages.fileSaveFailed");
      
      return {
        success: false,
        message: saveError.value,
        error: error
      };
    } finally {
      isSaving.value = false;
    }
  };

  /**
   * 清除错误状态
   */
  const clearSaveError = () => {
    saveError.value = null;
  };

  return {
    // 状态
    isSaving,
    saveError,

    // 方法
    saveFile,
    clearSaveError,
  };
}
