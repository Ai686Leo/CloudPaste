<template>
  <div
    class="rounded-xl border shadow-sm h-full flex flex-col"
    :class="darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'"
  >
    <!-- 标题 -->
    <div class="px-4 py-3 border-b flex-shrink-0" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
      <h3 class="text-sm font-semibold" :class="darkMode ? 'text-white' : 'text-gray-900'">
        {{ t("admin.fsIndex.actions.title") }}
      </h3>
    </div>

    <div class="p-3 flex-1 flex flex-col overflow-y-auto">
      <!-- 操作列表 -->
      <div class="space-y-2 flex-1">
        <!-- 全量重建 -->
        <div
          class="rounded-lg border overflow-hidden"
          :class="darkMode ? 'border-gray-700' : 'border-gray-200'"
        >
          <!-- 操作按钮行 -->
          <div
            class="flex items-center gap-3 p-2.5 cursor-pointer transition-colors"
            :class="darkMode ? 'hover:bg-gray-700/50' : 'hover:bg-gray-50'"
            @click="toggleRebuildExpand"
          >
            <div
              class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              :class="darkMode ? 'bg-primary-900/30' : 'bg-primary-100'"
            >
              <IconRebuild class="w-4 h-4" :class="darkMode ? 'text-primary-400' : 'text-primary-600'" />
            </div>
            <div class="flex-1 min-w-0">
              <h4 class="text-sm font-medium" :class="darkMode ? 'text-white' : 'text-gray-900'">
                {{ t("admin.fsIndex.actions.rebuildAll") }}
              </h4>
              <p class="text-xs truncate" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.fsIndex.actionPanel.rebuildDesc") }}
              </p>
            </div>
            <IconChevronDown
              class="w-4 h-4 flex-shrink-0 transition-transform duration-200"
              :class="[
                darkMode ? 'text-gray-500' : 'text-gray-400',
                { 'rotate-180': rebuildExpanded }
              ]"
            />
          </div>

          <!-- 可展开的配置区域 -->
          <div
            v-show="rebuildExpanded"
            class="px-3 pb-3 pt-1 border-t"
            :class="darkMode ? 'border-gray-700 bg-gray-750' : 'border-gray-100 bg-gray-50'"
          >
            <div class="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label class="block text-xs mb-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                  {{ t("admin.fsIndex.advancedOptions.batchSize") }}
                </label>
                <input
                  v-model.number="rebuildOptions.batchSize"
                  type="number"
                  min="20"
                  max="1000"
                  step="50"
                  class="w-full px-2 py-1 text-xs rounded border focus:outline-none focus:ring-1"
                  :class="darkMode
                    ? 'bg-gray-700 border-gray-600 text-gray-200 focus:ring-primary-500'
                    : 'bg-white border-gray-300 text-gray-700 focus:ring-primary-500'"
                />
              </div>
              <div>
                <label class="block text-xs mb-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                  {{ t("admin.fsIndex.advancedOptions.maxDepth") }}
                </label>
                <input
                  v-model.number="rebuildOptions.maxDepth"
                  type="number"
                  min="0"
                  max="100"
                  :placeholder="t('admin.fsIndex.advancedOptions.unlimited')"
                  class="w-full px-2 py-1 text-xs rounded border focus:outline-none focus:ring-1"
                  :class="darkMode
                    ? 'bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-500 focus:ring-primary-500'
                    : 'bg-white border-gray-300 text-gray-700 placeholder-gray-400 focus:ring-primary-500'"
                />
              </div>
            </div>
            <button
              @click="handleRebuild"
              :disabled="disabled"
              class="w-full py-1.5 text-xs font-medium text-white rounded transition-colors disabled:opacity-50"
              :class="darkMode ? 'bg-primary-600 hover:bg-primary-700' : 'bg-primary-500 hover:bg-primary-600'"
            >
              {{ t("admin.fsIndex.actions.rebuild") }}
            </button>
          </div>
        </div>

        <!-- 增量更新 -->
        <div
          class="rounded-lg border overflow-hidden"
          :class="darkMode ? 'border-gray-700' : 'border-gray-200'"
        >
          <!-- 操作按钮行 -->
          <div
            class="flex items-center gap-3 p-2.5 cursor-pointer transition-colors"
            :class="darkMode ? 'hover:bg-gray-700/50' : 'hover:bg-gray-50'"
            @click="toggleApplyDirtyExpand"
          >
            <div
              class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              :class="darkMode ? 'bg-green-900/30' : 'bg-green-100'"
            >
              <IconUpdate class="w-4 h-4" :class="darkMode ? 'text-green-400' : 'text-green-600'" />
            </div>
            <div class="flex-1 min-w-0">
              <h4 class="text-sm font-medium" :class="darkMode ? 'text-white' : 'text-gray-900'">
                {{ t("admin.fsIndex.actions.applyDirtyAll") }}
              </h4>
              <p class="text-xs truncate" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.fsIndex.actionPanel.applyDirtyDesc") }}
              </p>
            </div>
            <IconChevronDown
              class="w-4 h-4 flex-shrink-0 transition-transform duration-200"
              :class="[
                darkMode ? 'text-gray-500' : 'text-gray-400',
                { 'rotate-180': applyDirtyExpanded }
              ]"
            />
          </div>

          <!-- 可展开的配置区域 -->
          <div
            v-show="applyDirtyExpanded"
            class="px-3 pb-3 pt-1 border-t"
            :class="darkMode ? 'border-gray-700 bg-gray-750' : 'border-gray-100 bg-gray-50'"
          >
            <div class="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label class="block text-xs mb-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                  {{ t("admin.fsIndex.advancedOptions.batchSize") }}
                </label>
                <input
                  v-model.number="applyDirtyOptions.batchSize"
                  type="number"
                  min="10"
                  max="2000"
                  step="50"
                  class="w-full px-2 py-1 text-xs rounded border focus:outline-none focus:ring-1"
                  :class="darkMode
                    ? 'bg-gray-700 border-gray-600 text-gray-200 focus:ring-primary-500'
                    : 'bg-white border-gray-300 text-gray-700 focus:ring-primary-500'"
                />
              </div>
              <div>
                <label class="block text-xs mb-1" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                  {{ t("admin.fsIndex.advancedOptions.maxItems") }}
                </label>
                <input
                  v-model.number="applyDirtyOptions.maxItems"
                  type="number"
                  min="100"
                  max="100000"
                  step="100"
                  :placeholder="t('admin.fsIndex.advancedOptions.unlimited')"
                  class="w-full px-2 py-1 text-xs rounded border focus:outline-none focus:ring-1"
                  :class="darkMode
                    ? 'bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-500 focus:ring-primary-500'
                    : 'bg-white border-gray-300 text-gray-700 placeholder-gray-400 focus:ring-primary-500'"
                />
              </div>
            </div>
            <div class="flex items-center gap-2 mb-2">
              <input
                v-model="applyDirtyOptions.rebuildDirectorySubtree"
                type="checkbox"
                id="rebuild-subtree"
                class="w-3.5 h-3.5 rounded border focus:ring-primary-500"
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
            <button
              @click="handleApplyDirty"
              :disabled="disabled"
              class="w-full py-1.5 text-xs font-medium text-white rounded transition-colors disabled:opacity-50"
              :class="darkMode ? 'bg-green-600 hover:bg-green-700' : 'bg-green-500 hover:bg-green-600'"
            >
              {{ t("admin.fsIndex.actions.applyDirty") }}
            </button>
          </div>
        </div>

        <!-- 清空索引 -->
        <div
          class="rounded-lg border overflow-hidden"
          :class="darkMode ? 'border-gray-700' : 'border-gray-200'"
        >
          <div
            class="flex items-center gap-3 p-2.5 cursor-pointer transition-colors"
            :class="darkMode ? 'hover:bg-gray-700/50' : 'hover:bg-gray-50'"
            @click="$emit('clear')"
          >
            <div
              class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              :class="darkMode ? 'bg-red-900/30' : 'bg-red-100'"
            >
              <IconTrash class="w-4 h-4" :class="darkMode ? 'text-red-400' : 'text-red-500'" />
            </div>
            <div class="flex-1 min-w-0">
              <h4 class="text-sm font-medium" :class="darkMode ? 'text-white' : 'text-gray-900'">
                {{ t("admin.fsIndex.actions.clearAll") }}
              </h4>
              <p class="text-xs truncate" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ t("admin.fsIndex.actionPanel.clearDesc") }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- 刷新按钮 -->
      <div class="pt-2 mt-2 border-t flex-shrink-0" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <button
          @click="$emit('refresh')"
          :disabled="isLoading"
          class="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors"
          :class="darkMode
            ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
            : 'bg-gray-100 hover:bg-gray-200 text-gray-700'"
        >
          <IconRefresh class="w-4 h-4" :class="{ 'animate-spin': isLoading }" />
          {{ t("admin.fsIndex.actions.refresh") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from "vue";
import { useI18n } from "vue-i18n";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import {
  IconRebuild,
  IconUpdate,
  IconTrash,
  IconRefresh,
  IconChevronDown,
} from "@/components/icons";

const { t } = useI18n();
const { isDarkMode: darkMode } = useThemeMode();

defineProps({
  disabled: {
    type: Boolean,
    default: false,
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["rebuild", "applyDirty", "clear", "refresh"]);

// 展开状态
const rebuildExpanded = ref(false);
const applyDirtyExpanded = ref(false);

// 默认值
const defaultRebuildOptions = {
  batchSize: 200,
  maxDepth: null,
};

const defaultApplyDirtyOptions = {
  batchSize: 200,
  maxItems: null,
  rebuildDirectorySubtree: true,
};

// 选项状态
const rebuildOptions = reactive({ ...defaultRebuildOptions });
const applyDirtyOptions = reactive({ ...defaultApplyDirtyOptions });

// 切换展开状态
function toggleRebuildExpand() {
  rebuildExpanded.value = !rebuildExpanded.value;
  if (rebuildExpanded.value) {
    applyDirtyExpanded.value = false;
  }
}

function toggleApplyDirtyExpand() {
  applyDirtyExpanded.value = !applyDirtyExpanded.value;
  if (applyDirtyExpanded.value) {
    rebuildExpanded.value = false;
  }
}

// 处理重建操作
function handleRebuild() {
  emit("rebuild");
}

// 处理增量更新操作
function handleApplyDirty() {
  emit("applyDirty");
}

// 暴露方法供父组件调用
defineExpose({
  getRebuildOptions: () => {
    const opts = {};
    if (Number.isFinite(rebuildOptions.batchSize) && rebuildOptions.batchSize !== defaultRebuildOptions.batchSize) {
      opts.batchSize = rebuildOptions.batchSize;
    }
    if (rebuildOptions.maxDepth !== null && rebuildOptions.maxDepth !== undefined && Number.isFinite(rebuildOptions.maxDepth)) {
      opts.maxDepth = rebuildOptions.maxDepth;
    }
    opts.refresh = true;
    return opts;
  },
  getApplyDirtyOptions: () => {
    const opts = {};
    if (Number.isFinite(applyDirtyOptions.batchSize) && applyDirtyOptions.batchSize !== defaultApplyDirtyOptions.batchSize) {
      opts.batchSize = applyDirtyOptions.batchSize;
    }
    if (applyDirtyOptions.maxItems !== null && applyDirtyOptions.maxItems !== undefined && Number.isFinite(applyDirtyOptions.maxItems)) {
      opts.maxItems = applyDirtyOptions.maxItems;
    }
    if (applyDirtyOptions.rebuildDirectorySubtree !== defaultApplyDirtyOptions.rebuildDirectorySubtree) {
      opts.rebuildDirectorySubtree = applyDirtyOptions.rebuildDirectorySubtree;
    }
    opts.refresh = true;
    return opts;
  },
});
</script>
