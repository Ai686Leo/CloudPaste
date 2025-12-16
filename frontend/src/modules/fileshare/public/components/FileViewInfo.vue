<template>
  <div class="file-info-container flex flex-col min-h-0 flex-grow">
    <!-- 文件头部信息 -->
    <div class="file-header mb-6">
      <div class="flex items-center gap-3">
        <!-- 文件图标 -->
        <div class="file-icon flex items-center justify-center w-12 h-12 rounded-xl bg-gray-100 dark:bg-gray-700">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" :class="iconClass" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
        </div>

        <!-- 文件名和类型 -->
        <div class="flex-1 min-w-0">
          <h1 class="text-xl font-bold truncate text-gray-900 dark:text-white">
            {{ fileInfo.filename }}
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ formattedMimeType }} · {{ formattedSize }}</p>
        </div>
      </div>
    </div>

    <!-- 文件备注 -->
    <div v-if="fileInfo.remark" class="file-remark mb-6 px-4 py-3 rounded-lg bg-gray-100 dark:bg-gray-700 overflow-auto max-h-[300px]">
      <p class="text-blue-600 dark:text-blue-400 break-words whitespace-pre-wrap">{{ fileInfo.remark }}</p>
    </div>

    <!--使用动态组件进行文件预览 -->
    <div v-if="shouldShowPreview" class="file-preview mb-6 flex-grow flex flex-col justify-center items-center">
      <component
        :is="currentPreviewComponent"
        v-bind="previewComponentProps"
        @load="handlePreviewLoad"
        @error="handlePreviewError"
        @toggle-mode="handleToggleMode"
      />
    </div>
    <!-- 当处于直链模式但当前存储不具备直链预览能力时，在原本内容区域显示占位提示 -->
    <div
      v-else-if="!fileInfo.use_proxy && !processedPreviewUrl"
      class="file-preview mb-6 flex-grow flex items-center justify-center"
    >
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ t("fileView.preview.directNotSupported") }}
      </p>
    </div>

    <!-- EXIF 拍摄信息 -->
    <div v-if="exifData" class="exif-compact mb-4 rounded-lg bg-gray-100 dark:bg-gray-800 overflow-hidden">
      <!-- 折叠头部：点击切换展开/收起 -->
      <button
        type="button"
        class="w-full p-3 flex items-center justify-between gap-2 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-left"
        @click="exifExpanded = !exifExpanded"
      >
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <!-- 相机图标 -->
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500 dark:text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <!-- 摘要信息 -->
          <span class="text-sm text-gray-800 dark:text-gray-200 truncate">
            {{ exifData.summary.camera || '拍摄信息' }}
          </span>
          <!-- GPS 指示器 -->
          <span v-if="!exifExpanded && exifData.gpsCoords" class="flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-blue-500 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </span>
        </div>
        <!-- 展开/收起箭头 -->
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4 text-gray-400 dark:text-gray-500 flex-shrink-0 transition-transform duration-200"
          :class="{ 'rotate-180': exifExpanded }"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <!-- 可折叠内容区域 -->
      <transition
        enter-active-class="transition-all duration-200 ease-out"
        enter-from-class="max-h-0 opacity-0"
        enter-to-class="max-h-[500px] opacity-100"
        leave-active-class="transition-all duration-200 ease-in"
        leave-from-class="max-h-[500px] opacity-100"
        leave-to-class="max-h-0 opacity-0"
      >
        <div v-show="exifExpanded" class="overflow-hidden">
          <div class="px-3 pb-3 space-y-2 border-t border-gray-200 dark:border-gray-700 pt-2">
            <!-- 拍摄参数 -->
            <div v-if="hasExifParams" class="flex items-center gap-2 flex-wrap">
              <span class="text-xs font-mono text-gray-600 dark:text-gray-400">
                {{ [exifParams.aperture, exifParams.shutter, exifParams.iso ? `ISO ${exifParams.iso}` : '', exifParams.focalLength].filter(Boolean).join(' · ') }}
              </span>
            </div>

            <!-- 时间 + 位置 -->
            <div v-if="exifData.summary.date || exifData.gpsCoords" class="flex items-center gap-2 flex-wrap text-xs text-gray-500 dark:text-gray-400">
              <!-- 时间 -->
              <div v-if="exifData.summary.date" class="flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{{ exifData.summary.date }}</span>
              </div>
              <!-- 分隔 -->
              <span v-if="exifData.summary.date && exifData.gpsCoords" class="text-gray-300 dark:text-gray-600">|</span>
              <!-- 位置 -->
              <div v-if="exifData.gpsCoords" class="flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span class="font-mono">{{ formattedGps }}</span>
                <!-- 地图链接 -->
                <a :href="googleMapsUrl" target="_blank" rel="noopener noreferrer" class="ml-1 text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300" title="Google Maps" @click.stop>
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                </a>
                <a :href="amapUrl" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300" title="高德地图" @click.stop>
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                </a>
              </div>
            </div>

            <!-- 地图嵌入（仅展开时渲染） -->
            <div v-if="exifData.gpsCoords && !mapLoadError" class="mt-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
              <MapEmbed
                :lat="exifData.gpsCoords.lat"
                :lng="exifData.gpsCoords.lng"
                :height="140"
                :interactive="true"
                :show-zoom-controls="true"
                @load="handleMapLoad"
                @error="handleMapError"
              />
            </div>
            <!-- 地图加载失败时的兜底 -->
            <div v-else-if="exifData.gpsCoords && mapLoadError" class="mt-2 p-3 rounded-lg bg-gray-200 dark:bg-gray-700 text-center">
              <span class="text-xs text-gray-500 dark:text-gray-400">地图加载失败</span>
            </div>
          </div>
        </div>
      </transition>
    </div>

    <!-- 文件元数据 -->
    <div class="file-metadata grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
      <!-- 创建时间 -->
      <div class="metadata-item p-3 rounded-lg bg-gray-100 dark:bg-gray-700">
        <div class="flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span class="text-sm font-medium text-gray-600 dark:text-gray-200">{{ t("fileView.fileInfo.uploadTime") }}</span>
        </div>
        <p class="mt-1 text-sm pl-7 text-gray-800 dark:text-white">{{ formattedCreatedAt }}</p>
      </div>

      <!-- 访问次数 -->
      <div class="metadata-item p-3 rounded-lg bg-gray-100 dark:bg-gray-700">
        <div class="flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            />
          </svg>
          <span class="text-sm font-medium text-gray-600 dark:text-gray-200">{{ t("fileView.fileInfo.accessCount") }}</span>
        </div>
        <p class="mt-1 text-sm pl-7 text-gray-800 dark:text-white">
          {{ fileInfo.views || 0 }}
          <span v-if="fileInfo.max_views" class="text-xs text-gray-500 dark:text-gray-400"> / {{ fileInfo.max_views }} ({{ t("fileView.fileInfo.limit") }}) </span>
        </p>
      </div>

      <!-- 过期时间 -->
      <div v-if="fileInfo.expires_at" class="metadata-item p-3 rounded-lg bg-gray-100 dark:bg-gray-700">
        <div class="flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="text-sm font-medium text-gray-600 dark:text-gray-200">{{ t("fileView.fileInfo.expiresAt") }}</span>
        </div>
        <p class="mt-1 text-sm pl-7 text-gray-800 dark:text-white">{{ formattedExpiresAt }}</p>
      </div>

      <!-- 访问模式 -->
      <div class="metadata-item p-3 rounded-lg bg-gray-100 dark:bg-gray-700">
        <div class="flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
          <span class="text-sm font-medium text-gray-600 dark:text-gray-200">{{ t("fileView.fileInfo.accessMode") }}</span>
        </div>
        <p class="mt-1 text-sm pl-7 text-gray-800 dark:text-white">
          <span :class="{ 'text-green-600 dark:text-green-400': fileInfo.use_proxy, 'text-blue-600 dark:text-blue-400': !fileInfo.use_proxy }">
            {{ fileInfo.use_proxy ? t("fileView.fileInfo.proxyAccess") : t("fileView.fileInfo.directAccess") }}
          </span>
        </p>
      </div>

      <!-- 文件短链接 -->
      <div class="metadata-item p-3 rounded-lg bg-gray-100 dark:bg-gray-700">
        <div class="flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
          <span class="text-sm font-medium text-gray-600 dark:text-gray-200">{{ t("fileView.fileInfo.fileLink") }}</span>
        </div>
        <div class="mt-1 pl-7 flex items-center relative">
          <p class="text-sm truncate flex-1 text-gray-800 dark:text-white">
            {{ shareUrl || t("fileView.fileInfo.needPassword") }}
          </p>
          <button
            v-if="shareUrl"
            @click="copyToClipboard(shareUrl)"
            class="ml-2 p-1 rounded hover:bg-opacity-80 transition-colors bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500"
            :title="t('fileView.fileInfo.copyLink')"
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

          <!-- 复制成功提示 -->
          <div
            v-if="showCopyToast"
            class="absolute right-0 -top-10 px-3 py-2 rounded-md shadow-md text-sm transition-opacity duration-300 bg-white dark:bg-gray-700 text-green-600 dark:text-green-400 border border-gray-200 dark:border-gray-600"
          >
            <div class="flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              {{ t("fileView.fileInfo.linkCopied") }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, defineProps, onMounted, watch, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { getFilePassword as resolveFilePassword } from "@/utils/filePasswordUtils.js";
