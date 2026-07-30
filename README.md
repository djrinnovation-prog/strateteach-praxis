# Praxis

Crypto algo-trading automation platform for the Israeli market.

## Status

Sprint 1 — Infrastructure

- [x] Database schema designed and peer reviewed
- [ ] Supabase project created
- [ ] Migrations executed
- [ ] Smoke test passed
- [ ] Worker scaffold

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite |
| Worker | Node.js + TypeScript |
| Database | Supabase (Postgres + Auth + Vault) |
| Queue | pgmq |
| Hosting | Railway |
| Secrets | Doppler |
| Exchange | ccxt |
| Error tracking | Sentry |

## Repository Structure

```
supabase/migrations/   ← Database migrations (CLI-managed)
worker/                ← Trade execution worker
frontend/              ← React frontend
```

## Setup

See Notion workspace for full setup guide and architecture documentation.

Secrets are managed via Doppler. No `.env` files are used in this repository.
