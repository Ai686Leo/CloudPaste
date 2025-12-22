# SQLite/D1 数据库迁移说明


## 1) 入口调用链

运行时会走这条链路：

1. `backend/unified-entry.js` 在 Workers/Node 启动或首次请求时调用 `ensureDatabaseReady(...)`
2. `backend/src/db/ensureDatabaseReady.js` 构建 runtime（db + provider + dialect）
3. `backend/src/db/providers/sqliteProvider.js` 调用迁移 runner：`applyMigrations(runtime, sqliteMigrations)`
4. `backend/src/db/migrations/runner.js` 确保存在 `schema_migrations`，然后按顺序执行每个 migration，并写入记录
5. `backend/src/db/migrations/sqlite/index.js` 导出 SQLite/D1 的迁移列表（实际列表在 `sqlite/plan/index.js`）

---

## 2) migrations 目录职责划分

### 2.1 `backend/src/db/migrations/runner.js`

- 迁移运行器（Node + Workers 通用）。
- 职责：按顺序执行 migration，并写入 `schema_migrations`（迁移执行日志表）。
- 约定：migration 的 `up()` 返回 `false` 表示“无需执行/跳过”，runner 会记录为 `skipped`，但仍会写入 `schema_migrations`，避免重复评估。

### 2.2 `backend/src/db/migrations/sqlite/index.js`

- SQLite/D1 迁移集合入口。

### 2.3 `backend/src/db/migrations/sqlite/plan/*`

- `plan/index.js`
  - 迁移列表汇总导出：`[adopt, ...app-v01..app-vNN]`

- `plan/adoptSchemaMigrations.js`
  - “接管迁移状态”的一次性迁移：
    - 新库/缺表库：执行 `engine/initDatabase.js` 直接把库建到最终态，然后把 `app-v01..app-vNN` 批量写入 `schema_migrations`（squash），避免新库误跑历史迁移。
    - 旧库：如果存在 `system_settings.schema_version`，按其版本上限把 `app-v01..app-vNN` 写入 `schema_migrations`（squash），随后删除 `system_settings` 里的 legacy key（`schema_version/db_initialized`）。

- `plan/versions.js`
  - 自动生成 `app-v01..app-vNN` 的迁移数组（每个 `app-vXX` 内部会调用 `legacy/migrations.js` 的对应版本逻辑）。

- `plan/adoptUtils.js`
  - adopt 专用工具：表探测、旧 schema_version 读取、批量写入 `schema_migrations`、清理 legacy key 等。

### 2.4 `backend/src/db/migrations/sqlite/engine/*`

这部分是“SQLite/D1 最终态 schema + 历史迁移实现”，供上层复用：

- `engine/version.js`：`APP_SCHEMA_VERSION/DB_SCHEMA_VERSION`（当前应用 schema 版本号）
- `engine/legacyKeys.js`：旧库 system_settings legacy key + legacy 表名（仅用于接管/历史迁移降级）
- `engine/schema.js`：最终态建表/建索引（新库直接用它建到最新）
- `engine/seed.js`：默认配置 + 默认数据（默认管理员、默认 guest key 等）
- `engine/initDatabase.js`：新库初始化入口（schema + seed）
- `engine/migrations.js`：历史版本迁移实现（switch-case），供 `app-vXX` 调用

---

## 4) 新增迁移怎么加？

本项目的约定是：**版本号就是 migration 的语义边界**，不需要为每个版本新增一个文件（避免碎片化）。

当你要新增 vXX 时，按顺序做这几步：

1) 增大版本号
- 修改：`backend/src/db/migrations/sqlite/engine/version.js`
- 把 `APP_SCHEMA_VERSION`（同时也是 `DB_SCHEMA_VERSION`）从 `27` 改为 `28`

2) 增加迁移实现（只写差异）
- 修改：`backend/src/db/migrations/sqlite/engine/migrations.js`
- 添加 `case 28:`，只做“从 v27 升级到 v28”的差异变更（幂等/可重入优先）

3) 同步更新新库最终态（让新用户直接就是 v28）
- 修改：`backend/src/db/migrations/sqlite/engine/schema.js`（新增表/字段/索引）
- 修改：`backend/src/db/migrations/sqlite/engine/seed.js`（新增默认配置/默认数据）

4) 注意 `backend/schema.sql`
- 该文件应保持“schema 快照”为主，不要手工预填充 `schema_migrations`，避免与运行时的 adopt/init 逻辑产生理解偏差。