import { useFileshareService } from "@/modules/fileshare/fileshareService.js";
import { isImageLikeForExif, loadExifTagsFromArrayBufferAsync, buildExifRows, resolveGpsCoordinates } from "@/utils/exifReaderUtils.js";

const { t } = useI18n();
const fileshareService = useFileshareService();
const route = useRoute();
import { getPreviewComponent, formatFileSize, FileType, getIconType } from "@/utils/fileTypes.js";
import { getPreviewModeFromFilename, PREVIEW_MODES } from "@/utils/textUtils.js";
import { formatDateTime } from "@/utils/timeUtils.js";
import { copyToClipboard as clipboardCopy } from "@/utils/clipboard";

//导入预览组件
import ImagePreview from "./previews/ImagePreview.vue";
import VideoPreview from "./previews/VideoPreview.vue";
import AudioPreview from "./previews/AudioPreview.vue";
import PdfPreview from "./previews/PdfPreview.vue";
import TextPreview from "./previews/TextPreview.vue";
import CodePreview from "./previews/CodePreview.vue";
import MarkdownPreview from "./previews/MarkdownPreview.vue";
import HtmlPreview from "./previews/HtmlPreview.vue";
import OfficeSharePreview from "./previews/OfficeSharePreview.vue";
import GenericPreview from "./previews/GenericPreview.vue";
import MapEmbed from "@/components/common/MapEmbed.vue";

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

