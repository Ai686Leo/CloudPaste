import { DbTables } from "../../constants/index.js";

/**
 * 清理 upload_sessions 会话记录的后台任务
 * - 标记明显过期的 initiated/uploading 会话为 expired
 * - 删除超出保留窗口的历史会话（completed/aborted/error/expired）
 *
 * 生命周期约定（只针对本地 upload_sessions 表）：
 * - expires_at：代表“应用侧认为的会话过期时间”
 *   - OneDrive 场景下通常映射自 Graph uploadSession.expirationDateTime
 *   - 其他驱动（S3 / Google Drive 等）可能为空，由 activeGraceHours + updated_at 推导“长时间未更新的进行中会话”
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
          "对于仍处于 initiated/uploading 状态在该时长内没有任何更新，则视为已失效并标记为过期。",
      },
      {
        name: "deleteBatchSize",
        label: "删除批次大小",
        type: "number",
        defaultValue: 200,
        required: false,
        min: 50,
        max: 500,
        description: "每次最多删除多少条历史会话（以及关联的 upload_parts），避免一次性删除过重。",
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
    const deleteBatchSize =
      Number(config.deleteBatchSize) > 0 ? Math.min(Number(config.deleteBatchSize), 500) : 200;

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
            SUM(CASE WHEN status = 'initiated' THEN 1 ELSE 0 END) AS initiated_count,
            SUM(CASE WHEN status = 'uploading' THEN 1 ELSE 0 END) AS uploading_count,
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
        initiated: Number(row?.initiated_count) || 0,
        uploading: Number(row?.uploading_count) || 0,
        completed: Number(row?.completed_count) || 0,
        aborted: Number(row?.aborted_count) || 0,
        error: Number(row?.error_count) || 0,
        expired: Number(row?.expired_count) || 0,
      };
    };

    // 清理前统计一次当前会话分布，方便后续在日志中观察整体趋势
    const beforeCounts = await readStatusCounts();

    // 1) 标记明显过期的 initiated/uploading 会话为 expired
    // 1.1 expires_at 非空且早于当前时间的会话
    const expireByExpiresAtResult = await db
      .prepare(
        `
        UPDATE ${DbTables.UPLOAD_SESSIONS}
        SET status = 'expired', updated_at = ?
        WHERE status IN ('initiated','uploading')
          AND expires_at IS NOT NULL
          AND expires_at < ?
      `,
      )
      .bind(now, now)
      .run();

    // 1.2 expires_at 为空且长时间未更新的 initiated/uploading 会话
    const expireByStaleActiveResult = await db
      .prepare(
        `
        UPDATE ${DbTables.UPLOAD_SESSIONS}
        SET status = 'expired', updated_at = ?
        WHERE status IN ('initiated','uploading')
          AND expires_at IS NULL
          AND updated_at < ?
      `,
      )
      .bind(now, activeStaleThresholdIso)
      .run();

    // 2) 删除历史会话（completed/aborted/error/expired 且更新时间早于保留窗口）
    // 说明：
    // - 必须连带清理 upload_parts（临时分片记录），避免留下“垃圾分片”
    // - 删除必须分批（bounded/batched），避免一次性 IN 参数过大或单次 DELETE 过重
    let deletedHistory = 0;
    let deletedHistoryBatches = 0;
    let deletedPartsTotal = 0;

    const pickDeleteCandidates = async () => {
      const res = await db
        .prepare(
          `
          SELECT id
          FROM ${DbTables.UPLOAD_SESSIONS}
          WHERE status IN ('completed','aborted','error','expired')
            AND updated_at < ?
          LIMIT ?
        `,
        )
        .bind(historyThresholdIso, deleteBatchSize)
        .all();
      return (res?.results || []).map((r) => r?.id).filter(Boolean);
    };

    while (true) {
      const ids = await pickDeleteCandidates();
      if (ids.length === 0) break;

      deletedHistoryBatches += 1;
      const placeholders = ids.map(() => "?").join(", ");

      // 2.1 先删 upload_parts
      const delPartsRes = await db
        .prepare(
          `
          DELETE FROM ${DbTables.UPLOAD_PARTS}
          WHERE upload_id IN (${placeholders})
        `,
        )
        .bind(...ids)
        .run();
      deletedPartsTotal += getChanges(delPartsRes);

      // 2.2 再删 upload_sessions
      const delSessionsRes = await db
        .prepare(
          `
          DELETE FROM ${DbTables.UPLOAD_SESSIONS}
          WHERE id IN (${placeholders})
        `,
        )
        .bind(...ids)
        .run();
      deletedHistory += getChanges(delSessionsRes);
    }

    const expiredByExpiresAt = getChanges(expireByExpiresAtResult);
    const expiredByStaleActive = getChanges(expireByStaleActiveResult);
    const expiredTotal = expiredByExpiresAt + expiredByStaleActive;

    // 清理后再统计一次，便于对比前后变化
    const afterCounts = await readStatusCounts();

    // 3)（兜底）一致性自检：统计 orphan upload_parts（upload_id 不存在对应 upload_session）
    // 说明：这里先只做统计 + 日志观测，不做强制删除，避免误删导致排查困难
    const orphanRow = await db
      .prepare(
        `
        SELECT COUNT(*) AS cnt
        FROM ${DbTables.UPLOAD_PARTS} p
        WHERE NOT EXISTS (
          SELECT 1 FROM ${DbTables.UPLOAD_SESSIONS} s WHERE s.id = p.upload_id
        )
      `,
      )
      .first();
    const orphanParts = Number(orphanRow?.cnt) || 0;

    const summaryParts = [
      `标记过期会话 ${expiredTotal} 条`,
      `删除历史会话 ${deletedHistory} 条（分 ${deletedHistoryBatches} 批）`,
      `连带清理 upload_parts ${deletedPartsTotal} 条`,
      `orphan upload_parts ${orphanParts} 条`,
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
