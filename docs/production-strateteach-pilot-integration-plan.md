# StrateTeach ⇄ Praxis — Pilot Integration Plan (PLAN ONLY)

**No code · no deploy · no DB change · no secrets · no live trading.** This plans a *controlled pilot*
connecting the StrateTeach UI to the Praxis execution backend, on top of the current closeout state
(backend live path `PASS*`, worker cold, no funds moved, one bot on a valid mainnet credential but paused,
TradingView token flow unresolved, self-serve incomplete).

## Binding premise (from `production-strateteach-readiness-questions.md` — do not relitigate here)
- **Praxis owns:** execute · audit · limit · credentials · orders — the only component that touches the
  exchange or moves money.
- **StrateTeach owns:** strategy · backtest · signal ideas · market-data · UI claims (§B S1–S7 **OPEN**).
- **Hard boundary:** StrateTeach never holds exchange keys / `service_role` / Vault secrets / DB-write /
  webhook tokens in browser/client; never decides quantity; never bypasses risk. **Only transport = the
  governed webhook (T13 seam).** Envelope contract (P7): `signal_id` + `action` (+ optional dedup/freshness);
  **no symbol, no quantity, no account, no keys.**
- **Gating decisions BEFORE any connection:** T13 seam in the Decision Log; §B StrateTeach answers; **identity
  bridge** (StrateTeach user ↔ Praxis `auth.uid`); **UI ownership** (embed in the Praxis React app vs. a
  separate StrateTeach app consuming the Praxis backend). These are owner/StrateTeach decisions, not assumed here.

---

