import { z } from "zod";

export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type SourceId = Brand<string, "SourceId">;
export type RuleId = Brand<string, "RuleId">;
export type RunId = Brand<string, "RunId">;
export type IssueId = Brand<string, "IssueId">;

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
  kind: "csv";
  fileName: string;
  rowCount: number;
  columns: string[];
  createdAt: string;
  updatedAt: string;
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
