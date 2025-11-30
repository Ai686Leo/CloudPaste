<template>
  <div class="mount-explorer-container mx-auto px-3 sm:px-6 flex-1 flex flex-col pt-6 sm:pt-8 w-full max-w-full sm:max-w-6xl">
    <div class="header mb-4 border-b pb-2 flex justify-between items-center" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
      <h2 class="text-xl font-semibold" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">{{ $t("mount.title") }}</h2>

      <!-- 搜索按钮 -->
      <button
        @click="handleOpenSearchModal"
        class="flex items-center gap-2 px-3 py-1.5 rounded-md border transition-all duration-200 hover:shadow-sm"
        :class="
          darkMode
            ? 'border-gray-600 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-gray-200'
            : 'border-gray-300 bg-white hover:bg-gray-50 text-gray-600 hover:text-gray-700'
        "
        :title="$t('search.title')"
      >
        <!-- 搜索图标 -->
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>

        <!-- 搜索文字（在小屏幕上隐藏） -->
        <span class="hidden sm:inline text-sm text-gray-500" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ $t("search.placeholder") }}
        </span>

        <!-- 快捷键提示（在大屏幕上显示） -->
        <kbd
          class="hidden lg:inline-flex items-center px-1.5 py-0.5 text-xs font-mono rounded border"
          :class="darkMode ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-gray-100 border-gray-300 text-gray-600'"
        >
          Ctrl K
        </kbd>
      </button>
    </div>

    <!-- 权限管理组件 -->
    <PermissionManager
      :dark-mode="darkMode"
      permission-type="mount"
      :permission-required-text="$t('mount.permissionRequired')"
      :login-auth-text="$t('mount.loginAuth')"
      @permission-change="handlePermissionChange"
      @navigate-to-admin="navigateToAdmin"
    />

    <!-- 主要内容区域 -->
    <div v-if="hasPermission" class="mount-explorer-main">
      <!-- 顶部 README -->
      <DirectoryReadme position="top" :meta="directoryMeta" :dark-mode="darkMode" />

      <!-- 操作按钮 -->
      <div class="card mb-4">
        <div class="p-3">
          <FileOperations
            :current-path="currentPath"
            :is-virtual="isVirtualDirectory"
            :dark-mode="darkMode"
            :view-mode="viewMode"
            :selected-items="selectedItems"
            @create-folder="handleCreateFolder"
            @refresh="handleRefresh"
            @change-view-mode="handleViewModeChange"
            @openUploadModal="handleOpenUploadModal"
            @openCopyModal="handleBatchCopy"
            @openTasksModal="handleOpenTasksModal"
            @task-created="handleTaskCreated"
            @show-message="handleShowMessage"
          />
        </div>
      </div>

      <!-- 上传弹窗 -->
      <UppyUploadModal
        :is-open="isUploadModalOpen"
        :current-path="currentPath"
        :dark-mode="darkMode"
        :is-admin="isAdmin"
        @close="handleCloseUploadModal"
        @upload-success="handleUploadSuccess"
        @upload-error="handleUploadError"
      />

      <!-- 复制弹窗 -->
      <CopyModal
        :is-open="isCopyModalOpen"
        :dark-mode="darkMode"
        :selected-items="getSelectedItems()"
        :source-path="currentPath"
        :is-admin="isAdmin"
        :api-key-info="apiKeyInfo"
        @close="handleCloseCopyModal"
        @copy-started="handleCopyStarted"
        @copy-complete="handleCopyComplete"
      />

      <!-- 任务管理弹窗 -->
      <TasksModal :is-open="isTasksModalOpen" :dark-mode="darkMode" @close="handleCloseTasksModal" />

      <!-- 新建文件夹弹窗 -->
      <InputDialog
        :is-open="showCreateFolderDialog"
        :title="t('mount.operations.createFolder')"
        :description="t('mount.createFolder.enterName')"
        :label="t('mount.createFolder.folderName')"
        :placeholder="t('mount.createFolder.placeholder')"
        :confirm-text="t('mount.createFolder.create')"
        :cancel-text="t('mount.createFolder.cancel')"
        :loading="isCreatingFolder"
        :loading-text="t('mount.createFolder.creating')"
        :dark-mode="darkMode"
        @confirm="handleCreateFolderConfirm"
        @cancel="handleCreateFolderCancel"
        @close="showCreateFolderDialog = false"
      />

      <!-- 文件篮面板 -->
      <FileBasketPanel :is-open="isBasketOpen" :dark-mode="darkMode" @close="closeBasket" @task-created="handleTaskCreated" @show-message="handleShowMessage" />

      <!-- 通用 ConfirmDialog 组件替换内联对话框 -->
      <ConfirmDialog
        :is-open="showDeleteDialog"
        :title="itemsToDelete.length === 1 ? t('mount.delete.title') : t('mount.batchDelete.title')"
        :confirm-text="itemsToDelete.length === 1 ? t('mount.delete.confirm') : t('mount.batchDelete.confirmButton')"
        :cancel-text="itemsToDelete.length === 1 ? t('mount.delete.cancel') : t('mount.batchDelete.cancelButton')"
        :loading="isDeleting"
        :loading-text="itemsToDelete.length === 1 ? t('mount.delete.deleting') : t('mount.batchDelete.deleting')"
        :dark-mode="darkMode"
        confirm-type="danger"
        @confirm="confirmDelete"
        @cancel="cancelDelete"
        @close="showDeleteDialog = false"
      >
        <template #content>
          <template v-if="itemsToDelete.length === 1">
            {{
              t("mount.delete.message", {
                type: itemsToDelete[0]?.isDirectory ? t("mount.fileTypes.folder") : t("mount.fileTypes.file"),
                name: itemsToDelete[0]?.name,
              })
            }}
            {{ itemsToDelete[0]?.isDirectory ? t("mount.delete.folderWarning") : "" }}
          </template>
          <template v-else>
            {{ t("mount.batchDelete.message", { count: itemsToDelete.length }) }}
            <div class="mt-2">
              <div class="text-xs font-medium mb-1">{{ t("mount.batchDelete.selectedItems") }}</div>
              <div class="max-h-32 overflow-y-auto bg-gray-50 dark:bg-gray-700 rounded p-2 text-xs">
                <div v-for="item in itemsToDelete.slice(0, 10)" :key="item.path" class="flex items-center py-0.5">
                  <span class="truncate">{{ item.name }}</span>
                  <span v-if="item.isDirectory" class="ml-1 text-gray-500">{{ t("mount.batchDelete.folder") }}</span>
                </div>
                <div v-if="itemsToDelete.length > 10" class="text-gray-500 py-0.5">
                  {{ t("mount.batchDelete.moreItems", { count: itemsToDelete.length - 10 }) }}
                </div>
              </div>
            </div>
          </template>
        </template>
      </ConfirmDialog>


      <!-- 面包屑导航 -->
      <div class="mb-4">
          <BreadcrumbNav
          :current-path="currentPath"
          :dark-mode="darkMode"
          :preview-file="isPreviewMode ? previewFile : null"
          @navigate="handleNavigate"
          :is-checkbox-mode="isCheckboxMode"
          :selected-count="selectedCount"
          @toggle-checkbox-mode="toggleCheckboxMode"
          @batch-delete="batchDelete"
          @batch-copy="handleBatchCopy"
          @batch-add-to-basket="handleBatchAddToBasket"
          :basic-path="apiKeyInfo?.basic_path || '/'"
          :user-type="isAdmin ? 'admin' : 'user'"
        />
      </div>

      <!-- 内容区域 - 根据模式显示文件列表或文件预览 -->
      <div class="card">
        <!-- 文件列表模式 -->
        <div v-if="!hasPreviewIntent">
          <!-- 内嵌式密码验证 -->
          <PathPasswordDialog
            v-if="pathPassword.showPasswordDialog.value"
            :is-open="pathPassword.showPasswordDialog.value"
            :path="pathPassword.pendingPath.value || currentPath"
            :dark-mode="darkMode"
            :inline="true"
            @verified="handlePasswordVerified"
            @cancel="handlePasswordCancel"
            @close="handlePasswordClose"
            @error="handlePasswordError"
          />

          <!-- 错误提示 -->
          <div v-else-if="error" class="mb-4 p-4 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg">
            <div class="flex items-center">
              <svg class="w-5 h-5 text-red-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clip-rule="evenodd"
                ></path>
              </svg>
              <span class="text-red-700 dark:text-red-200">{{ error }}</span>
            </div>
          </div>

          <!-- 目录列表 -->
          <DirectoryList
            v-else
            :current-path="currentPath"
            :items="visibleItems"
            :loading="loading"
            :is-virtual="isVirtualDirectory"
            :dark-mode="darkMode"
            :view-mode="viewMode"
            :is-checkbox-mode="isCheckboxMode"
            :selected-items="getSelectedItems()"
            @navigate="handleNavigate"
            @download="handleDownload"
            @getLink="handleGetLink"
            @rename="handleRename"
            @delete="handleDelete"
            @preview="handlePreview"
            @item-select="handleItemSelect"
            @toggle-select-all="toggleSelectAll"
            @show-message="handleShowMessage"
          />
        </div>

        <!-- 文件预览模式 -->
        <div v-else>
          <!-- 预览加载状态 -->
          <div v-if="isPreviewLoading" class="p-8 text-center">
            <div class="flex flex-col items-center space-y-4">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <div class="text-gray-600 dark:text-gray-400">{{ $t("common.loading") }}</div>
            </div>
          </div>

          <!-- 预览错误状态 -->
          <div v-else-if="previewError" class="p-8 text-center">
            <div class="flex flex-col items-center space-y-4">
              <svg class="w-12 h-12 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.694-.833-2.464 0L4.35 16.5c-.77.833.192 2.5 1.732 2.5z"
                ></path>
              </svg>
              <div class="text-red-600 dark:text-red-400">
                {{ previewError }}
              </div>
              <button @click="closePreviewWithUrl" class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
                {{ $t("common.back") }}
              </button>
            </div>
          </div>

          <!-- 预览内容 -->
          <div v-else-if="previewFile" class="p-4">
            <!-- 返回按钮 -->
            <div class="mb-4">
              <button
                @click="closePreviewWithUrl"
                class="inline-flex items-center px-3 py-1.5 rounded-md transition-colors text-sm font-medium"
                :class="darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'"
              >
                <svg class="w-4 h-4 mr-1.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span>{{ t("mount.backToFileList") }}</span>
              </button>
            </div>

            <!-- 文件预览内容 -->
            <FilePreview
              :file="previewInfo || previewFile"
              :dark-mode="darkMode"
              :is-loading="isPreviewLoading"
              :is-admin="isAdmin"
              :api-key-info="apiKeyInfo"
              :has-file-permission="hasFilePermission"
              :directory-items="visibleItems"
              @download="handleDownload"
              @loaded="handlePreviewLoaded"
              @error="handlePreviewError"
              @show-message="handleShowMessage"
            />
          </div>
        </div>
      </div>

      <!-- 底部 README -->
      <DirectoryReadme v-if="!hasPreviewIntent" position="bottom" :meta="directoryMeta" :dark-mode="darkMode" />
    </div>

    <!-- 搜索弹窗 -->
    <SearchModal
      :is-open="isSearchModalOpen"
      :dark-mode="darkMode"
      :current-path="currentPath"
      :current-mount-id="currentMountId"
      @close="handleCloseSearchModal"
      @item-click="handleSearchItemClick"
    />
  </div>
