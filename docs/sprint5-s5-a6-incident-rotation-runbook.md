# Sprint 5 · A6 — Incident / Rotation Protocol runbook

## Status
- **DRAFT / REVIEW** — docs-only; **no execution** (no code / DB / Doppler / Railway / Supabase
  changes, no secret reads).
- **Applies to `dev` first, production later** — the dev playbook is proven (2026-06-26 Doppler
  exposure containment); production adds the S4 (live-money) severity + Oren as mandatory approver.
- **`QUEUE_ENABLED=false` during containment** unless Oren explicitly approves otherwise — no
  arming/firing while secrets are being rotated.
- Purpose: turn the 2026-06 Doppler exposure containment into a **reusable defensive protocol** for
  any future secret exposure / credential compromise. This runbook closes (per the production gap
  review, A6) only after **review + a tabletop dry-run** — not on drafting.

## 1. Severity model
| Sev | Definition | Approver to resume |
|-----|------------|--------------------|
| **S0** | False alarm / no value exposed (only a scare, a redacted view, a names-only listing) | Operator |
| **S1** | Non-secret **identifiers** exposed (e.g. `SUPABASE_URL`, `bot_id`, `VAULT_SECRET_ID`, chat_id) | Operator |
| **S2** | An **app secret** exposed in **dev** (e.g. a dev DSN, a dev bot token) | Operator |
| **S3** | A **privileged** secret exposed: `service_role` / Supabase secret key, DB password, the Vault decrypt path, an exchange key, the webhook pepper | **Oren** |
| **S4** | **Production / live-money** exposure (any prod privileged secret, mainnet exchange key, prod DB) | **Oren** (+ post-incident review) |

Pick the **highest** matching severity. When unsure between two, assume the higher.

## 2. Immediate containment checklist (do first, in order)
- [ ] **Disarm:** set `QUEUE_ENABLED=false` (verify `worker_queue_disabled`); **pause** any live
      fire / simulator / worker action. No new execution starts during containment.
- [ ] **Identify the exposure surface:** chat, terminal scrollback, git (history + working tree),
      logs (Railway / CI / app), screenshots, clipboard/paste tools. Note *where* and *what*.
- [ ] **Do NOT paste secret values into chat** (or any shared channel). Preserve evidence by
      **names / digests / timestamps only**.
- [ ] **Close the channel:** clear the affected terminal scrollback / purge the log / delete the
      screenshot before re-storing any rotated secret in the same place.
- [ ] **Scan git for accidental secret persistence:** review the **working tree AND recent history**
      for the affected secret **NAMES** (e.g. `git grep` / `git log -p` read for the env-var names —
      never echo a value). **If any secret VALUE is found in git → STOP; a git purge is the FIRST
      priority** (before further rotation — git history persists and propagates).
- [ ] **Classify affected secrets** against the §3 matrix → assign severity (§1).
- [ ] If **S3/S4**: notify Oren before proceeding past containment.

## 3. Secret inventory matrix
*(Values never recorded here — identifiers only. "Blast radius" = what the holder can do.)*

