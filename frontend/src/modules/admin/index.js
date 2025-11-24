// Admin 模块统一入口
// - 为外部调用方提供统一的 admin service / 管理类 composable 入口
// - 避免在视图层到处引用深层路径，保持依赖清晰

// 系统与设置相关服务
import { useAdminSystemService } from "./services/systemService.js";
import { useAdminStorageConfigService } from "./services/storageConfigService.js";
import { useAdminMountService } from "./services/mountService.js";

// 备份与仪表盘
import { useAdminBackupService } from "./services/backupService.js";
import { useDashboardService } from "./services/dashboardService.js";

// 账户与 API Key
import { useAdminAccountService } from "./services/accountService.js";
import { useAdminApiKeyService } from "./services/apiKeyService.js";

// 挂载 / 存储配置管理 composable
import { useMountManagement } from "./storage/useMountManagement.js";
import { useStorageConfigManagement } from "./storage/useStorageConfigManagement.js";

// FS Meta 元信息管理 composable
import { useFsMetaManagement } from "./composables/useFsMetaManagement.js";

// 基础 admin 通用逻辑（仍位于通用 composables 下）
import { useAdminBase } from "@/composables/admin-management/useAdminBase.js";

export {
  // system / settings
  useAdminSystemService,
  useAdminStorageConfigService,
  useAdminMountService,

  // backup / dashboard
  useAdminBackupService,
  useDashboardService,

  // account / api key
  useAdminAccountService,
  useAdminApiKeyService,

  // storage / mount management composables
  useMountManagement,
  useStorageConfigManagement,

  // fs meta
  useFsMetaManagement,

  // shared admin base
  useAdminBase,
};

export default {
  useAdminSystemService,
  useAdminStorageConfigService,
  useAdminMountService,
  useAdminBackupService,
  useDashboardService,
  useAdminAccountService,
  useAdminApiKeyService,
  useMountManagement,
  useStorageConfigManagement,
  useFsMetaManagement,
  useAdminBase,
};
