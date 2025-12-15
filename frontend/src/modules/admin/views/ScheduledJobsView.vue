<script setup>
import { ref, computed, onMounted, onUnmounted, h } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useScheduledJobs } from "@/modules/admin/composables/useScheduledJobs";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useConfirmDialog } from "@/composables/core/useConfirmDialog.js";
import { formatDateTime, formatDateTimeWithSeconds } from "@/utils/timeUtils.js";
import AdminTable from "@/components/common/AdminTable.vue";
import ConfirmDialog from "@/components/common/dialogs/ConfirmDialog.vue";
import ScheduledJobDetailModal from "@/modules/admin/components/ScheduledJobDetailModal.vue";

const { t } = useI18n();
const router = useRouter();
const { isDarkMode: darkMode } = useThemeMode();

// 全局时钟：用于实时更新相对时间显示（倒计时）
const currentTick = ref(0);
let tickTimer = null;

onMounted(async () => {
  // 启动全局时钟，每秒更新一次（用于倒计时实时显示）
  tickTimer = setInterval(() => {
    currentTick.value++;
  }, 1000);
  
  // 加载页面配置
  loadSettings();
  
  // 初始化数据加载
  await Promise.all([loadJobs(), loadHandlerTypes(), loadAnalytics()]);
});

onUnmounted(() => {
  // 清理全局时钟定时器
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
});

// 确认对话框
const { dialogState, confirm, handleConfirm, handleCancel } = useConfirmDialog();

const confirmFn = async ({ title, message, confirmType }) => {
  return await confirm({
    title,
    message,
    confirmType,
    confirmText: t("common.dialogs.deleteButton"),
    darkMode: darkMode.value,
  });
};

const {
  jobs, currentJob, jobRuns, loading, runsLoading, filteredJobs, enabledFilter,
  handlerTypes, showDetailDialog,
  loadJobs, toggleJobEnabled, deleteJob, runJobNow, loadJobRuns, loadHandlerTypes,
  formatSchedule, formatInterval,
  loadHourlyAnalytics,
} = useScheduledJobs();

// 路由导航函数
const navigateToCreate = () => {
  router.push({ name: 'AdminScheduledJobCreate' });
};

const navigateToEdit = (job) => {
  router.push({ name: 'AdminScheduledJobEdit', params: { id: job.taskId } });
};

// 搜索和选择状态
const searchQuery = ref("");
const selectedJobs = ref([]);

// 显示的任务列表（搜索过滤）
const displayedJobs = computed(() => {
  if (!searchQuery.value) return filteredJobs.value;
  const query = searchQuery.value.toLowerCase();
  return filteredJobs.value.filter((job) => job.taskId.toLowerCase().includes(query));
});

// 选择处理
const handleSelectionChange = ({ type, id, item }) => {
  if (type === "toggle-all") {
    if (selectedJobs.value.length === displayedJobs.value.length) {
      selectedJobs.value = [];
    } else {
      selectedJobs.value = displayedJobs.value.map(job => job.taskId);
    }
  } else if (type === "toggle-item") {
    const index = selectedJobs.value.indexOf(id);
    if (index > -1) {
      selectedJobs.value.splice(index, 1);
    } else {
      selectedJobs.value.push(id);
    }
  }
};

// 页面配置管理（统一的 localStorage 存储）
const SETTINGS_KEY = 'scheduled-jobs-settings';

// 默认配置
const defaultSettings = {
  statsCollapsed: false,
  // 扩展更多配置：
};

// 页面配置状态
const settings = ref({ ...defaultSettings });

// 折叠状态（从统一配置中读取）
const isStatsCollapsed = computed({
  get: () => settings.value.statsCollapsed,
  set: (value) => {
    settings.value.statsCollapsed = value;
    saveSettings();
  }
});

// 从 localStorage 加载配置
const loadSettings = () => {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      settings.value = { ...defaultSettings, ...parsed };
    }
  } catch (error) {
    console.warn('加载定时任务页面配置失败:', error);
    settings.value = { ...defaultSettings };
  }
};

// 保存配置到 localStorage
const saveSettings = () => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.value));
  } catch (error) {
    console.warn('保存定时任务页面配置失败:', error);
  }
};

