#!/usr/bin/env bash
#
# wb6-e1-fire.sh — WB6 E1 single-fire (Binance Testnet webhook).
# Fires EXACTLY ONE webhook. No retries. Never echoes the token or the full URL.
#
# Usage:
#   scripts/wb6-e1-fire.sh ['signal_id']
#     - signal_id defaults to 'WB6E1|60|1750000000|buy'
#     - QUOTE it (contains '|'):   scripts/wb6-e1-fire.sh 'WB6E1|60|1750000001|buy'
#     - Use a FRESH signal_id per fire. Repeats are server-deduped
#       (UNIQUE(bot_id, signal_id)) -> no double trade, but no new trade either.
#
# ⚠️  WB6 TESTNET-ONLY SCRIPT
#     L-17 (audit v3) hardening: the token-bearing URL is now delivered to curl via `--config -`
#     on STDIN, so the token no longer appears in argv / `ps`. Live identifiers (project ref, bot
#     UUID) are no longer committed — supply them via WB6_PROJECT_REF / WB6_BOT_ID env vars.
#     BEFORE PRODUCTION (required): this token was E1-confirmed leaked to Supabase platform logs —
#     ROTATE it before any mainnet use. This helper stays testnet-only.
#
# Security (this script):
#   - Token read from a hidden prompt (read -rs) -> never in shell history.
#   - Minimal hygiene ONLY: reject empty / control+whitespace / surrounding double-quotes.
#     NO path-character whitelist: the token's encoding is not proven by the repo, and it
#     is empirically proven to traverse the URL-path transport by WB5.
#   - Prompts -> stderr; stdout carries ONLY the response body + 'HTTP <code>'.
#   - curl stderr is redacted in-memory if it ever contains the token or URL.
#
# Safety: testnet enforcement is server-side (PRAXIS_IS_PRODUCTION!='true' -> sandbox).
#         This script cannot select an environment; it only delivers a signal.
#
set -euo pipefail

# L-17 / H-6 (audit v3): live identifiers are NO LONGER committed here — supply them via env so the repo
# does not carry the project ref + a real bot UUID. Both are REQUIRED (no defaults).
#   export WB6_PROJECT_REF=<project-ref>
#   export WB6_BOT_ID=<bot-uuid>
readonly PROJECT_REF="${WB6_PROJECT_REF:?set WB6_PROJECT_REF (not committed — see L-17/H-6)}"
readonly BOT_ID="${WB6_BOT_ID:?set WB6_BOT_ID (not committed — see L-17/H-6)}"
readonly SIGNAL_ID="${1:-WB6E1|60|1750000000|buy}"

printf 'Webhook token (hidden, not echoed): ' >&2
# IFS= so read does NOT strip leading/trailing whitespace -> the token is taken verbatim
# (never trimmed/modified); any surrounding whitespace is then REJECTED below, not removed.
IFS= read -rs WB6_TOKEN
printf '\n' >&2

# --- Minimal token hygiene: reject paste artifacts only; NO charset assumptions ---
[ -n "${WB6_TOKEN:-}" ] || { printf 'ERROR: empty token; aborting.\n' >&2; exit 2; }
# Surrounding double-quotes from paste -> friendlier message (token not shown).
case "$WB6_TOKEN" in
  \"*|*\")
    printf 'ERROR: the token looks wrapped in double-quotes; paste it WITHOUT surrounding quotes.\n' >&2
    exit 2 ;;
esac
# Reject any whitespace or C0 control char (CR/LF/TAB/space/etc.) — paste/storage
# artifacts that would corrupt the request. No character whitelist beyond this.
if [[ "$WB6_TOKEN" =~ [[:cntrl:][:space:]] ]]; then
  printf 'ERROR: the token contains whitespace or control characters; aborting (token not shown).\n' >&2
  exit 2
fi

# URL built in-memory; never printed.
printf -v WB6_URL '%s/functions/v1/webhook/%s/%s' \
  "https://${PROJECT_REF}.supabase.co" "$BOT_ID" "$WB6_TOKEN"

# Non-network self-test hook: stop before the request (used by fake-token tests).
if [ "${WB6_PREFLIGHT_ONLY:-0}" = "1" ]; then
  printf 'PREFLIGHT_OK\n' >&2
  exit 0
fi

readonly PAYLOAD="$(printf \
  '{"signal_id":"%s","action":"buy","fire_time":"1750000000","close":"68000","volume":"1.0"}' \
  "$SIGNAL_ID")"

# Single POST. L-17 (audit v3): the token-bearing URL is delivered to curl via `--config -` on STDIN,
# NOT as a command-line argument — so the token never appears in argv / `ps` (the old transport did).
# --globoff disables [] {} range parsing; --fail-with-body makes HTTP >= 400 exit nonzero while still
# printing the body (curl >= 7.76); -m 20 is a hard timeout; no --retry -> exactly one request; -w
# appends 'HTTP <code>'. The URL is fed as a curl config line: `url = "<...>"`.
ERRF="$(mktemp)"
cleanup() { rm -f "$ERRF"; unset WB6_TOKEN WB6_URL; }
trap cleanup EXIT

BODY="$(curl --globoff --fail-with-body -sS -m 20 \
  -X POST \
  -H 'content-type: application/json' \
  --data "$PAYLOAD" \
  -w '\nHTTP %{http_code}\n' \
  --config - <<CURLCFG 2>"$ERRF")" && CURL_EXIT=0 || CURL_EXIT=$?
url = "$WB6_URL"
CURLCFG

# curl stderr, redacted IN-MEMORY if it ever echoed the token or URL (bash 'case' is
# in-process -> no external command, no argv exposure of the secret).
ERR="$(cat "$ERRF")"
case "$ERR" in
  *"$WB6_TOKEN"*) ERR='[redacted: curl message contained the token]' ;;
  *"$WB6_URL"*)   ERR='[redacted: curl message contained the URL]'   ;;
esac

printf '%s\n' "$BODY"                       # response body + 'HTTP <code>'
printf 'CURL_EXIT=%s\n' "$CURL_EXIT" >&2
if [ "$CURL_EXIT" -ne 0 ]; then
  [ -n "$ERR" ] && printf 'CURL_ERROR: %s\n' "$ERR" >&2
  case "$CURL_EXIT" in
    6)  printf 'HINT: DNS resolution failed (host unresolved).\n'   >&2 ;;
    7)  printf 'HINT: connection refused / host unreachable.\n'     >&2 ;;
    28) printf 'HINT: timed out (>20s).\n'                          >&2 ;;
    35) printf 'HINT: TLS handshake failure.\n'                     >&2 ;;
    3)  printf 'HINT: malformed URL.\n'                             >&2 ;;
    *)  printf 'HINT: check the curl exit-code reference.\n'        >&2 ;;
  esac
fi
exit "$CURL_EXIT"
