# ADR-003: Deduplicate findings with stable fingerprints

## Status

Accepted

## Context

Running the same check repeatedly should update an existing issue instead of creating copies. A resolved issue must also reopen when the problem returns.

## Decision

Each finding receives a rule-scoped key. DataLint hashes the rule ID with that key and enforces uniqueness on `(rule_id, fingerprint)`.

- Row rules use the CSV row number.
- Unique rules use the duplicated value.
- Repeated findings update their last-seen time and latest run.
- Repeated resolved findings return to the open state.

## Consequences

CSV row numbers are not durable identifiers. Reordering a file can make the same record appear as a new issue, so any refresh workflow will need an explicit stable-key choice.
