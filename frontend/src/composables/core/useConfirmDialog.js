/**
 * 确认对话框 Composable
 *
 */
import { ref, reactive } from "vue";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("ConfirmDialog");

export function useConfirmDialog() {
  // 对话框状态
  const dialogState = reactive({
    isOpen: false,
    title: "",
    message: "",
    confirmText: "",
    cancelText: "",
    confirmType: "primary",
    loading: false,
    loadingText: "",
    allowBackdropClose: true,
    darkMode: false,
  });

  // Promise 解析器
  let resolvePromise = null;
  // 异步确认回调
  let onConfirmCallback = null;

  /**
   * 显示确认对话框
   * @param {Object} options - 对话框选项
   * @param {string} options.title - 标题（必需）
   * @param {string} [options.message] - 消息内容
   * @param {string} [options.confirmText] - 确认按钮文本
   * @param {string} [options.cancelText] - 取消按钮文本
   * @param {'primary'|'danger'|'warning'} [options.confirmType='primary'] - 确认按钮类型
   * @param {string} [options.loadingText] - 加载中文本
   * @param {boolean} [options.allowBackdropClose=true] - 是否允许点击背景关闭
   * @param {boolean} [options.darkMode] - 暗色模式
   * @param {Function} [options.onConfirm] - 确认时执行的异步回调（会显示加载状态）
   * @returns {Promise<boolean>} - 用户点击确认返回 true，取消返回 false
   */
  const confirm = (options) => {
    return new Promise((resolve) => {
      resolvePromise = resolve;
      onConfirmCallback = options.onConfirm || null;

      // 设置对话框状态
      dialogState.isOpen = true;
      dialogState.title = options.title || "";
      dialogState.message = options.message || "";
      dialogState.confirmText = options.confirmText || "";
      dialogState.cancelText = options.cancelText || "";
      dialogState.confirmType = options.confirmType || "primary";
      dialogState.loading = false;
      dialogState.loadingText = options.loadingText || "";
      dialogState.allowBackdropClose = options.allowBackdropClose !== false;
      dialogState.darkMode = options.darkMode !== undefined ? options.darkMode : false;
    });
  };

  /**
   * 处理确认事件
   * 如果有 onConfirm 回调，会自动执行并显示加载状态
   */
  const handleConfirm = async () => {
    if (onConfirmCallback) {
      // 有异步回调，显示加载状态
      dialogState.loading = true;
      dialogState.allowBackdropClose = false;

      try {
        await onConfirmCallback();
        closeDialog(true);
      } catch (error) {
        // 发生错误时关闭对话框并返回 false
        log.error("Confirm dialog callback error:", error);
        closeDialog(false);
        throw error; // 重新抛出错误让调用者处理
      }
    } else {
      // 无异步回调，直接确认
      closeDialog(true);
    }
  };

  /**
   * 处理取消事件
   */
  const handleCancel = () => {
    closeDialog(false);
  };

  /**
   * 关闭对话框
   * @param {boolean} result - 结果（true=确认，false=取消）
   */
  const closeDialog = (result) => {
    dialogState.isOpen = false;
    dialogState.loading = false;
    onConfirmCallback = null;

    if (resolvePromise) {
      resolvePromise(result);
      resolvePromise = null;
    }
  };

  /**
   * 设置暗色模式（全局）
   * @param {boolean} isDark - 是否暗色模式
   */
  const setDarkMode = (isDark) => {
    dialogState.darkMode = isDark;
  };

  return {
    // 状态（绑定到 ConfirmDialog 组件）
    dialogState,

    // 方法
    confirm,
    handleConfirm,
    handleCancel,
    setDarkMode,
  };
}

/**
 * “confirmFn 适配器”，用于给各类管理 composable
 *
 *
 * @param {(options: any) => Promise<boolean>} confirm - useConfirmDialog() 返回的 confirm 方法
 * @param {Object} [options]
 * @param {any} [options.t] - i18n 的 t（可选）
 * @param {any} [options.darkMode] - ref 或 boolean（可选）
 * @param {(ctx: {confirmType?: string, title?: string, message?: string}) => string} [options.getConfirmText]
 * @returns {(payload: {title: string, message?: string, confirmType?: 'primary'|'danger'|'warning', confirmText?: string}) => Promise<boolean>}
 */
export function createConfirmFn(confirm, { t, darkMode, getConfirmText } = {}) {
  return async ({ title, message, confirmType, confirmText }) => {
    const resolvedDarkMode = typeof darkMode === "object" && darkMode ? !!darkMode.value : !!darkMode;
    const resolvedConfirmType = confirmType || "primary";

    const resolvedConfirmText =
      confirmText ||
      (typeof getConfirmText === "function" ? getConfirmText({ confirmType: resolvedConfirmType, title, message }) : "") ||
      (t && typeof t === "function"
        ? resolvedConfirmType === "danger"
          ? t("common.dialogs.deleteButton")
          : t("common.dialogs.confirmButton")
        : resolvedConfirmType === "danger"
          ? "删除"
          : "确认");

    return await confirm({
      title,
      message,
      confirmType: resolvedConfirmType,
      confirmText: resolvedConfirmText,
      darkMode: resolvedDarkMode,
    });
  };
}

/**
 * 快捷方法：创建删除确认对话框选项
 * @param {string} itemName - 要删除的项目名称
 * @param {Object} [options] - 额外选项
 * @returns {Object} 对话框选项
 */
export function createDeleteConfirmOptions(itemName, options = {}) {
  return {
    title: options.title || "确认删除",
    message: options.message || `确定要删除 "${itemName}" 吗？此操作不可撤销。`,
    confirmType: "danger",
    confirmText: options.confirmText || "删除",
    ...options,
  };
}

/**
 * 快捷方法：创建批量删除确认对话框选项
 * @param {number} count - 要删除的项目数量
 * @param {Object} [options] - 额外选项
 * @returns {Object} 对话框选项
 */
export function createBatchDeleteConfirmOptions(count, options = {}) {
  return {
    title: options.title || "确认批量删除",
    message: options.message || `确定要删除选中的 ${count} 项吗？此操作不可撤销。`,
    confirmType: "danger",
    confirmText: options.confirmText || `删除 (${count})`,
    ...options,
  };
}
