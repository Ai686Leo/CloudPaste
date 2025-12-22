/**
 * 跨存储任务编排的共享类型定义（跨运行时）
 */

import type { JobDescriptor } from './TaskOrchestratorAdapter.js';

/** 任务状态枚举 */
export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  PARTIAL = 'partial',    // 部分项失败
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/** 单个文件/项目的处理状态 */
export type ItemStatus = 'pending' | 'processing' | 'retrying' | 'success' | 'failed' | 'skipped';

/**
 * 单个项目的处理结果（通用）
 *
 */
export interface ItemResult {
  /** 项目类型（可选）：copy/mount/path/... */
  kind?: string;
  /** 给 UI 展示的短文本（可选） */
  label?: string;

  /** copy 语义字段（可选，copy 任务必填；其他任务可不填） */
  sourcePath?: string;
  targetPath?: string;

  status: ItemStatus;
  error?: string;              // 失败时的错误信息
  fileSize?: number;           // 文件总大小（字节）
  bytesTransferred?: number;   // 已传输字节数
  retryCount?: number;         // 重试次数
  lastRetryAt?: number;        // 最后重试时间戳
  /** 通用耗时（毫秒），用于非 copy 任务描述“处理耗时” */
  durationMs?: number;
  /** 扩展字段 */
  meta?: Record<string, any>;
}

/** 任务统计（通用，可扩展） */
export interface TaskStats {
  totalItems: number;
  processedItems: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  totalBytes?: number;         // 总字节数 (用于进度计算)
  bytesTransferred?: number;   // 已传输字节数
  itemResults?: ItemResult[];  // 每个文件的处理结果
  /** 允许不同任务类型扩展 stats 字段 */
  [key: string]: any;
}

/** 重试策略 */
export interface RetryPolicy {
  limit: number;                      // 最大重试次数
  delay: number;                      // 重试延迟 (ms)
  backoff: 'linear' | 'exponential';  // 退避策略
}

/** 复制任务载荷 */
export interface CopyTaskPayload {
  items: Array<{
    sourcePath: string;
    targetPath: string;
  }>;
  options?: {
    skipExisting?: boolean;
    maxConcurrency?: number;
    retryPolicy?: RetryPolicy;
  };
}

/** 任务数据库记录 */
export interface TaskRecord<TPayload = unknown> {
  task_id: string;
  task_type: string;
  status: TaskStatus;
  payload: TPayload;
  stats: TaskStats;
  error_message?: string;
  user_id: string;
  user_type: string;
  workflow_instance_id?: string;  // Workers 专用
  created_at: number;
  started_at?: number;
  updated_at: number;
  finished_at?: number;
}

/** 复制任务记录 */
export type CopyTaskRecord = TaskRecord<CopyTaskPayload>;

/** 复制作业描述符 (API 响应) */
export interface CopyJobDescriptor {
  jobId: string;
  status: TaskStatus;
  stats: TaskStats;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  items?: Array<{ sourcePath: string; targetPath: string }>;
  userId?: string;
}

/** 创建复制作业参数 */
export interface CreateCopyJobParams {
  userId: string;
  userType: string;
  items: Array<{ sourcePath: string; targetPath: string }>;
  options?: {
    skipExisting?: boolean;
    maxConcurrency?: number;
    retryPolicy?: RetryPolicy;
  };
}

/** 作业过滤条件 */
export interface JobFilter {
  status?: TaskStatus;
  taskType?: string;
  taskTypes?: string[];
  userId?: string;
  limit?: number;
  offset?: number;
}

export interface JobListResult {
  jobs: JobDescriptor[];
  total: number;
}
