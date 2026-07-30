"""DRY-RUN proof that a MANUAL live close records realized P&L NET of real fees (the last gross
path). The manual-close path (exchange_order sell → net_close_pnl(entry, exit, qty, order, base))
feeds the place_order RESULT order (which carries fee/fees from the fill) to the same helper the
OCO reconcile uses. This proves it nets for all three fee currencies + the `fees` LIST form +
graceful GROSS fallback. No exchange call (ccxt + DB stubbed; fetch_prices faked).

Run:  python3 tests/test_manual_close_fees_dryrun.py
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
sys.modules.setdefault("app.database", types.ModuleType("app.database"))  # heavy; net_close_pnl doesn't use it

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.services import exchange as ex           # noqa: E402
from app.services import live_reconcile as lr      # noqa: E402

ex.fetch_prices = lambda syms: {"BNB/USDT": 500.0}

ENTRY, EXIT, QTY, BASE = 100.0, 110.0, 1.0, "TAO"


def _order(fee=None, fees=None):
    # Shape returned by place_order for a market SELL fill (see the "order" dict + fee/fees).
    return {"id": "S1", "side": "sell", "average": 110.0, "filled": 1.0, "cost": 110.0,
            "status": "closed", "fee": fee, "fees": fees}


def _check(name, order, expect):
    pnl, pct = lr.net_close_pnl(ENTRY, EXIT, QTY, order, BASE, {})
    gross = round((EXIT - ENTRY) * QTY, 2)
    print(f"\n=== {name} ===\n  GROSS +${gross:.2f} → NET +${pnl:.2f} ({pct:+.2f}%)  fee impact ${gross - pnl:.2f}")
    assert pnl == expect, (name, pnl, expect)
    print(f"  PASS ✓  net = ${expect}")


if __name__ == "__main__":
    _check("manual close · USDT fee (fee)",   _order(fee={"cost": 0.11, "currency": "USDT"}), 9.79)
    _check("manual close · BASE fee (fee)",   _order(fee={"cost": 0.001, "currency": "TAO"}), 9.79)  # 0.001*110
    _check("manual close · BNB fee (fee)",    _order(fee={"cost": 0.00022, "currency": "BNB"}), 9.79)  # *500
    _check("manual close · fees LIST form",   _order(fees=[{"cost": 0.11, "currency": "USDT"}]), 9.79)
    _check("manual close · no fee → GROSS",   _order(), 10.00)
    print("\nALL MANUAL-CLOSE FEE DRY-RUN CHECKS PASSED ✓  (no exchange call was made)")
