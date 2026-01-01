<template>
  <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50" @click="handleClickOutside">
    <div class="relative rounded-lg max-w-md w-full shadow-xl" :class="darkMode ? 'bg-gray-800' : 'bg-white'">
      <!-- 标题栏 -->
      <div class="flex items-center justify-between p-6 border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <h3 class="text-lg font-medium" :class="darkMode ? 'text-white' : 'text-gray-900'">
          {{ t("fileView.actions.share") }}
        </h3>
        <button @click="closeModal" class="transition-colors" :class="darkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-400 hover:text-gray-500'">
          <IconClose size="lg" />
        </button>
      </div>

      <!-- 分享内容 -->
      <div class="p-6 space-y-6">
        <!-- 文件信息 -->
        <div class="flex items-center space-x-3 p-3 rounded-lg" :class="darkMode ? 'bg-gray-700/50' : 'bg-gray-50'">
          <div class="flex-shrink-0">
            <IconDocumentText size="xl" class="text-blue-500" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">
              {{ fileInfo.filename }}
            </p>
            <p class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ formatFileSize(fileInfo.size) }}
            </p>
          </div>
        </div>

        <!-- 快速操作 -->
        <div class="grid grid-cols-2 gap-3">
          <button
            @click="copyLink"
            class="flex items-center justify-center px-4 py-3 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2"
            :class="[
              copySuccess
                ? darkMode
                  ? 'bg-green-600 text-white'
                  : 'bg-green-600 text-white'
                : darkMode
                ? 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500 focus:ring-offset-gray-800'
                : 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500 focus:ring-offset-white',
            ]"
          >
            <IconCopy size="md" class="mr-2" />
            <span class="text-sm font-medium">{{ copySuccess ? t("fileView.actions.copied") : t("fileView.actions.copyLink") }}</span>
          </button>

          <button
            @click="nativeShare"
            class="flex items-center justify-center px-4 py-3 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2"
            :class="[
              darkMode
                ? 'bg-purple-600 hover:bg-purple-700 text-white focus:ring-purple-500 focus:ring-offset-gray-800'
                : 'bg-purple-600 hover:bg-purple-700 text-white focus:ring-purple-500 focus:ring-offset-white',
            ]"
          >
            <IconShare size="md" class="mr-2" />
            <span class="text-sm font-medium">{{ t("fileView.actions.nativeShare") }}</span>
          </button>
        </div>

        <!-- 社交平台分享 -->
        <div>
          <h4 class="text-sm font-medium mb-3" :class="darkMode ? 'text-gray-100' : 'text-gray-700'">
            {{ t("fileView.actions.shareToSocial") }}
          </h4>
          <div class="grid grid-cols-5 gap-3">
            <button
              v-for="platform in socialPlatforms"
              :key="platform.key"
              @click="shareToSocial(platform)"
              class="flex flex-col items-center p-3 rounded-lg transition-colors hover:bg-opacity-80 text-white"
              :class="platform.bgClass"
              :title="platform.name"
            >
              <component :is="platform.icon" size="lg" class="mb-1" />
              <span class="text-xs font-medium">{{ platform.name }}</span>
            </button>
          </div>
        </div>

        <!-- 二维码 -->
        <div>
          <button
            @click="toggleQRCode"
            class="flex items-center justify-between w-full p-3 rounded-lg transition-colors"
            :class="darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'"
          >
            <div class="flex items-center">
              <div class="h-6 w-6 mr-3 text-green-500">
                <IconQrCode size="lg" />
              </div>
              <span class="text-sm font-medium" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">
                {{ t("fileView.actions.qrCode") }}
              </span>
            </div>
            <IconChevronDown
              size="md"
              class="transition-transform"
              :class="[showQRCode ? 'rotate-180' : '', darkMode ? 'text-gray-400' : 'text-gray-500']"
            />
          </button>

          <!-- 二维码区域 -->
          <div v-if="showQRCode" class="mt-3 p-4 rounded-lg text-center" :class="darkMode ? 'bg-gray-700/50' : 'bg-gray-50'">
            <div v-if="qrCodeDataURL" class="inline-block p-3 bg-white rounded-lg">
              <img :src="qrCodeDataURL" alt="QR Code" class="w-32 h-32" />
            </div>
            <div v-else-if="qrCodeError" class="w-32 h-32 mx-auto rounded-lg flex items-center justify-center" :class="darkMode ? 'bg-red-900/20' : 'bg-red-50'">
              <span class="text-sm text-red-500">{{ t("fileView.actions.qrCodeError") }}</span>
            </div>
            <div v-else class="w-32 h-32 mx-auto rounded-lg flex items-center justify-center" :class="darkMode ? 'bg-gray-600' : 'bg-gray-200'">
              <span class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ t("fileView.actions.generating") }}</span>
            </div>
            <p v-if="!qrCodeError" class="text-xs mt-2" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("fileView.actions.scanToShare") }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { onKeyStroke } from "@vueuse/core";
