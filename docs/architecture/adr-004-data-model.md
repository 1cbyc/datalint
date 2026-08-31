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
  RULES ||--o{ ISSUES : detects
  CHECK_RUNS ||--o{ ISSUES : observes

  DATA_SOURCES {
    uuid id PK
    text name
    jsonb columns_json
    jsonb rows_json
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
```

```mermaid
stateDiagram-v2
  [*] --> Open: detected
  Open --> Resolved: resolved by operator
  Resolved --> Open: detected again
```

The application does not automatically resolve a finding that disappears from a later run, because a missing row may represent an incomplete input rather than a correction.
