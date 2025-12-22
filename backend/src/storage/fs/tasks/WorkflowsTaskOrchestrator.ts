/**
 * Cloudflare Workers 任务编排器 - 使用 Workflows API
 * - 持久化执行 + 步骤级重试
 * - 双层数据: Workflow 实例 (3-7天) + D1 tasks 表 (永久)
 * - 支持多任务类型 (TaskRegistry + TaskHandler)
 */

import { DbTables } from '../../../constants/index.js';
import { taskRegistry } from './TaskRegistry.js';
import type { TaskHandler } from './TaskHandler.js';
import type {
  TaskOrchestratorAdapter,
  CreateJobParams,
  JobDescriptor,
  JobStatus,
} from './TaskOrchestratorAdapter.js';
import { TaskStatus } from './types.js';
import type {
  JobFilter,
  JobListResult,
  TaskStats,
} from './types.js';

/** Workers 环境绑定 */
interface WorkersEnv {
  JOB_WORKFLOW: WorkflowNamespace;
  DB: D1Database;
}

/** Workflow 实例状态 */
interface WorkflowInstanceStatus {
  id: string;
  status: string;
  output?: {
    totalItems?: number;
    processedItems?: number;
    successCount?: number;
    failedCount?: number;
    skippedCount?: number;
    finishedAt?: string;
  };
  created: string;
  modified: string;
}

/** Workflow 命名空间 */
interface WorkflowNamespace {
  create(params: { id: string; params: unknown }): Promise<WorkflowInstance>;
  get(id: string): Promise<WorkflowInstance>;
}

/** Workflow 实例 */
interface WorkflowInstance {
  id: string;
  status(): Promise<WorkflowInstanceStatus>;
  terminate(): Promise<void>;
}

export class WorkflowsTaskOrchestrator implements TaskOrchestratorAdapter {
  constructor(
    private env: WorkersEnv,
    private fileSystem: any
  ) {}

