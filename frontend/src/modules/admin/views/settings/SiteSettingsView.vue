<script setup>
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import VditorUnified from "@/components/common/VditorUnified.vue";
import ConfirmDialog from "@/components/common/dialogs/ConfirmDialog.vue";
import { useAdminSystemService } from "@/modules/admin/services/systemService.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";
import { useConfirmDialog } from "@/composables/core/useConfirmDialog.js";
import { IconHome, IconMegaphone, IconAdjustments, IconRefresh, IconGallery } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();
const log = createLogger("SiteSettingsView");
const { getSiteSettings, updateSiteSettings } = useAdminSystemService();
const { isDarkMode: darkMode } = useThemeMode();
const { showSuccess, showError } = useGlobalMessage();
const { dialogState, confirm, handleConfirm, handleCancel } = useConfirmDialog();

// ============ 状态管理 ============

// 站点设置
const siteSettings = ref({
  site_title: "CloudPaste",
  site_favicon_url: "",
  site_footer_markdown: "© 2025 CloudPaste. 保留所有权利。",
  site_announcement_enabled: false,
  site_announcement_content: "",
  site_custom_head: "",
  site_custom_body: "",
  site_home_editor_enabled: true,
  site_upload_page_enabled: true,
  site_mount_explorer_enabled: true,
});

// 加载状态
const isLoading = ref(false);

// 独立保存状态
const isSavingBasic = ref(false);
const isSavingAnnouncement = ref(false);
const isSavingAdvanced = ref(false);

// ============ 数据加载 ============

onMounted(async () => {
  isLoading.value = true;
  try {
    const settings = await getSiteSettings();
    settings.forEach((setting) => {
      switch (setting.key) {
        case "site_title":
          siteSettings.value.site_title = setting.value || "CloudPaste";
          break;
        case "site_favicon_url":
          siteSettings.value.site_favicon_url = setting.value || "";
          break;
        case "site_footer_markdown":
          siteSettings.value.site_footer_markdown = setting.value;
          break;
        case "site_announcement_enabled":
          siteSettings.value.site_announcement_enabled = setting.value === "true";
          break;
        case "site_announcement_content":
          siteSettings.value.site_announcement_content = setting.value || "";
          break;
        case "site_custom_head":
          siteSettings.value.site_custom_head = setting.value || "";
          break;
        case "site_custom_body":
          siteSettings.value.site_custom_body = setting.value || "";
          break;
        case "site_home_editor_enabled":
          siteSettings.value.site_home_editor_enabled = setting.value === "true";
          break;
        case "site_upload_page_enabled":
          siteSettings.value.site_upload_page_enabled = setting.value === "true";
          break;
        case "site_mount_explorer_enabled":
          siteSettings.value.site_mount_explorer_enabled = setting.value === "true";
          break;
      }
    });
  } catch (error) {
    log.error("获取站点设置失败:", error);
    showError(t("admin.site.messages.updateFailed"));
  } finally {
    isLoading.value = false;
  }
});

// ============ 保存函数 ============

// 保存基础站点信息
const handleSaveBasic = async () => {
  isSavingBasic.value = true;
  try {
    await updateSiteSettings({
      site_title: siteSettings.value.site_title || "CloudPaste",
      site_favicon_url: siteSettings.value.site_favicon_url || "",
      site_footer_markdown: siteSettings.value.site_footer_markdown || "",
    });
    showSuccess(t("admin.site.messages.updateSuccess"));
    await updateSiteConfigStore();
  } catch (error) {
    log.error("更新基础站点信息失败:", error);
    showError(error.message || t("admin.site.messages.updateFailed"));
  } finally {
    isSavingBasic.value = false;
  }
};

// 保存公告设置
const handleSaveAnnouncement = async () => {
  isSavingAnnouncement.value = true;
  try {
    await updateSiteSettings({
      site_announcement_enabled: siteSettings.value.site_announcement_enabled.toString(),
      site_announcement_content: siteSettings.value.site_announcement_content,
    });
    showSuccess(t("admin.site.messages.updateSuccess"));
    await updateSiteConfigStore();
  } catch (error) {
    log.error("更新公告设置失败:", error);
    showError(error.message || t("admin.site.messages.updateFailed"));
  } finally {
    isSavingAnnouncement.value = false;
  }
};

