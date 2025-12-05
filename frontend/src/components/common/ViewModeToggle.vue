<script setup>
/**
 * ViewModeToggle - 视图模式切换按钮组组件
 *
 * 统一的视图切换组件，用于在不同视图模式（表格/卡片/网格/列表/瀑布流）之间切换
 *
 * @example
 * <ViewModeToggle
 *   v-model="viewMode"
 *   :options="[
 *     { value: 'table', icon: 'table', titleKey: 'admin.tasks.viewMode.table' },
 *     { value: 'card', icon: 'card', titleKey: 'admin.tasks.viewMode.card' }
 *   ]"
 *   :dark-mode="isDarkMode"
 *   size="md"
 * />
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps({
  /**
   * 当前选中的视图模式值 (v-model)
   */
  modelValue: {
    type: String,
    required: true,
  },
  /**
   * 视图选项数组
   * @type {Array<{ value: string, icon: string, titleKey?: string, title?: string }>}
   */
  options: {
    type: Array,
    required: true,
    validator: (val) => val.length >= 2 && val.every((opt) => opt.value && opt.icon),
  },
  /**
   * 暗色模式
   */
  darkMode: {
    type: Boolean,
    default: false,
  },
  /**
   * 尺寸大小
   */
  size: {
    type: String,
    default: "md",
    validator: (val) => ["sm", "md"].includes(val),
  },
});

const emit = defineEmits(["update:modelValue"]);

const { t, te } = useI18n();

/**
 * 获取选项的 title 文本
 */
const getOptionTitle = (option) => {
  if (option.titleKey && te(option.titleKey)) {
    return t(option.titleKey);
  }
  return option.title || option.value;
};

/**
 * 尺寸配置
 */
const sizeConfig = computed(() => ({
  sm: {
    button: "px-2 py-1.5 text-xs",
    icon: "h-3.5 w-3.5",
  },
  md: {
    button: "px-3 py-2 text-sm",
    icon: "h-4 w-4",
  },
}));

/**
 * 当前尺寸的样式类
 */
const currentSize = computed(() => sizeConfig.value[props.size]);

/**
 * 获取按钮的边框类
 * - 第一个按钮：左圆角 + 全边框
 * - 中间按钮：无左边框（避免双边框）
 * - 最后一个按钮：右圆角 + 无左边框
 */
const getBorderClass = (index) => {
  const total = props.options.length;
  if (index === 0) {
    return "rounded-l-md border";
  } else if (index === total - 1) {
    return "rounded-r-md border-t border-r border-b";
  }
  return "border-t border-r border-b";
};

/**
 * 获取按钮的状态样式类
 */
const getStateClass = (isActive) => {
  if (isActive) {
    return "bg-primary-600 text-white border-primary-600 hover:bg-primary-700";
  }
  return props.darkMode
    ? "bg-gray-700 text-gray-300 border-gray-600 hover:bg-gray-600"
    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50";
};

/**
 * 获取完整的按钮类名
 */
const getButtonClass = (option, index) => {
  const isActive = props.modelValue === option.value;
  return [
    "inline-flex items-center justify-center font-medium",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset",
    "transition-colors duration-200",
    currentSize.value.button,
    getBorderClass(index),
    getStateClass(isActive),
  ];
};

/**
 * 处理选项点击
 */
const handleClick = (value) => {
  if (value !== props.modelValue) {
    emit("update:modelValue", value);
  }
};

/**
 * 图标路径映射
 */
const iconPaths = {
  // 表格视图 - 三条横线
  table: "M4 6h16M4 12h16M4 18h16",
  // 列表视图 - 四条横线
  list: "M4 6h16M4 10h16M4 14h16M4 18h16",
  // 卡片/网格/瀑布流视图 - 2x2 网格 (使用多个路径)
  card: null, // 使用特殊渲染
  grid: null,
  masonry: null,
};

/**
 * 判断是否为网格类图标
 */
const isGridIcon = (icon) => ["card", "grid", "masonry"].includes(icon);
</script>

<template>
  <div class="inline-flex rounded-md shadow-sm" role="group">
    <button
      v-for="(option, index) in options"
      :key="option.value"
      type="button"
      :class="getButtonClass(option, index)"
      :title="getOptionTitle(option)"
      @click="handleClick(option.value)"
    >
      <!-- 网格类图标 (card/grid/masonry) -->
      <svg
        v-if="isGridIcon(option.icon)"
        :class="currentSize.icon"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
        />
      </svg>
      <!-- 线条类图标 (table/list) -->
      <svg v-else :class="currentSize.icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          :d="iconPaths[option.icon] || iconPaths.table"
        />
      </svg>
    </button>
  </div>
</template>
