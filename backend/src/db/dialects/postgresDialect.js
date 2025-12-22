/**
 * Postgres 方言实现（骨架）
 * - 仅定义能力面
 */

export const postgresDialect = {
  name: "postgres",
  placeholderStyle() {
    return "dollar";
  },
  buildInsertIgnoreSql({ table, columns, conflictTarget = null }) {
    const cols = Array.isArray(columns) ? columns : [];
    const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(", ");
    const colList = cols.join(", ");
    // 注意：conflictTarget 在 PG 中通常必需；此处先留空，让未来 provider 做更精确的约束映射
    const conflict = conflictTarget ? `(${conflictTarget})` : "";
    return `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT ${conflict} DO NOTHING`;
  },
  supportsPartialIndex() {
    return true;
  },
};
