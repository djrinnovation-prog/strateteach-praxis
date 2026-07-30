-- 014_bot_sizing_risk.sql — DB-configured sizing + server-enforced risk limits (S5-A3/B4)
-- ============================================================================
-- Replaces the temporary per-symbol BUY price floors with bot-config sizing + risk caps.
-- "The code is the guardrail; the database config is the policy." No business sizing/risk
-- VALUES live in code — they live here.
--
-- NOT auto-applied. GATED. **Migration 009 frozen.** Do NOT `db push` (010–013 were applied
-- surgically and are absent from supabase_migrations — a push would re-apply them). Apply
-- surgically via `supabase db query --linked --file` only on explicit approval, then reconcile
-- migration history.
--
-- Fail-closed: all business numeric/text fields default NULL (unconfigured → no order). Only the
-- two booleans have non-NULL defaults (trading_enabled=true kill-switch; sell_enabled=false v1).
-- See docs/sprint5-s5-a3-b4-sizing-risk-design.md.
-- ============================================================================

ALTER TABLE public.bots
  ADD COLUMN sizing_mode             TEXT
    CHECK (sizing_mode IN ('percent_of_balance', 'fixed_notional')),
  ADD COLUMN position_size_pct       NUMERIC
    CHECK (position_size_pct > 0 AND position_size_pct <= 100),
  ADD COLUMN fixed_notional_usdt     NUMERIC
    CHECK (fixed_notional_usdt > 0),
  ADD COLUMN max_order_notional_usdt NUMERIC
    CHECK (max_order_notional_usdt > 0),
  ADD COLUMN daily_notional_cap_usdt NUMERIC
    CHECK (daily_notional_cap_usdt > 0),
  ADD COLUMN trading_enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN sell_enabled            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN sell_size_pct           NUMERIC
    CHECK (sell_size_pct > 0 AND sell_size_pct <= 100);

COMMENT ON COLUMN public.bots.sizing_mode IS
  'Sizing policy: percent_of_balance | fixed_notional. NULL = unconfigured → fail-closed (no order). S5-A3/B4.';
COMMENT ON COLUMN public.bots.position_size_pct IS
  'Percent of free quote balance per BUY. Required only when sizing_mode=percent_of_balance.';
COMMENT ON COLUMN public.bots.fixed_notional_usdt IS
  'Flat per-order notional (USDT). Required only when sizing_mode=fixed_notional (v1: schema-ready).';
COMMENT ON COLUMN public.bots.max_order_notional_usdt IS 'Per-order max notional cap (USDT). Required to trade.';
COMMENT ON COLUMN public.bots.daily_notional_cap_usdt IS 'Per-bot daily notional cap (USDT). Required to trade.';
COMMENT ON COLUMN public.bots.trading_enabled IS
  'Server-side kill switch. FALSE = bot disabled (reported disabled, NOT misconfigured).';
COMMENT ON COLUMN public.bots.sell_enabled IS 'SELL support flag. v1 default FALSE (SELL off).';
COMMENT ON COLUMN public.bots.sell_size_pct IS
  'Percent of free base balance per SELL. Required only when sell_enabled=true.';

-- ── trades: stored notional for daily-cap accounting (never recompute from a later price) ──
ALTER TABLE public.trades
  ADD COLUMN requested_notional_usdt NUMERIC CHECK (requested_notional_usdt >= 0),
  ADD COLUMN executed_notional_usdt  NUMERIC CHECK (executed_notional_usdt >= 0);

COMMENT ON COLUMN public.trades.requested_notional_usdt IS
  'Sized notional (USDT) written at the sizing/risk decision (pending row). Reservation basis for the daily cap.';
COMMENT ON COLUMN public.trades.executed_notional_usdt IS
  'Final fill notional (USDT) from the exchange order cost, when available. Reporting/accounting only.';

-- ── credential environment = the source of truth for the testnet/mainnet guard ──
ALTER TABLE public.user_exchange_credentials
  ADD COLUMN exchange_environment TEXT
    CHECK (exchange_environment IN ('testnet', 'mainnet'));

COMMENT ON COLUMN public.user_exchange_credentials.exchange_environment IS
  'Environment source of truth: testnet | mainnet. Worker blocks on mismatch vs is_production or if NULL.
   NOT the same as bots.account_type (spot|futures = market-type, not environment). NULL = fail-closed.';
