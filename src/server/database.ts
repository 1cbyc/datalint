import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

export interface QueryExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
}

export interface DataLintDatabase extends QueryExecutor {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

export async function migrateDatabase(database: QueryExecutor): Promise<void> {
  const migration = await readFile(resolve("migrations/001_initial.sql"), "utf8");
  await database.query(migration);
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
