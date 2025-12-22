<template>
  <div class="max-w-sm w-full mx-auto p-5 border rounded-lg shadow-sm bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
    <h3 class="text-lg font-medium mb-4 text-gray-900 dark:text-white">{{ t("fileView.password.title") }}</h3>
    <p class="mb-4 text-sm text-gray-600 dark:text-gray-300">{{ t("fileView.password.description") }}</p>

    <form @submit.prevent="verifyPassword" class="space-y-4">
      <!-- 密码输入框 -->
      <div>
        <label for="password" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">{{ t("fileView.password.label") }}</label>
        <div class="relative">
          <input
            :type="showPassword ? 'text' : 'password'"
            id="password"
            autocomplete="current-password"
            v-model="password"
            :placeholder="t('fileView.password.placeholder')"
            class="block w-full px-3 py-2 rounded-md shadow-sm border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white dark:bg-gray-700 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:focus:ring-offset-gray-800 password-input"
            :disabled="loading"
          />
          <button
            type="button"
            @click="togglePasswordVisibility"
            class="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300"
          >
            <IconEyeOff v-if="showPassword" size="md" class="h-5 w-5" />
            <IconEye v-else size="md" class="h-5 w-5" />
          </button>
        </div>
        <!-- 错误提示 -->
        <p v-if="error" class="mt-2 text-sm text-red-500 dark:text-red-400">{{ error }}</p>
      </div>

      <!-- 提交按钮 -->
      <button
        type="submit"
        class="w-full px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 dark:focus:ring-offset-gray-800"
        :disabled="loading || !password"
      >
        <span v-if="loading">
          <IconRefresh class="animate-spin h-5 w-5 mr-2 inline-block" />
          {{ t("fileView.password.loading") }}
        </span>
        <span v-else>{{ t("fileView.password.submit") }}</span>
      </button>
    </form>
  </div>
</template>

<script setup>
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useFileshareService } from "@/modules/fileshare/fileshareService.js";
import { ApiStatus } from "@/api/ApiStatus"; // 导入API状态码常量
import { IconEye, IconEyeOff, IconRefresh } from "@/components/icons";

const { t } = useI18n();
const fileshareService = useFileshareService();

const props = defineProps({
  fileId: {
    type: String,
    required: true,
  },
  appUrl: {
    type: String,
    required: false, // 不再需要appUrl
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  fileThumbnail: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["verified"]);

const password = ref("");
const loading = ref(false);
const error = ref("");
const showPassword = ref(false);

// 切换密码可见性
const togglePasswordVisibility = () => {
  showPassword.value = !showPassword.value;
};

// 验证密码
const verifyPassword = async () => {
  if (!password.value) return;

  loading.value = true;
  error.value = "";

  try {
    // 通过 fileshareService 验证文件密码
    // 约定：成功时返回领域数据对象，失败时抛出 Error
    const data = await fileshareService.verifyFilePassword(props.fileId, password.value);

    // 密码验证成功，将用户输入的密码与API返回的数据一起传递给父组件
    emit("verified", {
      ...(data || {}),
      currentPassword: password.value, // 传递当前输入的密码，用于后续操作
    });
  } catch (err) {
    console.error("验证密码时出错:", err);
    // 优先使用HTTP状态码判断错误类型，更可靠
    if (err.status === ApiStatus.UNAUTHORIZED || err.response?.status === ApiStatus.UNAUTHORIZED || err.code === ApiStatus.UNAUTHORIZED) {
      // 401 Unauthorized - 密码错误
      error.value = "密码错误，请重新输入";
    } else if (err.status === ApiStatus.GONE || err.response?.status === ApiStatus.GONE || err.code === ApiStatus.GONE) {
      // 410 Gone - 资源已过期
      error.value = "此文件已过期或不可访问";
    } else if (err.status === ApiStatus.NOT_FOUND || err.response?.status === ApiStatus.NOT_FOUND || err.code === ApiStatus.NOT_FOUND) {
      // 404 Not Found - 资源不存在
      error.value = "此文件不存在或已被删除";
    } else {
      // 根据错误消息内容精确映射到文案
      const msg = err.message || "";
      if (msg.includes("密码不正确") || msg.includes("密码错误")) {
        error.value = t("fileView.password.error");
      } else if (msg.includes("已过期") || msg.includes("达到最大查看次数") || msg.includes("410")) {
        error.value = "此文件已过期或不可访问";
      } else if (msg.includes("不存在") || msg.includes("已被删除") || msg.includes("404")) {
        error.value = "此文件不存在或已被删除";
      } else {
        error.value = msg || t("fileView.errors.unknown");
      }
    }
  } finally {
    loading.value = false;
  }
};

// 清除表单
watch(
  () => props.fileId,
  () => {
    password.value = "";
    error.value = "";
    loading.value = false;
  }
);
</script>

<style>
/* 隐藏密码框的浏览器自带眼睛图标 */
.password-input::-ms-reveal,
.password-input::-ms-clear {
  display: none !important;
}

/* 确保表单不会自动填充 */
input:-webkit-autofill,
input:-webkit-autofill:hover,
input:-webkit-autofill:focus {
  transition: background-color 5000s ease-in-out 0s;
}
</style>
