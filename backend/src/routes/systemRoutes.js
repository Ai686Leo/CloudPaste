import { Hono } from "hono";
import { ValidationError, NotFoundError } from "../http/errors.js";
import {
  getMaxUploadSize,
  getDashboardStats,
  getSettingsByGroup,
  getAllSettingsByGroups,
  getGroupsInfo,
  updateGroupSettings,
  getSettingMetadata,
} from "../services/systemService.js";
import { ApiStatus, UserType } from "../constants/index.js";
import { getQueryBool, jsonOk } from "../utils/common.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";

const systemRoutes = new Hono();
const requireAdmin = usePolicy("admin.all");

// 获取最大上传文件大小限制（公共API）
systemRoutes.get("/api/system/max-upload-size", async (c) => {
  const db = c.env.DB;
  const repositoryFactory = c.get("repos");

  const size = await getMaxUploadSize(db, repositoryFactory);

  return jsonOk(c, { max_upload_size: size }, "获取最大上传大小成功");
});

// 仪表盘统计数据API
systemRoutes.get("/api/admin/dashboard/stats", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const repositoryFactory = c.get("repos");
  const stats = await getDashboardStats(db, adminId, repositoryFactory);

  return jsonOk(c, stats, "获取仪表盘统计数据成功");
});

// 获取系统版本信息（公共API）
systemRoutes.get("/api/version", async (c) => {
  // 判断运行环境和数据存储
  const runtimeEnv = process.env.RUNTIME_ENV || "unknown";
  const isDocker = runtimeEnv === "docker";

  // 统一的默认版本配置
  const DEFAULT_VERSION = "0.9.0";
  const DEFAULT_NAME = "cloudpaste-api";

  let version = DEFAULT_VERSION;
  let name = DEFAULT_NAME;

  // 根据环境获取版本信息
  if (isDocker) {
    const packageJson = await (async () => {
      const fs = await import("fs");
      const path = await import("path");
      const packagePath = path.resolve("./package.json");
      const packageContent = await fs.promises.readFile(packagePath, "utf8");
      return JSON.parse(packageContent);
    })().catch((error) => {
      console.warn("Docker环境读取package.json失败，使用默认值:", error.message);
      return null;
    });

    if (packageJson) {
      version = packageJson.version || DEFAULT_VERSION;
      name = packageJson.name || DEFAULT_NAME;
    }
  } else {
    // Workers环境：使用环境变量或默认值
    version = process.env.APP_VERSION || DEFAULT_VERSION;
    name = process.env.APP_NAME || DEFAULT_NAME;
  }

  const versionInfo = {
    version,
    name,
    environment: isDocker ? "Docker" : "Cloudflare Workers",
    storage: isDocker ? "SQLite" : "Cloudflare D1",
    nodeVersion: process.version || "unknown",
    uptime: Math.round(process.uptime()),
  };

  return jsonOk(c, versionInfo, "获取版本信息成功");
});

// ==================== 新增：分组设置管理API接口 ====================

// 按分组获取设置项（公开访问，无需认证）
systemRoutes.get("/api/admin/settings", async (c) => {
  const db = c.env.DB;
  const repositoryFactory = c.get("repos");
  const groupId = c.req.query("group");
  const includeMetadata = getQueryBool(c, "metadata", true);

  if (groupId) {
    const groupIdNum = parseInt(groupId, 10);
    if (Number.isNaN(groupIdNum)) {
      throw new ValidationError("分组ID必须是数字");
    }

    const settings = await getSettingsByGroup(db, groupIdNum, includeMetadata, repositoryFactory);
    return jsonOk(c, settings, "获取分组设置成功");
  }

  const includeSystemGroup = getQueryBool(c, "includeSystem", false);
  const groupedSettings = await getAllSettingsByGroups(db, includeSystemGroup, repositoryFactory);

  return jsonOk(c, groupedSettings, "获取所有分组设置成功");
});

// 获取分组列表和统计信息
systemRoutes.get("/api/admin/settings/groups", requireAdmin, async (c) => {
  const db = c.env.DB;
  const repositoryFactory = c.get("repos");
  const groupsInfo = await getGroupsInfo(db, repositoryFactory);

  return jsonOk(c, { groups: groupsInfo }, "获取分组信息成功");
});

// 获取设置项元数据
systemRoutes.get("/api/admin/settings/metadata", requireAdmin, async (c) => {
  const db = c.env.DB;
  const repositoryFactory = c.get("repos");
  const key = c.req.query("key");
  if (!key) {
    throw new ValidationError("缺少设置键名参数");
  }

  const metadata = await getSettingMetadata(db, key, repositoryFactory);
  if (!metadata) {
    throw new NotFoundError("设置项不存在");
  }

  return jsonOk(c, metadata, "获取设置元数据成功");
});

// 按分组批量更新设置
systemRoutes.put("/api/admin/settings/group/:groupId", requireAdmin, async (c) => {
  const db = c.env.DB;
  const repositoryFactory = c.get("repos");
  const groupId = parseInt(c.req.param("groupId"), 10);
  if (Number.isNaN(groupId)) {
    throw new ValidationError("分组ID必须是数字");
  }

  const body = await c.req.json();
  if (!body || typeof body !== "object") {
    throw new ValidationError("请求参数无效");
  }

  const validateType = getQueryBool(c, "validate", true);
  const result = await updateGroupSettings(db, groupId, body, { validateType }, repositoryFactory);

  return jsonOk(c, result, result.message);
});

export default systemRoutes;

