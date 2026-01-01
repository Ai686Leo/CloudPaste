import { get, post, put, del } from "@/api/client";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("ScheduledJobService");

/**
 * @typedef {Object} ScheduledJob
 * @property {string} taskId - 作业ID（jobId，唯一标识此调度作业）
 * @property {string} [handlerId] - 任务处理器类型ID（Handler ID），对应后端 ScheduledTaskRegistry 中的 handler.id
 * @property {string} [name] - 作业名称（展示用）
 * @property {string|null} [description] - 作业描述/备注
 * @property {boolean} enabled - 是否启用
 * @property {"interval"|"cron"} scheduleType - 调度类型
 * @property {number} [intervalSec] - 执行间隔(秒)，仅 interval 模式有效
 * @property {string|null} [cronExpression] - Cron 表达式，仅 cron 模式有效
 * @property {number} [runCount] - 累计执行次数（成功/失败均计入）
 * @property {number} [failureCount] - 累计失败次数
 * @property {string|null} [lastRunStatus] - 最近一次执行状态 success/failure/skipped
 * @property {string|null} [lastRunStartedAt] - 最近一次执行开始时间(ISO格式)
 * @property {string|null} [lastRunFinishedAt] - 最近一次执行结束时间(ISO格式)
 * @property {string|null} nextRunAfter - 下次执行时间(ISO格式)
 * @property {string|null} lockUntil - 锁过期时间(ISO格式)
 * @property {"disabled"|"scheduled"|"pending"|"running"|"idle"} [runtimeState] - 当前运行状态
 * @property {Object} config - 任务配置参数
 * @property {string[]} [previewNextRuns] - 未来预览的执行时间列表（ISO字符串，最多5条）
 */

/**
 * @typedef {Object} ScheduledJobRun
 * @property {number} id - 运行记录ID
 * @property {string} taskId - 任务ID
 * @property {string} status - 执行状态 (success/failure/skipped)
 * @property {string} startedAt - 开始时间(ISO格式)
 * @property {string|null} finishedAt - 结束时间(ISO格式)
 * @property {number|null} durationMs - 执行耗时(毫秒)
 * @property {string|null} summary - 简要摘要
 * @property {string|null} errorMessage - 错误信息
 */

/**
 * @typedef {Object} FieldSchema
 * @property {string} name - 字段名
 * @property {string} label - 字段标签
 * @property {"string"|"number"|"boolean"|"select"|"textarea"} type - 字段类型
 * @property {any} defaultValue - 默认值
 * @property {boolean} required - 是否必填
 * @property {number} [min] - 最小值（number类型）
 * @property {number} [max] - 最大值（number类型）
 * @property {Array<{value: any, label: string}>} [options] - 选项（select类型）
 * @property {string} [description] - 字段描述
 */

/**
 * @typedef {Object} HandlerType
 * @property {string} id - Handler ID
 * @property {string} name - Handler 显示名称
 * @property {string} description - Handler 描述
 * @property {"maintenance"|"business"} category - Handler 类别
 * @property {FieldSchema[]} configSchema - 配置参数 Schema
 */

/**
 * 定时任务管理 Service
 * 
 * 封装定时任务相关的所有API调用
 */
