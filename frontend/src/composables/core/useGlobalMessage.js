/**
 * 全局消息管理系统 
 */

import { ref, computed } from "vue";

// 全局消息状态 - 使用单例模式
let globalMessageState = null;

export function useGlobalMessage() {
  // 确保全局只有一个消息管理实例
  if (!globalMessageState) {
    globalMessageState = createMessageState();
  }

  return globalMessageState;
}

/**
 * 创建消息状态管理 
 */
function createMessageState() {
  // ===== 核心状态 =====
  const message = ref(null);

  // ===== 计算属性 =====
  const hasMessage = computed(() => !!message.value);
  const messageType = computed(() => message.value?.type || null);
  const messageContent = computed(() => message.value?.content || null);

  // ===== 核心方法 =====

  let currentTimeoutId = null; // 用于管理自动清除的定时器

  /**
   * 根据消息类型和自定义 duration 计算最终展示时长
   * - 不传 duration 时使用推荐默认值
   * - 传入 duration 时优先使用调用方指定值
   */
  const resolveDurationByType = (type, duration) => {
    if (typeof duration === "number") {
      return duration;
    }

    switch (type) {
      case "success":
      case "info":
        return 4000; // 成功 / 信息 提示较短
      case "warning":
        return 5500; // 警告略长
      case "error":
        return 6000; // 错误提示再长一些，便于阅读
      default:
        return 5000;
    }
  };

  /**
   * 显示消息
   * @param {string} type - 消息类型 ('success', 'error', 'warning', 'info')
   * @param {string} content - 消息内容
   * @param {number} [duration] - 显示时长（毫秒），不传则按类型使用推荐默认值
   */
  const showMessage = (type, content, duration) => {
    const finalDuration = resolveDurationByType(type, duration);

    // 清除之前的定时器，确保新消息优先展示
    if (currentTimeoutId) {
      clearTimeout(currentTimeoutId);
      currentTimeoutId = null;
    }

    // 设置当前要展示的消息
    message.value = {
      type,
      content,
      timestamp: Date.now(),
    };

    // 自动清除消息（duration <= 0 时不自动清除，例如离线场景）
    if (finalDuration > 0) {
      currentTimeoutId = setTimeout(() => {
        clearMessage();
      }, finalDuration);
    }

    console.log(`[GlobalMessage] 显示消息: ${type} - ${content}`);
  };

  /**
   * 清除当前消息
   */
  const clearMessage = () => {
    if (currentTimeoutId) {
      clearTimeout(currentTimeoutId);
      currentTimeoutId = null;
    }
    message.value = null;
    console.log("[GlobalMessage] 清除消息");
  };

  // ===== 便捷方法 =====

  /**
   * 显示成功消息
   */
  const showSuccess = (content, duration) => {
    showMessage("success", content, duration);
  };

  /**
   * 显示错误消息
   */
  const showError = (content, duration) => {
    showMessage("error", content, duration);
  };

  /**
   * 显示警告消息
   */
  const showWarning = (content, duration) => {
    showMessage("warning", content, duration);
  };

  /**
   * 显示信息消息
   */
  const showInfo = (content, duration) => {
    showMessage("info", content, duration);
  };

  return {
    // 状态 - 匹配现有组件期望的结构
    message,

    // 计算属性
    hasMessage,
    messageType,
    messageContent,

    // 核心方法
    showMessage,
    clearMessage,

    // 便捷方法
    showSuccess,
    showError,
    showWarning,
    showInfo,

    // 兼容性别名
    clearCurrentMessage: clearMessage,
  };
}
