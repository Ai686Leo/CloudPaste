/**
 * 通用存储配置 Repository（基于 storage_configs + config_json）
 * - 统一从 storage_configs 读取，驱动私有配置存于 config_json（JSON）
 * - 返回对象时展开常用字段到顶层（endpoint_url/provider_type/bucket_name等）
 * - WithSecrets 版本才返回 access_key_id/secret_access_key/password
 * - 支持多种存储类型：S3、WebDAV（未来可扩展）
 */
import { BaseRepository } from "./BaseRepository.js";
import { DbTables } from "../constants/index.js";

export class StorageConfigRepository extends BaseRepository {
  /**
   * 展开 S3 专用字段
   * @private
   * @param {object} cfg - config_json 解析后的对象
   * @param {object} merged - 合并目标对象
   * @param {object} options - 选项
   */
  _inflateS3Fields(cfg, merged, { withSecrets = false }) {
    merged.provider_type = cfg?.provider_type;
    merged.endpoint_url = cfg?.endpoint_url;
    merged.bucket_name = cfg?.bucket_name;
    merged.region = cfg?.region;
    merged.path_style = cfg?.path_style;
    if (withSecrets) {
      merged.access_key_id = cfg?.access_key_id;
      merged.secret_access_key = cfg?.secret_access_key;
    }
  }

  /**
   * 展开 WebDAV 专用字段
   * @private
   * @param {object} cfg - config_json 解析后的对象
   * @param {object} merged - 合并目标对象
   * @param {object} options - 选项
   */
  _inflateWebDavFields(cfg, merged, { withSecrets = false }) {
    merged.endpoint_url = cfg?.endpoint_url;
    merged.username = cfg?.username;
    merged.tls_insecure_skip_verify = cfg?.tls_insecure_skip_verify;
    if (withSecrets) {
      merged.password = cfg?.password;
    }
  }

  /**
   * 展开 LOCAL 专用字段
   * @private
   * @param {object} cfg - config_json 解析后的对象
   * @param {object} merged - 合并目标对象
   */
  _inflateLocalFields(cfg, merged) {
    merged.root_path = cfg?.root_path;
    merged.auto_create_root = cfg?.auto_create_root;
    merged.readonly = cfg?.readonly;
    merged.trash_path = cfg?.trash_path;
    merged.dir_permission = cfg?.dir_permission;
  }

  /**
   * 通用展开方法（策略模式）
   * 根据 storage_type 自动选择对应的字段展开策略
   * @param {object} row - 数据库原始行
   * @param {object} options - 选项
   * @returns {object|null} 展开后的配置对象
   */
  _inflate(row, { withSecrets = false } = {}) {
    if (!row) return null;
    try {
      if (row.config_json) {
        const cfg = JSON.parse(row.config_json);
        const merged = {
          ...row,
          // 通用字段（所有存储类型共享）
          default_folder: cfg?.default_folder,
          custom_host: cfg?.custom_host,
          signature_expires_in: cfg?.signature_expires_in,
          total_storage_bytes: cfg?.total_storage_bytes,
        };

        // 根据存储类型展开专用字段
        switch (row.storage_type) {
          case "S3":
            this._inflateS3Fields(cfg, merged, { withSecrets });
            break;
          case "WEBDAV":
            this._inflateWebDavFields(cfg, merged, { withSecrets });
            break;
          case "LOCAL":
            this._inflateLocalFields(cfg, merged);
            break;
          default:
            console.warn(`Unknown storage_type: ${row.storage_type}`);
        }

        // 保留原始 config_json 对象（非枚举属性，避免对外暴露）
        Object.defineProperty(merged, "__config_json__", {
          value: cfg,
          enumerable: false,
          configurable: false,
          writable: false,
        });
        delete merged.config_json;
        return merged;
      }
    } catch (error) {
      console.error("Failed to inflate storage config:", error);
    }
    const { config_json, ...rest } = row;
    return rest;
  }

  _inflateList(rows, { withSecrets = false } = {}) {
    return Array.isArray(rows) ? rows.map((r) => this._inflate(r, { withSecrets })) : [];
  }

  async findById(configId) {
    const row = await super.findById(DbTables.STORAGE_CONFIGS, configId);
    return this._inflate(row, { withSecrets: false });
  }

  async findByIdWithSecrets(configId) {
    const row = await this.queryFirst(`SELECT * FROM ${DbTables.STORAGE_CONFIGS} WHERE id = ?`, [configId]);
    return this._inflate(row, { withSecrets: true });
  }

