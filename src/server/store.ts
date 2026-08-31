import { createHash, randomUUID } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type {
  CheckRun,
  Dashboard,
  DataSource,
  Issue,
  IssueId,
  IssueStatus,
  Rule,
  RuleId,
  RuleInput,
  RunId,
  Severity,
  SourceId,
} from "../shared/domain.js";
import type { DataLintDatabase, QueryExecutor } from "./database.js";

const rowsSchema = z.array(z.record(z.string(), z.string()));
type DataRow = z.infer<typeof rowsSchema>[number];

type SourceRow = QueryResultRow & {
  id: string;
  name: string;
  kind: "csv";
  fileName: string;
  rowCount: number;
  columnsJson: unknown;
  rowsJson: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RuleRow = QueryResultRow & {
  id: string;
  sourceId: string;
  name: string;
  type: RuleInput["type"];
  column: string;
  configJson: unknown;
  severity: Severity;
  enabled: boolean;
  createdAt: Date | string;
};

type Finding = {
  key: string;
  rowNumber: number | null;
  column: string;
  message: string;
  observedValue: string | null;
};

function now(): string {
  return new Date().toISOString();
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function parseJson<T>(value: unknown, schema: z.ZodType<T>): T {
  return schema.parse(typeof value === "string" ? JSON.parse(value) as unknown : value);
}

function mapSource(row: SourceRow): DataSource {
  return {
    id: row.id as SourceId,
    name: row.name,
    kind: row.kind,
    fileName: row.fileName,
    rowCount: row.rowCount,
    columns: parseJson(row.columnsJson, z.array(z.string())),
    createdAt: toIso(row.createdAt) ?? "",
    updatedAt: toIso(row.updatedAt) ?? "",
  };
}

function mapRule(row: RuleRow): Rule {
  return {
    id: row.id as RuleId,
    sourceId: row.sourceId as SourceId,
    name: row.name,
    type: row.type,
    column: row.column,
    severity: row.severity,
    config: parseJson(row.configJson, z.record(z.string(), z.unknown())),
    enabled: row.enabled,
    createdAt: toIso(row.createdAt) ?? "",
  } as Rule;
}

function fingerprint(ruleId: RuleId, key: string): string {
  return createHash("sha256").update(`${ruleId}\0${key}`).digest("hex");
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

function evaluateRule(rule: Rule, rows: DataRow[]): Finding[] {
  if (rule.type === "unique") {
    const positions = new Map<string, number[]>();
    rows.forEach((row, index) => {
      const value = row[rule.column]?.trim();
      if (!value) return;
      positions.set(value, [...(positions.get(value) ?? []), index + 2]);
    });
    return [...positions.entries()]
      .filter(([, rowNumbers]) => rowNumbers.length > 1)
      .map(([value, rowNumbers]) => ({
        key: `duplicate:${value}`,
        rowNumber: null,
        column: rule.column,
        message: `Value appears in rows ${rowNumbers.join(", ")}`,
        observedValue: value,
      }));
  }

  const compiledPattern = rule.type === "pattern" ? new RegExp(rule.config.pattern) : null;
  const findings: Finding[] = [];
  rows.forEach((row, index) => {
    const value = row[rule.column];
    const rowNumber = index + 2;
    const base = { rowNumber, column: rule.column, observedValue: value ?? null };

    if (rule.type === "required" && isBlank(value)) {
      findings.push({ ...base, key: `row:${rowNumber}`, message: "Required value is missing" });
    } else if (rule.type === "email" && !isBlank(value) && !z.string().email().safeParse(value).success) {
      findings.push({ ...base, key: `row:${rowNumber}`, message: "Value is not a valid email address" });
    } else if (rule.type === "number_range" && !isBlank(value)) {
      const numericValue = Number(value);
      const tooLow = rule.config.min !== undefined && numericValue < rule.config.min;
      const tooHigh = rule.config.max !== undefined && numericValue > rule.config.max;
      if (!Number.isFinite(numericValue) || tooLow || tooHigh) {
        findings.push({ ...base, key: `row:${rowNumber}`, message: "Value is outside the allowed number range" });
      }
    } else if (rule.type === "allowed_values" && !isBlank(value) && !rule.config.values.includes(value ?? "")) {
      findings.push({ ...base, key: `row:${rowNumber}`, message: "Value is not in the allowed list" });
    } else if (rule.type === "pattern" && !isBlank(value) && !compiledPattern?.test(value ?? "")) {
      findings.push({ ...base, key: `row:${rowNumber}`, message: "Value does not match the required pattern" });
    }
  });
  return findings;
}

export class DataLintStore {
  public constructor(private readonly database: DataLintDatabase) {}

  public async listSources(): Promise<DataSource[]> {
    const result = await this.database.query<SourceRow>(`SELECT id, name, kind, file_name AS "fileName",
      row_count AS "rowCount", columns_json AS "columnsJson", rows_json AS "rowsJson",
      created_at AS "createdAt", updated_at AS "updatedAt"
      FROM data_sources ORDER BY created_at DESC`);
    return result.rows.map(mapSource);
  }

  public async importCsv(name: string, fileName: string, content: string): Promise<DataSource> {
    const records = parseCsv(content, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false,
    }) as unknown;
    const rows = rowsSchema.parse(records);
    if (rows.length === 0) throw new Error("CSV must contain a header and at least one data row");
    const columns = Object.keys(rows[0] ?? {});
    if (columns.length === 0 || columns.some((column) => column.trim() === "")) {
      throw new Error("CSV headers must be non-empty");
    }

    const id = randomUUID() as SourceId;
    const timestamp = now();
    await this.database.query(`INSERT INTO data_sources
      (id, name, kind, file_name, row_count, columns_json, rows_json, created_at, updated_at)
      VALUES ($1, $2, 'csv', $3, $4, $5::jsonb, $6::jsonb, $7, $7)`,
    [id, name, fileName, rows.length, JSON.stringify(columns), JSON.stringify(rows), timestamp]);
    const source = await this.getSource(id);
    if (!source) throw new Error("Imported source could not be read back");
    return source;
  }

  public async getSource(sourceId: SourceId, executor: QueryExecutor = this.database): Promise<DataSource | null> {
    const result = await executor.query<SourceRow>(`SELECT id, name, kind, file_name AS "fileName",
      row_count AS "rowCount", columns_json AS "columnsJson", rows_json AS "rowsJson",
      created_at AS "createdAt", updated_at AS "updatedAt"
      FROM data_sources WHERE id = $1`, [sourceId]);
    const row = result.rows[0];
    return row ? mapSource(row) : null;
  }

  public async listRules(sourceId?: SourceId, executor: QueryExecutor = this.database): Promise<Rule[]> {
    const selection = `SELECT id, source_id AS "sourceId", name, type, column_name AS "column",
      config_json AS "configJson", severity, enabled, created_at AS "createdAt" FROM rules`;
    const result = sourceId
      ? await executor.query<RuleRow>(`${selection} WHERE source_id = $1 ORDER BY created_at DESC`, [sourceId])
      : await executor.query<RuleRow>(`${selection} ORDER BY created_at DESC`);
    return result.rows.map(mapRule);
  }

  public async createRule(sourceId: SourceId, input: RuleInput): Promise<Rule> {
    const source = await this.getSource(sourceId);
    if (!source) throw new Error("Data source not found");
    if (!source.columns.includes(input.column)) throw new Error(`Column “${input.column}” does not exist in this source`);
    if (input.type === "pattern") new RegExp(input.config.pattern);

    const id = randomUUID() as RuleId;
    const timestamp = now();
    await this.database.query(`INSERT INTO rules
      (id, source_id, name, type, column_name, config_json, severity, enabled, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, TRUE, $8, $8)`,
    [id, sourceId, input.name, input.type, input.column, JSON.stringify(input.config), input.severity, timestamp]);
    const rule = (await this.listRules(sourceId)).find((candidate) => candidate.id === id);
    if (!rule) throw new Error("Created rule could not be read back");
    return rule;
  }

  public async runChecks(sourceId: SourceId): Promise<CheckRun> {
    const sourceResult = await this.database.query<QueryResultRow & { rowsJson: unknown }>(
      `SELECT rows_json AS "rowsJson" FROM data_sources WHERE id = $1`, [sourceId]);
    const source = await this.getSource(sourceId);
    const sourceRow = sourceResult.rows[0];
    if (!sourceRow || !source) throw new Error("Data source not found");
    const rows = parseJson(sourceRow.rowsJson, rowsSchema);
    const rules = (await this.listRules(sourceId)).filter((rule) => rule.enabled);
    if (rules.length === 0) throw new Error("Add at least one enabled rule before running checks");

    const runId = randomUUID() as RunId;
    const startedAt = now();
    const evaluated = rows.length * rules.length;
    const findings = rules.flatMap((rule) => evaluateRule(rule, rows).map((finding) => ({ rule, finding })));
    const score = evaluated === 0 ? 100 : Math.round(Math.max(0, 100 - (findings.length / evaluated) * 100) * 10) / 10;
    const finishedAt = now();
    const client = await this.database.connect();

    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO check_runs
        (id, source_id, status, started_at, finished_at, rows_scanned, checks_evaluated, issues_found, score)
        VALUES ($1, $2, 'completed', $3, $4, $5, $6, $7, $8)`,
      [runId, sourceId, startedAt, finishedAt, rows.length, evaluated, findings.length, score]);

      for (const { rule, finding } of findings) {
        await client.query(`INSERT INTO issues
          (id, source_id, rule_id, run_id, fingerprint, status, severity, row_number, column_name,
            message, observed_value, first_seen_at, last_seen_at, resolved_at, resolution_note)
          VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, $10, $11, $11, NULL, NULL)
          ON CONFLICT(rule_id, fingerprint) DO UPDATE SET
            run_id = EXCLUDED.run_id, status = 'open', severity = EXCLUDED.severity,
            message = EXCLUDED.message, observed_value = EXCLUDED.observed_value,
            last_seen_at = EXCLUDED.last_seen_at, resolved_at = NULL, resolution_note = NULL`,
        [randomUUID(), sourceId, rule.id, runId, fingerprint(rule.id, finding.key), rule.severity,
          finding.rowNumber, finding.column, finding.message, finding.observedValue, finishedAt]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return { id: runId, sourceId, sourceName: source.name, status: "completed", startedAt, finishedAt,
      rowsScanned: rows.length, checksEvaluated: evaluated, issuesFound: findings.length, score };
  }

  public async listRuns(): Promise<CheckRun[]> {
    const result = await this.database.query<QueryResultRow & {
      id: string; sourceId: string; sourceName: string; status: "completed" | "failed";
      startedAt: Date | string; finishedAt: Date | string; rowsScanned: number;
      checksEvaluated: number; issuesFound: number; score: number;
    }>(`SELECT check_runs.id, check_runs.source_id AS "sourceId", data_sources.name AS "sourceName",
      check_runs.status, check_runs.started_at AS "startedAt", check_runs.finished_at AS "finishedAt",
      check_runs.rows_scanned AS "rowsScanned", check_runs.checks_evaluated AS "checksEvaluated",
      check_runs.issues_found AS "issuesFound", check_runs.score
      FROM check_runs JOIN data_sources ON data_sources.id = check_runs.source_id
      ORDER BY check_runs.started_at DESC LIMIT 50`);
    return result.rows.map((row) => ({ ...row, id: row.id as RunId, sourceId: row.sourceId as SourceId,
      startedAt: toIso(row.startedAt) ?? "", finishedAt: toIso(row.finishedAt) ?? "" }));
  }

  public async listIssues(status?: IssueStatus): Promise<Issue[]> {
    type IssueRow = QueryResultRow & Omit<Issue, "id" | "sourceId" | "ruleId" | "runId" | "firstSeenAt" | "lastSeenAt" | "resolvedAt"> & {
      id: string; sourceId: string; ruleId: string; runId: string;
      firstSeenAt: Date | string; lastSeenAt: Date | string; resolvedAt: Date | string | null;
    };
    const selection = `SELECT issues.id, issues.source_id AS "sourceId", data_sources.name AS "sourceName",
      issues.rule_id AS "ruleId", rules.name AS "ruleName", issues.run_id AS "runId", issues.status,
      issues.severity, issues.row_number AS "rowNumber", issues.column_name AS "column", issues.message,
      issues.observed_value AS "observedValue", issues.first_seen_at AS "firstSeenAt",
      issues.last_seen_at AS "lastSeenAt", issues.resolved_at AS "resolvedAt",
      issues.resolution_note AS "resolutionNote" FROM issues
      JOIN data_sources ON data_sources.id = issues.source_id JOIN rules ON rules.id = issues.rule_id`;
    const result = status
      ? await this.database.query<IssueRow>(`${selection} WHERE issues.status = $1 ORDER BY issues.last_seen_at DESC`, [status])
      : await this.database.query<IssueRow>(`${selection} ORDER BY issues.last_seen_at DESC`);
    return result.rows.map((row) => ({ ...row, id: row.id as IssueId, sourceId: row.sourceId as SourceId,
      ruleId: row.ruleId as RuleId, runId: row.runId as RunId, firstSeenAt: toIso(row.firstSeenAt) ?? "",
      lastSeenAt: toIso(row.lastSeenAt) ?? "", resolvedAt: toIso(row.resolvedAt) }));
  }

  public async updateIssue(issueId: IssueId, status: IssueStatus, resolutionNote?: string): Promise<Issue> {
    const timestamp = now();
    const result = await this.database.query(
      `UPDATE issues SET status = $1, resolved_at = $2, resolution_note = $3 WHERE id = $4`,
      [status, status === "resolved" ? timestamp : null, status === "resolved" ? resolutionNote ?? null : null, issueId]);
    if (result.rowCount === 0) throw new Error("Issue not found");
    const issue = (await this.listIssues()).find((candidate) => candidate.id === issueId);
    if (!issue) throw new Error("Updated issue could not be read back");
    return issue;
  }

  public async dashboard(): Promise<Dashboard> {
    type CountRow = QueryResultRow & { count: number };
    const [sources, rules, openIssues, resolvedIssues, latestResult, severityResult] = await Promise.all([
      this.database.query<CountRow>(`SELECT COUNT(*)::integer AS count FROM data_sources`),
      this.database.query<CountRow>(`SELECT COUNT(*)::integer AS count FROM rules WHERE enabled = TRUE`),
      this.database.query<CountRow>(`SELECT COUNT(*)::integer AS count FROM issues WHERE status = 'open'`),
      this.database.query<CountRow>(`SELECT COUNT(*)::integer AS count FROM issues WHERE status = 'resolved'`),
      this.database.query<QueryResultRow & { score: number; finishedAt: Date | string }>(
        `SELECT score, finished_at AS "finishedAt" FROM check_runs ORDER BY started_at DESC LIMIT 1`),
      this.database.query<QueryResultRow & { severity: Severity; count: number }>(
        `SELECT severity, COUNT(*)::integer AS count FROM issues WHERE status = 'open' GROUP BY severity`),
    ]);
    const issuesBySeverity = { low: 0, medium: 0, high: 0 } satisfies Record<Severity, number>;
    severityResult.rows.forEach((row) => { issuesBySeverity[row.severity] = row.count; });
    const latest = latestResult.rows[0];
    return {
      sourceCount: sources.rows[0]?.count ?? 0,
      ruleCount: rules.rows[0]?.count ?? 0,
      openIssueCount: openIssues.rows[0]?.count ?? 0,
      resolvedIssueCount: resolvedIssues.rows[0]?.count ?? 0,
      latestScore: latest?.score ?? null,
      latestRunAt: latest ? toIso(latest.finishedAt) : null,
      issuesBySeverity,
    };
  }
}
