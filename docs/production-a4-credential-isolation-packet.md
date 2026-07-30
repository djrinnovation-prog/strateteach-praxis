# A4 Packet — Production Credential Isolation

> **DOC / DESIGN ONLY — NOT EXECUTION.** No DB mutation · no Vault change · no key creation/rotation ·
> no Doppler/Railway change · no mainnet/real funds. Defines the target credential model, options,
> blast radius, rotation, evidence, and stop conditions. Related: [A1 egress](production-a1-egress-binance-connectivity-packet.md)
> (the mainnet key must be IP-restricted from creation), [S5-A6 rotation runbook](sprint5-s5-a6-incident-rotation-runbook.md).

## 1. Current state (testnet)
- **One shared credential** `2b5c038a-a4a7-4be5-b2fe-90d32f67781b` backs **all 5** bots
  (BTC/ETH/BNB/SOL/XRP). `status=valid`, not deleted, `exchange_environment=testnet`.
- Storage: the secret is in **Supabase Vault**; `user_exchange_credentials.vault_secret_id` holds the
  pointer (UUID), never the key. The worker resolves the pointer → `get_decrypted_secret` at order time.
- This is fine for a **testnet** campaign (one account, no real funds). It is **not** acceptable for
  production real funds.

## 2. Production requirement
- **No shared *production* credential** — unless Oren **explicitly** approves a single-operator launch
  on one mainnet key, recorded as a documented exception.
- Per the intended model: **per-user, and (optionally) per-bot** credentials; a user/bot can reach
  **only its own** credential (RLS-enforced); rotation of one credential does **not** impact others.
- **Vault-only** storage for every key (testnet and mainnet); never DB columns, never browser, never
  Doppler, never logs.
- **`exchange_environment` separates testnet/mainnet** at the credential — the worker's env guard
  (`assertExchangeEnvironment`) already fail-closes on a mismatch vs `PRAXIS_IS_PRODUCTION`.

