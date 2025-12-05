/**
 * SQLite 通用任务编排器实现 (Docker/Node.js 环境)
 *
 *
 */

import Database from 'better-sqlite3';
import { DbTables } from '../../../constants/index.js';
import { taskRegistry } from './TaskRegistry.js';
import type { TaskHandler, InternalJob, ExecutionContext } from './TaskHandler.js';
import type {
  TaskOrchestratorAdapter,
  CreateJobParams,
  JobDescriptor,
  JobStatus,
} from './TaskOrchestratorAdapter.js';
import { TaskStatus } from './types.js';
import type { JobFilter, TaskStats } from './types.js';

export class SQLiteTaskOrchestrator implements TaskOrchestratorAdapter {
  private db: Database.Database;
  private workers: Promise<void>[] = [];
  private running = false;
  private fileSystem: any;

  constructor(
    fileSystem: any,  // FileSystem 实例 (从工厂传入)
    private dbPath: string = './data/database.db',  // 现有 D1 兼容 SQLite 数据库路径
    private concurrency: number = 10  // Worker Pool 并发数
  ) {
    this.fileSystem = fileSystem;
    // 初始化 SQLite 连接 (tasks 表已由 database.js migration case 25 创建)
    this.db = new Database(dbPath);

    // PRAGMA 优化
    this.db.pragma('journal_mode = WAL');      // 并发读性能
    this.db.pragma('synchronous = 1');         // 事务速度 (NORMAL 模式)
    this.db.pragma('busy_timeout = 5000');     // 5秒重试超时,避免 SQLITE_BUSY 错误

    // 启动时恢复 pending/running 作业 (崩溃恢复)
    this.recoverJobs();

    // 启动内存 Worker Pool
    this.startWorkers();

    console.log(
      `[SQLiteTaskOrchestrator] 已启动 (并发数: ${concurrency}, 数据库: ${dbPath})`
    );
  }

  /**
   * 更新 FileSystem 实例引用（单例模式下每次请求可能传入不同实例）
   */
  updateFileSystem(fileSystem: any): void {
    this.fileSystem = fileSystem;
  }

