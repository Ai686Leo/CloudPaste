<template>
  <Teleport to="body">
    <!-- 遮罩层 -->
    <Transition
      enter-active-class="transition-opacity duration-300"
      leave-active-class="transition-opacity duration-300"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
        @click="$emit('close')"
      />
    </Transition>

    <!-- 抽屉主体 -->
    <!-- 移动端：从底部滑入 | 桌面端：从右侧滑入 -->
    <Transition
      :enter-active-class="isMobile ? 'transition-transform duration-300 ease-out' : 'transition-transform duration-300'"
      :leave-active-class="isMobile ? 'transition-transform duration-300 ease-in' : 'transition-transform duration-300'"
      :enter-from-class="isMobile ? 'translate-y-full' : 'translate-x-full'"
      :leave-to-class="isMobile ? 'translate-y-full' : 'translate-x-full'"
    >
      <div
        v-if="open"
        ref="drawerRef"
        class="fixed bg-white dark:bg-gray-800 shadow-2xl z-50 flex flex-col"
        :class="[
          isMobile
            ? 'inset-x-0 bottom-0 h-[95vh] rounded-t-2xl'
            : 'right-0 top-0 h-full w-[480px] lg:w-[540px]'
        ]"
        :style="drawerStyle"
      >
        <!-- === 移动端拖拽指示条 === -->
        <div
          v-if="isMobile"
          class="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing shrink-0"
          @touchstart="onGrabHandleTouchStart"
        >
          <div class="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
        </div>

        <!-- === 抽屉头部 === -->
        <div
          class="px-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-900 shrink-0"
          :class="isMobile ? 'py-2' : 'py-3'"
        >
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <!-- 任务图标 -->
            <div :class="getTaskIconWrapperClass(task?.taskType)">
              <component :is="getTaskIcon(task?.taskType)" class="w-5 h-5" />
            </div>
            <!-- 任务名称 + ID -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <h2 class="text-base font-bold text-gray-900 dark:text-gray-100 capitalize truncate">
                  {{ formatTaskType(task?.taskType) }}
                </h2>
                <StatusBadge v-if="task?.status" :status="task.status" size="sm" />
              </div>
              <p class="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5 truncate">
                {{ task?.jobId }}
              </p>
            </div>
          </div>
          <!-- 关闭按钮 -->
          <button
            @click="$emit('close')"
            class="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors flex-shrink-0"
            :title="t('common.close')"
          >
            <XIcon class="w-5 h-5" />
          </button>
        </div>

        <!-- === 抽屉内容（可滚动） === -->
        <div ref="contentRef" class="flex-1 overflow-y-auto overscroll-contain">
          <div v-if="task" class="p-4 space-y-4">
            <!-- === 执行时间线（紧凑单行） === -->
            <div v-if="task.startedAt || task.finishedAt" class="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
              <ClockIcon class="w-4 h-4 flex-shrink-0" />
              <div class="flex items-center gap-2 flex-wrap">
                <span v-if="task.startedAt" class="flex items-center gap-1">
                  <span class="text-gray-500 dark:text-gray-500">{{ t('admin.tasks.timeline.start') }}:</span>
                  <span class="font-mono text-gray-900 dark:text-gray-100">{{ formatTimestamp(task.startedAt) }}</span>
                </span>
                <span v-if="task.startedAt && task.finishedAt" class="text-gray-400">→</span>
                <span v-if="task.finishedAt" class="flex items-center gap-1">
                  <span class="text-gray-500 dark:text-gray-500">{{ t('admin.tasks.timeline.finish') }}:</span>
                  <span class="font-mono text-gray-900 dark:text-gray-100">{{ formatTimestamp(task.finishedAt) }}</span>
                </span>
                <span v-if="task.startedAt && task.finishedAt" class="text-gray-400">|</span>
                <span v-if="task.startedAt && task.finishedAt" class="flex items-center gap-1">
                  <span class="text-gray-500 dark:text-gray-500">{{ t('admin.tasks.timeline.duration') }}:</span>
                  <span class="font-mono font-medium text-gray-900 dark:text-gray-100">{{ calculateDuration(task.startedAt, task.finishedAt) }}</span>
                </span>
              </div>
            </div>

            <!-- === 任务特定详情区域（动态组件）- 核心内容 === -->
            <component
              :is="getTaskDetailsComponent(task.taskType)"
              v-if="getTaskDetailsComponent(task.taskType)"
              :task="task"
              @retry-all-failed="$emit('retry-all-failed', $event)"
              @retry-file="$emit('retry-file', $event)"
            />

            <!-- === 错误信息（如果有） === -->
            <div v-if="task.error" class="space-y-2">
              <label class="text-xs font-semibold text-red-500 dark:text-red-400 uppercase tracking-wider">
                {{ t('admin.tasks.details.errorInfo') }}
              </label>
              <div class="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                <p class="text-sm text-red-700 dark:text-red-400 font-mono break-words">
                  {{ task.error }}
                </p>
              </div>
            </div>

            <!-- === 触发引用（如果有） === -->
            <div v-if="task.triggerRef" class="space-y-2">
              <label class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {{ t('admin.tasks.details.triggerRef') }}
              </label>
              <div class="bg-gray-50 dark:bg-gray-900 p-3 rounded-lg border border-gray-200 dark:border-gray-600">
                <p class="text-sm text-gray-700 dark:text-gray-300 font-mono break-all">
                  {{ task.triggerRef }}
                </p>
              </div>
            </div>

            <!-- === Payload（可折叠面板） === -->
            <div v-if="task.payload" class="space-y-2">
              <button
                @click="payloadExpanded = !payloadExpanded"
                class="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
              >
                <ChevronIcon
                  :class="['w-4 h-4 transition-transform duration-200', payloadExpanded ? 'rotate-90' : '']"
                />
                {{ t('admin.tasks.details.payload') }}
              </button>
              <Transition
                enter-active-class="transition-all duration-200 ease-out"
                leave-active-class="transition-all duration-200 ease-in"
                enter-from-class="opacity-0 max-h-0"
                enter-to-class="opacity-100 max-h-[500px]"
                leave-from-class="opacity-100 max-h-[500px]"
                leave-to-class="opacity-0 max-h-0"
              >
                <div v-if="payloadExpanded" class="overflow-hidden">
                  <div class="bg-gray-900 dark:bg-gray-950 p-3 rounded-lg overflow-x-auto">
                    <pre class="text-xs text-gray-100 dark:text-gray-200 font-mono">{{ formatJSON(task.payload) }}</pre>
                  </div>
                </div>
              </Transition>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBreakpoints, breakpointsTailwind, useSwipe } from '@vueuse/core'
