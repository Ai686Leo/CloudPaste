<script setup>
import { ref, onMounted, computed } from "vue";
import { useI18n } from "vue-i18n";
import CommonPagination from "@/components/common/CommonPagination.vue";
import ConfirmDialog from "@/components/common/dialogs/ConfirmDialog.vue";
import { copyToClipboard } from "@/utils/clipboard";
import { useAdminApiKeyService } from "@/modules/admin/services/apiKeyService.js";
import { useAdminMountService } from "@/modules/admin/services/mountService.js";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";
import { useConfirmDialog } from "@/composables/core/useConfirmDialog.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useAdminBase } from "@/composables/admin-management/useAdminBase.js";
import { IconClock, IconDelete, IconKey, IconRefresh } from "@/components/icons";

// 导入子组件
import KeyForm from "@/modules/admin/components/KeyForm.vue";
import KeyTable from "@/modules/admin/components/KeyTable.vue";

// 使用i18n
const { t } = useI18n();
const { getAllApiKeys, deleteApiKey } = useAdminApiKeyService();
const { getMountsList } = useAdminMountService();
const { showSuccess, showError } = useGlobalMessage();
const { isDarkMode: darkMode } = useThemeMode();

// 确认对话框
const { dialogState, confirm, handleConfirm, handleCancel } = useConfirmDialog();

// 管理页面基础功能（含移动端检测 + 分页）
const {
  isMobile,
  lastRefreshTime,
  updateLastRefreshTime,
  pagination,
  pageSizeOptions,
  handlePaginationChange,
  changePageSize,
  resetPagination,
  updatePagination,
} = useAdminBase('key-management', {
  mobileDetect: { breakpoint: 768 },
});

// 状态管理
const apiKeys = ref([]);
const isLoading = ref(false);
const showCreateModal = ref(false);
const showEditModal = ref(false);
const selectedKeys = ref([]);
const editingKey = ref(null);

// 计算当前页显示的密钥
const currentPageKeys = computed(() => {
  const start = (pagination.page - 1) * pagination.limit;
  const end = start + pagination.limit;
  return apiKeys.value.slice(start, end);
});

// 处理页码变化
const handlePageChange = (page) => {
  handlePaginationChange(page, 'page');
};

// 引用子组件
const keyFormRef = ref(null);
const keyTableRef = ref(null);

// 可用挂载点列表
const availableMounts = ref([]);

// 加载所有API密钥
const loadApiKeys = async () => {
  isLoading.value = true;

  try {
    const keys = await getAllApiKeys();
    apiKeys.value = Array.isArray(keys) ? keys : [];

    // 重置分页并更新总数
    resetPagination();
    updatePagination({ total: apiKeys.value.length }, 'page');
    // 更新最后刷新时间
    updateLastRefreshTime();
  } catch (e) {
    console.error("加载API密钥失败:", e);
    showError(e.message || t("admin.keyManagement.error.loadFailed"));
  } finally {
    isLoading.value = false;
  }
};

// 加载挂载点列表
const loadMounts = async () => {
  try {
    const mounts = await getMountsList();
    // 只保留激活状态的挂载点
    availableMounts.value = (Array.isArray(mounts) ? mounts : []).filter((mount) => mount.is_active);
  } catch (error) {
    console.error("加载挂载点列表失败:", error);
    availableMounts.value = [];
  }
};

// 打开创建模态框
const openCreateModal = () => {
  showCreateModal.value = true;
};

// 打开编辑模态框
const openEditModal = (key) => {
  editingKey.value = key;
  showEditModal.value = true;
};

// 处理创建密钥成功
const handleKeyCreated = (newKey, fullKey) => {
  // 自动复制新创建的密钥到剪贴板
  if (fullKey) {
    (async () => {
      try {
        await copyToClipboard(fullKey);
        showSuccess(t("admin.keyManagement.success.createdAndCopied", "密钥已创建并复制到剪贴板"));
      } catch (e) {
        showSuccess(t("admin.keyManagement.success.created", "密钥已成功创建"));
      }
    })();
  } else {
    showSuccess(t("admin.keyManagement.success.created", "密钥已成功创建"));
  }

  // 添加到列表
  apiKeys.value.unshift(newKey);

  // 关闭模态框
  showCreateModal.value = false;
};

