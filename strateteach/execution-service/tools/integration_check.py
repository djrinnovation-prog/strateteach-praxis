"""Integration check against a REAL Postgres — slices 1+2, end to end.

Run from execution-service/ with a DISPOSABLE local database:

    EXEC_DATABASE_URL=postgresql://exec:exec@localhost:55432/strateteach_exec \
        python tools/integration_check.py

What it proves (each line prints ✓/✗ and the script exits non-zero on any ✗):

  schema     migrations 001-003 apply cleanly; re-apply is a no-op
  gate       the effective gate reads DISARMED on a fresh, seeded database
  mainnet    a mainnet bot is rejected by the phase-1 CHECK
  ingress    valid signed signal → noop_disarmed row; duplicate → duplicate;
             unknown bot / bad signature / stale → rejected|expired (no row);
             per-bot rate-limit kicks in
  3-of-3     the SAME owner three times is rejected by the DB (003);
             three DISTINCT owners pass
  audit      rows were written; UPDATE on audit_log is rejected by trigger

Test data only — a throwaway bot, a fake webhook secret, zero keys, zero money.
"""
from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

FAILS: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    mark = "✓" if ok else "✗"
    print(f"  {mark} {name}" + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        FAILS.append(name)


def main() -> int:
    if not os.environ.get("EXEC_DATABASE_URL"):
        print("EXEC_DATABASE_URL is not set — refusing (this script needs a disposable local DB).")
        return 2
    os.environ.setdefault("ENVIRONMENT", "testnet")
    os.environ["EXEC_SIGNAL_HMAC_SECRET"] = "integration-test-secret"  # webhook-signing secret, test-only
    os.environ["EXEC_SIGNAL_RATE_LIMIT"] = "5"
    os.environ["EXEC_SIGNAL_RATE_WINDOW_SEC"] = "60"

    from psycopg.types.json import Json

    from exec_service import migrate
    from exec_service.db import connect
    from exec_service.envelope import compute_signature
    from exec_service.ingress import ingest
    from exec_service.state import read_gate

    print("== schema ==")
    applied = migrate.migrate()
    check("migrations apply", True)
    check("re-apply is a no-op", migrate.migrate() == [])

    print("== gate ==")
    gate = read_gate()
    check("effective gate DISARMED", gate.armed is False, gate.reason)
    check("kill-switch engaged by default", gate.kill_switch is True)

    print("== mainnet blocked at the schema ==")
    try:
        with connect() as conn:
            conn.execute(
                "INSERT INTO exec_bots (name, exchange, pair, env, fixed_notional, max_order_notional, daily_notional_cap) "
                "VALUES ('itest-mainnet', 'bybit', 'BTC/USDT', 'mainnet', 10, 20, 100)"
            )
        check("mainnet bot rejected", False, "INSERT unexpectedly succeeded")
    except Exception:
        check("mainnet bot rejected", True)

    print("== ingress (slice 2) ==")
    with connect() as conn:
        conn.execute(
            "INSERT INTO exec_bots (name, exchange, pair, fixed_notional, max_order_notional, daily_notional_cap) "
            "VALUES ('itest-bot', 'bybit', 'BTC/USDT', 10, 20, 100) ON CONFLICT (name) DO NOTHING"
        )
        conn.execute("DELETE FROM exec_signals WHERE bot_id = (SELECT id FROM exec_bots WHERE name='itest-bot')")
        conn.commit()

    secret = os.environ["EXEC_SIGNAL_HMAC_SECRET"]
    now = int(time.time())
    p = {"bot": "itest-bot", "signal_id": f"it-{now}", "action": "buy", "ts": now}
    r = ingest(p, compute_signature(secret, p))
    check("valid signal → noop_disarmed", r.status == "noop_disarmed" and r.signal_row_id, f"{r.status}/{r.reason}")
    r2 = ingest(p, compute_signature(secret, p))
    check("same signal again → duplicate", r2.status == "duplicate", f"{r2.status}/{r2.reason}")
    r3 = ingest({**p, "bot": "no-such-bot"}, compute_signature(secret, {**p, "bot": "no-such-bot"}))
    check("unknown bot → rejected", r3.status == "rejected" and r3.reason == "unknown_bot", f"{r3.status}/{r3.reason}")
    r4 = ingest(p, "deadbeef")
    check("bad signature → rejected", r4.status == "rejected" and r4.reason == "bad_signature", f"{r4.status}/{r4.reason}")
    stale = {**p, "signal_id": f"it-stale-{now}", "ts": now - 3600}
    r5 = ingest(stale, compute_signature(secret, stale))
    check("stale → expired", r5.status == "expired", f"{r5.status}/{r5.reason}")

    hit_limit = False
    for i in range(8):
        q = {"bot": "itest-bot", "signal_id": f"it-flood-{now}-{i}", "action": "sell", "ts": int(time.time())}
        rr = ingest(q, compute_signature(secret, q))
        if rr.reason == "rate_limited":
            hit_limit = True
            break
    check("per-bot rate-limit kicks in", hit_limit)

    print("== 3-of-3 distinct (003) ==")
    same = [{"owner": "dan", "at": "t1"}, {"owner": "dan", "at": "t2"}, {"owner": "DAN ", "at": "t3"}]
    try:
        with connect() as conn:
            conn.execute(
                "INSERT INTO owner_approvals (request_ref, action, requested_by, approvals, status) "
                "VALUES (%s, 'itest', 'dan', %s, 'approved')",
                (f"it-same-{now}", Json(same)),
            )
        check("same owner ×3 rejected by DB", False, "INSERT unexpectedly succeeded")
    except Exception:
        check("same owner ×3 rejected by DB", True)
    distinct = [{"owner": "dan", "at": "t1"}, {"owner": "rafi", "at": "t2"}, {"owner": "yoav", "at": "t3"}]
    try:
        with connect() as conn:
            conn.execute(
                "INSERT INTO owner_approvals (request_ref, action, requested_by, approvals, status) "
                "VALUES (%s, 'itest', 'dan', %s, 'approved')",
                (f"it-distinct-{now}", Json(distinct)),
            )
        check("three distinct owners accepted", True)
    except Exception as e:
        check("three distinct owners accepted", False, str(e)[:120])

    print("== durable queue (slice 3) ==")
    os.environ["EXEC_QUEUE_VISIBILITY_TIMEOUT_SEC"] = "10"
    from exec_service import queue as q

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM exec_queue")
            # two fresh signal rows to queue
            cur.execute("SELECT id FROM exec_bots WHERE name='itest-bot'")
            bid = int(cur.fetchone()["id"])
            cur.execute(
                "INSERT INTO exec_signals (bot_id, signal_id, action, status) VALUES "
                "(%s, %s, 'buy', 'accepted'), (%s, %s, 'sell', 'accepted') RETURNING id",
                (bid, f"q-{now}-a", bid, f"q-{now}-b"),
            )
            ids = [int(r["id"]) for r in cur.fetchall()]
            conn.commit()

    i1 = q.enqueue(ids[0], bid)
    check("enqueue creates an item", bool(i1))
    check("re-enqueue is a no-op (idempotent)", q.enqueue(ids[0], bid) is None)
    q.enqueue(ids[1], bid)

    a = q.dequeue("worker-A")
    b = q.dequeue("worker-B")
    check("two claimers get two DIFFERENT items", bool(a and b) and a.id != b.id,
          f"a={a and a.id} b={b and b.id}")
    check("empty queue → None", q.dequeue("worker-C") is None)

    check("ack by the claimer works", q.ack(a.id, "worker-A") is True)
    check("ack by a NON-claimer is refused", q.ack(b.id, "worker-A") is False)

    st = q.nack(b.id, "worker-B", "simulated failure", retry_delay_sec=0)
    check("nack below cap → queued (retry)", st == "queued", st)
    reclaimed = q.dequeue("worker-B")
    check("failed item is claimable again", bool(reclaimed) and reclaimed.id == b.id)
    # exhaust attempts → dead-letter
    status_now = "queued"
    for _ in range(10):
        if not reclaimed:
            break
        status_now = q.nack(reclaimed.id, "worker-B", "still failing", retry_delay_sec=0)
        if status_now == "dead":
            break
        reclaimed = q.dequeue("worker-B")
    check("attempt cap → dead-letter (never silent loss)", status_now == "dead", status_now)

    # sweeper: stuck 'processing' items are recovered
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM exec_queue")
            cur.execute(
                "INSERT INTO exec_signals (bot_id, signal_id, action, status) VALUES (%s, %s, 'buy', 'accepted') RETURNING id",
                (bid, f"q-{now}-c",),
            )
            sid = int(cur.fetchone()["id"])
            conn.commit()
    q.enqueue(sid, bid)
    stuck = q.dequeue("worker-crashed")
    with connect() as conn:  # age the lock past the (10s) visibility timeout
        conn.execute("UPDATE exec_queue SET locked_at = NOW() - INTERVAL '1 hour' WHERE id = %s", (stuck.id,))
        conn.commit()
    check("sweeper recovers a stuck item", q.sweep() == 1)
    check("swept item is claimable again", bool(q.dequeue("worker-D")))
    d = q.depth()
    check("depth counters answer", isinstance(d, dict) and set(d) == {"queued", "processing", "held", "done", "dead"})

    print("== worker skeleton (slice 4) — mock adapter, throwaway DB only ==")
    # NOTE: this section SIMULATES arming on the disposable local database with
    # the MOCK adapter (synthetic fills, zero network, zero keys). Production
    # arming remains an explicit owner act; the script re-disarms and verifies
    # DISARMED at the end.
    from exec_service.mock_exchange import MockExchange
    from exec_service.state import engage_kill_switch
    from exec_service import worker as w

    def _seed_signal(cur, bid_, sid_):
        cur.execute(
            "INSERT INTO exec_signals (bot_id, signal_id, action, status) VALUES (%s, %s, 'buy', 'accepted') RETURNING id",
            (bid_, sid_),
        )
        return int(cur.fetchone()["id"])

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM exec_queue"); cur.execute("DELETE FROM exec_orders")
            cur.execute(
                "INSERT INTO exec_bots (name, exchange, pair, fixed_notional, max_order_notional, daily_notional_cap, max_open_positions) "
                "VALUES ('itest-caps-bot', 'mock', 'BTC/USDT', 10, 20, 25, 1) ON CONFLICT (name) DO NOTHING"
            )
            cur.execute("SELECT id FROM exec_bots WHERE name='itest-caps-bot'")
            cbid = int(cur.fetchone()["id"])
            s_dis = _seed_signal(cur, cbid, f"w-{now}-disarmed")
            conn.commit()

    q.enqueue(s_dis, cbid)
    res = w.process_one("itest-worker", MockExchange())
    check("DISARMED → worker writes a noop_disarmed order", res.outcome == "noop_disarmed", res.outcome)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS n FROM exec_orders WHERE status='filled'")
            check("nothing filled while disarmed", int(cur.fetchone()["n"]) == 0)

    # ── simulated ARM on the throwaway DB (all four ANDs, test-only) ──
    os.environ["EXECUTION_ARMED"] = "true"
    with connect() as conn:
        conn.execute("UPDATE exec_state SET execution_armed=TRUE, kill_switch=FALSE WHERE id=1")
        conn.execute("UPDATE exec_bots SET trading_enabled=TRUE WHERE name='itest-caps-bot'")
        conn.commit()
    check("gate reads ARMED in the simulation", read_gate().armed is True, read_gate().reason)

    with connect() as conn:  # armed + NO adapter → still refuses (one more AND)
        with conn.cursor() as cur:
            s_na = _seed_signal(cur, cbid, f"w-{now}-noadapter")
            conn.commit()
    q.enqueue(s_na, cbid)
    rna = w.process_one("itest-worker", None)
    check("armed + NO adapter still refuses", rna.outcome == "noop_disarmed", rna.outcome)

    with connect() as conn:
        with conn.cursor() as cur:
            s1 = _seed_signal(cur, cbid, f"w-{now}-1"); s2 = _seed_signal(cur, cbid, f"w-{now}-2"); s3 = _seed_signal(cur, cbid, f"w-{now}-3")
            conn.commit()
    q.enqueue(s1, cbid)
    r1 = w.process_one("itest-worker", MockExchange())
    check("armed → mock fill (clearly marked MOCK)", r1.outcome == "filled_mock", r1.outcome)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT exchange_order_id FROM exec_orders WHERE id=%s", (r1.order_id,))
            check("mock order id is unmistakable", str(cur.fetchone()["exchange_order_id"]).startswith("MOCK-"))

    q.enqueue(s2, cbid)
    r2 = w.process_one("itest-worker", MockExchange())
    check("second order fills (10+10=20 ≤ daily 25)", r2.outcome == "filled_mock", r2.outcome)
    q.enqueue(s3, cbid)
    r3 = w.process_one("itest-worker", MockExchange())
    check("third order hits the DAILY CAP (20+10>25)", r3.outcome == "rejected" and r3.detail == "daily_cap", f"{r3.outcome}/{r3.detail}")

    with connect() as conn:  # an open (submitted) order → max_open_positions=1 blocks the next
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO exec_orders (bot_id, client_order_id, side, symbol, requested_qty, requested_notional, status) "
                "VALUES (%s, %s, 'buy', 'BTC/USDT', 0.01, 1, 'submitted')", (cbid, f"manual-open-{now}"))
            cur.execute("UPDATE exec_bots SET daily_notional_cap=1000 WHERE id=%s", (cbid,))
            s4 = _seed_signal(cur, cbid, f"w-{now}-4")
            conn.commit()
    q.enqueue(s4, cbid)
    r4 = w.process_one("itest-worker", MockExchange())
    check("open position → MAX_POSITIONS rejects", r4.outcome == "rejected" and r4.detail == "max_positions", f"{r4.outcome}/{r4.detail}")

    with connect() as conn:  # idempotency: an order already exists for this signal
        with conn.cursor() as cur:
            cur.execute("DELETE FROM exec_orders WHERE client_order_id LIKE 'manual-open-%'")
            s5 = _seed_signal(cur, cbid, f"w-{now}-5")
            cur.execute(
                "INSERT INTO exec_orders (bot_id, signal_row_id, client_order_id, side, symbol, requested_qty, requested_notional, status) "
                "VALUES (%s, %s, %s, 'buy', 'BTC/USDT', 0.1, 10, 'filled')", (cbid, s5, f"sig-{s5}"))
            conn.commit()
    q.enqueue(s5, cbid)
    r5 = w.process_one("itest-worker", MockExchange())
    check("crash-retry can never place a SECOND order per signal", r5.outcome == "duplicate", r5.outcome)

    print("== ccxt testnet adapter (slice 8) — FAKE ccxt, NO network, NO real key ==")
    # Drives the REAL CcxtTestnetAdapter through the worker, but with an injected
    # FAKE ccxt exchange — so this proves the armed→resolve→adapter→order path and
    # sandbox enforcement WITHOUT touching a real venue, a real key, or mainnet.
    from exec_service.adapters.ccxt_testnet import CcxtTestnetAdapter, AdapterSafetyError
    from exec_service.vault import ExchangeCreds, MockVault

    class _FakeCcxt:
        def __init__(self, cfg, price=100.0, honors=True):
            self.config = cfg; self._p = price; self._h = honors
            self.sandbox = False; self.options = {}; self.urls = {"api": "https://api-mainnet.x"}
            self.orders = []
        def set_sandbox_mode(self, on):
            if self._h: self.sandbox = bool(on); self.urls = {"api": "https://api-testnet.x"}
        def fetch_ticker(self, s): return {"last": self._p}
        def create_order(self, s, t, side, qty, price, params):
            assert self.sandbox, "order reached a non-sandbox client"
            self.orders.append(params); return {"id": f"TESTNET-{params['clientOrderId']}", "filled": qty, "average": self._p}

    vref = "vault://strateteach/exec/ccxt-testnet"
    mvault = MockVault(); mvault.put_placeholder(vref, ExchangeCreds(api_key="PLACEHOLDER-k", api_secret="PLACEHOLDER-s"))
    # simulate arm on the throwaway DB, register a testnet credential row (ref only)
    os.environ["EXECUTION_ARMED"] = "true"
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE exec_state SET execution_armed=TRUE, kill_switch=FALSE WHERE id=1")
            cur.execute("UPDATE exec_bots SET exchange='bybit', trading_enabled=TRUE, daily_notional_cap=1000, max_open_positions=9 WHERE id=%s", (cbid,))
            cur.execute("DELETE FROM exec_queue"); cur.execute("DELETE FROM exec_orders WHERE bot_id=%s", (cbid,))
            cur.execute("INSERT INTO exec_credentials (label, exchange, env, owner, vault_ref, vault_backend, status) "
                        "VALUES (%s,'bybit','testnet','dan',%s,'hashicorp_vault','active') ON CONFLICT (label) DO NOTHING",
                        (f"itest-ccxt-{now}", vref))
            sX = _seed_signal(cur, cbid, f"ccxt-{now}-1")
            conn.commit()
    q.enqueue(sX, cbid)
    adapter = CcxtTestnetAdapter("bybit", environment="testnet", exchange_factory=lambda ex, cfg: _FakeCcxt(cfg, price=50.0))
    rX = w.process_one("itest-worker", adapter, vault_backend=mvault)
    check("armed worker → ccxt(testnet) fill via fake exchange", rX.outcome in ("filled", "filled_mock"), f"{rX.outcome}/{rX.detail}")
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT exchange_order_id FROM exec_orders WHERE id=%s", (rX.order_id,))
            check("order id is a TESTNET id", str(cur.fetchone()["exchange_order_id"]).startswith("TESTNET-"))

    # a ccxt build that IGNORES sandbox must abort (worker nacks → item retried, no live order)
    with connect() as conn:
        with conn.cursor() as cur:
            sY = _seed_signal(cur, cbid, f"ccxt-{now}-2"); conn.commit()
    q.enqueue(sY, cbid)
    bad = CcxtTestnetAdapter("bybit", environment="testnet", exchange_factory=lambda ex, cfg: _FakeCcxt(cfg, honors=False))
    rY = w.process_one("itest-worker", bad, vault_backend=mvault)
    check("client ignoring sandbox → worker fails (no live order)", rY.outcome == "failed", rY.outcome)

    # re-disarm the throwaway DB before continuing
    os.environ["EXECUTION_ARMED"] = "false"
    with connect() as conn:
        conn.execute("UPDATE exec_state SET execution_armed=FALSE, kill_switch=TRUE WHERE id=1")
        conn.commit()
    check("re-disarmed after ccxt section", read_gate().armed is False)

    print("== vault resolve path (slice 5) — MockVault + PLACEHOLDER creds only ==")
    # A test adapter that DEMANDS credentials, so the worker's resolve-then-call
    # wiring runs end-to-end. The vault is the in-memory MockVault holding an
    # obviously-fake placeholder — NO real vault, NO real key, nothing entered.
    from exec_service.vault import ExchangeCreds, MockVault, resolve

    class CredMock:
        name = "cred-mock"; needs_credentials = True
        def __init__(self): self._n = 0
        def submit_intent(self, *, side, symbol, notional, client_order_id, creds=None):
            assert creds is not None and creds.api_key, "worker must resolve creds for a needs_credentials adapter"
            self._n += 1
            from exec_service.mock_exchange import MockFill
            return MockFill(exchange_order_id=f"MOCKCRED-{client_order_id}-{self._n}", price=100.0,
                            qty=round(notional / 100.0, 12), notional=float(notional))

    ref = "vault://strateteach/exec/mock-testnet"
    mv = MockVault(); mv.put_placeholder(ref, ExchangeCreds(api_key="PLACEHOLDER-key", api_secret="PLACEHOLDER-secret"))
    # this section needs an ARMED gate (throwaway DB only) — arm it explicitly so
    # it doesn't depend on a prior section's leftover state.
    os.environ["EXECUTION_ARMED"] = "true"
    with connect() as conn:
        conn.execute("UPDATE exec_state SET execution_armed=TRUE, kill_switch=FALSE WHERE id=1")
        conn.commit()
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE exec_bots SET exchange='mock', trading_enabled=TRUE, daily_notional_cap=1000, max_open_positions=5 WHERE id=%s", (cbid,))
            cur.execute("DELETE FROM exec_orders WHERE bot_id=%s", (cbid,))
            cur.execute(
                "INSERT INTO exec_credentials (label, exchange, env, owner, vault_ref, vault_backend, status) "
                "VALUES (%s, 'mock', 'testnet', 'dan', %s, 'hashicorp_vault', 'active') "
                "ON CONFLICT (label) DO NOTHING",
                (f"itest-cred-{now}", ref),
            )
            sc = _seed_signal(cur, cbid, f"w-{now}-cred")
            conn.commit()
    q.enqueue(sc, cbid)
    rc = w.process_one("itest-worker", CredMock(), vault_backend=mv)
    check("worker resolves ref→creds and the adapter fills", rc.outcome in ("filled", "filled_mock"), rc.outcome)

    # a needs-credentials adapter with NO vault backend → fail-closed (retry), never a keyless order
    with connect() as conn:
        with conn.cursor() as cur:
            s_noc = _seed_signal(cur, cbid, f"w-{now}-nocreds")
            conn.commit()
    q.enqueue(s_noc, cbid)
    rnc = w.process_one("itest-worker", CredMock(), vault_backend=None)
    check("needs-creds adapter + no vault → failed (fail-closed)", rnc.outcome == "failed", rnc.outcome)
    # the secret must not have leaked into the audit trail
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS n FROM audit_log WHERE after::text ILIKE '%PLACEHOLDER-secret%' OR meta::text ILIKE '%PLACEHOLDER-secret%'")
            check("no secret ever written to the audit trail", int(cur.fetchone()["n"]) == 0)

    print("== kill-switch wiring (slice 6) ==")
    # DISARMED throughout (enqueue/hold/release are independent of the gate) — so
    # this also proves release does NOT arm: execution_armed stays false the whole
    # time, and the effective gate is DISARMED before AND after the release.
    os.environ["EXECUTION_ARMED"] = "false"
    with connect() as conn:
        conn.execute("UPDATE exec_state SET execution_armed=FALSE, kill_switch=FALSE WHERE id=1")
        conn.execute("UPDATE exec_bots SET trading_enabled=TRUE WHERE id=%s", (cbid,))
        conn.execute("DELETE FROM exec_queue")
        conn.commit()
    with connect() as conn:
        with conn.cursor() as cur:
            sA = _seed_signal(cur, cbid, f"k-{now}-A"); sB = _seed_signal(cur, cbid, f"k-{now}-B")
            conn.commit()
    q.enqueue(sA, cbid); q.enqueue(sB, cbid)
    from exec_service.state import engage_kill_switch, release_kill_switch
    engage_kill_switch("itest-owner", reason="integration check")
    dk = q.depth()
    check("kill-switch HELD the queued items", dk["held"] == 2 and dk["queued"] == 0, str(dk))
    check("held items are NOT claimable", w.process_one("itest-worker", MockExchange()).outcome == "idle")
    check("kill-switch flipped bots off", read_gate().armed is False)

    release_kill_switch("itest-owner", reason="integration check")
    dr = q.depth()
    check("release restored held → queued", dr["queued"] == 2 and dr["held"] == 0, str(dr))
    check("release does NOT arm execution (gate still DISARMED)", read_gate().armed is False, read_gate().reason)

    print("== reconciliation (slice 6) ==")
    from exec_service import reconcile
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM exec_orders WHERE bot_id=%s", (cbid,))
            # one clean mock fill, one overfill drift, one missing-exec drift
            cur.execute("INSERT INTO exec_orders (bot_id, client_order_id, side, symbol, requested_qty, requested_notional, executed_qty, avg_fill_price, exchange_order_id, status) "
                        "VALUES (%s,%s,'buy','BTC/USDT',0.1,10,0.1,100,'MOCK-clean','filled')", (cbid, f"rec-ok-{now}"))
            cur.execute("INSERT INTO exec_orders (bot_id, client_order_id, side, symbol, requested_qty, requested_notional, executed_qty, exchange_order_id, status) "
                        "VALUES (%s,%s,'buy','BTC/USDT',0.1,10,0.5,'MOCK-over','filled')", (cbid, f"rec-over-{now}"))
            cur.execute("INSERT INTO exec_orders (bot_id, client_order_id, side, symbol, requested_qty, requested_notional, executed_qty, status) "
                        "VALUES (%s,%s,'buy','BTC/USDT',0.1,10,0,'filled')", (cbid, f"rec-missing-{now}"))
            conn.commit()
    rep = reconcile.run(bot_id=cbid)
    check("reconcile flags the overfill + missing_exec drifts", rep["counts"].get("overfill") == 1 and rep["counts"].get("missing_exec") == 1, str(rep["counts"]))
    check("reconcile counts the clean fill as ok", rep["counts"].get("ok") == 1, str(rep["counts"]))
    check("reconcile reports not-ok when drifts exist", rep["ok"] is False)

    # re-disarm before the shared end-state assertion below
    import os as _os
    _os.environ["EXECUTION_ARMED"] = "false"
    with connect() as conn:
        conn.execute("UPDATE exec_state SET execution_armed=FALSE, kill_switch=TRUE WHERE id=1")
        conn.commit()

    # kill-switch: one act halts everything (and flips every bot off)
    engage_kill_switch("itest-owner", reason="integration check")
    with connect() as conn:
        with conn.cursor() as cur:
            s6 = _seed_signal(cur, cbid, f"w-{now}-6")
            conn.commit()
    q.enqueue(s6, cbid)
    r6 = w.process_one("itest-worker", MockExchange())
    check("kill-switch → worker no-ops", r6.outcome == "noop_disarmed", r6.outcome)

    # ── re-disarm FULLY and prove it ──
    os.environ["EXECUTION_ARMED"] = "false"
    with connect() as conn:
        conn.execute("UPDATE exec_state SET execution_armed=FALSE, kill_switch=TRUE WHERE id=1")
        conn.commit()
    check("end state: gate DISARMED again", read_gate().armed is False)

    print("== owner fund + 3-of-3 flow (slice 7) — owner-only, RECORDS only ==")
    from exec_service import owner_fund as fund
    from exec_service import approvals_flow as flow

    with connect() as conn:
        conn.execute("DELETE FROM owner_fund")
        conn.execute("DELETE FROM owner_approvals WHERE request_ref LIKE 'fund-%'")
        conn.commit()
    fund.add_entry("dan", "deposit", 100, created_by="dan")
    fund.add_entry("rafi", "deposit", 100, created_by="rafi")
    fund.add_entry("yoav", "deposit", 100, created_by="yoav")
    fund.add_entry("dan", "pnl", 30, created_by="dan")
    v = fund.view()
    check("fund NAV = 330 (300 contributed + 30 pnl)", v.nav_usd == 330.0, str(v.nav_usd))
    check("equal deposits → ~33.33% each",
          abs(v.by_owner["dan"]["ownership_pct"] - 100/3) < 0.01, str(v.by_owner))

    req = flow.request("fund_deposit", {"amountUsd": 500}, requested_by="dan")
    ref = req["ref"]
    flow.approve(ref, "dan")
    st2 = flow.approve(ref, "rafi")
    check("2 approvals → still pending (not enough)", st2["status"] == "pending", st2["status"])
    # same owner cannot approve twice
    dup_ok = False
    try:
        flow.approve(ref, "DAN")  # case-insensitive same owner
    except PermissionError:
        dup_ok = True
    check("same owner can't approve twice (case-insensitive)", dup_ok)
    st3 = flow.approve(ref, "yoav")
    check("3 DISTINCT owners → approved (RECORDED, not executed)", st3["status"] == "approved", st3["status"])

    # the DB itself refuses a forged 3-same-owner 'approved' row (003 backstop)
    forged_blocked = False
    try:
        with connect() as conn:
            conn.execute(
                "INSERT INTO owner_approvals (request_ref, action, requested_by, approvals, status) "
                "VALUES (%s, 'fund_trade', 'dan', %s, 'approved')",
                (f"fund-forge-{now}", Json([{"owner": "dan"}, {"owner": "dan"}, {"owner": "dan"}])),
            )
        check("DB backstops forged same-owner approval", False, "INSERT unexpectedly succeeded")
    except Exception:
        forged_blocked = True
        check("DB backstops forged same-owner approval", True)

    # a rejection closes a fresh request
    req2 = flow.request("fund_withdrawal", {"amountUsd": 50}, requested_by="rafi")
    rj = flow.reject(req2["ref"], "yoav", note="not now")
    check("one owner's rejection closes the request", rj["status"] == "rejected", rj["status"])

    # NOTHING advanced to 'executed', and the operator can't see the fund (access.py)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS n FROM owner_approvals WHERE status='executed'")
            check("no fund request ever reached 'executed'", int(cur.fetchone()["n"]) == 0)
    from exec_service.access import ExecRole, can_read
    check("operator still blocked from owner_fund", can_read(ExecRole.EXECUTION_OPERATOR, "owner_fund") is False)
    check("operator still blocked from owner_approvals", can_read(ExecRole.EXECUTION_OPERATOR, "owner_approvals") is False)

    print("== audit ==")
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS n FROM audit_log")
            check("audit rows written", int(cur.fetchone()["n"]) > 0)
    try:
        with connect() as conn:
            conn.execute("UPDATE audit_log SET action = 'tampered'")
        check("audit UPDATE rejected by trigger", False, "UPDATE unexpectedly succeeded")
    except Exception:
        check("audit UPDATE rejected by trigger", True)

    print()
    if FAILS:
        print(f"RESULT: FAIL ({len(FAILS)}): {', '.join(FAILS)}")
        return 1
    print("RESULT: ALL GREEN — the execution service verified against a real Postgres.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
