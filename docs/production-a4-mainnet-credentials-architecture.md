# A4 — Mainnet Credentials Architecture (Planning Packet)

> **DOC / PLANNING — NO CODE, NO SECRETS.** No DB mutation · no deploy · no mainnet/real funds. **No secret values in
> this doc, ever.** Overnight draft, **uncommitted**, for Codex/Oren review. Pairs with the A8-H3 isolation design.

## Scope (planning only — explicit)
- **Planning only.** No deploy. No linked apply. No DB mutation. No Railway/Doppler change. No secrets. No mainnet / no real funds. **Real funds remain NO-GO.**
## 1. How mainnet API keys should be created
- Created **by Oren** in the exchange (Binance) mainnet account — **never** by Claude, never pasted anywhere Claude can
  read. One key **per (user, bot, environment=mainnet)** (aligns with A8-H3 per-bot isolation — no shared mainnet key).
- Label each key to its bot for auditability; record only **non-secret** metadata (key label, creation date, allowlisted
  IP) in docs/DB — **never the secret**.

## 2. Required permissions (least privilege) — hard requirements
- **Trade-only. Enable Spot/Margin trading as needed; DISABLE withdrawals.** No transfer/withdraw permission on any
  Praxis key — the platform must be unable to move funds off the exchange.
- **NO universal / account-wide master key** used across bots; **NO shared key across bots or users.** One key per
  (user, bot, mainnet) — aligns with A8-H3 per-bot isolation.
- Scope to the specific symbols/markets in use if the exchange supports it.
- **Rationale:** a compromised key can at worst mis-trade within caps for **one** bot — never withdraw, never affect
  other bots. Hard requirement.

## 3. IP allowlist requirements
- Each mainnet key **allowlisted to the worker's static egress IP** (A1). Binance IP-locks keys; without a pinned
  egress + allowlist, mainnet orders are rejected or the key is insecurely un-restricted.
- **Dependency:** A4 mainnet keys cannot be finalized until **A1 static egress IP** exists (the allowlist target).

## 4. Storage path (Vault / Doppler / Railway) — NO values in docs/chat/logs
**Never** write a real key/secret **value** into any doc, chat, PR, or log. Only non-secret pointers/metadata.
- **Exchange trading keys → Supabase Vault** (encrypted), referenced by `user_exchange_credentials.vault_secret_id`
  **per bot** (existing pattern via `read_vault_secret`/`delete_vault_secret`). The worker decrypts at execution; the
  browser/console never sees keys.
- **Doppler** = source-of-record for **app/infra** secrets (service_role, pepper, etc.), synced to Railway.
- **Railway** holds **app config + the Doppler-synced app secrets the worker needs** (that's expected and unchanged) —
  but it holds **NO exchange trading keys** (those live only in Vault). *(Clarification: "no keys in Railway" means no
  **exchange** keys — it does NOT mean Railway has no app secrets; the worker's Doppler-synced app secrets stay.)*
- **The custody split:** exchange keys = Vault (per bot); platform secrets = Doppler→Railway. Confirm at implementation.
- **Operator provisions all secret values;** Claude designs only the pointers/flow and never handles a value.

## 5. Rotation process
- Rotate a bot's mainnet key by: create new key (Oren) → store new secret in Vault → update that bot's
  `vault_secret_id` (compare-and-swap) → verify new key works (safe check) → **delete old Vault secret last** (the
  key-rotation order from migration 005). Per-bot isolation means rotation affects only that bot.
- Rotation is operator-run + audited; never reuse a key that was ever exposed locally.

## 6. Per-bot / per-user mapping
- `user_exchange_credentials`: one row per (user, bot, environment); `user_id` = owner; `vault_secret_id` = that bot's
  key; `exchange_environment` ∈ {testnet, mainnet}. `bots.credential_id` → that row **1:1** (A8-H3 constraint). A bot's
  `exchange_environment` **must match** its credential's — enforced (A8-H3).

## 7. Testnet vs mainnet separation — ENFORCED by DB + worker, not convention
- **Distinct credential rows, distinct Vault secrets, distinct exchange endpoints.** A bot is either testnet or mainnet.
- **DB enforcement:** a bot's `exchange_environment` **must equal** its credential's `exchange_environment` — a
  CHECK/trigger (with A8-H3) rejects a mismatch; there is no valid row where they differ.
- **Worker enforcement (fail-closed):** before decrypt/execute, the worker asserts `bot.exchange_environment ==
  credential.exchange_environment` and selects the ccxt endpoint from it; on mismatch → **no order** (fail-closed), not
  a silent fallback. So a testnet key can never place a mainnet order (or vice-versa) even if data were mis-set.
- **No mainnet execution until** the bot is explicitly mainnet-provisioned + all real-funds gates closed + A11.

## 8. OREN manual-steps checklist (secret-entry — never printed to Claude/docs/logs)
- [ ] Create the mainnet exchange account.
- [ ] Create **trade-only, no-withdrawal** API key **per bot** (no master/shared key).
- [ ] **Allowlist the A1 static egress IP** on each key.
- [ ] Store each key's secret into **Vault** (per-bot `vault_secret_id`) via the operator provisioning path — **paste the
      value only into the secret store, never into a doc/PR/chat/terminal history Claude can read.**
- [ ] Record only **non-secret** metadata (key label, creation date, allowlisted IP, bot mapping).
- [ ] Rotate keys operator-side (per §5); confirm no key was ever locally exposed.
- [ ] Grant **A11 (capped)** before any mainnet key is armed.

## 9. CLAUDE can-implement checklist (design/code, gated — NEVER handles secret values)
- [ ] Schema/constraints for per-bot isolation (with A8-H3).
- [ ] Worker **ownership + environment fail-closed** check (no secret value handled — reads `vault_secret_id` pointer,
      decrypt happens server-side via existing RPC).
- [ ] `operator_status` credential-status surfacing (non-secret).
- [ ] Provisioning + **rotation runbooks** (operator-run; Claude authors steps, never values).
- [ ] LOCAL test fixtures for the constraints/worker checks.
- **Never** touches key values, never provisions real keys, never deploys, never reads Vault contents.
- **Rotation compatibility:** the §5 flow (new→swap `vault_secret_id`→verify→delete-old-last) operates on the **per-bot
  credential row** (A8-H3) — rotation replaces one bot's Vault secret without touching any other bot.

## 10. Stop conditions
- Any key with **withdrawal permission** → STOP (must be trade-only).
- A mainnet key **not** allowlisted to the static egress IP → STOP (A1 first).
- Any shared mainnet credential (A8-H3 not enforced) → STOP.
- Any secret value appearing in a doc/PR/log → STOP + rotate.
- Any mainnet arming before A11 (capped) + all §gates → STOP.

**Real funds remain NO-GO** — A4 is a prerequisite; still needs A1, A8-H3, A2 reconcile, live-tier fail-closed, A11.
