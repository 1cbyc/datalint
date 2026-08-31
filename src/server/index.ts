import { createApp } from "./app.js";
import { openDatabase } from "./database.js";
import { startScheduler } from "./scheduler.js";
import { DataLintStore } from "./store.js";

const port = Number(process.env.PORT ?? 4100);
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://datalint:datalint@localhost:5432/datalint";
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024);
const apiToken = process.env.DATALINT_API_TOKEN;
const allowedOrigins = (process.env.DATALINT_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const useInMemoryDatabase = process.env.DATALINT_USE_IN_MEMORY_DATABASE === "true";
const database = await openDatabase(databaseUrl, useInMemoryDatabase);
const store = new DataLintStore(database);
const { app, close } = await createApp({
  database,
  useInMemoryDatabase: process.env.DATALINT_USE_IN_MEMORY_DATABASE === "true",
  maxUploadBytes,
  ...(apiToken ? { apiToken } : {}),
  allowedOrigins,
  ...(process.env.DATALINT_ALERT_WEBHOOK_URL ? { webhookUrl: process.env.DATALINT_ALERT_WEBHOOK_URL } : {}),
});
const stopScheduler = useInMemoryDatabase ? () => undefined : startScheduler(store, process.env.DATALINT_ALERT_WEBHOOK_URL);

const server = app.listen(port, () => {
  process.stdout.write(`DataLint listening on http://localhost:${port}\n`);
});

function shutdown(): void {
  stopScheduler();
  server.close(() => {
    void close().then(() => {
      process.exit(0);
    });
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
