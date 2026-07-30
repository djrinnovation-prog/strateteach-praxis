# strateteach-praxis — the unified trading product

This repo is the **single home of the unified product**. It keeps Praxis's full git history, CI, and the
independently-audited engine branch, and adds StrateTeach (the brain + UI) under `strateteach/`.

## The golden rule
> Anything that touches **money or an exchange key → Praxis.** Anything **strategy / brain / UI → StrateTeach.**

- **Praxis** (repo root: `worker/`, `supabase/`, `frontend/`) = the ONLY component that holds exchange
  keys or places orders. Signed webhook ingress, Vault-isolated per-(user,bot) credentials, the
  multi-exchange execution engine (EP0–EP7), risk caps, reconciliation, kill, flatten, operator status.
- **StrateTeach** (`strateteach/`) = the brain + product: strategy scanners, signals, backtest, users,
  billing, notifications, education, and the dashboard UI. **It holds NO exchange keys and places NO
  orders** (its own trading engine is being retired — see "Cutover").

## How they connect
1. **Signals:** StrateTeach's strategy → a SIGNED intent (buy/sell) → Praxis's webhook
   (`supabase/functions/webhook`, HMAC body-signing) → Praxis executes. Contract:
   `docs/phase2b-m0-signed-signal-contract.md`. Relay: `strateteach/.../services/praxis_relay.py`.
2. **Keys & bots go STRAIGHT to Praxis** (no key ever transits StrateTeach): the browser posts to the
   Praxis Edge functions `create-bot` + `connect-credential`, authenticated by a signed, single-use,
   action-bound provisioning TICKET that StrateTeach mints (`strateteach/.../services/praxis_tickets.py`;
   Praxis side: `supabase/functions/{create-bot,connect-credential,_shared/provision-ticket.ts}`).

## Status (2026-07-30)
- Praxis engine (EP0–EP7 + futures cage) and the unification endpoints are **independently audited**
  (4 adversarial audits; no BLOCKER/HIGH; findings fixed). See the memory / commit log.
- The StrateTeach `strateteach/` app is the 2026-07-19 baseline **plus** the integration patches
  (`praxis_relay.py`, `praxis_tickets.py`, and the one `place_order` shadow hook).
- **Cutover (remaining):** StrateTeach's own trading engine (`services/exchange.py` place_order/close/
  withdraw, `autopilot_live.py`, `live_reconcile.py`, Fernet key stores, its own webhook) is to be
  **archived then deleted** (`docs/phase2b-m3-strateteach-cutover.md`), so only Praxis touches money.

## Local run
- Praxis: `supabase start` + `supabase db reset` (migrations 001..039) + the worker (`cd worker && npm run dev`,
  `PRAXIS_IS_PRODUCTION=false`) + `supabase functions serve`.
- StrateTeach: `cd strateteach && docker compose up` (needs a local `.env` — see `.env.example`; a
  `docker-compose.override.yml` wires `PRAXIS_WEBHOOK_BASE=http://host.docker.internal:54321`).
- Heavy marketing media (a home-reel mp4 + large HTML tours) are gitignored — restore via CDN/git-lfs
  for a production build.

## Real funds: NO-GO
Everything is dormant/flag-gated. Real money is gated behind: the deferred execution slices
(protective/futures wiring), per-venue testnet validation, the go-live blockers (A1/A4/A11), the
comprehensive testnet e2e (`docs/phase2ab-go-live-operator-runbook.md`), and — only then — a tiny-live
pilot, followed by external penetration testing.
