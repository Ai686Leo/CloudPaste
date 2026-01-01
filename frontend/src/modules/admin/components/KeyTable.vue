<script setup>
import { ref, computed, h } from "vue";
import { useI18n } from "vue-i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { Permission, PermissionChecker } from "@/constants/permissions.js";
import { useAdminApiKeyService } from "@/modules/admin/services/apiKeyService.js";
import { useConfirmDialog } from "@/composables/core/useConfirmDialog.js";
import AdminTable from "@/components/common/AdminTable.vue";
import ConfirmDialog from "@/components/common/dialogs/ConfirmDialog.vue";
import { formatDateTime } from "@/utils/timeUtils.js";
import { IconKey } from "@/components/icons";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { createLogger } from "@/utils/logger.js";

// i18n
const { t } = useI18n();
const log = createLogger("KeyTable");
const { deleteApiKey } = useAdminApiKeyService();

// 确认对话框
const { dialogState, confirm, handleConfirm, handleCancel } = useConfirmDialog();

// Props
const props = defineProps({
  darkMode: {
    type: Boolean,
    required: true,
  },
  apiKeys: {
    type: Array,
    required: true,
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
  availableMounts: {
    type: Array,
    default: () => [],
  },
  isMobile: {
    type: Boolean,
    default: false,
  },
});

// Emits
const emit = defineEmits(["refresh", "edit", "success", "error", "selected-keys-change"]);

// 状态管理
const error = ref(null);
const successMessage = ref(null);
const selectedKeys = ref([]);

// ========== 工具函数 ==========

// 角色判断
const isGuestKey = (key) => (key.role || "GENERAL") === "GUEST";

// 获取权限分组（紧凑显示）
const getPermissionGroups = (permissions) => {
  const groups = [];

  // 基础权限组
  let baseCount = 0;
  const basePerms = [];
  if (PermissionChecker.hasPermission(permissions, Permission.TEXT_SHARE)) {
    baseCount++;
    basePerms.push(t("admin.keyManagement.permissions.text", "文本分享"));
  }
  if (PermissionChecker.hasPermission(permissions, Permission.TEXT_MANAGE)) {
    baseCount++;
    basePerms.push(t("admin.keyManagement.permissions.text_manage", "文本管理"));
  }
  if (PermissionChecker.hasPermission(permissions, Permission.FILE_SHARE)) {
    baseCount++;
    basePerms.push(t("admin.keyManagement.permissions.file_share", "文件分享"));
  }
  if (PermissionChecker.hasPermission(permissions, Permission.FILE_MANAGE)) {
    baseCount++;
    basePerms.push(t("admin.keyManagement.permissions.file_manage", "文件管理"));
  }
  if (baseCount > 0) {
    groups.push({
      name: t("admin.keyManagement.permissions.basic", "基础"),
      count: baseCount,
      items: basePerms,
      color: "blue",
    });
  }

  // 挂载权限组
  let mountCount = 0;
  const mountPerms = [];
  if (PermissionChecker.hasPermission(permissions, Permission.MOUNT_VIEW)) {
    mountCount++;
    mountPerms.push(t("admin.keyManagement.permissions.mount_view", "查看"));
  }
  if (PermissionChecker.hasPermission(permissions, Permission.MOUNT_UPLOAD)) {
    mountCount++;
    mountPerms.push(t("admin.keyManagement.permissions.mount_upload", "上传"));
  }
  if (PermissionChecker.hasPermission(permissions, Permission.MOUNT_COPY)) {
    mountCount++;
    mountPerms.push(t("admin.keyManagement.permissions.mount_copy", "复制"));
  }
  if (PermissionChecker.hasPermission(permissions, Permission.MOUNT_RENAME)) {
    mountCount++;
    mountPerms.push(t("admin.keyManagement.permissions.mount_rename", "重命名"));
  }
  if (PermissionChecker.hasPermission(permissions, Permission.MOUNT_DELETE)) {
    mountCount++;
    mountPerms.push(t("admin.keyManagement.permissions.mount_delete", "删除"));
  }
  if (mountCount > 0) {
    groups.push({
      name: t("admin.keyManagement.permissions.mount", "挂载"),
      count: mountCount,
      items: mountPerms,
      color: "purple",
    });
  }

  // WebDAV权限组
  let webdavCount = 0;
  const webdavPerms = [];
  if (PermissionChecker.hasPermission(permissions, Permission.WEBDAV_READ)) {
    webdavCount++;
    webdavPerms.push(t("admin.keyManagement.permissions.webdav_read", "读取"));
  }
  if (PermissionChecker.hasPermission(permissions, Permission.WEBDAV_MANAGE)) {
    webdavCount++;
    webdavPerms.push(t("admin.keyManagement.permissions.webdav_manage", "管理"));
  }
  if (webdavCount > 0) {
    groups.push({
      name: t("admin.keyManagement.permissions.webdav", "WebDAV"),
      count: webdavCount,
      items: webdavPerms,
      color: "cyan",
    });
  }

  return groups;
};

// 获取权限分组的颜色类
const getGroupColorClass = (color) => {
  const colorMap = {
    blue: props.darkMode
      ? "bg-blue-500/15 text-blue-300 border-blue-400/30 hover:bg-blue-500/20"
      : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100",
    purple: props.darkMode
      ? "bg-purple-500/15 text-purple-300 border-purple-400/30 hover:bg-purple-500/20"
      : "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100",
    cyan: props.darkMode
      ? "bg-cyan-500/15 text-cyan-300 border-cyan-400/30 hover:bg-cyan-500/20"
      : "bg-cyan-50 text-cyan-700 border-cyan-200 hover:bg-cyan-100",
  };
  return colorMap[color] || colorMap.blue;
};

// 格式化日期（仅显示年月日）
const formatDate = (dateString) => {
  if (!dateString) return t("admin.keyManagement.neverExpires");
  if (dateString.startsWith("9999-")) {
    return t("admin.keyManagement.neverExpires");
  }
  // 仅显示日期，不显示时间
  return formatDateTime(dateString, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
};

// 获取显示路径
const getDisplayPath = (path) => {
  if (!path || path === "/") {
    return "/";
  }

  const mount = props.availableMounts.find((m) => m.mount_path === path);
  if (mount) {
    return `${mount.name} (${path})`;
  }

  if (path.length > 25) {
    const segments = path.split("/");
    if (segments.length <= 2) return path;

    const firstPart = segments[1];
    const lastPart = segments[segments.length - 1];
    const last = lastPart === "" ? segments[segments.length - 2] : lastPart;
    return `/${firstPart}/.../${last}${lastPart === "" ? "/" : ""}`;
  }

  return path;
};

// 获取角色标签
const getRoleLabel = (key) => {
  const role = key.role || "GENERAL";
  if (role === "GUEST") return t("admin.keyManagement.role.guest", "游客");
  if (role === "ADMIN") return t("admin.keyManagement.role.admin", "管理员");
  return t("admin.keyManagement.role.general", "普通");
};

// 获取状态标签
const getStatusLabel = (key) => {
  const enabled = typeof key.is_enable === "number" ? key.is_enable === 1 : !!key.is_enable;
  return enabled ? t("admin.keyManagement.status.enabled", "启用") : t("admin.keyManagement.status.disabled", "禁用");
};

// ========== 表格列定义 ==========

const keyColumns = computed(() => [
  // 名称列
  {
    key: "name",
    type: "accessor",
    header: t("admin.keyManagement.keyName"),
    sortable: true,
    render: (_, key) => {
      return h("div", { class: "flex flex-col" }, [
        h("span", {
          class: `font-medium ${props.darkMode ? "text-white" : "text-gray-900"}`,
          title: key.name
        }, key.name),
        // 角色徽章
        h("div", { class: "mt-1" }, [
          isGuestKey(key)
            ? h("span", {
                class: `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                  props.darkMode ? "bg-amber-500/15 text-amber-200 border border-amber-400/30" : "bg-amber-50 text-amber-700 border border-amber-200"
                }`
              }, [
                // 游客图标
                h("svg", {
                  xmlns: "http://www.w3.org/2000/svg",
                  class: "h-3 w-3",
                  viewBox: "0 0 20 20",
                  fill: "currentColor"
                }, [
                  h("path", {
                    "fill-rule": "evenodd",
                    d: "M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z",
                    "clip-rule": "evenodd"
                  })
                ]),
                getRoleLabel(key)
              ])
            : h("span", {
                class: `inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  props.darkMode ? "bg-gray-700 text-gray-300 border border-gray-600" : "bg-gray-100 text-gray-700 border border-gray-300"
                }`
              }, getRoleLabel(key))
        ])
      ]);
    },
  },

  // 密钥列
  {
    key: "key",
    type: "display",
    header: t("admin.keyManagement.key"),
    sortable: false,
    render: (key) => {
      return h("div", { class: "flex items-center gap-2" }, [
        h("code", {
          class: `px-2 py-1 rounded text-xs font-mono ${
            props.darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"
          }`
        }, key.key_masked || "CKP-···"),
        // 复制按钮
        h("button", {
          onClick: () => copyKeyToClipboard(key.key),
          class: `p-1.5 rounded-md transition-colors ${
            props.darkMode
              ? "hover:bg-slate-700 text-slate-400 hover:text-slate-200"
              : "hover:bg-slate-200 text-slate-500 hover:text-slate-700"
          }`,
          title: t("admin.keyManagement.copyKeyFull")
        }, [
          h("svg", {
            xmlns: "http://www.w3.org/2000/svg",
            class: "h-4 w-4",
            fill: "none",
            viewBox: "0 0 24 24",
            stroke: "currentColor"
          }, [
            h("path", {
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
              "stroke-width": "2",
              d: "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            })
          ])
        ])
      ]);
    },
  },

  // 权限列（分组紧凑显示）
  {
    key: "permissions",
    type: "display",
    header: t("admin.keyManagement.permissionsColumn"),
    sortable: false,
    render: (key) => {
      const groups = getPermissionGroups(key.permissions || 0);

      if (groups.length === 0) {
        return h("span", {
          class: `text-xs ${props.darkMode ? "text-gray-400" : "text-gray-500"}`
        }, t("admin.keyManagement.permissions.none"));
      }

      // 构建悬停提示内容
      const tooltipText = groups.map(group =>
        `${group.name}: ${group.items.join("、")}`
      ).join("\n");

      // 显示分组徽章: 基础 (4)  挂载 (5)  WebDAV (2)
      return h("div", {
        class: "flex items-center gap-1.5",
        title: tooltipText
      }, groups.map(group =>
        h("span", {
          class: `inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium cursor-help transition-colors ${getGroupColorClass(group.color)}`
        }, [
          h("span", { class: "font-semibold" }, group.name),
          h("span", { class: "opacity-75" }, `(${group.count})`)
        ])
      ));
    },
  },

  // 基础路径列
  {
    key: "basic_path",
    type: "display",
    header: t("admin.keyManagement.basicPath"),
    sortable: false,
    render: (key) => {
      return h("div", {
        class: `text-sm max-w-[180px] truncate ${props.darkMode ? "text-gray-400" : "text-gray-600"}`,
        title: key.basic_path
      }, getDisplayPath(key.basic_path));
    },
  },

  // 过期时间列
  {
    key: "expires_at",
    type: "accessor",
    header: t("admin.keyManagement.expiresAt"),
    sortable: true,
    render: (_, key) => {
      return h("span", {
        class: `text-sm ${props.darkMode ? "text-gray-400" : "text-gray-600"}`
      }, formatDate(key.expires_at));
    },
  },

  // 最后使用时间列
  {
    key: "last_used",
    type: "accessor",
    header: t("admin.keyManagement.lastUsed"),
    sortable: true,
    render: (_, key) => {
      return h("span", {
        class: `text-sm ${props.darkMode ? "text-gray-400" : "text-gray-600"}`
      }, key.last_used ? formatDate(key.last_used) : t("admin.keyManagement.neverUsed"));
    },
  },

  // 状态列（滑动开关）
  {
    key: "status",
    type: "display",
    header: t("admin.keyManagement.table.status"),
    sortable: false,
    render: (key) => {
      const enabled = typeof key.is_enable === "number" ? key.is_enable === 1 : !!key.is_enable;

      return h("div", { class: "flex items-center justify-center" }, [
        // 滑动开关
        h("button", {
          onClick: () => toggleKeyStatus(key),
          class: `relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
            enabled
              ? "bg-emerald-500 focus:ring-emerald-500"
              : (props.darkMode ? "bg-gray-600 focus:ring-gray-500" : "bg-gray-300 focus:ring-gray-400")
          }`,
          role: "switch",
          "aria-checked": enabled,
          title: enabled ? t("admin.keyManagement.clickToDisable") : t("admin.keyManagement.clickToEnable")
        }, [
          h("span", {
            class: `inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`
          })
        ])
      ]);
    },
  },

  // 操作列
  {
    key: "actions",
    type: "display",
    header: t("admin.keyManagement.actions"),
    sortable: false,
    render: (key) => {
      return h("div", { class: "flex justify-center space-x-2" }, [
        // 编辑按钮
        h("button", {
          onClick: () => openEditModal(key),
          class: `text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700`,
          title: t("admin.keyManagement.edit")
        }, [
          h("svg", {
            xmlns: "http://www.w3.org/2000/svg",
            class: "h-5 w-5",
            fill: "none",
            viewBox: "0 0 24 24",
            stroke: "currentColor"
          }, [
            h("path", {
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
              "stroke-width": "2",
              d: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            })
          ])
        ]),
        // 删除按钮
        h("button", {
          onClick: () => handleDeleteKey(key),
          disabled: isGuestKey(key),
          class: isGuestKey(key)
            ? "opacity-40 cursor-not-allowed text-gray-400 p-1.5"
            : "text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700",
          title: isGuestKey(key)
            ? t("admin.keyManagement.error.cannotDeleteGuest")
            : t("admin.keyManagement.delete")
        }, [
          h("svg", {
            xmlns: "http://www.w3.org/2000/svg",
            class: "h-5 w-5",
            fill: "none",
            viewBox: "0 0 24 24",
            stroke: "currentColor"
          }, [
            h("path", {
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
              "stroke-width": "2",
              d: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            })
          ])
        ])
      ]);
    },
  }
]);

// 列样式配置
const keyColumnClasses = computed(() => ({
  name: "",
  key: "",
  permissions: "hidden lg:table-cell text-center",
  basic_path: "hidden xl:table-cell text-center",
  expires_at: "hidden 2xl:table-cell text-center",
  last_used: "hidden 2xl:table-cell text-center",
  status: "text-center",
  actions: "text-center"
}));

// ========== 选择管理 ==========

const selectableKeys = computed(() =>
  props.apiKeys.filter((key) => !isGuestKey(key)).map((key) => key.id)
);

const toggleSelectKey = (keyId) => {
  const key = props.apiKeys.find((k) => k.id === keyId);
  if (key && isGuestKey(key)) return;

  const index = selectedKeys.value.indexOf(keyId);
  if (index === -1) {
    selectedKeys.value.push(keyId);
  } else {
    selectedKeys.value.splice(index, 1);
  }
  emit("selected-keys-change", selectedKeys.value);
};

const handleSelectionChange = (event) => {
  if (event.type === "toggle-all") {
    if (selectedKeys.value.length === selectableKeys.value.length) {
      selectedKeys.value = [];
    } else {
      selectedKeys.value = [...selectableKeys.value];
    }
    emit("selected-keys-change", selectedKeys.value);
  } else if (event.type === "toggle-item") {
    toggleSelectKey(event.id);
  }
};

// ========== CRUD操作 ==========

const toggleKeyStatus = async (key) => {
  const currentStatus = typeof key.is_enable === "number" ? key.is_enable === 1 : !!key.is_enable;
  const newStatus = !currentStatus;

  try {
    const { updateApiKey } = useAdminApiKeyService();
    await updateApiKey(key.id, { is_enable: newStatus });

    emit("success", t(newStatus ? "admin.keyManagement.success.enabled" : "admin.keyManagement.success.disabled"));
    emit("refresh");
  } catch (e) {
    log.error("切换API密钥状态失败:", e);
    error.value = e.message || t("admin.keyManagement.error.updateFailed");
    emit("error", error.value);
  }
};

const handleDeleteKey = async (key) => {
  if (isGuestKey(key)) {
    error.value = t("admin.keyManagement.error.cannotDeleteGuest");
    emit("error", error.value);
    return;
  }

  // 使用统一确认对话框
  const confirmed = await confirm({
    title: t("common.dialogs.deleteTitle"),
    message: t("common.dialogs.deleteItem", { name: t("admin.keyManagement.item", "此 API 密钥") }),
    confirmType: "danger",
    confirmText: t("common.dialogs.deleteButton"),
    darkMode: props.darkMode,
  });

  if (!confirmed) {
    return;
  }

  try {
    await deleteApiKey(key.id);

    const index = selectedKeys.value.indexOf(key.id);
    if (index !== -1) {
      selectedKeys.value.splice(index, 1);
      emit("selected-keys-change", selectedKeys.value);
    }

    emit("success", t("admin.keyManagement.success.deleted"));
    emit("refresh");
  } catch (e) {
    log.error("删除API密钥失败:", e);
    error.value = e.message || t("admin.keyManagement.error.deleteFailed");
    emit("error", error.value);
  }
};

const openEditModal = (key) => {
  emit("edit", key);
};

const copyKeyToClipboard = async (keyValue) => {
  try {
    const success = await copyToClipboard(keyValue);
    if (success) {
      emit("success", t("admin.keyManagement.success.copied"));
    } else {
      throw new Error(t("admin.keyManagement.error.copyFailed"));
    }
  } catch (e) {
    log.error("复制到剪贴板失败:", e);
    error.value = t("admin.keyManagement.error.copyFailed");
    emit("error", error.value);
  }
};

// ========== 对外暴露 ==========

const clearSelectedKeys = () => {
  selectedKeys.value = [];
  emit("selected-keys-change", selectedKeys.value);
};

defineExpose({
  clearSelectedKeys,
  getSelectedKeys: () => selectedKeys.value,
});
</script>

<template>
  <div class="flex flex-col">
    <!-- 加载状态 -->
    <div v-if="isLoading && apiKeys.length === 0" class="flex flex-col items-center justify-center h-40">
      <LoadingIndicator
        :text="$t('admin.keyManagement.loadingKeys')"
        :dark-mode="darkMode"
        size="xl"
        :icon-class="darkMode ? 'text-white' : 'text-primary-500'"
        :text-class="darkMode ? 'text-gray-300' : 'text-gray-600'"
      />
    </div>

    <!-- 空状态 -->
    <div v-else-if="apiKeys.length === 0" class="text-center p-12 rounded-lg border-2 border-dashed" :class="darkMode ? 'border-gray-700 text-gray-400 bg-gray-800/30' : 'border-gray-200 text-gray-500 bg-gray-50'">
      <IconKey size="4xl" class="mx-auto mb-4 opacity-40" aria-hidden="true" />
      <p class="text-lg font-semibold mb-2">{{ $t("admin.keyManagement.noKeysTitle") }}</p>
      <p>{{ $t("admin.keyManagement.noKeysDescription") }}</p>
    </div>

    <!-- 数据展示 -->
    <div v-else>
      <!-- 使用AdminTable组件 -->
      <AdminTable
        :data="apiKeys"
        :columns="keyColumns"
        :column-classes="keyColumnClasses"
        :selectable="true"
        :selected-items="selectedKeys"
        row-id-field="id"
        :empty-text="$t('admin.keyManagement.table.noData')"
        @selection-change="handleSelectionChange"
      >
        <template #mobile="{ data }">
          <!-- 移动端卡片视图 -->
          <div class="space-y-3 p-2">
            <div
              v-for="key in data"
              :key="key.id"
              class="rounded-lg border p-4 transition-shadow hover:shadow-md"
              :class="[
                darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white',
                isGuestKey(key) ? (darkMode ? 'ring-1 ring-amber-400/30' : 'ring-1 ring-amber-200') : ''
              ]"
            >
              <!-- 卡片头部 -->
              <div class="flex items-start justify-between mb-3">
                <div class="flex items-start gap-2 flex-1 min-w-0">
                  <input
                    type="checkbox"
                    :checked="selectedKeys.includes(key.id)"
                    @change="toggleSelectKey(key.id)"
                    :disabled="isGuestKey(key)"
                    class="rounded border-gray-300 text-primary-600 focus:ring-primary-500 flex-shrink-0 mt-0.5"
                    :class="darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'"
                  />
                  <div class="min-w-0 flex-1">
                    <h3 class="font-semibold truncate" :class="darkMode ? 'text-white' : 'text-gray-900'">{{ key.name }}</h3>
                    <!-- 角色徽章单独显示 -->
                    <div class="mt-1.5">
                      <span
                        :class="[
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                          isGuestKey(key)
                            ? (darkMode ? 'bg-amber-500/15 text-amber-200 border border-amber-400/30' : 'bg-amber-50 text-amber-700 border border-amber-200')
                            : (darkMode ? 'bg-gray-700 text-gray-300 border border-gray-600' : 'bg-gray-100 text-gray-700 border border-gray-300')
                        ]"
                      >
                        {{ getRoleLabel(key) }}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Toggle Switch 在右上角 -->
                <button
                  @click="toggleKeyStatus(key)"
                  :class="[
                    'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 flex-shrink-0',
                    (typeof key.is_enable === 'number' ? key.is_enable === 1 : !!key.is_enable)
                      ? 'bg-emerald-500 focus:ring-emerald-500'
                      : (darkMode ? 'bg-gray-600 focus:ring-gray-500' : 'bg-gray-300 focus:ring-gray-400')
                  ]"
                  role="switch"
                  :aria-checked="typeof key.is_enable === 'number' ? key.is_enable === 1 : !!key.is_enable"
                  :title="(typeof key.is_enable === 'number' ? key.is_enable === 1 : !!key.is_enable) ? '点击禁用' : '点击启用'"
                >
                  <span
                    :class="[
                      'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                      (typeof key.is_enable === 'number' ? key.is_enable === 1 : !!key.is_enable) ? 'translate-x-6' : 'translate-x-1'
                    ]"
                  ></span>
                </button>
              </div>

              <!-- 密钥信息 -->
              <div class="mb-3 p-2 rounded" :class="darkMode ? 'bg-slate-800/50' : 'bg-slate-50'">
                <div class="flex items-center justify-between">
                  <code class="text-xs font-mono" :class="darkMode ? 'text-slate-300' : 'text-slate-700'">
                    {{ key.key_masked || 'CKP-···' }}
                  </code>
                  <button
                    @click="copyKeyToClipboard(key.key)"
                    class="p-1.5 rounded-md text-xs transition-colors"
                    :class="darkMode ? 'bg-slate-700 hover:bg-slate-600 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'"
                  >
                    复制
                  </button>
                </div>
              </div>

              <!-- 权限信息 -->
              <div class="mb-3">
                <div class="text-xs font-medium mb-1.5" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">权限</div>
                <div class="flex flex-wrap gap-1.5">
                  <template v-if="getPermissionGroups(key.permissions || 0).length > 0">
                    <span
                      v-for="group in getPermissionGroups(key.permissions || 0)"
                      :key="group.name"
                      class="inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium transition-colors"
                      :class="getGroupColorClass(group.color)"
                      :title="`${group.name}: ${group.items.join('、')}`"
                    >
                      <span class="font-semibold">{{ group.name }}</span>
                      <span class="opacity-75">({{ group.count }})</span>
                    </span>
                  </template>
                  <span v-else class="px-2 py-1 text-xs rounded-md" :class="darkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-500'">
                    {{ $t("admin.keyManagement.permissions.none") }}
                  </span>
                </div>
              </div>

              <!-- 其他信息 -->
              <div class="grid grid-cols-2 gap-2 text-xs mb-3" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
                <div>
                  <div class="font-medium mb-0.5">基础路径</div>
                  <div class="truncate" :title="key.basic_path">{{ getDisplayPath(key.basic_path) }}</div>
                </div>
                <div>
                  <div class="font-medium mb-0.5">过期时间</div>
                  <div>{{ formatDate(key.expires_at) }}</div>
                </div>
                <div>
                  <div class="font-medium mb-0.5">创建时间</div>
                  <div>{{ formatDate(key.created_at) }}</div>
                </div>
                <div>
                  <div class="font-medium mb-0.5">最后使用</div>
                  <div>{{ key.last_used ? formatDate(key.last_used) : $t("admin.keyManagement.neverUsed") }}</div>
                </div>
              </div>

              <!-- 操作按钮 -->
              <div class="flex justify-end gap-2 pt-3 border-t" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
                <button
                  @click="openEditModal(key)"
                  class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                  :class="darkMode ? 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-400' : 'bg-blue-100 hover:bg-blue-200 text-blue-600'"
                >
                  {{ $t("admin.keyManagement.edit") }}
                </button>
                <button
                  @click="handleDeleteKey(key)"
                  :disabled="isGuestKey(key)"
                  class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                  :class="[
                    isGuestKey(key)
                      ? 'opacity-40 cursor-not-allowed bg-gray-600 text-gray-400'
                      : (darkMode ? 'bg-red-500/20 hover:bg-red-500/30 text-red-400' : 'bg-red-100 hover:bg-red-200 text-red-600')
                  ]"
                >
                  {{ $t("admin.keyManagement.delete") }}
                </button>
              </div>
            </div>
          </div>
        </template>
      </AdminTable>
    </div>

    <!-- 确认对话框 -->
    <ConfirmDialog
      v-bind="dialogState"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>
