import { resolveDriverByConfigId, resolveDriverByType } from "@/modules/storage-core/drivers/registry.js";
import { DRIVER_TYPES, STORAGE_STRATEGIES, STORAGE_SOURCES, DEFAULT_DRIVER_CAPABILITIES } from "@/modules/storage-core/drivers/types.js";
import { useUploaderClient } from "@/modules/storage-core/useUploaderClient.js";

/**
 * storage-core 模块入口
 *
 * - 作为存储驱动与上传管线的领域入口
 * - 对外暴露 driver registry 与 uploader client
 *
 */

export {
  // driver registry
  resolveDriverByConfigId,
  resolveDriverByType,

  // driver 常量
  DRIVER_TYPES,
  STORAGE_STRATEGIES,
  STORAGE_SOURCES,
  DEFAULT_DRIVER_CAPABILITIES,

  // uploader client
  useUploaderClient,
};
