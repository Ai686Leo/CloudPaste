/**
 * VfsNodesRepository
 * - 虚拟目录树索引（长期数据）
 *
 * root 约定：
 * - root 本身不占一条 vfs_nodes 记录
 * - root 下子节点使用 parent_id = ""（空字符串）
 */

import { BaseRepository } from "./BaseRepository.js";
import { DbTables } from "../constants/index.js";
import { ValidationError } from "../http/errors.js";
import { generateUUID } from "../utils/common.js";

export const VFS_ROOT_PARENT_ID = "";

const normalizeVfsPathSegments = (path) => {
  if (path === null || path === undefined) return [];
  const raw = String(path);
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "/") return [];
  return trimmed.split("/").filter(Boolean);
};

const safeJsonStringify = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

export class VfsNodesRepository extends BaseRepository {
  async listChildrenByParentId(params) {
    const { ownerType, ownerId, scopeType, scopeId, parentId } = params || {};
    if (!ownerType || !ownerId || !scopeType || !scopeId) {
      throw new ValidationError("listChildrenByParentId: 缺少 ownerType/ownerId/scopeType/scopeId");
    }
    const pid = typeof parentId === "string" ? parentId : VFS_ROOT_PARENT_ID;

    const result = await this.query(
      `
      SELECT *
      FROM ${DbTables.VFS_NODES}
      WHERE owner_type = ?
        AND owner_id = ?
        AND scope_type = ?
        AND scope_id = ?
        AND parent_id = ?
        AND status = 'active'
      ORDER BY node_type ASC, name ASC
      `,
      [ownerType, ownerId, scopeType, scopeId, pid],
    );

    return result?.results || [];
  }

  async getChildByName(params) {
    const { ownerType, ownerId, scopeType, scopeId, parentId, name } = params || {};
    if (!ownerType || !ownerId || !scopeType || !scopeId) {
      throw new ValidationError("getChildByName: 缺少 ownerType/ownerId/scopeType/scopeId");
    }
    if (!name) {
      throw new ValidationError("getChildByName: 缺少 name");
    }
    const pid = typeof parentId === "string" ? parentId : VFS_ROOT_PARENT_ID;

    return await this.queryFirst(
      `
      SELECT *
      FROM ${DbTables.VFS_NODES}
      WHERE owner_type = ?
        AND owner_id = ?
        AND scope_type = ?
        AND scope_id = ?
        AND parent_id = ?
        AND name = ?
      LIMIT 1
      `,
      [ownerType, ownerId, scopeType, scopeId, pid, name],
    );
  }

  /**
   * 将 path 解析到 node（任意一段不存在则返回 null）
   */
  async resolveNodeByPath(params) {
    const { ownerType, ownerId, scopeType, scopeId, path } = params || {};
    if (!ownerType || !ownerId || !scopeType || !scopeId) {
      throw new ValidationError("resolveNodeByPath: 缺少 ownerType/ownerId/scopeType/scopeId");
    }

    const segments = normalizeVfsPathSegments(path);
    if (segments.length === 0) return null; // root 没有 node 记录

    let currentParentId = VFS_ROOT_PARENT_ID;
    let currentNode = null;

    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      currentNode = await this.getChildByName({
        ownerType,
        ownerId,
        scopeType,
        scopeId,
        parentId: currentParentId,
        name: seg,
      });
      if (!currentNode) return null;
      currentParentId = String(currentNode.id);
    }

