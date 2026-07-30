# A8-H3 / KP5 — Credential Blast-Radius Isolation (Design)

> **DOC / DESIGN — NO CODE.** No DB mutation · no deploy · no secrets · no mainnet/real funds. Overnight draft,
> **uncommitted**, for Codex/Oren review. Closes the KP5 carve-out from A8-H2 (audited one-click kill). Grounded in the
> credential schema (`user_exchange_credentials`, `bots.credential_id`, Vault via `read_vault_secret`/`delete_vault_secret`).

## Scope (planning only — explicit)
- **Planning only.** No deploy. No linked apply. No DB mutation. No Railway/Doppler change. No secrets. No mainnet / no real funds. **Real funds remain NO-GO.**
## 1. Current shared-credential risk model
- `public.bots.credential_id` → `public.user_exchange_credentials(id)`. **Multiple bots can point at the SAME
  credential row** (nothing enforces one-credential-per-bot).
- Each credential row has a **`vault_secret_id`** (the encrypted exchange key in Vault) + `status`
  (`pending_validation`/`valid`/`invalid`) + `exchange_environment` (testnet/mainnet).
- The worker decrypts via `read_vault_secret(vault_secret_id)` to place orders.
- **KP5 kill = credential `status='invalid'` or `delete_vault_secret(vault_secret_id)`** (auto on auth failure
  `worker/src/index.ts:497-542`, or manual).

## 2. Exact blast-radius problem
Because a credential can be **shared**, a KP5 action on **one** credential **disables EVERY bot that references it** —
including unrelated bots/users. So a "custody-lock" one-click kill (the KP5 half of A8-H2) is **unsafe**: it can
unintentionally halt bots it was never meant to touch, and (with `delete_vault_secret`) is **irreversible** for all of
them. This is why A8-H2 deliberately excluded custody-lock and deferred it to **H3**.

## 2a. Exact isolation invariant + edge cases
- **INVARIANT:** **at most one ACTIVE credential row per `(user_id, bot_id, environment)`, and no ACTIVE credential row
  shared across bots.** "Active" = `deleted_at IS NULL AND status <> 'invalid'` (a live, usable credential).
- **Soft-deleted / revoked credentials & uniqueness:** the uniqueness/single-use constraint must apply to **active** rows
  only — a **partial unique index** (e.g. `unique (credential_id) where deleted_at is null`, and/or
  `unique (user_id, bot_id, exchange_environment) where deleted_at is null and status <> 'invalid'`). Revoked/soft-deleted
  rows are exempt so history and rotation (old→new) don't trip the constraint.
- **Detect existing shared credentials BEFORE migrating** (read-only discovery):
  ```sql
  -- credentials referenced by >1 live bot (the sharing to resolve):
  select credential_id, count(*) as live_bots
  from public.bots where credential_id is not null and deleted_at is null
  group by credential_id having count(*) > 1;
  -- (and any bot whose credential's user_id/environment != the bot's)
  ```
- **If two bots currently share one `vault_secret_id`:** do NOT enforce uniqueness first. **Backfill first** — provision
  a separate credential row (its own `vault_secret_id`, operator-provisioned) for each bot and repoint, **then** enforce.
  Never orphan a bot mid-migration; never point two bots at one active row after enforcement.

## 3. Target model — per-user / per-bot / per-environment isolation
- **Invariant:** **one credential row is owned by exactly one (user, environment) and is used by exactly one bot** (or a
  deliberately-scoped set), so a KP5 action affects **only** that bot. Concretely:
  - **Per-user:** `user_exchange_credentials.user_id` already scopes ownership; enforce it end-to-end.
  - **Per-bot:** a **1:1 (or 1:few, explicitly)** bot↔credential mapping — no accidental sharing across bots/users.
  - **Per-environment:** testnet vs mainnet credentials are **distinct rows** with distinct `vault_secret_id`; a bot's
    `exchange_environment` selects the matching credential; **never** cross environments.
- **Result:** KP5 (invalidate / Vault-delete) on a bot's credential = **isolated blast radius = that one bot.**

## 4. DB / schema impact
- **Enforce non-sharing:** either (a) a **UNIQUE** constraint making `credential_id` single-use (unique on
  `bots.credential_id` where not null/not-deleted), or (b) an explicit `bot_id` FK on the credential row (credential
  belongs to a bot), or (c) a join table with a uniqueness guard. Recommend the simplest that enforces 1:1 without
  breaking existing rows.
- **Per-(user,environment) guard:** ensure a credential's `user_id` matches the bot's owner and its
  `exchange_environment` matches the bot's — a CHECK/trigger or app-layer invariant + a reconcile of existing rows.
