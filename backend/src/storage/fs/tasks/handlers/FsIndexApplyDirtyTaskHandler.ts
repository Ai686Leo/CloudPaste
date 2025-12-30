import type { TaskHandler, InternalJob, ExecutionContext } from "../TaskHandler.js";
import { ValidationError } from "../../../../http/errors.js";
import { ensureRepositoryFactory } from "../../../../utils/repositories.js";
import { FsSearchIndexStore } from "../../search/FsSearchIndexStore.js";
import { iterateListDirectoryItems } from "../../utils/listDirectoryPaging.js";

type FsIndexApplyDirtyPayload = {
  mountIds?: string[];
  options?: {
    /**
     * 单次拉取 dirty 的条数（上限 2000）
     */
    batchSize?: number;
    /**
     * 单次作业最多处理的 dirty 条目数量（可选）
     */
    maxItems?: number | null;
    /**
     * 对目录 upsert：是否递归重建该目录子树（默认 true）
     */
    rebuildDirectorySubtree?: boolean;
    /**
     * 目录子树重建的最大深度（相对该目录），可选
     */
    maxDepth?: number | null;
    /**
     * 是否强制跳过缓存（默认 true）
     */
    refresh?: boolean;
  };
};

function coercePositiveInt(value: any, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function parseMaybeInt(value: any): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function isDirectoryPath(fsPath: string): boolean {
  return typeof fsPath === "string" && fsPath.endsWith("/");
}

function tryRandomUuid(): string {
  try {
    // eslint-disable-next-line no-undef
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      // eslint-disable-next-line no-undef
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return `run_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function parseModifiedMs(modified: any): number {
  const ms = Date.parse(String(modified || ""));
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * dirty 增量应用任务
 * - 消费 fs_search_index_dirty 队列，更新 fs_search_index_entries（FTS 由触发器维护）
 * - 目录删除：前缀删除（删除目录自身 + 子树）
 * - 目录 upsert：可选递归重建该目录子树（避免目录 rename/move 导致索引残留）
 */
export class FsIndexApplyDirtyTaskHandler implements TaskHandler {
  readonly taskType = "fs_index_apply_dirty";

  async validate(payload: any): Promise<void> {
    if (payload === null || typeof payload !== "object") {
      throw new ValidationError("payload 必须是对象");
    }

    const mountIds = payload.mountIds;
    if (mountIds !== undefined && mountIds !== null) {
      if (!Array.isArray(mountIds)) {
        throw new ValidationError("mountIds 必须是字符串数组");
      }
      for (let i = 0; i < mountIds.length; i++) {
        const id = mountIds[i];
        if (typeof id !== "string" || !id.trim()) {
          throw new ValidationError(`mountIds[${i}] 必须是非空字符串`);
        }
      }
    }

    const options = payload.options ?? {};
    if (options && typeof options !== "object") {
      throw new ValidationError("options 必须是对象");
    }

    if (options.batchSize !== undefined) {
      const n = Number(options.batchSize);
      if (!Number.isFinite(n) || n <= 0) {
        throw new ValidationError("options.batchSize 必须是正整数");
      }
    }

    if (options.maxItems !== undefined && options.maxItems !== null) {
      const n = Number(options.maxItems);
      if (!Number.isFinite(n) || n <= 0) {
        throw new ValidationError("options.maxItems 必须是正整数或 null");
      }
    }

    if (options.maxDepth !== undefined && options.maxDepth !== null) {
      const n = Number(options.maxDepth);
      if (!Number.isFinite(n) || n < 0) {
        throw new ValidationError("options.maxDepth 必须是 >=0 的整数或 null");
      }
    }
  }

  createStatsTemplate(payload: any) {
    const mountIds = Array.isArray(payload?.mountIds) ? payload.mountIds : [];
    return {
      totalItems: 0,
      processedItems: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      itemResults: [],
      mountsHint: mountIds.length > 0 ? mountIds.length : 0,
      totalDirtyProcessed: 0,
      totalUpserted: 0,
      totalDeleted: 0,
    } as any;
  }

  async execute(job: InternalJob, context: ExecutionContext): Promise<void> {
    const payload = (job.payload || {}) as FsIndexApplyDirtyPayload;
    const fileSystem = context.getFileSystem();
    const env = typeof context.getEnv === "function" ? context.getEnv() : null;
    const db = env?.DB ?? fileSystem?.mountManager?.db;
    if (!db) {
      throw new ValidationError("fs_index_apply_dirty: 缺少 DB 绑定");
    }

    const isWorkersEnv =
      !!env &&
      (Object.prototype.hasOwnProperty.call(env, "DB") ||
        Object.prototype.hasOwnProperty.call(env, "JOB_WORKFLOW"));

    const options = payload.options || {};
    const batchSize = coercePositiveInt(options.batchSize, isWorkersEnv ? 50 : 200, 10, 2000);
    const maxItems = options.maxItems === null || options.maxItems === undefined ? null : parseMaybeInt(options.maxItems);
    const rebuildDirectorySubtree = options.rebuildDirectorySubtree !== false;
    const maxDepth = options.maxDepth === null || options.maxDepth === undefined ? null : parseMaybeInt(options.maxDepth);
    const refresh = options.refresh !== false;

    const store = new FsSearchIndexStore(db);
    const factory = ensureRepositoryFactory(db, fileSystem?.repositoryFactory);
    const mountRepository = factory.getMountRepository();
    const allMounts = await mountRepository.findAll(true);
    const mountInfoMap = new Map(
      allMounts.map((mount: any) => [String(mount?.id || ""), mount]),
    );

    const requestedMountIds = Array.isArray(payload.mountIds)
      ? payload.mountIds.map((x) => String(x).trim()).filter(Boolean)
      : [];

    const mounts = requestedMountIds.length > 0 ? requestedMountIds : [];
    if (mounts.length === 0) {
      // 没指定 mountIds：消费全局 dirty（按 mount_id 分组扫描）
      const resp = await db
        .prepare(`SELECT DISTINCT mount_id FROM fs_search_index_dirty ORDER BY mount_id ASC LIMIT 2000`)
        .all();
      const rows = Array.isArray(resp?.results) ? resp.results : [];
      for (const r of rows) {
        const id = String(r?.mount_id || "");
        if (id) mounts.push(id);
      }
    }

    let processed = 0;
    let success = 0;
    let failed = 0;
    let skipped = 0;
    let totalUpserted = 0;
    let totalDeleted = 0;
    const itemResults: any[] = [];

    console.log(
      `[FsIndexApplyDirtyTaskHandler] 开始执行作业 ${job.jobId}, mounts=${mounts.length}, batchSize=${batchSize}, maxItems=${maxItems ?? "∞"}, rebuildDir=${rebuildDirectorySubtree}`,
    );

    for (const mountId of mounts) {
      const mountStartedAt = Date.now();
      const mountInfo = mountInfoMap.get(mountId);
      const mountSummary = {
        kind: "mount",
        mountId,
        mountName: mountInfo?.name ?? null,
        mountPath: mountInfo?.mount_path ?? null,
        storageType: mountInfo?.storage_type ?? null,
        status: "processing",
        durationMs: 0,
        processedDirtyCount: 0,
        upsertedCount: 0,
        deletedCount: 0,
        skippedCount: 0,
        failedCount: 0,
      } as any;
      itemResults.push(mountSummary);

      if (await context.isCancelled(job.jobId)) {
        console.warn(`[FsIndexApplyDirtyTaskHandler] 作业已取消: ${job.jobId}`);
        break;
      }

      // 未 ready 的 mount：只消费 dirty 可能导致“部分可用”，这里选择跳过并提示
      const stateMap = await store.getIndexStates([mountId]);
      const state = stateMap.get(mountId);
      if (String(state?.status || "not_ready") !== "ready") {
        skipped++;
        mountSummary.status = "skipped";
        mountSummary.error = "index_not_ready";
        mountSummary.durationMs = Date.now() - mountStartedAt;
        await context.updateProgress(job.jobId, {
          totalItems: maxItems ?? 0,
          processedItems: processed,
          successCount: success,
          failedCount: failed,
          skippedCount: skipped,
          itemResults,
          currentMountId: mountId,
          lastBatch: 0,
          totalDirtyProcessed: processed,
          totalUpserted,
          totalDeleted,
        } as any);
        continue;
      }

      // mount 内循环消费
      while (true) {
        if (await context.isCancelled(job.jobId)) {
          console.warn(`[FsIndexApplyDirtyTaskHandler] 作业已取消: ${job.jobId}`);
          break;
        }

        if (maxItems !== null && processed >= maxItems) {
          break;
        }

        const remaining = maxItems !== null ? Math.max(maxItems - processed, 0) : null;
        const take = remaining !== null ? Math.max(1, Math.min(batchSize, remaining)) : batchSize;

        const rows = await store.listDirtyBatch(mountId, take);
        if (!rows || rows.length === 0) {
          break;
        }

        const consumedKeys: string[] = [];

        for (const row of rows) {
          const fsPath = String(row?.fs_path || "");
          const op = String(row?.op || "");
          const key = String(row?.dedupe_key || "");
          if (!fsPath || !key) {
            continue;
          }

          try {
            if (op === "delete") {
              if (isDirectoryPath(fsPath)) {
                await store.deleteByPathPrefix(mountId, fsPath);
              } else {
                await store.deleteEntry(mountId, fsPath);
              }
              success++;
              processed++;
              mountSummary.processedDirtyCount++;
              mountSummary.deletedCount++;
              totalDeleted++;
              consumedKeys.push(key);
              continue;
            }

            if (op !== "upsert") {
              // 未知 op：跳过但消费掉，避免死循环
              skipped++;
              processed++;
              mountSummary.processedDirtyCount++;
              mountSummary.skippedCount++;
              consumedKeys.push(key);
              continue;
            }

            if (isDirectoryPath(fsPath) && rebuildDirectorySubtree) {
              const runId = tryRandomUuid();
              const startedDirAt = Date.now();

              // 先 upsert 目录自身（listDirectory 不包含目录自身）
              const dirInfo = await fileSystem.getFileInfo(fsPath, job.userId, job.userType);
              await store.upsertEntries(
                [
                  {
                    mountId,
                    fsPath: String(dirInfo?.path || fsPath),
                    name: String(dirInfo?.name || ""),
                    isDir: true,
                    size: Number(dirInfo?.size || 0),
                    modifiedMs: parseModifiedMs(dirInfo?.modified),
                    mimetype: dirInfo?.mimetype ?? null,
                  },
                ],
                { indexRunId: runId },
              );

              // 递归扫描子树（BFS）
              const queue: Array<{ path: string; depth: number }> = [{ path: fsPath, depth: 0 }];
              const pending: any[] = [];
              let upserted = 0;
              const seenDirs = new Set<string>();

              while (queue.length > 0) {
                if (await context.isCancelled(job.jobId)) {
                  throw new Error("cancelled");
                }

                const current = queue.shift()!;
                const dir = current.path;
                const depth = current.depth;

                if (seenDirs.has(dir)) continue;
                seenDirs.add(dir);

                for await (const item of iterateListDirectoryItems(
                  fileSystem,
                  dir,
                  job.userId,
                  job.userType,
                  { refresh },
                )) {
                  const childPath = String(item?.path || "");
                  if (!childPath) continue;

                  const isDir = Boolean(item?.isDirectory);
                  pending.push({
                    mountId,
                    fsPath: childPath,
                    name: String(item?.name || ""),
                    isDir,
                    size: Number(item?.size) || 0,
                    modifiedMs: parseModifiedMs(item?.modified),
                    mimetype: item?.mimetype ?? null,
                  });

                  if (pending.length >= batchSize) {
                    await store.upsertEntries(pending, { indexRunId: runId });
                    upserted += pending.length;
                    pending.length = 0;
                  }

                  if (isDir) {
                    if (maxDepth !== null && depth >= maxDepth) continue;
                    queue.push({ path: childPath.endsWith("/") ? childPath : `${childPath}/`, depth: depth + 1 });
                  }
                }
              }

              if (pending.length > 0) {
                await store.upsertEntries(pending, { indexRunId: runId });
                upserted += pending.length;
                pending.length = 0;
              }

              await store.cleanupPrefixByRunId(mountId, fsPath, runId);

              success++;
              processed++;
              mountSummary.processedDirtyCount++;
              mountSummary.upsertedCount += upserted;
              totalUpserted += upserted;
              consumedKeys.push(key);

              itemResults.push({
                kind: "path",
                label: fsPath,
                sourcePath: fsPath,
                targetPath: "",
                status: "success",
                durationMs: Date.now() - startedDirAt,
                meta: {
                  upsertedCount: upserted,
                },
              });
              continue;
            }

            // 文件/目录（不递归）：用 getFileInfo 读取最新元数据并 upsert
            const info = await fileSystem.getFileInfo(fsPath, job.userId, job.userType);
            const isDir = Boolean(info?.isDirectory);
            await store.upsertEntries(
              [
                {
                  mountId,
                  fsPath: String(info?.path || fsPath),
                  name: String(info?.name || ""),
                  isDir,
                  size: Number(info?.size || 0),
                  modifiedMs: parseModifiedMs(info?.modified),
                  mimetype: info?.mimetype ?? null,
                },
              ],
              { indexRunId: null },
            );

            success++;
            processed++;
            mountSummary.processedDirtyCount++;
            mountSummary.upsertedCount++;
            totalUpserted++;
            consumedKeys.push(key);
          } catch (error: any) {
            const msg = String(error?.message || error || "unknown error");
            const status = error?.status || error?.statusCode || error?.response?.status;
            // 不存在：视为 delete，并消费掉该 dirty
            if (status === 404) {
              try {
                if (isDirectoryPath(fsPath)) {
                  await store.deleteByPathPrefix(mountId, fsPath);
                } else {
                  await store.deleteEntry(mountId, fsPath);
                }
                success++;
                processed++;
                mountSummary.processedDirtyCount++;
                mountSummary.deletedCount++;
                totalDeleted++;
                consumedKeys.push(key);
                continue;
              } catch (secondary) {
                // fallthrough
              }
            }

            console.warn(
              `[FsIndexApplyDirtyTaskHandler] apply failed: mountId=${mountId}, op=${op}, path=${fsPath}, error=${msg}`,
            );
            failed++;
            processed++;
            mountSummary.processedDirtyCount++;
            mountSummary.failedCount++;
            // 失败时不消费该 dirty：保留以便下次重试（避免丢更新）
            itemResults.push({
              kind: "path",
              label: fsPath,
              sourcePath: fsPath,
              targetPath: "",
              status: "failed",
              error: msg,
            });
          }
        }

        if (consumedKeys.length > 0) {
          await store.deleteDirtyByKeys(consumedKeys);
        }

        await context.updateProgress(job.jobId, {
          totalItems: maxItems ?? 0,
          processedItems: processed,
          successCount: success,
          failedCount: failed,
          skippedCount: skipped,
          itemResults,
          currentMountId: mountId,
          lastBatch: rows.length,
          totalDirtyProcessed: processed,
          totalUpserted,
          totalDeleted,
        } as any);

        if (rows.length < take) {
          break;
        }
      }

      if (mountSummary.status === "processing") {
        mountSummary.status = mountSummary.failedCount > 0 ? "failed" : "success";
        mountSummary.durationMs = Date.now() - mountStartedAt;
        await context.updateProgress(job.jobId, {
          totalItems: maxItems ?? 0,
          processedItems: processed,
          successCount: success,
          failedCount: failed,
          skippedCount: skipped,
          itemResults,
          currentMountId: mountId,
          lastBatch: 0,
          totalDirtyProcessed: processed,
          totalUpserted,
          totalDeleted,
        } as any);
      }
    }

    console.log(
      `[FsIndexApplyDirtyTaskHandler] 作业结束: jobId=${job.jobId}, processed=${processed}, ok=${success}, failed=${failed}, skipped=${skipped}`,
    );
  }
}
