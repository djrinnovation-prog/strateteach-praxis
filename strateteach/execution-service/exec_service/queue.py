"""Durable queue (slice 3) — plain Postgres, SKIP LOCKED. TRANSPORT ONLY.

The queue moves signal REFERENCES between ingress and the (future, gated)
worker. It never looks inside a signal, never talks to an exchange, never
reads anything secret — a queue item is (signal_row_id, bot_id) and bookkeeping.

Semantics (the same guarantees pgmq gives, in one reviewable table):

  enqueue   idempotent — one item per signal, ever (UNIQUE signal_row_id).
  dequeue   atomic claim via FOR UPDATE SKIP LOCKED: two workers can never
            hold the same item; claiming marks it 'processing' + who/when.
  ack       done. Terminal.
  nack      failure: attempts+1; below the cap → back to 'queued' with a
            DELAYED visible_at (backoff); at the cap → 'dead' (dead-letter,
            audited, waits for an owner's eyes — never silently dropped).
  sweep     recovery: 'processing' items whose lock went stale (worker died
            mid-item) are nacked by the sweeper so nothing is lost.

§10.3 note: pgmq was the recommended option and stays an easy swap — this
module IS the queue API; nothing else in the service touches exec_queue.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional

from exec_service.audit import record
from exec_service.db import connect

log = logging.getLogger("exec_service.queue")

DEFAULT_VISIBILITY_TIMEOUT_SEC = 120   # a processing lock older than this is "stuck"
DEFAULT_RETRY_DELAY_SEC = 30           # base delay before a failed item is claimable again


@dataclass(frozen=True)
class QueueItem:
    id: int
    signal_row_id: int
    bot_id: int
    attempts: int
    max_attempts: int


def _stale_after() -> int:
    try:
        return max(10, int(os.environ.get("EXEC_QUEUE_VISIBILITY_TIMEOUT_SEC", DEFAULT_VISIBILITY_TIMEOUT_SEC)))
    except ValueError:
        return DEFAULT_VISIBILITY_TIMEOUT_SEC


def enqueue(signal_row_id: int, bot_id: int) -> Optional[int]:
    """Queue one accepted signal. Idempotent: re-enqueueing the same signal is
    a no-op (returns None). Returns the queue item id when a row was created."""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO exec_queue (signal_row_id, bot_id) VALUES (%s, %s) "
                "ON CONFLICT (signal_row_id) DO NOTHING RETURNING id",
                (signal_row_id, bot_id),
            )
            row = cur.fetchone()
            conn.commit()
    if row:
        record(actor="ingress", action="queue.enqueue", entity="exec_queue", entity_id=str(row["id"]),
               meta={"signal_row_id": signal_row_id, "bot_id": bot_id})
        return int(row["id"])
    return None


def dequeue(worker_id: str) -> Optional[QueueItem]:
    """Claim the oldest claimable item, atomically. None = queue is empty.

    SKIP LOCKED means concurrent claimers never block each other and never
    double-claim; the UPDATE and the claim-select are one statement, so a
    crash between them is impossible."""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE exec_queue
                   SET status = 'processing', locked_by = %s, locked_at = NOW(), updated_at = NOW()
                 WHERE id = (
                       SELECT id FROM exec_queue
                        WHERE status = 'queued' AND visible_at <= NOW()
                        ORDER BY id
                        FOR UPDATE SKIP LOCKED
                        LIMIT 1
                 )
                 RETURNING id, signal_row_id, bot_id, attempts, max_attempts
                """,
                (worker_id,),
            )
            row = cur.fetchone()
            conn.commit()
    if not row:
        return None
    return QueueItem(id=int(row["id"]), signal_row_id=int(row["signal_row_id"]),
                     bot_id=int(row["bot_id"]), attempts=int(row["attempts"]),
                     max_attempts=int(row["max_attempts"]))


def ack(item_id: int, worker_id: str) -> bool:
    """Mark a claimed item done. Only its own claimer may ack (a stale worker
    whose item was swept away cannot ack someone else's re-claim)."""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE exec_queue SET status = 'done', updated_at = NOW() "
                "WHERE id = %s AND status = 'processing' AND locked_by = %s RETURNING id",
                (item_id, worker_id),
            )
            ok = cur.fetchone() is not None
            conn.commit()
    if ok:
        record(actor=worker_id, action="queue.ack", entity="exec_queue", entity_id=str(item_id))
    return ok


