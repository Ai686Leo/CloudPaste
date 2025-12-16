/**
 * WebDAV MOVE方法实现
 * 基于RFC 4918标准和SabreDAV实现模式，采用"复制-删除"机制
 * - 基于FileSystem抽象层的统一实现
 */

import { FileSystem } from "../../storage/fs/FileSystem.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { createWebDAVErrorResponse, withWebDAVErrorHandling } from "../utils/errorUtils.js";
import { getStandardWebDAVHeaders } from "../utils/headerUtils.js";
import { lockManager } from "../utils/LockManager.js";
import { checkLockPermission } from "../utils/lockUtils.js";
import { parseDestinationPath } from "../utils/webdavUtils.js";

/**
 * 处理WebDAV MOVE请求
 * @param {Object} c - Hono上下文
 * @param {string} path - 请求路径
 * @param {string} userId - 用户ID
 * @param {string} userType - 用户类型
 * @param {D1Database} db - D1数据库实例
 * @returns {Promise<Response>} HTTP响应
 */
export async function handleMove(c, path, userId, userType, db) {
  return withWebDAVErrorHandling("MOVE", async () => {
    console.log(`WebDAV MOVE - 开始处理: ${path}`);

    // 1. 解析WebDAV头部（与COPY方法完全一致）
    const destination = c.req.header("Destination");
    const overwrite = c.req.header("Overwrite") || "T";
    const depth = c.req.header("Depth") || "infinity";
    const ifHeader = c.req.header("If");

    console.log(`WebDAV MOVE - 请求头部: Destination=${destination}, Overwrite=${overwrite}, Depth=${depth}`);

    // 检查锁定状态

    // 检查源路径的锁定状态（MOVE操作会删除源资源）
    const sourceLockConflict = checkLockPermission(lockManager, path, ifHeader, "MOVE");
    if (sourceLockConflict) {
      console.log(`WebDAV MOVE - 源路径锁定冲突: ${path}`);
      return createWebDAVErrorResponse(sourceLockConflict.message, sourceLockConflict.status, false);
    }

    // 2. 验证必需的Destination头
    if (!destination) {
      console.warn(`WebDAV MOVE - 缺少Destination头`);
      return createWebDAVErrorResponse("缺少Destination头", 400, false);
    }

    // 3. 验证Depth头部（RFC 4918要求集合资源只能是infinity）
    if (depth !== "infinity") {
      console.error(`WebDAV MOVE - 不支持的Depth值: ${depth}`);
      return createWebDAVErrorResponse("MOVE操作只支持Depth: infinity", 412, false);
    }

    // 4. 解析目标路径
    const destPath = parseDestinationPath(destination);
    if (!destPath) {
      console.error(`WebDAV MOVE - 无效的Destination URL: ${destination}`);
      return createWebDAVErrorResponse("无效的Destination URL", 400, false);
    }

    console.log(`WebDAV MOVE - 目标路径: ${destPath}`);

    // 5. 验证源路径和目标路径不能相同（RFC 4918标准）
    if (path === destPath) {
      console.warn(`WebDAV MOVE - 源路径和目标路径相同: ${path}`);
      return createWebDAVErrorResponse("源路径和目标路径不能相同", 403, false);
    }

    // 6. 创建FileSystem实例
    const repositoryFactory = c.get("repos");
    const mountManager = new MountManager(db, getEncryptionSecret(c), repositoryFactory);
    const fileSystem = new FileSystem(mountManager);

    console.log(`WebDAV MOVE - 开始移动: ${path} -> ${destPath}, 用户类型: ${userType}`);

    // 7. 检查目标是否已存在（用于确定返回的状态码）
    let destExists = false;
    try {
      destExists = await fileSystem.exists(destPath, userId, userType);
      console.log(`WebDAV MOVE - 目标路径存在性检查: ${destPath} = ${destExists}`);
    } catch (error) {
      // exists方法出错，记录警告但继续执行
      console.warn(`WebDAV MOVE - 检查目标路径存在性失败: ${error.message}`);
    }

    // 8. 如果目标存在且不允许覆盖，直接返回错误
    if (destExists && overwrite === "F") {
      console.warn(`WebDAV MOVE - 目标已存在且不允许覆盖: ${destPath}`);
      return createWebDAVErrorResponse("目标已存在且不允许覆盖", 412, false); // Precondition Failed
    }

    // 9. 第一步：执行复制操作（复用COPY方法的完整逻辑）
    const copyResult = await fileSystem.copyItem(path, destPath, userId, userType, {
      skipExisting: overwrite === "F", // Overwrite: F 表示不覆盖，即跳过已存在的文件
    });

    console.log(`WebDAV MOVE - 复制结果:`, copyResult);

    // 10. 第二步：删除源文件/目录（SabreDAV的"复制-删除"机制）
    console.log(`WebDAV MOVE - 第二步：删除源文件 ${path}`);

    try {
      const deleteResult = await fileSystem.batchRemoveItems([path], userId, userType);
      console.log(`WebDAV MOVE - 删除结果: 成功=${deleteResult.success}, 失败=${deleteResult.failed?.length || 0}`);

      if (deleteResult.failed && deleteResult.failed.length > 0) {
        // 删除失败，需要回滚已复制的文件
        console.error(`WebDAV MOVE - 删除源文件失败，尝试回滚: ${deleteResult.failed[0]?.error}`);

        try {
          // 回滚：删除已复制的目标文件
          await fileSystem.batchRemoveItems([destPath], userId, userType);
          console.log(`WebDAV MOVE - 回滚成功：已删除目标文件 ${destPath}`);
        } catch (rollbackError) {
          console.error(`WebDAV MOVE - 回滚失败: ${rollbackError.message}`, rollbackError);
        }

        return createWebDAVErrorResponse(`移动失败：无法删除源文件 - ${deleteResult.failed[0]?.error}`, 500, false);
      }
    } catch (deleteError) {
      console.error(`WebDAV MOVE - 删除源文件异常: ${deleteError.message}`, deleteError);

      try {
        // 回滚：删除已复制的目标文件
        await fileSystem.batchRemoveItems([destPath], userId, userType);
        console.log(`WebDAV MOVE - 回滚成功：已删除目标文件 ${destPath}`);
      } catch (rollbackError) {
        console.error(`WebDAV MOVE - 回滚失败: ${rollbackError.message}`, rollbackError);
      }

      return createWebDAVErrorResponse(`移动失败：删除源文件异常 - ${deleteError.message}`, 500, false);
    }

    // 13. 根据RFC 4918标准返回适当的状态码
    if (destExists) {
      // 目标已存在，移动成功（覆盖了现有资源）
      console.log(`WebDAV MOVE - 移动成功（覆盖现有资源）: ${path} -> ${destPath}`);
      return new Response(null, {
        status: 204, // No Content
        headers: getStandardWebDAVHeaders({
          customHeaders: {
            "Content-Type": "text/plain",
            "Content-Length": "0",
          },
        }),
      });
    } else {
      // 目标不存在，移动成功（创建了新资源）
      console.log(`WebDAV MOVE - 移动成功（创建新资源）: ${path} -> ${destPath}`);
      return new Response(null, {
        status: 201, // Created
        headers: getStandardWebDAVHeaders({
          customHeaders: {
            "Content-Type": "text/plain",
            "Content-Length": "0",
            Location: destination,
          },
        }),
      });
    }
  }, { includeDetails: false, useXmlResponse: false });
}
