<template>
  <div class="flex-1 flex flex-col overflow-y-auto">
    <!-- 页面标题和说明 -->
    <div class="mb-6">
      <h1 class="text-2xl font-bold mb-2" :class="darkMode ? 'text-white' : 'text-gray-800'">{{ t("admin.preview.title") }}</h1>
      <p class="text-base" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">{{ t("admin.preview.description") }}</p>
    </div>

    <!-- 设置分组 -->
    <div class="space-y-6">
      <!-- 预览设置组 -->
      <div class="setting-group bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700 max-w-2xl">
        <h2 class="text-lg font-medium mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">{{ t("admin.preview.title") }}</h2>
        <div class="space-y-4">
          <form @submit="handleSaveSettings" class="space-y-6">
            <!-- 文本文件类型设置 -->
            <div class="setting-item">
              <label class="block text-sm font-medium mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                {{ t("admin.preview.textTypesLabel") }}
              </label>
              <textarea
                v-model="settings.preview_text_types"
                :placeholder="t('admin.preview.textTypesPlaceholder')"
                rows="3"
                class="block w-full rounded border shadow-sm px-3 py-2 text-sm"
                :class="
                  darkMode
                    ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500'
                "
              ></textarea>
              <p class="mt-2 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.preview.textTypesHelp") }}
              </p>
            </div>

            <!-- 图片文件类型设置 -->
            <div class="setting-item">
              <label class="block text-sm font-medium mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                {{ t("admin.preview.imageTypesLabel") }}
              </label>
              <textarea
                v-model="settings.preview_image_types"
                :placeholder="t('admin.preview.imageTypesPlaceholder')"
                rows="3"
                class="block w-full rounded border shadow-sm px-3 py-2 text-sm"
                :class="
                  darkMode
                    ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500'
                "
              ></textarea>
              <p class="mt-2 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.preview.imageTypesHelp") }}
              </p>
            </div>

            <!-- 视频文件类型设置 -->
            <div class="setting-item">
              <label class="block text-sm font-medium mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                {{ t("admin.preview.videoTypesLabel") }}
              </label>
              <textarea
                v-model="settings.preview_video_types"
                :placeholder="t('admin.preview.videoTypesPlaceholder')"
                rows="3"
                class="block w-full rounded border shadow-sm px-3 py-2 text-sm"
                :class="
                  darkMode
                    ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500'
                "
              ></textarea>
              <p class="mt-2 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.preview.videoTypesHelp") }}
              </p>
            </div>

            <!-- 音频文件类型设置 -->
            <div class="setting-item">
              <label class="block text-sm font-medium mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                {{ t("admin.preview.audioTypesLabel") }}
              </label>
              <textarea
                v-model="settings.preview_audio_types"
                :placeholder="t('admin.preview.audioTypesPlaceholder')"
                rows="3"
                class="block w-full rounded border shadow-sm px-3 py-2 text-sm"
                :class="
                  darkMode
                    ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500'
                "
              ></textarea>
              <p class="mt-2 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.preview.audioTypesHelp") }}
              </p>
            </div>

            <!-- Office文件类型设置 -->
            <div class="setting-item">
              <label class="block text-sm font-medium mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                {{ t("admin.preview.officeTypesLabel") }}
              </label>
              <textarea
                v-model="settings.preview_office_types"
                :placeholder="t('admin.preview.officeTypesPlaceholder')"
                rows="3"
                class="block w-full rounded border shadow-sm px-3 py-2 text-sm"
                :class="
                  darkMode
                    ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500'
                "
              ></textarea>
              <p class="mt-2 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.preview.officeTypesHelp") }}
              </p>
            </div>

            <!-- 文档文件类型设置 -->
            <div class="setting-item">
              <label class="block text-sm font-medium mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                {{ t("admin.preview.documentTypesLabel") }}
              </label>
              <textarea
                v-model="settings.preview_document_types"
                :placeholder="t('admin.preview.documentTypesPlaceholder')"
                rows="3"
                class="block w-full rounded border shadow-sm px-3 py-2 text-sm"
                :class="
                  darkMode
                    ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500'
                "
              ></textarea>
              <p class="mt-2 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.preview.documentTypesHelp") }}
              </p>
            </div>

            <!-- 文档/Office DocumentApp 模板配置 -->
            <div class="setting-item">
              <label class="block text-sm font-medium mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                {{ t("admin.preview.documentAppsLabel") }}
              </label>
              <textarea
                v-model="settings.preview_document_apps"
                :placeholder="t('admin.preview.documentAppsPlaceholder')"
                rows="6"
                class="block w-full rounded border shadow-sm px-3 py-2 text-xs font-mono leading-snug"
                :class="
                  darkMode
                    ? 'bg-gray-700 border-gray-600 text-white focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500'
                "
              ></textarea>
              <p class="mt-2 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.preview.documentAppsHelp") }}
              </p>
            </div>

            <!-- 操作按钮 -->
            <div class="flex justify-between items-center pt-6">
              <button
                type="button"
                @click="handleResetToDefaults"
                :disabled="status.loading"
                class="inline-flex items-center px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-colors"
                :class="[
                  status.loading ? 'opacity-50 cursor-not-allowed' : '',
                  darkMode
                    ? 'border-gray-600 text-gray-300 bg-gray-800 hover:bg-gray-700 hover:border-gray-500'
                    : 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50 hover:border-gray-400',
                ]"
              >
                <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                {{ t("admin.preview.resetDefaults") }}
              </button>

              <button
                type="submit"
                :disabled="status.loading"
                class="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-colors"
                :class="status.loading ? 'opacity-50 cursor-not-allowed' : ''"
              >
                <svg v-if="status.loading" class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                {{ status.loading ? t("admin.global.buttons.updating") : t("admin.global.buttons.updateSettings") }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useAdminSystemService } from "@/modules/admin/services/systemService.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";

