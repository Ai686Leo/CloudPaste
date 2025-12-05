import { taskRegistry } from './TaskRegistry.js';
import { CopyTaskHandler } from './handlers/CopyTaskHandler.js';

/**
 * 注册所有任务处理器
 *
 * 在应用启动时调用,向 TaskRegistry 注册所有任务类型的处理器
 *
 * 注册顺序:
 * 1. CopyTaskHandler - 复制任务
 * 2. (未来) ScheduledSyncTaskHandler - 定时同步任务
 * 3. (未来) CleanupTaskHandler - 清理任务
 * 4. (未来) ArchiveTaskHandler - 归档任务
 *
 * @example
 * ```typescript
 * // backend/unified-entry.js
 * import { registerTaskHandlers } from './src/storage/fs/tasks/registerHandlers.js';
 *
 * // 应用启动时注册
 * registerTaskHandlers();
 * ```
 */
export function registerTaskHandlers(): void {
  console.log('[TaskRegistry] 开始注册任务处理器...');

  // 注册复制任务处理器
  taskRegistry.register(new CopyTaskHandler());

  // 未来扩展 (零核心代码修改):
  // taskRegistry.register(new ScheduledSyncTaskHandler());
  // taskRegistry.register(new CleanupTaskHandler());
  // taskRegistry.register(new ArchiveTaskHandler());

  const supportedTypes = taskRegistry.getSupportedTypes();
  console.log(
    `[TaskRegistry] 注册完成! 共注册 ${supportedTypes.length} 个任务类型: ${supportedTypes.join(', ')}`
  );
}
