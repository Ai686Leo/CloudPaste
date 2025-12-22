/**
 * 任务编排工厂和类型导出
 * - 自动检测运行时环境 (Workers 或 Node.js)
 * - 统一类型导出
 */

import { WorkflowsTaskOrchestrator } from './WorkflowsTaskOrchestrator.js';
import { SQLiteTaskOrchestrator } from './SQLiteTaskOrchestrator.js';
import type { TaskOrchestratorAdapter } from './TaskOrchestratorAdapter.js';

// 类型导出
export type { TaskOrchestratorAdapter, JobStatus } from './TaskOrchestratorAdapter.js';
export type {
  CreateCopyJobParams,
  CopyJobDescriptor,
  JobFilter,
  TaskStats,
  TaskRecord,
  CopyTaskRecord,
  CopyTaskPayload,
  RetryPolicy,
} from './types.js';
export { TaskStatus } from './types.js';

/** 运行时环境接口 */
export interface RuntimeEnv {
  // Workers 绑定
  JOB_WORKFLOW?: WorkflowNamespace;
  DB?: D1Database;
  // Node.js 配置
  TASK_DATABASE_PATH?: string;       // SQLite 路径 (unified-entry.js 自动设置)
  TASK_WORKER_POOL_SIZE?: number;   // Worker 池大小 (默认 2)
}

/**
 * 获取合理的 Worker 池大小
 * - 默认值: 2 
 * - 环境变量覆盖: TASK_WORKER_POOL_SIZE
 * - 范围限制: 1-10
 */
function getWorkerPoolSize(envSize?: number): number {
  const size = envSize ?? 2;  // 默认 2
  return Math.max(1, Math.min(10, size));  // 限制在 1-10 之间
}

/**
 * 全局单例缓存
 * - Node.js: 单例 SQLiteTaskOrchestrator（避免重复创建 Worker Pool）
 * - Workers: 每次请求需要传入 env，但实际 Workflow 实例由 Cloudflare 管理
 */
let globalSQLiteOrchestrator: SQLiteTaskOrchestrator | null = null;

/**
 * 创建任务编排器 - 自动检测运行时
 * - Workers: WorkflowsTaskOrchestrator (Workflows API + D1)
 * - Node.js: SQLiteTaskOrchestrator (Worker Pool + SQLite) - 全局单例
 */
export function createTaskOrchestrator(
  fileSystem: any,
  env: RuntimeEnv
): TaskOrchestratorAdapter {
  // Workers 环境检测 - 每次创建新实例（因为 env 包含请求级绑定）
  if (env.JOB_WORKFLOW && env.DB) {
    console.log('[TaskOrchestrator] ✓ Using WorkflowsTaskOrchestrator (Workers)');
    return new WorkflowsTaskOrchestrator(
      env as { JOB_WORKFLOW: WorkflowNamespace; DB: D1Database },
      fileSystem
    );
  }

  // Node.js 环境 - 使用全局单例
  if (globalSQLiteOrchestrator) {
    // 更新 fileSystem 引用（可能是新实例）
    globalSQLiteOrchestrator.updateFileSystem(fileSystem);
    return globalSQLiteOrchestrator;
  }

  console.log('[TaskOrchestrator] Runtime detection:', {
    hasJobWorkflow: !!env.JOB_WORKFLOW,
    hasDB: !!env.DB,
    hasTaskDatabasePath: !!env.TASK_DATABASE_PATH,
  });

  console.log('[TaskOrchestrator] ✓ Creating SQLiteTaskOrchestrator singleton (Node.js)');
  if (!env.TASK_DATABASE_PATH) {
    console.warn('[TaskOrchestrator] WARNING: TASK_DATABASE_PATH not set, using fallback');
  }

  const poolSize = getWorkerPoolSize(env.TASK_WORKER_POOL_SIZE);
  globalSQLiteOrchestrator = new SQLiteTaskOrchestrator(
    fileSystem,
    env.TASK_DATABASE_PATH || './data/database.db',
    poolSize
  );

  return globalSQLiteOrchestrator;
}

/** Workers Workflow 命名空间类型 */
interface WorkflowNamespace {
  create(params: { id: string; params: unknown }): Promise<any>;
  get(id: string): Promise<any>;
}
