<template>
  <!-- 模式1: 已知总数 - 百分比进度条 -->
  <div v-if="hasKnownTotal" class="w-24 flex flex-col gap-1">
    <div class="flex justify-between text-[10px] text-gray-500 dark:text-gray-400">
      <span>{{ progressPercent }}%</span>
      <span v-if="task.status === 'running'" class="animate-pulse text-blue-500 dark:text-blue-400">...</span>
    </div>
    <div class="flex h-1.5 w-full rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700">
      <div
        :style="{ width: `${successPercent}%` }"
        class="bg-emerald-500 dark:bg-emerald-600 transition-all duration-300"
      />
      <div
        :style="{ width: `${skippedPercent}%` }"
        class="bg-amber-400 dark:bg-amber-500 transition-all duration-300"
      />
      <div
        :style="{ width: `${failedPercent}%` }"
        class="bg-red-500 dark:bg-red-600 transition-all duration-300"
      />
    </div>
  </div>

  <!-- 模式2: 动态任务 - 迷你进度条 -->
  <div v-else-if="hasDynamicStats" class="w-24 flex flex-col gap-1">
    <div class="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
      <span v-if="dynamicDisplayCount > 0">{{ t('admin.tasks.progress.items', { count: dynamicDisplayCount }) }}</span>
      <span v-if="task.status === 'running'" class="animate-pulse text-blue-500 dark:text-blue-400">...</span>
    </div>
    <!-- 迷你分段进度条（基于成功/失败/跳过比例） -->
    <div v-if="dynamicTotal > 0" class="flex h-1 w-full rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700">
      <div
        :style="{ width: `${dynamicSuccessPercent}%` }"
        class="bg-emerald-500 dark:bg-emerald-600 transition-all duration-300"
      />
      <div
        :style="{ width: `${dynamicSkippedPercent}%` }"
        class="bg-amber-400 dark:bg-amber-500 transition-all duration-300"
      />
      <div
        :style="{ width: `${dynamicFailedPercent}%` }"
        class="bg-red-500 dark:bg-red-600 transition-all duration-300"
      />
    </div>
    <!-- 运行中但无结果时显示不确定进度条 -->
    <div v-else-if="task.status === 'running'" class="h-1 w-full rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700">
      <div class="h-full w-1/3 bg-blue-500 dark:bg-blue-400 rounded-full animate-indeterminate" />
    </div>
  </div>

  <!-- 模式3: 无统计数据 -->
  <div v-else class="text-xs text-gray-400 dark:text-gray-500">{{ t('admin.tasks.progress.empty') }}</div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  task: {
    type: Object,
    required: true
  }
})

const { t } = useI18n()

// 已知总数模式：totalItems > 0
const hasKnownTotal = computed(() => {
  return props.task.stats && props.task.stats.totalItems && props.task.stats.totalItems > 0
})

// 动态模式：没有总数但有处理统计或 itemResults
const hasDynamicStats = computed(() => {
  if (hasKnownTotal.value) return false
  const stats = props.task.stats
  if (!stats) return false
  return (
    stats.successCount > 0 ||
    stats.failedCount > 0 ||
    stats.skippedCount > 0 ||
    stats.processedItems > 0 ||
    (Array.isArray(stats.itemResults) && stats.itemResults.length > 0)
  )
})

// 基础统计
const total = computed(() => props.task.stats?.totalItems || 0)
const processed = computed(() => props.task.stats?.processedItems || 0)
const success = computed(() => props.task.stats?.successCount || 0)
const failed = computed(() => props.task.stats?.failedCount || 0)
const skipped = computed(() => props.task.stats?.skippedCount || 0)
const itemResultsCount = computed(() => {
  const results = props.task.stats?.itemResults
  return Array.isArray(results) ? results.length : 0
})

// 已知总数模式的百分比计算
const progressPercent = computed(() => {
  if (total.value === 0) return 0
  return Math.round((processed.value / total.value) * 100)
})

const successPercent = computed(() => {
  if (total.value === 0) return 0
  return (success.value / total.value) * 100
})

const skippedPercent = computed(() => {
  if (total.value === 0) return 0
  return (skipped.value / total.value) * 100
})

const failedPercent = computed(() => {
  if (total.value === 0) return 0
  return (failed.value / total.value) * 100
})

// 动态模式的百分比计算（基于 processedItems 或 successCount+failedCount+skippedCount）
const dynamicTotal = computed(() => {
  if (processed.value > 0) return processed.value
  const sum = success.value + failed.value + skipped.value
  return sum > 0 ? sum : 0
})

const dynamicDisplayCount = computed(() => {
  if (processed.value > 0) return processed.value
  if (itemResultsCount.value > 0) return itemResultsCount.value
  return 0
})

const dynamicSuccessPercent = computed(() => {
  if (dynamicTotal.value === 0) return 0
  return (success.value / dynamicTotal.value) * 100
})

const dynamicSkippedPercent = computed(() => {
  if (dynamicTotal.value === 0) return 0
  return (skipped.value / dynamicTotal.value) * 100
})

const dynamicFailedPercent = computed(() => {
  if (dynamicTotal.value === 0) return 0
  return (failed.value / dynamicTotal.value) * 100
})
</script>

<style scoped>
@keyframes indeterminate {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(400%);
  }
}

.animate-indeterminate {
  animation: indeterminate 1.5s ease-in-out infinite;
}
</style>
