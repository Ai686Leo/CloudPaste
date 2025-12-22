/**
 * PrincipalStorageAclRepository
 * 负责主体 -> 存储配置（storage_configs）访问白名单的持久化
 */

import { BaseRepository } from "./BaseRepository.js";
import { DbTables } from "../constants/index.js";

export class PrincipalStorageAclRepository extends BaseRepository {
  /**
   * 根据主体获取可访问的 storage_config_id 列表
   * @param {string} subjectType - 主体类型，例如 'API_KEY' / 'USER' / 'ROLE'
   * @param {string} subjectId - 主体 ID
   * @returns {Promise<string[]>} 可访问的 storage_config_id 列表
   */
  async findConfigIdsBySubject(subjectType, subjectId) {
    if (!subjectType || !subjectId) {
      return [];
    }

    const result = await this.query(
      `SELECT storage_config_id FROM ${DbTables.PRINCIPAL_STORAGE_ACL} WHERE subject_type = ? AND subject_id = ?`,
      [subjectType, subjectId]
    );

    const rows = result.results || [];
    return rows.map((row) => row.storage_config_id).filter(Boolean);
  }

  /**
   * 为主体添加一条存储配置访问权限绑定（幂等）
   */
  async addBinding(subjectType, subjectId, storageConfigId) {
    if (!subjectType || !subjectId || !storageConfigId) {
      return;
    }

    const sql = this._buildInsertIgnoreSql(DbTables.PRINCIPAL_STORAGE_ACL, [
      "subject_type",
      "subject_id",
      "storage_config_id",
    ]);
    await this.execute(
      sql,
      [subjectType, subjectId, storageConfigId]
    );
  }

  /**
   * 为主体移除一条存储配置访问权限绑定
   */
  async removeBinding(subjectType, subjectId, storageConfigId) {
    if (!subjectType || !subjectId || !storageConfigId) {
      return;
    }

    await this.execute(
      `DELETE FROM ${DbTables.PRINCIPAL_STORAGE_ACL} WHERE subject_type = ? AND subject_id = ? AND storage_config_id = ?`,
      [subjectType, subjectId, storageConfigId]
    );
  }

  /**
   * 用一组 storage_config_id 替换某主体的所有绑定
   * 传入空数组表示清空白名单（回退到默认行为）
   */
  async replaceBindings(subjectType, subjectId, storageConfigIds) {
    if (!subjectType || !subjectId) {
      return;
    }

    // 先清空现有绑定
    await this.execute(
      `DELETE FROM ${DbTables.PRINCIPAL_STORAGE_ACL} WHERE subject_type = ? AND subject_id = ?`,
      [subjectType, subjectId]
    );

    if (!Array.isArray(storageConfigIds) || storageConfigIds.length === 0) {
      return;
    }

    // 逐条插入新的绑定
    for (const configId of storageConfigIds) {
      if (!configId) continue;
      const sql = this._buildInsertIgnoreSql(DbTables.PRINCIPAL_STORAGE_ACL, [
        "subject_type",
        "subject_id",
        "storage_config_id",
      ]);
      await this.execute(
        sql,
        [subjectType, subjectId, configId]
      );
    }
  }

  /**
   * 根据存储配置ID批量删除所有 ACL 绑定
   * @param {string} storageConfigId - storage_configs.id
   * @returns {Promise<void>}
   */
  async deleteByStorageConfigId(storageConfigId) {
    if (!storageConfigId) {
      return;
    }

    await this.execute(
      `DELETE FROM ${DbTables.PRINCIPAL_STORAGE_ACL} WHERE storage_config_id = ?`,
      [storageConfigId]
    );
  }
}
