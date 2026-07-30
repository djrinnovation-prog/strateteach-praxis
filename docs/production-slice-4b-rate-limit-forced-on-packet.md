# Slice 4B — Force webhook rate limiting ON in production (IMPLEMENTATION PACKET)

> **DOC / PLANNING — NO CODE yet.** No DB mutation · no deploy · no Railway/Doppler · no secrets · no mainnet / no real
> funds. **Real funds remain NO-GO.** Uncommitted draft for Codex review. Closes hard-blocker **B3** from the 4/5 packets:
> production must not be able to silently disable webhook rate limiting. Grounded in the actual code (read-only, 2026-07-12).
>
> **Progress: 1/5 complete · Current: 2/5 — Static egress / IP allowlist (A1) · Remaining: 4/5.** 4B is an A1-INDEPENDENT
> live-tier hardening slice — buildable + LOCAL-testable now; **zero testnet behavior change** (see §3); linked deploy
> separately gated.
>
> **Rev 2 (2026-07-12): Codex CHANGES applied.** Added the **tier source-of-truth mapping + split-brain caveat** (§2a) —
> the webhook's `tier` derives from `PRAXIS_IS_PRODUCTION` (`rate-limit.ts:29`), the same var name the worker uses but read
> from a *different deployment surface*; added the **cutover consistency requirement + cross-check**; added the
> tier/source **test expectations** (§5) and a **stop condition** requiring the mapping be unambiguous before implementing
> 4B (§9).

## 1. Current rate-limit behavior (CONFIRMED from code)
- **[FACT] `rateConfig`** (`supabase/functions/_shared/rate-limit.ts:19-32`): **`enabled = getEnv("WEBHOOK_RATE_LIMIT_ENABLED")
  === "true"`** — the flag is **OFF unless explicitly `"true"`**. `tier = getEnv("PRAXIS_IS_PRODUCTION")==="true" ? "live"
  : "testnet"`. Limits default 60 (IP/min) / 20 (bot/min) via `num()` (L27-28). `failOverride` from `WEBHOOK_RATE_FAILMODE`.
- **[FACT] The gates run ONLY when enabled:** `shouldRunIpGate(cfg) = cfg.enabled` (L59-61); `shouldRunBotGate(cfg,authed)
  = cfg.enabled && authed` (L64-66). The webhook wires them: `rateConfig(k=>Deno.env.get(k))` (`webhook/index.ts:126`),
  `if (shouldRunIpGate(rateCfg))` (L135), `if (shouldRunBotGate(rateCfg, authed))` (L178).
- **[FACT] `failMode` is tier-aware but only on a STORE ERROR, and only WHEN enabled:** `failMode(tier,override)` (L52-56)
  = `live ⇒ "closed"` (override cannot force open in live), `testnet ⇒ override ?? "open"`. `enforceRateLimit` (L88-114)
  consults `failMode` **only inside the enabled gate**, on a `bump()` failure.
- **[FACT] THE GAP (B3):** if `WEBHOOK_RATE_LIMIT_ENABLED` is absent/`false`, **`enabled=false` ⇒ neither gate runs ⇒ NO
  rate limiting at all — even in production (`tier="live"`).** `failMode`'s live-fails-closed only helps when the gate is
  already running. So a **missing/false flag silently disables protection in production.**

## 2. Exact production fail-closed rule
- **[PROPOSAL] In the `live` tier, `enabled` is FORCED true** — the flag can **enable** rate limiting but can **never
  disable** it in production. Exact rule: **`enabled = (WEBHOOK_RATE_LIMIT_ENABLED === "true") OR (tier === "live")`.**
  With this, production **always** rate-limits (IP gate always; bot gate when authed), using env limits or the safe
  defaults (60/20), and on a store error live **already** fails closed (`failMode` unchanged).
- **[DECISION] Force-ON vs reject-all — recommend FORCE-ON.** The rule says "fail closed **or** force ON." **Force-ON is
  recommended** over "reject every request when unconfigured": force-ON delivers protection **without breaking legitimate
  traffic** on a config slip, whereas reject-all would DoS the live webhook. (Live already fails closed on a *store* error
  via `failMode`; force-ON closes the *missing-flag* hole. Together: production is never unprotected and never fails open.)
- **Net production guarantee:** missing/false `WEBHOOK_RATE_LIMIT_ENABLED` in production → **still rate-limited** (not
  disabled); a store error in production → **fail closed** (reject, uniform 200, no enqueue). Neither can silently
  disable protection.

