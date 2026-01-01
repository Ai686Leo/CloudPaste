<script setup>
import { ref, reactive, onMounted } from "vue";
import { useLocalStorage } from "@vueuse/core";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiStatus } from "@/api/ApiStatus";
import { useAuthStore } from "@/stores/authStore.js";
import { IconKey, IconUser, IconUsers } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

const props = defineProps({
  darkMode: {
    type: Boolean,
    required: true,
  },
});

const router = useRouter();
const { t } = useI18n();
const log = createLogger("AdminLoginView");
const authStore = useAuthStore();

const loading = ref(false);
const error = ref("");
const isApiKeyMode = ref(false);
const guestEnabled = ref(false);
const rememberMe = ref(false);

const form = reactive({
  username: "",
  password: "",
});

const apiKeyForm = reactive({
  apiKey: "",
});

const toggleLoginMode = () => {
  isApiKeyMode.value = !isApiKeyMode.value;
  error.value = "";
};

const LOGIN_PREF_KEY = "cp_admin_login_pref";
const storedLoginPref = useLocalStorage(LOGIN_PREF_KEY, null);

const loadRemembered = () => {
  try {
    const data = storedLoginPref.value;
    if (!data) return;

    if (data.lastMode === "admin") {
      isApiKeyMode.value = false;
      if (data.rememberAdmin && data.adminUsername) {
        form.username = data.adminUsername;
        rememberMe.value = true;
      }
    } else if (data.lastMode === "apikey") {
      isApiKeyMode.value = true;
      if (data.rememberApiKey && data.apiKey) {
        apiKeyForm.apiKey = data.apiKey;
        rememberMe.value = true;
      }
    }
  } catch {
    // ignore
  }
};

const saveRemembered = (mode) => {
  const payload = {
    lastMode: mode,
    rememberAdmin: mode === "admin" && rememberMe.value,
    adminUsername: mode === "admin" && rememberMe.value ? form.username : "",
    rememberApiKey: mode === "apikey" && rememberMe.value,
    apiKey: mode === "apikey" && rememberMe.value ? apiKeyForm.apiKey : "",
  };
  try {
    storedLoginPref.value = payload;
  } catch {
    // ignore
  }
};

const handleLogin = async () => {
  if (isApiKeyMode.value) {
    return handleApiKeyLogin();
  }

  if (!form.username || !form.password) {
    error.value = t("admin.login.inputRequired.usernamePassword");
    return;
  }

  loading.value = true;
  error.value = "";

  try {
    await authStore.adminLogin(form.username, form.password);
    saveRemembered("admin");

    // 登录成功，智能重定向到合适的管理页面
    const redirectQuery = router.currentRoute.value.query.redirect;
    if (redirectQuery) {
      router.push(redirectQuery);
    } else {
      // 没有指定重定向路径，使用智能重定向
      router.push("/admin");
    }
  } catch (err) {
    log.error("管理员登录失败:", err);
    if (err.status === ApiStatus.UNAUTHORIZED || err.response?.status === ApiStatus.UNAUTHORIZED || err.code === ApiStatus.UNAUTHORIZED) {
      error.value = t("admin.login.errors.invalidCredentials") || "用户名或密码错误";
    } else if (err.message && err.message.includes("认证失败")) {
      error.value = t("admin.login.errors.invalidCredentials") || "用户名或密码错误";
    } else {
      error.value = err.message || t("admin.login.errors.loginFailed");
    }
  } finally {
    loading.value = false;
  }
};

