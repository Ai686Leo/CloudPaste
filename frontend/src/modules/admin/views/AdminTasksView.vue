<template>
  <div class="h-full flex flex-col">
    <!-- Header -->
    <div class="px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
      <div class="max-w-7xl mx-auto">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">{{ t('admin.tasks.title') }}</h1>
      </div>
    </div>

    <!-- Stats Cards -->
    <div class="px-3 sm:px-4 md:px-6 lg:px-8 pt-6 shrink-0">
      <div class="max-w-7xl mx-auto">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatsCard
            :title="t('admin.tasks.stats.running')"
            :value="stats.active"
            :icon="ActivityIcon"
            colorClass="bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
          />
          <StatsCard
            :title="t('admin.tasks.stats.completed')"
            :value="stats.completed"
            :icon="CheckCircleIcon"
            colorClass="bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400"
          />
          <StatsCard
            :title="t('admin.tasks.stats.failed')"
            :value="stats.failed"
            :icon="AlertCircleIcon"
            colorClass="bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
          />
          <StatsCard
            :title="t('admin.tasks.stats.total')"
            :value="stats.total"
            :icon="DatabaseIcon"
            colorClass="bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-400"
          />
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 overflow-hidden px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6">
      <div class="flex-1 flex flex-col">
        <!-- Toolbar -->
        <div class="mb-3 space-y-3">
          <!-- Row 1: Title + Actions -->
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {{ t('admin.tasks.list.title') }}
            </h2>
            <div class="flex items-center gap-2">
              <!-- Batch Actions (shown when items selected) -->
              <template v-if="selectedTasks.length > 0">
                <button
                  v-if="selectedCancellableTaskIds.length > 0"
                  @click="handleBatchCancel"
                  class="flex items-center gap-1.5 px-2 py-1 sm:px-3 sm:py-1.5 rounded-md text-sm font-medium transition-colors bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-100 dark:hover:bg-yellow-900/40 border border-yellow-200 dark:border-yellow-800"
                >
                  <XCircleIcon class="w-4 h-4" />
                  <span class="hidden sm:inline">{{ t('admin.tasks.actions.cancel') }} ({{ selectedCancellableTaskIds.length }})</span>
                </button>
                <button
                  @click="handleBatchDelete"
                  class="flex items-center gap-1.5 px-2 py-1 sm:px-3 sm:py-1.5 rounded-md text-sm font-medium transition-colors bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 border border-red-200 dark:border-red-800"
                >
                  <TrashIcon class="w-4 h-4" />
                  <span class="hidden sm:inline">{{ t('admin.tasks.actions.deleteShort') }} ({{ selectedTasks.length }})</span>
                </button>
              </template>
              <!-- Regular Actions -->
              <template v-else>
                <button
                  @click="fetchTasks"
                  :disabled="loading"
                  class="flex items-center gap-1.5 px-2 py-1 sm:px-3 sm:py-1.5 rounded-md text-sm font-medium transition-colors bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshIcon :class="['w-4 h-4', loading && 'animate-spin']" />
                  <span class="hidden sm:inline">{{ t('admin.tasks.actions.refresh') }}</span>
                </button>
              </template>
            </div>
          </div>

          <!-- Row 2: Filter + Search -->
          <div class="flex flex-col sm:flex-row gap-3 justify-between items-stretch sm:items-center">
            <!-- 筛选器组 -->
            <div class="flex flex-wrap gap-2">
              <!-- 状态筛选 -->
              <div class="relative w-full sm:w-36">
                <select
                  v-model="filters.status"
                  class="w-full pl-3 pr-8 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all appearance-none cursor-pointer"
                >
                  <option value="ALL">{{ t('admin.tasks.filters.allStatuses') }}</option>
                  <option value="running">{{ t('admin.tasks.status.running') }}</option>
                  <option value="completed">{{ t('admin.tasks.status.completed') }}</option>
                  <option value="failed">{{ t('admin.tasks.status.failed') }}</option>
                  <option value="partial">{{ t('admin.tasks.status.partial') }}</option>
                </select>
                <FilterIcon class="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
              </div>

              <!-- 任务类型筛选 -->
              <div class="relative w-full sm:w-40">
                <select
                  v-model="filters.taskType"
                  class="w-full pl-3 pr-8 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all appearance-none cursor-pointer"
                >
                  <option value="ALL">{{ t('admin.tasks.filters.allTypes') }}</option>
                  <option v-for="type in availableTaskTypes" :key="type" :value="type">
                    {{ formatTaskType(type) }}
                  </option>
                </select>
                <FilterIcon class="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
              </div>

              <!-- 创建者筛选 -->
              <div class="relative w-full sm:w-36">
                <select
                  v-model="filters.creatorType"
                  class="w-full pl-3 pr-8 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all appearance-none cursor-pointer"
                >
                  <option value="ALL">{{ t('admin.tasks.filters.allCreators') }}</option>
                  <option v-for="creator in availableCreators" :key="creator" :value="creator">
                    {{ creator === 'admin'
                      ? t('admin.tasks.creator.admin')
                      : t('admin.tasks.creator.keyPrefix', { key: creator }) }}
                  </option>
                </select>
                <FilterIcon class="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
              </div>

              <!-- 触发方式筛选 -->
              <div class="relative w-full sm:w-32">
                <select
                  v-model="filters.triggerType"
                  class="w-full pl-3 pr-8 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all appearance-none cursor-pointer"
                >
                  <option value="ALL">{{ t('admin.tasks.filters.allTriggers') }}</option>
                  <option value="manual">{{ t('admin.tasks.trigger.manual') }}</option>
                  <option value="scheduled">{{ t('admin.tasks.trigger.scheduled') }}</option>
                </select>
                <FilterIcon class="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
              </div>
            </div>

            <!-- Search Input -->
            <div class="relative w-full sm:w-80">
              <SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
              <input
                v-model="searchQuery"
                type="text"
                :placeholder="t('admin.tasks.filters.searchPlaceholder')"
                class="w-full pl-9 pr-4 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 dark:focus:border-blue-400 transition-all placeholder:text-gray-400 dark:placeholder:text-gray-500"
              />
            </div>
          </div>
        </div>

        <!-- Task Table -->
          <div v-if="loading" class="flex items-center justify-center h-64">
          <div class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <RefreshIcon class="w-5 h-5 animate-spin" />
            <span>{{ t('admin.tasks.loading') }}</span>
          </div>
        </div>
        <AdminTable
          v-else
          :data="paginatedTasks"
          :columns="taskColumns"
          :column-classes="taskColumnClasses"
          :selectable="true"
          :selected-items="selectedTasks"
          row-id-field="jobId"
          :empty-text="t('admin.tasks.empty.tableNoData')"
          @selection-change="handleSelectionChange"
        >
          <!-- Mobile Card View -->
          <template #mobile="{ data }">
            <div class="space-y-3 p-0">
              <div
                v-for="task in data"
                :key="task.jobId"
                class="rounded-lg shadow-md overflow-hidden border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
              >
                <!-- Card Header -->
                <div class="px-5 py-3 flex items-center justify-between gap-2 border-b bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600">
                  <div class="flex items-center gap-2 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      :checked="selectedTasks.includes(task.jobId)"
                      @click.stop="toggleTask(task.jobId)"
                      class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                    />
                    <div :class="getTaskColorClass(task.taskType)">
                      <component :is="getTaskIcon(task.taskType)" class="w-4 h-4" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <h3 class="font-medium text-sm truncate text-gray-900 dark:text-gray-100 capitalize">
                        {{ formatTaskType(task.taskType) }}
                      </h3>
                      <p class="text-xs truncate mt-0.5 text-gray-400 dark:text-gray-500 font-mono">{{ task.jobId }}</p>
                    </div>
                  </div>
                  <StatusBadge :status="task.status" />
                </div>

                <!-- Card Body -->
                <div class="p-4 space-y-3 text-sm text-gray-600 dark:text-gray-300">
                  <div class="flex justify-between items-start">
                    <span class="font-medium">{{ t('admin.tasks.labels.creator') }}:</span>
                    <div class="flex flex-col items-end gap-1">
                      <span :class="`px-2 py-0.5 text-xs rounded inline-block text-center ${getCreatorBadgeInfo(task.userId, task.keyName).badgeClass}`">
                        {{ getCreatorBadgeInfo(task.userId, task.keyName).text }}
                      </span>
                      <span class="text-xs text-gray-400 dark:text-gray-500">
                        {{ task.triggerType === 'scheduled'
                          ? t('admin.tasks.trigger.scheduled')
                          : t('admin.tasks.trigger.manual') }}
                      </span>
                    </div>
                  </div>
                  <div class="flex justify-between">
                    <span class="font-medium">{{ t('admin.tasks.labels.created') }}:</span>
                    <span class="text-xs text-gray-500 dark:text-gray-400">
                      {{ formatDateTime(task.createdAt) }}
                    </span>
                  </div>
                  <div class="flex justify-between items-center">
                    <span class="font-medium">{{ t('admin.tasks.labels.progress') }}:</span>
                    <TaskProgressBar :task="task" />
                  </div>
                  <div class="flex justify-end gap-1 pt-2 border-t border-gray-200 dark:border-gray-600">
                    <!-- View Details Button (Eye Icon) -->
                    <button
                      @click.stop="selectedTaskId = task.jobId"
                      class="p-1.5 rounded-full transition-colors text-blue-500 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                      :title="t('admin.tasks.actions.viewDetails')"
                    >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
                <!-- Cancel Button -->
                <button
                  v-if="isTaskCancellable(task)"
                  @click.stop="handleCancelTask(task)"
                  class="p-1.5 rounded-full transition-colors text-yellow-600 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-900/20"
                  :title="t('admin.tasks.actions.cancel')"
                >
                  <XCircleIcon class="w-4 h-4" />
                </button>
                <!-- Delete Button -->
                <button
                  @click.stop="handleDeleteTask(task)"
                  class="p-1.5 rounded-full transition-colors text-red-400 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                  :title="t('admin.tasks.actions.deleteTask')"
                    >
                      <TrashIcon class="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </AdminTable>

        <!-- Pagination -->
        <CommonPagination
          v-if="!loading && filteredTasks.length > 0"
          :dark-mode="darkMode"
          :pagination="pagination"
          :page-size-options="pageSizeOptions"
          mode="offset"
          @offset-changed="handleOffsetChange"
          @limit-changed="handlePageSizeChange"
          class="mt-4"
        />
      </div>
    </div>

    <!-- Task Detail Drawer -->
    <TaskDrawer
      :task="selectedTask"
      :open="selectedTaskId !== null"
      @close="selectedTaskId = null"
      @retry-all-failed="handleRetryAllFailed"
      @retry-file="handleRetryFile"
    />

    <!-- Delete Confirmation Dialog -->
    <ConfirmDialog v-bind="dialogState" @confirm="handleConfirm" @cancel="handleCancel" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, h } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { createLogger } from '@/utils/logger.js'
