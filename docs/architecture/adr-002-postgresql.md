# ADR-002: Use PostgreSQL

## Status

Accepted

## Context

DataLint needs relational integrity, transactional issue updates, concurrent access, and established backup tooling.

## Decision

Use PostgreSQL as the only application database. Identifiers use UUIDs, timestamps use `TIMESTAMPTZ`, and flexible source snapshots and rule configuration use JSONB. SQL is parameterized and connections use a bounded pool.

## Consequences

PostgreSQL adds a service and credentials to local setup. In return, check runs and their issue upserts can commit atomically, and the application does not depend on a process-local database file.
