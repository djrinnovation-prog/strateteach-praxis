"""DRY-RUN proof that the runs_log ledger (live_reconcile) records realized P&L NET of real fees,
for all three fee currencies (USDT / base-asset / BNB) + graceful GROSS fallback. No exchange call
(ccxt stubbed; the heavy DB module stubbed since net_close_pnl doesn't use it; fetch_prices faked).

Run:  python3 tests/test_reconcile_fees_dryrun.py
"""
import os
import sys
import types

_ccxt = types.ModuleType("ccxt")
class _B(Exception): ...
_ccxt.AuthenticationError = type("A", (_B,), {})
_ccxt.InsufficientFunds = type("I", (_B,), {})
_ccxt.BaseError = _B
sys.modules.setdefault("ccxt", _ccxt)
# live_reconcile imports `app.database` at load (psycopg etc.); net_close_pnl never uses it → stub.
sys.modules.setdefault("app.database", types.ModuleType("app.database"))

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.services import exchange as ex           # noqa: E402
from app.services import live_reconcile as lr      # noqa: E402

ex.fetch_prices = lambda syms: {"BNB/USDT": 500.0}  # BNB → $500 for fee conversion


def _sell(fee):
    return {"side": "sell", "average": 110.0, "filled": 1.0, "fee": fee}


# One live position: entry $100, exit $110, qty 1 → GROSS +$10.00.
ENTRY, EXIT, QTY, BASE = 100.0, 110.0, 1.0, "TAO"


def _run(name, fee, expect):
    pnl, pct = lr.net_close_pnl(ENTRY, EXIT, QTY, _sell(fee), BASE, {})
    gross = round((EXIT - ENTRY) * QTY, 2)
    print(f"\n=== {name} ===")
    print(f"  fee: {fee}")
    print(f"  GROSS +${gross:.2f}  →  NET +${pnl:.2f}  ({pct:+.2f}%)   fee impact ${gross - pnl:.2f}")
    assert pnl == expect, (name, pnl, expect)
    print(f"  PASS ✓  net = ${expect}")


if __name__ == "__main__":
    # USDT sell fee $0.11 → observed rate 0.1% → buy fee $0.10 → net 10.00 − 0.21 = 9.79.
    _run("USDT-paid sell fee", {"cost": 0.11, "currency": "USDT"}, 9.79)
    # base-asset sell fee 0.001 TAO valued at exit $110 = $0.11 → same as above.
    _run("BASE-asset sell fee", {"cost": 0.001, "currency": "TAO"}, 9.79)
    # BNB sell fee 0.00022 BNB × $500 = $0.11 → same.
    _run("BNB-paid sell fee", {"cost": 0.00022, "currency": "BNB"}, 9.79)
    # No fee data on the fill → GROSS fallback (never crash/zero).
    _run("no fee data (fallback)", None, 10.00)
    print("\nALL RECONCILE-FEE DRY-RUN CHECKS PASSED ✓  (no exchange call was made)")
