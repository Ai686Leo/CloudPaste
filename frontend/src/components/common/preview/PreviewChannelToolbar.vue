<template>
  <div class="preview-channel-toolbar p-3 mb-4 rounded-lg bg-opacity-50" :class="darkMode ? 'bg-gray-700/50' : 'bg-gray-100'">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <!-- 左侧：标题 + 可选扩展内容 -->
      <div class="toolbar-left flex flex-wrap items-center gap-3">
        <span class="font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">{{ title }}</span>
        <slot name="left" />
      </div>

      <!-- 右侧：渠道选择 + 全屏 -->
      <div class="toolbar-right flex flex-wrap items-center gap-2">
        <select
          v-if="providerOptions.length > 1"
          :value="modelValue"
          class="px-3 py-1 text-sm border rounded"
          :class="darkMode ? 'bg-gray-600 border-gray-500 text-gray-200' : 'bg-white border-gray-300 text-gray-700'"
          @change="handleProviderChange"
        >
          <option v-for="opt in providerOptions" :key="opt.key" :value="opt.key">
            {{ opt.label }}
          </option>
        </select>

        <slot name="right" />

        <button
          v-if="showFullscreen"
          type="button"
          class="fullscreen-btn flex items-center px-3 py-1 text-sm border rounded transition-colors"
          :class="darkMode ? 'bg-gray-600 hover:bg-gray-700 border-gray-500 text-gray-200' : 'bg-white hover:bg-gray-50 border-gray-300 text-gray-700'"
          :title="isFullscreen ? fullscreenExitTitle : fullscreenEnterTitle"
          @click="$emit('toggle-fullscreen')"
        >
          <IconExpand v-if="!isFullscreen" size="sm" aria-hidden="true" />
          <IconCollapse v-else size="sm" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { IconCollapse, IconExpand } from "@/components/icons";

defineProps({
  /** 工具栏标题（可选，为空时不显示） */
  title: {
    type: String,
    default: "",
  },
  /** 暗色模式 */
  darkMode: {
    type: Boolean,
    default: false,
  },
  /** 渠道选项数组，格式：[{ key: string, label: string, url?: string }] */
  providerOptions: {
    type: Array,
    default: () => [],
  },
  /** 当前选中的渠道 key（v-model） */
  modelValue: {
    type: String,
    default: "",
  },
  /** 是否显示全屏按钮 */
  showFullscreen: {
    type: Boolean,
    default: true,
  },
  /** 当前是否处于全屏状态 */
  isFullscreen: {
    type: Boolean,
    default: false,
  },
  /** 进入全屏按钮的 title */
  fullscreenEnterTitle: {
    type: String,
    default: "全屏",
  },
  /** 退出全屏按钮的 title */
  fullscreenExitTitle: {
    type: String,
    default: "退出全屏",
  },
});

const emit = defineEmits(["update:modelValue", "toggle-fullscreen"]);

const handleProviderChange = (e) => {
  const value = String(e?.target?.value || "");
  emit("update:modelValue", value);
};
</script>
