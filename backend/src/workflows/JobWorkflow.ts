/**
 * Cloudflare Workflows 通用作业入口点
 * - 支持任意任务类型,通过 TaskRegistry 动态分发
 * - 持久化执行 + 步骤级重试
 * - 双层数据: Workflow 实例 (3-7天) + D1 tasks 表 (永久)
 */

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";

// @ts-ignore - JS modules lack type declarations
import { MountManager } from "../storage/managers/MountManager.js";
// @ts-ignore - JS modules lack type declarations
import { FileSystem } from "../storage/fs/FileSystem.js";
// @ts-ignore - JS modules lack type declarations
import { ensureRepositoryFactory } from "../utils/repositories.js";
import { DbTables } from "../constants/index.js";
import { taskRegistry } from "../storage/fs/tasks/TaskRegistry.js";
import type { ExecutionContext, InternalJob } from "../storage/fs/tasks/TaskHandler.js";
import { TaskStatus } from "../storage/fs/tasks/types.js";
import type { TaskStats } from "../storage/fs/tasks/types.js";

/** Workflow 参数 */
export interface JobWorkflowParams {
  jobId: string;
  taskType: string;
  payload: any;
  userId: string;
  userType: string;
}

/** Workers 环境绑定 */
interface Env {
  DB: D1Database;
  ENCRYPTION_SECRET: string;
}

/** 通用作业 Workflow - 持久化执行 + 自动重试 */
export class JobWorkflow extends WorkflowEntrypoint<Env, JobWorkflowParams> {
  async run(event: WorkflowEvent<JobWorkflowParams>, step: WorkflowStep) {
    const { jobId, taskType, payload, userId, userType } = event.payload;

    console.log(`[JobWorkflow] 启动作业 ${jobId}, 任务类型: ${taskType}`);

    // 获取任务处理器
    let handler;
    try {
      handler = taskRegistry.getHandler(taskType);
    } catch (error: any) {
      console.error(`[JobWorkflow] 未知任务类型 ${taskType}:`, error);

      await step.do('record-invalid-task-type', async () => {
        await this.env.DB.prepare(`
          UPDATE ${DbTables.TASKS}
          SET status = ?, error_message = ?, updated_at = ?, finished_at = ?
          WHERE task_id = ?
        `).bind(
          'failed',
          `未知任务类型: ${taskType}`,
          Date.now(),
          Date.now(),
          jobId
        ).run();
        return { error: 'invalid_task_type' };
      });

      throw error;
    }

    // 标记为 running
    await step.do('mark-running', async () => {
      await this.env.DB.prepare(`
        UPDATE ${DbTables.TASKS}
        SET status = ?, started_at = ?, updated_at = ?
        WHERE task_id = ?
      `).bind(
        'running',
        Date.now(),
        Date.now(),
        jobId
      ).run();
      return { success: true };
    });

    // 执行任务
    let taskSuccess = true;
    let taskError: Error | null = null;

    await step.do(
      'execute-task',
      {
        retries: {
          limit: 3,
          delay: 10000,
          backoff: "exponential" as const,
        },
        timeout: 600000,
      },
      async () => {
        try {
          console.log(`[JobWorkflow] 执行任务 ${jobId} (类型: ${taskType})`);

          // 创建执行上下文
          const context: ExecutionContext = {
            isCancelled: async (jobId: string) => {
              const row = await this.env.DB.prepare(`
                SELECT status FROM ${DbTables.TASKS} WHERE task_id = ?
              `).bind(jobId).first();
              return row?.status === 'cancelled';
            },

            updateProgress: async (jobId: string, stats: Partial<TaskStats>) => {
              const currentRow = await this.env.DB.prepare(`
                SELECT stats FROM ${DbTables.TASKS} WHERE task_id = ?
              `).bind(jobId).first();

              if (!currentRow) {
                console.error(`[JobWorkflow] 作业 ${jobId} 未找到,无法更新进度`);
                return;
              }

              const currentStats = JSON.parse(currentRow.stats as string);
              const updatedStats = { ...currentStats, ...stats };

              await this.env.DB.prepare(`
                UPDATE ${DbTables.TASKS}
                SET stats = ?, updated_at = ?
                WHERE task_id = ?
              `).bind(
                JSON.stringify(updatedStats),
                Date.now(),
                jobId
              ).run();
            },

            getFileSystem: () => {
              const repositoryFactory = ensureRepositoryFactory(this.env.DB);
              const mountManager = new MountManager(
                this.env.DB,
                this.env.ENCRYPTION_SECRET,
                repositoryFactory
              );
              return new FileSystem(mountManager, this.env);
            },

            getEnv: () => this.env,
          };

          const job: InternalJob = {
            jobId,
            taskType,
            payload,
            userId,
            userType,
            stats: {
              totalItems: 0,
              processedItems: 0,
              successCount: 0,
              failedCount: 0,
              skippedCount: 0,
            },
            createdAt: new Date(),
          };

          await handler.execute(job, context);

          console.log(`[JobWorkflow] ✓ 任务 ${jobId} 执行成功`);
          return { success: true };
        } catch (error: any) {
          taskSuccess = false;
          taskError = error;
          console.error(`[JobWorkflow] ✗ 任务 ${jobId} 执行失败:`, error);

          return {
            success: false,
            error: error.message || String(error),
          };
        }
      }
    );

    // 最终化状态
    await step.do('finalize-task-record', async () => {
      console.log(`[JobWorkflow] 最终化作业记录 ${jobId}`);

      const finalRow = await this.env.DB.prepare(`
        SELECT status, stats FROM ${DbTables.TASKS} WHERE task_id = ?
      `).bind(jobId).first();

      if (finalRow?.status === 'cancelled') {
        console.log(`[JobWorkflow] 作业 ${jobId} 已被用户取消,保持 cancelled 状态`);
        return { cancelled: true };
      }

      const finalStats = JSON.parse(finalRow?.stats as string || '{}') as TaskStats;
      let finalStatus: TaskStatus;

      if (!taskSuccess && taskError) {
        finalStatus = TaskStatus.FAILED;
      } else {
        finalStatus =
          finalStats.failedCount === 0 ? TaskStatus.COMPLETED :
          finalStats.successCount === 0 ? TaskStatus.FAILED :
          TaskStatus.PARTIAL;
      }

      const errorMessage =
        finalRow?.status === 'cancelled' ? '任务已被用户取消' :
        taskError ? taskError.message || String(taskError) :
        finalStats.failedCount > 0 ? `部分项目失败 (${finalStats.failedCount}/${finalStats.totalItems})` :
        null;

      await this.env.DB.prepare(`
        UPDATE ${DbTables.TASKS}
        SET status = ?, stats = ?, finished_at = ?, updated_at = ?, error_message = ?
        WHERE task_id = ?
      `).bind(
        finalStatus,
        JSON.stringify(finalStats),
        Date.now(),
        Date.now(),
        errorMessage,
        jobId
      ).run();

      console.log(`[JobWorkflow] ✓ 作业记录已最终化,状态: ${finalStatus}`);
      return { status: finalStatus };
    });

    const finalRow = await this.env.DB.prepare(`
      SELECT stats FROM ${DbTables.TASKS} WHERE task_id = ?
    `).bind(jobId).first();

    const finalStats = finalRow ? JSON.parse(finalRow.stats as string) as TaskStats : {
      totalItems: 0,
      processedItems: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
    };

    return {
      ...finalStats,
      finishedAt: new Date().toISOString(),
    };
  }
}
