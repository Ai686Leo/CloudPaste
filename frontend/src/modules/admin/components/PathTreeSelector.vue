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
          <IconHome size="sm" aria-hidden="true" />
        </button>

        <!-- 路径段 -->
        <template v-for="(segment, index) in pathSegments" :key="index">
          <IconChevronRight size="xs" class="flex-shrink-0" :class="darkMode ? 'text-gray-600' : 'text-gray-300'" aria-hidden="true" />
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
          <IconBack size="sm" aria-hidden="true" />
        </button>

        <!-- 刷新 -->
        <button
          @click="loadDirectory(currentPath, true)"
          :disabled="loading"
          class="p-1.5 rounded-md transition-colors disabled:opacity-30"
          :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'"
          :title="$t('admin.scheduledJobs.syncTask.refresh', '刷新')"
        >
          <IconRefresh size="sm" :class="{ 'animate-spin': loading }" aria-hidden="true" />
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
        <IconRefresh class="animate-spin mx-auto mb-2" aria-hidden="true" />
        {{ $t('admin.scheduledJobs.syncTask.loading', '加载中...') }}
      </div>

      <!-- 错误状态 -->
      <div v-else-if="error" class="p-4 text-center" :class="darkMode ? 'text-red-400' : 'text-red-600'">
        <IconInformationCircle size="xl" class="mx-auto mb-2 opacity-50" aria-hidden="true" />
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
        <IconFolderOpen size="2xl" class="mx-auto mb-3 opacity-40" aria-hidden="true" />
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
import { IconBack, IconChevronRight, IconFolderOpen, IconHome, IconInformationCircle, IconRefresh } from '@/components/icons'

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
