<template>
  <div class="space-y-4">
    <!-- 顶部统计区 -->
    <div class="flex items-center justify-between">
      <h3 class="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 text-sm">
        <IconDatabase class="w-4 h-4" />
        <span>{{ t('admin.tasks.indexDetails.rebuildTitle') }}</span>
      </h3>
      <div class="flex items-center gap-3 text-xs">
        <!-- 总进度 -->
        <span class="text-gray-600 dark:text-gray-400">
          <span class="font-semibold text-gray-900 dark:text-gray-100">{{ stats.processedItems || 0 }}</span>
          <span class="mx-0.5">/</span>
          <span>{{ stats.totalItems || 0 }}</span>
          <span class="ml-1">{{ t('admin.tasks.indexDetails.mountUnit') }}</span>
        </span>
        <!-- 状态计数 -->
        <div class="flex items-center gap-2">
          <span v-if="stats.successCount" class="flex items-center gap-1 text-green-600 dark:text-green-400">
            <IconCheck class="w-3 h-3" />
            <span>{{ stats.successCount }}</span>
          </span>
          <span v-if="stats.failedCount" class="flex items-center gap-1 text-red-600 dark:text-red-400">
            <IconClose class="w-3 h-3" />
            <span>{{ stats.failedCount }}</span>
          </span>
          <span v-if="stats.skippedCount" class="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
            <IconMinus class="w-3 h-3" />
            <span>{{ stats.skippedCount }}</span>
          </span>
        </div>
      </div>
    </div>

    <!-- 实时进度条（任务进行中时显示） -->
    <div v-if="isRunning && stats.totalItems > 0" class="relative">
      <div class="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          class="h-full bg-blue-500 dark:bg-blue-400 transition-all duration-300 ease-out"
          :style="{ width: `${progressPercent}%` }"
        ></div>
      </div>
    </div>

    <!-- 挂载点列表 -->
    <div v-if="itemResults.length > 0" class="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
      <div
        v-for="(item, index) in itemResults"
        :key="index"
        class="rounded-lg border transition-all duration-200 overflow-hidden"
        :class="getItemContainerClass(item)"
      >
        <!-- 紧凑卡片头部（可点击展开） -->
        <div
          class="flex items-center gap-2.5 px-3 py-2 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-800/50"
          @click="toggleExpand(index)"
        >
          <!-- 状态图标 -->
          <span class="flex-shrink-0">
            <span
              v-if="item.status === 'success'"
              class="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center"
            >
              <IconCheck class="w-3 h-3 text-white" />
            </span>
            <span
              v-else-if="item.status === 'processing'"
              class="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center animate-pulse"
            >
              <IconRefresh class="w-3 h-3 text-white animate-spin" />
            </span>
            <span
              v-else-if="item.status === 'failed'"
              class="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center"
            >
              <IconClose class="w-3 h-3 text-white" />
            </span>
            <span
              v-else-if="item.status === 'skipped'"
              class="w-5 h-5 rounded-full bg-yellow-500 flex items-center justify-center"
            >
              <IconMinus class="w-3 h-3 text-white" />
            </span>
            <span
              v-else
              class="w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 flex items-center justify-center"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500"></span>
            </span>
          </span>

         <!-- 挂载路径 -->
         <span class="flex-1 min-w-0 font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
            {{ item.mountName || item.mountPath || item.label || item.sourcePath || t('admin.tasks.indexDetails.unknownMount') }}
          </span>

          <!-- 关键统计（紧凑显示） -->
          <div class="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            <span v-if="getDiscoveredCount(item) > 0" class="flex items-center gap-1">
              <IconFolder class="w-3.5 h-3.5" />
              <span class="font-medium text-gray-700 dark:text-gray-300">{{ formatNumber(getDiscoveredCount(item)) }}</span>
            </span>
            <span v-if="getUpsertedCount(item) > 0" class="flex items-center gap-1">
              <IconDatabase class="w-3.5 h-3.5" />
              <span class="font-medium text-gray-700 dark:text-gray-300">{{ formatNumber(getUpsertedCount(item)) }}</span>
            </span>
            <span v-if="item.durationMs" class="font-mono">
              {{ formatDuration(item.durationMs) }}
            </span>
          </div>

          <!-- 展开/收起指示器 -->
          <IconChevronDown
            class="w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 flex-shrink-0"
            :class="{ 'rotate-180': expandedItems.has(index) }"
          />
        </div>

        <!-- 展开详情 -->
        <Transition
          enter-active-class="transition-all duration-200 ease-out"
          enter-from-class="opacity-0 max-h-0"
          enter-to-class="opacity-100 max-h-96"
          leave-active-class="transition-all duration-150 ease-in"
          leave-from-class="opacity-100 max-h-96"
          leave-to-class="opacity-0 max-h-0"
        >
          <div v-if="expandedItems.has(index)" class="overflow-hidden">
            <div class="px-3 pb-3 pt-1 border-t border-gray-100 dark:border-gray-700/50">
              <!-- 详细统计网格 -->
              <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <!-- 发现数 -->
                <div class="flex items-center justify-between">
                  <span class="text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    <IconFolder class="w-3.5 h-3.5" />
                    {{ t('admin.tasks.indexDetails.discovered') }}
                  </span>
                  <span class="font-medium text-gray-900 dark:text-gray-100">
                    {{ formatNumber(getDiscoveredCount(item)) }}
                  </span>
                </div>
                <!-- 索引数 -->
                <div class="flex items-center justify-between">
                  <span class="text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    <IconDatabase class="w-3.5 h-3.5" />
                    {{ t('admin.tasks.indexDetails.upserted') }}
                  </span>
                  <span class="font-medium text-gray-900 dark:text-gray-100">
                    {{ formatNumber(getUpsertedCount(item)) }}
                  </span>
                </div>
                <!-- 耗时 -->
                <div v-if="item.durationMs" class="flex items-center justify-between">
                  <span class="text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    <IconClock class="w-3.5 h-3.5" />
                    {{ t('admin.tasks.indexDetails.duration') }}
                  </span>
                  <span class="font-medium font-mono text-gray-900 dark:text-gray-100">
                    {{ formatDuration(item.durationMs) }}
                  </span>
                </div>
                <!-- 源路径（如果与label不同） -->
                <div v-if="item.sourcePath && item.sourcePath !== item.label" class="col-span-2 flex items-start gap-1.5">
                  <span class="text-gray-500 dark:text-gray-400 flex-shrink-0">{{ t('admin.tasks.indexDetails.path') }}:</span>
                  <span class="font-mono text-gray-700 dark:text-gray-300 break-all">{{ item.sourcePath }}</span>
                </div>
              </div>

              <!-- 实时进度（处理中时显示） -->
              <div
                v-if="item.status === 'processing' && hasRealtimeData"
                class="mt-3 p-2 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50"
              >
                <div class="flex items-center gap-2 mb-2">
                  <span class="relative flex h-2 w-2">
                    <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span class="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                  </span>
                  <span class="text-xs font-medium text-blue-700 dark:text-blue-300">{{ t('admin.tasks.indexDetails.realtime') }}</span>
                </div>
                <div class="grid grid-cols-3 gap-2 text-xs">
                  <div class="text-center">
                    <div class="font-semibold text-blue-900 dark:text-blue-100">{{ formatNumber(stats.scannedDirs || 0) }}</div>
                    <div class="text-blue-600 dark:text-blue-400">{{ t('admin.tasks.indexDetails.scannedDirs') }}</div>
                  </div>
                  <div class="text-center">
                    <div class="font-semibold text-blue-900 dark:text-blue-100">{{ formatNumber(stats.discoveredCount || 0) }}</div>
                    <div class="text-blue-600 dark:text-blue-400">{{ t('admin.tasks.indexDetails.discoveredShort') }}</div>
                  </div>
                  <div class="text-center">
                    <div class="font-semibold text-blue-900 dark:text-blue-100">{{ formatNumber(stats.pendingCount || 0) }}</div>
                    <div class="text-blue-600 dark:text-blue-400">{{ t('admin.tasks.indexDetails.pending') }}</div>
                  </div>
                </div>
              </div>

              <!-- 错误信息 -->
              <div
                v-if="item.status === 'failed' && item.error"
                class="mt-3 flex items-start gap-2 p-2 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/50"
              >
                <IconExclamation class="w-4 h-4 text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <span class="flex-1 min-w-0 text-xs text-red-700 dark:text-red-300 break-words">{{ item.error }}</span>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="text-center py-8 text-gray-500 dark:text-gray-400">
      <IconDatabase class="w-10 h-10 mx-auto mb-2 opacity-40" />
      <p class="text-sm">{{ t('admin.tasks.indexDetails.noMounts') }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  IconDatabase,
  IconCheck,
  IconClose,
  IconRefresh,
  IconExclamation,
  IconFolder,
  IconChevronDown,
  IconClock,
  IconMinus
} from '@/components/icons'