const handleApiKeyLogin = async () => {
  if (!apiKeyForm.apiKey) {
    error.value = t("admin.login.inputRequired.apiKey");
    return;
  }

  loading.value = true;
  error.value = "";

  try {
    await authStore.apiKeyLogin(apiKeyForm.apiKey);
    saveRemembered("apikey");

    // 登录成功，智能重定向到合适的管理页面
    const redirectQuery = router.currentRoute.value.query.redirect;
    if (redirectQuery) {
      router.push(redirectQuery);
    } else {
      // 没有指定重定向路径，使用智能重定向
      router.push("/admin");
    }
  } catch (err) {
    log.error("API密钥验证失败:", err);
    // 优先使用HTTP状态码判断错误类型，更可靠
    if (err.status === ApiStatus.UNAUTHORIZED || err.response?.status === ApiStatus.UNAUTHORIZED || err.code === ApiStatus.UNAUTHORIZED) {
      // 401 Unauthorized - API密钥无效
      error.value = t("admin.login.errors.invalidApiKey") || "API密钥无效或未授权";
    } else if (err.status === ApiStatus.FORBIDDEN || err.response?.status === ApiStatus.FORBIDDEN || err.code === ApiStatus.FORBIDDEN) {
      // 403 Forbidden - 权限不足
      error.value = t("admin.login.errors.insufficientPermissions") || "API密钥权限不足";
    } else if (err.message && err.message.includes("认证失败")) {
      // 特殊处理：如果错误消息包含"认证失败"，显示API密钥无效
      error.value = t("admin.login.errors.invalidApiKey") || "API密钥无效或未授权";
    } else {
      // 后备判断：基于错误消息内容判断错误类型（保持兼容性）
      error.value = err.message || t("admin.login.errors.keyValidationFailed");
    }
  } finally {
    loading.value = false;
  }
};

const handleGuestLogin = async () => {
  loading.value = true;
  error.value = "";

  try {
    await authStore.guestLogin();

    const redirectQuery = router.currentRoute.value.query.redirect;
    if (typeof redirectQuery === "string" && redirectQuery.startsWith("/mount-explorer")) {
      router.push(redirectQuery);
    } else {
      router.push({ name: "MountExplorer" });
    }
  } catch (err) {
    log.error("游客登录失败:", err);
    error.value = err.message || t("admin.login.errors.guestLoginFailed", "游客登录失败");
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  loadRemembered();
  try {
    const resp = await import("@/api").then((m) => m.api.system.getGuestConfig());
    const data = resp?.data ?? resp;
    guestEnabled.value = Boolean(data && data.enabled && data.key);
  } catch {
    guestEnabled.value = false;
  }
});
</script>