import {
  IconX as XIcon,
  IconClock as ClockIcon,
  IconSync as SyncIcon,
  IconCopy as CopyIcon,
  IconDatabase as DatabaseIcon,
  IconChevronRight as ChevronIcon
} from '@/components/icons'
import StatusBadge from './StatusBadge.vue'
import TaskDetailsCopy from './details/TaskDetailsCopy.vue'
import TaskDetailsFsIndexRebuild from './details/TaskDetailsFsIndexRebuild.vue'
import TaskDetailsFsIndexApplyDirty from './details/TaskDetailsFsIndexApplyDirty.vue'

const props = defineProps({
  task: {
    type: Object,
    default: null
  },
  open: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'retry-all-failed', 'retry-file'])

const { t, locale } = useI18n()

// === 响应式状态 ===
const payloadExpanded = ref(false)
const drawerRef = ref(null)
const contentRef = ref(null)

// 移动端检测 (sm breakpoint = 640px)
const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('sm')

// === 滑动关闭手势状态 ===
const isFromGrabHandle = ref(false)
const swipeAllowed = ref(false)

const getSwipeDeltaY = (coordsStart, coordsEnd) => {
  const startY = coordsStart?.y ?? 0
  const endY = coordsEnd?.y ?? 0
  return endY - startY
}

