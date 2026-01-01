<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-[60] overflow-hidden bg-black bg-opacity-50 flex items-center justify-center p-2 sm:p-4"
    @click.self="close"
    @keydown.esc="close"
  >
    <div
      class="relative w-full bg-white dark:bg-gray-800 rounded-lg shadow-xl flex flex-col"
      style="max-width: 480px; max-height: 420px"
    >
      <!-- 固定头部 -->
      <div
        class="flex-shrink-0 px-4 py-3 border-b flex justify-between items-center"
        :class="darkMode ? 'border-gray-700' : 'border-gray-200'"
      >
        <div class="flex items-center space-x-2">
          <h3 class="text-base font-medium" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">
            {{ t('mount.taskList.title') }}
          </h3>
          <span
            v-if="tasks.length > 0"
            class="text-xs px-1.5 py-0.5 rounded-full"
            :class="darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'"
          >
            {{ tasks.length }}
          </span>
          <!-- 跳转到任务管理 -->
          <button
            @click="goToTaskManagement"
            class="p-1.5 rounded transition-colors duration-150"
            :class="darkMode ? 'hover:bg-gray-700 text-gray-500 hover:text-blue-400' : 'hover:bg-gray-100 text-gray-400 hover:text-blue-600'"
            :title="t('mount.taskList.viewFullManagement')"
          >
            <IconExternalLink aria-hidden="true" />
          </button>
        </div>
        <div class="flex items-center space-x-1">
          <!-- 刷新按钮 -->
          <button
            @click="loadTasks"
            :disabled="isLoading"
            class="p-2 rounded-full transition-colors duration-150"
            :class="darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'"
            :title="t('mount.operations.refresh')"
          >
            <IconRefresh :class="{ 'animate-spin': isLoading }" aria-hidden="true" />
          </button>
          <!-- 关闭按钮 -->
          <button
            @click="close"
            class="p-2 rounded-full transition-colors duration-150"
            :class="darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'"
          >
            <IconClose aria-hidden="true" />
          </button>
        </div>
      </div>

      <!-- 滚动内容区 -->
      <div class="flex-1 overflow-y-auto" style="max-height: 360px">
        <!-- 加载状态 -->
        <div v-if="isLoading && tasks.length === 0" class="text-center py-10">
          <IconRefresh size="lg" class="animate-spin mx-auto" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" aria-hidden="true" />
          <p class="mt-2 text-xs" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
            {{ t('mount.taskList.loading') }}
          </p>
        </div>

        <!-- 空状态 -->
        <div v-else-if="tasks.length === 0" class="text-center py-10 px-4">
          <IconTaskList size="2xl" class="mx-auto mb-2 opacity-30" :class="darkMode ? 'text-gray-500' : 'text-gray-400'" aria-hidden="true" />
          <p class="text-xs" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
            {{ t('mount.taskList.empty') }}
          </p>
        </div>

        <!-- 任务列表 -->
        <div v-else class="divide-y" :class="darkMode ? 'divide-gray-700/60' : 'divide-gray-200'">
          <div
            v-for="task in tasks"
            :key="task.id"
            class="group px-4 py-3.5 transition-colors duration-150 cursor-pointer"
            :class="[
              darkMode ? 'hover:bg-gray-700/50' : 'hover:bg-gray-50/80',
              hasTaskError(task) ? (darkMode ? 'bg-red-900/10' : 'bg-red-50/50') : ''
            ]"
            @click="toggleExpand(task.id)"
          >
            <!-- 主信息行 -->
            <div class="flex items-center gap-3">
              <!-- 状态指示器 -->
              <span class="flex-shrink-0 relative">
                <!-- 运行中：脉冲圆点 -->
                <template v-if="task.status === 'running'">
                  <span class="block w-2 h-2 rounded-full bg-blue-500"></span>
                  <span class="absolute inset-0 rounded-full bg-blue-500 animate-ping opacity-75"></span>
                </template>
                <!-- 完成：绿色对勾 -->
                <IconCheckCircle v-else-if="task.status === 'completed'" class="text-green-500" aria-hidden="true" />
                <!-- 失败：红色叉号 -->
                <IconXCircle v-else-if="task.status === 'failed'" class="text-red-500" aria-hidden="true" />
                <!-- 部分完成：黄色警告 -->
                <IconExclamationSolid v-else-if="task.status === 'partial'" class="text-yellow-500" aria-hidden="true" />
                <!-- 取消/等待：灰色圆点 -->
                <span v-else class="block w-2 h-2 rounded-full" :class="darkMode ? 'bg-gray-500' : 'bg-gray-400'"></span>
              </span>

              <!-- 任务名称 -->
              <span
                class="flex-1 text-sm font-medium truncate"
                :class="darkMode ? 'text-gray-100' : 'text-gray-900'"
                :title="task.name"
              >
                {{ task.name }}
              </span>

              <!-- 进度/状态文字 -->
              <span class="flex-shrink-0 text-xs tabular-nums" :class="getStatusTextClass(task)">
                <template v-if="task.status === 'running'">{{ task.progress }}%</template>
                <template v-else-if="task.status === 'completed'">{{ task.relativeTime }}</template>
                <template v-else-if="task.status === 'failed'">{{ t('mount.taskList.status.failed') }}</template>
                <template v-else-if="task.status === 'partial'">{{ task.stats.failed }}{{ t('mount.taskList.itemsFailed') }}</template>
                <template v-else-if="task.status === 'cancelled'">{{ t('mount.taskList.status.cancelled') }}</template>
                <template v-else>{{ t('mount.taskList.status.pending') }}</template>
              </span>

              <!-- 取消按钮 -->
              <button
                v-if="task.status === 'running' || task.status === 'pending'"
                @click.stop="handleCancelTask(task.id)"
                class="flex-shrink-0 p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                :class="darkMode
                ? 'hover:bg-gray-700 text-gray-400 hover:text-red-400'
                : 'hover:bg-gray-100 text-gray-400 hover:text-red-500'"
                :title="t('mount.taskList.cancel')"
              >
                <IconClose size="sm" aria-hidden="true" />
              </button>

              <!-- 展开指示器 -->
              <IconChevronDown
                size="sm"
                class="flex-shrink-0 transition-transform duration-200"
                :class="[
                  expandedIds.has(task.id) ? 'rotate-180' : '',
                  darkMode ? 'text-gray-500' : 'text-gray-400'
                ]"
                aria-hidden="true"
              />
            </div>

            <!-- 进度条（仅运行中显示） -->
            <div
              v-if="task.status === 'running'"
              class="mt-2 h-1.5 rounded-full overflow-hidden"
              :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"
            >
              <div
                class="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                :style="{ width: task.progress + '%' }"
              ></div>
            </div>

            <!-- 展开详情：文件列表 -->
            <transition
              enter-active-class="transition-all duration-200 ease-out"
              enter-from-class="opacity-0 max-h-0"
              enter-to-class="opacity-100 max-h-40"
              leave-active-class="transition-all duration-150 ease-in"
              leave-from-class="opacity-100 max-h-40"
              leave-to-class="opacity-0 max-h-0"
            >
              <div
                v-if="expandedIds.has(task.id) && task.itemResults && task.itemResults.length > 0"
                class="mt-2.5 overflow-hidden"
              >
                <div
                  class="space-y-1.5 max-h-32 overflow-y-auto rounded-md p-3"
                  :class="darkMode ? 'bg-gray-900/50' : 'bg-gray-50'"
                >
                  <div
                    v-for="(item, index) in task.itemResults"
                    :key="index"
                    class="flex items-center gap-2 text-xs"
                    :class="darkMode ? 'text-gray-300' : 'text-gray-600'"
                  >
                    <!-- 文件状态图标 -->
                    <span class="flex-shrink-0 w-4 text-center">
                      <span v-if="item.status === 'success'" class="text-green-500">✓</span>
                      <span v-else-if="item.status === 'processing'" class="text-blue-500">●</span>
                      <span v-else-if="item.status === 'retrying'" class="text-orange-500 animate-pulse">↻</span>
                      <span v-else-if="item.status === 'failed'" class="text-red-500">✗</span>
                      <span v-else-if="item.status === 'skipped'" class="text-yellow-500">○</span>
                      <span v-else class="text-gray-400">·</span>
                    </span>
                    <!-- 文件名 -->
                    <span class="flex-1 truncate font-mono" :title="item.sourcePath">
                      {{ extractNameFromPath(item.sourcePath) }}
                      <!-- 重试次数标记 (仅在有重试记录时显示) -->
                      <span
                        v-if="item.retryCount && item.retryCount > 0"
                        class="ml-1 text-orange-500"
                        :title="t('mount.taskList.retry.retryCount', { count: item.retryCount })"
                      >
                        {{ t('mount.taskList.retry.withRetry', { count: item.retryCount }) }}
                      </span>
                    </span>
                    <!-- 文件大小 -->
                    <span v-if="item.fileSize || item.bytesTransferred" class="flex-shrink-0 tabular-nums text-blue-500">
                      {{ formatFileSize(item.fileSize || item.bytesTransferred) }}
                    </span>
                  </div>
                </div>
              </div>
            </transition>

            <!-- 错误摘要（失败/部分完成时显示，未展开时） -->
            <p
              v-if="!expandedIds.has(task.id) && hasTaskError(task) && getErrorMessage(task)"
              class="mt-1 pl-6 text-xs truncate"
              :class="darkMode ? 'text-red-400' : 'text-red-500'"
              :title="getErrorMessage(task)"
            >
              {{ getErrorMessage(task) }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue';
import { useIntervalFn } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { listJobs, getJobStatus, cancelJob } from '@/api/services/fsService.js';
import { formatRelativeTime } from '@/utils/timeUtils.js';
import { formatFileSize } from '@/utils/fileUtils.js';
import { IconCheckCircle, IconChevronDown, IconClose, IconExclamationSolid, IconExternalLink, IconRefresh, IconTaskList, IconXCircle } from '@/components/icons';
import { createLogger } from '@/utils/logger.js';

const { t } = useI18n();
const log = createLogger('TaskListModal');
const router = useRouter();

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['close', 'task-completed']);

