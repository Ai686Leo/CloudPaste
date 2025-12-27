/**
 * 全局删除设置状态管理
 * 管理删除模式的全局状态，支持持久化存储
 */

import { defineStore } from "pinia";
import { computed } from "vue";
import { useLocalStorage } from "@vueuse/core";

export const useDeleteSettingsStore = defineStore("deleteSettings", () => {
  const storedSettings = useLocalStorage("cloudpaste_delete_settings", { deleteRecordOnly: false });

  // 删除模式状态：false = 同时删除文件和记录，true = 仅删除记录
  const deleteRecordOnly = computed({
    get: () => !!storedSettings.value?.deleteRecordOnly,
    set: (value) => {
      storedSettings.value = { ...(storedSettings.value || {}), deleteRecordOnly: !!value };
    },
  });

  // 从localStorage加载设置
  const loadSettings = () => {
    // VueUse 已自动加载，这里保留方法名用于兼容旧调用
    deleteRecordOnly.value = !!storedSettings.value?.deleteRecordOnly;
  };

  // 保存设置到localStorage
  const saveSettings = () => {
    // VueUse 会自动保存，这里保留方法名用于兼容旧调用
    storedSettings.value = { ...(storedSettings.value || {}), deleteRecordOnly: !!deleteRecordOnly.value };
  };

  // 切换删除模式
  const toggleDeleteMode = () => {
    deleteRecordOnly.value = !deleteRecordOnly.value;
    saveSettings();
  };

  // 获取删除模式字符串（用于API调用）
  const getDeleteMode = () => {
    return deleteRecordOnly.value ? "record_only" : "both";
  };

  // 初始化时加载设置
  loadSettings();

  return {
    deleteRecordOnly,
    toggleDeleteMode,
    getDeleteMode,
    loadSettings,
    saveSettings,
  };
});
