import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";
import { useScheduledJobService } from "@/modules/admin/services/scheduledJobService";

/**
 * 定时任务管理 Composable
 * 
 * 提供定时任务的CRUD操作、状态管理和执行历史查询
 */
export function useScheduledJobs() {
  const { t } = useI18n();
  const service = useScheduledJobService();
  const { showSuccess, showError } = useGlobalMessage();

  // 状态管理
  const jobs = ref([]);
  const currentJob = ref(null);
  const jobRuns = ref([]);
  const loading = ref(false);
  const runsLoading = ref(false);

  // 行级加载状态：正在执行的任务 ID 集合
  const runningJobIds = ref(new Set());

  // Handler 类型状态
  const handlerTypes = ref([]);
  const handlerTypesLoading = ref(false);

  // 平台触发器（Cloudflare/Docker）的状态：用于展示“下一次触发倒计时”
  const schedulerTicker = ref(null);
  const schedulerTickerLoading = ref(false);

  // 详情对话框状态
  const showDetailDialog = ref(false);

  // 筛选状态
  const enabledFilter = ref("all"); // 'all' | 'enabled' | 'disabled'

  /**
   * 筛选后的任务列表
   */
  const filteredJobs = computed(() => {
    if (enabledFilter.value === "all") {
      return jobs.value;
    }
    const isEnabled = enabledFilter.value === "enabled";
    return jobs.value.filter((job) => job.enabled === isEnabled);
  });

  /**
   * 加载任务列表
   */
  const loadJobs = async (params = {}, options = {}) => {
    const { silent = false, showErrorOnCatch = true } = options || {};

    if (!silent) {
      loading.value = true;
    }
    try {
      const { items } = await service.getScheduledJobs(params);
      jobs.value = items;
      return items;
    } catch (error) {
      if (showErrorOnCatch) {
        showError(error.message || t("admin.scheduledJobs.loadFailed"));
      }
      throw error;
    } finally {
      if (!silent) {
        loading.value = false;
      }
    }
  };

  /**
   * 加载单个任务详情
   */
  const loadJob = async (taskId) => {
    loading.value = true;
    try {
      const job = await service.getScheduledJob(taskId);
      currentJob.value = job;
      return job;
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.loadDetailFailed"));
      throw error;
    } finally {
      loading.value = false;
    }
  };

  /**
   * 创建任务
   */
  const createJob = async (data) => {
    loading.value = true;
    try {
      const created = await service.createScheduledJob(data);
      showSuccess(t("admin.scheduledJobs.createSuccess"));
      // 不在这里刷新列表，由调用方决定何时刷新
      return created;
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.createFailed"));
      throw error;
    } finally {
      loading.value = false;
    }
  };

  /**
   * 更新任务
   */
  const updateJob = async (taskId, data) => {
    loading.value = true;
    try {
      const updated = await service.updateScheduledJob(taskId, data);
      showSuccess(t("admin.scheduledJobs.updateSuccess"));
      // 不在这里刷新列表，由调用方决定何时刷新
      return updated;
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.updateFailed"));
      throw error;
    } finally {
      loading.value = false;
    }
  };

  /**
   * 删除任务（确认对话框由调用方处理）
   */
  const deleteJob = async (taskId) => {
    loading.value = true;
    try {
      await service.deleteScheduledJob(taskId);
      showSuccess(t("admin.scheduledJobs.deleteSuccess"));
      await loadJobs(); // 刷新列表
      return true;
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.deleteFailed"));
      throw error;
    } finally {
      loading.value = false;
    }
  };

  /**
   * 切换任务启用状态
   */
  const toggleJobEnabled = async (taskId, enabled) => {
    loading.value = true;
    try {
      await service.toggleScheduledJob(taskId, enabled);
      const statusText = enabled
        ? t("admin.scheduledJobs.status.enabled")
        : t("admin.scheduledJobs.status.disabled");
      showSuccess(t("admin.scheduledJobs.toggleSuccess", { status: statusText }));
      await loadJobs(); // 刷新列表
      return true;
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.toggleFailed"));
      throw error;
    } finally {
      loading.value = false;
    }
  };

  /**
   * 立即执行任务（行级加载状态，不影响全局 loading）
   */
  const runJobNow = async (taskId) => {
    // 添加到正在运行集合
    runningJobIds.value = new Set([...runningJobIds.value, taskId]);
    try {
      const result = await service.runScheduledJobNow(taskId);
      if (result.status === "success") {
        showSuccess(t("admin.scheduledJobs.runNowSuccess"));
      } else {
        showError(result.errorMessage || t("admin.scheduledJobs.runNowFailed"));
      }
      // 不在这里刷新列表，由调用方决定何时刷新
      return result;
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.runNowFailed"));
      throw error;
    } finally {
      // 从正在运行集合中移除
      const newSet = new Set(runningJobIds.value);
      newSet.delete(taskId);
      runningJobIds.value = newSet;
    }
  };

  /**
   * 加载任务执行历史
   */
  const loadJobRuns = async (taskId, params = {}) => {
    runsLoading.value = true;
    try {
      const { items } = await service.getScheduledJobRuns(taskId, params);
      jobRuns.value = items;
      return items;
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.loadRunsFailed"));
      throw error;
    } finally {
      runsLoading.value = false;
    }
  };

  /**
   * 加载按小时统计的执行数据
   */
  const loadHourlyAnalytics = async (windowHours = 24) => {
    try {
      return await service.getHourlyAnalytics(windowHours);
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.loadAnalyticsFailed"));
      throw error;
    }
  };

  /**
   * 加载“平台触发器”的状态（cron + 下次触发时间）
   */
  const loadSchedulerTicker = async (options = {}) => {
    const { silent = false, showErrorOnCatch = true } = options || {};

    if (!silent) {
      schedulerTickerLoading.value = true;
    }
    try {
      const data = await service.getSchedulerTicker();
      schedulerTicker.value = data;
      return data;
    } catch (error) {
      if (showErrorOnCatch) {
        showError(error.message || t("admin.scheduledJobs.ticker.loadFailed"));
      }
      throw error;
    } finally {
      if (!silent) {
        schedulerTickerLoading.value = false;
      }
    }
  };



  // ==================== Handler 类型方法 ====================

  /**
   * 加载所有 handler 类型列表
   */
  const loadHandlerTypes = async () => {
    handlerTypesLoading.value = true;
    try {
      const { items } = await service.getHandlerTypes();
      handlerTypes.value = items;
      return items;
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.loadHandlerTypesFailed"));
      throw error;
    } finally {
      handlerTypesLoading.value = false;
    }
  };

  /**
   * 获取单个 handler 类型详情
   * @param {string} taskId - Handler ID
   */
  const loadHandlerType = async (taskId) => {
    try {
      return await service.getHandlerType(taskId);
    } catch (error) {
      showError(error.message || t("admin.scheduledJobs.loadHandlerTypeFailed"));
      throw error;
    }
  };

  /**
   * 根据 taskId 从已加载的 handlerTypes 中查找
   * @param {string} taskId - Handler ID
   */
  const getHandlerTypeById = (taskId) => {
    return handlerTypes.value.find((h) => h.id === taskId) || null;
  };

  /**
   * 格式化时间间隔为人类可读格式
   */
  const formatInterval = (seconds) => {
    if (!seconds) return "-";

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours}${t("common.hour")}`);
    if (minutes > 0) parts.push(`${minutes}${t("common.minute")}`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}${t("common.second")}`);

    return `每隔${parts.join("")}`;
  };

  /**
   * 格式化调度配置（interval/cron）
   * @param {ScheduledJob} job
   */
  const formatSchedule = (job) => {
    if (!job) return "-";
    const type = (job.scheduleType || "interval").toLowerCase();

    let base = "-";

    if (type === "interval") {
      base = formatInterval(Number(job.intervalSec) || 0);
    } else if (type === "cron") {
      base = job.cronExpression || "-";
    }

    return base;
  };

  /**
   * 判断任务是否正在执行
   * @param {string} taskId - 任务 ID
   */
  const isJobRunning = (taskId) => {
    return runningJobIds.value.has(taskId);
  };

  return {
    // 状态
    jobs,
    currentJob,
    jobRuns,
    loading,
    runsLoading,
    filteredJobs,
    enabledFilter,

    // 行级加载状态
    runningJobIds,
    isJobRunning,

    // Handler 类型状态
    handlerTypes,
    handlerTypesLoading,

    // 平台触发器状态
    schedulerTicker,
    schedulerTickerLoading,

    // 对话框状态
    showDetailDialog,

    // 方法
    loadJobs,
    loadJob,
    createJob,
    updateJob,
    deleteJob,
    toggleJobEnabled,
    runJobNow,
    loadJobRuns,
    loadHourlyAnalytics,
    loadSchedulerTicker,

    // Handler 类型方法
    loadHandlerTypes,
    loadHandlerType,
    getHandlerTypeById,

    // 工具方法
    formatSchedule,
    formatInterval,
  };
}