// State
const tasks = ref([]);
const isLoading = ref(false);
const expandedIds = ref(new Set());

/**
 * 从路径中提取文件/文件夹名称
 */
const extractNameFromPath = (path) => {
  if (!path || typeof path !== 'string') return '';
  return path.replace(/\/+$/, '').split('/').filter(Boolean).pop() || '';
};

/**
 * 生成任务名称
 */
const generateTaskName = (jobData) => {
  const items = jobData.payload?.items;
  if (!items || items.length === 0) {
    return `#${jobData.jobId?.substring(0, 6) || '???'}`;
  }

  const firstItem = items[0];
  const sourcePath = firstItem?.sourcePath || '';
  const sourceFileName = extractNameFromPath(sourcePath) || t('mount.taskList.unknownFile');

  if (items.length === 1) {
    return sourceFileName;
  } else {
    return `${sourceFileName} (+${items.length - 1})`;
  }
};

/**
 * 转换后端数据为前端格式
 */
const transformTaskData = (jobData) => {
  const total = jobData.stats?.totalItems || 0;
  const success = jobData.stats?.successCount || 0;
  const failed = jobData.stats?.failedCount || 0;
  const processed = jobData.stats?.processedItems || 0;
  const bytesTransferred = jobData.stats?.bytesTransferred || 0;
  const totalBytes = jobData.stats?.totalBytes || 0;

  // 智能进度计算
  let progress = 0;
  if (totalBytes > 0 && bytesTransferred > 0) {
    progress = Math.round((bytesTransferred / totalBytes) * 100);
  } else if (total > 0) {
    progress = Math.round((processed / total) * 100);
  }
  progress = Math.min(100, Math.max(0, progress));

  // 获取文件处理结果列表
  const itemResults = jobData.stats?.itemResults || [];
  const firstFailedItem = itemResults.find(item => item.status === 'failed');

  return {
    id: jobData.jobId,
    name: generateTaskName(jobData),
    type: jobData.taskType,
    status: jobData.status,
    progress,
    stats: {
      total,
      success,
      failed,
      skipped: jobData.stats?.skippedCount || 0,
    },
    itemResults,
    relativeTime: formatRelativeTime(jobData.createdAt),
    error: jobData.errorMessage || firstFailedItem?.error || null,
  };
};

