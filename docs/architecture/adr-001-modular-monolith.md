# ADR-001: Use a modular monolith

## Status

Accepted

## Context

CSV imports, rule execution, and issue updates share one transaction boundary. Splitting them into services would add queues and distributed failure handling without improving the current workload.

## Decision

Keep the API, rule engine, and persistence code in one Node.js application. Module boundaries remain explicit so check execution can be separated later if workload measurements justify it.

## Consequences

The application is simple to run and reason about. Long-running checks would compete with HTTP traffic, so uploads are bounded and checks remain synchronous.
