import type {
  ApiError,
  CheckRun,
  Dashboard,
  DataSource,
  Issue,
  IssueStatus,
  Rule,
  RuleInput,
  SourceId,
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
  const payload = (await response.json()) as T | ApiError;
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
  createRule: (sourceId: SourceId, input: RuleInput): Promise<Rule> =>
    request(`/api/sources/${sourceId}/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  runChecks: (sourceId: SourceId): Promise<CheckRun> => request(`/api/sources/${sourceId}/checks`, { method: "POST" }),
  updateIssue: (issue: Issue, status: IssueStatus, resolutionNote?: string): Promise<Issue> =>
    request(`/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, resolutionNote }),
    }),
};
