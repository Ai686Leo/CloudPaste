/**
 * 挂载点解析工具
 * 提供通用的挂载点查找和路径解析功能
 */

import { DbTables } from "../../../constants/index.js";
import { PROXY_CONFIG } from "../../../constants/proxy.js";
import { ensureRepositoryFactory } from "../../../utils/repositories.js";
import { normalizePath } from "./PathResolver.js";

/**
 * 规范化挂载路径格式
 * @param {string} mountPath - 挂载路径
 * @returns {string} 规范化的挂载路径
 */
export function normalizeMountPath(mountPath) {
  return mountPath.startsWith("/") ? mountPath : "/" + mountPath;
}

/**
 * 计算子路径
 * @param {string} fullPath - 完整路径
 * @param {string} mountPath - 挂载路径
 * @returns {string} 子路径（始终以 / 开头，空子路径时返回 "/"）
 */
export function calculateSubPath(fullPath, mountPath) {
  let subPath = fullPath.substring(mountPath.length);
  if (!subPath) {
    return "/";
  }
  if (!subPath.startsWith("/")) {
    subPath = "/" + subPath;
  }
  return subPath;
}

/**
 * 在内存挂载列表中解析路径对应的挂载点
 * - 仅负责纯路径→挂载点匹配，不访问数据库
 * - 供 VirtualDirectory 等非 DB 场景复用
 * @param {string} path - 请求路径（FS 视图路径）
 * @param {Array<{ mount_path: string }>} mounts - 挂载点列表
 * @returns {{ mount: any, subPath: string, mountPath: string } | null}
 */
export function resolveMountFromList(path, mounts) {
  if (!Array.isArray(mounts) || mounts.length === 0) {
    return null;
  }

  // 使用与 findMountPointByPath 相同的规范化规则，保证行为一致
  const normalizedPath = normalizePath(path);

  // 根路径不属于任何具体挂载
  if (normalizedPath === "/" || normalizedPath === "//") {
    return null;
  }

  const sortedMounts = [...mounts].sort(
    (a, b) => b.mount_path.length - a.mount_path.length,
  );

  for (const mount of sortedMounts) {
    const mountPath = normalizeMountPath(mount.mount_path);

    if (
      normalizedPath === mountPath ||
      normalizedPath === mountPath + "/" ||
      normalizedPath.startsWith(mountPath + "/")
    ) {
      const subPath = calculateSubPath(normalizedPath, mountPath);
      return { mount, subPath, mountPath };
    }
  }

  return null;
}

/**
 * 根据请求路径查找对应的挂载点和子路径
 * @param {D1Database} db - D1数据库实例
 * @param {string} path - 请求路径
 * @param {string|Object} userIdOrInfo - 用户ID（管理员）或API密钥信息对象（API密钥用户）
 * @param {string} userType - 用户类型 (admin 或 apiKey)
 * @returns {Promise<Object>} 包含挂载点、子路径和错误信息的对象
 */
export async function findMountPointByPath(db, path, userIdOrInfo, userType, repositoryFactory = null) {
  // 规范化路径
  path = normalizePath(path);

  // 处理根路径
  if (path === "/" || path === "//") {
    return {
      isRoot: true,
      error: {
        status: 403,
        message: "无法操作根目录",
      },
    };
  }

  // 对于代理访问，使用特殊的处理逻辑
  if (userType === PROXY_CONFIG.USER_TYPE) {
    // 代理访问直接使用findMountPointByPathForProxy
    return await findMountPointByPathForProxy(db, path);
  }

  // 获取挂载点列表 - 不进行权限过滤，权限检查在路由层完成
  let mounts;
  try {
    const factory = ensureRepositoryFactory(db, repositoryFactory);
    const mountRepository = factory.getMountRepository();
    mounts = await mountRepository.findAll(false); // false = 只获取活跃的挂载点
  } catch (error) {
    return {
      error: {
        status: 500,
        message: "获取挂载点失败",
      },
    };
  }

  // 按照路径长度降序排序，以便优先匹配最长的路径
  mounts.sort((a, b) => b.mount_path.length - a.mount_path.length);

  // 查找匹配的挂载点
  for (const mount of mounts) {
    const mountPath = normalizeMountPath(mount.mount_path);

    // 如果请求路径完全匹配挂载点或者是挂载点的子路径
    if (path === mountPath || path === mountPath + "/" || path.startsWith(mountPath + "/")) {
      const subPath = calculateSubPath(path, mountPath);

      return {
        mount,
        subPath,
        mountPath,
      };
    }
  }

  // 未找到匹配的挂载点
  return {
    error: {
      status: 404,
      message: "挂载点不存在",
    },
  };
}

