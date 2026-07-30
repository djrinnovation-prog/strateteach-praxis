# Phase 2C — Identity & Provisioning Architecture (StrateTeach ↔ Praxis)

**Status: DESIGN v3.1 — COMPLETED 3 adversarial audit rounds (9 reviewer passes, 3 lenses × 3 rounds).**
Pre-implementation; NO code until the operator signs off on the open decisions below.
**Unanimous round-3 verdict: GO to build the early TESTNET identity plumbing (S0–S2, S4a) after two
pre-code fixes (the `user_uid` immutability-trigger form §4.1, and the R3-F0 `connect-credential` fail-close
§4.9, both folded in); NO-GO on the mainnet path** until Open Decisions #1 (Option A/C1/C2) and #7
(independent mainnet-approval authority) are made and S3/S9/S10 land. All round-1/round-2 BLOCKERs are
CLOSED. Scope target: correct + secure at **1,000 users**. Real-funds NO-GO throughout.

> v3 changelog (from 2 audit rounds, 6 adversarial reviewers): (1) identity root now enforced by
> **`UNIQUE` + immutability trigger + single-statement migration** (was a comment); (2) the real-money
> approval and the destructive `deprovision` no longer trust the bridge HMAC key — they require an
> **independent operator authority** (the shared-key "double gate" collapse and the forgeable-wipe BLOCKERs);
> (3) `mainnet_provision_approvals` PK bug fixed (strictly per-bot); (4) reads use a **multi-use scoped
> token**, not single-use tickets; (5) `provision-user` honors `disabled` + concurrent-insert races; (6) the
> **live-read subsystem** is called out as net-new execution-adjacent work, not an "RPC"; (7) **arm** and
> **validate** specified/deferred honestly; (8) offboarding is a real **cross-DB GDPR state machine**
> covering **both** legacy key stores; (9) venue `is_active` reconciliation; (10) audit-logging + concrete
> alerting. Traceability: Appendix A (round 1), Appendix B (round 2).

---

## 0. Assumptions (defaults; CORRECT if wrong)
- **A1** Praxis invisible to the end-user (one brand, one StrateTeach login). → shadow Praxis identity.
- **A2** Self-serve **testnet**; **mainnet requires explicit operator approval**, enforced in BOTH systems
  with **independent** authority (not the same signing key).
- **A3** Every user brings their OWN exchange key. No pooled custody.
- **A4** StrateTeach backend holds the ticket-signing key only; **never** Praxis `service_role`, Vault, or an
  exchange key. Privileged Praxis writes happen inside ticket-gated Edge functions — **except** destructive
  and mainnet-approval actions, which need a second, independent authority (§4.9/§4.10).

> **META DECISION the audits surfaced (see §10):** Option A (shadow users) keeps accumulating net-new
> subsystems (read bridge, st_ref/user_uid machinery, shared-key risk) *specifically because it denies users
> a Praxis identity/JWT*. **Option C (shared Supabase Auth — the StrateTeach user IS the Praxis auth user)**
> would delete much of §4.8/§4.2/§4.3 by letting the browser use a real JWT with existing RLS. This doc
> fully specifies A (the assumed path) but flags C as a serious alternative to weigh before S0.

---

## 1. Problem & ground truth
Bridge two identity models so the browser POSTs an exchange key straight to Praxis, authorised by a
StrateTeach-signed ticket carrying a `praxis_user_id` Praxis trusts as owner.

| | StrateTeach | Praxis |
|---|---|---|
| Auth | opaque bearer → `auth_sessions` (no JWT, **no expiry column** — immortal tokens) | Supabase Auth JWT |
| User id | `username` TEXT PK, **recyclable** (hard-delete + reissue) | `auth.users.id` UUID |
| Tenancy | app-level `WHERE username=` (**no RLS**) | RLS on `auth.uid()` **but bypassed here** (§3.1) |

**Verified (both rounds):** ticket verify `_shared/provision-ticket.ts` (one pepper-derived HMAC key, all
actions share it, `provision-ticket.ts:23,47-54`). IDOR + single-use `connect-credential/index.ts:44-58,73-91`;
`create-bot/index.ts:56-98` (**no per-user bot cap**). Praxis identity+FK `bots.user_id UUID NOT NULL
REFERENCES auth.users(id) ON DELETE RESTRICT` (`001:187`); profiles trigger `002` inserts only `(id)` and
does **not** read metadata; user RPCs `auth.uid()`-gated (`033`, `user_pause_own_bot` exists but JWT-gated).
Only `binance` seeded `is_active=true` (`001:648`, `037` adds more but false); `connect-credential:49` does
**not** check `is_active`. StrateTeach: `users(username PK)` no UUID, no RLS; `delete_user` hard-deletes
against StrateTeach's OWN DB (`database.py:1624`, called from admin `auth.py:572` AND self-serve GDPR
`auth.py:761`); `unique_username` blocks name reuse at signup (`database.py:7383`); `auth_sessions ON DELETE
CASCADE` only fires on row delete (`database.py:166`). **Two** legacy key stores: `exchange_config.api_key_enc`
(`exchange.py:291`) AND `autopilot_exchange_keys` (Fernet, `database.py:1261`). Worker is a **headless pgmq
consumer** — no HTTP surface; `fetchBalance`/`fetchPositions` exist (`BinanceAdapter.ts:376,626`) but only
inside the order pipeline. No `validate-credential`/arm Edge fn exists (`ls supabase/functions/`).

