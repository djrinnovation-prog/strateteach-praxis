# AUDIT-OPS — Operational Remediation Runbook (audit v3)

Prepared read-only. **Nothing applied/deployed/rotated.** Each action is operator-gated with an exact
approval. Code state (all pushed on `main`): worker/tools/edge/config/deps fixes (`d40c7f8`→`39610f8`),
gated migrations 026–029 (`184c195` + 029 enum fix `da95784`), G-TVR (`7bad8a3`). Real funds: **NO-GO**.

Approval format: **Need Oren: [exact thing]. Why: [why]. I will do: [what]. Risk: [risk].**

---

## Packet 1 — Linked execution: migrations 026–029

**Preconditions (met):** local `supabase db reset` applied 001→029 clean; behavioral SQL tests pass
(`da95784`); 029 enum-cast fix committed. Discipline: apply SURGICALLY (`db query --linked --file`),
NEVER `db push`; separate APPLY from TRACKING; read-back each; each file is begin/commit + pre-guard +
post-verify (self-rolls-back on failure).

### ⚠ BLOCKER to clear FIRST (read-only pre-flight)
Migration **026** creates `credentials_vault_secret_id_live_uidx` — UNIQUE on `vault_secret_id` WHERE
`deleted_at IS NULL`. The Option-1 testnet setup may have **5 live credential rows sharing one Vault
secret** (`2b5c038a…`). If so, **026 fails at index creation** (026's pre-guard only checks *cross-user*
sharing, not same-user duplicate pointers). Must verify before applying 026.

**Pre-flight query (READ-ONLY):**
```sql
-- (a) tracking state: are 026-029 absent from remote?
select version from supabase_migrations.schema_migrations where version in ('026','027','028','029');
-- (b) 026 blocker: any vault_secret_id shared by >1 LIVE credential row?
select vault_secret_id, count(*) live_rows, count(distinct user_id) users
from public.user_exchange_credentials where deleted_at is null
group by vault_secret_id having count(*) > 1;
```
- **If (b) returns rows → STOP.** Options: (i) consolidate the 5 testnet bots onto per-bot DISTINCT Vault
  secrets first (the A4 "never the shortcut" work), or (ii) defer 026's *index* and apply only the
  cross-user *trigger* now (index later, post-A4). Decision needed before 026.
- **If (b) empty → proceed.**

### Execution order (each = one approval)
| Step | Action | Read-back |
|---|---|---|
| A0 | READ-ONLY pre-flight (above) + `supabase migration list --linked` | 026–029 absent; blocker query empty |
| A1 | Manual backup `pg_dump` schema+data → `~/praxis-db-backups/praxis-linked-pre026-<ts>.{schema,data}.sql` (read-only export; Free plan, no PITR) | files written, non-zero size |
| A2 | Apply **026** `db query --linked --file …026….sql` | trigger + partial index present (026 post-verify NOTICE) |
| A3 | Track 026 (metadata-only insert into schema_migrations) | `migration list` 026 Local==Remote |
| A4 | Apply **027** | operator_locked col + trigger + RPC present |
| A5 | Track 027 | Local==Remote |
| A6 | Apply **028** | policies (deleted_at/authenticated) + fn grants present |
| A7 | Track 028 | Local==Remote |
| A8 | Apply **029** (enum-fixed) | `insert_pending_trade_atomic` present |
| A9 | Track 029 | final `migration list` — nothing pending |

**Follow-ups (separate, NOT in these migrations):** (1) wire `operator_kill_all` (019) to also set
`operator_locked=true` — M-2 completeness; (2) worker wiring to call `insert_pending_trade_atomic`
(H-2) — only AFTER 029 is live. Both are code packets, Codex-reviewed, own commits.

---

## Packet 2 — Edge deploy: audit edge fixes

**Scope:** `webhook` (H-4 trusted IP + L-3 payload bounds — `8ff6b8d`) and `admin-rotate-webhook-token`
(M-1/L-9/I-1 — `39610f8`). *(G-TVR `rotate-bot-webhook-token` deploy is the UI thread — adjacent, optional
to bundle.)*

