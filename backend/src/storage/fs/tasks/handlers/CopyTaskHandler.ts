// cSpell:words retryable
import type { TaskHandler, InternalJob, ExecutionContext } from '../TaskHandler.js';
import type { TaskStats, CopyTaskPayload, ItemResult, RetryPolicy } from '../types.js';
import { ValidationError } from '../../../../http/errors.js';
import {
  isRetryableError,
  calculateBackoffDelay,
  sleep,
  formatRetryLog,
  DEFAULT_RETRY_POLICY
} from '../utils/retryUtils.js';

// 进度上报节流：限制单个文件的进度写入次数，避免在 Workers Free 计划下触发 50 次子请求上限
const MAX_PROGRESS_UPDATES_PER_ITEM = 5;
const DEFAULT_PROGRESS_BYTES_STEP = 5 * 1024 * 1024; // 默认按 5MB 步长上报

// Docker 环境进度节流：按时间间隔限制进度上报频率，减少数据库写入压力
const DOCKER_PROGRESS_INTERVAL_MS = 500; // Docker 环境最小进度上报间隔 500ms

// 预扫描并发数：
// - Workers: 6 个并发连接是每次 invocation 独立的配额
// - Docker: 无硬限制
const PRESCAN_CONCURRENCY_WORKERS = 6;
const PRESCAN_CONCURRENCY_DOCKER = 10;

/**
 * 复制任务处理器 - 支持同存储原子复制和跨存储流式复制
 * - 同存储: 驱动层原子复制 (S3 自动使用 CopyObject API)
 * - 跨存储: 后端流式复制 + 字节级进度监控
 */
export class CopyTaskHandler implements TaskHandler {
  readonly taskType = 'copy';

  /** 验证复制任务载荷 - items 非空数组且每项包含 sourcePath 和 targetPath */
  async validate(payload: any): Promise<void> {
    // 检查items字段存在且为数组
    if (!payload.items || !Array.isArray(payload.items)) {
      throw new ValidationError('items 必须是数组');
    }

    // 检查items非空
    if (payload.items.length === 0) {
      throw new ValidationError('items 不能为空');
    }

    // 验证每个item的结构
    for (let i = 0; i < payload.items.length; i++) {
      const item = payload.items[i];

      if (!item.sourcePath || typeof item.sourcePath !== 'string') {
        throw new ValidationError(
          `items[${i}].sourcePath 必须是非空字符串`
        );
      }

      if (!item.targetPath || typeof item.targetPath !== 'string') {
        throw new ValidationError(
          `items[${i}].targetPath 必须是非空字符串`
        );
      }
    }
  }

