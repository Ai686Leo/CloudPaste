import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../constants/index.js";

const SENSITIVE_KEYS = [
  "authorization",
  "x-api-key",
  "x-api-key-id",
  "access_key",
  "secret_key",
  "access_key_id",
  "secret_access_key",
  "token",
  "signature",
  "password",
];

//  AppError 用于处理应用程序错误
export class AppError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, code?: string, expose?: boolean, details?: any}} options
   */
  constructor(message, { status = ApiStatus.INTERNAL_ERROR, code = "APP_ERROR", expose = true, details = null } = {}) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.expose = expose;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = "请求参数无效", details = null) {
    super(message, { status: ApiStatus.BAD_REQUEST, code: "VALIDATION_ERROR", expose: true, details });
    this.name = "ValidationError";
  }
}

//  maskSensitiveValue 用于 mask 敏感信息
export const maskSensitiveValue = (value) => {
  if (!value || typeof value !== "string") {
    return value;
  }
  if (value.length <= 8) {
    return "*".repeat(value.length);
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
};

//  sanitizeHeaders 用于 sanitize headers 中的敏感信息
export const sanitizeHeaders = (headers = {}) => {
  const sanitized = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
      sanitized[key] = maskSensitiveValue(String(value ?? ""));
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

export const normalizeError = (error, context = {}) => {
  if (error instanceof HTTPException) {
    return {
      status: error.status ?? ApiStatus.INTERNAL_ERROR,
      code: "HTTP_EXCEPTION",
      publicMessage: error.message ?? "服务器内部错误",
      expose: true,
      originalError: error,
      context,
    };
  }

  if (error instanceof AppError) {
    return {
      status: error.status,
      code: error.code,
      publicMessage: error.message,
      expose: error.expose,
      details: error.details,
      originalError: error,
      context,
    };
  }

  const status = error?.status ?? ApiStatus.INTERNAL_ERROR;
  return {
    status,
    code: error?.code ?? "UNHANDLED_ERROR",
    publicMessage: status >= 500 ? "服务器内部错误" : error?.message ?? "请求失败",
    expose: status < 500,
    originalError: error,
    context,
  };
};