export function useScheduledJobService() {
  /**
   * 获取定时任务列表
   * @param {{taskId?: string, enabled?: boolean}} [params] - 查询参数
   * @returns {Promise<{items: ScheduledJob[]}>}
   */
  const getScheduledJobs = async (params = {}) => {
    try {
      const resp = await get("/admin/scheduled/jobs", { params });
      
      if (!resp) {
        throw new Error("获取定时任务列表失败");
      }

      // 处理统一响应格式
      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "获取定时任务列表失败");
        }
        const items = resp.data?.items || resp.items || [];
        return { items };
      }

      // 直接返回数组或包含items的对象
      const items = Array.isArray(resp) ? resp : (resp.items || []);
      return { items };
    } catch (error) {
    log.error("[ScheduledJobService] 获取任务列表失败:", error);
      throw error;
    }
  };

  /**
   * 获取单个定时任务详情
   * @param {string} taskId - 任务ID
   * @returns {Promise<ScheduledJob>}
   */
  const getScheduledJob = async (taskId) => {
    try {
      const resp = await get(`/admin/scheduled/jobs/${taskId}`);
      
      if (!resp) {
        throw new Error("获取任务详情失败");
      }

      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "获取任务详情失败");
        }
        return resp.data || resp;
      }

      return resp;
    } catch (error) {
    log.error(`[ScheduledJobService] 获取任务详情失败 (${taskId}):`, error);
      throw error;
    }
  };

  /**
   * 创建定时任务
   * @param {{taskId?: string, handlerId: string, name?: string, description?: string, scheduleType?: "interval"|"cron", intervalSec?: number, cronExpression?: string, enabled?: boolean, config?: Object}} data - 任务数据
   * @returns {Promise<ScheduledJob>}
   */
  const createScheduledJob = async (data) => {
    try {
      const resp = await post("/admin/scheduled/jobs", data);
      
      if (!resp) {
        throw new Error("创建定时任务失败");
      }

      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "创建定时任务失败");
        }
        return resp.data || data;
      }

      return resp;
    } catch (error) {
    log.error("[ScheduledJobService] 创建任务失败:", error);
      throw error;
    }
  };

  /**
   * 更新定时任务
   * @param {string} taskId - 任务ID
   * @param {{scheduleType?: "interval"|"cron", intervalSec?: number, cronExpression?: string, enabled?: boolean, config?: Object, name?: string, description?: string, handlerId?: string}} data - 更新数据
   * @returns {Promise<ScheduledJob>}
   */
  const updateScheduledJob = async (taskId, data) => {
    try {
      const resp = await put(`/admin/scheduled/jobs/${taskId}`, data);
      
      if (!resp) {
        throw new Error("更新定时任务失败");
      }

      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "更新定时任务失败");
        }
        return resp.data || { taskId, ...data };
      }

      return resp;
    } catch (error) {
    log.error(`[ScheduledJobService] 更新任务失败 (${taskId}):`, error);
      throw error;
    }
  };

  /**
   * 删除定时任务
   * @param {string} taskId - 任务ID
   * @returns {Promise<boolean>}
   */
  const deleteScheduledJob = async (taskId) => {
    try {
      const resp = await del(`/admin/scheduled/jobs/${taskId}`);
      
      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "删除定时任务失败");
        }
      }

      return true;
    } catch (error) {
    log.error(`[ScheduledJobService] 删除任务失败 (${taskId}):`, error);
      throw error;
    }
  };

  /**
   * 获取任务执行历史记录
   * @param {string} taskId - 任务ID
   * @param {{limit?: number}} [params] - 查询参数
   * @returns {Promise<{items: ScheduledJobRun[]}>}
   */
  const getScheduledJobRuns = async (taskId, params = {}) => {
    try {
      const resp = await get(`/admin/scheduled/jobs/${taskId}/runs`, { params });
      
      if (!resp) {
        throw new Error("获取执行历史失败");
      }

      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "获取执行历史失败");
        }
        const items = resp.data?.items || resp.items || [];
        return { items };
      }

      const items = Array.isArray(resp) ? resp : (resp.items || []);
      return { items };
    } catch (error) {
    log.error(`[ScheduledJobService] 获取执行历史失败 (${taskId}):`, error);
      throw error;
    }
  };

  /**
   * 切换任务启用状态
   * @param {string} taskId - 任务ID
   * @param {boolean} enabled - 是否启用
   * @returns {Promise<ScheduledJob>}
   */
  const toggleScheduledJob = async (taskId, enabled) => {
    return updateScheduledJob(taskId, { enabled });
  };

  // ==================== Handler 类型 API ====================

  /**
   * 获取所有 handler 类型列表
   * @returns {Promise<{items: HandlerType[]}>}
   */
  const getHandlerTypes = async () => {
    try {
      const resp = await get("/admin/scheduled/types");

      if (!resp) {
        throw new Error("获取handler类型列表失败");
      }

      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "获取handler类型列表失败");
        }
        const items = resp.data?.items || resp.items || [];
        return { items };
      }

      const items = Array.isArray(resp) ? resp : (resp.items || []);
      return { items };
    } catch (error) {
    log.error("[ScheduledJobService] 获取handler类型列表失败:", error);
      throw error;
    }
  };

  /**
   * 获取单个 handler 类型详情
   * @param {string} taskId - Handler ID
   * @returns {Promise<HandlerType>}
   */
  const getHandlerType = async (taskId) => {
    try {
      const resp = await get(`/admin/scheduled/types/${taskId}`);

      if (!resp) {
        throw new Error("获取handler类型详情失败");
      }

      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "获取handler类型详情失败");
        }
        return resp.data || resp;
      }

      return resp;
    } catch (error) {
    log.error(`[ScheduledJobService] 获取handler类型详情失败 (${taskId}):`, error);
      throw error;
    }
  };

  /**
   * 立即执行定时任务
   * @param {string} taskId - 任务ID
   * @returns {Promise<Object>}
   */
  const runScheduledJobNow = async (taskId) => {
    try {
      const resp = await post(`/admin/scheduled/jobs/${taskId}/run`);

      if (!resp) {
        throw new Error("执行任务失败");
      }

      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "执行任务失败");
        }
        return resp.data || resp;
      }

      return resp;
    } catch (error) {
    log.error(`[ScheduledJobService] 执行任务失败 (${taskId}):`, error);
      throw error;
    }
  };

  /**
   * 获取按小时统计的执行数据
   * @param {number} windowHours - 时间窗口（小时数，默认24）
   * @returns {Promise<{windowHours: number, buckets: Array}>}
   */
  const getHourlyAnalytics = async (windowHours = 24) => {
    try {
      const resp = await get('/admin/scheduled/analytics', { 
        params: { windowHours } 
      });
      
      if (!resp) {
        throw new Error('获取统计数据失败');
      }

      // 处理统一响应格式
      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "获取统计数据失败");
        }
        return resp.data || resp;
      }
      
      return resp;
    } catch (error) {
    log.error('[ScheduledJobService] 获取按小时统计数据失败:', error);
      throw error;
    }
  };

  /**
   * 获取“平台触发器 tick”的状态
   * - Cloudflare Workers：cron 来自实际触发 scheduled() 的 controller.cron
   * - Docker/Node：cron 来自环境变量 SCHEDULED_TICK_CRON（默认每分钟一次）
   *
   * @returns {Promise<{
   *   now: string,
   *   runtime: 'cloudflare' | 'docker',
   *   cron: { active: string|null, source: string, configured: string|null, lastSeen: string|null, cloudflareApi: string[]|null, cloudflareApiError: string|null },
   *   lastTick: { taskId: string, at: string|null, source: string|null, scheduledTimeMs: number|null },
   *   nextTick: { at: string|null, cronParseError: string|null },
   *   note?: string|null
   * }>}
   */
  const getSchedulerTicker = async () => {
    try {
      const resp = await get("/admin/scheduled/ticker");

      if (!resp) {
        throw new Error("获取触发器状态失败");
      }

      if (typeof resp === "object" && "success" in resp) {
        if (!resp.success) {
          throw new Error(resp.message || "获取触发器状态失败");
        }
        return resp.data || resp;
      }

      return resp;
    } catch (error) {
    log.error("[ScheduledJobService] 获取触发器状态失败:", error);
      throw error;
    }
  };

  return {
    getScheduledJobs,
    getScheduledJob,
    createScheduledJob,
    updateScheduledJob,
    deleteScheduledJob,
    getScheduledJobRuns,
    getHourlyAnalytics,
    getSchedulerTicker,
    toggleScheduledJob,
    runScheduledJobNow,
    getHandlerTypes,
    getHandlerType,
  };
}
