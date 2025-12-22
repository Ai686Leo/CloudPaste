<template>
  <div
    class="rounded-lg border shadow-sm overflow-hidden"
    :class="darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'"
  >
    <!-- 可折叠标题栏 -->
    <button
      @click="toggleExpanded"
      class="w-full px-4 py-3 flex items-center justify-between transition-colors"
      :class="darkMode ? 'hover:bg-gray-700/50' : 'hover:bg-gray-50'"
    >
      <div class="flex items-center gap-2">
        <div
          class="w-8 h-8 rounded-md flex items-center justify-center relative overflow-hidden"
          :class="darkMode ? 'bg-blue-900/30' : 'bg-blue-100'"
        >
          <!-- 运行中时的扫描光效 -->
          <span
            v-if="runningJobs.length > 0"
            class="absolute inset-0 search-scan-glow"
            :class="darkMode ? 'bg-gradient-to-r from-transparent via-blue-400/30 to-transparent' : 'bg-gradient-to-r from-transparent via-blue-500/25 to-transparent'"
          ></span>
          <IconSearch
            class="w-4 h-4 relative z-10"
            :class="[
              darkMode ? 'text-blue-400' : 'text-blue-600',
              runningJobs.length > 0 ? 'search-icon-scanning' : ''
            ]"
          />
        </div>
        <div class="text-left">
          <h3 class="text-sm font-semibold" :class="darkMode ? 'text-white' : 'text-gray-900'">
            {{ t("admin.fsIndex.runningJobs.title") }}
          </h3>
          <p class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
            {{ runningJobs.length }} {{ t("admin.fsIndex.kpi.activeTasks") }}
          </p>
        </div>
      </div>
      <IconChevronDown
        class="w-4 h-4 transition-transform duration-200"
        :class="[
          darkMode ? 'text-gray-400' : 'text-gray-500',
          { 'rotate-180': isExpanded }
        ]"
      />
    </button>

    <!-- 任务列表（可折叠） -->
    <div
      v-show="isExpanded"
      class="px-4 pb-4 space-y-3"
    >
      <!-- 空状态 -->
      <div
        v-if="!isLoading && runningJobs.length === 0"
        class="text-center py-6"
      >
        <IconCheckCircle
          class="mx-auto w-8 h-8 mb-2"
          :class="darkMode ? 'text-green-400' : 'text-green-500'"
        />
        <p class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ t("admin.fsIndex.runningJobs.empty") }}
        </p>
      </div>

      <!-- 骨架屏 -->
      <div
        v-else-if="isLoading"
        class="space-y-3"
      >
        <div
          v-for="i in 2"
          :key="i"
          class="h-24 rounded-md animate-pulse"
          :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"
        ></div>
      </div>

      <!-- 任务卡片 -->
      <div
        v-else
        v-for="job in runningJobs"
        :key="job.jobId"
        class="border rounded-lg p-3 transition-colors"
        :class="darkMode ? 'border-gray-700 hover:border-blue-700' : 'border-gray-200 hover:border-blue-300'"
      >
        <!-- 任务头部 -->
        <div class="flex items-center justify-between gap-3 mb-2">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5 mb-0.5">
              <span
                :class="[
                  'px-1.5 py-0.5 text-xs font-medium rounded',
                  getTaskTypeBadgeClass(job.taskType)
                ]"
              >
                {{ getTaskTypeText(job.taskType) }}
              </span>
              <span class="text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                #{{ job.jobId }}
              </span>
            </div>
            <p class="text-sm font-medium truncate" :class="darkMode ? 'text-white' : 'text-gray-900'">
              {{ getCurrentMountName(job) || t("admin.fsIndex.runningJobs.processing") }}
              <span v-if="getCurrentMountStorageType(job)" class="text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                ({{ getCurrentMountStorageType(job) }})
              </span>
            </p>
          </div>

          <!-- 圆形进度条 -->
          <div class="flex items-center gap-2">
            <div class="relative w-12 h-12 flex-shrink-0">
              <svg class="transform -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  stroke-width="8"
                  fill="none"
                  :class="darkMode ? 'stroke-gray-700' : 'stroke-gray-200'"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  stroke-width="8"
                  fill="none"
                  :class="getProgressStrokeClass(job.taskType)"
                  :stroke-dasharray="251.2"
                  :stroke-dashoffset="getProgressOffset(job)"
                  stroke-linecap="round"
                  class="transition-all duration-500"
                />
              </svg>
              <div class="absolute inset-0 flex items-center justify-center">
                <span class="text-xs font-bold" :class="darkMode ? 'text-white' : 'text-gray-900'">
                  {{ getProgressPercentage(job) }}%
                </span>
              </div>
            </div>

            <!-- 停止按钮 -->
            <button
              @click="handleStopJob(job.jobId)"
              class="p-1.5 rounded transition-colors"
              :class="darkMode ? 'text-red-400 hover:bg-red-900/20' : 'text-red-600 hover:bg-red-50'"
              :title="t('admin.fsIndex.actions.stop')"
            >
              <IconClose class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- 任务统计信息 -->
        <div class="grid grid-cols-4 gap-2 text-xs">
          <!-- rebuild：processedItems 是“已完成挂载点数”，单挂载点会长期 0，改为更直观的展示 -->
          <div v-if="job.taskType === 'fs_index_rebuild'">
            <span :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
              {{ t("admin.fsIndex.runningJobs.mountProgress") }}
            </span>
            <p class="font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-800'">
              {{ formatNumber(job.stats?.processedItems || 0) }}/{{ formatNumber(job.stats?.totalItems || 0) }}
            </p>
          </div>
          <div v-else>
            <span :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
              {{ t("admin.fsIndex.runningJobs.processed") }}
            </span>
            <p class="font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-800'">
              {{ formatNumber(job.stats?.processedItems || 0) }}
            </p>
          </div>

          <div>
            <span :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
              {{ t("admin.fsIndex.runningJobs.scannedDirs") }}
            </span>
            <p class="font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-800'">
              {{ formatNumber(job.stats?.scannedDirs || 0) }}
            </p>
          </div>

          <div v-if="job.taskType === 'fs_index_rebuild'">
            <span :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
              {{ t("admin.fsIndex.runningJobs.discoveredCount") }}
            </span>
            <p class="font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-800'">
              {{ formatNumber(job.stats?.discoveredCount || 0) }}
            </p>
          </div>
          <div v-else>
            <span :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
              {{ t("admin.fsIndex.runningJobs.upsertedCount") }}
            </span>
            <p class="font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-800'">
              {{ formatNumber(job.stats?.upsertedCount || 0) }}
            </p>
          </div>

          <div>
            <span :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
              {{ t("admin.fsIndex.runningJobs.duration") }}
            </span>
            <p class="font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-800'">
              {{ formatDuration(job.startedAt) }}
            </p>
          </div>
        </div>

        <!-- 进度心跳：仅在“长时间无更新”时展示，避免常态 0s 造成噪音 -->
        <div
          v-if="shouldShowLastUpdate(job)"
          class="mt-2 text-[11px]"
          :class="darkMode ? 'text-gray-500' : 'text-gray-400'"
        >
          {{ t("admin.fsIndex.runningJobs.lastUpdate") }}: {{ formatLastUpdate(job) }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import {
  IconSearch,
  IconChevronDown,
  IconCheckCircle,
  IconClose,
} from "@/components/icons";
import { calculateJobProgress } from "@/api/services/fsIndexService";

const { t } = useI18n();
const { isDarkMode: darkMode } = useThemeMode();

const props = defineProps({
  runningJobs: {
    type: Array,
    default: () => [],
  },
  mounts: {
    type: Array,
    default: () => [],
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
});

// 根据 mountId 获取挂载点信息
function getMountInfo(mountId) {
  if (!mountId || !props.mounts) return null;
  return props.mounts.find((m) => m.mountId === mountId);
}

// 获取当前处理的挂载点名称
function getCurrentMountName(job) {
  const mountId = job.stats?.currentMountId;
  if (!mountId) return null;
  const mount = getMountInfo(mountId);
  return mount?.name || mountId;
}

// 获取当前处理的挂载点存储类型
function getCurrentMountStorageType(job) {
  const mountId = job.stats?.currentMountId;
  if (!mountId) return null;
  const mount = getMountInfo(mountId);
  return mount?.storageType || null;
}

const emit = defineEmits(["stop-job"]);

// 折叠状态
const isExpanded = ref(true);

function toggleExpanded() {
  isExpanded.value = !isExpanded.value;
}

// 任务类型文本
function getTaskTypeText(taskType) {
  const key = `admin.fsIndex.taskType.${taskType}`;
  return t(key);
}

// 任务类型徽章样式
function getTaskTypeBadgeClass(taskType) {
  if (taskType === "fs_index_rebuild") {
    return darkMode.value
      ? "bg-blue-900/30 text-blue-300"
      : "bg-blue-100 text-blue-800";
  } else if (taskType === "fs_index_apply_dirty") {
    return darkMode.value
      ? "bg-green-900/30 text-green-300"
      : "bg-green-100 text-green-800";
  }
  return darkMode.value
    ? "bg-gray-700 text-gray-300"
    : "bg-gray-100 text-gray-800";
}

// 进度条颜色
function getProgressStrokeClass(taskType) {
  if (taskType === "fs_index_rebuild") {
    return darkMode.value ? "stroke-blue-400" : "stroke-blue-600";
  } else if (taskType === "fs_index_apply_dirty") {
    return darkMode.value ? "stroke-green-400" : "stroke-green-600";
  }
  return darkMode.value ? "stroke-gray-400" : "stroke-gray-600";
}

// 计算进度百分比
function getProgressPercentage(job) {
  return calculateJobProgress(job.stats);
}

// 计算进度偏移量（SVG stroke-dashoffset）
function getProgressOffset(job) {
  const percentage = getProgressPercentage(job);
  const circumference = 251.2; // 2 * π * r (r=40)
  return circumference * (1 - percentage / 100);
}

// 格式化数字
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M";
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num.toString();
}

// 格式化持续时间（支持 ISO 字符串或毫秒时间戳）
function formatDuration(startedAt) {
  if (!startedAt) return "0s";

  // 支持 ISO 字符串或毫秒时间戳
  const startMs = typeof startedAt === "string" ? new Date(startedAt).getTime() : startedAt;
  if (isNaN(startMs)) return "0s";

  const now = Date.now();
  const duration = now - startMs;
  const seconds = Math.floor(duration / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}

function toMs(value) {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function formatAgo(ms) {
  if (!Number.isFinite(ms)) return "-";
  const diff = Math.max(0, Date.now() - ms);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function getLastUpdateAgeMs(job) {
  const hb = toMs(job?.stats?.heartbeatAtMs);
  if (hb !== null) return Math.max(0, Date.now() - hb);

  const updatedAt = toMs(job?.updatedAt);
  if (updatedAt !== null) return Math.max(0, Date.now() - updatedAt);

  return null;
}

function formatLastUpdate(job) {
  const hb = toMs(job?.stats?.heartbeatAtMs);
  if (hb !== null) return formatAgo(hb);

  const updatedAt = toMs(job?.updatedAt);
  if (updatedAt !== null) return formatAgo(updatedAt);

  const startedAt = toMs(job?.startedAt);
  if (startedAt !== null) return formatAgo(startedAt);

  return "-";
}

function shouldShowLastUpdate(job) {
  // KISS：只有当“超过 10s 没有任何进度写入”时才显示，避免常态 0s（频繁刷新）带来的噪音。
  const ageMs = getLastUpdateAgeMs(job);
  if (!Number.isFinite(ageMs)) return false;
  return ageMs >= 10_000;
}

// 停止任务
function handleStopJob(jobId) {
  emit("stop-job", jobId);
}
</script>

<style scoped>

/* 搜索图标左右扫描动画 */
.search-icon-scanning {
  animation: search-scan 1.5s ease-in-out infinite;
}

@keyframes search-scan {
  0%, 100% {
    transform: translateX(0);
    opacity: 1;
  }
  50% {
    transform: translateX(2px);
    opacity: 0.7;
  }
}

/* 扫描光效动画 */
.search-scan-glow {
  animation: scan-glow 2s ease-in-out infinite;
}

@keyframes scan-glow {
  0% {
    transform: translateX(-100%);
    opacity: 0;
  }
  50% {
    opacity: 1;
  }
  100% {
    transform: translateX(100%);
    opacity: 0;
  }
}
</style>
