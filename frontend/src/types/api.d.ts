export interface PaginationInfo {
  total: number;
  limit: number;
  offset?: number;
  page?: number;
  hasMore?: boolean;
}

export interface ApiSuccess<T = any> {
  success: true;
  data: T;
  message?: string;
  code?: number | string;
  total?: number;
  pagination?: PaginationInfo;
}

export interface ApiFailure {
  success: false;
  message?: string;
  code?: number | string;
}

export type ApiResponse<T = any> = ApiSuccess<T> | ApiFailure;

