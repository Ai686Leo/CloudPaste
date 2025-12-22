/**
 * 轻量迁移运行器（Node + Workers 通用）
 *
 */

const MIGRATIONS_TABLE = "schema_migrations";

/**
 * 确保迁移记录表存在（SQLite/D1 语法）
 * @param {any} db
 */
export async function ensureSchemaMigrationsTable(db) {
  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `
    )
    .run();
}

/**
 * 读取已应用迁移 ID 集合
 * @param {any} db
 * @returns {Promise<Set<string>>}
 */
export async function getAppliedMigrationIds(db) {
  const resp = await db.prepare(`SELECT id FROM ${MIGRATIONS_TABLE}`).all();
  const rows = resp?.results || [];
  return new Set(rows.map((r) => r.id).filter(Boolean));
}

async function hasMigrationId(db, id) {
  try {
    const row = await db.prepare(`SELECT 1 AS ok FROM ${MIGRATIONS_TABLE} WHERE id = ?`).bind(id).first();
    return !!row;
  } catch {
    return false;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function assertUniqueMigrationIds(migrations) {
  const seen = new Set();
  for (const m of migrations) {
    if (!m?.id) {
      throw new Error("migration: 缺少 id");
    }
    if (seen.has(m.id)) {
      throw new Error(`migration: 重复的 id: ${m.id}`);
    }
    seen.add(m.id);
  }
}

/**
 * 应用迁移列表
 * @param {{ db:any, dialect:any, env:any, providerName:string }} runtime
 * @param {Array<{ id:string, up:(ctx:any)=>Promise<void|boolean> }>} migrations
 */
export async function applyMigrations(runtime, migrations) {
  const { db, dialect } = runtime;
  const list = Array.isArray(migrations) ? migrations : [];

  assertUniqueMigrationIds(list);
  await ensureSchemaMigrationsTable(db);

  const insertSql =
    typeof dialect?.buildInsertIgnoreSql === "function"
      ? dialect.buildInsertIgnoreSql({
          table: MIGRATIONS_TABLE,
          columns: ["id", "applied_at"],
        })
      : `INSERT OR IGNORE INTO ${MIGRATIONS_TABLE} (id, applied_at) VALUES (?, ?)`;

  for (const migration of list) {
    // 注意：不要只依赖进程内缓存的 applied set。
    // 某些迁移（例如 baseline/adopt）可能会批量写入 schema_migrations，
    // 需要以 DB 中真实数据为准，避免后续迁移被重复执行。
    if (await hasMigrationId(db, migration.id)) {
      continue;
    }

    const result = await migration.up(runtime);
    const status = result === false ? "skipped" : "applied";
    console.log(`[db:migrations迁移表] ${status}: ${migration.id}`);

    // 记录迁移已应用（并发场景下允许重复写入被忽略）
    await db.prepare(insertSql).bind(migration.id, nowIso()).run();
  }
}

export default {
  applyMigrations,
  ensureSchemaMigrationsTable,
  getAppliedMigrationIds,
};