---

## 2. Invariants
1. **INV-1 Server-derived identity** — never from a request field.
2. **INV-2 Immutable, unique, non-recyclable root** — enforced by DB `UNIQUE` + an immutability trigger,
   not by comment (§4.1).
3. **INV-3 Key isolation** — exchange key browser→Praxis only.
4. **INV-4 No service_role / exchange key in StrateTeach.**
5. **INV-5 Fail-closed.**
6. **INV-6 Real-money double-gate with INDEPENDENT authorities** — mainnet needs StrateTeach `praxis_env`
   AND a Praxis approval **signed by a separate operator authority**, not the bridge ticket key (§4.9).
7. **INV-7 Least blast radius** — `pending_validation`, no-withdrawal, spot, `trading_enabled=false`.
8. **INV-8 User kill path that does NOT depend on StrateTeach liveness** (§4.8).
9. **INV-9 Tenancy = the Edge `WHERE user_id=` predicates, with a drop-the-filter regression test** (no RLS
   backstop, §3.1).
10. **INV-10 Destructive & approval actions require an independent authority + are reversible/rate-limited**
    (§4.9/§4.10) — the shared bridge key must never be sufficient for irreversible loss or self-approval.

---

## 3. Identity model — Option A (shadow user), with the RLS reality stated
### 3.1 RLS is bypassed for this whole feature
All Edge fns run as `service_role` (bypass RLS); the browser has no JWT. The real trust boundary is (a)
ticket/authority verification + (b) hand-written `WHERE user_id = …praxis_user_id`. Every such predicate is
load-bearing and MUST have a regression test that fails if the `.eq("user_id", …)` filter is removed (INV-9).

---

## 4. Architecture

### 4.1 Data model (constraints are real, not comments)
**StrateTeach `users`** — single-statement, idempotent migrations (CHECK inline; **no separate `UPDATE`
backfill** — the volatile `DEFAULT` fills existing rows atomically in the table rewrite):
- `user_uid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid()` — immutable identity root. Add a **`BEFORE
  UPDATE` trigger** that raises if `NEW.user_uid <> OLD.user_uid`. **No INSERT path may pass `user_uid`**
  (DB default only — column-level REVOKE won't bite StrateTeach's single-role app, so this is enforced by
  code review of every signup/admin/import path, plus UNIQUE + the trigger for post-insert tampering).
  **Trigger idempotency (R3-CRITICAL):** `bootstrap()` re-runs every migration each boot in ONE
  transaction, so a bare `CREATE TRIGGER` throws on the 2nd boot and bricks startup. Use **`CREATE OR
  REPLACE TRIGGER`** (Postgres ≥14) OR a `DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE
  tgname=…) … $$` guard. **Confirm before S0:** the StrateTeach Postgres version (for `CREATE OR REPLACE
  TRIGGER`) and `gen_random_uuid()` availability (PG13 core, else `pgcrypto`).
- `praxis_user_id UUID NULL UNIQUE`, `praxis_env TEXT NOT NULL DEFAULT 'none' CHECK (praxis_env IN
  ('none','testnet','mainnet'))`, `praxis_linked_at timestamptz`, `status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active','deprovisioned'))`.

**Praxis** (service_role only, RLS deny-all):
- `strateteach_user_link(st_ref TEXT PK, praxis_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')), created_at)`.
- `mainnet_provision_approvals(praxis_user_id UUID NOT NULL, praxis_bot_id UUID NOT NULL REFERENCES bots(id),
  approved_by TEXT NOT NULL, approved_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(praxis_user_id,
  praxis_bot_id))` — **strictly per-bot** (fixes the NULL-in-PK bug; one approval ≠ many mainnet bots). A
  user-level pre-authorization, if ever wanted, is a **separate boolean**, never a NULL PK member.
- `provisioning_audit(id, event, praxis_user_id, praxis_bot_id, actor, at, meta jsonb)` — append-only
  (§4.14).

