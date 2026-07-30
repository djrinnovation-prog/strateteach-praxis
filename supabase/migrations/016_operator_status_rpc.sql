-- 016_operator_status_rpc.sql — Operator Console read RPC + protected operator flag — S5 Slice 1b
-- ============================================================================
-- Adds:
--   1. profiles.is_operator (deny-by-default) — the operator allowlist flag.
--   2. A BEFORE UPDATE guard so a USER (JWT) context can NEVER change is_operator — only a privileged
--      (service_role / admin, auth.uid() IS NULL) session may. The existing profiles_update RLS policy
--      (USING id = auth.uid()) lets a user update their OWN row, so without this guard a user could
--      self-assign is_operator=true. The guard enforces "no self-assignment" — not just documents it.
--   3. operator_status() — a READ-ONLY SECURITY DEFINER RPC. Denies (RAISE, never partial/empty) unless
--      the caller is an authenticated operator. Returns a NON-SECRET status payload only, ignores
--      soft-deleted bots, and surfaces bot/credential validity (config_ready vs execution_ready).
--
-- NOT auto-applied. GATED. **Migration 009 frozen.** Do NOT `db push` (010–015 surgical, absent from
-- supabase_migrations). Apply surgically (transaction-wrapped `db query --linked --file`) only on
-- approval; then run sql/016_operator_status_verify.sql (transaction + ROLLBACK) to verify; reconcile.
--
-- Depends on: 015 (worker_status), 007 (public.pgmq_queue_length), 001 (profiles/bots/trades/
-- trades_dlq/reconciliation_jobs/user_exchange_credentials + 002 profile trigger), 014 (sizing/risk).
-- ============================================================================

-- 1. Operator allowlist flag — deny-by-default. Provisioned only by a gated privileged UPDATE (§2 guard).
ALTER TABLE public.profiles
  ADD COLUMN is_operator boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_operator IS
  'Operator-console allowlist. Deny-by-default. Changeable ONLY by a privileged (auth.uid() IS NULL)
   session — the guard trigger blocks any user-context change. No self-assignment, no role-mgmt UI (v1).';

-- 2. Guard: a user (JWT) context may not change is_operator. Privileged sessions (auth.uid() IS NULL,
--    i.e. service_role / direct admin) may, which is how operators are provisioned.
CREATE OR REPLACE FUNCTION public.guard_profiles_is_operator()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.is_operator IS DISTINCT FROM OLD.is_operator AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'profiles.is_operator cannot be changed by a user; provision via a privileged session'
      USING errcode = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_guard_is_operator
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profiles_is_operator();

-- 3. operator_status() — read-only console status. SECURITY DEFINER so it can aggregate counts across
--    RLS-protected tables, but it exposes ONLY non-secret fields and performs NO writes.
CREATE OR REPLACE FUNCTION public.operator_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_is_op boolean;
  v_out   jsonb;
BEGIN
  -- Deny-by-default, never a partial/empty success:
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'operator_status: not authenticated' USING errcode = '42501';
  END IF;

  SELECT p.is_operator INTO v_is_op FROM public.profiles p WHERE p.id = v_uid;
  IF v_is_op IS DISTINCT FROM true THEN   -- NULL (no profile) OR false (not an operator) → forbidden
    RAISE EXCEPTION 'operator_status: forbidden' USING errcode = '42501';
  END IF;

  SELECT jsonb_build_object(
    'bots', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'trading_pair',         b.trading_pair,
               'bot_status',           b.status,
               'trading_enabled',      b.trading_enabled,
               'sizing_mode',          b.sizing_mode,
               'exchange_environment', c.exchange_environment,
               'credential_status',    c.status,
               'credential_ok',        (c.status = 'valid' AND c.deleted_at IS NULL),
               -- config_ready: sizing/risk config present (mode-specific) + env present
               'config_ready',
                 (b.sizing_mode IS NOT NULL
                  AND b.max_order_notional_usdt IS NOT NULL
                  AND b.daily_notional_cap_usdt IS NOT NULL
                  AND ((b.sizing_mode = 'percent_of_balance' AND b.position_size_pct  IS NOT NULL)
                    OR (b.sizing_mode = 'fixed_notional'     AND b.fixed_notional_usdt IS NOT NULL))
                  AND c.exchange_environment IS NOT NULL),
               -- execution_ready: config_ready AND bot active AND credential valid/not-deleted
               'execution_ready',
                 (b.status = 'active'
                  AND c.status = 'valid' AND c.deleted_at IS NULL
                  AND c.exchange_environment IS NOT NULL
                  AND b.sizing_mode IS NOT NULL
                  AND b.max_order_notional_usdt IS NOT NULL
                  AND b.daily_notional_cap_usdt IS NOT NULL
                  AND ((b.sizing_mode = 'percent_of_balance' AND b.position_size_pct  IS NOT NULL)
                    OR (b.sizing_mode = 'fixed_notional'     AND b.fixed_notional_usdt IS NOT NULL)))
             ) ORDER BY b.trading_pair)
      FROM public.bots b
      LEFT JOIN public.user_exchange_credentials c ON c.id = b.credential_id
      WHERE b.deleted_at IS NULL
    ), '[]'::jsonb),
    'enabled_bots', (SELECT count(*) FROM public.bots WHERE trading_enabled = true AND deleted_at IS NULL),
    'open_trades',  (SELECT count(*) FROM public.trades
                      WHERE status IN ('pending','submitted','unknown') AND deleted_at IS NULL),
    'dlq',          (SELECT count(*) FROM public.trades_dlq),
    'open_recon',   (SELECT count(*) FROM public.reconciliation_jobs WHERE status = 'pending'),
    'queue_length', public.pgmq_queue_length('trade_signals'),
    'worker_status', (
      SELECT jsonb_build_object(
               'queue_enabled',    w.queue_enabled,
               'is_production',    w.is_production,
               'worker_state',     w.worker_state,
               'boot_stuck_count', w.boot_stuck_count,
               'updated_at',       w.updated_at
             )
      FROM public.worker_status w LIMIT 1
    )
  ) INTO v_out;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.operator_status() IS
  'Operator-console read-only status (Slice 1b). Denies non-operators (RAISE 42501). Ignores soft-deleted
   bots. NON-SECRET payload only: per-bot trading_pair/bot_status/trading_enabled/sizing_mode/
   exchange_environment/credential_status/credential_ok/config_ready/execution_ready; enabled_bots;
   open_trades; dlq; open_recon; queue_length; worker_status. No mutation. Never returns vault pointers,
   keys, tokens, or any secret.';

-- Execute granted to authenticated only (the function itself then enforces is_operator). Never anon/public.
REVOKE ALL ON FUNCTION public.operator_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_status() TO authenticated;
