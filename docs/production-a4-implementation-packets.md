# A4 — Mainnet Credential Implementation Packets (A4-1 … A4-5)

> **DOC / PLANNING + runbooks — NOT EXECUTION.** No real keys · no Vault writes · no DB mutation · no deploy · no
> Railway/Doppler · **no secret VALUES anywhere** · no mainnet / no real funds. **Real funds remain NO-GO.** Uncommitted
> draft for Codex review. Operationalizes `production-a4-mainnet-credentials-plan.md` (PASS `35cf391`) into concrete
> reviewable packets, now that **A8-H3 credential isolation is COMPLETE** (021 ownership FK + worker W1 + 023 S1b live).
>
> **Progress: 1/5 complete · Current: 2/5 — Static egress / IP allowlist (A1) · Remaining: 4/5.** A4 is **3/5** — this is
> planning-ahead; nothing in A4 executes until **A1 egress is proven** (2/5) and **A11** is granted (5/5).
>
> **Rev 2 (2026-07-12): Codex CHANGES 1-9 applied.** Made explicit the **"credential row exists" ≠ "bot uses it"**
> separation (no repoint until A1+A4-2+A4-3+A11+tiny-live); tightened `vault_secret_id` handling (fingerprint/count in
> evidence, placeholder in SQL, real value operator-only out-of-band); exact A4-1 PRE-guards; split A4-2 into **A4-2a
> keyless egress probe** + **A4-2b authenticated read-only** (2b blocked until A1 proven + key allowlisted); A4-3 now
> requires **stored validation-evidence fields (id/hash)**, not "operator says"; A4-4 delete-old-last conditions; a
> **"mainnet first-use" boundary** (§A4-6); and **per-packet test/dry-run expectations** (§A4-7).

## 0a. CORE SEPARATION — "credential ROW exists" ≠ "bot USES it" [CHANGE 1]
- **Provisioning (A4-1) may create `pending_validation` mainnet credential ROWS.** It must **NOT** repoint any bot to
  them (`bots.credential_id` is never touched by A4-1) and must **NOT** arm anything (`bots.trading_enabled` never
  touched).
- **A bot may be REPOINTED to a mainnet credential ONLY after ALL of:** (1) **A1 egress proof PASS**, (2) **A4-2 read-only
  validation PASS**, (3) **A4-3 promotion PASS** (`status='valid'`), (4) **A11 approval**, and (5) an **explicit tiny-live
  preflight** (A4-6). Until then, a mainnet credential row sits **unused** (`valid` or `pending_validation`) and touches
  no bot.
- **Creating a row changes nothing operational.** Arming = a *separate*, A11-gated step. This separation is repeated in
  every packet below.

## 0. Grounding + dependencies (verified)
- **[FACT] Schema:** `user_exchange_credentials(id uuid, user_id, exchange_id, vault_secret_id TEXT, label, status
  {pending_validation|valid|invalid}, exchange_environment {testnet|mainnet}, deleted_at)`; `UNIQUE(user_id,exchange_id,
  label)`. `bots.credential_id` under **composite FK `bots(credential_id,user_id)→uec(id,user_id) ON DELETE RESTRICT`**
  (021) + **partial-unique `bots_credential_single_use_uidx`** (023). Vault: `get_decrypted_secret(uuid)` (read),
  `delete_vault_secret(uuid)` — **no in-repo create helper** (operator uses Supabase Vault native `create_secret`/
  dashboard).
- **[FACT] Isolation prerequisite MET:** per-bot mainnet keys → single-use (023) + ownership (021 + worker W1) enforced by
  construction. So A4 keys are isolated the moment they exist; no shared mainnet key can be referenced by 2 live bots.
- **[FACT] Worker fail-closed for mainnet:** on the current worker (`PRAXIS_IS_PRODUCTION=false`) a `mainnet` credential
  → `assertExchangeEnvironment` fails closed (no order). Mainnet execution needs the **live tier** (4/5) — separate.
- **Dependency chain:** **A1 static egress IP (2/5)** = the allowlist target + the vantage point for read-only validation;
  **A8-H3 (done)** = isolation; **A11 (5/5)** = arming. **A4 packets author now; execute only after A1 proven + A11.**
