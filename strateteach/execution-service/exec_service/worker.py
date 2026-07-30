"""Worker SKELETON (slice 4) — gate → caps → adapter, everything fail-closed.

`process_one()` handles exactly one queue item:

    dequeue → load signal + bot → GATE (4-way AND, re-read NOW) →
    per-bot trading_enabled → sizing/caps (server-side, from config) →
    idempotency (one order per signal, ever) → adapter → record + audit

Safety posture, in code and not in comments only:

* **The gate is re-checked at processing time.** An item that was queued while
  armed but processed after a disarm becomes a `noop_disarmed` ORDER ROW with
  an audit line — spec §4: disarmed means every execution is a no-op, loudly.
* **There is NO default adapter.** `adapter=None` refuses to execute even with
  the gate armed — one more AND. The only adapter that exists today is the
  MOCK (synthetic fills, zero network); a real one is a later, reviewed slice.
* **Caps are decided by pure code** (`sizing.decide`) fed with usage read from
  `exec_orders`. A violation is a REJECTED order row (audited), acked — a cap
  breach will not heal by retrying.
* **Idempotency at the database**: `client_order_id = sig-<signal_row_id>` is
  UNIQUE — a crashed-and-retried item can never place a second order for the
  same signal.
* No keys anywhere. The vault arrives in slice 5; this file must not change
  when it does — the adapter owns that boundary.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

from exec_service.audit import record
from exec_service.db import connect
from exec_service.queue import QueueItem, ack, dequeue, nack
from exec_service.sizing import decide
from exec_service.state import heartbeat, read_gate
from exec_service.vault import resolve

log = logging.getLogger("exec_service.worker")


@dataclass(frozen=True)
class ProcessResult:
    outcome: str           # idle | noop_disarmed | rejected | duplicate | filled_mock | failed
    detail: str = ""
    order_id: Optional[int] = None
    queue_item_id: Optional[int] = None


def _load_context(item: QueueItem) -> Optional[dict]:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id AS signal_row_id, s.action, s.signal_id,
                       b.id AS bot_id, b.name, b.exchange, b.pair, b.env, b.trading_enabled,
                       b.fixed_notional, b.max_order_notional, b.daily_notional_cap, b.max_open_positions
                  FROM exec_signals s JOIN exec_bots b ON b.id = s.bot_id
                 WHERE s.id = %s
                """,
                (item.signal_row_id,),
            )
            return cur.fetchone()


def _active_credential_ref(bot: dict) -> Optional[tuple[str, str]]:
    """The vault REF (not the secret) + its env for this bot's exchange, if an
    ACTIVE credential is registered. Returns (vault_ref, env) or None. This
    reads a POINTER only — exec_credentials has no secret column by design."""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT vault_ref, env FROM exec_credentials "
                "WHERE exchange = %s AND env = %s AND status = 'active' "
                "ORDER BY id DESC LIMIT 1",
                (bot["exchange"], bot["env"]),
            )
            row = cur.fetchone()
    return (row["vault_ref"], row["env"]) if row else None


def _usage(bot_id: int) -> tuple[float, int]:
    """Today's used notional + currently-open orders, from exec_orders.
    Skeleton definition (real reconciliation is slice 6): used = every order
    today that isn't a no-op/rejection; open = orders not yet terminal."""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COALESCE(SUM(requested_notional) FILTER (
                           WHERE created_at::date = NOW()::date
                             AND status NOT IN ('rejected', 'noop_disarmed', 'cancelled', 'failed')), 0) AS used_today,
                       COUNT(*) FILTER (
                           WHERE status IN ('pending', 'submitted', 'partially_filled')) AS open_now
                  FROM exec_orders WHERE bot_id = %s
                """,
                (bot_id,),
            )
            row = cur.fetchone()
    return float(row["used_today"] or 0), int(row["open_now"] or 0)


def _write_order(ctx: dict, status: str, *, notional: float, price: Optional[float] = None,
                 qty: Optional[float] = None, exchange_order_id: Optional[str] = None,
                 error: Optional[str] = None, fills: Optional[list] = None) -> Optional[int]:
    """One exec_orders row. client_order_id is sig-<signal_row_id> — UNIQUE, so
    a duplicate write answers None instead of a second order."""
    from psycopg.types.json import Json

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO exec_orders
                       (bot_id, signal_row_id, client_order_id, exchange_order_id, side, symbol,
                        requested_qty, requested_notional, executed_qty, avg_fill_price, fills, status, error)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (client_order_id) DO NOTHING
                RETURNING id
                """,
                (ctx["bot_id"], ctx["signal_row_id"], f"sig-{ctx['signal_row_id']}", exchange_order_id,
                 ctx["action"], ctx["pair"],
                 qty if qty is not None else 0, notional,
                 qty if (qty is not None and status == "filled") else 0,
                 price, Json(fills or []), status, error),
            )
            row = cur.fetchone()
            conn.commit()
    return int(row["id"]) if row else None