import { listJobs, getJobStatus, cancelJob, deleteJob, batchCopyItems, listJobTypes } from '@/api/services/fsService'
import { useThemeMode } from '@/composables/core/useThemeMode.js'
import { useConfirmDialog } from '@/composables/core/useConfirmDialog.js'
import { useCreatorBadge } from '@/composables/admin-management/useCreatorBadge.js'
import {
  IconActivity as ActivityIcon,
  IconCheckCircle as CheckCircleIcon,
  IconAlertCircle as AlertCircleIcon,
  IconDatabase as DatabaseIcon,
  IconSearch as SearchIcon,
  IconFilter as FilterIcon,
  IconCalendar as CalendarIcon,
  IconUser as UserIcon,
  IconSync as SyncIcon,
  IconCopy as CopyIcon,
  IconRefresh as RefreshIcon,
  IconTrash as TrashIcon,
  IconXCircle as XCircleIcon
} from '@/components/icons'
import StatsCard from '@/modules/admin/components/StatsCard.vue'
import StatusBadge from '@/modules/admin/components/StatusBadge.vue'
import TaskProgressBar from '@/modules/admin/components/TaskProgressBar.vue'
import TaskDrawer from '@/modules/admin/components/TaskDrawer.vue'
import AdminTable from '@/components/common/AdminTable.vue'
import CommonPagination from '@/components/common/CommonPagination.vue'
import ConfirmDialog from '@/components/common/dialogs/ConfirmDialog.vue'
import { useAdminBase } from '@/composables/admin-management/useAdminBase.js'

