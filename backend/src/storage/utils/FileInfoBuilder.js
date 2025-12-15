import { FILE_TYPES, FILE_TYPE_NAMES } from "../../constants/index.js";
import { GetFileType, getFileTypeName } from "../../utils/fileTypeDetector.js";

/**
 * FileInfo 构造工具
 *
 * 目标：
 * - 为所有存储驱动提供统一的 FileInfo 构造逻辑
 * - 避免在各个驱动内部重复实现 name/type/typeName/mimetype 等细节
 * - 仅关注“挂载视图下的文件/目录信息”这一领域模型
 */

/**
 * 基于通用元数据构造 FileInfo
 * @param {Object} params
 * @param {string} params.fsPath        挂载视图下的完整路径（例如 /s3/docs/file.txt）
 * @param {string} [params.name]        文件名（可选，不传则从 fsPath 中推导）
 * @param {boolean} params.isDirectory  是否为目录
 * @param {number|null|undefined} [params.size]           大小（字节），目录会被归一为 0
 * @param {Date|string|null|undefined} [params.modified]   最后修改时间
 * @param {string|null|undefined} [params.mimetype]        MIME 类型（文件时可选）
 * @param {Object|null|undefined} [params.mount]           挂载对象
 * @param {string|null|undefined} [params.storageType]     存储类型（优先显式传入，其次 mount.storage_type）
 * @param {D1Database|null|undefined} [params.db]          数据库实例，用于类型推断
 * @returns {Promise<Object>} 标准 FileInfo 对象
 */
export async function buildFileInfo({
  fsPath,
  name,
  isDirectory,
  size,
  modified,
  mimetype,
  mount,
  storageType,
  db,
}) {
  const finalName = name || inferNameFromPath(fsPath, isDirectory);

  const type = isDirectory ? FILE_TYPES.FOLDER : await GetFileType(finalName, db);
  const typeName = isDirectory ? FILE_TYPE_NAMES[FILE_TYPES.FOLDER] : await getFileTypeName(finalName, db);

  const finalSize = isDirectory ? 0 : typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : 0;

  let finalModified;
  if (modified instanceof Date) {
    finalModified = modified.toISOString();
  } else if (typeof modified === "string") {
    finalModified = modified;
  } else if (modified && typeof modified.toISOString === "function") {
    finalModified = modified.toISOString();
  } else {
    finalModified = new Date().toISOString();
  }

  const finalMimetype = isDirectory
    ? "application/x-directory"
    : mimetype || null;

  return {
    path: fsPath,
    name: finalName,
    isDirectory,
    size: finalSize,
    modified: finalModified,
    mimetype: finalMimetype,
    mount_id: mount?.id ?? null,
    storage_type: storageType || mount?.storage_type || null,
    type,
    typeName,
  };
}

/**
 * 根据挂载视图路径推导名称
 * - 对目录：若路径以 / 结尾则去除尾部 / 再取最后一段
 * - 对根路径：返回 "" 或 "root" 由调用方控制（此处仅兜底）
 * @param {string} fsPath
 * @param {boolean} isDirectory
 * @returns {string}
 */
export function inferNameFromPath(fsPath, isDirectory) {
  if (!fsPath || typeof fsPath !== "string") {
    return isDirectory ? "" : "file";
  }

  let normalized = fsPath;
  if (isDirectory && normalized.endsWith("/")) {
    normalized = normalized.replace(/\/+$/, "");
  }

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return isDirectory ? "" : "file";
  }
  return segments[segments.length - 1];
}

export default {
  buildFileInfo,
  inferNameFromPath,
};
