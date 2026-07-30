-- Migration 022: A8-H3 Slice H3-1c — S1a shared-credential DETECTION in operator_status().
--
-- SCHEMA-ONLY / READ-SURFACE DDL. `CREATE OR REPLACE FUNCTION` (DDL of the function definition) even
-- though operator_status() only READS. Adds two ADDITIVE, non-secret per-bot fields and changes NOTHING
-- else (authz, grants, shape, and all existing 020 fields preserved verbatim):
--   * credential_shared  (boolean, NEVER null): is this bot's credential referenced by ANOTHER live bot?
--   * shared_with_count  (int >= 0): count of OTHER live bots sharing this credential.
-- Null credential ⇒ false / 0 (not null). Soft-deleted bots neither appear nor count (deleted_at IS NULL
-- filters both the outer list and the peer subqueries). Self excluded (b2.id <> b.id). Catalog/count only
-- — no vault pointer, key, token, or secret. This is DETECTION only (S1a); it does NOT enforce single-use
-- (that is S1b/H3-2).
--
-- Apply SURGICALLY (transaction-wrapped `supabase db query --linked --file`), NOT via `db push`. GATED:
-- apply LOCAL for tests (supabase/tests/022_operator_status_credential_shared.test.sql); apply LINKED only
-- on explicit operator approval + read-back; then record 022 in schema_migrations.

begin;

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
               'id',                   b.id,
               'trading_pair',         b.trading_pair,
               'bot_status',           b.status,
               'trading_enabled',      b.trading_enabled,
               'sizing_mode',          b.sizing_mode,
               'exchange_environment', c.exchange_environment,
               'credential_status',    c.status,
               'credential_ok',        (c.status = 'valid' AND c.deleted_at IS NULL),
               -- ADDED (022, S1a): shared-credential detection. Boolean never null; count >= 0.
               -- Null credential ⇒ false / 0. Soft-deleted peers excluded. Self excluded.
               'credential_shared',
                 (b.credential_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM public.bots b2
                    WHERE b2.credential_id = b.credential_id
                      AND b2.deleted_at IS NULL AND b2.id <> b.id)),
               'shared_with_count',
                 (SELECT count(*) FROM public.bots b2
                    WHERE b2.credential_id = b.credential_id
                      AND b2.deleted_at IS NULL AND b2.id <> b.id),
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
    'kill_rpc_present', (SELECT EXISTS (
                           SELECT 1 FROM pg_catalog.pg_proc p
                           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                           WHERE n.nspname = 'public' AND p.proname = 'operator_kill_all'
                         )),
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
  'Operator-console read-only status (022 adds per-bot credential_shared + shared_with_count for A8-H3 S1a
   detection). Denies non-operators (RAISE 42501). Ignores soft-deleted bots. NON-SECRET payload only:
   per-bot id/trading_pair/bot_status/trading_enabled/sizing_mode/exchange_environment/credential_status/
   credential_ok/credential_shared/shared_with_count/config_ready/execution_ready; enabled_bots; open_trades;
   dlq; open_recon; queue_length; kill_rpc_present (catalog boolean, no execute); worker_status. No mutation.
   Never returns vault pointers, keys, tokens, or secrets.';

-- Authz/grants preserved verbatim (re-asserted, idempotent): authenticated only; the body enforces is_operator.
REVOKE ALL ON FUNCTION public.operator_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_status() TO authenticated;

commit;