</template>

<script setup>
import { ref, computed, provide, onMounted, onBeforeUnmount, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { storeToRefs } from "pinia";
import { useThemeMode } from "@/composables/core/useThemeMode.js";

// 组合式函数 - 使用统一聚合导出
import { useSelection, useFileOperations, useUIState, useFileBasket } from "@/composables/index.js";
import { usePathPassword } from "@/composables/usePathPassword.js";

// 视图控制器
import { useMountExplorerController } from "./useMountExplorerController.js";

// 子组件
import BreadcrumbNav from "@/modules/fs/components/shared/BreadcrumbNav.vue";
import DirectoryList from "@/modules/fs/components/directory/DirectoryList.vue";
import DirectoryReadme from "@/modules/fs/components/DirectoryReadme.vue";
import FileOperations from "@/modules/fs/components/shared/FileOperations.vue";
import FilePreview from "@/modules/fs/components/preview/FilePreview.vue";
import UppyUploadModal from "@/modules/fs/components/shared/modals/UppyUploadModal.vue";
import CopyModal from "@/modules/fs/components/shared/modals/CopyModal.vue";
import TasksModal from "@/modules/fs/components/shared/modals/TasksModal.vue";
import SearchModal from "@/modules/fs/components/shared/modals/SearchModal.vue";
import PathPasswordDialog from "@/modules/fs/components/shared/modals/PathPasswordDialog.vue";
import ConfirmDialog from "@/components/common/dialogs/ConfirmDialog.vue";
import InputDialog from "@/components/common/dialogs/InputDialog.vue";
import FileBasketPanel from "@/modules/fs/components/shared/FileBasketPanel.vue";
import PermissionManager from "@/components/common/PermissionManager.vue";

const { t } = useI18n();

// Vue Router
const router = useRouter();

// 使用组合式函数
const selection = useSelection();
const fileOperations = useFileOperations();
const uiState = useUIState();
const fileBasket = useFileBasket();
const pathPassword = usePathPassword();

// 文件篮状态
const { isBasketOpen } = storeToRefs(fileBasket);

// 控制器：封装路由 / 权限 / 目录加载与预览初始化
const {
  currentPath,
  loading,
  error,
  hasPermissionForCurrentPath,
  directoryItems,
  isVirtualDirectory,
  directoryMeta,
  isAdmin,
  hasApiKey,
  hasFilePermission,
  hasMountPermission,
  hasPermission,
  apiKeyInfo,
  currentMountId,
  previewFile,
  previewInfo,
  isPreviewMode,
  isPreviewLoading,
  previewError,
  hasPreviewIntent,
  updateUrl,
  navigateTo,
  updatePreviewUrl,
  stopPreview,
  refreshDirectory,
} = useMountExplorerController();

// 根据目录 Meta 的隐藏规则计算实际可见条目
const visibleItems = computed(() => {
  const items = directoryItems.value || [];
  const meta = directoryMeta.value;
  const patterns = meta && Array.isArray(meta.hidePatterns) ? meta.hidePatterns : [];

  if (!patterns.length) {
    return items;
  }

  const regexes = patterns
    .map((pattern) => {
      try {
        return new RegExp(pattern);
      } catch {
        return null;
      }
    })
    .filter((re) => re);

  if (!regexes.length) {
    return items;
  }

  return items.filter((item) => !regexes.some((re) => re.test(item.name)));
});

const { isCheckboxMode, selectedItems, selectedCount, setAvailableItems, toggleCheckboxMode, toggleSelectAll, getSelectedItems, selectItem } = selection;

// 组合式函数状态和方法
const {
  // 消息管理
  showMessage,
  // 视图模式管理
  viewMode,
  setViewMode,
  // 弹窗状态管理
  isUploadModalOpen,
  isCopyModalOpen,
  isTasksModalOpen,
  isSearchModalOpen,

  openUploadModal,
  closeUploadModal,
  openCopyModal,
  closeCopyModal,
  openTasksModal,
  closeTasksModal,
  openSearchModal,
  closeSearchModal,
} = uiState;

const showDeleteDialog = ref(false);
const itemsToDelete = ref([]);
const isDeleting = ref(false);

// 新建文件夹弹窗状态
const showCreateFolderDialog = ref(false);
const isCreatingFolder = ref(false);

const props = defineProps({
  mode: {
    type: String,
    default: "default", // 默认模式，或 "selection"（选择模式）
  },
});

const { isDarkMode: darkMode } = useThemeMode();

// 权限变化处理
const handlePermissionChange = (hasPermission) => {
  console.log("MountExplorer: 权限状态变化", hasPermission);
  // 权限状态会自动更新，这里只需要记录日志
};

// API密钥信息
// 导航到管理页面
const navigateToAdmin = () => {
  import("@/router").then(({ routerUtils }) => {
    routerUtils.navigateTo("admin");
  });
};

// 搜索相关事件处理
const handleOpenSearchModal = () => {
  openSearchModal();
};

const handleCloseSearchModal = () => {
  closeSearchModal();
};

// 处理搜索结果项点击
const handleSearchItemClick = async (item) => {
  try {
    console.log("搜索结果项点击:", item);

    // 如果是文件，导航到文件所在目录并预览文件
    if (!item.isDirectory) {
      const directoryPath = item.path.substring(0, item.path.lastIndexOf("/")) || "/";
      const fileName = item.name;

      console.log("文件导航:", { directoryPath, fileName });

      // 构建正确的路由路径
      let routePath = "/mount-explorer";
      if (directoryPath !== "/") {
        // 移除开头的斜杠，因为路由已经包含了
        const normalizedPath = directoryPath.replace(/^\/+/, "");
        routePath = `/mount-explorer/${normalizedPath}`;
      }

      // 导航到目录，并在URL中添加预览参数
      await router.push({
        path: routePath,
        query: { preview: fileName },
      });
    } else {
      // 如果是目录，直接导航到该目录
      console.log("目录导航:", item.path);

      let routePath = "/mount-explorer";
      if (item.path !== "/") {
        // 移除开头的斜杠，因为路由已经包含了
        const normalizedPath = item.path.replace(/^\/+/, "");
        routePath = `/mount-explorer/${normalizedPath}`;
      }

      await router.push(routePath);
    }

    // 关闭搜索模态框
    closeSearchModal();
  } catch (error) {
    console.error("搜索结果导航失败:", error);
    showMessage("error", "导航失败: " + error.message);
  }
};

// ===== MountExplorerMain的所有方法 =====

/**
 * 处理导航
 */
const handleNavigate = async (path, previewFileName = null) => {
  if (previewFileName) {
    // 如果有预览文件，使用updateUrl
    updateUrl(path, previewFileName);
  } else {
    // 否则使用navigateTo
    await navigateTo(path);
  }
};

/**
 * 处理刷新
 */
const handleRefresh = async () => {
  await refreshDirectory();
};

/**
 * 处理视图模式变化
 */
const handleViewModeChange = (newViewMode) => {
  setViewMode(newViewMode);
  // 保存到本地存储
  localStorage.setItem("file_explorer_view_mode", newViewMode);
};

/**
 * 处理文件夹创建 - 打开弹窗
 */
const handleCreateFolder = () => {
  showCreateFolderDialog.value = true;
};

/**
 * 处理新建文件夹确认
 */
const handleCreateFolderConfirm = async (folderName) => {
  if (!folderName) return;

  isCreatingFolder.value = true;
  try {
    // 使用fileOperations创建文件夹，传递正确的参数
    const result = await fileOperations.createFolder(currentPath.value, folderName);

    if (result.success) {
      showMessage("success", result.message);
      // 重新加载当前目录内容
      await refreshDirectory();
      showCreateFolderDialog.value = false;
    } else {
      showMessage("error", result.message);
    }
  } catch (error) {
    console.error("创建文件夹失败:", error);
    showMessage("error", "创建文件夹失败，请重试");
  } finally {
    isCreatingFolder.value = false;
  }
};

/**
 * 处理新建文件夹取消
 */
const handleCreateFolderCancel = () => {
  showCreateFolderDialog.value = false;
};

/**
 * 关闭文件篮面板
 */
const closeBasket = () => {
  try {
    fileBasket.closeBasket();
  } catch (error) {
    console.error("关闭文件篮面板失败:", error);
  }
};

/**
 * 处理文件下载
 */
const handleDownload = async (item) => {
  const result = await fileOperations.downloadFile(item);

  if (result.success) {
    showMessage("success", result.message);
  } else {
    showMessage("error", result.message);
  }
};

/**
 * 处理获取文件链接
 */
const handleGetLink = async (item) => {
  const result = await fileOperations.getFileLink(item);

  if (result.success) {
    showMessage("success", result.message);
  } else {
    showMessage("error", result.message);
  }
};

/**
 * 处理文件预览
 */
const handlePreview = async (item) => {
  if (!item || item.isDirectory) return;

  // 只更新URL，让路由监听器处理实际的文件加载
  updatePreviewUrl(currentPath.value, item.name);

  // 滚动到顶部
  window.scrollTo({ top: 0, behavior: "smooth" });
};

/**
 * 处理文件删除（显示确认对话框）
 */
const handleDelete = (item) => {
  itemsToDelete.value = [item];
  showDeleteDialog.value = true;
};

/**
 * 处理文件重命名
 */
const handleRename = async ({ item, newName }) => {
  if (!item || !newName || !newName.trim()) return;

  // 构建新路径
  const parentPath = item.path.substring(0, item.path.lastIndexOf("/") + 1);
  const isDirectory = item.isDirectory;
  const oldPath = item.path;
  let newPath = parentPath + newName.trim();

  // 如果是目录，确保新路径末尾有斜杠
  if (isDirectory && !newPath.endsWith("/")) {
    newPath += "/";
  }

  // 使用fileOperations重命名
  const result = await fileOperations.renameItem(oldPath, newPath);

  if (result.success) {
    showMessage("success", result.message);
    // 重新加载当前目录内容
    await refreshDirectory();
  } else {
    showMessage("error", result.message);
  }
};

/**
 * 处理项目选择
 */
const handleItemSelect = (item, selected) => {
  selectItem(item, selected);
};

// handleItemDelete方法在原始文件中不存在，已删除（使用handleDelete代替）

/**
 * 处理批量删除
 */
const batchDelete = () => {
  const selectedFiles = getSelectedItems();

  if (selectedFiles.length === 0) {
    showMessage("warning", t("mount.messages.noItemsSelected"));
    return;
  }

  itemsToDelete.value = selectedFiles;
  showDeleteDialog.value = true;
};

/**
 * 取消删除
 */
const cancelDelete = () => {
  // 删除过程中不允许取消
  if (isDeleting.value) return;

  // 清理删除状态
  itemsToDelete.value = [];
};

/**
 * 确认删除
 */
const confirmDelete = async () => {
  if (itemsToDelete.value.length === 0 || isDeleting.value) return;

  isDeleting.value = true;

  try {
    // 使用fileOperations删除项目
    const result = await fileOperations.batchDeleteItems(itemsToDelete.value);

    if (result.success) {
      showMessage("success", result.message);

      // 如果是批量删除，清空选择状态
      if (itemsToDelete.value.length > 1) {
        toggleCheckboxMode(false);
      }

      // 关闭对话框
      showDeleteDialog.value = false;
      itemsToDelete.value = [];

      // 重新加载当前目录内容
      await refreshDirectory();
    } else {
      showMessage("error", result.message);
    }
  } catch (error) {
    console.error("删除操作失败:", error);
    showMessage("error", error.message || t("mount.messages.deleteFailed", { message: t("common.unknown") }));
  } finally {
    isDeleting.value = false;
  }
};

// 这些方法在原始MountExplorerMain.vue中不存在，已删除

const handleBatchAddToBasket = () => {
  try {
    const selectedFiles = getSelectedItems();
    const result = fileBasket.addSelectedToBasket(selectedFiles, currentPath.value);

    if (result.success) {
      showMessage("success", result.message);
      // 可选：关闭勾选模式
      // toggleCheckboxMode(false);
    } else {
      showMessage("error", result.message);
    }
  } catch (error) {
    console.error("批量添加到文件篮失败:", error);
    showMessage("error", t("fileBasket.messages.batchAddFailed"));
  }
};

// 弹窗相关方法
const handleOpenUploadModal = () => {
  openUploadModal();
};

const handleCloseUploadModal = () => {
  closeUploadModal();
};

const handleUploadSuccess = async () => {
  showMessage("success", t("mount.messages.uploadSuccess"));
  await refreshDirectory();
};

const handleUploadError = (error) => {
  console.error("上传失败:", error);
  showMessage("error", error.message || t("mount.messages.uploadFailed"));
};

const handleBatchCopy = () => {
  if (selectedItems.value.length === 0) {
    showMessage("warning", t("mount.messages.noItemsSelected"));
    return;
  }
  openCopyModal();
};

const handleCloseCopyModal = () => {
  closeCopyModal();
};

const handleCopyStarted = (event) => {
  // 显示复制开始消息
  const message =
    event?.message ||
    t("mount.taskManager.copyStarted", {
      count: event?.itemCount || 0,
      path: event?.targetPath || "",
    });
  showMessage("success", message);
  toggleCheckboxMode(false);
};

const handleCopyComplete = async (event) => {
  // 复制完成后刷新目录
  // 注意：我们已经在copy-started事件中显示了开始消息，这里不再重复显示

  // 只有在模态框未关闭时才关闭模态框
  if (!event?.modalAlreadyClosed) {
    closeCopyModal();
  }

  await refreshDirectory();
};

const handleOpenTasksModal = () => {
  openTasksModal();
};

const handleCloseTasksModal = () => {
  closeTasksModal();
};

/**
 * 处理任务创建事件
 */
const handleTaskCreated = (taskInfo) => {
  console.log("文件篮任务已创建:", taskInfo);
  // 可以在这里添加额外的任务跟踪逻辑
  // 例如：打开任务管理器面板
  // openTasksModal();
};

const handleShowMessage = (messageInfo) => {
  showMessage(messageInfo.type, messageInfo.message);
};

// 密码验证事件处理
const handlePasswordVerified = ({ path, token, message }) => {
  console.log("密码验证成功:", { path, token });

  // 保存验证 token
  pathPassword.savePathToken(path, token);

  // 显示成功消息
  showMessage("success", message || t("mount.pathPassword.verified"));

  // 关闭弹窗
  pathPassword.closePasswordDialog();
  pathPassword.clearPendingPath();

  // 重新加载目录
  refreshDirectory();
};

const handlePasswordCancel = async () => {
  console.log("密码验证取消/返回");

  // 关闭密码弹窗
  pathPassword.closePasswordDialog();
  pathPassword.clearPendingPath();

  // 计算父目录路径
  const currentPathValue = currentPath.value;
  let parentPath = "/";

  if (currentPathValue && currentPathValue !== "/") {
    // 移除末尾的斜杠（如果有）
    const normalized = currentPathValue.replace(/\/+$/, "");
    // 获取最后一个斜杠之前的部分
    const lastSlashIndex = normalized.lastIndexOf("/");
    if (lastSlashIndex > 0) {
      parentPath = normalized.substring(0, lastSlashIndex);
    }
  }

  console.log("导航到父目录:", { from: currentPathValue, to: parentPath });

  // 导航到父目录
  await navigateTo(parentPath);
};

const handlePasswordClose = () => {
  console.log("密码弹窗关闭");
  pathPassword.closePasswordDialog();
};

const handlePasswordError = ({ message }) => {
  console.error("密码验证错误:", message);
  showMessage("error", message);
};

// 预览相关方法
const handlePreviewLoaded = () => {
  console.log("预览加载完成");
};

const handlePreviewError = (error) => {
  console.error("预览加载失败:", error);
  showMessage("error", t("mount.messages.previewError"));
};

const closePreview = () => {
  stopPreview(false);
};

const closePreviewWithUrl = () => {
  closePreview();
  updateUrl(currentPath.value);
};

// 预览相关事件处理已在上面定义

// 提供数据给子组件
provide(
  "darkMode",
  computed(() => props.darkMode)
);
provide("isAdmin", isAdmin);
provide("apiKeyInfo", apiKeyInfo);
provide("hasPermissionForCurrentPath", hasPermissionForCurrentPath);

// 处理认证状态变化
const handleAuthStateChange = (event) => {
  console.log("MountExplorer: 认证状态变化", event.detail);
  // 权限状态会自动更新，这里只需要记录日志
};

// 全局快捷键处理
const handleGlobalKeydown = (event) => {
  // Ctrl+K 打开搜索
  if ((event.ctrlKey || event.metaKey) && event.key === "k") {
    event.preventDefault();
    if (hasPermission.value && !isSearchModalOpen.value) {
      handleOpenSearchModal();
    }
  }

  // ESC 关闭搜索
  if (event.key === "Escape" && isSearchModalOpen.value) {
    handleCloseSearchModal();
  }
};

// 监听目录项目变化，更新选择状态（仅针对可见条目）
watch(
  () => visibleItems.value,
  (newItems) => {
    setAvailableItems(newItems);
  },
  { immediate: true }
);

// 监听路径变化，自动关闭密码弹窗
watch(
  () => currentPath.value,
  (newPath, oldPath) => {
    if (newPath !== oldPath && pathPassword.showPasswordDialog.value) {
      console.log("路径变化，关闭密码弹窗:", { from: oldPath, to: newPath });
      pathPassword.closePasswordDialog();
      pathPassword.clearPendingPath();
    }
  }
);

// 组件挂载时执行
onMounted(async () => {
  // 监听认证状态变化事件
  window.addEventListener("auth-state-changed", handleAuthStateChange);

  // 监听全局快捷键
  document.addEventListener("keydown", handleGlobalKeydown);

  // 恢复视图首选项
  const savedViewMode = localStorage.getItem("file_explorer_view_mode");
  if (savedViewMode) {
    setViewMode(savedViewMode);
  }

  console.log("MountExplorer权限状态:", {
    isAdmin: isAdmin.value,
    hasApiKey: hasApiKey.value,
    hasFilePermission: hasFilePermission.value,
    hasMountPermission: hasMountPermission.value,
    hasPermission: hasPermission.value,
    apiKeyInfo: apiKeyInfo.value,
  });
});

// 组件卸载时清理资源
onBeforeUnmount(() => {
  console.log("MountExplorerView组件卸载，清理资源");

  // 移除事件监听器
  window.removeEventListener("auth-state-changed", handleAuthStateChange);
  document.removeEventListener("keydown", handleGlobalKeydown);

  // 停止预览
  if (isPreviewMode.value) {
    stopPreview(false);
  }

  // 清理选择状态
  toggleCheckboxMode(false);
});

// 组件卸载时清理
onBeforeUnmount(() => {
  console.log("MountExplorerView组件卸载，清理资源");

  // 停止预览
  if (isPreviewMode.value) {
    stopPreview(false);
  }

  // 清理选择状态
  toggleCheckboxMode(false);

  // 移除事件监听器
  window.removeEventListener("auth-state-changed", handleAuthStateChange);
  document.removeEventListener("keydown", handleGlobalKeydown);
});
</script>