**Preconditions:** `WEBHOOK_SECRET_PEPPER` present in Edge secrets (unchanged); config.toml `verify_jwt`
per function unchanged by these commits.

| Step | Action | Verify |
|---|---|---|
| D1 | `supabase functions deploy webhook` | new version live; a testnet fire still `200`; `webhook_logs` row still written |
| D2 | **H-4 runtime check** — confirm the live Supabase edge sets `x-real-ip` (or the XFF hop count), since the fix uses the right-most/`x-real-ip`, never left-most | a normal TradingView fire is rate-limited under one stable IP bucket, not per-request |
| D3 | `supabase functions deploy admin-rotate-webhook-token` | dry_run returns fingerprints-only by default; cross-owner without override → 403 |

**Risk:** `webhook` is the live TradingView ingress. H-4 changes the IP source; if the live edge's trusted
header differs from the assumption, rate-limit bucketing changes (never fails open in live — `failMode`
forces closed). **Rollback:** redeploy the previous function version. Deploy during a quiet window.

---

## Packet 3 — Rotation: leaked tokens + Vault pointer (H-6 / L-14)

All operator actions; **secret values never seen by Claude.**
| Step | Action | Notes |
|---|---|---|
| R1 | Rotate all **5 per-bot webhook tokens** | use G-TVR (owner UI, after deploy) or `admin-rotate` fallback; treat every doc-exposed token as burned |
| R2 | Rotate the **leaked Vault pointer** `2b5c038a…` | re-store the secret so the pointer changes; the leaked pointer must no longer resolve. Ties into the 026 pre-flight (per-bot distinct secrets) |
| R3 | Operator **IP `87.71.21.23` = burned** | never re-allowlist; use a fresh /32 for M-14 |
| R4 | **MFA** on the operator account | email is leaked (L-14) |
| R5 | **git-history secret scan** (gitleaks/trufflehog) full history | rotate anything found (I-5) |
| R6 | Mechanical **doc scrub** (reviewed batch) | 11 docs project-ref, 22 vault-pointer, 22 bot-uuid — replace with placeholders |

**Sequencing:** R1/R2 are cleaner AFTER Packet 2 (G-TVR/admin-rotate deployed) and interact with the 026
pre-flight (R2 distinct per-bot secrets may be the way to clear the 026 blocker).

---

## Packet 4 — Dashboard config verification (M-13 / M-14)

Committed `config.toml` is necessary-but-not-sufficient — **hosted settings override it.** Operator verifies
(and sets) on the LIVE Supabase dashboard:
| Check | Target |
|---|---|
| Password policy | ≥12 chars + complexity |
| Email confirmation | ON |
| MFA (TOTP) | available; **mandatory for operator** |
| Open signup | gated/invite per product decision |
| DB network restrictions | enabled; allowlist = 3 Railway static-egress /32s + a fresh operator /32 |
| SSL enforcement | ON (verify-full) |

Read-only first (screenshot current state); changes are dashboard actions (approval each).

---

## Packet 5 — Final audit GO / NO-GO checklist

| Gate | State |
|---|---|
| Code fixes (H-1/H-3/H-4/H-5 + Mediums + Lows) | ✅ committed + pushed |
| Migrations 026–029 | ⛔ **not applied** (Packet 1; 026 pre-flight blocker) |
| Edge deploys (webhook/admin-rotate) | ⛔ **not deployed** (Packet 2) |
| Token/pointer rotation | ⛔ **not rotated** (Packet 3) |
| Dashboard config (live) | ⛔ **unverified** (Packet 4) |
| H-2 worker wiring | ⛔ pending (after 029 live) |
| Pre-existing gates A1 / A4 / A11 | ⛔ open |
| **Real funds** | **NO-GO** |

**Close criteria for audit GO (testnet-safe, still not mainnet):** Packets 1+2+4 complete + R1/R2 rotation
done. Mainnet remains behind A1/A4/4A/4C/A11.
