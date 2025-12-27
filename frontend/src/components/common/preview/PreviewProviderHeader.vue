<template>
  <div v-if="show" class="office-header">
    <span class="office-type-label">{{ title }}</span>
    <div class="office-header-actions">
      <select v-if="showSelect" :value="modelValue" class="office-provider-select" @change="handleChange">
        <option v-for="opt in options" :key="opt.key" :value="opt.key">
          {{ opt.label }}
        </option>
      </select>
      <slot name="actions" />
      <!-- 内置全屏按钮 -->
      <button
        v-if="showFullscreen"
        type="button"
        class="fullscreen-btn"
        @click="handleToggleFullscreen"
        :title="isFullscreen ? t('fileView.preview.exitFullscreen') : t('fileView.preview.fullscreen')"
      >
        <IconExpand v-if="!isFullscreen" size="sm" class="w-4 h-4" />
        <IconCollapse v-else size="sm" class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>

<script setup>
import { watch } from "vue";
import { useI18n } from "vue-i18n";
import { IconExpand, IconCollapse } from "@/components/icons";
import { useElementFullscreen } from "@/composables/useElementFullscreen.js";

const { t } = useI18n();

const props = defineProps({
  title: {
    type: String,
    default: "",
  },
  options: {
    type: Array,
    default: () => [],
  },
  modelValue: {
    type: String,
    default: "",
  },
  show: {
    type: Boolean,
    default: true,
  },
  showSelect: {
    type: Boolean,
    default: true,
  },
  /** 是否显示全屏按钮 */
  showFullscreen: {
    type: Boolean,
    default: false,
  },
  /** 全屏目标元素的 ref（由父组件传入） */
  fullscreenTarget: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(["update:modelValue", "change", "fullscreen-change"]);

const handleChange = (e) => {
  const value = String(e?.target?.value || "");
  emit("update:modelValue", value);
  emit("change", value);
};

// 使用 useElementFullscreen composable，将 target 传入
const { isFullscreen, toggleFullscreen } = useElementFullscreen(() => props.fullscreenTarget);

const handleToggleFullscreen = async () => {
  await toggleFullscreen();
  emit("fullscreen-change", isFullscreen.value);
};

// 监听 isFullscreen 变化，通知父组件
watch(isFullscreen, (val) => {
  emit("fullscreen-change", val);
});
</script>

<style scoped>
.office-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  background-color: #f3f4f6;
  border-bottom: 1px solid #e5e7eb;
}

.office-type-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #374151;
  min-width: 0;
  max-width: 70%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.office-header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.office-provider-select {
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  border: 1px solid #d1d5db;
  background-color: #ffffff;
  color: #374151;
}

.fullscreen-btn {
  display: flex;
  align-items: center;
  padding: 0.25rem 0.5rem;
  font-size: 0.875rem;
  border-radius: 0.25rem;
  border: 1px solid #d1d5db;
  background-color: #ffffff;
  color: #374151;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
}

.fullscreen-btn:hover {
  background-color: #f9fafb;
  border-color: #9ca3af;
}

.dark .office-header {
  background-color: #374151;
  border-bottom-color: #4b5563;
}

.dark .office-type-label {
  color: #e5e7eb;
}

.dark .office-provider-select {
  background-color: #1f2937;
  border-color: #4b5563;
  color: #e5e7eb;
}

.dark .fullscreen-btn {
  background-color: #4b5563;
  border-color: #6b7280;
  color: #e5e7eb;
}

.dark .fullscreen-btn:hover {
  background-color: #6b7280;
  border-color: #9ca3af;
}
</style>
