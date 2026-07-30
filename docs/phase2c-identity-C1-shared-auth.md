# Phase 2C (C1) — Shared Supabase Auth: the StrateTeach user IS the Praxis user

**Status: DESIGN v1 — pre-audit. Supersedes the Option-A doc** (`phase2c-identity-provisioning-architecture.md`,
kept as the "why not A" record). **Decision made with the operator:** StrateTeach has only a handful of
users → **C1** (adopt shared Supabase Auth) over A (shadow users). C1 deletes the entire ticket/shadow
machinery that took A three audit rounds to harden. NO code until this passes 3 adversarial audit rounds.
Real-funds NO-GO throughout.

> **Why C1 (from the A audit):** A's whole cost existed *because it denied users a Praxis JWT* — forcing
> `user_uid`/`st_ref`, shadow `auth.users`, a `provision-user` Edge fn, a bespoke read/kill bridge, and a
> single shared HMAC "bridge key" whose compromise the A audit showed could forge tickets, self-approve
> mainnet, and irreversibly wipe every Vault key. **Give the user a real JWT and all of that disappears.**

---

## 0. What C1 deletes vs A (the win), and what survives
**DELETED (no longer needed):** `provision-ticket.ts` + `praxis_tickets.py` (the whole ticket layer),
`st_ref`, `user_uid`, shadow `auth.users` provisioning, `provision-user`/`deprovision-user` as ticket-gated
fns, the multi-use read-token bridge, the "independent authority vs shared key" contortions (INV-10), and
threats T1/T2/T7/T15/T16 (all shared-bridge-key attacks) — **structurally gone**, not mitigated.

**SURVIVES from the A analysis (identity-independent, still owed):** the live-balance subsystem (§3.8), EP6
**validate** + **arm** (§3.7), legacy-key **offboarding across all 4 stores** (§3.9), venue **`is_active`**
gate (§3.10), **audit logging** (§3.11), the safe-default bot creation + Vault storage logic inside
`create-bot`/`connect-credential`, and all Praxis go-live blockers (A1/A4/A11).

---

## 1. The C1 model + ground truth
The StrateTeach user **is** a Supabase `auth.users` record in the **same Supabase project as Praxis**. The
browser logs into Supabase Auth, holds a real JWT, and talks to Praxis Edge functions + RLS RPCs directly
with it. StrateTeach stays the brain (strategies/UI) and never holds an exchange key.

**Ground truth (verified):** `create-bot`/`connect-credential` are `verify_jwt=false` today (ticket-auth,
`config.toml:439,445`) → C1 switches them to **`verify_jwt=true`** and derives `user_id = auth.uid()`
(drop the ticket). `033` `user_bot_dashboard()` + `user_pause_own_bot(uuid)` are `auth.uid()`-gated,
`SECURITY DEFINER`, `grant execute … to authenticated` (`033:20,98,108,142`) → the browser calls them
directly with its JWT for **status + kill** (the A "read/kill bridge" is unnecessary). StrateTeach
frontend holds its own bearer today (`dashboard/src/lib/client.ts:541`) → it will hold the Supabase JWT.
StrateTeach identity today = `username` PK, opaque token, **its own Postgres, no RLS** (from the A audit) —
this is what C1 changes.

---

## 2. Invariants
1. **INV-1 Identity = Supabase `auth.uid()`** from a verified JWT — one identity for both systems. No
   client-supplied user id anywhere.
