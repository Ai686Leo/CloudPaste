<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-2 py-2">
      <!-- 左侧操作按钮组 -->
      <div class="flex items-center space-x-2">
        <!-- 上传文件按钮 -->
        <button
          v-if="!isVirtual"
          @click="openUploadFileDialog"
          class="inline-flex items-center px-3 py-1.5 rounded-md transition-colors text-sm font-medium"
          :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'"
        >
          <IconUpload size="sm" class="mr-1.5" />
          <span>{{ t("mount.operations.upload") }}</span>
        </button>

        <!-- 新建文件夹按钮 -->
        <button
          v-if="!isVirtual"
          @click="createFolder"
          class="inline-flex items-center px-3 py-1.5 rounded-md transition-colors text-sm font-medium"
          :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'"
        >
          <IconFolderPlus size="sm" class="mr-1.5" />
          <span>{{ t("mount.operations.createFolder") }}</span>
        </button>
      </div>

      <!-- 右侧视图操作按钮组 -->
      <div class="flex items-center space-x-2">
        <!-- 文件篮按钮 -->
        <div class="mr-2">
          <FileBasket :dark-mode="darkMode" @task-created="$emit('task-created', $event)" @show-message="$emit('show-message', $event)" />
        </div>

        <!-- 任务管理按钮 -->
        <button
          @click="$emit('openTasksModal')"
          class="inline-flex items-center px-3 py-1.5 rounded-md transition-colors text-sm font-medium mr-2"
          :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'"
        >
          <IconTaskList size="sm" class="mr-1.5" />
          <span>{{ t("mount.operations.tasks") }}</span>
        </button>

        <!-- 视图切换按钮组 -->
        <div class="flex rounded-md overflow-hidden border" :class="darkMode ? 'border-gray-700' : 'border-gray-300'">
          <!-- 列表视图按钮 -->
          <button
            @click="changeViewMode('list')"
            class="inline-flex items-center px-2 py-1.5 transition-colors text-sm"
            :class="[viewMode === 'list' ? (darkMode ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-800') : darkMode ? 'bg-gray-800 text-gray-400' : 'bg-white text-gray-500']"
          >
            <IconList size="sm" />
          </button>

          <!-- 网格视图按钮 -->
          <button
            @click="changeViewMode('grid')"
            class="inline-flex items-center px-2 py-1.5 transition-colors text-sm"
            :class="[viewMode === 'grid' ? (darkMode ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-800') : darkMode ? 'bg-gray-800 text-gray-400' : 'bg-white text-gray-500']"
          >
            <IconGrid size="sm" />
          </button>

          <!-- 图廊视图按钮 -->
          <button
            @click="changeViewMode('gallery')"
            class="inline-flex items-center px-2 py-1.5 transition-colors text-sm"
            :class="[
              viewMode === 'gallery' ? (darkMode ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-800') : darkMode ? 'bg-gray-800 text-gray-400' : 'bg-white text-gray-500',
            ]"
          >
            <IconGallery size="sm" />
          </button>
        </div>

        <!-- 刷新按钮 -->
        <button
          @click="$emit('refresh')"
          class="inline-flex items-center px-3 py-1.5 rounded-md transition-colors text-sm font-medium"
          :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'"
        >
          <IconRefresh size="sm" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from "vue-i18n";
import FileBasket from "./FileBasket.vue";
import {
  IconUpload,
  IconFolderPlus,
  IconTaskList,
  IconList,
  IconGrid,
  IconGallery,
  IconRefresh
} from '@/components/icons';

const { t } = useI18n();

const props = defineProps({
  currentPath: {
    type: String,
    required: true,
    default: "/",
  },
  isVirtual: {
    type: Boolean,
    default: false,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  viewMode: {
    type: String,
    default: "list", // 'list' | 'grid' | 'gallery'
  },
});

const emit = defineEmits(["upload", "createFolder", "refresh", "changeViewMode", "openUploadModal", "openTasksModal", "task-created", "show-message"]);

// 视图模式切换
const changeViewMode = (mode) => {
  emit("changeViewMode", mode);
};

// 打开文件上传对话框
const openUploadFileDialog = () => {
  emit("openUploadModal");
};

// 新建文件夹
const createFolder = () => {
  emit("createFolder");
};
</script>
