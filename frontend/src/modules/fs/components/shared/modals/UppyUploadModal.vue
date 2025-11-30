<template>
  <div v-if="isOpen" class="fixed inset-0 z-[60] overflow-auto bg-black bg-opacity-50 flex items-center justify-center p-2 sm:p-4 pt-20 sm:pt-4">
    <div
      class="relative w-full max-w-sm sm:max-w-3xl lg:max-w-5xl h-auto min-h-[400px] sm:min-h-[500px] max-h-[85vh] sm:max-h-[80vh] rounded-lg shadow-xl flex flex-col"
      :class="darkMode ? 'bg-gray-800' : 'bg-white'"
    >
      <!-- 弹窗标题栏 -->
      <div class="p-4 flex justify-between items-center border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <h3 class="text-lg font-semibold" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">{{ t("mount.uppy.title") }}</h3>
        <button
          @click="closeModal"
          class="p-1 rounded-full transition-colors"
          :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-200 text-gray-500 hover:text-gray-700'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- 弹窗内容区 -->
      <div class="flex-1 p-4 overflow-y-auto">
        <!-- 上传模式选择 -->
        <UploadModeSelector
          v-model="uploadMethod"
          :modes="uploadModes"
          :title="t('mount.uppy.uploadMethod')"
          :dark-mode="darkMode"
          :disabled="isUploading"
        />

        <!-- 高级功能 -->
        <AdvancedPluginsPanel
          :plugins="mediaPlugins"
          :enabled-count="enabledPluginsCount"
          :title="t('mount.uppy.advancedFeatures')"
          :enabled-count-template="t('mount.uppy.enabledCount', { count: '{count}' })"
          :dark-mode="darkMode"
          @toggle-plugin="togglePlugin"
        />

        <!-- Uppy Dashboard 容器 -->
        <UppyDashboardContainer
          ref="uppyContainerRef"
          container-id="uppy-dashboard"
          :dark-mode="darkMode"
          :show-paste-hint="true"
          :paste-hint-prefix="t('mount.uppy.pasteSupport')"
          :paste-key="t('mount.uppy.pasteKey')"
          :paste-hint-suffix="t('mount.uppy.pasteHint')"
        />

        <!-- 错误显示 -->
        <div v-if="errorMessage" class="mb-4 p-3 rounded-md" :class="darkMode ? 'bg-red-900/20 border border-red-700' : 'bg-red-50 border border-red-200'">
          <div class="flex items-center">
            <svg class="w-4 h-4 mr-2 text-red-500" fill="currentColor" viewBox="0 0 20 20">
              <path
                fill-rule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clip-rule="evenodd"
              />
            </svg>
            <span class="text-sm" :class="darkMode ? 'text-red-300' : 'text-red-700'">{{ errorMessage }}</span>
          </div>
        </div>
      </div>

      <!-- 底部操作栏 -->
      <div class="p-4 border-t" :class="darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50/50'">
        <div class="flex justify-between items-center">
          <div class="flex items-center space-x-4">
            <div class="flex items-center space-x-2">
              <svg class="w-4 h-4" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3a2 2 0 012-2h4a2 2 0 012 2v4" />
              </svg>
              <span class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'"> {{ t("mount.uppy.targetPath") }} {{ currentPath }} </span>
            </div>
          </div>

          <div class="flex items-center space-x-2">
            <!-- 开始上传按钮 -->
            <button
              v-if="canStartUpload"
              @click="startUpload"
              :disabled="isUploading"
              class="px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center space-x-2 disabled:opacity-50"
              :class="darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'"
            >
              <svg v-if="isUploading" class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <span>{{ isUploading ? t("mount.uppy.uploading") : t("mount.uppy.startUpload") }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 多个上传选择对话框 -->
    <Teleport to="body">
      <SelectUploadDialog
        v-if="showSelectUploadDialog"
        :is-open="showSelectUploadDialog"
        :file="selectUploadData.file"
        :uploads="selectUploadData.uploads"
        :show-match-score="selectUploadData.showMatchScore"
        :dark-mode="darkMode"
        @select="handleUploadSelect"
        @cancel="handleUploadSelectCancel"
        @close="showSelectUploadDialog = false"
      />
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useI18n } from "vue-i18n";

import Dashboard from "@uppy/dashboard";

