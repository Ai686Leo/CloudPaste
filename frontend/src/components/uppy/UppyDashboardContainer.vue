<!-- UppyDashboardContainer.vue - Uppy Dashboard容器组件 -->
<template>
  <div class="uppy-container mb-4">
    <div ref="container" :id="containerId" class="min-h-[300px]"></div>

    <!-- 提示信息区域 -->
    <div class="mt-2 text-center">
      <div class="flex items-center justify-center gap-3 flex-wrap">
        <!-- 粘贴提示 -->
        <span v-if="showPasteHint" class="text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
          {{ pasteHintPrefix }}
          <kbd
            class="px-1 py-0.5 text-xs font-mono rounded"
            :class="darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'"
          >
            {{ pasteKey }}
          </kbd>
          {{ pasteHintSuffix }}
        </span>

        <!-- 分隔符 -->
        <span v-if="showPasteHint && maxFileSizeHint" class="text-xs" :class="darkMode ? 'text-gray-600' : 'text-gray-300'">•</span>

        <!-- 最大文件大小提示 -->
        <span v-if="maxFileSizeHint" class="text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
          {{ maxFileSizeHint }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const props = defineProps({
  /**
   * Dashboard DOM ID
   */
  containerId: {
    type: String,
    required: true,
  },
  /**
   * 暗色模式
   */
  darkMode: {
    type: Boolean,
    default: false,
  },
  /**
   * 显示粘贴提示
   */
  showPasteHint: {
    type: Boolean,
    default: true,
  },
  /**
   * 粘贴提示前缀
   */
  pasteHintPrefix: {
    type: String,
    default: '支持',
  },
  /**
   * 粘贴快捷键
   */
  pasteKey: {
    type: String,
    default: 'Ctrl+V',
  },
  /**
   * 粘贴提示后缀
   */
  pasteHintSuffix: {
    type: String,
    default: '粘贴上传',
  },
  /**
   * 最大文件大小提示文本
   */
  maxFileSizeHint: {
    type: String,
    default: '',
  },
});

const container = ref(null);

defineExpose({ container });
</script>
