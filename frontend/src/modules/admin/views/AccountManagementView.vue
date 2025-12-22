<script setup>
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/authStore";
import { useAdminAccountService } from "@/modules/admin/services/accountService.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";
import { IconExclamation, IconInformationCircle, IconKey, IconLockClosed, IconRefresh, IconUser } from "@/components/icons";

// 使用i18n和认证Store
const { t } = useI18n();
const authStore = useAuthStore();
const { changePassword } = useAdminAccountService();
const { isDarkMode: darkMode } = useThemeMode();
const { showSuccess, showError } = useGlobalMessage();

// 检测用户类型
const isAdmin = computed(() => authStore.isAdmin);
const isApiKeyUser = computed(() => authStore.authType === "apikey");
const isGuest = computed(() => authStore.isGuest);

// 定义事件，用于通知父组件需要退出登录
const emit = defineEmits(["logout"]);

// 密码更改表单
const passwordForm = ref({
  currentPassword: "",
  newPassword: "",
  newUsername: "",
});

// 密码更改状态（仅用于控制加载状态）
const passwordChangeStatus = ref({
  loading: false,
});

// 更改密码
const handleChangePassword = async (event) => {
  event.preventDefault();

  // 验证表单
  if (!passwordForm.value.currentPassword) {
    const message = t("admin.account.messages.passwordRequired");
    showError(message);
    return;
  }

  // 确保新密码或新用户名至少填写一个
  if (!passwordForm.value.newPassword && !passwordForm.value.newUsername) {
    const message = t("admin.account.messages.newFieldRequired");
    showError(message);
    return;
  }

  // 如果新密码与当前密码相同，给出提示（虽然后端也会验证，但前端提前验证可以减少无效请求）
  if (passwordForm.value.newPassword && passwordForm.value.newPassword === passwordForm.value.currentPassword) {
    const message = t("admin.account.messages.samePassword");
    showError(message);
    return;
  }

  passwordChangeStatus.value = {
    loading: true,
  };

  try {
    // 调用 Service 修改密码
    await changePassword(passwordForm.value.currentPassword, passwordForm.value.newPassword, passwordForm.value.newUsername);

    // 更新成功
    showSuccess(t("admin.account.messages.updateSuccess"));
    showSuccess(t("admin.account.messages.updateSuccess"));
    passwordForm.value = {
      currentPassword: "",
      newPassword: "",
      newUsername: "",
    };

    // 由于后端会删除所有token，3秒后自动触发登出
    setTimeout(() => {
      emit("logout");
    }, 3000);
  } catch (error) {
    // 发生错误时，仅显示错误消息，不执行登出
    const message = error.message || t("admin.account.messages.updateFailed");
    showError(message);
  } finally {
    passwordChangeStatus.value.loading = false;
  }
};
</script>

