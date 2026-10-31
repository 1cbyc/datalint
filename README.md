> **Licensing update (31 October 2026):** The current policy requires prior written permission for reuse and a separate agreement for AI training. See [LICENSE](LICENSE). Earlier grants remain valid for previously licensed material; [LICENSE.previous](LICENSE.previous) preserves those terms. Any older license descriptions below describe the previous policy. Contact [ei@nsisong.com](mailto:ei@nsisong.com).

# DataLint

DataLint finds bad records before they become expensive mistakes. Import a CSV or connect a public data source, define the rules that matter to your business, and work through the resulting issues.

## Sources and workflows

- CSV import and replacement snapshots
- public Google Sheets
- public JSON APIs with an optional record path
- manual, hourly, six-hourly, daily, or weekly checks
- issue history, automatic closure, CSV reports, and deduplicated webhook alerts

## What it checks

- required values
- duplicate identifiers
- email addresses
- numeric ranges
- allowed values
- regular-expression patterns
- numeric outliers
- unexpected row-count changes

Findings are deduplicated across runs. A repaired finding closes automatically; resolving one manually keeps the history, and a later run reopens it when the same problem returns.

## Run it locally

DataLint requires Docker and Docker Compose.

```bash
git clone https://github.com/1cbyc/datalint.git
cd datalint
cp .env.example .env
docker compose up --build
```

Open [http://localhost:4100](http://localhost:4100). To explore the workflow, import [`examples/invoices-with-issues.csv`](examples/invoices-with-issues.csv) and add rules for its `invoice_id`, `customer_email`, `amount`, and `status` columns.

## Development

Node.js 22 or newer and npm are required.

```bash
npm install
cp .env.example .env
docker compose up -d postgres
npm run dev
```

The web interface runs at [http://localhost:5173](http://localhost:5173), with the API on port `4100`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API and web interface with reload enabled |
| `npm run check` | Run linting, type checks, tests, and production builds |
| `npm run test:e2e` | Run browser workflow and responsive-layout tests |
| `npm run build` | Build the server and web interface |
| `npm start` | Start the production build |

The API uses PostgreSQL through `DATABASE_URL`. Set `DATALINT_API_TOKEN` to require a bearer token, `DATALINT_ALLOWED_ORIGINS` to restrict browser origins, and `DATALINT_ALERT_WEBHOOK_URL` to receive newly opened or reopened issues. The full list of environment variables is in [`.env.example`](.env.example).

Architecture decisions are recorded in [`docs/architecture/adr-000-overview.md`](docs/architecture/adr-000-overview.md).

## Contributing

Bug reports and focused pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.

## License

[MIT](LICENSE)
