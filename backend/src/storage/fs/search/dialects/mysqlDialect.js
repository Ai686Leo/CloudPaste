/**
 * MySQL dialect（规划占位）
 * - 预期路线：
 *   - FULLTEXT（MATCH ... AGAINST）或退化 LIKE（需谨慎）
 *
 * 说明：
 * - 该文件仅作为“接口桩”，用于约束未来扩展的形态
 */

export function createMysqlDialect() {
  return {
    id: "mysql",
    minQueryLength: 1,
    buildSearchSql() {
      throw new Error("MySQL dialect 未实现：请按 FULLTEXT 方案补齐");
    },
    buildCountSql() {
      throw new Error("MySQL dialect 未实现：请按 FULLTEXT 方案补齐");
    },
  };
}