import { copyToClipboard } from "@/utils/clipboard";
import { formatFileSize } from "@/utils/fileUtils";
import { generateQRCode as createQRCodeImage } from "@/utils/qrcodeUtils.js";
import { IconChevronDown, IconClose, IconCopy, IconDocumentText, IconFacebook, IconQQ, IconQrCode, IconShare, IconTelegram, IconTwitter, IconWeibo } from "@/components/icons";
import { createLogger } from "@/utils/logger.js";

// 社交平台配置常量
const SOCIAL_PLATFORMS = [
  {
    key: "weibo",
    name: "Weibo",
    bgClass: "bg-red-500 hover:bg-red-600",
    icon: IconWeibo,
    url: "https://service.weibo.com/share/share.php?url={url}&title={title}",
  },
  {
    key: "qq",
    name: "QQ",
    bgClass: "bg-blue-500 hover:bg-blue-600",
    icon: IconQQ,
    url: "https://connect.qq.com/widget/shareqq/index.html?url={url}&title={title}&desc={text}&summary={title}",
  },
  {
    key: "twitter",
    name: "X",
    bgClass: "bg-black hover:bg-gray-800",
    icon: IconTwitter,
    url: "https://twitter.com/intent/tweet?url={url}&text={text}",
  },
  {
    key: "telegram",
    name: "Telegram",
    bgClass: "bg-blue-400 hover:bg-blue-500",
    icon: IconTelegram,
    url: "https://t.me/share/url?url={url}&text={text}",
  },
  {
    key: "facebook",
    name: "Facebook",
    bgClass: "bg-blue-600 hover:bg-blue-700",
    icon: IconFacebook,
    url: "https://www.facebook.com/sharer/sharer.php?u={url}",
  },
];

export default {
  name: "ShareModal",
  components: {
    IconChevronDown,
    IconClose,
    IconCopy,
    IconDocumentText,
    IconFacebook,
    IconQQ,
    IconQrCode,
    IconShare,
    IconTelegram,
    IconTwitter,
    IconWeibo,
  },
  props: {
    visible: {
      type: Boolean,
      default: false,
    },
    fileInfo: {
      type: Object,
      required: true,
    },
    darkMode: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["close"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const log = createLogger("ShareModal");

    const showQRCode = ref(false);
    const qrCodeDataURL = ref("");
    const copySuccess = ref(false);
    const qrCodeError = ref(false);

    // 使用外部社交平台配置常量
    const socialPlatforms = ref(SOCIAL_PLATFORMS);

    // 获取分享文本
    const getShareText = () => {
      return t("fileView.actions.shareFileText", { filename: props.fileInfo.filename });
    };

    // 复制链接
    const copyLink = async () => {
      try {
        const success = await copyToClipboard(window.location.href);
        if (success) {
          copySuccess.value = true;
          // 2秒后重置状态
          setTimeout(() => {
            copySuccess.value = false;
          }, 2000);
        }
      } catch (error) {
        log.error("Failed to copy link:", error);
      }
    };

    // 原生分享
    const nativeShare = async () => {
      if (navigator.share) {
        try {
          await navigator.share({
            title: props.fileInfo.filename,
            text: getShareText(),
            url: window.location.href,
          });
        } catch (error) {
          if (error.name !== "AbortError") {
            log.error("Native share failed:", error);
            // 回退到复制链接
            await copyLink();
          }
        }
      } else {
        // 不支持原生分享，回退到复制链接
        await copyLink();
      }
    };

    // 分享到社交平台
    const shareToSocial = (platform) => {
      // 构建分享URL，替换占位符
      const shareUrl = platform.url
        .replace("{url}", encodeURIComponent(window.location.href))
        .replace("{title}", encodeURIComponent(props.fileInfo.filename))
        .replace("{text}", encodeURIComponent(getShareText()));

      window.open(shareUrl, "_blank", "width=600,height=400");
    };

    // 切换二维码显示
    const toggleQRCode = async () => {
      showQRCode.value = !showQRCode.value;

      if (showQRCode.value && !qrCodeDataURL.value && !qrCodeError.value) {
        try {
          qrCodeDataURL.value = await createQRCodeImage(window.location.href, { width: 128, margin: 1 });
          qrCodeError.value = false;
        } catch (error) {
          log.error("Failed to generate QR code:", error);
          qrCodeError.value = true;
        }
      }
    };

    // 关闭模态框
    const closeModal = () => {
      emit("close");
    };

    // 监听 ESC 键关闭
    onKeyStroke("Escape", () => {
      if (props.visible) {
        closeModal();
      }
    });

    // 点击外部关闭 - 更健壮的检测方式
    const handleClickOutside = (event) => {
      // 检查点击的是否是背景遮罩层（最外层div）
      if (event.target === event.currentTarget) {
        closeModal();
      }
    };

    // 监听键盘和点击事件
    watch(
      () => props.visible,
      (newVal) => {
        if (!newVal) {
          // 重置二维码相关状态
          showQRCode.value = false;
          qrCodeDataURL.value = "";
          qrCodeError.value = false;
        }
      }
    );

    return {
      t,
      showQRCode,
      qrCodeDataURL,
      qrCodeError,
      copySuccess,
      socialPlatforms,
      formatFileSize,
      copyLink,
      nativeShare,
      shareToSocial,
      toggleQRCode,
      closeModal,
    };
  },
};
</script>