### 4.2 `st_ref` — rooted in the enforced-immutable surrogate
`st_ref = base64url(HMAC(PROVISION_KEY, "praxis.stref.v1|" + user_uid))`, computed server-side from
`current_user()`→`users.user_uid`. Since `user_uid` is `UNIQUE`+trigger-immutable+DB-generated, no
freed/renamed username can resolve to a prior identity. `st_ref` is a **keyed pseudonym — reversible by any
key-holder** (not relied on for privacy). **Operational rule:** any StrateTeach DB restore/snapshot-merge
triggers a Praxis link reconciliation (a restore could resurrect an old `user_uid`; the tombstone lives in a
restorable table, so it cannot be the sole guard — T16).

### 4.3 `provision-user` Edge fn (idempotent, disabled-safe, race-safe)
`verify_jwt=false`, ticket-gated. Flow:
1. `verifyTicket(…, "provision_user")` — sig + freshness + single-use jti + **strict `st_ref` format**
   (`^[A-Za-z0-9_-]{43}$`), `praxis_user_id` NOT required for this action (§4.4).
2. Look up `strateteach_user_link.st_ref`. If found & `status='active'` → return its `praxis_user_id`
   (200 `already_linked`). **If found & `status='disabled'` → `403 identity_disabled`** (re-enable is an
   explicit, separately-authorized operator action — never silent re-link).
3. Else `auth.admin.createUser({ email: "st-"+HEX(HMAC…)+"@users.nologin.<owned-domain>",
   email_confirm:true, password:<32 random bytes>, user_metadata:{ source:"strateteach", st_ref }})`. **Email
   local-part is a case-INSENSITIVE encoding (hex/base32), not base64url** (auth providers case-fold emails).
   Then `INSERT … ON CONFLICT (st_ref) DO NOTHING`, re-select, return the `praxis_user_id`.
4. **Reconcile (self-heal):** on `createUser` duplicate-email (crash after createUser, before link) → look up
   by that deterministic email, `INSERT link ON CONFLICT DO NOTHING`, return. Idempotency rests on the
   **deterministic email + `st_ref` PK** (NOT `praxis_user_id`, which is fresh-random). Both insert sites use
   `ON CONFLICT DO NOTHING` + re-select, so concurrent calls converge with no spurious 500.
- `env` is NOT in this ticket (shadow identity is env-agnostic). The `002` profiles trigger will create a
  `trialing` profile; since it can't read metadata, a follow-up marks these rows (`profiles.is_shadow=true`
  via a small trigger change or post-write) so billing/affiliate queries can exclude them.

### 4.4 `verifyTicket` — table-driven, default-deny per action
Extend `TicketAction` with `provision_user | read_status | pause_bot | rotate_credential | arm_bot |
deprovision_user`. Replace the ad-hoc checks with a **per-action field schema** (default-deny): each action
lists required fields + formats; `provision_user` requires `st_ref` (not `praxis_user_id`); the rest keep
requiring `praxis_user_id`; action-binding already blocks cross-action replay. (Destructive/approval actions
additionally require the independent authority of §4.9/§4.10 — a valid ticket is necessary but not
sufficient for them.)

### 4.5 StrateTeach ticket-issuing routes (sole bridge trust boundary; all behind `current_user`)
`app/api/routes/praxis_provision.py`, flag `PRAXIS_PROVISION_ENABLED` (default off), per-user+per-IP rate
limits in a **shared store** (DB/Redis — multi-instance-safe):
- `POST /praxis/link` → idempotent provision-user; store `praxis_user_id`.
- `POST /praxis/bot-ticket` → `create_bot_ticket(praxis_user_id)`.
- `POST /praxis/credential-ticket {bot_id, exchange, env}` → venue allowlist (§4.13) + env gate
  (`env=mainnet` needs `users.praxis_env='mainnet'`) → `connect_credential_ticket(...)`.
- All derive `praxis_user_id` from the session (INV-1).

### 4.6 Browser write flow
`/praxis/link` → `/praxis/bot-ticket` → Praxis `create-bot` (returns `bot_id` + `url_token` shown ONCE — UI
must surface it for the TradingView alert, then unrecoverable) → `/praxis/credential-ticket` → Praxis
`connect-credential` (**key only here**).

### 4.7 Validate + arm (so the happy-path yields a tradeable bot)
- **Validate — BLOCKED on external EP6.** No `validate-credential` Edge fn exists today. This design
  *depends* on it; its slice (S5) has done-condition "credential flips `valid` only after EP6 trade-only /
  withdrawals-off proof." **Testnet-validate is on the critical path to a tradeable testnet bot and needs
  its own concrete step** (S5 done-condition covers it; a bot cannot be armed until valid) — do not leave
  it as "may auto-validate." Mainnet validate is operator-only.
