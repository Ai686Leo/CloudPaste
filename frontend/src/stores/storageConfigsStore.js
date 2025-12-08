/**
 * Storage Configs Store
 * 统一管理上传/挂载等模块需要的存储配置、缓存和类型 schema
 */

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { api } from "@/api";

const CACHE_TTL = 5 * 60 * 1000; // 5 分钟缓存
const FETCH_LIMIT = 200; // 通常足够覆盖所有配置

// 存储类型 schema，可后续扩展字段渲染/校验
const STORAGE_TYPE_SCHEMA = {
  S3: {
    type: "S3",
    label: "对象存储 (S3 兼容)",
    description: "支持 Cloudflare R2、B2、AWS S3 等对象存储，具备直传与预签名能力",
    capabilities: {
      multipart: true,
      presigned: true,
      requiresProxy: false,
      preview: "signed-url",
    },
  },
  ONEDRIVE: {
    type: "ONEDRIVE",
    label: "OneDrive 存储",
    description: "基于 Microsoft OneDrive / Graph API 的云存储，支持预签名直传",
    capabilities: {
      multipart: false,
      presigned: true,
      requiresProxy: false,
      preview: "signed-url",
    },
  },
  WEBDAV: {
    type: "WEBDAV",
    label: "WebDAV",
    description: "通过 WebDAV 网关读写文件，暂不支持分片直传",
    capabilities: {
      multipart: false,
      presigned: false,
      requiresProxy: true,
      preview: "proxy",
    },
  },
  LOCAL: {
    type: "LOCAL",
    label: "本地存储",
    description: "直接挂载服务器本地磁盘，通常仅用于自托管",
    capabilities: {
      multipart: false,
      presigned: false,
      requiresProxy: true,
      preview: "proxy",
    },
  },
  UNKNOWN: {
    type: "UNKNOWN",
    label: "未指定类型",
    description: "缺少 storage_type 字段，仅提供基础信息",
    capabilities: {
      multipart: false,
      presigned: false,
      requiresProxy: true,
      preview: "proxy",
    },
  },
};

export const useStorageConfigsStore = defineStore("storageConfigs", () => {
  const configs = ref([]);
  const lastLoadedAt = ref(0);
  const isLoading = ref(false);
  const error = ref(null);

  let inflightPromise = null;

  const hasFreshCache = computed(() => {
    if (!configs.value.length || !lastLoadedAt.value) return false;
    return Date.now() - lastLoadedAt.value < CACHE_TTL;
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
        console.error("加载存储配置失败", err);
        error.value = err;
        throw err;
      })
      .finally(() => {
        isLoading.value = false;
        inflightPromise = null;
      });

    return inflightPromise;
  };

  const refreshConfigs = async () => {
    lastLoadedAt.value = 0;
    return loadConfigs({ force: true });
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
    if (!type) return STORAGE_TYPE_SCHEMA.UNKNOWN;
    return STORAGE_TYPE_SCHEMA[type] || STORAGE_TYPE_SCHEMA.UNKNOWN;
  };

  const getStorageTypeLabel = (type) => getStorageTypeMeta(type).label;

  const formatProviderLabel = (config) => {
    if (!config) return "";
    const typeMeta = getStorageTypeMeta(config.storage_type);
    if (config.provider_type) {
      return `${config.provider_type} · ${typeMeta.label}`;
    }
    return typeMeta.label;
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

    // schema
    storageTypeSchema: STORAGE_TYPE_SCHEMA,

    // 业务方法
    loadConfigs,
    refreshConfigs,
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