/**
 * 加载任务列表
 */
const loadTasks = async () => {
  isLoading.value = true;
  try {
    const response = await listJobs({ taskType: 'copy' });
    const jobsList = response?.data?.jobs || response?.jobs || [];
    tasks.value = jobsList.map(transformTaskData);
  } catch (error) {
    log.error('[TaskListModal] Failed to load tasks:', error);
  } finally {
    isLoading.value = false;
  }
};

/**
 * 轮询运行中任务状态
 */
const pollRunningTasks = async () => {
  const runningTasks = tasks.value.filter((task) => task.status === 'running' || task.status === 'pending');
  if (runningTasks.length === 0) return;

  const completedTasks = [];

  for (const task of runningTasks) {
    try {
      const response = await getJobStatus(task.id);
      const jobData = response?.data || response;
      const index = tasks.value.findIndex((t) => t.id === task.id);
      if (index !== -1) {
        const oldStatus = tasks.value[index].status;
        const newTaskData = transformTaskData(jobData);
        tasks.value[index] = newTaskData;

        // 检测任务从运行中变为完成状态
        const wasRunning = oldStatus === 'running' || oldStatus === 'pending';
        const isNowComplete = newTaskData.status === 'completed' || newTaskData.status === 'partial';
        if (wasRunning && isNowComplete) {
          completedTasks.push(newTaskData);
        }
      }
    } catch (error) {
      log.error(`[TaskListModal] Failed to poll task ${task.id}:`, error);
    }
  }

  // 如果有任务刚完成，通知父组件刷新目录
  if (completedTasks.length > 0) {
    emit('task-completed', { tasks: completedTasks });
  }
};

