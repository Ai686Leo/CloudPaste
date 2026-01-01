<template>
  <Teleport to="body">
    <div v-if="isOpen" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/20 backdrop-blur-[1px]" @click="close"></div>

      <!-- 面板本体 -->
      <div
        class="relative w-full max-w-lg bg-white/95 dark:bg-gray-800/95 backdrop-blur-md rounded-xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 flex flex-col overflow-hidden transition-all duration-200"
      >
        <!-- 标题栏 -->
        <div class="flex-shrink-0 px-4 py-3 border-b flex justify-between items-center" :class="darkMode ? 'border-gray-700/50' : 'border-gray-200/50'">
          <h3 class="text-lg font-medium" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">
            {{ t("fileBasket.panel.title") }}
          </h3>
          <button @click="close" class="text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <IconClose size="sm" aria-hidden="true" />
          </button>
        </div>

        <!-- 统计信息 -->
        <div v-if="hasCollection" class="px-4 py-3 border-b bg-gray-50/50 dark:bg-gray-900/30" :class="darkMode ? 'border-gray-700/50' : 'border-gray-200/50'">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-sm" :class="darkMode ? 'text-blue-200' : 'text-blue-800'">{{ collectionCount }} 个文件，来自 {{ directoryCount }} 个目录</div>
              <div class="text-xs mt-1" :class="darkMode ? 'text-blue-300' : 'text-blue-600'">总大小：{{ collectionTotalSizeMB }} MB</div>
            </div>
            <!-- 全部展开/收起按钮 -->
            <button
              @click="toggleAllDirectories"
              class="text-xs px-2 py-1 rounded transition-colors"
              :class="darkMode ? 'text-blue-300 hover:text-blue-200 hover:bg-blue-800/30' : 'text-blue-600 hover:text-blue-700 hover:bg-blue-100'"
            >
              {{ allDirectoriesExpanded ? "全部收起" : "全部展开" }}
            </button>
          </div>
        </div>

        <!-- 内容区 -->
        <div class="flex-1 overflow-y-auto p-3 sm:p-4" style="max-height: 500px; min-height: 200px;">
          <!-- 空状态 -->
          <div v-if="!hasCollection" class="text-center py-8" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
            <IconCollection class="h-12 w-12 mx-auto mb-3 opacity-30" aria-hidden="true" />
            <p class="font-medium">{{ t("fileBasket.panel.empty") }}</p>
            <p class="text-xs mt-1 opacity-75">{{ t("fileBasket.panel.emptyDescription") }}</p>
          </div>

          <!-- 文件列表 -->
          <div v-else class="space-y-3">
            <div v-for="(files, directory) in filesByDirectory" :key="directory" class="border rounded-lg overflow-hidden bg-white/50 dark:bg-gray-900/20" :class="darkMode ? 'border-gray-700/50' : 'border-gray-200/50'">
              <!-- 目录标题 -->
              <div
                @click="toggleDirectory(directory)"
                class="px-3 py-2 text-sm font-medium flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                :class="darkMode ? 'bg-gray-750 text-gray-300 hover:bg-gray-700' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'"
              >
                <div class="flex items-center space-x-2">
                  <IconChevronRight
                    size="sm"
                    class="transition-transform duration-200"
                    :class="isDirectoryExpanded(directory) ? 'rotate-90' : ''"
                    aria-hidden="true"
                  />
                  <IconFolder size="sm" aria-hidden="true" />
                  <span class="truncate">{{ directory }}</span>
                </div>
                <span class="text-xs opacity-75 flex-shrink-0">{{ (files || []).length }} 个文件</span>
              </div>

              <!-- 文件列表 -->
              <div v-if="isDirectoryExpanded(directory)" class="divide-y" :class="darkMode ? 'divide-gray-700/30' : 'divide-gray-100'">
                <div
                  v-for="file in getValidFiles(files)"
                  :key="file.uniqueId"
                  class="px-3 py-2 flex items-center justify-between hover:bg-blue-50/50 dark:hover:bg-blue-900/10 group transition-colors"
                  :class="darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'"
                >
                  <div class="flex items-center space-x-2 flex-1 min-w-0">
                    <div class="w-5 h-5 flex-shrink-0" v-html="getFileIcon(file, darkMode)"></div>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium truncate" :class="darkMode ? 'text-gray-200' : 'text-gray-900'">
                        {{ file.name }}
                      </p>
                      <p class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                        {{ formatFileSize(file.size) }}
                      </p>
                    </div>
                  </div>
                  <button
                    @click="removeFile(file.path)"
                    class="opacity-0 group-hover:opacity-100 p-1 rounded transition-all duration-200 flex-shrink-0"
                    :class="darkMode ? 'text-red-400 hover:text-red-300 hover:bg-red-900/30' : 'text-red-500 hover:text-red-600 hover:bg-red-50'"
                    :title="t('fileBasket.actions.remove')"
                  >
                    <IconClose size="sm" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部操作栏 (Updated: Side-by-side) -->
        <div v-if="hasCollection" class="px-4 py-3 border-t flex space-x-3 bg-gray-50/50 dark:bg-gray-900/30" :class="darkMode ? 'border-gray-700/50' : 'border-gray-200/50'">
          <button
            @click="handleClearBasket"
            :disabled="isProcessing"
            class="flex-1 px-4 py-2 rounded-md font-medium transition-colors"
            :class="[darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-200 hover:bg-gray-300 text-gray-700', isProcessing ? 'opacity-50 cursor-not-allowed' : '']"
          >
            {{ t("fileBasket.actions.clear") }}
          </button>

          <button
            @click="handlePackDownload"
            :disabled="isProcessing"
            class="flex-[2] flex items-center justify-center space-x-2 px-4 py-2 rounded-md font-medium transition-colors shadow-sm"
            :class="[isProcessing ? 'bg-gray-400 text-white cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20']"
          >
            <IconDownload size="sm" aria-hidden="true" />
            <span>{{ isProcessing ? t("fileBasket.status.processing") : t("fileBasket.actions.packDownload") }}</span>
          </button>
        </div>

        <ConfirmDialog
          v-bind="dialogState"
          @confirm="handleConfirm"
          @cancel="handleCancel"
        />
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onUnmounted, ref, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { IconChevronRight, IconClose, IconCollection, IconDownload, IconFolder } from "@/components/icons";
import { storeToRefs } from "pinia";
import { useFileBasket } from "@/composables/file-system/useFileBasket.js";
import { useConfirmDialog } from "@/composables/core/useConfirmDialog.js";
import { formatFileSize } from "@/utils/fileUtils.js";
import { getFileIcon } from "@/utils/fileTypeIcons.js";
import ConfirmDialog from "@/components/common/dialogs/ConfirmDialog.vue";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();
const log = createLogger("FileBasketPanel");

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