// 分享链接 - 使用当前页面的URL
const shareUrl = computed(() => {
  return window.location.href;
});

// 复制成功提示状态
const showCopyToast = ref(false);

// EXIF 相关状态
const exifData = ref(null); // { gpsCoords, summary, rows }
const exifExpanded = ref(false);
const mapLoadError = ref(false);

// 地图事件处理
const handleMapLoad = () => {
  mapLoadError.value = false;
};

const handleMapError = () => {
  mapLoadError.value = true;
};
const showExifSection = computed(() => isImageLikeForExif({ ...props.fileInfo, name: props.fileInfo.filename }));

const getFilePassword = () => resolveFilePassword({ file: props.fileInfo });

// 处理预览URL，统一通过 fileshareService 基于 Link JSON 构造
const processedPreviewUrl = computed(() => {
  return fileshareService.getPermanentPreviewUrl(props.fileInfo) || "";
});

// 格式化的文件大小
const formattedSize = computed(() => {
  return formatFileSize(props.fileInfo.size || 0);
});

// 格式化的MIME类型
const formattedMimeType = computed(() => {
  return props.fileInfo.filename || props.fileInfo.name || "";
});

// 格式化的创建时间
const formattedCreatedAt = computed(() => {
  return formatDateTime(props.fileInfo.created_at);
});

