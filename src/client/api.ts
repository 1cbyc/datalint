import type {
  ApiError,
  CheckRun,
  Dashboard,
  DataSource,
  Issue,
  IssueEvent,
  IssueStatus,
  RemoteSourceInput,
  Rule,
  RuleId,
  RuleInput,
  SourceId,
  SourceSchedule,
} from "../shared/domain";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const tokenStorageKey = "datalint-api-token";
export const remoteApiEnabled = apiBaseUrl !== "";

export function setApiToken(token: string): void {
  sessionStorage.setItem(tokenStorageKey, token);
}

export function clearApiToken(): void {
  sessionStorage.removeItem(tokenStorageKey);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const apiToken = sessionStorage.getItem(tokenStorageKey);
  if (apiToken) headers.set("Authorization", `Bearer ${apiToken}`);
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });
  const payload = response.status === 204 ? undefined : await response.json() as T | ApiError;
  if (!response.ok) {
    const error = payload as ApiError;
    throw new Error(error.details?.join(". ") ?? error.error ?? "Request failed");
  }
  return payload as T;
}

export const api = {
  dashboard: (): Promise<Dashboard> => request("/api/dashboard"),
  sources: (): Promise<DataSource[]> => request("/api/sources"),
  rules: (): Promise<Rule[]> => request("/api/rules"),
  runs: (): Promise<CheckRun[]> => request("/api/runs"),
  issues: (status?: IssueStatus): Promise<Issue[]> => request(`/api/issues${status ? `?status=${status}` : ""}`),
  importCsv: (name: string, file: File): Promise<DataSource> => {
    const body = new FormData();
    body.append("name", name);
    body.append("file", file);
    return request("/api/sources/csv", { method: "POST", body });
  },
  refreshCsv: (sourceId: SourceId, file: File): Promise<DataSource> => {
    const body = new FormData();
    body.append("file", file);
    return request(`/api/sources/${sourceId}/csv`, { method: "PUT", body });
  },
  createRemoteSource: (input: RemoteSourceInput): Promise<DataSource> =>
    request("/api/sources/remote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  refreshRemoteSource: (sourceId: SourceId): Promise<DataSource> =>
    request(`/api/sources/${sourceId}/refresh`, { method: "POST" }),
  setSchedule: (sourceId: SourceId, scheduleMinutes: SourceSchedule): Promise<DataSource> =>
    request(`/api/sources/${sourceId}/schedule`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scheduleMinutes }) }),
  createRule: (sourceId: SourceId, input: RuleInput): Promise<Rule> =>
    request(`/api/sources/${sourceId}/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  runChecks: (sourceId: SourceId): Promise<CheckRun> => request(`/api/sources/${sourceId}/checks`, { method: "POST" }),
  setRuleEnabled: (ruleId: RuleId, enabled: boolean): Promise<Rule> =>
    request(`/api/rules/${ruleId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) }),
  deleteRule: (ruleId: RuleId): Promise<void> => request(`/api/rules/${ruleId}`, { method: "DELETE" }),
  issueEvents: (issue: Issue): Promise<IssueEvent[]> => request(`/api/issues/${issue.id}/events`),
  downloadIssues: async (): Promise<void> => {
    const headers = new Headers();
    const apiToken = sessionStorage.getItem(tokenStorageKey);
    if (apiToken) headers.set("Authorization", `Bearer ${apiToken}`);
    const response = await fetch(`${apiBaseUrl}/api/issues/export.csv`, { headers });
    if (!response.ok) throw new Error("Could not export issues");
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "datalint-issues.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  },
  updateIssue: (issue: Issue, status: IssueStatus, resolutionNote?: string): Promise<Issue> =>
    request(`/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, resolutionNote }),
    }),
};
