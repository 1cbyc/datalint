# ADR-005: Keep data access behind the API

## Status

Accepted

## Decision

The browser never connects to PostgreSQL or fetches remote sources directly. It sends source, rule, and issue changes to the API, which validates each request before calling the store.

```mermaid
flowchart LR
  operator[Operator] --> client[React client]
  client -->|Bearer token, JSON, CSV| api[Express API]
  api --> validation[Request validation]
  validation --> engine[Rule engine]
  validation --> store[PostgreSQL store]
  validation --> connector[Restricted HTTPS connector]
  engine --> store
  store --> database[(PostgreSQL)]
```

CSV content is treated as data and is never evaluated as code. Imported rows remain sensitive business data. Pattern rules execute as JavaScript regular expressions and therefore belong to trusted workspace configuration.

Remote connectors accept HTTPS URLs without embedded credentials. They reject local and private-network destinations, limit redirects, response size, and request time, and normalize fetched values before storage.