// 格式化的过期时间
const formattedExpiresAt = computed(() => {
  return formatDateTime(props.fileInfo.expires_at);
});

// 文件信息（直接使用后端type字段）

// 文件类型判断计算属性 - 遵循 usePreviewRenderers.js 的标准模式
const isOfficeFile = computed(() => props.fileInfo.type === FileType.OFFICE);
const isText = computed(() => props.fileInfo.type === FileType.TEXT);
const isImage = computed(() => props.fileInfo.type === FileType.IMAGE);
const isVideo = computed(() => props.fileInfo.type === FileType.VIDEO);
const isAudio = computed(() => props.fileInfo.type === FileType.AUDIO);

// 文本文件的细分类型判断 - 使用标准化的工具类函数
const textPreviewMode = computed(() => {
  if (!isText.value) return null;
  return getPreviewModeFromFilename(props.fileInfo.filename || "");
});

const isCode = computed(() => textPreviewMode.value === PREVIEW_MODES.CODE);
const isMarkdown = computed(() => textPreviewMode.value === PREVIEW_MODES.MARKDOWN);
const isHtml = computed(() => textPreviewMode.value === PREVIEW_MODES.HTML);

// PDF文件判断
const isPdf = computed(() => {
  return props.fileInfo.type === FileType.DOCUMENT;
});

// 文件图标类名 - 使用标准的 getIconType 函数
const iconClass = computed(() => {
  const iconType = getIconType(props.fileInfo);
  // 根据文件类型返回对应的图标颜色类
  const colorMap = {
    image: "text-green-500",
    video: "text-purple-500",
    audio: "text-blue-500",
    text: "text-yellow-500",
    document: "text-red-500",
    folder: "text-blue-500",
    file: "text-gray-500",
  };
  return colorMap[iconType] || "text-gray-500";
});

const currentPreviewComponent = computed(() => {
  const componentName = getPreviewComponent(props.fileInfo);

  // 组件映射
  const componentMap = {
    ImagePreview,
    VideoPreview,
    AudioPreview,
    PdfPreview,
    CodePreview,
    MarkdownPreview,
    HtmlPreview,
    TextPreview,
    OfficeSharePreview,
    GenericPreview,
  };

  return componentMap[componentName] || GenericPreview;
});

// 是否应该显示预览
const shouldShowPreview = computed(() => {
  // 文本类预览不依赖 processedPreviewUrl（直链能力），只要识别为文本类就应显示并走 contentUrl
  if (isText.value || isCode.value || isMarkdown.value || isHtml.value) {
    return true;
  }
  return Boolean(processedPreviewUrl.value) || isOfficeFile.value;
});

// 注意：预览能力检查现在通过 shouldShowPreview 计算属性处理

// 获取代码文件的语言类型
const getCodeLanguage = computed(() => {
  if (!props.fileInfo.filename) return t("fileView.preview.code.title");

  const extension = props.fileInfo.filename.split(".").pop().toLowerCase();
  const languageMap = {
    // 编程语言
    js: "JavaScript",
    ts: "TypeScript",
    py: "Python",
    java: "Java",
    c: "C",
    cpp: "C++",
    cs: "C#",
    go: "Go",
    php: "PHP",
    rb: "Ruby",
    swift: "Swift",
    kt: "Kotlin",
    rs: "Rust",
    sh: "Shell",
    sql: "SQL",
    xml: "XML",
    json: "JSON",
    yaml: "YAML",
    toml: "TOML",
    // UI/前端
    css: "CSS",
    scss: "SCSS",
    less: "LESS",
    vue: "Vue",
    jsx: "JSX",
    tsx: "TSX",
  };

  return languageMap[extension] || t("fileView.preview.code.title");
});


