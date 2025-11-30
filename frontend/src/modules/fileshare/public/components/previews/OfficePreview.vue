<template>
  <div class="office-preview rounded-lg overflow-hidden mb-2 flex-grow flex flex-col w-full">
    <div class="flex items-center justify-between p-2 bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
      <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
        {{ officeTypeDisplayName }}
      </span>
      <!-- 仅在存在多个可选渠道时展示下拉选择 -->
      <select
        v-if="providerOptions.length > 1"
        v-model="selectedProviderKey"
        class="text-xs px-2 py-1 rounded border bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"
      >
        <option v-for="opt in providerOptions" :key="opt.key" :value="opt.key">
          {{ opt.label }}
        </option>
      </select>
    </div>
    <div class="office-iframe flex-grow relative" style="height: calc(100vh - 400px); min-height: 300px; background-color: white">
      <iframe
        v-if="currentOfficePreviewUrl"
        :src="currentOfficePreviewUrl"
        frameborder="0"
        class="w-full h-full"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation"
        @load="handleOfficePreviewLoad"
        @error="handleOfficePreviewError"
      ></iframe>
      <div v-else class="w-full h-full flex items-center justify-center">
        <div class="text-center p-4">
          <p class="text-gray-500 mb-2">{{ officePreviewError || t("fileView.preview.office.loading") }}</p>
          <div v-if="officePreviewError && officePreviewError.includes('401')">
            <p class="text-amber-500 text-sm mb-2">{{ t("fileView.preview.office.passwordIssue") }}</p>
            <ul class="text-left text-sm text-gray-600 dark:text-gray-300 list-disc pl-5 mb-2">
              <li>{{ t("fileView.preview.office.refreshAndRetry") }}</li>
              <li>{{ t("fileView.preview.office.confirmPassword") }}</li>
              <li>{{ t("fileView.preview.office.tryUrlPassword") }}</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- 加载中状态遮罩 -->
      <div v-if="officePreviewLoading && currentOfficePreviewUrl" class="absolute inset-0 bg-white bg-opacity-70 flex items-center justify-center">
        <div class="text-center">
          <svg class="animate-spin h-8 w-8 text-blue-500 mx-auto mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 0 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <p class="text-blue-600">{{ t("fileView.preview.office.loadingDetail") }}</p>
          <p class="text-gray-500 text-sm mt-1">
            {{ t("fileView.preview.office.loadingDetail") }}
            {{ useProxy ? t("fileView.preview.office.proxyMode") : t("fileView.preview.office.directMode") }}
          </p>
        </div>
      </div>
    </div>
    <div class="p-2 bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400 text-center">
      <p v-if="officePreviewError" class="text-red-500 mb-1">{{ officePreviewError }}</p>
      <p>
        {{ t("fileView.preview.office.previewTrouble") }}
        <button @click="updateOfficePreviewUrls" class="text-blue-500 hover:underline">{{ t("fileView.preview.office.refreshPreview") }}</button>
        {{ t("fileView.preview.office.switchService") }}
        <a :href="downloadUrl" class="text-blue-500 hover:underline" target="_blank">{{ t("fileView.preview.office.downloadFile") }}</a>
        {{ t("fileView.preview.office.afterDownload") }}
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { getExtension } from "@/utils/fileTypes.js";

const { t } = useI18n();

const props = defineProps({
  // DocumentApp providers 映射，例如 { microsoft: 'https://...', google: 'https://...' }
  providers: {
    type: Object,
    default: () => ({}),
  },
  // 原生浏览器预览 URL（直链 / 代理）
  nativeUrl: {
    type: String,
    default: "",
  },
  mimetype: {
    type: String,
    default: "",
  },
  filename: {
    type: String,
    default: "",
  },
  useProxy: {
    type: Boolean,
    default: false,
  },
  downloadUrl: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["load", "error"]);

const officePreviewLoading = ref(true);
const officePreviewError = ref("");

// Office子类型判断 - 使用标准的 getExtension 函数
const isWordDocument = computed(() => {
  const ext = getExtension(props.filename || "");
  const mime = props.mimetype?.toLowerCase() || "";

  // 通过MIME类型判断
  if (
    mime === "application/msword" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/vnd.oasis.opendocument.text" ||
    mime === "application/rtf"
  ) {
    return true;
  }

  // 通过文件扩展名判断
  return ["doc", "docx", "odt", "rtf"].includes(ext);
});

const isSpreadsheet = computed(() => {
  const ext = getExtension(props.filename || "");
  const mime = props.mimetype?.toLowerCase() || "";

  // 通过MIME类型判断
  if (
    mime === "application/vnd.ms-excel" ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.oasis.opendocument.spreadsheet" ||
    mime === "text/csv"
  ) {
    return true;
  }

  // 通过文件扩展名判断
  return ["xls", "xlsx", "ods", "csv"].includes(ext);
});

const isPresentation = computed(() => {
  const ext = getExtension(props.filename || "");
  const mime = props.mimetype?.toLowerCase() || "";

  // 通过MIME类型判断
  if (
    mime === "application/vnd.ms-powerpoint" ||
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mime === "application/vnd.oasis.opendocument.presentation"
  ) {
    return true;
  }

  // 通过文件扩展名判断
  return ["ppt", "pptx", "odp"].includes(ext);
});

// Office类型显示名称
const officeTypeDisplayName = computed(() => {
  if (isWordDocument.value) return t("fileView.preview.office.wordPreview");
  if (isSpreadsheet.value) return t("fileView.preview.office.excelPreview");
  if (isPresentation.value) return t("fileView.preview.office.powerpointPreview");
  return t("fileView.preview.office.title");
});

// 可用预览渠道
const providerOptions = computed(() => {
  const options = [];

  const providers = props.providers || {};
  for (const key of Object.keys(providers)) {
    options.push({
      key,
      label: key,
      url: providers[key],
    });
  }

  return options;
});

const selectedProviderKey = ref("");

// 当前选中的 Office 预览 URL
const currentOfficePreviewUrl = computed(() => {
  const options = providerOptions.value;
  if (!options.length) return "";

  const current = options.find((opt) => opt.key === selectedProviderKey.value) || options[0];
  return current.url || "";
});

const handleOfficePreviewLoad = () => {
  console.log("Office预览加载成功");
  officePreviewError.value = "";
  officePreviewLoading.value = false;
  emit("load");
};

const handleOfficePreviewError = (event) => {
  console.error("Office预览加载失败:", event);
  officePreviewError.value = t("fileView.preview.office.error");
  officePreviewLoading.value = false;
  emit("error", event);
};

onMounted(() => {
  const opts = providerOptions.value;
  if (opts.length) {
    selectedProviderKey.value = opts[0].key;
  }

  if (currentOfficePreviewUrl.value) {
    officePreviewLoading.value = true;
  }
});

// 清理资源
onUnmounted(() => {
  // 清理可能的定时器或其他资源
  officePreviewLoading.value = false;
  officePreviewError.value = "";
});
</script>
