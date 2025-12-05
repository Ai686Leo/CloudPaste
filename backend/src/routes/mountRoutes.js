/**
 * 统一挂载点路由
 */
import { Hono } from "hono";
import { createMount, updateMount, deleteMount, getAllMounts } from "../services/storageMountService.js";
import { ApiStatus, UserType } from "../constants/index.js";
import { jsonOk, jsonCreated } from "../utils/common.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";
import { getAccessibleMountsForUser } from "../security/helpers/access.js";
import { StorageFactory } from "../storage/factory/StorageFactory.js";
import { getMountConfigSchema } from "../storage/factory/MountConfigSchema.js";

/**
 * 为挂载点列表附加能力信息
 * @param {Array} mounts - 挂载点列表
 * @returns {Array} 附加了 capabilities 字段的挂载点列表
 */
function enrichMountsWithCapabilities(mounts) {
  if (!Array.isArray(mounts)) return mounts;
  return mounts.map(mount => ({
    ...mount,
    capabilities: StorageFactory.getRegisteredCapabilities(mount.storage_type) || [],
  }));
}

const mountRoutes = new Hono();

/**
 * 获取挂载点列表
 * 统一入口，根据用户权限返回不同数据：
 * - 管理员：返回所有挂载点（包括禁用的）
 * - API密钥用户：返回有权限的活跃挂载点
 */
const requireAdmin = usePolicy("admin.all");
const requireMountView = usePolicy("fs.base");

mountRoutes.get("/api/mount/list", requireMountView, async (c) => {
  const db = c.env.DB;
  const identity = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });

  if (identity.isAdmin) {
    const mounts = await getAllMounts(db, true);
    // 附加驱动能力信息，供前端动态适配功能
    const enrichedMounts = enrichMountsWithCapabilities(mounts);
    return jsonOk(c, enrichedMounts, "获取挂载点列表成功");
  }

  const mounts = await getAccessibleMountsForUser(db, identity.apiKeyInfo, UserType.API_KEY);
  // 附加驱动能力信息，供前端动态适配功能
  const enrichedMounts = enrichMountsWithCapabilities(mounts);
  return jsonOk(c, enrichedMounts, "获取挂载点列表成功");
});

/**
 * 创建挂载点（仅管理员）
 */
mountRoutes.post("/api/mount/create", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });

  const body = await c.req.json();
  const mount = await createMount(db, body, adminId);

  return jsonCreated(c, mount, "挂载点创建成功");
});

/**
 * 更新挂载点（仅管理员）
 */
mountRoutes.put("/api/mount/:id", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const { id } = c.req.param();

  const body = await c.req.json();
  await updateMount(db, id, body, adminId, true);

  return jsonOk(c, undefined, "挂载点已更新");
});

/**
 * 删除挂载点（仅管理员）
 */
mountRoutes.delete("/api/mount/:id", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const { id } = c.req.param();

  await deleteMount(db, id, adminId, true);

  return jsonOk(c, undefined, "挂载点删除成功");
});

/**
 * 获取存储类型的能力列表
 * GET /api/storage-types/:type/capabilities
 * 返回指定存储类型支持的能力列表及元数据
 */
mountRoutes.get("/api/storage-types/:type/capabilities", requireMountView, async (c) => {
  const { type } = c.req.param();

  if (!StorageFactory.isTypeSupported(type)) {
    return c.json({ success: false, message: `不支持的存储类型: ${type}` }, ApiStatus.NOT_FOUND);
  }

  const meta = StorageFactory.getTypeMetadata(type);

  return jsonOk(
    c,
    {
      storageType: type,
      displayName: meta?.displayName || type,
      capabilities: meta?.capabilities || [],
      ui: meta?.ui || null,
      configSchema: meta?.configSchema || null,
      providerOptions: meta?.providerOptions || null,
    },
    "获取存储类型能力成功",
  );
});

/**
 * 获取所有支持的存储类型及其能力
 * GET /api/storage-types
 * 返回所有注册的存储类型及其能力与配置元数据信息
 */
mountRoutes.get("/api/storage-types", requireMountView, async (c) => {
  const result = StorageFactory.getAllTypeMetadata();
  return jsonOk(c, result, "获取存储类型列表成功");
});

/**
 * 获取挂载点配置Schema
 * GET /api/mount-schema
 * 返回挂载点表单的Schema定义，供前端动态渲染表单
 */
mountRoutes.get("/api/mount-schema", requireAdmin, async (c) => {
  const schema = getMountConfigSchema();
  return jsonOk(c, schema, "获取挂载点Schema成功");
});

export default mountRoutes;