// Composables
const { isDarkMode: darkMode } = useThemeMode()
const { t, locale } = useI18n()
const log = createLogger('AdminTasksView')
const { dialogState, confirm, handleConfirm, handleCancel } = useConfirmDialog()
const { getCreatorBadgeInfo } = useCreatorBadge()

// State
const tasks = ref([])
const loading = ref(false)
const jobTypes = ref([])
const searchQuery = ref('')
const filters = ref({
  status: 'ALL',
  taskType: 'ALL',
  creatorType: 'ALL',
  triggerType: 'ALL'
})
const selectedTaskId = ref(null)
const selectedTasks = ref([])
const { pagination, pageSizeOptions, changePageSize } = useAdminBase('tasks')
const { pause: pausePoll, resume: resumePoll } = useIntervalFn(
  () => {
    if (tasks.value.some(t => t.status === 'running' || t.status === 'pending')) {
      pollRunningTasks()
    }
  },
  3000,
  { immediate: false }
)

const isTaskCancellable = (task) => {
  if (!task) return false
  if (task.allowedActions && typeof task.allowedActions === 'object') {
    return task.allowedActions.canCancel === true
  }
  return task.status === 'pending' || task.status === 'running'
}

const selectedCancellableTaskIds = computed(() => {
  const selected = selectedTasks.value || []
  if (selected.length === 0) return []
  const byId = new Map(tasks.value.map(t => [t.jobId, t]))
  return selected
    .map(id => byId.get(id))
    .filter(t => isTaskCancellable(t))
    .map(t => t.jobId)
})

