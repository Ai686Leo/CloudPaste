/**
 * DiscordOperations（VFS 索引层 CRUD）
 *
 * 大白话说明：
 * - Discord 本质是“消息 + 附件”，它没有“按目录列文件”的能力；
 * - 所以 CloudPaste 里的“网盘目录树”必须落在数据库 vfs_nodes 表；
 * - 这些操作（rename/copy/delete）只动 vfs_nodes，不会去删 Discord 里的真实消息内容（先按 index-only 口径）。
 */

import { ValidationError } from "../../../http/errors.js";
import { VfsNodesRepository, VFS_ROOT_PARENT_ID } from "../../../repositories/VfsNodesRepository.js";

// =========================
// 1) 工具函数（无副作用）
// =========================

export function toPosixPath(p) {
  if (p == null) return "/";
  let s = String(p).replace(/\\\\/g, "/");
  s = s.replace(/\/+/g, "/");
  if (!s.startsWith("/")) s = `/${s}`;
  return s;
}

export function stripTrailingSlash(p) {
  const s = String(p || "");
  if (s === "/") return "/";
  return s.replace(/\/+$/, "");
}

export function splitDirAndName(posixPath) {
  const p = stripTrailingSlash(toPosixPath(posixPath));
  if (p === "/") return { dirPath: "/", name: "" };
  const idx = p.lastIndexOf("/");
  if (idx <= 0) return { dirPath: "/", name: p.slice(1) };
  const dir = p.slice(0, idx) || "/";
  const name = p.slice(idx + 1);
  return { dirPath: dir || "/", name };
}

export function safeJsonParse(text) {
  if (!text) return null;
  if (typeof text === "object") return text;
  try {
    return JSON.parse(String(text));
  } catch {
    return null;
  }
}

// =========================
// 2) 索引层 CRUD（只动 vfs_nodes）
// =========================

export async function discordRenameItem(driver, oldSubPath, newSubPath, ctx = {}) {
  driver._ensureInitialized();
  const db = ctx?.db || null;
  if (!db) throw new ValidationError("DISCORD.renameItem: 缺少 db");

  const oldPath = ctx?.oldPath;
  const newPath = ctx?.newPath;

  const { ownerType, ownerId } = driver._getOwnerFromOptions(ctx);
  const { scopeType, scopeId } = driver._getScopeFromOptions(ctx);
  const repo = new VfsNodesRepository(db, null);

  const oldSub = toPosixPath(oldSubPath || "/");
  const newSub = toPosixPath(newSubPath || "/");

  const node = await repo.resolveNodeByPath({ ownerType, ownerId, scopeType, scopeId, path: oldSub });
  if (!node) {
    return { success: false, source: oldPath, target: newPath, message: "源路径不存在" };
  }

  const { dirPath: newDirPath, name: newName } = splitDirAndName(newSub);
  if (!newName) {
    return { success: false, source: oldPath, target: newPath, message: "目标名称为空" };
  }

  // mkdir -p：确保目标父目录存在
  const ensured = await repo.ensureDirectoryPath({ ownerType, ownerId, scopeType, scopeId, path: newDirPath });
  const targetParentId = ensured?.parentId ?? VFS_ROOT_PARENT_ID;

  // 先改名，再移动
  let current = node;
  if (String(current.name) !== String(newName)) {
    current = await repo.renameNode({ ownerType, ownerId, scopeType, scopeId, nodeId: String(current.id), newName });
  }

  if (String(current.parent_id) !== String(targetParentId)) {
    current = await repo.moveNode({
      ownerType,
      ownerId,
      scopeType,
      scopeId,
      nodeId: String(current.id),
      newParentId: targetParentId,
    });
  }

  return { success: true, source: oldPath, target: newPath, message: undefined };
}

export async function discordBatchRemoveItems(driver, paths, options = {}) {
  driver._ensureInitialized();
  const db = options?.db || null;
  if (!db) throw new ValidationError("DISCORD.batchRemoveItems: 缺少 db");

  if (!Array.isArray(paths) || paths.length === 0) {
    return { success: 0, failed: [] };
  }

  if (!Array.isArray(options?.paths) || options.paths.length !== paths.length) {
    throw new ValidationError("DISCORD.batchRemoveItems 需要 ctx.paths 与 subPaths 一一对应（不做兼容）");
  }

  const { ownerType, ownerId } = driver._getOwnerFromOptions(options);
  const { scopeType, scopeId } = driver._getScopeFromOptions(options);
  const repo = new VfsNodesRepository(db, null);

  const fsPaths = options.paths;
  const failed = [];
  let success = 0;

  for (let i = 0; i < paths.length; i += 1) {
    const fsPath = fsPaths[i];
    const subPath = paths[i];
    try {
      const normalizedSubPath = toPosixPath(subPath || "/");
      const node = await repo.resolveNodeByPath({ ownerType, ownerId, scopeType, scopeId, path: normalizedSubPath });
      if (!node) {
        // 不存在：视为已删除
        success += 1;
        continue;
      }

      // Discord：先按 index-only（只删索引）口径
      await repo.deleteNode({ ownerType, ownerId, scopeType, scopeId, nodeId: String(node.id), mode: "hard" });
      success += 1;
    } catch (e) {
      failed.push({ path: fsPath, error: e?.message || String(e) });
    }
  }

  return { success, failed };
}

