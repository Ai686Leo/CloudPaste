import { Hono } from "hono";
import { Permission, PermissionChecker } from "../constants/permissions.js";
import { getAllApiKeys, createApiKey, updateApiKey, deleteApiKey } from "../services/apiKeyService.js";
import { ApiStatus } from "../constants/index.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";

const apiKeyRoutes = new Hono();
const requireAdmin = usePolicy("admin.all");
const requireAuth = usePolicy("auth.authenticated");

// 测试API密钥验证路由
apiKeyRoutes.get("/api/test/api-key", requireAuth, async (c) => {
  // 获取认证信息
  const identity = resolvePrincipal(c, { allowGuest: false });
  const apiKeyInfo = identity.apiKeyInfo;
  const apiKeyId = identity.userId;
  const isAdmin = identity.isAdmin;

  // 如果是管理员，返回管理员信息
  if (isAdmin) {
    return c.json({
      code: ApiStatus.SUCCESS,
      message: "管理员令牌验证成功",
      data: {
        name: "管理员",
        basic_path: "/",
        permissions: {
          text: true,
          file: true,
          mount_view: true,
          mount_upload: true,
          mount_copy: true,
          mount_rename: true,
          mount_delete: true,
          webdav_read: true,
          webdav_manage: true,
        },
        key_info: {
          id: apiKeyId,
          name: "管理员",
          basic_path: "/",
        },
        is_admin: true,
      },
      success: true,
    });
  }

  // API密钥用户，返回具体的权限信息
  const permissions = apiKeyInfo?.permissions || 0;
  return c.json({
    code: ApiStatus.SUCCESS,
    message: "API密钥验证成功",
    data: {
      name: apiKeyInfo?.name || "未知",
      basic_path: apiKeyInfo?.basicPath || "/",
      permissions: {
        text: PermissionChecker.hasPermission(permissions, Permission.TEXT),
        file: PermissionChecker.hasPermission(permissions, Permission.FILE_SHARE),
        mount_view: PermissionChecker.hasPermission(permissions, Permission.MOUNT_VIEW),
        mount_upload: PermissionChecker.hasPermission(permissions, Permission.MOUNT_UPLOAD),
        mount_copy: PermissionChecker.hasPermission(permissions, Permission.MOUNT_COPY),
        mount_rename: PermissionChecker.hasPermission(permissions, Permission.MOUNT_RENAME),
        mount_delete: PermissionChecker.hasPermission(permissions, Permission.MOUNT_DELETE),
        webdav_read: PermissionChecker.hasPermission(permissions, Permission.WEBDAV_READ),
        webdav_manage: PermissionChecker.hasPermission(permissions, Permission.WEBDAV_MANAGE),
      },
      key_info: {
        id: apiKeyId || apiKeyInfo?.id,
        name: apiKeyInfo?.name || "未知",
        basic_path: apiKeyInfo?.basicPath || "/",
      },
    },
    success: true,
  });
});

// 获取所有API密钥列表
apiKeyRoutes.get("/api/admin/api-keys", requireAdmin, async (c) => {
  const db = c.env.DB;
  const repositoryFactory = c.get("repos");
  const keys = await getAllApiKeys(db, repositoryFactory);

  return c.json({
    code: ApiStatus.SUCCESS,
    message: "获取成功",
    data: keys,
    success: true, // 添加兼容字段
  });
});

// 创建新的API密钥
apiKeyRoutes.post("/api/admin/api-keys", requireAdmin, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();
  const repositoryFactory = c.get("repos");
  const apiKey = await createApiKey(db, body, repositoryFactory);

  return c.json({
    code: ApiStatus.CREATED,
    message: "API密钥创建成功",
    data: apiKey,
    success: true,
  });
});

// 修改API密钥
apiKeyRoutes.put("/api/admin/api-keys/:id", requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json();
  const repositoryFactory = c.get("repos");
  await updateApiKey(db, id, body, repositoryFactory);

  return c.json({
    code: ApiStatus.SUCCESS,
    message: "API密钥已更新",
    success: true,
  });
});

// 删除API密钥
apiKeyRoutes.delete("/api/admin/api-keys/:id", requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const repositoryFactory = c.get("repos");
  await deleteApiKey(db, id, repositoryFactory);

  return c.json({
    code: ApiStatus.SUCCESS,
    message: "密钥已删除",
    success: true,
  });
});

export default apiKeyRoutes;
