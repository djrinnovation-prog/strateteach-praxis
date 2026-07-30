# Phase 2B · M4 — StrateTeach → Praxis credential migration tooling — operator-apply packet

Status: **Ready, MOST-SENSITIVE, OPERATOR-RUN ONLY.** This moves LIVE exchange API keys from
StrateTeach (Fernet-encrypted) into Praxis Vault as per-(user,bot,exchange) credentials
(`status='pending_validation'`). It is a bridge over Praxis's already-reviewed primitives
(`create_vault_secret` migration 031; the `provision-tiny-live.mjs` pattern; EP6 `validate-credential`).

## Absolute rules (do not deviate)
- **Operator runs it. Claude prepared the tooling and NEVER saw, printed, or handled a real key.**
- A plaintext key exists **only in memory** during a single `migrate_one(...)` call, goes **straight to
  Praxis Vault over TLS**, and is **never printed, logged, echoed to a shell, put in an env var, or
  written to disk.** Output is ids + `first8..last8` fingerprints only (validated).
- **One bot at a time**, `--dry-run` first, fail-closed on anything unexpected.
- The migrated credential is **`pending_validation` = inert**: it cannot trade until it is separately
  validated (EP6), promoted (`live-path-promote-credential-packet.md`), and the bot is repointed
  (`live-path-repoint-bot-packet.md`) — each its own gate. So even a completed migration arms nothing.
- **This script simultaneously holds StrateTeach's `SESSION_SECRET` (decrypts keys) and Praxis's
  `service_role` (writes Vault) — the most powerful combination in the system.** Run it in a
  controlled, ephemeral environment, then clear that environment. Migrate → validate → rotate → REVOKE
  the old StrateTeach key at the exchange.

## Pre-requisites
1. Target Praxis bots + `exchanges` rows exist (A4 provisioning); you have the mapping
   `StrateTeach bot → {praxis_user_id, praxis_bot_id, praxis_exchange_id}`.
2. Operator env (never in code): StrateTeach DB + `SESSION_SECRET`; Praxis `SUPABASE_URL` +
   `SERVICE_ROLE_KEY`.
3. `034/037/038` and the C-1 owner-binding trigger (026) applied; single-use index (023) present.

## Step 1 — the migration module `scripts/migrate_credential.py` (VALIDATED; deps-injected)

```python
"""M4: migrate ONE StrateTeach bot's exchange key into Praxis Vault as a per-(user,bot,exchange)
credential (status pending_validation). Operator-run. The plaintext key exists ONLY in memory during
the call, goes straight to Praxis Vault over TLS via create_vault_secret (031), and is NEVER printed,
logged, or written to disk. Output = ids + fingerprints only. Fail-closed; dry_run preflights.

Deps (operator binds to real StrateTeach + Praxis; NO secret in code, and none is ever passed to log):
  get_st_credentials(st_bot_id) -> {"apiKey","apiSecret"}         # StrateTeach: db._bot_creds + decrypt (memory)
  create_vault_secret(secret_json, name, desc) -> vault_secret_id # Praxis 031 RPC (service_role, TLS)
  insert_credential(row) -> credential_id                          # Praxis insert (service_role): pending_validation
  log(obj) -> None                                                 # structured; MUST NOT be handed a secret
"""
import json


def fingerprint(idv):
    return (idv[:8] + ".." + idv[-8:]) if isinstance(idv, str) and len(idv) >= 16 else "********"


def build_secret_json(api_key, api_secret):
    """Vault payload matching Praxis VaultSecretsProvider (parsed.api_key/api_secret). Errors carry NO value."""
    if not api_key or not api_secret:
        raise ValueError("missing_credentials")
    return json.dumps({"api_key": api_key, "api_secret": api_secret})


def migrate_one(deps, spec, dry_run=False):
    """spec = {st_bot_id, praxis_user_id, praxis_bot_id, praxis_exchange_id, label}.
    Returns {dryRun, credentialId?, vaultSecretFp?}. Fail-closed; no secret in any error/log."""
    creds = deps.get_st_credentials(spec["st_bot_id"])          # in memory only
    if not creds or not creds.get("apiKey") or not creds.get("apiSecret"):
        raise ValueError("st_credentials_missing")
    secret_json = build_secret_json(creds["apiKey"], creds["apiSecret"])  # in memory only; NEVER logged
    deps.log({"event": "preflight_ok", "st_bot_id": spec["st_bot_id"],
              "praxis_bot_id": spec["praxis_bot_id"], "keys_present": True})
    if dry_run:
        deps.log({"event": "dry_run_ok", "would_write_vault": True, "would_insert_credential": True})
        return {"dryRun": True}
    vault_secret_id = deps.create_vault_secret(
        secret_json,
        spec["praxis_exchange_id"] + "/" + spec["label"],
        "migrated from StrateTeach; trade-only, withdrawals off (verify via validate-credential)",
    )
    fp = fingerprint(vault_secret_id)
    deps.log({"event": "vault_secret_created", "vault_secret_fp": fp})
    credential_id = deps.insert_credential({
        "user_id": spec["praxis_user_id"],
        "exchange_id": spec["praxis_exchange_id"],
        "vault_secret_id": vault_secret_id,        # server-set pointer (C-1/026 owner-binding trigger)
        "status": "pending_validation",            # NEVER 'valid' here — validation + promotion are separate
        "label": spec["label"],
    })
    if not credential_id:
        raise RuntimeError("credential_insert_failed")
    deps.log({"event": "credential_created", "credential_id": credential_id,
              "vault_secret_fp": fp, "status": "pending_validation"})
    return {"dryRun": False, "credentialId": credential_id, "vaultSecretFp": fp}
```

