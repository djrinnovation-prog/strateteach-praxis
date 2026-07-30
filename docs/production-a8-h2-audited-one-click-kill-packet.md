# A8-H2 — Audited One-Click Kill (Operator Console) — Planning Packet

> **DOC / DESIGN + read-only discovery — NOT EXECUTION.** No code · no deploy · no DB mutation · no migration apply ·
> no Railway/Doppler change · no mainnet/real-funds. Nothing here is built or applied.
> **Rev 3 (2026-07-08): Codex round-2 CHANGES 1-5 applied** — `ok=true` **only** when fully clean (no open trades /
> no queued msgs); `queue_length>0` classified ATTENTION; **exact response contract** (§2a); denial-audit made
> unambiguous (denials not DB-audited, zero writes; authorized kills mandatory in-tx); **`p_hard_lock` default = `true`**
> (disable trading AND pause bots). (Rev 2 applied the prior 8.) **Returned for Codex re-review before implementation.**
> Grounded in actual repo/schema/operator-auth patterns (file:line cited). No invented endpoints.

## 0. What this slice is (and is not)
**A8-H2** (per `docs/production-a8-kill-path-readiness-packet.md:100-101`) = *"one-action hardened kill — Operator
Console guarded **kill-button / disable-all / custody-lock** with **audit + read-back**."* Today the Operator Console is
**read-only** (`frontend/src/components/StatusPanel.tsx`; only `operator_status()` read RPC exists) — there is **no**
operator mutation surface. H2 adds the **first audited operator *mutation*: a single guarded action that stops all
trading, writes an immutable audit row, and returns raw-read-back before/after.**

- **IS:** one audited, operator-gated, reversible **kill-all** that by default trips **both** proven, A10-PASS paths —
  KP1 `trading_enabled=false` (no new execution) **and** KP4 `status='paused'` (no new intake) — for all bots. Its
  response distinguishes `kill_applied` (flags set) from a clean `ok` (no residual open trades / queued msgs).
- **IS NOT:** KP5 credential/Vault destruction (broad blast radius) — that is **A8-H3**, explicitly out of scope here
  (§9). Not queue-arm/enable (that stays Oren-gated, never an MVP action). Not a real-funds trust gate by itself (§8).

## 1. Kill mechanisms this wraps (all A10-proven, code-cited)
| Path | Mechanism | Where honored (deployed code) | A10 evidence | Role in H2 |
|---|---|---|---|---|
| **KP1** | `bots.trading_enabled=false` | worker gate BEFORE adapter — `worker/src/index.ts:860` → `assertTradingEnabled` → `worker/src/sizingRisk.ts:166-167` throws `trading_disabled`; audited `order.blocked` at `worker/src/index.ts:823-827` | **K1 PASS** (2026-07-06): `order.blocked`, 0 trades | **Primary kill** — fastest (per-signal immediate), safest, reversible; column comment (`014_bot_sizing_risk.sql:42`): "FALSE = bot disabled (NOT misconfigured)" |
| **KP4** | `bots.status='paused'` | webhook intake reject `supabase/functions/webhook/index.ts:187-189` (`bot_not_active`, HTTP 200, no enqueue); worker skip `worker/src/index.ts:650-658` | **K4 PASS**: `webhook_logs=0`, queue unchanged, 0 trades | **Optional escalation** — hard intake lock (rejects NEW signals pre-enqueue); conflates "killed" vs "paused/misconfigured", so kept **separate/opt-in**, not the default primitive |
| KP2 | `QUEUE_ENABLED=false` + redeploy | worker boot gate `worker/src/index.ts:308-328,1473` | K2 PASS | **NOT in H2** — Doppler/Railway env, ~1-3 min redeploy, out-of-band (browser cannot flip env). Console can't do it. |
| KP3 | Railway worker stop | operational (dashboard) | K3 PASS | **NOT in H2** — operational, not a console action |
| KP5 | credential `status='invalid'` / Vault delete | auto: `worker/src/index.ts:497-542`; manual SQL / `delete_vault_secret` (`005`) | — | **A8-H3, NOT H2** — broad blast radius (§9) |

