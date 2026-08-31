# Contributing

Please search existing issues before opening a new one. For a bug, include the smallest synthetic CSV that reproduces it; never attach customer records, credentials, or production exports.

## Setup

```bash
npm install
cp .env.example .env
docker compose up -d postgres
npm run dev
```

Before opening a pull request, run:

```bash
npm run check
npm run test:e2e
```

Keep changes focused. New behavior should include tests, database changes should include a migration, and architecture changes should update the relevant ADR.
