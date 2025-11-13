import { Hono } from "hono";
import { login, logout, changePassword, testAdminToken } from "../services/adminService.js";
import { ApiStatus, UserType } from "../constants/index.js";
import { directoryCacheManager, urlCacheManager, searchCacheManager } from "../cache/index.js";
import { invalidateFsCache, invalidateAllCaches } from "../cache/invalidation.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";

const adminRoutes = new Hono();
const requireAdmin = usePolicy("admin.all");
const requireMountView = usePolicy("fs.base");

const readCacheStats = async (label, reader) => {
  if (typeof reader !== "function") {
    return { error: `${label}模块未启用` };
  }

  return Promise.resolve()
    .then(() => reader())
    .catch((error) => {
      console.warn(`获取${label}统计失败:`, error);
      return { error: `${label}模块未启用` };
    });
};

// 管理员登录
adminRoutes.post("/api/admin/login", async (c) => {
  const db = c.env.DB;
  const repositoryFactory = c.get("repos");
  const { username, password } = await c.req.json();
  const loginResult = await login(db, username, password, repositoryFactory);

  return c.json({
    code: ApiStatus.SUCCESS,
    message: "登录成功",
    data: loginResult,
  });
});

// 管理员登出 - 不需要认证检查，因为可能令牌已过期
adminRoutes.post("/api/admin/logout", async (c) => {
  const db = c.env.DB;
  const repositoryFactory = c.get("repos");
  const authHeader = c.req.header("Authorization");

  // 如果没有认证头，直接返回成功（前端清理状态）
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({
      code: ApiStatus.SUCCESS,
      message: "登出成功",
    });
  }

  const token = authHeader.substring(7);

  await logout(db, token, repositoryFactory).catch((error) => {
    console.log("登出时清理令牌失败（可能已过期）:", error.message);
  });

  return c.json({
    code: ApiStatus.SUCCESS,
    message: "登出成功",
  });
});

// 更改管理员密码（需要认证）
adminRoutes.post("/api/admin/change-password", requireAdmin, async (c) => {
  const db = c.env.DB;
  const repositoryFactory = c.get("repos");
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const { currentPassword, newPassword, newUsername } = await c.req.json();

  await changePassword(db, adminId, currentPassword, newPassword, newUsername, repositoryFactory);

  return c.json({
    code: ApiStatus.SUCCESS,
    message: "信息更新成功，请重新登录",
  });
});

// 测试管理员令牌路由
adminRoutes.get("/api/test/admin-token", requireAdmin, async (c) => {
  // 使用新的统一认证系统，管理员权限已在中间件中验证
  return c.json({
    code: ApiStatus.SUCCESS,
    message: "令牌有效",
    success: true,
  });
});

// 获取系统监控信息（包括缓存统计和系统内存）
adminRoutes.get("/api/admin/cache/stats", requireAdmin, async (c) => {
  const dirStats = directoryCacheManager.getStats();
  const urlStats = await readCacheStats("URL缓存模块", () => urlCacheManager.getStats());
  const searchStats = await readCacheStats("搜索缓存模块", () => searchCacheManager.getStats());

  const memUsage = process.memoryUsage();
  const systemMemory = {
    rss: Math.round(memUsage.rss / 1024 / 1024),
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
    external: Math.round(memUsage.external / 1024 / 1024),
    arrayBuffers: memUsage.arrayBuffers ? Math.round(memUsage.arrayBuffers / 1024 / 1024) : 0,
    heapUsagePercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
  };

  return c.json({
    code: ApiStatus.SUCCESS,
    message: "获取系统监控信息成功",
    data: {
      cache: {
        directory: dirStats,
        url: urlStats,
        search: searchStats,
      },
      system: {
        memory: systemMemory,
        uptime: Math.round(process.uptime()),
      },
      timestamp: new Date().toISOString(),
    },
    success: true,
  });
});

// 清理目录缓存（管理员）
adminRoutes.post("/api/admin/cache/clear", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { mountId, storageConfigId } = await c.req.json().catch(() => ({}));
  let clearedScope = null;

  if (mountId) {
    invalidateFsCache({ mountId, reason: "admin-manual", db });
    clearedScope = `mount:${mountId}`;
    console.log(`管理员手动清理挂载点缓存 - 挂载点ID: ${mountId}`);
  } else if (storageConfigId) {
    invalidateFsCache({ storageConfigId, reason: "admin-manual", db });
    clearedScope = `storageConfig:${storageConfigId}`;
    console.log(`管理员手动清理存储配置缓存 - 存储配置ID: ${storageConfigId}`);
  } else {
    invalidateAllCaches({ reason: "admin-manual-all" });
    clearedScope = "all";
    console.log(`管理员手动清理所有缓存`);
  }

  return c.json({
    code: ApiStatus.SUCCESS,
    message: `缓存清理操作已触发`,
    data: {
      scope: clearedScope,
      timestamp: new Date().toISOString(),
    },
    success: true,
  });
});

// 清理目录缓存（API密钥用户）
adminRoutes.post("/api/user/cache/clear", requireMountView, async (c) => {
  const db = c.env.DB;
  const identity = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const apiKeyInfo = identity.apiKeyInfo;

  const { mountId, storageConfigId } = await c.req.json().catch(() => ({}));
  let clearedScope = null;

  if (mountId) {
    invalidateFsCache({ mountId, reason: "user-manual", db });
    clearedScope = `mount:${mountId}`;
    console.log(`API密钥用户手动清理挂载点缓存 - 用户: ${apiKeyInfo?.name || identity.type}, 挂载点ID: ${mountId}`);
  } else if (storageConfigId) {
    invalidateFsCache({ storageConfigId, reason: "user-manual", db });
    clearedScope = `storageConfig:${storageConfigId}`;
    console.log(`API密钥用户手动清理存储配置缓存 - 用户: ${apiKeyInfo?.name || identity.type}, 存储配置ID: ${storageConfigId}`);
  } else {
    invalidateAllCaches({ reason: "user-manual-all" });
    clearedScope = "all";
    console.log(`API密钥用户手动清理所有缓存 - 用户: ${apiKeyInfo?.name || identity.type}`);
  }

  return c.json({
    code: ApiStatus.SUCCESS,
    message: `缓存清理操作已触发`,
    data: {
      scope: clearedScope,
      timestamp: new Date().toISOString(),
    },
    success: true,
  });
});

export default adminRoutes;
