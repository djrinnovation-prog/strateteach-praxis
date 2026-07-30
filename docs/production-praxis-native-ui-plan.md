# Praxis-native operator + bot-setup UI — research & plan (Codex-reviewable) — **Rev 2**

**Status:** RESEARCH / PLANNING ONLY — no code, no deploy, no DB mutation, no secrets, no mainnet / no real funds. Signum is **product inspiration only** — no Signum code, assets, branding, text, or exact UI is copied.

**Prime directives (non-negotiable, every phase):** the browser calls **Praxis surfaces only** (Supabase RPCs / Edge Functions / worker via queue); **never Binance directly**; holds **no `service_role`, no exchange keys, no secrets**; **never stores an exchange API secret in the browser**; **never exposes withdrawals**; **never bypasses Praxis** (RLS + server RPCs are the authority; the UI only reflects them). **Mainnet activation stays locked until A1 + A4 + 4A + 4C + A11. Real funds NO-GO.**

Builds on: `docs/production-operator-console-mvp-design.md` (RPC architecture + safety gates), `docs/ops-console-roadmap.md` (phasing), the live read-only Ops Harness (Slice A), the A4 credential / TradingView / live-tier packets.

---

## 0. Grounding — what exists today (verified)

**Frontend** (`frontend/`, React 18 + Vite 5 + TS): a minimal **internal operator console**, deliberately unstyled — no design system (bare HTML; deps only `@supabase/supabase-js`, `react`, `react-dom`; no router). Screens: `Login` (magic-link OTP, no public signup), `StatusPanel` (counters + bots table), `HarnessPanel` (read-only Ops Harness, flag-gated). Auth: Supabase **anon key only**; operator gating via `profiles.is_operator` (inferred from `operator_status()` success vs `42501`). Flags (default OFF): `VITE_OPERATOR_KILL_ENABLED`, `VITE_OPERATOR_HARNESS_ENABLED`. **Read surface = ONE RPC** `operator_status()`; **write surface = ONE RPC** `operator_kill_all()`. **No bot-create / credential / TradingView UI exists.**

