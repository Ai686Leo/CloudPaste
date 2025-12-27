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
        <IconCopy size="md" aria-hidden="true" />
      </button>

      <button
        v-if="showQrButton"
        @click="emit('show-qr-code', shareLink)"
        class="ml-2 p-1 rounded-md transition-colors"
        :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-200 text-gray-500 hover:text-gray-700'"
        :title="qrTooltip"
      >
        <IconQrCode size="md" aria-hidden="true" />
      </button>

      <button
        v-if="secondaryLink"
        @click="copySecondaryLink"
        class="ml-2 p-1 rounded-md transition-colors"
        :class="darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-200 text-gray-500 hover:text-gray-700'"
        :title="secondaryTooltip"
      >
        <IconLink size="md" aria-hidden="true" />
      </button>

      <span v-if="showCountdown && countdownSeconds > 0" class="ml-2 text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
        {{ countdownText }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { ref, onUnmounted, watch, computed } from "vue";
import { useIntervalFn } from "@vueuse/core";
import { copyToClipboard } from "@/utils/clipboard";
import { IconCopy, IconLink, IconQrCode } from "@/components/icons";

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
const { pause: stopCountdown, resume: resumeCountdown } = useIntervalFn(
  () => {
    countdown.value--;
    if (countdown.value <= 0) {
      stopCountdown();
      emit("countdown-end");
    }
  },
  1000,
  { immediate: false }
);

const startCountdown = () => {
  if (!props.showCountdown) return;
  stopCountdown();
  countdown.value = props.countdownSeconds;
  resumeCountdown();
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
