# A4 — Mainnet Credentials Architecture (PRODUCTION-GRADE DECISION / IMPLEMENTATION PLAN)

> **DOC / PLANNING + read-only grounding — NOT EXECUTION.** No code · no migration · no DB mutation · no deploy · no
> Railway/Doppler change · **no secrets** · no mainnet / no real funds. **Real funds remain NO-GO.** **No secret VALUE
> appears in this doc, ever.** Uncommitted draft for Codex/Oren review. Supersedes
> `production-a4-mainnet-credentials-architecture.md` by grounding it in the **verified live schema + worker code**
> (read-only, 2026-07-10) and aligning it with **A8-H3** (per-bot isolation) and **A1** (static egress / key allowlist).
>
> **Rev 2 (2026-07-10): Codex CHANGES 1-10 applied.** Provisioning is now a **reviewed operator packet** (not ad-hoc SQL)
> with an exact non-secret field list (§4); **`vault_secret_id` is treated as sensitive operational metadata** for mainnet
> (§0a); the **`pending_validation → valid` promotion mechanism is an explicit BLOCKER** to implementation-readiness (§4b);
> an exact **read-only validation plan** (no `createOrder`) is added (§4c); **A4 is explicitly gated behind A8-H3
> ownership/no-sharing** (§2a); work is split into **slices A4-1..A4-5** with code/doc/operator tags (§10); the
> Vault/Doppler/Railway wording is corrected (no exchange **key values** in Railway; app secrets may still live there,
> §6); and a hard **recreate-before-proceeding** stop condition is added (§9).

## 0. Reading guide — four buckets (kept explicit)
- **[FACT]** verified from repo/migrations/worker (file:line). **[ASSUMPTION]** carried from prior docs, not re-confirmed.
- **[PROPOSAL]** a change this plan proposes (not built). **[UNKNOWN]** open question for Codex/Oren.

## 0a. Secret-handle handling (applies to the whole doc)
- **[RULE] No secret VALUE ever printed** — API keys/secrets, Vault secret values, proxy creds: never in doc/PR/chat/log/argv.
- **[RULE] `vault_secret_id` is SENSITIVE OPERATIONAL METADATA for mainnet.** It is **not** the key value (it is a Vault
  pointer), and **docs may NAME the column**, but a **real mainnet `vault_secret_id` value must NOT be pasted into
  chat/docs/logs unless explicitly approved.** Evidence about mainnet credentials uses **counts / a redacted or
  fingerprinted handle**, never a raw mainnet secret handle. *(Testnet row-ids already recorded in prior packets are
  out of scope of this mainnet rule; the rule governs mainnet handles going forward.)*

---

## 1. Current credential schema + worker path (CONFIRMED from repo)
- **[FACT] `user_exchange_credentials`** (`001_initial_schema.sql:153-168`): `id uuid PK`, `user_id uuid NOT NULL →
  auth.users`, `exchange_id uuid NOT NULL → exchanges`, **`vault_secret_id TEXT NOT NULL`** (Vault pointer), `label TEXT`,
  `status credential_status NOT NULL DEFAULT 'pending_validation'`, `deleted_at`, **`exchange_environment TEXT` nullable,
  `CHECK (… IN ('testnet','mainnet'))`** (added `014:58-60`). Only uniqueness = `UNIQUE (user_id, exchange_id, label)`.
  **No `bot_id` column.** `credential_status` enum = `pending_validation | valid | invalid`.
- **[FACT] `exchanges`** (`001:99-110`): `id`, `name`, `display_name`, **`ccxt_id`** (e.g. `binance`),
  `supported_account_types`, `is_active`. **No environment column** — a single `binance` exchange row serves both
  testnet + mainnet; **environment is entirely the credential's `exchange_environment` + the worker's `setSandboxMode`.**
- **[FACT] `bots`** (`001:185-198`): `credential_id uuid` **nullable** `→ user_exchange_credentials(id) ON DELETE
  RESTRICT`, **non-unique index** (`idx_bots_credential_id`) → **sharing is possible today** (this is the A8-H3 problem).
  `user_id NOT NULL`, `deleted_at`, `trading_enabled` (014, kill switch), `status`.