const props = defineProps({
  task: {
    type: Object,
    required: true
  }
})

const { t } = useI18n()
// 展开状态管理
const expandedItems = ref(new Set())

// 统计信息
const stats = computed(() => props.task.stats || {})

// 挂载点结果列表
const itemResults = computed(() => props.task.stats?.itemResults || [])

// 任务是否正在运行
const isRunning = computed(() => {
  const status = props.task.status
  return status === 'running' || status === 'pending'
})

// 是否有实时数据
const hasRealtimeData = computed(() => {
  const s = stats.value
  return s.scannedDirs !== undefined || s.discoveredCount !== undefined || s.pendingCount !== undefined
})

// 进度百分比
const progressPercent = computed(() => {
  const total = stats.value.totalItems || 0
  const processed = stats.value.processedItems || 0
  if (total === 0) return 0
  return Math.min(100, Math.round((processed / total) * 100))
})

// 获取发现数（优先使用meta，回退到stats）
const getDiscoveredCount = (item) => {
  if (item.discoveredCount !== undefined) {
    return item.discoveredCount
  }
  if (item.meta?.discoveredCount !== undefined) {
    return item.meta.discoveredCount
  }
  if (item.status === 'processing' && stats.value.discoveredCount !== undefined) {
    return stats.value.discoveredCount
  }
  return 0
}