// 保存高级设置
const handleSaveAdvanced = async () => {
  isSavingAdvanced.value = true;
  try {
    await updateSiteSettings({
      site_home_editor_enabled: siteSettings.value.site_home_editor_enabled.toString(),
      site_upload_page_enabled: siteSettings.value.site_upload_page_enabled.toString(),
      site_mount_explorer_enabled: siteSettings.value.site_mount_explorer_enabled.toString(),
      site_custom_head: siteSettings.value.site_custom_head || "",
      site_custom_body: siteSettings.value.site_custom_body || "",
    });
    showSuccess(t("admin.site.messages.updateSuccess"));
    await updateSiteConfigStore();
  } catch (error) {
    log.error("更新高级设置失败:", error);
    showError(error.message || t("admin.site.messages.updateFailed"));
  } finally {
    isSavingAdvanced.value = false;
  }
};

// 更新站点配置Store缓存
const updateSiteConfigStore = async () => {
  try {
    const { useSiteConfigStore } = await import("@/stores/siteConfigStore.js");
    const siteConfigStore = useSiteConfigStore();
    siteConfigStore.updateSiteTitle(siteSettings.value.site_title);
    siteConfigStore.updateSiteFavicon(siteSettings.value.site_favicon_url);
    siteConfigStore.updateSiteFooter(siteSettings.value.site_footer_markdown);
    siteConfigStore.updateCustomHead(siteSettings.value.site_custom_head);
    siteConfigStore.updateCustomBody(siteSettings.value.site_custom_body);
    await siteConfigStore.refresh?.();
  } catch (storeError) {
    log.warn("更新站点配置Store失败:", storeError);
  }
};

// 重置设置
const resetSettings = async () => {
  const confirmed = await confirm({
    title: t("common.dialogs.resetTitle"),
    message: t("common.dialogs.resetConfirm"),
    confirmType: "warning",
    confirmText: t("common.dialogs.resetButton"),
    darkMode: darkMode.value,
  });

  if (!confirmed) return;

  siteSettings.value.site_title = "CloudPaste";
  siteSettings.value.site_favicon_url = "";
  siteSettings.value.site_footer_markdown = "© 2025 CloudPaste. 保留所有权利。";
  siteSettings.value.site_announcement_enabled = false;
  siteSettings.value.site_announcement_content = "";
  siteSettings.value.site_home_editor_enabled = true;
  siteSettings.value.site_upload_page_enabled = true;
  siteSettings.value.site_mount_explorer_enabled = true;
  siteSettings.value.site_custom_head = "";
  siteSettings.value.site_custom_body = "";
};

// 清空公告内容
const handleClearAnnouncementContent = () => {
  siteSettings.value.site_announcement_content = "";
};
</script>

