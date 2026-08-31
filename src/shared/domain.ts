import { z } from "zod";

export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type SourceId = Brand<string, "SourceId">;
export type RuleId = Brand<string, "RuleId">;
export type RunId = Brand<string, "RunId">;
export type IssueId = Brand<string, "IssueId">;
export type IssueEventId = Brand<string, "IssueEventId">;

export const sourceKindSchema = z.enum(["csv", "google_sheets", "json_api"]);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const sourceScheduleSchema = z.union([z.literal(60), z.literal(360), z.literal(1440), z.literal(10080)]).nullable();
export type SourceSchedule = z.infer<typeof sourceScheduleSchema>;

export const remoteSourceInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(["google_sheets", "json_api"]),
  url: z.string().url().max(2000),
  recordPath: z.string().trim().max(240).optional(),
  scheduleMinutes: sourceScheduleSchema.default(null),
});
export type RemoteSourceInput = z.infer<typeof remoteSourceInputSchema>;

export const severitySchema = z.enum(["low", "medium", "high"]);
export type Severity = z.infer<typeof severitySchema>;

const ruleBase = {
  name: z.string().trim().min(2).max(80),
  column: z.string().trim().min(1).max(120),
  severity: severitySchema.default("medium"),
};

export const ruleInputSchema = z.discriminatedUnion("type", [
  z.object({ ...ruleBase, type: z.literal("required"), config: z.object({}).default({}) }),
  z.object({ ...ruleBase, type: z.literal("unique"), config: z.object({}).default({}) }),
  z.object({ ...ruleBase, type: z.literal("email"), config: z.object({}).default({}) }),
  z.object({
    ...ruleBase,
    type: z.literal("number_range"),
    config: z
      .object({ min: z.number().optional(), max: z.number().optional() })
      .refine((value) => value.min !== undefined || value.max !== undefined, "Set a minimum or maximum"),
  }),
  z.object({
    ...ruleBase,
    type: z.literal("allowed_values"),
    config: z.object({ values: z.array(z.string().trim().min(1)).min(1).max(100) }),
  }),
  z.object({
    ...ruleBase,
    type: z.literal("pattern"),
    config: z.object({ pattern: z.string().min(1).max(300) }),
  }),
  z.object({
    ...ruleBase,
    type: z.literal("numeric_outlier"),
    config: z.object({ standardDeviations: z.number().min(1).max(6).default(3), minSamples: z.number().int().min(5).max(1000).default(10) }),
  }),
  z.object({
    ...ruleBase,
    type: z.literal("row_count_change"),
    column: z.literal("__rows__"),
    config: z.object({ maximumPercentChange: z.number().min(1).max(1000).default(25) }),
  }),
]);

export type RuleInput = z.infer<typeof ruleInputSchema>;
export type RuleType = RuleInput["type"];

export const resolveIssueSchema = z.object({
  status: z.enum(["open", "resolved"]),
  resolutionNote: z.string().trim().max(500).optional(),
});

export type DataSource = {
  id: SourceId;
  name: string;
  kind: SourceKind;
  fileName: string | null;
  connectorUrl: string | null;
  recordPath: string | null;
  rowCount: number;
  columns: string[];
  scheduleMinutes: SourceSchedule;
  nextRunAt: string | null;
  lastSyncedAt: string | null;
  syncStatus: "ready" | "syncing" | "failed";
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IssueEventType = "opened" | "reopened" | "resolved" | "auto_resolved";

export type IssueEvent = {
  id: IssueEventId;
  issueId: IssueId;
  type: IssueEventType;
  note: string | null;
  createdAt: string;
};

export type Rule = RuleInput & {
  id: RuleId;
  sourceId: SourceId;
  enabled: boolean;
  createdAt: string;
};

export type CheckRun = {
  id: RunId;
  sourceId: SourceId;
  sourceName: string;
  status: "completed" | "failed";
  startedAt: string;
  finishedAt: string;
  rowsScanned: number;
  checksEvaluated: number;
  issuesFound: number;
  score: number;
};

export type IssueStatus = "open" | "resolved";

export type Issue = {
  id: IssueId;
  sourceId: SourceId;
  sourceName: string;
  ruleId: RuleId;
  ruleName: string;
  runId: RunId;
  status: IssueStatus;
  severity: Severity;
  rowNumber: number | null;
  column: string;
  message: string;
  observedValue: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
};

export type Dashboard = {
  sourceCount: number;
  ruleCount: number;
  openIssueCount: number;
  resolvedIssueCount: number;
  latestScore: number | null;
  latestRunAt: string | null;
  issuesBySeverity: Record<Severity, number>;
};

export type ApiError = { error: string; details?: string[] };