  async findByAdmin(adminId) {
    const rows = await this.findMany(DbTables.STORAGE_CONFIGS, { admin_id: adminId }, { orderBy: "name ASC" });
    return this._inflateList(rows);
  }

  async findByAdminWithPagination(adminId, options = {}) {
    const { page = 1, limit = 10 } = options;
    const offset = (page - 1) * limit;
    const total = await this.count(DbTables.STORAGE_CONFIGS, { admin_id: adminId });
    const rows = await this.findMany(DbTables.STORAGE_CONFIGS, { admin_id: adminId }, { orderBy: "name ASC", limit, offset });
    return {
      configs: this._inflateList(rows),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findDefault(options = {}) {
    const { requirePublic = false, adminId = null, withSecrets = false } = options;
    let sql = `SELECT * FROM ${DbTables.STORAGE_CONFIGS} WHERE is_default = 1`;
    const params = [];
    if (adminId) {
      sql += ` AND admin_id = ?`;
      params.push(adminId);
    }
    if (requirePublic) {
      sql += ` AND is_public = 1`;
    }
    sql += ` ORDER BY updated_at DESC LIMIT 1`;
    const row = await this.queryFirst(sql, params);
    return this._inflate(row, { withSecrets });
  }

  async findFirstPublic(options = {}) {
    const { withSecrets = false } = options;
    const row = await this.queryFirst(`SELECT * FROM ${DbTables.STORAGE_CONFIGS} WHERE is_public = 1 ORDER BY is_default DESC, updated_at DESC LIMIT 1`);
    return this._inflate(row, { withSecrets });
  }

  async findByProviderType(providerType, adminId = null) {
    let sql = `SELECT * FROM ${DbTables.STORAGE_CONFIGS} WHERE storage_type='S3' AND json_extract(config_json,'$.provider_type') = ?`;
    const params = [providerType];
    if (adminId) {
      sql += ` AND admin_id = ?`;
      params.push(adminId);
    }
    sql += ` ORDER BY name ASC`;
    const res = await this.query(sql, params);
    return this._inflateList(res.results || []);
  }

  async createConfig(data) {
    const dataWithTimestamp = {
      ...data,
      created_at: data.created_at || new Date().toISOString(),
      updated_at: data.updated_at || new Date().toISOString(),
    };
    return await this.create(DbTables.STORAGE_CONFIGS, dataWithTimestamp);
  }

  async updateConfig(configId, updateData) {
    const dataWithTimestamp = {
      ...updateData,
      updated_at: new Date().toISOString(),
    };
    return await this.update(DbTables.STORAGE_CONFIGS, configId, dataWithTimestamp);
  }

  async updateLastUsed(configId) {
    return await this.execute(`UPDATE ${DbTables.STORAGE_CONFIGS} SET last_used = CURRENT_TIMESTAMP WHERE id = ?`, [configId]);
  }

  async deleteConfig(configId) {
    return await this.delete(DbTables.STORAGE_CONFIGS, configId);
  }

  async existsByName(name, adminId, excludeId = null) {
    if (excludeId) {
      const result = await this.queryFirst(`SELECT id FROM ${DbTables.STORAGE_CONFIGS} WHERE name = ? AND admin_id = ? AND id != ?`, [name, adminId, excludeId]);
      return !!result;
    }
    return await this.exists(DbTables.STORAGE_CONFIGS, { name, admin_id: adminId });
  }

  async countByAdmin(adminId) {
    return await this.count(DbTables.STORAGE_CONFIGS, { admin_id: adminId });
  }

  async findAll() {
    const rows = await this.findMany(DbTables.STORAGE_CONFIGS, {}, { orderBy: "admin_id ASC, name ASC" });
    return this._inflateList(rows);
  }

  async findByEndpoint(endpointUrl, adminId) {
    const res = await this.query(`SELECT * FROM ${DbTables.STORAGE_CONFIGS} WHERE json_extract(config_json,'$.endpoint_url') = ? AND admin_id = ? ORDER BY name ASC`, [
      endpointUrl,
      adminId,
    ]);
    return this._inflateList(res.results || []);
  }

  async findByBucket(bucketName, adminId) {
    const res = await this.query(
      `SELECT * FROM ${DbTables.STORAGE_CONFIGS} WHERE storage_type='S3' AND json_extract(config_json,'$.bucket_name') = ? AND admin_id = ? ORDER BY name ASC`,
      [bucketName, adminId]
    );
    return this._inflateList(res.results || []);
  }

  async getStatistics(adminId = null) {
    const conditions = adminId ? { admin_id: adminId } : {};
    const total = await this.count(DbTables.STORAGE_CONFIGS, conditions);
    let sql = `
      SELECT json_extract(config_json,'$.provider_type') AS provider_type, COUNT(*) as count
      FROM ${DbTables.STORAGE_CONFIGS}
      WHERE storage_type='S3'
    `;
    const params = [];
    if (adminId) {
      sql += ` AND admin_id = ?`;
      params.push(adminId);
    }
    sql += ` GROUP BY provider_type`;
    const providerStats = await this.query(sql, params);
    return { total, byProvider: providerStats.results || [] };
  }

  async findRecentlyUsed(adminId, limit = 10) {
    const result = await this.query(
      `
      SELECT * FROM ${DbTables.STORAGE_CONFIGS}
      WHERE admin_id = ? AND last_used IS NOT NULL
      ORDER BY last_used DESC
      LIMIT ?
      `,
      [adminId, limit]
    );
    return this._inflateList(result.results || []);
  }

  async batchDelete(configIds) {
    if (!configIds || configIds.length === 0) {
      return { deletedCount: 0, message: "没有要删除的配置" };
    }
    const placeholders = configIds.map(() => "?").join(",");
    const result = await this.execute(`DELETE FROM ${DbTables.STORAGE_CONFIGS} WHERE id IN (${placeholders})`, configIds);
    return { deletedCount: result.meta?.changes || 0, message: `已删除${result.meta?.changes || 0}个配置` };
  }

  async findByRegion(region, adminId) {
    const res = await this.query(
      `SELECT * FROM ${DbTables.STORAGE_CONFIGS} WHERE storage_type='S3' AND json_extract(config_json,'$.region') = ? AND admin_id = ? ORDER BY name ASC`,
      [region, adminId]
    );
    return this._inflateList(res.results || []);
  }

  async findByIdAndAdmin(configId, adminId) {
    const row = await this.findOne(DbTables.STORAGE_CONFIGS, { id: configId, admin_id: adminId });
    return this._inflate(row, { withSecrets: false });
  }

  async findByIdAndAdminWithSecrets(configId, adminId) {
    const row = await this.queryFirst(`SELECT * FROM ${DbTables.STORAGE_CONFIGS} WHERE id = ? AND admin_id = ?`, [configId, adminId]);
    return this._inflate(row, { withSecrets: true });
  }

  async findPublic() {
    const rows = await this.findMany(DbTables.STORAGE_CONFIGS, { is_public: 1 }, { orderBy: "name ASC" });
    return this._inflateList(rows);
  }

  async findPublicById(configId) {
    const row = await this.findOne(DbTables.STORAGE_CONFIGS, { id: configId, is_public: 1 });
    return this._inflate(row, { withSecrets: false });
  }

  async setAsDefault(configId, adminId) {
    await this.db.batch([
      this.db.prepare(`UPDATE ${DbTables.STORAGE_CONFIGS} SET is_default = 0, updated_at = CURRENT_TIMESTAMP WHERE admin_id = ?`).bind(adminId),
      this.db.prepare(`UPDATE ${DbTables.STORAGE_CONFIGS} SET is_default = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(configId),
    ]);
  }

  async findAllWithUsage() {
    const queryResult = await this.query(
      `SELECT id, name, storage_type, admin_id, is_public, is_default, created_at, updated_at, last_used,
              json_extract(config_json,'$.provider_type') AS provider_type,
              json_extract(config_json,'$.endpoint_url') AS endpoint_url,
              json_extract(config_json,'$.bucket_name') AS bucket_name,
              json_extract(config_json,'$.region') AS region,
              json_extract(config_json,'$.path_style') AS path_style,
              json_extract(config_json,'$.default_folder') AS default_folder,
              json_extract(config_json,'$.custom_host') AS custom_host,
              json_extract(config_json,'$.signature_expires_in') AS signature_expires_in,
              json_extract(config_json,'$.total_storage_bytes') AS total_storage_bytes
       FROM ${DbTables.STORAGE_CONFIGS}
       ORDER BY name ASC`
    );
    const configs = queryResult.results || [];
    const result = [];
    for (const config of configs) {
      const usage = await this.queryFirst(
        `SELECT COUNT(*) as file_count, SUM(size) as total_size
         FROM ${DbTables.FILES}
         WHERE storage_config_id = ?`,
        [config.id]
      );
      result.push({
        ...config,
        usage: {
          file_count: usage?.file_count || 0,
          total_size: usage?.total_size || 0,
        },
      });
    }
    return result;
  }
}
