<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { pwaUtils } from "@/pwa/pwaManager.js";
import { IconClose, IconComputerDesktop, IconExclamation, IconRefresh } from "@/components/icons";

// 🎯 国际化支持
const { t } = useI18n();

const props = defineProps({
  darkMode: {
    type: Boolean,
    default: false,
  },
});

// 组件状态
const showInstallPrompt = ref(false);
const showUpdatePrompt = ref(false);
const isInstalling = ref(false);
const isUpdating = ref(false);

// 计算属性
const pwaState = pwaUtils.state;
const canInstall = computed(() => pwaState.isInstallable && !pwaState.isInstalled);
const hasUpdate = computed(() => pwaState.isUpdateAvailable);
const isOffline = computed(() => pwaState.isOffline);

// 安装应用
const installApp = async () => {
  if (isInstalling.value) return;

  isInstalling.value = true;
  try {
    const success = await pwaUtils.install();
    if (success) {
      showInstallPrompt.value = false;
    }
  } catch (error) {
    console.error(t("pwa.errors.installFailed"), error);
  } finally {
    isInstalling.value = false;
  }
};

// 更新应用
const updateApp = async () => {
  if (isUpdating.value) return;

  isUpdating.value = true;
  try {
    const success = await pwaUtils.update();
    if (success) {
      showUpdatePrompt.value = false;
      // 等待一下然后刷新页面
      setTimeout(() => {
        pwaUtils.reloadApp();
      }, 1000);
    }
  } catch (error) {
    console.error(t("pwa.errors.updateFailed"), error);
  } finally {
    isUpdating.value = false;
  }
};

// 关闭安装提示
const dismissInstallPrompt = () => {
  showInstallPrompt.value = false;
  // 记住用户选择，一段时间内不再显示
  localStorage.setItem("pwa-install-dismissed", Date.now().toString());
};

// 关闭更新提示
const dismissUpdatePrompt = () => {
  showUpdatePrompt.value = false;
};

// 检查是否应该显示安装提示
const checkInstallPrompt = () => {
  const dismissed = localStorage.getItem("pwa-install-dismissed");
  const dismissedTime = dismissed ? parseInt(dismissed) : 0;
  const daysSinceDismissed = (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);

  // 如果超过7天或从未拒绝过，则显示提示
  if (canInstall.value && (!dismissed || daysSinceDismissed > 7)) {
    showInstallPrompt.value = true;
  }
};

// 监听PWA状态变化
let stateWatcher;

onMounted(() => {
  // 检查安装提示
  checkInstallPrompt();

  // 监听更新
  if (hasUpdate.value) {
    showUpdatePrompt.value = true;
  }

  // 设置状态监听器
  stateWatcher = setInterval(() => {
    if (canInstall.value && !showInstallPrompt.value) {
      checkInstallPrompt();
    }
    if (hasUpdate.value && !showUpdatePrompt.value) {
      showUpdatePrompt.value = true;
    }
  }, 5000);
});

onUnmounted(() => {
  if (stateWatcher) {
    clearInterval(stateWatcher);
  }
});
</script>