## 1. What the user sees in StrateTeach (pilot)
A thin, mostly **read-only** surface — the user monitors; the operator provisions and arms.
- **Auth + consent:** sign in; explicit risk disclosure / disclaimers (StrateTeach-owned, §B S6) before anything live.
- **Strategy pick:** choose a StrateTeach strategy to run (concept + backtest provenance are StrateTeach's, §B).
- **"Connect trading" (pilot = request, not self-serve):** a "Request operator setup" action — the user does
  **not** enter API keys in the pilot; the operator provisions them.
- **My-bot dashboard (read-only, no secrets):** status (Pending setup / Paused / Active / Live), env badge
  (Testnet / **LIVE real-funds**), the strategy, the operator-set tiny caps, last signal id/time, open
  position (qty + ~$ value), recent trades (side / notional / status / time), simple P&L, and a friendly
  reason if an order was blocked (e.g. "insufficient balance").
- **The one control the user has:** **pause/stop their own bot** (kill switch). No quantity, no key entry, no
  withdrawals, no arming into production.

## 2. What the admin/operator sees (Praxis operator console)
Extends the existing console into a **pilot cockpit** — essentially the monitoring we ran by hand this
session, surfaced as UI:
- **Fleet view:** every pilot bot with user, **credential fingerprint + env** (never the secret), caps,
  status, and lock/kill state.
- **Runtime health:** `worker_status` (`is_production` / `queue_enabled` / `worker_state` / age), pgmq
  `trade_signals` depth, per-bot last trade + last `order.blocked` reason.
- **Operator actions:** provision credential (operator-assisted A4 flow), arm/disarm bot, per-bot lock +
  global kill (`operator_kill_all`), rotate webhook token (G-TVR / admin-rotate), pause queue.
- **Arming guardrail baked in:** show the `worker_status` truth (with age + a "real restart?" indicator) so
  arming/de-arming is verified against the DB, not a UI (per the Doppler↔Railway drift finding).

## 3. Fastest pilot path (operator-assisted Binance provisioning)
Managed-account model — smallest surface, operator does the risky steps:
1. User signs up + consents in StrateTeach.
2. **Operator provisions** the Binance credential (A4 `provision-tiny-live` → Vault via `create_vault_secret`
   → `user_exchange_credentials` `pending_validation` → read-only `validate-credential` → promote `valid`).
   Key = trade-only, withdrawals OFF, IP-allowlisted to the A1 static egress IPs.
3. **Operator creates/configures** the Praxis bot (trading_pair, tiny caps, `sizing=fixed_notional`, SELL off)
   and repoints it to the mainnet credential (or a testnet credential for a dry pilot first).
4. **Resolve the signal seam** (pick one): (a) TradingView alert → Praxis webhook with a **server-side**
   per-bot token (resolve B1), or (b) StrateTeach-server → Praxis webhook with a server-side per-bot token
   (per J2). **No token in any browser.** For the very first pilot, an **operator-triggered** internal signal
   (as validated this session) is the lowest-risk way to prove the wired path per user.
5. **Arm ritual (gated, per micro-order closeout):** set env in **both** Doppler + Railway → redeploy →
   verify `worker_status` armed → arm bot → one controlled signal → monitor → disarm.
6. **Funding:** a real fill needs **13–15 USDT** in the mainnet account per bot (operator/user funds; Praxis
   cannot move funds). Start on **testnet** or **tiny mainnet + operator-monitored**.
7. User sees the read-only dashboard + their own kill switch.

## 4. Later self-serve path (post-pilot)
The Signum-inspired wizard (`BotSetupWizard` + `TradingViewConnect`): user creates a bot → enters **their own**
Binance API key (validated read-only, IP-allowlisted, withdrawals-off enforced) → connects TradingView (token
shown once via G-TVR, hashed at rest) → sets risk **within operator-bounded caps** → activates. All via Praxis
RLS/RPC/Edge; browser never holds `service_role`/Vault/withdrawals. Gated on: a hardened key-entry UX, a gated
credential-creation RPC/Edge, the resolved token flow, and server-enforced risk bounds.

## 5. Reusable existing Praxis UI components (`frontend/src`)
| Component / lib | Reuse for |
|---|---|
| `Login.tsx` | Auth (both operator + user shells) |
| `App.tsx` | Shell — split into operator vs. user (pilot) shells |
| `StatusPanel.tsx` + `lib/status.ts` (`operator_status` RPC) | Operator health/fleet + user bot-status card |
| `GateProgress.tsx` | Operator gate view **and** user "setup progress" |
| `BotSetupWizard.tsx` | Later self-serve wizard (pilot hides key-entry) |
| `TradingViewConnect.tsx` + `lib/tradingview.ts` | TV token connect (flag `VITE_TV_CONNECT_ENABLED`, default OFF) |
| `HarnessPanel.tsx` + `lib/harness.ts` | Operator-only ops harness |
| `lib/actions.ts` (`operator_kill_all`) | Operator kill/lock actions |
| `lib/supabase.ts`, `lib/buildinfo.ts` | Client + build stamp |

**Open UI-ownership fork:** if StrateTeach is the *same* React app rebranded, these are reused directly; if
StrateTeach is a *separate* app, it consumes the same Praxis RPC/Edge surface and only the user-facing cards
are re-implemented. Decide before Slice work.

## 6. Required backend / RPC / Edge gaps
Current surface: Edge = `webhook`, `rotate-bot-webhook-token`, `admin-rotate-webhook-token`; RPCs used by UI =
`operator_status`, `operator_kill_all`, `from('bots')` reads. Gaps:
- **G-A Identity bridge** — map a StrateTeach-authenticated user to a Praxis `auth.uid` for RLS. (decision + impl)
- **G-B User dashboard RPC** — one read-only per-user RPC returning bot status/trades/position/P&L with
  **no secrets** (never `vault_secret_id`/`webhook_secret_hash`). Extend the existing "never select hash" rule.
- **G-C User self-kill RPC** — user pauses **their own** bot (today only operator-scoped kill/lock exists).
- **G-D Gated credential creation** — a server-side create-credential path (Vault `create_vault_secret` exists;
  the `user_exchange_credentials` INSERT-grant gap we hit must be closed) for self-serve; pilot uses the
  operator script.
- **G-E Signal seam / token issuance (T13, B1)** — server-side per-bot token issuance for StrateTeach-direct,
  or resolve TradingView rotation; plus A5 freshness window + rate limits + source validation.
- **G-F Risk-bounds enforcement** — self-serve users may only set caps within operator-defined maxima (server-checked).
- **G-G Read-only operator surfaces** — expose `worker_status`, pgmq depth, `trades`/`trades_dlq`,
  `audit_logs`, `webhook_logs`, `reconciliation_jobs` to the console via safe read RPCs.

## 7. Data / log / audit surfaces to expose
- **User (own bot only, no secrets):** status, env badge, caps, last signal id/time, open position (qty + ~$),
  recent trades, simple P&L, friendly blocked-reason.
- **Operator:** `worker_status` (tier/queue/state/age), pgmq depth, all bots + **cred fingerprints** + env +
  caps + status, `trades` + `trades_dlq`, `audit_logs` (`trade.created`/`order.blocked`/`webhook_token.rotated`/
  kill), `webhook_logs` (dedup / `queue_failed`), `reconciliation_jobs`, per-bot lock/kill.
- **NEVER exposed anywhere:** `api_key`/`secret`, full `vault_secret_id`, `webhook_secret_hash`/plaintext token,
  `service_role`, pepper, `ADMIN_ROTATE_SECRET`. **Fingerprints / placeholders only.**

## 8. Locked / disabled states (pilot defaults)
- Key entry **locked** (operator-provisioned); withdrawals **OFF**; SELL **disabled** (v1); quantity
  **server-computed**; caps **operator-set**; self-activation **gated** until operator promotes the credential
  and arms.
- State machine (user-visible): **Pending operator setup** → **Provisioned/Paused** → **Armed/Active** →
  **Live**. Kill/pause available to the user for their own bot at all times; global kill = operator.
- Badges: **Testnet** vs **LIVE real-funds** (prominent). Feature flags: `VITE_TV_CONNECT_ENABLED` (OFF),
  new `VITE_STRATETEACH_PILOT` (OFF), self-serve-key-entry flag (OFF for pilot).

## 9. Deployment sequence (each: packet → Codex PASS → implement → local validate → gated deploy → verify)
- **Phase 0 — Decisions:** T13 seam (Decision Log), §B StrateTeach answers, identity bridge, UI ownership.
- **Phase 1 — Operator read-only cockpit** (Slice ST-1, §12) — zero mutation, zero secrets.
- **Phase 2 — User read-only dashboard** (per-user, no secrets) behind the pilot flag; identity bridge (G-A/G-B).
- **Phase 3 — User self-kill** (G-C).
- **Phase 4 — Operator-assisted provisioning surfaced** in the console (wraps A4).
- **Phase 5 — Signal seam** (G-E: resolve token flow / server-direct) → **testnet** controlled pilot.
- **Phase 6 — Tiny mainnet funded pilot** (after USDT funding + the gated arm ritual).
- **Phase 7 — Self-serve wizard** (G-D/G-F: key entry + validate + TV connect + risk bounds).
- Mainnet stays locked until the gate ladder (A1/A4/4C/A11 + funding) is green. Real funds NO-GO until then.

## 10. Security boundaries (binding)
- Owner-split + hard boundary as in the premise. Browser (StrateTeach + Praxis user UI) talks **only** to
  Praxis RPC/Edge with RLS + the user's JWT — **never Binance**, no secrets in browser, no withdrawals.
- **Envelope-only** signal contract; server rejects/ignores forbidden fields; SELL fail-closed; all P3 limits apply.
- Webhook token: **server-side only**, per-bot, rotatable, audited, hashed at rest; never in browser (J2).
- Instruction-source: only the user via the UI issues actions; signal payloads are data, enforced server-side.
- Fail-closed everywhere (proven this session). Secrets never printed to logs/UI (fingerprints only).
- Real funds NO-GO until gates; arming/de-arming verified against `worker_status`, never a UI alone.

## 11. Notion / runbook documentation structure
A **StrateTeach⇄Praxis** space:
1. **Decision Log** — T13 seam, identity bridge, UI ownership, env source-of-truth (task #6).
2. **Owner-split contract** — the binding boundary (`production-strateteach-readiness-questions.md`).
3. **Pilot runbook** — operator-assisted provisioning → arm → monitor → disarm, referencing the micro-order
   closeout (arming recipe + Doppler/Railway drift caveat + funding).
4. **Per-slice packets** (ST-1, ST-2, …) — consolidate the scattered `docs/live-path-*.md` into canonical runbooks.
5. **Gate ladder / production-readiness roadmap** — the A1/A4/4C/A11 + funding path.
6. **StrateTeach-owned open questions (S1–S7)** tracker — must close before real funds.
7. **Incident / kill runbook** — global kill, per-bot lock, queue pause, de-arm.
Governance v1.0 binding; each phase gets a Workstream row.

## 12. Exact first implementation slice — **ST-1: Operator read-only pilot cockpit**
- **What:** one operator page showing, per pilot bot: user · credential **fingerprint** + env · caps · status ·
  `worker_status` (`is_production`/`queue_enabled`/`worker_state` + age + "real-restart?" hint) · pgmq depth ·
  last trade · last `order.blocked` reason · lock/kill state.
- **Why first:** it's the exact monitoring we ran by hand via SQL this session, turned into a durable cockpit —
  highest operator value, lowest risk, and it de-risks every later phase (arming verification lives here).
- **Reuses:** `StatusPanel` + `lib/status.ts` (`operator_status`), `GateProgress`, `lib/actions.ts` (read paths).
- **Scope guardrails:** **read-only** (zero DB mutation), **zero secrets** (fingerprints only), behind a flag,
  local-validated (Vitest + a mock/harness screenshot), **not deployed**. Needs at most one safe read RPC
  (G-G) if `operator_status` doesn't already return `worker_status`/queue depth — to be confirmed in the packet.
- **Explicitly NOT first:** the user-facing UI (needs the identity-bridge decision) and anything that provisions,
  arms, or trades.

## Boundaries
Plan only. No code, no deploy, no DB change, no secrets, no live trading. Real funds NO-GO. All §B StrateTeach
questions remain OPEN; the T13 seam, identity bridge, and UI-ownership decisions gate Phase 1 code.
