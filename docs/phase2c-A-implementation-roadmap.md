# Phase 2C (Option A) — Money-Pipe Implementation Roadmap

**Goal:** finish connecting the Praxis money pipe **without adding risk — strengthening security** — using
the 3-round-audited Option-A design (`phase2c-identity-provisioning-architecture.md`). StrateTeach's own big
overhaul (auth/RBAC/2FA/DB, possibly adopting shared auth C1) is a **separate future project** and is NOT
touched here.

**Working rule (operator-mandated):** each milestone is DESIGN-audited already; after we IMPLEMENT it, run
**2–3 adversarial CODE audits** (self + independent subagents) before moving on. Nothing armed. Real-funds
NO-GO until the mainnet phase + its gates.

**Security posture:** today the exchange keys live INSIDE StrateTeach (Fernet, 4 stores + the live
`autopilot_live` engine). This roadmap moves keys OUT to Praxis Vault (per-bot isolated, signed webhook)
and then decommissions the legacy key stores — a net security *upgrade*, not just "no new risk."

---

## Phase T — Testnet money pipe (the immediate goal)

### M0 — Pre-code confirmations (no code)
- Confirm StrateTeach Postgres version (for `CREATE OR REPLACE TRIGGER`, PG≥14) and `gen_random_uuid()`
  availability (PG13 core / `pgcrypto`).
- Confirm no signup/admin/import path writes `user_uid` explicitly.
- **Done:** both confirmed in writing.

### M1 — Identity root (design slice S0)
- **Do:** add `user_uid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid()` to StrateTeach `users` + idempotent
  `BEFORE UPDATE` immutability trigger (correct form per M0), single-statement migration (no separate
  backfill).
- **Touches:** StrateTeach `users` table only. No endpoint logic.
- **Done:** every user row has a distinct immutable uid; an `UPDATE user_uid` raises; re-boot is a no-op.
- **Then:** 2–3 code audits (migration idempotency, uniqueness, trigger, no explicit-insert path).

### M2 — Praxis provisioning + the fail-closed guard (design slice S1)
- **Do:** Praxis Edge fn `provision-user` (idempotent: deterministic case-insensitive email + `st_ref` PK +
  `ON CONFLICT`, disabled→403, reconcile-on-dup) + tables `strateteach_user_link`, `provisioning_audit` +
  `verifyTicket` table-driven `provision_user` branch. **Ship the R3-F0 guard:** `connect-credential`
  rejects `env='mainnet'` and `is_active=false` venues.
- **Touches:** Praxis Edge functions + migrations (dormant).
- **Done:** Deno tests green — reconcile/crash/concurrent → one identity, disabled→403, malformed st_ref
  rejected, ownership enforced, and mainnet/inactive-venue connect rejected at the edge.
- **Then:** 2–3 code audits (idempotency races, forgery, the F0 guard).

### M3 — StrateTeach ticket-issuing routes (design slice S2)
- **Do:** StrateTeach migration (`praxis_user_id`, `praxis_env`, `status`) + `st_ref` derived from
  `user_uid` + a small `praxis_provision` router (`/praxis/link`, `/praxis/bot-ticket`,
  `/praxis/credential-ticket`) behind `PRAXIS_PROVISION_ENABLED` (default off) + shared-store rate-limit +
  **gate both `delete_user` sites** on `praxis_user_id IS NULL` (soft path).
- **Touches:** a NEW small StrateTeach router (does NOT touch the 428 existing endpoints) + the users table.
- **Done:** pytest — `praxis_user_id` derived server-side from the session (never the body); env gate;
  idempotent link; a provisioned user's hard-delete is refused.
- **Then:** 2–3 code audits (server-side binding / IDOR, env gate, rate-limit, delete-gate).

### M4 — Status + KILL (design slice S4a)
- **Do:** Praxis `bot-status` (multi-use read token, no jti) + `pause-bot` Edge fns keyed by
  `praxis_user_id` (each with the ownership predicate + drop-the-filter regression test) + a long-lived
  per-bot pause token the user holds (kill works even if StrateTeach is down, INV-8).