<template>
  <div class="h-screen flex flex-col">
    <div class="flex-1 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div class="mx-auto w-full max-w-sm rounded-lg p-6 shadow-md" :class="[darkMode ? 'bg-gray-800 shadow-gray-700/20' : 'bg-white shadow-gray-200/70']">
        <div class="sm:mx-auto sm:w-full sm:max-w-sm">
          <h2 class="mt-4 text-center text-2xl font-bold leading-9 tracking-tight" :class="darkMode ? 'text-white' : 'text-gray-900'">
            {{ isApiKeyMode ? $t("admin.login.apiKeyAuth") : $t("admin.login.adminLogin") }}
          </h2>
        </div>

        <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-sm">
          <form v-if="isApiKeyMode" class="space-y-6" @submit.prevent="handleLogin">
            <div>
              <label for="apiKey" class="block text-sm font-medium leading-6" :class="darkMode ? 'text-gray-200' : 'text-gray-900'">{{ $t("admin.login.apiKey") }}</label>
              <div class="mt-2">
                <input id="apiKey" v-model="apiKeyForm.apiKey" name="apiKey" type="text" required class="form-input" />
              </div>
            </div>

            <div class="flex items-center">
              <input id="remember-api-key" v-model="rememberMe" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
              <label for="remember-api-key" class="ml-2 block text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
                {{ $t("admin.login.rememberMe") }}
              </label>
            </div>

            <div v-if="error" class="rounded-md p-4" :class="darkMode ? 'bg-red-900/30' : 'bg-red-50'">
              <div class="flex">
                <div class="text-sm" :class="darkMode ? 'text-red-200' : 'text-red-700'">
                  {{ error }}
                </div>
              </div>
            </div>

            <div>
              <button
                type="submit"
                :disabled="loading"
                :class="[
                  'flex w-full justify-center rounded-md px-3 py-1.5 text-sm font-semibold leading-6 text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
                  loading ? 'opacity-70 cursor-not-allowed' : 'hover:bg-primary-500',
                  darkMode ? 'bg-primary-600 focus-visible:outline-primary-500' : 'bg-primary-600 focus-visible:outline-primary-600',
                ]"
              >
                <span v-if="loading">{{ t("common.loading") }}</span>
                <span v-else>{{ t("common.confirm") }}</span>
              </button>
            </div>
          </form>

          <form v-else class="space-y-6" @submit.prevent="handleLogin">
            <div>
              <label for="username" class="block text-sm font-medium leading-6" :class="darkMode ? 'text-gray-200' : 'text-gray-900'">{{ $t("admin.login.username") }}</label>
              <div class="mt-2">
                <input id="username" v-model="form.username" name="username" type="text" required class="form-input" />
              </div>
            </div>

            <div>
              <div class="flex items-center justify-between">
                <label for="password" class="block text-sm font-medium leading-6" :class="darkMode ? 'text-gray-200' : 'text-gray-900'">{{ $t("admin.login.password") }}</label>
              </div>
              <div class="mt-2">
                <input id="password" v-model="form.password" name="password" type="password" autocomplete="current-password" required class="form-input" />
              </div>
            </div>

            <div class="flex items-center">
              <input id="remember-admin" v-model="rememberMe" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
              <label for="remember-admin" class="ml-2 block text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
                {{ $t("admin.login.rememberMe") }}
              </label>
            </div>

            <div v-if="error" class="rounded-md p-4" :class="darkMode ? 'bg-red-900/30' : 'bg-red-50'">
              <div class="flex">
                <div class="text-sm" :class="darkMode ? 'text-red-200' : 'text-red-700'">
                  {{ error }}
                </div>
              </div>
            </div>

            <div>
              <button
                type="submit"
                :disabled="loading"
                :class="[
                  'flex w-full justify-center rounded-md px-3 py-1.5 text-sm font-semibold leading-6 text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
                  loading ? 'opacity-70 cursor-not-allowed' : 'hover:bg-primary-500',
                  darkMode ? 'bg-primary-600 focus-visible:outline-primary-500' : 'bg-primary-600 focus-visible:outline-primary-600',
                ]"
              >
                <span v-if="loading">{{ $t("admin.login.loggingIn") }}</span>
                <span v-else>{{ $t("admin.login.loginButton") }}</span>
              </button>
            </div>
          </form>

          <!-- 其他登录方式分隔线 -->
          <div class="relative mt-6">
            <div class="absolute inset-0 flex items-center">
              <div class="w-full border-t" :class="darkMode ? 'border-gray-600' : 'border-gray-300'"></div>
            </div>
            <div class="relative flex justify-center text-sm">
              <span class="px-2 text-gray-500" :class="darkMode ? 'bg-gray-800' : 'bg-white'">{{ $t("admin.login.orLoginWith", "或") }}</span>
            </div>
          </div>

          <!-- 其他登录方式按钮 -->
          <div class="mt-6 space-y-3">
            <!-- API密钥登录按钮 -->
            <button
              v-if="!isApiKeyMode"
              @click="toggleLoginMode"
              :class="[
                'flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                darkMode
                  ? 'border-gray-600 bg-gray-700/50 text-gray-200 hover:bg-gray-700 hover:border-gray-500'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400'
              ]"
            >
              <IconKey aria-hidden="true" />
              {{ $t("admin.login.useApiKey") }}
            </button>

            <!-- 返回管理员账号按钮 -->
            <button
              v-else
              @click="toggleLoginMode"
              :class="[
                'flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                darkMode
                  ? 'border-gray-600 bg-gray-700/50 text-gray-200 hover:bg-gray-700 hover:border-gray-500'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400'
              ]"
            >
              <IconUser aria-hidden="true" />
              {{ $t("admin.login.useAdminAccount") }}
            </button>

            <!-- 游客访问按钮 -->
            <button
              v-if="guestEnabled"
              @click="handleGuestLogin"
              :disabled="loading"
              :class="[
                'flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                loading ? 'opacity-50 cursor-not-allowed' : '',
                darkMode
                  ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/30'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              ]"
            >
              <IconUsers aria-hidden="true" />
              {{ $t("admin.login.useGuest", "以游客身份访问") }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