// 动态组件属性配置
const previewComponentProps = computed(() => {
  const previewUrl = processedPreviewUrl.value;
  const baseProps = {
    filename: props.fileInfo.filename,
    mimetype: props.fileInfo.mimetype,
  };

  const effectiveSlug =
    props.fileInfo?.slug ||
    route.params?.slug ||
    route.params?.fileSlug ||
    "";
  const effectiveContentUrl = effectiveSlug
    ? fileshareService.getPermanentContentUrl({ ...props.fileInfo, slug: effectiveSlug })
    : "";

  // 所有“文本类预览”组件仅接收 contentUrl，由 gateway / LinkService 统一决定直链或代理
  if (isText.value || isCode.value) {
    return {
      ...baseProps,
      contentUrl: effectiveContentUrl,
      title: isCode.value ? t("fileView.preview.code.title") : t("fileView.preview.text.title"),
      language: isCode.value ? getCodeLanguage.value : "",
      loadingText: isCode.value ? t("fileView.preview.code.loading") : t("fileView.preview.text.loading"),
      darkMode: props.darkMode,
    };
  }

  if (isMarkdown.value) {
    return {
      ...baseProps,
      contentUrl: effectiveContentUrl,
      darkMode: props.darkMode,
    };
  }

  if (isHtml.value) {
    return {
      ...baseProps,
      contentUrl: effectiveContentUrl,
      darkMode: props.darkMode,
    };
  }

  // PDF文件特殊处理：支持 DocumentApp 多渠道（如 pdfjs / 原生浏览器）
  if (isPdf.value) {
    const preview = props.fileInfo.documentPreview || null;
    const providers = (preview && preview.providers) || {};
    return {
      ...baseProps,
      previewUrl,
      providers,
      nativeUrl: previewUrl,
    };
  }

  if (isOfficeFile.value) {
    return {
      providers: props.fileInfo.documentPreview?.providers || {},
      filename: props.fileInfo.filename,
      downloadUrl: fileshareService.getPermanentDownloadUrl(props.fileInfo),
      contentUrl: effectiveContentUrl,
    };
  }

  if (isImage.value || isAudio.value) {
    return {
      ...baseProps,
      previewUrl,
      darkMode: props.darkMode,
      // Live Photo 支持：videoUrl 需要从外部传入（如果有配对的视频文件）
      // 在单文件分享场景中，通常不会有配对的视频文件
      videoUrl: "",
    };
  }

  if (isVideo.value) {
    return {
      ...baseProps,
      previewUrl,
      linkType: props.fileInfo.linkType || null,
      darkMode: props.darkMode,
    };
  }

  return {
    iconClass: iconClass.value,
    filename: props.fileInfo.filename,
    mimetype: props.fileInfo.mimetype,
  };
});

// 动态组件事件处理
const handlePreviewLoad = () => undefined;
const handlePreviewError = () => undefined;
const handleToggleMode = () => undefined;



// 复制到剪贴板函数
const copyToClipboard = async (text) => {
  try {
    const success = await clipboardCopy(text);

    if (success) {
      // 显示复制成功提示
      showCopyToast.value = true;
      // 3秒后自动隐藏提示
      setTimeout(() => {
        showCopyToast.value = false;
      }, 3000);
    } else {
      throw new Error("复制失败");
    }
  } catch {
    // 复制失败时保持静默（后续如需更友好提示，再单独做 UI 交互）
  }
};