- **[FACT] Vault helpers = read + delete only:** `get_decrypted_secret(uuid)` (`004:11-25`, decrypt at execution) and
  `delete_vault_secret(uuid)` (`005:28-41`), both `SECURITY DEFINER search_path='' service_role`-only. **NOTE the arg is
  `uuid`** while `vault_secret_id` is stored `TEXT` → callers cast. **There is NO in-repo create/insert-secret helper and
  NO create-credential Edge function/RPC** (grep clean) — so **credential + Vault-secret provisioning is operator-run
  out-of-band today** (insert the row + create the Vault secret + set `vault_secret_id`). A4 must define that operator
  path explicitly (§4).
- **[FACT] Worker path:** resolves `bot.credential_id` → selects `vault_secret_id, status, deleted_at,
  exchange_environment` (`worker/src/index.ts:754-758`) → builds `new BinanceAdapter(secretsProvider, cred.vault_secret_id,
  isProduction)` (`:872`); `VaultSecretsProvider` resolves the secret at execution. **Gates:** credential `status='valid'`
  + not-deleted (`:774-783`), `vault_secret_id` UUID-shape (`:785-793`), env guard `assertExchangeEnvironment(isProduction,
  cred.exchange_environment)` (`:861`), kill switch `assertTradingEnabled`. **[FACT] NO `user_id` ownership check today**
  (the A8-H3 **W1** gap). Second resolution site: `reconciliation.ts:232-246`.
- **[UNKNOWN] Validation lifecycle:** the enum has `pending_validation → valid`, and the worker requires `valid`, but the
  exact mechanism that promotes `pending_validation → valid` (a read-only `fetchBalance` check, operator-run, or an Edge
  step) is **not yet located in-repo** — confirm before wiring A4 provisioning (validation must be **read-only, no order**,
  consistent with A1).

## 2. How A4 depends on A8-H3 and A1 (alignment)
- **On A8-H3 (isolation) — A4 mainnet keys are provisioned ALREADY-ISOLATED:**
  - A4 creates **one credential row + one Vault secret per (user, bot, mainnet)** — so the A8-H3 invariants hold **by
    construction**: **I1 single-use** (no mainnet key shared across bots), **I2 ownership** (`cred.user_id = bot.user_id`,
    enforced by A8-H3 **S2** composite FK), **I3 environment** (`exchange_environment='mainnet'`, worker-guarded).
  - A4 **rides on** A8-H3 **S2 (ownership FK) + W1 (worker ownership fail-closed)**; and because every mainnet key is
    per-bot from creation, **S1b (single-use index)** is satisfied trivially (no mainnet backfill needed — only the
    *testnet* fleet is currently shared, per A8-H3 §5 discovery). **Ordering: A8-H3 Slice H3-1 (S2+W1+S1a) should land
    before mainnet keys are armed**, so ownership is enforced when the first real key exists.
- **On A1 (static egress) — the key IP-allowlist consumes A1's chosen IP:**
  - Each mainnet key must be **IP-restricted to the worker's static egress IP** (A1). **A4 mainnet keys CANNOT be
    finalized/allowlisted until A1-PROVIDER-DECISION picks the egress path and the IP is known + proven** (A1 stage gates
    A1-EGRESS-PROOF → A1-ALLOWLIST-READY → A1-LIVE-READONLY-PROOF). The key's allowlist target must exist first.
- **Net dependency chain:** **A8-H3 (ownership/isolation) + A1 (static IP)** are prerequisites; **A4** is where the real
  per-bot mainnet key is created, isolated, allowlisted, and validated read-only — then armed only behind **A11**.

## 2a. A4 is GATED behind A8-H3 (mainnet credential entry is BLOCKED until these hold)
**A4 must not look executable before A8-H3 can actually enforce ownership + no-sharing.** Mainnet credential entry is
blocked until ALL of:
- [ ] **H3-1 S2 ownership guard is LIVE** — the composite FK (or trigger) enforcing `cred.user_id = bot.user_id` is
      applied, so a mainnet key can never be owned by the wrong user.
- [ ] **H3-1 W1 worker ownership fail-closed is LIVE** — the worker refuses to decrypt/trade on an ownership mismatch
      (both resolution sites).
- [ ] **H3-1 S1a shared-credential detection EXISTS** — sharing is observable (read-only query + `operator_status`
      `credential_shared`), so a shared mainnet key would be caught.