// 统计数据（实时更新版本）
const stats = computed(() => {
  // 触发响应式依赖，让统计数据每秒更新
  const _ = currentTick.value;
  
  const total = jobs.value.length;
  const enabled = jobs.value.filter((j) => j.enabled).length;
  const running = jobs.value.filter((j) => j.runtimeState === "running").length;
  
  // 实时计算"等待触发"数量：后端标记 + 前端判断
  const now = new Date();
  const pending = jobs.value.filter((job) => {
    // 后端已标记为 pending
    if (job.runtimeState === "pending") return true;
    
    // 前端实时判断：时间已到但未执行
    if (!job.nextRunAfter) return false;
    const nextRun = new Date(job.nextRunAfter);
    const hasLock = job.lockUntil && new Date(job.lockUntil) > now;
    return nextRun <= now && !hasLock;
  }).length;
  
  return { total, enabled, running, pending };
});

// 24小时执行活动热力图数据（从后端获取实际执行历史）
const hourlyAnalytics = ref(null);

// 加载热力图数据
const loadAnalytics = async () => {
  try {
    const data = await loadHourlyAnalytics(24);
    hourlyAnalytics.value = data;
  } catch (error) {
    console.error('[热力图] 加载统计数据失败:', error);
  }
};

// 将后端返回的桶数据转换为24小时数组（按本地时区的小时）
const hourlyActivity = computed(() => {
  const hours = Array(24).fill(0);
  
  if (!hourlyAnalytics.value?.buckets) return hours;
  
  // 遍历所有桶，累加到对应的本地小时
  hourlyAnalytics.value.buckets.forEach(bucket => {
    const startDate = new Date(bucket.start);
    const hour = startDate.getHours(); // 获取本地时区的小时
    hours[hour] += bucket.totalRuns;
  });
  
  return hours;
});

// 最大执行次数（用于热力图高度计算）
const maxHourlyCount = computed(() => {
  return Math.max(...hourlyActivity.value, 1);
});

// 获取热力图颜色
const getActivityColor = (count) => {
  if (count === 0) return darkMode.value ? 'bg-gray-700' : 'bg-gray-200';
  if (count <= 3) return darkMode.value ? 'bg-blue-600' : 'bg-blue-300';
  if (count <= 7) return darkMode.value ? 'bg-green-600' : 'bg-green-400';
  if (count <= 12) return darkMode.value ? 'bg-orange-600' : 'bg-orange-400';
  return darkMode.value ? 'bg-red-600' : 'bg-red-500';
};

// 格式化相对时间（实时更新版本）
const formatRelativeTime = (dateStr) => {
  // 触发响应式依赖：每秒 currentTick 变化时，此函数会重新计算
  const _ = currentTick.value;
  
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date - now;
  const diffSec = Math.abs(Math.floor(diffMs / 1000));
  const isPast = diffMs < 0;

  if (diffSec < 60) {
    return isPast ? `${diffSec}${t("common.second")}${t("admin.scheduledJobs.card.ago")}` : `${diffSec}${t("common.second")}${t("admin.scheduledJobs.card.later")}`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return isPast ? `${diffMin}${t("common.minute")}${t("admin.scheduledJobs.card.ago")}` : `${diffMin}${t("common.minute")}${t("admin.scheduledJobs.card.later")}`;
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return isPast ? `${diffHour}${t("common.hour")}${t("admin.scheduledJobs.card.ago")}` : `${diffHour}${t("common.hour")}${t("admin.scheduledJobs.card.later")}`;
  }
  const diffDay = Math.floor(diffHour / 24);
  return isPast ? `${diffDay}${t("common.day")}${t("admin.scheduledJobs.card.ago")}` : `${diffDay}${t("common.day")}${t("admin.scheduledJobs.card.later")}`;
};

// 格式化下次执行时间：如果时间已到但还没执行，显示"等待触发"（实时更新版本）
const formatNextRun = (job) => {
  // 触发响应式依赖
  const _ = currentTick.value;
  
  if (!job.nextRunAfter) return t("admin.scheduledJobs.card.notScheduled");
  
  const nextRun = new Date(job.nextRunAfter);
  const now = new Date();
  const hasLock = job.lockUntil && new Date(job.lockUntil) > now;
  
  // 如果时间已到且未获取锁，说明在等待外部扫描触发
  if (nextRun <= now && !hasLock) {
    return t('admin.scheduledJobs.stats.pendingJobs');
  }
  
  return formatRelativeTime(job.nextRunAfter);
};