// 获取索引数（优先使用meta，回退到stats）
const getUpsertedCount = (item) => {
  if (item.upsertedCount !== undefined) {
    return item.upsertedCount
  }
  if (item.meta?.upsertedCount !== undefined) {
    return item.meta.upsertedCount
  }
  if (item.status === 'processing' && stats.value.upsertedCount !== undefined) {
    return stats.value.upsertedCount
  }
  return 0
}

// 切换展开状态
const toggleExpand = (index) => {
  if (expandedItems.value.has(index)) {
    expandedItems.value.delete(index)
  } else {
    expandedItems.value.add(index)
  }
}

// 格式化数字（添加千分位）
const formatNumber = (num) => {
  if (num === undefined || num === null) return '0'
  return num.toLocaleString()
}

// 格式化耗时
const formatDuration = (ms) => {
  if (!ms) return ''
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) {
    const seconds = (ms / 1000).toFixed(1)
    return `${seconds}s`
  }
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

// 获取容器样式
const getItemContainerClass = (item) => {
  const baseClass = 'bg-white dark:bg-gray-800/50'
  const statusClasses = {
    success: 'border-green-200 dark:border-green-800/50',
    processing: 'border-blue-300 dark:border-blue-700/50 ring-1 ring-blue-200 dark:ring-blue-800/30',
    failed: 'border-red-200 dark:border-red-800/50',
    skipped: 'border-yellow-200 dark:border-yellow-800/50',
    pending: 'border-gray-200 dark:border-gray-700'
  }
  return `${baseClass} ${statusClasses[item.status] || statusClasses.pending}`
}
</script>