- **Arm — specified (net-new).** New `arm-bot` Edge fn, `action:"arm_bot"`, ownership predicate `WHERE id=?
  AND user_id=ticket.praxis_user_id`, flips `trading_enabled=true` ONLY if the credential is `valid`; mainnet
  additionally requires a live `mainnet_provision_approvals` row. Never automatic. (Under Option A the browser
  has no JWT, so the existing RLS owner-UPDATE path — which `034` still permits on an unlocked bot — is
  unreachable; arming is solely this ownership-checked Edge fn. `027` only blocks re-enable when
  `operator_locked` — it did NOT remove the arm path; the v2 claim was imprecise.)

### 4.8 Read / control bridge — split by risk
- **4.8a Status + kill/pause (build WITH connect — INV-8):** `bot-status` / `credential-status` (read) and
  `pause-bot` (control) Edge fns keyed by `praxis_user_id`, each with the INV-9 ownership predicate + a
  drop-the-filter regression test. **Reads use a short-lived, MULTI-use scoped read token (bounded by `exp`
  only, NO jti claim)** — single-use is wrong for polling (retry-breakage + ledger write-amplification);
  single-use stays for state-changing actions only. `pause-bot` reuses the existing `user_pause_own_bot`
  logic (033), re-exposed keyed by `praxis_user_id`. **Kill independence (INV-8):** additionally issue the
  user a **long-lived per-bot pause token** they hold, so a StrateTeach outage never removes their stop; the
  operator kill (A8-H2) remains independent. Hard global rate-limit on `pause-bot` and reads (forged-key DoS).
- **4.8b Live balances / positions / PnL (net-new execution-adjacent subsystem — NOT an "RPC"):** the worker
  is a headless pgmq consumer and a Postgres RPC cannot reach an exchange. Options, to be chosen in S4b with
  a written sub-design: (i) a pgmq **request/reply** job type (`read_balance`) the worker services, with a
  reply row + latency/staleness budget; (ii) a small authenticated worker HTTP surface; (iii) an Edge fn
  running ccxt against Vault through the A1 static-egress allowlist — **which widens the key-isolation
  boundary INV-3/INV-4 keeps narrow** and must be risk-assessed. **Protective-orders and withdraw have NO
  Praxis equivalent** (withdraw stays prohibited; protective legs are deferred EP-protective). The UI must
  **degrade honestly** per panel (label "managed by Praxis / balance via exchange app" rather than showing
  empty or errored numbers). This subsystem is explicitly **deferred** with its own slice + done-condition;
  it does not block testnet connect + status + kill.

### 4.9 Mainnet double-gate — INDEPENDENT authorities (INV-6/INV-10)
For `env==='mainnet'`, `connect-credential` verifies a `mainnet_provision_approvals` row for
`(praxis_user_id, bot_id)` BEFORE storing the key. Crucially, that approval is **written by an authority
independent of the bridge ticket key** — options: a real operator Supabase session (RLS/`require_owner`
server-side), a **distinct approval-signing key** held only by the operator surface, or a manual
Supabase-console/service write. A stolen `PRAXIS_PROVISION_KEY_HEX`/pepper thus cannot self-approve. The
StrateTeach `require_owner` endpoint also sets `users.praxis_env` and records the approval. **Downgrade
(mainnet→testnet) is a real REVOKE (§4.11):** since supabase-js has no multi-statement transaction, use
**revoke-first ordering** (set affected credentials `status='revoked'`, `trading_enabled=false` **before**
deleting the `mainnet_provision_approvals` row) — or a single Postgres RPC — so a mid-operation crash fails
safe (never a live mainnet key with its approval already gone). **Re-upgrade requires a fresh approval**.
**Ordering + edge fail-close (R3-F0):** the Praxis-side gate MUST land before `praxis_env='mainnet'` is
reachable. Because a bridge-ticket holder can craft `env:"mainnet"` directly and today's `connect-credential`
has neither the approval check nor an `is_active` check, **ship a one-line fail-closed guard WITH S1**:
`connect-credential` rejects `env==='mainnet'` (until the S3 approval gate exists) and rejects
`is_active=false` venues (§4.13). This turns "mainnet unreachable" from an assumption about ticket provenance
into a real Praxis-edge boundary. Separately, the `require_owner` setter that can write `praxis_env='mainnet'`
must never ship before S3 (explicit release gate).

### 4.10 Offboarding / deprovision — a real cross-DB GDPR state machine (INV-10)
The `ON DELETE RESTRICT` FK is inside Praxis and does NOT stop StrateTeach's `DELETE FROM users`. So:
- **Gate both `delete_user` call sites** (admin `auth.py:572`, self-serve GDPR `auth.py:761`) on
  `praxis_user_id IS NULL`; a provisioned account routes to the **soft path** instead of hard delete.
  **Pull this gate forward to co-ship with S2** (not S8): the moment S2 populates `praxis_user_id` and users
  connect, an un-gated hard delete orphans live Praxis key state (T12). (T4 inheritance is already closed by
  S0's immutable `user_uid`, so recycle isn't the risk here — orphaned key accumulation is.)
