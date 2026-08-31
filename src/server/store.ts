import { createHash, randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type {
  CheckRun, Dashboard, DataSource, Issue, IssueEvent, IssueEventId, IssueId, IssueStatus,
  RemoteSourceInput, Rule, RuleId, RuleInput, RunId, Severity, SourceId, SourceKind, SourceSchedule,
} from "../shared/domain.js";
import { loadRemoteSource, parseCsvSnapshot, type DataRow, type SourceSnapshot } from "./connectors.js";
import type { DataLintDatabase, QueryExecutor } from "./database.js";

const rowsSchema = z.array(z.record(z.string(), z.string()));
const ruleConfigSchema = z.record(z.string(), z.unknown());

type SourceRow = QueryResultRow & {
  id: string; name: string; kind: SourceKind; fileName: string | null; connectorUrl: string | null;
  recordPath: string | null; rowCount: number; columnsJson: unknown; rowsJson: unknown;
  scheduleMinutes: SourceSchedule; nextRunAt: Date | string | null; lastSyncedAt: Date | string | null;
  syncStatus: "ready" | "syncing" | "failed"; syncError: string | null;
  createdAt: Date | string; updatedAt: Date | string;
};

type RuleRow = QueryResultRow & {
  id: string; sourceId: string; name: string; type: RuleInput["type"]; column: string;
  configJson: unknown; severity: Severity; enabled: boolean; createdAt: Date | string;
};

type Finding = { key: string; rowNumber: number | null; column: string; message: string; observedValue: string | null };

function now(): string { return new Date().toISOString(); }
function toIso(value: Date | string | null): string | null { return value === null ? null : value instanceof Date ? value.toISOString() : value; }
function parseJson<T>(value: unknown, schema: z.ZodType<T>): T {
  return schema.parse(typeof value === "string" ? JSON.parse(value) as unknown : value);
}

function mapSource(row: SourceRow): DataSource {
  return {
    id: row.id as SourceId, name: row.name, kind: row.kind, fileName: row.fileName,
    connectorUrl: row.connectorUrl, recordPath: row.recordPath, rowCount: row.rowCount,
    columns: parseJson(row.columnsJson, z.array(z.string())), scheduleMinutes: row.scheduleMinutes,
    nextRunAt: toIso(row.nextRunAt), lastSyncedAt: toIso(row.lastSyncedAt), syncStatus: row.syncStatus,
    syncError: row.syncError, createdAt: toIso(row.createdAt) ?? "", updatedAt: toIso(row.updatedAt) ?? "",
  };
}

function mapRule(row: RuleRow): Rule {
  return {
    id: row.id as RuleId, sourceId: row.sourceId as SourceId, name: row.name, type: row.type,
    column: row.column, severity: row.severity, config: parseJson(row.configJson, ruleConfigSchema),
    enabled: row.enabled, createdAt: toIso(row.createdAt) ?? "",
  } as Rule;
}

function fingerprint(ruleId: RuleId, key: string): string {
  return createHash("sha256").update(`${ruleId}\0${key}`).digest("hex");
}

function evaluateRule(rule: Rule, rows: DataRow[], previousRowCount: number | null): Finding[] {
  if (rule.type === "row_count_change") {
    if (previousRowCount === null || previousRowCount === 0) return [];
    const change = Math.abs(rows.length - previousRowCount) / previousRowCount * 100;
    return change <= rule.config.maximumPercentChange ? [] : [{
      key: "source:row-count", rowNumber: null, column: "Rows",
      message: `Row count changed by ${change.toFixed(1)}% from the previous snapshot`,
      observedValue: `${previousRowCount} to ${rows.length}`,
    }];
  }
  if (rule.type === "unique") {
    const positions = new Map<string, number[]>();
    rows.forEach((row, index) => {
      const value = row[rule.column]?.trim();
      if (value) positions.set(value, [...(positions.get(value) ?? []), index + 2]);
    });
    return [...positions.entries()].filter(([, values]) => values.length > 1).map(([value, values]) => ({
      key: `duplicate:${value}`, rowNumber: null, column: rule.column,
      message: `Value appears in rows ${values.join(", ")}`, observedValue: value,
    }));
  }
  if (rule.type === "numeric_outlier") {
    const values = rows.flatMap((row, index) => {
      const value = Number(row[rule.column]);
      return Number.isFinite(value) && row[rule.column]?.trim() !== "" ? [{ value, rowNumber: index + 2 }] : [];
    });
    if (values.length < rule.config.minSamples) return [];
    const mean = values.reduce((sum, item) => sum + item.value, 0) / values.length;
    const deviation = Math.sqrt(values.reduce((sum, item) => sum + (item.value - mean) ** 2, 0) / values.length);
    if (deviation === 0) return [];
    return values.filter((item) => Math.abs(item.value - mean) / deviation > rule.config.standardDeviations).map((item) => ({
      key: `row:${item.rowNumber}`, rowNumber: item.rowNumber, column: rule.column,
      message: `Value is more than ${rule.config.standardDeviations} standard deviations from the mean`, observedValue: String(item.value),
    }));
  }

  const pattern = rule.type === "pattern" ? new RegExp(rule.config.pattern) : null;
  const findings: Finding[] = [];
  rows.forEach((row, index) => {
    const value = row[rule.column];
    const blank = value === undefined || value.trim() === "";
    const base = { key: `row:${index + 2}`, rowNumber: index + 2, column: rule.column, observedValue: value ?? null };
    if (rule.type === "required" && blank) findings.push({ ...base, message: "Required value is missing" });
    else if (rule.type === "email" && !blank && !z.string().email().safeParse(value).success) findings.push({ ...base, message: "Value is not a valid email address" });
    else if (rule.type === "number_range" && !blank) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || (rule.config.min !== undefined && numeric < rule.config.min) || (rule.config.max !== undefined && numeric > rule.config.max)) {
        findings.push({ ...base, message: "Value is outside the allowed number range" });
      }
    } else if (rule.type === "allowed_values" && !blank && !rule.config.values.includes(value ?? "")) findings.push({ ...base, message: "Value is not in the allowed list" });
    else if (rule.type === "pattern" && !blank && !pattern?.test(value ?? "")) findings.push({ ...base, message: "Value does not match the required pattern" });
  });
  return findings;
}

