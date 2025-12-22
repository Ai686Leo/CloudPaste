<template>
  <div
    class="rounded-lg border p-4 shadow-sm"
    :class="darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'"
  >
    <!-- 图表标题 -->
    <div class="flex items-center gap-2 mb-4">
      <div
        class="w-8 h-8 rounded-md flex items-center justify-center"
        :class="darkMode ? 'bg-purple-900/30' : 'bg-purple-100'"
      >
        <IconChartPie
          class="w-4 h-4"
          :class="darkMode ? 'text-purple-400' : 'text-purple-600'"
        />
      </div>
      <h3 class="text-sm font-semibold" :class="darkMode ? 'text-white' : 'text-gray-900'">
        {{ t("admin.fsIndex.chart.title") }}
      </h3>
    </div>

    <!-- 图表容器 -->
    <div
      v-if="isLoading"
      class="h-48 rounded-md animate-pulse"
      :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"
    ></div>
    <div
      v-else-if="!indexStatus || !indexStatus.items || indexStatus.items.length === 0"
      class="h-48 flex flex-col items-center justify-center text-center"
    >
      <IconExclamation
        class="w-8 h-8 mb-2"
        :class="darkMode ? 'text-gray-600' : 'text-gray-400'"
      />
      <p class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
        {{ t("admin.fsIndex.empty.description") }}
      </p>
    </div>
    <div v-else class="relative">
      <!-- 圆环图 -->
      <div class="h-40 flex items-center justify-center">
        <Doughnut
          :data="chartData"
          :options="chartOptions"
        />
      </div>

      <!-- 中心统计 -->
      <div
        class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none"
        style="margin-top: -16px"
      >
        <div class="text-2xl font-bold" :class="darkMode ? 'text-white' : 'text-gray-900'">
          {{ totalMounts }}
        </div>
        <div class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ t("admin.fsIndex.chart.total") }}
        </div>
      </div>

      <!-- 图例 -->
      <div class="mt-4 grid grid-cols-2 gap-2">
        <div
          v-for="item in legendItems"
          :key="item.status"
          class="flex items-center gap-1.5"
        >
          <div
            class="w-3 h-3 rounded-sm flex-shrink-0"
            :style="{ backgroundColor: item.color }"
          ></div>
          <div class="flex-1 min-w-0">
            <p class="text-xs truncate" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
              {{ item.label }} ({{ item.count }})
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { Doughnut } from "vue-chartjs";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";
import {
  IconChartPie,
  IconExclamation,
} from "@/components/icons";
import { getStatusTextKey } from "@/api/services/fsIndexService";

// 注册 Chart.js 组件
ChartJS.register(ArcElement, Tooltip, Legend);

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

// 状态颜色映射
const statusColors = {
  ready: "#10b981", // green-500
  indexing: "#3b82f6", // blue-500
  not_ready: "#f59e0b", // yellow-500
  error: "#ef4444", // red-500
  unknown: "#6b7280", // gray-500
};

// 计算状态分布
const statusDistribution = computed(() => {
  if (!props.indexStatus?.items || props.indexStatus.items.length === 0) {
    return {};
  }

  const distribution = {};
  props.indexStatus.items.forEach((item) => {
    const status = item.status || "unknown";
    distribution[status] = (distribution[status] || 0) + 1;
  });

  return distribution;
});

// 总挂载点数
const totalMounts = computed(() => {
  return props.indexStatus?.items?.length || 0;
});

// 图例项
const legendItems = computed(() => {
  const items = [];
  const dist = statusDistribution.value;

  Object.keys(dist).forEach((status) => {
    items.push({
      status,
      label: t(getStatusTextKey(status)),
      count: dist[status],
      color: statusColors[status] || statusColors.unknown,
    });
  });

  return items;
});

// Chart.js 数据
const chartData = computed(() => {
  const labels = [];
  const data = [];
  const backgroundColor = [];
  const borderColor = [];

  legendItems.value.forEach((item) => {
    labels.push(item.label);
    data.push(item.count);
    backgroundColor.push(item.color);
    borderColor.push(darkMode.value ? "#1f2937" : "#ffffff");
  });

  return {
    labels,
    datasets: [
      {
        data,
        backgroundColor,
        borderColor,
        borderWidth: 2,
        hoverBorderWidth: 3,
        hoverOffset: 4,
      },
    ],
  };
});

// Chart.js 配置
const chartOptions = computed(() => {
  return {
    responsive: true,
    maintainAspectRatio: true,
    cutout: "65%",
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: true,
        backgroundColor: darkMode.value ? "#1f2937" : "#ffffff",
        titleColor: darkMode.value ? "#f9fafb" : "#111827",
        bodyColor: darkMode.value ? "#f9fafb" : "#111827",
        borderColor: darkMode.value ? "#374151" : "#e5e7eb",
        borderWidth: 1,
        padding: 8,
        cornerRadius: 6,
        displayColors: true,
        callbacks: {
          label: function (context) {
            const label = context.label || "";
            const value = context.parsed || 0;
            const total = context.dataset.data.reduce((a, b) => a + b, 0);
            const percentage = ((value / total) * 100).toFixed(1);
            return `${label}: ${value} (${percentage}%)`;
          },
        },
      },
    },
    animation: {
      animateRotate: true,
      animateScale: true,
      duration: 600,
      easing: "easeInOutQuart",
    },
  };
});
</script>

<style scoped>
canvas {
  max-height: 160px;
}
</style>
