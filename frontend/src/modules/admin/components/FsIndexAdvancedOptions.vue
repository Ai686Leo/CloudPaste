<template>
  <div
    class="rounded-lg border shadow-sm overflow-hidden"
    :class="darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'"
  >
    <!-- 可折叠标题栏（非内联模式时显示） -->
    <button
      v-if="!inlineMode"
      @click="isExpanded = !isExpanded"
      class="w-full px-4 py-3 flex items-center justify-between transition-colors"
      :class="darkMode ? 'hover:bg-gray-700/50' : 'hover:bg-gray-50'"
    >
      <div class="flex items-center gap-2">
        <div
          class="w-8 h-8 rounded-md flex items-center justify-center"
          :class="darkMode ? 'bg-purple-900/30' : 'bg-purple-100'"
        >
          <IconSettings
            class="w-4 h-4"
            :class="darkMode ? 'text-purple-400' : 'text-purple-600'"
          />
        </div>
        <div class="text-left">
          <h3 class="text-sm font-semibold" :class="darkMode ? 'text-white' : 'text-gray-900'">
            {{ t("admin.fsIndex.advancedOptions.title") }}
          </h3>
          <p class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
            {{ t("admin.fsIndex.advancedOptions.description") }}
          </p>
        </div>
      </div>
      <IconChevronDown
        class="w-4 h-4 transition-transform duration-200"
        :class="[
          darkMode ? 'text-gray-400' : 'text-gray-500',
          { 'rotate-180': isExpanded }
        ]"
      />
    </button>

    <!-- 选项内容（可折叠或内联模式始终显示） -->
    <div
      v-show="inlineMode || isExpanded"
      class="px-4 pb-4 space-y-4"
      :class="inlineMode ? 'pt-4' : (darkMode ? 'border-t border-gray-700' : 'border-t border-gray-200')"
    >
      <!-- 重建选项 -->
      <div class="pt-4">
        <h4 class="text-xs font-medium mb-3 flex items-center gap-2" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
          <IconRebuild class="w-3.5 h-3.5" />
          {{ t("admin.fsIndex.advancedOptions.rebuildOptions") }}
        </h4>
        <div class="grid grid-cols-2 gap-3">
          <!-- 批量大小 -->
          <div>
            <label class="block text-xs mb-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.fsIndex.advancedOptions.batchSize") }}
            </label>
            <input
              v-model.number="rebuildOptions.batchSize"
              type="number"
              min="50"
              max="1000"
              step="50"
              class="w-full px-2 py-1.5 text-xs rounded border focus:outline-none focus:ring-1"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-gray-200 focus:ring-primary-500'
                : 'bg-white border-gray-300 text-gray-700 focus:ring-primary-500'"
            />
          </div>

          <!-- 最大深度 -->
          <div>
            <label class="block text-xs mb-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.fsIndex.advancedOptions.maxDepth") }}
            </label>
            <input
              v-model.number="rebuildOptions.maxDepth"
              type="number"
              min="1"
              max="100"
              :placeholder="t('admin.fsIndex.advancedOptions.unlimited')"
              class="w-full px-2 py-1.5 text-xs rounded border focus:outline-none focus:ring-1"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-500 focus:ring-primary-500'
                : 'bg-white border-gray-300 text-gray-700 placeholder-gray-400 focus:ring-primary-500'"
            />
          </div>

          <!-- 强制刷新 -->
          <div class="col-span-2 flex items-center gap-2">
            <input
              v-model="rebuildOptions.refresh"
              type="checkbox"
              id="rebuild-refresh"
              class="w-4 h-4 rounded border focus:ring-primary-500"
              :class="darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'"
            />
            <label
              for="rebuild-refresh"
              class="text-xs"
              :class="darkMode ? 'text-gray-300' : 'text-gray-600'"
            >
              {{ t("admin.fsIndex.advancedOptions.forceRefresh") }}
            </label>
          </div>
        </div>
      </div>

      <!-- 增量更新选项 -->
      <div class="pt-3 border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <h4 class="text-xs font-medium mb-3 flex items-center gap-2" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
          <IconUpdate class="w-3.5 h-3.5" />
          {{ t("admin.fsIndex.advancedOptions.applyDirtyOptions") }}
        </h4>
        <div class="grid grid-cols-2 gap-3">
          <!-- 批量大小 -->
          <div>
            <label class="block text-xs mb-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.fsIndex.advancedOptions.batchSize") }}
            </label>
            <input
              v-model.number="applyDirtyOptions.batchSize"
              type="number"
              min="50"
              max="1000"
              step="50"
              class="w-full px-2 py-1.5 text-xs rounded border focus:outline-none focus:ring-1"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-gray-200 focus:ring-primary-500'
                : 'bg-white border-gray-300 text-gray-700 focus:ring-primary-500'"
            />
          </div>

          <!-- 最大条目数 -->
          <div>
            <label class="block text-xs mb-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ t("admin.fsIndex.advancedOptions.maxItems") }}
            </label>
            <input
              v-model.number="applyDirtyOptions.maxItems"
              type="number"
              min="100"
              max="10000"
              step="100"
              :placeholder="t('admin.fsIndex.advancedOptions.unlimited')"
              class="w-full px-2 py-1.5 text-xs rounded border focus:outline-none focus:ring-1"
              :class="darkMode
                ? 'bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-500 focus:ring-primary-500'
                : 'bg-white border-gray-300 text-gray-700 placeholder-gray-400 focus:ring-primary-500'"
            />
          </div>

          <!-- 递归重建子树 -->
          <div class="col-span-2 flex items-center gap-2">
            <input
              v-model="applyDirtyOptions.rebuildDirectorySubtree"
              type="checkbox"
              id="rebuild-subtree"
              class="w-4 h-4 rounded border focus:ring-primary-500"
              :class="darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'"
            />
            <label
              for="rebuild-subtree"
              class="text-xs"
              :class="darkMode ? 'text-gray-300' : 'text-gray-600'"
            >
              {{ t("admin.fsIndex.advancedOptions.rebuildSubtree") }}
            </label>
          </div>
        </div>
      </div>

      <!-- 重置按钮 -->
      <div class="pt-3 flex justify-end">
        <button
          @click="resetToDefaults"
          class="px-3 py-1.5 text-xs rounded transition-colors"
          :class="darkMode
            ? 'text-gray-400 hover:bg-gray-700 hover:text-gray-300'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'"
        >
          {{ t("admin.fsIndex.advancedOptions.resetDefaults") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import {
  IconSettings,
  IconChevronDown,
  IconRebuild,
  IconUpdate,
} from "@/components/icons";

const { t } = useI18n();
const { isDarkMode: darkMode } = useThemeMode();

const props = defineProps({
  inlineMode: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["update:rebuildOptions", "update:applyDirtyOptions"]);

// 折叠状态
const isExpanded = ref(false);

// 默认值
const defaultRebuildOptions = {
  batchSize: 200,
  maxDepth: null,
  refresh: true,
};

const defaultApplyDirtyOptions = {
  batchSize: 200,
  maxItems: null,
  rebuildDirectorySubtree: true,
};

// 选项状态
const rebuildOptions = reactive({ ...defaultRebuildOptions });
const applyDirtyOptions = reactive({ ...defaultApplyDirtyOptions });

// 监听变化并向上传递
watch(rebuildOptions, (newVal) => {
  emit("update:rebuildOptions", { ...newVal });
}, { deep: true });

watch(applyDirtyOptions, (newVal) => {
  emit("update:applyDirtyOptions", { ...newVal });
}, { deep: true });

// 重置为默认值
function resetToDefaults() {
  Object.assign(rebuildOptions, defaultRebuildOptions);
  Object.assign(applyDirtyOptions, defaultApplyDirtyOptions);
}

// 暴露方法供父组件调用
defineExpose({
  getRebuildOptions: () => {
    const opts = {};
    if (rebuildOptions.batchSize !== defaultRebuildOptions.batchSize) {
      opts.batchSize = rebuildOptions.batchSize;
    }
    if (rebuildOptions.maxDepth) {
      opts.maxDepth = rebuildOptions.maxDepth;
    }
    if (rebuildOptions.refresh !== defaultRebuildOptions.refresh) {
      opts.refresh = rebuildOptions.refresh;
    }
    return Object.keys(opts).length > 0 ? opts : {};
  },
  getApplyDirtyOptions: () => {
    const opts = {};
    if (applyDirtyOptions.batchSize !== defaultApplyDirtyOptions.batchSize) {
      opts.batchSize = applyDirtyOptions.batchSize;
    }
    if (applyDirtyOptions.maxItems) {
      opts.maxItems = applyDirtyOptions.maxItems;
    }
    if (applyDirtyOptions.rebuildDirectorySubtree !== defaultApplyDirtyOptions.rebuildDirectorySubtree) {
      opts.rebuildDirectorySubtree = applyDirtyOptions.rebuildDirectorySubtree;
    }
    return Object.keys(opts).length > 0 ? opts : {};
  },
});
</script>
