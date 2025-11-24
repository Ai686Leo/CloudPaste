import { useStorageConfigsStore } from "@/stores/storageConfigsStore.js";
import { DRIVER_TYPES, DriverResolutionError } from "./types.js";
import { S3Driver } from "./s3/S3Driver.js";
import { WebDavDriver } from "./webdav/WebDavDriver.js";

// 存储驱动工厂
const driverFactories = new Map([
  [DRIVER_TYPES.S3, (config) => new S3Driver(config)],
  [DRIVER_TYPES.WEBDAV, (config) => new WebDavDriver(config)],
]);

const driverCache = new Map();

const buildCacheKey = (configId) => `driver:${configId}`;

// 注册存储驱动
export function registerStorageDriver(type, factory) {
  driverFactories.set(type, factory);
}

// 失效驱动缓存
export function invalidateDriverCache(configId) {
  if (typeof configId === "number" || typeof configId === "string") {
    driverCache.delete(buildCacheKey(configId));
    return;
  }
  driverCache.clear();
}

// 根据类型和配置解析驱动
export function resolveDriverByType(type, config) {
  if (!type) {
    throw new DriverResolutionError("缺少 storage_type，无法解析存储驱动", { code: "MISSING_TYPE" });
  }

  const normalizedType = type.toUpperCase();
  const factory = driverFactories.get(normalizedType);
  if (!factory) {
    throw new DriverResolutionError(`未注册的存储驱动: ${normalizedType}`, {
      code: "UNSUPPORTED_TYPE",
      meta: { type: normalizedType },
    });
  }
  return factory(config || {});
}

// 根据配置ID解析驱动
export function resolveDriverByConfigId(configId) {
  if (configId === undefined || configId === null || configId === "") {
    throw new DriverResolutionError("storage_config_id 不能为空", { code: "MISSING_CONFIG_ID" });
  }

  const cacheKey = buildCacheKey(configId);
  if (driverCache.has(cacheKey)) {
    return driverCache.get(cacheKey);
  }

  const store = useStorageConfigsStore();
  const config = store.getConfigById(Number(configId)) || store.getConfigById(configId);

  if (!config) {
    throw new DriverResolutionError(`未找到存储配置: ${configId}`, {
      code: "CONFIG_NOT_FOUND",
      meta: { configId },
    });
  }

  const driver = resolveDriverByType(config.storage_type || DRIVER_TYPES.S3, config);
  driverCache.set(cacheKey, driver);
  return driver;
}