- **Touches:** Praxis Edge fns (reuses the `033` `user_pause_own_bot` logic).
- **Done:** a user pauses their own bot with StrateTeach offline; a cross-user status/pause attempt fails.
- **Then:** 2–3 code audits (ownership, read-token replay bound, kill independence, DoS rate-limit).

### M5 — Frontend connect + status/kill (design slice S6, testnet part)
- **Do:** rewire the existing StrateTeach dashboard key/bot forms to the 5-step flow (link → create-bot →
  connect-credential with the key going browser→Praxis only) + status/kill panels + honest degradation of
  the legacy live-read panels.
- **Touches:** the StrateTeach dashboard (React) — the key/bot forms + a status view. Not StrateTeach auth.
- **Done:** a user connects a **testnet** key and self-kills entirely in the UI; the key never transits
  StrateTeach.
- **Then:** 2–3 code audits (no key logged/stored client-side, correct endpoints, error paths).

### M6 — Testnet end-to-end + the $10-style test (validation, not new code)
- **Do:** with a real **testnet** exchange key: connect → signal → Praxis executes on testnet → reconcile →
  kill. (EP6 validate is a dependency for a *tradeable* bot — see M8; for a pure ingress smoke-test the
  webhook→enqueue path is already proven.)
- **Done:** a signed StrateTeach signal drives a Praxis testnet order end-to-end; kill works; reconciliation
  matches.
- **Then:** 2–3 audits of the full e2e run (evidence-graded, like the earlier internal-microorder proof).

## Phase H — Hardening (strengthen security — retire the legacy key custody)

### M7 — Decommission the legacy key stores (design slices S8 parts + §4.10/§4.12)
- **Do:** hard-disable `autopilot_live` execution (the M4a kill-switch already blocks trading by default —
  make it terminal), and **destroy the exchange keys in ALL FOUR legacy stores** (`exchange_config`,
  `autopilot_exchange_keys`, `bots.enc_*`, `exchange_creds_backup.enc_*`) after users re-connect via Praxis.
  Add the venue `is_active` operator step + audit logging (S10) + the GDPR soft-delete state machine.
- **Touches:** StrateTeach services + an inventory/erasure script.
- **Done:** an inventory query returns zero live legacy ciphertext for a re-connected user; StrateTeach holds
  no exchange key anywhere; every privileged event is audit-logged.
- **Then:** 2–3 code audits (no store missed, no orphan, erasure irreversible, audit completeness).

## Phase M — Mainnet (GATED — later; needs the 2 open decisions)

### M8 — Validate + arm (design slices S5/S6)
- Validate is **blocked on EP6** (`validate-credential`, trade-only/withdrawals-off) — build or schedule it;
  arm via an ownership-checked path (mainnet needs a live approval). **Done:** valid→armed only via the
  audited path.

### M9 — Mainnet double-gate (design slice S3) — **needs Open Decision #7**
- Choose the **independent mainnet-approval authority** (operator Supabase session / distinct key / manual
  console — console is strongest) → `mainnet_provision_approvals` (per-bot) + connect-credential gate +
  revoke-on-downgrade + worker-side continuous approval check.

### M10 — Mainnet prerequisites → tiny-live
- Session hardening (D1), audit+alerting live (S10), live-balance subsystem (§4.8b choice), Praxis go-live
  blockers **A1/A4/A11**, then a **tiny-live** pilot ($10 real) — only after independent pentest.

---

## What is OPEN vs CLOSED (honest ledger, post-audits)
- **Testnet path (M0–M6): CLOSED** — 3 design rounds, all BLOCKERs fixed, both pre-code fixes folded in. No
  open design defect. Ready to build.
- **Hardening (M7): design present (§4.10/§4.12); the FOUR-store erasure is the key correctness item.**
- **Mainnet (M8–M10): deferred by design** — depends on Open Decision #7 (independent authority), EP6
  (validate), the live-balance subsystem choice, and Praxis A1/A4/A11. None block testnet.
- **No more DESIGN audits warranted** (converged, diminishing returns). Audits now go on the CODE, per
  milestone (2–3 each).
