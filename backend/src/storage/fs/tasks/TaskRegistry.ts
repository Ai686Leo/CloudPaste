import type { TaskHandler } from './TaskHandler.js';

/**
 * 任务类型注册表 (单例) - 注册和分发任务处理器
 */
class TaskRegistry {
  private static instance: TaskRegistry;
  private handlers = new Map<string, TaskHandler>();

  private constructor() {}

  static getInstance(): TaskRegistry {
    if (!TaskRegistry.instance) {
      TaskRegistry.instance = new TaskRegistry();
    }
    return TaskRegistry.instance;
  }

  /** 注册任务处理器 */
  register(handler: TaskHandler): void {
    if (this.handlers.has(handler.taskType)) {
      throw new Error(`任务类型 "${handler.taskType}" 已注册,不允许重复注册`);
    }
    this.handlers.set(handler.taskType, handler);
    console.log(`[TaskRegistry] 已注册任务类型: ${handler.taskType}`);
  }

  /** 获取任务处理器 */
  getHandler(taskType: string): TaskHandler {
    const handler = this.handlers.get(taskType);
    if (!handler) {
      throw new Error(
        `未知任务类型: "${taskType}"\n` +
          `支持的任务类型: ${this.getSupportedTypes().join(', ')}`
      );
    }
    return handler;
  }

  /** 获取所有支持的任务类型 */
  getSupportedTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  /** 检查任务类型是否已注册 */
  hasType(taskType: string): boolean {
    return this.handlers.has(taskType);
  }

  /** 获取已注册的任务处理器数量 */
  getHandlerCount(): number {
    return this.handlers.size;
  }
}

/** 全局单例实例 - 在应用启动时注册所有任务处理器 */
export const taskRegistry = TaskRegistry.getInstance();