<template>
  <div class="flex-1 flex flex-col overflow-y-auto">
    <!-- 页面标题 -->
    <div class="mb-8 flex items-start justify-between">
      <div>
        <h1 class="text-2xl font-bold mb-2" :class="darkMode ? 'text-white' : 'text-gray-900'">
          {{ t("admin.site.title") }}
        </h1>
        <p class="text-base" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
          {{ t("admin.site.description") }}
        </p>
      </div>
      <button
        type="button"
        @click="resetSettings"
        class="flex-shrink-0 px-4 py-2 text-sm font-medium border rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        :class="darkMode ? 'text-gray-300 bg-gray-700 border-gray-600 hover:bg-gray-600' : 'text-gray-700 bg-white border-gray-300 hover:bg-gray-50'"
      >
        {{ t("admin.site.buttons.reset") }}
      </button>
    </div>

    <!-- 加载状态 -->
    <div v-if="isLoading" class="flex items-center justify-center py-12">
      <IconRefresh size="lg" class="animate-spin" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" />
    </div>

    <!-- 设置内容 - 垂直布局 -->
    <div v-else class="space-y-6 max-w-2xl">

      <!-- ==================== 卡片1：基础站点信息 ==================== -->
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
              <IconHome size="sm" :class="darkMode ? 'text-blue-400' : 'text-blue-600'" />
            </div>
            <div>
              <h2 class="text-base font-semibold" :class="darkMode ? 'text-white' : 'text-gray-900'">
                {{ t("admin.site.groups.basic") }}
              </h2>
              <p class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.site.siteTitle.hint") }}
              </p>
            </div>
          </div>
        </div>

        <!-- 卡片内容 -->
        <div class="p-5 space-y-4">
          <!-- 站点标题 -->
          <div class="flex items-center justify-between gap-4">
            <div class="flex-1 min-w-0">
              <label class="block text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                {{ t("admin.site.siteTitle.label") }}
              </label>
            </div>
            <div class="flex-shrink-0 w-64">
              <input
                type="text"
                v-model="siteSettings.site_title"
                :placeholder="t('admin.site.siteTitle.placeholder')"
                class="w-full px-3 py-2 border rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                :class="darkMode
                  ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
                  : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'"
                maxlength="100"
              />
            </div>
          </div>

          <!-- 分隔线 -->
          <div class="border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'"></div>

          <!-- 站点图标 -->
          <div>
            <div class="flex items-center justify-between gap-4 mb-2">
              <label class="block text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                {{ t("admin.site.favicon.label") }}
              </label>
              <div class="w-8 h-8 border rounded flex items-center justify-center flex-shrink-0" :class="darkMode ? 'border-gray-600 bg-gray-700' : 'border-gray-300 bg-gray-50'">
                <img
                  v-if="siteSettings.site_favicon_url"
                  :src="siteSettings.site_favicon_url"
                  alt="站点图标预览"
                  class="w-6 h-6 object-contain"
                  @error="$event.target.style.display = 'none'"
                />
                <IconGallery v-else size="sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" />
              </div>
            </div>
            <input
              type="url"
              v-model="siteSettings.site_favicon_url"
              :placeholder="t('admin.site.favicon.placeholder')"
              class="w-full px-3 py-2 border rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'"
            />
            <p class="text-xs mt-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.site.favicon.hint") }}
            </p>
          </div>

          <!-- 分隔线 -->
          <div class="border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'"></div>

          <!-- 页脚内容 -->
          <div>
            <label class="block text-sm font-medium mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
              {{ t("admin.site.footer.label") }}
            </label>
            <textarea
              v-model="siteSettings.site_footer_markdown"
              :placeholder="t('admin.site.footer.placeholder')"
              rows="3"
              class="w-full px-3 py-2 border rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-vertical"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'"
            />
            <p class="text-xs mt-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.site.footer.hint") }}
            </p>
          </div>
        </div>

        <!-- 卡片底部：保存按钮 -->
        <div class="px-5 py-4 border-t flex justify-end" :class="darkMode ? 'border-gray-700 bg-gray-800/30' : 'border-gray-100 bg-gray-50/50'">
          <button
            type="button"
            @click="handleSaveBasic"
            :disabled="isSavingBasic"
            class="inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-lg transition-all focus:outline-none focus:ring-4 focus:ring-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
            :class="isSavingBasic ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'"
          >
            <IconRefresh v-if="isSavingBasic" size="sm" class="animate-spin -ml-0.5 mr-2" />
            {{ isSavingBasic ? t("admin.site.buttons.updating") : t("admin.site.buttons.updateSettings") }}
          </button>
        </div>
      </section>

      <!-- ==================== 卡片2：公告系统 ==================== -->
      <section
        class="rounded-xl border transition-colors"
        :class="darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'"
      >
        <!-- 卡片头部 -->
        <div class="px-5 py-4 border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
          <div class="flex items-center gap-3">
            <div
              class="flex items-center justify-center w-9 h-9 rounded-lg"
              :class="darkMode ? 'bg-amber-500/20' : 'bg-amber-50'"
            >
              <IconMegaphone size="sm" :class="darkMode ? 'text-amber-400' : 'text-amber-600'" />
            </div>
            <div>
              <h2 class="text-base font-semibold" :class="darkMode ? 'text-white' : 'text-gray-900'">
                {{ t("admin.site.groups.announcement") }}
              </h2>
              <p class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.site.announcement.enableHint") }}
              </p>
            </div>
          </div>
        </div>

        <!-- 卡片内容 -->
        <div class="p-5 space-y-4">
          <!-- 公告开关 -->
          <div class="flex items-center justify-between gap-4">
            <div class="flex-1 min-w-0">
              <label class="block text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                {{ t("admin.site.announcement.enableLabel") }}
              </label>
            </div>
            <label class="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input type="checkbox" v-model="siteSettings.site_announcement_enabled" class="sr-only peer" />
              <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-500/20 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <!-- 分隔线 -->
          <div class="border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'"></div>

          <!-- 公告内容编辑器 -->
          <div>
            <label class="block text-sm font-medium mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
              {{ t("admin.site.announcement.contentLabel") }}
            </label>
            <p class="text-xs mb-3" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.site.announcement.contentHint") }}
            </p>
            <VditorUnified
              v-model="siteSettings.site_announcement_content"
              :dark-mode="darkMode"
              :mini-mode="true"
              :placeholder="t('admin.site.announcement.contentPlaceholder')"
              @clear-content="handleClearAnnouncementContent"
            />
          </div>
        </div>

        <!-- 卡片底部：保存按钮 -->
        <div class="px-5 py-4 border-t flex justify-end" :class="darkMode ? 'border-gray-700 bg-gray-800/30' : 'border-gray-100 bg-gray-50/50'">
          <button
            type="button"
            @click="handleSaveAnnouncement"
            :disabled="isSavingAnnouncement"
            class="inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-lg transition-all focus:outline-none focus:ring-4 focus:ring-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
            :class="isSavingAnnouncement ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'"
          >
            <IconRefresh v-if="isSavingAnnouncement" size="sm" class="animate-spin -ml-0.5 mr-2" />
            {{ isSavingAnnouncement ? t("admin.site.buttons.updating") : t("admin.site.buttons.updateSettings") }}
          </button>
        </div>
      </section>

      <!-- ==================== 卡片3：高级设置 ==================== -->
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
              <IconAdjustments size="sm" :class="darkMode ? 'text-purple-400' : 'text-purple-600'" />
            </div>
            <div>
              <h2 class="text-base font-semibold" :class="darkMode ? 'text-white' : 'text-gray-900'">
                {{ t("admin.site.frontendEntries.title") }}
              </h2>
              <p class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.site.frontendEntries.hint") }}
              </p>
            </div>
          </div>
        </div>

        <!-- 卡片内容 -->
        <div class="p-5 space-y-4">
          <!-- 文本编辑器入口开关 -->
          <div class="flex items-center justify-between gap-4">
            <div class="flex-1 min-w-0">
              <label class="block text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                {{ t("admin.site.frontendEntries.homeEditor.label") }}
              </label>
              <p class="text-xs mt-0.5" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.site.frontendEntries.homeEditor.hint") }}
              </p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input type="checkbox" v-model="siteSettings.site_home_editor_enabled" class="sr-only peer" />
              <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-500/20 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <!-- 分隔线 -->
          <div class="border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'"></div>

          <!-- 文件上传页入口开关 -->
          <div class="flex items-center justify-between gap-4">
            <div class="flex-1 min-w-0">
              <label class="block text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                {{ t("admin.site.frontendEntries.uploadPage.label") }}
              </label>
              <p class="text-xs mt-0.5" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.site.frontendEntries.uploadPage.hint") }}
              </p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input type="checkbox" v-model="siteSettings.site_upload_page_enabled" class="sr-only peer" />
              <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-500/20 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <!-- 分隔线 -->
          <div class="border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'"></div>

          <!-- 挂载浏览入口开关 -->
          <div class="flex items-center justify-between gap-4">
            <div class="flex-1 min-w-0">
              <label class="block text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                {{ t("admin.site.frontendEntries.mountExplorer.label") }}
              </label>
              <p class="text-xs mt-0.5" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.site.frontendEntries.mountExplorer.hint") }}
              </p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input type="checkbox" v-model="siteSettings.site_mount_explorer_enabled" class="sr-only peer" />
              <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-500/20 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <!-- 分隔线 -->
          <div class="border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'"></div>

          <!-- 自定义头部 -->
          <div>
            <label class="block text-sm font-medium mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
              {{ t("admin.site.customHead") }}
            </label>
            <textarea
              v-model="siteSettings.site_custom_head"
              rows="6"
              :placeholder="t('admin.site.customHeadPlaceholder')"
              class="w-full px-3 py-2 border rounded-lg font-mono text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-vertical"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'"
            />
            <p class="text-xs mt-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.site.customHeadHelp") }}
            </p>
          </div>

          <!-- 分隔线 -->
          <div class="border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'"></div>

          <!-- 自定义body -->
          <div>
            <label class="block text-sm font-medium mb-2" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
              {{ t("admin.site.customBody") }}
            </label>
            <textarea
              v-model="siteSettings.site_custom_body"
              rows="6"
              :placeholder="t('admin.site.customBodyPlaceholder')"
              class="w-full px-3 py-2 border rounded-lg font-mono text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-vertical"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'"
            />
            <p class="text-xs mt-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.site.customBodyHelp") }}
            </p>
          </div>
        </div>

        <!-- 卡片底部：保存按钮 -->
        <div class="px-5 py-4 border-t flex justify-end" :class="darkMode ? 'border-gray-700 bg-gray-800/30' : 'border-gray-100 bg-gray-50/50'">
          <button
            type="button"
            @click="handleSaveAdvanced"
            :disabled="isSavingAdvanced"
            class="inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-lg transition-all focus:outline-none focus:ring-4 focus:ring-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
            :class="isSavingAdvanced ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'"
          >
            <IconRefresh v-if="isSavingAdvanced" size="sm" class="animate-spin -ml-0.5 mr-2" />
            {{ isSavingAdvanced ? t("admin.site.buttons.updating") : t("admin.site.buttons.updateSettings") }}
          </button>
        </div>
      </section>

    </div>

    <!-- 确认对话框 -->
    <ConfirmDialog
      v-bind="dialogState"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>
