import { ref, computed, onMounted } from "vue";
import { api } from "@/api";

/**
 * Admin 存储类型展示/样式 helper
 * - 统一从 /api/storage-types 加载元数据
 * - 基于 ui.icon / ui.badgeTheme / i18nKey 计算展示文案与 badge class
 */

const storageTypesMeta = ref([]);
const loading = ref(false);
let loaded = false;

async function ensureLoadedInternal() {
  if (loaded || loading.value) return;
  loading.value = true;
  try {
    const resp = await api.mount.getStorageTypes();
    storageTypesMeta.value = Array.isArray(resp?.data) ? resp.data : Array.isArray(resp) ? resp : [];
    loaded = true;
  } catch (e) {
    console.error("加载存储类型元数据失败(useStorageTypePresentation):", e);
    storageTypesMeta.value = [];
  } finally {
    loading.value = false;
  }
}

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
  local: {
    light: "bg-gray-100 text-gray-800",
    dark: "bg-gray-700 text-gray-100",
  },
  default: {
    light: "bg-gray-100 text-gray-700",
    dark: "bg-gray-700 text-gray-300",
  },
};

function resolveBadgeTheme(type) {
  const meta = storageTypesMeta.value.find((m) => m.type === type);
  const theme = meta?.ui?.badgeTheme;
  if (theme) return theme;

  // 兼容旧的类型字符串
  switch (type) {
    case "S3":
      return "s3";
    case "WebDAV":
    case "WEBDAV":
      return "webdav";
    case "ONEDRIVE":
      return "onedrive";
    case "GOOGLE_DRIVE":
      return "googledrive";
    case "LOCAL":
      return "local";
    default:
      return "default";
  }
}

export function useStorageTypePresentation() {
  onMounted(() => {
    ensureLoadedInternal();
  });

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
    const theme = resolveBadgeTheme(type);
    const entry = BADGE_THEME_CLASS[theme] || BADGE_THEME_CLASS.default;
    return darkModeValue ? entry.dark : entry.light;
  };

  const ensureLoaded = async () => {
    await ensureLoadedInternal();
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

