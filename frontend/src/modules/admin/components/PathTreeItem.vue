<template>
  <div
    class="path-tree-item flex items-center px-3 py-2.5 cursor-pointer transition-colors group"
    :class="[
      isSelected
        ? (darkMode ? 'bg-primary-900/40 border-l-2 border-primary-400' : 'bg-primary-50 border-l-2 border-primary-500')
        : (darkMode ? 'hover:bg-gray-700/70 border-l-2 border-transparent' : 'hover:bg-gray-50 border-l-2 border-transparent'),
      darkMode ? 'text-gray-300' : 'text-gray-700'
    ]"
    @click="handleClick"
    @dblclick="handleDoubleClick"
  >
    <!-- 选中指示点 -->
    <div
      v-if="isSelected"
      class="flex-shrink-0 mr-2 w-1.5 h-1.5 rounded-full"
      :class="darkMode ? 'bg-primary-400' : 'bg-primary-500'"
    ></div>

    <!-- 文件/文件夹图标 - 使用统一的 getFileIcon -->
    <div class="flex-shrink-0 mr-2.5 w-5 h-5" v-html="fileIconHtml"></div>

    <!-- 文件/文件夹名称 -->
    <div class="flex-1 min-w-0">
      <div
        class="truncate text-sm"
        :class="isSelected ? 'font-semibold' : 'font-medium'"
      >
        {{ item.name }}
      </div>
      <!-- 文件大小（如有） -->
      <div v-if="!item.isDirectory && item.size" class="text-xs mt-0.5" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
        {{ formatSize(item.size) }}
      </div>
    </div>

    <!-- 文件夹进入箭头按钮 - 始终显示（文件夹时） -->
    <button
      v-if="item.isDirectory"
      @click.stop="handleEnter"
      class="flex-shrink-0 ml-2 p-1 rounded transition-all"
      :class="[
        darkMode
          ? 'text-gray-500 hover:text-primary-400 hover:bg-gray-700'
          : 'text-gray-400 hover:text-primary-500 hover:bg-gray-100',
        'opacity-50 group-hover:opacity-100'
      ]"
      :title="$t('admin.scheduledJobs.syncTask.enterFolder', '进入文件夹')"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { getFileIcon } from '@/utils/fileTypeIcons.js'
import { detectFileTypeFromFilename, FileType } from '@/utils/fileTypes.js'

const props = defineProps({
  item: {
    type: Object,
    required: true
  },
  darkMode: {
    type: Boolean,
    default: false
  },
  selectedPath: {
    type: String,
    default: ''
  },
  allowFiles: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['select', 'enter'])

// 是否选中
const isSelected = computed(() => {
  return props.selectedPath === props.item.path
})

// 获取文件图标 HTML
const fileIconHtml = computed(() => {
  // 构造符合 getFileIcon 期望的对象格式
  // 关键：需要根据文件名检测 type，因为 API 可能不返回 type 字段
  const itemType = props.item.isDirectory
    ? FileType.FOLDER
    : (props.item.type ?? detectFileTypeFromFilename(props.item.name))

  const iconItem = {
    isDirectory: props.item.isDirectory,
    isMount: props.item.isMount || false,
    filename: props.item.name,
    name: props.item.name,
    type: itemType
  }
  return getFileIcon(iconItem, props.darkMode)
})

// 格式化文件大小
const formatSize = (bytes) => {
  if (!bytes || bytes === 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let unitIndex = 0
  let size = bytes
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`
}

// 处理点击 - 选中项目（文件或文件夹都可选中）
const handleClick = () => {
  emit('select', props.item)
}

// 处理双击 - 文件夹双击进入目录
const handleDoubleClick = () => {
  if (props.item.isDirectory) {
    emit('enter', props.item)
  }
}

// 处理进入文件夹（箭头按钮）
const handleEnter = () => {
  if (props.item.isDirectory) {
    emit('enter', props.item)
  }
}
</script>

<style scoped>
.path-tree-item {
  @apply select-none;
  /* 禁用移动端双击缩放，使双击事件正常工作 */
  touch-action: manipulation;
}
</style>