- [ ] **H3-2 S1b (or an equivalent accepted no-sharing guarantee) covers mainnet** — because A4 provisions **per-bot
      mainnet keys**, S1b holds by construction; but **S1a must report ZERO sharing for every mainnet-bound bot** before
      arming (no shared mainnet credential may exist).
- **⇒ No mainnet credential is created/validated/armed until the above are in place.** A4 rides on A8-H3; it does not
  bypass it.

## 3. Target mainnet credential model
> **One key per (user, bot, environment=mainnet); trade-only; no withdrawal; IP-allowlisted; never shared.**
- **[PROPOSAL] Per-user:** `user_exchange_credentials.user_id` = the owning user; A8-H3 **S2** enforces
  `cred.user_id = bot.user_id`. No cross-user use.
- **[PROPOSAL] Per-bot:** exactly one bot references each mainnet credential (A8-H3 **I1/S1b**). A KP5 lock/disable on that
  credential affects **only that bot** (isolated blast radius).
- **[PROPOSAL] Per-environment:** `exchange_environment='mainnet'`, a **distinct row + distinct `vault_secret_id`** from
  any testnet credential; the worker selects the ccxt endpoint from it (`setSandboxMode`/`assertExchangeEnvironment`).
  **Never cross environments.**
- **[PROPOSAL] No shared key:** **NO universal/account-wide master key**; **NO key reused across bots or users.** A
  compromised key can at worst mis-trade within caps for **one** bot — never withdraw, never touch other bots.
- **[PROPOSAL] No withdrawal permission:** each key is **trade-only** (enable Spot/Margin trading as needed; **DISABLE
  withdrawals/transfers**). The platform must be **unable to move funds off the exchange**. Hard requirement.
- **[PROPOSAL] IP allowlist required:** each key **restricted to the A1 static egress IP** (defence in depth). Applied
  **only after** the IP is proven reachable (A1), never before (out-of-order = lockout).

## 4. Mainnet credential PROVISIONING = a reviewed operator packet (NOT ad-hoc SQL)
**[CHANGE 1] Mainnet credential provisioning must go through a reviewed packet/procedure — never casual/ad-hoc SQL.**
- **Operator-run only; Codex-reviewed BEFORE any linked insert.** The exact `INSERT`/repoint statements are authored,
  reviewed (like the A2 reconcile artifact), and only then operator-run surgically (`db query --linked --file`, **never
  `db push`**). No credential row is inserted outside this reviewed path.
- **Exact NON-SECRET fields allowed in the DB row** (nothing else; **no secret value in any field but the Vault pointer,
  which is itself sensitive — §0a**):
  | Column | Value at provisioning |
  |---|---|
  | `user_id` | the owning user's uuid (must equal the bot's `user_id` — A8-H3 S2) |
  | `exchange_id` | the `binance` exchanges row id |
  | `exchange_environment` | **`'mainnet'`** |
  | `vault_secret_id` | the Vault pointer (sensitive metadata — §0a; not the key value) |
  | `label` | non-secret human label (e.g. bot mapping) |
  | `status` | **`'pending_validation'`** (NEVER `'valid'` at insert — §4b) |
  | `deleted_at` | NULL |
  *(`created_at`/`updated_at` default. No other columns set. The key **value** lives only in Vault.)*
- **Initial `status = 'pending_validation'`** — promotion to `'valid'` happens only via §4b after §4c read-only validation.
- **`bots.trading_enabled` stays `false`** — provisioning does **not** arm; no arming during provisioning (§12/A11).
- **Repoint** the bot's `credential_id` to the new row (per-bot, one row) as part of the same reviewed packet.

### Exact OREN key-creation checklist (NO value exposure) — [CHANGE 9]
> **Never paste a real key/secret VALUE, or a real mainnet `vault_secret_id` (§0a), into any doc/PR/chat/log/argv.**
- [ ] **Create the mainnet API key** (Binance mainnet), one **per (user, bot)**.
- [ ] **Set trade-only** — enable Spot/Margin trading as needed; scope to traded symbols if supported.
- [ ] **DISABLE withdrawals/transfers** — the key must be unable to move funds off the exchange.
- [ ] **Apply the IP allowlist from A1** — restrict the key to the proven A1 static egress IP (only after
      A1-ALLOWLIST-READY; never before).
