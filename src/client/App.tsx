import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleDot,
  Database,
  FileClock,
  FileSpreadsheet,
  Gauge,
  KeyRound,
  Lock,
  Menu,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import type {
  CheckRun,
  Dashboard,
  DataSource,
  Issue,
  IssueStatus,
  Rule,
  RuleInput,
  RuleType,
  Severity,
  SourceId,
} from "../shared/domain";
import { api, clearApiToken, remoteApiEnabled, setApiToken } from "./api";

type View = "overview" | "sources" | "issues" | "history";

type Workspace = {
  dashboard: Dashboard;
  sources: DataSource[];
  rules: Rule[];
  issues: Issue[];
  runs: CheckRun[];
};

const navItems = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "sources", label: "Sources & rules", icon: Database },
  { id: "issues", label: "Issue desk", icon: CircleDot },
  { id: "history", label: "Run history", icon: FileClock },
] satisfies Array<{ id: View; label: string; icon: typeof Gauge }>;

const ruleLabels: Record<RuleType, string> = {
  required: "Required value",
  unique: "Unique value",
  email: "Valid email",
  number_range: "Number range",
  allowed_values: "Allowed values",
  pattern: "Text pattern",
};

const emptyWorkspace: Workspace = {
  dashboard: {
    sourceCount: 0,
    ruleCount: 0,
    openIssueCount: 0,
    resolvedIssueCount: 0,
    latestScore: null,
    latestRunAt: null,
    issuesBySeverity: { low: 0, medium: 0, high: 0 },
  },
  sources: [],
  rules: [],
  issues: [],
  runs: [],
};

