// SQLiteAdapter - 在 Node/Docker 环境模拟 Cloudflare D1 接口的适配器
// 仅在本地 / Docker 模式使用，Workers 环境直接使用 D1。

import sqlite3 from "sqlite3";
import { open } from "sqlite";

export class SQLiteAdapter {
  /**
   * @param {string} dbPath
   */
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async init() {
    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database,
    });
    await this.db.exec("PRAGMA foreign_keys = ON;");
    return this;
  }

  prepare(sql) {
    return {
      sql,
      params: [],
      _db: this.db,

      bind(...args) {
        this.params = args;
        return this;
      },

      async run() {
        const result = await this._db.run(this.sql, ...this.params);
        const changes =
          result && typeof result.changes === "number" ? result.changes : 0;
        return {
          success: true,
          changes,
          meta: { changes },
        };
      },

      async all() {
        const results = await this._db.all(this.sql, ...this.params);
        return { results };
      },

      async first() {
        return await this._db.get(this.sql, ...this.params);
      },
    };
  }

  async batch(statements) {
    await this.db.exec("BEGIN TRANSACTION");
    try {
      const results = [];
      for (const statement of statements) {
        if (typeof statement === "string") {
          const result = await this.db.exec(statement);
          results.push({ success: true, result });
        } else if (statement.sql && Array.isArray(statement.params)) {
          const result = await this.db.run(statement.sql, ...statement.params);
          results.push({ success: true, result });
        } else if (statement.sql && typeof statement.params === "undefined") {
          const result = await this.db.run(statement.sql);
          results.push({ success: true, result });
        } else if (statement.text || statement.sql) {
          const stmt = this.prepare(statement.text || statement.sql);
          if (statement.params) {
            stmt.bind(...statement.params);
          }
          const result = await stmt.run();
          results.push(result);
        }
      }
      await this.db.exec("COMMIT");
      return results;
    } catch (error) {
      await this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async exec(sql) {
    return await this.db.exec(sql);
  }
}

/**
 * 工厂函数：创建并初始化 SQLiteAdapter 实例
 * @param {string} dbPath
 */
export async function createSQLiteAdapter(dbPath) {
  const adapter = new SQLiteAdapter(dbPath);
  await adapter.init();
  return adapter;
}
