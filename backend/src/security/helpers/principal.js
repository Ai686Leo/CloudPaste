import { HTTPException } from "hono/http-exception";
import { ApiStatus, UserType } from "../../constants/index.js";

const normalizeType = (t) => (t === "apikey" ? UserType.API_KEY : t);

export const resolvePrincipal = (c, options = {}) => {
  const { allowedTypes = [UserType.ADMIN, UserType.API_KEY], allowGuest = false, message = "需要认证访问" } = options;
  const principal = c.get("principal");

  if ((!principal || principal.type === "guest") && !allowGuest) {
    throw new HTTPException(ApiStatus.UNAUTHORIZED, { message });
  }

  if (!principal) {
    return null;
  }

  const isAdmin = Boolean(principal.isAdmin);
  const type = isAdmin ? UserType.ADMIN : normalizeType(principal.type);

  const normalizedAllowed = Array.isArray(allowedTypes) ? allowedTypes.map(normalizeType) : [UserType.ADMIN, UserType.API_KEY];
  if (!allowGuest && normalizedAllowed && !normalizedAllowed.includes(type)) {
    throw new HTTPException(ApiStatus.FORBIDDEN, { message: "不支持的身份类型" });
  }

  return {
    principal,
    type,
    userId: principal.id ?? null,
    authorities: principal.authorities ?? 0,
    apiKeyInfo: principal.attributes?.keyInfo ?? null,
    attributes: principal.attributes ?? {},
    isAdmin,
  };
};
