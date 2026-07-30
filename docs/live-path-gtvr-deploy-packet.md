# LIVE-PATH — G-TVR deploy packet

**Function:** `rotate-bot-webhook-token` (owner-gated webhook token rotation). **Committed:** `7bad8a3`.
**Status:** ready to deploy. **Deploy is an approval boundary (Oren).** No secrets printed here.

## Why deploy is the first live-path step
The 4C live-fixture validation is blocked because no plaintext webhook token exists (only the hash is
stored; non-recoverable). G-TVR lets the bot **owner** rotate to a fresh token via the app. Deploying it
unblocks: UI token flow → obtain a fresh token → fire the 4C fixture → validate `queued` → enable sweeper.

## Preconditions (all ✅ verified locally)
- Code committed (`7bad8a3`): `rotate.ts`, `index.ts`, `rotate.test.ts`.
- Tests: 11 `node:test` pass; `deno check` clean.
- `supabase/config.toml` → `[functions.rotate-bot-webhook-token] verify_jwt = false` (already pushed in `a3636ab`).
- **Required Edge secrets — all already present in the project (no new secrets to set):**
  - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — auto-injected into every Edge function.
  - `WEBHOOK_SECRET_PEPPER` — already set (the deployed `webhook` + `admin-rotate-webhook-token` use it).

## Deploy command (Oren runs — approval boundary)
```
supabase functions deploy rotate-bot-webhook-token
```
(CLI reads `config.toml`, so `verify_jwt=false` is applied. Project ref comes from the linked project /
Doppler — not committed.)

## Post-deploy smoke test — NON-MUTATING (no token is rotated, no secrets shown)
Deliberately stops short of a real rotation (a real 200 mutates a bot's `webhook_secret_hash` = a separate
token-action approval). These prove "live + auth-gated" without touching any bot:

1. **OPTIONS preflight** → `204` + `Access-Control-Allow-Origin: *` (no auth needed).
2. **POST with no `Authorization`** → `401 unauthenticated` (no DB touch).
3. *(optional, needs a real user JWT — an Oren login)* **POST + valid JWT + `bot_id:"not-a-uuid"`** → `400 invalid_bot_id` (validation before any read/write).
4. *(optional, needs JWT)* **POST + valid JWT + well-formed but non-owned `bot_id` + valid-shape token** → `403 forbidden` (owner-scoped read returns null; **no CAS/write** runs).

**Do NOT** run a real (owned bot + real token) rotation as part of deploy verification — that is the next,
separate approval (a token action).

## Rollback
Edge functions are versioned. To revert: redeploy the prior version, or
`supabase functions delete rotate-bot-webhook-token` (the committed config entry then becomes an inert
orphan again — harmless). No schema/data change to undo.

## Risk
Low. New, self-contained, owner-gated function; no migration, no data change; does not alter the existing
`webhook` / `admin-rotate` functions. `verify_jwt=false` is intentional (auth enforced in-function so the
browser CORS preflight isn't blocked).
