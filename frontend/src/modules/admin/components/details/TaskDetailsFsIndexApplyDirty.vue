<template>
  <div class="space-y-4">
    <!-- 顶部统计区（与rebuild风格统一） -->
    <div class="flex items-center justify-between">
      <h3 class="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 text-sm">
        <IconQueueList class="w-4 h-4" />
        <span>{{ t('admin.tasks.indexDetails.applyDirtyTitle') }}</span>
      </h3>
      <div class="flex items-center gap-3 text-xs">
        <!-- 总队列数 -->
        <span class="text-gray-600 dark:text-gray-400">
          <span class="font-semibold text-gray-900 dark:text-gray-100">{{ stats.totalDirtyProcessed || 0 }}</span>
          <span class="ml-1">{{ t('admin.tasks.indexDetails.queueUnit') }}</span>
        </span>
        <!-- 状态计数（与rebuild统一：成功/失败/跳过） -->
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

    <!-- 实时进度条（任务进行中时显示，与rebuild统一） -->
    <div v-if="isProcessing && stats.totalItems > 0" class="relative">
      <div class="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          class="h-full bg-blue-500 dark:bg-blue-400 transition-all duration-300 ease-out"
          :style="{ width: `${progressPercent}%` }"
        ></div>
      </div>
    </div>

    <!-- 挂载点列表（与rebuild风格统一：紧凑卡片） -->
    <div v-if="mountItems.length > 0" class="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
      <div
        v-for="mount in mountItems"
        :key="mount.mountId"
        class="rounded-lg border transition-all duration-200 overflow-hidden"
        :class="getItemContainerClass(mount)"
      >
        <!-- 紧凑卡片头部（可点击展开） -->
        <div
          class="flex items-center gap-2.5 px-3 py-2 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-800/50"
          @click="toggleExpand(mount.mountId)"
        >
          <!-- 状态图标 -->
          <span class="flex-shrink-0">
            <span
              v-if="mount.status === 'success'"
              class="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center"
            >
              <IconCheck class="w-3 h-3 text-white" />
            </span>
            <span
              v-else-if="mount.status === 'processing'"
              class="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center animate-pulse"
            >
              <IconRefresh class="w-3 h-3 text-white animate-spin" />
            </span>
            <span
              v-else-if="mount.status === 'failed'"
              class="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center"
            >
              <IconClose class="w-3 h-3 text-white" />
            </span>
            <span
              v-else-if="mount.status === 'skipped'"
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

          <!-- 挂载点名称 -->
          <span class="flex-1 min-w-0 font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
            {{ mount.mountName || mount.mountPath || t('admin.tasks.indexDetails.unknownMount') }}
          </span>

          <!-- 关键统计（与rebuild风格统一：队列+更新+删除+耗时，带图标） -->
          <div class="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            <span v-if="mount.processedDirtyCount" class="flex items-center gap-1">
              <IconQueueList class="w-3.5 h-3.5" />
              <span class="font-medium text-gray-700 dark:text-gray-300">{{ mount.processedDirtyCount }}</span>
            </span>
            <span v-if="mount.upsertedCount" class="flex items-center gap-1">
              <IconArrowUp class="w-3.5 h-3.5 text-emerald-500" />
              <span class="font-medium text-emerald-600 dark:text-emerald-400">{{ mount.upsertedCount }}</span>
            </span>
            <span v-if="mount.deletedCount" class="flex items-center gap-1">
              <IconTrash class="w-3.5 h-3.5 text-red-500" />
              <span class="font-medium text-red-600 dark:text-red-400">{{ mount.deletedCount }}</span>
            </span>
            <span v-if="mount.durationMs" class="flex items-center gap-1">
              <IconClock class="w-3.5 h-3.5" />
              <span class="font-mono">{{ formatDuration(mount.durationMs) }}</span>
            </span>
          </div>

          <!-- 展开/收起指示器 -->
          <IconChevronDown
            class="w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 flex-shrink-0"
            :class="{ 'rotate-180': expandedMounts.has(mount.mountId) }"
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
          <div v-if="expandedMounts.has(mount.mountId)" class="overflow-hidden">
            <div class="px-3 pb-3 pt-1 border-t border-gray-100 dark:border-gray-700/50">
              <!-- 详细统计网格 -->
              <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div class="flex items-center justify-between">
                  <span class="text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    <IconQueueList class="w-3.5 h-3.5" />
                    {{ t('admin.tasks.indexDetails.queueProcessed') }}
                  </span>
                  <span class="font-medium text-gray-900 dark:text-gray-100">
                    {{ mount.processedDirtyCount || 0 }}
                  </span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    <IconArrowUp class="w-3.5 h-3.5" />
                    {{ t('admin.tasks.indexDetails.updated') }}
                  </span>
                  <span class="font-medium text-emerald-600 dark:text-emerald-400">
                    {{ mount.upsertedCount || 0 }}
                  </span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    <IconTrash class="w-3.5 h-3.5" />
                    {{ t('admin.tasks.indexDetails.deleted') }}
                  </span>
                  <span class="font-medium text-red-600 dark:text-red-400">
                    {{ mount.deletedCount || 0 }}
                  </span>
                </div>
                <div v-if="mount.skippedCount > 0" class="flex items-center justify-between">
                  <span class="text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    <IconMinus class="w-3.5 h-3.5" />
                    {{ t('admin.tasks.indexDetails.skipped') }}
                  </span>
                  <span class="font-medium text-yellow-600 dark:text-yellow-400">
                    {{ mount.skippedCount }}
                  </span>
                </div>
                <div v-if="mount.durationMs" class="flex items-center justify-between">
                  <span class="text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    <IconClock class="w-3.5 h-3.5" />
                    {{ t('admin.tasks.indexDetails.duration') }}
                  </span>
                  <span class="font-medium font-mono text-gray-900 dark:text-gray-100">
                    {{ formatDuration(mount.durationMs) }}
                  </span>
                </div>
              </div>

              <!-- 错误信息 -->
              <div
                v-if="mount.status === 'failed' && mount.error"
                class="mt-3 flex items-start gap-2 p-2 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/50"
              >
                <IconExclamation class="w-4 h-4 text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <span class="flex-1 min-w-0 text-xs text-red-700 dark:text-red-300 break-words">{{ getErrorMessage(mount.error) }}</span>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="text-center py-8 text-gray-500 dark:text-gray-400">
      <IconQueueList class="w-10 h-10 mx-auto mb-2 opacity-40" />
      <p class="text-sm">{{ t('admin.tasks.indexDetails.noRecords') }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  IconCheck,
  IconClose,
  IconRefresh,
  IconExclamation,
  IconArrowUp,
  IconTrash,
  IconChevronDown,
  IconQueueList,
  IconMinus,
  IconClock
} from '@/components/icons'

