<template>
  <div v-if="shareLink" class="mt-3 p-3 rounded-md share-link-box" :class="darkMode ? 'bg-gray-800/50' : 'bg-gray-50'">
    <div class="flex items-center">
      <span class="text-sm mr-2" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ label }}</span>
      <a
        :href="shareLink"
        target="_blank"
        rel="noopener"
        class="link-text text-sm flex-grow"
        :class="darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-500'"
      >
        {{ shareLink }}
      </a>

      <button
        @click="copyPrimaryLink"
        class="ml-2 p-1 rounded-md transition-colors"
        :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-200 text-gray-500 hover:text-gray-700'"
        :title="copyTooltip"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
          />
        </svg>
      </button>

      <button
        v-if="showQrButton"
        @click="emit('show-qr-code', shareLink)"
        class="ml-2 p-1 rounded-md transition-colors"
        :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-200 text-gray-500 hover:text-gray-700'"
        :title="qrTooltip"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
          />
        </svg>
      </button>

      <button
        v-if="secondaryLink"
        @click="copySecondaryLink"
        class="ml-2 p-1 rounded-md transition-colors"
        :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-200 text-gray-500 hover:text-gray-700'"
        :title="secondaryTooltip"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.172 13.828a4 4 0 015.656 0l4 4a4 4 0 01-5.656 5.656l-1.102-1.101" />
        </svg>
      </button>

      <span v-if="showCountdown && countdownSeconds > 0" class="ml-2 text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
        {{ countdownText }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { ref, onUnmounted, watch, computed } from "vue";
import { copyToClipboard } from "@/utils/clipboard";

const props = defineProps({
  darkMode: { type: Boolean, default: false },
  label: { type: String, default: "" },
  shareLink: { type: String, default: "" },
  copyTooltip: { type: String, default: "" },
  copySuccessText: { type: String, default: "" },
  copyFailureText: { type: String, default: "" },
  showQrButton: { type: Boolean, default: false },
  qrTooltip: { type: String, default: "" },
  secondaryLink: { type: String, default: "" },
  secondaryTooltip: { type: String, default: "" },
  secondarySuccessText: { type: String, default: "" },
  secondaryFailureText: { type: String, default: "" },
  showCountdown: { type: Boolean, default: false },
  countdownSeconds: { type: Number, default: 15 },
  countdownFormatter: { type: Function, default: null },
});

const emit = defineEmits(["show-qr-code", "status-message", "countdown-end"]);

const countdown = ref(props.countdownSeconds);
let countdownTimer = null;

const stopCountdown = () => {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
};

const startCountdown = () => {
  if (!props.showCountdown) return;
  stopCountdown();
  countdown.value = props.countdownSeconds;
  countdownTimer = setInterval(() => {
    countdown.value--;
    if (countdown.value <= 0) {
      stopCountdown();
      emit("countdown-end");
    }
  }, 1000);
};

watch(
  () => props.shareLink,
  (link) => {
    if (link && props.showCountdown) {
      startCountdown();
    } else {
      stopCountdown();
    }
  }
);

onUnmounted(() => {
  stopCountdown();
});

const emitStatus = (type, message) => {
  if (message) {
    emit("status-message", { type, message });
  }
};

const copyPrimaryLink = async () => {
  if (!props.shareLink) return;
  try {
    const success = await copyToClipboard(props.shareLink);
    emitStatus(success ? "success" : "error", success ? props.copySuccessText : props.copyFailureText);
  } catch {
    emitStatus("error", props.copyFailureText);
  }
};

const copySecondaryLink = async () => {
  if (!props.secondaryLink) return;
  try {
    const success = await copyToClipboard(props.secondaryLink);
    emitStatus(success ? "success" : "error", success ? props.secondarySuccessText : props.secondaryFailureText);
  } catch {
    emitStatus("error", props.secondaryFailureText);
  }
};

const countdownText = computed(() => {
  if (!props.showCountdown) return "";
  if (typeof props.countdownFormatter === "function") {
    return props.countdownFormatter(countdown.value);
  }
  return `${countdown.value}s`;
});

defineExpose({
  startCountdown,
  stopCountdown,
});
</script>

<style scoped>
.share-link-box {
  animation: fadeIn 0.3s ease-out;
  border: 1px solid v-bind('props.darkMode ? "rgba(75, 85, 99, 0.3)" : "rgba(229, 231, 235, 0.8)"');
}

.link-text {
  text-decoration: none;
  word-break: break-all;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.link-text:hover {
  text-decoration: underline;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@media (max-width: 640px) {
  .share-link-box {
    max-width: 100%;
    overflow-x: hidden;
  }
}
</style>