// Computed - 动态生成筛选选项
const availableTaskTypes = computed(() => {
  const types = new Set()
  if (jobTypes.value.length > 0) {
    jobTypes.value.forEach((item) => {
      const taskType = item?.taskType || item
      if (taskType) {
        types.add(taskType)
      }
    })
  } else {
    tasks.value.forEach((task) => {
      if (task?.taskType) {
        types.add(task.taskType)
      }
    })
  }
  return Array.from(types).sort()
})

const availableCreators = computed(() => {
  const creators = new Set()
  tasks.value.forEach(t => {
    if (t.userId && !t.keyName) {
      creators.add('admin')
    } else if (t.keyName) {
      creators.add(t.keyName)
    }
  })
  return Array.from(creators).sort()
})

const isClientFiltering = computed(() => {
  return searchQuery.value.trim().length > 0
    || filters.value.creatorType !== 'ALL'
    || filters.value.triggerType !== 'ALL'
})

const buildServerFilter = () => {
  const serverFilter = {
    limit: pagination.limit,
    offset: pagination.offset
  }
  if (filters.value.status !== 'ALL') {
    serverFilter.status = filters.value.status
  }
  if (filters.value.taskType !== 'ALL') {
    serverFilter.taskType = filters.value.taskType
  }
  return serverFilter
}

// Computed - 多维度筛选
const filteredTasks = computed(() => {
  return tasks.value.filter(task => {
    // 状态筛选
    if (filters.value.status !== 'ALL' && task.status !== filters.value.status.toLowerCase()) {
      return false
    }

    // 任务类型筛选
    if (filters.value.taskType !== 'ALL' && task.taskType !== filters.value.taskType) {
      return false
    }

    // 创建者类型筛选
    if (filters.value.creatorType !== 'ALL') {
      if (filters.value.creatorType === 'admin') {
        if (!task.userId || task.keyName) return false
      } else {
        if (task.keyName !== filters.value.creatorType) return false
      }
    }

    // 触发方式筛选
    if (filters.value.triggerType !== 'ALL' && task.triggerType !== filters.value.triggerType) {
      return false
    }

    // 搜索过滤
    const matchesSearch =
      task.jobId?.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      task.taskType?.toLowerCase().includes(searchQuery.value.toLowerCase())

    return matchesSearch
  })
})

