# TradingView Readiness — PREPARED, NOT LIVE

**Status:** DOCUMENTATION ONLY — **prepared, not live**. **No live TradingView alert · no valid executable signal ·
no queue arm · no fire · no mainnet · no real funds.** · **Date:** 2026-07-01 · **Owner:** Praxis · **Gate:** A5.
Grounded in the actual Edge function `supabase/functions/webhook/index.ts` (WB5, ratified 2026-06-04).

> Current standing (unchanged): `QUEUE_ENABLED=false` · all 5 bots `trading_enabled=false` · testnet only ·
> nothing armed/fired. This packet documents readiness; it does **not** activate anything.

---

## 1. Exact webhook URL format
```
POST https://<PROJECT-REF>.supabase.co/functions/v1/webhook/{bot_id}/{token}
```
- `{bot_id}` — the bot UUID (must match `^[0-9a-f]{8}-…-[0-9a-f]{12}$`; else `bad_request` → 200).
- `{token}` — the **per-bot webhook token** (raw, in the URL path segment; never the hash).
- Method **must be POST** (any other method → uniform 200, no side effect).
- Path parser accepts both `/webhook/{id}/{token}` and `/functions/v1/webhook/{id}/{token}`.

## 2. Exact payload contract (JSON body)
| Field | Required | Type | Role |
|-------|----------|------|------|
| `signal_id` | **yes** | non-empty string | Source-supplied C-bar composite (`ticker\|interval\|time\|action`). **Reject-if-absent — no UUID fallback.** Dedup key with `bot_id`. |
| `action` | **yes** | `"buy"` \| `"sell"` | Becomes `side`. Any other value → `invalid_action` → 200. |
| `fire_time` | no | any | **Advisory only** — dedup discriminator; **never executed, never enqueued**. |
| `close` | no | any | Advisory only (dedup discriminator). |
| `volume` | no | any | Advisory only (dedup discriminator). |

- **Dedup:** `webhook_logs` upsert `ON CONFLICT (bot_id, signal_id) DO NOTHING`. A duplicate → `audit_logs`
  `webhook_dedup_skip` (with the full fire_time/close/volume discriminator + `distinct` flag) → 200, **no enqueue**.
- **Enqueued wire (fresh signal only)** → pgmq `trade_signals`, WB1 v1.0 shape **exactly**:
  `{ "schema_version": "1.0", "bot_id": <uuid>, "signal_id": <string>, "side": "buy"|"sell" }`.
  Symbol/quantity/exchange/environment/sizing/risk are **never** on the wire — resolved server-side by the worker.

## 3. Auth (token custody at the wire)
- `key = base64url_decode(WEBHOOK_SECRET_PEPPER)` (raw bytes, **Edge-only** secret).
- `msg = UTF-8(token)` (the raw `{token}` path segment, not decoded).
- `hash = "v1:" + lowercase_hex( HMAC-SHA256(key, msg) )` → compared **constant-time** to `bots.webhook_secret_hash`.
- Stored hash shape strictly `^v1:[0-9a-f]{64}$` (Fix 3); malformed → `webhook_config_error` → 503 (never "bad token").
- Missing/empty pepper → `webhook_config_error` → 503 (Fix 1) — must **not** look like a bad token.

## 4. Response policy (no structure leak)
- **200 `{ok:true}`** for **every** authenticated/business outcome — including `invalid_secret`, `bot_not_found`,
  `bot_not_active`, `invalid_payload`, `missing_signal_id`, `invalid_action`, `dedup_skip`, `accepted`,
  `queue_failed`. Attackers cannot distinguish reject vs accept.
- **503 `{ok:false}`** ONLY for genuine infra failure **before** the `webhook_logs` insert (missing pepper, bot-lookup
  DB error, auth config/infra error, `webhook_logs` insert error) — so a TradingView retry recovers a transient blip;
  a retry after the row exists correctly dedups.