    return currentNode;
  }

  /**
   * mkdir -p：确保目录路径存在，返回最终目录节点
   */
  async ensureDirectoryPath(params) {
    const { ownerType, ownerId, scopeType, scopeId, path } = params || {};
    if (!ownerType || !ownerId || !scopeType || !scopeId) {
      throw new ValidationError("ensureDirectoryPath: 缺少 ownerType/ownerId/scopeType/scopeId");
    }

    const segments = normalizeVfsPathSegments(path);
    if (segments.length === 0) {
      return { parentId: VFS_ROOT_PARENT_ID, node: null };
    }

    let currentParentId = VFS_ROOT_PARENT_ID;
    let currentNode = null;

    for (const seg of segments) {
      const existing = await this.getChildByName({
        ownerType,
        ownerId,
        scopeType,
        scopeId,
        parentId: currentParentId,
        name: seg,
      });

      if (existing) {
        if (existing.node_type !== "dir") {
          throw new ValidationError(`路径冲突：${seg} 已存在但不是目录`);
        }
        currentNode = existing;
        currentParentId = String(existing.id);
        continue;
      }

      currentNode = await this.createDirectory({
        ownerType,
        ownerId,
        scopeType,
        scopeId,
        parentId: currentParentId,
        name: seg,
      });
      currentParentId = String(currentNode.id);
    }

    return { parentId: currentParentId, node: currentNode };
  }

  async createDirectory(params) {
    const { ownerType, ownerId, scopeType, scopeId, parentId = VFS_ROOT_PARENT_ID, name } = params || {};
    if (!ownerType || !ownerId || !scopeType || !scopeId) {
      throw new ValidationError("createDirectory: 缺少 ownerType/ownerId/scopeType/scopeId");
    }
    if (!name) {
      throw new ValidationError("createDirectory: 缺少 name");
    }

    const conflict = await this.getChildByName({ ownerType, ownerId, scopeType, scopeId, parentId, name });
    if (conflict) {
      throw new ValidationError("同目录下已存在同名文件/文件夹");
    }

    const id = `vfs_${generateUUID()}`;
    const now = new Date().toISOString();

    await this.create(DbTables.VFS_NODES, {
      id,
      owner_type: ownerType,
      owner_id: ownerId,
      scope_type: scopeType,
      scope_id: scopeId,
      parent_id: parentId,
      name,
      node_type: "dir",
      mime_type: null,
      size: null,
      hash_algo: null,
      hash_value: null,
      status: "active",
      // 目录没有内容后端，统一用占位值（driver 层展示仍以 mount.storage_type 为准）
      storage_type: "VFS",
      content_ref: null,
      created_at: now,
      updated_at: now,
    });

    return await this.getNodeById({ ownerType, ownerId, scopeType, scopeId, nodeId: id });
  }

  async createFileNode(params) {
    const { ownerType, ownerId, scopeType, scopeId, parentId = VFS_ROOT_PARENT_ID, name, mimeType = null, size = null, storageType, contentRef } = params || {};
    if (!ownerType || !ownerId || !scopeType || !scopeId) {
      throw new ValidationError("createFileNode: 缺少 ownerType/ownerId/scopeType/scopeId");
    }
    if (!name) {
      throw new ValidationError("createFileNode: 缺少 name");
    }
    if (!storageType) {
      throw new ValidationError("createFileNode: 缺少 storageType");
    }

    const conflict = await this.getChildByName({ ownerType, ownerId, scopeType, scopeId, parentId, name });
    if (conflict) {
      throw new ValidationError("同目录下已存在同名文件/文件夹");
    }

    const id = `vfs_${generateUUID()}`;
    const now = new Date().toISOString();

    await this.create(DbTables.VFS_NODES, {
      id,
      owner_type: ownerType,
      owner_id: ownerId,
      scope_type: scopeType,
      scope_id: scopeId,
      parent_id: parentId,
      name,
      node_type: "file",
      mime_type: mimeType,
      size: Number.isFinite(size) ? size : null,
      hash_algo: null,
      hash_value: null,
      status: "active",
      storage_type: storageType,
      content_ref: safeJsonStringify(contentRef),
      created_at: now,
      updated_at: now,
    });

    return await this.getNodeById({ ownerType, ownerId, scopeType, scopeId, nodeId: id });
  }

  /**
   * 创建或更新文件节点（同目录同名时更新内容）
   * - 用于 share 上传“覆盖写”（updateIfExists）以及同路径重传场景
   */
  async createOrUpdateFileNode(params) {
    const { ownerType, ownerId, scopeType, scopeId, parentId = VFS_ROOT_PARENT_ID, name, mimeType = null, size = null, storageType, contentRef } = params || {};
    if (!ownerType || !ownerId || !scopeType || !scopeId) {
      throw new ValidationError("createOrUpdateFileNode: 缺少 ownerType/ownerId/scopeType/scopeId");
    }
    if (!name) {
      throw new ValidationError("createOrUpdateFileNode: 缺少 name");
    }
    if (!storageType) {
      throw new ValidationError("createOrUpdateFileNode: 缺少 storageType");
    }

    const existing = await this.getChildByName({ ownerType, ownerId, scopeType, scopeId, parentId, name });
    if (!existing) {
      return await this.createFileNode({ ownerType, ownerId, scopeType, scopeId, parentId, name, mimeType, size, storageType, contentRef });
    }

    if (existing.node_type !== "file") {
      throw new ValidationError("同目录下已存在同名节点，但不是文件");
    }

    const now = new Date().toISOString();
    await this.execute(
      `
      UPDATE ${DbTables.VFS_NODES}
      SET
        mime_type = ?,
        size = ?,
        storage_type = ?,
        content_ref = ?,
        status = 'active',
        updated_at = ?
      WHERE id = ?
        AND owner_type = ?
        AND owner_id = ?
        AND scope_type = ?
        AND scope_id = ?
      `,
      [
        mimeType,
        Number.isFinite(size) ? size : null,
        storageType,
        safeJsonStringify(contentRef),
        now,
        String(existing.id),
        ownerType,
        ownerId,
        scopeType,
        scopeId,
      ],
    );

    return await this.getNodeById({ ownerType, ownerId, scopeType, scopeId, nodeId: String(existing.id) });
  }

  async renameNode(params) {
    const { ownerType, ownerId, scopeType, scopeId, nodeId, newName } = params || {};
    if (!ownerType || !ownerId || !scopeType || !scopeId || !nodeId) {
      throw new ValidationError("renameNode: 缺少 ownerType/ownerId/scopeType/scopeId/nodeId");
    }
    if (!newName) {
      throw new ValidationError("renameNode: 缺少 newName");
    }

    const node = await this.getNodeById({ ownerType, ownerId, scopeType, scopeId, nodeId });
    if (!node) {
      throw new ValidationError("节点不存在");
    }

    const conflict = await this.getChildByName({
      ownerType,
      ownerId,
      scopeType,
      scopeId,
      parentId: node.parent_id,
      name: newName,
    });
    if (conflict) {
      throw new ValidationError("同目录下已存在同名文件/文件夹");
    }

    const now = new Date().toISOString();
    await this.execute(
      `
      UPDATE ${DbTables.VFS_NODES}
      SET name = ?, updated_at = ?
      WHERE id = ? AND owner_type = ? AND owner_id = ? AND scope_type = ? AND scope_id = ?
      `,
      [newName, now, nodeId, ownerType, ownerId, scopeType, scopeId],
    );

    return await this.getNodeById({ ownerType, ownerId, scopeType, scopeId, nodeId });
  }

  async moveNode(params) {
    const { ownerType, ownerId, scopeType, scopeId, nodeId, newParentId } = params || {};
    if (!ownerType || !ownerId || !scopeType || !scopeId || !nodeId) {
      throw new ValidationError("moveNode: 缺少 ownerType/ownerId/scopeType/scopeId/nodeId");
    }
    const targetParentId = typeof newParentId === "string" ? newParentId : VFS_ROOT_PARENT_ID;

    const node = await this.getNodeById({ ownerType, ownerId, scopeType, scopeId, nodeId });
    if (!node) {
      throw new ValidationError("节点不存在");
    }

    const conflict = await this.getChildByName({
      ownerType,
      ownerId,
      scopeType,
      scopeId,
      parentId: targetParentId,
      name: node.name,
    });
    if (conflict) {
      throw new ValidationError("目标目录下已存在同名文件/文件夹");
    }

    const now = new Date().toISOString();
    await this.execute(
      `
      UPDATE ${DbTables.VFS_NODES}
      SET parent_id = ?, updated_at = ?
      WHERE id = ? AND owner_type = ? AND owner_id = ? AND scope_type = ? AND scope_id = ?
      `,
      [targetParentId, now, nodeId, ownerType, ownerId, scopeType, scopeId],
    );

    return await this.getNodeById({ ownerType, ownerId, scopeType, scopeId, nodeId });
  }

  async deleteNode(params) {
    const { ownerType, ownerId, scopeType, scopeId, nodeId, mode = "hard" } = params || {};
    if (!ownerType || !ownerId || !scopeType || !scopeId || !nodeId) {
      throw new ValidationError("deleteNode: 缺少 ownerType/ownerId/scopeType/scopeId/nodeId");
    }

    if (mode === "soft") {
      const now = new Date().toISOString();
      const result = await this.execute(
        `
        UPDATE ${DbTables.VFS_NODES}
        SET status = 'deleted', updated_at = ?
        WHERE id = ? AND owner_type = ? AND owner_id = ? AND scope_type = ? AND scope_id = ?
        `,
        [now, nodeId, ownerType, ownerId, scopeType, scopeId],
      );
      return { changes: result?.meta?.changes ?? result?.changes ?? 0 };
    }

    // hard delete：递归删子树（避免 orphan）
    const sql = `
      WITH RECURSIVE subtree(id) AS (
        SELECT id
        FROM ${DbTables.VFS_NODES}
        WHERE id = ? AND owner_type = ? AND owner_id = ? AND scope_type = ? AND scope_id = ?
        UNION ALL
        SELECT v.id
        FROM ${DbTables.VFS_NODES} v
        JOIN subtree s ON v.parent_id = s.id
        WHERE v.owner_type = ? AND v.owner_id = ? AND v.scope_type = ? AND v.scope_id = ?
      )
      DELETE FROM ${DbTables.VFS_NODES}
      WHERE id IN (SELECT id FROM subtree)
    `;

    const result = await this.execute(sql, [
      nodeId,
      ownerType,
      ownerId,
      scopeType,
      scopeId,
      ownerType,
      ownerId,
      scopeType,
      scopeId,
    ]);

    return { changes: result?.meta?.changes ?? result?.changes ?? 0 };
  }

  async getNodeById(params) {
    const { ownerType, ownerId, scopeType, scopeId, nodeId } = params || {};
    if (!ownerType || !ownerId || !scopeType || !scopeId || !nodeId) return null;
    return await this.queryFirst(
      `
      SELECT *
      FROM ${DbTables.VFS_NODES}
      WHERE id = ?
        AND owner_type = ?
        AND owner_id = ?
        AND scope_type = ?
        AND scope_id = ?
      LIMIT 1
      `,
      [nodeId, ownerType, ownerId, scopeType, scopeId],
    );
  }

  async getNodeByPath(params) {
    const { ownerType, ownerId, scopeType, scopeId, path } = params || {};
    const node = await this.resolveNodeByPath({ ownerType, ownerId, scopeType, scopeId, path });
    return node || null;
  }

  /**
   * 不带 owner/scope 的“按 id 读取”兜底方法
   * - 仅用于 storage-first 的 vfs:<id> 反查（上层已有权限判定：share slug / 管理后台）
   */
  async getNodeByIdUnsafe(nodeId) {
    if (!nodeId) return null;
    return await this.queryFirst(
      `SELECT * FROM ${DbTables.VFS_NODES} WHERE id = ? LIMIT 1`,
      [nodeId],
    );
  }
}