// 导入Uppy样式
import "@uppy/core/dist/style.min.css";
import "@uppy/dashboard/dist/style.min.css";
import "@uppy/webcam/dist/style.min.css";
import "@uppy/screen-capture/dist/style.min.css";
import "@uppy/audio/dist/style.min.css";
import "@uppy/image-editor/dist/style.min.css";
import "@uppy/url/dist/style.min.css";

// 导入共享CSS
import "@/styles/uppy-dashboard.css";

// 导入共享Composables
import { useUppyCore, useUppyEvents, useUppyPaste, useUppyBackendProgress } from "@/composables/uppy";

// 导入共享UI组件
import UploadModeSelector from "@/components/uppy/UploadModeSelector.vue";
import AdvancedPluginsPanel from "@/components/uppy/AdvancedPluginsPanel.vue";
import UppyDashboardContainer from "@/components/uppy/UppyDashboardContainer.vue";

// 导入ServerResumePlugin插件
import ServerResumePlugin from "@/modules/storage-core/uppy/ServerResumePlugin.js";
import { api } from "@/api";
import { getUploadProgress } from "@/api/services/systemService.js";
import { useStorageConfigsStore } from "@/stores/storageConfigsStore.js";
import { STORAGE_STRATEGIES } from "@/modules/storage-core/drivers/types.js";
import { resolveDriverByConfigId } from "@/modules/storage-core/drivers/registry.js";
import { useShareUploadController } from "@/modules/upload";

// 导入插件管理器
import { createUppyPluginManager } from "@/modules/storage-core/uppy/UppyPluginManager.js";

// 导入 URL 上传服务
import { validateUrlInfo, fetchUrlContent } from "@/api/services/urlUploadService.js";

// 导入对话框组件
import SelectUploadDialog from "@/components/common/dialogs/SelectUploadDialog.vue";

// 组件属性
const props = defineProps({
  isOpen: { type: Boolean, default: false },
  darkMode: { type: Boolean, default: false },
  currentPath: { type: String, required: true },
  isAdmin: { type: Boolean, default: false },
});

// 事件
const emit = defineEmits(["close", "upload-success", "upload-error"]);

// 国际化
const { locale, t } = useI18n();

// 使用Composables
const { uppyInstance, initializeUppy, destroyUppy } = useUppyCore();
const { fileCount } = useUppyEvents({
  uppy: uppyInstance,
  onFileAdded: (file) => {
    console.log("[Uppy] 文件已添加:", file.name);
    ensureUploadIdForFile(file);
    errorMessage.value = "";
  },
  onFileRemoved: (file) => {
    console.log("[Uppy] 文件已移除:", file.name);
  },
  onError: (error) => {
    // 捕获Uppy系统错误，统一展示到错误区域
    const message = error?.message || t("file.messages.uploadFailed");
    errorMessage.value = message;
  },
});

useUppyPaste({
  uppy: uppyInstance,
  enabled: computed(() => props.isOpen),
  onPaste: (file) => {
    console.log("[Uppy] 粘贴文件:", file.name);
  },
});

// 响应式数据
const uppyContainerRef = ref(null);
const uploadMethod = ref("presigned");
const canUsePresigned = ref(true);
const canUseMultipart = ref(true);
const currentDriverType = ref(null);
const errorMessage = ref("");
const isUploading = ref(false);
const mediaPlugins = ref([]);

// 多个上传选择对话框状态
const showSelectUploadDialog = ref(false);
const selectUploadData = ref({
  file: null,
  uploads: [],
  showMatchScore: true,
  onSelect: null,
  onCancel: null,
});

// 插件管理器实例
let pluginManager = null;

// 驱动适配器句柄
let fsAdapterHandle = null;
let fsUploadSession = null;

const disposeFsAdapterHandle = () => {
  if (fsAdapterHandle?.adapter?.destroy) {
    try {
      fsAdapterHandle.adapter.destroy();
    } catch (error) {
      console.warn("[Uppy] 清理StorageAdapter失败", error);
    }
  }
  fsAdapterHandle = null;
};

const disposeFsSession = (shouldCancel = false) => {
  if (shouldCancel) {
    try {
      fsUploadSession?.cancel?.();
    } catch {}
  }
  try {
    fsUploadSession?.destroy?.();
  } catch {}
  fsUploadSession = null;
};

const storageConfigsStore = useStorageConfigsStore();
const { createFsUploadSession } = useShareUploadController();
const driverStrategy = ref(STORAGE_STRATEGIES.PRESIGNED_SINGLE);
const mountsCache = ref([]);
const mountsLoading = ref(false);

