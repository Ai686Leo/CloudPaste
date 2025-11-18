import { ref, reactive, computed } from "vue";
import { usePasteService } from "@/modules/paste";
import { copyToClipboard } from "@/utils/clipboard";
import { useAuthStore } from "@/stores/authStore.js";
import { useAdminBase } from "@/modules/admin";
import { generateQRCode as createQRCodeImage } from "@/utils/qrcodeUtils.js";

/** @typedef {import("@/types/paste").Paste} Paste */
/** @typedef {import("@/types/api").PaginationInfo} PaginationInfo */

/**
 * 文本管理 Admin composable
 * 基于 useAdminBase + usePasteService 统一管理 Admin 文本列表的加载、删除、搜索、预览、编辑等逻辑
 */
export function usePasteManagement() {
  const base = useAdminBase();
  const pasteService = usePasteService();

  /** @type {import("vue").Ref<Paste[]>} */
  const pastes = ref([]);
  /** @type {import("vue").Ref<Paste | null>} */
  const previewPaste = ref(null);
  /** @type {import("vue").Ref<Paste | null>} */
  const editingPaste = ref(null);
  const showPreview = ref(false);
  const showEdit = ref(false);
  const showQRCodeModal = ref(false);
  const qrCodeDataURL = ref("");
  const qrCodeSlug = ref("");

  const copiedTexts = reactive(/** @type {Record<string, boolean>} */ ({}));
  const copiedRawTexts = reactive(/** @type {Record<string, boolean>} */ ({}));

  const authStore = useAuthStore();

  const isAdmin = computed(() => authStore.isAdmin);
  const isApiKeyUser = computed(() => authStore.authType === "apikey" && authStore.hasTextManagePermission);
  const isAuthorized = computed(() => isAdmin.value || isApiKeyUser.value);

  /**
   * 加载文本列表
   * @returns {Promise<void>}
   */
  const loadPastes = async () => {
    return base.withLoading(async () => {
      try {
        const { items, pagination } = await pasteService.getPastes({
          limit: base.pagination.limit,
          offset: base.pagination.offset,
        });

        pastes.value = items;
        base.updatePagination(pagination, "offset");
        base.updateLastRefreshTime();
        console.log(`文本列表加载完成，共 ${pastes.value.length} 条`);
      } catch (err) {
        pastes.value = [];
        throw err;
      }
    });
  };

  /**
   * offset 变更（分页）
   * @param {number} newOffset
   */
  const handleOffsetChange = (newOffset) => {
    base.handlePaginationChange(newOffset, "offset");
    loadPastes();
  };

  /**
   * 删除单条文本
   * @param {string|number} pasteId
   */
  const deletePaste = async (pasteId) => {
    if (!pasteId) {
      base.showError("删除失败：缺少文本标识信息");
      return;
    }

    if (!confirm("确认要删除该文本吗？此操作不可恢复")) {
      return;
    }

    return base.withLoading(async () => {
      await pasteService.deleteSinglePaste(pasteId);
      base.showSuccess("删除成功");
      await loadPastes();
    });
  };

  /**
   * 批量删除文本
   */
  const batchDeletePastes = async () => {
    const selectedCount = base.selectedItems.value.length;
    if (selectedCount === 0) {
      base.showError("请先选择要删除的文本");
      return;
    }

    if (!confirm(`确认要删除选中的 ${selectedCount} 条文本吗？此操作不可恢复`)) {
      return;
    }

    return base.withLoading(async () => {
      await pasteService.deletePastes(base.selectedItems.value);
      base.showSuccess(`成功删除 ${selectedCount} 条文本`);
      base.clearSelection();
      await loadPastes();
    });
  };

  /**
   * 清理所有已过期文本（管理员）
   */
  const clearExpiredPastes = async () => {
    if (!isAdmin.value) {
      base.showError("只有管理员可以清理过期文本");
      return;
    }

    if (!confirm("确认要清理所有已过期文本吗？此操作不可恢复")) {
      return;
    }

    return base.withLoading(async () => {
      const message = await pasteService.clearExpiredPastes();
      base.showSuccess(message || "已清理过期文本");
      await loadPastes();
    });
  };

  /**
   * 打开预览弹窗并加载完整内容
   * @param {Paste} paste
   */
  const openPreview = async (paste) => {
    try {
      // 加载完整的文本详情（包含 content 字段）
      const detail = await pasteService.getPasteById(paste.id);
      previewPaste.value = detail;
      showPreview.value = true;
    } catch (err) {
      console.error("获取文本详情失败:", err);
      base.showError("获取文本详情失败");
    }
  };

  const closePreview = () => {
    showPreview.value = false;
    previewPaste.value = null;
  };

  /**
   * 打开编辑弹窗并加载详情
   * @param {Paste} paste
   */
  const openEditModal = async (paste) => {
    try {
      const detail = await pasteService.getPasteById(paste.id);
      editingPaste.value = detail;
      showEdit.value = true;
    } catch (err) {
      console.error("获取文本详情失败:", err);
      base.showError("获取文本详情失败");
    }
  };

  const closeEditModal = () => {
    showEdit.value = false;
    editingPaste.value = null;
  };

  /**
   * 提交编辑修改
   * @param {Partial<Paste>} updated
   */
  const submitEdit = async (updated) => {
    if (updated && updated.error) {
      base.showError(updated.error);
      return;
    }

    if (!editingPaste.value || !editingPaste.value.slug) {
      base.showError("提交失败：缺少文本标识");
      return;
    }

    return base.withLoading(async () => {
      try {
        const payload = {
          content: Object.prototype.hasOwnProperty.call(updated, "content") ? updated.content : editingPaste.value.content,
          remark: Object.prototype.hasOwnProperty.call(updated, "remark") ? updated.remark : editingPaste.value.remark,
          max_views: Object.prototype.hasOwnProperty.call(updated, "max_views") ? updated.max_views : editingPaste.value.max_views,
          expires_at: Object.prototype.hasOwnProperty.call(updated, "expires_at") ? updated.expires_at : editingPaste.value.expires_at,
        };

        if (Object.prototype.hasOwnProperty.call(updated, "newSlug")) {
          payload.newSlug = updated.newSlug;
        }

        if (updated.password) {
          payload.password = updated.password;
        } else if (updated.clearPassword) {
          payload.clearPassword = true;
        }

        await pasteService.updatePaste(editingPaste.value.slug, payload);
        base.showSuccess("更新成功");
        await loadPastes();
        closeEditModal();
      } catch (err) {
        console.error("更新文本失败:", err);
        base.showError(err.message || "更新文本失败");
      }
    });
  };

  /**
   * 复制访问链接
   * @param {Paste} paste
   */
  const resolvePasteContext = (payload) => {
    if (!payload) return { slug: "", id: null };
    if (typeof payload === "string") {
      const found = pastes.value.find((item) => item.slug === payload);
      return { slug: payload, id: found?.id ?? null };
    }
    return { slug: payload.slug || "", id: payload.id ?? null };
  };

  const copyLink = async (payload) => {
    const { slug, id } = resolvePasteContext(payload);
    if (!slug) {
      base.showError("复制失败：缺少文本标识");
      return;
    }

    const baseUrl = window.location.origin;
    const link = `${baseUrl}/paste/${slug}`;

    try {
      const ok = await copyToClipboard(link);
      if (ok) {
        const key = id ?? slug;
        copiedTexts[key] = true;
        base.showSuccess("访问链接已复制");
        setTimeout(() => {
          copiedTexts[key] = false;
        }, 2000);
      } else {
        base.showError("复制访问链接失败");
      }
    } catch (err) {
      console.error("复制访问链接失败:", err);
      base.showError("复制访问链接失败");
    }
  };

  /**
   * 复制 Raw 链接
   * @param {Paste} paste
   */
  const copyRawLink = async (paste) => {
    if (!paste || !paste.slug) {
      base.showError("复制失败：缺少文本标识");
      return;
    }

    try {
      const rawLink = pasteService.getRawPasteUrl(paste.slug, paste.plain_password || null);
      const ok = await copyToClipboard(rawLink);
      if (ok) {
        copiedRawTexts[paste.slug] = true;
        base.showSuccess("Raw 链接已复制");
        setTimeout(() => {
          copiedRawTexts[paste.slug] = false;
        }, 2000);
      } else {
        base.showError("复制 Raw 链接失败");
      }
    } catch (err) {
      console.error("复制 Raw 链接失败:", err);
      base.showError("复制 Raw 链接失败");
    }
  };

  /**
   * 打开公共访问页
   * @param {string} slug
   */
  const goToViewPage = (slug) => {
    const baseUrl = window.location.origin;
    const viewUrl = `${baseUrl}/paste/${slug}`;
    window.open(viewUrl, "_blank");
  };

  /**
   * 生成并显示二维码
   * @param {string} slug
   * @param {boolean} darkMode
   */
  const showQRCode = async (slug, darkMode = false) => {
    try {
      if (!slug) {
        base.showError("生成二维码失败：缺少文本标识信息");
        return;
      }

      const baseUrl = window.location.origin;
      const pasteUrl = `${baseUrl}/paste/${slug}`;

      qrCodeDataURL.value = await createQRCodeImage(pasteUrl, { darkMode });
      qrCodeSlug.value = slug;
      showQRCodeModal.value = true;
    } catch (err) {
      console.error("生成二维码失败:", err);
      base.showError("生成二维码失败");
    }
  };

  /**
   * 切换全选状态（按 id 字段）
   */
  const toggleSelectAll = () => {
    base.toggleSelectAll(pastes.value, "id");
  };

  /**
   * 搜索文本列表
   * @param {string} searchTerm
   * @param {number|null} [offset]
   * @returns {Promise<{results: Paste[], pagination: PaginationInfo}>}
   */
  const searchPastes = async (searchTerm, offset = null) => {
    if (!searchTerm || searchTerm.trim().length < 2) {
      return { results: [], pagination: /** @type {PaginationInfo} */ ({ total: 0, limit: base.pagination.limit, offset: 0 }) };
    }

    const searchOffset = offset !== null ? offset : base.pagination.offset;

    return base.withLoading(async () => {
      try {
        const { items, pagination } = await pasteService.getPastes({
          limit: base.pagination.limit,
          offset: searchOffset,
          search: searchTerm.trim(),
        });

        return {
          results: items,
          pagination: pagination || /** @type {PaginationInfo} */ ({
            total: items.length,
            limit: base.pagination.limit,
            offset: searchOffset,
          }),
        };
      } catch (err) {
        base.showError(err.message || "搜索失败");
        return {
          results: [],
          pagination: /** @type {PaginationInfo} */ ({
            total: 0,
            limit: base.pagination.limit,
            offset: searchOffset,
          }),
        };
      }
    });
  };

  /**
   * 关闭所有弹窗
   */
  const closeAllModals = () => {
    showPreview.value = false;
    showEdit.value = false;
    showQRCodeModal.value = false;
    previewPaste.value = null;
    editingPaste.value = null;
    qrCodeDataURL.value = "";
    qrCodeSlug.value = "";
  };

  return {
    // 继承 admin base
    ...base,

    // 文本管理状态
    pastes,
    previewPaste,
    editingPaste,
    showPreview,
    showEdit,
    showQRCodeModal,
    qrCodeDataURL,
    qrCodeSlug,
    copiedTexts,
    copiedRawTexts,

    // 权限状态
    isAdmin,
    isApiKeyUser,
    isAuthorized,

    // 操作
    loadPastes,
    searchPastes,
    handleOffsetChange,
    deletePaste,
    batchDeletePastes,
    clearExpiredPastes,
    openPreview,
    closePreview,
    openEditModal,
    closeEditModal,
    submitEdit,
    copyLink,
    copyRawLink,
    goToViewPage,
    showQRCode,
    toggleSelectAll,
    closeAllModals,
  };
}
