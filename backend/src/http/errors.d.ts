import { HTTPException } from 'hono/http-exception';

/**
 * 应用程序基础错误类
 */
export class AppError extends Error {
  name: string;
  status: number;
  code: string;
  expose: boolean;
  details: any;

  constructor(
    message: string,
    options?: {
      status?: number;
      code?: string;
      expose?: boolean;
      details?: any;
    }
  );
}

/**
 * 请求参数验证错误
 */
export class ValidationError extends AppError {
  constructor(message?: string, details?: any);
}

/**
 * 认证失败错误
 */
export class AuthenticationError extends AppError {
  constructor(message?: string, details?: any);
}

/**
 * 权限不足错误
 */
export class AuthorizationError extends AppError {
  constructor(message?: string, details?: any);
}

/**
 * 资源不存在错误
 */
export class NotFoundError extends AppError {
  constructor(message?: string, details?: any);
}

/**
 * 资源冲突错误
 */
export class ConflictError extends AppError {
  constructor(message?: string, details?: any);
}

/**
 * 仓储/数据访问层错误
 */
export class RepositoryError extends AppError {
  constructor(message?: string, details?: any);
}

export interface DriverErrorOptions {
  status?: number;
  code?: string;
  expose?: boolean;
  details?: any;
}

/**
 * 外部驱动/上游服务错误
 */
export class DriverError extends AppError {
  constructor(message?: string, optionsOrDetails?: DriverErrorOptions | any);
}

/**
 * S3 驱动错误
 */
export class S3DriverError extends DriverError {
  constructor(message?: string, optionsOrDetails?: DriverErrorOptions | any);
}

/**
 * 驱动契约错误：存储驱动类型/能力/方法实现的契约不一致
 */
export class DriverContractError extends DriverError {
  constructor(message?: string, optionsOrDetails?: DriverErrorOptions | any);
}

/**
 * 掩码敏感值
 */
export function maskSensitiveValue(value: string | null | undefined): string;

/**
 * 清理 headers 中的敏感信息
 */
export function sanitizeHeaders(headers?: Record<string, any>): Record<string, any>;

export interface NormalizedError {
  status: number;
  code: string;
  publicMessage: string;
  expose: boolean;
  details?: any;
  originalError: Error;
  context: Record<string, any>;
}

/**
 * 标准化错误对象
 */
export function normalizeError(
  error: Error | HTTPException | AppError | any,
  context?: Record<string, any>
): NormalizedError;

/**
 * 断言辅助：条件不满足即抛出给定 AppError 实例
 */
export function assert(condition: any, errorInstance: AppError): asserts condition;

/**
 * 包装外部异步调用为统一的 DriverError
 */
export function wrapAsync<T>(
  fn: () => Promise<T>,
  details?: Record<string, any>
): Promise<T>;