const enforceUploadMethodByDriver = (driver) => {
  const fsCaps = driver?.capabilities?.fs || {};
  const allowPresigned = fsCaps.presignedSingle === true;
  const allowMultipart = fsCaps.multipart === true;
  canUsePresigned.value = allowPresigned;
  canUseMultipart.value = allowMultipart;
  currentDriverType.value = driver?.config?.storage_type || driver?.type || null;

  if (!allowPresigned && uploadMethod.value === "presigned") {
    uploadMethod.value = allowMultipart ? "multipart" : "stream";
  }
  if (!allowMultipart && uploadMethod.value === "multipart") {
    uploadMethod.value = allowPresigned ? "presigned" : "stream";
  }
};

const normalizePath = (path) => {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
};

const getMountRootFromPath = (path) => {
  const normalized = normalizePath(path);
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length) return null;
  return `/${segments[0]}`;
};

const ensureMountsLoaded = async () => {
  if (mountsCache.value.length || mountsLoading.value) return;
  mountsLoading.value = true;
  try {
    const { useAdminMountService } = await import("@/modules/admin/services/mountService.js");
    const { getMountsList } = useAdminMountService();
    const mounts = await getMountsList();
    mountsCache.value = Array.isArray(mounts) ? mounts : [];
  } catch (error) {
    console.error("[Uppy] 加载挂载列表失败", error);
  } finally {
    mountsLoading.value = false;
  }
};

const getStorageConfigIdForCurrentPath = async () => {
  await ensureMountsLoaded();
  const mountRoot = getMountRootFromPath(props.currentPath);
  if (!mountRoot) return null;
  const mount = mountsCache.value.find((item) => item.mount_path === mountRoot);
  return mount?.storage_config_id || null;
};

const ensureStorageConfigForCurrentPath = async () => {
  const id = await getStorageConfigIdForCurrentPath();
  if (!id) throw new Error(t("file.messages.noStorageConfig"));

  // 1) 尝试通过通用 storageConfigsStore 加载配置（可能对非 admin 返回 403）
  let loadError = null;
  try {
    if (!storageConfigsStore.hasFreshCache.value) {
      await storageConfigsStore.loadConfigs();
    }
  } catch (e) {
    // 记录加载错误，但先不急着决定提示内容
    loadError = e;
  }

  // 如果缓存中已有目标配置，直接返回
  if (storageConfigsStore.getConfigById(id)) return id;

  // 如果加载过程中发生错误（例如非 admin 无权访问存储配置列表），
  // 且仍然找不到目标配置，则将原始错误抛出，交由上层统一规范化（包括权限错误提示）。
  if (loadError) {
    throw loadError;
  }

  // 2) admin 场景下的兜底：直接调用 admin storageConfigService 补全配置列表
  try {
    const { useAdminStorageConfigService } = await import("@/modules/admin/services/storageConfigService.js");
    const { getStorageConfigs } = useAdminStorageConfigService();
    const resp = await getStorageConfigs();
    if (resp?.data) {
      storageConfigsStore.replaceConfigs(resp.data);
      if (storageConfigsStore.getConfigById(id)) return id;
    }
  } catch (e) {
    // admin 兜底失败时不覆盖之前的错误语义，仍然落到“缺少配置”提示
  }

  // 3) 确实不存在该存储配置（或配置被删除）
  throw new Error(`${t("file.messages.noStorageConfig")}: ${id}`);
};

// 上传模式配置
const uploadModes = computed(() => {
  return [
    {
      value: "presigned",
      label: t("mount.uppy.presignedUpload"),
      modeLabel: t("mount.uppy.presignedMode"),
      tooltip: t("mount.uppy.presignedModeTooltip"),
      disabled: !canUsePresigned.value,
    },
    {
      value: "stream",
      label: t("mount.uppy.streamUpload"),
      modeLabel: t("mount.uppy.streamMode"),
      tooltip: t("mount.uppy.streamModeTooltip"),
    },
    {
      value: "form",
      label: t("mount.uppy.formUpload"),
      modeLabel: t("mount.uppy.formMode"),
      tooltip: t("mount.uppy.formModeTooltip"),
    },
    {
      value: "multipart",
      label: t("mount.uppy.multipartUpload"),
      modeLabel: t("mount.uppy.multipartMode"),
      tooltip: t("mount.uppy.multipartModeTooltip"),
      badge: t("mount.uppy.resumeSupport"),
      disabled: !canUseMultipart.value,
    },
  ];
});

