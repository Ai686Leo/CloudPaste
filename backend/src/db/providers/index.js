import { sqliteProvider } from "./sqliteProvider.js";
import { postgresProvider } from "./postgresProvider.js";
import { mysqlProvider } from "./mysqlProvider.js";

/** @type {Record<string, any>} */
const PROVIDERS = {
  sqlite: sqliteProvider,
  postgres: postgresProvider,
  mysql: mysqlProvider,
};

export function getDbProvider(name) {
  const key = String(name || "").toLowerCase();
  return PROVIDERS[key] || PROVIDERS.sqlite;
}

