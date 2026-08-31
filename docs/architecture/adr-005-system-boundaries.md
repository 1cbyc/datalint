# ADR-005: Keep data access behind the API

## Status

Accepted

## Decision

The browser never connects to PostgreSQL. It uploads CSV files and sends rule or issue changes to the API, which validates each request before calling the store.

```mermaid
flowchart LR
  operator[Operator] --> client[React client]
  client -->|Bearer token, JSON, CSV| api[Express API]
  api --> validation[Request validation]
  validation --> engine[Rule engine]
  validation --> store[PostgreSQL store]
  engine --> store
  store --> database[(PostgreSQL)]
```

CSV content is treated as data and is never evaluated as code. Imported rows remain sensitive business data. Pattern rules execute as JavaScript regular expressions and therefore belong to trusted workspace configuration.
