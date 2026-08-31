import express, { type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import multer from "multer";
import { z, ZodError } from "zod";

import {
  remoteSourceInputSchema,
  resolveIssueSchema,
  ruleInputSchema,
  sourceScheduleSchema,
  type IssueId,
  type RuleId,
  type SourceId,
} from "../shared/domain.js";
import type { SourceSnapshot } from "./connectors.js";
import { openDatabase, type DataLintDatabase } from "./database.js";
import { deliverPendingAlerts } from "./scheduler.js";
import { DataLintStore } from "./store.js";

const identifierSchema = z.string().uuid();
const sourceQuerySchema = z.object({ sourceId: identifierSchema.optional() });
const issueQuerySchema = z.object({ status: z.enum(["open", "resolved"]).optional() });

type AppOptions = {
  databaseUrl?: string;
  database?: DataLintDatabase;
  useInMemoryDatabase?: boolean;
  maxUploadBytes?: number;
  apiToken?: string;
  allowedOrigins?: string[];
  webhookUrl?: string;
  remoteLoader?: (input: z.infer<typeof remoteSourceInputSchema>) => Promise<SourceSnapshot>;
};

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected server error";
}

function tokensMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

export async function createApp(options: AppOptions): Promise<{
  app: express.Express;
  close: () => Promise<void>;
}> {
  const database = options.database ?? await openDatabase(
    options.databaseUrl ?? "postgresql://datalint:datalint@localhost:5432/datalint",
    options.useInMemoryDatabase,
  );
  const store = new DataLintStore(database, options.remoteLoader);
  const app = express();
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: options.maxUploadBytes ?? 5 * 1024 * 1024, files: 1 },
  });

  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.use("/api", (request, response, next) => {
    const origin = request.header("origin");
    if (origin) {
      if (!allowedOrigins.has(origin)) {
        response.status(403).json({ error: "Origin is not allowed" });
        return;
      }
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }
    if (options.apiToken && request.path !== "/health") {
      const authorization = request.header("authorization");
      const provided = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (!tokensMatch(provided, options.apiToken)) {
        response.status(401).json({ error: "Authentication required" });
        return;
      }
    }
    next();
  });

  app.get("/api/health", async (_request, response) => {
    await database.query("SELECT 1");
    response.json({ status: "ok", database: "postgresql" });
  });

  app.get("/api/dashboard", async (_request, response) => {
    response.json(await store.dashboard());
  });

  app.get("/api/sources", async (_request, response) => {
    response.json(await store.listSources());
  });

  app.post("/api/sources/csv", upload.single("file"), async (request, response) => {
    if (!request.file) {
      response.status(400).json({ error: "Choose a CSV file to import" });
      return;
    }
    if (!request.file.originalname.toLowerCase().endsWith(".csv")) {
      response.status(400).json({ error: "Only .csv files are supported in the MVP" });
      return;
    }
    if (request.file.buffer.includes(0)) {
      response.status(400).json({ error: "The uploaded file must be plain-text CSV" });
      return;
    }
    const body = z.object({ name: z.string().optional() }).parse(request.body as unknown);
    const name = z.string().trim().min(2).max(80).parse(body.name ?? request.file.originalname.replace(/\.csv$/i, ""));
    response.status(201).json(await store.importCsv(name, request.file.originalname, request.file.buffer.toString("utf8")));
  });

  app.post("/api/sources/remote", async (request, response) => {
    response.status(201).json(await store.createRemoteSource(remoteSourceInputSchema.parse(request.body)));
  });

  app.put("/api/sources/:sourceId/csv", upload.single("file"), async (request, response) => {
    const sourceId = identifierSchema.parse(request.params.sourceId) as SourceId;
    if (!request.file) {
      response.status(400).json({ error: "Choose a CSV file to refresh the source" });
      return;
    }
    response.json(await store.refreshCsv(sourceId, request.file.originalname, request.file.buffer.toString("utf8")));
  });

  app.post("/api/sources/:sourceId/refresh", async (request, response) => {
    response.json(await store.refreshRemoteSource(identifierSchema.parse(request.params.sourceId) as SourceId));
  });

  app.patch("/api/sources/:sourceId/schedule", async (request, response) => {
    const input = z.object({ scheduleMinutes: sourceScheduleSchema }).parse(request.body);
    response.json(await store.setSchedule(identifierSchema.parse(request.params.sourceId) as SourceId, input.scheduleMinutes));
  });

  app.get("/api/rules", async (request, response) => {
    const query = sourceQuerySchema.parse(request.query);
    response.json(await store.listRules(query.sourceId as SourceId | undefined));
  });

  app.post("/api/sources/:sourceId/rules", async (request, response) => {
    const sourceId = identifierSchema.parse(request.params.sourceId) as SourceId;
    const input = ruleInputSchema.parse(request.body);
    response.status(201).json(await store.createRule(sourceId, input));
  });

  app.patch("/api/rules/:ruleId", async (request, response) => {
    const input = z.object({ enabled: z.boolean() }).parse(request.body);
    response.json(await store.setRuleEnabled(identifierSchema.parse(request.params.ruleId) as RuleId, input.enabled));
  });

  app.delete("/api/rules/:ruleId", async (request, response) => {
    await store.deleteRule(identifierSchema.parse(request.params.ruleId) as RuleId);
    response.status(204).end();
  });

  app.post("/api/sources/:sourceId/checks", async (request, response) => {
    const sourceId = identifierSchema.parse(request.params.sourceId) as SourceId;
    const run = await store.runChecks(sourceId);
    await deliverPendingAlerts(store, options.webhookUrl);
    response.status(201).json(run);
  });

  app.get("/api/runs", async (_request, response) => {
    response.json(await store.listRuns());
  });

  app.get("/api/issues", async (request, response) => {
    const query = issueQuerySchema.parse(request.query);
    response.json(await store.listIssues(query.status));
  });

  app.get("/api/issues/export.csv", async (_request, response) => {
    const issues = await store.listIssues();
    const escape = (value: string | number | null) => `"${(value === null ? "" : String(value)).replaceAll('"', '""')}"`;
    const rows = [["status", "severity", "source", "rule", "column", "row", "message", "observed_value", "first_seen", "last_seen", "resolution_note"],
      ...issues.map((issue) => [issue.status, issue.severity, issue.sourceName, issue.ruleName, issue.column,
        issue.rowNumber ?? "", issue.message, issue.observedValue ?? "", issue.firstSeenAt, issue.lastSeenAt, issue.resolutionNote ?? ""])];
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", "attachment; filename=\"datalint-issues.csv\"");
    response.send(rows.map((row) => row.map(escape).join(",")).join("\n"));
  });

  app.get("/api/issues/:issueId/events", async (request, response) => {
    response.json(await store.listIssueEvents(identifierSchema.parse(request.params.issueId) as IssueId));
  });

  app.patch("/api/issues/:issueId", async (request, response) => {
    const issueId = identifierSchema.parse(request.params.issueId) as IssueId;
    const input = resolveIssueSchema.parse(request.body);
    response.json(await store.updateIssue(issueId, input.status, input.resolutionNote));
  });

  const clientDirectory = resolve("dist/client");
  if (existsSync(clientDirectory)) {
    app.use(express.static(clientDirectory, { index: false, maxAge: "1h" }));
    app.get("/{*path}", (request, response, next) => {
      if (request.path.startsWith("/api/")) {
        next();
        return;
      }
      response.sendFile(resolve(clientDirectory, "index.html"));
    });
  }

  app.use("/api/{*path}", (_request, response) => {
    response.status(404).json({ error: "API route not found" });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    void _next;
    if (error instanceof ZodError) {
      response.status(400).json({
        error: "Request validation failed",
        details: error.issues.map((issue) => issue.message),
      });
      return;
    }
    if (error instanceof multer.MulterError) {
      response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: messageFor(error) });
      return;
    }
    const message = messageFor(error);
    const isClientError = /^(Data source|Remote source|CSV source|Rule|Issue).*not found$|^Add at least|^Only remote|^Column “|^CSV |^Only \.csv|^The (source|API|JSON|Google)|^Remote sources|^Private network|^Local network|^Credentials|^Use a public|^Source columns|^Invalid regular expression/i.test(message);
    if (!isClientError) process.stderr.write(`Request failed: ${message}\n`);
    response.status(isClientError ? 400 : 500).json({ error: isClientError ? message : "Internal server error" });
  });

  return { app, close: () => database.end() };
}