- **Migration** (surgical, gated, never `db push`): add the constraint(s) + backfill/repoint any currently-shared
  credentials into per-bot rows **before** enforcing uniqueness (data migration with per-object verify).

## 5. Vault / Doppler / Railway impact
- **Vault:** one `vault_secret_id` per (bot, environment) credential — mainnet keys stored per-bot, never shared. The
  pepper/topology is unchanged; keys are per-bot secrets in Vault (operator provisions; Claude never handles values).
- **Doppler/Railway:** no new app secrets from this design itself; mainnet provisioning is A4's concern. The worker
  reads per-bot `vault_secret_id` — no env change.

## 6. Worker impact
- Worker already resolves a bot's credential → `vault_secret_id` → `read_vault_secret`. Change: **assert the credential
  belongs to the bot's user + matches the bot's environment** before decrypt (fail-closed on mismatch). The auto-disable
  path (`disableCredentialAndBot`) then affects only the one bot (isolation makes this safe by construction).

## 7. Operator-console impact
- `operator_status()` already surfaces `credential_status`/`credential_ok` per bot. Add (optional) a per-bot
  credential-isolation indicator (is this credential single-use?). A future **custody-lock** stop-action (Ops Harness
  Slice C, gated) becomes safe **only after** isolation — it would invalidate **one bot's** credential with an audited,
  reversible-where-possible action.

## 8. Kill / disable semantics (post-isolation) — DISABLE-first, DELETE-only-after-review
- **KP1 (trading_enabled=false)** and **KP4 (status=paused)** — unchanged (already per-bot; A8-H2).
- **KP5 is two distinct actions — prefer the reversible one:**
  1. **DISABLE / LOCK the credential reference (default):** set the credential row `status='invalid'` (or detach the
     bot's `credential_id`) — **reversible**, per-bot isolated, audited. This is the first-line "custody-lock."
  2. **DELETE the Vault secret (`delete_vault_secret`) — EMERGENCY ONLY, AFTER REVIEW:** irreversible for that one bot;
     used only when the key must be destroyed (e.g. confirmed compromise). Never the default path.
- With isolation, **either** affects **only that one bot** — the blast radius is contained by construction. A safe
  **custody-lock one-click** (disable-first) becomes a viable Ops Harness Slice-C action **after** isolation, gated.

## 9. Migration plan (gated)
1. **Discovery:** read-only — count currently-shared credentials (any `credential_id` used by >1 live bot); map them.
2. **Backfill:** for each shared credential, provision per-bot credential rows (operator provisions keys; testnet first)
   and repoint bots — reviewed, surgical.
3. **Enforce:** add the uniqueness/ownership/environment constraints once no sharing remains.
4. Each step: design → Codex CP → LOCAL test → gated linked apply (surgical, never `db push`) → read-back → A2 ledger.

## 10. Tests
- **LOCAL SQL fixtures:**
  - the partial-unique constraint **rejects** a second live bot pointing at an active credential; **allows** a
    soft-deleted/revoked duplicate (rotation).
  - a credential whose `user_id` or `exchange_environment` mismatches its bot is rejected (CHECK/trigger).
  - **ISOLATION PROOF:** two bots (A, B) with distinct credentials → **DISABLE bot A's credential (`status='invalid'`)
    → bot B's credential + execution_ready UNAFFECTED**; then re-enable A (reversible).
- **Worker unit:** fail-closed (no order) if a bot's resolved credential ownership/env/bot-mapping mismatches.
- **Testnet validation:** disable one testnet bot's credential → only that bot disabled; others unaffected; reversible;
  and (separately, emergency-path) a reviewed Vault-delete affects only that one bot.

## 11. Rollout plan
- Testnet first (repoint + enforce on testnet creds), validate isolation, then apply the same to mainnet creds **as part
  of A4 provisioning** (per-bot mainnet keys are created already-isolated — no shared mainnet key ever).

## 12. What remains blocked for real funds
- **STOP CONDITION (hard):** **any active shared mainnet credential → real funds NO-GO.** No mainnet bot may reference a
  credential used by another bot/user; enforcement (partial-unique + ownership/env checks) must be **live-verified**
  before any mainnet arming.
- H3 isolation is a **prerequisite** but not sufficient: real funds still need **A4** (real per-bot mainnet keys), **A1**
  (static egress), **A11**, **live-tier fail-closed**, **A2 reconcile**. H3 closes the **custody-lock blast-radius**
  gap and makes A8 fully closable (with the H4 drill). **Real funds remain NO-GO.**
