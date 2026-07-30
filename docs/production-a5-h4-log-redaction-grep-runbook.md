# A5 H4 — Log-Redaction Live Grep (webhook Edge + Railway worker)

> **RUN — H4 = PARTIAL (2026-07-08).** _updated by Codex at Oren request._ Webhook side COMPLETE; worker side PARTIAL
> (armed-window logs not exportable). See "Run — results" at the end. No endpoint fire · no deploy · no DB mutation ·
> no flag change · no mainnet/real funds by producing this doc.
> **H4 static audit already PASS**; this is the **live** verification that runtime logs carry no secrets.
> Operator exports logs + runs greps; **Claude never sees raw logs or secret values.**

## What H4 proves
The deployed **webhook** Edge function and the **Railway worker** must **never** emit secrets to logs — specifically:
**webhook tokens**, the **`WEBHOOK_SECRET_PEPPER`**, stored **`v1:<hex>` hashes**, the **full webhook URL** (which
contains the token path segment), `ADMIN_ROTATE_SECRET`, and (worker) **exchange API key/secret** or any **decrypted
credential**. The code is written to redact these (webhook header comment: "never log the token, the full URL, the
pepper, or the stored hash"); H4 confirms it at runtime.

## 1. Time window (recommendation)
Cover the **full recent test period: 2026-07-05 00:00 UTC → now** (≈ 3–4 days). This captures every webhook fire that
could have leaked a secret: H5 N1–N4 negatives, the A10 drill (K1–K4), H6 positive, all three rotation **old-token-fails**
fires, and the A5-1 rate-limit smoke — plus the worker's H6 fill + A10 consumption. A shorter window risks missing a fire.
*(If the log backend caps retention/volume, export at minimum the windows of the known fires above.)*

## 2. Export steps (operator; Claude does not see raw logs)
**A. Supabase Edge — `webhook` logs**
- Dashboard → your project → **Edge Functions** → **`webhook`** → **Logs** (or **Logs → Edge Functions** in the Logs
  Explorer). Set the time range to §1. *(There is no `supabase functions logs` CLI subcommand in the installed version —
  use the dashboard.)*
- **Export/download** the log lines to a local file, e.g. `~/praxis-logs/webhook-edge.log` (Logs Explorer supports
  download; or copy the rendered lines). Keep it **local**, delete after (§7).

**B. Railway — worker logs**
- Railway dashboard → project → **`praxis-worker`** service → **Deployments** (the relevant deployment(s) for the window)
  → **Logs / View Logs** → set/scroll the time range → **download** (Railway offers log download) to
  `~/praxis-logs/worker.log`. If the window spans multiple deployments, export each.

## 3. Grep checklist (operator runs locally; expect **0 hits** on every secret pattern)
> Save both files under `~/praxis-logs/`. Run these; **every secret-pattern grep must return nothing (0 hits).**

**Sanity check first — confirm the export actually captured the fires (expect >0):**
```bash
grep -cE 'invalid_secret|webhook_reject|webhook_rate_limited|bot_not_active' ~/praxis-logs/webhook-edge.log   # >0 expected
grep -cE 'worker_running|trade_executed|order_blocked|worker_queue_disabled' ~/praxis-logs/worker.log         # >0 expected
```
*(If these are 0, the window/export is wrong — fix before trusting the secret greps.)*

**Webhook Edge — secret patterns (each must be 0 hits):**
```bash
# 1. full webhook URL WITH a token path segment (bot_id/<token>)
grep -nE '/webhook/[0-9a-fA-F-]{36}/[A-Za-z0-9_-]{12,}' ~/praxis-logs/webhook-edge.log
# 2. any stored v1:<hex> hash (fragment or full)
grep -nE 'v1:[0-9a-f]{16,}' ~/praxis-logs/webhook-edge.log
# 3. secret-ish JSON field carrying a value
grep -niE '"(token|secret|pepper|webhook_secret_hash|authorization|x-admin-rotate-secret)"[[:space:]]*:[[:space:]]*"[^"]{8,}"' ~/praxis-logs/webhook-edge.log
# 4. secret env NAMES appearing with a value
grep -nE '(WEBHOOK_SECRET_PEPPER|ADMIN_ROTATE_SECRET)[[:space:]]*[:=]' ~/praxis-logs/webhook-edge.log
# 5. bearer tokens (webhook is verify_jwt=false, so none expected)
grep -niE 'Bearer [A-Za-z0-9._-]{20,}' ~/praxis-logs/webhook-edge.log
```

**Railway worker — secret patterns (each must be 0 hits):**
```bash
# 1. exchange key/secret JSON fields carrying a value
grep -niE '"(apiKey|api_secret|apisecret|secret|secretKey|password)"[[:space:]]*:[[:space:]]*"[^"]{8,}"' ~/praxis-logs/worker.log
# 2. Binance key env NAMES with a value
grep -nE 'BINANCE_[A-Z_]*(KEY|SECRET)[[:space:]]*[:=][[:space:]]*\S{12,}' ~/praxis-logs/worker.log
# 3. stored hash / pepper (worker should never carry these)
grep -nE 'v1:[0-9a-f]{16,}|WEBHOOK_SECRET_PEPPER' ~/praxis-logs/worker.log
# 4. decrypt / vault markers — INSPECT hits: the event name is OK, an accompanying secret VALUE is a FAIL
grep -niE 'decrypt|get_decrypted_secret|vault_secret|credential' ~/praxis-logs/worker.log
```
- Grep #4 (worker) is an **inspection** grep, not a 0-hit grep: the worker legitimately logs *event names* like
  `get_decrypted_secret` / `vault_secret_id` **without** the value. **Read each hit** and confirm no decrypted key/secret
  value is present. A hit that shows only ids/names/counts = OK; a hit showing an actual key/secret = **FAIL**.

**Optional (strongest, operator discretion — handles a secret):** grep the logs for the **literal** current token/pepper
values from your store to prove they're absent. This puts a secret in the shell for the grep — run it in a way that
doesn't persist (read into a var, `grep -F -- "$V"`, then `unset V`), and never paste the value anywhere:
```bash
read -r V; grep -Fc -- "$V" ~/praxis-logs/webhook-edge.log ~/praxis-logs/worker.log; unset V   # expect 0
```

## 4. Expected result
- **Sanity greps:** > 0 (the fires are present ⇒ the window is right).
- **Every secret-pattern grep (webhook 1–5, worker 1–3):** **0 hits.**
- **Worker inspection grep (#4):** hits allowed, but **each shows only non-secret event fields** (no key/secret value).

## 5. What counts as FAILURE
- **Any hit** on a webhook secret pattern (1–5) or worker secret pattern (1–3).
- A worker `decrypt/vault/credential` line that contains an **actual** decrypted key/secret value.
- The optional literal-value grep returning **> 0**.
- A leak ⇒ **H4 FAIL** ⇒ file the exact redacted sample (§6), fix the offending log statement (code slice, Codex-gated),
  redeploy, re-export, re-grep. **Do not** mark H4 complete with any confirmed leak.

## 6. Documenting redacted samples
- For any hit, record: the **file**, **line number**, the **matched pattern id** (e.g. "webhook #2"), and a **redacted**
  copy of the line with the secret replaced by `<REDACTED>` (never the real value). Keep byte-length only if useful.
- For a clean run, record the **grep command + `0`** for each pattern (a screenshot or copied counts is enough) — no raw
  log content needed. Claude only receives the **counts / pass-fail**, never raw logs or secrets.

## 7. Cleanup
```bash
rm -f ~/praxis-logs/webhook-edge.log ~/praxis-logs/worker.log   # remove local log exports after grepping
```

## 8. Marking H4
- **H4 = COMPLETE** iff: both sources exported for the §1 window, **sanity greps > 0**, **all secret-pattern greps = 0**,
  worker inspection hits confirmed value-free, and the clean-run counts are recorded.
- **H4 = PARTIAL** if: only one source was exported, the window is incomplete, or a grep couldn't be run — document
  exactly what remains (e.g. "worker logs pending export").
- **H4 = FAIL** if any confirmed secret in logs — remediate (§5) and re-run; H4 stays open until re-verified clean.

## Scope / GO-NO-GO
- **Planning/instructions only** — nothing fired/deployed/mutated here. The export + grep are operator-run.
- On a clean run, **A5 H4 = COMPLETE** ⇒ combined with H1 (deployed+enabled), H5 (N1–N5), H6 (RUN+PASS), and the three
  token rotations, **A5 is effectively closed for testnet** (the per-bot valid-token live exercise stays optional/gated).
- **Real funds = NO-GO** regardless (A11/A1/A4/A8/A2 + live-tier fail-closed proof).

---

## Run — results (H4 = PARTIAL · 2026-07-08)
_updated by Codex at Oren request._ Operator exported logs + ran greps; reported counts/pass-fail only (Claude/Codex
never saw raw logs or secrets).

**Webhook Edge — COMPLETE ✅**
- Sanity `webhook fires = 11` (> 0 — H5/A10/H6/rotation/rate-limit fires captured).
- All 5 secret patterns = **0** (url+token, `v1:` hash, secret JSON field, pepper/admin-secret env names, Bearer).

**Railway worker — PARTIAL ⚠️**
- Exported worker log is **clean for secret patterns** (w1 key/secret = 0, w2 BINANCE env = 0, w3 `v1:`/pepper = 0,
  w4 decrypt/vault/credential = 0 / value-free).
- **BUT insufficient coverage:** the **armed-worker execution window is NOT in the export** — coverage grep
  (`trade_executed|trade_pending|order_blocked`) = **0**; sanity = 1 (a lone latest-deploy event). The credential-decrypt
  path (H6 fill 2026-07-07 · A10 drill 2026-07-06) was **not** grepped. Railway retention aged those deployment logs out;
  they are not currently exportable.

**Documented outcome (per operator):**
- **Worker live-log grep = unavailable / incomplete** for the armed window (Railway retention).
- **H4 static audit = clean** (prior PASS — code never logs token/pepper/hash/URL/decrypted-credential).
- **Exported worker log = clean for secret patterns, but insufficient coverage** (no armed-execution events).
- **H4 = PARTIAL** (webhook COMPLETE; worker PARTIAL). **A5 is NOT fully COMPLETE** — H4 worker-side open.

**To close worker H4 later (no action now):** grep the worker logs of the **next armed-worker run** (e.g. a future
H6-style fill or the first order after arming) within retention — confirm `coverage ≥ 1` + w1–w3 = 0 + w4 value-free.
Then mark **H4 COMPLETE** and **A5 COMPLETE (testnet)**.

> **⏱ CLOSE-OUT TRIGGER (binding, per operator 2026-07-08).** Do **not** keep chasing aged-out Railway logs — the H6/A10
> armed-window worker logs are gone and won't return. Instead, **the next armed-worker run** (next H6-style fill, or the
> first order after any future ARM) **must**, as a mandatory step of that run: export the worker logs **within Railway
> retention** (same day) and run the H4 worker greps §3 — pass = `coverage ≥ 1` **and** all secret greps = 0 (w4
> value-free). Only that closes worker H4 ⇒ H4 COMPLETE ⇒ A5 COMPLETE (testnet). Attach this step to whatever armed
> run comes next; do not schedule a separate ARM just for H4.
