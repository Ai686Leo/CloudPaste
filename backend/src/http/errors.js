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

// 认证失败
export class AuthenticationError extends AppError {
  constructor(message = "未授权", details = null) {
    super(message, { status: ApiStatus.UNAUTHORIZED, code: "UNAUTHORIZED", expose: true, details });
    this.name = "AuthenticationError";
  }
}

// 权限不足
export class AuthorizationError extends AppError {
  constructor(message = "权限不足", details = null) {
    super(message, { status: ApiStatus.FORBIDDEN, code: "FORBIDDEN", expose: true, details });
    this.name = "AuthorizationError";
  }
}

// 资源不存在
export class NotFoundError extends AppError {
  constructor(message = "资源不存在", details = null) {
    super(message, { status: ApiStatus.NOT_FOUND, code: "NOT_FOUND", expose: true, details });
    this.name = "NotFoundError";
  }
}

// 资源冲突
export class ConflictError extends AppError {
  constructor(message = "资源冲突", details = null) {
    super(message, { status: ApiStatus.CONFLICT, code: "CONFLICT", expose: true, details });
    this.name = "ConflictError";
  }
}

// 仓储/数据访问层错误
export class RepositoryError extends AppError {
  constructor(message = "数据访问错误", details = null) {
    super(message, { status: ApiStatus.INTERNAL_ERROR, code: "REPOSITORY_ERROR", expose: false, details });
    this.name = "RepositoryError";
  }
}

// 外部驱动/上游服务错误
export class DriverError extends AppError {
  /**
   * @param {string} message
   * @param {object|any} optionsOrDetails - 可传 { status?, code?, expose?, details? } 或直接 details 对象
   */
  constructor(message = "外部服务错误", optionsOrDetails = null) {
    let status = ApiStatus.INTERNAL_ERROR;
    let code = "DRIVER_ERROR";
    let expose = false;
    let details = null;
    if (optionsOrDetails && typeof optionsOrDetails === "object" && ("status" in optionsOrDetails || "code" in optionsOrDetails || "expose" in optionsOrDetails || "details" in optionsOrDetails)) {
      status = optionsOrDetails.status ?? status;
      code = optionsOrDetails.code ?? code;
      expose = optionsOrDetails.expose ?? expose;
      details = optionsOrDetails.details ?? null;
    } else {
      details = optionsOrDetails;
    }
    super(message, { status, code, expose, details });
    this.name = "DriverError";
  }
}

export class S3DriverError extends DriverError {
  /**
   * @param {string} message
   * @param {object|any} optionsOrDetails - 同 DriverError，可覆盖 code/status 等
   */
  constructor(message = "外部服务错误", optionsOrDetails = null) {
    const opts = (optionsOrDetails && typeof optionsOrDetails === "object" && ("status" in optionsOrDetails || "code" in optionsOrDetails || "expose" in optionsOrDetails || "details" in optionsOrDetails))
      ? { ...optionsOrDetails, code: optionsOrDetails.code ?? "DRIVER_ERROR.S3" }
      : { details: optionsOrDetails, code: "DRIVER_ERROR.S3" };
    super(message, opts);
    this.name = "S3DriverError";
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

// 断言辅助：条件不满足即抛出给定 AppError 实例
export const assert = (condition, errorInstance) => {
  if (!condition) throw errorInstance;
};

// 包装外部异步调用为统一的 DriverError（或其子类）
export const wrapAsync = async (fn, details = {}) => {
  try {
    return await fn();
  } catch (e) {
    throw new DriverError("外部服务调用失败", { cause: e?.message, ...details });
  }
};