// 处理更新密钥成功
const handleKeyUpdated = (updatedKey) => {
  // 更新本地状态
  const index = apiKeys.value.findIndex((key) => key.id === updatedKey.id);
  if (index !== -1) {
    apiKeys.value[index] = updatedKey;
  }

  // 关闭模态框
  showEditModal.value = false;

  // 显示成功消息
  showSuccess(t("admin.keyManagement.success.updated"));
};

// 批量删除选中的密钥
const deleteSelectedKeys = async () => {
  if (selectedKeys.value.length === 0) {
    showError(t("admin.keyManagement.selectKeysFirst"));
    return;
  }

  // 过滤掉 GUEST 密钥（不允许删除）
  const deletableIds = selectedKeys.value.filter((id) => {
    const key = apiKeys.value.find((k) => k.id === id);
    return key && (key.role || "GENERAL") !== "GUEST";
  });

  if (deletableIds.length === 0) {
    showError(t("admin.keyManagement.error.cannotDeleteGuest", "游客密钥不允许删除，请通过禁用或修改权限控制访问"));
    return;
  }

  const selectedCount = deletableIds.length;

  // 使用统一确认对话框
  const confirmed = await confirm({
    title: t("common.dialogs.deleteTitle"),
    message: t("common.dialogs.deleteMultiple", { count: selectedCount }),
    confirmType: "danger",
    confirmText: t("common.dialogs.deleteButton") + ` (${selectedCount})`,
    darkMode: darkMode.value,
  });

  if (!confirmed) {
    return;
  }

  isLoading.value = true;

  try {
    // 逐个删除选中的密钥
    const promises = deletableIds.map((id) => deleteApiKey(id));
    await Promise.all(promises);

    // 清空选中列表
    selectedKeys.value = [];

    // 重新加载数据
    await loadApiKeys();

    // 清空表格选中状态
    if (keyTableRef.value) {
      keyTableRef.value.clearSelectedKeys();
    }

    // 显示成功消息
    showSuccess(t("admin.keyManagement.success.bulkDeleted", { count: selectedCount }));
  } catch (e) {
    console.error("批量删除密钥失败:", e);
    showError(t("admin.keyManagement.error.bulkDeleteFailed"));
  } finally {
    isLoading.value = false;
  }
};

// Key 管理页不再维护局部 toast，错误与成功提示统一走 useGlobalMessage

// 处理选中密钥变化
const handleSelectedKeysChange = (keys) => {
  selectedKeys.value = keys;
};

// 组件挂载时加载密钥和挂载点列表
onMounted(() => {
  loadApiKeys();
  loadMounts();
});
</script>