def nack(item_id: int, worker_id: str, error: str, *, retry_delay_sec: int = DEFAULT_RETRY_DELAY_SEC) -> str:
    """Report a failure. Below the attempt cap → delayed retry; at the cap →
    dead-letter. Returns the resulting status ('queued' | 'dead' | 'noop')."""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE exec_queue
                   SET attempts   = attempts + 1,
                       status     = CASE WHEN attempts + 1 >= max_attempts THEN 'dead' ELSE 'queued' END,
                       visible_at = NOW() + make_interval(secs => %s),
                       locked_by  = NULL, locked_at = NULL,
                       last_error = %s, updated_at = NOW()
                 WHERE id = %s AND status = 'processing' AND locked_by = %s
                 RETURNING status, attempts, max_attempts, signal_row_id
                """,
                (int(retry_delay_sec), (error or "")[:500], item_id, worker_id),
            )
            row = cur.fetchone()
            conn.commit()
    if not row:
        return "noop"
    status = str(row["status"])
    record(actor=worker_id, action="queue.dead" if status == "dead" else "queue.nack",
           entity="exec_queue", entity_id=str(item_id),
           meta={"attempts": int(row["attempts"]), "max": int(row["max_attempts"]),
                 "signal_row_id": int(row["signal_row_id"]), "error": (error or "")[:200]})
    if status == "dead":
        log.error("queue item %s is DEAD after %s attempts: %s", item_id, row["attempts"], error)
    return status


def sweep(*, actor: str = "sweeper") -> int:
    """Recover items stuck in 'processing' past the visibility timeout (their
    worker died mid-item). Each is nacked on the dead worker's behalf: retry
    below the cap, dead-letter at it. Returns how many items were swept."""
    stale = _stale_after()
    swept = 0
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE exec_queue
                   SET attempts   = attempts + 1,
                       status     = CASE WHEN attempts + 1 >= max_attempts THEN 'dead' ELSE 'queued' END,
                       visible_at = NOW(),
                       last_error = COALESCE('swept: stale lock by ' || locked_by, 'swept: stale lock'),
                       locked_by  = NULL, locked_at = NULL, updated_at = NOW()
                 WHERE status = 'processing' AND locked_at < NOW() - make_interval(secs => %s)
                 RETURNING id, status, attempts
                """,
                (stale,),
            )
            rows = cur.fetchall()
            conn.commit()
    for r in rows:
        swept += 1
        record(actor=actor, action="queue.swept", entity="exec_queue", entity_id=str(r["id"]),
               meta={"resulting_status": r["status"], "attempts": int(r["attempts"])})
    if swept:
        log.warning("sweeper recovered %s stuck queue item(s)", swept)
    return swept


def hold_all(*, actor: str = "kill_switch") -> int:
    """Pause the queue (slice 6, kill-switch wiring): every claimable 'queued'
    item becomes 'held' so dequeue skips it. In-flight 'processing' items are
    NOT touched — the worker's own gate re-check turns them into no-ops, and the
    sweeper still recovers a crashed one. Returns how many items were held."""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE exec_queue SET status = 'held', updated_at = NOW() "
                "WHERE status = 'queued' RETURNING id"
            )
            ids = [int(r["id"]) for r in cur.fetchall()]
            conn.commit()
    if ids:
        record(actor=actor, action="queue.hold_all", entity="exec_queue", entity_id="*",
               meta={"held": len(ids)})
    return len(ids)


def release_held(*, actor: str = "kill_switch") -> int:
    """Un-pause: 'held' items become 'queued' again, claimable NOW. This restores
    the queue but does NOT arm execution — the master gate stays closed until an
    owner arms it (spec §0.1). Returns how many items were released."""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE exec_queue SET status = 'queued', visible_at = NOW(), updated_at = NOW() "
                "WHERE status = 'held' RETURNING id"
            )
            ids = [int(r["id"]) for r in cur.fetchall()]
            conn.commit()
    if ids:
        record(actor=actor, action="queue.release_held", entity="exec_queue", entity_id="*",
               meta={"released": len(ids), "note": "release does not arm execution"})
    return len(ids)


def depth() -> dict:
    """Queue counters for the status view. Read-only."""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT status, COUNT(*) AS n FROM exec_queue GROUP BY status")
            counts = {r["status"]: int(r["n"]) for r in cur.fetchall()}
    return {s: counts.get(s, 0) for s in ("queued", "processing", "held", "done", "dead")}
