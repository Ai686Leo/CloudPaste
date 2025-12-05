/**
 * 跨存储任务编排的共享类型定义（跨运行时）
 */

/** 任务类型枚举 */
export enum TaskType {
  COPY = 'copy',
  UPLOAD = 'upload',
  DOWNLOAD = 'download',
  DELETE = 'delete',
  ARCHIVE = 'archive',
}

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

/** 单个文件/项目的处理结果 */
export interface ItemResult {
  sourcePath: string;
  targetPath: string;
  status: ItemStatus;
  error?: string;              // 失败时的错误信息
  fileSize?: number;           // 文件总大小（字节）
  bytesTransferred?: number;   // 已传输字节数
  retryCount?: number;         // 重试次数
  lastRetryAt?: number;        // 最后重试时间戳
}

/** 任务统计 */
export interface TaskStats {
  totalItems: number;
  processedItems: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  totalBytes?: number;         // 总字节数 (用于进度计算)
  bytesTransferred?: number;   // 已传输字节数
  itemResults?: ItemResult[];  // 每个文件的处理结果
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
  task_type: TaskType;
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
  taskType?: TaskType;
  userId?: string;
  limit?: number;
  offset?: number;
}