const {
  ensureUploadIdForFile,
  resetBackendProgressTracking,
  updateBrowserProgressState,
  startBackendProgressPolling,
} = useUppyBackendProgress({
  uppy: uppyInstance,
  isDirectMode: () => uploadMethod.value === "stream",
});

// 计算属性
const canStartUpload = computed(() => {
  return fileCount.value > 0 && !isUploading.value;
});

const enabledPluginsCount = computed(() => {
  return pluginManager ? pluginManager.getEnabledPluginsCount() : 0;
});

/**
 * 切换插件状态
 */
const togglePlugin = (pluginKey) => {
  if (pluginManager) {
    pluginManager.togglePlugin(pluginKey);
    mediaPlugins.value = pluginManager.getPluginList();
    if (props.isOpen && uppyInstance.value) {
      setupUppy();
    }
  }
};

/**
 * 获取Dashboard插件配置
 */
const getDashboardConfig = () => ({
  inline: true,
  target: uppyContainerRef.value.container,
  theme: props.darkMode ? "dark" : "light",
  width: "100%",
  height: 400,
  showProgressDetails: true,
  showRemoveButtonAfterComplete: true,
  hideUploadButton: true,
  hidePauseResumeButton: false,
  proudlyDisplayPoweredByUppy: false,
  disableLocalFiles: false,
  metaFields: [
    {
      id: "name",
      name: t("mount.uppy.fileName"),
      placeholder: t("mount.uppy.customFilename"),
    },
  ],
  locale: {
    strings: {
      dataUploadedOfTotal: "%{complete} / %{total}",
    },
  },
});

/**
 * 获取ServerResumePlugin插件配置
 */
const getServerResumeConfig = () => ({
  autoCheck: true,
  matchThreshold: 0.8,
  timeWindow: 24,
  showConfirmDialog: true,
  currentPath: props.currentPath,
  maxSelectionOptions: 5,
  showMatchScore: true,
  shouldUseMultipart: () => uploadMethod.value === 'multipart',
  resolveStorageConfigId: async () => await ensureStorageConfigForCurrentPath(),
});

const strategyMap = {
  stream: STORAGE_STRATEGIES.BACKEND_STREAM, // 流式直传：PUT /fs/upload
  form: STORAGE_STRATEGIES.BACKEND_FORM,     // 表单上传：POST /fs/upload
  presigned: STORAGE_STRATEGIES.PRESIGNED_SINGLE,
  multipart: STORAGE_STRATEGIES.PRESIGNED_MULTIPART,
};

/**
 * 配置上传方式
 */
const configureUploadMethod = async () => {
  try {
    const storageConfigId = await ensureStorageConfigForCurrentPath();
    const driver = resolveDriverByConfigId(storageConfigId);
    enforceUploadMethodByDriver(driver);
    driverStrategy.value = strategyMap[uploadMethod.value] || STORAGE_STRATEGIES.BACKEND_STREAM;
    if (
      driver?.fs?.applyFsUploader &&
      (driverStrategy.value === STORAGE_STRATEGIES.PRESIGNED_SINGLE ||
        driverStrategy.value === STORAGE_STRATEGIES.PRESIGNED_MULTIPART ||
        driverStrategy.value === STORAGE_STRATEGIES.BACKEND_STREAM ||
        driverStrategy.value === STORAGE_STRATEGIES.BACKEND_FORM)
    ) {
      disposeFsAdapterHandle();
      const handle = driver.fs.applyFsUploader(uppyInstance.value, { strategy: driverStrategy.value, path: props.currentPath });
      fsAdapterHandle = handle ? { ...handle, mode: handle.mode || driverStrategy.value } : null;
    }
  } catch (e) {
    console.warn('[Uppy] configureUploadMethod 解析驱动失败', e);
    disposeFsAdapterHandle();
  }
};

/**
 * 配置ServerResumePlugin插件
 */
const configureServerResumePlugin = () => {
  if (uploadMethod.value === 'multipart') {
    uppyInstance.value.use(ServerResumePlugin, getServerResumeConfig());
  }
};

/**
 * 设置断点续传对话框事件监听器
 */
const setupResumeDialogEvents = () => {
  uppyInstance.value.on("server-resume-select-dialog", (data) => {
    selectUploadData.value = {
      file: data.file,
      uploads: data.uploads,
      showMatchScore: data.showMatchScore,
      onSelect: data.onSelect,
      onCancel: data.onCancel,
    };
    showSelectUploadDialog.value = true;
  });
};