## 2a. Tier source-of-truth mapping (+ split-brain caveat) [CHANGE 1]
**Where the mapping is defined [FACT]:** the webhook's `tier` is derived **solely** from `PRAXIS_IS_PRODUCTION`:
`rate-limit.ts:29` — `tier = getEnv("PRAXIS_IS_PRODUCTION") === "true" ? "live" : "testnet"` (read via
`Deno.env.get` in `webhook/index.ts:126`). **This is the SAME variable NAME the worker uses** to decide production:
`worker/src/index.ts` `validateEnv` requires `PRAXIS_IS_PRODUCTION` (exit1 if missing) and `isProduction =
process.env.PRAXIS_IS_PRODUCTION === "true"`. So both the webhook and the worker map "live/production" from
`PRAXIS_IS_PRODUCTION === "true"` — **one variable name, one rule.**

**[CAVEAT — the split-brain risk to close] They read that variable from DIFFERENT deployment surfaces:** the webhook is a
**Supabase Edge function** (reads its own Edge secrets) while the worker is a **Railway Node service** (reads Railway
env). Same name ≠ guaranteed same value: if the Edge webhook's `PRAXIS_IS_PRODUCTION` is `false` while the worker is live,
the webhook would think `tier="testnet"` → **force-ON would NOT fire → rate limiting off while the system is live.** 4B's
guarantee is therefore **conditional on the webhook's `PRAXIS_IS_PRODUCTION` correctly reflecting the live state.**

