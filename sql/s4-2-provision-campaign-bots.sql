-- s4-2-provision-campaign-bots.sql — TEMPLATE (operator fills the four <HASH_*> values out-of-band)
-- ============================================================================
-- S4-2 campaign bots: create 4 new testnet bots (ETHUSDT/BNBUSDT/SOLUSDT/XRPUSDT)
-- alongside the existing BTCUSDT bot (2dcaddba…), for the 5-symbol 50-trade campaign.
--
-- NOT auto-applied. GATED operator step. Inherits user_id + shared testnet credential +
-- account_type from the existing BTCUSDT bot (no hardcoded user/credential UUIDs). Each
-- `webhook_secret_hash` is `v1:<hex>` computed OUT-OF-BAND from a fresh per-bot token + the
-- WEBHOOK_SECRET_PEPPER — see docs/sprint4-s4-2-bot-provisioning-runbook.md. The agent never
-- generates or sees a token/pepper/hash. Idempotent: re-running will NOT duplicate (guarded on name).
--
-- SAFETY: these are inert rows. A bot only executes when (a) the worker queue is ARMED
-- (QUEUE_ENABLED=true) AND (b) a signal is fired to /webhook/{bot_id}/{token} with the bot's
-- secret token (operator-held). Creating active bots does NOT auto-trade. Testnet only.
-- ============================================================================

-- DEFAULTS (override before applying): symbols ETHUSDT/BNBUSDT/SOLUSDT/XRPUSDT; ONE shared
-- testnet credential (the existing one); status 'active'. Replace each <HASH_*> with the
-- operator-computed `v1:<64-hex>` value for that bot's token.

INSERT INTO public.bots
  (user_id, credential_id, name, trading_pair, account_type, webhook_secret_hash, status)
SELECT b.user_id, b.credential_id, v.name, v.trading_pair, b.account_type, v.hash, 'active'
FROM public.bots b
CROSS JOIN (VALUES
  ('S4-2 Campaign ETHUSDT', 'ETHUSDT', '<HASH_ETH>'),
  ('S4-2 Campaign BNBUSDT', 'BNBUSDT', '<HASH_BNB>'),
  ('S4-2 Campaign SOLUSDT', 'SOLUSDT', '<HASH_SOL>'),
  ('S4-2 Campaign XRPUSDT', 'XRPUSDT', '<HASH_XRP>')
) AS v(name, trading_pair, hash)
WHERE b.id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2'   -- template: BTCUSDT bot (user/credential/account_type source)
  AND b.deleted_at IS NULL                            -- never clone from a soft-deleted template
  AND v.hash ~ '^v1:[0-9a-f]{64}$'                    -- SKIP any unfilled <HASH_*> placeholder; mirrors the webhook HASH_RE
  AND NOT EXISTS (
    SELECT 1 FROM public.bots x WHERE x.name = v.name AND x.deleted_at IS NULL
  )
RETURNING id, name, trading_pair, status, credential_id;
-- The RETURNING row count MUST equal 4. Fewer than 4 ⇒ some <HASH_*> was unfilled (regex-skipped) or a
-- name already exists — investigate; do NOT proceed to the campaign until all 5 bots are present + active.

-- After INSERT, the per-bot webhook URL is:  /functions/v1/webhook/{RETURNING id}/{that bot's token}
-- The {token} is operator-held (never committed); the simulator uses it to fire signals.