  /**
   * 创建任意类型的作业
   */
  async createJob(params: CreateJobParams): Promise<JobDescriptor> {
    const { taskType, payload, userId, userType } = params;

    // 验证任务类型并获取处理器
    const handler = taskRegistry.getHandler(taskType);
    await handler.validate(payload);

    // 生成作业 ID (带任务类型前缀)
    const jobId = this.generateJobId(taskType);
    const now = Date.now();

    // 创建初始统计模板
    const stats = handler.createStatsTemplate(payload);

    // 插入数据库
    this.db.prepare(`
      INSERT INTO ${DbTables.TASKS} (
        task_id, task_type, status, payload, stats,
        user_id, user_type,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      jobId,
      taskType,  // 动态任务类型
      'pending',
      JSON.stringify(payload),
      JSON.stringify(stats),
      userId,
      userType,
      now,
      now
    );

    console.log(
      `[SQLiteTaskOrchestrator] 已创建作业 ${jobId} (任务类型: ${taskType})`
    );

    return {
      jobId,
      taskType,
      status: TaskStatus.PENDING,
      stats,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  /**
   * 获取作业状态
   */
  async getJobStatus(jobId: string): Promise<JobStatus> {
    // JOIN api_keys 表获取密钥名称
    const row = this.db.prepare(`
      SELECT 
        t.*,
        ak.name as key_name
      FROM ${DbTables.TASKS} t
      LEFT JOIN ${DbTables.API_KEYS} ak ON t.user_id = ak.id
      WHERE t.task_id = ?
    `).get(jobId) as any;

    if (!row) {
      throw new Error(`作业 ${jobId} 不存在`);
    }

    const payload = JSON.parse(row.payload);

    return {
      jobId: row.task_id,
      taskType: row.task_type,
      status: row.status as TaskStatus,
      stats: JSON.parse(row.stats) as TaskStats,
      createdAt: new Date(row.created_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      finishedAt: row.finished_at ? new Date(row.finished_at) : undefined,
      updatedAt: new Date(row.updated_at),  // 新增: 最后更新时间
      errorMessage: row.error_message || undefined,
      payload,
      userId: row.user_id,
      keyName: row.key_name || null,  // API 密钥名称
    };
  }

  /**
   * 取消作业
   */
  async cancelJob(jobId: string): Promise<void> {
    const result = this.db.prepare(`
      UPDATE ${DbTables.TASKS}
      SET status = ?, updated_at = ?
      WHERE task_id = ? AND status IN ('pending', 'running')
    `).run(
      TaskStatus.CANCELLED,
      Date.now(),
      jobId
    );

    if (result.changes === 0) {
      throw new Error('作业不存在或已完成,无法取消');
    }

    console.log(`[SQLiteTaskOrchestrator] 已取消作业 ${jobId}`);
  }

  /**
   * 列出作业 (支持任务类型过滤)
   */
  async listJobs(filter?: JobFilter): Promise<JobDescriptor[]> {
    // JOIN api_keys 表获取密钥名称
    let query = `
      SELECT 
        t.*,
        ak.name as key_name
      FROM ${DbTables.TASKS} t
      LEFT JOIN ${DbTables.API_KEYS} ak ON t.user_id = ak.id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    // 任务类型过滤
    if (filter?.taskType) {
      query += ' AND t.task_type = ?';
      params.push(filter.taskType);
    }

    // 状态过滤
    if (filter?.status) {
      query += ' AND t.status = ?';
      params.push(filter.status);
    }

    // 用户过滤
    if (filter?.userId) {
      query += ' AND t.user_id = ?';
      params.push(filter.userId);
    }

    // 排序和分页
    query += ' ORDER BY t.created_at DESC';

    if (filter?.limit) {
      query += ' LIMIT ?';
      params.push(filter.limit);

      if (filter?.offset) {
        query += ' OFFSET ?';
        params.push(filter.offset);
      }
    }

    const results = this.db.prepare(query).all(...params) as any[];

    return results.map((row) => ({
      jobId: row.task_id,
      taskType: row.task_type,
      status: row.status as TaskStatus,
      stats: JSON.parse(row.stats) as TaskStats,
      createdAt: new Date(row.created_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      finishedAt: row.finished_at ? new Date(row.finished_at) : undefined,
      updatedAt: new Date(row.updated_at),  // 新增: 最后更新时间
      payload: JSON.parse(row.payload),
      userId: row.user_id,
      keyName: row.key_name || null,  // API 密钥名称
    }));
  }

  /**
   * 删除作业
   */
  async deleteJob(jobId: string): Promise<void> {
    const row = this.db.prepare(`
      SELECT status FROM ${DbTables.TASKS} WHERE task_id = ?
    `).get(jobId) as any;

    if (!row) {
      throw new Error(`作业 ${jobId} 不存在`);
    }

    if (row.status === TaskStatus.PENDING || row.status === TaskStatus.RUNNING) {
      throw new Error(`不能删除运行中的作业 ${jobId},请先取消`);
    }

    this.db.prepare(`
      DELETE FROM ${DbTables.TASKS} WHERE task_id = ?
    `).run(jobId);

    console.log(`[SQLiteTaskOrchestrator] 已删除作业 ${jobId}`);
  }

  // ==================== 内部方法 ====================

  /**
   * 启动内存 Worker Pool
   */
  private startWorkers(): void {
    this.running = true;

    for (let i = 0; i < this.concurrency; i++) {
      this.workers.push(this.workerLoop());
    }

    console.log(`[SQLiteTaskOrchestrator] 已启动 ${this.concurrency} 个 Worker`);
  }

  /**
   * Worker 循环 (持续运行直到 orchestrator 停止)
   * 使用指数退避策略优化空闲轮询：初始 500ms，每次空闲翻倍，最大 8 秒
   */
  private async workerLoop(): Promise<void> {
    const MIN_POLL_INTERVAL = 500;   // 初始轮询间隔 500ms
    const MAX_POLL_INTERVAL = 8000; // 最大轮询间隔 8 秒
    let currentInterval = MIN_POLL_INTERVAL;

    while (this.running) {
      // 原子获取下一个待执行作业
      const job = this.getNextJob();

      if (job) {
        // 有作业时重置轮询间隔
        currentInterval = MIN_POLL_INTERVAL;
        await this.processJob(job);
      } else {
        // 无待处理作业，使用指数退避休眠
        await new Promise(resolve => setTimeout(resolve, currentInterval));
        // 指数增长，但不超过最大值
        currentInterval = Math.min(currentInterval * 2, MAX_POLL_INTERVAL);
      }
    }
  }

  /**
   * 原子获取下一个待执行作业并标记为 running
   *
   * 使用 BEGIN IMMEDIATE TRANSACTION (而非 BEGIN TRANSACTION) 防止死锁
   */
  private getNextJob(): InternalJob | null {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');  // 关键: IMMEDIATE 避免死锁

    try {
      const row = this.db.prepare(`
        SELECT * FROM ${DbTables.TASKS}
        WHERE status = 'pending'
        ORDER BY created_at
        LIMIT 1
      `).get() as any;

      if (row) {
        const now = Date.now();

        // 标记为 running
        this.db.prepare(`
          UPDATE ${DbTables.TASKS}
          SET status = ?, started_at = ?, updated_at = ?
          WHERE task_id = ?
        `).run(
          TaskStatus.RUNNING,
          now,
          now,
          row.task_id
        );

        this.db.exec('COMMIT');

        const payload = JSON.parse(row.payload);
        const stats: TaskStats = JSON.parse(row.stats);

        return {
          jobId: row.task_id,
          taskType: row.task_type,  // 从数据库读取
          payload,
          userId: row.user_id,
          userType: row.user_type,
          stats,
          createdAt: new Date(row.created_at),
        };
      }

      this.db.exec('ROLLBACK');
      return null;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * 处理作业 (使用 TaskHandler 执行)
   */
  private async processJob(job: InternalJob): Promise<void> {
    console.log(
      `[SQLiteTaskOrchestrator] 开始处理作业 ${job.jobId} (任务类型: ${job.taskType})`
    );

    let errorMessage: string | undefined;

    try {
      // 获取任务处理器
      const handler = taskRegistry.getHandler(job.taskType);

      // 创建执行上下文
      const context: ExecutionContext = {
        isCancelled: async (jobId: string) => {
          const row = this.db.prepare(`
            SELECT status FROM ${DbTables.TASKS} WHERE task_id = ?
          `).get(jobId) as any;
          return row?.status === TaskStatus.CANCELLED;
        },

        updateProgress: async (jobId: string, stats: Partial<TaskStats>) => {
          const currentRow = this.db.prepare(`
            SELECT stats FROM ${DbTables.TASKS} WHERE task_id = ?
          `).get(jobId) as any;

          const currentStats = JSON.parse(currentRow.stats);
          const updatedStats = { ...currentStats, ...stats };

          this.db.prepare(`
            UPDATE ${DbTables.TASKS}
            SET stats = ?, updated_at = ?
            WHERE task_id = ?
          `).run(
            JSON.stringify(updatedStats),
            Date.now(),
            jobId
          );
        },

        getFileSystem: () => this.fileSystem,
        getEnv: () => ({ db: this.db }),
      };

      // 执行任务 (委托给 TaskHandler)
      await handler.execute(job, context);
    } catch (error: any) {
      errorMessage = error.message || String(error);
      console.error(
        `[SQLiteTaskOrchestrator] 作业 ${job.jobId} 执行失败:`,
        error
      );
    }

    // 检查最终状态 (可能已被取消)
    const finalRow = this.db.prepare(`
      SELECT status, stats FROM ${DbTables.TASKS} WHERE task_id = ?
    `).get(job.jobId) as any;

    if (finalRow.status === TaskStatus.CANCELLED) {
      console.log(
        `[SQLiteTaskOrchestrator] 作业 ${job.jobId} 已被用户取消,保持 cancelled 状态`
      );
      return;
    }

    // 根据统计结果确定最终状态
    const finalStats = JSON.parse(finalRow.stats) as TaskStats;
    const finalStatus: TaskStatus =
      errorMessage ? TaskStatus.FAILED :
      finalStats.failedCount === 0 ? TaskStatus.COMPLETED :
      finalStats.successCount === 0 ? TaskStatus.FAILED :
      TaskStatus.PARTIAL;

    // 更新最终状态
    this.db.prepare(`
      UPDATE ${DbTables.TASKS}
      SET status = ?, finished_at = ?, updated_at = ?, error_message = ?
      WHERE task_id = ?
    `).run(
      finalStatus,
      Date.now(),
      Date.now(),
      errorMessage || null,
      job.jobId
    );

    console.log(
      `[SQLiteTaskOrchestrator] 作业 ${job.jobId} 执行完成 (最终状态: ${finalStatus})`
    );
  }

  /**
   * 崩溃恢复: 启动时恢复 pending/running 作业
   */
  private recoverJobs(): void {
    const rows = this.db.prepare(`
      SELECT task_id, task_type FROM ${DbTables.TASKS}
      WHERE status IN ('pending', 'running')
      ORDER BY created_at
    `).all() as any[];

    for (const row of rows) {
      this.db.prepare(`
        UPDATE ${DbTables.TASKS}
        SET status = ?, updated_at = ?
        WHERE task_id = ?
      `).run(
        'pending',
        Date.now(),
        row.task_id
      );
    }

    if (rows.length > 0) {
      console.log(
        `[SQLiteTaskOrchestrator] 已恢复 ${rows.length} 个待处理作业 ` +
          `(任务类型: ${[...new Set(rows.map(r => r.task_type))].join(', ')})`
      );
    }
  }

  /**
   * 生成唯一作业 ID (格式: taskType-YYMMDDHHMM-random6)
   * 示例: copy-2512011430-a3f5g7
   */
  private generateJobId(taskType: string): string {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2); // 25
    const month = (now.getMonth() + 1).toString().padStart(2, '0'); // 12
    const day = now.getDate().toString().padStart(2, '0'); // 01
    const hour = now.getHours().toString().padStart(2, '0'); // 14
    const minute = now.getMinutes().toString().padStart(2, '0'); // 30
    const timeStr = `${year}${month}${day}${hour}${minute}`; // 2512011430
    const random = Math.random().toString(36).substring(2, 8); // 6位随机码
    return `${taskType}-${timeStr}-${random}`;
  }

  /**
   * 优雅关闭 orchestrator (停止 Worker,关闭数据库)
   */
  async shutdown(): Promise<void> {
    console.log('[SQLiteTaskOrchestrator] 正在关闭...');
    this.running = false;
    await Promise.all(this.workers);
    this.db.close();
    console.log('[SQLiteTaskOrchestrator] 已关闭');
  }
}
