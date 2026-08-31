# Security policy

Please report vulnerabilities through GitHub private vulnerability reporting. Do not open a public issue containing exploit details, credentials, customer data, or private endpoints.

Include the affected commit, reproduction steps, and expected impact. Security fixes are applied to the latest version on the default branch.

DataLint supports an optional workspace bearer token; it does not provide user accounts or role-based permissions. Any internet-facing installation should set `DATALINT_API_TOKEN`, restrict `DATALINT_ALLOWED_ORIGINS`, use TLS, and keep PostgreSQL off the public network.
