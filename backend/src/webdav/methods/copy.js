/**
 * 处理WebDAV COPY请求
 * 用于复制文件和目录
 */
import { MountManager } from "../../storage/managers/MountManager.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { createWebDAVErrorResponse, withWebDAVErrorHandling } from "../utils/errorUtils.js";
import { getStandardWebDAVHeaders } from "../utils/headerUtils.js";
import { parseDestinationPath } from "../utils/webdavUtils.js";
import { invalidateFsCache } from "../../cache/invalidation.js";
import { lockManager } from "../utils/LockManager.js";
import { checkLockPermission } from "../utils/lockUtils.js";

/**
 * 处理COPY请求
 * @param {Object} c - Hono上下文
 * @param {string} path - 请求路径
 * @param {string} userId - 用户ID
 * @param {string} userType - 用户类型 (admin 或 apiKey)
 * @param {D1Database} db - D1数据库实例
 */
export async function handleCopy(c, path, userId, userType, db) {
  return withWebDAVErrorHandling("COPY", async () => {
    // 1. 解析WebDAV头部
    const destination = c.req.header("Destination");
    const overwrite = c.req.header("Overwrite") || "T";
    const depth = c.req.header("Depth") || "infinity";
    const ifHeader = c.req.header("If");

    console.log(`WebDAV COPY - 请求头部: Destination=${destination}, Overwrite=${overwrite}, Depth=${depth}`);

    // 2. 验证必需的Destination头
    if (!destination) {
      console.warn(`WebDAV COPY - 缺少Destination头`);
      return createWebDAVErrorResponse("缺少Destination头", 400, false);
    }

    // 3. 解析目标路径
    const destPath = parseDestinationPath(destination);
    if (!destPath) {
      console.warn(`WebDAV COPY - 无效的Destination头: ${destination}`);
      return createWebDAVErrorResponse("无效的Destination头", 400, false);
    }

    // 检查目标路径的锁定状态（COPY操作会在目标位置创建新资源）
    const lockConflict = checkLockPermission(lockManager, destPath, ifHeader, "COPY");
    if (lockConflict) {
      console.log(`WebDAV COPY - 目标路径锁定冲突: ${destPath}`);
      return createWebDAVErrorResponse(lockConflict.message, lockConflict.status, false);
    }

    // 4. 检查源路径和目标路径是否相同
    if (path === destPath) {
      console.warn(`WebDAV COPY - 源路径和目标路径相同: ${path}`);
      return createWebDAVErrorResponse("源路径和目标路径不能相同", 403, false);
    }

    // 5. 验证Depth头（对于集合资源）
    if (depth !== "0" && depth !== "infinity") {
      console.warn(`WebDAV COPY - 无效的Depth头: ${depth}`);
      return createWebDAVErrorResponse("无效的Depth头", 400, false);
    }

    // 6. 创建FileSystem实例
    const repositoryFactory = c.get("repos");
    const mountManager = new MountManager(db, getEncryptionSecret(c), repositoryFactory);
    const fileSystem = new FileSystem(mountManager);

    console.log(`WebDAV COPY - 开始复制: ${path} -> ${destPath}, 用户类型: ${userType}`);

    // 7. 检查目标是否已存在（用于确定返回的状态码）
    let destExists = false;
    try {
      destExists = await fileSystem.exists(destPath, userId, userType);
      console.log(`WebDAV COPY - 目标路径存在性检查: ${destPath} = ${destExists}`);
    } catch (error) {
      // exists方法出错，记录警告但继续执行
      console.warn(`WebDAV COPY - 检查目标路径存在性失败: ${error.message}`);
    }

    // 8. 如果目标存在且不允许覆盖，直接返回错误
    if (destExists && overwrite === "F") {
      console.warn(`WebDAV COPY - 目标已存在且不允许覆盖: ${destPath}`);
      return createWebDAVErrorResponse("目标已存在且不允许覆盖", 412, false); // Precondition Failed
    }

    // 9. 使用FileSystem统一抽象层执行复制
    // 将WebDAV的Overwrite头映射为FileSystem的skipExisting选项
    const result = await fileSystem.copyItem(path, destPath, userId, userType, {
      skipExisting: overwrite === "F", // Overwrite: F 表示不覆盖，即跳过已存在的文件
    });

    // console.log(`WebDAV COPY - 复制结果:`, result);

    // 10. 处理跳过的情况（这种情况理论上不应该发生，因为我们已经预先检查了）
    if (result.skipped === true || result.status === "skipped") {
      console.warn(`WebDAV COPY - 复制被跳过: ${path} -> ${destPath}`);
      return createWebDAVErrorResponse("目标已存在且不允许覆盖", 412, false); // Precondition Failed
    }

    // 12. 同存储复制的缓存清理（跨存储复制已在上面处理）
    try {
      const { mount: sourceMountResult } = await mountManager.getDriverByPath(path, userId, userType);
      const { mount: destMountResult } = await mountManager.getDriverByPath(destPath, userId, userType);

      if (sourceMountResult) {
        invalidateFsCache({ mountId: sourceMountResult.id, reason: "webdav-copy", db });
      }

      if (destMountResult) {
        invalidateFsCache({ mountId: destMountResult.id, reason: "webdav-copy", db });
      }
    } catch (cacheError) {
      console.warn(`WebDAV COPY - 缓存清理失败: ${cacheError.message}`);
    }

    console.log(`WebDAV COPY - 复制成功: ${path} -> ${destPath}`);

    // 13. 返回成功响应（符合WebDAV COPY标准）
    // 根据目标是否已存在返回正确的状态码
    const statusCode = destExists ? 204 : 201; // 204 No Content (覆盖) 或 201 Created (新建)
    const statusText = destExists ? "No Content" : "Created";

    console.log(`WebDAV COPY - 返回状态码: ${statusCode} (${statusText})`);

    return new Response(null, {
      status: statusCode,
      headers: getStandardWebDAVHeaders({
        customHeaders: {
          "Content-Type": "text/plain",
          "Content-Length": "0",
        },
      }),
    });
  }, { includeDetails: false, useXmlResponse: false });
}
