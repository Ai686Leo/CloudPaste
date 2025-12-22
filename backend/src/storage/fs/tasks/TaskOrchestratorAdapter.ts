/**
 * 运行时无关的任务编排器接口
 * - Workers: WorkflowsTaskOrchestrator (Workflows API)
 * - Node.js: SQLiteTaskOrchestrator (Worker Pool + SQLite)
 */

import type { JobFilter, JobListResult, TaskStatus, TaskStats } from './types.js';

/** 创建作业参数 */
export interface CreateJobParams {
  /** 任务类型 (如 'copy', 'sync') - 必须在 TaskRegistry 中注册 */
  taskType: string;
  /** 任务载荷 - 不同 taskType 结构不同 */
  payload: any;
  /** 用户 ID */
  userId: string;
  /** 用户类型 */
  userType: string;
  /**
   * 触发方式
   * - manual: 用户/管理员在页面或 API 主动触发
   * - scheduled: 由 scheduled_jobs 定时任务触发
   */
  triggerType?: 'manual' | 'scheduled' | string;
  /**
   * 来源引用（可选）
   * - 例如 scheduled handlerId（scheduled_xxx）
   * - 或某个页面/接口标识（如 admin/fs-index/rebuild）
   */
  triggerRef?: string | null;
}

/** 作业描述符 - 用于 API 响应 */
export interface JobDescriptor {
  /** 作业 ID - 格式: ${taskType}-${timestamp}-${random} */
  jobId: string;
  /** 任务类型 */
  taskType: string;
  /** 当前状态 */
  status: TaskStatus;
  /** 聚合统计 */
  stats: TaskStats;
  /** 创建时间 */
  createdAt: Date;
  /** 开始时间 */
  startedAt?: Date;
  /** 完成时间 */
  finishedAt?: Date;
  /** 最后更新时间 */
  updatedAt?: Date;
  /** 原始载荷 */
  payload?: any;
  /** 触发方式 */
  triggerType?: string;
  /** 来源引用 */
  triggerRef?: string | null;
}

/** 作业状态响应 - 扩展描述符 */
export interface JobStatus extends JobDescriptor {
  /** 错误消息 */
  errorMessage?: string;
  /** 原始载荷 */
  payload?: any;
  /** 用户 ID */
  userId?: string;
  /** API 密钥名称 */
  keyName?: string | null;
}

/**
 * 任务编排器接口 - 支持多任务类型
 */
export interface TaskOrchestratorAdapter {
  /**
   * 创建任意类型作业
   * 流程: 验证类型 → 验证载荷 → 生成 ID → 创建统计模板 → 启动执行
   */
  createJob(params: CreateJobParams): Promise<JobDescriptor>;

  /** 获取作业状态 - 返回实时状态和统计 */
  getJobStatus(jobId: string): Promise<JobStatus>;

  /** 取消作业 - 协作式取消，已完成项保持完成 */
  cancelJob(jobId: string): Promise<void>;

  /** 列出作业 - 支持过滤和分页，按创建时间倒序 */
  listJobs(filter?: JobFilter): Promise<JobListResult>;

  /** 删除作业 - 仅终态作业，运行中需先取消 */
  deleteJob(jobId: string): Promise<void>;
}