async function copyDirectoryTree(driver, repo, { ownerType, ownerId, scopeType, scopeId, sourceDirId, targetDirId }) {
  const children = await repo.listChildrenByParentId({ ownerType, ownerId, scopeType, scopeId, parentId: sourceDirId });
  for (const row of children) {
    if (row.node_type === "dir") {
      const newDir = await repo
        .createDirectory({
          ownerType,
          ownerId,
          scopeType,
          scopeId,
          parentId: targetDirId,
          name: row.name,
        })
        .catch(async () => {
          const existsDir = await repo.getChildByName({
            ownerType,
            ownerId,
            scopeType,
            scopeId,
            parentId: targetDirId,
            name: row.name,
          });
          if (!existsDir || existsDir.node_type !== "dir") throw new ValidationError("目录复制冲突：目标同名不是目录");
          return existsDir;
        });

      await copyDirectoryTree(driver, repo, {
        ownerType,
        ownerId,
        scopeType,
        scopeId,
        sourceDirId: String(row.id),
        targetDirId: String(newDir.id),
      });
      continue;
    }

    await repo.createOrUpdateFileNode({
      ownerType,
      ownerId,
      scopeType,
      scopeId,
      parentId: targetDirId,
      name: row.name,
      mimeType: row.mime_type || null,
      size: row.size || null,
      storageType: row.storage_type || driver.type,
      contentRef: safeJsonParse(row.content_ref) || row.content_ref,
    });
  }
}

export async function discordCopyItem(driver, sourceSubPath, targetSubPath, ctx = {}) {
  driver._ensureInitialized();
  const db = ctx?.db || null;
  if (!db) throw new ValidationError("DISCORD.copyItem: 缺少 db");

  const sourcePath = ctx?.sourcePath;
  const targetPath = ctx?.targetPath;

  const { ownerType, ownerId } = driver._getOwnerFromOptions(ctx);
  const { scopeType, scopeId } = driver._getScopeFromOptions(ctx);
  const repo = new VfsNodesRepository(db, null);

  const skipExisting = !!ctx?.skipExisting;

  const sourceSub = toPosixPath(sourceSubPath || "/");
  const targetSub = toPosixPath(targetSubPath || "/");

  const src = await repo.resolveNodeByPath({ ownerType, ownerId, scopeType, scopeId, path: sourceSub });
  if (!src) {
    return { status: "failed", source: sourcePath, target: targetPath, message: "源路径不存在" };
  }

  const { dirPath: targetDirPath, name: targetName } = splitDirAndName(targetSub);
  if (!targetName) {
    return { status: "failed", source: sourcePath, target: targetPath, message: "目标名称为空" };
  }

  // mkdir -p：确保目标父目录存在
  const ensured = await repo.ensureDirectoryPath({ ownerType, ownerId, scopeType, scopeId, path: targetDirPath });
  const targetParentId = ensured?.parentId ?? VFS_ROOT_PARENT_ID;

  // skipExisting：如果目标已存在，直接跳过
  if (skipExisting) {
    const exists = await repo.getChildByName({ ownerType, ownerId, scopeType, scopeId, parentId: targetParentId, name: targetName });
    if (exists) {
      return { status: "skipped", source: sourcePath, target: targetPath, skipped: true, reason: "target_exists" };
    }
  }

  if (src.node_type === "dir") {
    const targetDirNode = await repo
      .createDirectory({ ownerType, ownerId, scopeType, scopeId, parentId: targetParentId, name: targetName })
      .catch(async () => {
        const existsDir = await repo.getChildByName({
          ownerType,
          ownerId,
          scopeType,
          scopeId,
          parentId: targetParentId,
          name: targetName,
        });
        if (!existsDir || existsDir.node_type !== "dir") throw new ValidationError("目标已存在但不是目录");
        return existsDir;
      });

    await copyDirectoryTree(driver, repo, {
      ownerType,
      ownerId,
      scopeType,
      scopeId,
      sourceDirId: String(src.id),
      targetDirId: String(targetDirNode.id),
    });
    return { status: "success", source: sourcePath, target: targetPath, skipped: false };
  }

  // 文件复制：复用 content_ref
  await repo.createOrUpdateFileNode({
    ownerType,
    ownerId,
    scopeType,
    scopeId,
    parentId: targetParentId,
    name: targetName,
    mimeType: src.mime_type || null,
    size: src.size || null,
    storageType: src.storage_type || driver.type,
    contentRef: safeJsonParse(src.content_ref) || src.content_ref,
  });

  return { status: "success", source: sourcePath, target: targetPath, skipped: false };
}

export async function discordDeleteObjectByStoragePath(driver, storagePath, options = {}) {
  driver._ensureInitialized();
  const db = options?.db || null;
  if (!db) throw new ValidationError("DISCORD.deleteObjectByStoragePath: 缺少 db");

  const nodeId = driver._parseVfsStoragePath(storagePath);
  if (!nodeId) {
    throw new ValidationError("DISCORD.deleteObjectByStoragePath: 仅支持 vfs:<id> 形式的 storagePath");
  }

  const repo = new VfsNodesRepository(db, null);
  const node = await repo.getNodeByIdUnsafe(nodeId);
  if (!node) return { success: true };

  await repo.deleteNode({
    ownerType: node.owner_type,
    ownerId: node.owner_id,
    scopeType: node.scope_type,
    scopeId: node.scope_id,
    nodeId: String(node.id),
    mode: "hard",
  });

  return { success: true };
}
