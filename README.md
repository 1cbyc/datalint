# DataLint

DataLint finds bad records before they become expensive mistakes. Import a CSV, define the rules that matter to your business, run a check, and work through the resulting issues.

## What it checks

- required values
- duplicate identifiers
- email addresses
- numeric ranges
- allowed values
- regular-expression patterns

Findings are deduplicated across runs. Resolving an issue keeps the history, and a later run reopens it when the same problem returns.

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

The API uses PostgreSQL through `DATABASE_URL`. Set `DATALINT_API_TOKEN` to require a bearer token and `DATALINT_ALLOWED_ORIGINS` to restrict browser origins. The full list of environment variables is in [`.env.example`](.env.example).

Architecture decisions are recorded in [`docs/architecture/adr-000-overview.md`](docs/architecture/adr-000-overview.md).

## Contributing

Bug reports and focused pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.

## License

[MIT](LICENSE)