**[PROPOSAL] Consistency requirement (part of the live-tier cutover, 4/5):**
- The live-tier flip must set `PRAXIS_IS_PRODUCTION=true` on **BOTH** the Edge webhook **and** the worker.
- The **production-readiness read-only preflight** (4/5 §1d(ii)) must **cross-check** the two agree — e.g. the DB
  `worker_status.is_production === true` (the worker's observed value, already written to the DB) **AND** a webhook probe/
  audit confirms the webhook tier is `live`. If they disagree → STOP (do not go live).
- **[ALTERNATIVE for Codex]** make the webhook's tier a **single source of truth** by deriving it from
  `worker_status.is_production` (a DB read) instead of its own env — removes the split-brain but adds a per-request DB read
  (latency + dependency). **Recommend the env mapping + cutover cross-check** (no per-request cost); note the alternative.

## 3. Config allowed — testnet vs production
| Knob | Testnet (`PRAXIS_IS_PRODUCTION≠true`) | Production (`live`) |
|---|---|---|
| `WEBHOOK_RATE_LIMIT_ENABLED` | respected — **default OFF** (opt-in); `"true"` turns it on | **ignored for DISABLING** — rate limiting is always ON (flag `"true"` is redundant; absent/false cannot disable) |
| `WEBHOOK_RATE_IP_PER_MIN` / `_BOT_PER_MIN` | env or defaults 60 / 20 | env or defaults 60 / 20 (same) |
| `WEBHOOK_RATE_FAILMODE` (override) | may tighten testnet to `closed` | **cannot force open** (live ⇒ closed, unchanged — L54) |
- **[FACT] ZERO testnet behavior change:** on testnet, `tier="testnet"` so `enabled` still equals the flag (default OFF) —
  the force-ON branch only fires when `tier="live"`. Since the platform is testnet today (`PRAXIS_IS_PRODUCTION=false`
  everywhere), **deploying 4B now changes nothing on testnet**; it only activates when the tier flips to live (the 4/5
  live-tier step). This makes 4B safe to build + deploy ahead of A1.

## 4. Implementation files
- **`supabase/functions/_shared/rate-limit.ts`** — the ONLY logic change: in `rateConfig`, compute `tier` first, then
  `enabled = flag || tier === "live"`. (Single line; `shouldRunIpGate`/`shouldRunBotGate`/`enforceRateLimit`/`failMode`
  unchanged — they already consult `cfg.enabled` + `failMode`.)
- **`supabase/functions/_shared/rate-limit.test.ts`** — add the tests in §5.
- **No change to `webhook/index.ts`** (it already reads `rateConfig` + the gate helpers). No DB/migration change.

## 5. Tests required (Deno, `_shared/rate-limit.test.ts`)
### Tier / source-of-truth mapping [CHANGE 2]
- **Tier derives from `PRAXIS_IS_PRODUCTION`** — `getEnv("PRAXIS_IS_PRODUCTION")="true"` → `tier="live"`; anything else
  (absent / `"false"` / `"TRUE"` / `"1"`) → `tier="testnet"` (only exact `"true"` = live — same rule as the worker).
- **production/live tier FORCES rate limit ON** — `PRAXIS_IS_PRODUCTION="true"` → `enabled=true` regardless of the flag.
- **testnet tier keeps existing behavior** — non-production → `enabled` equals the flag (default OFF).
- **missing/false `WEBHOOK_RATE_LIMIT_ENABLED` CANNOT disable live tier** — `PRAXIS_IS_PRODUCTION="true"` + flag
  absent → `enabled=true`; + flag `="false"` → `enabled=true`.
### Existing behavior (regressions)
- **`rateConfig`: production forces ON** — as above (`tier="live"`, `enabled=true`).
- **`rateConfig`: testnet respects the flag** — non-production + flag absent → `enabled=false`; + flag `="true"` →
  `enabled=true`. **(No testnet behavior change.)**
- **Gates run in live even with flag off** — `shouldRunIpGate(cfgLiveNoFlag)=true`, `shouldRunBotGate(cfgLiveNoFlag,
  true)=true`.
- **`failMode` unchanged** — `failMode("live", "open")==="closed"` (override can't force open); `failMode("testnet",
  "closed")==="closed"`; `failMode("testnet", null)==="open"`.
- **enforceRateLimit fail-closed in live on store error** (regression) — a throwing `bump` at `tier="live"` → `"reject"`
  + `webhook_rate_limit_failclosed` audit (already covered — keep green).
- **Limits still default** — `ipPerMin=60`, `botPerMin=20` when unset (regression).

## 6. LOCAL validation plan
- **`deno test supabase/functions/_shared/rate-limit.test.ts`** (+ webhook-hash + any webhook unit tests) → all PASS.
- Confirm **no other suite regresses** (the change is additive; `enabled` only widens in live).
- **No linked apply, no deploy, no Edge deploy** in this step — LOCAL Deno tests only. Record pass/fail evidence.

## 7. Linked deploy plan (GATED, separate — operator-run)
- **Edge deploy:** `supabase functions deploy webhook` (operator) — deploys the updated `_shared/rate-limit.ts` (bundled
  into the webhook function). **Gated; not part of authoring/LOCAL.**
- **Safe to deploy on testnet now:** because the force-ON branch is `tier==="live"`-only and the platform is
  `PRAXIS_IS_PRODUCTION=false`, the deployed behavior on testnet is **identical** (flag-respecting). The force-ON only
  takes effect if/when the tier flips to live.
- **Post-deploy read-back (read-only):** confirm the webhook still returns 200/dedup normally on testnet; optionally, in a
  staging live-tier config, confirm rate limiting is active with the flag unset. **No secrets, no mainnet.**
- **[NOTE] No Railway/Doppler value change is required by 4B** — it removes the *dependence* on the flag in production
  rather than adding config. (Production may still set the flag/limits, but can no longer disable protection by omission.)

## 8. Rollback
- **Revert the one-line `rate-limit.ts` change** (back to `enabled = flag === "true"`) + `supabase functions deploy
  webhook` to redeploy the prior behavior. Reversible; no data change, no migration. (Testnet is unaffected either way.)

## 9. Stop conditions (hard)
- **[CHANGE 3] If the tier / source-of-truth mapping is AMBIGUOUS, do NOT implement 4B until it is clarified.** 4B's
  force-ON is only correct if the webhook's `tier="live"` reliably tracks the system's live state (§2a). Before
  implementing, confirm: (a) the webhook tier derives from `PRAXIS_IS_PRODUCTION` (documented, `rate-limit.ts:29`); (b)
  the live-tier cutover sets `PRAXIS_IS_PRODUCTION=true` on BOTH the Edge webhook and the worker; (c) a preflight
  cross-checks they agree (`worker_status.is_production` + webhook probe). If any is undecided → STOP.
- **Do NOT choose reject-all** (rejecting every request when unconfigured in production) — force-ON is the chosen rule
  (availability + protection). If Codex prefers reject-all, that is a separate explicit decision.
- **Must NOT alter testnet behavior** — if any test shows testnet `enabled` changing, STOP (the force-ON must be
  `tier="live"`-gated only).
- **Must NOT weaken `failMode`** — live must still fail closed on store errors.
- **No deploy without LOCAL tests green** · **no secrets** · **no DB mutation** · **no mainnet.** Real funds NO-GO.

---
**Net:** a one-line, tier-gated change to `rateConfig` so **production rate limiting cannot be silently disabled** by a
missing/false flag (`enabled = flag || tier==='live'`), plus Deno tests + a gated Edge redeploy. **Force-ON** (not
reject-all) preserves availability while guaranteeing protection; **zero testnet behavior change**; `failMode`'s
live-fails-closed-on-store-error is preserved. **Planning only — no code yet, no deploy, no secrets, no mainnet.**

**Progress: 1/5 complete · Current: 2/5 — Static egress / IP allowlist (A1) · Remaining: 4/5.**
