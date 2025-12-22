<template>
  <!-- 模态框遮罩 -->
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="isOpen"
        class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto"
        @click.self="closeModal"
      >
        <!-- 背景遮罩 -->
        <div class="fixed inset-0 bg-black bg-opacity-50 transition-opacity"></div>

        <!-- 模态框内容 -->
        <div
          class="relative z-10 w-full max-w-2xl mx-4 rounded-lg shadow-xl transition-all"
          :class="darkMode ? 'bg-gray-800' : 'bg-white'"
          @click.stop
        >
          <!-- 头部 -->
          <div
            class="flex items-center justify-between p-4 border-b"
            :class="darkMode ? 'border-gray-700' : 'border-gray-200'"
          >
            <h3 class="text-lg font-medium" :class="darkMode ? 'text-white' : 'text-gray-900'">
              {{ t("file.urlImport.title") }}
            </h3>
            <button
              type="button"
              @click="closeModal"
              class="rounded-md p-1 transition-colors"
              :class="darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'"
            >
              <IconClose size="lg" />
            </button>
          </div>

          <!-- 内容区域 -->
          <div class="p-6">
            <!-- URL输入 -->
            <div class="mb-4">
              <label class="block text-sm font-medium mb-2" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
                {{ t("file.enterUrl") }}
              </label>
              <div class="flex gap-2">
                <input
                  type="url"
                  v-model="urlInput"
                  class="flex-1 form-input rounded-md shadow-sm focus:ring-2 focus:ring-offset-1 focus:border-transparent"
                  :class="[
                    darkMode
                      ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-600 focus:ring-offset-gray-800'
                      : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:ring-offset-white',
                  ]"
                  :placeholder="t('file.urlPlaceholder')"
                  :disabled="isAnalyzing || isDownloading"
                  @keyup.enter="analyzeUrl"
                />
                <button
                  type="button"
                  @click="analyzeUrl"
                  class="px-4 py-2 rounded-md font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors"
                  :class="[
                    isAnalyzing || !urlInput
                      ? darkMode
                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                        : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                      : darkMode
                      ? 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-600'
                      : 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500',
                  ]"
                  :disabled="!urlInput || isAnalyzing || isDownloading"
                >
                  {{ isAnalyzing ? t("file.analyzing") : t("file.analyze") }}
                </button>
              </div>
              <p v-if="urlError" class="mt-2 text-sm text-red-600 dark:text-red-400">
                {{ urlError }}
              </p>
            </div>

            <!-- 文件信息预览 -->
            <div v-if="fileInfo" class="mb-4 p-4 rounded-lg border" :class="darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-50 border-gray-200'">
              <div class="flex items-center gap-3">
                <div class="flex-shrink-0 text-blue-500">
                  <IconDocumentText size="2xl" />
                </div>
                <div class="flex-1 min-w-0">
                  <p class="font-medium truncate" :class="darkMode ? 'text-white' : 'text-gray-900'">
                    {{ displayFilename }}
                  </p>
                  <div class="flex gap-2 mt-1">
                    <span class="text-xs px-2 py-0.5 rounded-full" :class="darkMode ? 'bg-gray-600 text-gray-300' : 'bg-gray-200 text-gray-700'">
                      {{ displayFileSize }}
                    </span>
                    <span v-if="displayMimeType" class="text-xs px-2 py-0.5 rounded-full" :class="darkMode ? 'bg-blue-900/30 text-blue-300' : 'bg-blue-100 text-blue-700'">
                      {{ displayMimeType }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- 自定义文件名 -->
              <div class="mt-3">
                <label class="block text-xs font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
                  {{ t("file.customFileName") }}
                </label>
                <input
                  type="text"
                  v-model="customFilename"
                  class="w-full form-input rounded-md shadow-sm focus:ring-2 focus:ring-offset-1 focus:border-transparent text-sm"
                  :class="[
                    darkMode
                      ? 'bg-gray-600 border-gray-500 text-white focus:ring-blue-600 focus:ring-offset-gray-700'
                      : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:ring-offset-white',
                  ]"
                  :placeholder="displayFilename"
                  :disabled="isDownloading"
                />
              </div>
            </div>

            <!-- 下载进度 -->
            <div v-if="isDownloading" class="mb-4">
              <div class="flex justify-between items-center mb-2">
                <span class="text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
                  {{ t("file.downloading") }}
                </span>
                <span class="text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
                  {{ downloadProgress }}%
                </span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
                <div
                  class="bg-blue-600 h-2 rounded-full transition-all duration-200"
                  :style="{ width: `${downloadProgress}%` }"
                ></div>
              </div>
            </div>
          </div>

          <!-- 底部按钮 -->
          <div
            class="flex justify-end gap-3 p-4 border-t"
            :class="darkMode ? 'border-gray-700' : 'border-gray-200'"
          >
            <button
              type="button"
              @click="closeModal"
              class="px-4 py-2 rounded-md font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors"
              :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-white focus:ring-gray-500' : 'bg-gray-100 hover:bg-gray-200 text-gray-700 focus:ring-gray-300'"
              :disabled="isDownloading"
            >
              {{ t("file.cancel") }}
            </button>
            <button
              type="button"
              @click="importFile"
              class="px-4 py-2 rounded-md font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors"
              :class="[
                !fileInfo || isDownloading
                  ? darkMode
                    ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : darkMode
                  ? 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-600'
                  : 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500',
              ]"
              :disabled="!fileInfo || isDownloading"
            >
              {{ isDownloading ? t("file.loading") : t("file.import") }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { formatFileSize as formatFileSizeUtil } from "@/utils/fileTypes.js";
import { IconClose, IconDocumentText } from "@/components/icons";

const props = defineProps({
  isOpen: { type: Boolean, default: false },
  darkMode: { type: Boolean, default: false },
  urlImportPlugin: { type: Object, default: null },
});

const emit = defineEmits(["close", "import-success", "import-error"]);

const { t } = useI18n();

// 响应式数据
const urlInput = ref("");
const urlError = ref("");
const fileInfo = ref(null);
const customFilename = ref("");
const isAnalyzing = ref(false);
const isDownloading = ref(false);
const downloadProgress = ref(0);

// 计算属性
const displayFilename = computed(() => {
  if (!fileInfo.value) return "";
  try {
    return decodeURIComponent(fileInfo.value.filename || "file");
  } catch {
    return fileInfo.value.filename || "file";
  }
});

const displayFileSize = computed(() => {
  if (!fileInfo.value || typeof fileInfo.value.size !== "number") {
    return t("file.unknownSize");
  }
  return formatFileSizeUtil(fileInfo.value.size);
});

const displayMimeType = computed(() => {
  if (!fileInfo.value) return null;
  const contentType = fileInfo.value.contentType;
  if (contentType && contentType !== "application/octet-stream") {
    return contentType;
  }
  return null;
});

// 监听模态框关闭，重置状态
watch(() => props.isOpen, (newVal) => {
  if (!newVal) {
    resetForm();
  }
});

// 验证URL
const isValidUrl = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

// 分析URL
const analyzeUrl = async () => {
  urlError.value = "";
  fileInfo.value = null;
  customFilename.value = "";

  if (!urlInput.value) return;

  if (!isValidUrl(urlInput.value)) {
    urlError.value = t("file.messages.invalidUrl");
    return;
  }

  if (!props.urlImportPlugin) {
    urlError.value = "URL导入插件未初始化";
    return;
  }

  isAnalyzing.value = true;

  try {
    fileInfo.value = await props.urlImportPlugin.validateUrl(urlInput.value);
    if (fileInfo.value) {
      customFilename.value = fileInfo.value.filename || "";
    }
  } catch (error) {
    urlError.value = error.message || t("file.messages.urlAnalysisFailed");
  } finally {
    isAnalyzing.value = false;
  }
};

// 导入文件
const importFile = async () => {
  if (!fileInfo.value || !props.urlImportPlugin) return;

  isDownloading.value = true;
  downloadProgress.value = 0;

  try {
    const filename = customFilename.value || fileInfo.value.filename || "downloaded-file";

    await props.urlImportPlugin.addFromUrl(urlInput.value, {
      customFilename: filename,
      onProgress: (progress) => {
        downloadProgress.value = Math.min(100, Math.round(progress));
      },
    });

    emit("import-success", { url: urlInput.value, filename });
    closeModal();
  } catch (error) {
    urlError.value = error.message || t("file.messages.importFailed");
    emit("import-error", error);
  } finally {
    isDownloading.value = false;
    downloadProgress.value = 0;
  }
};

// 关闭模态框
const closeModal = () => {
  if (isDownloading.value) return;
  emit("close");
};

// 重置表单
const resetForm = () => {
  urlInput.value = "";
  urlError.value = "";
  fileInfo.value = null;
  customFilename.value = "";
  isAnalyzing.value = false;
  isDownloading.value = false;
  downloadProgress.value = 0;
};
</script>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
