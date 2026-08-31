import type { IssueEventId } from "../shared/domain.js";
import type { DataLintStore } from "./store.js";

export async function deliverPendingAlerts(store: DataLintStore, webhookUrl?: string): Promise<void> {
  if (!webhookUrl) return;
  const pending = await store.pendingAlerts();
  const delivered: IssueEventId[] = [];
  for (const alert of pending) {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "datalint.issue.detected",
        issue: {
          id: alert.issue.id,
          source: alert.issue.sourceName,
          rule: alert.issue.ruleName,
          severity: alert.issue.severity,
          message: alert.issue.message,
          column: alert.issue.column,
          rowNumber: alert.issue.rowNumber,
          observedValue: alert.issue.observedValue,
          firstSeenAt: alert.issue.firstSeenAt,
          lastSeenAt: alert.issue.lastSeenAt,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Alert webhook returned HTTP ${response.status}`);
    delivered.push(alert.eventId);
  }
  await store.markAlerted(delivered);
}

export async function runScheduledCycle(store: DataLintStore, webhookUrl?: string): Promise<void> {
  const sourceIds = await store.claimDueSources();
  for (const sourceId of sourceIds) {
    try {
      await store.refreshRemoteSource(sourceId);
      const enabledRules = (await store.listRules(sourceId)).filter((rule) => rule.enabled);
      if (enabledRules.length) await store.runChecks(sourceId);
    } catch (error) {
      process.stderr.write(`Scheduled check failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    }
  }
  try {
    await deliverPendingAlerts(store, webhookUrl);
  } catch (error) {
    process.stderr.write(`Alert delivery failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  }
}

export function startScheduler(store: DataLintStore, webhookUrl?: string, intervalMs = 60_000): () => void {
  const timer = setInterval(() => void runScheduledCycle(store, webhookUrl), intervalMs);
  timer.unref();
  void runScheduledCycle(store, webhookUrl);
  return () => clearInterval(timer);
}
