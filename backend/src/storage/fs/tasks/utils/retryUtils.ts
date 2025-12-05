/** 重试工具 - 错误判断和退避延迟计算 */

import type { RetryPolicy } from '../types.js';

/** 默认重试策略: 最多重试 3 次，初始延迟 2 秒，指数退避 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  limit: 3,
  delay: 2000,
  backoff: 'exponential'
};

const MAX_BACKOFF_DELAY = 60000;

const RETRYABLE_PATTERNS = [
  'TIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND',
  'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
  'ECONNABORTED', 'ENETRESET', 'EADDRINUSE', 'EADDRNOTAVAIL',
  'THROTTL', 'TEMPORARILY', 'UNAVAILABLE', 'OVERLOAD',
  'RATE_LIMIT', 'TOO_MANY', 'BUSY', 'RETRY',
  'NETWORK', 'SOCKET', 'CONNECTION', 'DNS',
  'SLOWDOWN', 'INTERNAL_ERROR', 'SERVICE_EXCEPTION',
  'REQUEST_TIMEOUT', 'OPERATION_ABORTED'
];

const NON_RETRYABLE_STATUS_CODES = [
  400, 401, 403, 404, 405, 409, 410, 413, 415, 422
];

const RETRYABLE_STATUS_CODES = [
  408, 425, 429, 500, 502, 503, 504, 507, 509
];

/** 判断错误是否可重试 - 基于 HTTP 状态码、错误代码和消息模式匹配 */
export function isRetryableError(error: any): boolean {
  if (!error) return false;

  // Cloudflare Workflows 平台级限流错误（单次调用子请求超限）：
  // 此类错误在当前 Worker/Workflow 调用中继续重试没有意义，应该直接视为不可重试，
  // 由上层通过新的调用或人工干预进行恢复。
  const rawMessage = String(error?.message || '').toUpperCase();
  if (rawMessage.includes('TOO MANY API REQUESTS BY SINGLE WORKER INVOCATION')) {
    return false;
  }

  if (typeof error.retryable === 'boolean') {
    return error.retryable;
  }

  const status = error?.status || error?.statusCode || error?.response?.status;
  if (typeof status === 'number') {
    if (NON_RETRYABLE_STATUS_CODES.includes(status)) {
      return false;
    }
    if (RETRYABLE_STATUS_CODES.includes(status)) {
      return true;
    }
  }

  const code = String(error?.code || '').toUpperCase();
  if (code && RETRYABLE_PATTERNS.some(pattern => code.includes(pattern))) {
    return true;
  }

  const message = String(error?.message || '').toUpperCase();
  if (message && RETRYABLE_PATTERNS.some(pattern => message.includes(pattern))) {
    return true;
  }

  const cause = error?.cause || error?.originalError || error?.details?.cause;
  if (cause && cause !== error) {
    return isRetryableError(cause);
  }

  return false;
}

/** 计算退避延迟 - 支持指数和线性退避，带随机抖动 */
export function calculateBackoffDelay(
  attempt: number,
  policy: RetryPolicy
): number {
  const { delay, backoff } = policy;
  let calculatedDelay: number;

  if (backoff === 'exponential') {
    calculatedDelay = delay * Math.pow(2, attempt - 1);
  } else {
    calculatedDelay = delay * attempt;
  }

  const jitter = calculatedDelay * 0.1 * (Math.random() * 2 - 1);
  calculatedDelay = Math.round(calculatedDelay + jitter);

  return Math.min(calculatedDelay, MAX_BACKOFF_DELAY);
}

/** 延迟执行 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 格式化重试日志 */
export function formatRetryLog(
  attempt: number,
  maxRetries: number,
  delay: number,
  path: string,
  error?: string
): string {
  const delayStr = delay >= 1000 ? `${(delay / 1000).toFixed(1)}s` : `${delay}ms`;
  const errorStr = error ? ` - ${error}` : '';
  return `[重试 ${attempt}/${maxRetries}] ${path}, 延迟 ${delayStr}${errorStr}`;
}
