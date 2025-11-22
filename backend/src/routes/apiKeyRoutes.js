import { Hono } from "hono";
import { Permission, PermissionChecker } from "../constants/permissions.js";
import { getAllApiKeys, createApiKey, updateApiKey, deleteApiKey } from "../services/apiKeyService.js";
import { ApiStatus } from "../constants/index.js";
import { jsonOk, jsonCreated } from "../utils/common.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";
import { ValidationError } from "../http/errors.js";
import { ensureRepositoryFactory } from "../utils/repositories.js";

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
    return jsonOk(c, {
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
      }, "管理员令牌验证成功");
  }

  // API密钥用户，返回具体的权限信息
  const permissions = apiKeyInfo?.permissions || 0;
  const role = apiKeyInfo?.role || null;
  const isGuestKey = role === "GUEST" || apiKeyInfo?.isGuest === true;

  return jsonOk(
    c,
    {
      name: apiKeyInfo?.name || "未知",
      basic_path: apiKeyInfo?.basicPath || "/",
      permissions: {
        text_share: PermissionChecker.hasPermission(permissions, Permission.TEXT_SHARE),
        text_manage: PermissionChecker.hasPermission(permissions, Permission.TEXT_MANAGE),
        file_share: PermissionChecker.hasPermission(permissions, Permission.FILE_SHARE),
        file_manage: PermissionChecker.hasPermission(permissions, Permission.FILE_MANAGE),
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
        role,
        is_guest: isGuestKey,
      },
    },
    "API密钥验证成功",
  );
});

// 公共游客配置接口（基于 API Key 表中的 GUEST 角色）
apiKeyRoutes.get("/api/public/guest-config", async (c) => {
  const db = c.env.DB;
  const factory = ensureRepositoryFactory(db, c.get("repos"));
  const apiKeyRepository = factory.getApiKeyRepository();

  const allKeys = await apiKeyRepository.findAll({});
  const guestKeys = allKeys.filter((k) => (k.role || "GENERAL") === "GUEST");

  if (!guestKeys.length) {
    return jsonOk(
      c,
      {
        enabled: false,
        key: null,
      },
      "未配置游客 API 密钥"
    );
  }

  const guestKey = guestKeys[0];
  const now = new Date();
  const expiresAt = guestKey.expires_at ? new Date(guestKey.expires_at) : null;
  const isExpired = expiresAt && expiresAt < now;
  const isEnabled = typeof guestKey.is_enable === "number" ? guestKey.is_enable === 1 : Boolean(guestKey.is_enable);

  const enabled = isEnabled && !isExpired;
  const permissions = guestKey.permissions || 0;

  const permissionsDetail = {
    text_share: PermissionChecker.hasPermission(permissions, Permission.TEXT_SHARE),
    text_manage: PermissionChecker.hasPermission(permissions, Permission.TEXT_MANAGE),
    file_share: PermissionChecker.hasPermission(permissions, Permission.FILE_SHARE),
    file_manage: PermissionChecker.hasPermission(permissions, Permission.FILE_MANAGE),
    mount_view: PermissionChecker.hasPermission(permissions, Permission.MOUNT_VIEW),
    mount_upload: PermissionChecker.hasPermission(permissions, Permission.MOUNT_UPLOAD),
    mount_copy: PermissionChecker.hasPermission(permissions, Permission.MOUNT_COPY),
    mount_rename: PermissionChecker.hasPermission(permissions, Permission.MOUNT_RENAME),
    mount_delete: PermissionChecker.hasPermission(permissions, Permission.MOUNT_DELETE),
    webdav_read: PermissionChecker.hasPermission(permissions, Permission.WEBDAV_READ),
    webdav_manage: PermissionChecker.hasPermission(permissions, Permission.WEBDAV_MANAGE),
  };

  return jsonOk(
    c,
    {
      enabled,
      key: enabled ? guestKey.key : null,
      name: guestKey.name || "GUEST",
      permissions,
      permissions_detail: permissionsDetail,
      basic_path: guestKey.basic_path || "/",
      expires_at: guestKey.expires_at,
    },
    "游客配置获取成功"
  );
});

// 获取所有API密钥列表
apiKeyRoutes.get("/api/admin/api-keys", requireAdmin, async (c) => {
  const db = c.env.DB;
  const repositoryFactory = c.get("repos");
  const keys = await getAllApiKeys(db, repositoryFactory);

  return jsonOk(c, keys, "获取成功");
});

// 创建新的API密钥
apiKeyRoutes.post("/api/admin/api-keys", requireAdmin, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();
  const repositoryFactory = c.get("repos");
  const apiKey = await createApiKey(db, body, repositoryFactory);

  return jsonCreated(c, apiKey, "API密钥创建成功");
});

// 修改API密钥
apiKeyRoutes.put("/api/admin/api-keys/:id", requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json();
  const repositoryFactory = c.get("repos");
  await updateApiKey(db, id, body, repositoryFactory);

  return jsonOk(c, undefined, "API密钥已更新");
});

// 删除API密钥
apiKeyRoutes.delete("/api/admin/api-keys/:id", requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const repositoryFactory = c.get("repos");
  await deleteApiKey(db, id, repositoryFactory);

  return jsonOk(c, undefined, "密钥已删除");
});

// 获取指定 API 密钥的存储 ACL（可访问的 storage_config_id 白名单）
apiKeyRoutes.get("/api/admin/api-keys/:id/storage-acl", requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const repositoryFactory = c.get("repos");

  const aclRepo = repositoryFactory.getPrincipalStorageAclRepository();
  const storageConfigIds = await aclRepo.findConfigIdsBySubject("API_KEY", id);

  return jsonOk(
    c,
    {
      subject_type: "API_KEY",
      subject_id: id,
      storage_config_ids: storageConfigIds,
    },
    "获取存储 ACL 成功"
  );
});

// 更新指定 API 密钥的存储 ACL（整体替换）
apiKeyRoutes.put("/api/admin/api-keys/:id/storage-acl", requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const repositoryFactory = c.get("repos");

  const body = await c.req.json().catch(() => ({}));
  let storageConfigIds = body.storage_config_ids ?? body.storageConfigIds ?? [];

  if (!Array.isArray(storageConfigIds)) {
    throw new ValidationError("storage_config_ids 必须是数组");
  }

  // 过滤无效值并去除空字符串
  storageConfigIds = storageConfigIds
    .filter((v) => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

  const aclRepo = repositoryFactory.getPrincipalStorageAclRepository();
  await aclRepo.replaceBindings("API_KEY", id, storageConfigIds);

  return jsonOk(
    c,
    {
      subject_type: "API_KEY",
      subject_id: id,
      storage_config_ids: storageConfigIds,
    },
    "存储 ACL 已更新"
  );
});

export default apiKeyRoutes;
