# S4-1 — Migration 011 Apply & Verify Runbook (`praxis_alert_ro`)

**Status:** DESIGN / DOC ONLY. Nothing in this runbook has been executed.
**Target:** `supabase/migrations/011_alert_readonly_role.sql` (committed `cff68a5`, **not applied**).
**Gate:** every step that mutates the DB requires explicit operator approval at the moment of running. The agent does **not** run `db push`, direct SQL, or any DB mutation; does **not** create passwords; does **not** touch Doppler/Railway. **Migration 009 remains frozen.**

This runbook is what makes the apply safe given the **migration-010 history exception** (010 was applied surgically via direct SQL and is **not** recorded in `supabase_migrations`). Read it end-to-end before running anything.

---

## 0. Preconditions
- `011_alert_readonly_role.sql` is committed and pushed (`cff68a5`).
- Operator has a privileged session to the linked project (e.g. `postgres` / `supabase_admin`) for catalog checks and the apply.
- No poller is wired yet — applying 011 does **not** make alerting operational (the role has no password until step 5).

---

## 1. Pre-check — migration history
Run (read-only):
```bash
supabase migration list --linked
```
**Expected, given the 010 exception:**
- `010_reconciliation_dlq_select_grant` appears **Local** but **not Remote** (applied surgically, never tracked).
- `011_alert_readonly_role` appears **Local** only (never applied).
- `001`–`008` show **Local = Remote**.

Record the exact output as E2 evidence. Do **not** proceed to any push if the history is not understood.

---

## 2. Decision point — do NOT naive `db push`
Because `010` is missing from the remote `supabase_migrations` history, a naive `supabase db push` would attempt to apply **both** `010` and `011`:
- `010` is idempotent grants (re-running is harmless), **but**
- `db push` running an unexpected/older migration is exactly the risk the 010 exception warns about, and it couples this apply to a history-reconcile that has not been approved.

**Rule:** do **not** run `supabase db push` unless the `010` history has first been reconciled or proven safe under a **separate** explicit approval.

Two acceptable paths (operator chooses, with approval):
- **Path A (RECOMMENDED) — surgical direct SQL.** Apply `011` exactly as `010` was applied: run the file's SQL directly against the linked DB, then log a written exception ("011 applied surgically via direct SQL, not in `supabase_migrations`") — mirroring the 010 precedent. Lowest blast radius; touches only the new role.
- **Path B — reconcile history, then push.** First reconcile/repair the migration history so `010` (and `011`) are correctly represented, then `db push`. More moving parts; only if the operator wants the history fully back in sync. Must be its own approved step.

---

## 3. Recommended apply path (Path A — surgical, explicit approval)
**Run only on explicit "apply 011 now" approval.** As the privileged role, execute the contents of `supabase/migrations/011_alert_readonly_role.sql` against the linked DB (the file is idempotent: `CREATE ROLE` guarded by `IF NOT EXISTS`, grants are no-ops on repeat, policies use `DROP POLICY IF EXISTS` first).

After running, capture as E2 evidence (privileged session):
```sql
-- role exists with the intended attributes
SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
       rolreplication, rolinherit
FROM pg_roles WHERE rolname = 'praxis_alert_ro';

-- the three alert_ro_* policies exist, scoped to praxis_alert_ro
SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE policyname LIKE 'alert_ro_%'
ORDER BY tablename;

-- exactly the intended column grants (and nothing more)
SELECT table_name, column_name, privilege_type
FROM information_schema.role_column_grants
WHERE grantee = 'praxis_alert_ro'
ORDER BY table_name, column_name;
```
Then log the written exception (Path A) in `DECISIONS.md` / Current Status, exactly as for 010.

---

## 4. (If Path B chosen) history reconcile
Out of scope to detail here — must be its own gated step with its own approval and evidence. Do not improvise a `db push` mid-apply. If unsure, use Path A.

---

## 5. Password provisioning — SEPARATE, operator-only, out-of-band
**The agent never does this and never sees the value.**
- Provision the login password as a separate operator step, e.g.:
  ```sql
  -- run by the OPERATOR only; value comes from the secret store, NEVER typed in chat/git
  ALTER ROLE praxis_alert_ro PASSWORD '<operator-managed secret>';
  ```
- Store the secret in Doppler / the operator-managed secret store — **never** in the migration file, git, this doc, or chat.
- Applying 011 (steps 1–3) does **not** require the password; the password is needed only when the poller connects.
- After provisioning, **confirm the intended connection path**: the poller authenticates as `praxis_alert_ro` via the direct / session connection string; verify behaviour through the pooler before relying on it.

---

## 6. 7-point verification
Two ways to run as the role:
- **(preferred for grant/RLS checks, no password needed):** in a privileged session, `SET ROLE praxis_alert_ro;` … run checks … `RESET ROLE;`. `auth.uid()` is NULL here (no JWT) — identical to the real poller's direct connection, so RLS behaves exactly as in production.
- **(connectivity check, needs password):** connect with the real `praxis_alert_ro` credentials once provisioned (step 5).

