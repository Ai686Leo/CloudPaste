<template>
  <div class="file-list">
    <!-- 加载状态 -->
    <div v-if="loading" class="flex justify-center items-center py-8">
      <svg class="animate-spin h-8 w-8" :class="darkMode ? 'text-gray-400' : 'text-gray-600'" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    </div>

    <!-- 无文件状态 -->
    <div v-else-if="!files.length" class="text-center py-8">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-12 w-12 mx-auto mb-3"
        :class="darkMode ? 'text-gray-500' : 'text-gray-400'"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      </svg>
      <p class="text-base" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">{{ t("file.noFilesUploaded") }}</p>
      <p class="text-sm mt-1" :class="darkMode ? 'text-gray-500' : 'text-gray-500'">{{ t("file.uploadToShow") }}</p>
    </div>

    <!-- 文件列表 -->
    <div v-else>
      <!-- 表格头部 - 桌面视图 -->
      <div class="hidden md:grid md:grid-cols-file-list gap-4 py-2 border-b mb-3" :class="darkMode ? 'border-gray-700 text-gray-300' : 'border-gray-200 text-gray-600'">
        <div class="text-sm font-medium">{{ t("file.fileName") }}</div>
        <div class="text-sm font-medium">{{ t("file.fileSize") }}</div>
        <div class="text-sm font-medium">{{ t("file.fileType") }}</div>
        <div class="text-sm font-medium">{{ t("file.remainingViewsLabel") }}</div>
        <div class="text-sm font-medium">{{ t("file.password") }}</div>
        <div class="text-sm font-medium">{{ t("file.createdAt") }}</div>
        <div class="text-sm font-medium text-center">{{ t("file.actions") }}</div>
      </div>

      <!-- 文件卡片列表 -->
      <div class="space-y-3">
        <div
          v-for="file in files"
          :key="file.id"
          class="file-item border rounded-lg overflow-hidden transition-all duration-200"
          :class="darkMode ? 'border-gray-700 hover:border-gray-600 bg-gray-800/30' : 'border-gray-200 hover:border-gray-300 bg-white'"
        >
          <!-- 桌面视图 - 表格式布局 -->
          <div class="hidden md:grid md:grid-cols-file-list gap-4 items-center p-4">
            <div class="truncate">
              <div class="flex items-center">
                <!-- 文件图标 -->
                <div class="flex-shrink-0 mr-2 w-5 h-5">
                  <span v-html="getFileIconClassLocal(file)"></span>
                </div>
                <!-- 文件名 -->
                <div class="flex-1 truncate">
                  <div :class="['font-medium truncate', darkMode ? 'text-white' : 'text-gray-900']" :title="file.filename">
                    {{ file.filename }}
                  </div>
                  <div class="text-xs truncate" :class="darkMode ? 'text-blue-400' : 'text-blue-600'" v-if="file.remark">
                    {{ file.remark }}
                  </div>
                </div>
              </div>
            </div>

            <!-- 文件大小 -->
            <div :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
              {{ formatFileSize(file.size) }}
            </div>

            <!-- 文件类型 -->
            <div :class="darkMode ? 'text-gray-300' : 'text-gray-600'" class="truncate">
              {{ formatMimeType(file.mimetype, file.filename) }}
            </div>

            <!-- 访问次数 -->
            <div
              :class="[
                darkMode ? 'text-gray-300' : 'text-gray-600',
                getRemainingViewsRaw(file) === 0
                  ? 'text-red-500 dark:text-red-400'
                  : getRemainingViewsRaw(file) !== Infinity && getRemainingViewsRaw(file) < 10
                  ? 'text-yellow-500 dark:text-yellow-400'
                  : '',
              ]"
            >
              {{ getRemainingViewsLabel(file) }}
            </div>

            <!-- 密码状态 -->
            <div>
              <span
                v-if="file.has_password"
                class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                :class="darkMode ? 'bg-yellow-900/40 text-yellow-200' : 'bg-yellow-100 text-yellow-800'"
              >
                {{ t("file.encrypted") }}
              </span>
              <span v-else class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" :class="darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'">
                {{ t("file.noPassword") }}
              </span>
            </div>

            <!-- 创建时间 -->
            <div :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
              {{ formatDate(file.created_at) }}
            </div>

            <!-- 操作按钮 -->
            <div class="flex justify-center items-center space-x-2">
              <!-- 打开链接按钮 -->
              <button
                @click.stop="openFileUrl(file)"
                class="p-1.5 rounded-md transition-colors"
                :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-white' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'"
                :title="t('file.open')"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </button>

              <!-- 复制链接按钮 -->
              <button
                @click.stop="copyFileUrl(file)"
                class="p-1.5 rounded-md transition-colors"
                :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-white' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'"
                :title="t('file.copyLink')"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                  />
                </svg>
              </button>

              <!-- 复制直链按钮 -->
              <button
                @click.stop="copyPermanentLink(file)"
                class="p-1.5 rounded-md transition-colors relative"
                :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-white' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'"
                :title="t('file.copyDirectLink')"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.172 13.828a4 4 0 015.656 0l4 4a4 4 0 01-5.656 5.656l-1.102-1.101" />
                </svg>
              </button>

              <!-- 二维码按钮 -->
              <button
                @click.stop="showQRCode(file)"
                class="p-1.5 rounded-md transition-colors"
                :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-white' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'"
                :title="t('file.qrCode')"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
                  />
                </svg>
              </button>

              <!-- 删除按钮 -->
              <button
                @click.stop="confirmDelete(file.id)"
                class="p-1.5 rounded-md transition-colors"
                :class="darkMode ? 'hover:bg-red-900/30 text-gray-400 hover:text-red-300' : 'hover:bg-red-50 text-gray-500 hover:text-red-600'"
                :title="t('file.delete')"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </div>
          </div>

          <!-- 移动视图 - 卡片式布局 -->
          <div class="md:hidden p-3">
            <div class="flex items-start justify-between">
              <div class="flex items-start">
                <!-- 文件图标 -->
                <div class="mr-3 mt-0.5 w-6 h-6">
                  <span v-html="getFileIconClassLocal(file)"></span>
                </div>

                <!-- 文件信息 -->
                <div class="flex-1 min-w-0">
                  <div :class="['font-medium truncate', darkMode ? 'text-white' : 'text-gray-900']" :title="file.filename">
                    {{ file.filename }}
                  </div>
                  <div class="text-xs mt-1" :class="darkMode ? 'text-blue-400' : 'text-blue-600'" v-if="file.remark">
                    {{ file.remark }}
                  </div>
                  <div class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                    <div class="flex flex-wrap gap-x-3 gap-y-1">
                      <span>{{ formatFileSize(file.size) }}</span>
                      <span
                        :class="[
                          getRemainingViewsRaw(file) === 0
                            ? 'text-red-500 dark:text-red-400'
                            : getRemainingViewsRaw(file) !== Infinity && getRemainingViewsRaw(file) < 10
                            ? 'text-yellow-500 dark:text-yellow-400'
                            : '',
                        ]"
                        >{{ getRemainingViewsLabel(file) }}</span
                      >
                      <span>{{ formatDate(file.created_at) }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 密码状态 -->
              <div class="flex flex-col items-end ml-2">
                <span
                  v-if="file.has_password"
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  :class="darkMode ? 'bg-yellow-900/40 text-yellow-200' : 'bg-yellow-100 text-yellow-800'"
                >
                  {{ t("file.encrypted") }}
                </span>
                <span v-else class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" :class="darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'">
                  {{ t("file.noPassword") }}
                </span>
              </div>
            </div>

            <!-- 操作按钮 - 移动视图 -->
            <div class="flex justify-end mt-3 space-x-3">
              <!-- 打开链接按钮 -->
              <button
                @click.stop="openFileUrl(file)"
                class="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded transition-colors"
                :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-800'"
              >
                {{ t("file.open") }}
              </button>

              <!-- 复制链接按钮 -->
              <button
                @click.stop="copyFileUrl(file)"
                class="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded transition-colors"
                :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-800'"
              >
                {{ t("file.copyLink") }}
              </button>

              <!-- 复制直链按钮 -->
              <button
                @click.stop="copyPermanentLink(file)"
                class="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded transition-colors"
                :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-800'"
              >
                {{ t("file.copyDirectLink") }}
              </button>

              <!-- 二维码按钮 -->
              <button
                @click.stop="showQRCode(file)"
                class="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded transition-colors"
                :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-800'"
              >
                {{ t("file.qrCode") }}
              </button>

              <!-- 删除按钮 -->
              <button
                @click.stop="confirmDelete(file.id)"
                class="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded transition-colors"
                :class="darkMode ? 'bg-red-900/30 hover:bg-red-800/30 text-red-300' : 'bg-red-100 hover:bg-red-200 text-red-700'"
              >
                {{ t("file.delete") }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除确认对话框 -->
    <div v-if="showDeleteConfirm" class="fixed inset-0 flex items-center justify-center z-[60] p-2 sm:p-4 pt-20 sm:pt-4">
      <div class="absolute inset-0 bg-black opacity-50" @click="cancelDelete"></div>
      <div class="bg-white dark:bg-gray-800 rounded-lg p-4 sm:p-6 shadow-lg max-w-xs sm:max-w-md w-full relative z-10">
        <h3 class="text-lg font-medium mb-4" :class="darkMode ? 'text-white' : 'text-gray-900'">{{ t("file.confirmDelete") }}</h3>
        <p class="mb-6" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">{{ t("file.confirmDeleteMessage") }}</p>
        <div class="flex justify-end space-x-3">
          <button
            @click="cancelDelete"
            class="px-4 py-2 text-sm font-medium rounded-md"
            :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-800'"
          >
            {{ t("file.cancel") }}
          </button>
          <button @click="deleteFile" class="px-4 py-2 text-sm font-medium rounded-md bg-red-600 hover:bg-red-700 text-white" :disabled="isDeleting">
            {{ isDeleting ? t("file.deleting") : t("file.confirmDeleteBtn") }}
          </button>
        </div>
      </div>
    </div>

    <!-- 操作反馈消息 -->
    <div
      v-if="message"
      class="fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg transition-all duration-300 transform translate-y-0 opacity-100 z-50 max-w-xs"
      :class="message.type === 'success' ? (darkMode ? 'bg-green-800 text-green-100' : 'bg-green-600 text-white') : darkMode ? 'bg-red-800 text-red-100' : 'bg-red-600 text-white'"
    >
      <div class="flex items-center">
        <svg v-if="message.type === 'success'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
        {{ message.content }}
      </div>
    </div>

    <!-- 二维码弹窗 -->
    <div v-if="showQRModal" class="fixed inset-0 flex items-center justify-center z-50">
      <div class="absolute inset-0 bg-black opacity-50" @click="closeQRCode"></div>
      <div class="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-lg max-w-sm w-full relative z-10">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-lg font-medium" :class="darkMode ? 'text-white' : 'text-gray-900'">{{ t("file.fileQrCode") }}</h3>
          <button
            @click="closeQRCode"
            class="p-1 rounded-md transition-colors"
            :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-white' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="flex flex-col items-center">
          <div class="bg-white p-3 rounded-md shadow-md mb-3">
            <img v-if="qrCodeUrl" :src="qrCodeUrl" :alt="t('file.fileQrCode')" class="w-60 h-60" />
            <div v-else class="w-60 h-60 flex items-center justify-center">
              <svg class="animate-spin h-8 w-8" :class="darkMode ? 'text-gray-400' : 'text-gray-600'" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
            </div>
          </div>
          <p class="text-sm mb-3 break-all text-center" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
            {{ currentFileUrl }}
          </p>
          <button
            @click="downloadQRCode"
            class="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors"
            :class="darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {{ t("file.downloadQrCode") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useDeleteSettingsStore } from "@/stores/deleteSettingsStore.js";
import { copyToClipboard } from "@/utils/clipboard.js";
import { formatDateTime } from "@/utils/timeUtils.js";
import { getRemainingViews as getRemainingViewsUtil, formatFileSize } from "@/utils/fileUtils.js";
import { getFileIcon } from "@/utils/fileTypeIcons.js";
import { generateQRCode as createQRCodeImage } from "@/utils/qrcodeUtils.js";
import { useFileshareService } from "@/modules/fileshare";

const props = defineProps({
  darkMode: {
    type: Boolean,
    default: false,
  },
  files: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
  userType: {
    type: String,
    default: "admin", // 'admin' 或 'apikey'
  },
});

const emit = defineEmits(["refresh"]);

const { t } = useI18n();
const deleteSettingsStore = useDeleteSettingsStore();
const fileshareService = useFileshareService();

// 剩余访问次数 - 数值模型
const getRemainingViewsRaw = (file) => {
  return getRemainingViewsUtil(file);
};

// 剩余访问次数 - 展示文案（带 i18n）
const getRemainingViewsLabel = (file) => {
  const remaining = getRemainingViewsRaw(file);
  if (remaining === Infinity) {
    return t("file.unlimited");
  }
  if (remaining === 0) {
    return t("file.usedUp");
  }
  return remaining;
};

const formatMimeType = (mimetype, filename) => {
  if (mimetype) {
    return mimetype;
  }
  const ext = filename?.split(".").pop()?.toLowerCase();
  return ext ? `${ext} 文件` : "未知类型";
};

// 删除状态
const showDeleteConfirm = ref(false);
const fileIdToDelete = ref(null);
const isDeleting = ref(false);

// 消息提示
const message = ref(null);
let messageTimeout = null;

// 二维码相关
const showQRModal = ref(false);
const qrCodeUrl = ref(null);
const currentFileUrl = ref("");

// 复制成功标志
const copiedPermanentFiles = ref({});

const getFileIconClassLocal = (file) => {
  const fileItem = {
    name: file.filename,
    filename: file.filename,
    isDirectory: false,
    type: file.type,
  };

  return getFileIcon(fileItem, props.darkMode);
};

const showMessage = (type, content) => {
  if (messageTimeout) {
    clearTimeout(messageTimeout);
    messageTimeout = null;
  }

  message.value = {
    type,
    content,
  };

  startMessageTimer();
};

const startMessageTimer = () => {
  if (messageTimeout) {
    clearTimeout(messageTimeout);
    messageTimeout = null;
  }

  if (message.value) {
    messageTimeout = setTimeout(() => {
      message.value = null;
      messageTimeout = null;
    }, 4000);
  }
};

const confirmDelete = (fileId) => {
  fileIdToDelete.value = fileId;
  showDeleteConfirm.value = true;
};

const cancelDelete = () => {
  showDeleteConfirm.value = false;
  fileIdToDelete.value = null;
};

const deleteFile = async () => {
  if (!fileIdToDelete.value || isDeleting.value) return;

  isDeleting.value = true;

  try {
    await fileshareService.deleteFiles([fileIdToDelete.value], deleteSettingsStore.getDeleteMode());
    showMessage("success", t("file.deletedSuccess"));

    showDeleteConfirm.value = false;
    fileIdToDelete.value = null;

    emit("refresh");
  } catch (error) {
    console.error("删除文件失败:", error);
    showMessage("error", t("file.messages.deleteFailed") + ": " + (error.message || t("file.messages.unknownError")));
  } finally {
    isDeleting.value = false;
  }
};

const copyFileUrl = async (file) => {
  const fileUrl = fileshareService.buildShareUrl(file, window.location.origin);

  try {
    const success = await copyToClipboard(fileUrl);
    if (success) {
      showMessage("success", t("file.linkCopied"));
    } else {
      throw new Error(t("file.messages.copyFailed"));
    }
  } catch (error) {
    console.error("复制链接失败:", error);
    showMessage("error", t("file.messages.copyFailed"));
  }
};

const openFileUrl = (file) => {
  const fileUrl = fileshareService.buildShareUrl(file, window.location.origin);
  window.open(fileUrl, "_blank");
};

const copyPermanentLink = async (file) => {
  if (!file || !file.slug) {
    showMessage("error", t("file.noValidLink"));
    return;
  }

  try {
    // 基于 Link JSON 的 Down 路由获取永久下载链接
    const permanentDownloadUrl = fileshareService.getPermanentDownloadUrl(file);
    if (!permanentDownloadUrl) {
      throw new Error(t("file.cannotGetProxyLink"));
    }

    const success = await copyToClipboard(permanentDownloadUrl);
    if (success) {
      copiedPermanentFiles.value[file.id] = true;
      setTimeout(() => {
        copiedPermanentFiles.value[file.id] = false;
      }, 2000);
      showMessage("success", t("file.directLinkCopied"));
    } else {
      throw new Error(t("file.messages.copyFailed"));
    }
  } catch (error) {
    console.error(t("file.copyPermanentLinkFailed") + ":", error);
    showMessage("error", `${t("file.copyPermanentLinkFailed")}: ${error.message || t("file.messages.unknownError")}`);
  }
};

const showQRCode = async (file) => {
  const fileUrl = fileshareService.buildShareUrl(file, window.location.origin);
  currentFileUrl.value = fileUrl;

  qrCodeUrl.value = null;
  generateQRCode(fileUrl);

  showQRModal.value = true;
};

const closeQRCode = () => {
  showQRModal.value = false;
  setTimeout(() => {
    qrCodeUrl.value = null;
    currentFileUrl.value = "";
  }, 300);
};

const generateQRCode = async (url) => {
  try {
    qrCodeUrl.value = await createQRCodeImage(url, { darkMode: props.darkMode });
  } catch (error) {
    console.error("生成二维码失败:", error);
  }
};

const downloadQRCode = () => {
  if (!qrCodeUrl.value) return;

  const a = document.createElement("a");
  a.href = qrCodeUrl.value;
  a.download = `cloudpaste-file-qrcode-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  showMessage("success", t("file.qrCodeDownloadSuccess"));
};

const formatDate = (dateString) => {
  if (!dateString) return t("common.unknown");
  return formatDateTime(dateString);
};

watch(
  () => props.files,
  (newFiles) => {
    if (message.value) {
      startMessageTimer();
    }

    if (newFiles && newFiles.length > 0) {
      console.log("文件列表已更新:", newFiles);
      console.log("第一个文件的密码状态:", newFiles[0].has_password);
    }
  }
);

onUnmounted(() => {
  if (messageTimeout) {
    clearTimeout(messageTimeout);
    messageTimeout = null;
  }
});
</script>

<style scoped>
.file-list {
  width: 100%;
}

.file-item {
  transition: box-shadow 0.2s ease;
}

.file-item:hover {
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
}

/* 表格列宽格式（保持与原组件一致） */
@media (min-width: 768px) {
  .md\:grid-cols-file-list {
    grid-template-columns: 2fr 0.8fr 1fr 0.8fr 0.8fr 1.5fr 0.8fr;
  }
}

/* 消息提示动画 */
.fixed {
  animation: slideIn 0.3s ease-out forwards;
}

@keyframes slideIn {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
</style>