<template>
  <div class="pwa-prompts">
    <!-- 离线状态指示器 -->
    <Transition name="fade-slide">
      <div
        v-if="isOffline"
        :class="['fixed bottom-20 right-4 z-50 px-2 py-1 rounded-full shadow-lg text-xs font-medium', darkMode ? 'bg-yellow-800 text-yellow-200' : 'bg-yellow-500 text-white']"
      >
        <div class="flex items-center space-x-1">
          <IconExclamation size="xs" class="flex-shrink-0" />
          <span class="whitespace-nowrap">{{ t("pwa.status.offline") }}</span>
        </div>
      </div>
    </Transition>

    <!-- 安装提示 -->
    <Transition name="slide-up">
      <div
        v-if="showInstallPrompt && canInstall"
        :class="[
          'fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-sm z-40 rounded-lg shadow-lg p-4',
          darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200',
        ]"
      >
        <div class="flex items-start space-x-3">
          <div :class="['flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center', darkMode ? 'bg-blue-900' : 'bg-blue-100']">
            <IconComputerDesktop size="lg" :class="darkMode ? 'text-blue-400' : 'text-blue-600'" />
          </div>
          <div class="flex-1 min-w-0">
            <h3 :class="['text-sm font-medium', darkMode ? 'text-white' : 'text-gray-900']">{{ t("pwa.installPrompt.title") }}</h3>
            <p :class="['text-sm mt-1', darkMode ? 'text-gray-300' : 'text-gray-600']">{{ t("pwa.installPrompt.message") }}</p>
            <div class="flex space-x-2 mt-3">
              <button
                @click="installApp"
                :disabled="isInstalling"
                :class="[
                  'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                  darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white disabled:bg-blue-800' : 'bg-blue-600 hover:bg-blue-700 text-white disabled:bg-blue-400',
                ]"
              >
                <span v-if="!isInstalling">{{ t("pwa.actions.install") }}</span>
                <span v-else class="flex items-center space-x-1">
                  <IconRefresh class="animate-spin w-3 h-3" aria-hidden="true" />
                  <span>{{ t("pwa.install.installing") }}</span>
                </span>
              </button>
              <button
                @click="dismissInstallPrompt"
                :class="[
                  'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                  darkMode ? 'text-gray-300 hover:text-white hover:bg-gray-700' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100',
                ]"
              >
                {{ t("pwa.actions.later") }}
              </button>
            </div>
          </div>
          <button
            @click="dismissInstallPrompt"
            :class="['flex-shrink-0 p-1 rounded-md transition-colors', darkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600']"
          >
            <IconClose size="sm" />
          </button>
        </div>
      </div>
    </Transition>

    <!-- 更新提示 -->
    <Transition name="slide-up">
      <div
        v-if="showUpdatePrompt && hasUpdate"
        :class="[
          'fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-sm z-40 rounded-lg shadow-lg p-4',
          darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200',
        ]"
      >
        <div class="flex items-start space-x-3">
          <div :class="['flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center', darkMode ? 'bg-green-900' : 'bg-green-100']">
            <IconRefresh size="lg" :class="darkMode ? 'text-green-400' : 'text-green-600'" />
          </div>
          <div class="flex-1 min-w-0">
            <h3 :class="['text-sm font-medium', darkMode ? 'text-white' : 'text-gray-900']">{{ t("pwa.updatePrompt.title") }}</h3>
            <p :class="['text-sm mt-1', darkMode ? 'text-gray-300' : 'text-gray-600']">{{ t("pwa.updatePrompt.message") }}</p>
            <div class="flex space-x-2 mt-3">
              <button
                @click="updateApp"
                :disabled="isUpdating"
                :class="[
                  'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                  darkMode ? 'bg-green-600 hover:bg-green-700 text-white disabled:bg-green-800' : 'bg-green-600 hover:bg-green-700 text-white disabled:bg-green-400',
                ]"
              >
                <span v-if="!isUpdating">{{ t("pwa.update.updateApp") }}</span>
                <span v-else class="flex items-center space-x-1">
                  <IconRefresh class="animate-spin w-3 h-3" aria-hidden="true" />
                  <span>{{ t("pwa.update.updating") }}</span>
                </span>
              </button>
              <button
                @click="dismissUpdatePrompt"
                :class="[
                  'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                  darkMode ? 'text-gray-300 hover:text-white hover:bg-gray-700' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100',
                ]"
              >
                {{ t("pwa.actions.later") }}
              </button>
            </div>
          </div>
          <button
            @click="dismissUpdatePrompt"
            :class="['flex-shrink-0 p-1 rounded-md transition-colors', darkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600']"
          >
            <IconClose size="sm" />
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* 过渡动画 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.3s ease-out;
}

.fade-slide-enter-from {
  transform: translateX(20px);
  opacity: 0;
}

.fade-slide-leave-to {
  transform: translateX(20px);
  opacity: 0;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease-out;
}

.slide-up-enter-from {
  transform: translateY(100%);
  opacity: 0;
}

.slide-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
