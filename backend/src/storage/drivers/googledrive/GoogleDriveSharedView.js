/**
 * Google Drive sharedWithMe 虚拟目录支持模块
 *
 */

import { DriverError } from "../../../http/errors.js";
import { FILE_TYPES, FILE_TYPE_NAMES } from "../../../constants/index.js";
import { GetFileType, getFileTypeName } from "../../../utils/fileTypeDetector.js";

// 虚拟目录前缀常量：用于 sharedWithMe 视图内部路径
export const SHARED_WITH_ME_SEGMENT = "__shared_with_me__";
// 兼容别名：用于 WebDAV 等场景下用户可能直接访问的可读名称
const SHARED_WITH_ME_ALIAS = "Shared with me";

/**
 * 判定路径片段是否落在 sharedWithMe 虚拟视图下
 * @param {string[]} segments
 * @returns {boolean}
 */
export function isSharedWithMePath(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return false;
  const head = segments[0];
  return head === SHARED_WITH_ME_SEGMENT || head === SHARED_WITH_ME_ALIAS;
}

/**
 * 解析 sharedWithMe 路径到 fileId/driveItem 信息
 * 约定：
 * - 根：/mount/__shared_with_me__/ -> 无具体 fileId，仅表示虚拟目录
 * - 其它：最后一段视为 fileId，直接调用 files.get
 *
 * @param {string[]} segments 有效子路径片段
 * @param {import("./GoogleDriveApiClient.js").GoogleDriveApiClient} apiClient
 */
