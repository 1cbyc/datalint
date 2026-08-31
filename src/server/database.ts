import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

export interface QueryExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
}

export interface DataLintDatabase extends QueryExecutor {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

export async function migrateDatabase(database: DataLintDatabase): Promise<void> {
  await database.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const migrationDirectory = resolve("migrations");
  const migrationNames = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();

  for (const name of migrationNames) {
    const applied = await database.query<{ name: string }>("SELECT name FROM schema_migrations WHERE name = $1", [name]);
    if (applied.rowCount) continue;
    const sql = await readFile(resolve(migrationDirectory, name), "utf8");
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function openInMemoryDatabase(): Promise<DataLintDatabase> {
  const { newDb } = await import("pg-mem");
  const memory = newDb();
  const adapter = memory.adapters.createPg();
  const PoolConstructor = adapter.Pool as unknown as new () => DataLintDatabase;
  const database = new PoolConstructor();
  await migrateDatabase(database);
  return database;
}

export async function openDatabase(connectionString: string, useInMemoryDatabase = false): Promise<DataLintDatabase> {
  if (useInMemoryDatabase) return openInMemoryDatabase();

  const database = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await migrateDatabase(database);
    return database;
  } catch (error) {
    await database.end();
    throw error;
  }
}
