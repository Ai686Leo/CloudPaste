<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <CopyIcon class="w-4 h-4" />
        {{ t('admin.tasks.details.fileList') }}
        <span class="text-gray-500 dark:text-gray-400 font-normal">
          ({{ itemResults.length }})
        </span>
      </h3>

      <!-- 重试所有失败按钮 -->
      <button
        v-if="task.allowedActions?.canRetry && failedCount > 0"
        @click="handleRetryAllFailed"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors bg-orange-500 hover:bg-orange-600 dark:bg-orange-600 dark:hover:bg-orange-700 text-white"
      >
        <IconRefresh class="w-4 h-4" />
        {{ t('admin.tasks.actions.retryAllFailed') }} ({{ failedCount }})
      </button>
    </div>

    <!-- 文件列表容器 -->
    <div v-if="itemResults.length > 0" class="space-y-2 max-h-[400px] overflow-y-auto pr-1">
      <div
        v-for="(item, index) in itemResults"
        :key="index"
        class="group relative rounded-lg overflow-hidden transition-all duration-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
      >
        <!-- 背景进度条 -->
        <div
          class="absolute inset-0 transition-all duration-500 ease-out"
          :class="getFileProgressBgClass(item.status)"
          :style="{ width: getFileProgressWidth(item) }"
        ></div>

        <!-- 文件信息内容层（可点击展开） -->
        <div
          class="relative flex items-center gap-3 px-3 py-2.5 text-xs cursor-pointer select-none hover:bg-gray-50/50 dark:hover:bg-gray-700/30"
          @click="toggleExpand(index)"
        >
          <!-- 状态图标 -->
          <span class="flex-shrink-0">
            <!-- 成功 -->
            <span v-if="item.status === 'success'" class="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shadow-sm">
              <IconCheck class="w-3 h-3 text-white" />
            </span>
            <!-- 处理中 -->
            <span v-else-if="item.status === 'processing'" class="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center shadow-sm">
              <IconRefresh class="w-3 h-3 text-white animate-spin" />
            </span>
            <!-- 重试中 -->
            <span v-else-if="item.status === 'retrying'" class="w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center shadow-sm animate-pulse">
              <IconRefresh class="w-3 h-3 text-white" />
            </span>
            <!-- 失败 -->
            <span v-else-if="item.status === 'failed'" class="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center shadow-sm">
              <IconClose class="w-3 h-3 text-white" />
            </span>
            <!-- 跳过 -->
            <span v-else-if="item.status === 'skipped'" class="w-5 h-5 rounded-full bg-yellow-500 flex items-center justify-center shadow-sm">
              <span class="text-white text-xs leading-none">—</span>
            </span>
            <!-- 等待中 -->
            <span v-else class="w-5 h-5 rounded-full border-2 flex items-center justify-center border-gray-300 dark:border-gray-500 bg-gray-100 dark:bg-gray-700">
              <span class="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500"></span>
            </span>
          </span>

          <!-- 文件名 + 重试次数 -->
          <span class="flex-shrink-0 max-w-[200px] flex items-center gap-1">
            <span
              class="truncate font-medium text-gray-800 dark:text-gray-100"
              :title="item.sourcePath"
            >
              {{ extractNameFromPath(item.sourcePath) }}
            </span>
            <!-- 重试次数标记 -->
            <span
            v-if="item.retryCount && item.retryCount > 0"
            class="flex-shrink-0 text-orange-500 text-xs"
            :title="t('admin.tasks.retry.retryCount', { count: item.retryCount })"
          >
            ×{{ item.retryCount }}
          </span>
          </span>

          <!-- 箭头 + 目标路径 -->
          <span class="flex-1 min-w-0 flex items-center gap-1 text-gray-500 dark:text-gray-400">
            <IconChevronRight class="w-3 h-3 flex-shrink-0" />
            <span class="truncate font-mono text-xs" :title="item.targetPath">
              {{ item.targetPath || '...' }}
            </span>
          </span>

          <!-- 文件大小 -->
          <span class="flex-shrink-0 w-20 text-right font-mono text-gray-500 dark:text-gray-400">
            {{ getDisplaySize(item) }}
          </span>

          <!-- 状态徽章 -->
          <span
            class="flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium"
            :class="getFileStatusBadgeClass(item.status)"
          >
            {{ getFileStatusText(item.status) }}
          </span>

          <!-- 单文件重试按钮 -->
          <button
            v-if="task.allowedActions?.canRetry && item.status === 'failed'"
            @click.stop="handleRetryFile(item)"
            class="flex-shrink-0 p-1.5 rounded-md transition-colors bg-orange-500/10 hover:bg-orange-500/20 dark:bg-orange-500/20 dark:hover:bg-orange-500/30 text-orange-600 dark:text-orange-400"
            :title="t('admin.tasks.actions.retryFile')"
          >
            <IconRefresh class="w-4 h-4" />
          </button>

          <!-- 展开/收起指示器 -->
          <IconChevronDown
            class="w-4 h-4 flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-200"
            :class="{ 'rotate-180': expandedItems.has(index) }"
          />
        </div>

        <!-- 展开后的完整路径 -->
        <Transition
          enter-active-class="transition-all duration-200 ease-out"
          enter-from-class="opacity-0 max-h-0"
          enter-to-class="opacity-100 max-h-40"
          leave-active-class="transition-all duration-150 ease-in"
          leave-from-class="opacity-100 max-h-40"
          leave-to-class="opacity-0 max-h-0"
        >
          <div v-if="expandedItems.has(index)" class="overflow-hidden">
            <div class="relative px-3 pb-2 pt-1 space-y-1.5 border-t border-gray-100 dark:border-gray-700/50">
              <!-- 源路径 -->
              <div class="flex items-start gap-2 text-xs">
                <span class="flex-shrink-0 text-gray-500 dark:text-gray-400">{{ t('admin.tasks.details.sourcePath') }}:</span>
                <span class="font-mono text-gray-700 dark:text-gray-300 break-all select-text">{{ item.sourcePath }}</span>
              </div>
              <!-- 目标路径 -->
              <div class="flex items-start gap-2 text-xs">
                <span class="flex-shrink-0 text-gray-500 dark:text-gray-400">{{ t('admin.tasks.details.targetPath') }}:</span>
                <span class="font-mono text-gray-700 dark:text-gray-300 break-all select-text">{{ item.targetPath }}</span>
              </div>
            </div>
          </div>
        </Transition>

        <!-- 错误信息 -->
        <div
          v-if="item.status === 'failed' && item.error"
          class="relative px-3 pb-2 pt-0"
        >
          <div class="flex items-start gap-1.5 px-2 py-1.5 rounded text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300">
            <IconExclamation class="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span class="break-words">{{ item.error }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
      <CopyIcon class="w-8 h-8 mx-auto mb-2 opacity-50" />
      <p>{{ t('admin.tasks.details.noFiles') }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  IconCopy as CopyIcon,
  IconCheck,
  IconClose,
  IconRefresh,
  IconChevronRight,
  IconChevronDown,
  IconExclamation
} from '@/components/icons'

