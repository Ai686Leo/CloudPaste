import type { TaskStats } from './types.js';

/**
 * 任务执行上下文 - 提供取消检测、进度更新、文件系统和环境访问
 */
export interface ExecutionContext {
  /** 检查作业是否已被取消 */
  isCancelled(jobId: string): Promise<boolean>;
  /** 更新作业进度统计 */
  updateProgress(jobId: string, stats: Partial<TaskStats>): Promise<void>;
  /** 获取 FileSystem 实例 */
  getFileSystem(): any;
  /** 获取环境绑定 (DB/R2/etc.) */
  getEnv(): any;
}

/**
 * 内部作业对象 - 传递给 TaskHandler.execute() 的作业数据
 */
export interface InternalJob {
  jobId: string;
  taskType: string;
  payload: any;
  userId: string;
  userType: string;
  stats: TaskStats;
  createdAt: Date;
}

/**
 * 任务处理器接口 - 每个任务类型实现一个处理器
 */
export interface TaskHandler {
  /** 任务类型标识符 (必须唯一) */
  readonly taskType: string;

  /** 验证任务载荷 - 在创建作业前调用 */
  validate(payload: any): Promise<void>;

  /** 执行任务 - 遍历处理所有任务项，定期检查取消状态并更新进度 */
  execute(job: InternalJob, context: ExecutionContext): Promise<void>;

  /** 创建统计模板 - 根据载荷初始化统计对象 */
  createStatsTemplate(payload: any): TaskStats;
}
