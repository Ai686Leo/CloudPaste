import { UserType } from "../../../constants/index.js";
import { ValidationError } from "../../../http/errors.js";

// - 这里的“owner”是给 vfs_nodes 用的“所有者隔离字段”
// - 把“（admin / apiKey）”统一映射成 { ownerType, ownerId }

const normalizeUserType = (userType) => {
  if (!userType) return null;
  // 兼容历史写法：apikey -> apiKey
  return userType === "apikey" ? UserType.API_KEY : userType;
};

const pickUserId = (userIdOrInfo) => {
  if (!userIdOrInfo) return null;
  if (typeof userIdOrInfo === "string") return userIdOrInfo;
  if (typeof userIdOrInfo?.id === "string") return userIdOrInfo.id;
  if (userIdOrInfo?.id !== null && userIdOrInfo?.id !== undefined) return String(userIdOrInfo.id);
  return null;
};

/**
 * 将 (userIdOrInfo, userType) 映射为 VFS owner
 * @param {string|{id?: string}|any} userIdOrInfo
 * @param {string} userType - 期望值：admin / apiKey（或历史 apikey）
 * @returns {{ ownerType: string, ownerId: string }}
 */
export function resolveOwner(userIdOrInfo, userType) {
  const normalizedType = normalizeUserType(userType);
  const userId = pickUserId(userIdOrInfo);

  if (!normalizedType) {
    throw new ValidationError("resolveOwner: 缺少 userType");
  }
  if (!userId) {
    throw new ValidationError("resolveOwner: 缺少 userId");
  }

  // 按项目既有常量（UserType）保持一致
  if (normalizedType === UserType.ADMIN) {
    return { ownerType: UserType.ADMIN, ownerId: String(userId) };
  }
  if (normalizedType === UserType.API_KEY) {
    return { ownerType: UserType.API_KEY, ownerId: String(userId) };
  }

  // todo:未来 user 体系：先允许传入，但当前项目其他地方可能尚未支持
  return { ownerType: String(normalizedType), ownerId: String(userId) };
}

/**
 * 从请求上下文 principal 映射 owner
 * @param {any} principal
 * @returns {{ ownerType: string, ownerId: string }}
 */
export function resolveOwnerFromPrincipal(principal) {
  if (!principal || principal.type === UserType.ANONYMOUS) {
    throw new ValidationError("resolveOwnerFromPrincipal: 需要已认证身份");
  }

  const userType = principal.isAdmin ? UserType.ADMIN : normalizeUserType(principal.type);
  return resolveOwner(principal.id ?? null, userType);
}

