import { performAuth } from "../auth/authGateway.js";

/**
 * securityContext 的职责非常单一：
 * 1. 通过 performAuth 解析 Authorization / X-Custom-Auth-Key。
 * 2. 将 authResult 映射为更轻量的 principal 并挂载到 context（供 authorize / 业务层读取）。
 * 3. 不做任何权限判断或拒绝逻辑，让后续的 authorize 按策略决定是否放行。
 */
import { PermissionGroup } from "../../constants/permissions.js";

const ADMIN_AUTHORITIES = PermissionGroup.ALL_PERMISSIONS ?? 0xffffffff;

export const createGuestPrincipal = () => ({
  type: "guest",
  id: null,
  authorities: 0,
  attributes: {},
  isAdmin: false,
  isAuthenticated: false,
});

const mapAuthResultToPrincipal = (authResult) => {
  if (!authResult || !authResult.isAuthenticated) {
    return createGuestPrincipal();
  }

  const isAdmin = Boolean(authResult.isAdmin?.() ?? authResult._isAdmin);
  if (isAdmin) {
    return {
      type: "admin",
      id: authResult.getUserId?.() ?? authResult.userId ?? null,
      authorities: ADMIN_AUTHORITIES,
      attributes: {
        basicPath: "/",
        role: "ADMIN",
      },
      isAdmin: true,
      isAuthenticated: true,
    };
  }

  const keyInfo = authResult.keyInfo ?? null;
  if (keyInfo) {
    return {
      type: "apiKey",
      id: authResult.getUserId?.() ?? keyInfo?.id ?? null,
      authorities: authResult.permissions ?? 0,
      attributes: {
        basicPath: keyInfo?.basicPath ?? authResult.basicPath ?? "/",
        role: keyInfo?.role ?? null,
        keyInfo: keyInfo ?? undefined,
      },
      isAdmin: false,
      isAuthenticated: true,
    };
  }

  // 非 admin 且无 apiKey，仅保留三种类型：admin/apiKey/guest
  return createGuestPrincipal();
};

export const securityContext = () => {
  return async (c, next) => {
    let principal = c.get("principal");
    if (!principal) {
      const authResult = await performAuth(c);
      principal = mapAuthResultToPrincipal(authResult);
      c.set("principal", principal);
    }

    await next();
  };
};

export const getPrincipal = (c) => c.get("principal") ?? createGuestPrincipal();
