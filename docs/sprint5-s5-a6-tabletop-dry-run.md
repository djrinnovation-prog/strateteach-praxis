# Sprint 5 · A6 — Tabletop Dry-Run (S3 dev privileged-secret exposure)

## Status
- **DRAFT / REVIEW** — docs-only **paper walkthrough**; **no execution** (no code / DB / Doppler /
  Railway / Supabase changes, no secret reads, no rotation actually performed).
- Validates [sprint5-s5-a6-incident-rotation-runbook.md](sprint5-s5-a6-incident-rotation-runbook.md)
  against a realistic incident. Secret **NAMES only — never values**. `QUEUE_ENABLED=false` throughout.

## Scenario
A terminal paste accidentally exposed **Doppler `dev` secret values**, including
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_POSTGRES_PASSWORD`, `WEBHOOK_SECRET_PEPPER`, and a
**Vault-decrypt-capable path** (the exposed `SUPABASE_SERVICE_ROLE_KEY` can call
`get_decrypted_secret`). **No production / mainnet key confirmed exposed.** A whole-config paste is
assumed to have exposed the rest of the `dev` config too (treat the full matrix as affected).

## 1. Severity classification (runbook §1)
- Privileged dev secrets exposed (service_role, DB password, webhook pepper, Vault decrypt path) →
  **S3**. Not S4 (no prod/mainnet key confirmed). **→ Oren is the required approver to resume.**

## 2. Walkthrough (no execution — "what WOULD be done")

**Immediate containment (§2):** disarm is already the resting state — confirm `QUEUE_ENABLED=false`
/ `worker_queue_disabled`; pause any simulator/worker action. Exposure surface = the **terminal
paste / scrollback** (check also git working-tree + logs + clipboard). Record affected secrets by
**name** only; do not paste values. Close the channel (clear the terminal scrollback) before
re-storing any rotated value.

**Secret inventory classification (§3):** affected (rotate) — `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_POSTGRES_PASSWORD`, `WEBHOOK_SECRET_PEPPER` + the per-bot `PRAXIS_*_WEBHOOK_TOKEN`,
`BINANCE_TESTNET_API_KEY/_SECRET`, the **Vault-stored Binance credential** (decrypt path exposed),
`PRAXIS_ALERT_RO`/`PRAXIS_REPORT_RO` DSNs+role pw, `PRAXIS_ALERT_TELEGRAM_BOT_TOKEN`, `GIT_SSH_PASS`.
Not rotated — identifiers (`SUPABASE_URL`, `bot_id`, `VAULT_SECRET_ID`, chat_id, config flags).

**Rotation order (§4):** (1) Doppler access/CLI token + close the paste channel → (2) `service_role`
→ JWT/keys → `SUPABASE_POSTGRES_PASSWORD` → Vault decrypt path → (3) **exchange creds after the
Vault path**: Vault-stored Binance credential + Doppler Binance keys → (4) `WEBHOOK_SECRET_PEPPER` +
bot tokens together → Edge `functions deploy webhook` → re-hash bots → (5) alerting (DSNs/role pw,
Telegram) after DB roles → (6) propagate to provider **then** redeploy/restart → (7) verify per
category before resuming.

**Provider verification plan (§6):** Supabase — service_role non-secret smoke (a row count), DB
`SELECT 1` via re-linked `--linked`, Edge function redeployed (pepper read at module load), legacy
JWT keys disabled if unused. Vault — decrypt → **read-only `fetchBalance`** proves the rotated
credential works. Binance — **testnet** explicit; read-only `fetchBalance` before any order. Telegram
— BotFather revoke → send smoke only after replacement. Railway — Doppler sync → redeploy → confirm
`worker_queue_disabled`.

**Stop conditions checked (§8):** unknown blast radius? **No** (surface identified). Production key?
**No** (dev only). Secret in git? **verify** working-tree + history clean (paste was terminal, not
git). Inability to verify? **No** (non-secret smokes available). Active queue/trade? **No**
(`QUEUE_ENABLED=false`). → **No stop condition triggered; proceed.**

**Resume criteria (§7):** `QUEUE_ENABLED=false` verified · all affected secrets rotated + propagated
· all §6 checks pass · no leaked values remain (scrollback/tmp/chat/logs cleared) · Current
Status/Notion updated · **Oren approves (S3)**.

## 3. Dry-run evidence table
*(PASS/FAIL = is the runbook step actionable + sufficient as written. No action executed.)*

| # | Step | Expected action | Expected non-secret evidence | Tabletop | Notes |
|---|------|-----------------|------------------------------|----------|-------|
| 1 | Disarm | confirm `QUEUE_ENABLED=false` | boot log `worker_queue_disabled`; `queue_length=0` | PASS | resting state |
| 2 | Identify surface | enumerate chat/terminal/git/logs/clipboard | named surface = terminal paste | PASS | |
| 3 | No values in chat | record names/digests/timestamps only | incident record has NAMES only | PASS | |
| 4 | Close channel | clear scrollback before re-store | scrollback cleared | PASS | |
| 5 | Classify → severity | map to §3 matrix → S3 | affected-name list + severity S3 | PASS | Oren required |
| 6 | Rotate Doppler access + channel | revoke/rotate CLI/access token | `doppler --only-names` works w/ new token | PASS | platform-first |
| 7 | service_role | regenerate; propagate; redeploy | non-secret smoke (row count) OK; worker boots | PASS | data-plane root |
| 8 | postgres password | reset; re-link | `SELECT 1` via `--linked` | PASS | |
| 9 | Vault Binance credential + Doppler Binance keys | regenerate keys; `vault.update_secret`; update Doppler | read-only `fetchBalance` OK (testnet) | PASS | exchange-after-Vault |
| 10 | pepper + bot tokens | new pepper → Edge `functions deploy` → re-hash bots | webhook smoke `reason=invalid_payload` (valid token, bad body) | PASS | pepper+tokens together |
| 11 | alerting DSNs + Telegram | `ALTER ROLE` pw; rebuild DSN; BotFather revoke | redacted DSN shape OK; alert send after replace | PASS | after DB roles |
| 12 | Provider verification | run §6 per category | per-category non-secret evidence | PASS | |
| 13 | Stop conditions | check §8 list | none triggered | PASS | |
| 14 | Resume | meet §7 + Oren approve | Oren sign-off; `QUEUE_ENABLED` decision recorded | PASS | S3 → Oren |

## 4. Gaps found
The runbook is sufficient to drive an S3 dev exposure end to end. Two tabletop observations were
**folded into the runbook (this revision)**:
- The **Supabase CLI / access token** (the `supabase link` / `--linked` auth) is now named as a
  platform-access credential to rotate/revoke in runbook **§4** rotation order **and** **§6** Supabase
  verification (when the exposure surface includes local CLI / terminal / credential-store).
- A **git working-tree + recent-history scan** for accidental secret persistence is now an **active
  step in the §2 containment checklist** (NAMES-only; **STOP + git purge first** if any value is found).

With those patches in place: **No remaining runbook-blocking gaps found.**

## 5. Recommendation
The tabletop walkthrough **PASSES** — all 14 steps are actionable with non-secret evidence, no stop
condition is triggered, and the S3 → Oren approval path is correct. **A6 may be marked CLOSED only
if the Codex review agrees this tabletop passed** (and Oren accepts); the two observations
above were folded into the runbook in this revision. No execution was performed.
