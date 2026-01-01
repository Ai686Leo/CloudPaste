<template>
  <Teleport to="body">
    <div v-if="isOpen" class="fixed inset-0 z-[70] overflow-auto bg-black bg-opacity-50 flex items-center justify-center p-4" @click="handleBackdropClick">
      <div class="relative w-full max-w-2xl rounded-lg shadow-xl" :class="darkMode ? 'bg-gray-800' : 'bg-white'" @click.stop>
        <!-- 标题栏 -->
        <div class="px-6 py-4 border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
          <h3 class="text-lg font-semibold" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">{{ t("common.dialogs.selectUpload.title") }}</h3>
          <p class="text-sm mt-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ t("common.dialogs.selectUpload.description", { count: uploads.length }) }}</p>
        </div>

        <!-- 上传选项列表 -->
        <div class="px-6 py-4">
          <div class="max-h-96 overflow-y-auto space-y-3 custom-scrollbar">
            <div
              v-for="(upload, index) in uploads"
              :key="upload.uploadId || index"
              class="p-4 border rounded-lg cursor-pointer transition-all duration-200"
              :class="[
                selectedIndex === index
                  ? darkMode
                    ? 'border-blue-500 bg-blue-900/20 ring-1 ring-blue-500/50'
                    : 'border-blue-500 bg-blue-50 ring-1 ring-blue-500/50'
                  : darkMode
                  ? 'border-gray-600 hover:border-gray-500 hover:bg-gray-700/50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50',
                index === 0 ? 'ring-2 ring-green-200 dark:ring-green-800' : '',
              ]"
              @click="selectedIndex = index"
            >
              <div class="flex items-center justify-between">
                <div class="flex-1 min-w-0">
                  <!-- 文件路径和推荐标签 -->
                  <div class="flex items-center gap-2 mb-2">
                    <span class="font-medium truncate" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">
                      {{ upload.key }}
                    </span>
                    <span v-if="index === 0" class="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 flex-shrink-0">
                      {{ t("common.dialogs.selectUpload.recommended") }}
                    </span>
                  </div>

                  <!-- 详细信息 -->
                  <div class="space-y-2">
                    <!-- 第一行：时间信息 -->
                    <div class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                      <span class="inline-flex items-center gap-1">
                        <IconClock size="sm" class="flex-shrink-0" />
                        {{ formatDate(upload.initiated) }}
                      </span>
                    </div>

                    <!-- 第二行：匹配度、分片信息和ID -->
                    <div class="flex items-center gap-3 text-sm flex-wrap" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                      <!-- 匹配度 -->
                      <span v-if="showMatchScore" class="inline-flex items-center gap-1">
                        <IconCheckbox size="sm" class="flex-shrink-0" />
                        {{ t("common.dialogs.selectUpload.matchScore", { score: getMatchScoreDisplay(upload, index) }) }}
                      </span>

                      <!-- 分隔符 -->
                      <span v-if="showMatchScore" class="text-gray-300 dark:text-gray-600">•</span>

                      <!-- 已上传分片数量 -->
                      <span class="inline-flex items-center gap-1 flex-wrap">
                        <IconDocument size="sm" class="flex-shrink-0" />
                        <span>{{ getUploadedPartsInfo(upload).partsText }}</span>
                        <span
                          v-if="getUploadedPartsInfo(upload).progressText"
                          class="text-xs"
                          :class="darkMode ? 'text-gray-500' : 'text-gray-400'"
                        >
                          · {{ getUploadedPartsInfo(upload).progressText }}
                        </span>
                      </span>

                      <!-- 失败分片提示（如果有） -->
                      <template v-if="getPartErrorsCount(upload) > 0">
                        <span class="text-gray-300 dark:text-gray-600">•</span>
                        <span class="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                          {{ t("common.dialogs.selectUpload.partErrors", { count: getPartErrorsCount(upload) }) }}
                        </span>
                      </template>

                      <!-- 分隔符和上传ID -->
                      <template v-if="upload.uploadId">
                        <span class="text-gray-300 dark:text-gray-600">•</span>
                        <button
                          @click.stop="copyUploadId(upload.uploadId)"
                          class="text-xs hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer inline-flex items-center gap-1"
                          :title="t('common.dialogs.selectUpload.copyIdTooltip', { id: upload.uploadId })"
                        >
                          <span>ID {{ formatUploadId(upload.uploadId) }}</span>
                          <IconCopy size="xs" />
                        </button>
                      </template>
                    </div>
                  </div>
                </div>

                <!-- 选择指示器 -->
                <div class="ml-4 flex-shrink-0">
                  <div
                    class="w-5 h-5 rounded-full border-2 flex items-center justify-center"
                    :class="selectedIndex === index ? 'border-blue-500 bg-blue-500' : darkMode ? 'border-gray-500' : 'border-gray-300'"
                  >
                    <div v-if="selectedIndex === index" class="w-2 h-2 bg-white rounded-full"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="px-6 py-4 border-t flex justify-end space-x-3" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
          <button
            @click="handleCancel"
            class="px-4 py-2 text-sm font-medium rounded-md transition-colors"
            :class="darkMode ? 'text-gray-300 hover:text-white hover:bg-gray-700' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'"
          >
            {{ t("common.dialogs.selectUpload.reupload") }}
          </button>
          <button
            @click="handleConfirm"
            class="px-4 py-2 text-sm font-medium rounded-md transition-colors"
            :class="darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'"
          >
            {{ t("common.dialogs.selectUpload.resumeSelected") }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { formatDateTimeWithSeconds } from "@/utils/timeUtils.js";
import { IconCheckbox, IconClock, IconCopy, IconDocument } from "@/components/icons";
import { useEventListener } from "@vueuse/core";
import { copyToClipboard } from "@/utils/clipboard";
import { createLogger } from "@/utils/logger.js";

// 国际化
const { t } = useI18n();
const log = createLogger("SelectUploadDialog");

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  file: {
    type: Object,
    default: null,
  },
  uploads: {
    type: Array,
    default: () => [],
  },
  showMatchScore: {
    type: Boolean,
    default: true,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  allowBackdropClose: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(["select", "cancel", "close"]);

// 选中的索引
const selectedIndex = ref(-1);

// 监听打开状态，重置选择
watch(
  () => props.isOpen,
  (newValue) => {
    if (newValue) {
      // 默认选中第一个（最佳匹配）
      selectedIndex.value = props.uploads.length > 0 ? 0 : -1;
    } else {
      selectedIndex.value = -1;
    }
  }
);

// 格式化日期
const formatDate = (dateString) => {
  return formatDateTimeWithSeconds(dateString);
};
// 获取匹配分数显示
const getMatchScoreDisplay = (upload, index) => {
  //使用 ServerResumePlugin 计算的真实匹配分数
  if (upload.matchScore !== undefined) {
    return (upload.matchScore * 100).toFixed(1);
  }

  // 备用计算：如果没有预计算的分数，使用简化算法
  const baseScore = 95 - index * 5;
  return Math.max(baseScore, 60).toFixed(1);
};

// 获取已上传分片数量的精确显示（分离主信息 + 小字进度）
const getUploadedPartsInfo = (upload) => {
  const buildProgressText = () => {
    const totalBytes = Number(upload?.fileSize) || 0;
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) return "";

    // 进度的“主依据”：
    // - 优先用 ServerResumePlugin 预先计算好的 bytesUploaded
    // - 如果没有 bytesUploaded，才用 uploadedParts/parts 的 size 求和兜底
    let uploadedBytes = Number(upload?.bytesUploaded);
    if (!Number.isFinite(uploadedBytes) || uploadedBytes < 0) {
      const parts = Array.isArray(upload?.uploadedParts) ? upload.uploadedParts : upload?.parts;
      if (!Array.isArray(parts) || parts.length === 0) return "";
      uploadedBytes = parts.reduce((sum, p) => {
        const s = Number(p?.size ?? p?.Size ?? 0);
        if (!Number.isFinite(s) || s <= 0) return sum;
        return sum + s;
      }, 0);
    }

    uploadedBytes = Math.min(Math.max(0, uploadedBytes), totalBytes);

    const uploadedMB = (uploadedBytes / (1024 * 1024)).toFixed(1);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
    const percentage = totalBytes > 0 ? ((uploadedBytes / totalBytes) * 100).toFixed(1) : "0.0";
    return t("common.dialogs.selectUpload.progressInfo", {
      percentage,
      uploaded: uploadedMB,
      total: totalMB,
    });
  };

  const progressText = buildProgressText();

  // 1. 优先使用服务器返回的分片信息（最准确）
  if (upload.uploadedParts && Array.isArray(upload.uploadedParts)) {
    const partCount = upload.uploadedParts.length;
    if (partCount > 0) {
      // 计算总分片数（优先使用服务端返回的 partSize）
      const partSize = Number(upload.partSize) > 0 ? Number(upload.partSize) : 5 * 1024 * 1024;
      const totalParts = upload.fileSize ? Math.ceil(upload.fileSize / partSize) : "?";
      return {
        partsText: t("common.dialogs.selectUpload.partsInfo", { count: partCount, total: totalParts }),
        progressText,
      };
    }
  }

  // 2. 使用 parts 字段（S3 ListParts 返回的格式）
  if (upload.parts && Array.isArray(upload.parts)) {
    const partCount = upload.parts.length;
    if (partCount > 0) {
      const partSize = Number(upload.partSize) > 0 ? Number(upload.partSize) : 5 * 1024 * 1024;
      const totalParts = upload.fileSize ? Math.ceil(upload.fileSize / partSize) : "?";
      return {
        partsText: t("common.dialogs.selectUpload.partsInfo", { count: partCount, total: totalParts }),
        progressText,
      };
    }
  }

  // 如果没有分片列表，但后端返回了 bytesUploaded，也给个进度提示
  if (progressText) {
    return {
      partsText: t("common.dialogs.selectUpload.partialComplete"),
      progressText,
    };
  }

  // 3. 使用进度信息计算
  if (upload.progress && upload.progress.uploadedBytes && upload.progress.totalBytes) {
    const percentage = ((upload.progress.uploadedBytes / upload.progress.totalBytes) * 100).toFixed(1);
    const uploadedMB = (upload.progress.uploadedBytes / (1024 * 1024)).toFixed(1);
    const totalMB = (upload.progress.totalBytes / (1024 * 1024)).toFixed(1);
    return {
      partsText: t("common.dialogs.selectUpload.partialComplete"),
      progressText: t("common.dialogs.selectUpload.progressInfo", { percentage, uploaded: uploadedMB, total: totalMB }),
    };
  }

  // 4. 使用单个分片编号（不太准确，但总比没有好）
  if (upload.partNumber && typeof upload.partNumber === "number") {
    return {
      partsText: t("common.dialogs.selectUpload.atLeastParts", { count: upload.partNumber }),
      progressText: "",
    };
  }

  // 5. 默认显示（最不准确）
  return {
    partsText: t("common.dialogs.selectUpload.partialComplete"),
    progressText: "",
  };
};

const getPartErrorsCount = (upload) => {
  const errors = upload?.partErrors;
  if (!Array.isArray(errors)) return 0;
  return errors.length;
};

// 格式化上传ID显示
const formatUploadId = (uploadId) => {
  if (!uploadId) return "";

  // 如果ID很长，显示前6位...后4位的格式
  if (uploadId.length > 8) {
    return `${uploadId.substring(0, 6)}...${uploadId.substring(uploadId.length - 4)}`;
  }

  // 短ID直接显示
  return uploadId;
};

// 制上传ID到剪贴板
const copyUploadId = async (uploadId) => {
  try {
    const success = await copyToClipboard(uploadId);
    if (!success) {
      throw new Error("copy_failed");
    }
  } catch (error) {
    log.error("复制失败:", error);
  }
};

// 事件处理
const handleConfirm = () => {
  if (selectedIndex.value >= 0) {
    const selectedUpload = props.uploads[selectedIndex.value];
    emit("select", selectedUpload);
    emit("close");
  }
};

const handleCancel = () => {
  emit("cancel");
  emit("close");
};

const handleBackdropClick = () => {
  if (props.allowBackdropClose) {
    handleCancel();
  }
};

// 键盘导航
const handleKeydown = (event) => {
  if (!props.isOpen) return;

  switch (event.key) {
    case "Escape":
      handleCancel();
      break;
    case "Enter":
      if (selectedIndex.value >= 0) {
        handleConfirm();
      }
      break;
    case "ArrowUp":
      event.preventDefault();
      if (selectedIndex.value > 0) {
        selectedIndex.value--;
      }
      break;
    case "ArrowDown":
      event.preventDefault();
      if (selectedIndex.value < props.uploads.length - 1) {
        selectedIndex.value++;
      }
      break;
  }
};

// 生命周期：自动注册/清理事件
useEventListener(document, "keydown", handleKeydown);
</script>

<style scoped>
/* 自定义滚动条 */
.custom-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: rgba(156, 163, 175, 0.5) transparent;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 8px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
  border-radius: 4px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: rgba(156, 163, 175, 0.7);
}

/* 暗色模式滚动条 */
.dark .custom-scrollbar {
  scrollbar-color: rgba(75, 85, 99, 0.5) transparent;
}

.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(75, 85, 99, 0.5);
}

.dark .custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: rgba(75, 85, 99, 0.7);
}
</style>
