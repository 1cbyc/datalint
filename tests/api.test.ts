import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createApp } from "../src/server/app.js";
import { openDatabase } from "../src/server/database.js";

const invoiceCsv = `invoice_id,email,amount,status
INV-001,owner@example.com,120,paid
INV-001,bad-email,-4,pending
,client@example.com,85,unknown
`;

const sourceResponseSchema = z.object({ id: z.string(), columns: z.array(z.string()) }).passthrough();
const issueResponseSchema = z.object({ id: z.string(), message: z.string(), status: z.string(), resolutionNote: z.string().nullable() }).passthrough();
const issuesResponseSchema = z.array(issueResponseSchema);

describe("DataLint API", () => {
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof createApp>>["app"];

  beforeEach(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    const database = databaseUrl ? await openDatabase(databaseUrl) : undefined;
    if (database) await database.query("TRUNCATE TABLE data_sources CASCADE");
    const instance = await createApp(database ? { database } : { useInMemoryDatabase: true });
    app = instance.app;
    close = instance.close;
  });

  afterEach(async () => {
    await close();
  });

  it("imports a CSV, evaluates rules, and reports a stable quality score", async () => {
    const imported = await request(app)
      .post("/api/sources/csv")
      .field("name", "Weekly invoices")
      .attach("file", Buffer.from(invoiceCsv), "invoices.csv")
      .expect(201);

    const source = sourceResponseSchema.parse(imported.body as unknown);
    expect(source).toMatchObject({ name: "Weekly invoices", rowCount: 3 });
    expect(source.columns).toEqual(["invoice_id", "email", "amount", "status"]);
    const sourceId = source.id;

    const rules = [
      { name: "Invoice IDs are present", type: "required", column: "invoice_id", severity: "high", config: {} },
      { name: "Invoice IDs are unique", type: "unique", column: "invoice_id", severity: "high", config: {} },
      { name: "Customer email is valid", type: "email", column: "email", severity: "medium", config: {} },
      { name: "Amount cannot be negative", type: "number_range", column: "amount", severity: "high", config: { min: 0 } },
      { name: "Status is recognized", type: "allowed_values", column: "status", severity: "low", config: { values: ["paid", "pending"] } },
    ];

    for (const rule of rules) {
      await request(app).post(`/api/sources/${sourceId}/rules`).send(rule).expect(201);
    }

    const run = await request(app).post(`/api/sources/${sourceId}/checks`).expect(201);
    expect(run.body).toMatchObject({ rowsScanned: 3, checksEvaluated: 15, issuesFound: 5, score: 66.7 });

    const issues = await request(app).get("/api/issues?status=open").expect(200);
    const issueList = issuesResponseSchema.parse(issues.body as unknown);
    expect(issueList).toHaveLength(5);
    expect(issueList.map((issue) => issue.message)).toContain("Required value is missing");

    const dashboard = await request(app).get("/api/dashboard").expect(200);
    expect(dashboard.body).toMatchObject({ sourceCount: 1, ruleCount: 5, openIssueCount: 5, latestScore: 66.7 });
  });

  it("resolves an issue and reopens the same finding when it appears again", async () => {
    const imported = await request(app)
      .post("/api/sources/csv")
      .field("name", "Customers")
      .attach("file", Buffer.from("customer_id,name\n,Amara\n"), "customers.csv")
      .expect(201);
    const sourceId = sourceResponseSchema.parse(imported.body as unknown).id;
    await request(app).post(`/api/sources/${sourceId}/rules`).send({
      name: "Customer ID is required",
      type: "required",
      column: "customer_id",
      severity: "high",
      config: {},
    }).expect(201);

    await request(app).post(`/api/sources/${sourceId}/checks`).expect(201);
    const firstIssues = await request(app).get("/api/issues?status=open").expect(200);
    const issueId = issuesResponseSchema.parse(firstIssues.body as unknown)[0]?.id;
    expect(issueId).toBeDefined();

    await request(app).patch(`/api/issues/${issueId ?? ""}`).send({
      status: "resolved",
      resolutionNote: "Corrected upstream",
    }).expect(200);
    await request(app).get("/api/issues?status=open").expect(200, []);

    await request(app).post(`/api/sources/${sourceId}/checks`).expect(201);
    const reopened = await request(app).get("/api/issues?status=open").expect(200);
    const reopenedIssues = issuesResponseSchema.parse(reopened.body as unknown);
    expect(reopenedIssues).toHaveLength(1);
    expect(reopenedIssues[0]).toMatchObject({ id: issueId, status: "open", resolutionNote: null });
  });

  it("rejects unsupported uploads and rules for unknown columns", async () => {
    await request(app)
      .post("/api/sources/csv")
      .attach("file", Buffer.from("not,csv"), "notes.txt")
      .expect(400, { error: "Only .csv files are supported in the MVP" });

    const imported = await request(app)
      .post("/api/sources/csv")
      .field("name", "Customers")
      .attach("file", Buffer.from("id,name\n1,Amara\n"), "customers.csv")
      .expect(201);
    const sourceId = sourceResponseSchema.parse(imported.body as unknown).id;
    await request(app).post(`/api/sources/${sourceId}/rules`).send({
      name: "Missing column rule",
      type: "required",
      column: "email",
      severity: "medium",
      config: {},
    }).expect(400);
  });

  it("requires the configured token and restricts browser origins", async () => {
    await close();
    const databaseUrl = process.env.TEST_DATABASE_URL;
    const database = databaseUrl ? await openDatabase(databaseUrl) : undefined;
    if (database) await database.query("TRUNCATE TABLE data_sources CASCADE");
    const instance = await createApp({
      ...(database ? { database } : { useInMemoryDatabase: true }),
      apiToken: "test-access-token",
      allowedOrigins: ["https://datalint.example.com"],
    });
    app = instance.app;
    close = instance.close;

    await request(app).get("/api/health").expect(200, { status: "ok", database: "postgresql" });
    await request(app).get("/api/dashboard").expect(401, { error: "Authentication required" });
    await request(app)
      .get("/api/dashboard")
      .set("Authorization", "Bearer test-access-token")
      .set("Origin", "https://untrusted.example")
      .expect(403, { error: "Origin is not allowed" });
    const allowed = await request(app)
      .get("/api/dashboard")
      .set("Authorization", "Bearer test-access-token")
      .set("Origin", "https://datalint.example.com")
      .expect(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://datalint.example.com");
  });
});
