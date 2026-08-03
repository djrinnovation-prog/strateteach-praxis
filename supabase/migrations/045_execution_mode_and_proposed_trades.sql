-- 045 — StrateTeach-style arm/go-live + per-order approval (UI model); Praxis execution UNCHANGED.
--
-- Model (matches StrateTeach): a bot is ARMED into SIMULATION first (dry-run — real signals, simulated fills,
-- NO real orders), then a deliberate GO-LIVE switches it to LIVE. In LIVE, each signal produces a PROPOSED
-- order that the user must explicitly APPROVE before the worker executes it (StrateTeach: "the pilot never
-- buys on its own"). The Praxis money-path — insert_pending_trade_atomic (caps) + BinanceAdapter.createOrder
-- + every fail-closed gate + the mainnet double-gate — is NOT modified: this only adds (a) a SIMULATED branch
-- and (b) a human-approval gate that runs BEFORE createOrder. Approval executes the existing path 1:1.

-- Bot execution mode. DEFAULT 'simulation' = fail-closed: no bot is real until a deliberate go-live.
ALTER TABLE public.bots
  ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'simulation'
    CHECK (execution_mode IN ('simulation','live'));

-- Mark a trade row that was SIMULATED (arm=simulation) — recorded for the user's view, never sent to the
-- exchange. Keeps the existing trade_status enum + lifecycle untouched.
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS simulated boolean NOT NULL DEFAULT false;

-- The per-order APPROVAL QUEUE (LIVE bots). A live-bot signal inserts one 'pending' row here (NOT a real
-- order). The user Approves → the worker runs the normal Praxis order path + links the resulting trade;
-- Rejects → 'rejected' (nothing placed); unapproved past expires_at → 'expired' (fail-safe, nothing placed).
-- Carries the non-secret proposal details needed to size/execute; NEVER a key or vault pointer.
CREATE TABLE IF NOT EXISTS public.proposed_trades (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id                   uuid NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  user_id                  uuid NOT NULL,                       -- owner (isolation; matches bots.user_id)
  signal_id                text NOT NULL,                       -- the originating signal (idempotency/correlation)
  side                     text NOT NULL CHECK (side IN ('buy','sell')),
  trading_pair             text NOT NULL,
  requested_notional_usdt  numeric,                             -- BUY sizing at proposal time (null for SELL exits)
  price_at_signal          numeric,                             -- live market price when proposed (display)
  status                   text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','approved','rejected','expired')),
  trade_id                 uuid REFERENCES public.trades(id),   -- set once approved + the real trade is created
  expires_at               timestamptz NOT NULL,                -- auto-expire an un-approved proposal (fail-safe)
  created_at               timestamptz NOT NULL DEFAULT now(),
  decided_at               timestamptz,                         -- when approved/rejected/expired
  UNIQUE (bot_id, signal_id)                                    -- one proposal per (bot, signal) — no dup on retry
);

CREATE INDEX IF NOT EXISTS idx_proposed_trades_user_pending
  ON public.proposed_trades (user_id, status) WHERE status = 'pending';

-- Deny-all RLS + service_role only (same posture as bots / trades / mainnet_approvals). The browser reads
-- pending proposals ONLY through an ownership-scoped Edge function, never directly.
ALTER TABLE public.proposed_trades ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.proposed_trades FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proposed_trades TO service_role;
