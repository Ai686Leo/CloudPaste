<template>
  <div
    class="border rounded-lg p-3 transition-all duration-200"
    :class="[
      borderClass,
      darkMode ? 'bg-gray-800' : 'bg-white'
    ]"
  >
    <!-- 卡片头部 -->
    <div class="flex items-start justify-between mb-2">
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <!-- 存储类型品牌图标 -->
        <div
          :class="[
            'w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0',
            storageTypeBgClassComputed
          ]"
        >
          <component
            :is="storageTypeIcon"
            class="w-4 h-4"
            :class="storageTypeColorClass"
          />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <p class="font-medium text-sm truncate" :class="darkMode ? 'text-white' : 'text-gray-900'">
              {{ mount.name }}
            </p>
            <!-- 状态小图标指示器 -->
            <component
              :is="statusIcon"
              class="w-3.5 h-3.5 flex-shrink-0"
              :class="statusIconColorClass"
            />
          </div>
          <p class="text-xs truncate" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
            {{ mount.storageType }}
          </p>
        </div>
      </div>
      <span
        :class="[
          'px-1.5 py-0.5 text-xs font-medium rounded flex-shrink-0',
          statusBadgeClass
        ]"
      >
        {{ statusText }}
      </span>
    </div>

    <!-- 卡片信息 -->
    <div class="space-y-1 mb-2 text-xs">
      <div class="flex justify-between">
        <span :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ t("admin.fsIndex.table.dirtyCount") }}
        </span>
        <span
          :class="[
            'font-medium',
            mount.dirtyCount > 0 ? (darkMode ? 'text-yellow-400' : 'text-yellow-600') : (darkMode ? 'text-gray-300' : 'text-gray-700')
          ]"
        >
          {{ mount.dirtyCount || 0 }}
        </span>
      </div>
      <div class="flex justify-between">
        <span :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ t("admin.fsIndex.table.lastIndexed") }}
        </span>
        <span class="font-medium truncate ml-2" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
          {{ lastIndexedText }}
        </span>
      </div>

      <!-- 错误信息 -->
      <div
        v-if="mount.status === 'error' && mount.lastError"
        class="text-xs p-1.5 rounded mt-1"
        :class="darkMode ? 'text-red-400 bg-red-900/20' : 'text-red-600 bg-red-50'"
      >
        {{ mount.lastError }}
      </div>
    </div>

    <!-- 卡片底部操作区 -->
    <div
      class="flex items-center justify-between pt-2 border-t"
      :class="borderTopClass"
    >
      <span
        class="text-xs font-medium"
        :class="recommendedActionTextClass"
      >
        {{ recommendedActionText }}
      </span>

      <!-- 操作按钮 - 仅使用 SVG 图标 -->
      <div class="flex gap-1">
        <!-- 增量更新按钮 - 绿色，仅当有脏数据时显示 -->
        <button
          v-if="mount.status !== 'indexing' && mount.dirtyCount > 0"
          @click="$emit('apply-dirty')"
          :title="t('admin.fsIndex.actions.applyDirty')"
          class="p-1.5 rounded transition-colors"
          :class="darkMode ? 'text-green-400 hover:bg-green-900/30 hover:text-green-300' : 'text-green-600 hover:bg-green-100 hover:text-green-700'"
        >
          <IconUpdate class="w-4 h-4" />
        </button>

        <!-- 重建按钮 - 蓝色 -->
        <button
          v-if="mount.status !== 'indexing'"
          @click="$emit('rebuild')"
          :title="t('admin.fsIndex.actions.rebuild')"
          class="p-1.5 rounded transition-colors"
          :class="darkMode ? 'text-blue-400 hover:bg-blue-900/30 hover:text-blue-300' : 'text-blue-600 hover:bg-blue-100 hover:text-blue-700'"
        >
          <IconRebuild class="w-4 h-4" />
        </button>

        <!-- 清空按钮 - 红色 -->
        <button
          v-if="mount.status !== 'indexing'"
          @click="$emit('clear')"
          :title="t('admin.fsIndex.actions.clear')"
          class="p-1.5 rounded transition-colors"
          :class="darkMode ? 'text-red-400 hover:bg-red-900/30 hover:text-red-300' : 'text-red-500 hover:bg-red-100 hover:text-red-600'"
        >
          <IconTrash class="w-4 h-4" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useStorageTypeIcon } from "@/composables/core/useStorageTypeIcon.js";