// 使用i18n
const { t } = useI18n();
const { getPreviewSettings, updatePreviewSettings } = useAdminSystemService();
const { isDarkMode: darkMode } = useThemeMode();
const { showSuccess, showError } = useGlobalMessage();

// 状态管理（仅用于控制加载状态）
const status = ref({
  loading: false,
});

// 预览设置数据
const settings = ref({
  preview_text_types: "",
  preview_image_types: "",
  preview_video_types: "",
  preview_audio_types: "",
  preview_office_types: "",
  preview_document_types: "",
  preview_document_apps: "",
});

// 默认设置
const defaultSettings = {
  preview_text_types:
    "txt,htm,html,xml,java,properties,sql,js,md,json,conf,ini,vue,php,py,bat,yml,yaml,go,sh,c,cpp,h,hpp,tsx,vtt,srt,ass,rs,lrc,dockerfile,makefile,gitignore,license,readme",
  preview_image_types: "jpg,tiff,jpeg,png,gif,bmp,svg,ico,swf,webp,avif",
  preview_video_types: "mp4,mkv,avi,mov,rmvb,webm,flv,m3u8,ts,m2ts",
  preview_audio_types: "mp3,flac,ogg,m4a,wav,opus,wma",
  preview_office_types: "doc,docx,xls,xlsx,ppt,pptx,rtf",
  preview_document_types: "pdf",
  preview_document_apps: JSON.stringify(
    {
      "doc,docx,xls,xlsx,ppt,pptx,rtf": {
        microsoft: {
          urlTemplate: "https://view.officeapps.live.com/op/view.aspx?src=$e_url",
        },
        google: {
          urlTemplate: "https://docs.google.com/viewer?url=$e_url&embedded=true",
        },
      },
    },
    null,
    2,
  ),
};

// 加载设置
const loadSettings = async () => {
  try {
    status.value.loading = true;

    // 使用分组API获取预览设置（分组ID = 2）
    const previewSettings = await getPreviewSettings();

    // 将设置数据映射到本地状态
    previewSettings.forEach((setting) => {
      if (Object.prototype.hasOwnProperty.call(settings.value, setting.key)) {
        settings.value[setting.key] = setting.value || "";
      }
    });
  } catch (err) {
    console.error("加载预览设置失败:", err);
    const message = err.message || "加载设置失败";
    showError(message);
  } finally {
    status.value.loading = false;
  }
};

// 保存设置
const handleSaveSettings = async (event) => {
  event.preventDefault();

  try {
    // 基础 JSON 校验：preview_document_apps 需要是合法的 JSON 对象
    if (settings.value.preview_document_apps && settings.value.preview_document_apps.trim().length > 0) {
      try {
        const parsed = JSON.parse(settings.value.preview_document_apps);
        if (!parsed || typeof parsed !== "object") {
          throw new Error("INVALID_DOCUMENT_APPS_JSON");
        }
        settings.value.preview_document_apps = JSON.stringify(parsed, null, 2);
      } catch (e) {
        console.error("预览模板配置 JSON 解析失败:", e);
        const message = t("admin.preview.documentAppsInvalidJson");
        status.value.loading = false;
        showError(message);
        return;
      }
    }

    status.value.loading = true;

    // 预览设置组，分组ID = 2
    await updatePreviewSettings({
      preview_text_types: settings.value.preview_text_types,
      preview_image_types: settings.value.preview_image_types,
      preview_video_types: settings.value.preview_video_types,
      preview_audio_types: settings.value.preview_audio_types,
      preview_office_types: settings.value.preview_office_types,
      preview_document_types: settings.value.preview_document_types,
      preview_document_apps: settings.value.preview_document_apps,
    });
    showSuccess(t("admin.preview.saveSuccess"));
  } catch (err) {
    console.error("保存预览设置失败:", err);
    const message = err.message || "保存设置失败";
    showError(message);
  } finally {
    status.value.loading = false;
  }
};

// 重置为默认设置
const handleResetToDefaults = () => {
  if (confirm(t("admin.preview.resetConfirm"))) {
    Object.assign(settings.value, defaultSettings);
  }
};

// 组件挂载时加载设置
onMounted(() => {
  loadSettings();
});
</script>