- **[RULE] Secret handling [CHANGE 2]:** operator creates keys + writes Vault; **Claude never handles a key value.** No
  key/secret value in any doc/PR/chat/log.
  - **`vault_secret_id` is SENSITIVE OPERATIONAL METADATA** (a Vault pointer, not the key value). Docs may **name the
    column** but **must never include a real mainnet value**.
  - **Evidence** about mainnet credentials uses a **md5 fingerprint / count** only — never the raw handle.
  - **SQL artifacts reference a PLACEHOLDER/parameter** (e.g. `:cred`, `:new_ptr`, `<VAULT_PTR>`) — **never a real
    value**. **Any real value entry is operator-only, out-of-band** (into Vault / the reviewed row insert the operator
    fills at run time), never authored by Claude.

---

## A4-1 — Per-bot mainnet credential PROVISIONING packet
**Shape:** ONE reviewed operator-run SQL packet per credential (or a reviewed batch), txn-wrapped, PRE/POST-guarded,
`db query --linked --file`, **never `db push`**. Claude authors; **operator runs**; Claude read-backs only.

**Operator pre-work (secret-safe, before the SQL):**
1. Create the **mainnet** API key in the exchange — **trade-only, withdrawals DISABLED**, one key **per (user, bot)**.
2. **IP-allowlist** the key to the **A1 static egress IP** (only after A1-ALLOWLIST-READY).
3. Store the secret **into Supabase Vault** (native `create_secret`) → obtain the **`vault_secret_id`** pointer. **The
   value is pasted only into Vault — never a doc/chat/log/argv.**
4. Record only **non-secret metadata** (key label, creation date, allowlisted IP, bot mapping).