const emit = defineEmits(["close", "task-created", "show-message"]);

// 使用文件篮composable
const fileBasket = useFileBasket();

// 确认对话框
const { dialogState, confirm, handleConfirm, handleCancel } = useConfirmDialog();

// 直接从store获取计算属性，避免storeToRefs的问题
const filesByDirectory = computed(() => fileBasket.filesByDirectory.value);
const collectionCount = computed(() => fileBasket.collectionCount.value);
const directoryCount = computed(() => fileBasket.directoryCount.value);
const collectionTotalSizeMB = computed(() => fileBasket.collectionTotalSizeMB.value);
const hasCollection = computed(() => fileBasket.hasCollection.value);

// 本地状态
const isProcessing = ref(false);

// 关闭面板
const close = () => {
  emit("close");
};

// 过滤有效的文件对象
const getValidFiles = (files) => {
  if (!Array.isArray(files)) return [];

  return files.filter((file) => {
    // 严格验证文件对象
    if (!file || typeof file !== "object") return false;
    if (!file.name || typeof file.name !== "string") return false;
    if (!file.uniqueId || typeof file.uniqueId !== "string") return false;
    if (!file.path || typeof file.path !== "string") return false;
    if (typeof file.size !== "number" || file.size < 0) return false;

    return true;
  });
};

