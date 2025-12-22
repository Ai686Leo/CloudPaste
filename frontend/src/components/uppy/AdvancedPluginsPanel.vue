<!-- AdvancedPluginsPanel.vue - 高级插件面板组件 -->
<template>
  <div class="mb-4">
    <button
      @click="showAdvanced = !showAdvanced"
      class="flex items-center justify-between w-full p-3 text-left rounded-lg transition-colors"
      :class="darkMode ? 'bg-gray-700/50 hover:bg-gray-700/70' : 'bg-gray-100 hover:bg-gray-200'"
    >
      <span class="text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
        {{ title }}
        <span
          v-if="enabledCount > 0"
          class="ml-2 px-2 py-0.5 text-xs rounded-full"
          :class="darkMode ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-700'"
        >
          {{ enabledCountText }}
        </span>
      </span>
      <IconChevronDown
        size="sm"
        class="transition-transform duration-200"
        :class="[showAdvanced ? 'rotate-180' : '', darkMode ? 'text-gray-400' : 'text-gray-500']"
      />
    </button>

    <!-- 可折叠的插件选项 -->
    <div
      v-show="showAdvanced"
      class="mt-2 p-3 rounded border-l-2"
      :class="darkMode ? 'bg-gray-800/30 border-gray-600' : 'bg-gray-50 border-gray-300'"
    >
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <label
          v-for="plugin in plugins"
          :key="plugin.key"
          class="flex items-center cursor-pointer"
        >
          <input
            type="checkbox"
            :checked="plugin.enabled"
            @change="$emit('toggle-plugin', plugin.key)"
            class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded dark:bg-gray-700 dark:border-gray-600"
          />
          <span class="ml-2 text-sm" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
            {{ plugin.label }}
          </span>
        </label>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { IconChevronDown } from '@/components/icons';

const props = defineProps({
  /**
   * 插件列表
   */
  plugins: {
    type: Array,
    required: true,
    validator: (plugins) => plugins.every(p => p.key && p.label !== undefined),
  },
  /**
   * 启用的插件数量
   */
  enabledCount: {
    type: Number,
    required: true,
  },
  /**
   * 标题文本
   */
  title: {
    type: String,
    default: '高级功能',
  },
  /**
   * 启用数量文本模板 (使用 {count} 占位符)
   */
  enabledCountTemplate: {
    type: String,
    default: '已启用 {count} 个',
  },
  /**
   * 暗色模式
   */
  darkMode: {
    type: Boolean,
    default: false,
  },
});

defineEmits(['toggle-plugin']);

const showAdvanced = ref(false);

// 启用数量文本
const enabledCountText = computed(() => {
  return props.enabledCountTemplate.replace('{count}', props.enabledCount);
});
</script>
