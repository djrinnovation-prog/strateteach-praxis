# Operator checklist — rotate webhook token for bot `2dcaddba-b62d-47e1-87a7-7f7b759f38d2`

> **Operator fallback only — NOT the normal user flow.** The normal path is the in-product TradingView connection UI
> (see `production-ui3-tradingview-connection-flow.md`, slice UI-3). Use this terminal procedure ONLY as an operator
> fallback when that UI is unavailable AND Oren has explicitly approved it.

Testnet bot. Operator-run only (needs your JWT + optional second factor). **The token is generated locally, saved to your
secret store, and used in requests via shell vars — it is never echoed to the screen and never sent to chat.**
Requires: `curl`, `jq`, `openssl`, `pbcopy` (macOS). Endpoint gated by `verify_jwt=true` + `profiles.is_operator`.

```bash
# ── Prereqs (hidden entry; nothing printed) ─────────────────────────────────
BOT=2dcaddba-b62d-47e1-87a7-7f7b759f38d2
URL=https://eraxuxidsiolyvfefcez.supabase.co/functions/v1/admin-rotate-webhook-token
read -rs OP_JWT;       printf '\n'   # paste operator JWT (access_token from your logged-in operator session)
read -rs ADMIN_SECRET; printf '\n'   # paste ADMIN_ROTATE_SECRET, or just press Enter if the function has none set

# ── helper: POST a JSON body; token stays out of argv (stdin) + auth in a 0600 temp config ──
post() {  # $1 = JSON body string; prints only the HTTP response
  local cfg; cfg=$(mktemp); chmod 600 "$cfg"
  { printf 'url = "%s"\n' "$URL"
    printf 'header = "Authorization: Bearer %s"\n' "$OP_JWT"
    [ -n "$ADMIN_SECRET" ] && printf 'header = "x-admin-rotate-secret: %s"\n' "$ADMIN_SECRET"
    printf 'header = "content-type: application/json"\nrequest = "POST"\n'; } > "$cfg"   # printf is a builtin → not in ps
  printf '%s' "$1" | curl -sS --config "$cfg" --data @- ; local rc=$?
  rm -f "$cfg"; return $rc
}

# ── 1. Generate the new token INTO A VAR (never printed) ────────────────────
NEW_TOKEN=$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=' | cut -c1-48)   # URL-safe, ≥32 (TOKEN_RE)

# ── 2. Save it to your secret store WITHOUT showing it (WHERE YOU "PASTE" IT) ─
printf '%s' "$NEW_TOKEN" | pbcopy    # → paste into 1Password / Doppler as e.g. webhook_token_2dcaddba…
                                     # (clipboard only; DO NOT paste it into chat or echo it)

# ── 3. dry_run (validates; NO DB write) ─────────────────────────────────────
BODY=$(BOT="$BOT" NEW_TOKEN="$NEW_TOKEN" jq -nc '{bot_id:env.BOT, mode:"dry_run", token:env.NEW_TOKEN}')
DRY=$(post "$BODY")
printf '%s' "$DRY" | jq '{ok, error, old_fp, new_fp, updated_rows}'   # fingerprints only — no full hash, no token
OLD_HASH=$(printf '%s' "$DRY" | jq -r '.old_hash')   # captured to a var SILENTLY (never printed)
NEW_FP=$(printf '%s'   "$DRY" | jq -r '.new_fp')
# expect: { "ok": true, "updated_rows": 0, ... }

# ── 4. commit (only AFTER step 2 saved the token) ───────────────────────────
DN=webhook_token_$BOT
BODY=$(BOT="$BOT" NEW_TOKEN="$NEW_TOKEN" EOH="$OLD_HASH" FP="$NEW_FP" DN="$DN" jq -nc \
  '{bot_id:env.BOT, mode:"commit", token:env.NEW_TOKEN, expected_old_hash:env.EOH,
    dry_run_fingerprint:env.FP, doppler_updated_confirmed:true, doppler_secret_name:env.DN}')
post "$BODY" | jq '{ok, error, bot_id, old_fp, new_fp, updated_rows}'
# expect: { "ok": true, "updated_rows": 1, ... }

# ── 5. cleanup (clear token/JWT from shell + clipboard) ─────────────────────
unset NEW_TOKEN OP_JWT ADMIN_SECRET BODY DRY OLD_HASH NEW_FP; printf '' | pbcopy
```

## Expected responses
- **dry_run** `200`: `{ ok:true, mode:"dry_run", updated_rows:0, old_fp, new_fp, shape_ok:true }` (also returns full `old_hash`/`new_hash` — kept in vars, not printed).
- **commit** `200`: `{ ok:true, mode:"commit", updated_rows:1, old_fp, new_fp }`.
- **Failures:** `401` bad JWT · `403` not operator / bad `x-admin-rotate-secret` · `400` invalid token/mode or `missing_doppler_attestation`/`invalid_expected_old_hash` · `409` `dry_run_fingerprint_mismatch` → re-run dry_run with the **same** token · `500` `rotation_committed_audit_failed` (committed but audit failed → manual reconcile) · `503` config/pepper. If **commit `updated_rows:0`** → the hash changed under you (CAS miss); re-run dry_run.

## Run the fixture after rotation (Action E validation)
```bash
SIG="4C|60|$(date +%s)|buy"            # a FRESH signal_id (unique per fire)
scripts/wb6-e1-fire.sh "$SIG"          # at the hidden "Webhook token" prompt, paste the NEW token from your store
# expect: response body + 'HTTP 200'.  (worker is disarmed → the signal enqueues but nothing trades)
echo "fired signal_id: $SIG"           # this line prints only the signal_id, never the token
```

## What I (Claude) will do after you fire — read-only, on your go
```sql
select status, requeue_attempts, next_retry_at
from webhook_logs
where bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' and signal_id='<the SIG you fired>';
```
I report **`status` only** (expect **`queued`**) — no token, no hash. That confirms the 4C webhook's `accepted → queued` transition.

## Notes
- The token is **yours** end-to-end: generated locally, saved to your store, entered at hidden prompts. I never see, request, or print it.
- `admin-rotate-webhook-token` stores only the **hash**; it never returns the plaintext token.
- WB6 caveat: `wb6-e1-fire.sh` puts the token in the request URL (argv) — a **testnet-only** transport exception; do not reuse this transport for production.
- Testnet only; no mainnet; no real funds.
