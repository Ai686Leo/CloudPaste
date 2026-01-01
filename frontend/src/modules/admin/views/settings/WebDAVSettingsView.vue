<script setup>
import { ref, onMounted } from "vue";
import { API_BASE_URL } from "@/api/config";
import { useI18n } from "vue-i18n";
import { useAdminSystemService } from "@/modules/admin/services/systemService.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";
import { IconRefresh, IconCloud, IconInformationCircle, IconCopy, IconKey, IconUser, IconCheck } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();
const log = createLogger("WebDAVSettingsView");
const { getWebdavSettings, updateWebdavSettings } = useAdminSystemService();
const { isDarkMode: darkMode } = useThemeMode();
const { showSuccess, showError } = useGlobalMessage();

// ============ 状态管理 ============

// WebDAV 设置
const webdavSettings = ref({
  webdav_upload_mode: "chunked",
});

// 上传模式选项
const uploadModes = [
  { value: "chunked", labelKey: "admin.webdav.uploadSettings.modes.chunked" },
  { value: "single", labelKey: "admin.webdav.uploadSettings.modes.single" },
];

// WebDAV 服务地址
const webdavUrl = ref("");

// 加载状态
const isLoading = ref(false);
const isSaving = ref(false);
const isCopied = ref(false);

// ============ 数据加载 ============

onMounted(async () => {
  // 设置 WebDAV 地址
  webdavUrl.value = `${API_BASE_URL}/dav`;

  isLoading.value = true;
  try {
    const settings = await getWebdavSettings();
    settings.forEach((setting) => {
      if (setting.key === "webdav_upload_mode") {
        webdavSettings.value.webdav_upload_mode = setting.value || "chunked";
      }
    });
  } catch (error) {
    log.error("获取 WebDAV 设置失败:", error);
    showError(t("admin.webdav.messages.updateFailed"));
  } finally {
    isLoading.value = false;
  }
});

// ============ 操作函数 ============

const handleSave = async () => {
  isSaving.value = true;
  try {
    await updateWebdavSettings({
      webdav_upload_mode: webdavSettings.value.webdav_upload_mode,
    });
    showSuccess(t("admin.webdav.messages.updateSuccess"));
  } catch (error) {
    log.error("更新 WebDAV 设置失败:", error);
    showError(error.message || t("admin.webdav.messages.updateFailed"));
  } finally {
    isSaving.value = false;
  }
};

const copyWebdavUrl = async () => {
  try {
    await navigator.clipboard.writeText(webdavUrl.value);
    isCopied.value = true;
    showSuccess(t("fileView.actions.copied"));
    setTimeout(() => {
      isCopied.value = false;
    }, 2000);
  } catch (error) {
    log.error("复制失败:", error);
    showError(t("fileView.actions.copyFailed"));
  }
};
</script>

