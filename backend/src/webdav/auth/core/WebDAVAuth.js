/**
 * WebDAV认证核心
 */

import { MountManager } from "../../../storage/managers/MountManager.js";
import { UserType } from "../../../constants/index.js";
import { processWebDAVPath } from "../../utils/webdavUtils.js";
import { getAccessibleMountsForUser } from "../../../security/helpers/access.js";
import { isVirtualPath } from "../../../storage/fs/utils/VirtualDirectory.js";

/**
 * WebDAVAuth 只负责协议层兼容（Basic Challenge + 路径验权），
 * 具体的读/写授权交由 webdavRoutes 中的策略完成。
 */

/**
 * 认证结果类型枚举
 */
export const AuthResultType = {
  SUCCESS: "success",
  CHALLENGE: "challenge",
  FORBIDDEN: "forbidden",
  UNAUTHORIZED: "unauthorized",
  ERROR: "error",
};

/**
 * WebDAV认证核心类
 */
export class WebDAVAuth {
  constructor(db) {
    this.db = db;
  }

  /**
   * 验证WebDAV路径权限
   * 检查API密钥用户是否有权限访问指定路径
   * @param {Object} keyInfo - API密钥信息
   * @param {string} path - 请求路径
   * @param {string} method - HTTP方法
   * @param {Object} c - Hono上下文
   * @returns {Promise<boolean>} 是否有权限
   */
  async validateWebDAVPathPermission(keyInfo, path, method, c) {
    try {
      // 1. 检查基础路径权限
      const basicPath = keyInfo.basicPath || "/";
      if (!this.checkBasicPathPermission(basicPath, path)) {
        console.log(`WebDAV基础路径权限检查失败: basicPath=${basicPath}, requestPath=${path}`);
        return false;
      }

      const repositoryFactory = c.get("repos");
      const accessibleMounts = await getAccessibleMountsForUser(this.db, keyInfo, "apiKey", repositoryFactory);

      // 2. 虚拟路径（根目录 / 以及不直接落在具体挂载点上的中间目录）：。
      if (isVirtualPath(path, accessibleMounts)) {
        console.log(`WebDAV虚拟路径访问允许: basicPath=${basicPath}, requestPath=${path}`);
        return true;
      }

      // 3. 实际存储路径：保持原有挂载点 + 存储 ACL 校验逻辑，
      const { getEncryptionSecret } = await import("../../../utils/environmentUtils.js");
      const mountManager = new MountManager(this.db, getEncryptionSecret(c), repositoryFactory, { env: c.env });

      try {
        await mountManager.getDriverByPath(path, keyInfo, "apiKey");
        return true;
      } catch (mountError) {
        console.log(`WebDAV挂载点检查失败: ${mountError.message}`);
        return false;
      }
    } catch (error) {
      console.error("WebDAV路径权限检查失败:", error);
      return false;
    }
  }

  /**
   * 检查基础路径权限
   * @param {string} basicPath - 用户的基础路径
   * @param {string} requestPath - 请求的路径
   * @returns {boolean} 是否有权限
   */
  checkBasicPathPermission(basicPath, requestPath) {
    if (!basicPath || basicPath === "/") {
      return true; // 根路径权限
    }

    // 规范化路径
    const normalizedBasicPath = basicPath.endsWith("/") ? basicPath : basicPath + "/";
    const normalizedRequestPath = requestPath.startsWith("/") ? requestPath : "/" + requestPath;

    // 检查请求路径是否在基础路径范围内
    return normalizedRequestPath.startsWith(normalizedBasicPath) || normalizedRequestPath === basicPath;
  }

  /**
   * 生成认证挑战 - 符合RFC 4918 WebDAV标准
   * 发送Basic认证挑战
   * @returns {Object} 认证挑战结果
   */
  generateAuthChallenge() {
    return {
      type: AuthResultType.CHALLENGE,
      message: "需要认证",
      headers: {
        "WWW-Authenticate": 'Basic realm="WebDAV"',
      },
    };
  }

  /**
   * 创建中间件
   * @returns {Function} 中间件函数
   */
  createMiddleware() {
    return async (c, next) => {
      try {
        // 获取并处理请求路径
        const url = new URL(c.req.url);
        const rawPath = url.pathname;
        let requestPath = this.processPath(rawPath);
        c.set("webdavPath", requestPath);

        // OPTIONS 方法特殊处理 - 允许未认证访问进行能力发现
        if (c.req.method === "OPTIONS") {
          // 直接跳过认证，不设置用户类型（保持undefined状态）
          return await next();
        }

        // 统一认证处理
        const authResult = await this.performUnifiedAuth(c, requestPath);

        if (authResult.type === AuthResultType.SUCCESS) {
          c.set("userType", authResult.userType);
          c.set("userId", authResult.userId);
          return await next();
        } else if (authResult.type === AuthResultType.CHALLENGE) {
          // 返回认证挑战
          return new Response("Unauthorized", {
            status: 401,
            headers: authResult.headers,
          });
        } else {
          // 认证失败
          return new Response(authResult.message, {
            status: authResult.type === AuthResultType.FORBIDDEN ? 403 : 401,
          });
        }
      } catch (error) {
        console.error("WebDAV中间件错误:", error);
        return new Response("Internal Server Error", { status: 500 });
      }
    };
  }

  /**
   * 统一路径处理 - 使用统一的路径处理函数
   * @param {string} rawPath - 原始路径
   * @returns {string} 处理后的路径
   */
  processPath(rawPath) {
    const processedPath = processWebDAVPath(rawPath, false);
    return processedPath || rawPath; // 如果处理失败，返回原始路径
  }

  /**
   * 统一认证处理
   * @param {Object} c - Hono上下文
   * @param {string} requestPath - 请求路径
   * @returns {Promise<Object>} 认证结果
   */
  async performUnifiedAuth(c, requestPath) {
    try {
      const principal = c.get("principal");
      if (!principal || principal.type === "anonymous") {
        return this.generateAuthChallenge();
      }

      const userType = principal.isAdmin ? UserType.ADMIN : principal.type;
      if (userType !== UserType.ADMIN && userType !== UserType.API_KEY) {
        return {
          type: AuthResultType.FORBIDDEN,
          message: "不支持的身份类型",
        };
      }

      let apiKeyInfo = null;
      if (userType === UserType.API_KEY) {
        apiKeyInfo = principal.attributes?.keyInfo ?? null;
        if (!apiKeyInfo) {
          return {
            type: AuthResultType.ERROR,
            message: "API密钥信息缺失",
          };
        }

        const hasPathPermission = await this.validateWebDAVPathPermission(apiKeyInfo, requestPath, c.req.method, c);
        if (!hasPathPermission) {
          return {
            type: AuthResultType.FORBIDDEN,
            message: "路径权限不足",
          };
        }
      }

      return {
        type: AuthResultType.SUCCESS,
        userType,
        userId: userType === UserType.ADMIN ? principal.id : apiKeyInfo,
      };
    } catch (error) {
      console.error("WebDAV统一认证错误:", error);
      return {
        type: AuthResultType.ERROR,
        message: "认证失败",
      };
    }
  }
}

/**
 * 创建WebDAV认证实例
 * @param {D1Database} db - 数据库实例
 * @returns {WebDAVAuth} 认证实例
 */
export function createWebDAVAuth(db) {
  return new WebDAVAuth(db);
}
