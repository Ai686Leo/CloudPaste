<template>
  <div class="file-actions flex flex-wrap gap-3">
    <!-- 预览按钮 -->
    <button
      v-if="hasPreviewUrl"
      @click="previewFile"
      class="action-button flex items-center justify-center px-4 py-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 bg-indigo-600 hover:bg-indigo-700 text-white focus:ring-indigo-500 focus:ring-offset-white dark:focus:ring-offset-gray-800"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
        />
      </svg>
      <span>{{ t("fileView.actions.preview") }}</span>
    </button>

    <!-- 下载按钮 -->
    <button
      v-if="hasDownloadUrl"
      @click="downloadFile"
      class="action-button flex items-center justify-center px-4 py-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500 focus:ring-offset-white dark:focus:ring-offset-gray-800"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
      <span>{{ t("fileView.actions.download") }}</span>
    </button>

    <!-- 编辑按钮 (管理员可见所有文件，API密钥用户只能看到自己的文件) -->
    <button
      v-if="(isAdmin || (hasApiKey && hasFilePermission && isCreator)) && fileInfo.id"
      @click="$emit('edit')"
      class="action-button flex items-center justify-center px-4 py-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-white focus:ring-gray-400 dark:focus:ring-gray-500 focus:ring-offset-white dark:focus:ring-offset-gray-800"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
        />
      </svg>
      <span>{{ t("fileView.actions.edit") }}</span>
    </button>

    <!-- 分享按钮 -->
    <button
      @click="openShareModal"
      class="action-button flex items-center justify-center px-4 py-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 bg-green-600 hover:bg-green-700 text-white focus:ring-green-500 focus:ring-offset-white dark:focus:ring-offset-gray-800"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
        />
      </svg>
      <span>{{ t("fileView.actions.share") }}</span>
    </button>

    <!-- 删除按钮 (管理员可见所有文件，API密钥用户只能看到自己的文件) -->
    <button
      v-if="(isAdmin || (hasApiKey && hasFilePermission && isCreator)) && fileInfo.id"
      @click="confirmDelete"
      class="action-button flex items-center justify-center px-4 py-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 bg-red-600 hover:bg-red-700 text-white focus:ring-red-500 focus:ring-offset-white dark:focus:ring-offset-gray-800"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
        />
      </svg>
      <span>{{ t("fileView.actions.delete") }}</span>
    </button>

    <!-- 删除确认模态框 -->
    <div v-if="showDeleteConfirm" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
      <div class="rounded-lg p-6 max-w-sm w-full shadow-xl bg-white dark:bg-gray-800">
        <h3 class="text-lg font-medium mb-4 text-gray-900 dark:text-white">{{ t("fileView.actions.delete") }}</h3>
        <p class="mb-6 text-gray-600 dark:text-gray-300">
          {{ t("fileView.actions.deleteConfirm") }}
        </p>
        <div class="flex justify-end space-x-3">
          <button
            @click="showDeleteConfirm = false"
            class="px-4 py-2 rounded-md text-sm font-medium transition-colors bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-white"
          >
            {{ t("common.cancel") }}
          </button>
          <button @click="deleteFile" class="px-4 py-2 rounded-md text-sm font-medium transition-colors bg-red-600 hover:bg-red-700 text-white" :disabled="deleting">
            {{ deleting ? t("fileView.actions.deleting") : t("common.confirm") }}
          </button>
        </div>
      </div>
    </div>

    <!-- 复制成功提示 -->
    <div
      v-if="showCopyToast"
      class="fixed top-4 right-4 px-4 py-3 rounded-lg shadow-lg z-50 flex items-center transition-opacity duration-200 bg-white dark:bg-gray-800 text-green-600 dark:text-green-400 border border-gray-200 dark:border-gray-700"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
      </svg>
      <span>{{ t("fileView.fileInfo.linkCopied") }}</span>
    </div>

    <!-- 分享模态框 -->
    <ShareModal :visible="showShareModal" :file-info="fileInfo" :dark-mode="darkMode" @close="closeShareModal" />
  </div>
</template>

<script setup>
import { ref, defineProps, defineEmits, computed } from "vue";
import { useI18n } from "vue-i18n";
import { copyToClipboard } from "@/utils/clipboard";
import ShareModal from "./ShareModal.vue";
import { useAuthStore } from "@/stores/authStore.js";
import { FileType } from "@/utils/fileTypes.js";
import { useDeleteSettingsStore } from "@/stores/deleteSettingsStore.js";
import { getFileErrorKey } from "@/api/services/fileGateway.js";
import { useFileshareService } from "@/modules/fileshare/fileshareService.js";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";

const { t } = useI18n();

