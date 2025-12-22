import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { ensureRepositoryFactory } from "../../utils/repositories.js";
import { ValidationError } from "../../http/errors.js";
import { UserType } from "../../constants/index.js";

/**
 * 定时重建 FS 搜索索引（只负责创建 job，不做重活）
 * - 作为“业务可选项”，系统不默认创建 scheduled_jobs 记录
 * - 管理员可在后台显式创建并启用此 scheduled job
 */
export class ScheduledFsIndexRebuildTask {
  constructor() {
    /** @type {string} 用于 ScheduledTaskRegistry && scheduled_jobs.handler_id */
    this.id = "scheduled_fs_index_rebuild";

    /** @type {string} */
    this.name = "FS 搜索索引重建";

    /** @type {string} */
    this.description =
      "按配置定期创建 fs_index_rebuild 作业，用于重建 FS 搜索索引（Index-only 搜索的写入侧）";

    /** @type {"maintenance" | "business"} */
    this.category = "business";

    /** @type {Array<object>} */
    this.configSchema = [
      {
        name: "mountIds",
        label: "挂载点ID列表（可选）",
        type: "textarea",
        defaultValue: "",
        required: false,
        description:
          "留空表示重建全部活跃挂载点；填写时可用逗号/空格/换行分隔多个 mountId。",
      },
      {
        name: "batchSize",
        label: "批量写入大小（可选）",
        type: "number",
        defaultValue: 200,
        required: false,
        min: 20,
        max: 1000,
        description: "单次 upsert 的批量大小；越大写入次数越少，但单批更重。",
      },
      {
        name: "maxDepth",
        label: "最大遍历深度（可选）",
        type: "number",
        defaultValue: "",
        required: false,
        min: 0,
        max: 1000,
        description:
          "从挂载根目录算起：0 表示只扫根目录本层；留空表示不限深度。",
      },
      {
        name: "maxMountsPerRun",
        label: "单次最多处理挂载点数（可选）",
        type: "number",
        defaultValue: "",
        required: false,
        min: 1,
        max: 10000,
        description:
          "用于控制单次作业规模，避免过多挂载点导致一次重建不可控；留空表示不限制。",
      },
    ];
  }

  /**
   * @private
   * @param {any} rawConfig
   */
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
    batchSize = Math.max(20, Math.min(1000, Math.trunc(batchSize)));

    const maxDepthRaw = config.maxDepth;
    let maxDepth = null;
    if (maxDepthRaw !== "" && maxDepthRaw !== null && maxDepthRaw !== undefined) {
      const parsed = Number(maxDepthRaw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new ValidationError("maxDepth 必须是 >=0 的整数或留空");
      }
      maxDepth = Math.trunc(parsed);
    }

    const maxMountsRaw = config.maxMountsPerRun;
    let maxMountsPerRun = null;
    if (maxMountsRaw !== "" && maxMountsRaw !== null && maxMountsRaw !== undefined) {
      const parsed = Number(maxMountsRaw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new ValidationError("maxMountsPerRun 必须是正整数或留空");
      }
      maxMountsPerRun = Math.trunc(parsed);
    }

    return {
      mountIds: mountIds.length > 0 ? mountIds : null,
      options: {
        batchSize,
        maxDepth,
        maxMountsPerRun,
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

    // 后台任务：使用管理员身份（管理员配置并启用）
    const systemUserId = "system-scheduled-fs-index";
    const systemUserType = UserType.ADMIN;

    const payload = {
      ...(normalized.mountIds ? { mountIds: normalized.mountIds } : {}),
      options: normalized.options,
    };

    const job = await fileSystem.createJob(
      "fs_index_rebuild",
      payload,
      systemUserId,
      systemUserType,
      { triggerType: "scheduled", triggerRef: ctx?.scheduledJobId || this.id },
    );

    const summaryParts = [
      "已创建 FS 索引重建作业",
      normalized.mountIds ? `mounts=${normalized.mountIds.length}` : "mounts=all",
      `batchSize=${normalized.options.batchSize}`,
      `maxDepth=${normalized.options.maxDepth ?? "∞"}`,
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