**Exact NON-SECRET fields inserted (nothing else):**
| Column | Value |
|---|---|
| `user_id` | owning user uuid (must equal the bot's `user_id` — 021 FK) |
| `exchange_id` | the `binance` exchanges row id |
| `exchange_environment` | **`'mainnet'`** |
| `vault_secret_id` | the Vault pointer (sensitive metadata; a UUID-shaped string — worker requires UUID shape) |
| `label` | non-secret per-bot label (distinct — `UNIQUE(user_id,exchange_id,label)`) |
| `status` | **`'pending_validation'`** (NEVER `'valid'` at insert) |
| `deleted_at` | NULL |

**Exact PRE-guards (fail-closed) [CHANGE 3]:**
- **A8-H3 complete / S1b exists** — `pg_indexes` has `bots_credential_single_use_uidx` (single-use enforced) + the
  composite ownership FK `bots_credential_owner_fkey` present.
- **The bot exists and belongs to the user** — `bots(bot_id).user_id = :user_id`, bot not soft-deleted.
- **No live mainnet credential already assigned to that bot** — no live `user_exchange_credentials` row with
  `exchange_environment='mainnet'` already referenced by this bot (avoid a second mainnet key for one bot).
- **Target label does not collide** — no existing `(user_id, exchange_id, label)` row (`UNIQUE`).
- **`exchange_environment='mainnet'`** and **`status='pending_validation'`** in the inserted values (asserted).
- **NO bot `trading_enabled` change** — the packet must not touch `bots.trading_enabled`.
- **NO bot `credential_id` update** — the packet must not repoint any bot (row creation only; §0a).

**POST:** exactly one credential row inserted, `status='pending_validation'`, `exchange_environment='mainnet'`; **zero
`bots` rows modified** (no repoint, no arm); no mainnet credential in `valid`.

**Repoint is NOT here [CHANGE 1]:** attaching a bot's `credential_id` to a mainnet row happens **only** in the tiny-live
preflight (§A4-6), after **A1 proof + A4-2 + A4-3 + A11**. A4-1 leaves every bot untouched. *(On the testnet-tier worker a
mainnet credential is fail-closed anyway — but the rule stands regardless of tier.)*

**Read-backs (Claude):** the row exists with the exact non-secret fields + `status='pending_validation'` + mainnet;
`vault_secret_id` shown as **md5 fingerprint** only (never the value); **no `bots` row changed** (no `trading_enabled=true`,
no `credential_id` repoint); no mainnet credential in `valid`.

---

## A4-2 — Read-only VALIDATION packet (split A4-2a / A4-2b) [CHANGE 4]
Proves the mainnet key works **without trading**, from the A1 static egress IP. **No order/withdraw/state-mutating
endpoint, ever. No balances printed.**

### A4-2a — Keyless egress probe (no key)
- Public/unauthenticated call (server-time / `loadMarkets`) **from the A1 static egress IP** → **200** proves region/egress
  is not geo-blocked. A `451`/`403` = region/egress problem → **STOP**.
- **No key involved.** Can run as soon as the A1 static IP exists (A1-EGRESS-PROOF). Records the **egress IP** (non-secret)
  → used as the `validated_from_egress_fingerprint` in A4-3.

### A4-2b — Authenticated read-only validation (BLOCKED until A1 proven + key IP-allowlisted)
- **Precondition (hard):** A1 is **complete** (static IP proven, A1-LIVE-READONLY-PROOF) **and the key is IP-allowlisted**
  to that IP. **Do not run A4-2b before both.**
- **Authenticated READ-ONLY private endpoint** — `fetchBalance` (read-only) → **200** proves **key + IP + region** are
  accepted **without moving funds**. Uses the existing worker read path; **never** an order/withdraw call.
- **Trade-only / no-withdrawal verification** — **operator attestation** (key created no-withdrawal) **+ exchange
  key-permission API info if the exchange exposes it** (read-only) → recorded **pass/fail** only.

**EXPLICITLY FORBIDDEN in A4-2 (any → STOP):** balances/positions/account data **in logs or docs**; querying **open
orders** unless strictly needed (default: do not); **`createOrder`** / any order placement; **withdrawals**/transfers; **any
endpoint that mutates exchange state**; any arming.

**Evidence format — pass/fail + counts ONLY:** `keyless_ping: PASS (200)` · `auth_read: PASS (200)` ·
`withdrawals_disabled: PASS (attested + API)` · `egress_ip_matches_allowlist: PASS`. **NO balances, NO account numbers,
NO positions, NO `vault_secret_id` value** — only PASS/FAIL + at most a boolean/count. Any 4xx/geo error → FAIL → STOP.

---

## A4-3 — PROMOTION mechanism packet (`pending_validation` → `valid`)
**Defines the ONLY reviewed path** to promote a mainnet credential. **No auto-promotion.**

**[CHANGE 5] Promotion requires a STORED validation-evidence record — NOT "operator says it passed."** The exact A4-2
evidence must be captured (fields below) and its **id/hash** referenced in the promotion, so the promotion is traceable to
a specific validation run.

**Required evidence fields (non-secret):**
`validated_at` · `validated_from_egress_fingerprint` (the A4-2a egress IP, or its md5) · `exchange_environment='mainnet'`
· `credential_id` · `result='pass'` · **(NO balances, NO account data, NO `vault_secret_id` value, NO key).** Serialize
these to a canonical string → **`evidence_hash = md5(...)`** = the id/hash the promotion references.

**Where the evidence lives [DECISION]:** the current schema has **no ops-evidence table**. Two options — **recommend (a)
for the first mainnet credential:**
- **(a) DOC + audit-log evidence NOW:** record the evidence fields in a reviewed **evidence doc**, and capture them
  (incl. `evidence_hash`) into `audit_logs.after_state` at promotion (below). Auditable, no new table.
- **(b) Dedicated `ops_credential_validation` table LATER:** a small append-only table (`credential_id, validated_at,
  egress_fingerprint, environment, result, evidence_hash`) — a separate reviewed slice if a queryable evidence trail is
  wanted before scale.

**Chosen mechanism (RECOMMENDED): reviewed operator-run SQL** (placeholders only — no real values):
```sql
begin;
-- PRE: credential is mainnet + pending; the A4-2 evidence (id/hash) is recorded + attested;
--      A1-LIVE-READONLY-PROOF (egress from the static IP) = PASS. Operator supplies :evidence_hash + :egress_fp.
do $$ begin
  if not exists (select 1 from public.user_exchange_credentials
       where id = :cred and exchange_environment='mainnet' and status='pending_validation' and deleted_at is null) then
    raise exception 'A4-3 PRE: credential not a pending mainnet row';
  end if;
  if :evidence_hash is null or length(:evidence_hash) < 8 then
    raise exception 'A4-3 PRE: missing A4-2 validation evidence hash — no auto-promotion';
  end if;
end $$;
update public.user_exchange_credentials
   set status='valid', last_validated_at = now()
 where id = :cred and exchange_environment='mainnet' and status='pending_validation' and deleted_at is null;
-- audit (non-secret): store the evidence reference. NO key/secret/vault value, NO balances.
insert into public.audit_logs (entity_type, entity_id, event_type, before_state, after_state)
  values ('credential', :cred, 'credential.promoted',
          jsonb_build_object('status','pending_validation'),
          jsonb_build_object('status','valid','result','pass',
                             'validated_from_egress_fingerprint', :egress_fp,
                             'exchange_environment','mainnet','evidence_hash', :evidence_hash));
do $$ begin
  if not exists (select 1 from public.user_exchange_credentials where id=:cred and status='valid') then
    raise exception 'A4-3 POST: promotion did not take'; end if;
end $$;
commit;
```
- **BLOCKED unless A1 egress proof passes** (A1-LIVE-READONLY-PROOF) and **A4-2 evidence hash is present** — both are
  enforced preconditions (the missing-hash guard forbids "operator says").
- **Alternatives:** (b) a `SECURITY DEFINER` RPC `promote_credential(cred uuid, evidence_hash text)` service_role-only
  that refuses without a matching recorded evidence row; (c) a documented manual procedure. Recommend (a).
- **Promotion ≠ arming:** a `valid` mainnet credential is execution-*eligible* only when its bot is `active` +
  `trading_enabled=true` + the worker is live-tier — none of which this packet touches. **Arming waits on A11.**

---

## A4-4 — ROTATION packet (per-bot; compare-and-swap; delete-old-last)
Rotate one bot's mainnet key without touching any other bot (isolation by 021/023).
1. **Create new key + Vault secret** (operator; trade-only, no-withdrawal, IP-allowlisted) → **new `vault_secret_id`**.
2. **Compare-and-swap** the credential's pointer (reviewed operator SQL):
   ```sql
   update public.user_exchange_credentials
      set vault_secret_id = :new_ptr, status = 'pending_validation', last_validated_at = null
    where id = :cred and vault_secret_id = :old_ptr and exchange_environment='mainnet';   -- CAS on old pointer
   -- assert exactly 1 row updated; else STOP (someone else rotated).
   ```
   *(Setting `status='pending_validation'` forces re-validation before the new key is trusted.)*
3. **Validate the new key READ-ONLY** (A4-2) → then **promote** (A4-3).
4. **Delete the OLD Vault secret LAST — NOT automatic [CHANGE 6].** `delete_vault_secret(:old_ptr::uuid)` (operator,
   service_role) is performed **only after ALL of:**
   - the **new key is validated** (A4-2b PASS) **and promoted** (A4-3, `status='valid'`);
   - the **bot remains disarmed** (`trading_enabled=false`) **OR A11 explicitly allows the live state**;
   - a **rollback-window decision is recorded** (how long to retain the old secret before deletion — e.g. keep N hours/one
     validated live cycle, documented in the rotation evidence).
   It is a **separate, reviewed operator action** — never chained automatically into the rotation SQL.
- **Per-bot rollback:** if the new key fails validation → **CAS the pointer back** (`set vault_secret_id=:old_ptr,
  status='valid' where id=:cred and vault_secret_id=:new_ptr`) and **do NOT delete the old secret**. Fully reversible
  while the old secret is retained (delete-old-last guarantees a working key at all times).
- **No arming during rotation.** Never reuse a key that was ever locally exposed. Rotation is operator-run + audited.

---

## A4-5 — STOP CONDITIONS + ROLLBACK (whole A4)
**Stop conditions (hard — any → STOP):**
- **Withdrawal permission** on any key → STOP + delete/disable/recreate trade-only.
- **Missing IP allowlist** (key not restricted to the A1 static egress IP) → STOP.
- **Shared mainnet key** (a mainnet credential referenced by >1 live bot) → STOP (023 rejects it; also guard).
- **Any key/secret VALUE exposure** in a doc/PR/chat/log → STOP + rotate (A4-4).
- **Validation hits an order endpoint / `createOrder` / withdrawal** → STOP.
- **A1 not proven** (no static egress IP, or not reachable / geo-blocked) → STOP (cannot allowlist or validate).
- **A11 not approved** → STOP (no arming; `trading_enabled` stays false).
- **Real funds remain NO-GO** until A1 + A4 + live-tier (4/5) + A11 all close.

**Rollback (per artifact; reversible; never Vault-delete except emergency-after-review):**
- **Provisioning (A4-1):** delete the `pending_validation` row (metadata; safe — never `delete_vault_secret` here). If a
  bot was repointed, repoint its `credential_id` back first (ON DELETE RESTRICT).
- **Promotion (A4-3):** `update … set status='pending_validation' where id=:cred` (reversible; execution-eligibility
  removed).
- **Rotation (A4-4):** CAS the pointer back to the old, keep old secret (delete-old-last means the old key still works).
- **Repoint / arming (A4-5 tiny-live):** set `trading_enabled=false` (disarm) + repoint `credential_id` back; the kill
  switch (A8-H2 `operator_kill_all`) is the emergency stop.
- **`delete_vault_secret`** is **emergency-only, operator-run, reviewed each time** (out of the default A4 path).

## A4-6 — MAINNET FIRST-USE boundary [CHANGE 7]
**A4 alone does NOT authorize trading.** Even with A4 fully done (credential provisioned + validated + promoted to
`valid`), the **first live order** requires **ALL of**:
- **A1 complete** (static egress IP proven + key IP-allowlisted, A1-LIVE-READONLY-PROOF);
- **A4 credential `valid`** (A4-2 + A4-3 done for that bot's key);
- **live-tier fail-closed proof** (4/5 — worker at `PRAXIS_IS_PRODUCTION=true` proven to fail closed);
- **TradingView production path ready** (real alert → live webhook, no-token-exposure path);
- **A11 written approval WITH CAPS** (per-order + daily notional, one bot, kill authority ready);
- an **explicit tiny-live preflight** — repoint the bot's `credential_id` to the mainnet credential + set
  `trading_enabled=true` **only here**, one bot, minimum caps, kill ready.
Until every one is true, a `valid` mainnet credential sits **unused/unarmed**. **Provisioning/validation/promotion (A4-1..3)
change no bot; arming is this A4-6 step, gated on A11 + the full ladder.**

## A4-7 — Test / dry-run expectations (future LOCAL proofs; planning only) [CHANGE 8]
Each packet, when implemented, must have a LOCAL/dry-run proof (like the A8-H3 fixtures) — authored + LOCAL-tested before
any linked run:
- **A4-1 provisioning:** a LOCAL fixture proves the packet **inserts exactly one `pending_validation` mainnet row and
  changes ZERO `bots` rows** (no `trading_enabled`, no `credential_id`); PRE-guards abort on a missing/foreign bot, a
  label collision, an already-assigned mainnet credential, or a missing S1b index.
- **A4-3 promotion:** a LOCAL fixture proves it **updates `status` only** (`pending_validation`→`valid`), touches no other
  column/row, **aborts when the evidence hash is absent**, and writes the non-secret audit row.
- **A4-4 rotation:** a LOCAL fixture proves the **CAS rejects a stale old pointer** (update matches 0 rows when
  `vault_secret_id ≠ :old_ptr`), sets the row back to `pending_validation`, and that rollback CAS restores the old pointer;
  **no `delete_vault_secret` in the rotation SQL**.
- **A4-2 validation code:** a unit/dry-run proves the validation path **can only call read-only endpoints** — no
  `createOrder`/withdraw/state-mutating call is reachable (e.g. assert the code path never invokes an order/withdraw
  method; grep/CI guard), and **no balances are logged**.
- **All:** a grep/CI guard that **no artifact contains a real `vault_secret_id` value** (placeholder/fingerprint only).

---
**Net:** five reviewed A4 packets + a first-use boundary + test expectations. **"Credential row exists" ≠ "bot uses it":**
provisioning/validation/promotion touch **no bot**; arming is the separate A4-6 step gated on **A1 + live-tier +
TradingView + A11 + tiny-live preflight**. `vault_secret_id` is sensitive metadata (fingerprint/placeholder only; real
value operator-only). Promotion needs **stored evidence (id/hash)**, not attestation alone. All plug into the now-enforced
A8-H3 isolation. **Authoring only — nothing executes until A1 egress is proven (2/5) and A11 is granted (5/5).** No real
keys, no Vault writes, no DB mutation, no deploy, no secrets, no mainnet. **Real funds remain NO-GO.**

**Progress: 1/5 complete · Current: 2/5 — Static egress / IP allowlist (A1) · Remaining: 4/5.**
