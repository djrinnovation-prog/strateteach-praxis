# LIVE-PATH — B1 fresh webhook token via deployed G-TVR (packet)

Rotate bot `2dcaddba-…` to a fresh webhook token using the **deployed owner-gated G-TVR** Edge function.
**PACKET ONLY — do not rotate yet.** The **operator** generates + holds the token (shown once); Claude never
sees/handles/prints it. Server stores the **hash only**; G-TVR returns a **fingerprint only**.

Bot owner: `66e1b075-930e-4a20-9289-ca8668699eea`. Current stored-hash fingerprint (before): `v1:ad064b40..a4a8304d`.

## 1. PRE checks (read-only — verified)
- Bot `2dcaddba` exists, `status='paused'`, owner `66e1b075` ✅.
- `webhook_secret_hash` is a valid `v1:<64hex>` ✅ — G-TVR's compare-and-swap needs an existing valid hash.
- G-TVR `rotate-bot-webhook-token` is **deployed + ACTIVE** ✅.
- **The operator must be able to authenticate as the bot OWNER (`66e1b075`)** — G-TVR is owner-gated
  (`bots.user_id == auth.uid()`). If Oren's login is that account → G-TVR works. If NOT the owner, use the
  operator fallback (§2 Option C, admin-rotate with `operator_override`).
- Rotation changes ONLY `webhook_secret_hash`; the bot stays `paused`/`trading_enabled=false`.

## 2. Exact rotation method (G-TVR; pick one — client generates the token, server stores the hash)
G-TVR contract: `POST /functions/v1/rotate-bot-webhook-token`, `Authorization: Bearer <owner JWT>`, body
`{bot_id, token}` (client-generated plaintext, `^[A-Za-z0-9_-]{32,}$`) → `{ ok, bot_id, new_fp }` (fingerprint
only; the plaintext is NEVER returned/logged/stored).

- **Option A (SAFEST — in-product UI):** deploy the frontend with `VITE_TV_CONNECT_ENABLED=true` (the held
  frontend-deploy packet), sign in as the owner, Bot Setup → Step 4 → "Rotate webhook token". The browser
  generates the token, **reveals it once**, calls G-TVR, and **wipes it on dismiss** — zero shell/log
  exposure. Best hygiene, but requires the frontend deploy.

- **Option B (no frontend deploy — browser DevTools + G-TVR):** signed in to the console as the OWNER, in the
  DevTools console:
  ```js
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
  // >>> COPY `token` to your password manager NOW — shown once, non-recoverable <<<
  const jwt = (await /* app supabase client */.auth.getSession()).data.session.access_token;
  const r = await fetch('https://<project-ref>.supabase.co/functions/v1/rotate-bot-webhook-token', {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ bot_id: '2dcaddba-b62d-47e1-87a7-7f7b759f38d2', token }),
  });
  console.log(await r.json()); // { ok:true, bot_id, new_fp } — save new_fp for verification
  ```
  Token stays in browser memory + your password manager; never in shell history/argv/server logs.

- **Option C (operator fallback — only if you are NOT the bot owner):** `admin-rotate-webhook-token` with
  `operator_override:true` (M-1, audited cross-owner). Same "client generates, server stores hash" model;
  deliver the token via stdin/header, never argv. Use only if Option A/B aren't possible.

**Recommended:** Option A if you're willing to do the (held) frontend deploy; otherwise Option B.

## 3. How the plaintext token is safely captured/saved
- The **operator** generates it client-side (browser) and immediately saves it to a **password manager** — it
  is shown ONCE; G-TVR never returns it, and it is non-recoverable afterward.
- **Claude never generates, sees, transmits, or logs the token.** My only role is the read-only
  before/after **fingerprint** verification (§4) — I never touch the plaintext.
- No plaintext in the DB (hash only), no plaintext in any log (G-TVR logs fingerprints), no plaintext in
  shell argv (browser path avoids the shell entirely).

## 4. Post-rotation verification (read-only — Claude can run)
```sql
select left(webhook_secret_hash,11)||'..'||right(webhook_secret_hash,8) as hash_fp,
       (webhook_secret_hash ~ '^v1:[0-9a-f]{64}$') as hash_shape_v1,
       status, trading_enabled
from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2';
```
Expect: `hash_fp` **DIFFERENT** from the before value `v1:ad064b40..a4a8304d`, and equal to G-TVR's returned
`new_fp` (prefixed `v1:`); `hash_shape_v1=true`; `status='paused'`, `trading_enabled=false` (unchanged). The
DB never holds the plaintext.

## 5. Manual single-fire command shape (for LATER — after arming; do NOT run now)
Fire exactly ONE BUY signal with the saved token via the hardened fire script (token from a hidden prompt,
URL delivered on stdin — never argv; ids from env, not committed):
```
export WB6_PROJECT_REF=<project-ref>
export WB6_BOT_ID=2dcaddba-b62d-47e1-87a7-7f7b759f38d2
scripts/wb6-e1-fire.sh 'TINYLIVE-<unique-signal-id>'   # prompts for the token (hidden); one BUY, fresh signal_id
```
This only matters AFTER the bot is armed (tier flip + queue + activate) — it fires nothing on a paused bot
(the webhook rejects `bot_not_active`).

## 6. Rollback / rotate-again
- A rotation is NOT reversible — the previous plaintext is non-recoverable. To "undo", simply **rotate again**
  (G-TVR) to a new token; the newest token is the live one.
- No downstream to break: no TradingView alert is configured yet, so rotating has no external impact.
- If a token is lost/suspect, rotate again immediately; the old one stops working the moment the new hash is
  stored.

## Boundaries
Packet only — no rotation performed, no signal fired, no queue enabled, no activation, no order. Rotation
itself is the operator's browser action; Claude only runs the read-only fingerprint verification on request.
