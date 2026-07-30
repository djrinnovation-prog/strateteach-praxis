# UI-3 — TradingView connection flow (webhook token) — design packet

**Status:** DESIGN / PLANNING ONLY — no code, no deploy, no DB mutation, no secrets, no mainnet / no real funds. Stop for Codex review before any code. Supersedes the display-only UI-3 sketch in `production-praxis-native-ui-plan.md` with the full token-generation UX.

**Product rule applied:** user-facing token generation/rotation is a **UI flow**, not a terminal script. The terminal rotation checklist is retired for user-facing use.

**Hard UI safety invariants:** the plaintext token lives **only in React component memory**, shown **exactly once**, **never** in `localStorage`/`sessionStorage`/`console`/analytics, and is wiped on dismiss/unmount. The browser **never writes the DB directly** and **never calls Binance**. Existing tokens are **non-recoverable** (only the hash is stored) — you can only **rotate**.

---

## 1. Can we reuse `admin-rotate-webhook-token`? — assessment (code-grounded)
Partially, but **not directly** for a user self-service UI:
- ✅ Good parts to reuse: it takes a **client-generated token** (`rotate.ts:117,120` `TOKEN_RE`), hashes it with the Edge-only pepper via the shared hasher (`_shared/webhook-hash.ts`), does a **compare-and-swap** on `bots.webhook_secret_hash` (`index.ts:54-58`), audits, and **returns fingerprints only — never the plaintext** (`rotate.ts:150-152`). That model is exactly right for the UI (browser generates → shows once → server stores hash).
- ❌ Blockers for UI use:
  1. **Operator-only auth** — it enforces `profiles.is_operator=true` (`index.ts:38-40`). A bot **owner** rotating **their own** bot's token needs **owner-auth** (`auth.uid() == bots.user_id`), not operator.
  2. **Doppler attestation** — commit requires `doppler_updated_confirmed=true` + `doppler_secret_name` (`rotate.ts:161-163`). That's an operator/Doppler workflow; the UI's **"I saved this token"** is the client-side equivalent and shouldn't require Doppler.
  3. **Two-step dry_run+commit with CAS** is operator-ergonomic; the UI can keep CAS but wants a single "rotate" call.

**Recommendation:** a **new owner-gated Edge function** (below), reusing `_shared/webhook-hash.ts` + the pepper, rather than overloading the operator function. (Alternative: extend `admin-rotate-webhook-token` with owner-auth + a "ui" mode that drops the Doppler attestation — messier dual-purpose; not recommended.)

---

## 2. UI/UX plan — the "Connect TradingView" step

**Entry state (token status, no reveal):** show whether a token is set (a boolean, e.g. `webhook_token_set` — derived from `bots.webhook_secret_hash IS NOT NULL`, never the hash). Two cases:
- *No token yet* → primary button **"Generate webhook token"**.
- *Token already set* → **"Rotate webhook token"** (with the warning below). The existing token is **never shown** (non-recoverable).