- [ ] **Store the value directly into Vault / the approved secret path** — obtain the `vault_secret_id`; **do not paste
      the value (or the mainnet handle) into chat/docs.**
- [ ] **Record only NON-SECRET metadata** (label, creation date, allowlisted IP, bot mapping).
- [ ] **Leave the credential `pending_validation`** — do not self-promote.
- [ ] **Wait for validation** (§4c) before the credential becomes `valid`; **do not arm** (`trading_enabled=false`) until
      A11 + all gates.

## 4b. `pending_validation → valid` promotion mechanism — EXPLICIT BLOCKER [CHANGE 3]
**[UNKNOWN → BLOCKER] The promotion path is not yet defined in-repo. A4 is NOT implementation-ready until it is.**
- A4 cannot be implementation-ready until the **validate/promote mechanism is defined and Codex-reviewed**. Acceptable
  forms (pick one in review):
  - **(a) reviewed operator SQL packet** — an operator-run, reviewed `UPDATE … SET status='valid' WHERE …` gated on
    recorded read-only validation evidence; or
  - **(b) reviewed SECURITY DEFINER RPC** — a service_role-only promote function that requires validation evidence; or
  - **(c) documented manual DB procedure** — an explicit, reviewed operator runbook.
- **No automatic promotion** — a credential is promoted to `valid` **only** with **read-only validation evidence** (§4c).
- **No promotion to `valid` if A1 static egress is not proven** — the validation in §4c must run from the **proven A1
  static IP** (A1-LIVE-READONLY-PROOF). Until A1 closes, mainnet credentials stay `pending_validation`.
- **[UNKNOWN]** the current testnet promotion mechanism must be located/confirmed first (worker sets `invalid` on failure,
  but what sets `valid`?) — resolving this is a precondition of A4-2 (§10).

## 4c. Read-only mainnet validation plan (NO `createOrder`) [CHANGE 4]
Validation proves the key works **without trading**, from the allowlisted egress:
- **Allowed checks (read-only only):**
  1. **Egress/auth from the allowlisted IP** — the key authenticates from the **A1 static egress IP** (a request that
     would fail if the IP allowlist or key were wrong).
  2. **A read-only PRIVATE account endpoint succeeds** — e.g. authenticated `fetchBalance` returns 200 (proves key + IP +
     region accepted). Public keyless ping first (region/`451` proof).
  3. **Trade-only / no-withdrawal verification** — by **operator attestation** (the key was created no-withdrawal) **plus
     API evidence if the exchange exposes key-permission info**; recorded as **pass/fail**, not raw account data.
- **Evidence discipline:** record **pass/fail + counts** only — **no balances, no account numbers, no sensitive account
  details** in docs; no raw mainnet secret handle (§0a).
- **Hard rules:** **NO order endpoints, no `createOrder`, no order of any size.** **A failed IP-allowlist or failed auth =
  STOP** (do not loosen the key, do not promote; treat as an incident).
- **Sequence:** testnet read-only re-confirm → mainnet keyless public ping (region) → mainnet authenticated `fetchBalance`
  (key+IP+region) → then (and only then) promote via §4b. All Oren-gated.

## 5. Exact CLAUDE-implementable checklist (schema/code/runbooks only — NEVER handles secret values)
- [ ] **Schema/constraints for per-bot isolation** (with A8-H3): the S2 ownership FK + S1b single-use index — mainnet keys
      are per-bot, so these hold by construction.
- [ ] **Worker ownership + environment fail-closed checks** (A8-H3 **W1** + existing `assertExchangeEnvironment`) — reads
      the `vault_secret_id` **pointer** only; decrypt happens server-side via `get_decrypted_secret`. No secret value
      handled.
- [ ] **`operator_status` credential surfacing** (non-secret): status/env/`credential_shared` — no values.
- [ ] **Provisioning + rotation RUNBOOKS** (operator-run; Claude authors the steps, never the values) — the §4 + §7 flows
      as reviewed runbooks.
- [ ] **Read-only validation design** (`fetchBalance`, no order) for the `pending_validation → valid` promotion.
- [ ] **LOCAL test fixtures** for the constraints + worker checks.
- **NEVER:** touch key values, provision real keys, create/read Vault secret values, deploy, or arm trading.