  /** 执行复制任务 - 预扫描文件大小 → 逐项复制 + 支持重试和取消 */
  async execute(job: InternalJob, context: ExecutionContext): Promise<void> {
    const payload = job.payload as CopyTaskPayload;
    const fileSystem = context.getFileSystem();

    // 通过 ExecutionContext 获取运行时环境，用于区分 Cloudflare Workers (D1/Workflows) 与本地 SQLite (Docker/Node)
    // 只有在 Workers 环境下才开启进度上报节流，Docker 部署仍保持细粒度进度反馈
    const env = typeof context.getEnv === 'function' ? context.getEnv() : null;
    const isWorkersEnv =
      !!env &&
      (Object.prototype.hasOwnProperty.call(env, 'DB') ||
        Object.prototype.hasOwnProperty.call(env, 'JOB_WORKFLOW'));

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let totalBytesTransferred = 0;  // 累计已传输字节

    console.log(
      `[CopyTaskHandler] 开始执行作业 ${job.jobId}, 共 ${payload.items.length} 项`
    );

    // 预扫描所有源文件，获取 totalBytes 和每个文件大小（并发执行）
    const prescanConcurrency = isWorkersEnv
      ? PRESCAN_CONCURRENCY_WORKERS
      : PRESCAN_CONCURRENCY_DOCKER;

    const fileSizes: number[] = new Array(payload.items.length).fill(0);

    // 批量并发预扫描
    for (let batchStart = 0; batchStart < payload.items.length; batchStart += prescanConcurrency) {
      const batchEnd = Math.min(batchStart + prescanConcurrency, payload.items.length);
      const batchPromises: Promise<void>[] = [];

      for (let i = batchStart; i < batchEnd; i++) {
        const item = payload.items[i];

        // 目录跳过
        if (item.sourcePath.endsWith('/')) {
          continue;
        }

        const scanPromise = (async () => {
          try {
            const fileInfo = await fileSystem.getFileInfo(
              item.sourcePath,
              job.userId,
              job.userType
            );
            fileSizes[i] = fileInfo?.size || 0;
          } catch (error) {
            console.warn(
              `[CopyTaskHandler] 无法获取文件大小: ${item.sourcePath}`,
              error
            );
          }
        })();

        batchPromises.push(scanPromise);
      }

      await Promise.all(batchPromises);
    }

    const totalBytes = fileSizes.reduce((sum, size) => sum + size, 0);

    // 初始化每个文件的状态跟踪数组（包含文件大小）
    const itemResults: ItemResult[] = payload.items.map((item, index) => ({
      sourcePath: item.sourcePath,
      targetPath: item.targetPath,
      status: 'pending' as const,
      fileSize: fileSizes[index],
    }));

    await context.updateProgress(job.jobId, { totalBytes, itemResults });

    console.log(
      `[CopyTaskHandler] 预扫描完成，总大小: ${totalBytes} 字节`
    );

    // 获取重试策略
    const retryPolicy: RetryPolicy = payload.options?.retryPolicy || DEFAULT_RETRY_POLICY;
    console.log(
      `[CopyTaskHandler] 重试策略: limit=${retryPolicy.limit}, delay=${retryPolicy.delay}ms, backoff=${retryPolicy.backoff}`
    );

    // 为每个文件计算进度上报的最小步长和最近一次上报的字节数（仅在 Workers 环境下会使用）
    const lastReportedBytesPerItem: number[] = new Array(payload.items.length).fill(0);
    const progressStepPerItem: number[] = fileSizes.map((size) => {
      if (!size || size <= 0) {
        return DEFAULT_PROGRESS_BYTES_STEP;
      }
      const step = Math.ceil(size / MAX_PROGRESS_UPDATES_PER_ITEM);
      return Math.max(step, DEFAULT_PROGRESS_BYTES_STEP);
    });

    // Docker 环境：基于时间间隔的进度节流，避免高频写入 SQLite
    let lastDockerProgressTime = 0;

    for (let i = 0; i < payload.items.length; i++) {
      const item = payload.items[i];

      // 检查取消状态
      if (await context.isCancelled(job.jobId)) {
        console.log(
          `[CopyTaskHandler] 作业 ${job.jobId} 已取消, 停止执行 (已处理 ${i}/${payload.items.length} 项)`
        );
        break;
      }

      // 单文件重试循环
      let lastError: Error | null = null;
      let fileSuccess = false;
      let fileSkipped = false;
      let currentFileBytes = 0;

      for (let attempt = 0; attempt <= retryPolicy.limit; attempt++) {
        if (attempt > 0) {
          const delay = calculateBackoffDelay(attempt, retryPolicy);

          console.log(
            `[CopyTaskHandler] ${formatRetryLog(
              attempt,
              retryPolicy.limit,
              delay,
              item.sourcePath,
              lastError?.message
            )}`
          );

          itemResults[i].status = 'retrying';
          itemResults[i].retryCount = attempt;
          itemResults[i].lastRetryAt = Date.now();
          await context.updateProgress(job.jobId, { itemResults });

          await sleep(delay);

          // 重试前再次检查取消
          if (await context.isCancelled(job.jobId)) {
            console.log(
              `[CopyTaskHandler] 作业 ${job.jobId} 在重试等待期间被取消`
            );
            break;
          }
        }

        itemResults[i].status = attempt > 0 ? 'retrying' : 'processing';
        currentFileBytes = 0;

        try{

          // 调用 FileSystem.copyItem() - 自动选择同存储原子复制或跨存储流式复制
          const copyResult = await fileSystem.copyItem(
            item.sourcePath,
            item.targetPath,
            job.userId,
            job.userType,
            {
              ...payload.options,
              onProgress: (bytesTransferred: number) => {
                currentFileBytes = bytesTransferred;
                itemResults[i].bytesTransferred = bytesTransferred;
                const absoluteBytes = totalBytesTransferred + currentFileBytes;

                // Docker/Node.js 环境：按时间间隔节流
                if (!isWorkersEnv) {
                  const now = Date.now();
                  if (now - lastDockerProgressTime >= DOCKER_PROGRESS_INTERVAL_MS) {
                    lastDockerProgressTime = now;
                    context
                      .updateProgress(job.jobId, {
                        bytesTransferred: absoluteBytes,
                        itemResults,
                      })
                      .catch(() => {});
                  }
                  return;
                }

                // Cloudflare Workers 环境：按字节步长节流进度上报，减少 D1 子请求次数
                const lastReported = lastReportedBytesPerItem[i];
                const step = progressStepPerItem[i];
                if (absoluteBytes - lastReported >= step) {
                  lastReportedBytesPerItem[i] = absoluteBytes;
                  context
                    .updateProgress(job.jobId, {
                      bytesTransferred: absoluteBytes,
                      itemResults,
                    })
                    .catch(() => {});
                }
              },
            }
          );

          const isSkipped = copyResult?.status === 'skipped' || copyResult?.skipped === true;

          if (isSkipped) {
            fileSkipped = true;
          } else {
            const fileBytes = copyResult?.contentLength || currentFileBytes || 0;
            totalBytesTransferred += fileBytes;
            itemResults[i].bytesTransferred = fileBytes;
            fileSuccess = true;
          }

          itemResults[i].retryCount = attempt;
          break;

        } catch (error: any) {
          lastError = error;

          const canRetry = isRetryableError(error);
          const hasMoreRetries = attempt < retryPolicy.limit;

          if (!canRetry || !hasMoreRetries) {
            const retryInfo = attempt > 0 ? ` (已重试 ${attempt}/${retryPolicy.limit} 次)` : '';
            const retryableInfo = !canRetry ? ' [不可重试错误]' : '';

            itemResults[i].status = 'failed';
            itemResults[i].error = `${error.message || String(error)}${retryInfo}${retryableInfo}`;
            itemResults[i].retryCount = attempt;

            console.error(
              `[CopyTaskHandler] 复制最终失败 [${i + 1}/${payload.items.length}]${retryInfo}${retryableInfo} ` +
              `${item.sourcePath} → ${item.targetPath}: ${error.message || error}`
            );

            break;
          }

          console.warn(
            `[CopyTaskHandler] 复制失败 [${i + 1}/${payload.items.length}] (尝试 ${attempt + 1}/${retryPolicy.limit + 1}) ` +
            `${item.sourcePath}: ${error.message || error} [将重试]`
          );
        }
      }

      // 更新最终状态
      if (fileSkipped) {
        itemResults[i].status = 'skipped';
        itemResults[i].bytesTransferred = 0;
        skippedCount++;
      } else if (fileSuccess) {
        itemResults[i].status = 'success';
        successCount++;
        const retryCount = itemResults[i].retryCount;
        if (retryCount !== undefined && retryCount > 0) {
          console.log(
            `[CopyTaskHandler] ✓ 复制成功 (经 ${retryCount} 次重试) ${item.sourcePath}`
          );
        }
      } else {
        failedCount++;
      }

      // 更新进度
      await context.updateProgress(job.jobId, {
        processedItems: successCount + failedCount + skippedCount,
        successCount,
        failedCount,
        skippedCount,
        bytesTransferred: totalBytesTransferred,
        itemResults,
      });
    }

    console.log(
      `[CopyTaskHandler] 作业 ${job.jobId} 执行完成: ` +
        `成功 ${successCount}, 失败 ${failedCount}, 跳过 ${skippedCount}, ` +
        `传输 ${totalBytesTransferred} 字节`
    );
  }

  /** 创建统计模板 - 初始化所有项状态为 pending */
  createStatsTemplate(payload: any): TaskStats {
    const copyPayload = payload as CopyTaskPayload;

    const itemResults: ItemResult[] = copyPayload.items.map(item => ({
      sourcePath: item.sourcePath,
      targetPath: item.targetPath,
      status: 'pending' as const,
    }));

    return {
      totalItems: copyPayload.items.length,
      processedItems: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      bytesTransferred: 0,
      itemResults,
    };
  }

}