// 批量操作
const handleBatchEnable = async () => {
  for (const taskId of selectedJobs.value) {
    await toggleJobEnabled(taskId, true);
  }
  selectedJobs.value = [];
  await handleRefresh();
};

const handleBatchDisable = async () => {
  for (const taskId of selectedJobs.value) {
    await toggleJobEnabled(taskId, false);
  }
  selectedJobs.value = [];
  await handleRefresh();
};

const handleBatchDelete = async () => {
  const confirmed = await confirmFn({
    title: t("admin.scheduledJobs.deleteConfirmTitle"),
    message: `确定要删除选中的 ${selectedJobs.value.length} 个任务吗？此操作不可撤销。`,
    confirmType: "danger",
  });
  if (confirmed) {
    for (const taskId of selectedJobs.value) {
      await deleteJob(taskId);
    }
    selectedJobs.value = [];
  }
};

// 操作处理
const handleRefresh = async () => {
  await Promise.all([loadJobs(), loadAnalytics()]);
};

const handleToggleEnabled = async (job) => {
  await toggleJobEnabled(job.taskId, !job.enabled);
};

const handleDelete = async (job) => {
  const confirmed = await confirmFn({
    title: t("admin.scheduledJobs.deleteConfirmTitle"),
    message: t("admin.scheduledJobs.deleteConfirmMessage"),
    confirmType: "danger",
  });
  if (confirmed) {
    await deleteJob(job.taskId);
  }
};

const handleRunNow = async (job) => {
  await runJobNow(job.taskId);
  await handleRefresh();
};

const handleViewDetail = async (job) => {
  currentJob.value = job;
  await loadJobRuns(job.taskId);
  showDetailDialog.value = true;
};

