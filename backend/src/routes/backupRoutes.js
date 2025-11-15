import { Hono } from "hono";
import { ValidationError } from "../http/errors.js";
import { BackupService } from "../services/BackupService.js";
import { ApiStatus, UserType } from "../constants/index.js";
import { jsonOk } from "../utils/common.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";

const backupRoutes = new Hono();
const requireAdmin = usePolicy("admin.all");

/**
 * 创建备份
 * POST /api/admin/backup/create
 */
backupRoutes.post("/api/admin/backup/create", requireAdmin, async (c) => {
  const body = await c.req.json();
  const { backup_type = "full", selected_modules = [] } = body;

  if (backup_type === "modules" && (!selected_modules || selected_modules.length === 0)) {
    throw new ValidationError("模块备份必须选择至少一个模块");
  }

  const backupService = new BackupService(c.env.DB);
  const backupData = await backupService.createBackup({
    backup_type,
    selected_modules,
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `cloudpaste-${backup_type}-${timestamp}.json`;

  return new Response(JSON.stringify(backupData, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-cache",
    },
  });
});

/**
 * 还原备份
 * POST /api/admin/backup/restore
 */
backupRoutes.post("/api/admin/backup/restore", requireAdmin, async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("backup_file");
  const mode = formData.get("mode") || "overwrite";

  if (!file) {
    throw new ValidationError("请选择备份文件");
  }

  if (!file.name.endsWith(".json")) {
    throw new ValidationError("只支持JSON格式的备份文件");
  }

  const fileContent = await file.text();
  const backupData = await Promise.resolve()
    .then(() => JSON.parse(fileContent))
    .catch(() => {
      throw new ValidationError("备份文件格式错误，请确保是有效的JSON文件");
    });

  const backupService = new BackupService(c.env.DB);
  const { userId: currentAdminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const skipIntegrityCheck = formData.get("skipIntegrityCheck") === "true";
  const preserveTimestamps = formData.get("preserveTimestamps") === "true";

  const result = await backupService.restoreBackup(backupData, {
    mode,
    currentAdminId,
    skipIntegrityCheck,
    preserveTimestamps,
  });

  return jsonOk(
    c,
    {
      restored_tables: result.restored_tables,
      total_records: result.total_records,
      results: result.results,
      mode,
      backup_info: {
        backup_type: backupData.metadata.backup_type,
        timestamp: backupData.metadata.timestamp,
      },
    },
    "数据还原成功"
  );
});

/**
 * 获取备份模块信息
 * GET /api/admin/backup/modules
 */
backupRoutes.get("/api/admin/backup/modules", requireAdmin, async (c) => {
  const backupService = new BackupService(c.env.DB);
  const modules = await backupService.getModulesInfo();

  return jsonOk(c, { modules }, "获取模块信息成功");
});

export { backupRoutes };
