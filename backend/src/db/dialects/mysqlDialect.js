/**
 * MySQL 方言实现（骨架）
 * - 仅定义能力面
 */

export const mysqlDialect = {
  name: "mysql",
  placeholderStyle() {
    return "question";
  },
  buildInsertIgnoreSql({ table, columns }) {
    const cols = Array.isArray(columns) ? columns : [];
    const placeholders = cols.map(() => "?").join(", ");
    const colList = cols.join(", ");
    return `INSERT IGNORE INTO ${table} (${colList}) VALUES (${placeholders})`;
  },
  supportsPartialIndex() {
    return false;
  },
};