// 表格列配置
const jobColumns = computed(() => [
  // 任务名称列（第一列）
  {
    type: "accessor",
    key: "name",
    header: t("admin.scheduledJobs.form.name"),
    sortable: true,
    render: (value, row) => {
      return h("div", { class: "flex flex-col" }, [
        h("span", {
          class: [
            "truncate max-w-[200px]",
            darkMode.value ? "font-medium text-gray-100" : "font-medium text-gray-900"
          ],
          title: value || row.taskId
        }, value || row.taskId),
        row.description ? h("span", {
          class: [
            "text-xs mt-0.5 truncate max-w-[200px]",
            darkMode.value ? "text-gray-400" : "text-gray-500"
          ],
          title: row.description
        }, row.description) : null,
        row.handlerExists === false ? h("span", {
          class: [
            "text-xs px-2 py-0.5 rounded-full font-medium mt-1 inline-block w-fit",
            darkMode.value ? "bg-orange-900/40 text-orange-300" : "bg-orange-100 text-orange-700"
          ]
        }, t("admin.scheduledJobs.status.unknownType")) : null
      ]);
    }
  },
  
  // 执行周期列
  {
    type: "display",
    key: "schedule",
    header: t("admin.scheduledJobs.card.interval"),
    sortable: false,
    render: (row) => {
      return h("span", { class: "text-sm" }, formatSchedule(row));
    }
  },
  
  // 上次执行列
  {
    type: "accessor",
    key: "lastRunFinishedAt",
    header: t("admin.scheduledJobs.detail.lastRun"),
    sortable: true,
    render: (_, row) => {
      const ts = row.lastRunFinishedAt || row.lastRunStartedAt;
      return ts ? formatDateTime(ts) : t("admin.scheduledJobs.card.never");
    }
  },
  
  // 下次执行列
  {
    type: "display",
    key: "nextRunAfter",
    header: t("admin.scheduledJobs.detail.nextRun"),
    sortable: true,
    render: (row) => {
      const text = formatNextRun(row);
      
      // 判断是否应该显示黄色：
      // 1. runtimeState 为 "pending"（后端标记）
      // 2. 或者时间已到且未获取锁（前端判断）
      const now = new Date();
      const nextRun = row.nextRunAfter ? new Date(row.nextRunAfter) : null;
      const hasLock = row.lockUntil && new Date(row.lockUntil) > now;
      const isWaitingTrigger = nextRun && nextRun <= now && !hasLock;
      const isPending = row.runtimeState === "pending" || isWaitingTrigger;
      
      return h("span", {
        class: isPending ? (darkMode.value ? 'text-yellow-400 font-medium' : 'text-yellow-600 font-medium') : ''
      }, text);
    }
  },
  
  // 执行次数列
  {
    type: "display",
    key: "runCount",
    header: t("admin.scheduledJobs.detail.runCount"),
    sortable: true,
    render: (row) => {
      const runCount = row.runCount || 0;
      return h("span", {
        class: [
          "text-sm font-medium tabular-nums",
          darkMode.value ? "text-gray-300" : "text-gray-700"
        ]
      }, `${runCount}`);
    }
  },
  
  // 状态列 - 滑块开关
  {
    type: "accessor",
    key: "enabled",
    header: t("admin.scheduledJobs.detail.status"),
    sortable: true,
    render: (value, row) => {
      return h("button", {
        onClick: (e) => {
          e.stopPropagation();
          handleToggleEnabled(row);
        },
        class: [
          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
          value
            ? "bg-emerald-500 focus:ring-emerald-500"
            : (darkMode.value ? "bg-gray-600 focus:ring-gray-500" : "bg-gray-300 focus:ring-gray-400")
        ],
        role: "switch",
        "aria-checked": value,
        title: value ? t("admin.scheduledJobs.actions.disable") : t("admin.scheduledJobs.actions.enable")
      }, [
        h("span", {
          class: [
            "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
            value ? "translate-x-6" : "translate-x-1"
          ]
        })
      ]);
    }
  },
  
  // 操作列
  {
    type: "display",
    key: "actions",
    header: t("admin.scheduledJobs.detail.actions"),
    sortable: false,
    render: (row) => {
      return h("div", { class: "flex items-center justify-center gap-1" }, [
        // 立即执行按钮
        h("button", {
          class: [
            "p-1.5 rounded transition",
            darkMode.value ? "text-green-400 hover:bg-gray-700 hover:text-green-300" : "text-green-600 hover:bg-gray-100 hover:text-green-700"
          ],
          title: t("admin.scheduledJobs.actions.runNow"),
          onClick: (e) => {
            e.stopPropagation();
            handleRunNow(row);
          }
        }, [
          h("svg", {
            class: "h-5 w-5",
            fill: "none",
            viewBox: "0 0 24 24",
            stroke: "currentColor"
          }, [
            h("path", {
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
              "stroke-width": "2",
              d: "M13 10V3L4 14h7v7l9-11h-7z"
            })
          ])
        ]),
        
        // 查看详情按钮
        h("button", {
          class: [
            "p-1.5 rounded transition",
            darkMode.value ? "text-blue-400 hover:bg-gray-700 hover:text-blue-300" : "text-blue-600 hover:bg-gray-100 hover:text-blue-700"
          ],
          title: "查看详情",
          onClick: (e) => {
            e.stopPropagation();
            handleViewDetail(row);
          }
        }, [
          h("svg", {
            class: "h-5 w-5",
            fill: "none",
            viewBox: "0 0 24 24",
            stroke: "currentColor"
          }, [
            h("path", {
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
              "stroke-width": "2",
              d: "M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            }),
            h("path", {
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
              "stroke-width": "2",
              d: "M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            })
          ])
        ]),
        
        // 编辑按钮
        h("button", {
          class: [
            "p-1.5 rounded transition disabled:opacity-50 disabled:cursor-not-allowed",
            darkMode.value ? "text-gray-400 hover:bg-gray-700 hover:text-gray-300" : "text-gray-600 hover:bg-gray-100 hover:text-gray-700"
          ],
          title: t("admin.scheduledJobs.actions.edit"),
          disabled: row.handlerExists === false,
          onClick: (e) => {
            e.stopPropagation();
            navigateToEdit(row);
          }
        }, [
          h("svg", {
            class: "h-5 w-5",
            fill: "none",
            viewBox: "0 0 24 24",
            stroke: "currentColor"
          }, [
            h("path", {
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
              "stroke-width": "2",
              d: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            })
          ])
        ]),
        
        // 删除按钮
        h("button", {
          class: [
            "p-1.5 rounded transition",
            darkMode.value ? "text-red-400 hover:bg-gray-700 hover:text-red-300" : "text-red-600 hover:bg-gray-100 hover:text-red-700"
          ],
          title: t("admin.scheduledJobs.actions.delete"),
          onClick: (e) => {
            e.stopPropagation();
            handleDelete(row);
          }
        }, [
          h("svg", {
            class: "h-5 w-5",
            fill: "none",
            viewBox: "0 0 24 24",
            stroke: "currentColor"
          }, [
            h("path", {
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
              "stroke-width": "2",
              d: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            })
          ])
        ])
      ]);
    }
  }
]);

// 列宽度配置
const jobColumnClasses = {
  select: "w-10",
  name: "w-48",
  schedule: "w-32",
  lastRunFinishedAt: "w-32",
  nextRunAfter: "w-32",
  runCount: "w-24",
  enabled: "w-24",
  actions: "w-40"
};

// 注意：初始化逻辑已合并到上面的 onMounted 钩子中

</script>

<template>
  <div class="p-4 flex-1 flex flex-col overflow-y-auto">
    <!-- 工具栏 -->
    <div class="flex flex-col space-y-3 mb-5">
      <!-- 第一行：标题和操作按钮 -->
      <div class="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
        <h2 class="text-lg sm:text-xl font-medium" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">
          {{ t("admin.scheduledJobs.title") }}
        </h2>

        <div class="flex flex-wrap gap-2">
          <!-- 批量操作按钮（选中时显示） -->
          <template v-if="selectedJobs.length > 0">
            <button @click="handleBatchEnable" class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white transition-all duration-200" :class="darkMode ? 'bg-green-600 hover:bg-green-700' : 'bg-green-500 hover:bg-green-600'">
              <svg class="h-3 w-3 sm:h-4 sm:w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span class="hidden xs:inline">
                {{ t('admin.scheduledJobs.actions.enable') }} ({{ selectedJobs.length }})
              </span>
              <span class="xs:hidden">{{ t('admin.scheduledJobs.actions.enable') }}</span>
            </button>
            <button @click="handleBatchDisable" class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white transition-all duration-200" :class="darkMode ? 'bg-gray-600 hover:bg-gray-700' : 'bg-gray-500 hover:bg-gray-600'">
              <svg class="h-3 w-3 sm:h-4 sm:w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span class="hidden xs:inline">
                {{ t('admin.scheduledJobs.actions.disable') }} ({{ selectedJobs.length }})
              </span>
              <span class="xs:hidden">{{ t('admin.scheduledJobs.actions.disable') }}</span>
            </button>
            <button @click="handleBatchDelete" class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white transition-all duration-200" :class="darkMode ? 'bg-red-600 hover:bg-red-700' : 'bg-red-500 hover:bg-red-600'">
              <svg class="h-3 w-3 sm:h-4 sm:w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span class="hidden xs:inline">
                {{ t('admin.scheduledJobs.actions.delete') }} ({{ selectedJobs.length }})
              </span>
              <span class="xs:hidden">{{ t('admin.scheduledJobs.actions.delete') }}</span>
            </button>
          </template>

          <!-- 常规按钮 -->
          <template v-else>
            <button @click="navigateToCreate" class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white transition-all duration-200" :class="darkMode ? 'bg-primary-600 hover:bg-primary-700' : 'bg-primary-500 hover:bg-primary-600'">
              <svg class="h-3 w-3 sm:h-4 sm:w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              <span class="hidden xs:inline">{{ t("admin.scheduledJobs.toolbar.createJob") }}</span>
              <span class="xs:hidden">{{ t("admin.scheduledJobs.toolbar.createJob") }}</span>
            </button>

            <button @click="handleRefresh" :disabled="loading" class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white transition-all duration-200 disabled:opacity-50" :class="darkMode ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'">
              <svg class="h-3 w-3 sm:h-4 sm:w-4 mr-1.5" :class="{ 'animate-spin': loading }" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span class="hidden xs:inline">{{ t("admin.scheduledJobs.toolbar.refresh") }}</span>
              <span class="xs:hidden">{{ t("admin.scheduledJobs.toolbar.refresh") }}</span>
            </button>
          </template>
        </div>
      </div>

      <!-- 第二行：筛选和搜索 -->
      <div class="flex flex-col sm:flex-row sm:justify-end sm:items-center gap-3">
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-2 text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
            <span class="hidden sm:inline">{{ t("admin.scheduledJobs.toolbar.filter") }}</span>
            <select v-model="enabledFilter" class="px-2 py-1 rounded-md border text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" :class="darkMode ? 'bg-gray-800 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-800'">
              <option value="all">{{ t("admin.scheduledJobs.toolbar.filterAll") }}</option>
              <option value="enabled">{{ t("admin.scheduledJobs.toolbar.filterEnabled") }}</option>
              <option value="disabled">{{ t("admin.scheduledJobs.toolbar.filterDisabled") }}</option>
            </select>
          </div>

          <div class="relative">
            <input v-model="searchQuery" type="text" :placeholder="t('admin.scheduledJobs.toolbar.search')" class="pl-8 pr-3 py-1 rounded-md border text-sm w-48 focus:outline-none focus:ring-2 focus:ring-primary-500" :class="darkMode ? 'bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500' : 'bg-white border-gray-300 text-gray-800 placeholder-gray-400'" />
            <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" :class="darkMode ? 'text-gray-500' : 'text-gray-400'" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
      </div>
    </div>

    <!-- 统计区域：热力图 + 紧凑指标 -->
    <div class="mb-4">
      <!-- 折叠控制按钮 -->
      <button
        @click="isStatsCollapsed = !isStatsCollapsed"
        class="w-full flex items-center justify-between px-4 py-2 mb-3 rounded-lg border transition-colors"
        :class="darkMode ? 'bg-gray-800 border-gray-700 hover:bg-gray-750' : 'bg-white border-gray-200 hover:bg-gray-50'"
      >
        <span class="text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
          {{ t('admin.scheduledJobs.stats.sectionTitle') }}
        </span>
        <svg
          class="h-5 w-5 transition-transform"
          :class="[
            isStatsCollapsed ? 'rotate-180' : '',
            darkMode ? 'text-gray-400' : 'text-gray-500'
          ]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <!-- 可折叠内容 -->
      <div v-show="!isStatsCollapsed" class="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <!-- 24小时执行热力图 (占8列) -->
        <div class="lg:col-span-8 rounded-lg border p-4 shadow-sm" :class="darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
              {{ t('admin.scheduledJobs.stats.hourlyActivityTitle') }}
            </h3>
            <div class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t('admin.scheduledJobs.stats.hourlyActivitySubtitle') }}
            </div>
          </div>
        
        <!-- 热力图 -->
        <div class="flex items-end gap-0.5 h-16 mb-2">
          <div 
            v-for="(count, hour) in hourlyActivity" 
            :key="hour"
            class="flex-1 rounded-t transition-all hover:opacity-80 cursor-pointer relative group"
            :class="getActivityColor(count)"
            :style="{ height: count > 0 ? `${(count / maxHourlyCount) * 100}%` : '2px' }"
          >
            <!-- Tooltip -->
            <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
              {{ t('admin.scheduledJobs.stats.hourlyTooltip', { hour, count }) }}
            </div>
          </div>
        </div>
        
        <!-- 时间轴标签 -->
        <div class="flex justify-between text-xs mb-2" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>23:59</span>
        </div>
        
        <!-- 图例 -->
        <div class="flex items-center gap-3 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          <div class="flex items-center gap-1">
            <div class="w-2 h-2 rounded" :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"></div>
            <span>{{ t('admin.scheduledJobs.stats.legendNone') }}</span>
          </div>
          <div class="flex items-center gap-1">
            <div class="w-2 h-2 rounded" :class="darkMode ? 'bg-blue-600' : 'bg-blue-300'"></div>
            <span>{{ t('admin.scheduledJobs.stats.legendRange1') }}</span>
          </div>
          <div class="flex items-center gap-1">
            <div class="w-2 h-2 rounded" :class="darkMode ? 'bg-green-600' : 'bg-green-400'"></div>
            <span>{{ t('admin.scheduledJobs.stats.legendRange2') }}</span>
          </div>
          <div class="flex items-center gap-1">
            <div class="w-2 h-2 rounded" :class="darkMode ? 'bg-orange-600' : 'bg-orange-400'"></div>
            <span>{{ t('admin.scheduledJobs.stats.legendRange3') }}</span>
          </div>
          <div class="flex items-center gap-1">
            <div class="w-2 h-2 rounded" :class="darkMode ? 'bg-red-600' : 'bg-red-500'"></div>
            <span>{{ t('admin.scheduledJobs.stats.legendRange4') }}</span>
          </div>
        </div>
      </div>

      <!-- 右侧紧凑指标 (占4列) -->
      <div class="lg:col-span-4 grid grid-cols-2 gap-3">
        <!-- 总任务 -->
        <div class="rounded-lg border p-3 shadow-sm" :class="darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'">
          <div class="text-xs font-medium mb-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
            {{ t('admin.scheduledJobs.stats.totalJobs') }}
          </div>
          <div class="text-xl font-semibold" :class="darkMode ? 'text-blue-400' : 'text-blue-600'">{{ stats.total }}</div>
        </div>

        <!-- 已启用 -->
        <div class="rounded-lg border p-3 shadow-sm" :class="darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'">
          <div class="text-xs font-medium mb-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
            {{ t('admin.scheduledJobs.stats.enabledJobs') }}
          </div>
          <div class="text-xl font-semibold" :class="darkMode ? 'text-green-400' : 'text-green-600'">{{ stats.enabled }}</div>
        </div>

        <!-- 等待触发 -->
        <div class="rounded-lg border p-3 shadow-sm" :class="darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'">
          <div class="text-xs font-medium mb-1 flex items-center gap-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
            <span>{{ t('admin.scheduledJobs.stats.pendingJobs') }}</span>
            <svg v-if="stats.pending > 0" class="h-2 w-2 text-yellow-500 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="5" />
            </svg>
          </div>
          <div class="text-xl font-semibold" :class="darkMode ? 'text-yellow-400' : 'text-yellow-600'">{{ stats.pending }}</div>
        </div>

        <!-- 运行中 -->
        <div class="rounded-lg border p-3 shadow-sm" :class="darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'">
          <div class="text-xs font-medium mb-1 flex items-center gap-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
            <span>{{ t('admin.scheduledJobs.stats.runningJobs') }}</span>
            <svg v-if="stats.running > 0" class="h-2 w-2 text-blue-500 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="5" />
            </svg>
          </div>
          <div class="text-xl font-semibold" :class="darkMode ? 'text-blue-400' : 'text-blue-600'">{{ stats.running }}</div>
        </div>
      </div>
      </div>
    </div>

    <!-- 表格内容 -->
    <div class="flex-1 flex flex-col">
      <!-- 加载状态 -->
      <div v-if="loading" class="flex justify-center items-center h-40">
        <svg class="animate-spin h-8 w-8 text-primary-500" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>

      <!-- AdminTable 组件 -->
      <AdminTable
        v-else
        :data="displayedJobs"
        :columns="jobColumns"
        :column-classes="jobColumnClasses"
        :selectable="true"
        :selected-items="selectedJobs"
        row-id-field="taskId"
        :empty-text="t('admin.scheduledJobs.empty.title')"
        @selection-change="handleSelectionChange"
      >
        <!-- 移动端卡片视图 -->
        <template #mobile="{ data }">
          <div class="space-y-3 p-0">
            <div 
              v-for="job in data" 
              :key="job.taskId" 
              class="rounded-lg shadow-md overflow-hidden border"
              :class="[
                darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200',
                !job.enabled ? 'opacity-70' : ''
              ]"
            >
              <!-- 卡片头部 -->
              <div class="px-5 py-3 flex justify-between items-center gap-2 border-b" :class="darkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-200'">
                <div class="flex items-center gap-2 min-w-0 flex-1">
                  <input 
                    type="checkbox" 
                    :checked="selectedJobs.includes(job.taskId)" 
                    @change="handleSelectionChange({ type: 'toggle-item', id: job.taskId })"
                    class="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <div class="min-w-0 flex-1">
                    <h3 class="font-medium text-sm truncate" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">{{ job.name || job.taskId }}</h3>
                    <p v-if="job.description" class="text-xs truncate mt-0.5" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ job.description }}</p>
                  </div>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  <span v-if="job.handlerExists === false" class="text-xs px-2 py-0.5 rounded-full font-medium" :class="darkMode ? 'bg-orange-900/40 text-orange-300' : 'bg-orange-100 text-orange-700'">
                    {{ t("admin.scheduledJobs.status.unknownType") }}
                  </span>
                  <span class="text-xs px-2 py-0.5 rounded-full font-medium" :class="job.enabled ? (darkMode ? 'bg-green-900/40 text-green-300' : 'bg-green-100 text-green-700') : (darkMode ? 'bg-gray-600 text-gray-300' : 'bg-gray-200 text-gray-600')">
                    {{ job.enabled ? t("admin.scheduledJobs.status.enabled") : t("admin.scheduledJobs.status.disabled") }}
                  </span>
                </div>
              </div>

              <!-- 卡片内容 -->
              <div class="p-4" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
                <div class="space-y-2 text-sm">
                  <div class="flex justify-between">
                    <span class="font-medium">
                      {{ t('admin.scheduledJobs.card.interval') }}
                    </span>
                    <span class="text-right">{{ formatSchedule(job) }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="font-medium">
                      {{ t('admin.scheduledJobs.detail.lastRun') }}
                    </span>
                    <span class="text-right">{{ job.lastRunFinishedAt || job.lastRunStartedAt ? formatDateTime(job.lastRunFinishedAt || job.lastRunStartedAt) : t("admin.scheduledJobs.card.never") }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="font-medium">
                      {{ t('admin.scheduledJobs.detail.nextRun') }}
                    </span>
                    <span 
                      class="text-right"
                      :class="(() => {
                        const now = new Date();
                        const nextRun = job.nextRunAfter ? new Date(job.nextRunAfter) : null;
                        const hasLock = job.lockUntil && new Date(job.lockUntil) > now;
                        const isWaitingTrigger = nextRun && nextRun <= now && !hasLock;
                        const isPending = job.runtimeState === 'pending' || isWaitingTrigger;
                        return isPending ? (darkMode ? 'text-yellow-400 font-medium' : 'text-yellow-600 font-medium') : '';
                      })()"
                    >
                      {{ formatNextRun(job) }}
                    </span>
                  </div>
                </div>

                <!-- 操作按钮 -->
                <div class="mt-3 flex flex-wrap gap-2">
                  <!-- 启用/禁用按钮 -->
                  <button 
                    @click="handleToggleEnabled(job)" 
                    class="flex items-center px-3 py-1.5 rounded text-sm font-medium transition" 
                    :class="job.enabled ? (darkMode ? 'bg-gray-600 hover:bg-gray-700 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-800') : (darkMode ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-green-100 hover:bg-green-200 text-green-800')"
                  >
                    <svg v-if="job.enabled" class="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <svg v-else class="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {{ job.enabled ? t('admin.scheduledJobs.actions.disable') : t('admin.scheduledJobs.actions.enable') }}
                  </button>
                  
                  <!-- 立即执行按钮 -->
                  <button 
                    @click="handleRunNow(job)" 
                    class="flex items-center px-3 py-1.5 rounded text-sm font-medium transition" 
                    :class="darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-100 hover:bg-blue-200 text-blue-800'"
                  >
                    <svg class="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    {{ t('admin.scheduledJobs.actions.runNow') }}
                  </button>
                  
                  <!-- 查看详情按钮 -->
                  <button 
                    @click="handleViewDetail(job)" 
                    class="flex items-center px-3 py-1.5 rounded text-sm font-medium transition" 
                    :class="darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-100 hover:bg-blue-200 text-blue-800'"
                  >
                    <svg class="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    {{ t('admin.scheduledJobs.actions.viewDetail') }}
                  </button>
                  
                  <!-- 编辑按钮 -->
                  <button
                    @click="navigateToEdit(job)"
                    :disabled="job.handlerExists === false"
                    class="flex items-center px-3 py-1.5 rounded text-sm font-medium transition disabled:opacity-50"
                    :class="darkMode ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-amber-100 hover:bg-amber-200 text-amber-800'"
                  >
                    <svg class="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    {{ t('admin.scheduledJobs.actions.edit') }}
                  </button>
                  
                  <!-- 删除按钮 -->
                  <button 
                    @click="handleDelete(job)" 
                    class="flex items-center px-3 py-1.5 rounded text-sm font-medium transition" 
                    :class="darkMode ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-red-100 hover:bg-red-200 text-red-800'"
                  >
                    <svg class="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    {{ t('admin.scheduledJobs.actions.delete') }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </AdminTable>
    </div>

    <!-- 详情弹窗组件 -->
    <ScheduledJobDetailModal
      :show="showDetailDialog"
      :job="currentJob"
      :runs="jobRuns"
      :runs-loading="runsLoading"
      :dark-mode="darkMode"
      @close="showDetailDialog = false"
    />

    <!-- 确认对话框 -->
    <ConfirmDialog 
      :is-open="dialogState.isOpen" 
      :title="dialogState.title" 
      :message="dialogState.message" 
      :confirm-text="dialogState.confirmText" 
      :confirm-type="dialogState.confirmType" 
      :dark-mode="darkMode" 
      @confirm="handleConfirm" 
      @cancel="handleCancel" 
    />
  </div>
</template>