## Step 2 — bind the deps (operator; the ONLY place secrets are touched)

```python
# StrateTeach side — decrypt in memory; return a dict, never log it.
from app.services.exchange import decrypt          # StrateTeach's Fernet(SESSION_SECRET) decrypt
from app.database import db
def get_st_credentials(st_bot_id):
    cfg = db._bot_creds(db.get_bot(st_bot_id))      # per-bot cfg (apiKeyEnc/apiSecretEnc)
    return {"apiKey": decrypt(cfg["apiKeyEnc"]), "apiSecret": decrypt(cfg["apiSecretEnc"])}

# Praxis side — service_role over TLS. create_vault_secret (031) stores in Vault; the insert sets the
# server-returned pointer. Use supabase-py (service_role) or a raw POST to /rest/v1/rpc/create_vault_secret.
from supabase import create_client
sb = create_client(PRAXIS_URL, PRAXIS_SERVICE_ROLE_KEY)          # service_role — never ships to a browser
def create_vault_secret(secret_json, name, desc):
    return sb.rpc("create_vault_secret", {"new_secret": secret_json, "new_name": name, "new_description": desc}).execute().data
def insert_credential(row):
    return sb.table("user_exchange_credentials").insert(row).execute().data[0]["id"]

def log(o): print(json.dumps(o))                  # structured; migrate_one hands it NO secret
```
(Confirm the `create_vault_secret` argument names against migration 031's signature before running.)

## Step 3 — the migration procedure (per bot, gated)
1. **Dry-run:** `migrate_one(deps, spec, dry_run=True)` → confirms the key decrypts + the mapping is
   right; writes NOTHING.
2. **Migrate:** `migrate_one(deps, spec)` → creates the `pending_validation` credential; record the
   `credentialId` + `vaultSecretFp`.
3. **Validate (EP6):** run `worker/scripts/validate-credential.mjs --credential <id>` from an
   allowlisted egress IP. Binance restrictions are auto-checked; **other venues return
   `restrictions_require_manual_verification` — you must confirm withdrawals-off + IP-restriction at the
   exchange** before promotion. Reject any key that is not trade-only / has withdrawals on.
4. **Promote:** per `live-path-promote-credential-packet.md` (records the evidence_hash, sets
   `status='valid'`). No auto-promote.
5. **Repoint the bot:** per `live-path-repoint-bot-packet.md` — ONLY after A1 (egress) + A4-2 (auth read)
   + A11 + tiny-live gates. Until repointed, the bot does not use the migrated credential.
6. **Disarm the old path:** rotate the Praxis credential if it was ever locally exposed, then **REVOKE
   the old StrateTeach key at the exchange** (not just delete a row) — this is the real disarm that
   ends StrateTeach's ability to trade that account. Do this only after the bot is cut over (M3) and
   proven.

## Step 4 — test (`scripts/tests/test_migrate_credential.py`; VALIDATED, all pass)
Covers: happy path creates a `pending_validation` credential with fingerprint-only output; **no key in
any log / name / insert / return value** (asserts the live-key strings appear nowhere); missing creds
fail-closed BEFORE any Vault write or insert; `dry_run` writes nothing; `build_secret_json` shape +
fail-closed; `fingerprint`.

```python
import json
import migrate_credential as mc
SECRET_KEY, SECRET_SEC = "AKIA_LIVE_SECRET_KEY_VALUE", "s3cr3t_live_secret_value"
SPEC = {"st_bot_id": "st-1", "praxis_user_id": "u-1", "praxis_bot_id": "pb-1", "praxis_exchange_id": "ex-1", "label": "migrated-1"}
class Deps:
    def __init__(self, creds): self.creds=creds; self.logs=[]; self.vault=[]; self.inserts=[]
    def get_st_credentials(self, _): return self.creds
    def create_vault_secret(self, sj, n, d): self.vault.append((sj, n, d)); return "abcd1234-0000-0000-0000-00005678ffff"
    def insert_credential(self, row): self.inserts.append(row); return "cred-9999"
    def log(self, o): self.logs.append(o)
def _no_leak(d):
    blob = json.dumps(d.logs) + json.dumps([[n, dd] for (_, n, dd) in d.vault]) + json.dumps(d.inserts)
    assert SECRET_KEY not in blob and SECRET_SEC not in blob
def test_happy_no_leak():
    d = Deps({"apiKey": SECRET_KEY, "apiSecret": SECRET_SEC})
    r = mc.migrate_one(d, SPEC)
    assert r == {"dryRun": False, "credentialId": "cred-9999", "vaultSecretFp": "abcd1234..5678ffff"}
    assert d.inserts[0]["status"] == "pending_validation"
    assert json.loads(d.vault[0][0]) == {"api_key": SECRET_KEY, "api_secret": SECRET_SEC}   # only inside the Vault payload
    assert SECRET_KEY not in json.dumps(r); _no_leak(d)
def test_missing_fail_closed():
    for creds in ({"apiKey": "", "apiSecret": ""}, None):
        d = Deps(creds)
        try: mc.migrate_one(d, SPEC); assert False
        except ValueError: pass
        assert d.vault == [] and d.inserts == []
def test_dry_run_writes_nothing():
    d = Deps({"apiKey": SECRET_KEY, "apiSecret": SECRET_SEC})
    assert mc.migrate_one(d, SPEC, dry_run=True) == {"dryRun": True}
    assert d.vault == [] and d.inserts == []
def test_helpers():
    assert json.loads(mc.build_secret_json("k", "s")) == {"api_key": "k", "api_secret": "s"}
    try: mc.build_secret_json("", "s"); assert False
    except ValueError: pass
    assert mc.fingerprint("abcd1234-0000-0000-0000-00005678ffff") == "abcd1234..5678ffff"
```

## Idempotency, ownership, rollback
- **Idempotency / ownership:** the single-use index (023) rejects a duplicate `vault_secret_id`; the
  026 trigger binds the pointer to the owning user (a cross-user pointer is rejected). Re-running for a
  bot that already has a valid credential is a no-op-or-error, never a silent second key.
- **Rollback:** a `pending_validation` credential is inert. To undo one: delete the credential row and
  its Vault secret via the 005 delete RPC (`vault_secret_id`), fingerprint-only logs. Nothing was armed,
  so there is nothing to unwind on the exchange.
- **Failure mid-run:** `migrate_one` is fail-closed and does the Vault write before the row insert; if
  the insert fails you have an orphan Vault secret (fingerprint logged) — delete it via the 005 RPC and
  retry. No key is exposed by any failure path.

Real funds NO-GO until the credential is validated + promoted + the bot repointed AND Stage 11/12 of the
go-live runbook pass. Independent agent audits are owed on all M-packets (529-blocked this session).
