<template>
  <div v-if="visible" class="fixed inset-0 flex items-center justify-center z-50">
    <div class="absolute inset-0 bg-black opacity-50" @click="closeModal"></div>
    <div class="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-lg max-w-md w-full relative z-10">
      <button @click="closeModal" class="absolute top-3 right-3 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
        <IconClose size="lg" aria-hidden="true" />
      </button>

      <h3 class="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">{{ $t("markdown.qrCodeTitle") }}</h3>

      <div class="flex flex-col items-center">
        <div v-if="qrCodeDataURL" class="bg-white p-4 rounded-lg mb-4">
          <img :src="qrCodeDataURL" :alt="$t('markdown.qrCodeTitle')" class="w-48 h-48" />
        </div>
        <div v-else class="bg-gray-100 dark:bg-gray-700 p-4 rounded-lg mb-4 w-48 h-48 flex items-center justify-center">
          <span class="text-gray-500 dark:text-gray-400">{{ $t("markdown.qrCodeGenerating") }}</span>
        </div>

        <div class="text-sm text-gray-600 dark:text-gray-300 mb-4 text-center max-w-xs">{{ $t("markdown.qrCodeScanToAccess") }}</div>

        <button @click="downloadQRCode" class="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors" :disabled="!qrCodeDataURL">
          {{ $t("markdown.downloadQRCode") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { generateQRCode as createQRCodeImage } from "@/utils/qrcodeUtils.js";
import { IconClose } from "@/components/icons";

const { t } = useI18n();

// Props
const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  shareLink: {
    type: String,
    default: "",
  },
});

// Emits
const emit = defineEmits(["close", "status-message"]);

// 二维码数据URL
const qrCodeDataURL = ref("");

// 生成二维码
const generateQRCode = async (url) => {
  if (!url) return;

  qrCodeDataURL.value = "";

  try {
    const dataURL = await createQRCodeImage(url, { width: 240, margin: 1 });
    qrCodeDataURL.value = dataURL;
  } catch (error) {
    console.error("生成二维码时出错:", error);
    emit("status-message", t("markdown.messages.qrCodeGenerateFailed"));
  }
};

// 关闭弹窗
const closeModal = () => {
  emit("close");
};

// 下载二维码
const downloadQRCode = () => {
  if (!qrCodeDataURL.value) return;

  const link = document.createElement("a");
  link.href = qrCodeDataURL.value;
  link.download = `cloudpaste-qrcode-${new Date().getTime()}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  emit("status-message", t("markdown.qrCodeDownloaded"));
};

// 监听弹窗显示状态
watch(
  () => props.visible,
  (newVisible) => {
    if (newVisible && props.shareLink) {
      generateQRCode(props.shareLink);
    } else {
      qrCodeDataURL.value = "";
    }
  }
);

// 监听分享链接变化
watch(
  () => props.shareLink,
  (newLink) => {
    if (props.visible && newLink) {
      generateQRCode(newLink);
    }
  }
);
</script>

<style scoped>
/* 弹窗动画 */
.fixed {
  animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* 弹窗内容动画 */
.bg-white,
.dark\\:bg-gray-800 {
  animation: slideIn 0.2s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(-10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
</style>
