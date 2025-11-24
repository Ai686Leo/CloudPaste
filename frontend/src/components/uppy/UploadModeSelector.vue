<!-- UploadModeSelector.vue - 上传模式选择器组件 -->
<template>
  <div class="mb-4 p-3 rounded-lg" :class="darkMode ? 'bg-gray-700/50' : 'bg-gray-100'">
    <!-- 标题和当前模式指示器 -->
    <div class="flex items-center justify-between mb-3">
      <span class="text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
        {{ title }}
      </span>
      <span
        class="text-xs px-2 py-1 rounded-full cursor-help"
        :class="currentModeClass"
        :title="currentModeTooltip"
      >
        {{ currentModeLabel }}
      </span>
    </div>

    <!-- 模式选项 -->
    <div class="flex flex-col sm:flex-row sm:space-x-4 space-y-2 sm:space-y-0">
      <label
        v-for="mode in modes"
        :key="mode.value"
        class="flex items-center cursor-pointer"
        :class="mode.disabled || disabled ? 'opacity-50 cursor-not-allowed' : ''"
      >
        <input
          type="radio"
          :name="name"
          :value="mode.value"
          :checked="modelValue === mode.value"
          :disabled="mode.disabled || disabled"
          class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 dark:bg-gray-700 dark:border-gray-600 flex-shrink-0"
          @change="$emit('update:modelValue', mode.value)"
        />
        <div class="ml-2 flex items-center flex-wrap gap-1">
          <span class="text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-600'">
            {{ mode.label }}
          </span>
          <span
            v-if="mode.badge"
            class="text-xs px-1 py-0.5 rounded flex-shrink-0"
            :class="darkMode ? 'bg-green-900/50 text-green-300' : 'bg-green-100 text-green-700'"
          >
            {{ mode.badge }}
          </span>
          <span
            v-if="mode.disabled && mode.disabledHint"
            class="text-xs"
            :class="darkMode ? 'text-gray-500' : 'text-gray-400'"
          >
            {{ mode.disabledHint }}
          </span>
        </div>
      </label>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  /**
   * 上传模式列表
   */
  modes: {
    type: Array,
    required: true,
    validator: (modes) => modes.every(m => m.value && m.label),
  },
  /**
   * 当前选中的模式值 (v-model)
   */
  modelValue: {
    type: String,
    required: true,
  },
  /**
   * 标题文本
   */
  title: {
    type: String,
    default: '上传方式',
  },
  /**
   * 表单字段名
   */
  name: {
    type: String,
    default: 'uploadMode',
  },
  /**
   * 暗色模式
   */
  darkMode: {
    type: Boolean,
    default: false,
  },
  /**
   * 是否禁用所有选项
   */
  disabled: {
    type: Boolean,
    default: false,
  },
});

defineEmits(['update:modelValue']);

// 当前选中的模式对象
const currentMode = computed(() => {
  return props.modes.find(m => m.value === props.modelValue) || props.modes[0];
});

// 当前模式标签
const currentModeLabel = computed(() => currentMode.value?.modeLabel || currentMode.value?.label);

// 当前模式提示
const currentModeTooltip = computed(() => currentMode.value?.tooltip || '');

// 当前模式样式类
const currentModeClass = computed(() => {
  const mode = currentMode.value;
  if (!mode) return '';

  // 支持自定义样式类
  if (mode.badgeClass) return mode.badgeClass;

  // 默认样式：presigned 绿色，stream/form 蓝色，其它（如 multipart）琥珀色
  if (mode.value === 'presigned') {
    return props.darkMode
      ? 'bg-green-900/30 text-green-300'
      : 'bg-green-100 text-green-700';
  } else if (mode.value === 'stream' || mode.value === 'form') {
    return props.darkMode
      ? 'bg-blue-900/30 text-blue-300'
      : 'bg-blue-100 text-blue-700';
  } else {
    return props.darkMode
      ? 'bg-amber-900/30 text-amber-300'
      : 'bg-amber-100 text-amber-700';
  }
});
</script>
