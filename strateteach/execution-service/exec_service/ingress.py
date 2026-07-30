"""Signal INGRESS (spec §3) — verify, classify, RECORD. Nothing executes.

The pipeline for one inbound intent:

    structure → signature (constant-time) → freshness → bot lookup →
    per-bot rate-limit → dedup INSERT → gate classification → audit

Everything lands in ``exec_signals`` with an honest status:

    accepted        gate armed (impossible in Phase 1 — it never is)
    noop_disarmed   valid signal, gate disarmed → recorded, goes nowhere
    duplicate       same (bot, signal_id) already recorded (DB UNIQUE)
    rejected        contract violation / unknown bot / rate-limited
    expired         stale or future-dated

There is no queue and no worker in this slice: a VALID signal is a ROW, full
stop. The (future) transport layer maps every business outcome above to a
uniform 200 (spec §3: no structure leak); infrastructure failure raises so the
transport answers 5xx before anything was written.

Secrets: the signing secret is read from ``EXEC_SIGNAL_HMAC_SECRET`` per call,
never cached, never logged, never written anywhere. No secret → every signal
is rejected (fail-closed). This is a WEBHOOK-SIGNING secret — exchange keys do
not exist anywhere in this service (vault refs only, slice 5+).
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Mapping, Optional

from exec_service.audit import record
from exec_service.db import connect
from exec_service.envelope import (
    ContractError,
    check_freshness,
    validate_structure,
    verify_signature,
)
from exec_service.state import read_gate

log = logging.getLogger("exec_service.ingress")

# Per-bot rate limit (spec §3): max signals RECORDED per rolling window.
DEFAULT_RATE_LIMIT = 10
DEFAULT_RATE_WINDOW_SEC = 60


@dataclass(frozen=True)
class IngestResult:
    """One business outcome. `status` mirrors the exec_signals CHECK statuses."""

    status: str            # accepted | noop_disarmed | duplicate | rejected | expired
    reason: str            # stable slug ('ok', 'bad_signature', 'rate_limited', …)
    detail: str = ""
    signal_row_id: Optional[int] = None


def _rate_limit() -> int:
    try:
        return max(1, int(os.environ.get("EXEC_SIGNAL_RATE_LIMIT", DEFAULT_RATE_LIMIT)))
    except ValueError:
        return DEFAULT_RATE_LIMIT


def _rate_window() -> int:
    try:
        return max(1, int(os.environ.get("EXEC_SIGNAL_RATE_WINDOW_SEC", DEFAULT_RATE_WINDOW_SEC)))
    except ValueError:
        return DEFAULT_RATE_WINDOW_SEC


def ingest(payload: Mapping[str, Any], provided_signature: Optional[str], *, now_ts: Optional[int] = None) -> IngestResult:
    """Take one inbound signal payload + its signature, return the outcome.

    Raises ONLY on infrastructure failure (DB unreachable mid-write) — the
    transport layer turns that into a 5xx so the sender retries. Every
    CONTRACT outcome returns an IngestResult, and every outcome that names a
    real bot is audited.
    """
    now = int(now_ts if now_ts is not None else time.time())

    # 1-3 · contract: structure, signature (constant-time), freshness.
    #      Signature is verified BEFORE any database work: an unsigned payload
    #      must not be able to make this service touch its storage.
    try:
        validate_structure(payload)
        secret = os.environ.get("EXEC_SIGNAL_HMAC_SECRET") or ""
        verify_signature(secret, payload, provided_signature)
        check_freshness(payload, now_ts=now)
    except ContractError as e:
        status = "expired" if e.reason == "expired" else "rejected"
        # Unsigned/malformed traffic is logged (no payload echo — no oracle,
        # no junk amplification) but NOT audited per-row: the audit trail is
        # for actions on real entities, not for internet noise.
        log.warning("signal %s: %s", status, e.reason)
        return IngestResult(status=status, reason=e.reason, detail=e.detail)

    bot_name = str(payload["bot"]).strip()
    signal_id = str(payload["signal_id"]).strip()
    action = str(payload["action"]).strip().lower()
    fire_time = payload.get("fire_time")

    with connect() as conn:
        with conn.cursor() as cur:
            # 4 · the bot must exist (and is testnet by schema CHECK). Unknown
            #     bot = rejection with NO row (there is no bot_id to attach).
            cur.execute("SELECT id, trading_enabled FROM exec_bots WHERE name = %s", (bot_name,))
            bot = cur.fetchone()
            if not bot:
                log.warning("signal rejected: unknown bot %r", bot_name)
                return IngestResult(status="rejected", reason="unknown_bot", detail=f"no bot named {bot_name!r}")
            bot_id = int(bot["id"])

            # 5 · per-bot rate limit over a rolling window (counts every row we
            #     recorded for this bot, whatever its status — a flood of
            #     duplicates is still a flood).
            cur.execute(
                "SELECT COUNT(*) AS n FROM exec_signals "
                "WHERE bot_id = %s AND received_at > NOW() - make_interval(secs => %s)",
                (bot_id, _rate_window()),
            )
            if int(cur.fetchone()["n"]) >= _rate_limit():
                record(actor="ingress", action="signal.rate_limited", entity="exec_bots", entity_id=str(bot_id),
                       meta={"signal_id": signal_id})
                return IngestResult(status="rejected", reason="rate_limited",
                                    detail=f"bot {bot_name!r} exceeded {_rate_limit()}/{_rate_window()}s")

            # 6 · classification: the gate is read AFTER validation so the row
            #     records the truth at arrival. Disarmed (always, in Phase 1)
            #     → the signal is a RECORD, not an instruction.
            armed = read_gate().armed
            status = "accepted" if armed else "noop_disarmed"

            # 7 · dedup is the DB's UNIQUE, not an app-side SELECT: two
            #     concurrent deliveries cannot both insert.
            cur.execute(
                "INSERT INTO exec_signals (bot_id, signal_id, action, fire_time, status) "
                "VALUES (%s, %s, %s, %s, %s) "
                "ON CONFLICT (bot_id, signal_id) DO NOTHING RETURNING id",
                (bot_id, signal_id, action, fire_time, status),
            )
            row = cur.fetchone()
            conn.commit()

    if row is None:
        record(actor="ingress", action="signal.duplicate", entity="exec_signals", entity_id=signal_id,
               meta={"bot_id": bot_id})
        return IngestResult(status="duplicate", reason="duplicate",
                            detail=f"signal {signal_id!r} already recorded for bot {bot_name!r}")

    record(actor="ingress", action="signal.recorded", entity="exec_signals", entity_id=str(row["id"]),
           after={"status": status, "action": action, "bot_id": bot_id},
           meta={"signal_id": signal_id, "armed": armed})

    # 8 · slice 3: only an ACCEPTED signal (gate armed — never, in Phase 1)
    #     enters the durable queue. A noop_disarmed signal is a record, not
    #     work; queueing it would hand the future worker a backlog of stale
    #     intents the moment someone arms the gate. Import here (not module
    #     top) keeps the contract tests import-light.
    if status == "accepted":
        from exec_service.queue import enqueue
        enqueue(int(row["id"]), bot_id)

    return IngestResult(status=status, reason="ok", signal_row_id=int(row["id"]))
