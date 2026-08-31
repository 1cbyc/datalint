import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 4100);
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://datalint:datalint@localhost:5432/datalint";
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024);
const apiToken = process.env.DATALINT_API_TOKEN;
const allowedOrigins = (process.env.DATALINT_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const { app, close } = await createApp({
  databaseUrl,
  useInMemoryDatabase: process.env.DATALINT_USE_IN_MEMORY_DATABASE === "true",
  maxUploadBytes,
  ...(apiToken ? { apiToken } : {}),
  allowedOrigins,
});

const server = app.listen(port, () => {
  process.stdout.write(`DataLint listening on http://localhost:${port}\n`);
});

function shutdown(): void {
  server.close(() => {
    void close().then(() => {
      process.exit(0);
    });
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
