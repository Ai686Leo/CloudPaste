<template>
  <div
    v-if="visible"
    class="fixed top-4 right-4 max-w-sm w-full bg-white dark:bg-gray-800 border border-red-200 dark:border-red-700 rounded-lg shadow-lg z-50 transition-all duration-300"
    :class="{ 'opacity-0 translate-x-full': !visible }"
  >
    <div class="p-4">
      <div class="flex items-start">
        <div class="flex-shrink-0">
          <IconXCircle class="text-red-400" />
        </div>
        <div class="ml-3 w-0 flex-1">
          <p class="text-sm font-medium text-gray-900 dark:text-white">{{ title || t("common.errorToast.defaultTitle") }}</p>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-300">{{ message }}</p>
          <div v-if="actionText && actionHandler" class="mt-3">
            <button @click="actionHandler" class="text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-md transition-colors">
              {{ actionText }}
            </button>
          </div>
        </div>
        <div class="ml-4 flex-shrink-0 flex">
          <button
            @click="close"
            class="bg-white dark:bg-gray-800 rounded-md inline-flex text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
          >
            <span class="sr-only">{{ t("common.errorToast.srClose") }}</span>
            <IconClose />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from "vue";
import { useTimeoutFn } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { IconClose, IconXCircle } from "@/components/icons";

const { t } = useI18n();

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: "",
  },
  message: {
    type: String,
    required: true,
  },
  actionText: {
    type: String,
    default: "",
  },
  actionHandler: {
    type: Function,
    default: null,
  },
  autoClose: {
    type: Boolean,
    default: true,
  },
  duration: {
    type: Number,
    default: 5000,
  },
});

const emit = defineEmits(["close"]);

const { start: startAutoCloseTimer, stop: stopAutoCloseTimer } = useTimeoutFn(
  () => {
    close();
  },
  () => props.duration,
  { immediate: false }
);

const close = () => {
  emit("close");
};

const startAutoClose = () => {
  if (props.autoClose && props.duration > 0) {
    stopAutoCloseTimer();
    startAutoCloseTimer();
  }
};

const clearAutoClose = () => {
  stopAutoCloseTimer();
};

watch(
  () => props.visible,
  (newVisible) => {
    if (newVisible) {
      startAutoClose();
    } else {
      clearAutoClose();
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  clearAutoClose();
});
</script>