## 6. Vault / Doppler / Railway separation (custody split — NO exchange key values outside Vault)
- **[PROPOSAL] Exchange trading keys → Supabase Vault** (encrypted), referenced by
  `user_exchange_credentials.vault_secret_id` **per bot**. The worker decrypts at execution via `get_decrypted_secret`
  (service_role); the browser/console/logs **never** see keys.
- **[PROPOSAL] Doppler = source-of-record for APP/INFRA secrets** (service_role, pepper, etc.), synced to Railway.
- **[PROPOSAL] Railway** holds **app config + the Doppler-synced APP secrets the worker needs** (service_role, etc. —
  expected and unchanged). **[CHANGE 7] Do NOT overclaim "no keys in Railway":** Railway legitimately holds **app
  secrets** via Doppler/Railway. The precise rule is: **no exchange API key/secret VALUES in Railway** — exchange
  trading-key values live **only in Vault**; app secrets may still live in Doppler/Railway.
- **[constraint] No exchange key VALUE in Railway env, Doppler app config, docs, chat, PR, or logs — ever.** Only the
  `vault_secret_id` **pointer** travels through the DB (and even that is sensitive metadata for mainnet — §0a); the key
  value stays in Vault. (Consistent with the existing pattern + S5-A6 hygiene.)
- **Operator provisions all secret values; Claude designs only the pointers/flow.**

## 7. Rotation path (compatible with A8-H3 per-bot isolation)
- **[PROPOSAL] Per-bot rotation, compare-and-swap, delete-old-last** (the migration-005 key-rotation order):
  1. Operator creates a **new** mainnet key (trade-only, IP-allowlisted) for that bot.
  2. Store the new secret in **Vault** → obtain new `vault_secret_id`.
  3. **Compare-and-swap** the bot's credential `vault_secret_id` old→new (reviewed, surgical).
  4. **Validate read-only** (`fetchBalance`, no order) that the new key works from the static IP.
  5. **Delete the OLD Vault secret LAST** (`delete_vault_secret(old_id::uuid)`), only after the new one is proven.
- **[FACT] Isolation makes rotation safe:** because each credential is **per-bot** (A8-H3), rotation replaces **one bot's**
  Vault secret without touching any other bot. Old credential rows are soft-deleted/invalidated (A8-H3 S1b exempts
  soft-deleted rows, so rotation never trips the single-use index).
- **Never reuse a key that was ever locally exposed.** Rotation is operator-run + audited.

## 8. Testnet / mainnet separation — ENFORCED by DB + worker, not convention
- **[FACT] Distinct rows, distinct Vault secrets, distinct ccxt endpoints.** A bot is testnet **or** mainnet via its
  credential's `exchange_environment`; there is no `bots.exchange_environment` (environment lives on the credential).
- **[FACT] Worker enforcement (fail-closed, exists today):** `assertExchangeEnvironment(isProduction,
  cred.exchange_environment)` (`index.ts:861`, logic `sizingRisk.ts:78-85`) — NULL env or a tier mismatch → **no order**
  (not a silent fallback); `setSandboxMode(true)` when `!isProduction`. So a testnet key can never place a mainnet order
  (or vice-versa) even if data were mis-set. `PRAXIS_IS_PRODUCTION` is the worker-wide tier.
- **[PROPOSAL] Optional DB reinforcement:** A8-H3 §6 leaves environment enforcement to the worker (a cross-table CHECK is
  awkward); A4 keeps the worker guard as the control. Revisit only if a DB-level env tie is wanted.
- **No mainnet execution until** the bot is explicitly mainnet-provisioned (§4) + all real-funds gates closed + A11.

## 9. Stop conditions (hard)
- **[CHANGE 8] If any key has withdrawal permission, universal/master scope, missing IP restriction, shared usage, or an
  unknown owner/bot mapping → STOP.** Do **not** proceed — **delete/disable/recreate** the key correctly (trade-only,
  scoped, IP-restricted, per-bot, known owner) before continuing. Never "work around" a mis-scoped key.
- **Any key with withdrawal/transfer permission → STOP** (must be trade-only).
- **Any shared mainnet credential (A8-H3 not enforced) → STOP** — one key per (user, bot, mainnet); S2/W1 must be live.
- **Any mainnet key not IP-allowlisted to the A1 static egress IP → STOP** (A1 first; allowlist only after IP proven).
- **Enabling the key IP-restriction before the static IP is confirmed + reachability proven → STOP** (out-of-order =
  lockout).
