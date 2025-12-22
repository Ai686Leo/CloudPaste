/**
 * Postgres dialect（规划占位）
 * - 预期路线：
 *   - contains/模糊：pg_trgm（GIN/GiST + % / similarity）
 *   - 全文：tsvector + websearch_to_tsquery / plainto_tsquery
 *
 * 说明：
 * - 本项目当前运行时主线为 D1(SQLite) + SQLite（Docker）
 * - 该文件仅作为“接口桩”，用于约束未来扩展的形态，避免业务层直接耦合某个数据库语法
 */

export function createPostgresDialect() {
  return {
    id: "postgres",
    minQueryLength: 1,
    buildSearchSql() {
      throw new Error("Postgres dialect 未实现：请按 pg_trgm/tsvector 方案补齐");
    },
    buildCountSql() {
      throw new Error("Postgres dialect 未实现：请按 pg_trgm/tsvector 方案补齐");
    },
  };
}