export class DataLintStore {
  public constructor(
    private readonly database: DataLintDatabase,
    private readonly remoteLoader: (input: RemoteSourceInput) => Promise<SourceSnapshot> = loadRemoteSource,
  ) {}

  private readonly sourceSelection = `SELECT id, name, kind, file_name AS "fileName", connector_url AS "connectorUrl",
    record_path AS "recordPath", row_count AS "rowCount", columns_json AS "columnsJson", rows_json AS "rowsJson",
    schedule_minutes AS "scheduleMinutes", next_run_at AS "nextRunAt", last_synced_at AS "lastSyncedAt",
    sync_status AS "syncStatus", sync_error AS "syncError", created_at AS "createdAt", updated_at AS "updatedAt" FROM data_sources`;

  public async listSources(): Promise<DataSource[]> {
    const result = await this.database.query<SourceRow>(`${this.sourceSelection} ORDER BY created_at DESC`);
    return result.rows.map(mapSource);
  }

  public async getSource(sourceId: SourceId, executor: QueryExecutor = this.database): Promise<DataSource | null> {
    const result = await executor.query<SourceRow>(`${this.sourceSelection} WHERE id = $1`, [sourceId]);
    return result.rows[0] ? mapSource(result.rows[0]) : null;
  }

  private async insertSource(name: string, kind: SourceKind, snapshot: SourceSnapshot, remote?: RemoteSourceInput): Promise<DataSource> {
    const id = randomUUID() as SourceId;
    const timestamp = now();
    const nextRunAt = remote?.scheduleMinutes ? new Date(Date.now() + remote.scheduleMinutes * 60_000).toISOString() : null;
    await this.database.query(`INSERT INTO data_sources
      (id, name, kind, file_name, connector_url, record_path, row_count, columns_json, rows_json, schedule_minutes,
       next_run_at, last_synced_at, sync_status, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,'ready',$12,$12)`,
    [id, name, kind, snapshot.fileName, remote?.url ?? null, remote?.recordPath ?? null, snapshot.rows.length,
      JSON.stringify(snapshot.columns), JSON.stringify(snapshot.rows), remote?.scheduleMinutes ?? null, nextRunAt, timestamp]);
    await this.recordSync(id, "completed", snapshot.rows.length, null, timestamp);
    const source = await this.getSource(id);
    if (!source) throw new Error("Created source could not be read back");
    return source;
  }

  public importCsv(name: string, fileName: string, content: string): Promise<DataSource> {
    return this.insertSource(name, "csv", parseCsvSnapshot(content, fileName));
  }