// Watch for filter changes to update pagination
watch([filteredTasks, isClientFiltering], ([filtered, clientFiltering]) => {
  if (!clientFiltering) return
  const total = filtered.length
  pagination.total = total
  pagination.hasMore = pagination.offset + pagination.limit < total
  if (pagination.offset >= total && total > 0) {
    pagination.offset = Math.max(0, total - pagination.limit)
  }
}, { immediate: true })

const paginatedTasks = computed(() => {
  if (!isClientFiltering.value) {
    return filteredTasks.value
  }
  const start = pagination.offset
  const end = start + pagination.limit
  return filteredTasks.value.slice(start, end)
})

watch(
  [
    () => filters.value.status,
    () => filters.value.taskType,
    () => filters.value.creatorType,
    () => filters.value.triggerType,
    () => searchQuery.value
  ],
  () => {
    pagination.offset = 0
    fetchTasks()
  }
)

const stats = computed(() => {
  return {
    active: tasks.value.filter(t => t.status === 'running').length,
    failed: tasks.value.filter(t => t.status === 'failed').length,
    completed: tasks.value.filter(t => t.status === 'completed').length,
    total: tasks.value.length
  }
})

const selectedTask = computed(() => {
  if (!selectedTaskId.value) return null
  return tasks.value.find(t => t.jobId === selectedTaskId.value) || null
})

// Table Columns Configuration
const taskColumns = computed(() => [
  {
    type: 'display',
    key: 'details',
    header: t('admin.tasks.table.details'),
    render: (task) => {
      return h('div', {
        class: 'flex items-start gap-3 cursor-pointer',
        onClick: () => selectedTaskId.value = task.jobId
      }, [
        h('div', { class: getTaskColorClass(task.taskType) }, [
          h(getTaskIcon(task.taskType), { class: 'w-4 h-4' })
        ]),
        h('div', {}, [
          h('div', {
            class: 'font-semibold text-gray-900 dark:text-gray-100 capitalize'
          }, formatTaskType(task.taskType)),
          h('div', {
            class: 'text-xs text-gray-400 dark:text-gray-500 mt-1 font-mono'
          }, task.jobId)
        ])
      ])
    }
  },
  {
    type: 'display',
    key: 'status',
    header: t('admin.tasks.table.status'),
    render: (task) => {
      return h(StatusBadge, { status: task.status })
    }
  },
  {
    type: 'display',
    key: 'progress',
    header: t('admin.tasks.table.progress'),
    render: (task) => {
      return h(TaskProgressBar, { task })
    }
  },
  {
    type: 'display',
    key: 'creator',
    header: t('admin.tasks.table.creator'),
    render: (task) => {
      const badgeInfo = getCreatorBadgeInfo(task.userId, task.keyName)

      return h('div', { class: 'flex flex-col gap-1' }, [
        // Creator badge
        h('span', {
          class: `px-2 py-0.5 text-xs rounded inline-block text-center w-fit ${badgeInfo.badgeClass}`
        }, badgeInfo.text),
        // Trigger type below (small text)
        h('span', {
          class: 'text-xs text-gray-400 dark:text-gray-500'
        }, task.triggerType === 'scheduled' ? t('admin.tasks.trigger.scheduled') : t('admin.tasks.trigger.manual'))
      ])
    }
  },
  {
    type: 'display',
    key: 'created',
    header: t('admin.tasks.table.createdAt'),
    render: (task) => {
      return h('span', {
        class: 'text-sm text-gray-600 dark:text-gray-300'
      }, formatDateTime(task.createdAt))
    }
  },
  {
    type: 'display',
    key: 'actions',
    header: t('admin.tasks.table.actions'),
    render: (task) => {
      const actions = [
        // View Details Button
        h('button', {
          class: 'p-1.5 rounded transition text-blue-500 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20',
          title: t('admin.tasks.actions.viewDetails'),
          onClick: (e) => {
            e.stopPropagation()
            selectedTaskId.value = task.jobId
          }
        }, [
          h('svg', {
            class: 'h-5 w-5',
            fill: 'none',
            stroke: 'currentColor',
            viewBox: '0 0 24 24'
          }, [
            h('path', {
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
              'stroke-width': '2',
              d: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z'
            }),
            h('path', {
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
              'stroke-width': '2',
              d: 'M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z'
            })
          ])
        ]),
      ]

      if (isTaskCancellable(task)) {
        actions.push(
          h('button', {
            class: 'p-1.5 rounded transition text-yellow-600 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 hover:text-yellow-700 dark:hover:text-yellow-300',
            title: t('admin.tasks.actions.cancel'),
            onClick: (e) => {
              e.stopPropagation()
              handleCancelTask(task)
            }
          }, [
            h(XCircleIcon, { class: 'w-5 h-5' })
          ])
        )
      }

      actions.push(
        // Delete Button
        h('button', {
          class: 'p-1.5 rounded transition text-red-400 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-300',
          title: t('admin.tasks.actions.deleteTask'),
          onClick: (e) => {
            e.stopPropagation()
            handleDeleteTask(task)
          }
        }, [
          h(TrashIcon, { class: 'w-5 h-5' })
        ])
      )

      return h('div', { class: 'flex items-center justify-center gap-1' }, actions)
    }
  }
])