| Secret / identifier | Blast radius | Rotate? | Rotation owner | Verification evidence | Prod blocker? |
|---|---|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` (or `sb_secret_…`) | Full DB read/write, bypass RLS | **Yes** | Operator (Supabase) | service_role smoke returns a non-secret result; worker boot clean | **Yes** |
| `SUPABASE_POSTGRES_PASSWORD` | Postgres superuser | **Yes** | Operator (Supabase) | `supabase link` + `SELECT 1` via `--linked` | **Yes** |
| `PRAXIS_ALERT_RO` / `PRAXIS_REPORT_RO` role pw + DSNs | Read-only scoped DB (alerting/reporter) | **Yes** | Operator (DB `ALTER ROLE`) | masked DSN shape OK; `alert:dry-run` / `sprint4:evidence` connect | No (dev); review for prod |
| `WEBHOOK_SECRET_PEPPER` | Forges webhook auth scheme for all bots | **Yes** | Operator (Supabase Edge secret + deploy) | webhook smoke → `reason=invalid_payload` for a valid token + bad body | **Yes** |
| Webhook **bot tokens** (`PRAXIS_*_WEBHOOK_TOKEN`) | Fire signals to a bot | **Yes** (with the pepper) | Operator | per-bot auth smoke = `invalid_payload` | **Yes** |
| Binance **Doppler** keys (`BINANCE_TESTNET_API_KEY/_SECRET`) | Exchange access (spike/preflight tools) | **Yes** | Operator (exchange site) | read-only `fetchBalance` succeeds | **Yes** (mainnet) |
| **Vault-stored** Binance credential (`vault_secret_id`) | The bots' real trading credential | **Yes if** service_role/Vault path exposed | Operator (`vault.update_secret`) | decrypt → read-only `fetchBalance` works | **Yes** |
| `PRAXIS_ALERT_TELEGRAM_BOT_TOKEN` | Send as the alert bot | **Yes** | Operator (BotFather) | alert send smoke after replacement | No |
| `GIT_SSH_PASS` | SSH key passphrase (key itself separate) | **Yes** | Operator (`ssh-keygen -p`) | a signed push / key unlocks | No |
| Personal account passwords (Gmail/Mac/Apple, if mistakenly stored) | The personal account | **Yes — at the provider** + **remove from the secret store** | Account owner | provider password changed; removed from Doppler | **Yes** |
| Non-secret identifiers (`SUPABASE_URL`, `bot_id`, `VAULT_SECRET_ID`, chat_id, config flags) | None (pointers) | **No** | — | n/a — rotate the *contents* they point to, not the id | No |

## 4. Rotation order (privileged → dependent; verify per category before resuming)
1. **Platform access first** — the credential that reads *all* secrets (e.g. the secret-manager
   access/CLI token) **and** the **Supabase CLI / access token** used by `supabase link` / `--linked`
   (rotate/revoke when the exposure surface includes local CLI access or a terminal/credential-store
   compromise), plus the exposure channel: rotate/revoke and close the channel, else every re-stored
   secret re-leaks.
2. **Data-plane root** — `service_role` / Supabase secret key → JWT secret/keys → DB password →
   the **Vault decrypt path**, **before** any dependent app secret.
3. **Exchange credentials** — rotate **after** any key that could decrypt Vault (a leaked
   service_role during the window could have read the Vault-stored exchange credential), so the
   exchange creds are assumed compromised and rotated regardless.
4. **Webhook pepper + bot tokens together** (the hashes depend on the pepper) → redeploy the Edge
   function (pepper is read at module load) → re-hash/insert bots.
5. **Alerting credentials** (DB role passwords/DSNs, Telegram token) **after** the DB roles.
6. **Propagate then restart:** push the new value into the provider **first**; redeploy/restart the
   consumer only **after** the new value is in place.
7. **Verify after each category** (§7) before moving on / resuming.

## 5. Safe CLI patterns (lessons learned — non-negotiable)
- **Secret managers print values.** `doppler secrets set` / `doppler secrets upload` echo the full
  secret table by default → **always redirect** (`… >/dev/null 2>&1; echo "exit=$?"`). Verify with
  **names only** (`doppler secrets --only-names`), provider metadata/digest where available, redacted
  shape checks, or a **non-secret smoke test**. **Never print any prefix/suffix/substring of a
  secret** — a prefix is still part of the secret.
- **Never put a secret value as a command argument** (it enters shell history and is visible in
  `ps`). Feed via `pbpaste`, `read`, or a **0600 temp env-file**.
- **0600 temp env-file pattern (delete immediately):**
  `( umask 077; printf 'NAME=%s\n' "$VALUE" > /tmp/x.env ); chmod 600 /tmp/x.env; <use --env-file>; rm -f /tmp/x.env`
  — **STOP condition:** if the temp file survives the command, delete it before proceeding.
- **zsh gotcha:** `read -p 'prompt'` fails (`no coprocess`) in zsh → use `read "VAR?prompt"` or
  `pbpaste`. (A failed `read` can upload an empty value — verify by a non-secret smoke test or provider metadata, **never by printing any part of the value**.)
- **Never paste full secret-manager output into chat / shared channels.** Use names, digests, or a
  **redacted DSN** (`sed -E 's#(//[^:]+:)[^@]+(@)#\1****\2#'`) only.
- **Generate-in-place** where possible (`openssl rand … | …`) so a value never lands on screen.

## 6. Provider-specific verification
**Supabase**
- service_role: a smoke query returning a **non-secret** result (e.g. a row count), not the key.
- If on new API keys: confirm **legacy JWT keys disabled** when nothing depends on them (verify no
  consumer uses the legacy `anon`/`service_role` first).
- DB: `supabase link` then `SELECT 1` via `--linked`.
- **CLI / access token:** if the exposure includes local CLI access / terminal / credential-store,
  rotate/revoke the Supabase **CLI access token** (used by `supabase link` / `--linked`) and
  re-`supabase login`; verify with the non-secret `--linked` `SELECT 1` above.
- **Edge:** when a function reads an env var at **module load** (e.g. `WEBHOOK_SECRET_PEPPER`),
  set the Edge secret **and** `supabase functions deploy <fn>` — the new value is inert until redeploy.

**Vault**
- Prove the **decrypted credential works** via a **read-only exchange call** (e.g. `fetchBalance`)
  before trusting it.
- **Rotate the Vault-stored bot credential** (`vault.update_secret`) if `service_role` (or the
  decrypt path) was exposed — assume it was readable during the window.

**Binance**
- **Testnet vs mainnet explicit** (sandbox mode set). Mainnet keys are an S4 concern.
- **Read-only `fetchBalance` before any order.** Never place an order to "test" a rotated key.

**Telegram**
- BotFather → **Revoke current token** / `/revoke` → new token. Old token dies immediately.
- Alert **send** smoke only **after** the token is replaced in the store.

**Railway**
- Doppler→Railway sync, then **redeploy** so the worker re-reads env at boot.
- Confirm `worker_queue_disabled` (or the expected queue state) in the boot logs.

## 7. Resume criteria (all required; Oren approves for S3/S4)
- [ ] `QUEUE_ENABLED=false` verified (or Oren-approved otherwise).
- [ ] **All affected secrets rotated** (per the §3 matrix) and propagated.
- [ ] **All §6 verification checks pass** for each rotated category.
- [ ] **No leaked values remain** where controllable — repo (history + working tree), `/tmp`, chat,
      logs, screenshots, clipboard.
- [ ] **Current Status / Notion updated** (and DECISIONS canon if a decision changed).
- [ ] **Oren approves resume** for **S3/S4**.

## 8. Stop conditions (halt; do not resume)
- **Unknown blast radius** (can't enumerate what was exposed).
- A **production / live-money** key possibly exposed (→ S4, Oren).
- Any secret **appears in git** (history or working tree) — purge before anything else.
- **Inability to verify** a rotation succeeded (no non-secret evidence).
- Any **active queue / trade** during containment (disarm first).

## 9. Incident record template (copy-paste; fill with NAMES only — never values)
```
INCIDENT RECORD
- incident_id:        INC-<YYYYMMDD>-<seq>
- date/time (UTC):    <start> … <contained> … <resolved>
- severity:           S0 | S1 | S2 | S3 | S4
- exposed surfaces:   <chat | terminal | git | logs | screenshot | clipboard>
- affected secrets:   <env-var NAMES only, e.g. SUPABASE_SERVICE_ROLE_KEY, WEBHOOK_SECRET_PEPPER>
- rotations performed: <name → rotated? → propagated? (provider + Doppler/Edge + redeploy)>
- verification:       <per-category §6 evidence — non-secret results / smoke outcomes>
- residual risk:      <what is NOT yet closed / assumptions>
- Oren decision:      <resume approved? conditions?>      (required for S3/S4)
- resume timestamp:   <when QUEUE_ENABLED re-enabled, if at all>
```

---
**This runbook is DRAFT.** Closure (per production gap review A6) requires **review + a tabletop
dry-run**. No execution is performed by writing it. `QUEUE_ENABLED=false`; Migration 009 frozen.
