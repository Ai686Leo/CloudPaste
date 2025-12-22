/**
 * SQLite/D1 迁移集合（当前主线）
 *
 * 目标：
 * - 迁移编排通过 `plan/` 目录维护：由 `plan/index.js` 汇总导出
 * - 具体迁移实现通过 `engine/` 目录维护（最终态 schema + v01..vN 的历史迁移实现）
 */

import sqliteMigrations from "./plan/index.js";

export { sqliteMigrations };
export default sqliteMigrations;
