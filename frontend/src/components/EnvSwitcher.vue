<script setup>
import { ref, onMounted } from "vue";
import { useLocalStorage } from "@vueuse/core";
import { API_BASE_URL, getEnvironmentInfo } from "../api/config";
import { createLogger } from "@/utils/logger.js";

// 预设环境配置
const environments = [
  { name: "本地开发", url: "http://localhost:8787" },
  { name: "开发Worker", url: "https://cloudpaste-backend.开发环境域名.workers.dev" },
  { name: "测试Worker", url: "https://cloudpaste-backend.xxxx.workers.dev" },
  { name: "生产Worker", url: "https://api.你的生产域名.com" },
];

// 添加自定义环境选项
const customUrl = ref("");
const showCustomInput = ref(false);

// 当前环境URL
const currentEnv = ref(API_BASE_URL);
const storedApiBaseUrl = useLocalStorage("vite-api-base-url", API_BASE_URL);
const log = createLogger("EnvSwitcher");

// 初始化时检查是否是自定义环境
onMounted(() => {
  // 如果当前环境不在预设列表中，则认为是自定义环境
  const isCustomEnv = !environments.some((env) => env.url === API_BASE_URL);
  if (isCustomEnv && API_BASE_URL) {
    customUrl.value = API_BASE_URL;
    showCustomInput.value = true;
  }

  // 输出当前环境信息
  log.debug("当前API环境:", getEnvironmentInfo());
});

// 切换环境
const switchEnvironment = (url) => {
  // 存储选择的环境URL到本地存储
  storedApiBaseUrl.value = url;
  currentEnv.value = url;

  // 刷新页面以应用新环境
  window.location.reload();
};

// 切换到自定义环境
const toggleCustomEnv = () => {
  showCustomInput.value = !showCustomInput.value;
  if (!showCustomInput.value) {
    customUrl.value = "";
  }
};

// 应用自定义环境
const applyCustomEnv = () => {
  if (customUrl.value.trim()) {
    switchEnvironment(customUrl.value.trim());
  }
};
</script>

<template>
  <div class="env-switcher p-2 rounded-lg" :class="{ 'bg-gray-100 dark:bg-gray-800': true }">
    <div class="flex flex-col space-y-2">
      <p class="text-xs font-medium text-gray-600 dark:text-gray-300">API环境切换</p>

      <div class="flex flex-wrap gap-2">
        <button
          v-for="env in environments"
          :key="env.url"
          @click="switchEnvironment(env.url)"
          class="px-2 py-1 text-xs rounded transition-colors"
          :class="[currentEnv === env.url ? 'bg-primary-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600']"
        >
          {{ env.name }}
        </button>

        <button
          @click="toggleCustomEnv"
          class="px-2 py-1 text-xs rounded transition-colors"
          :class="[showCustomInput ? 'bg-primary-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600']"
        >
          自定义
        </button>
      </div>

      <div v-if="showCustomInput" class="flex items-center space-x-2">
        <input
          v-model="customUrl"
          type="text"
          placeholder="输入API基础URL"
          class="flex-1 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
        <button @click="applyCustomEnv" class="px-2 py-1 text-xs bg-primary-500 text-white rounded hover:bg-primary-600 transition-colors">应用</button>
      </div>

      <div class="text-xs text-gray-500 dark:text-gray-400">当前: {{ currentEnv }}</div>
    </div>
  </div>
</template>

<style scoped>
.env-switcher {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 1000;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  max-width: 300px;
}
</style>