const props = defineProps({
  task: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['retry-all-failed', 'retry-file'])
const { t } = useI18n()

// 展开状态管理
const expandedItems = ref(new Set())

// 切换展开状态
const toggleExpand = (index) => {
  if (expandedItems.value.has(index)) {
    expandedItems.value.delete(index)
  } else {
    expandedItems.value.add(index)
  }
}

// 文件结果列表
const itemResults = computed(() => props.task.stats?.itemResults || [])

// 失败文件数
const failedItems = computed(() => {
  return itemResults.value.filter(item => item.status === 'failed')
})

const failedCount = computed(() => failedItems.value.length)

/**
 * 从路径中提取文件/文件夹名称
 */
const extractNameFromPath = (path) => {
  if (!path || typeof path !== 'string') return ''
  return path.replace(/\/+$/, '').split('/').filter(Boolean).pop() || ''
}

/**
 * 格式化文件大小
 */
const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

/**
 * 获取显示用大小
 */
const getDisplaySize = (item) => {
  if (item?.fileSize) return formatFileSize(item.fileSize)
  if (item?.bytesTransferred) return formatFileSize(item.bytesTransferred)
  return '--'
}

/**
 * 触发重试（全部失败）
 */
const handleRetryAllFailed = () => {
  emit('retry-all-failed', { task: props.task, items: failedItems.value })
}

/**
 * 触发重试（单个文件）
 */
const handleRetryFile = (item) => {
  emit('retry-file', { task: props.task, item })
}

/**
 * 获取文件状态徽章样式
 */
const getFileStatusBadgeClass = (status) => {
  const classes = {
    success: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    retrying: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    skipped: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
    pending: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
  }
  return classes[status] || classes.pending
}

/**
 * 获取文件状态文字
 */
const getFileStatusText = (status) => {
  const textMap = {
    success: t('admin.tasks.fileStatus.success'),
    processing: t('admin.tasks.fileStatus.processing'),
    retrying: t('admin.tasks.fileStatus.retrying'),
    failed: t('admin.tasks.fileStatus.failed'),
    skipped: t('admin.tasks.fileStatus.skipped'),
    pending: t('admin.tasks.fileStatus.pending')
  }
  return textMap[status] || status
}

/**
 * 获取文件进度条背景色
 */
const getFileProgressBgClass = (status) => {
  const classes = {
    success: 'bg-green-500/15 dark:bg-green-500/20',
    processing: 'bg-blue-500/15 dark:bg-blue-500/20',
    retrying: 'bg-orange-500/15 dark:bg-orange-500/20',
    failed: 'bg-red-500/10 dark:bg-red-500/15',
    skipped: 'bg-yellow-500/10 dark:bg-yellow-500/15',
    pending: 'bg-gray-200/50 dark:bg-gray-600/20'
  }
  return classes[status] || classes.pending
}

/**
 * 获取文件进度条宽度
 */
const getFileProgressWidth = (item) => {
  // 成功/失败/跳过 - 100%
  if (['success', 'failed', 'skipped'].includes(item.status)) {
    return '100%'
  }
  // 处理中或重试中
  if (item.status === 'processing' || item.status === 'retrying') {
    // 优先使用 progress 字段
    if (item.progress !== undefined && item.progress > 0) {
      return `${Math.min(100, Math.max(5, item.progress))}%`
    }
    // 使用 bytesTransferred 计算进度
    if (item.bytesTransferred > 0 && item.fileSize > 0) {
      const progress = Math.round((item.bytesTransferred / item.fileSize) * 100)
      return `${Math.min(100, Math.max(5, progress))}%`
    }
    // 有字节传输但没有总大小
    if (item.bytesTransferred > 0) {
      return '50%'
    }
    // 等待开始传输
    return '10%'
  }
  // 等待中
  return '0%'
}
</script>