  /** 创建作业 - 验证任务类型 → 生成 ID → 创建 Workflow 实例 → 插入数据库 */
  async createJob(params: CreateJobParams): Promise<JobDescriptor> {
    const {
      taskType,
      payload,
      userId,
      userType,
      triggerType: triggerTypeRaw,
      triggerRef: triggerRefRaw,
    } = params;
    const triggerType = triggerTypeRaw ?? 'manual';
    const triggerRef = triggerRefRaw ?? null;

    const handler = taskRegistry.getHandler(taskType);
    await handler.validate(payload);

    const jobId = this.generateJobId(taskType);
    const now = Date.now();
    const stats = handler.createStatsTemplate(payload);

    const workflowInstance = await this.env.JOB_WORKFLOW.create({
      id: jobId,
      params: {
        jobId,
        taskType,
        payload,
        userId,
        userType,
        triggerType,
        triggerRef,
      },
    });

    await this.env.DB.prepare(`
      INSERT INTO ${DbTables.TASKS} (
        task_id, task_type, status, payload, stats,
        user_id, user_type, workflow_instance_id,
        trigger_type, trigger_ref,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      jobId,
      taskType,
      'pending',
      JSON.stringify(payload),
      JSON.stringify(stats),
      userId,
      userType,
      jobId,
      triggerType,
      triggerRef,
      now,
      now
    ).run();

    console.log(
      `[WorkflowsTaskOrchestrator] 已创建作业 ${jobId} (任务类型: ${taskType})`
    );

    return {
      jobId,
      taskType,
      status: TaskStatus.PENDING,
      stats,
      createdAt: new Date(now),
      updatedAt: new Date(now),
      triggerType,
      triggerRef,
    };
  }

  /** 获取作业状态 - 数据库静态数据 + Workflow 实时进度 */
  async getJobStatus(jobId: string): Promise<JobStatus> {
    const taskRecord = await this.env.DB.prepare(`
      SELECT
        t.*,
        ak.name as key_name
      FROM ${DbTables.TASKS} t
      LEFT JOIN ${DbTables.API_KEYS} ak ON t.user_id = ak.id
      WHERE t.task_id = ?
    `).bind(jobId).first();

    if (!taskRecord) {
      throw new Error(`作业 ${jobId} 不存在`);
    }

    const payload = JSON.parse(taskRecord.payload as string);
    const dbStats = JSON.parse(taskRecord.stats as string) as TaskStats;

    let workflowStatus: WorkflowInstanceStatus | null = null;
    try {
      const instance = await this.env.JOB_WORKFLOW.get(jobId);
      workflowStatus = await instance.status();
    } catch (error) {
      console.log(`Workflow ${jobId} 不可用，使用数据库状态:`, error);
    }

    // 当前数据库中的状态
    let dbStatus = taskRecord.status as string;

    if (workflowStatus) {
      // 映射 Workflow 实例状态到任务状态
      const mappedStatus = this.mapWorkflowStatus(workflowStatus.status);

      // 如果 Workflow 已经进入终态，而数据库仍然是 pending/running，则进行一次状态同步
      const isDbRunning =
        dbStatus === TaskStatus.PENDING || dbStatus === TaskStatus.RUNNING;
      const isFinalStatus =
        mappedStatus === TaskStatus.COMPLETED ||
        mappedStatus === TaskStatus.FAILED ||
        mappedStatus === TaskStatus.CANCELLED ||
        mappedStatus === TaskStatus.PARTIAL;

      if (isDbRunning && isFinalStatus) {
        try {
          const finishedAtMs = workflowStatus.output?.finishedAt
            ? new Date(workflowStatus.output.finishedAt).getTime()
            : Date.now();
          const updatedAtMs = Date.now();

          await this.env.DB.prepare(`
            UPDATE ${DbTables.TASKS}
            SET status = ?, finished_at = ?, updated_at = ?
            WHERE task_id = ?
          `)
            .bind(mappedStatus, finishedAtMs, updatedAtMs, jobId)
            .run();

          dbStatus = mappedStatus;
        } catch (error) {
          console.warn(
            `[WorkflowsTaskOrchestrator] 同步作业 ${jobId} 状态到 D1 失败，将继续使用内存状态:`,
            error,
          );
        }
      }

      const effectiveStatus =
        dbStatus === TaskStatus.CANCELLED ? TaskStatus.CANCELLED : mappedStatus;

      return {
        jobId: taskRecord.task_id as string,
        taskType: taskRecord.task_type as string,
        status: effectiveStatus,
        stats: {
          totalItems: workflowStatus.output?.totalItems ?? dbStats.totalItems,
          processedItems: workflowStatus.output?.processedItems ?? dbStats.processedItems,
          successCount: workflowStatus.output?.successCount ?? dbStats.successCount,
          failedCount: workflowStatus.output?.failedCount ?? dbStats.failedCount,
          skippedCount: workflowStatus.output?.skippedCount ?? dbStats.skippedCount,
          totalBytes: dbStats.totalBytes,
          bytesTransferred: dbStats.bytesTransferred,
          itemResults: dbStats.itemResults,
        },
        createdAt: new Date(taskRecord.created_at as number),
        startedAt: taskRecord.started_at ? new Date(taskRecord.started_at as number) : undefined,
        finishedAt: workflowStatus.output?.finishedAt
          ? new Date(workflowStatus.output.finishedAt)
          : (taskRecord.finished_at ? new Date(taskRecord.finished_at as number) : undefined),
        updatedAt: new Date(taskRecord.updated_at as number),
        errorMessage: taskRecord.error_message as string | undefined,
        payload,
        userId: taskRecord.user_id as string,
        keyName: taskRecord.key_name as string | null,
        triggerType: (taskRecord as any).trigger_type as string,
        triggerRef: ((taskRecord as any).trigger_ref as string) ?? null,
      };
    }

    return {
      jobId: taskRecord.task_id as string,
      taskType: taskRecord.task_type as string,
      status: taskRecord.status as TaskStatus,
      stats: dbStats,
      createdAt: new Date(taskRecord.created_at as number),
      startedAt: taskRecord.started_at ? new Date(taskRecord.started_at as number) : undefined,
      finishedAt: taskRecord.finished_at ? new Date(taskRecord.finished_at as number) : undefined,
      updatedAt: new Date(taskRecord.updated_at as number),
      errorMessage: taskRecord.error_message as string | undefined,
      payload,
      userId: taskRecord.user_id as string,
      keyName: taskRecord.key_name as string | null,
      triggerType: (taskRecord as any).trigger_type as string,
      triggerRef: ((taskRecord as any).trigger_ref as string) ?? null,
    };
  }

  /** 取消作业 - 终止 Workflow 实例 + 更新数据库状态 */
  async cancelJob(jobId: string): Promise<void> {
    try {
      const instance = await this.env.JOB_WORKFLOW.get(jobId);
      await instance.terminate();
    } catch (error) {
      console.log(`终止 Workflow ${jobId} 失败:`, error);
    }

    await this.env.DB.prepare(`
      UPDATE ${DbTables.TASKS}
      SET status = ?, updated_at = ?
      WHERE task_id = ?
    `).bind(
      'cancelled',
      Date.now(),
      jobId
    ).run();

    console.log(`[WorkflowsTaskOrchestrator] 已取消作业 ${jobId}`);
  }

  /** 列出作业 - 支持任务类型、状态、用户过滤 + 分页 */
  async listJobs(filter?: JobFilter): Promise<JobListResult> {
    let whereClause = 'WHERE 1=1';
    const baseParams: (string | number)[] = [];

    if (filter?.taskType) {
      whereClause += ' AND t.task_type = ?';
      baseParams.push(filter.taskType);
    } else if (filter?.taskTypes && filter.taskTypes.length > 0) {
      const placeholders = filter.taskTypes.map(() => '?').join(', ');
      whereClause += ` AND t.task_type IN (${placeholders})`;
      baseParams.push(...filter.taskTypes);
    }

    if (filter?.status) {
      whereClause += ' AND t.status = ?';
      baseParams.push(filter.status);
    }

    if (filter?.userId) {
      whereClause += ' AND t.user_id = ?';
      baseParams.push(filter.userId);
    }

    const countQuery = `
      SELECT COUNT(1) as total
      FROM ${DbTables.TASKS} t
      ${whereClause}
    `;
    const countResult = await this.env.DB.prepare(countQuery).bind(...baseParams).first();
    const total = Number((countResult as any)?.total || 0);

    let query = `
      SELECT
        t.*,
        ak.name as key_name
      FROM ${DbTables.TASKS} t
      LEFT JOIN ${DbTables.API_KEYS} ak ON t.user_id = ak.id
      ${whereClause}
      ORDER BY t.created_at DESC
    `;
    const params = [...baseParams];

    if (filter?.limit) {
      query += ' LIMIT ?';
      params.push(filter.limit);

      if (filter.offset) {
        query += ' OFFSET ?';
        params.push(filter.offset);
      }
    }

    const results = await this.env.DB.prepare(query).bind(...params).all();
    const jobs = results.results.map((row: any) => ({
      jobId: row.task_id,
      taskType: row.task_type,
      status: row.status,
      stats: JSON.parse(row.stats),
      createdAt: new Date(row.created_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      finishedAt: row.finished_at ? new Date(row.finished_at) : undefined,
      updatedAt: new Date(row.updated_at),
      payload: JSON.parse(row.payload),
      userId: row.user_id,
      keyName: row.key_name || null,
      triggerType: row.trigger_type || 'manual',
      triggerRef: row.trigger_ref ?? null,
    }));

    return { jobs, total };
  }

  /** 删除作业 - 仅终态作业，运行中需先取消 */
  async deleteJob(jobId: string): Promise<void> {
    const taskRecord = await this.env.DB.prepare(`
      SELECT status FROM ${DbTables.TASKS} WHERE task_id = ?
    `).bind(jobId).first();

    if (!taskRecord) {
      throw new Error(`作业 ${jobId} 不存在`);
    }

    const status = taskRecord.status as string;
    if (status === 'pending' || status === 'running') {
      throw new Error(`不能删除运行中的作业 ${jobId},请先取消`);
    }

    await this.env.DB.prepare(`
      DELETE FROM ${DbTables.TASKS} WHERE task_id = ?
    `).bind(jobId).run();

    console.log(`[WorkflowsTaskOrchestrator] 已删除作业 ${jobId}`);
  }

  private parseWorkflowStatus(status: WorkflowInstanceStatus): JobStatus {
    return {
      jobId: status.id,
      taskType: '',  // 占位符,实际使用时从数据库获取
      status: this.mapWorkflowStatus(status.status),
      stats: {
        totalItems: status.output?.totalItems || 0,
        processedItems: status.output?.processedItems || 0,
        successCount: status.output?.successCount || 0,
        failedCount: status.output?.failedCount || 0,
        skippedCount: status.output?.skippedCount || 0,
        bytesTransferred: 0,
      },
      createdAt: new Date(status.created),
      finishedAt: status.output?.finishedAt ? new Date(status.output.finishedAt) : undefined,
      payload: {},
    };
  }

  private mapWorkflowStatus(workflowStatus: string): TaskStatus {
    switch (workflowStatus) {
      case 'queued':
        return TaskStatus.PENDING;
      case 'running':
        return TaskStatus.RUNNING;
      // Workflows 的 status() 可能返回更多“非终态”状态：
      // - waiting: 休眠/等待事件（不消耗 CPU，但实例仍在生命周期中）
      // - paused: 显式暂停
      // - waitingForPause: 正在收尾以进入 paused
      // - unknown: 平台无法判定（文档列出该值）
      //
      // 本项目内部 TaskStatus 仅建模 pending/running/...，没有 paused/waiting。
      // 因此这里做“语义折叠”：
      // - waiting/paused/unknown → pending（非终态、非执行态）
      // - waitingForPause → running（仍可能在执行当前工作单元）
      //
      // 注意：是否允许“取消/终止”不应依赖 UI 文案，而应以终态判定为准；
      // 这里的映射主要用于：列表展示 + allowedActions 的粗粒度判断。
      case 'waiting':
      case 'paused':
      case 'unknown':
        return TaskStatus.PENDING;
      case 'waitingForPause':
        return TaskStatus.RUNNING;
      case 'complete':
        return TaskStatus.COMPLETED;
      case 'errored':
        return TaskStatus.FAILED;
      case 'terminated':
        return TaskStatus.CANCELLED;
      default:
        return TaskStatus.PENDING;
    }
  }

  /** 生成作业 ID - 格式: taskType-YYMMDDHHMM-random6 */
  private generateJobId(taskType: string): string {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hour = now.getHours().toString().padStart(2, '0');
    const minute = now.getMinutes().toString().padStart(2, '0');
    const timeStr = `${year}${month}${day}${hour}${minute}`;
    const random = Math.random().toString(36).substring(2, 8);
    return `${taskType}-${timeStr}-${random}`;
  }
}