**Design choice:** the guaranteed, proven, reversible primitive is **KP1 (`trading_enabled=false`)** — the worker honors
it *before every adapter call* and it's the A10 K1-proven path. The one-click kill's **core guarantee rests on KP1.**
KP4 is offered as an explicit escalation (also A10-proven) but is not the default because flipping `status` muddies the
re-arm story (§6).

> **Note on `system_controls.trading_paused` (Option A, MVP design §3):** the *ideal* master kill is a single global
> fail-closed gate the worker honors independently of per-bot rows. **But that gate is NOT built and NOT honored by the
> deployed worker today** (it's an unbuilt worker-code slice). Setting it now would be **cosmetic** (no runtime effect),
> so H2 does **not** rely on it. **Recommendation:** when `system_controls` + the worker-honor slice land, the one-click
> kill should *also* set `trading_paused=true` as the outermost, per-bot-independent guarantee. Flagged for Codex: build
> H2 on KP1 now; add the `trading_paused` layer when the worker honors it. (See §10 open decision.)

## 2. The one-click kill action — proposed shape
**Recommendation: a `SECURITY DEFINER` RPC, not an Edge function.** Rationale: the entire action is DB-only (flip flags
+ write audit + read-back), it must be **atomic** (single Postgres transaction — flags + audit succeed or fail
together), and it mirrors the already-designed `operator_disarm_all()` / `operator_status()` pattern
(`docs/production-operator-console-mvp-design.md:70-71`, and the live `operator_status()` in
`016_operator_status_rpc.sql:52-126`). No Edge deploy needed; the browser holds no privilege and calls the RPC.

**Proposed RPC (design — NOT written):**
```
public.operator_kill_all(p_reason text DEFAULT NULL, p_hard_lock boolean DEFAULT true)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
```
**`p_hard_lock` defaults to `true`** (RESOLVED, Rev 3): the one-click kill **disables trading AND pauses bots**
(`trading_enabled=false` + `status='paused'`) — the strongest single stop. `p_hard_lock=false` (KP1-only) remains
callable but is not the default. Re-arm stays the **separate guarded** path (§6) and must un-pause + re-enable.

**Call path & grants (EXACT — the operator's browser calls this directly via PostgREST with the user JWT):**
- `REVOKE ALL ON FUNCTION public.operator_kill_all(text, boolean) FROM PUBLIC, anon;`
- `GRANT EXECUTE ON FUNCTION public.operator_kill_all(text, boolean) TO authenticated;`
- **NOT `service_role-only`** — an operator's browser session calls it under the `authenticated` role with their JWT, so
  `auth.uid()` inside the function resolves to the caller. (This is the same call model as the live `operator_status()`
  in `016_operator_status_rpc.sql`.) The function is `SECURITY DEFINER` so it can perform the privileged UPDATE +
  `audit_logs` INSERT, but **authorization is enforced inside the body** (`auth.uid()` + `is_operator`), never by the
  grant alone. *(Edge/service_role is the rejected alternative: it would require the JWT to be verified in the Edge fn
  and the verified uid passed to a service-role DB call — more surface, no atomicity. We choose the RPC path.)*

**Hardening (mandatory for the SECURITY DEFINER function):**
- `SECURITY DEFINER` + `SET search_path = ''` (empty — defeats search-path hijack).
- **Every** table/function/type reference **schema-qualified** (`public.bots`, `public.audit_logs`, `public.profiles`,
  `public.worker_status`, `auth.uid()`, `public.pgmq_queue_length(...)`).
- **No caller-supplied `actor_id`** — actor is `auth.uid()` only; `p_reason`/`p_hard_lock` are the *only* params, both
  validated (§3).
- **No dynamic SQL** (no `EXECUTE format(...)`) — all statements static.
- **Fail closed:** null `auth.uid()` OR `is_operator` not true → denial with **zero effect** (§2.1).

**Behavior (atomic, single transaction):**
1. **Authz gate (fail-closed) — reuse the proven `operator_status()` inline check verbatim** (`016:59-71`):
   `v_uid := auth.uid();` → if `v_uid IS NULL` → `RAISE ... 42501` (not authenticated);
   `SELECT p.is_operator INTO v_is_op FROM public.profiles p WHERE p.id = v_uid;` → if `v_is_op IS DISTINCT FROM true`
   (NULL profile OR false) → `RAISE ... 42501` (forbidden). **Zero mutation, no audit row.** This reads
   `public.profiles` directly under definer privilege (same as `016`) — it does **not** depend on the
   `public.is_operator(uuid)` RPC (`018`), which is granted to `service_role` only. Never trust caller-supplied
   identity.
2. **Capture `before`** — `SELECT id, trading_pair, trading_enabled, status FROM public.bots` (all bots) into the
   before-set. Also `enabled_bots_before = count(trading_enabled)`.
3. **Kill (KP1, always)** — `UPDATE public.bots SET trading_enabled=false WHERE trading_enabled=true` → capture
   `updated_rows`.
4. **Hard lock (KP4, default ON — `p_hard_lock=true`)** — `UPDATE public.bots SET status='paused' WHERE status='active'`
   → capture `paused_rows`. The default one-click kill both disables trading (step 3) **and** pauses intake (this step).
   `p_hard_lock=false` skips only this step (KP1-only). Re-arm reverses both via the guarded path (§6).
5. **Read-back (`after`) — richer than a single count.** A **fresh** `SELECT` inside the transaction produces the full
   post-kill picture the UI/audit consumes (never an assumed/empty result — MVP rule `operator-console-mvp-design.md:33`
   "empty output is never success"). It MUST report **all** of:
   - `enabled_bots_after` — MUST be `0`;
   - per-bot rows: every campaign bot with `trading_enabled=false` (and, since default `p_hard_lock=true`,
     `status='paused'`);
   - `open_trades` — `count` of `trades` with an open/pending status;
   - `queue_length` — `public.pgmq_queue_length('trade_signals')` (the wrapper used by `operator_status()`);
   - `worker_state` + `updated_at` staleness — from `public.worker_status` (`015`).
6. **Classify the result (kill_applied vs clean).** The kill *action* and the *operational cleanliness* are **separate**
   — never collapse them into a single green `ok=true`:
   - **`kill_applied = true`** once the flag UPDATEs (+ pause, default) succeeded — i.e. no NEW execution is possible.
     This is true even when residual state exists.
   - **`requires_attention = true` iff `open_trades > 0` OR `queue_length > 0`.** Open positions/orders are **not
     unwound** (§5) and queued messages are **not purged** (§5) by H2 — they still exist. Queued messages will hit the
     KP1 gate and be blocked *later*, but until consumed they are residual ⇒ attention.
   - **`operational_state = 'ATTENTION'` iff `requires_attention`, else `'SAFE'`.**
   - **`ok = (kill_applied AND NOT requires_attention)`.** So **`open_trades>0` or `queue_length>0` ⇒ `ok=false`** (a
     non-clean result) even though `kill_applied=true`. **Never return a clean `ok=true` while open trades or queued
     messages exist.** `queue_length=0 AND open_trades=0` ⇒ clean ⇒ `ok=true`.
   - `enabled_bots_after != 0` ⇒ the kill did **not** take ⇒ `kill_applied=false`, `ok=false` (F3).
7. **Audit (§3)** — insert the operator-kill audit row from within the same transaction (definer privilege inserts into
   the service-role-only `audit_logs`). **If the audit insert fails, the whole transaction rolls back** (flags revert)
   — a kill is not "done" unless it is audited. (Strict-audit posture, same as the hasher's
   `rotation_committed_audit_failed` lesson — but here we roll back because it's one DB transaction.)
8. **Return the exact response contract (§2a).**

### §2a. Exact response contract (JSON)
```
{
  "ok":               boolean,   // = kill_applied AND NOT requires_attention (clean success ONLY)
  "kill_applied":     boolean,   // flags set false (+ paused, default) — no new execution possible
  "requires_attention": boolean, // open_trades>0 OR queue_length>0
  "operational_state": "SAFE" | "ATTENTION",
  "enabled_bots_after": integer, // MUST be 0 on kill_applied
  "open_trades":      integer,   // open/pending trades remaining (NOT unwound by H2)
  "queue_length":     integer,   // pgmq depth remaining (NOT purged by H2)
  "worker_state":     text,      // from worker_status (+ staleness via worker_updated_at)
  "worker_updated_at": timestamptz,
  "audit_id":         uuid,      // the mandatory audit row (present iff kill_applied)
  "message":          text       // human summary, e.g. "Kill applied. 2 open trades + 3 queued — ATTENTION."
}
```
`ok=true` is reachable **only** when `kill_applied=true AND open_trades=0 AND queue_length=0`. Any residual ⇒ `ok=false`
+ `requires_attention=true` + `operational_state='ATTENTION'`; the UI must show ATTENTION, never a green "all clear".

**Idempotent (concurrent-safe):** a second click while already killed → `updated_rows=0`, `enabled_bots_after=0`,
`kill_applied=true`, and it **still writes an audit row** whose `before_state` shows the already-disabled set. `ok`
still follows the residual rule (clean only if no open trades / no queue). **No partial success** — the single
transaction fully applies (flags + audit) or fully rolls back. See §7-F7.

## 3. Audit event(s) — exact shape
`audit_logs` (`001_initial_schema.sql:310-331`) is **append-only, service_role-write only** (RLS `WITH CHECK (FALSE)`
for non-service, `001:602-611`); `actor_type` enum = `('user','system','worker')` (`001:75-79`). The kill RPC runs
`SECURITY DEFINER` (definer owns/holds the audit-insert privilege — **implementation must confirm the definer role has
INSERT on `audit_logs`**; flag for Codex, §10).

**One summary row per kill action** (recommended over one-row-per-bot — a single operator action is one audit event):
| Column | Value |
|---|---|
| `entity_type` | `'operator'` (a system-scope action, not a single bot) — consistent with MVP design §10 "reuse `audit_logs` with `entity_type='operator'`" (`operator-console-mvp-design.md:88-90`) |
| `entity_id` | the operator's `auth.uid()` (there is no single bot entity; scope=all) |
| `event_type` | `'operator.kill_all'` (and, if `p_hard_lock`, note it in `after_state`, not a separate event) |
| `actor_type` | `'user'` |
| `actor_id` | `auth.uid()` (the operator) |
| `ip_address` | **omit** (resolved §10.3 — an RPC can't see the real peer IP; do NOT fabricate/trust a client value) |
| `before_state` | `{ scope:'all', enabled_bots_before:N, bots:[{id,trading_pair,trading_enabled,status}] }` — **status fields only, never secrets** |
| `after_state` | `{ enabled_bots_after:0, updated_rows:N, paused_rows:M, hard_lock:bool, open_trades:K, queue_length:Q, reason:p_reason, kill_applied:true, requires_attention:bool, operational_state:'SAFE'|'ATTENTION' }` |
| `created_at` | `now()` (default) |

No token, pepper, hash, URL, credential, or Vault id ever appears (matches H-A8-1 "no secret value",
`a8-kill-path-readiness-packet.md:98-99`).

**Exact audit contract:**
- **Event name:** `event_type = 'operator.kill_all'` (single summary row per action; `p_hard_lock` recorded as a field
  in `after_state`, not a second event).
- **Entity:** `entity_type='operator'`, `entity_id = v_uid` (the operator's `auth.uid()`; scope is system-wide, not one
  bot).
- **Actor:** `actor_type='user'`, `actor_id = v_uid` — **from `auth.uid()` only, never caller-supplied.**
- **`before_state` / `after_state`:** status fields only (§ table above) — `{scope,enabled_bots,bots:[{id,pair,
  trading_enabled,status}]}` / `{enabled_bots_after,updated_rows,paused_rows,hard_lock,open_trades,queue_length,
  reason,kill_applied,requires_attention,operational_state}`. **No secrets, ever.**
- **`p_reason` validation (fail-closed):** optional; if provided, **trim + enforce `length ≤ 500`** and a **restricted
  charset** (printable/whitespace, e.g. `~ '^[[:print:][:space:]]{0,500}$'`); reject (denial, zero effect) on
  violation. Stored as a plain string, **never executed** (no dynamic SQL anywhere, §2). NULL/empty is allowed.
- **Audit is MANDATORY for authorized kills — no best-effort.** The `audit_logs` INSERT runs **inside the same
  transaction** as the flag UPDATEs. **If the audit INSERT fails, the whole transaction ROLLS BACK** (flags revert) and
  the RPC returns `ok=false`. A kill is never reported done unless it is audited. (Stronger than the hasher's post-CAS
  best-effort audit precisely because here everything is one DB transaction and can atomically revert.)

**Denial auditing — explicit (no mixed wording):**
- **Unauthorized / anon / non-operator denials are NOT DB-audited by this RPC.** The authz gate (§2.1) raises `42501`
  **before** any write — so a denial produces **zero DB changes** and **zero `audit_logs` rows**.
- Denials **may** still be recorded **outside** the DB — PostgREST/gateway request logs, Supabase auth logs, or the
  console/API layer — that observability is out of scope for this RPC and not a DB audit row.
- **Only authorized kill attempts are audited**, and those are audited **mandatorily and in-transaction** (above).
- Consequence for the validation plan: the denial test asserts **exactly zero new `audit_logs` rows** (§11.1); the
  authorized test asserts **exactly one** (§11.2).

## 4. Actor identity
- **Who:** an authenticated Supabase Auth user with `profiles.is_operator=true` (`016_operator_status_rpc.sql:21-27`;
  guarded against user-context tampering by `guard_profiles_is_operator()` trigger `016:31-48`). Identity =
  `auth.uid()`, captured inside the definer RPC (same trust model as `operator_status()`), **not** supplied by the
  browser.
- **Gate (RESOLVED):** reuse the **inline** check `operator_status()` uses (`016:59-71`) — read `public.profiles`
  under definer privilege; `is_operator IS DISTINCT FROM true` → `42501`, zero effect, no audit row. We do **not** call
  the `public.is_operator(uuid)` RPC (`018`) because it is granted to `service_role` only; the inline read needs no
  extra grant and matches the proven precedent.
- **Least privilege:** the browser session holds **no** service_role, cannot write `bots`/`audit_logs` directly, cannot
  read secrets/`vault_secret_id` (`operator-console-mvp-design.md:96-98`). The RPC is the only authority.

## 5. Exact resources killed (blast radius of H2)
**Touched:** `public.bots.trading_enabled` (all rows, →false) and — by default (`p_hard_lock=true`) —
`public.bots.status` (`active`→`paused`). (`p_hard_lock=false` touches only `trading_enabled`.) **That is the entire
mutation surface.**

**What A8-H2 explicitly does NOT do (state plainly):** A8-H2 disables **future execution** (`trading_enabled=false`,
optionally `status=paused`). It does **NOT**:
- **cancel already-submitted exchange orders** (an order already sent to Binance is not recalled — F6);
- **unwind / close open positions** (existing positions stay; surfaced as `open_trades>0` ⇒ ATTENTION, §2.5);
- **stop the Railway worker process** (worker keeps running — it just finds nothing enabled to trade; KP3 is separate);
- **purge / drain the pgmq queue** (already-queued messages are consumed but then **blocked** by the KP1 gate before
  the adapter → `order.blocked`, no exchange call; the queue is not emptied);
- **flip `QUEUE_ENABLED`** (Doppler/Railway env — untouched; KP2 is out-of-band);
- **invalidate or delete any credential / Vault secret** (no `status='invalid'`, no `delete_vault_secret`);
- **solve the KP5 shared-credential blast-radius** (that is A8-H3, §9).

**Because H2 touches no credential/custody:** no shared-credential blast radius ⇒ **fully reversible** (§6). Custody-lock
(the KP5-style "custody" third of the H2 line item) is deferred to **A8-H3** with per-bot credential isolation (§9).

## 6. Read-backs, rollback & re-arm
- **Read-back (must prove more than one count):** the response's `after` is a **fresh SELECT inside the same
  transaction** (§2.5, §2a) and MUST report `enabled_bots_after` (**MUST be 0**), every campaign bot's
  `trading_enabled=false` (and `status='paused'` — default hard-lock), `open_trades`, `queue_length`, and
  `worker_state`+staleness. If `enabled_bots_after != 0` → `kill_applied=false`, `ok=false`, UI shows failure. If
  `open_trades>0` OR `queue_length>0` → `kill_applied=true` but **`ok=false`**, `requires_attention=true`,
  `operational_state='ATTENTION'` (no new execution possible, but residual open trades / queued messages exist — not
  clean). Post-action, the console's normal `operator_status()` poll independently re-confirms `enabled_bots=0` +
  `open_trades`/`queue_length`/`worker_state` (a second, out-of-transaction read-back).
- **Rollback of the kill itself:** unnecessary/none — the kill only *stops* trading (safe direction). If the kill RPC
  errors mid-way, the single transaction **rolls back atomically** (flags + audit revert together); nothing partial.
- **Re-arm (the deliberately-hard direction):** re-enabling is **NOT part of H2** and is **not** a one-click inverse.
  Re-arm goes through the **guarded** `operator_enable_bots()` path (`operator-console-mvp-design.md:72-74`): per-bot
  `operator_precheck` (mode/size/caps/env), testnet-only, explicit confirm, audit, read-back — and enabling a bot still
  does **not** authorize any order (queue-arm stays Oren-gated). If `p_hard_lock` set `status='paused'`, re-arm must
  also flip `status` back to `active` via the same guarded path. **Asymmetry is intentional:** killing is one click;
  arming is deliberate, gated, and multi-condition.

## 7. Failure modes (and required handling)
| # | Failure | Required behavior |
|---|---|---|
| F1 | Caller not operator / not authed | `42501`, **zero mutation**, no audit row |
| F2 | Audit insert fails after flag UPDATE | **Whole transaction rolls back** (flags revert) → `ok=false`, error surfaced. A kill is never reported done unless audited. |
| F3 | `enabled_bots_after != 0` (read-back disproves the kill) | `ok=false`; UI shows failure + the non-zero set; operator escalates (KP2/KP3 operational) |
| F4 | Definer role lacks INSERT on `audit_logs` | **Caught in testnet validation before ship** (§ implementation must grant/verify) — otherwise every kill would F2-rollback. Flag for Codex (§10). |
| F5 | Client-supplied IP spoofed | Don't trust it — §3/§10.3 **omit** `ip_address`; audit integrity does not depend on it |
| F6 | Worker mid-flight when kill lands | KP1 is checked **before each adapter call** (`index.ts:860`); an already-submitted exchange order is not recalled (out of scope — kill prevents *new* orders, matching A10 K1 semantics). Document this limit. |
| F7 | Concurrent / repeated operator kills | **Idempotent, no partial success.** A second (or concurrent) click while already killed returns `kill_applied=true`, `enabled_bots_after=0` (`updated_rows` may be 0), and **still writes an audit row** whose `before_state` shows the already-disabled set. `ok` follows the residual rule (§2a): clean `ok=true` only if `open_trades=0 AND queue_length=0`, else `ok=false`+ATTENTION. Each call is its own atomic transaction — fully applies or fully rolls back; no half-killed state. Row-level UPDATEs serialize in Postgres, so concurrent kills converge to the same disabled end-state; each is audited. |
| F8 | DB unreachable / RPC 5xx | UI shows failure (no optimistic success); operator falls back to KP3 (Railway stop) as the operational backstop |

## 8. Testnet kill vs real-funds readiness (must not be conflated)
- **Testnet:** on merge + surgical migration apply + a passing testnet validation (§ below), H2 delivers *an audited,
  operator-gated, reversible one-click kill for testnet* — closing the "no audited operator kill surface" gap for
  testnet (`a8-kill-path-readiness-packet.md:88-89` — raw SQL/Doppler flip "not acceptable for real funds", audited
  action required).
- **Real funds = still NO-GO** after H2 alone. Real-funds trust additionally requires: **A8-H4** (a fresh A10-style
  drill exercising *this audited one-click path* at runtime + timing — `a8:104`), **A8-H3** (KP5 blast-radius /
  per-bot credential isolation — §9), **A11** (Oren written approval), live-tier fail-closed proof, and migration
  history reconcile (`docs/production-a2-migration-009-decision-packet.md`). Planning/impl-PASS ≠ trusted-closed
  (`a8:92-93`).

## 9. What A8-H2 closes vs what stays open (esp. KP5 blast radius)
**Closes (testnet):**
- H-A8-1 (audited kill action) — for the **operator manual KP1(+KP4) path**: audit row {actor, kill_path, scope,
  reason, ts, before/after}, no secret. ✅
- H-A8-2 (one-action hardened kill: kill-button / disable-all) — the `operator_kill_all()` RPC + a guarded console
  button. ✅ (the **custody-lock** third of the H2 line item is the KP5 half → deferred to H3, below).

**Stays OPEN:**
- **KP5 blast-radius / shared credentials (A8-H3) — the key carve-out.** H2 deliberately does **not** touch credentials
  or Vault. Today credentials can be **shared** across bots (`user_exchange_credentials`, one `vault_secret_id` per
  credential; the auto-path `worker/src/index.ts:497-542` disables *the bot* on auth failure, but a manual
  `status='invalid'` / `delete_vault_secret` on a **shared** credential would disable **every bot using it** — the
  documented broad blast radius, `a8-kill-path-readiness-packet.md:86-87`, "EMERGENCY-ONLY, not first-line"). A safe
  *custody-lock* one-click therefore needs **per-bot credential isolation** first (or an explicit, confirmed
  emergency-only procedure) — that is **A8-H3** (`a8:102-103`). Until H3, the "custody-lock" button is **not** built;
  H2 ships the `trading_enabled`/`status` kill only.
- **A8-H4** runtime drill of the audited path (real-funds evidence).
- **`system_controls.trading_paused` master gate** — unbuilt worker-honor slice (§1 note); layer in later.
- **Queue arm / enable / any fire** — Oren-gated, never in this slice.

## 10. Resolved design choices + residual items for Codex
**Resolved in this revision (grounded in repo):**
- **RPC vs Edge → RPC** (§2): atomic DB-only action; browser holds no privilege; matches `operator_status()`.
- **Call model → `authenticated` grant + inline authz** (§2, §4): `revoke from public/anon`, `grant execute to
  authenticated`, authorize inside the body via the proven `016` inline `profiles.is_operator` read (not the
  service-role-only `018` RPC). Fail-closed on null uid / non-operator.
- **Hardening → fixed** (§2): `security definer` + `search_path=''`, schema-qualified refs, no dynamic SQL, no
  caller-supplied `actor_id`, `p_reason` validated (≤500 printable).
- **Audit → mandatory in-transaction, rollback on failure** (§3); one `operator.kill_all` summary row. Denials
  (anon/non-operator) are **not** DB-audited by this RPC — zero DB writes (§3, §4).
- **Response semantics → resolved** (§2a): `ok` is clean-only (`kill_applied AND NOT requires_attention`);
  `open_trades>0` OR `queue_length>0` ⇒ `ok=false` + ATTENTION.
- **Default `p_hard_lock=true`** (RESOLVED, §2): one-click kill disables trading AND pauses bots; re-arm is a separate
  guarded path. (No longer an open decision.)
- **Idempotency / concurrency → defined** (§2.7, §7-F7).

**Residual items to confirm at implementation (flag for Codex):**
1. **Audit-insert privilege (F4):** confirm the RPC's **definer owner** has `INSERT` on `public.audit_logs` (RLS is
   `WITH CHECK (FALSE)` for non-service; definer bypasses RLS but still needs table INSERT privilege). If the chosen
   owner lacks it, own the function by a role that has it (e.g. the same owner as `016`) — **not** by exposing
   service_role to the browser. Decide the owning role explicitly.
2. **IP in audit:** proposed **omit** (an RPC can't see the real peer IP the way the rotate Edge fn did; a
   client-supplied value would be untrusted). Confirm omit vs advisory-labeled.
3. **Migration number:** use **`019`** after confirming it's the next free number (highest file = `018`). Standing
   state: **`010-018` applied surgically but UNTRACKED** in `supabase_migrations` (`009` frozen) per
   `a2-migration-009-decision-packet.md`. Apply `019` transaction-wrapped via `supabase db query --linked --file`;
   **never `db push`** (would mis-fire on untracked 010-018). Reconcile tracking before real funds.

## 11. Testnet validation plan (post-implementation, gated — NOT run here)
Design-only; execution is a separate approved run (operator mutates, Claude read-backs). **All of the following are
required tests:**
1. **Denial test (non-operator) — MANDATORY.** A valid `authenticated` JWT for a user with `is_operator=false` (and an
   `anon` call) → **`42501`/denial**, **zero bot changes** (raw read-back: every bot's `trading_enabled`/`status`
   unchanged), and **zero audit rows** written (raw `audit_logs` SELECT before/after shows no new row). Fail-closed
   denial specified: null `auth.uid()` and non-operator both rejected with no effect.
2. **Operator kill test (clean case).** Operator (`is_operator=true`) executes the default kill with `open_trades=0`
   and `queue_length=0` → `kill_applied=true`, `requires_attention=false`, `operational_state='SAFE'`, **`ok=true`**;
   **exactly one** `audit_logs` row (`event_type='operator.kill_all'`, `actor_type='user'`, `actor_id=operator uid`,
   before/after present, **no secrets**) via raw SELECT; **read-backs prove disabled** via `operator_status()`:
   `enabled_bots=0`, all `trading_enabled=false`, all active→`paused` (default hard-lock); **no** new trade rows, **no**
   credential/Vault change. (Capture baseline first.)
3. **Idempotency test.** Second click while already killed → `kill_applied=true`, `enabled_bots_after=0`, a **new**
   audit row with `before_state` already-disabled, `updated_rows=0`; `ok` follows the residual rule; no partial state.
4. **Default hard-lock test.** Default call sets active bots' `status='paused'` **and** `trading_enabled=false` (raw
   read-back both); audit `after_state.hard_lock=true`. Also test `p_hard_lock=false` → only `trading_enabled=false`,
   `status` unchanged.
5. **ATTENTION test — open_trades.** With an `open_trades>0` fixture (a live/pending testnet trade row), kill returns
   `kill_applied=true` but **`ok=false`**, `requires_attention=true`, `operational_state='ATTENTION'`; UI must not show
   "all clear".
6. **ATTENTION test — queue_length.** With `queue_length>0` (a message enqueued before the kill), kill returns
   `kill_applied=true` but **`ok=false`**, `requires_attention=true`, `operational_state='ATTENTION'`; the queue is
   **not purged** (raw `pgmq` depth unchanged by the RPC).
7. **Reason-validation test.** Over-length (>500) / non-printable `p_reason` → denial, zero effect, zero audit rows;
   valid reason stored verbatim.
8. **Re-arm is NOT part of kill.** Re-enabling for the next test cycle MUST go through the **guarded**
   `operator_enable_bots` precheck path (`operator-console-mvp-design.md:72-74`), not any inverse of the kill RPC —
   and, because default hard-lock paused the bots, it must **un-pause** (`status='active'`) too; verify a bot the
   precheck would refuse is not enabled.
9. **Unit (Deno/pgTAP or RPC harness)** mirrors 1-7 deterministically incl. **audit-fail → full rollback** (F2): force
   the audit INSERT to fail and assert the flag UPDATEs did **not** persist.
10. **Evidence discipline:** empty/filtered output is not evidence; every assertion backed by a **raw** read-back;
    secret values never printed. (Consistent with `praxis-evidence-discipline`.)

## 12. GO / NO-GO
> **STATUS (2026-07-09): IMPLEMENTED + VALIDATED on TESTNET.** Design Rev 3 → built (migration `019` c4f28a7, LOCAL
> test 143998c/8cb1d9e GREEN, frontend kill UI 0e3a3b2, runbook 81e4c00) → **testnet validation run PASS** (linked
> apply → real UI + authenticated PostgREST → anon denied 401 → one audited SAFE kill → exact-baseline restore →
> read-only). Evidence: `docs/production-a8-h2-testnet-validation-runbook.md` (RUN — RESULTS). **A8-H2 = testnet-CLOSED.**
> Minor non-blocking follow-up: audit `reason` came through null (UI reason field empty at fire; optional).

- **This packet:** DESIGN, Rev 3 — now **built + testnet-validated** (above).
- **Testnet:** **A8-H2 = testnet-closed** (audited one-click KP1+KP4 kill exists and is validated end-to-end).
- **Real funds = OPEN / NO-GO** — needs H3 (KP5 isolation), H4 (runtime drill of this path — A10 satisfies path-level;
  the audited-one-click path is now testnet-proven), A11, live-tier fail-closed proof, migration reconcile. **A8 not
  fully closed by H2.**