const taskColumnClasses = {
  details: 'text-left',
  creator: 'text-left',
  created: 'text-left',
  progress: 'text-left',
  status: 'text-left',
  actions: 'text-center'
}

// Methods
const fetchJobTypes = async () => {
  try {
    const response = await listJobTypes()
    const types = response?.data?.types || response?.types || []
    jobTypes.value = Array.isArray(types) ? types : []
  } catch (error) {
    log.error('[AdminTasksView] 获取任务类型失败:', error)
  }
}

const fetchAllTasks = async () => {
  const serverFilter = buildServerFilter()
  const pageSize = Math.min(100, serverFilter.limit || 50)
  let offset = 0
  let total = 0
  const allJobs = []

  while (true) {
    const response = await listJobs({ ...serverFilter, limit: pageSize, offset })
    const payload = response?.data || response || {}
    const jobs = payload.jobs || []
    total = Number(payload.total || 0)
    allJobs.push(...jobs)
    offset += jobs.length
    if (jobs.length === 0 || offset >= total) break
  }

  tasks.value = allJobs
  const filteredTotal = filteredTasks.value.length
  pagination.total = filteredTotal
  pagination.hasMore = pagination.offset + pagination.limit < filteredTotal
  if (pagination.offset >= filteredTotal && filteredTotal > 0) {
    pagination.offset = Math.max(0, filteredTotal - pagination.limit)
  }
}

const fetchTasks = async () => {
  try {
    loading.value = true
    if (isClientFiltering.value) {
      await fetchAllTasks()
      return
    }
    const response = await listJobs(buildServerFilter())
    const payload = response?.data || response || {}
    tasks.value = payload.jobs || []
    const total = Number(payload.total || 0)
    pagination.total = total
    pagination.hasMore = pagination.offset + pagination.limit < total
    if (total > 0 && pagination.offset >= total) {
      pagination.offset = Math.max(0, total - pagination.limit)
      const retryResponse = await listJobs(buildServerFilter())
      const retryPayload = retryResponse?.data || retryResponse || {}
      tasks.value = retryPayload.jobs || []
      const retryTotal = Number(retryPayload.total || 0)
      pagination.total = retryTotal
      pagination.hasMore = pagination.offset + pagination.limit < retryTotal
    }
  } catch (error) {
    log.error('Failed to fetch tasks:', error)
  } finally {
    loading.value = false
  }
}

