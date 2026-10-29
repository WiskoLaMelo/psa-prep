import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { config } from "../config";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const MIGRATIONS = path.join(process.cwd(), "core/db/migrations");

/** Ouvre une base (fichier ou ":memory:") et applique les migrations. */
export function openDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as Db;
  migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}

const g = globalThis as unknown as { __psaPrepDb?: Db };

/** Base partagée de l'application (singleton, survit au rechargement à chaud de Next). */
export function getDb(): Db {
  if (!g.__psaPrepDb) g.__psaPrepDb = openDb(config.dbFile);
  return g.__psaPrepDb;
}

export { schema };
