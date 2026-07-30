# Ops Harness — `credential_*` Redaction False-Positive Cleanup (Plan)

> **DOC / PLANNING — NO CODE.** No deploy · no DB mutation · no secrets · no mainnet/real funds. Overnight draft,
> **uncommitted**, for Codex review. **Do NOT implement unless separately approved.**

## Scope (planning only — explicit)
- **Planning only.** No deploy. No linked apply. No DB mutation. No Railway/Doppler change. No secrets. No mainnet / no real funds. **Real funds remain NO-GO.**
## 1. The issue (observed 2026-07-09, live harness run)
The secret-**name** scan/redaction over-matches the substring **`credential`**, flagging the **non-secret** status
fields **`credential_status`** and **`credential_ok`** (returned by `operator_status()` per bot). In the live run the
runtime check reported `secret_named_keys=10` (5 bots × 2 fields) — **verified benign**; `operator_status` carries no
secret. Same over-broad pattern lives in the harness `generateEvidence` redaction (`frontend/src/lib/harness.ts`,
`SECRET_KEY_RE`).

## 2. Impact (why it's non-blocking)
- **No security risk:** it *over*-redacts / over-flags non-secret fields — it never *under*-redacts a real secret.
- **Cosmetic/UX:** evidence output would show `credential_status`/`credential_ok` as `<REDACTED>` (losing harmless
  status context), and readiness scans report false "secret-named keys". No leak, no functional break.

## 3. Root cause
The pattern uses broad substrings (`credential`, `token`, `secret`, …) that match legitimate field names containing
those substrings. `credential` matches `credential_status`/`credential_ok`; similarly `token`/`secret` could match a
benign field name in future payloads.

## 4. Options
**A — Exact-key allow/deny list (RECOMMENDED).** Redact only keys that are *actually* secret-bearing (exact names):
`webhook_secret_hash`, `authorization`, `x-admin-rotate-secret`, `pepper`, `password`, `service_role`, `api_key`/
`apikey`/`secret_key`, `vault_secret_id`(value), `dsn`, `access_token`/`refresh_token`. Match **exact key names** (or
anchored patterns), not loose substrings — so `credential_status`/`credential_ok` are **not** matched.
**B — Add explicit non-secret exceptions.** Keep the broad pattern but exempt a known allowlist
(`credential_status`, `credential_ok`, …). *Cons:* fragile; the broad pattern will keep catching new benign names.
**C — Value-aware (out of scope).** Detect secret *values* — not feasible/reliable; explicitly NOT pursued (matches the
A3 "named-field redaction, not arbitrary secret detection" stance).

## 5. Recommended change (design) — exact-key matching
- Adopt **Option A**: replace the loose `SECRET_KEY_RE` with an **exact-key** matcher (anchored, case-insensitive; match
  the whole key name, not a substring) in **both** places:
  1. `frontend/src/lib/harness.ts` — `generateEvidence` redaction.
  2. the runtime/readiness secret-name check (the jq in the live runbook / any harness preflight check) — align to the
     same exact key set.
- **Exact redact-list (redact the VALUE of a key whose name equals — case-insensitive — one of):**
  `token`, `access_token`, `refresh_token`, `secret`, `secret_key`, `secretkey`, `password`, `authorization`,
  `apikey`, `api_key`, `webhook_secret_hash`, `x-admin-rotate-secret`, `pepper`, `service_role`, `dsn`, `vault_secret_id`.
- **Explicitly NOT redacted (non-secret status fields — must remain visible):** **`credential_ok`**, **`credential_status`**
  (and any other `credential_*` status field). The word "credential" is NOT in the redact-list; only exact secret keys.
- Keep the redaction **name-based** (no value detection — matches the A3 stance); just make the name set precise.

## 6. Tests
- **NON-secret stays visible:** assert `credential_status` and `credential_ok` are **NOT** redacted (their real values
  preserved), structure intact.
- **Real secret keys STILL redacted → `<REDACTED>`** (one assertion each): `token`, `secret`, `password`,
  `authorization`, `apiKey`, `secretKey`, `webhook_secret_hash`, `x-admin-rotate-secret`, `pepper` (+ the rest of the
  §5 list). No raw value survives.
- **Regression:** an `operator_status`-shaped object (with `credential_status`/`credential_ok`) → **0** false-positive
  redactions.
- **Scope guard:** **no behavior change outside the evidence/redaction path** — `buildPreflight`/`verifyAgainst`/
  `verifyDisarmed`/`captureBaseline`/`generateRestoreDraft` outputs unchanged; the existing 28 harness tests still pass.

## 7. Rollout
- Frontend-only, read-only, no mutation. Design → Codex CP → implement → `npm run typecheck && npm test` → (behind the
  existing default-OFF harness flag; no new deploy required beyond the normal frontend redeploy). Update the live
  runbook's jq to the exact key set. **No linked apply, no DB change.**

## 8. Priority
**Safe quick win — but still Codex-reviewed.** Small, frontend-only, read-only, no behavior change outside redaction;
a good early confidence-builder alongside A2. **Still: do not implement unless separately approved** (design → Codex CP →
implement → `typecheck && test`). Real funds unaffected / NO-GO regardless.
