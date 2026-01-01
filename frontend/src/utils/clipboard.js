/**
 * 通用复制文本到剪贴板函数
 *
 * @param {string} text - 要复制的文本
 * @returns {Promise<boolean>} 是否复制成功
 */
import { useClipboard } from "@vueuse/core";
import { createLogger } from "@/utils/logger.js";

const clipboard = useClipboard({
  // legacy=true：在 Clipboard API 不可用/被限制时，自动回退到 execCommand
  legacy: true,
});
const log = createLogger("Clipboard");

export const copyToClipboard = async (text) => {
  try {
    const payload = String(text ?? "");
    if (!payload) return false;
    await clipboard.copy(payload);
    return true;
  } catch (err) {
    log.error("复制到剪贴板失败:", err);
    return false;
  }
};
