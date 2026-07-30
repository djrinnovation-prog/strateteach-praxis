# LIVE-PATH — A4 Binance credential connection packet (design only)

How Binance credentials connect through Praxis to a bot, safely, with orders blocked until A11. **Design
packet — no code until Codex PASS. No secret printing. The browser never sees the secret.**

## 0. Key clarification: Doppler vs Vault (important)
You stored the Binance key in **Doppler**. Doppler is Praxis's **source-of-record for INFRA secrets**
(pepper, service_role, DSNs) that sync to Railway/Edge **env** — it is **not** where the worker reads
exchange credentials. The worker reads exchange keys **only from Supabase Vault** via
`get_decrypted_secret(vault_secret_id)` (migration 004, service_role-only), and the DB stores just the
`vault_secret_id` pointer. So the Doppler-staged key must be **provisioned into Vault** before a bot can use
it. Two supported entry paths, one canonical store:

| Entry path | Who enters the secret | Where it lands |
|---|---|---|
| **Operator provisioning (now, first bot)** | secret already in Doppler → a server-side operator-run step reads it from the worker/Edge env and writes it to **Vault** | Supabase Vault; credential row gets server-set `vault_secret_id` |
| **User product (later)** | user types key+secret in the UI → `connect-exchange` Edge fn | Supabase Vault; same downstream |

Either way the **secret ends in Vault**, the DB holds only a pointer + metadata, and the browser never
touches it.

## 1. How the UI connects Binance credentials
- **User product (future, UI-3b "Connect Exchange"):** api_key + api_secret entered in the browser
  (password field, in-memory only, never localStorage/sessionStorage) → `POST` to the **`connect-exchange`
  Edge function** over TLS with the user JWT → returns a non-secret fingerprint + `credential_id`. This is
  also the **C-1 full fix**: the server (service_role) writes Vault and **sets `vault_secret_id`** — the
  client can never set it.
- **Operator/first bot (now):** no UI secret entry. The UI's "Connect Exchange" step shows the credential
  **status** only (pending_validation → valid) from an RLS-scoped read; the Vault write is the operator
  provisioning step above.

## 2. How it reads Doppler / Vault safely
- **Browser:** anon key only; RLS-scoped reads of **non-secret** columns (credential `status`,
  `exchange_environment`, a fingerprint). Never Doppler, never Vault, never the key/secret.
- **Doppler → env:** the staged key is available **server-side** (worker/Edge env) for the one-time
  provisioning write into Vault; it is never returned to any client and never logged.
- **Vault (canonical):** service_role-only `get_decrypted_secret(vault_secret_id)`; the worker's
  `VaultSecretsProvider` fetches it per call, uses it, and drops the reference. DB = pointer only.
- **C-1 (migration 026, applied-gated):** `vault_secret_id` is owner-bound — a pointer can never be tied to
  two users; the client can never set it.

## 3. How to validate read-only from the Railway static IPs
- **Validation MUST run on the WORKER (Railway `praxis-platform`)**, not an Edge function — the Binance key
  is IP-allowlisted to the worker's 3 static-egress IPs, so only the worker can reach it. An Edge-fn
  validation would egress from Supabase IPs and be rejected.
- Flow: worker fetches the secret from Vault (allowlisted IP) → calls Binance **READ-ONLY**: account /
  API-restrictions + `fetchBalance` → asserts **(a)** the key answers (proves the IP allowlist is correct),
  **(b) withdrawals DISABLED**, **(c) spot enabled / not futures**, **(d) environment matches tier**. **No
  order.** Pass → promote `status='valid'` + store non-secret evidence (permissions snapshot, IP-ok,
  checked-at); fail → `status='invalid'` + reason. Triggered by a UI/operator action (enqueue a validation
  job); UI polls `status`.
- **Mainnet read-only nuance (design point for review):** validating a **mainnet** key requires the
  validation adapter to hit **mainnet** Binance endpoints (non-sandbox) for the read-only calls, while order
  placement stays blocked by §4. Read-only mainnet validation ≠ armed mainnet trading — the adapter must do
  `fetchBalance` only and never `createOrder` on this path.

## 4. How orders are prevented until A11 (defense in depth, all server-side)
1. Bot `status` ≠ `active` and `trading_enabled=false` until an explicit **guarded** `set_bot_status` (G5);
   **mainnet activation is hard-blocked until A1/A4/4A/4C/A11.**
2. `operator_locked` (migration 027, M-2) can hold the bot even against the owner.
3. Worker fail-closed gates run before any exchange call: `assertTradingEnabled`, `assertExchangeEnvironment`
   (tier must match the credential's env), config-readiness, and the A1 proxy check.
4. Credential must be `valid`; a `pending_validation`/`invalid` credential fail-closes the bot (Step 4a).
5. **Credential row exists ≠ bot uses it** — a bot only trades on a credential after repoint + activation.
6. Connect + validate are **read-only** (no `createOrder` anywhere on those paths).
7. **A11 tiny-live** is a separate explicit approval that arms the first micro-order — nothing before it can.

## 5. Exact user-facing flow
**Operator / first bot (now):**
1. Binance key created + restricted (withdrawals OFF, spot-only, IP-allowlisted to the 3 worker IPs) → staged in Doppler. ✅ (your step)
2. **Operator provisioning** (server-side, gated): read the staged secret from env → write to Vault → insert `user_exchange_credentials` (env=**mainnet**, `status=pending_validation`, **server-set** `vault_secret_id`). No browser, no order.
3. **UI Step 3 "Validate Credential"** → enqueues the worker read-only validation → worker checks from the allowlisted IP.
4. **UI shows `valid`** + evidence (withdrawals-off confirmed, IP ok, spot ok). If `invalid`, the reason is shown; fix on Binance and re-validate.
5. **UI Step 5 "Risk Limits"** → set sizing + per-order max + daily cap (fail-closed if incomplete).
6. **No activation.** Step 6 "Activate" stays locked; mainnet is NO-GO until A1/A4/4A/4C/A11 + explicit A11 approval.

**User product (later):** identical from step 3 on; step 1–2 replaced by UI secret entry → `connect-exchange` Edge fn → Vault.

## 6. Naming / env clarity to confirm (your open question)
- **Doppler var naming** (suggestion): encode purpose + env + bot, e.g. `BINANCE_APIKEY_MAINNET_<bot>` /
  `BINANCE_SECRET_MAINNET_<bot>` — so mainnet vs testnet is unambiguous and per-bot (no sharing).
- **`user_exchange_credentials.exchange_environment`** must be set to `mainnet` for this key and **match the
  worker tier** at validation/use (`assertExchangeEnvironment`). A testnet-tier worker will (correctly)
  reject a mainnet credential and vice versa.
- Per A4: **one key per (user, bot, mainnet)**, trade-only, no-withdrawal, IP-allowlisted, **never shared**;
  `vault_secret_id` is sensitive (fingerprint/placeholder only in logs/UI).

## 7. Backend to build (all gated on Codex PASS; none built here)
- **Operator provisioning step** (Doppler→Vault write + credential row, server-set pointer) — the C-1-safe writer.
- **`connect-exchange` Edge fn** (user-product secret entry → Vault) — same writer, UI-fronted.
- **Worker read-only validation** + **`start-credential-validation`** trigger/poll.
- **`set_bot_risk_config`** (G4) and **guarded `set_bot_status`** (G5, mainnet-blocked).

## Boundaries
No deploy, no token rotation, no TradingView alert, no secret printed, no mainnet order. This is a design
packet for review; no secret-handling code is written until Codex PASS.
