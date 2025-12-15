import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { ensureRepositoryFactory } from "../../utils/repositories.js";
import { ValidationError } from "../../http/errors.js";
import { UserType } from "../../constants/index.js";

/**
 * 定时同步任务（基于 copy 作业的单向同步）
 * - 通过 ScheduledJobs 框架调度
 * - 通过 FS Job 系统创建 taskType = "copy" 的作业
 * - 不在 handler 内直接执行长时间复制
 */
export class ScheduledSyncCopyTask {
  constructor() {
    /** @type {string} 任务唯一标识（用于 ScheduledTaskRegistry && scheduled_jobs.handler_id） */
    this.id = "scheduled_sync_copy";

    /** @type {string} 任务显示名称 */
    this.name = "存储同步";

    /** @type {string} 任务描述 */
    this.description =
      "按配置定期创建跨驱动复制作业，实现单向同步（只复制新增/更新文件，不删除目标）";

    /** @type {\"maintenance\" | \"business\"} 任务类别 */
    this.category = "business";

    /**
     * 配置参数 Schema（供前端表单动态渲染）
     * @type {Array<{
     *   name: string,
     *   label: string,
     *   type: \"string\" | \"number\" | \"boolean\" | \"select\" | \"textarea\",
     *   defaultValue: any,
     *   required: boolean,
     *   min?: number,
     *   max?: number,
     *   options?: Array<{ value: any, label: string }>,
     *   description?: string
     * }>}
     */
    this.configSchema = [
      // 注意：sourcePath 和 targetPath 字段已由前端专用 UI 处理
      // 前端 SyncTaskConfigForm 组件会自动生成这些字段
      // 这里保留空数组，表示使用专用配置界面
    ];
  }

  /**
   * 解析配置，返回标准化的 { items, options, meta }
   * @private
   * @param {any} rawConfig
   */
  _normalizeConfig(rawConfig) {
    const config = rawConfig || {};

    // 显式拒绝非 copyNew 模式（为未来扩展 mirror 等模式预留）
    if (config.mode && config.mode !== "copyNew") {
      throw new ValidationError(
        `当前仅支持 mode=\"copyNew\" 的单向同步，不支持模式: ${String(
          config.mode,
        )}`,
      );
    }

    const items = [];
    const MAX_PAIRS_PER_RUN = 100;

    // 高级模式：config.pairs 数组
    if (Array.isArray(config.pairs) && config.pairs.length > 0) {
      for (const pair of config.pairs) {
        if (!pair || typeof pair.sourcePath !== "string" || typeof pair.targetPath !== "string") {
          continue;
        }
        if (!pair.sourcePath.trim() || !pair.targetPath.trim()) {
          continue;
        }
        items.push({
          sourcePath: pair.sourcePath.trim(),
          targetPath: pair.targetPath.trim(),
        });
        if (items.length >= MAX_PAIRS_PER_RUN) {
          break;
        }
      }
    } else if (config.sourcePath && config.targetPath) {
      // 简单模式：单 pair
      if (
        typeof config.sourcePath === "string" &&
        typeof config.targetPath === "string" &&
        config.sourcePath.trim() &&
        config.targetPath.trim()
      ) {
        items.push({
          sourcePath: config.sourcePath.trim(),
          targetPath: config.targetPath.trim(),
        });
      }
    }

    if (items.length === 0) {
      throw new ValidationError(
        "同步任务配置错误：请至少提供一组有效的 sourcePath/targetPath 或 pairs 数组。",
      );
    }

    const skipExisting =
      config.skipExisting === undefined ? true : Boolean(config.skipExisting);

    let maxConcurrency = Number(config.maxConcurrency) || 5;
    if (!Number.isFinite(maxConcurrency) || maxConcurrency <= 0) {
      maxConcurrency = 5;
    }
    if (maxConcurrency > 32) {
      maxConcurrency = 32;
    }

    const options = {
      skipExisting,
      maxConcurrency,
    };

    return {
      items,
      options,
      meta: {
        mode: "copyNew",
        pairsCount: items.length,
        truncated:
          Array.isArray(config.pairs) && config.pairs.length > MAX_PAIRS_PER_RUN,
      },
    };
  }

  /**
   * 执行同步任务：只负责创建 copy Job，不直接复制文件
   * @param {{ db: D1Database, env: any, now: string, config: any }} ctx
   */
  async run(ctx) {
    const { db, env, now, config } = ctx;

    const { items, options, meta } = this._normalizeConfig(config);

    // 构造 FileSystem（与 JobWorkflow 中的逻辑保持一致）
    const repositoryFactory = ensureRepositoryFactory(db);
    const mountManager = new MountManager(
      db,
      env?.ENCRYPTION_SECRET,
      repositoryFactory,
    );
    const fileSystem = new FileSystem(mountManager, env);

    // 内部系统身份：用于绕过基于 API Key 的挂载权限限制
    // 注意：Scheduled Sync 视为后台系统级操作，由管理员配置后启用
    const systemUserId = "system-scheduled-sync";
    const systemUserType = UserType.ADMIN; // 使用管理员身份，绕过挂载 ACL 限制

    const jobPayload = {
      items,
      options,
    };

    const job = await fileSystem.createJob(
      "copy",
      jobPayload,
      systemUserId,
      systemUserType,
    );

    const summaryParts = [
      // 面向管理员的人类可读摘要，避免暴露内部作业 ID 细节
      `已创建跨驱动同步作业（复制任务）`,
      `路径对数量=${items.length}`,
      options.skipExisting
        ? "同步模式=增量（仅复制新增/更新文件）"
        : "同步模式=全量（目标存在时尝试覆盖）",
      `作业内并发=${options.maxConcurrency}`,
      `copy 作业 ID=${job.jobId}`,
    ];
    if (meta.truncated) {
      summaryParts.push(
        "超过最大 pairs 数，本次已截断（部分路径未纳入本次同步）",
      );
    }

    return {
      summary: summaryParts.join("；"),
      jobId: job.jobId,
      jobIds: [job.jobId],
      mode: meta.mode,
      itemsCount: items.length,
      options,
      createdAt: new Date(now).toISOString(),
    };
  }
}