// EXIF 解析逻辑
const parseExif = async () => {
  if (!showExifSection.value || !processedPreviewUrl.value) {
    exifData.value = null;
    return;
  }

  try {
    const url = processedPreviewUrl.value;
    // 跳过 blob/data URL
    if (url.startsWith("blob:") || url.startsWith("data:")) {
      exifData.value = null;
      return;
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const ct = String(res.headers.get("content-type") || "").toLowerCase();
    if (ct && ct.includes("text/html")) throw new Error("unexpected content-type");

    const buf = await res.arrayBuffer();
    const tags = await loadExifTagsFromArrayBufferAsync(buf);
    const gpsCoords = resolveGpsCoordinates(tags);
    const rows = buildExifRows(tags).filter((r) => r.key !== "location");

    // 构建紧凑摘要
    const summary = buildExifSummary(rows);
    const hasSummary = !!(summary.camera || summary.params || summary.date);
    const hasGps = !!gpsCoords;
    // 保留 rows 供 exifParams 使用
    exifData.value = hasSummary || hasGps ? { gpsCoords, summary, rows } : null;
  } catch {
    exifData.value = null;
  }
};

// 构建紧凑摘要文本
const buildExifSummary = (rows) => {
  const result = { camera: "", params: "", date: "" };
  const rowMap = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  // 相机 + 镜头
  const cameraParts = [rowMap.camera, rowMap.lensModel].filter(Boolean);
  result.camera = cameraParts.join(" · ");

  // 拍摄参数：光圈 · 快门 · ISO · 焦距
  const paramParts = [rowMap.aperture, rowMap.shutter, rowMap.iso, rowMap.focalLength].filter(Boolean);
  result.params = paramParts.join(" · ");

  // 拍摄时间
  result.date = rowMap.dateTimeOriginal || "";

  return result;
};

// 单独的 EXIF 参数（用于网格展示）
const exifParams = computed(() => {
  if (!exifData.value?.rows) return {};
  const rowMap = Object.fromEntries(exifData.value.rows.map((r) => [r.key, r.value]));
  return {
    aperture: rowMap.aperture || "",
    shutter: rowMap.shutter || "",
    iso: rowMap.iso ? rowMap.iso.replace(/^ISO\s*/i, "") : "",
    focalLength: rowMap.focalLength || "",
  };
});

// 是否有任何 EXIF 参数
const hasExifParams = computed(() => {
  const p = exifParams.value;
  return !!(p.aperture || p.shutter || p.iso || p.focalLength);
});

// Google Maps URL
const googleMapsUrl = computed(() => {
  if (!exifData.value?.gpsCoords) return "";
  const { lat, lng } = exifData.value.gpsCoords;
  const safeLat = Math.min(90, Math.max(-90, Number(lat) || 0));
  const safeLng = Math.min(180, Math.max(-180, Number(lng) || 0));
  const url = new URL("https://www.google.com/maps");
  url.searchParams.set("q", `${safeLat},${safeLng}`);
  return url.toString();
});

// 高德地图 URL
const amapUrl = computed(() => {
  if (!exifData.value?.gpsCoords) return "";
  const { lat, lng } = exifData.value.gpsCoords;
  const safeLat = Math.min(90, Math.max(-90, Number(lat) || 0));
  const safeLng = Math.min(180, Math.max(-180, Number(lng) || 0));
  const url = new URL("https://uri.amap.com/marker");
  url.searchParams.set("position", `${safeLng},${safeLat}`);
  url.searchParams.set("name", "拍摄位置");
  return url.toString();
});

// 格式化 GPS 坐标显示
const formattedGps = computed(() => {
  if (!exifData.value?.gpsCoords) return "";
  const { lat, lng } = exifData.value.gpsCoords;
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(5)}°${latDir} ${Math.abs(lng).toFixed(5)}°${lngDir}`;
});

// 确保密码被保存到会话存储
const savePasswordToSessionStorage = () => {
  if (!props.fileInfo.slug) return;

  try {
    // 获取潜在的密码源
    let password = null;

    // 1. 首先检查props.fileInfo.currentPassword
    if (props.fileInfo.currentPassword) {
      password = props.fileInfo.currentPassword;
    }
    // 2. 其次检查URL中的密码参数
    else {
      const currentUrl = new URL(window.location.href);
      const passwordParam = currentUrl.searchParams.get("password");
      if (passwordParam) {
        password = passwordParam;
      }
    }

    // 如果找到了密码，保存到会话存储
    if (password) {
      sessionStorage.setItem(`file_password_${props.fileInfo.slug}`, password);
    }
  } catch {
    // ignore
  }
};

// Office 预览初始化仅保留密码缓存逻辑
onMounted(() => {
  savePasswordToSessionStorage();
});

watch(
  () => processedPreviewUrl.value,
  () => {
    void parseExif();
  },
  { immediate: true },
);

// 组件卸载时清理资源
onUnmounted(() => {
  if (showCopyToast.value) {
    showCopyToast.value = false;
  }
});
</script>