const props = defineProps({
  fileInfo: {
    type: Object,
    required: true,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["edit", "delete", "refresh-file-info"]);

const fileshareService = useFileshareService();
const { showSuccess, showError } = useGlobalMessage();

// 使用认证Store
const authStore = useAuthStore();

// 从Store获取权限状态的计算属性
const isAdmin = computed(() => authStore.isAdmin);
const hasApiKey = computed(() => authStore.isKeyUser && !!authStore.apiKey);
// 这里的文件权限用于管理（编辑/删除），对应后端 FILE_MANAGE 位
const hasFilePermission = computed(() => authStore.hasFileManagePermission);

// 删除确认状态
const showDeleteConfirm = ref(false);
const deleting = ref(false);

// 复制提示状态
const showCopyToast = ref(false);

// 分享模态框状态
const showShareModal = ref(false);

// 计算属性：判断当前用户是否为文件创建者
const isCreator = computed(() => authStore.isFileCreator(props.fileInfo));

// 预览/下载可用性（统一基于 Link JSON + fileshareService）
const hasPreviewUrl = computed(() => !!fileshareService.getPermanentPreviewUrl(props.fileInfo));
const hasDownloadUrl = computed(() => !!fileshareService.getPermanentDownloadUrl(props.fileInfo));

/**
 * 预览文件
 * 在新窗口中打开预览链接，为Office文件使用在线预览服务
 */
const previewFile = async () => {
  if (!props.fileInfo) return;

  try {
    if (props.fileInfo.type === FileType.OFFICE) {
      const officePreviewUrl = await fileshareService.getOfficePreviewUrl(props.fileInfo, {
        provider: "microsoft",
      });

      if (!officePreviewUrl) {
        throw new Error(t("fileView.errors.serverError"));
      }

      window.open(officePreviewUrl, "_blank");
      return;
    }

    const previewUrl = fileshareService.getPermanentPreviewUrl(props.fileInfo);
    if (!previewUrl) {
      throw new Error(t("fileView.errors.serverError"));
    }

    window.open(previewUrl, "_blank");
  } catch (error) {
    console.error("预览文件失败:", error);

    let message = error.message || t("fileView.errors.unknown");
    if (error.status) {
      const errorKey = getFileErrorKey(error.status);
      message = t(errorKey);
    }

    showError(`${t("fileView.actions.previewFailed")}: ${message}`);
  }
};

/**
 * 下载文件
 * 通过创建隐藏的a元素并模拟点击下载文件
 */
const downloadFile = () => {
  if (!props.fileInfo) return;

  try {
    console.log("开始下载文件:", props.fileInfo.filename);

    const downloadUrl = fileshareService.getPermanentDownloadUrl(props.fileInfo);
    if (!downloadUrl) {
      throw new Error(t("fileView.errors.serverError"));
    }

    const fileName = props.fileInfo.filename || t("fileView.actions.downloadFile");
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      document.body.removeChild(link);
    }, 100);
  } catch (error) {
    console.error("下载文件失败:", error);
    const fallbackUrl = fileshareService.getPermanentDownloadUrl(props.fileInfo);
    if (fallbackUrl) {
      window.open(fallbackUrl, "_blank");
    }
    showError(`${t("fileView.actions.downloadFailed")}: ${error.message || t("fileView.errors.unknown")}`);
  }
};

/**
 * 打开分享模态框
 */
const openShareModal = () => {
  showShareModal.value = true;
};

/**
 * 关闭分享模态框
 */
const closeShareModal = () => {
  showShareModal.value = false;
};

/**
 * 显示删除确认对话框
 */
const confirmDelete = () => {
  showDeleteConfirm.value = true;
};

/**
 * 删除文件
 */
const deleteFile = async () => {
  if (!props.fileInfo.id) return;

  deleting.value = true;

  try {
    // 使用统一的批量删除 API
    if (isAdmin.value || (hasApiKey.value && hasFilePermission.value && isCreator.value)) {
      const deleteSettingsStore = useDeleteSettingsStore();
      const response = await fileshareService.deleteFiles([props.fileInfo.id], deleteSettingsStore.getDeleteMode());

      if (response?.data && response.data.failed && response.data.failed.length > 0) {
        const failedItem = response.data.failed[0];
        throw new Error(failedItem.error || "删除失败");
      }

      // 关闭确认对话框
      showDeleteConfirm.value = false;
      // 通知父组件文件已删除
      emit("delete", props.fileInfo.id);
    } else {
      throw new Error(t("fileView.actions.noPermission"));
    }
  } catch (err) {
    console.error("删除文件错误:", err);
      showError(`${t("fileView.actions.deleteFailed")}: ${err.message || t("fileView.errors.unknown")}`);
  } finally {
    deleting.value = false;
  }
};
</script>