**Rotate/generate flow:**
1. **Warn modal (rotate only):** *"Rotating generates a new token and invalidates any existing TradingView alerts that use the old token. You'll need to update those alerts. Continue?"* (Confirm / Cancel.)
2. Browser **generates a secure token** (`crypto.getRandomValues` → URL-safe, ≥32 chars matching `TOKEN_RE`), held in component state only.
3. Browser calls the **owner-gated rotate Edge fn** (§3 G-TVR) with the token → server hashes+stores (CAS) + audits → returns `{ ok, new_fp, updated }` (**no plaintext**).
4. On success, render the **reveal-once panel**:
   - **Plaintext token** in a `RevealOnceField` (shown once) + **Copy** button.
   - **Webhook URL** `https://<ref>.supabase.co/functions/v1/webhook/<bot_id>/<token>` + **Copy** (built in-memory; the URL contains the token, so it's part of the once-only reveal — copying it is fine, persisting is not).
   - **TradingView payload template** (static JSON) + **Copy**:
     `{"signal_id":"{{timenow}}","action":"buy","fire_time":"{{timenow}}","close":"{{close}}","volume":"{{volume}}"}`
   - **"I saved this token"** checkbox (required). Until checked, a persistent notice: *"This token is shown once and cannot be recovered — save it now."*
5. On **checking "I saved this token" + Done** → wipe the token + URL from component state (set to null); the panel collapses to the *token-set* state. Nothing persisted.

**Test signal (enabled after "I saved this token"):**
- **"Send test signal"** button → fires a test signal for this bot (§3 G-TVT), then reads back the outcome (§3 G-TVR-READ) and shows **queued / rejected / error** with a short explanation. (See §4 for the test-path decision.)

**Copy affordances:** webhook URL, payload template (and the token, once). All via clipboard; never logged.

**States summary:** `no-token` → `generating` → `reveal-once` (token+URL+template+save-gate) → `token-set` (masked, rotate-only) ; plus `testing` → `test-result(queued|rejected|error)`.

---

## 3. Backend dependency list (exact contracts; none exist yet)

**G-TVR — `rotate_bot_webhook_token` (Edge function, owner-gated) — REQUIRED.**
- Auth: `verify_jwt=true`; resolve `auth.uid()`; require `bots.id = :bot_id AND bots.user_id = auth.uid() AND deleted_at IS NULL` (owner-gated; optionally also allow operators).
- Input: `{ bot_id, token }` (client-generated; validate `TOKEN_RE` = `^[A-Za-z0-9_-]{32,}$`).
- Behavior: `new_hash = computeWebhookHash(WEBHOOK_SECRET_PEPPER, token)` (reuse `_shared/webhook-hash.ts`); CAS update `bots.webhook_secret_hash` (no `expected_old_hash` needed if we accept "last write wins for the owner", or keep CAS via a read-then-swap); audit `webhook_token.rotated` (fingerprints only). **Never returns the plaintext.**
- Output: `{ ok, bot_id, new_fp, updated_rows }`.
- Pepper stays Edge-only; no plaintext logged. Mirrors the existing hasher/CAS/audit patterns; **no Doppler attestation**.

**G-TVT — `test_bot_signal` (owner-gated, RPC or Edge) — REQUIRED for the Test button (see §4).**
- Auth: owner of `bot_id`. Input: `{ bot_id }`. Behavior: server-side simulate one signal for the owner's bot — insert a `webhook_logs` row (unique test `signal_id`) and enqueue via `pgmq_send`, exactly as the webhook does — return the resulting `signal_id`. No token needed (owner-auth). **Testnet only; worker disarmed ⇒ no order.**

**G-TVR-READ — `get_bot_signal_status(bot_id, signal_id)` (owner-gated read RPC) — REQUIRED.**
- Returns the `webhook_logs` row's **status** (`accepted|queued|queue_failed|rejected`) + `requeue_attempts`/`next_retry_at` — **audit-safe labels only**, no token/payload/raw. Used for the test read-back and (later) the activity view (this is the G6 read RPC scoped to one signal).

**G-TOKEN-SET flag — owner read of "is a token set".**
- Either add `webhook_token_set boolean` (= `webhook_secret_hash IS NOT NULL`) to an owner-scoped bot read, or a tiny RPC. Never exposes the hash.

*(All four are new; each is its own reviewed packet. They reuse existing patterns: `_shared/webhook-hash.ts`, `pgmq_send`, SECURITY DEFINER + inline authz + audit.)*

---

## 4. Test-signal path — DECISION POINT
The webhook needs the plaintext token for auth, and a **browser fetch to the webhook is blocked by CORS** (the webhook sets no CORS headers — it's server-to-server for TradingView). Two options:
- **(A, recommended) Server-side `test_bot_signal` (G-TVT):** owner-gated; simulates the signal server-side (insert webhook_logs + enqueue), no token, no CORS. Tests the **enqueue → `queued`** path (the 4C-relevant part) + the read-back. **Does not** test token-auth rejection.
- **(B) Add CORS to the webhook** so the browser can fire the real URL with the in-memory token → tests the full **token-auth + enqueue** path, yielding a true `rejected` on a bad token. Cost: a webhook change (CORS) + the token transits the browser's own network log (inherent to webhooks).
- **Recommendation:** ship **(A)** first (covers queued/error); add **(B)** later if a true token-auth self-test is wanted. Real TradingView-alert validation stays **approval-gated** regardless.

---

## 5. What can be done NOW safely (frontend-only, no backend)
**Slice UI-3a — TradingView step shell + token-handling primitives (frontend-only, stubbed backend):**
- The step UI: entry state, warn-on-rotate modal, `RevealOnceField`, Copy buttons (webhook URL + payload template + token), "I saved this token" gate, disabled "Send test signal", test-result placeholder.
- Client token generation (`crypto.getRandomValues` → `TOKEN_RE`) — pure, testable.
- Wiring to **stubs** for G-TVR / G-TVT / G-TVR-READ (no network) so the flow is demonstrable and testable without backend.
- Tests (vitest): token never written to `localStorage`/`sessionStorage`; reveal-once (token shown once, gone after dismiss); rotate shows the warning; no token in any `console.*`; "Send test signal" disabled until "I saved this token"; generated token matches `TOKEN_RE`.
- Screenshots (desktop + mobile) via the existing demo harness.
- **No deploy, no backend, no real token stored anywhere.**

## 6. What remains LOCKED (needs reviewed backend + approvals)
- Real **token rotation** → needs **G-TVR** (owner-gated Edge fn), reviewed + deployed (deploy approval-gated).
- Real **test signal + read-back** → needs **G-TVT** + **G-TVR-READ**, reviewed + deployed.
- **Real TradingView alert activation** → your explicit approval; testnet only.
- Mainnet / real funds → NO-GO.

## 7. First implementation slice (proposed)
**UI-3a** (frontend-only, stubbed) as in §5 — a complete, testable, screenshot-able TradingView step whose real actions are disabled/stubbed until G-TVR/G-TVT/G-TVR-READ land. Then, in order, each as its own reviewed packet: **G-TVR** (rotate Edge fn) → wire real rotation; **G-TVR-READ** + **G-TVT** → wire the Test button; (optional) **(B) webhook CORS** for token-auth self-test.

## 8. Stop conditions
- Any token in `localStorage`/`sessionStorage`/`console`/analytics/URL-persistence; any token surviving screen exit → STOP.
- Any direct DB write or Binance call from the browser; any secret in the browser bundle → STOP.
- Any backend action (deploy G-TVR/G-TVT, webhook CORS) without its own review + approval → STOP.
- Reusing `admin-rotate-webhook-token` for user self-service without adding owner-auth (it's operator-only) → STOP.
- Real TradingView activation / mainnet / real funds → STOP.

*Prepared for Codex review at Oren request. No code until reviewed.*