/**
 * 初始化Uppy实例
 */
const setupUppy = async () => {
  try {
    if (uppyInstance.value) {
      disposeFsSession(true);
      destroyUppy();
    }
    disposeFsAdapterHandle();

    await initializeUppy({
      id: "new-uppy-dashboard",
      locale: locale.value,
    });

    pluginManager = createUppyPluginManager(uppyInstance.value, locale.value);
    mediaPlugins.value = pluginManager.getPluginList();

    // 设置 URL 导入插件回调
    pluginManager.setUrlImportCallbacks({
      validateUrlInfo,
      fetchUrlContent,
    });

    uppyInstance.value.use(Dashboard, getDashboardConfig());

    await configureUploadMethod();

    configureServerResumePlugin();
    if (uploadMethod.value === "multipart") {
      setupResumeDialogEvents();
    }

    pluginManager.addPluginsToUppy();
  } catch (error) {
    console.error("[Uppy] 初始化失败:", error);
    errorMessage.value = t("mount.uppy.initializationFailed", { message: error.message });
  }
};

/**
 * 处理上传完成事件
 */
const handleUploadComplete = async (result) => {
  console.log("[Uppy] 上传完成:", result);
  isUploading.value = false;

  if (result.successful.length > 0) {
    emit("upload-success", {
      count: result.successful.length,
      commitFailures: [],
      commitStats: {
        successCount: result.successful.length,
        failureCount: 0,
        totalCount: result.successful.length,
      },
      results: result.successful.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type,
        url: file.uploadURL,
      })),
    });

    setTimeout(() => {
      if (uppyInstance.value) {
        uppyInstance.value.clear();
      }
    }, 4000);
  }

  if (result.failed.length > 0) {
    const firstError = result.failed[0].error;
    emit("upload-error", new Error(firstError?.message || "上传失败"));
  }
};

const runFsCommitIfNeeded = async (result) => {
  if (!result) return;
  result.failed = result.failed || [];
  result.successful = result.successful || [];
  if (!fsAdapterHandle?.adapter || fsAdapterHandle.mode !== STORAGE_STRATEGIES.PRESIGNED_SINGLE) {
    return;
  }
  if (!result.successful.length) {
    return;
  }

  try {
    const summary = await fsAdapterHandle.adapter.batchCommitPresignedUploads(result.successful);
    const failures = summary?.failures || [];
    if (!failures.length) {
      return;
    }

    const failureMap = new Map();
    failures.forEach((failure) => {
      const error = new Error(failure.error || "提交预签名上传失败");
      failureMap.set(failure.fileId, error);
    });

    const remaining = [];
    result.successful.forEach((file) => {
      const failureError = failureMap.get(file.id);
      if (failureError) {
        try {
          uppyInstance.value?.emit?.("upload-error", file, failureError);
        } catch {}
        result.failed.push({ file, error: failureError });
      } else {
        remaining.push(file);
      }
    });

    result.successful = remaining;
  } catch (error) {
    const failureError = error instanceof Error ? error : new Error(String(error));
    const failedFiles = result.successful.slice();
    failedFiles.forEach((file) => {
      try {
        uppyInstance.value?.emit?.("upload-error", file, failureError);
      } catch {}
      result.failed.push({ file, error: failureError });
    });
    result.successful = [];
  }
};

/**
 * 规范化 FS 上传错误信息，统一处理权限错误等场景
 */
const normalizeFsUploadError = (error) => {
  if (!error) {
    return t("file.messages.uploadFailed");
  }

  const status = error?.request?.status || error?.response?.status;
  const body = error?.response?.body;
  const code = body?.code || error.code;

  // 权限错误：后端返回 403 或特定错误码时，统一提示为“没有权限使用此存储配置”
  if (status === 403 || code === "FS_PERMISSION_DENIED") {
    return t("file.messages.permissionError");
  }

  if (typeof body?.message === "string" && body.message) {
    return body.message;
  }

  if (typeof error.message === "string" && error.message) {
    return error.message;
  }

  return t("file.messages.uploadFailed");
};

/**
 * 开始上传
 */
