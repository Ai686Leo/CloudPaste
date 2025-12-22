/**
 * SQLite / D1 方言实现
 * - 面向“多 DB 插件化”的最小方言面
 * - 当前项目的默认方言（D1 与 Node SQLiteAdapter 都属于此类）
 */

export const sqliteDialect = {
  name: "sqlite",

  /**
   * SQLite/D1 使用 ? 占位符
   * @returns {"question"}
   */
  placeholderStyle() {
    return "question";
  },

  /**
   * INSERT IGNORE 的统一语义：冲突时忽略
   * - SQLite: INSERT OR IGNORE
   */
  buildInsertIgnoreSql({ table, columns }) {
    const cols = Array.isArray(columns) ? columns : [];
    const placeholders = cols.map(() => "?").join(", ");
    const colList = cols.join(", ");
    return `INSERT OR IGNORE INTO ${table} (${colList}) VALUES (${placeholders})`;
  },

  /**
   * 是否支持部分索引（WHERE 子句索引）
   */
  supportsPartialIndex() {
    return true;
  },
};