## 3. Credential model options
| Model | What | Pros | Cons | Fit |
|---|---|---|---|---|
| **Shared (current)** | one key, many bots | simplest | max blast radius; rotation hits all; no per-user isolation | **testnet only** |
| **Per-user** | one key per user (across that user's bots) | user-level isolation; matches multi-tenant RLS | a user's bots still share one key (intra-user blast radius) | **MUST for multi-user** |
| **Per-bot** | one key per bot | minimal blast radius; per-strategy limits | more keys to manage/rotate; exchange-side key limits | **strongest; SHOULD where feasible** |
| **Per-user + per-bot sub-keys** | user owns keys, optionally one per bot | best isolation + ownership | most management overhead | future / high-value bots |

**Recommendation:** **per-user** as the production floor (RLS-isolated), **per-bot** where the exchange
and ops allow. A **single-operator launch** MAY start on one mainnet key **only** with an explicit
Oren exception, kept isolated from any future user keys.

## 4. Vault-only storage (invariant)
- Every exchange key lives in **Vault**; `vault_secret_id` is the only DB reference (UUID; a malformed
  pointer already fail-closes the bot — `vault_secret_id_malformed`).
- The key is **never** returned to a client, written to a DB column, placed in Doppler, or logged.
- The credential-setup UI (B2) must write **straight to Vault** and surface only the `vault_secret_id`
  ref — never echo the key.

## 5. testnet / mainnet separation
- `user_exchange_credentials.exchange_environment ∈ {testnet, mainnet}` (migration 014).
- Worker env guard: `PRAXIS_IS_PRODUCTION=true` ⇒ mainnet creds only; `false` ⇒ testnet only —
  mismatch ⇒ `order.blocked('env_mismatch_*')`, no order (already enforced + tested).
- **A demo/test bot must never reference a mainnet credential** (ties to [A12 env separation](production-go-live-gap-list.md)).

## 6. Rotation plan
- **Granularity:** rotate a single credential (Vault re-encrypt / new key) **without touching others** —
  the per-credential model is what makes this possible (the shared key cannot).
- **Procedure:** follows the [S5-A6 rotation runbook](sprint5-s5-a6-incident-rotation-runbook.md) —
  privileged → dependent order; exchange creds rotated **after** the Vault decrypt path; new key
  IP-restricted (A1) **before** enabling; old key disabled at the exchange; secret values never printed.
- **Drill (evidence):** rotate one bot's/user's credential on testnet, prove the others keep working
  and the rotated bot uses the new key — no cross-impact.

## 7. Blast radius
| Event | Shared (current) | Per-user | Per-bot |
|---|---|---|---|
| One key leaked/compromised | **all 5 bots / all funds** on that account | one user's bots | one bot |
| Routine rotation | disrupts **all** bots | one user | one bot |
| Exchange disables the key | **all** bots halt | one user halts | one bot halts |
| Mis-set `exchange_environment` | all bots blocked (fail-closed) | one user blocked | one bot blocked |
| Wrong IP-allowlist on the key | **all** bots locked out | one user | one bot |

→ With real funds, the shared row's "all funds / all bots" column is the unacceptable risk A4 closes.

## 8. Evidence required before real funds (E1 + E2)
- **E2 — isolation:** schema + RLS demonstrate a user/bot can read/use **only** its own
  `user_exchange_credentials` row (a cross-user/cross-bot select returns 0 / is denied).
- **E2 — no shared prod key:** each production bot maps to a credential that is **not** shared across
  users (or a documented, Oren-approved single-operator exception is on record).
- **E1 — rotation drill:** rotate one credential on testnet; the rotated bot uses the new key, the
  others are unaffected (no cross-impact); old key rejected.
- **E2 — Vault-only:** the production key is in Vault; no key value in any DB column, Doppler, log, or
  client response (spot-check).

## 9. Stop conditions
- **No real funds on a shared credential** without an explicit, written Oren exception (single-operator
  scope, documented).
- **No mainnet key created without A1** — the key must be **IP-restricted from creation** (A1 static
  egress first), else it is created unrestricted.
- **No key value ever printed/pasted/stored outside Vault** — names / `vault_secret_id` / status only.
- **No demo/test bot pointing at a mainnet credential** (A12).
- Rotation that can't be proven non-cross-impacting → stay on the current credential; do not rotate
  blindly with real funds.

---

## Readiness assessment (Codex PASS with scoping · 2026-07-05) — read-only discovery
_updated by Codex at Oren request._

**Status:**
- **A4 testnet credential isolation = GO.**
- **A4 real-funds credential isolation = OPEN / NO-GO.**
- **A4 is NOT fully closed.**

**Evidence (code + live DB read-only + deployed bundle):**
- DB stores **`vault_secret_id` only** (001:157/171 — "Vault pointer only"); **raw_key_columns = 0**.
- Decrypt path `get_decrypted_secret(uuid)` (migration 004) reads `vault.decrypted_secrets`; **service_role only**
  (`public=f anon=f auth=f service_role=t`); **anon/auth cannot execute** the decrypt RPC.
- Credential table **not frontend-readable** (`anon_select=f`, `auth_select=f`); **RLS on**.
- `exchange_environment` is **credential-owned / server-side** (wire carries no env; worker resolves it).
- **Live DB: 1 testnet credential (valid), 0 mainnet credentials.**
- **Deployed frontend bundle CLEAN** (`/assets/index-DxkUnjP2.js`): no service_role / exchange keys / webhook token /
  pepper / DSN; only the public `sb_publishable_…` key + `…supabase.co` host. **No browser exchange secrets found.**
- **F-01** documented + implemented (index.ts:748–753, VaultSecretsProvider:54–56): worker resolves
  `credential_id → vault_secret_id`, passes **vault_secret_id** to Vault — never the credentials row id.

**Gaps (real-funds; NOT testnet-blocking):**
- Decrypt **audit missing** (no per-decrypt who/when/result trail).
- **F-01 runtime test missing** (structural/documented only).
- **Revoke/rotation runbook + evidence missing** (manual today).
- **Mainnet credential absent by design** (required for real funds).
- **Railway frontend env-list PENDING operator confirmation** (only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`).

**Hardening slice before real funds (gated, later — not now):**
- **H-A4-1** decrypt audit — every exchange-secret decrypt/use → `audit_logs` {actor, bot_id, credential_id,
  vault_secret_id, purpose, ts, result}, **no secret value**.
- **H-A4-2** F-01 runtime assertion/test — `credential_id → Vault` fails safely; `vault_secret_id` path works.
- **H-A4-3** audited revoke/rotation runbook — old fails · new works · bot disabled during rotation · audit exists.
- **H-A4-4** mainnet credential provisioning — **only after A11 + gates** (A1/A2/A5/A8/A10).
- **+ Railway frontend env-list confirmation** (operator/dashboard).
