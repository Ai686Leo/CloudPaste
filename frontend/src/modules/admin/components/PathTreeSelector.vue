<template>
  <div class="path-tree-selector" :class="{ 'fullscreen-mode': isFullscreen }">
    <!-- 工具栏 - 精简版 -->
    <div class="flex items-center justify-between mb-2">
      <!-- 面包屑导航 -->
      <div
        class="flex-1 flex items-center gap-1 text-sm overflow-x-auto py-1.5 px-2 rounded-md mr-2"
        :class="darkMode ? 'bg-gray-800/50 text-gray-300' : 'bg-gray-50 text-gray-600'"
      >
        <!-- 根目录图标按钮 -->
        <button
          @click="loadDirectory('/')"
          class="p-1 rounded transition-colors flex-shrink-0"
          :class="[
            darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200',
            currentPath === '/' ? (darkMode ? 'text-primary-400' : 'text-primary-600') : (darkMode ? 'text-gray-400' : 'text-gray-500')
          ]"
          :title="$t('admin.scheduledJobs.syncTask.goToRoot', '返回根目录')"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        </button>

        <!-- 路径段 -->
        <template v-for="(segment, index) in pathSegments" :key="index">
          <svg class="w-3 h-3 flex-shrink-0" :class="darkMode ? 'text-gray-600' : 'text-gray-300'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
          <button
            @click="navigateToSegment(index)"
            class="px-1.5 py-0.5 rounded transition-colors whitespace-nowrap max-w-[100px] truncate text-xs"
            :class="[
              darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200',
              index === pathSegments.length - 1 ? (darkMode ? 'text-primary-400 font-medium' : 'text-primary-600 font-medium') : ''
            ]"
            :title="segment"
          >
            {{ segment }}
          </button>
        </template>
      </div>

      <!-- 快捷操作按钮组 -->
      <div class="flex items-center gap-0.5 flex-shrink-0">
        <!-- 返回上级 -->
        <button
          @click="goUp"
          :disabled="currentPath === '/'"
          class="p-1.5 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'"
          :title="$t('admin.scheduledJobs.syncTask.goUp', '返回上级')"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
        </button>

        <!-- 刷新 -->
        <button
          @click="loadDirectory(currentPath, true)"
          :disabled="loading"
          class="p-1.5 rounded-md transition-colors disabled:opacity-30"
          :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'"
          :title="$t('admin.scheduledJobs.syncTask.refresh', '刷新')"
        >
          <svg class="w-4 h-4" :class="{ 'animate-spin': loading }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 树形列表容器 -->
    <div
      class="border rounded-md overflow-y-auto"
      :class="darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-white'"
      :style="{ maxHeight: maxHeight }"
    >
      <!-- 加载状态 -->
      <div v-if="loading" class="p-4 text-center" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
        <svg class="animate-spin h-5 w-5 mx-auto mb-2" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        {{ $t('admin.scheduledJobs.syncTask.loading', '加载中...') }}
      </div>

      <!-- 错误状态 -->
      <div v-else-if="error" class="p-4 text-center" :class="darkMode ? 'text-red-400' : 'text-red-600'">
        <svg class="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p class="text-sm">{{ error }}</p>
        <button
          @click="loadDirectory(currentPath)"
          class="mt-2 text-xs underline hover:no-underline"
        >
          {{ $t('admin.scheduledJobs.syncTask.retry', '点击重试') }}
        </button>
      </div>

      <!-- 空状态 -->
      <div v-else-if="items.length === 0" class="p-6 text-center" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
        <!-- 目录为空 -->
        <svg class="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
        </svg>
        <p class="text-sm font-medium mb-1">{{ $t('admin.scheduledJobs.syncTask.emptyDirectory', '目录为空') }}</p>
        <p class="text-xs opacity-70">{{ $t('admin.scheduledJobs.syncTask.emptyDirectoryHint', '当前目录下没有可选内容') }}</p>
      </div>

      <!-- 树形列表 -->
      <div v-else class="divide-y" :class="darkMode ? 'divide-gray-700' : 'divide-gray-200'">
        <PathTreeItem
          v-for="item in items"
          :key="item.path"
          :item="item"
          :dark-mode="darkMode"
          :selected-path="selectedPath"
          :allow-files="allowFiles"
          @select="handleSelect"
          @enter="handleEnterDirectory"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { getDirectoryList } from '@/api/services/fsService'