def process_one(worker_id: str, adapter: Any = None, *, vault_backend: Any = None) -> ProcessResult:
    """Process a single queue item. Returns an honest outcome; raises only on
    infrastructure failure mid-flight (the item's visibility timeout + the
    sweeper guarantee it is retried or dead-lettered, never lost).

    `vault_backend` (slice 5): when the adapter NEEDS credentials, the worker
    resolves the bot's vault_ref → creds through this backend just before the
    adapter call, and hands the creds straight in. They are never stored,
    logged, or audited (only the ref + the fact of a fetch is). The mock
    adapter needs nothing, so a resolve is only attempted for a real one."""
    heartbeat(worker_id)
    item = dequeue(worker_id)
    if item is None:
        return ProcessResult(outcome="idle", detail="queue empty")

    try:
        ctx = _load_context(item)
        if not ctx:
            nack(item.id, worker_id, "signal/bot rows missing")
            return ProcessResult(outcome="failed", detail="context missing", queue_item_id=item.id)

        # THE GATE — re-read now, not trusted from enqueue time. Plus the two
        # extra ANDs of this slice: a per-bot switch and an explicit adapter.
        gate = read_gate()
        if not gate.armed or not bool(ctx["trading_enabled"]) or adapter is None:
            why = gate.reason if not gate.armed else (
                "bot trading_enabled=false" if not bool(ctx["trading_enabled"]) else "no adapter wired")
            oid = _write_order(ctx, "noop_disarmed", notional=float(ctx["fixed_notional"]), error=why)
            ack(item.id, worker_id)
            record(actor=worker_id, action="order.noop_disarmed", entity="exec_orders",
                   entity_id=str(oid or f"sig-{ctx['signal_row_id']}"), meta={"why": why})
            return ProcessResult(outcome="noop_disarmed", detail=why, order_id=oid, queue_item_id=item.id)

        # CAPS — pure decision over config + live usage. Violation = terminal.
        used_today, open_now = _usage(int(ctx["bot_id"]))
        decision = decide(ctx, used_today_notional=used_today, open_positions=open_now)
        if not decision.ok:
            oid = _write_order(ctx, "rejected", notional=float(ctx["fixed_notional"]), error=f"{decision.reason}: {decision.detail}")
            ack(item.id, worker_id)
            record(actor=worker_id, action="order.rejected", entity="exec_orders",
                   entity_id=str(oid or f"sig-{ctx['signal_row_id']}"),
                   meta={"reason": decision.reason, "detail": decision.detail})
            return ProcessResult(outcome="rejected", detail=decision.reason, order_id=oid, queue_item_id=item.id)

        # CREDENTIALS (slice 5) — only for an adapter that NEEDS them. The mock
        # doesn't, so the resolve path is skipped for it. For a real adapter,
        # the vault_ref (a POINTER read from exec_credentials) is resolved to
        # in-memory creds here and handed straight to the call below; no secret
        # is stored, logged, or audited. Missing vault/creds for a real adapter
        # = fail-closed (raises → the item is retried, never a keyless order).
        creds = None
        if getattr(adapter, "needs_credentials", False):
            ref_env = _active_credential_ref(ctx)
            if not ref_env:
                nack(item.id, worker_id, "no active credential registered for this exchange/env")
                return ProcessResult(outcome="failed", detail="no credential ref", queue_item_id=item.id)
            vault_ref, cred_env = ref_env
            creds = resolve(vault_backend, ref=vault_ref, credential_env=cred_env)
            record(actor=worker_id, action="credential.resolved", entity="exec_credentials",
                   entity_id=vault_ref, meta={"env": cred_env})  # the REF, never the secret

        # ADAPTER — today only the mock exists (synthetic fill, zero network).
        client_order_id = f"sig-{ctx['signal_row_id']}"
        fill = adapter.submit_intent(side=str(ctx["action"]), symbol=str(ctx["pair"]),
                                     notional=decision.notional, client_order_id=client_order_id, creds=creds)
        oid = _write_order(ctx, "filled", notional=decision.notional, price=fill.price, qty=fill.qty,
                           exchange_order_id=fill.exchange_order_id,
                           fills=[{"price": fill.price, "qty": fill.qty, "mock": bool(getattr(fill, "mock", False))}])
        if oid is None:
            # UNIQUE said: an order for this signal already exists — a crashed
            # retry. The signal is DONE; nothing was placed twice.
            ack(item.id, worker_id)
            record(actor=worker_id, action="order.duplicate_skip", entity="exec_orders",
                   entity_id=client_order_id, meta={"signal_row_id": ctx["signal_row_id"]})
            return ProcessResult(outcome="duplicate", detail="order already recorded for this signal", queue_item_id=item.id)

        ack(item.id, worker_id)
        record(actor=worker_id, action="order.filled_mock" if getattr(fill, "mock", False) else "order.filled",
               entity="exec_orders", entity_id=str(oid),
               after={"status": "filled", "notional": decision.notional, "price": fill.price},
               meta={"adapter": getattr(adapter, "name", "?"), "mock": bool(getattr(fill, "mock", False))})
        return ProcessResult(outcome="filled_mock" if getattr(fill, "mock", False) else "filled",
                             order_id=oid, queue_item_id=item.id)

    except Exception as e:  # noqa: BLE001 — mid-flight infra failure → retry via nack
        log.exception("worker %s failed on item %s", worker_id, item.id)
        nack(item.id, worker_id, str(e)[:300])
        return ProcessResult(outcome="failed", detail=str(e)[:200], queue_item_id=item.id)


def run(worker_id: str, adapter: Any = None, *, vault_backend: Any = None, max_iterations: int = 100) -> list[ProcessResult]:
    """A bounded skeleton loop for tests/tools: process until idle or the
    iteration cap. There is deliberately NO unbounded daemon entry point in
    this slice — deploying a worker process is a later, explicit step."""
    out: list[ProcessResult] = []
    for _ in range(max(1, int(max_iterations))):
        res = process_one(worker_id, adapter, vault_backend=vault_backend)
        out.append(res)
        if res.outcome == "idle":
            break
    return out
