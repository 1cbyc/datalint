# ADR-004: Store checks as runs and durable issues

## Status

Accepted

## Decision

Keep imported snapshots, rules, check runs, and issues as separate relational records. Runs are immutable. Issues carry the current workflow state and point to the run where they were last observed.

```mermaid
erDiagram
  DATA_SOURCES ||--o{ RULES : defines
  DATA_SOURCES ||--o{ CHECK_RUNS : produces
  DATA_SOURCES ||--o{ ISSUES : owns
  DATA_SOURCES ||--o{ SOURCE_SYNCS : refreshes
  RULES ||--o{ ISSUES : detects
  CHECK_RUNS ||--o{ ISSUES : observes
  ISSUES ||--o{ ISSUE_EVENTS : records

  DATA_SOURCES {
    uuid id PK
    text name
    jsonb columns_json
    jsonb rows_json
    integer schedule_minutes
  }
  RULES {
    uuid id PK
    uuid source_id FK
    text type
    jsonb config_json
  }
  CHECK_RUNS {
    uuid id PK
    uuid source_id FK
    real score
    timestamptz finished_at
  }
  ISSUES {
    uuid id PK
    uuid rule_id FK
    uuid run_id FK
    text fingerprint
    text status
  }
  SOURCE_SYNCS {
    uuid id PK
    uuid source_id FK
    text status
    integer row_count
  }
  ISSUE_EVENTS {
    uuid id PK
    uuid issue_id FK
    text type
    timestamptz alerted_at
  }
```

```mermaid
stateDiagram-v2
  [*] --> Open: detected
  Open --> Resolved: resolved by operator
  Open --> Resolved: absent from latest run
  Resolved --> Open: detected again
```

Only rules that ran successfully may automatically close their existing findings. Every open, reopen, manual resolution, and automatic resolution is stored as an issue event.