Use a wide lower bound where a watermark param is needed, e.g. `'1970-01-01T00:00:00Z'`.
Run the read/RLS checks (1, 3, 4, 7-as-role) inside one `SET ROLE praxis_alert_ro; … RESET ROLE;`
block; the catalog checks (5, 6) run as the privileged role. The **write-negative checks (2) run as
separate, isolated `BEGIN; … ROLLBACK;` transactions** — a `42501` aborts its transaction, so they
cannot share a session and must not be chained.

**(1) Intended SELECT queries WORK** — `SET ROLE praxis_alert_ro;`
```sql
SELECT count(*)::int AS n, max(created_at) AS newest
  FROM public.trades_dlq   WHERE created_at  > '1970-01-01T00:00:00Z';
SELECT count(*)::int AS n FROM public.trades_dlq;
SELECT count(*)::int AS n, max(received_at) AS newest
  FROM public.webhook_logs WHERE status = 'queue_failed' AND received_at > '1970-01-01T00:00:00Z';
SELECT count(*)::int AS n
  FROM public.trades
  WHERE status IN ('pending','unknown')
    AND created_at < now() - make_interval(secs => 300)
    AND deleted_at IS NULL;
```
PASS = all four return a row, no error.

**(2) Writes FAIL `42501`** — write privilege must be denied at the privilege layer.
Do **not** use `WHERE false` (an empty match can read as `UPDATE 0`/`DELETE 0` and proves nothing).
These statements target **real rows** via granted (readable) columns, so the only thing that can
stop them is the missing write privilege. In Postgres the INSERT/UPDATE/DELETE privilege is enforced
regardless of how many rows match, so a `42501` here proves denial. Each negative write runs in its
**own** transaction and is rolled back, so nothing is ever persisted even in the (impossible) case a
write were permitted. A `42501` aborts its transaction — never chain these in one `BEGIN`.

Run this wrapper once **per** statement (substitute one write each time):
```sql
BEGIN;
SET ROLE praxis_alert_ro;
-- << one write statement here >>          -- expect 42501
RESET ROLE;
ROLLBACK;
```
Write statements to test (each inside its own wrapper above):
```sql
-- INSERT: no INSERT privilege on trades_dlq
INSERT INTO public.trades_dlq (trade_id, bot_id, signal_id, raw_payload, failure_reason)
  VALUES (gen_random_uuid(), gen_random_uuid(), 'verify', '{}'::jsonb, 'verify');   -- expect 42501

-- UPDATE: targets real rows (created_at is granted/readable); no UPDATE privilege on status
UPDATE public.trades SET status = status
  WHERE created_at > '1970-01-01T00:00:00Z';                                        -- expect 42501

-- DELETE: targets real queue_failed rows (status is granted/readable); no DELETE privilege
DELETE FROM public.webhook_logs WHERE status = 'queue_failed';                      -- expect 42501
```
PASS = each statement raises `42501` (SQLSTATE 42501, `permission denied`) and the surrounding
`ROLLBACK` leaves the table untouched.

> **`TRUNCATE` is intentionally NOT part of standard verification.** It is too destructive to place
> in an operator runbook even as a negative test (risk of being run by mistake on a real table). If
> ever exercised, treat it as an isolated destructive-negative test only — **do not run** as part of
> the standard pass.

**(3) Column overreach FAILS `42501`** — non-granted columns:
```sql
SELECT exchange_order_id FROM public.trades       LIMIT 1; -- expect 42501
SELECT raw_payload       FROM public.webhook_logs LIMIT 1; -- expect 42501
SELECT failure_reason    FROM public.trades_dlq   LIMIT 1; -- expect 42501
```
PASS = each raises `42501` (no column privilege).

**(4) Table overreach FAILS `42501`** — non-granted tables:
```sql
SELECT 1 FROM public.user_exchange_credentials LIMIT 1; -- expect 42501
SELECT 1 FROM public.bots                      LIMIT 1; -- expect 42501
SELECT 1 FROM public.reconciliation_jobs       LIMIT 1; -- expect 42501
```
PASS = each raises `42501`. Then `RESET ROLE;`.

**(5) No `service_role` (or any) membership** — privileged session:
```sql
SELECT g.rolname AS member_of
FROM pg_auth_members m
JOIN pg_roles g ON g.oid = m.roleid
JOIN pg_roles r ON r.oid = m.member
WHERE r.rolname = 'praxis_alert_ro';
```
PASS = **0 rows** (no memberships; specifically not `service_role`).

**(6) No `BYPASSRLS` / no elevated attrs** — privileged session:
```sql
SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication,
       rolcanlogin, rolinherit
FROM pg_roles WHERE rolname = 'praxis_alert_ro';
```
PASS = `rolsuper=f, rolbypassrls=f, rolcreatedb=f, rolcreaterole=f, rolreplication=f, rolinherit=f, rolcanlogin=t`.

