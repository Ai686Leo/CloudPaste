<template>
  <div v-if="!hasPermission" class="permission-warning">
    <div
      class="mb-4 p-3 rounded-md border"
      :class="
        isApiKeyUserWithoutPermission
          ? 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/30 dark:border-red-700/50 dark:text-red-200'
          : 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-900/30 dark:border-yellow-700/50 dark:text-yellow-200'
      "
    >
      <div class="flex items-center">
        <component
          :is="isApiKeyUserWithoutPermission ? IconExclamation : IconInformationCircle"
          size="md"
          class="mr-2"
          aria-hidden="true"
        />
        <span v-if="isApiKeyUserWithoutPermission">
          {{ $t("common.noPermission") }}
        </span>
        <span v-else>
          {{ permissionRequiredText }}
          <a href="#" @click.prevent="navigateToAdmin" class="font-medium underline">{{ loginAuthText }}</a
          >。
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from "vue";
import { useEventListener } from "@vueuse/core";
import { useAuthStore } from "@/stores/authStore.js";
import { IconExclamation, IconInformationCircle } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

// Props
const props = defineProps({
  darkMode: {
    type: Boolean,
    default: false,
  },
  permissionType: {
    type: String,
    default: "text", // text, file, mount
  },
  permissionRequiredText: {
    type: String,
    default: "",
  },
  loginAuthText: {
    type: String,
    default: "",
  },
});

// Emits
const emit = defineEmits(["permission-change", "navigate-to-admin"]);

// 使用认证Store
const authStore = useAuthStore();
const log = createLogger("PermissionManager");

// 从Store获取权限状态的计算属性
const isAdmin = computed(() => authStore.isAdmin);
const hasApiKey = computed(() => authStore.isKeyUser && !!authStore.apiKey);
const hasTextPermission = computed(() => authStore.hasTextSharePermission);
const hasFilePermission = computed(() => authStore.hasFileSharePermission);
const hasMountPermission = computed(() => authStore.hasMountPermission);

// 根据权限类型动态计算权限状态
const hasPermission = computed(() => {
  switch (props.permissionType) {
    case "file":
      return authStore.hasFileSharePermission;
    case "mount":
      return authStore.hasMountPermission;
    case "text":
    default:
      return authStore.hasTextSharePermission;
  }
});

// 判断是否为已登录但无权限的API密钥用户
const isApiKeyUserWithoutPermission = computed(() => {
  return authStore.isAuthenticated && authStore.isKeyUser && !hasPermission.value;
});

// 检查用户权限状态（简化版，主要用于触发事件）
const checkPermissionStatus = async () => {
  log.debug("检查用户权限状态...");

  // 如果需要重新验证，则进行验证
  if (authStore.needsRevalidation) {
    log.debug("需要重新验证认证状态");
    await authStore.validateAuth();
  }

  log.debug("用户权限:", hasPermission.value ? "有权限" : "无权限");
  emit("permission-change", hasPermission.value);
};


// 导航到管理员登录页面
const navigateToAdmin = () => {
  emit("navigate-to-admin");
};

// 事件处理函数
const handleAuthStateChange = async (e) => {
  log.debug("接收到认证状态变化事件:", e.detail);
  emit("permission-change", hasPermission.value);
};

// 组件挂载
onMounted(async () => {
  await checkPermissionStatus();

  // 监听认证状态变化事件
  useEventListener(window, "auth-state-changed", handleAuthStateChange);
});


// 暴露方法和状态
defineExpose({
  hasPermission,
  isAdmin,
  hasApiKey,
  hasTextPermission,
  hasFilePermission,
  hasMountPermission,
  isApiKeyUserWithoutPermission,
  checkPermissionStatus,
});
</script>

<style scoped>
.permission-warning {
  margin-bottom: 1rem;
}
</style>