<template>
  <div class="flex-1 flex flex-col overflow-y-auto">
    <!-- 页面标题 -->
    <div class="mb-8">
      <h1 class="text-2xl font-bold mb-2" :class="darkMode ? 'text-white' : 'text-gray-900'">
        {{ t("admin.webdav.title") }}
      </h1>
      <p class="text-base" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
        {{ t("admin.webdav.description") }}
      </p>
    </div>

    <!-- 加载状态 -->
    <div v-if="isLoading" class="flex items-center justify-center py-12">
      <IconRefresh size="lg" class="animate-spin" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" />
    </div>

    <!-- 设置内容 - 垂直布局 -->
    <div v-else class="space-y-6 max-w-2xl">

      <!-- ==================== 卡片1：上传设置 ==================== -->
      <section
        class="rounded-xl border transition-colors"
        :class="darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'"
      >
        <!-- 卡片头部 -->
        <div class="px-5 py-4 border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
          <div class="flex items-center gap-3">
            <div
              class="flex items-center justify-center w-9 h-9 rounded-lg"
              :class="darkMode ? 'bg-blue-500/20' : 'bg-blue-50'"
            >
              <IconCloud size="sm" :class="darkMode ? 'text-blue-400' : 'text-blue-600'" />
            </div>
            <div>
              <h2 class="text-base font-semibold" :class="darkMode ? 'text-white' : 'text-gray-900'">
                {{ t("admin.webdav.uploadSettings.title") }}
              </h2>
              <p class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.webdav.uploadSettings.description") }}
              </p>
            </div>
          </div>
        </div>

        <!-- 卡片内容 -->
        <div class="p-5">
          <!-- 上传模式选择 -->
          <div class="space-y-3">
            <label class="block text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
              {{ t("admin.webdav.uploadSettings.uploadModeLabel") }}
            </label>

            <!-- 单选卡片组 -->
            <div class="space-y-2">
              <label
                v-for="mode in uploadModes"
                :key="mode.value"
                class="relative flex items-start p-3 rounded-lg border-2 cursor-pointer transition-all"
                :class="[
                  webdavSettings.webdav_upload_mode === mode.value
                    ? darkMode
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-blue-500 bg-blue-50'
                    : darkMode
                      ? 'border-gray-600 hover:border-gray-500 bg-gray-700/30'
                      : 'border-gray-200 hover:border-gray-300 bg-gray-50/50'
                ]"
              >
                <input
                  type="radio"
                  :value="mode.value"
                  v-model="webdavSettings.webdav_upload_mode"
                  class="sr-only"
                />
                <div class="flex-1 min-w-0">
                  <span
                    class="block text-sm font-medium"
                    :class="darkMode ? 'text-white' : 'text-gray-900'"
                  >
                    {{ t(mode.labelKey) }}
                  </span>
                </div>
                <div
                  class="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ml-3 mt-0.5"
                  :class="webdavSettings.webdav_upload_mode === mode.value
                    ? 'bg-blue-500'
                    : darkMode ? 'border-2 border-gray-500' : 'border-2 border-gray-300'"
                >
                  <IconCheck
                    v-if="webdavSettings.webdav_upload_mode === mode.value"
                    size="xs"
                    class="text-white"
                  />
                </div>
              </label>
            </div>

            <p class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.webdav.uploadSettings.uploadModeHint") }}
            </p>
          </div>
        </div>

        <!-- 卡片底部：保存按钮 -->
        <div class="px-5 py-4 border-t flex justify-end" :class="darkMode ? 'border-gray-700 bg-gray-800/30' : 'border-gray-100 bg-gray-50/50'">
          <button
            type="button"
            @click="handleSave"
            :disabled="isSaving"
            class="inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-lg transition-all focus:outline-none focus:ring-4 focus:ring-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
            :class="isSaving ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'"
          >
            <IconRefresh v-if="isSaving" size="sm" class="animate-spin -ml-0.5 mr-2" />
            {{ isSaving ? t("admin.webdav.buttons.updating") : t("admin.webdav.buttons.updateSettings") }}
          </button>
        </div>
      </section>

      <!-- ==================== 卡片2：连接信息（只读，无保存按钮） ==================== -->
      <section
        class="rounded-xl border transition-colors"
        :class="darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'"
      >
        <!-- 卡片头部 -->
        <div class="px-5 py-4 border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
          <div class="flex items-center gap-3">
            <div
              class="flex items-center justify-center w-9 h-9 rounded-lg"
              :class="darkMode ? 'bg-purple-500/20' : 'bg-purple-50'"
            >
              <IconInformationCircle size="sm" :class="darkMode ? 'text-purple-400' : 'text-purple-600'" />
            </div>
            <div>
              <h2 class="text-base font-semibold" :class="darkMode ? 'text-white' : 'text-gray-900'">
                {{ t("admin.webdav.protocolInfo.title") }}
              </h2>
              <p class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.webdav.protocolInfo.description") }}
              </p>
            </div>
          </div>
        </div>

        <!-- 卡片内容 -->
        <div class="p-5 space-y-4">
          <!-- WebDAV 地址 -->
          <div class="flex items-center justify-between gap-4">
            <div class="flex-1 min-w-0">
              <label class="block text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                {{ t("admin.webdav.protocolInfo.webdavUrlLabel") }}
              </label>
              <p class="text-xs mt-0.5" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.webdav.protocolInfo.webdavUrlHint") }}
              </p>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <div
                class="px-3 py-2 rounded-lg font-mono text-sm"
                :class="darkMode ? 'bg-gray-700/70 text-gray-200' : 'bg-gray-100 text-gray-700'"
              >
                {{ webdavUrl }}
              </div>
              <button
                type="button"
                @click="copyWebdavUrl"
                class="flex-shrink-0 p-2 rounded-lg border transition-all"
                :class="[
                  isCopied
                    ? 'bg-green-500 border-green-500 text-white'
                    : darkMode
                      ? 'border-gray-600 text-gray-300 hover:bg-gray-700'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                ]"
                :title="isCopied ? t('fileView.actions.copied') : t('fileView.actions.copyLink')"
              >
                <IconCheck v-if="isCopied" size="sm" />
                <IconCopy v-else size="sm" />
              </button>
            </div>
          </div>

          <!-- 分隔线 -->
          <div class="border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'"></div>

          <!-- 认证方式 -->
          <div class="space-y-3">
            <label class="block text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
              {{ t("admin.webdav.protocolInfo.authMethodLabel") }}
            </label>

            <div class="space-y-2">
              <!-- 管理员认证 -->
              <div
                class="flex items-center gap-3 p-3 rounded-lg border"
                :class="darkMode ? 'bg-gray-700/30 border-gray-600' : 'bg-gray-50 border-gray-200'"
              >
                <div
                  class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  :class="darkMode ? 'bg-gray-600' : 'bg-gray-200'"
                >
                  <IconUser size="sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'" />
                </div>
                <span class="text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                  {{ t("admin.webdav.protocolInfo.adminAuth") }}
                </span>
              </div>

              <!-- API 密钥认证 -->
              <div
                class="flex items-center gap-3 p-3 rounded-lg border"
                :class="darkMode ? 'bg-gray-700/30 border-gray-600' : 'bg-gray-50 border-gray-200'"
              >
                <div
                  class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  :class="darkMode ? 'bg-gray-600' : 'bg-gray-200'"
                >
                  <IconKey size="sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'" />
                </div>
                <span class="text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                  {{ t("admin.webdav.protocolInfo.apiKeyAuth") }}
                </span>
              </div>
            </div>

            <p class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.webdav.protocolInfo.authHint") }}
            </p>
          </div>
        </div>
      </section>

    </div>
  </div>
</template>
