# StrateTeach ⇄ Praxis — Phase-0 Decision Brief

**PLAN ONLY — no code, no deploy, no DB, no secrets.** Scope: the two decisions that gate pilot code —
**(1) UI ownership** and **(2) Identity bridge**. Everything here sits under the binding owner-split (Praxis
executes/holds credentials; StrateTeach never holds keys/`service_role`/Vault/DB-write/webhook-tokens in the
browser).

---

## Decision 1 — UI ownership

**Option A — same React app, rebranded** (add a StrateTeach *user shell* to `frontend/src`, behind a flag).
**Option B — separate StrateTeach app** consuming the Praxis backend (RPC/Edge) over its own origin.

| Dimension | A — same app rebranded | B — separate app |
|---|---|---|
| **Speed** | **Fastest** — reuse `Login`, `StatusPanel`, `GateProgress`, `BotSetupWizard`, `TradingViewConnect`, `supabase.ts`; no new auth/API client, no CORS plumbing | Slower — new Supabase client, re-implement user cards, CORS allowlist on Edge, own deploy |
| **Risk** | **Lower** — the browser already talks only to Praxis RPC/Edge under RLS; the security boundary is already enforced; no new origin | Higher — new origin ⇒ new CORS/RLS/no-secrets surface to get right (recall the `admin-rotate` CORS bite) |
| **Maintenance** | Single codebase + pipeline; but couples StrateTeach product cadence to Praxis releases/governance | Two codebases; clean product/brand/team separation; independent iteration |
| **Deployment** | One Railway static build, flag-gated (`VITE_STRATETEACH_PILOT`) | Two pipelines |

**Key fact that de-risks the choice:** the **backend surface is identical either way** (a user-dashboard read
RPC + a self-kill RPC, both RLS-keyed on `auth.uid`). So starting with A does **not** lock out B — a later
extraction reuses the same RPCs.

**Recommendation (fastest controlled pilot): Option A**, flag-gated, with a "start coupled, extract to B later"
note once the pilot validates and StrateTeach wants independent iteration.

---

## Decision 2 — Identity bridge (StrateTeach user → Praxis `auth.uid`)

Praxis RLS keys every bot/credential on `user_id = auth.uid()`. The user's session must resolve to the
Praxis `auth.uid` that owns their bot.

**Option 1 — Shared Supabase Auth** (the user *is* a Praxis Supabase Auth user; their JWT `sub` = `auth.uid`).
- *Pilot shortcut:* **operator provisions a per-user Supabase Auth account** and creates the bot with
  `user_id` = that uid; user signs in (magic link / set password). Zero bridge.
- *Production:* self-registration + email verification on the same shared Supabase Auth. **Same RLS, no rework.**

**Option 2 — SSO / OIDC federation** (StrateTeach owns identity; federate into Supabase Auth / custom JWT).
- Needed only if StrateTeach must own the IdP (typically with Option B). Adds token-exchange + signing/verify
  surface; RLS must trust the bridged claim correctly.

**Option 3 — Service-mediated proxy** (StrateTeach server calls Praxis with a service identity; browser never
authenticates to Praxis).
- Moves trust to StrateTeach's server, can't use per-user RLS directly, needs a per-user proxy API. Overkill
  for a pilot and weakens the isolation guarantee.

| Aspect | 1 — Shared Supabase Auth | 2 — SSO federation | 3 — Service proxy |
|---|---|---|---|
| Pilot speed | **Fastest** (already how the app authenticates) | Slow (build the bridge) | Medium (build the proxy) |
| RLS fit | **Native** — `auth.uid()` just works | Works if the bridge maps claims correctly | Bypasses per-user RLS |
| Security surface | **Smallest** — no bridge, no mapping table | Larger — JWT signing/verify, mapping | Larger — server holds broad trust |
| Production-safe? | **Yes** — same model scales | Yes, if StrateTeach must own IdP | Discouraged for per-user isolation |

**Recommendation: Option 1 — shared Supabase Auth, per-user operator-provisioned for the pilot.** It is
simultaneously the **pilot shortcut and the production path** — nothing to rip out later; if StrateTeach ever
needs its own IdP, add SSO **federation into** Supabase Auth without touching RLS.

**Security anti-patterns to forbid (any option):**
- ❌ one shared "pilot" account for all users (breaks isolation — one user sees others' bots);
- ❌ `service_role` or any secret in the browser;
- ❌ StrateTeach minting/holding Praxis JWTs or webhook tokens client-side;
- ❌ passing `user_id` as a parameter without RLS (IDOR). RLS on `auth.uid()` is the only authority.

---

## Recommended combo for the fastest controlled pilot
**Option A (same app rebranded) + Option 1 (shared Supabase Auth, operator-provisioned per user).**
Lowest risk, fastest, and both are on the production path — no throwaway work.

## What we can do immediately (decision-independent)
- **ST-1 operator read-only cockpit** (Praxis-side; unaffected by either decision).
- Spec the **user-dashboard read RPC** + **user self-kill RPC** (RLS-keyed on `auth.uid` — same for A or B, 1/2/3).
- Confirm RLS policies + the "never select `webhook_secret_hash` / `vault_secret_id`" rule.
- Author packets. No code, no DB, no secrets.

## What must wait
- The StrateTeach **user shell** (proceed once Option A is confirmed — trivial under A).
- Any **SSO/federation bridge** (only if Option B **and** StrateTeach owns identity later).
- **Self-serve credential entry** (Phase 7) and the §B StrateTeach answers (S1–S7) — required before real funds.

## Exact first implementation slice after the decision
- **Still ST-1 (operator read-only pilot cockpit)** — decision-independent, the safest foundation and the
  arming-verification surface for every later phase.
- **First decision-*dependent* slice: ST-2 — user read-only dashboard** (per-user, no secrets), which the
  A+1 decision **unblocks immediately** (no bridge to build): the rebranded user shell + a new RLS-scoped
  `user_bot_dashboard` read RPC, gated behind `VITE_STRATETEACH_PILOT`, local-validated, not deployed.

## Boundaries
Decision brief only. No code, no deploy, no DB, no secrets, no live trading. Real funds NO-GO.