const formatTaskType = (type) => {
  if (!type) return t('admin.tasks.taskType.unknown')
  const typeMap = {
    copy: t('admin.tasks.taskType.copy'),
    fs_index_rebuild: t('admin.tasks.taskType.fs_index_rebuild'),
    fs_index_apply_dirty: t('admin.tasks.taskType.fs_index_apply_dirty')
  }
  return typeMap[type] || t('admin.tasks.taskType.unknownWithType', { type })
}

const formatDateTime = (dateStr) => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString(locale.value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const getTaskIcon = (type) => {
  if (!type) return SyncIcon
  if (type.includes('copy')) return CopyIcon
  if (type.includes('index')) return DatabaseIcon
  return SyncIcon
}

const getTaskColorClass = (type) => {
  const baseClass = 'p-2 rounded-lg mt-0.5 border'
  if (!type) return `${baseClass} text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600`
  if (type.includes('copy')) return `${baseClass} text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800`
  if (type.includes('index')) return `${baseClass} text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border-purple-100 dark:border-purple-800`
  return `${baseClass} text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600`
}

// Pagination Handlers
const handleOffsetChange = (newOffset) => {
  pagination.offset = newOffset
  if (!isClientFiltering.value) {
    fetchTasks()
  }
}

const handlePageSizeChange = (newLimit) => {
  changePageSize(newLimit)
  if (!isClientFiltering.value) {
    fetchTasks()
  }
}

// Selection Handlers
const handleSelectionChange = ({ type, id }) => {
  if (type === 'toggle-all') {
    if (selectedTasks.value.length === paginatedTasks.value.length) {
      selectedTasks.value = []
    } else {
      selectedTasks.value = paginatedTasks.value.map(t => t.jobId)
    }
  } else if (type === 'toggle-item') {
    toggleTask(id)
  }
}

const toggleTask = (jobId) => {
  const index = selectedTasks.value.indexOf(jobId)
  if (index > -1) {
    selectedTasks.value.splice(index, 1)
  } else {
    selectedTasks.value.push(jobId)
  }
}

// Delete Handlers
const handleDeleteTask = async (task) => {
  const confirmed = await confirm({
    title: t('admin.tasks.confirmDelete.title'),
    message: t('admin.tasks.confirmDelete.single', {
      name: `${formatTaskType(task.taskType)} (${task.jobId})`
    }),
    confirmType: 'danger',
    confirmText: t('common.dialogs.deleteButton'),
    darkMode: darkMode.value
  })

  if (confirmed) {
    try {
      await deleteJob(task.jobId)
      await fetchTasks()
    } catch (error) {
      log.error('Failed to delete task:', error)
    }
  }
}

const handleCancelTask = async (task) => {
  const confirmed = await confirm({
    title: t('admin.tasks.confirmCancel.title'),
    message: t('admin.tasks.confirmCancel.single', {
      name: `${formatTaskType(task.taskType)} (${task.jobId})`
    }),
    confirmType: 'warning',
    confirmText: t('admin.tasks.actions.cancel'),
    darkMode: darkMode.value
  })

  if (confirmed) {
    try {
      await cancelJob(task.jobId)
      await fetchTasks()
    } catch (error) {
      log.error('[AdminTasksView] 取消任务失败:', error)
    }
  }
}

const handleBatchDelete = async () => {
  const confirmed = await confirm({
    title: t('admin.tasks.confirmDelete.title'),
    message: t('admin.tasks.confirmDelete.batch', { count: selectedTasks.value.length }),
    confirmType: 'danger',
    confirmText: `${t('common.dialogs.deleteButton')} (${selectedTasks.value.length})`,
    darkMode: darkMode.value
  })

  if (confirmed) {
    try {
      const targets = [...selectedTasks.value]
      const results = await Promise.allSettled(targets.map(jobId => deleteJob(jobId)))
      const failedIds = []
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          failedIds.push(targets[index])
        }
      })
      selectedTasks.value = failedIds
      await fetchTasks()
      if (failedIds.length > 0) {
        log.error('[AdminTasksView] 部分任务删除失败:', failedIds)
      }
    } catch (error) {
      log.error('Failed to batch delete tasks:', error)
    }
  }
}