## 5. Token custody rules (BINDING)
- Raw token exists **only**: (a) in the TradingView alert URL (server-side at TradingView), and (b) in **Doppler**
  (`PRAXIS_CAMPAIGN_*_WEBHOOK_TOKEN` / `PRAXIS_WB5_TEST_BOT_WEBHOOK_TOKEN`) as source-of-record.
- DB stores **only** the HMAC-pepper hash (`bots.webhook_secret_hash`, `v1:<64 hex>`) — **never** the raw token.
- Pepper (`WEBHOOK_SECRET_PEPPER`) is **Edge-only** (Supabase Edge secret), base64url — never in DB, never in the
  worker, never in the browser, never in any client/UI.
- **StrateTeach must NEVER hold webhook tokens** in browser/client code — **server-side only, scoped per bot,
  rotatable, audited, never exposed to users/UI** (owner-split, Codex P1). No token in any front-end bundle.
- Code invariant: **never log** the token, the full URL, the pepper, or the stored hash.

## 6. Token rotation owner
- **Owner: Operator** (owns all secrets — Doppler + Edge). No agent handling of raw token/pepper values.
- **Per-bot token rotation:** operator generates a new token → recompute `v1:` hash (HMAC-pepper) → `UPDATE
  bots.webhook_secret_hash` (privileged) → update Doppler entry → update the TradingView alert URL. Old token invalid
  immediately (constant-time verify fails). Raw read-back the updated hash shape.
- **Pepper rotation (nuclear):** rotate `WEBHOOK_SECRET_PEPPER` → `supabase functions deploy webhook` → **re-hash
  every bot token** with the new pepper. Invalidates all existing tokens until re-hashed.

## 7. Safe negative tests (CANNOT enqueue / order)
All produce a **uniform 200** and must leave `queue_length=0`, no new `webhook_logs.status='accepted'`, no trade, no order.
| # | Test | Input | Expected | Why it cannot enqueue |
|---|------|-------|----------|-----------------------|
| N1 | **Wrong token reject** | valid `bot_id`, **bogus** token, any body | `invalid_secret` → 200 | rejects at auth (step 3), **before** any DB row / enqueue. **Zero-secret test** (no real token needed). |
| N2 | **Invalid payload reject** | valid token, malformed JSON | `invalid_payload` → 200 | rejects at body parse (step 5), before `webhook_logs`/enqueue. |
| N3 | **Missing signal_id** | valid token, body without `signal_id` | `missing_signal_id` → 200 | reject-if-absent (step 6), before enqueue. |
| N4 | **Invalid action** | valid token, `action` ∉ {buy,sell} | `invalid_action` → 200 | reject (step 6), before enqueue. |
| N5 | **Bot not active** | valid token, bot `status≠active` | `bot_not_active` → 200 | active gate (step 4), before enqueue. |
| N6 | **No enqueue / no trade / no order** | after N1–N5 | `queue_length=0`, 0 accepted logs, 0 trades, 0 orders | verification, read-only. |

- **N1 is the only zero-secret test** and is the safest to run first (no valid token exposure).
- N2–N5 need a **valid token** → **operator-run** (secret custody). Even valid-token tests here reject **before**
  `webhook_logs`/enqueue, so nothing is queued.
- **FORBIDDEN in this packet:** a valid token **+** valid payload **+** active bot (that combination enqueues) — that is
  a live signal, out of scope. No positive/live fire here.

## 8. STOP conditions (abort + report, do not proceed)
- Any `webhook_logs.status='accepted'` row, any enqueue (`queue_length>0`), any trade/order created during negative tests.
- Any 503 during a wrong-token test (would indicate a config fault — investigate pepper/hash, do not "fix by arming").
- Any token / pepper / full-URL / stored-hash value appearing in logs.
- `worker_state ≠ disabled` or `QUEUE_ENABLED=true` observed.
- Any bot `trading_enabled=true` observed.
- A5 hardening incomplete (see §9) at the moment of any live consideration.

