<template>
  <div class="relative">
    <div class="relative">
      <!-- 搜索图标 -->
      <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <IconSearch size="sm" class="text-gray-400 dark:text-gray-500" />
      </div>

      <!-- 搜索输入框 -->
      <input
        :value="modelValue"
        @input="handleInput"
        type="text"
        :placeholder="placeholder"
        :class="[
          'block w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-md leading-5 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:focus:ring-primary-400 dark:focus:border-primary-400 transition-colors duration-200',
          sizeClass,
        ]"
      />

      <!-- 清除按钮 -->
      <div v-if="modelValue" class="absolute inset-y-0 right-0 pr-3 flex items-center">
        <button
          @click="clearSearch"
          type="button"
          class="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none focus:text-gray-600 dark:focus:text-gray-300 transition-colors duration-200"
          :title="clearButtonTitle"
        >
          <IconClose size="sm" />
        </button>
      </div>
    </div>

    <!-- 搜索提示信息 -->
    <div v-if="showHint && modelValue" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
      {{ searchHint }}
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { IconClose, IconSearch } from "@/components/icons";

const props = defineProps({
  modelValue: {
    type: String,
    default: "",
  },
  placeholder: {
    type: String,
    default: "搜索...",
  },
  size: {
    type: String,
    default: "md", // sm, md, lg
    validator: (value) => ["sm", "md", "lg"].includes(value),
  },
  showHint: {
    type: Boolean,
    default: false,
  },
  searchHint: {
    type: String,
    default: "支持搜索文件名、内容等",
  },
  clearButtonTitle: {
    type: String,
    default: "清除搜索",
  },
  debounceMs: {
    type: Number,
    default: 300,
  },
  minSearchLength: {
    type: Number,
    default: 2,
  },
});

const emit = defineEmits(["update:modelValue", "search", "clear"]);

// 计算样式类
const sizeClass = computed(() => {
  const sizeMap = {
    sm: "text-sm py-1.5",
    md: "text-sm py-2",
    lg: "text-base py-2.5",
  };
  return sizeMap[props.size] || sizeMap.md;
});

// 防抖处理
let debounceTimer = null;

const handleInput = (event) => {
  const value = event.target.value;

  // 立即更新v-model
  emit("update:modelValue", value);

  // 防抖处理搜索事件
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    // 只有达到最小搜索长度或为空时才触发搜索
    if (value.length >= props.minSearchLength || value.length === 0) {
      emit("search", value);
    }
  }, props.debounceMs);
};

const clearSearch = () => {
  emit("update:modelValue", "");
  emit("search", "");
  emit("clear");

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
};
</script>