2. **INV-2 Key isolation** — exchange key browser→Praxis only (unchanged; now authed by the user's JWT).
3. **INV-3 No service_role / exchange key in the browser or StrateTeach backend** — privileged Vault writes
   stay inside Edge fns; the user's own JWT + RLS authorize user-scoped actions.
4. **INV-4 RLS is now a REAL control** — every user-facing Praxis table/RPC is `auth.uid()`-scoped, with a
   cross-user isolation test (033 already ships one). (Unlike A, tenancy is not a hand-written predicate.)
5. **INV-5 Real-money double-gate** — mainnet needs (a) the user's action AND (b) an **operator** approval
   written under the operator's own admin identity (naturally independent — no shared key).
6. **INV-6 Least blast radius** — connected key `pending_validation`, no-withdrawal, spot,
   `trading_enabled=false`.
7. **INV-7 Fail-closed** everywhere; **INV-8 user kill path** = the JWT-gated `user_pause_own_bot` (works as
   long as Supabase is up — no dependence on StrateTeach's backend).

---

## 3. Architecture

### 3.1 Shared Supabase Auth
StrateTeach's login points at Praxis's Supabase project. A user signs in via Supabase Auth (email+password /
magic link) and receives a JWT. Roles: a normal user has no special claim; the **operator** has the existing
Praxis operator role (`operator_status`), used for mainnet approval + kill.

### 3.2 Migrating the existing handful of users (one-time)
For each current StrateTeach user: create an `auth.users` record (Supabase admin), set their email, and
send a **password-set / magic-link** invite (we never migrate password hashes — different scheme). Map the
old `username` → the new `auth.uid()` once (§3.4). Because it's a handful of users, this is a short,
supervised migration, not a bulk job. Done-condition: every active user can log in via Supabase and reach
their data; the old opaque-token path is disabled.

### 3.3 StrateTeach backend verifies the Supabase JWT (not its own token)
`app/core/security.py` `current_user()` changes from an `auth_sessions` lookup to **verifying the Supabase
JWT** (signature via the project JWKS, `exp`, `aud`, issuer) and reading `sub` = `auth.uid()`. This also
**fixes the immortal-token weakness** (A's T6/D1): JWTs expire and refresh natively. The opaque
`auth_sessions` table is retired.

### 3.4 Re-keying StrateTeach's app data (the real C1 work)
StrateTeach's own Postgres tables key on `username` (strategies, legacy bots, billing, etc.). C1 adds a
stable `auth_uid UUID` to the StrateTeach user record and either (a) re-keys app tables to `auth_uid`, or
(b) keeps `username` as a stable alias resolved from `auth_uid` at the edge. For a handful of users, (a) is
clean; the doc's slice specifies the exact column-by-column plan + a verification query. **This is the main
cost of C1** and the audit must scrutinize it (no row orphaned, no cross-user leak during cutover).

### 3.5 Browser → Praxis directly with the JWT
- **create-bot / connect-credential:** flip to `verify_jwt=true`; set `user_id = auth.uid()` (delete the
  ticket param + all ticket verification). Key still goes browser→Praxis only, now authed by the user's JWT.
  Safe defaults unchanged (`trading_enabled=false`, `pending_setup`, body-signing required, spot-only).
- **status + kill:** browser calls `user_bot_dashboard()` / `user_pause_own_bot()` (033) directly — no
  bridge. Kill works whenever Supabase is up (INV-8).
- **live balances/positions:** still the net-new subsystem (§3.8).

### 3.6 Mainnet double-gate (independent by construction)
Mainnet credential requires: (a) the user connecting it, AND (b) an **operator approval** — a row written by
the operator acting under their **own operator identity/role** (RLS: only `operator_status` may insert into
`mainnet_provision_approvals(user_id, bot_id)`). `connect-credential` checks that row for `env=mainnet`
before storing the key. No shared key, no forgeable approval — the independence A struggled for is native
here. Downgrade = revoke (revoke-first ordering / single RPC). Until the approval path ships, a fail-closed
`env=mainnet` rejection stays in connect-credential.

### 3.7 Validate + arm (carried from A)
- **Validate — blocked on EP6** (`validate-credential`, trade-only/withdrawals-off). Testnet may
  auto-validate via EP6; mainnet operator-only. Own slice + done-condition.
- **Arm** — an RLS-gated action (`trading_enabled=true`) only when credential is `valid`; mainnet also needs
  a live approval row. With real RLS + JWT, this can be a policy-checked RPC (`user_arm_own_bot`) rather than
  a bespoke Edge fn — simpler than A.

### 3.8 Live balances / positions / PnL (net-new; owed under A and C alike)
The worker is a headless pgmq consumer; a Postgres RPC can't reach an exchange. Options (choose in its slice
with a written sub-design + latency/staleness budget + egress/isolation risk line): (i) pgmq request/reply
job serviced by the worker; (ii) a small authed worker HTTP surface; (iii) an Edge fn running ccxt against
Vault via the A1 static-egress allowlist (widens the key boundary — assess). Protective-orders/withdraw have
no Praxis equivalent; UI degrades honestly. **Deferred; off the testnet-connect critical path.**

### 3.9 Offboarding across all FOUR legacy key stores
`exchange_config.api_key_enc`, `autopilot_exchange_keys` (Fernet, `db:1261`), `bots.enc_*` (`db:610-627`),
`exchange_creds_backup.enc_*` (`db:723-732`). Account deletion: revoke Praxis credentials + delete Vault
secrets (delayed/reversible), destroy all four legacy stores, delete the Supabase auth user (or disable).
Inventory query = done-condition. GDPR erasure covers PII, not just keys.

### 3.10 Venue selection — reconcile `is_active`
Pick-list = `exchanges WHERE is_active=true` (today: binance only). `connect-credential` MUST reject
`is_active=false` venues (`:49` lacks the check). Adding a venue = flip `is_active` + worker allowlist
(EP1b two-layer gate).

### 3.11 Audit logging
Append-only `provisioning_audit` for connect / approve_mainnet / arm / rotate / revoke / offboard: event,
`user_id`, `bot_id`, actor, timestamp, non-secret meta.

---

## 4. Open JWT-mechanism decision (operator deferred to the audit)
- **C1-direct (RECOMMENDED): the browser logs into Supabase Auth directly.** One real identity; StrateTeach
  never mints identities; cleanest trust posture.
- **C2 (NOT recommended): StrateTeach mints Praxis JWTs.** Lighter, but StrateTeach then holds a
  JWT-**minting** secret = it can assert ANY user's identity — the SAME shared-secret blast radius C1 is
  chosen to escape. Included only so the audit can rule on it explicitly.
The design assumes **C1-direct**; the audit is asked to confirm or refute.

---

## 5. Threat model (much smaller than A)
| # | Threat | Mitigation |
|---|---|---|
| C1-T1 | Forged/leaked JWT | Verify signature (JWKS) + `exp` + `aud` + issuer in `current_user` AND Praxis (`verify_jwt=true`). Native expiry/refresh (fixes A's immortal tokens). |
| C1-T2 | IDOR | `auth.uid()` from the verified JWT + RLS on every user table/RPC + the existing 033 cross-user isolation test (INV-4). |
| C1-T3 | Auth migration errors (few users) | supervised migration; per-user verification; old token path disabled only after each user confirms login. |
| C1-T4 | RLS gap on a user-facing table | audit every table/RPC for an `auth.uid()` policy + isolation test; connect-credential/create-bot run `verify_jwt=true`. |
| C1-T5 | Mainnet self-approval | approval writable only under the operator role (RLS), independent of the user JWT (INV-5). |
| C1-T6 | Key still in browser path | unchanged from A — key browser→Praxis only, now JWT-authed; never logged. |
| C1-T7 | Operator account compromise | operator MFA + the approval is audit-logged; Praxis go-live blockers still apply. |
| C1-T8 | Live-balance subsystem widens key boundary (option iii) | assessed in its slice; prefer pgmq req/reply. |

*(A's T1/T2/T7/T15/T16 — shared-bridge-key forgery, deprovision mass-wipe, st_ref reversal, restore
resurrection — do not exist under C1: there is no bridge key and no st_ref.)*

## 6. Implementation slices (gated/dormant; testable done-conditions; real-funds NO-GO)
- **S1** Shared auth: StrateTeach login → Supabase Auth; `current_user()` verifies the Supabase JWT; retire
  opaque `auth_sessions`. *Done:* a user logs in via Supabase and StrateTeach authorizes them by JWT; expired
  JWT is rejected.
- **S2** Migrate the existing handful of users + `auth_uid` mapping + re-key app data (§3.4). *Done:* every
  active user reaches all their prior data under their new identity; a verification query shows zero orphans.
- **S3** Flip `create-bot`/`connect-credential` to `verify_jwt=true` + `auth.uid()`; delete the ticket layer;
  add the `is_active` + fail-closed `env=mainnet` guards. *Done:* browser creates a bot + connects a testnet
  key with only its JWT; a mainnet/inactive-venue connect is rejected; cross-user attempt fails via RLS.
- **S4** Frontend (existing StrateTeach dashboard) rewire: Supabase login + the connect/bot/status/kill flow
  against Praxis with the JWT; honest degradation of legacy live-read panels. *Done:* end-to-end connect +
  self-kill in the UI on testnet.
- **S5** Mainnet double-gate: `mainnet_provision_approvals` (per-bot, operator-RLS-write) + connect gate +
  revoke-on-downgrade. **mainnet gate.**
- **S6** Validate (EP6 dep) + arm (`user_arm_own_bot` RPC). *Done:* valid→armed only via the policy path.
- **S7** Live-balance subsystem (choose i/ii/iii + sub-design). **deferred; off testnet path.**
- **S8** Offboarding (all 4 legacy stores) + GDPR delete. **S9** Audit logging + alerting. **mainnet gates.**
- **Consolidated mainnet gate:** S5 ∧ S6-mainnet ∧ S9 ∧ Praxis A1/A4/A11 ∧ tiny-live. Testnet (S1–S4) needs
  none.

## 7. Open decisions
1. JWT mechanism: **C1-direct** (assumed/recommended) vs C2 (audit to rule) — §4.
2. App-data re-key: re-key to `auth_uid` vs `username` alias (§3.4) — audit to weigh for the handful of users.
3. Live-balance path (§3.8-i/ii/iii).
4. Existing-user migration timing (all at once, given it's a handful).

## 8. What we keep from the A work
The three A audit rounds were not wasted: they *proved* why the shadow/ticket model is costly and dangerous
(that evidence justified C1), and every identity-independent finding (live-balance reality, validate/arm
gap, the 4 legacy key stores, venue `is_active`, audit logging, mainnet-gate concept) carries directly into
the slices above.