- **Soft-teardown state machine:** set `users.status='deprovisioned'`; set `password_hash` to an **unusable
  sentinel `''`** — NOT NULL, because `users.password_hash` is `NOT NULL` (`:159`); `verify_password('',…)`
  already returns False (`auth.py:29-38`) so login is impossible. **`DELETE FROM auth_sessions WHERE
  username=…`** (immortal tokens don't cascade under soft-delete). **Anonymize PII** (email/phone/name).
  Keep only `username` (tombstone) + `user_uid`↔`praxis_user_id`. Then call Praxis `deprovision-user`.
  (Anti-recycle depends on `get_user`/`unique_username` continuing to SEE the tombstone — add a test so a
  future `WHERE status='active'` filter can't silently reopen recycle.)
- **`deprovision-user` is destructive → INV-10:** it needs the **independent operator authority** (not the
  bridge key alone — a forged bridge ticket must NOT wipe keys), a **hard global rate-limit + alert-BEFORE
  execute**, and **reversible/delayed Vault deletion** (retire the secret + revoke credential now; physically
  delete after N days) so an erroneous/forged wipe can be recovered. It sets `strateteach_user_link.status=
  'disabled'` (→ provision-user returns 403, §4.3), revokes credentials, and moves bots to a **terminal**
  state (not `paused`, so they can't be resurrected). Covers **both** legacy stores is a StrateTeach concern
  (below).
- **Legacy keys — there are FOUR stores, not two (R3 correction):** the soft path must destroy the
  encrypted keys in ALL of `exchange_config.api_key_enc`, `autopilot_exchange_keys` (Fernet, `:1261`),
  **`bots.enc_key/enc_secret/enc_passphrase`** (Signal-bot per-bot store, `:610-627`), and
  **`exchange_creds_backup.enc_key/…`** (`:723-732`). A live inventory query over all four is the
  done-condition; missing any makes "keys destroyed" false. (Re-audit for new stores before S8.)
- GDPR: erasure covers PII, not only keys — hence the anonymize step; the retained tombstone (`username`,
  uid mapping) is the documented legal-basis minimum.

### 4.11 Rotation & revoke (distinct)
- `rotate-credential` Edge fn (`action:"rotate_credential"`): CAS-replace the Vault secret for the bot's
  credential, set `pending_validation`, delete the OLD Vault secret LAST.
- `revoke-credential` (used by downgrade §4.9 and offboarding): set credential `status='revoked'`,
  `trading_enabled=false`, retire Vault secret (delayed delete). **These are different operations** — the v2
  doc conflated downgrade with rotate.

### 4.12 Existing-base coexistence
Legacy users hold keys across **all four** stores of §4.10; M4 already refuses new legacy connects. Runbook
slice: (a) prompt existing users to re-connect via the Praxis flow (no automated key migration — re-entered,
born in Vault); (b) destroy legacy keys in **all four** stores after re-connect or by deadline; (c) pause
legacy-engine bots (M4) and recreate as Praxis bots.

### 4.13 Venue selection (reconcile `is_active`)
Pick-list = `exchanges WHERE is_active=true` (today: **binance only**). `connect-credential` MUST reject a
credential for an `is_active=false` venue (add the check — `:49` lacks it). Adding a venue is a deliberate
operator step: flip `is_active` **and** the worker allowlist (matches the EP1b two-layer gate).

### 4.14 Audit logging (all privileged events)
`provisioning_audit` append-only row for every `provision / approve_mainnet / arm / rotate / revoke /
deprovision` event: event type, `praxis_user_id`, `praxis_bot_id`, actor/authority, timestamp, non-secret
`meta`. No secrets/keys. Required for post-incident forensics on cross-tenant-capable actions.

---

## 5. Threat model (v3)
| # | Threat | Mitigation |
|---|---|---|
| T1 | Forged bridge ticket (`PRAXIS_PROVISION_KEY_HEX`) | HMAC key not in browser; bounded by INV-7; destructive/approval actions need INV-10 independent authority; anomaly alerting (§5.1) is a **hard mainnet gate**. |
| T2 | Pepper compromise (2nd forgery vector; also signs webhook tokens) | Pepper Edge-only; rotate both on one runbook; documented residual (shared-secret bridge). |
| T3 | IDOR | server-derived id (INV-1) + Praxis `WHERE user_id=` recheck + regression test (INV-9). |
| T4 | **Username recycle/rename → inheritance** (R1 BLOCKER) | immutable **UNIQUE** `user_uid` + immutability trigger + tombstone + deprovision (§4.1/4.2/4.10). |
| T5 | Replay | single-use jti (state-changing only) + `exp`≤300s + action-bound. |
| T6 | Stolen StrateTeach session (immortal tokens) | Dependency **D1** (expiry/rotation/step-up) required before mainnet; testnet-only until then. |
| T7 | `st_ref` de-anonymization | keyed pseudonym, reversible by key-holder — not relied on for privacy. |
| T8 | **Mainnet key provisioned unapproved** | double-gate with **independent** authorities (INV-6/§4.9) — stolen bridge key can't self-approve. |
| T9 | Provision race / partial failure | deterministic (case-insensitive) email + `st_ref` PK + `ON CONFLICT DO NOTHING` re-select; reconcile self-heals. |
| T10 | Dropped `.eq("user_id")` | INV-9 regression tests (no RLS backstop). |
| T11 | Malformed `st_ref` → createUser | strict `^[A-Za-z0-9_-]{43}$` (§4.4). |
| T12 | Deletion leaves live key | soft teardown destroys **both** legacy stores + Vault (delayed) (§4.10/4.12). |
| T13 | CORS `*` default | pin `CONNECT_ALLOWED_ORIGIN`; hard config check. |
| T14 | Synthetic email domain routable → reset-login | owned/unroutable domain; disable password grant for shadow users. |
| T15 | **`deprovision-user` = forgeable mass-wipe** (R2 BLOCKER) | INV-10: independent authority + reversible/delayed delete + global rate-limit + alert-before. |
| T16 | **DB restore/merge resurrects `user_uid`→st_ref→identity** | restore triggers Praxis link reconciliation (§4.2); tombstone not the sole guard. |
| T17 | Re-provision returns a disabled identity | `status='disabled'` → 403 (§4.3). |
| T18 | Forged read/pause tokens (DoS / exfil) | ownership predicate + hard global rate-limit; kill path independent of StrateTeach (INV-8). |

### 5.1 Alerting spec (mainnet gate, was vapor)
Metric: bridge-ticket verifications/min per action + provision/approve/deprovision counts. Threshold: static +
rate-anomaly per action (e.g. any `deprovision` > N/hour, any `approve_mainnet` at all pages the operator).
Sink: the ops alert channel; page target: operator on-call. This is a **required precondition to enabling
mainnet**, not advisory.

## 6. Scale to 1,000 users
Trivial volumes. `provision_tickets_used` cleanup = `used_at < now() - (MAX_TICKET_TTL_S + slack)` (039 has
`(jti, used_at)`, **no `exp`**). **Reads do NOT burn jti** (multi-use read token, §4.8a) — the ledger is
state-changing actions only. Rate-limit state in a shared store (global, not per-instance). **Add a per-user
bot cap** to `create-bot` (none today).

## 7. Failure modes (fail-closed)
Provision down → link fails, no downstream. Partial provision → self-heals (§4.3). Disabled identity → 403.
Mapping missing → 409. Ticket/authority fail → 401/403. connect-credential partial → existing rollback.
Deprovision partial → idempotent retries; deletes are delayed/reversible.

## 8. Implementation slices (each has a testable done-condition; gated/dormant; real funds NO-GO)
- **S0** StrateTeach `user_uid` (UNIQUE + immutability trigger + single-statement migration) + backfill-free.
  *Done:* every user row has a distinct uid; an `UPDATE user_uid` raises. **Prereq for all.**
- **S1** Praxis `provision-user` + `strateteach_user_link` + `provisioning_audit` + verifyTicket table-driven
  branch **+ the R3-F0 fail-closed guard in `connect-credential` (reject `env='mainnet'` and `is_active=false`
  venues)**. *Done:* Deno tests for reconcile, disabled→403, concurrent→one identity, malformed st_ref,
  ownership, AND a test that a `mainnet`/inactive-venue connect is rejected at the Praxis edge.
- **S2** StrateTeach `praxis_*` migration + `st_ref` from `user_uid` + `praxis_provision` router (flag +
  shared rate-limit). *Done:* pytest — server-side binding, env gate, no client `praxis_user_id`.
- **S3** Mainnet double-gate: `mainnet_provision_approvals` (per-bot) + connect-credential gate +
  **independent** operator approval authority + revoke on downgrade. *Done:* forged bridge ticket cannot
  self-approve (test); downgrade revokes.
- **S4a** Status + **kill/pause** Edge fns (multi-use read token; long-lived per-bot pause token) — **ships
  WITH connect**. *Done:* user can pause their bot with StrateTeach down; drop-the-filter test fails closed.
- **S4b** Live-balance subsystem (choose i/ii/iii + written sub-design + egress/isolation risk line).
  *Done:* a connected bot's live balance renders, or the panel degrades honestly. **Deferred; not on the
  testnet-connect critical path.**
- **S5** Validate (EP6, external dep) + `arm-bot` Edge fn. *Done:* a bot goes valid→armed only via the
  ownership-checked path; mainnet arm needs approval.
- **S6** Frontend rewire (#4c): 5-step connect + status/kill panels + honest legacy-panel degradation.
  *Done:* a user completes connect→bot→key→status→pause entirely in the UI; legacy live-read panels show a
  "managed by Praxis" state, never empty/errored numbers.
- **S7** `rotate-credential` + `revoke-credential` (distinct, §4.11). *Done:* rotate replaces the Vault
  secret (delete-old-last) → `pending_validation`; revoke sets `revoked`+`trading_enabled=false` and retires
  the secret; tests cover a crash between steps leaving no live-key-without-approval.
- **S8** Coexistence runbook (**all four** legacy stores, §4.10) + GDPR soft-delete state machine + gate both
  delete sites (already pulled to S2). *Done:* an inventory query returns zero live legacy ciphertext for a
  re-connected/offboarded user; a "deleted" user cannot log in and holds no keys.
- **S9** D1 StrateTeach session hardening (expiry/rotation/step-up). **mainnet gate.** *Done:* a session
  token expires + rotates; a step-up re-auth precedes any mainnet action.
- **S10** Audit logging (§4.14) + alerting (§5.1). **mainnet gate.** *Done:* every privileged event writes a
  `provisioning_audit` row; a synthetic deprovision/approve spike pages the operator.
- Also owed (assign to a slice, not floating): **per-user bot cap** in `create-bot` (§6), and the
  `profiles.is_shadow` marking (§4.3) that billing/affiliate queries filter on.

**Consolidated mainnet-readiness gate (ALL required before any mainnet enablement):** S3 (independent
approval authority chosen + Praxis-edge gate) ∧ S5 (validate + arm, mainnet needs approval) ∧ S9 (D1
sessions) ∧ S10 (audit + alerting) ∧ §5.1 alerting live ∧ Praxis's own go-live blockers (A1/A4/A11) ∧
tiny-live pilot. Testnet (S0–S2, S4a, S6) needs none of these.

## 9. Open decisions for the operator
1. **Option A vs C** (§10) — the biggest one. 2. A1 invisible? 3. A2 testnet self-serve / mainnet operator?
4. `/praxis/link` on first login vs first connect? 5. Read bridge: multi-use read token vs `report_ro` BFF?
6. Live balances: pgmq req/reply vs worker HTTP vs Edge-ccxt (§4.8b)? 7. Independent mainnet-approval
authority: operator Supabase session vs distinct key vs manual console? 8. Existing-user forced-reconnect
deadline? 9. D1 before mainnet, or testnet-only until then?

## 10. The Option A-vs-C reconsideration (audit-surfaced) — the biggest decision
Three rounds show Option A's cost concentrates in **denying users a Praxis identity/JWT**: that forces the
shadow `user_uid`/`st_ref` machinery (§4.2/§4.3, T4/T16), the multi-use read-token status/kill bridge
(§4.8a), and a shared-key trust model where destructive/approval actions need bolt-on independent
authorities (INV-10). **Option C = the StrateTeach user IS a Praxis identity (real JWT)** would delete
§4.2/§4.3 and §4.8a (the browser hits the existing `auth.uid()`-gated `033` RPCs directly for status/kill)
and make RLS a real backstop (softens INV-9).

**But C is two very different sub-variants — decide on THESE, not on "C":**
- **C1 — StrateTeach adopts Supabase Auth** (users become real `auth.users`, StrateTeach delegates
  login/session/2FA to Supabase). *Best trust posture* (no shadow machinery, no bridge JWT-minting, RLS
  real). *Cost UNDER-sold as "one-time":* migrating a live `users(username PK)` + immortal-`auth_sessions`
  base and rewriting every `current_user` check is a **large, risky lift on existing users** — effectively
  folds in the D1 session-hardening too.
- **C2 — StrateTeach mints Praxis JWTs** for its users. *Lighter lift*, but StrateTeach then holds a
  JWT-**minting** capability = it can assert ANY user's identity — the **same shared-secret blast radius**
  that is the headline argument *against* Option A. **C2 does not escape A's core critique.**

**What C does NOT remove:** the **§4.8b live-balance subsystem is owed under A *and* C** — a Postgres RPC
can't reach an exchange regardless of identity model. And INV-10 independent-authority for *mainnet
approval* is softened but not eliminated by C (a user's own JWT must still not self-approve mainnet).

**Recommendation:** weigh **A vs C1 vs C2** before committing S0 (S0 is the foundation of the entire A
machinery and expensive to unwind). If the product will ever want a single real login at scale (A1), **C1**
is likely less total work and less attack surface than A + all its bolt-ons — at the price of a bigger,
riskier up-front auth migration. **C2 is not recommended** (reintroduces the shared-secret risk). This is
Open Decision #1 and it gates everything.

---
## Appendix A — Round-1 findings → resolutions
*(unchanged from v2; identity-root, read-bridge, validate/arm, offboarding, mainnet gate, RLS oversell,
provision idempotency, jti cleanup — all carried into the v3 sections above.)*

## Appendix B — Round-2 findings → resolutions
**Security:** deprovision forgeable-wipe BLOCKER → INV-10 + §4.10 (T15). Double-gate shared-key BLOCKER →
§4.9 independent authority (T8). provision returns disabled → §4.3 403 (T17). downgrade≠revoke → §4.11 revoke
+ §4.9. user_uid no UNIQUE/immutability → §4.1 (T4). email case-fold → §4.3 hex/base32. read/pause DoS +
kill-needs-StrateTeach → §4.8a rate-limit + long-lived pause token (T18/INV-8). action sprawl / no bot cap →
§4.4 table-driven + §6 cap.
**Correctness:** mainnet PK NULL bug → §4.1 per-bot NOT NULL. provision disabled + concurrent insert →
§4.3 403 + ON CONFLICT. user_uid unenforced → §4.1 UNIQUE+trigger. single-use read token wrong → §4.8a
multi-use. migration two-phase trap → §4.1 single-statement. offboarding cross-DB + login-still-works +
sessions + GDPR → §4.10 state machine. pre-S3 window / downgrade re-upgrade / phantom profiles → §4.9
ordering + §4.3 is_shadow.
**Completeness:** live-read impossible-as-RPC → §4.8b net-new subsystem. validate+arm unbuilt → §4.7
(validate deferred/EP6, arm specified). second legacy key store → §4.10/4.12. venue is_active → §4.13.
S4 mis-scoped + no done-conditions → §8 S4a/S4b + per-slice done. audit log + alerting → §4.14 + §5.1.

## Appendix C — Round-3 findings → resolutions (final)
Round 3 found NO new exploitable BLOCKER; all round-1/2 BLOCKERs verified CLOSED. Applied fixes:
- **Security F0 (HIGH):** mainnet unreachable enforced at the Praxis edge, not just the router →
  `connect-credential` fail-closes `env='mainnet'` + `is_active=false`, shipped **with S1** (§4.9/§8).
- **Correctness #1 (HIGH, S0 boot-bricker):** `user_uid` immutability trigger must be idempotent under the
  per-boot one-transaction migration runner → `CREATE OR REPLACE TRIGGER` (PG≥14) or `pg_trigger`-guarded
  `DO`; confirm PG version + `gen_random_uuid()` before S0 (§4.1).
- **Correctness #2 (MED):** legacy key stores are **FOUR**, not two (added `bots.enc_*`,
  `exchange_creds_backup.enc_*`) → §4.10/§4.12.
- **Correctness #3 (MED):** `password_hash` is `NOT NULL` → soft-delete uses sentinel `''`, not NULL (§4.10).
- **Correctness #4 (MED, ordering):** gate both `delete_user` sites **co-ships with S2** (§4.10/§8).
- **Correctness #5 (LOW-MED):** downgrade "transactional" → **revoke-first ordering** / single RPC (§4.9).
- **Correctness #6/#7 (LOW):** anti-recycle tombstone test; mainnet-setter release gate (§4.10/§4.9).
- **Completeness F1 (decision quality):** Option C decomposed into **C1 (adopt Supabase Auth)** vs **C2
  (mint Praxis JWTs — reintroduces the shared-secret risk, not recommended)** (§10).
- **Completeness F2:** §4.8b live-balance is owed under **both** A and C (RPC can't reach an exchange) (§10).
- **Completeness F4:** done-conditions added to S6–S10 + a consolidated mainnet-readiness gate list (§8).
- **Completeness #2 (validate):** testnet-validate is on the critical path and owned by S5 (§4.7).
- **Factual:** the "027 removed the arm path" claim corrected — `027` only blocks re-enable under
  `operator_locked`; arming is unreachable under A because the browser has no JWT (§4.7).

**Still OPEN — operator decisions, not defects (correctly gate mainnet, not testnet):**
1. Option **A vs C1 vs C2** (§10) — gates S0. 2. The **independent mainnet-approval authority** (§4.9,
Open #7) — gates S3. Nothing on the testnet path (S0–S2, S4a, S6) is blocked by these.
