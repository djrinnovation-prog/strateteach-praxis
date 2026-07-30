# Rebuild Plan — M3 v1.2 + M7 v1.3 (Codex round-2 CHANGES addressed) + Ledger

**Status:** PLANNING ONLY — no code, no DB, no deploy, no execution. Per the Master Rebuild Plan gate:
Produce → Verify(Claude/E1) → **Peer(Codex)** → Approve(Oren). This packet answers the **round-2** Codex CHANGES:
**M3 → v1.2**, **M7 → v1.3**, and updates the ledger. **M9 = v1.2 PASS** (accepted). **No M10/M11. No implementation.**
Proof standard for every dangerous surface: **not shown · not called · not deployed · not approved · cannot run.**

---

## M3 v1.2 — Praxis execution guardrails (Stone 1) — Codex round-2 CHANGES resolved
Grounded in the Praxis worker pipeline (`worker/src/index.ts`, `sizingRisk.ts`, `VaultSecretsProvider.ts`).

1. **Authorization/ownership BEFORE custody/decrypt.** Resolve **Profile ⊇ Credential ⊇ Bot ⊇ Signal** and authorize
   **before** any Vault decrypt. Gate: *bot exists + active + `trading_enabled` + `credential_id` belongs to the bot's
   `user_id` + not soft-deleted* → **only then** decrypt. Unauthorized / unowned / disabled bot **never** reaches decrypt.
   *Proof: call-graph — decrypt unreachable without the authz gate; audit `authz_denied` before any credential touch.*
