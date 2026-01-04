/**
 * Storage Configs Store
 * 统一管理上传/挂载等模块需要的存储配置、缓存和类型 schema
 */

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { api } from "@/api";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("StorageConfigsStore");

const CACHE_TTL = 5 * 60 * 1000; // 5 分钟缓存
const FETCH_LIMIT = 200; // 通常足够覆盖所有配置

export const useStorageConfigsStore = defineStore("storageConfigs", () => {
  const configs = ref([]);
  const lastLoadedAt = ref(0);
  const isLoading = ref(false);
  const error = ref(null);

  let inflightPromise = null;

  // 存储类型元数据：以 /api/storage-types 为唯一真相
  const storageTypesMeta = ref([]);
  const storageTypesLastLoadedAt = ref(0);
  const storageTypesLoading = ref(false);
  let inflightStorageTypesPromise = null;

  const hasFreshCache = computed(() => {
    if (!configs.value.length || !lastLoadedAt.value) return false;
    return Date.now() - lastLoadedAt.value < CACHE_TTL;
  });

  const hasFreshStorageTypesCache = computed(() => {
    if (!storageTypesMeta.value.length || !storageTypesLastLoadedAt.value) return false;
    return Date.now() - storageTypesLastLoadedAt.value < CACHE_TTL;
  });

  const sortedConfigs = computed(() => {
    const clone = [...configs.value];
    return clone.sort((a, b) => {
      const aDefault = a?.is_default ? 0 : 1;
      const bDefault = b?.is_default ? 0 : 1;
      if (aDefault !== bDefault) return aDefault - bDefault;
      const aActive = a?.is_active === false ? 1 : 0;
      const bActive = b?.is_active === false ? 1 : 0;
      if (aActive !== bActive) return aActive - bActive;
      return (a?.name || "").localeCompare(b?.name || "");
    });
  });

  const storageConfigMap = computed(() => {
    const map = new Map();
    configs.value.forEach((config) => {
      if (config?.id !== undefined && config?.id !== null) {
        map.set(config.id, config);
      }
    });
    return map;
  });

  const defaultConfig = computed(() => sortedConfigs.value.find((config) => config?.is_default));
  const publicConfigs = computed(() => sortedConfigs.value.filter((config) => config?.is_public));
  const availableStorageTypes = computed(() => {
    const set = new Set();
    sortedConfigs.value.forEach((config) => {
      if (config?.storage_type) {
        set.add(config.storage_type);
      }
    });
    return Array.from(set);
  });

  const normalizeResponse = (payload) => {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;

    const possibleArrays = [
      payload.data,
      payload.result,
      payload.items,
      payload.records,
      payload?.data?.data,
      payload?.data?.items,
      payload?.data?.records,
    ];

    for (const candidate of possibleArrays) {
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }

    return [];
  };

  const replaceConfigs = (list = []) => {
    configs.value = Array.isArray(list) ? list : [];
    lastLoadedAt.value = Date.now();
  };

  const shouldReuseCache = (force) => {
    if (force) return false;
    return hasFreshCache.value;
  };

  const loadConfigs = async ({ force = false, limit = FETCH_LIMIT } = {}) => {
    if (shouldReuseCache(force)) {
      return configs.value;
    }

    if (inflightPromise) {
      return inflightPromise;
    }

    isLoading.value = true;
    error.value = null;

    inflightPromise = api.storage
      .getStorageConfigs({ limit })
      .then((response) => {
        const normalized = normalizeResponse(response);
        replaceConfigs(normalized);
        return configs.value;
      })
      .catch((err) => {
        log.error("加载存储配置失败", err);
        error.value = err;
        throw err;
      })
      .finally(() => {
        isLoading.value = false;
        inflightPromise = null;
      });

    return inflightPromise;
  };

  const normalizeStorageTypesResponse = (payload) => {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.result)) return payload.result;
    return [];
  };

  const loadStorageTypes = async ({ force = false } = {}) => {
    if (!force && hasFreshStorageTypesCache.value) {
      return storageTypesMeta.value;
    }

    if (inflightStorageTypesPromise) {
      return inflightStorageTypesPromise;
    }

    storageTypesLoading.value = true;
    inflightStorageTypesPromise = api.mount
      .getStorageTypes()
      .then((resp) => {
        storageTypesMeta.value = normalizeStorageTypesResponse(resp);
        storageTypesLastLoadedAt.value = Date.now();
        return storageTypesMeta.value;
      })
      .catch((err) => {
        log.error("加载存储类型元数据失败", err);
        storageTypesMeta.value = [];
        throw err;
      })
      .finally(() => {
        storageTypesLoading.value = false;
        inflightStorageTypesPromise = null;
      });

    return inflightStorageTypesPromise;
  };

  const ensureStorageTypesLoaded = () => {
    if (storageTypesLoading.value || hasFreshStorageTypesCache.value) return;
    void loadStorageTypes().catch(() => null);
  };

  const refreshConfigs = async () => {
    lastLoadedAt.value = 0;
    return loadConfigs({ force: true });
  };

  const refreshStorageTypes = async () => {
    storageTypesLastLoadedAt.value = 0;
    return await loadStorageTypes({ force: true });
  };

  const invalidateCache = () => {
    lastLoadedAt.value = 0;
  };

  const getConfigById = (configId) => {
    return storageConfigMap.value.get(configId) || null;
  };

  const getDefaultConfigId = () => defaultConfig.value?.id || null;

  const upsertConfig = (config) => {
    if (!config || !config.id) return;
    const index = configs.value.findIndex((item) => item.id === config.id);
    if (index === -1) {
      configs.value.push(config);
    } else {
      configs.value.splice(index, 1, { ...configs.value[index], ...config });
    }
  };

  const removeConfig = (configId) => {
    const idx = configs.value.findIndex((item) => item.id === configId);
    if (idx !== -1) {
      configs.value.splice(idx, 1);
    }
  };

  const getStorageTypeMeta = (type) => {
    ensureStorageTypesLoaded();
    const normalized = typeof type === "string" ? type.trim() : "";
    if (!normalized) return null;
    return storageTypesMeta.value.find((m) => m?.type === normalized) || null;
  };

  const getStorageTypeLabel = (type) => {
    const normalized = typeof type === "string" ? type.trim() : "";
    if (!normalized) return "未指定类型";
    const meta = getStorageTypeMeta(normalized);
    return meta?.displayName || meta?.type || normalized;
  };

  const formatProviderLabel = (config) => {
    if (!config) return "";
    const typeLabel = getStorageTypeLabel(config.storage_type);
    if (config.provider_type) {
      return `${config.provider_type} · ${typeLabel}`;
    }
    return typeLabel;
  };

  return {
    // 状态
    configs,
    sortedConfigs,
    publicConfigs,
    isLoading,
    lastLoadedAt,
    error,
    hasFreshCache,
    availableStorageTypes,
    defaultConfig,
    storageTypesMeta,
    storageTypesLoading,

    // 业务方法
    loadConfigs,
    refreshConfigs,
    loadStorageTypes,
    refreshStorageTypes,
    invalidateCache,
    replaceConfigs,
    getConfigById,
    getDefaultConfigId,
    upsertConfig,
    removeConfig,
    getStorageTypeMeta,
    getStorageTypeLabel,
    formatProviderLabel,
  };
});
