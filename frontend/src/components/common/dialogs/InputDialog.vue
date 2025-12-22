<template>
  <!-- 基于 ConfirmDialog 设计的输入对话框组件，支持 modal 和 inline 两种模式 -->
  <!-- Modal 模式 -->
  <div v-if="isOpen && !inline" class="fixed inset-0 z-[70] overflow-auto bg-black bg-opacity-50 flex items-center justify-center" @click="handleBackdropClick">
    <div class="relative w-full max-w-md p-6 rounded-lg shadow-xl" :class="darkMode ? 'bg-gray-800' : 'bg-white'" @click.stop>
      <!-- 标题和描述 -->
      <div class="mb-4">
        <h3 class="text-lg font-semibold" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">
          {{ title }}
        </h3>
        <p v-if="description" class="text-sm mt-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ description }}
        </p>
      </div>

      <!-- 输入区域 -->
      <div class="mb-4">
        <label v-if="label" :for="inputId" class="block text-sm font-medium mb-1" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
          {{ label }}
        </label>
        <input
          :id="inputId"
          ref="inputRef"
          v-model="inputValue"
          :type="inputType"
          class="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
          :class="[darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300', hasError ? 'border-red-500 focus:ring-red-500' : '']"
          :placeholder="placeholder"
          :disabled="loading"
          @keyup.enter="handleConfirm"
          @keyup.escape="handleCancel"
        />
        <!-- 错误提示 -->
        <p v-if="hasError" class="text-sm mt-1 text-red-500">
          {{ errorMessage }}
        </p>
      </div>

      <!-- 按钮组 -->
      <div class="flex justify-end space-x-2">
        <button
          @click="handleCancel"
          :disabled="loading"
          class="px-4 py-2 rounded-md transition-colors"
          :class="[darkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-100', loading ? 'opacity-50 cursor-not-allowed' : '']"
        >
          {{ displayCancelText }}
        </button>
        <button
          @click="handleConfirm"
          :disabled="loading || !canConfirm"
          class="px-4 py-2 rounded-md text-white transition-colors flex items-center space-x-2"
          :class="confirmButtonClass"
        >
          <!-- 加载状态图标 -->
          <IconRefresh v-if="loading" class="animate-spin h-4 w-4" aria-hidden="true" />
          <span>{{ loading ? displayLoadingText : displayConfirmText }}</span>
        </button>
      </div>
    </div>
  </div>

  <!-- Inline 模式 -->
  <div v-else-if="isOpen && inline" class="py-12 px-6">
    <div class="flex flex-col items-center max-w-sm mx-auto">
      <!-- 图标 -->
      <div class="w-20 h-20 rounded-full flex items-center justify-center mb-6" :class="darkMode ? 'bg-gray-700' : 'bg-gray-100'">
        <IconLockClosed size="xl" :class="darkMode ? 'text-gray-400' : 'text-gray-500'" />
      </div>

      <!-- 标题和描述 -->
      <div class="text-center mb-8">
        <h3 class="text-lg font-semibold mb-1.5" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">
          {{ title }}
        </h3>
        <p v-if="description" class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
          {{ description }}
        </p>
      </div>

      <!-- 输入区域 -->
      <div class="w-full mb-6">
        <div class="relative">
          <input
            :id="inputId"
            ref="inputRef"
            v-model="inputValue"
            :type="showPasswordValue ? 'text' : inputType"
            class="w-full px-4 py-2.5 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors"
            :class="[
              darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-500' : 'bg-white border-gray-300 placeholder-gray-400',
              hasError ? 'border-red-500 focus:ring-red-500' : '',
              inputType === 'password' ? 'pr-10' : '',
            ]"
            :placeholder="placeholder"
            :disabled="loading"
            @keyup.enter="handleConfirm"
            @keyup.escape="handleCancel"
          />
          <!-- 显示/隐藏密码按钮 -->
          <button
            v-if="inputType === 'password'"
            type="button"
            @click="showPasswordValue = !showPasswordValue"
            class="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
            :class="darkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700'"
            tabindex="-1"
          >
            <IconEye v-if="!showPasswordValue" />
            <IconEyeOff v-else />
          </button>
        </div>
        <!-- 错误提示 -->
        <p v-if="hasError" class="text-sm mt-2 text-red-500 flex items-center justify-center gap-1">
          <IconExclamationSolid size="sm" />
          <span>{{ errorMessage }}</span>
        </p>
      </div>

      <!-- 按钮组 -->
      <div class="flex w-full gap-2">
        <button
          @click="handleCancel"
          :disabled="loading"
          class="flex-1 px-4 py-2 rounded-md border transition-colors flex items-center justify-center gap-1.5 text-sm font-medium"
          :class="[darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50', loading ? 'opacity-50 cursor-not-allowed' : '']"
        >
          <IconBack size="sm" />
          <span>{{ displayCancelText }}</span>
        </button>
        <button
          @click="handleConfirm"
          :disabled="loading || !canConfirm"
          class="flex-1 px-4 py-2 rounded-md text-white transition-colors flex items-center justify-center gap-1.5 text-sm font-medium"
          :class="confirmButtonClass"
        >
          <!-- 加载状态图标 -->
          <IconRefresh v-if="loading" class="animate-spin h-4 w-4" aria-hidden="true" />
          <span>{{ loading ? displayLoadingText : displayConfirmText }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { IconBack, IconExclamationSolid, IconEye, IconEyeOff, IconLockClosed, IconRefresh } from "@/components/icons";

// 国际化
const { t } = useI18n();

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: "",
  },
  label: {
    type: String,
    default: "",
  },
  placeholder: {
    type: String,
    default: "",
  },
  initialValue: {
    type: String,
    default: "",
  },
  inputType: {
    type: String,
    default: "text",
    validator: (value) => ["text", "password", "email", "number"].includes(value),
  },
  confirmText: {
    type: String,
    default: "",
  },
  cancelText: {
    type: String,
    default: "",
  },
  confirmType: {
    type: String,
    default: "primary",
    validator: (value) => ["primary", "danger", "warning"].includes(value),
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  loadingText: {
    type: String,
    default: "",
  },
  required: {
    type: Boolean,
    default: true,
  },
  validator: {
    type: Function,
    default: null,
  },
  allowBackdropClose: {
    type: Boolean,
    default: true,
  },
  inline: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["confirm", "cancel", "close"]);

