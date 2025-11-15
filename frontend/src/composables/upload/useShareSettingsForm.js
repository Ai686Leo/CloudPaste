import { reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStorageConfigsStore } from "@/stores/storageConfigsStore.js";

const SLUG_REGEX = /^[a-zA-Z0-9._-]+$/;

const DEFAULT_FORM_STATE = () => ({
  storage_config_id: "",
  slug: "",
  path: "",
  remark: "",
  password: "",
  expires_in: "0",
  max_views: 0,
});

export function useShareSettingsForm(options = {}) {
  const store = useStorageConfigsStore();
  const { t } = useI18n();

  const formData = reactive(DEFAULT_FORM_STATE());
  const slugError = ref("");

  const pickFirstConfigId = () => {
    const list = store.sortedConfigs;
    if (!list || list.length === 0) return "";
    const defaultConfig = store.defaultConfig;
    return (defaultConfig && defaultConfig.id) || list[0].id;
  };

  const selectDefaultStorageConfig = () => {
    if (formData.storage_config_id) {
      const exists = store.sortedConfigs.some((config) => config.id === formData.storage_config_id);
      if (exists) return formData.storage_config_id;
    }
    const fallbackId = pickFirstConfigId();
    formData.storage_config_id = fallbackId ?? "";
    return formData.storage_config_id;
  };

  watch(
    () => store.sortedConfigs.map((config) => config.id),
    () => {
      selectDefaultStorageConfig();
    },
    { immediate: true }
  );

  const validateSlug = () => {
    slugError.value = "";
    if (!formData.slug) {
      return true;
    }
    if (!SLUG_REGEX.test(formData.slug)) {
      slugError.value = t("file.messages.slugInvalid");
      return false;
    }
    return true;
  };

  const handleSlugInput = (value) => {
    formData.slug = (value || "").trim();
    validateSlug();
  };

  const handleMaxViewsInput = (value) => {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      formData.max_views = parsed;
    } else {
      formData.max_views = 0;
    }
  };

  const resetShareSettings = ({ keepStorage = true } = {}) => {
    const storageId = keepStorage ? formData.storage_config_id : "";
    Object.assign(formData, DEFAULT_FORM_STATE());
    formData.storage_config_id = storageId;
    if (!keepStorage) {
      selectDefaultStorageConfig();
    }
    slugError.value = "";
  };

  return {
    formData,
    slugError,
    validateSlug,
    handleSlugInput,
    handleMaxViewsInput,
    selectDefaultStorageConfig,
    resetShareSettings,
  };
}