import {
  IconCheckCircle,
  IconRefresh,
  IconExclamation,
  IconXCircle,
  IconRebuild,
  IconTrash,
  IconUpdate,
} from "@/components/icons";
import {
  getStatusTextKey,
  getStatusBadgeClass,
  formatTimestamp,
} from "@/api/services/fsIndexService";

const { t } = useI18n();
const { isDarkMode: darkMode } = useThemeMode();
const { getStorageTypeIcon, getStorageTypeIconClass, getStorageTypeBgClass } = useStorageTypeIcon();

const props = defineProps({
  mount: {
    type: Object,
    required: true,
  },
});

defineEmits(["rebuild", "apply-dirty", "clear"]);

// 状态相关计算属性
const statusText = computed(() => {
  return t(getStatusTextKey(props.mount.status));
});

const statusBadgeClass = computed(() => {
  return getStatusBadgeClass(props.mount.status);
});

// 存储类型图标（使用 composable）
const storageTypeIcon = computed(() => {
  return getStorageTypeIcon(props.mount.storageType);
});

// 存储类型图标颜色（使用 composable）
const storageTypeColorClass = computed(() => {
  return getStorageTypeIconClass(props.mount.storageType, darkMode.value);
});

// 存储类型图标背景色（使用 composable）
const storageTypeBgClassComputed = computed(() => {
  return getStorageTypeBgClass(props.mount.storageType, darkMode.value);
});

const statusIcon = computed(() => {
  switch (props.mount.status) {
    case "ready":
      return IconCheckCircle;
    case "indexing":
      return IconRefresh;
    case "not_ready":
      return IconExclamation;
    case "error":
      return IconXCircle;
    default:
      return IconExclamation;
  }
});

const statusIconColorClass = computed(() => {
  switch (props.mount.status) {
    case "ready":
      return darkMode.value ? "text-green-400" : "text-green-600";
    case "indexing":
      return (darkMode.value ? "text-blue-400" : "text-blue-600") + " animate-spin";
    case "not_ready":
      return darkMode.value ? "text-yellow-400" : "text-yellow-600";
    case "error":
      return darkMode.value ? "text-red-400" : "text-red-600";
    default:
      return darkMode.value ? "text-gray-400" : "text-gray-600";
  }
});

// 边框高亮样式
const borderClass = computed(() => {
  if (props.mount.status === "indexing") {
    return darkMode.value
      ? "border-2 border-blue-700 bg-blue-900/10"
      : "border-2 border-blue-300 bg-blue-50/50";
  }
  if (props.mount.recommendedAction === "rebuild") {
    return darkMode.value
      ? "border-2 border-yellow-700 bg-yellow-900/10"
      : "border-2 border-yellow-300 bg-yellow-50/50";
  }
  if (props.mount.status === "error") {
    return darkMode.value ? "border-red-700" : "border-red-300";
  }
  return darkMode.value
    ? "border-gray-700 hover:border-gray-600"
    : "border-gray-200 hover:border-gray-300";
});

const borderTopClass = computed(() => {
  if (props.mount.status === "indexing") {
    return darkMode.value ? "border-blue-800" : "border-blue-200";
  }
  if (props.mount.status === "error") {
    return darkMode.value ? "border-red-800" : "border-red-200";
  }
  if (props.mount.recommendedAction === "rebuild") {
    return darkMode.value ? "border-yellow-800" : "border-yellow-200";
  }
  return darkMode.value ? "border-gray-700" : "border-gray-200";
});

// 最后索引时间
const lastIndexedText = computed(() => {
  if (!props.mount.lastIndexedMs) {
    return t("admin.fsIndex.card.neverIndexed");
  }
  return formatTimestamp(props.mount.lastIndexedMs);
});

// 建议操作文本
const recommendedActionText = computed(() => {
  switch (props.mount.recommendedAction) {
    case "rebuild":
      return t("admin.fsIndex.action.rebuild");
    case "apply-dirty":
      return t("admin.fsIndex.action.applyDirty");
    case "wait":
      return t("admin.fsIndex.action.wait");
    case "none":
      return t("admin.fsIndex.action.none");
    default:
      return t("admin.fsIndex.action.unknown");
  }
});

const recommendedActionTextClass = computed(() => {
  switch (props.mount.recommendedAction) {
    case "rebuild":
      return darkMode.value ? "text-yellow-300" : "text-yellow-700";
    case "apply-dirty":
      return darkMode.value ? "text-green-300" : "text-green-700";
    case "wait":
      return darkMode.value ? "text-blue-300" : "text-blue-700";
    default:
      return darkMode.value ? "text-gray-400" : "text-gray-500";
  }
});
</script>