const startUpload = async () => {
  if (!uppyInstance.value || !canStartUpload.value || isUploading.value) {
    return;
  }

  try {
    errorMessage.value = "";
    isUploading.value = true;
    const storageConfigId = await ensureStorageConfigForCurrentPath();
    try {
      const driver = resolveDriverByConfigId(storageConfigId);
      enforceUploadMethodByDriver(driver);
    } catch (e) {
      console.warn("[Uppy] startUpload 驱动解析失败", e);
    }

    driverStrategy.value = strategyMap[uploadMethod.value] || STORAGE_STRATEGIES.BACKEND_STREAM;

    disposeFsSession();
    resetBackendProgressTracking();
    fsUploadSession = createFsUploadSession({
      storageConfigId,
      fsOptions: { strategy: driverStrategy.value, path: props.currentPath },
      uppy: uppyInstance.value,
      events: {
        onProgress: (progress) => {
          if (progress) {
            updateBrowserProgressState(progress);
          }
        },
        onError: ({ error }) => {
          errorMessage.value = normalizeFsUploadError(error);
        },
        onComplete: async (result) => {
          try {
            await runFsCommitIfNeeded(result);
            await handleUploadComplete(result);
          } finally {
            resetBackendProgressTracking();
            disposeFsSession();
          }
        },
      },
    });

    if (uploadMethod.value === "stream") {
      try {
        uppyInstance.value.getFiles().forEach((file) => ensureUploadIdForFile(file));
      } catch {}
      startBackendProgressPolling();
    }

    await fsUploadSession.start();
  } catch (error) {
    console.error("[Uppy] 上传失败", error);
    errorMessage.value = normalizeFsUploadError(error);
    emit("upload-error", error);
    disposeFsSession();
  } finally {
    resetBackendProgressTracking();
    isUploading.value = false;
  }
};

const closeModal = () => {
  if (uppyInstance.value) {
    uppyInstance.value.cancelAll?.();
    uppyInstance.value.clear();
  }
  errorMessage.value = "";
  isUploading.value = false;
  resetBackendProgressTracking();
  disposeFsSession(true);
  disposeFsAdapterHandle();
  emit("close");
};

/**
 * 处理上传选择对话框确认
 */
const handleUploadSelect = (selectedUpload) => {
  showSelectUploadDialog.value = false;
  if (selectUploadData.value.onSelect) {
    selectUploadData.value.onSelect(selectedUpload);
  }
};

/**
 * 处理上传选择对话框取消
 */
const handleUploadSelectCancel = () => {
  showSelectUploadDialog.value = false;
  if (selectUploadData.value.onCancel) {
    selectUploadData.value.onCancel();
  }
};

// 监听上传方式变化，重新初始化 Uppy（确保清理旧插件）
watch(
  () => uploadMethod.value,
  async () => {
    if (props.isOpen && uppyInstance.value && !isUploading.value) {
      resetBackendProgressTracking();
      disposeFsSession(true);
      await setupUppy();
    }
  }
);

// 监听弹窗打开状态
watch(
  () => props.isOpen,
  async (newValue) => {
    if (newValue) {
      await ensureMountsLoaded();
      try {
        await storageConfigsStore.loadConfigs();
      } catch (e) {}
      await nextTick();
      await setupUppy();
    } else if (uppyInstance.value) {
      uppyInstance.value.cancelAll?.();
      uppyInstance.value.clear();
      errorMessage.value = "";
      isUploading.value = false;
      resetBackendProgressTracking();
      disposeFsSession(true);
      disposeFsAdapterHandle();
    }
  }
);

// 监听路径变化
watch(
  () => props.currentPath,
  async () => {
    if (!props.isOpen || !uppyInstance.value || isUploading.value) {
      return;
    }
    resetBackendProgressTracking();
    disposeFsSession(true);
    await setupUppy();
  }
);

// 监听暗色模式变化
watch(
  () => props.darkMode,
  async () => {
    if (props.isOpen && uppyInstance.value) {
      resetBackendProgressTracking();
      disposeFsSession(true);
      await setupUppy();
    }
  }
);

// 监听语言变化
watch(
  () => locale.value,
  () => {
    if (pluginManager) {
      pluginManager.updateLocale(locale.value);
      mediaPlugins.value = pluginManager.getPluginList();
    }
    if (props.isOpen && uppyInstance.value) {
      resetBackendProgressTracking();
      disposeFsSession(true);
      setupUppy();
    }
  }
);

// 生命周期
onMounted(async () => {
  if (props.isOpen) {
    await ensureMountsLoaded();
    await nextTick();
    await setupUppy();
  }
});

onBeforeUnmount(() => {
  destroyUppy();
  resetBackendProgressTracking();
  disposeFsSession(true);
  disposeFsAdapterHandle();
});
</script>

<style scoped>
/* 组件特有样式 */
</style>