- **Any `createOrder` as part of provisioning/validation → STOP** — validation is **read-only** (`fetchBalance`).
- **Any secret VALUE appearing in a doc/PR/chat/log/argv → STOP + rotate.**
- **Any mainnet arming (trading_enabled=true) before A11 (capped) + all gates → STOP.**
- **Real funds remain NO-GO.**

## 10. A4 implementation SLICES (each separately Codex-gated; NO secret values) — [CHANGE 6]
> Schema/worker enforcement lands in **A8-H3** (S2/W1/S1a/S1b); A4 adds **no new table**. A4's own slices are mostly
> **docs/runbooks + one small validation-support path**, plus the operator/Oren actions they drive.
| Slice | What | Code / Doc / Operator |
|---|---|---|
| **A4-1** | **Provisioning + validation RUNBOOK** — the §4 reviewed operator packet (non-secret field list, per-bot, `pending_validation`, no arming) + the §4c read-only validation steps | **Doc** (Claude authors) → **Operator** runs; **no code** |
| **A4-2** | **`pending_validation → valid` promotion mechanism** (§4b) — pick (a) reviewed operator SQL packet, (b) SECURITY DEFINER RPC, or (c) documented manual procedure; requires validation evidence + A1 proven | **Doc** always; **Code** only if (b) RPC (LOCAL-tested migration) → **Operator** runs |
| **A4-3** | **Read-only mainnet validation packet** (§4c) — the exact keyless-ping → `fetchBalance` sequence + pass/fail evidence format; may include a small worker/operator read-only check (no order) | **Doc** + optional small **Code** (read-only check) → **Operator**-gated run |
| **A4-4** | **Rotation packet** (§7) — per-bot new-key → Vault → CAS `vault_secret_id` → validate → delete-old-last; A8-H3-compatible | **Doc** (Claude authors) → **Operator** runs |
| **A4-5** | **Tiny-live preflight integration — ONLY after A11** — wire the validated per-bot mainnet key into the Stage-3 tiny-live smoke (caps, one bot, kill ready) | **Doc** + gated **Operator/Oren**; **no arming without A11** |
- **NOT authorized by this packet:** creating/reading Vault secret values, provisioning real keys, any deploy, any mainnet
  arming, any key allowlist change — all operator/Oren + their own gates. **A4-2..A4-5 do not begin until A8-H3 (§2a) +
  A1 (§11) prerequisites are met.**

## 11. What remains BLOCKED until A1 provider decision
- **Finalizing/allowlisting any mainnet key** — the IP-restriction target (the static egress IP) does not exist until
  **A1-PROVIDER-DECISION** picks A/B1/C and **A1-EGRESS-PROOF → A1-ALLOWLIST-READY** produce a proven, documented IP.
- **A1-LIVE-READONLY-PROOF** (mainnet read-only `fetchBalance` from the static IP) is the validation step A4 depends on to
  promote a mainnet credential `pending_validation → valid`.
- Until then, mainnet credential rows may be **designed** but **not created/validated/allowlisted**; the fleet stays
  **testnet-only**.

## 12. What remains BLOCKED until A11 approval
- **Arming any mainnet bot** (`trading_enabled=true` on a mainnet-provisioned bot) — **A11 (written, capped)** is the hard
  gate; nothing trades real funds without it.
- Even with keys created, isolated, allowlisted, and read-only-validated, **the first real order waits on A11** (caps:
  per-order + daily notional, one bot, kill authority ready) + a controlled first-money smoke — separately gated.
- **Real funds remain NO-GO** until A11 + A1 + A8-H3 + live-tier fail-closed all close.

---
**Net:** A4 defines a **per-bot, per-user, per-environment, trade-only, IP-allowlisted, never-shared** mainnet key model
that rides on **A8-H3 isolation** and **A1 static egress**, with **all secret VALUES handled only by the operator into
Vault** and **only non-secret pointers/metadata** anywhere Claude can see. This plan authorizes **nothing** — schema/
worker/runbook work is Codex-gated; key creation/allowlisting is Oren+A1-gated; arming is A11-gated. **Real funds remain
NO-GO.**
