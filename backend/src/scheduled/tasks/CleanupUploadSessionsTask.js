import { DbTables } from "../../constants/index.js";

/**
 * 清理 upload_sessions 会话记录的后台任务
 * - 标记明显过期的 active 会话为 expired
 * - 删除超出保留窗口的历史会话（completed/aborted/error/expired）
 *
 * 生命周期约定（只针对本地 upload_sessions 表）：
 * - expires_at：代表“应用侧认为的会话过期时间”
 *   - OneDrive 场景下通常映射自 Graph uploadSession.expirationDateTime
 *   - 其他驱动（S3 / Google Drive 等）可能为空，由 activeGraceHours + updated_at 推导“长时间未更新的活跃会话”
 * - 本任务只负责清理本地会话记录，不保证云端 Provider 资源一定已被释放
 *   （例如 S3 multipart upload 的真正清理由生命周期策略或专用脚本负责）
 */
export class CleanupUploadSessionsTask {
  constructor() {
    /** @type {string} 任务唯一标识 */
    this.id = "cleanup_upload_sessions";

    /** @type {string} 任务显示名称 */
    this.name = "清理分片上传会话";

    /** @type {string} 任务描述 */
    this.description =
      "定期清理本地分片上传会话记录";

    /** @type {"maintenance" | "business"} 任务类别 */
    this.category = "maintenance";

    /**
     * 配置参数 Schema
     * @type {Array<{
     *   name: string,
     *   label: string,
     *   type: "string" | "number" | "boolean" | "select" | "textarea",
     *   defaultValue: any,
     *   required: boolean,
     *   min?: number,
     *   max?: number,
     *   description?: string
     * }>}
     */
    this.configSchema = [
      {
        name: "keepDays",
        label: "历史记录保留天数",
        type: "number",
        defaultValue: 30,
        required: true,
        min: 1,
        max: 365,
        description:
          "保留多少天内的数据；超出该天数的历史记录将从本地数据库中删除。",
      },
      {
        name: "activeGraceHours",
        label: "活跃会话最大空闲时长（小时）",
        type: "number",
        defaultValue: 24,
        required: true,
        min: 1,
        max: 168,
        description:
          "对于仍处于 active 状态在该时长内没有任何更新，则视为已失效并标记为过期。",
      },
    ];
  }

  /**
   * 执行清理逻辑
   * @param {{ db: D1Database, env: any, now: string, config: any }} ctx
   */
  async run(ctx) {
    const { db, now, config } = ctx;

    // 始终提供默认值，兼容旧配置和缺失字段
    const keepDays = Number(config.keepDays) > 0 ? Number(config.keepDays) : 30;
    const activeGraceHours =
      Number(config.activeGraceHours) > 0 ? Number(config.activeGraceHours) : 24;

    const nowDate = new Date(now);
    const nowMs = nowDate.getTime();

    // 计算时间窗口
    const activeGraceMs = activeGraceHours * 60 * 60 * 1000;
    const activeStaleThresholdIso = new Date(nowMs - activeGraceMs).toISOString();
    const keepMs = keepDays * 24 * 60 * 60 * 1000;
    const historyThresholdIso = new Date(nowMs - keepMs).toISOString();

    const getChanges = (result) => {
      if (!result) return 0;
      if (typeof result.meta?.changes === "number") return result.meta.changes;
      if (typeof result.changes === "number") return result.changes;
      return 0;
    };

    // 工具函数：统计当前 upload_sessions 各状态数量，方便日志观测
    const readStatusCounts = async () => {
      const row = await db
        .prepare(
          `
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
            SUM(CASE WHEN status = 'aborted' THEN 1 ELSE 0 END) AS aborted_count,
            SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
            SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired_count
          FROM ${DbTables.UPLOAD_SESSIONS}
        `,
        )
        .first();

      return {
        total: Number(row?.total) || 0,
        active: Number(row?.active_count) || 0,
        completed: Number(row?.completed_count) || 0,
        aborted: Number(row?.aborted_count) || 0,
        error: Number(row?.error_count) || 0,
        expired: Number(row?.expired_count) || 0,
      };
    };

    // 清理前统计一次当前会话分布，方便后续在日志中观察整体趋势
    const beforeCounts = await readStatusCounts();

    // 1) 标记明显过期的 active 会话为 expired
    // 1.1 expires_at 非空且早于当前时间的会话
    const expireByExpiresAtResult = await db
      .prepare(
        `
        UPDATE ${DbTables.UPLOAD_SESSIONS}
        SET status = 'expired', updated_at = ?
        WHERE status = 'active'
          AND expires_at IS NOT NULL
          AND expires_at < ?
      `,
      )
      .bind(now, now)
      .run();

    // 1.2 expires_at 为空且长时间未更新的 active 会话
    const expireByStaleActiveResult = await db
      .prepare(
        `
        UPDATE ${DbTables.UPLOAD_SESSIONS}
        SET status = 'expired', updated_at = ?
        WHERE status = 'active'
          AND expires_at IS NULL
          AND updated_at < ?
      `,
      )
      .bind(now, activeStaleThresholdIso)
      .run();

    // 2) 删除历史会话（非 active 且更新时间早于保留窗口）
    // 说明：
    const deleteHistoryResult = await db
      .prepare(
        `
        DELETE FROM ${DbTables.UPLOAD_SESSIONS}
        WHERE status IN ('completed','aborted','error','expired')
          AND updated_at < ?
      `,
      )
      .bind(historyThresholdIso)
      .run();

    const expiredByExpiresAt = getChanges(expireByExpiresAtResult);
    const expiredByStaleActive = getChanges(expireByStaleActiveResult);
    const deletedHistory = getChanges(deleteHistoryResult);
    const expiredTotal = expiredByExpiresAt + expiredByStaleActive;

    // 清理后再统计一次，便于对比前后变化
    const afterCounts = await readStatusCounts();

    const summaryParts = [
      `标记过期会话 ${expiredTotal} 条`,
      `删除历史会话 ${deletedHistory} 条`,
    ];

    const summary = summaryParts.join("，");


    return {
      summary,
      // 清理结束后 upload_sessions 表的总记录数，便于在前端或日志中快速查看当前规模
      totalSessions: afterCounts.total,
      stats: {
        before: beforeCounts,
        after: afterCounts,
        expiredByExpiresAt,
        expiredByStaleActive,
        deletedHistory,
        keepDays,
        activeGraceHours,
      },
    };
  }
}