## 9. Tomorrow activation gates (prepared → live)
Live TradingView (even testnet) requires **all** of:
1. **A5 hardening complete** — rate-limiting / abuse controls, **source IP allowlist (MANDATORY before live execution / real funds; optional for internal-beta / prepared-not-live)**, replay/freshness window, response-policy audit, log-redaction audit, no structure leak.
2. **Token custody verified across ALL surfaces** (not just tracked source) — deployed frontend env, built bundle, StrateTeach client/repo, Edge/platform logs; server-side only; per-bot; rotatable; audited.
3. **Negative tests N1–N6 pass** (wrong token / invalid payload → no enqueue).
4. **Controlled positive test = TESTNET only**, one bot, one signal, immediate disarm — mirrors the S5 smoke and
   **requires the S5 arm gate + Oren approval** (migration/config + explicit approval). `QUEUE_ENABLED` flips to true
   **only** inside that approved window, then back to false.
5. **NO mainnet, NO real funds** — A11 not granted; A1/A2/A4/A8/A10 open. Live-real-funds TradingView stays blocked.

## 10. Rollback / disable steps
- **Disable one bot's intake (fastest):** set `bots.status ≠ 'active'` → webhook returns `bot_not_active` → no enqueue.
- **Invalidate a token:** rotate per §6 (old token fails constant-time verify immediately).
- **Stop processing (kill switch):** `QUEUE_ENABLED=false` → worker stops consuming (webhook may still enqueue; combine
  with bot-status disable to also stop enqueue).
- **Full disable:** disable/undeploy the `webhook` Edge function, or set all bots `status≠active`.
- **Nuclear:** rotate the pepper + `functions deploy webhook` → every existing token invalid until re-hashed.
- Every rollback verified by **raw read-back** (bot status / hash / `queue_length` / `worker_status`).

## 11. A5 hardening checklist (prepared — NOT live)
| # | Control | State today | Required for |
|---|---------|-------------|--------------|
| H1 | Rate limit / abuse control on the webhook endpoint | ❌ none | live |
| H2 | **Source IP allowlist** (TradingView published egress IPs) | ❌ none — **optional for internal-beta / prepared-not-live; MANDATORY before live execution / real funds** | live |
| H3 | Replay / freshness window (bound signal age) | partial — dedup only (`UNIQUE(bot_id,signal_id)`); no freshness bound | live |
| H4 | Log-redaction audit (Edge + worker never log token / pepper / full-URL / stored-hash) | code invariant present; **audit pending** | live |
| H5 | Negative tests **N1–N6** (wrong token / invalid payload → no enqueue / no trade / no order) | documented (§7), **not run** | live |
| H6 | Controlled **TESTNET** positive test | **blocked** — only after S5 arm gate + Oren approval | live (testnet) |

## 12. Token-custody scan status (2026-07-01)
**Wording (binding):** *Token custody is verified clean in tracked Praxis frontend source. Runtime/deploy/StrateTeach custody still require separate checks.*
- ✅ **CLOSED — Praxis tracked frontend source only:** git-grep of tracked `frontend/` + repo — no webhook token / pepper / service_role value / DB secret / hardcoded key / valid webhook URL+token; client reads only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (anon/publishable). (One `service_role` hit = a warning comment; one repo hit = a fake worker redaction-test fixture.)
- ⏳ **NOT yet closed** (separate checks required, A5 stays open):
  - deployed **frontend env** (Railway service vars — confirm ONLY the two `VITE_` keys)
  - **built bundle** (`dist/` after `npm run build` — scan output for any leaked secret)
  - **StrateTeach** client/repo (no webhook token in their browser/client)
  - **Edge / platform log** audit (no token / full-URL exposure)

---

## What this packet does NOT do
No live TradingView alert · no valid executable signal · no queue arm · no fire · no mainnet · no real funds ·
no DB mutation · no Railway/worker change · no token/pepper handling by the agent. Prepared only; activation is
gated per §9. A5 remains **open**; execution remains **disarmed**.