// 文件夹展开状态管理
const expandedDirectories = ref(new Set());

// 切换文件夹展开状态
const toggleDirectory = (directory) => {
  if (expandedDirectories.value.has(directory)) {
    expandedDirectories.value.delete(directory);
  } else {
    expandedDirectories.value.add(directory);
  }
};

// 检查文件夹是否展开
const isDirectoryExpanded = (directory) => {
  return expandedDirectories.value.has(directory);
};

// 检查是否所有文件夹都已展开
const allDirectoriesExpanded = computed(() => {
  if (!filesByDirectory.value || typeof filesByDirectory.value !== "object") return false;
  const allDirectories = Object.keys(filesByDirectory.value);
  return allDirectories.length > 0 && allDirectories.every((dir) => expandedDirectories.value.has(dir));
});

// 全部展开/收起
const toggleAllDirectories = () => {
  if (!filesByDirectory.value || typeof filesByDirectory.value !== "object") return;

  const allDirectories = Object.keys(filesByDirectory.value);

  if (allDirectoriesExpanded.value) {
    // 全部收起
    expandedDirectories.value.clear();
  } else {
    // 全部展开
    allDirectories.forEach((directory) => {
      expandedDirectories.value.add(directory);
    });
  }
};

// 初始化展开状态 - 默认展开所有文件夹
watch(
  filesByDirectory,
  (newValue) => {
    if (newValue && typeof newValue === "object") {
      Object.keys(newValue).forEach((directory) => {
        if (!expandedDirectories.value.has(directory)) {
          expandedDirectories.value.add(directory);
        }
      });
    }
  },
  { immediate: true }
);

// 移除文件
const removeFile = (filePath) => {
  try {
    const result = fileBasket.removeFromBasket(filePath);
    if (result.success) {
      emit("show-message", { type: "success", message: result.message });
    } else {
      emit("show-message", { type: "error", message: result.message });
    }
  } catch (error) {
    log.error("移除文件失败:", error);
    emit("show-message", { type: "error", message: t("fileBasket.messages.removeFailed") });
  }
};

// 处理打包下载
const handlePackDownload = async () => {
  if (isProcessing.value) return;

  try {
    isProcessing.value = true;

    const result = await fileBasket.createPackTask();

    if (result.success) {
      emit("show-message", { type: "success", message: result.message });
      emit("task-created", result);
      close(); // 关闭面板
    } else {
      emit("show-message", { type: "error", message: result.message });
    }
  } catch (error) {
    log.error("创建打包任务失败:", error);
    emit("show-message", { type: "error", message: t("fileBasket.messages.taskCreateFailed") });
  } finally {
    isProcessing.value = false;
  }
};

// 处理清空篮子
const handleClearBasket = async () => {
  if (isProcessing.value) return;

  // 使用统一确认对话框
  const confirmed = await confirm({
    title: t("fileBasket.confirmations.clearTitle", "确认清空"),
    message: t("fileBasket.confirmations.clearBasket"),
    confirmType: "warning",
    confirmText: t("fileBasket.actions.clear"),
    darkMode: props.darkMode,
  });
  if (!confirmed) return;

  try {
    const result = fileBasket.clearBasket();
    if (result.success) {
      emit("show-message", { type: "success", message: result.message });
      close(); // 关闭面板
    } else {
      emit("show-message", { type: "error", message: result.message });
    }
  } catch (error) {
    log.error("清空文件篮失败:", error);
    emit("show-message", { type: "error", message: t("fileBasket.messages.clearFailed") });
  }
};

// 组件卸载时清理
onUnmounted(() => {
  // 如果正在处理任务，尝试清理
  if (isProcessing.value) {
    isProcessing.value = false;
  }

  // 清理展开状态
  expandedDirectories.value.clear();
});
</script>
