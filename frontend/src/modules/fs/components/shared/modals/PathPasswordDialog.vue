<template>
  <!-- 路径密码验证弹窗/内嵌框 -->
  <InputDialog
    :is-open="isOpen"
    :title="title"
    :description="description"
    :label="label"
    :placeholder="placeholder"
    input-type="password"
    :confirm-text="confirmText"
    :cancel-text="cancelText"
    :dark-mode="darkMode"
    :loading="isVerifying"
    :loading-text="loadingText"
    :allow-backdrop-close="false"
    :inline="inline"
    confirm-type="primary"
    @confirm="handleConfirm"
    @cancel="handleCancel"
    @close="handleClose"
  />
</template>

<script setup>
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import InputDialog from "@/components/common/dialogs/InputDialog.vue";
import { verifyFsMetaPassword } from "@/api/services/fsMetaService.js";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();
const log = createLogger("PathPasswordDialog");

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  path: {
    type: String,
    required: true,
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  inline: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["verified", "cancel", "close", "error"]);

// 响应式状态
const isVerifying = ref(false);

// 国际化文本
const title = computed(() => t("mount.pathPassword.title"));
const description = computed(() => t("mount.pathPassword.description", { path: props.path }));
const label = computed(() => t("mount.pathPassword.label"));
const placeholder = computed(() => t("mount.pathPassword.placeholder"));
const confirmText = computed(() => t("mount.pathPassword.verify"));
const cancelText = computed(() => (props.inline ? t("mount.pathPassword.back") : t("mount.pathPassword.cancel")));
const loadingText = computed(() => t("mount.pathPassword.verifying"));

/**
 * 处理密码确认
 */
const handleConfirm = async (password) => {
  if (!password || isVerifying.value) return;

  isVerifying.value = true;

  try {
    const result = await verifyFsMetaPassword(props.path, password);

    if (result && result.verified) {
      // 密码验证成功，返回 token
      emit("verified", {
        path: result.path || props.path,
        token: result.token || null,
        message: result.message || t("mount.pathPassword.verified"),
      });
    } else {
      // 验证失败（正常情况下应由 403 分支返回）
      emit("error", {
        message: (result && result.message) || t("mount.pathPassword.incorrectPassword"),
      });
    }
  } catch (error) {
    log.error("密码验证失败:", error);

    // 如果是 401 错误，说明密码错误
    if (error.status === 401) {
      emit("error", {
        message: t("mount.pathPassword.incorrectPassword"),
      });
    } else {
      emit("error", {
        message: error.message || t("mount.pathPassword.verifyFailed"),
      });
    }
  } finally {
    isVerifying.value = false;
  }
};

/**
 * 处理取消
 */
const handleCancel = () => {
  emit("cancel");
  emit("close");
};

/**
 * 处理关闭
 */
const handleClose = () => {
  emit("close");
};
</script>
