# A4 — per-bot Binance mainnet credential runbook (PREPARED, NOT EXECUTED)

**Status:** RUNBOOK / PREP ONLY — **no Binance key is created or entered here**, no Vault write, no secret handled, no bot repointed, no mainnet order, no real funds. Every step that creates/enters a key or writes a secret is an **operator action requiring explicit per-action approval** in the standard format. This document only lays out the exact steps so they can be executed later, fast and safely.

Grounds: `production-a4-mainnet-credentials-plan.md` + `production-a4-implementation-packets.md` (A4-1..A4-7). Unblocked by the **A1 EGRESS-PROOF PASS (2026-07-13)**.

---

## 0. Prerequisite now satisfied — the allowlist targets

A1 EGRESS-PROOF is **green**. The worker (`praxis-platform`, EU West, 1 replica) egresses via a Railway **HA set of 3 SHARED static outbound IPv4**:

```
208.77.244.242
152.55.184.240
152.55.184.241
```

**A Binance mainnet key for this platform MUST be IP-restricted to ALL THREE** — under HA the worker can egress from any of them (proven: this run egressed from `152.55.184.240`). Restricting to only one would break when the worker uses another. "Shared" type = allowlisting these permits *our* key from those IPs; it does not grant any other Railway tenant access to our key.

> These are **shared** egress IPs. That is acceptable for an IP-allowlisted, **trade-only, no-withdrawal** key (the allowlist is one factor among key-secret + signature). If Oren wants dedicated egress IPs instead, that is a Railway plan question — not required for A4, but noted.

---

## 1. Invariants (every per-bot key)

- **One key per `(user, bot, mainnet)`** — never shared across bots (enforced by the 021 ownership FK + 023 single-use index).
- **Permissions:** **Enable Spot & Margin Trading = ON**, **Enable Withdrawals = OFF** (hard — the platform never withdraws), **Enable Futures = OFF** (v1 spot only), **Enable Internal Transfer / Universal Transfer = OFF**.
- **IP access restriction = ON**, allowlist = the **3 IPs above** (exactly).
- **Stored in Supabase Vault only** (service-role provisioning path), referenced by `user_exchange_credentials.vault_secret_id`. **The secret never touches the browser, logs, audit, chat, or this doc.** `vault_secret_id` is sensitive metadata (fingerprint/placeholder only in any evidence).
- **Initial status `pending_validation`**, `exchange_environment='mainnet'`. **Never `valid`** until the promotion step with stored evidence. **The bot is NOT repointed** to the mainnet credential during provisioning (creating the ROW ≠ the bot USING it).

---

## 2. Per-bot steps (exact order; each key = repeat)

**Step A — Create the Binance mainnet API key (OPERATOR, Binance dashboard) — APPROVAL REQUIRED.**
- Label it per-bot (e.g. `praxis-<bot>-mainnet`).
- Set: Spot Trading ON · Withdrawals OFF · Futures OFF · Transfers OFF.
- IP restriction ON → paste exactly: `208.77.244.242, 152.55.184.240, 152.55.184.241`.
- Copy the API key + secret **once** (Binance shows the secret once). **Do not paste them into the browser, chat, or any Praxis UI.** They go only into the Vault-write path (Step B).
- *(This is a Binance account/API-key action — blocked until Oren explicitly approves that exact step.)*

**Step B — Provision into Vault + create the credential row (service-role path, NOT browser) — APPROVAL REQUIRED.**
- Use the reviewed A4 provisioning path (Edge fn / operator-run, service_role) to: write the secret to Vault → get a `vault_secret_id` → insert `user_exchange_credentials { user_id, exchange_id, vault_secret_id, exchange_environment:'mainnet', status:'pending_validation', permissions_confirmed:false, label }`.
- Read-back: the row exists, `status='pending_validation'`, and **no secret value is anywhere in the output** (fingerprint/placeholder only). **The bot's `credential_id` is NOT changed.**
- *(Vault write + linked DB insert — blocked until Oren approves that exact action. The provisioning path itself (G2) must be Codex-reviewed before use.)*

**Step C — Keyless egress re-confirm (already green) — SAFE, no approval.**
- The A1 probe already proved the worker egresses from an allowlisted IP + Binance public reachable. Re-run only if the IPs change (they shouldn't). No key involved.

**Step D — Authenticated read-only validation from the static IP — APPROVAL REQUIRED.**
- A **read-only** `fetchBalance` (or account-info) call using the new key, executed server-side from the worker/static IP, to prove the key works, is correctly IP-allowlisted, and is trade-only. **No order endpoints. No balances printed** (the check records success/failure + a non-secret fingerprint, never amounts).
- On success: capture **stored evidence** (timestamp, non-secret result hash, the egress IP observed) — this is the promotion evidence.
- *(Authenticated Binance call + mainnet credential validation — blocked until Oren approves; also gated on A4-2/A4-3 review.)*

**Step E — Promote `pending_validation → valid` (reviewed mechanism, stored evidence) — APPROVAL REQUIRED.**
- Only with the Step-D stored evidence hash; **no auto-promote**. Sets `status='valid'`, `last_validated_at`, `permissions_confirmed=true`.
- *(Linked DB mutation — blocked until Oren approves the exact action.)*

**Step F — (LATER, separate gate) repoint the bot + tiny-live.**
- The bot's `credential_id` is repointed to the mainnet credential **only after** A1 (done) + A4-2/A4-3 (validation) + **A11** authorization + the tiny-live one-order guard. **Not part of provisioning.** Real funds NO-GO until then.

---

## 3. Rollback

- Step A (key created, not yet used): delete/disable the key in Binance; no platform state changed.
- Step B (row exists, bot not repointed): the credential row is inert (no bot uses it); soft-delete the row + `delete_vault_secret(vault_secret_id)` (service-role, reviewed) — no order was ever possible.
- No repoint means there is no live-trading exposure to roll back at any point in Steps A-E.

## 4. What is blocked on Oren approval (exact actions)

1. **Binance mainnet API key creation** (Step A) — Oren, on the Binance dashboard, with the 3-IP allowlist + trade-only/no-withdrawal.
2. **Vault write + credential-row insert** (Step B) — after the G2 provisioning path is Codex-reviewed.
3. **Authenticated read-only validation** (Step D) — after A4-2/A4-3 review.
4. **Promotion to `valid`** (Step E) — linked DB mutation.
5. **Bot repoint + tiny-live** (Step F) — needs A11.

Nothing above is done in this runbook. **Real funds NO-GO.**

---

## Summary
A1 gave us the exact allowlist targets (`208.77.244.242 / 152.55.184.240 / 152.55.184.241`). This runbook fixes the per-bot key recipe (one key per bot, spot-trade-only, **withdrawals OFF**, IP-restricted to all 3, Vault-stored, `pending_validation`, no repoint) and marks the five approval boundaries. Author the **G2 provisioning path** as its own reviewed packet before Step B is ever executed. No keys, no secrets, no mainnet here.

*Prepared for Codex review at Oren request.*