import PathTreeItem from './PathTreeItem.vue'

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  darkMode: {
    type: Boolean,
    default: false
  },
  allowFiles: {
    type: Boolean,
    default: false
  },
  maxHeight: {
    type: String,
    default: '300px'
  }
})

const emit = defineEmits(['update:modelValue'])

// 状态
const loading = ref(false)
const error = ref(null)
const items = ref([])
const currentPath = ref('/')
const selectedPath = ref(props.modelValue)
const isFullscreen = ref(false)

// ========== 请求去重 ==========
let pendingRequest = null
let pendingPath = null
let isInitialLoaded = false

// 面包屑路径段（不包含根目录）
const pathSegments = computed(() => {
  if (!currentPath.value || currentPath.value === '/') {
    return []
  }
  return currentPath.value.split('/').filter(Boolean)
})

// 排序函数：文件夹优先，然后按名称字母顺序
const sortItems = (itemList) => {
  return [...itemList].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
  })
}

// 加载目录列表（带请求去重）
const loadDirectory = async (path = '/', forceRefresh = false) => {
  if (pendingRequest && pendingPath === path) {
    return pendingRequest
  }

  loading.value = true
  error.value = null
  pendingPath = path

  try {
    // forceRefresh 参数传递给后端，由后端决定是否跳过缓存
    pendingRequest = getDirectoryList(path, { refresh: forceRefresh })
    const response = await pendingRequest

    if (response.success && response.data) {
      const allItems = response.data.items || []
      // 过滤：如果不允许文件，只显示文件夹
      const filtered = props.allowFiles
        ? allItems
        : allItems.filter(item => item.isDirectory)
      // 排序：文件夹优先，然后按名称字母顺序
      items.value = sortItems(filtered)
      currentPath.value = path
    } else {
      error.value = response.message || '加载失败'
    }
  } catch (err) {
    error.value = err.message || '加载失败'
  } finally {
    loading.value = false
    pendingRequest = null
    pendingPath = null
  }
}

// 处理选择 - 点击项目时选中（文件或文件夹都可选中）
const handleSelect = (item) => {
  if (props.allowFiles || item.isDirectory) {
    selectedPath.value = item.path
    emit('update:modelValue', item.path)
  }
}

// 处理进入目录 - 点击箭头按钮时进入文件夹
const handleEnterDirectory = (item) => {
  if (item.isDirectory) {
    loadDirectory(item.path)
  }
}

// 返回上级目录
const goUp = () => {
  if (currentPath.value === '/') return

  const segments = currentPath.value.split('/').filter(Boolean)
  if (segments.length <= 1) {
    loadDirectory('/')
  } else {
    const parentPath = '/' + segments.slice(0, -1).join('/')
    loadDirectory(parentPath)
  }
}

// 导航到面包屑段
const navigateToSegment = (index) => {
  const path = '/' + pathSegments.value.slice(0, index + 1).join('/')
  loadDirectory(path)
}

// 监听 modelValue 变化
watch(() => props.modelValue, (newVal) => {
  selectedPath.value = newVal
})

// 组件挂载时加载根目录（仅首次）
onMounted(() => {
  if (!isInitialLoaded) {
    isInitialLoaded = true
    loadDirectory('/')
  }
})
</script>

<style scoped>
.path-tree-selector {
  @apply w-full;
}

/* 全屏模式样式 */
.path-tree-selector.fullscreen-mode {
  @apply fixed inset-4 z-50 p-4 rounded-lg shadow-2xl;
}

/* 滚动条美化 */
.path-tree-selector ::-webkit-scrollbar {
  @apply w-1.5;
}

.path-tree-selector ::-webkit-scrollbar-track {
  @apply bg-transparent;
}

.path-tree-selector ::-webkit-scrollbar-thumb {
  @apply bg-gray-300 rounded-full;
}

.path-tree-selector.dark ::-webkit-scrollbar-thumb {
  @apply bg-gray-600;
}
</style>