/**
 * 取消任务
 */
const handleCancelTask = async (jobId) => {
  try {
    await cancelJob(jobId);
    await loadTasks();
  } catch (error) {
    log.error('[TaskListModal] Failed to cancel task:', error);
  }
};

/**
 * 切换展开状态
 */
const toggleExpand = (taskId) => {
  if (expandedIds.value.has(taskId)) {
    expandedIds.value.delete(taskId);
  } else {
    expandedIds.value.add(taskId);
  }
};

/**
 * 判断任务是否有错误
 */
const hasTaskError = (task) => {
  return task.status === 'failed' || task.status === 'partial';
};

/**
 * 获取错误信息
 */
const getErrorMessage = (task) => {
  return task.error || null;
};

/**
 * 获取状态文字样式
 */
const getStatusTextClass = (task) => {
  const classes = {
    running: 'text-blue-500',
    completed: props.darkMode ? 'text-gray-400' : 'text-gray-500',
    failed: 'text-red-500',
    partial: 'text-yellow-600',
    cancelled: props.darkMode ? 'text-gray-500' : 'text-gray-400',
    pending: props.darkMode ? 'text-gray-500' : 'text-gray-400',
  };
  return classes[task.status] || classes.pending;
};

/**
 * 跳转到任务管理页
 */
const goToTaskManagement = () => {
  close();
  router.push('/admin/tasks');
};

/**
 * 关闭模态框
 */
const close = () => {
  emit('close');
};

// 轮询：用 VueUse 统一管理定时器
const { pause: stopPolling, resume: startPolling } = useIntervalFn(pollRunningTasks, 3000, {
  immediate: false,
  immediateCallback: true,
});

// 监听模态框打开/关闭
watch(
  () => props.isOpen,
  async (isOpen) => {
    if (isOpen) {
      try {
        await loadTasks();
        // 确保在加载完成后组件仍然打开才启动轮询
        if (props.isOpen) {
          startPolling();
        }
      } catch (error) {
        log.error('[TaskListModal] 加载任务失败:', error);
      }
    } else {
      stopPolling();
      expandedIds.value.clear();
    }
  },
  { immediate: true }
);

// 组件卸载时清理（确保所有状态被重置）
onUnmounted(() => {
  stopPolling();
  expandedIds.value.clear();
});
</script>
