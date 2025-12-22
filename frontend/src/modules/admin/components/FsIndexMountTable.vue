<template>
  <div class="overflow-x-auto">
    <table class="w-full text-xs">
      <thead>
        <tr
          class="border-b"
          :class="darkMode ? 'border-gray-700' : 'border-gray-200'"
        >
          <th
            class="px-3 py-2 text-left font-medium"
            :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
          >
            {{ t("admin.fsIndex.table.mountName") }}
          </th>
          <th
            class="px-3 py-2 text-left font-medium"
            :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
          >
            {{ t("admin.fsIndex.table.storageType") }}
          </th>
          <th
            class="px-3 py-2 text-center font-medium"
            :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
          >
            {{ t("admin.fsIndex.table.status") }}
          </th>
          <th
            class="px-3 py-2 text-right font-medium"
            :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
          >
            {{ t("admin.fsIndex.table.dirtyCount") }}
          </th>
          <th
            class="px-3 py-2 text-left font-medium"
            :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
          >
            {{ t("admin.fsIndex.table.lastIndexed") }}
          </th>
          <th
            class="px-3 py-2 text-right font-medium"
            :class="darkMode ? 'text-gray-400' : 'text-gray-500'"
          >
            {{ t("admin.fsIndex.table.actions") }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(mount, index) in mounts"
          :key="mount.mountId"
          class="border-b transition-colors"
          :class="[
            darkMode ? 'border-gray-700/50 hover:bg-gray-700/30' : 'border-gray-100 hover:bg-gray-50',
            index % 2 === 0 ? (darkMode ? 'bg-gray-800/30' : 'bg-gray-50/50') : ''
          ]"
        >
          <!-- 挂载点名称 -->
          <td class="px-3 py-2.5">
            <div class="flex items-center gap-2">
              <component
                :is="getStatusIcon(mount.status)"
                class="w-4 h-4 flex-shrink-0"
                :class="getStatusIconClass(mount.status)"
              />
              <span
                class="font-medium truncate max-w-[150px]"
                :class="darkMode ? 'text-white' : 'text-gray-900'"
                :title="mount.name"
              >
                {{ mount.name }}
              </span>
            </div>
          </td>

          <!-- 存储类型 -->
          <td class="px-3 py-2.5">
            <span
              class="px-1.5 py-0.5 rounded text-xs"
              :class="darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'"
            >
              {{ mount.storageType }}
            </span>
          </td>

          <!-- 状态 -->
          <td class="px-3 py-2.5 text-center">
            <span
              :class="[
                'px-1.5 py-0.5 text-xs font-medium rounded',
                getStatusBadgeClass(mount.status)
              ]"
            >
              {{ t(getStatusTextKey(mount.status)) }}
            </span>
          </td>

          <!-- Dirty Count -->
          <td class="px-3 py-2.5 text-right">
            <span
              :class="[
                'font-medium',
                mount.dirtyCount > 0
                  ? (darkMode ? 'text-yellow-400' : 'text-yellow-600')
                  : (darkMode ? 'text-gray-400' : 'text-gray-500')
              ]"
            >
              {{ mount.dirtyCount || 0 }}
            </span>
          </td>

          <!-- 最后索引时间 -->
          <td class="px-3 py-2.5">
            <span :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ formatTimestamp(mount.lastIndexedMs) || t("admin.fsIndex.card.neverIndexed") }}
            </span>
          </td>

          <!-- 操作按钮 -->
          <td class="px-3 py-2.5">
            <div class="flex items-center justify-end gap-1">
              <!-- 建议操作按钮 -->
              <button
                v-if="mount.recommendedAction === 'rebuild'"
                @click="$emit('rebuild', mount.mountId)"
                class="px-2 py-1 text-xs font-medium text-white rounded transition-colors"
                :class="darkMode ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-yellow-500 hover:bg-yellow-600'"
              >
                {{ t("admin.fsIndex.actions.rebuild") }}
              </button>
              <button
                v-else-if="mount.recommendedAction === 'apply-dirty'"
                @click="$emit('apply-dirty', mount.mountId)"
                class="px-2 py-1 text-xs font-medium text-white rounded transition-colors"
                :class="darkMode ? 'bg-green-600 hover:bg-green-700' : 'bg-green-500 hover:bg-green-600'"
              >
                {{ t("admin.fsIndex.actions.applyDirty") }}
              </button>

              <!-- 更多操作下拉 -->
              <div class="relative" v-if="mount.status !== 'indexing'">
                <button
                  @click="toggleDropdown(mount.mountId)"
                  class="p-1 rounded transition-colors"
                  :class="darkMode ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-500 hover:bg-gray-100'"
                >
                  <IconMenu class="w-4 h-4" />
                </button>

                <!-- 下拉菜单 -->
                <div
                  v-if="openDropdown === mount.mountId"
                  class="absolute right-0 top-full mt-1 w-32 rounded-md shadow-lg z-10 border"
                  :class="darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'"
                >
                  <button
                    @click="handleAction('rebuild', mount.mountId)"
                    class="w-full px-3 py-2 text-left text-xs flex items-center gap-2 transition-colors"
                    :class="darkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-50'"
                  >
                    <IconRebuild class="w-3.5 h-3.5" />
                    {{ t("admin.fsIndex.actions.rebuild") }}
                  </button>
                  <button
                    @click="handleAction('apply-dirty', mount.mountId)"
                    class="w-full px-3 py-2 text-left text-xs flex items-center gap-2 transition-colors"
                    :class="darkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-50'"
                  >
                    <IconUpdate class="w-3.5 h-3.5" />
                    {{ t("admin.fsIndex.actions.applyDirty") }}
                  </button>
                  <button
                    @click="handleAction('clear', mount.mountId)"
                    class="w-full px-3 py-2 text-left text-xs flex items-center gap-2 transition-colors"
                    :class="darkMode ? 'text-red-400 hover:bg-gray-700' : 'text-red-600 hover:bg-gray-50'"
                  >
                    <IconTrash class="w-3.5 h-3.5" />
                    {{ t("admin.fsIndex.actions.clear") }}
                  </button>
                </div>
              </div>

              <!-- 索引中状态显示 -->
              <span
                v-else
                class="px-2 py-1 text-xs rounded flex items-center gap-1"
                :class="darkMode ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-600'"
              >
                <IconRefresh class="w-3 h-3 animate-spin" />
                {{ t("admin.fsIndex.status.indexing") }}
              </span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import {
  IconCheckCircle,
  IconRefresh,
  IconExclamation,
  IconXCircle,
  IconMenu,
  IconRebuild,
  IconUpdate,
  IconTrash,
} from "@/components/icons";
import {
  getStatusTextKey,
  getStatusBadgeClass,
  formatTimestamp,
} from "@/api/services/fsIndexService";

const { t } = useI18n();
const { isDarkMode: darkMode } = useThemeMode();

const props = defineProps({
  mounts: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["rebuild", "apply-dirty", "clear"]);

// 下拉菜单状态
const openDropdown = ref(null);

function toggleDropdown(mountId) {
  openDropdown.value = openDropdown.value === mountId ? null : mountId;
}

function handleAction(action, mountId) {
  openDropdown.value = null;
  emit(action, mountId);
}

// 点击外部关闭下拉菜单
function handleClickOutside(event) {
  if (!event.target.closest(".relative")) {
    openDropdown.value = null;
  }
}

onMounted(() => {
  document.addEventListener("click", handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener("click", handleClickOutside);
});

// 状态图标
function getStatusIcon(status) {
  switch (status) {
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
}

function getStatusIconClass(status) {
  switch (status) {
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
}
</script>