<template>
  <div class="flex-1 flex flex-col overflow-y-auto">
    <!-- 页面标题和说明 -->
    <div class="mb-6">
      <h1 class="text-2xl font-bold mb-2" :class="darkMode ? 'text-white' : 'text-gray-800'">
        {{ isAdmin ? t("admin.account.title") : t("admin.account.apiKeyTitle") }}
      </h1>
      <p class="text-base" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
        {{ isAdmin ? t("admin.account.description") : t("admin.account.apiKeyDescription") }}
      </p>

      <!-- 游客 API Key 会话提示 -->
      <div
        v-if="isApiKeyUser && isGuest"
        class="mt-4 p-4 rounded-md border"
        :class="darkMode ? 'bg-blue-900/20 border-blue-800/40' : 'bg-blue-50 border-blue-200'"
      >
        <div class="flex items-start">
          <IconInformationCircle class="h-5 w-5 mr-2 mt-0.5 text-blue-500" aria-hidden="true" />
          <div class="text-sm" :class="darkMode ? 'text-blue-100' : 'text-blue-800'">
            <p class="font-medium">
              {{ t("admin.account.apiKeyInfo.guestBannerTitle") }}
            </p>
            <p class="mt-1">
              {{ t("admin.account.apiKeyInfo.guestBannerDescription") }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- 设置表单 -->
    <div class="space-y-6">
      <!-- API密钥用户信息显示 -->
      <div v-if="isApiKeyUser" class="setting-group bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700 max-w-2xl">
        <h2 class="text-lg font-medium mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">{{ t("admin.account.apiKeyInfo.title") }}</h2>
        <div class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
            <div class="md:col-span-1">
              <span class="block text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">{{ t("admin.account.apiKeyInfo.keyName") }}</span>
            </div>
            <div class="md:col-span-2">
              <span class="text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">{{ authStore.apiKeyInfo?.name || t("common.unknown") }}</span>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
            <div class="md:col-span-1">
              <span class="block text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">{{ t("admin.account.apiKeyInfo.basicPath") }}</span>
            </div>
            <div class="md:col-span-2">
              <span class="text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">{{ authStore.apiKeyInfo?.basic_path || "/" }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 管理员信息修改设置组 -->
      <div v-if="isAdmin" class="setting-group bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700 max-w-2xl">
        <h2 class="text-lg font-medium mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">{{ t("admin.account.adminInfo.title") }}</h2>
        <div class="space-y-4">
          <p class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ t("admin.account.adminInfo.description") }}</p>

          <form @submit="handleChangePassword" class="space-y-6">
            <!-- 新用户名 -->
            <div class="setting-item grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
              <div class="md:col-span-1">
                <label for="newUsername" class="block text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">{{
                  t("admin.account.adminInfo.newUsernameLabel")
                }}</label>
              </div>
              <div class="md:col-span-2">
                <div class="relative">
                  <input
                    type="text"
                    name="newUsername"
                    id="newUsername"
                    v-model="passwordForm.newUsername"
                    class="block w-full rounded border shadow-sm pl-3 pr-10 py-2 text-sm"
                    :class="
                      darkMode
                        ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500'
                        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500'
                    "
                    :placeholder="t('admin.account.adminInfo.newUsernamePlaceholder')"
                  />
                  <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                    <IconUser class="h-5 w-5" :class="darkMode ? 'text-gray-500' : 'text-gray-400'" aria-hidden="true" />
                  </div>
                </div>
                <p class="mt-2 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ t("admin.account.adminInfo.newUsernameHint") }}</p>
              </div>
            </div>

            <!-- 当前密码 -->
            <div class="setting-item grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
              <div class="md:col-span-1">
                <label for="currentPassword" class="block text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
                  {{ t("admin.account.adminInfo.currentPasswordLabel") }} <span class="text-red-500">*</span>
                </label>
              </div>
              <div class="md:col-span-2">
                <div class="relative">
                  <input
                    type="password"
                    name="currentPassword"
                    id="currentPassword"
                    autocomplete="current-password"
                    v-model="passwordForm.currentPassword"
                    class="block w-full rounded border shadow-sm pl-3 pr-10 py-2 text-sm"
                    :class="
                      darkMode
                        ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500'
                        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500'
                    "
                    :placeholder="t('admin.account.adminInfo.currentPasswordPlaceholder')"
                    required
                  />
                  <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                    <IconKey class="h-5 w-5" :class="darkMode ? 'text-gray-500' : 'text-gray-400'" aria-hidden="true" />
                  </div>
                </div>
                <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                  {{ t("admin.account.adminInfo.currentPasswordHint") }}
                </p>
              </div>
            </div>

            <!-- 新密码 -->
            <div class="setting-item grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
              <div class="md:col-span-1">
                <label for="newPassword" class="block text-sm font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">{{
                  t("admin.account.adminInfo.newPasswordLabel")
                }}</label>
              </div>
              <div class="md:col-span-2">
                <div class="relative">
                  <input
                    type="password"
                    name="newPassword"
                    id="newPassword"
                    autocomplete="new-password"
                    v-model="passwordForm.newPassword"
                    class="block w-full rounded border shadow-sm pl-3 pr-10 py-2 text-sm"
                    :class="
                      darkMode
                        ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500'
                        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500'
                    "
                    :placeholder="t('admin.account.adminInfo.newPasswordPlaceholder')"
                  />
                  <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                    <IconLockClosed class="h-5 w-5" :class="darkMode ? 'text-gray-500' : 'text-gray-400'" aria-hidden="true" />
                  </div>
                </div>
                <p class="mt-1 text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                  {{ t("admin.account.adminInfo.newPasswordHint") }}
                </p>
              </div>
            </div>

            <div class="flex justify-end pt-4">
              <button
                type="submit"
                :disabled="passwordChangeStatus.loading"
                class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span v-if="passwordChangeStatus.loading" class="flex items-center">
                  <IconRefresh size="sm" class="animate-spin -ml-0.5 mr-2" aria-hidden="true" />
                  {{ t("admin.account.buttons.updating") }}
                </span>
                <span v-else>{{ t("admin.account.buttons.updateAccount") }}</span>
              </button>
            </div>
          </form>

          <!-- 警告提示 -->
          <div class="mt-6 p-4 rounded-md border" :class="darkMode ? 'bg-amber-900/20 border-amber-800/40' : 'bg-amber-50 border-amber-200'">
            <div class="flex items-start">
              <IconExclamation class="h-5 w-5 mr-2 mt-0.5 text-amber-500" aria-hidden="true" />
              <p class="text-sm" :class="darkMode ? 'text-amber-200' : 'text-amber-800'">{{ t("admin.account.adminInfo.warningMessage") }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.setting-group {
  background: transparent;
}

.setting-item {
  padding: 1rem 0;
}

.setting-item:not(:last-child) {
  border-bottom: 1px solid;
  border-color: inherit;
}

/* 移动端适配 */
@media (max-width: 768px) {
  .setting-item {
    grid-template-columns: 1fr;
  }
}
</style>