  public async createRemoteSource(input: RemoteSourceInput): Promise<DataSource> {
    return this.insertSource(input.name, input.kind, await this.remoteLoader(input), input);
  }

  private async recordSync(sourceId: SourceId, status: "completed" | "failed", rowCount: number | null, error: string | null, startedAt: string): Promise<void> {
    await this.database.query(`INSERT INTO source_syncs (id, source_id, status, row_count, error_message, started_at, finished_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), sourceId, status, rowCount, error, startedAt, now()]);
  }

  private async applySnapshot(sourceId: SourceId, snapshot: SourceSnapshot, fileName: string | null): Promise<DataSource> {
    const timestamp = now();
    await this.database.query(`UPDATE data_sources SET file_name = COALESCE($2, file_name), row_count = $3,
      columns_json = $4::jsonb, rows_json = $5::jsonb, last_synced_at = $6, updated_at = $6,
      sync_status = 'ready', sync_error = NULL WHERE id = $1`,
    [sourceId, fileName, snapshot.rows.length, JSON.stringify(snapshot.columns), JSON.stringify(snapshot.rows), timestamp]);
    await this.recordSync(sourceId, "completed", snapshot.rows.length, null, timestamp);
    const source = await this.getSource(sourceId);
    if (!source) throw new Error("Data source not found");
    return source;
  }

  public async refreshCsv(sourceId: SourceId, fileName: string, content: string): Promise<DataSource> {
    const source = await this.getSource(sourceId);
    if (!source || source.kind !== "csv") throw new Error("CSV source not found");
    return this.applySnapshot(sourceId, parseCsvSnapshot(content, fileName), fileName);
  }

  public async refreshRemoteSource(sourceId: SourceId): Promise<DataSource> {
    const source = await this.getSource(sourceId);
    if (!source || source.kind === "csv" || !source.connectorUrl) throw new Error("Remote source not found");
    const startedAt = now();
    await this.database.query("UPDATE data_sources SET sync_status = 'syncing', sync_error = NULL WHERE id = $1", [sourceId]);
    try {
      const snapshot = await this.remoteLoader({
        name: source.name, kind: source.kind, url: source.connectorUrl,
        ...(source.recordPath ? { recordPath: source.recordPath } : {}), scheduleMinutes: source.scheduleMinutes,
      });
      return await this.applySnapshot(sourceId, snapshot, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Remote source refresh failed";
      await this.database.query("UPDATE data_sources SET sync_status = 'failed', sync_error = $2 WHERE id = $1", [sourceId, message]);
      await this.recordSync(sourceId, "failed", null, message, startedAt);
      throw error;
    }
  }

  public async setSchedule(sourceId: SourceId, schedule: SourceSchedule): Promise<DataSource> {
    const source = await this.getSource(sourceId);
    if (!source || source.kind === "csv") throw new Error("Only remote sources can be scheduled");
    const next = schedule ? new Date(Date.now() + schedule * 60_000).toISOString() : null;
    await this.database.query("UPDATE data_sources SET schedule_minutes = $2, next_run_at = $3, updated_at = $4 WHERE id = $1", [sourceId, schedule, next, now()]);
    return (await this.getSource(sourceId)) ?? source;
  }

  public async claimDueSources(): Promise<SourceId[]> {
    const result = await this.database.query<QueryResultRow & { id: string }>(`UPDATE data_sources SET
      next_run_at = NOW() + schedule_minutes * INTERVAL '1 minute'
      WHERE id IN (SELECT id FROM data_sources WHERE schedule_minutes IS NOT NULL AND next_run_at <= NOW() FOR UPDATE SKIP LOCKED)
      RETURNING id`);
    return result.rows.map((row) => row.id as SourceId);
  }

  public async listRules(sourceId?: SourceId, executor: QueryExecutor = this.database): Promise<Rule[]> {
    const selection = `SELECT id, source_id AS "sourceId", name, type, column_name AS "column",
      config_json AS "configJson", severity, enabled, created_at AS "createdAt" FROM rules`;
    const result = sourceId ? await executor.query<RuleRow>(`${selection} WHERE source_id = $1 ORDER BY created_at DESC`, [sourceId])
      : await executor.query<RuleRow>(`${selection} ORDER BY created_at DESC`);
    return result.rows.map(mapRule);
  }

  public async createRule(sourceId: SourceId, input: RuleInput): Promise<Rule> {
    const source = await this.getSource(sourceId);
    if (!source) throw new Error("Data source not found");
    if (input.type !== "row_count_change" && !source.columns.includes(input.column)) throw new Error(`Column “${input.column}” does not exist in this source`);
    if (input.type === "pattern") new RegExp(input.config.pattern);
    const id = randomUUID() as RuleId;
    const timestamp = now();
    await this.database.query(`INSERT INTO rules
      (id, source_id, name, type, column_name, config_json, severity, enabled, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,TRUE,$8,$8)`,
    [id, sourceId, input.name, input.type, input.column, JSON.stringify(input.config), input.severity, timestamp]);
    return (await this.listRules(sourceId)).find((rule) => rule.id === id) as Rule;
  }

  public async setRuleEnabled(ruleId: RuleId, enabled: boolean): Promise<Rule> {
    const result = await this.database.query("UPDATE rules SET enabled = $2, updated_at = $3 WHERE id = $1", [ruleId, enabled, now()]);
    if (!result.rowCount) throw new Error("Rule not found");
    const rule = (await this.listRules()).find((item) => item.id === ruleId);
    if (!rule) throw new Error("Rule not found");
    return rule;
  }

  public async deleteRule(ruleId: RuleId): Promise<void> {
    const result = await this.database.query("DELETE FROM rules WHERE id = $1", [ruleId]);
    if (!result.rowCount) throw new Error("Rule not found");
  }

  public async runChecks(sourceId: SourceId): Promise<CheckRun> {
    const sourceResult = await this.database.query<QueryResultRow & { rowsJson: unknown }>("SELECT rows_json AS \"rowsJson\" FROM data_sources WHERE id = $1", [sourceId]);
    const source = await this.getSource(sourceId);
    if (!source || !sourceResult.rows[0]) throw new Error("Data source not found");
    const rows = parseJson(sourceResult.rows[0].rowsJson, rowsSchema);
    const rules = (await this.listRules(sourceId)).filter((rule) => rule.enabled);
    if (!rules.length) throw new Error("Add at least one enabled rule before running checks");
    const previous = await this.database.query<QueryResultRow & { rowCount: number }>(`SELECT row_count AS "rowCount" FROM source_syncs
      WHERE source_id = $1 AND status = 'completed' ORDER BY finished_at DESC OFFSET 1 LIMIT 1`, [sourceId]);
    const previousRowCount = previous.rows[0]?.rowCount ?? null;
    const findings = rules.flatMap((rule) => evaluateRule(rule, rows, previousRowCount).map((finding) => ({ rule, finding })));
    const evaluated = rows.length * rules.length;
    const score = evaluated ? Math.round(Math.max(0, 100 - findings.length / evaluated * 100) * 10) / 10 : 100;
    const runId = randomUUID() as RunId;
    const startedAt = now();
    const finishedAt = now();
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO check_runs
        (id, source_id, status, started_at, finished_at, rows_scanned, checks_evaluated, issues_found, score)
        VALUES ($1,$2,'completed',$3,$4,$5,$6,$7,$8)`, [runId, sourceId, startedAt, finishedAt, rows.length, evaluated, findings.length, score]);
      const activeFingerprints: string[] = [];
      for (const { rule, finding } of findings) {
        const issueFingerprint = fingerprint(rule.id, finding.key);
        activeFingerprints.push(issueFingerprint);
        const existing = await client.query<QueryResultRow & { id: string; status: IssueStatus }>("SELECT id, status FROM issues WHERE rule_id = $1 AND fingerprint = $2", [rule.id, issueFingerprint]);
        const current = existing.rows[0];
        const issueId = (current?.id ?? randomUUID()) as IssueId;
        if (current) {
          await client.query(`UPDATE issues SET run_id=$2,status='open',severity=$3,row_number=$4,column_name=$5,message=$6,
            observed_value=$7,last_seen_at=$8,resolved_at=NULL,resolution_note=NULL WHERE id=$1`,
          [issueId, runId, rule.severity, finding.rowNumber, finding.column, finding.message, finding.observedValue, finishedAt]);
        } else {
          await client.query(`INSERT INTO issues (id,source_id,rule_id,run_id,fingerprint,status,severity,row_number,column_name,message,
            observed_value,first_seen_at,last_seen_at) VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,$9,$10,$11,$11)`,
          [issueId, sourceId, rule.id, runId, issueFingerprint, rule.severity, finding.rowNumber, finding.column, finding.message, finding.observedValue, finishedAt]);
        }
        if (!current || current.status === "resolved") {
          await client.query("INSERT INTO issue_events (id,issue_id,type,note,created_at) VALUES ($1,$2,$3,NULL,$4)",
            [randomUUID(), issueId, current ? "reopened" : "opened", finishedAt]);
        }
      }
      const parameters: unknown[] = [sourceId, finishedAt];
      let activeClause = "";
      if (activeFingerprints.length) {
        activeClause = `AND fingerprint NOT IN (${activeFingerprints.map((_, index) => `$${index + 3}`).join(",")})`;
        parameters.push(...activeFingerprints);
      }
      const resolved = await client.query<QueryResultRow & { id: string }>(`UPDATE issues SET status='resolved',resolved_at=$2,
        resolution_note='No longer detected in the latest completed run' WHERE source_id=$1 AND status='open'
        AND rule_id IN (SELECT id FROM rules WHERE source_id=$1 AND enabled=TRUE) ${activeClause} RETURNING id`, parameters);
      for (const issue of resolved.rows) {
        await client.query("INSERT INTO issue_events (id,issue_id,type,note,created_at) VALUES ($1,$2,'auto_resolved',$3,$4)",
          [randomUUID(), issue.id, "No longer detected in the latest completed run", finishedAt]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    return { id: runId, sourceId, sourceName: source.name, status: "completed", startedAt, finishedAt,
      rowsScanned: rows.length, checksEvaluated: evaluated, issuesFound: findings.length, score };
  }

  public async listRuns(): Promise<CheckRun[]> {
    const result = await this.database.query<QueryResultRow & { id: string; sourceId: string; sourceName: string;
      status: "completed" | "failed"; startedAt: Date | string; finishedAt: Date | string; rowsScanned: number;
      checksEvaluated: number; issuesFound: number; score: number }>(`SELECT check_runs.id,check_runs.source_id AS "sourceId",
      data_sources.name AS "sourceName",check_runs.status,check_runs.started_at AS "startedAt",check_runs.finished_at AS "finishedAt",
      check_runs.rows_scanned AS "rowsScanned",check_runs.checks_evaluated AS "checksEvaluated",check_runs.issues_found AS "issuesFound",
      check_runs.score FROM check_runs JOIN data_sources ON data_sources.id=check_runs.source_id ORDER BY check_runs.started_at DESC LIMIT 50`);
    return result.rows.map((row) => ({ ...row, id: row.id as RunId, sourceId: row.sourceId as SourceId,
      startedAt: toIso(row.startedAt) ?? "", finishedAt: toIso(row.finishedAt) ?? "" }));
  }

  public async listIssues(status?: IssueStatus): Promise<Issue[]> {
    type IssueRow = QueryResultRow & Omit<Issue, "id" | "sourceId" | "ruleId" | "runId" | "firstSeenAt" | "lastSeenAt" | "resolvedAt"> & {
      id: string; sourceId: string; ruleId: string; runId: string; firstSeenAt: Date | string; lastSeenAt: Date | string; resolvedAt: Date | string | null };
    const selection = `SELECT issues.id,issues.source_id AS "sourceId",data_sources.name AS "sourceName",issues.rule_id AS "ruleId",
      rules.name AS "ruleName",issues.run_id AS "runId",issues.status,issues.severity,issues.row_number AS "rowNumber",
      issues.column_name AS "column",issues.message,issues.observed_value AS "observedValue",issues.first_seen_at AS "firstSeenAt",
      issues.last_seen_at AS "lastSeenAt",issues.resolved_at AS "resolvedAt",issues.resolution_note AS "resolutionNote" FROM issues
      JOIN data_sources ON data_sources.id=issues.source_id JOIN rules ON rules.id=issues.rule_id`;
    const result = status ? await this.database.query<IssueRow>(`${selection} WHERE issues.status=$1 ORDER BY issues.last_seen_at DESC LIMIT 500`, [status])
      : await this.database.query<IssueRow>(`${selection} ORDER BY issues.last_seen_at DESC LIMIT 500`);
    return result.rows.map((row) => ({ ...row, id: row.id as IssueId, sourceId: row.sourceId as SourceId,
      ruleId: row.ruleId as RuleId, runId: row.runId as RunId, firstSeenAt: toIso(row.firstSeenAt) ?? "",
      lastSeenAt: toIso(row.lastSeenAt) ?? "", resolvedAt: toIso(row.resolvedAt) }));
  }

  public async updateIssue(issueId: IssueId, status: IssueStatus, note?: string): Promise<Issue> {
    const timestamp = now();
    const existing = (await this.listIssues()).find((issue) => issue.id === issueId);
    if (!existing) throw new Error("Issue not found");
    await this.database.query("UPDATE issues SET status=$2,resolved_at=$3,resolution_note=$4 WHERE id=$1",
      [issueId, status, status === "resolved" ? timestamp : null, status === "resolved" ? note ?? null : null]);
    if (existing.status !== status) await this.database.query("INSERT INTO issue_events (id,issue_id,type,note,created_at) VALUES ($1,$2,$3,$4,$5)",
      [randomUUID(), issueId, status === "resolved" ? "resolved" : "reopened", note ?? null, timestamp]);
    const issue = (await this.listIssues()).find((item) => item.id === issueId);
    if (!issue) throw new Error("Issue not found");
    return issue;
  }

  public async listIssueEvents(issueId: IssueId): Promise<IssueEvent[]> {
    const result = await this.database.query<QueryResultRow & { id: string; issueId: string; type: IssueEvent["type"]; note: string | null; createdAt: Date | string }>(
      `SELECT id,issue_id AS "issueId",type,note,created_at AS "createdAt" FROM issue_events WHERE issue_id=$1 ORDER BY created_at DESC LIMIT 200`, [issueId]);
    return result.rows.map((row) => ({ ...row, id: row.id as IssueEventId, issueId: row.issueId as IssueId, createdAt: toIso(row.createdAt) ?? "" }));
  }

  public async pendingAlerts(): Promise<Array<{ eventId: IssueEventId; issue: Issue }>> {
    const events = await this.database.query<QueryResultRow & { eventId: string; issueId: string }>(`SELECT id AS "eventId",issue_id AS "issueId"
      FROM issue_events WHERE alerted_at IS NULL AND type IN ('opened','reopened') ORDER BY created_at LIMIT 100`);
    const issues = await this.listIssues();
    return events.rows.flatMap((event) => {
      const issue = issues.find((item) => item.id === event.issueId);
      return issue ? [{ eventId: event.eventId as IssueEventId, issue }] : [];
    });
  }

  public async markAlerted(eventIds: IssueEventId[]): Promise<void> {
    if (!eventIds.length) return;
    await this.database.query(`UPDATE issue_events SET alerted_at=NOW() WHERE id IN (${eventIds.map((_, index) => `$${index + 1}`).join(",")})`, eventIds);
  }

  public async dashboard(): Promise<Dashboard> {
    type CountRow = QueryResultRow & { count: number };
    const [sources, rules, open, resolved, latest, severity] = await Promise.all([
      this.database.query<CountRow>("SELECT COUNT(*)::integer AS count FROM data_sources"),
      this.database.query<CountRow>("SELECT COUNT(*)::integer AS count FROM rules WHERE enabled=TRUE"),
      this.database.query<CountRow>("SELECT COUNT(*)::integer AS count FROM issues WHERE status='open'"),
      this.database.query<CountRow>("SELECT COUNT(*)::integer AS count FROM issues WHERE status='resolved'"),
      this.database.query<QueryResultRow & { score: number; finishedAt: Date | string }>("SELECT score,finished_at AS \"finishedAt\" FROM check_runs ORDER BY started_at DESC LIMIT 1"),
      this.database.query<QueryResultRow & { severity: Severity; count: number }>("SELECT severity,COUNT(*)::integer AS count FROM issues WHERE status='open' GROUP BY severity"),
    ]);
    const bySeverity = { low: 0, medium: 0, high: 0 } satisfies Record<Severity, number>;
    severity.rows.forEach((row) => { bySeverity[row.severity] = row.count; });
    return { sourceCount: sources.rows[0]?.count ?? 0, ruleCount: rules.rows[0]?.count ?? 0,
      openIssueCount: open.rows[0]?.count ?? 0, resolvedIssueCount: resolved.rows[0]?.count ?? 0,
      latestScore: latest.rows[0]?.score ?? null, latestRunAt: latest.rows[0] ? toIso(latest.rows[0].finishedAt) : null,
      issuesBySeverity: bySeverity };
  }
}
