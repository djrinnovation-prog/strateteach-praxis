# S4-2 — Campaign bot provisioning runbook (5 symbols)

**Status:** DOC + TEMPLATE SQL ONLY. Not applied. Provisions the campaign bots the S4-2 checklist
depends on. **GATED DB write** (creating `bots` rows). **No arm/fire** (bots are inert until the queue
is armed AND a signal is fired with the bot's secret token). Testnet only. **Migration 009 frozen.**
The agent never generates/sees a token, the pepper, or a hash — all secret steps are operator-only.

## 1. Design / decisions
- **5 symbols [DEFAULT — override]:** keep the existing **BTCUSDT** bot (`2dcaddba…`, active, valid
  credential) + create **4 new**: ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT.
- **Shared credential [DEFAULT — recommended]:** all 5 bots use the existing testnet credential
  `2b5c038a…` (one Binance testnet account trades all symbols). The template SQL inherits
  `user_id`/`credential_id`/`account_type` from the BTCUSDT bot via subquery — no hardcoded UUIDs.
  *(Alternative: per-symbol credentials — only if you want isolated keys; more provisioning.)*
- **Status `active`** (a bot must be `active` to process; activation is just a flag — see Safety).
- **Balances (operator):** fund the testnet account's USDT for all 5 pairs (≥50 small fills + headroom).

## 2. Per-bot webhook secret (OPERATOR ONLY — secret)
Each bot stores `webhook_secret_hash = 'v1:' + hex(HMAC-SHA256(key, token))` where
`key = base64url-decode(WEBHOOK_SECRET_PEPPER)` and `token` = a **fresh random per-bot secret** (the
`{secret}` path segment). This mirrors `supabase/functions/webhook/index.ts` exactly.

For each bot, out-of-band (pepper + token never leave your shell, never pasted to the agent). The
`WEBHOOK_SECRET_PEPPER` is injected into the hashing program's env via `doppler run` (never re-typed).
The token goes via **stdin, never argv** (argv is visible in `ps` on a shared host), and via
`printf '%s'` (NO trailing newline — the webhook HMACs the raw token with no newline; `echo` would
corrupt the hash).

**Write the program to a file** so stdin carries the token alone. Do NOT inline it as
`printf … | python3 - <<'PY'`: the pipe and the heredoc both target stdin and collide — the token gets
prepended to the program (verified: `SyntaxError` / wrong hash). (This was a defect in an earlier draft.)
```bash
# 1. write the (non-secret) hashing PROGRAM to a file, so stdin carries ONLY the token:
cat > /tmp/s4-hash.py <<'PY'
import sys, hmac, hashlib, base64, os
pepper = os.environ['WEBHOOK_SECRET_PEPPER']                # base64url, injected by `doppler run`
key = base64.urlsafe_b64decode(pepper + '=' * (-len(pepper) % 4))
token = sys.stdin.buffer.read()                            # raw token bytes, no trailing newline
print('v1:' + hmac.new(key, token, hashlib.sha256).hexdigest())
PY

# 2. per bot — fresh token (KEEP SECRET); pepper from Doppler, token via stdin only:
read -rs -p 'new bot token: ' BOT_TOKEN; echo
printf '%s' "$BOT_TOKEN" | doppler run -p praxis-platform -c dev -- python3 /tmp/s4-hash.py
unset BOT_TOKEN

# 3. after ALL bots are hashed, remove the (non-secret) program file:
rm -f /tmp/s4-hash.py
```
Each result is `v1:<64-lowercase-hex>` (matches the webhook's `^v1:[0-9a-f]{64}$`). Record each hash + its
token **securely** (token → operator secret store; you need it to fire signals). Tokens are NEVER
committed; do not paste tokens/pepper/hashes into chat.

## 3. Apply (GATED)
1. Read-only pre-check: confirm the template bot + shared credential are usable, and the 4 names are free:
   ```sql
   SELECT id, user_id, credential_id, status FROM public.bots WHERE id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2';
   SELECT name FROM public.bots WHERE name LIKE 'S4-2 Campaign %' AND deleted_at IS NULL;  -- expect 0 rows
   ```
2. Fill the four `<HASH_*>` placeholders in `sql/s4-2-provision-campaign-bots.sql` with the §2 hashes
   (a local working copy — do NOT commit the filled file).
3. Apply (read the RETURNING output → record the 4 new `bot_id`s for the simulator):
   ```bash
   supabase db query --linked --file <your-filled-copy>.sql
   ```
   **`RETURNING` MUST show 4 rows** — but this is **necessary, NOT sufficient**: it only proves rows were
   inserted, not that they are correct/fireable. Fewer than 4 ⇒ an unfilled `<HASH_*>` (regex-skipped) or
   a name already exists → STOP, fix, re-run (idempotent). **Always follow with the §4 MANDATORY verify**;
   never proceed to firing on `RETURNING=4` alone.
   **Apply role matters (RLS):** apply ONLY via the admin `db query --linked` path — that role **owns**
   `bots` and bypasses RLS (no `FORCE ROW LEVEL SECURITY` is set). Do NOT apply as an RLS-subject role
   (`authenticated` / `service_role`-JWT-less / anything with `auth.uid()=NULL`): the user-facing
   `bots_insert/select` policies would match nothing → the INSERT silently inserts **0 rows** (the
   `RETURNING=4` check is your backstop). If `bots` ever gains `FORCE ROW LEVEL SECURITY`, this needs a
   `SET ROLE`/BYPASSRLS provision first.
   **Name-only idempotency — stale existing rows:** this template only INSERTs and keys idempotency on
   **name** (`NOT EXISTS` on name). A bot already present under one of the 4 names is **silently skipped
   on re-run regardless of whether its `trading_pair`, `credential_id`, or `webhook_secret_hash` is
   stale/wrong** — the corrected values are dropped; the §4 verify is what catches the mismatch. To fix a
   stale row: soft-delete it by name (§6) then re-run, OR a separate gated
   `UPDATE public.bots SET <col>=<value> WHERE name='…' AND deleted_at IS NULL` (same owner/RLS caveat).
   Treat `RETURNING < expected-new` OR any §4 mismatch as the trigger to inspect/fix a stale row.

## 4. Verify (read-only) — MANDATORY before Phase 0 / any firing
`RETURNING=4` (§3) is **necessary but NOT sufficient** — it only proves rows were inserted, not that
they are correct or fireable. You **must** run this full verify and confirm every column:
```sql
SELECT b.name,
       b.trading_pair,
       b.status,
       (b.credential_id = tpl.credential_id)         AS credential_matches_shared,
       c.status                                       AS cred_status,
       (c.deleted_at IS NULL)                         AS cred_ok,
       (b.webhook_secret_hash ~ '^v1:[0-9a-f]{64}$')  AS hash_format_ok
FROM public.bots b
JOIN public.user_exchange_credentials c ON c.id = b.credential_id
CROSS JOIN (SELECT credential_id FROM public.bots WHERE id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2') tpl
WHERE b.deleted_at IS NULL
  AND (b.id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' OR b.name LIKE 'S4-2 Campaign %')
ORDER BY b.trading_pair;
```
**Expect exactly 5 rows** — `BTCUSDT` (template) + `ETHUSDT`, `BNBUSDT`, `SOLUSDT`, `XRPUSDT` — and for
**every** row: `status='active'`, `credential_matches_shared=true` (all share the BTCUSDT template's
testnet credential), `cred_status='valid'`, `cred_ok=true`, `hash_format_ok=true`. Any deviation (wrong
count, wrong symbol, non-active, mismatched credential, invalid credential, or a hash that fails the
`v1:` regex) → **STOP**; fix per §3/§6 before proceeding. Do not rely on `RETURNING=4` alone.
- **Auth smoke (deferred to campaign Phase 0):** the only true test of a bot's `webhook_secret_hash` is
  one authenticated fire of `/webhook/{bot_id}/{token}` returning `accepted` — done in the campaign
  checklist Phase 0 (queue armed), not here.

## 5. Safety / stop conditions
- Bots are **inert rows** until the queue is armed AND a signal is fired with the bot's token; creating
  active bots does not auto-trade. Keep `QUEUE_ENABLED=false` until the campaign.
- Tokens/pepper/hashes never in chat/git; the agent never computes them.
- **Shared-credential rate limits:** 5 bots on one testnet key can hit Binance testnet weight/rate caps
  under burst — the campaign fires in batches (checklist §4) to mitigate; treat the occasional rate-limit
  `failed`/`queue_failed` as a rate-limit signal, not a pipeline defect (it must still be observable, not silent).
- **Follow-up (not this packet):** the `webhook_secret_hash` comment in committed migration `001` still
  says "bcrypt" — stale; the real scheme is `v1:HMAC-SHA256`. Don't edit the committed migration here;
  flag for a docs pass so a future operator doesn't compute the wrong hash.
- **STOP** if: the INSERT would touch any bot other than the 4 new names (re-run guarded by `NOT EXISTS`
  on name); the shared credential is not `valid`; any attempt to write the credential row; any
  `account_type` other than `spot`; any touch of Migration 009.

## 6. Rollback
Bots are reversible (soft-delete): `UPDATE public.bots SET deleted_at = now() WHERE name LIKE 'S4-2 Campaign %' AND deleted_at IS NULL;`
(FK `bots.credential_id ON DELETE RESTRICT` is not engaged by soft-delete). Hard delete only if no
`trades` reference them (FK `trades.bot_id → bots ON DELETE RESTRICT`).
**Same apply-role caveat as §3:** run this UPDATE as the admin/owner role — under an RLS-subject role,
`bots_update USING(user_id=auth.uid())` matches nothing and it silently updates **0 rows** (verify the
affected-row count). The `LIKE 'S4-2 Campaign %'` scope cannot touch the BTCUSDT template (different name).