const handleBatchCancel = async () => {
  const targets = selectedCancellableTaskIds.value
  if (!targets || targets.length === 0) return

  const confirmed = await confirm({
    title: t('admin.tasks.confirmCancel.title'),
    message: t('admin.tasks.confirmCancel.batch', { count: targets.length }),
    confirmType: 'warning',
    confirmText: `${t('admin.tasks.actions.cancel')} (${targets.length})`,
    darkMode: darkMode.value
  })

  if (confirmed) {
    try {
      const results = await Promise.allSettled(targets.map(jobId => cancelJob(jobId)))
      const failedIds = []
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          failedIds.push(targets[index])
        }
      })
      selectedTasks.value = failedIds
      await fetchTasks()
      if (failedIds.length > 0) {
        log.error('[AdminTasksView] 部分任务取消失败:', failedIds)
      }
    } catch (error) {
      log.error('[AdminTasksView] 批量取消任务失败:', error)
    }
  }
}

// ===== 复制任务重试 =====
const normalizeCopyItems = (items = []) => {
  return items
    .filter(item => item?.sourcePath && item?.targetPath)
    .map(item => ({
      sourcePath: item.sourcePath,
      targetPath: item.targetPath
    }))
}

const handleRetryAllFailed = async ({ task, items }) => {
  try {
    const rawItems = items && items.length > 0 ? items : (task?.stats?.itemResults || [])
    const failedItems = rawItems.filter(item => item?.status === 'failed')
    const copyItems = normalizeCopyItems(failedItems)

    if (copyItems.length === 0) {
      log.warn('[AdminTasksView] 没有可重试的失败项')
      return
    }

    await batchCopyItems(copyItems, task?.payload?.options || {})
    await fetchTasks()
  } catch (error) {
    log.error('[AdminTasksView] 重试全部失败项失败:', error)
  }
}

const handleRetryFile = async ({ task, item }) => {
  try {
    const copyItems = normalizeCopyItems([item])
    if (copyItems.length === 0) {
      log.warn('[AdminTasksView] 失败项缺少路径，无法重试')
      return
    }

    await batchCopyItems(copyItems, task?.payload?.options || {})
    await fetchTasks()
  } catch (error) {
    log.error('[AdminTasksView] 重试单个失败项失败:', error)
  }
}

// 轮询运行中/待执行任务状态
const pollRunningTasks = async () => {
  const runningTasks = tasks.value.filter(t => t.status === 'running' || t.status === 'pending')
  if (runningTasks.length === 0) return

  // Fetch status for each running task in parallel
  const updates = await Promise.allSettled(
    runningTasks.map(task => getJobStatus(task.jobId))
  )

  // Update tasks array with new data
  updates.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value?.data) {
      const updatedTask = result.value.data
      const taskIndex = tasks.value.findIndex(t => t.jobId === updatedTask.jobId)
      if (taskIndex !== -1) {
        tasks.value[taskIndex] = updatedTask
      }
    }
  })
}

// Lifecycle
onMounted(() => {
  fetchJobTypes()
  fetchTasks()
  // 仅在存在运行中/待执行任务时轮询
  resumePoll()
})

onUnmounted(() => {
  pausePoll()
})
</script>

<style scoped>
/* Custom scrollbar for table */
.overflow-auto::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.overflow-auto::-webkit-scrollbar-track {
  background: #f3f4f6;
  border-radius: 4px;
}

.dark .overflow-auto::-webkit-scrollbar-track {
  background: #374151;
}

.overflow-auto::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 4px;
}

.dark .overflow-auto::-webkit-scrollbar-thumb {
  background: #6b7280;
}

.overflow-auto::-webkit-scrollbar-thumb:hover {
  background: #9ca3af;
}

.dark .overflow-auto::-webkit-scrollbar-thumb:hover {
  background: #9ca3af;
}
</style>
