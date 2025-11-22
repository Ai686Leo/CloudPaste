/**
 * FS Meta 元信息管理 Composable
 */
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { getAllFsMeta, createFsMeta, updateFsMeta, deleteFsMeta } from "@/api/services/fsMetaService.js";

export function useFsMetaManagement() {
  const { t } = useI18n();

  const metaList = ref([]);
  const loading = ref(false);
  const error = ref(null);

  // 加载所有元信息记录
  const loadMetaList = async () => {
    loading.value = true;
    error.value = null;

    try {
      const response = await getAllFsMeta();
      metaList.value = response.data || [];
    } catch (err) {
      error.value = err.message || t("admin.fsMeta.error.loadFailed");
      console.error("加载元信息列表失败:", err);
    } finally {
      loading.value = false;
    }
  };

  // 创建元信息
  const createMeta = async (data) => {
    loading.value = true;
    error.value = null;

    try {
      await createFsMeta(data);
      await loadMetaList(); // 重新加载列表
      return true;
    } catch (err) {
      error.value = err.message || t("admin.fsMeta.error.createFailed");
      console.error("创建元信息失败:", err);
      return false;
    } finally {
      loading.value = false;
    }
  };

  // 更新元信息
  const updateMeta = async (id, data) => {
    loading.value = true;
    error.value = null;

    try {
      await updateFsMeta(id, data);
      await loadMetaList(); // 重新加载列表
      return true;
    } catch (err) {
      error.value = err.message || t("admin.fsMeta.error.updateFailed");
      console.error("更新元信息失败:", err);
      return false;
    } finally {
      loading.value = false;
    }
  };

  // 删除元信息
  const deleteMeta = async (id) => {
    loading.value = true;
    error.value = null;

    try {
      await deleteFsMeta(id);
      await loadMetaList(); // 重新加载列表
      return true;
    } catch (err) {
      error.value = err.message || t("admin.fsMeta.error.deleteFailed");
      console.error("删除元信息失败:", err);
      return false;
    } finally {
      loading.value = false;
    }
  };

  return {
    metaList,
    loading,
    error,
    loadMetaList,
    createMeta,
    updateMeta,
    deleteMeta,
  };
}