**(7) RLS scoping matches expected rows** — the role sees only alert-relevant rows:
```sql
-- privileged: compute the expected scoped counts
SELECT
  count(*) FILTER (WHERE status IN ('pending','unknown') AND deleted_at IS NULL) AS trades_expected,
  count(*) AS trades_all
FROM public.trades;
SELECT count(*) FILTER (WHERE status = 'queue_failed') AS webhook_expected,
       count(*) AS webhook_all
FROM public.webhook_logs;

-- as the role: SET ROLE praxis_alert_ro;
SELECT count(*) AS trades_visible  FROM public.trades;        -- expect = trades_expected
SELECT count(*) AS webhook_visible FROM public.webhook_logs;  -- expect = webhook_expected
SELECT count(*) AS dlq_visible     FROM public.trades_dlq;    -- expect = all DLQ rows (USING true)
-- RESET ROLE;
```
PASS = `trades_visible = trades_expected`, `webhook_visible = webhook_expected`, `dlq_visible = total DLQ rows`. If `*_all > *_expected`, that confirms the role cannot see healthy rows.

Record all seven outcomes (E1 for induced negatives, E2 for catalog reads).

---

## 7. Criteria for marking S4-1 CLOSED
S4-1 (alerting Phase 1) is **CLOSED** only when **all** hold:
1. **Code/file-complete** — already true: shared lib (`abf94b3`), criteria engine (`3f627d3`), poller skeleton (`d47b058`), Telegram sender (`e200f98`), worker heartbeat (`c458988`), migration file (`cff68a5`).
2. **011 applied** — role + column grants + `alert_ro_*` policies present (step 3 catalog evidence, E2).
3. **7-point verification all PASS** (step 6, E1/E2) — recorded.
4. **Password provisioned out-of-band + connection path confirmed** (step 5, E1) — the poller can authenticate as `praxis_alert_ro` via the intended path.
5. **Operational capstone (recommended):** one induced alert proven end-to-end — poller (`SqlEvidenceSource` over `praxis_alert_ro`) → criteria engine → Telegram sender → delivered, **fixture/controlled induction first** per the alerting runbook, no secret leak (E1). Scheduling the external poller is the operational wiring for this.
6. Written exception logged (Path A) and Current Status / Kanban / `DECISIONS.md` updated to reflect closure.

Until 2–5 are done, S4-1 stays **code/file-complete, NOT closed** (current state).

---

## 8. Stop conditions (abort immediately, leave DB untouched)
- Any attempt to **apply without explicit approval** at the moment of running.
- Any `supabase db push` **without** the migration-010 pre-check (step 1) and an approved reconcile/decision (step 2).
- `db push` attempting to run any **unexpected/older migration**.
- Any **password** appearing in the SQL file, git, this doc, or chat.
- Any verification anomaly: a write-negative test does **not** raise `42501` (a write succeeds, or returns `UPDATE 0`/`DELETE 0` without a privilege error), column/table overreach **succeeds**, `rolbypassrls=t` or any elevated attr `t`, a non-empty membership list, or RLS counts **not** matching the scoped expectation.
- Running `TRUNCATE` (or any destructive statement) as part of standard verification — it is excluded by design (§6.2).
- Running a write-negative test **outside** a `BEGIN … ROLLBACK` transaction.
- Any grant broader than the column-level SELECTs in 011, any membership in `service_role`, or any change touching **Migration 009** (frozen).
- Any DB/Doppler/Railway change beyond the scoped 011 apply + the operator's out-of-band password step.

---

## 9. Rollback / cleanup
The migration is additive (one role + its grants/policies). To fully undo (privileged session, explicit approval):
```sql
-- 1. drop the role's policies
DROP POLICY IF EXISTS alert_ro_dlq_select     ON public.trades_dlq;
DROP POLICY IF EXISTS alert_ro_webhook_select ON public.webhook_logs;
DROP POLICY IF EXISTS alert_ro_trades_select  ON public.trades;

-- 2. revoke its grants
REVOKE SELECT (created_at)                     ON public.trades_dlq   FROM praxis_alert_ro;
REVOKE SELECT (status, received_at)            ON public.webhook_logs FROM praxis_alert_ro;
REVOKE SELECT (status, created_at, deleted_at) ON public.trades       FROM praxis_alert_ro;
REVOKE USAGE ON SCHEMA public                  FROM praxis_alert_ro;

-- 3. drop the role (owns nothing else; safe after revokes)
DROP ROLE IF EXISTS praxis_alert_ro;
```
Notes:
- `DROP ROLE` fails if any grant/dependency remains — run steps 1–2 first.
- Dropping the role also removes its password; no separate secret cleanup beyond rotating/removing it from the operator store.
- Rollback is only needed if apply or verification fails; on success there is no cleanup (the role is the deliverable).