const { isSwiping, coordsStart, coordsEnd } = useSwipe(drawerRef, {
  passive: false,
  threshold: 100,
  onSwipeStart: () => {
    if (!isMobile.value) return

    // 检查内容是否在顶部（允许从顶部下拉关闭）
    const content = contentRef.value
    const isAtTop = !content || content.scrollTop <= 0

    // 只有从拖拽条开始或内容在顶部时才允许拖拽关闭
    swipeAllowed.value = isFromGrabHandle.value || isAtTop
  },
  onSwipe: (e) => {
    if (!isMobile.value || !swipeAllowed.value) return
    const deltaY = getSwipeDeltaY(coordsStart, coordsEnd)
    if (deltaY > 0) {
      // 下拉时阻止内容滚动
      e.preventDefault()
    }
  },
  onSwipeEnd: (_e, direction) => {
    if (!isMobile.value || !swipeAllowed.value) {
      swipeAllowed.value = false
      isFromGrabHandle.value = false
      return
    }

    const deltaY = getSwipeDeltaY(coordsStart, coordsEnd)
    const threshold = 100 // 下拉超过 100px 触发关闭

    if (direction === 'down' && deltaY > threshold) {
      emit('close')
    }

    // 重置状态
    swipeAllowed.value = false
    isFromGrabHandle.value = false
  }
})

// 拖拽偏移样式
const drawerStyle = computed(() => {
  if (!isMobile.value || !isSwiping.value || !swipeAllowed.value) return {}
  const deltaY = Math.max(0, getSwipeDeltaY(coordsStart, coordsEnd))
  if (deltaY <= 0) return {}
  return {
    transform: `translateY(${deltaY}px)`,
    transition: 'none'
  }
})

// === 触摸事件处理 ===
const onGrabHandleTouchStart = () => {
  isFromGrabHandle.value = true
}

// 打开时重置状态
watch(() => props.open, (newVal) => {
  if (newVal) {
    swipeAllowed.value = false
    isFromGrabHandle.value = false
  }
})

// === 工具函数 ===
const formatTaskType = (type) => {
  if (!type) return t('admin.tasks.taskType.unknown')
  const typeMap = {
    copy: t('admin.tasks.taskType.copy'),
    fs_index_rebuild: t('admin.tasks.taskType.fs_index_rebuild'),
    fs_index_apply_dirty: t('admin.tasks.taskType.fs_index_apply_dirty')
  }
  return typeMap[type] || t('admin.tasks.taskType.unknownWithType', { type })
}

const getTaskIcon = (type) => {
  if (!type) return SyncIcon
  if (type.includes('copy')) return CopyIcon
  if (type.includes('index')) return DatabaseIcon
  return SyncIcon
}

const getTaskIconWrapperClass = (type) => {
  const baseClass = 'p-2 rounded-lg border flex-shrink-0'
  if (!type) return `${baseClass} text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600`
  if (type.includes('copy')) return `${baseClass} text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800`
  if (type.includes('index')) return `${baseClass} text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800`
  return `${baseClass} text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600`
}

const getTaskDetailsComponent = (taskType) => {
  const componentMap = {
    copy: TaskDetailsCopy,
    fs_index_rebuild: TaskDetailsFsIndexRebuild,
    fs_index_apply_dirty: TaskDetailsFsIndexApplyDirty
  }
  return componentMap[taskType] || null
}

const formatTimestamp = (timestamp) => {
  if (!timestamp) return '-'
  const date = new Date(timestamp)
  return date.toLocaleString(locale.value, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

const calculateDuration = (startTimestamp, endTimestamp) => {
  if (!startTimestamp || !endTimestamp) return '-'
  const duration = new Date(endTimestamp) - new Date(startTimestamp)
  const seconds = Math.floor(duration / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}

const formatJSON = (obj) => {
  try {
    if (typeof obj === 'string') {
      return JSON.stringify(JSON.parse(obj), null, 2)
    }
    return JSON.stringify(obj, null, 2)
  } catch (e) {
    return String(obj)
  }
}
</script>
