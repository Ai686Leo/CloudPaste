import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { ensureRepositoryFactory } from "../../utils/repositories.js";
import { ValidationError } from "../../http/errors.js";
import { UserType } from "../../constants/index.js";

/**
 * 定时应用 FS 搜索索引 dirty（只负责创建 job，不做重活）
 * - 作为“业务可选项”，系统不默认创建 scheduled_jobs 记录
 */
export class ScheduledFsIndexApplyDirtyTask {
  constructor() {
    this.id = "scheduled_fs_index_apply_dirty";
    this.name = "FS 搜索索引增量应用（dirty）";
    this.description = "按配置定期创建 fs_index_apply_dirty 作业，消费 dirty 队列以更新索引";
    this.category = "business";
    this.configSchema = [
      {
        name: "mountIds",
        label: "挂载点ID列表（可选）",
        type: "textarea",
        defaultValue: "",
        required: false,
        description: "留空表示消费全部 mount 的 dirty；填写可用逗号/空格/换行分隔。",
      },
      {
        name: "batchSize",
        label: "单次拉取 dirty 数量（可选）",
        type: "number",
        defaultValue: 200,
        required: false,
        min: 10,
        max: 2000,
        description: "单次从 dirty 表拉取的最大条数。",
      },
      {
        name: "maxItems",
        label: "单次作业最大处理条数（可选）",
        type: "number",
        defaultValue: "",
        required: false,
        min: 1,
        max: 100000,
        description: "用于限制单次作业规模；留空表示不限制。",
      },
      {
        name: "rebuildDirectorySubtree",
        label: "目录变更递归重建子树",
        type: "boolean",
        defaultValue: true,
        required: false,
        description: "目录 upsert 时是否递归扫描该目录子树（用于处理目录 rename/move 等结构性变更）。",
      },
      {
        name: "maxDepth",
        label: "目录子树最大深度（可选）",
        type: "number",
        defaultValue: "",
        required: false,
        min: 0,
        max: 1000,
        description: "相对 dirty 目录的最大扫描深度；留空表示不限制。",
      },
    ];
  }

  _normalizeConfig(rawConfig) {
    const config = rawConfig || {};

    const mountIdsText = typeof config.mountIds === "string" ? config.mountIds : "";
    const mountIds = mountIdsText
      .split(/[\s,]+/g)
      .map((x) => x.trim())
      .filter(Boolean);

    const batchSizeRaw = config.batchSize;
    let batchSize = Number(batchSizeRaw);
    if (!Number.isFinite(batchSize) || batchSize <= 0) {
      batchSize = 200;
    }
    batchSize = Math.max(10, Math.min(2000, Math.trunc(batchSize)));

    const maxItemsRaw = config.maxItems;
    let maxItems = null;
    if (maxItemsRaw !== "" && maxItemsRaw !== null && maxItemsRaw !== undefined) {
      const parsed = Number(maxItemsRaw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new ValidationError("maxItems 必须是正整数或留空");
      }
      maxItems = Math.trunc(parsed);
    }

    const rebuildDirectorySubtree = config.rebuildDirectorySubtree !== false;

    const maxDepthRaw = config.maxDepth;
    let maxDepth = null;
    if (maxDepthRaw !== "" && maxDepthRaw !== null && maxDepthRaw !== undefined) {
      const parsed = Number(maxDepthRaw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new ValidationError("maxDepth 必须是 >=0 的整数或留空");
      }
      maxDepth = Math.trunc(parsed);
    }

    return {
      mountIds: mountIds.length > 0 ? mountIds : null,
      options: {
        batchSize,
        maxItems,
        rebuildDirectorySubtree,
        maxDepth,
        refresh: true,
      },
    };
  }

  /**
   * @param {{ db: D1Database, env: any, now: string, config: any, scheduledJobId?: string }} ctx
   */
  async run(ctx) {
    const { db, env, now, config } = ctx;
    const normalized = this._normalizeConfig(config);

    const repositoryFactory = ensureRepositoryFactory(db);
    const mountManager = new MountManager(db, env?.ENCRYPTION_SECRET, repositoryFactory, { env });
    const fileSystem = new FileSystem(mountManager, env);

    const systemUserId = "system-scheduled-fs-index";
    const systemUserType = UserType.ADMIN;

    const payload = {
      ...(normalized.mountIds ? { mountIds: normalized.mountIds } : {}),
      options: normalized.options,
    };

    const job = await fileSystem.createJob(
      "fs_index_apply_dirty",
      payload,
      systemUserId,
      systemUserType,
      { triggerType: "scheduled", triggerRef: ctx?.scheduledJobId || this.id },
    );

    const summaryParts = [
      "已创建 FS 索引 dirty 应用作业",
      normalized.mountIds ? `mounts=${normalized.mountIds.length}` : "mounts=all",
      `batchSize=${normalized.options.batchSize}`,
      `maxItems=${normalized.options.maxItems ?? "∞"}`,
      `jobId=${job.jobId}`,
    ];

    return {
      summary: summaryParts.join("；"),
      jobId: job.jobId,
      jobIds: [job.jobId],
      createdAt: new Date(now).toISOString(),
    };
  }
}