### Decision D0 — visual design source (Codex #1)
There **is** an external, Claude-designed standalone operator UI to use as the **visual reference** (the repo itself has no styled UI). Resolved as a rule set:
- **D0a — Visual reference:** use the external standalone UI as the **look-and-feel reference only** (layout, spacing, components' appearance). *(Not yet inspected in this repo; visual fidelity matched at build time from the operator-provided reference.)*
- **D0b — Rebuild in Praxis:** **re-implement** the components natively in the Praxis React app (our shell, our state, our types). Do not import the standalone project.
- **D0c — No logic copy:** do **not** copy the standalone's JavaScript/behavior/business logic — appearance only.
- **D0d — Behavior binds to Praxis only:** every interactive behavior calls **Praxis RPCs / Edge Functions / queue+worker** surfaces — never a standalone endpoint, never Binance, never a direct table write.

---

## Phase 1 — Deliverable 1: UX research summary (Signum-like flows)

Signum-style no-code TradingView→exchange products converge on a **short linear onboarding + a live monitoring dashboard** (inspiration only):
1. **Create bot** — "automate in minutes, no code"; one subaccount per bot to isolate funds.
2. **Connect exchange** — API key with **trade ON / withdrawal OFF** (stated best practice), optional IP restriction; user pastes **key + secret**; balance checked before ordering.
3. **Connect TradingView** — product gives a **webhook URL + alert-message template** (placeholders); paste into a TradingView alert; **no strategy edits**; signals → **market orders**.
4. **Sizing / risk** — **% of balance** or **absolute** amounts; balance-checked.
5. **Activate / pause** — simple toggle; manual Long/Short/Flat + stop/override.
6. **Activity / live state** — real-time balances, open positions, "what the bot is doing," recent activity.

**The one pattern Praxis must NOT imitate:** Signum has the **browser collect the raw API secret**. Praxis differs (below).

### UX principle (Codex #7) — Signum for simplicity, Praxis for safety
Signum inspires **simplicity only**. Praxis is deliberately **safer** and these are hard rules, not preferences:
- **No direct exchange order from the UI** (orders only ever originate from a signal → queue → worker).
- **No browser API-secret storage** (secret never enters browser state/localStorage/logs).
- **No withdrawal support** (never rendered, never possible).
- **No activation until gates** (mainnet locked until A1/A4/4A/4C/A11).
- **queue / worker / risk / audit are mandatory** — the UI never shortcuts the Praxis pipeline.

### Phase-1 comparison to Praxis
| Signum concept | Reuse conceptually | Must NOT copy | Must be DIFFERENT for safety |
|---|---|---|---|
| Linear create→connect→configure→activate wizard | the *flow shape* | any Signum text/layout/assets | each step = a **reviewed Praxis RPC** |
| Paste key+secret in browser | the *goal* (attach a trade-only credential) | browser holding/keeping the secret | secret → **server-side Vault path over TLS only**, never in browser; UI sees a fingerprint. Deferred to A4 (Slice UI-4 = status/placeholder only) |
| "withdrawal OFF" guidance | show the same guidance | — | Praxis **never renders a withdrawal control**; enforces trade-only/allowlist server-side (A4) |
| TradingView webhook URL + template | show URL + copyable template | — | URL = **Praxis webhook**; token issued by a reviewed RPC, **shown once**, hash stored server-side (pepper); browser never hashes |
| Live balances / positions | show **Praxis-observed** state | reading Binance from browser | data from Praxis RPCs only, never a direct Binance call |
| Activate toggle | a status control | one-click live arming | **guarded** (precheck + audit); **mainnet locked** |
| Manual Long/Short/Flat, stop | the *stop* direction only | one-click manual *orders* | expose **stop/pause/kill** only; manual order placement out of scope |

---

## Phase 2 — Deliverables 2-5

### Deliverable 2 — Praxis-native UX map: TWO products, one shell (Codex #2)
Admin/operator and user-facing bot-setup are **different products for different roles** that **share the app shell/design system** but never share controls.

```
App shell (auth-gated, shared design system)
├── ADMIN / OPERATOR product  (role: operator)          [internal, fleet-wide]
│     Fleet health · worker status · bots table · Ops Harness · kill/read-only/guarded controls · audit/evidence
└── USER product  (role: bot owner)                      [self-serve, own bots only]
      My bots · Bot setup wizard · Bot detail · risk caps · activate/pause · activity/history
      Wizard: Create Bot → Connect Exchange → Validate → Connect TradingView → Risk Limits → Review + Activate
```
**Separation rule:** operator controls (kill, disarm-all, harness, fleet-wide views) **never render in the user product**; user setup/activation controls never grant fleet-wide power. Enforced by role (below) **and** server-side authz — the UI split is convenience; the RPC authz is the guarantee.

### Deliverable — Role model (Codex #3)
| Role | Sees | Can do | Never |
|---|---|---|---|
| **Operator / admin** (`profiles.is_operator=true`) | fleet-wide status, all bots, worker/queue, Ops Harness, audit/evidence | kill / disarm-all / pause (guarded, audited); (later) guarded enable on testnet | see secrets/`vault_secret_id`; arm queue / fire; mainnet activate; withdrawals |
| **Bot owner / user** (authenticated, owns the bot) | **only their own** bots + setup + activity | run the setup wizard; set risk caps; (later, via reviewed RPC) activate/pause **their** testnet bot | see other users' bots; see **operator kill/disarm controls**; enter/store secrets in browser; mainnet activate before gates; withdrawals |
| **Support / read-only auditor** (future role) | read-only fleet + audit-safe activity | **read only** — no mutations | any write; any secret |

- **Operator kill controls must NEVER appear in the ordinary user setup UI** (Codex #3) — they live only in the operator product, behind `VITE_OPERATOR_KILL_ENABLED`, and are server-gated by `is_operator`.
- Role source of truth = server (`is_operator` + owner RLS). The client role-routing is cosmetic; every RPC re-checks authz.

### Deliverable 3 — Screen-by-screen plan
**ADMIN/OPERATOR** — *Fleet status* (from `operator_status()`: counters, `worker_status` + staleness/DEGRADED, bots table with readiness + sharing advisory) · *Kill* (existing `operator_kill_all`, flag-gated, typed-confirm, audited, no re-arm) · *Audit/evidence view* (needs G6 read RPC; audit-safe only) · *Ops Harness* (existing).
**USER wizard** — (1) *Create Bot* (name/pair/type → **G1**; `pending_setup`, `trading_enabled=false`) · (2) *Connect Exchange* (exchange + env; **testnet selectable, mainnet locked**; secret entry **placeholder until G2/A4**) · (3) *Validate* (server-side read-only check → `pending_validation→valid`; **G3**) · (4) *Connect TradingView* (Praxis webhook URL + copyable alert template; **one-time token** revealed once from G1; never re-shown/stored) · (5) *Risk Limits* (`sizing_mode` %/fixed, per-order max, daily cap, buy-only v1 → **G4**, fail-closed) · (6) *Review + Activate* (testnet activate via **G5** guarded; **mainnet activate rendered but locked** with gate copy).
**USER bot detail** — status/`trading_enabled`; credential state (`credential_ok`/status/env/sharing — never `vault_secret_id`); TradingView (URL present, token last-rotated, rotate → `admin-rotate-webhook-token`); queue/worker state; latest activity; controls: **pause / (owner) request-kill**; re-enable guarded + mainnet-locked.
**Activity/history** — audit-safe timeline `signal received → queued → worker processed → blocked/filled/error` via **G6** (labels/ids/non-secret reasons only).

### Deliverable 4 — Component list (design-system-agnostic, rebuilt per D0b)
Shell/primitives: `AppShell/Header/RoleNav`, `Card`, `StatCounter`, `DataTable`, `StatusBadge`, `Button` (primary/danger/**disabled-with-reason**), `ConfirmDialog` (typed-confirm), `Banner` (degraded/locked), `CopyField` (webhook URL/template), `RevealOnceField` (one-time token), `Stepper/Wizard`, `FormField/Select/NumberInput`, `Toast`, `EmptyState`, `GateLock/LockedOverlay` (gate copy).
Feature: `FleetStatus`, `BotsTable`, `KillControls` (exists, operator-only), `HarnessPanel` (exists), `BotSetupWizard` (+6 steps), `BotDetail`, `CredentialStatus`, `TradingViewConnect`, `RiskLimitsForm`, `ActivityTimeline`, `GateLock`.
Util: extend `lib/status.ts`; new `lib/botSetup.ts`; reuse `lib/harness.ts` redaction; new `lib/gates.ts` (which control is locked until which gate); `lib/roles.ts` (client role routing, cosmetic).

### Deliverable 5 — Backend/API gap list (none exist today)
Each follows the established pattern (SECURITY DEFINER + inline authz + audit + raw read-back; secret handling like `admin-rotate-webhook-token`), is separately Codex-reviewed, applied surgically (never `db push`).

| # | Surface | Purpose | Risk / gate |
|---|---|---|---|
| G1 | `create_bot(...)` → `{bot_id, one_time_token}` (Edge fn — needs pepper) | create `pending_setup` bot + issue webhook token (hash stored server-side) | browser never hashes; token shown once |
| G2 | credential provisioning (Vault write) Edge fn | store key+secret in **Vault**, create `user_exchange_credentials`, return fingerprint | **A4** — never build ahead of A4; secret never in browser |
| G3 | `start_credential_validation(credential_id)` | server-side read-only exchange check; `pending_validation→valid` | no orders; mainnet gated on **A1** |
| G4 | `set_bot_risk_config(bot_id, sizing…)` | validate + set sizing/caps atomically | fail-closed |
| G5 | `set_bot_status(bot_id, active/paused)` (+ guarded re-enable) | activate/pause | testnet only; mainnet locked; guarded like `operator_enable_bots` |
| G6 | `list_bot_activity` / `operator_activity()` read RPC | audit-safe activity timeline | labels only, no secrets/balances/payloads |
| — | `admin-rotate-webhook-token` (**exists**) | rotate an existing bot's token | already built; wire safely |

### Deliverable 6 — Backend/API dependency table (Codex #6)
Per planned control: **Exists today** / **Needs RPC** / **Needs Edge fn** / blocked by **A1** / **A4** / **A11**.

| UI control / form | Exists today | Needs RPC | Needs Edge fn | Blocked by |
|---|---|---|---|---|
| Fleet status render | ✅ `operator_status()` | — | — | — |
| Kill / disarm (operator) | ✅ `operator_kill_all()` | — | — | — |
| Ops Harness (operator) | ✅ (read-only) | — | — | — |
| Activity/history timeline | — | **G6** (read) | — | — (testnet-safe once G6 reviewed) |
| Create Bot | — | — | **G1** | — |
| Connect Exchange (secret entry) | — | — | **G2** | **A4** |
| Validate credential (testnet) | — | **G3** | — | — |
| Validate credential (mainnet) | — | **G3** | — | **A1** |
| Connect TradingView (show URL/template) | ✅ (display only) | — | — | — |
| Reveal one-time token | — | — | **G1** | — |
| Rotate token | ✅ `admin-rotate-webhook-token` | — | (exists) | — |
| Set risk limits | — | **G4** | — | — |
| Activate/pause (testnet) | — | **G5** | — | — |
| Activate (mainnet) | — | **G5** | — | **A4 + 4A + 4C + A11** (and A1) |
| Withdrawals | ❌ never | ❌ | ❌ | **out of scope forever** |
| Direct order button | ❌ never | ❌ | ❌ | **out of scope forever** |

*This table prevents the UI from getting ahead of backend safety: a control ships **disabled** until its row is fully green.*

### Safety gates (visible vs disabled vs blocked) + copy
- **Enabled now (testnet, read/stop):** fleet status, bot detail (read), audit-safe activity (after G6), kill/pause/harness (operator).
- **Visible but DISABLED + copy:** mainnet activate; credential **secret entry** (until G2/A4); any re-arm to live. Copy: *"Mainnet activation is locked until static egress (A1), mainnet credentials (A4), audit fail-closed (4A), queue no-loss (4C), and the authorized live run (A11) are complete. Testnet only for now."*
- **Blocked server-side regardless of UI:** withdrawals, direct Binance calls, queue-arm/fire, secret display, mainnet writes.

---

## Deliverable — "Safe to build now" UI slices (Codex #4)
Each is **frontend-only or read-only** unless a reviewed RPC already exists.
- **UI-1** — admin/operator **shell read-only**, using existing `operator_status()` (+ existing kill behind its flag). *No new backend.*
- **UI-1b** — apply **visual styling from the external reference** (D0a/D0b), **no behavior changes**. *Frontend-only.*
- **UI-2** — bot setup **wizard skeleton** with **mock/disabled** backend actions (stubs; no secrets, no writes). *Frontend-only.*
- **UI-3** — TradingView setup **display-only** (webhook URL + alert template; token reveal stubbed until G1). *Frontend-only.*
- **UI-4** — credential **status placeholder only**, from `operator_status()`; **no secret entry**. *Read-only.*
- **UI-5** — activity/history from **existing safe logs only if available** (i.e. only once **G6** read RPC is reviewed; otherwise placeholder). *Read-only.*

## Deliverable — "Not safe yet" list (Codex #5)
Do NOT build any of these until their gate clears:
- real exchange **key entry** · **Vault write** · **credential promotion** (`→valid`/`→trusted`) · **mainnet activate** · **live TradingView enable** · **direct order buttons** · **withdrawals** · **browser-stored secrets** · **any mutation without a reviewed SECURITY DEFINER RPC**.

## Deliverable — implementation rule (Codex #8)
If a UI action **cannot be backed by an existing reviewed API/RPC**, render it **disabled with explanatory copy** (why it's locked + which gate/RPC unlocks it). **No hidden client-side mutations** — the UI never simulates or shortcuts a write; a control is either backed by a reviewed RPC or visibly disabled.

## Deliverable 7 — "Blocked before real funds"
Credential secret entry/Vault (G2, until A4) · mainnet credential validation (G3-mainnet, until A1) · any live order path (until 4A + 4C) · mainnet activate / re-arm (until A11) · manual orders / withdrawals / queue-arm-fire (never).

## Deliverable 8 — Implementation slices (each reviewed; no mainnet, no real secrets)
| Slice | Scope | Backend | Gate |
|---|---|---|---|
| **UI-1** admin/operator shell (read-only) | shell + fleet dashboard on `operator_status()`; DEGRADED banner; existing kill behind flag | none | safe now |
| **UI-1b** visual styling | apply external reference look (D0a/b/c/d); no behavior change | none | safe now |
| **UI-2** wizard skeleton | stepper + 6 panels, copy, locked-state; **stubbed** mutations | none (stubs) | safe now |
| **UI-3** TradingView display | webhook URL + copyable template; token reveal wired to G1 later | G1 (later) | display safe now |
| **UI-4** credential status | credential state from `operator_status`; **no secret entry** | none for status; G2/A4 for real (not this slice) | status safe now |
| **UI-5** activity/history | audit-safe timeline | **G6** (reviewed) | after G6 |
| **UI-6** guarded activation | Review+Activate; testnet via G5; **mainnet locked** | **G5** | testnet only; mainnet locked |

Order: **UI-1 → UI-1b → UI-2 → UI-4(status) → UI-3(display) → UI-5(after G6) → UI-6(after G5)**. G2 (Vault/secret) deferred to A4, never built ahead of it.

---

## Deliverable 9 — First implementation proposal (Codex #9)
**Recommended first coding slice: `UI-1 admin/operator shell (read-only) + UI-1b visual styling only`.**
- **Must NOT include:** bot-creation writes · credential writes · TradingView token creation · activation · mainnet · any new mutation.
- **May show (read-only / static):** system status + worker state (from `operator_status()`) · bots table · Ops Harness (existing, flag-gated) · **production-gate progress** (A1/A4/4A/4C/A11 status as read-only indicators) · **activity placeholders** · **disabled setup cards** (with gate copy).
- Existing kill stays behind `VITE_OPERATOR_KILL_ENABLED`; harness behind `VITE_OPERATOR_HARNESS_ENABLED`. Frontend-only + the one existing read RPC — zero new backend, zero new mutation.

---

## Stop conditions
Browser reaching Binance / holding `service_role` / storing a secret / hashing a token / reading `vault_secret_id` → STOP. Any withdrawal control, any functioning mainnet activation before A1+A4+4A+4C+A11, any queue-arm/fire from UI → STOP. Any mutation not backed by a reviewed SECURITY DEFINER RPC (with audit + raw read-back) → STOP. Any Signum code/asset/branding/text/exact-UI reuse, or copying the external reference's JS logic → STOP. Any real-funds path → STOP.

## Rev 2 summary (Codex #10)
- **What changed:** D0 split into **D0a-d** (external UI = visual reference; rebuild in Praxis; no logic copy; behavior binds to Praxis surfaces only). **Admin/operator vs user products explicitly separated** (shared shell, never shared controls). **Role model added** (operator / bot-owner / future read-only auditor — operator kill controls never in user UI). **Exact safe-now slices** incl. new **UI-1b** (styling-only). **"Not safe yet" list** + **backend/API dependency table** (exists / needs RPC / needs Edge / blocked by A1/A4/A11) added. **UX principle** (Signum=simplicity, Praxis=safer) + **disabled-with-copy implementation rule** (no hidden client mutations) added.
- **Recommended first UI slice:** **UI-1 + UI-1b** — admin/operator shell, read-only on `operator_status()`, styled from the external reference; **no writes, no setup mutations, no mainnet**; shows status/bots/harness/gate-progress/activity-placeholders/disabled setup cards.
- **Backend gaps:** G1 create_bot+token (Edge), G2 Vault provisioning (A4), G3 validate, G4 risk-config, G5 activate/pause, G6 activity-read — none exist; each its own reviewed packet.
- **Blocked items:** secret entry/Vault (A4), mainnet validate (A1), live order path (4A+4C), mainnet activate/re-arm (A11), manual orders/withdrawals/queue-arm (never).
- **Confirmation:** planning only — no code, no deploy, no DB mutation, no secrets, no mainnet / no real funds.

*Prepared for Codex review at Oren request.*