/**
 * 根据API密钥信息查找对应的挂载点和子路径
 * 注意：此函数不进行权限检查，权限检查应在路由层完成
 * @param {D1Database} db - D1数据库实例
 * @param {string} path - 请求路径
 * @param {Object} apiKeyInfo - API密钥信息对象
 * @returns {Promise<Object>} 包含挂载点、子路径和错误信息的对象
 */
export async function findMountPointByPathWithApiKey(db, path, apiKeyInfo, repositoryFactory = null) {
  // 规范化路径
  path = normalizePath(path);

  // 处理根路径
  if (path === "/" || path === "//") {
    return {
      isRoot: true,
      error: {
        status: 403,
        message: "无法操作根目录",
      },
    };
  }

  // 获取所有活跃的挂载点 - 不进行权限过滤
  const factory = ensureRepositoryFactory(db, repositoryFactory);
  const mountRepository = factory.getMountRepository();
  const mounts = await mountRepository.findAll(false); // false = 只获取活跃的挂载点

  // 按照路径长度降序排序，以便优先匹配最长的路径
  mounts.sort((a, b) => b.mount_path.length - a.mount_path.length);

  // 查找匹配的挂载点
  for (const mount of mounts) {
    const mountPath = normalizeMountPath(mount.mount_path);

    // 如果请求路径完全匹配挂载点或者是挂载点的子路径
    if (path === mountPath || path === mountPath + "/" || path.startsWith(mountPath + "/")) {
      const subPath = calculateSubPath(path, mountPath);

      return {
        mount,
        subPath,
        mountPath,
      };
    }
  }

  // 未找到匹配的挂载点
  return {
    error: {
      status: 404,
      message: "挂载点不存在",
    },
  };
}

/**
 * 更新挂载点的最后使用时间
 * @param {D1Database} db - D1数据库实例
 * @param {string} mountId - 挂载点ID
 */
export async function updateMountLastUsed(db, mountId, repositoryFactory = null) {
  try {
    // 使用 MountRepository
    const factory = ensureRepositoryFactory(db, repositoryFactory);
    const mountRepository = factory.getMountRepository();

    await mountRepository.updateLastUsed(mountId);
  } catch (error) {
    // 更新失败不中断主流程，但减少日志详细程度，避免冗余
    console.warn(`挂载点最后使用时间更新失败: ${mountId}`);
  }
}

/**
 * 根据路径查找挂载点（用于代理访问，无需用户认证）
 * @param {D1Database} db - D1数据库实例
 * @param {string} path - 请求路径
 * @returns {Promise<Object>} 包含挂载点、子路径和错误信息的对象
 */
export async function findMountPointByPathForProxy(db, path, repositoryFactory = null) {
  // 规范化路径
  path = normalizePath(path);

  // 处理根路径
  if (path === "/" || path === "//") {
    return {
      isRoot: true,
      error: {
        status: 403,
        message: "无法操作根目录",
      },
    };
  }

  // 获取所有活跃的挂载点
  let mounts;
  try {
    // 使用 MountRepository
    const factory = ensureRepositoryFactory(db, repositoryFactory);
    const mountRepository = factory.getMountRepository();

    mounts = await mountRepository.findAll(false); // false = 只获取活跃的挂载点
  } catch (error) {
    return {
      error: {
        status: 500,
        message: "获取挂载点失败",
      },
    };
  }

  // 按照路径长度降序排序，以便优先匹配最长的路径
  mounts.sort((a, b) => b.mount_path.length - a.mount_path.length);

  // 查找匹配的挂载点
  for (const mount of mounts) {
    const mountPath = normalizeMountPath(mount.mount_path);

    // 如果请求路径完全匹配挂载点或者是挂载点的子路径
    if (path === mountPath || path === mountPath + "/" || path.startsWith(mountPath + "/")) {

      const subPath = calculateSubPath(path, mountPath);

      return {
        mount,
        subPath,
        mountPath,
      };
    }
  }

  // 未找到匹配的挂载点
  return {
    error: {
      status: 404,
      message: "挂载点不存在",
    },
  };
}
