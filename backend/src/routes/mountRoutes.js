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

    return jsonOk(c, mounts, "获取挂载点列表成功");
  }

  const mounts = await getAccessibleMountsForUser(db, identity.apiKeyInfo, UserType.API_KEY);

  return jsonOk(c, mounts, "获取挂载点列表成功");
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

export default mountRoutes;