<template>
  <div class="p-3 sm:p-4 md:p-5 lg:p-6 flex-1 flex flex-col overflow-y-auto">
    <!-- 顶部操作栏 -->
    <div class="flex flex-col space-y-3 mb-4">
      <!-- 标题和操作按钮行 -->
      <div class="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
        <h2 class="text-lg sm:text-xl font-medium" :class="darkMode ? 'text-white' : 'text-gray-900'">{{ $t("admin.keyManagement.title") }}</h2>

        <div class="flex flex-wrap gap-2">
          <!-- 刷新按钮 -->
          <button
            @click="loadApiKeys"
            class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-sm font-medium rounded-md shadow-sm transition-all duration-200 ease-in-out"
            :class="darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'"
          >
            <IconRefresh size="sm" class="mr-1.5" />
            <span class="hidden xs:inline">{{ $t("admin.keyManagement.refresh") }}</span>
          </button>

          <!-- 批量删除按钮 -->
          <button
            @click="deleteSelectedKeys"
            :disabled="selectedKeys.length === 0"
            class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-sm font-medium rounded-md shadow-sm transition-all duration-200 ease-in-out"
            :class="[
              selectedKeys.length === 0
                ? 'opacity-50 cursor-not-allowed bg-gray-400 dark:bg-gray-600'
                : darkMode
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-red-500 hover:bg-red-600 text-white',
            ]"
          >
            <IconDelete size="sm" class="mr-1.5" />
            <span class="hidden xs:inline">{{ $t("admin.keyManagement.bulkDelete") }}{{ selectedKeys.length ? `(${selectedKeys.length})` : "" }}</span>
            <span class="xs:hidden">{{ $t("admin.keyManagement.delete") }}{{ selectedKeys.length ? `(${selectedKeys.length})` : "" }}</span>
          </button>

          <!-- 创建新密钥按钮 -->
          <button
            @click="openCreateModal"
            class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-sm font-medium rounded-md shadow-sm transition-all duration-200 ease-in-out"
            :class="darkMode ? 'bg-primary-600 hover:bg-primary-700 text-white' : 'bg-primary-500 hover:bg-primary-600 text-white'"
          >
            <IconKey size="sm" class="mr-1.5" />
            <span class="hidden xs:inline">{{ $t("admin.keyManagement.create") }}</span>
            <span class="xs:hidden">{{ $t("admin.keyManagement.createShort") }}</span>
          </button>
        </div>
      </div>

      <!-- 最后刷新时间显示 -->
      <div v-if="lastRefreshTime" class="text-xs sm:text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
        <span class="inline-flex items-center">
          <IconClock size="sm" class="mr-1" />
          {{ $t("admin.keyManagement.lastRefreshed") }}: {{ lastRefreshTime }}
        </span>
      </div>
    </div>

    <!-- 密钥列表 -->
    <div class="overflow-hidden bg-white dark:bg-gray-800 shadow-md rounded-lg">
      <KeyTable
        ref="keyTableRef"
        :dark-mode="darkMode"
        :api-keys="currentPageKeys"
        :is-loading="isLoading"
        :available-mounts="availableMounts"
        :is-mobile="isMobile"
        @refresh="loadApiKeys"
        @edit="openEditModal"
        @selected-keys-change="handleSelectedKeysChange"
      />
    </div>

    <!-- 分页组件 - 统一放在外部 -->
    <div v-if="!isLoading && apiKeys.length > 0" class="mt-4">
      <CommonPagination :dark-mode="darkMode" :pagination="pagination" mode="page" @page-changed="handlePageChange" />
    </div>

    <!-- 模态框 -->
    <!-- 创建密钥模态框 -->
    <div
      v-if="showCreateModal"
      class="fixed inset-0 z-[60] overflow-y-auto flex items-center justify-center p-2 sm:p-4 pt-20 sm:pt-4"
      :class="darkMode ? 'bg-gray-900/75' : 'bg-black/50'"
      @click="showCreateModal = false"
    >
      <KeyForm
        ref="keyFormRef"
        :dark-mode="darkMode"
        :available-mounts="availableMounts"
        :is-edit-mode="false"
        @close="showCreateModal = false"
        @created="handleKeyCreated"
        @click.stop
      />
    </div>

    <!-- 编辑密钥模态框 -->
    <div
      v-if="showEditModal"
      class="fixed inset-0 z-[60] overflow-y-auto flex items-center justify-center p-2 sm:p-4 pt-20 sm:pt-4"
      :class="darkMode ? 'bg-gray-900/75' : 'bg-black/50'"
      @click="showEditModal = false"
    >
      <KeyForm
        ref="keyFormRef"
        :dark-mode="darkMode"
        :key-data="editingKey"
        :available-mounts="availableMounts"
        :is-edit-mode="true"
        @close="showEditModal = false"
        @updated="handleKeyUpdated"
        @click.stop
      />
    </div>

    <!-- 确认对话框 -->
    <ConfirmDialog
      v-bind="dialogState"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>