function formatDate(value: string | null): string {
  if (!value) return "Not run yet";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatRuleType(type: RuleType): string {
  return ruleLabels[type];
}

function ScoreDial({ score }: { score: number | null }) {
  const value = score ?? 0;
  const tone = score === null ? "empty" : value >= 90 ? "good" : value >= 70 ? "watch" : "risk";
  return (
    <div className={`score-dial score-dial--${tone}`} style={{ "--score": `${value * 3.6}deg` } as React.CSSProperties}>
      <div className="score-dial__inner">
        <span>{score === null ? "—" : Math.round(score)}</span>
        <small>{score === null ? "no score" : "out of 100"}</small>
      </div>
    </div>
  );
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state__mark"><FileSpreadsheet aria-hidden="true" /></div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function App() {
  const [view, setView] = useState<View>(() => {
    const requested = window.location.hash.slice(1);
    return navItems.some((item) => item.id === requested) ? (requested as View) : "overview";
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const [selectedSourceId, setSelectedSourceId] = useState<SourceId | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [dashboard, sources, rules, issues, runs] = await Promise.all([
      api.dashboard(),
      api.sources(),
      api.rules(),
      api.issues(),
      api.runs(),
    ]);
    setWorkspace({ dashboard, sources, rules, issues, runs });
    setSelectedSourceId((current) => current ?? sources[0]?.id ?? null);
  }, []);

  useEffect(() => {
    refresh()
      .catch((caught: unknown) => {
        const message = caught instanceof Error ? caught.message : "Could not load the workspace";
        if (message === "Authentication required") setLocked(true);
        else setError(message);
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await refresh();
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : "Something went wrong";
      if (message === "Authentication required") setLocked(true);
      else setError(message);
    } finally {
      setBusy(false);
    }
  };

  const selectedSource = workspace.sources.find((source) => source.id === selectedSourceId) ?? null;

  const navigate = (nextView: View) => {
    setView(nextView);
    setMobileNavOpen(false);
    window.history.replaceState(null, "", `#${nextView}`);
  };

  const unlock = async (token: string) => {
    setBusy(true);
    setError(null);
    setApiToken(token);
    try {
      await refresh();
      setLocked(false);
    } catch (caught: unknown) {
      clearApiToken();
      setError(caught instanceof Error ? caught.message : "Could not unlock the workspace");
    } finally {
      setBusy(false);
      setLoading(false);
    }
  };

  if (locked) {
    return <UnlockScreen busy={busy} error={error} onUnlock={(token) => void unlock(token)} />;
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className={`sidebar ${mobileNavOpen ? "sidebar--open" : ""}`} aria-label="Primary navigation">
        <div className="brand">
          <div className="brand__mark" aria-hidden="true"><span /><span /><span /></div>
          <div><strong>DataLint</strong><small>quality monitor</small></div>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <a
                className={view === item.id ? "nav-item nav-item--active" : "nav-item"}
                href={`#${item.id}`}
                key={item.id}
                onClick={() => navigate(item.id)}
                aria-current={view === item.id ? "page" : undefined}
              >
                <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>
        <div className="sidebar__foot">
          <span className="status-dot" aria-hidden="true" />
          <div><strong>{remoteApiEnabled ? "Remote workspace" : "Local workspace"}</strong><small>{remoteApiEnabled ? "secured API session" : "data stays on this server"}</small></div>
          {remoteApiEnabled && <button className="lock-button" type="button" onClick={() => { clearApiToken(); setLocked(true); }} aria-label="Lock workspace"><Lock aria-hidden="true" /></button>}
        </div>
      </aside>

      {mobileNavOpen && <button className="scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}

      <main id="main-content" className="main">
        <header className="topbar">
          <button className="icon-button mobile-menu" type="button" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
            <Menu aria-hidden="true" />
          </button>
          <div>
            <p className="eyebrow">Operations / <span>{navItems.find((item) => item.id === view)?.label}</span></p>
            <h1>{view === "overview" ? "Know when the numbers stop making sense." : navItems.find((item) => item.id === view)?.label}</h1>
          </div>
          <button className="icon-button" type="button" onClick={() => void perform(refresh)} disabled={busy} aria-label="Refresh workspace">
            <RefreshCw className={busy ? "spin" : ""} aria-hidden="true" />
          </button>
        </header>

        <div className="announcer" aria-live="polite">
          {error && <div className="alert alert--error"><AlertTriangle aria-hidden="true" /><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error"><X /></button></div>}
          {notice && <div className="alert alert--success"><CheckCircle2 aria-hidden="true" /><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss message"><X /></button></div>}
        </div>

        {loading ? (
          <div className="loading-state"><span /><p>Opening the workspace…</p></div>
        ) : (
          <div className="view-enter" key={view}>
            {view === "overview" && (
              <Overview
                workspace={workspace}
                selectedSource={selectedSource}
                busy={busy}
                onNavigate={navigate}
                onRun={(sourceId) => void perform(async () => {
                  const run = await api.runChecks(sourceId);
                  setNotice(`Check complete: ${run.issuesFound} issue${run.issuesFound === 1 ? "" : "s"} found.`);
                })}
              />
            )}
            {view === "sources" && (
              <SourcesAndRules
                sources={workspace.sources}
                rules={workspace.rules}
                selectedSource={selectedSource}
                busy={busy}
                onSelect={setSelectedSourceId}
                onImport={(name, file) => void perform(async () => {
                  const source = await api.importCsv(name, file);
                  setSelectedSourceId(source.id);
                  setNotice(`${source.name} imported with ${source.rowCount} rows.`);
                })}
                onCreateRule={(sourceId, input) => void perform(async () => {
                  await api.createRule(sourceId, input);
                  setNotice("Validation rule added.");
                })}
                onRun={(sourceId) => void perform(async () => {
                  const run = await api.runChecks(sourceId);
                  setNotice(`Check complete with a score of ${run.score}.`);
                })}
              />
            )}
            {view === "issues" && (
              <IssueDesk
                issues={workspace.issues}
                busy={busy}
                onUpdate={(issue, status, note) => void perform(async () => {
                  await api.updateIssue(issue, status, note);
                  setNotice(status === "resolved" ? "Issue marked resolved." : "Issue reopened.");
                })}
              />
            )}
            {view === "history" && <RunHistory runs={workspace.runs} />}
          </div>
        )}
      </main>
    </div>
  );
}

function UnlockScreen({ busy, error, onUnlock }: { busy: boolean; error: string | null; onUnlock: (token: string) => void }) {
  const [token, setToken] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (token.trim()) onUnlock(token.trim());
  };
  return (
    <main className="unlock-screen">
      <section className="unlock-card" aria-labelledby="unlock-title">
        <div className="brand brand--dark">
          <div className="brand__mark" aria-hidden="true"><span /><span /><span /></div>
          <div><strong>DataLint</strong><small>quality monitor</small></div>
        </div>
        <span className="unlock-card__icon"><KeyRound aria-hidden="true" /></span>
        <p className="section-label">Protected workspace</p>
        <h1 id="unlock-title">Enter your access token.</h1>
        <p>The operational API is locked. Your token stays in this browser tab and is cleared when the tab closes.</p>
        {error && <div className="inline-error" role="alert">{error === "Authentication required" ? "That token was not accepted. Check it and try again." : error}</div>}
        <form onSubmit={submit}>
          <label className="field" htmlFor="access-token"><span>Access token</span><input id="access-token" name="access-token" type="password" autoComplete="current-password" spellCheck={false} value={token} onChange={(event) => setToken(event.target.value)} /></label>
          <button className="primary-button" type="submit" disabled={busy || token.trim() === ""}>{busy ? <RefreshCw className="spin" aria-hidden="true" /> : <Lock aria-hidden="true" />} {busy ? "Unlocking…" : "Unlock workspace"}</button>
        </form>
      </section>
    </main>
  );
}

function Overview({
  workspace,
  selectedSource,
  busy,
  onNavigate,
  onRun,
}: {
  workspace: Workspace;
  selectedSource: DataSource | null;
  busy: boolean;
  onNavigate: (view: View) => void;
  onRun: (sourceId: SourceId) => void;
}) {
  const { dashboard, runs, issues } = workspace;
  const recentIssues = issues.filter((issue) => issue.status === "open").slice(0, 5);
  return (
    <>
      <section className="hero-grid">
        <article className="score-card">
          <div>
            <p className="section-label">Latest quality score</p>
            <ScoreDial score={dashboard.latestScore} />
          </div>
          <div className="score-card__copy">
            <span className="stamp">Last checked {formatDate(dashboard.latestRunAt)}</span>
            <h2>{dashboard.latestScore === null ? "Start with one source." : dashboard.latestScore >= 90 ? "Your data is holding steady." : "Some records need attention."}</h2>
            <p>The score reflects failed validations in the most recent run. It is a signal, not a substitute for reviewing the actual records.</p>
            {selectedSource ? (
              <button className="primary-button" type="button" disabled={busy} onClick={() => onRun(selectedSource.id)}>
                <Play size={17} fill="currentColor" aria-hidden="true" /> Run checks on {selectedSource.name}
              </button>
            ) : (
              <button className="primary-button" type="button" onClick={() => onNavigate("sources")}>
                <Upload size={17} aria-hidden="true" /> Import your first CSV
              </button>
            )}
          </div>
        </article>

        <div className="metric-stack">
          <article className="metric-card metric-card--ink"><small>Open issues</small><strong>{dashboard.openIssueCount}</strong><span>{dashboard.issuesBySeverity.high} high severity</span></article>
          <article className="metric-card"><small>Rules watching</small><strong>{dashboard.ruleCount}</strong><span>across {dashboard.sourceCount} source{dashboard.sourceCount === 1 ? "" : "s"}</span></article>
          <article className="metric-card"><small>Resolved</small><strong>{dashboard.resolvedIssueCount}</strong><span>kept in issue history</span></article>
        </div>
      </section>

      <section className="content-grid">
        <article className="panel issue-preview">
          <div className="panel__header">
            <div><p className="section-label">Needs attention</p><h2>Open issues</h2></div>
            <button className="text-button" type="button" onClick={() => onNavigate("issues")}>Open issue desk <ArrowRight aria-hidden="true" /></button>
          </div>
          {recentIssues.length === 0 ? (
            <EmptyState title="No open issues" description={dashboard.latestRunAt ? "The latest checks did not leave anything unresolved." : "Run checks to find missing, duplicated, or inconsistent records."} />
          ) : (
            <div className="issue-list">
              {recentIssues.map((issue) => <IssueRow issue={issue} key={issue.id} />)}
            </div>
          )}
        </article>

        <article className="panel run-preview">
          <div className="panel__header"><div><p className="section-label">Activity</p><h2>Recent runs</h2></div></div>
          {runs.length === 0 ? (
            <p className="muted-copy">No checks have run yet.</p>
          ) : runs.slice(0, 4).map((run) => (
            <div className="run-row" key={run.id}>
              <span className="run-row__check"><Check aria-hidden="true" /></span>
              <div><strong>{run.sourceName}</strong><small>{formatDate(run.finishedAt)} · {run.rowsScanned} rows</small></div>
              <b>{run.score}</b>
            </div>
          ))}
        </article>
      </section>
    </>
  );
}

function SourcesAndRules({
  sources,
  rules,
  selectedSource,
  busy,
  onSelect,
  onImport,
  onCreateRule,
  onRun,
}: {
  sources: DataSource[];
  rules: Rule[];
  selectedSource: DataSource | null;
  busy: boolean;
  onSelect: (id: SourceId) => void;
  onImport: (name: string, file: File) => void;
  onCreateRule: (sourceId: SourceId, input: RuleInput) => void;
  onRun: (sourceId: SourceId) => void;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);

  const submitImport = (event: FormEvent) => {
    event.preventDefault();
    if (file) onImport(name.trim() || file.name.replace(/\.csv$/i, ""), file);
  };
  const sourceRules = rules.filter((rule) => rule.sourceId === selectedSource?.id);

  return (
    <div className="sources-layout">
      <section className="panel source-rail">
        <div className="panel__header"><div><p className="section-label">Inputs</p><h2>Data sources</h2></div><span className="count-badge">{sources.length}</span></div>
        <form className="upload-form" onSubmit={submitImport}>
          <label className="file-drop">
            <Upload aria-hidden="true" />
            <span>{file ? file.name : "Choose a CSV file"}</span>
            <small>{file ? `${Math.max(1, Math.round(file.size / 1024))} KB ready to import` : "Up to 5 MB · plain-text CSV"}</small>
            <input name="csv-file" type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>
          <label className="field" htmlFor="source-name"><span>Source name</span><input id="source-name" name="source-name" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Weekly invoices…" maxLength={80} /></label>
          <button className="secondary-button" type="submit" disabled={!file || busy}><Plus aria-hidden="true" /> Import source</button>
        </form>
        <div className="source-list">
          {sources.map((source) => (
            <button type="button" key={source.id} onClick={() => onSelect(source.id)} className={source.id === selectedSource?.id ? "source-item source-item--active" : "source-item"}>
              <span className="source-item__icon"><FileSpreadsheet aria-hidden="true" /></span>
              <span><strong>{source.name}</strong><small>{source.rowCount} rows · {source.columns.length} columns</small></span>
              <ArrowRight aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      <section className="panel rule-workspace">
        {!selectedSource ? (
          <EmptyState title="Import a source first" description="DataLint reads the header row and uses those columns when you define validation rules." />
        ) : (
          <>
            <div className="source-heading">
              <div><p className="section-label">Selected source</p><h2>{selectedSource.name}</h2><p>{selectedSource.fileName} · imported {formatDate(selectedSource.createdAt)}</p></div>
              <div className="button-row">
                <button className="secondary-button" type="button" onClick={() => setRuleOpen((current) => !current)}><SlidersHorizontal aria-hidden="true" /> {ruleOpen ? "Close builder" : "Add rule"}</button>
                <button className="primary-button" type="button" disabled={busy || sourceRules.length === 0} onClick={() => onRun(selectedSource.id)}><Play fill="currentColor" aria-hidden="true" /> Run checks</button>
              </div>
            </div>
            <div className="column-strip" aria-label="Available columns">
              <span>Columns</span>{selectedSource.columns.map((column) => <code key={column}>{column}</code>)}
            </div>
            {ruleOpen && <RuleBuilder source={selectedSource} busy={busy} onCreate={(input) => { onCreateRule(selectedSource.id, input); setRuleOpen(false); }} />}
            <div className="rules-list">
              <div className="rules-list__header"><h3>Active rules</h3><span>{sourceRules.length} configured</span></div>
              {sourceRules.length === 0 ? (
                <EmptyState title="No rules yet" description="Add a required, unique, format, or range rule, then run your first check." action={<button className="text-button" type="button" onClick={() => setRuleOpen(true)}>Create a rule <ArrowRight /></button>} />
              ) : sourceRules.map((rule) => (
                <div className="rule-row" key={rule.id}>
                  <span className={`severity-mark severity-mark--${rule.severity}`} aria-label={`${rule.severity} severity`} />
                  <div><strong>{rule.name}</strong><small>{formatRuleType(rule.type)} on <code>{rule.column}</code></small></div>
                  <span className="enabled-badge"><ShieldCheck aria-hidden="true" /> Active</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function RuleBuilder({ source, busy, onCreate }: { source: DataSource; busy: boolean; onCreate: (input: RuleInput) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<RuleType>("required");
  const [column, setColumn] = useState(source.columns[0] ?? "");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [configText, setConfigText] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const base = { name, type, column, severity };
    let input: RuleInput;
    if (type === "number_range") {
      input = { ...base, type, config: { ...(minimum ? { min: Number(minimum) } : {}), ...(maximum ? { max: Number(maximum) } : {}) } };
    } else if (type === "allowed_values") {
      input = { ...base, type, config: { values: configText.split(",").map((value) => value.trim()).filter(Boolean) } };
    } else if (type === "pattern") {
      input = { ...base, type, config: { pattern: configText } };
    } else {
      input = { ...base, type, config: {} };
    }
    onCreate(input);
  };

  return (
    <form className="rule-builder" onSubmit={submit}>
      <div className="rule-builder__title"><div><p className="section-label">Rule builder</p><h3>What should DataLint watch?</h3></div><span>01 / Define</span></div>
      <div className="form-grid">
        <label className="field field--wide" htmlFor="rule-name"><span>Rule name</span><input id="rule-name" name="rule-name" autoComplete="off" required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Every invoice needs an ID…" /></label>
        <label className="field" htmlFor="rule-type"><span>Check</span><select id="rule-type" name="rule-type" value={type} onChange={(event) => setType(event.target.value as RuleType)}>{Object.entries(ruleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field" htmlFor="rule-column"><span>Column</span><select id="rule-column" name="rule-column" value={column} onChange={(event) => setColumn(event.target.value)}>{source.columns.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="field" htmlFor="rule-severity"><span>Severity</span><select id="rule-severity" name="rule-severity" value={severity} onChange={(event) => setSeverity(event.target.value as Severity)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        {type === "number_range" && <><label className="field" htmlFor="rule-minimum"><span>Minimum</span><input id="rule-minimum" name="rule-minimum" autoComplete="off" type="number" value={minimum} onChange={(event) => setMinimum(event.target.value)} placeholder="No minimum…" /></label><label className="field" htmlFor="rule-maximum"><span>Maximum</span><input id="rule-maximum" name="rule-maximum" autoComplete="off" type="number" value={maximum} onChange={(event) => setMaximum(event.target.value)} placeholder="No maximum…" /></label></>}
        {type === "allowed_values" && <label className="field field--wide" htmlFor="rule-values"><span>Allowed values</span><input id="rule-values" name="rule-values" autoComplete="off" required value={configText} onChange={(event) => setConfigText(event.target.value)} placeholder="paid, pending, refunded…" /><small>Separate values with commas.</small></label>}
        {type === "pattern" && <label className="field field--wide" htmlFor="rule-pattern"><span>Regular expression</span><input id="rule-pattern" name="rule-pattern" autoComplete="off" spellCheck={false} required value={configText} onChange={(event) => setConfigText(event.target.value)} placeholder="^INV-[0-9]+$…" /><small>Stored and evaluated as a JavaScript regular expression.</small></label>}
      </div>
      <button className="primary-button" type="submit" disabled={busy || !name || !column}>Save rule <ArrowRight aria-hidden="true" /></button>
    </form>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  return (
    <div className="issue-row">
      <span className={`severity-mark severity-mark--${issue.severity}`} aria-label={`${issue.severity} severity`} />
      <div><strong>{issue.message}</strong><small>{issue.sourceName} · {issue.column}{issue.rowNumber ? ` · row ${issue.rowNumber}` : ""}</small></div>
      <code>{issue.observedValue || "empty"}</code>
    </div>
  );
}

function IssueDesk({ issues, busy, onUpdate }: { issues: Issue[]; busy: boolean; onUpdate: (issue: Issue, status: IssueStatus, note?: string) => void }) {
  const [status, setStatus] = useState<IssueStatus>("open");
  const [query, setQuery] = useState("");
  const [resolving, setResolving] = useState<Issue | null>(null);
  const [note, setNote] = useState("");
  const filtered = useMemo(() => issues.filter((issue) => {
    const matchesStatus = issue.status === status;
    const haystack = `${issue.sourceName} ${issue.ruleName} ${issue.message} ${issue.column} ${issue.observedValue ?? ""}`.toLowerCase();
    return matchesStatus && haystack.includes(query.toLowerCase());
  }), [issues, query, status]);

  useEffect(() => {
    if (!resolving) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setResolving(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    document.getElementById("resolve-dialog-close")?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      previousFocus?.focus();
    };
  }, [resolving]);

  return (
    <section className="panel issue-desk">
      <div className="desk-toolbar">
        <div className="segmented" aria-label="Issue status filter">
          {(["open", "resolved"] as const).map((value) => <button type="button" key={value} className={status === value ? "active" : ""} onClick={() => setStatus(value)}>{value === "open" ? "Open" : "Resolved"} <span>{issues.filter((issue) => issue.status === value).length}</span></button>)}
        </div>
        <label className="search-field"><Search aria-hidden="true" /><span className="visually-hidden">Search issues</span><input name="issue-search" autoComplete="off" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search source, rule, or value…" /></label>
      </div>
      {filtered.length === 0 ? (
        <EmptyState title={query ? "No matching issues" : `No ${status} issues`} description={query ? "Try a different search term or status." : status === "open" ? "Run checks or enjoy the quiet." : "Resolved issues will remain here as an audit trail."} />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Severity</th><th scope="col">Issue</th><th scope="col">Source / record</th><th scope="col">Observed</th><th scope="col">Last seen</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>{filtered.map((issue) => (
              <tr key={issue.id}>
                <td><span className={`severity-label severity-label--${issue.severity}`}><i />{issue.severity}</span></td>
                <td><strong>{issue.message}</strong><small>{issue.ruleName}</small></td>
                <td><strong>{issue.sourceName}</strong><small>{issue.column}{issue.rowNumber ? ` · row ${issue.rowNumber}` : " · multiple rows"}</small></td>
                <td><code>{issue.observedValue || "empty"}</code></td>
                <td>{formatDate(issue.lastSeenAt)}</td>
                <td>{status === "open" ? <button className="resolve-button" type="button" onClick={() => setResolving(issue)} disabled={busy}><Check aria-hidden="true" /> Resolve</button> : <button className="text-button" type="button" onClick={() => onUpdate(issue, "open")} disabled={busy}>Reopen</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {resolving && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setResolving(null); }}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="resolve-title" aria-describedby="resolve-description">
            <button id="resolve-dialog-close" className="icon-button dialog__close" type="button" onClick={() => setResolving(null)} aria-label="Close"><X aria-hidden="true" /></button>
            <span className="dialog__icon"><CheckCircle2 aria-hidden="true" /></span>
            <p className="section-label">Resolution note</p><h2 id="resolve-title">Close this issue?</h2>
            <p id="resolve-description">{resolving.message} in <strong>{resolving.sourceName}</strong>. If the same problem appears in a later run, DataLint will reopen it.</p>
            <label className="field" htmlFor="resolution-note"><span>What changed? <small>Optional</small></span><textarea id="resolution-note" name="resolution-note" autoComplete="off" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="e.g. Corrected the invoice in the source system…" /></label>
            <div className="button-row"><button className="secondary-button" type="button" onClick={() => setResolving(null)}>Cancel</button><button className="primary-button" type="button" disabled={busy} onClick={() => { onUpdate(resolving, "resolved", note); setResolving(null); setNote(""); }}><Check aria-hidden="true" /> Mark resolved</button></div>
          </div>
        </div>
      )}
    </section>
  );
}

function RunHistory({ runs }: { runs: CheckRun[] }) {
  if (runs.length === 0) return <section className="panel"><EmptyState title="No run history" description="Each completed check records its score, row count, and issue count here." /></section>;
  return (
    <section className="panel history-panel">
      <div className="panel__header"><div><p className="section-label">Audit trail</p><h2>Completed checks</h2></div><span className="count-badge">{runs.length}</span></div>
      <div className="table-wrap"><table><thead><tr><th scope="col">Source</th><th scope="col">Completed</th><th scope="col">Rows scanned</th><th scope="col">Checks evaluated</th><th scope="col">Issues found</th><th scope="col">Score</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td><strong>{run.sourceName}</strong></td><td>{formatDate(run.finishedAt)}</td><td>{run.rowsScanned}</td><td>{run.checksEvaluated}</td><td>{run.issuesFound}</td><td><span className={`score-chip ${run.score >= 90 ? "score-chip--good" : run.score >= 70 ? "score-chip--watch" : "score-chip--risk"}`}>{run.score}</span></td></tr>)}</tbody></table></div>
    </section>
  );
}
