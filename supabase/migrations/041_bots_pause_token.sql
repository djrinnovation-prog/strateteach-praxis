-- 041 — Phase 2C (Option A) · M4: a long-lived, per-bot KILL (pause) token.
--
-- INV-8: the user must ALWAYS retain a way to stop their own bot — even if StrateTeach is down (so a
-- StrateTeach-minted pause ticket is unavailable). We give the user a long-lived per-bot pause token at
-- create-bot time (shown ONCE, like the webhook url_token); only its hash is stored here. The pause-bot
-- Edge function accepts either that token (holder-proof ownership, StrateTeach-independent) OR a signed
-- single-use pause_bot ticket. Pausing sets trading_enabled=false + status='paused' (same as the existing
-- user_pause_own_bot). The token can only PAUSE — never arm, never trade — so its blast radius is a single
-- bot halt (safe direction).
--
-- Hash scheme mirrors webhook_secret_hash (pepper-derived, in the Edge function). Nullable: bots created
-- BEFORE M4 have no long-lived token, so INV-8's token path applies only to POST-M4 bots — pre-M4 bots
-- rely on the StrateTeach pause ticket + the operator kill. A token ROTATE/REISSUE path (and revoke) is a
-- tracked follow-up (M7 hardening): today the token is minted only at create-bot and cannot be rotated, so
-- a leaked token is an unrevocable single-bot pause-DoS (safe direction — pause-only, never arms).
--
-- DEPLOY ORDERING: this migration MUST be applied before the M4 create-bot deploys — create-bot inserts
-- pause_token_hash unconditionally, so a missing column fails EVERY bot creation.

ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS pause_token_hash TEXT;

COMMENT ON COLUMN public.bots.pause_token_hash IS
  'Phase 2C-A M4: hash of the long-lived per-bot KILL token (INV-8). Token shown once at create-bot; pause-bot accepts it StrateTeach-independently. Pause-only.';