export async function resolveSharedWithMePath(segments, apiClient) {
  if (!isSharedWithMePath(segments)) return null;

  // 去掉前缀后的路径片段，例如:
  // - ["__shared_with_me__"]                -> []
  // - ["__shared_with_me__", "foo.md"]      -> ["foo.md"]
  // - ["__shared_with_me__", "dir", "bar"]  -> ["dir", "bar"]
  const innerSegments = segments.slice(1);

  // 根：没有具体 fileId，仅表示一个虚拟目录
  if (innerSegments.length === 0) {
    return {
      fileId: null,
      isDirectory: true,
      name: SHARED_WITH_ME_SEGMENT,
      driveItem: null,
    };
  }

  // 规范：sharedWithMe 视图下，路径片段一律按「名称」解析，不再尝试猜测 fileId，
  // 避免冗余逻辑和模糊行为。名称冲突场景下，采用第一条匹配记录。
  let currentItem = null;
  let currentId = null;

  for (let index = 0; index < innerSegments.length; index++) {
    const segment = innerSegments[index];
    const escapedName = segment.replace(/'/g, "\\'");

    // 第一个片段：在 sharedWithMe 根下按名称查找
    const q =
      index === 0
        ? `sharedWithMe = true and name = '${escapedName}' and trashed = false`
        : `'${currentId}' in parents and name = '${escapedName}' and trashed = false`;

    const res = await apiClient.listFiles(index === 0 ? null : currentId, {
      q,
      pageSize: 2,
    });

    const files = Array.isArray(res.files) ? res.files : [];
    if (files.length === 0) {
      throw new DriverError(`指定路径不存在: ${segment}`, {
        status: 404,
        code: "DRIVER_ERROR.GDRIVE.SHARED_NOT_FOUND",
      });
    }

    currentItem = files[0];
    currentId = currentItem.id;
  }

  const isDirectory = currentItem.mimeType === "application/vnd.google-apps.folder";

  return {
    fileId: currentId,
    isDirectory,
    name: currentItem.name,
    driveItem: currentItem,
  };
}

/**
 * sharedWithMe 虚拟目录列表实现
 * 路径约定：
 * - /<mount>/__shared_with_me__/              -> 列出 sharedWithMe = true 的所有条目
 * - /<mount>/__shared_with_me__/<dirId>/...  -> 以 dirId 作为父目录列出其子项
 *
 * @param {object} params
 * @param {string} params.path  FS 视图路径（包含挂载前缀）
 * @param {string[]} params.segments 有效子路径片段
 * @param {import("./GoogleDriveApiClient.js").GoogleDriveApiClient} params.apiClient
 * @param {any} params.mount 挂载信息
 * @param {D1Database} params.db D1 数据库实例
 */
export async function listSharedWithMeDirectory({ path, segments, apiClient, mount, db, options = {} }) {
  const cursorRaw = options?.cursor != null && String(options.cursor).trim() ? String(options.cursor).trim() : null;
  const limitRaw = options?.limit != null && options.limit !== "" ? Number(options.limit) : null;
  const limit =
    limitRaw != null && Number.isFinite(limitRaw) && limitRaw > 0 ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : null;
  const paged = options?.paged === true || !!cursorRaw || limit != null;

  let res;
  let nextCursor = null;

  // 根：使用 sharedWithMe = true 过滤
  if (segments.length === 1) {
    if (paged) {
      res = await apiClient.listFiles(null, {
        q: "sharedWithMe = true and trashed = false",
        pageSize: limit ?? 1000,
        pageToken: cursorRaw || undefined,
      });
      nextCursor = res?.nextPageToken ? String(res.nextPageToken) : null;
    } else {
      /** @type {any[]} */
      const all = [];
      let pageToken = undefined;
      while (true) {
        const page = await apiClient.listFiles(null, {
          q: "sharedWithMe = true and trashed = false",
          pageSize: limit ?? 1000,
          pageToken,
        });
        all.push(...(Array.isArray(page?.files) ? page.files : []));
        pageToken = page?.nextPageToken ? String(page.nextPageToken) : undefined;
        if (!pageToken) break;
      }
      res = { files: all };
    }
  } else {
    // 非根：最后一段视为父目录 fileId
    const parentId = segments[segments.length - 1];

    // 先确认父项是目录
    const parent = await apiClient.getFile(parentId, {});
    const isDir = parent.mimeType === "application/vnd.google-apps.folder";
    if (!isDir) {
      throw new DriverError("目标路径不是目录", { status: 400 });
    }

    if (paged) {
      res = await apiClient.listFiles(parentId, {
        pageSize: limit ?? 1000,
        pageToken: cursorRaw || undefined,
      });
      nextCursor = res?.nextPageToken ? String(res.nextPageToken) : null;
    } else {
      /** @type {any[]} */
      const all = [];
      let pageToken = undefined;
      while (true) {
        const page = await apiClient.listFiles(parentId, { pageSize: limit ?? 1000, pageToken });
        all.push(...(Array.isArray(page?.files) ? page.files : []));
        pageToken = page?.nextPageToken ? String(page.nextPageToken) : undefined;
        if (!pageToken) break;
      }
      res = { files: all };
    }
  }

  const files = Array.isArray(res.files) ? res.files : [];

  const parentPath =
    typeof path === "string" && path.length > 0 ? path.replace(/\/+$/, "") : "";

  const formattedItems = await Promise.all(
    files.map(async (item) => {
      const isDir = item.mimeType === "application/vnd.google-apps.folder";
      const name = item.name;

      // sharedWithMe 视图下，路径使用名称作为最后一段，保持与 FS 其它驱动一致的行为；
      // resolveSharedWithMePath 会同时支持名称与 fileId。
      let childPath = `${parentPath}/${name}`.replace(/[\\/]+/g, "/");
      if (isDir && typeof childPath === "string" && !childPath.endsWith("/")) {
        childPath = `${childPath}/`;
      }

      const type = isDir ? FILE_TYPES.FOLDER : await GetFileType(name, db);
      const typeName = isDir ? FILE_TYPE_NAMES.FOLDER : await getFileTypeName(name, db);
      const size = isDir ? null : Number(item.size || 0);
      const modified = item.modifiedTime ? new Date(item.modifiedTime) : null;
      const mimetype = isDir ? "application/x-directory" : item.mimeType || null;

      return {
        path: childPath,
        name,
        isDirectory: isDir,
        size,
        modified,
        mimetype,
        type,
        typeName,
        mount_id: mount?.id,
        storage_type: mount?.storage_type || "GOOGLE_DRIVE",
      };
    }),
  );

  return {
    path,
    type: "directory",
    isRoot: segments.length === 1,
    isVirtual: true,
    mount_id: mount?.id,
    storage_type: mount?.storage_type || "GOOGLE_DRIVE",
    items: formattedItems,
    ...(paged ? { hasMore: !!nextCursor, nextCursor } : {}),
  };
}

/**
 * 在挂载根目录下为 items 注入一个 sharedWithMe 虚拟入口
 * @param {object} params
 * @param {string} params.path 当前目录路径
 * @param {any} params.mount 挂载信息
 * @param {Array} params.items 目录项数组（原位修改）
 */
export function injectSharedWithMeEntry({ path, mount, items }) {
  const parentPath =
    typeof path === "string" && path.length > 0 ? path.replace(/\/+$/, "") : "";
  let sharedPath = `${parentPath}/${SHARED_WITH_ME_SEGMENT}`.replace(/[\\/]+/g, "/");
  if (!sharedPath.endsWith("/")) {
    sharedPath = `${sharedPath}/`;
  }

  items.unshift({
    path: sharedPath,
    name: "Shared with me",
    isDirectory: true,
    // 虚拟目录：大小未知就保持 null（前端显示 “-”）
    size: null,
    modified: null,
    mimetype: "application/x-directory",
    type: FILE_TYPES.FOLDER,
    typeName: FILE_TYPE_NAMES.FOLDER,
    mount_id: mount?.id,
    storage_type: mount?.storage_type || "GOOGLE_DRIVE",
    isVirtual: true,
  });
}
