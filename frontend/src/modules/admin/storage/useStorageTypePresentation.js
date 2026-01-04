import { computed, onMounted } from "vue";
import { useStorageConfigsStore } from "@/stores/storageConfigsStore.js";

/**
 * Admin 存储类型展示/样式 helper
 * - 统一从 /api/storage-types 加载元数据
 * - 基于 ui.icon / ui.badgeTheme / i18nKey 计算展示文案与 badge class
 */

const BADGE_THEME_CLASS = {
  s3: {
    light: "bg-blue-100 text-blue-800",
    dark: "bg-blue-700 text-blue-100",
  },
  webdav: {
    light: "bg-green-100 text-green-800",
    dark: "bg-green-700 text-green-100",
  },
  onedrive: {
    light: "bg-sky-100 text-sky-800",
    dark: "bg-sky-700 text-sky-100",
  },
  googledrive: {
    light: "bg-red-100 text-red-800",
    dark: "bg-red-700 text-red-100",
  },
  github: {
    light: "bg-gray-900 text-white",
    dark: "bg-gray-100 text-gray-900",
  },
  local: {
    light: "bg-gray-100 text-gray-800",
    dark: "bg-gray-700 text-gray-100",
  },
  telegram: {
    light: "bg-sky-100 text-sky-700",
    dark: "bg-sky-800 text-sky-100",
  },
  discord: {
    light: "bg-indigo-100 text-indigo-800",
    dark: "bg-indigo-700 text-indigo-100",
  },
  huggingface: {
    light: "bg-yellow-100 text-yellow-800",
    dark: "bg-yellow-700 text-yellow-100",
  },
  mirror: {
    light: "bg-purple-100 text-purple-800",
    dark: "bg-purple-700 text-purple-100",
  },
  default: {
    light: "bg-gray-100 text-gray-700",
    dark: "bg-gray-700 text-gray-300",
  },
};

export function useStorageTypePresentation() {
  const storageConfigsStore = useStorageConfigsStore();

  onMounted(() => {
    void storageConfigsStore.loadStorageTypes().catch(() => null);
  });

  const storageTypesMeta = computed(() => storageConfigsStore.storageTypesMeta || []);
  const loading = computed(() => !!storageConfigsStore.storageTypesLoading);

  const getTypeMeta = (type) => storageTypesMeta.value.find((m) => m.type === type) || null;

  const getTypeLabel = (type, t) => {
    if (!type || type === "__UNSPECIFIED__") {
      return "未指定类型";
    }
    const meta = getTypeMeta(type);
    if (meta?.ui?.i18nKey && typeof t === "function") {
      return t(meta.ui.i18nKey);
    }
    if (meta?.displayName) {
      return meta.displayName;
    }
    return type;
  };

  const getBadgeClass = (type, darkModeValue = false) => {
    const theme = getTypeMeta(type)?.ui?.badgeTheme || "default";
    const entry = BADGE_THEME_CLASS[theme] || BADGE_THEME_CLASS.default;
    return darkModeValue ? entry.dark : entry.light;
  };

  const ensureLoaded = async () => {
    await storageConfigsStore.loadStorageTypes().catch(() => null);
  };

  const storageTypeOptions = computed(() =>
    storageTypesMeta.value.map((meta) => ({
      value: meta.type,
      meta,
    })),
  );

  return {
    storageTypesMeta,
    storageTypeOptions,
    getTypeMeta,
    getTypeLabel,
    getBadgeClass,
    ensureLoaded,
    loading,
  };
}

