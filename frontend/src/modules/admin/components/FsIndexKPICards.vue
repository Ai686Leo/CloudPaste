<template>
  <div class="grid grid-cols-2 gap-3">
    <!-- 整体健康度 -->
    <div
      class="rounded-lg border p-3 shadow-sm"
      :class="darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'"
    >
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ t("admin.fsIndex.kpi.health") }}
        </span>
        <div
          class="w-8 h-8 rounded-md flex items-center justify-center"
          :class="darkMode ? 'bg-green-900/30' : 'bg-green-100'"
        >
          <IconCheckCircle
            class="w-4 h-4"
            :class="darkMode ? 'text-green-400' : 'text-green-600'"
          />
        </div>
      </div>
      <div
        v-if="isLoading"
        class="h-7 rounded animate-pulse mb-1.5"
        :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"
      ></div>
      <div v-else class="text-xl font-semibold mb-1.5" :class="darkMode ? 'text-green-400' : 'text-green-600'">
        {{ healthPercentage }}%
      </div>
      <div class="w-full rounded-full h-1.5" :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'">
        <div
          class="bg-gradient-to-r from-green-400 to-green-600 h-1.5 rounded-full transition-all duration-500"
          :style="{ width: `${healthPercentage}%` }"
        ></div>
      </div>
    </div>

    <!-- 运行中任务 -->
    <div
      class="rounded-lg border p-3 shadow-sm"
      :class="darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'"
    >
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium flex items-center gap-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ t("admin.fsIndex.kpi.running") }}
          <span v-if="runningJobsCount > 0" class="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse"></span>
        </span>
        <div
          class="w-8 h-8 rounded-md flex items-center justify-center"
          :class="darkMode ? 'bg-blue-900/30' : 'bg-blue-100'"
        >
          <IconBolt
            class="w-4 h-4"
            :class="darkMode ? 'text-blue-400' : 'text-blue-600'"
          />
        </div>
      </div>
      <div
        v-if="isLoading"
        class="h-7 rounded animate-pulse"
        :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"
      ></div>
      <div v-else class="text-xl font-semibold" :class="darkMode ? 'text-blue-400' : 'text-blue-600'">
        {{ runningJobsCount }}
      </div>
      <div class="text-xs mt-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
        {{ t("admin.fsIndex.kpi.activeTasks") }}
      </div>
    </div>

    <!-- 待处理变更 -->
    <div
      class="rounded-lg border p-3 shadow-sm"
      :class="darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'"
    >
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ t("admin.fsIndex.kpi.pending") }}
        </span>
        <div
          class="w-8 h-8 rounded-md flex items-center justify-center"
          :class="darkMode ? 'bg-yellow-900/30' : 'bg-yellow-100'"
        >
          <IconClock
            class="w-4 h-4"
            :class="darkMode ? 'text-yellow-400' : 'text-yellow-600'"
          />
        </div>
      </div>
      <div
        v-if="isLoading"
        class="h-7 rounded animate-pulse"
        :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"
      ></div>
      <div v-else class="text-xl font-semibold" :class="darkMode ? 'text-yellow-400' : 'text-yellow-600'">
        {{ totalDirtyCount }}
      </div>
      <div class="text-xs mt-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
        {{ t("admin.fsIndex.kpi.changes") }}
      </div>
    </div>

    <!-- 最后更新 -->
    <div
      class="rounded-lg border p-3 shadow-sm"
      :class="darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'"
    >
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ t("admin.fsIndex.kpi.lastUpdate") }}
        </span>
        <div
          class="w-8 h-8 rounded-md flex items-center justify-center"
          :class="darkMode ? 'bg-purple-900/30' : 'bg-purple-100'"
        >
          <IconRefresh
            class="w-4 h-4"
            :class="darkMode ? 'text-purple-400' : 'text-purple-600'"
          />
        </div>
      </div>
      <div
        v-if="isLoading"
        class="h-7 rounded animate-pulse"
        :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"
      ></div>
      <div
        v-else
        class="text-base font-semibold"
        :class="darkMode ? 'text-purple-400' : 'text-purple-600'"
        :title="lastUpdateTimeFull"
      >
        {{ lastUpdateTimeShort }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import {
  IconCheckCircle,
  IconBolt,
  IconClock,
  IconRefresh,
} from "@/components/icons";
import { formatTimestamp } from "@/api/services/fsIndexService";

const { t } = useI18n();
const { isDarkMode: darkMode } = useThemeMode();

const props = defineProps({
  indexStatus: {
    type: Object,
    default: null,
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
});

// 计算健康度百分比
const healthPercentage = computed(() => {
  if (!props.indexStatus?.items || props.indexStatus.items.length === 0) {
    return 0;
  }

  const readyCount = props.indexStatus.items.filter(
    (item) => item.status === "ready"
  ).length;
  return Math.round((readyCount / props.indexStatus.items.length) * 100);
});

// 运行中任务数量
const runningJobsCount = computed(() => {
  return props.indexStatus?.runningJobs?.length || 0;
});

// 待处理变更总数
const totalDirtyCount = computed(() => {
  if (!props.indexStatus?.items) return 0;

  return props.indexStatus.items.reduce((sum, item) => {
    return sum + (item.dirtyCount || 0);
  }, 0);
});

// 获取最近的索引时间戳
const latestIndexTime = computed(() => {
  if (!props.indexStatus?.items || props.indexStatus.items.length === 0) {
    return null;
  }

  const times = props.indexStatus.items
    .map((item) => item.lastIndexedMs)
    .filter(Boolean);

  if (times.length === 0) return null;

  return Math.max(...times);
});

// 最后更新时间（简短格式，用于显示）
const lastUpdateTimeShort = computed(() => {
  if (!latestIndexTime.value) {
    return t("admin.fsIndex.kpi.never");
  }

  const now = Date.now();
  const diff = now - latestIndexTime.value;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return t("admin.fsIndex.kpi.justNow");
  } else if (minutes < 60) {
    return `${minutes}${t("admin.fsIndex.kpi.minutesAgo")}`;
  } else if (hours < 24) {
    return `${hours}${t("admin.fsIndex.kpi.hoursAgo")}`;
  } else {
    return `${days}${t("admin.fsIndex.kpi.daysAgo")}`;
  }
});

// 最后更新时间（完整格式，用于 tooltip）
const lastUpdateTimeFull = computed(() => {
  if (!latestIndexTime.value) {
    return t("admin.fsIndex.kpi.never");
  }

  return formatTimestamp(latestIndexTime.value);
});
</script>