// 响应式数据
const inputRef = ref(null);
const inputValue = ref("");
const errorMessage = ref("");
const showPasswordValue = ref(false);

// 生成唯一的输入框ID
const inputId = computed(() => `input-dialog-${Math.random().toString(36).substring(2, 11)}`);

// 验证状态
const hasError = computed(() => !!errorMessage.value);

const canConfirm = computed(() => {
  if (props.loading) return false;
  if (props.required && !inputValue.value.trim()) return false;
  if (hasError.value) return false;
  return true;
});

// 国际化文本计算属性
const displayConfirmText = computed(() => {
  return props.confirmText || t("common.dialogs.confirm");
});

const displayCancelText = computed(() => {
  return props.cancelText || t("common.dialogs.cancel");
});

const displayLoadingText = computed(() => {
  return props.loadingText || t("common.dialogs.processing");
});

// 确认按钮样式
const confirmButtonClass = computed(() => {
  const baseClass = "transition-colors";
  const disabledClass = props.loading || !canConfirm.value ? "cursor-not-allowed opacity-50" : "";

  switch (props.confirmType) {
    case "danger":
      return `${baseClass} ${props.loading || !canConfirm.value ? "bg-red-500" : "bg-red-600 hover:bg-red-700"} ${disabledClass}`;
    case "warning":
      return `${baseClass} ${props.loading || !canConfirm.value ? "bg-yellow-500" : "bg-yellow-600 hover:bg-yellow-700"} ${disabledClass}`;
    case "primary":
    default:
      return `${baseClass} ${
        props.loading || !canConfirm.value ? "bg-primary-500" : props.darkMode ? "bg-primary-600 hover:bg-primary-700" : "bg-primary-500 hover:bg-primary-600"
      } ${disabledClass}`;
  }
});

// 验证输入值
const validateInput = () => {
  errorMessage.value = "";

  if (props.required && !inputValue.value.trim()) {
    errorMessage.value = t("common.dialogs.requiredField");
    return false;
  }

  if (props.validator && typeof props.validator === "function") {
    const validationResult = props.validator(inputValue.value);
    if (validationResult !== true) {
      errorMessage.value = validationResult || t("common.dialogs.invalidInput");
      return false;
    }
  }

  return true;
};

// 事件处理
const handleConfirm = () => {
  if (props.loading || !canConfirm.value) return;

  if (validateInput()) {
    emit("confirm", inputValue.value.trim());
  }
};

const handleCancel = () => {
  if (props.loading) return;
  emit("cancel");
  emit("close");
};

const handleBackdropClick = () => {
  if (props.allowBackdropClose && !props.loading) {
    handleCancel();
  }
};

// 键盘事件处理
const handleKeydown = (event) => {
  if (!props.isOpen || props.loading) return;

  if (event.key === "Escape") {
    handleCancel();
  }
};

// 监听对话框打开状态
watch(
  () => props.isOpen,
  (newValue) => {
    if (newValue) {
      // 重置输入值和错误状态
      inputValue.value = props.initialValue;
      errorMessage.value = "";

      // 聚焦输入框
      nextTick(() => {
        if (inputRef.value) {
          inputRef.value.focus();
          // 如果有初始值，选中所有文本
          if (props.initialValue) {
            inputRef.value.select();
          }
        }
      });
    }
  }
);

// 监听输入值变化，实时验证
watch(inputValue, () => {
  if (hasError.value) {
    validateInput();
  }
});

// 生命周期
onMounted(() => {
  document.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener("keydown", handleKeydown);
});
</script>