const props = defineProps({
  task: {
    type: Object,
    required: true
  }
})

const { t } = useI18n()
// 展开状态管理
const expandedMounts = ref(new Set())

// 统计信息
const stats = computed(() => props.task.stats || {})

// 处理项结果列表
const itemResults = computed(() => props.task.stats?.itemResults || [])

// 是否正在处理
const isProcessing = computed(() => {
  return props.task.status === 'running' || props.task.status === 'pending'
})

// 进度百分比（与rebuild统一）
const progressPercent = computed(() => {
  const total = stats.value.totalItems || 0
  const processed = stats.value.processedItems || 0
  if (total === 0) return 0
  return Math.min(100, Math.round((processed / total) * 100))
})

// 分离mount类型
const mountItems = computed(() => {
  return itemResults.value.filter(item => item.kind === 'mount' || !item.kind)
})

// 检查是否为当前处理的挂载点
const isCurrentMount = (mountId) => {
  const currentMountId = stats.value.currentMountId
  return isProcessing.value && currentMountId === mountId
}

// 切换展开状态
const toggleExpand = (mountId) => {
  if (expandedMounts.value.has(mountId)) {
    expandedMounts.value.delete(mountId)
  } else {
    expandedMounts.value.add(mountId)
  }
}

// 获取错误消息
const getErrorMessage = (error) => {
  const errorMap = {
    'index_not_ready': t('admin.tasks.indexDetails.errors.indexNotReady'),
    'mount_not_found': t('admin.tasks.indexDetails.errors.mountNotFound'),
    'permission_denied': t('admin.tasks.indexDetails.errors.permissionDenied')
  }
  return errorMap[error] || error
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

// 获取容器样式（与rebuild风格统一）
const getItemContainerClass = (mount) => {
  const baseClass = 'bg-white dark:bg-gray-800/50'
  const statusClasses = {
    success: 'border-green-200 dark:border-green-800/50',
    processing: 'border-blue-300 dark:border-blue-700/50 ring-1 ring-blue-200 dark:ring-blue-800/30',
    failed: 'border-red-200 dark:border-red-800/50',
    skipped: 'border-yellow-200 dark:border-yellow-800/50',
    pending: 'border-gray-200 dark:border-gray-700'
  }
  // 当前处理的挂载点添加高亮
  const currentClass = isCurrentMount(mount.mountId) ? ' ring-2 ring-blue-400 dark:ring-blue-500' : ''
  return `${baseClass} ${statusClasses[mount.status] || statusClasses.pending}${currentClass}`
}
</script>