2. **Atomic idempotency reservation BEFORE adapter + FULL LIFECYCLE** *(round-2 fix #1).* The key is reserved atomically
   by `INSERT trades(pending)` under `UNIQUE(bot_id, signal_id)` **before** any `createOrder`; a duplicate (`23505`) ⇒
   **no adapter call**. **State machine — every reservation is terminal or reconciled, NEVER stuck pending:**
   `reserved/pending → { rejected | blocked | placed → submitted → filled | unknown → reconciled }`.
   **A reject AFTER reservation (risk / authz / step-up fails post-INSERT) transitions the row to a TERMINAL
   `rejected`/`blocked` state + audit — it must NOT remain `pending`.** A terminal-rejected `signal_id` stays terminal
   (no silent retry) but **does not block a future *distinct* valid signal** (dedup is per `signal_id`).
   *Evidence: (a) concurrency test — two workers, one signal ⇒ one pending, one order; (b) **post-reservation reject
   test** — risk/authz/step-up fail after INSERT ⇒ row terminal `rejected`+audit, **0 pending left**, adapter never
   called; (c) a later **distinct** `signal_id` proceeds while the same `signal_id` stays terminal.*
3. **Beta risk breach = REJECT only, NO clamp.** Breach ⇒ **reject** (`order.blocked` / `SizingUnavailableError`) +
   audit; the system **never** clamps/resizes to fit. *Evidence: over-cap ⇒ reject + audit, no order, no clamp.*
4. **Full server-enforced cap set** (reject-on-breach, **before** the adapter): **per-order** (`max_order_notional_usdt`)
   · **per-bot daily** (`daily_notional_cap_usdt`) · **per-owner daily** (aggregate across the owner's bots) · **total
   exposure** (open-position notional) · **order-window** (max orders / rolling window). Most-restrictive wins.
   *Evidence: per-cap tests, each breach ⇒ reject + audit.*
5. **Step-up tiers for PIN/2FA (not client-satisfiable) + SESSION RULES** *(round-2 fix #3).* Tiers: **T0** read-only ·
   **T1** config change (enable bot / edit caps) = PIN · **T2** arming / raising caps / credential change = PIN + 2FA.
   Server verifies; **client creds can never satisfy step-up**. **Session rules:** a successful step-up mints a
   **short-TTL** (≤5 min) **server-side session** bound to `{user_id, tier, action-scope}`; each use emits an **audit
   event** (`stepup_granted` / `stepup_used` / `stepup_denied`); **replay-prevented** (single-use nonce per sensitive
   action — not a reusable bearer); **invalidated on any credential / risk-limit / cap change** and on TTL expiry.
   *Proof: server-side session store; call-graph — no client path sets the verified flag; tests — expired / replayed /
   after-cap-change step-up ⇒ denied + audit.*
6. **submitted/unknown/reconciliation guard.** A bot with an open trade in `submitted`/`unknown` is **blocked from
   firing** until reconciled (in-flight guard + boot reconciliation). *Evidence: in-flight ⇒ next signal deferred/blocked
   + audit.*
7. **paper / simulation / proposal CANNOT reach the adapter — STRUCTURALLY** *(round-2 fix #2; call-graph alone is
   insufficient).* Non-live modes run on a **separate code path** with **no reference** to the exchange adapter; the
   adapter is reachable **only** from the **Execution Core** for a real / authorized / funded / live order. **Four proofs:**
   (a) **route inventory** — every route/handler enumerated; paper/sim/proposal endpoints resolve to non-execution
   handlers; (b) **build/bundle proof** — non-execution bundles do **not** include the adapter module (grep + import-map);
   (c) **CI guard** — a lint/CI rule that **fails the build** if the exchange adapter is imported **anywhere outside
   `Execution Core`** (explicit importer allowlist); (d) **call-graph** — no path from paper/sim/proposal to
   `createOrder`. *Evidence: the CI guard is a committed rule + a **red-build demo** (intentional bad import ⇒ CI fails).*

**M3 v1.2 close criteria:** each point has a cited planning proof + (at implementation) an E1/E2 test. **Re-review by
Codex required. No implementation until PASS + Oren.**

---

## M7 v1.3 — StrateTeach backend "Fix drawer" (Stone 2) — Codex round-2 CHANGES resolved

1. **Source-specific split — FOUR sources (no generic webhook)** *(round-2 fix #1).* Separate, isolated handlers, each
   with its own auth/validation: **TradingView** (trading signals — the **only** path that may reach the Praxis pipeline,
   via the Praxis webhook + HMAC token; never direct execution) · **Telegram** (notifications only) · **Stripe** (billing
   only) · **StrateTeach** (**proposal / simulation ONLY for now** — never execution). **Future StrateTeach execution
   must go through the Praxis signal contract only — never the legacy backend or direct ccxt.** No shared/generic route;
   no source crosses into execution except TradingView→Praxis. *Proof: routes enumerated; call-graph — Telegram / Stripe /
   StrateTeach cannot reach any order/adapter path; StrateTeach output lands only in proposal/simulation.*
2. **Explicit legacy backend HARD-BLOCK (impossible, not hidden).** Unreachable: `/exchange/order`,
   `/exchange/withdraw`, `/exchange/close-profitable`, **header-based credentials**, **client env selection**. Hard-block
   = route not mounted OR 403/404 + ccxt builder unreachable via call-graph + production bundle grep clean + named
   deploy/build artifact. *(M6 standard.) Evidence: per-surface 5-part proof.*
3. **No-mainnet proof — env + DB + bots + UI/RUNTIME** *(round-2 fix #3).* **env** (no mainnet API keys anywhere) + **DB
   credential rows** (no mainnet `user_exchange_credentials`; all `exchange_environment=testnet`) + **active bots** (none
   mainnet) + **UI / runtime:** **no client-side env selector**, **no live/mainnet toggle reachable**, **no request can
   carry the exchange environment from the browser** (env is server-resolved from the credential only). *Evidence: env
   scan + DB read-back + bot-config read-back = 0 mainnet; **UI proof** — source + bundle grep for an env selector/toggle
   = none; **runtime/HAR** — no request carries a client-supplied `environment`/`live`/`mainnet` field.*
4. **Legal/data gate for backtest / strategy lab.** Backtest / strategy-lab may use **only** the Praxis clean-room engine
   + **approved data/licensing** (no unlicensed data; no provenance-unresolved strategy). Gate **before** the feature is
   reachable. *Proof: the lab cannot load unlicensed data or an unresolved-provenance strategy; blocked until clearance.*
5. **M7 must NOT depend on M3 until M3 passes.** The legacy-backend blocks (1–2, 6) stand **on their own** — the backend
   is locked regardless of the Praxis pipeline state. M7 references M3 only after M3 is PASS + Oren-approved. *Proof: M7
   block proofs contain no runtime dependency on M3.*
6. **Browser-secret HARD-PROOF (explicit)** *(round-2 fix #2).* No exchange secret ever in the browser: **no
   `localStorage` `EX_KEY`** (or any exchange key), **no `apiKey`/`apiSecret`** in browser memory/bundle, **no
   `X-Exchange-Key` / `X-Exchange-Secret`** headers anywhere. *Evidence (three layers): (a) **source grep** — no
   `EX_KEY` / `apiKey` / `apiSecret` / `X-Exchange-*` in client source; (b) **bundle grep** — production browser bundle
   clean; (c) **browser runtime storage check** — `localStorage` / `sessionStorage` / IndexedDB inspected at runtime
   contain no exchange secret. Keys are server-side only (Vault), per M2.*

**M7 v1.3 close criteria:** each point has a 5-part proof (not shown/called/deployed/approved/cannot-run) at
implementation. **Re-review by Codex required. No implementation until PASS + Oren. RA-1** closes Stone 2 after M5–M7 are
implemented + proven.

---

## Updated ledger (M1–M11 + re-audits + go-live gates)
| Item | Stone | Scope | Status |
|------|-------|-------|--------|
| **M1** | 1 | Pipeline architecture | PASS (planning) |
| **M2** | 1 | Credential custody (Vault, server-side) | PASS (planning) |
| **M3** | 1 | Execution guardrails | **v1.2 — Codex round-2 CHANGES addressed → re-review** |
| **M4** | 1 | Execution audit + observability | PASS (v1.1) |
| **M5** | 2 | Surface classification S1–S12 (Beta Block Plan) | planning-complete |
| **M6** | 2 | Block-implementation proof plan | planning-complete |
| **M7** | 2 | Fix drawer | **v1.3 — Codex round-2 CHANGES addressed → re-review** |
| **RA-1** | 2 | Post-block re-audit (prove S1–S12 cannot run) | pending (after M5–M7 impl) |
| **M8** | 3 | UX research + JTBD | PASS |
| **M9** | 3 | Screen map + IA | **v1.2 PASS** |
| **M10** | 3 | Wireframes + interaction states | NOT started (gated by Stone 1+2) |
| **M11** | 3 | Visual language + Hebrew RTL + a11y + trust/risk | NOT started (gated) |
| **RA-2** | final | Pre-beta re-audit (pipeline + backend + live-log grep) | pending (final gate) |
| **A5** | — | Webhook/TV hardening H1–H6 | OPEN (H1–H3 design; H4 partial; H5/H6 pending) |
| **A10** | — | Rollback / kill-switch drill | OPEN |
| **A11** | — | Written real-funds approval (Oren) | NOT granted |
| A1/A2/A4/A8 | — | egress / migration 009 / cred isolation / kill path | open |

**All still blocked (whole plan):** live trading, execution, direct exchange, browser secrets, withdraw, DB migrations,
production, commercial, legal/IP, shorts/margin. **No mainnet credential exists.** Everything above is **planning only.**
