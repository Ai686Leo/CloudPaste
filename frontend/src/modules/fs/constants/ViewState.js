/**
 * FS模块视图状态枚举
 *
 * 状态转换图:
 *
 *                    ┌──────────────┐
 *                    │   INITIAL    │
 *                    └──────┬───────┘
 *                           │
 *              ┌────────────┼────────────┐
 *              │                         │
 *              ▼                         ▼
 *    ┌──────────────────┐      ┌──────────────┐
 *    │ LOADING_DIRECTORY│      │ LOADING_FILE │
 *    └────────┬─────────┘      └──────┬───────┘
 *             │                       │
 *             ▼                       ▼
 *    ┌──────────────────┐      ┌──────────────┐
 *    │DIRECTORY_LOADED  │◄────►│ FILE_LOADED  │
 *    └──────────────────┘      └──────────────┘
 *             │                       │
 *             └───────────┬───────────┘
 *                         │
 *              ┌──────────┼──────────┐
 *              ▼          ▼          ▼
 *    ┌─────────────┐  ┌───────┐  ┌──────────────────┐
 *    │PASSWORD_REQ │  │ ERROR │  │ 可返回INITIAL    │
 *    └─────────────┘  └───────┘  └──────────────────┘
 *
 * @module fs/constants/ViewState
 */

/**
 * 视图状态枚举
 * @readonly
 * @enum {string}
 */
export const ViewState = Object.freeze({
  /** 初始状态,还未加载任何内容 */
  INITIAL: 'INITIAL',

  /** 正在加载目录列表 */
  LOADING_DIRECTORY: 'LOADING_DIRECTORY',

  /** 目录列表已加载完成 */
  DIRECTORY_LOADED: 'DIRECTORY_LOADED',

  /** 正在加载文件预览 */
  LOADING_FILE: 'LOADING_FILE',

  /** 文件预览已加载完成 */
  FILE_LOADED: 'FILE_LOADED',

  /** 需要输入密码才能访问 */
  PASSWORD_REQUIRED: 'PASSWORD_REQUIRED',

  /** 发生错误 */
  ERROR: 'ERROR',
});

/**
 * 判断当前状态是否为加载中状态
 * @param {string} state - 视图状态
 * @returns {boolean} 是否为加载状态
 */
export function isLoadingState(state) {
  return state === ViewState.LOADING_DIRECTORY || state === ViewState.LOADING_FILE;
}

/**
 * 判断是否应该显示目录列表
 * @param {string} state - 视图状态
 * @returns {boolean} 是否显示目录
 */
export function shouldShowDirectory(state) {
  return state === ViewState.DIRECTORY_LOADED ||
         state === ViewState.LOADING_DIRECTORY ||
         state === ViewState.LOADING_FILE ||
         state === ViewState.FILE_LOADED ||
         state === ViewState.INITIAL;
}

/**
 * 判断是否应该显示文件预览
 * @param {string} state - 视图状态
 * @returns {boolean} 是否显示文件预览
 */
export function shouldShowFilePreview(state) {
  return state === ViewState.FILE_LOADED ||
         state === ViewState.LOADING_FILE;
}

/**
 * 判断是否为错误状态
 * @param {string} state - 视图状态
 * @returns {boolean} 是否为错误状态
 */
export function isErrorState(state) {
  return state === ViewState.ERROR;
}

/**
 * 判断是否需要密码
 * @param {string} state - 视图状态
 * @returns {boolean} 是否需要密码
 */
export function needsPassword(state) {
  return state === ViewState.PASSWORD_REQUIRED;
}

/**
 * 获取状态的可读描述
 * @param {string} state - 视图状态
 * @returns {string} 状态描述
 */
export function getStateDescription(state) {
  const descriptions = {
    [ViewState.INITIAL]: '初始状态',
    [ViewState.LOADING_DIRECTORY]: '加载目录中',
    [ViewState.DIRECTORY_LOADED]: '目录已加载',
    [ViewState.LOADING_FILE]: '加载文件中',
    [ViewState.FILE_LOADED]: '文件已加载',
    [ViewState.PASSWORD_REQUIRED]: '需要密码',
    [ViewState.ERROR]: '发生错误',
  };
  return descriptions[state] || '未知状态';
}

/**
 * 验证状态值是否有效
 * @param {string} state - 要验证的状态
 * @returns {boolean} 状态是否有效
 */
export function isValidState(state) {
  return Object.values(ViewState).includes(state);
}
