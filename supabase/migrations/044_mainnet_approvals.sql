-- 044 — mainnet_approvals (Mainnet Go-Live Plan v1.1 · 1.2 — per-user leg of the double-gate).
--
-- Real-money (mainnet) opens ONLY when BOTH hold:
--   (1) the GLOBAL master-switch env PRAXIS_MAINNET_ENABLED = "true" (default/absent ⇒ false ⇒ ALL mainnet
--       off; this is the instant global kill), AND
--   (2) an ACTIVE row here for the user (operator-approved; NEVER self-serve).
-- Default state = this table EMPTY + the switch unset ⇒ mainnet stays fully fenced, byte-identical to pre-1.2.
-- The Edge functions (connect-credential / validate-credential / arm-bot) call _shared/mainnet-gate.ts, which
-- reads the switch AND this table; the worker independently honours the master-switch per order.
--
-- Deny-all RLS (no policies) + explicit REVOKE from anon/authenticated; only service_role (server-side,
-- RLS-bypassing by design) may read/write. Approval rows are inserted by an operator-only server action,
-- never by a browser/self-serve path.

CREATE TABLE IF NOT EXISTS public.mainnet_approvals (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  approved_by   text        NOT NULL,                 -- operator identity who approved (audit)
  approved_at   timestamptz NOT NULL DEFAULT now(),
  evidence_hash text        NOT NULL,                 -- non-secret hash of the operator's approval evidence (A4)
  active        boolean     NOT NULL DEFAULT true     -- honored by the EDGE gate (blocks NEW connect/validate/arm for this user).
);
-- REVOCATION SCOPE (mainnet-review MED-1): active=false blocks the user at the Edge (no new connect/validate/arm),
-- but the WORKER trade loop currently re-checks only the GLOBAL switch (PRAXIS_MAINNET_ENABLED), NOT this row.
-- So to stop a user's ALREADY-ARMED bot: disarm/pause that bot (pause-bot / KILL) OR flip the global switch.
-- Full runtime per-user revocation in the worker is a REQUIRED follow-up BEFORE a 2nd (partner) real-money user.

ALTER TABLE public.mainnet_approvals ENABLE ROW LEVEL SECURITY;
-- No RLS policies ⇒ deny-all to anon/authenticated. service_role bypasses RLS by design.
REVOKE ALL ON public.mainnet_approvals FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mainnet_approvals TO service_role;
