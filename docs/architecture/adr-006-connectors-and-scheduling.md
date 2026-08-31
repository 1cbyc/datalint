# ADR-006: Refresh snapshots before scheduled checks

## Status

Accepted

## Decision

Treat every CSV replacement or remote fetch as a source snapshot. Scheduled work claims due remote sources, advances their next-run time, refreshes the snapshot, and runs enabled rules only after a successful refresh.

```mermaid
sequenceDiagram
  participant Timer as Scheduler
  participant Source as Remote source
  participant Store as PostgreSQL store
  participant Engine as Rule engine
  participant Hook as Optional webhook

  Timer->>Store: Claim due sources
  Timer->>Source: Fetch current records
  Source-->>Timer: CSV or JSON snapshot
  Timer->>Store: Save snapshot and sync result
  Timer->>Engine: Run enabled rules
  Engine->>Store: Upsert findings and issue events
  Timer->>Hook: Send unalerted open or reopen events
  Timer->>Store: Mark delivered events
```

The database is the coordination point. Advancing `next_run_at` during the claim prevents two scheduler processes from intentionally selecting the same work. Alert delivery uses issue-event rows as its deduplication ledger, so recurring checks do not repeatedly alert for an issue that remained open.

CSV sources remain manual because a browser-uploaded file has no refreshable remote location. Direct database connectors are outside this decision because they require encrypted credentials and stricter network isolation.
