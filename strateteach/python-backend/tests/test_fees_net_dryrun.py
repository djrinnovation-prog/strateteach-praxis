"""DRY-RUN proof that realized P&L is NET of real Binance fees, for all three fee currencies
(USDT-paid, BASE-asset-paid, BNB-paid) — with NO exchange call (ccxt stubbed, fetch_my_trades
and fetch_prices faked). Proves order_fees_usdt apportions fees correctly and that
realized_pnl_by_order / replay_orders subtract them (vs the GROSS figure), plus a graceful
fallback to GROSS when the exchange has no fee data.

Run:  python3 tests/test_fees_net_dryrun.py
"""
import sys
import types

_ccxt = types.ModuleType("ccxt")
class _Base(Exception): ...
_ccxt.AuthenticationError = type("AuthenticationError", (_Base,), {})
_ccxt.InsufficientFunds = type("InsufficientFunds", (_Base,), {})
_ccxt.BaseError = _Base
sys.modules.setdefault("ccxt", _ccxt)

import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.services import exchange as ex  # noqa: E402


class FakeClient:
    def __init__(self, trades_by_symbol, raise_symbols=()):
        self.markets = {"TAO/USDT": True}
        self._trades = trades_by_symbol
        self._raise = set(raise_symbols)
    def load_markets(self): return self.markets
    def fetch_my_trades(self, symbol, limit=500):
        if symbol in self._raise:
            raise _ccxt.BaseError("no trade history permission")
        return self._trades.get(symbol, [])


def _install(trades_by_symbol, raise_symbols=()):
    ex._client_from_config = lambda cfg, dt="spot": (FakeClient(trades_by_symbol, raise_symbols), {"exchange": "binance"})
    ex.fetch_prices = lambda syms: {"BNB/USDT": 500.0}   # BNB → $500 for fee conversion


# The app's own order log for one round trip (buy 1 @ $100, sell @ $110). Base-fee case sells 0.999.
def _orders(sell_qty=1.0, sell_cost=110.0):
    return [
        {"id": 1, "symbol": "TAO/USDT", "side": "buy", "qty": 1.0, "cost": 100.0},
        {"id": 2, "symbol": "TAO/USDT", "side": "sell", "qty": sell_qty, "cost": sell_cost},
    ]


def _enrich(orders, fee_map):
    for o in orders:
        f = fee_map.get(o["id"]) or {}
        o["feeUsdt"] = float(f.get("feeUsdt") or 0.0)
        o["baseFeeQty"] = float(f.get("baseFeeQty") or 0.0)
    return orders


def _report(name, gross, net, fees):
    print(f"\n=== {name} ===")
    print(f"  fee map: {fees}")
    print(f"  GROSS realized: ${gross:.4f}   NET realized: ${net:.4f}   fee impact: ${gross - net:.4f}")


def test_usdt_fee():
    _install({"TAO/USDT": [
        {"order": "b1", "side": "buy",  "amount": 1.0, "cost": 100.0, "fee": {"cost": 0.10, "currency": "USDT"}},
        {"order": "s1", "side": "sell", "amount": 1.0, "cost": 110.0, "fee": {"cost": 0.11, "currency": "USDT"}},
    ]})
    gross = ex.realized_pnl_by_order(_orders())            # not enriched → GROSS
    fees = ex.order_fees_usdt({}, _orders())
    net = ex.realized_pnl_by_order(_enrich(_orders(), fees))
    _report("USDT-paid fee", gross[2], net[2], fees)
    assert round(fees[1]["feeUsdt"], 4) == 0.10 and round(fees[2]["feeUsdt"], 4) == 0.11, fees
    assert gross[2] == 10.00, gross
    assert net[2] == 9.79, net                              # (110-100.10) - 0.11
    print("  PASS ✓  USDT fee subtracted (10.00 → 9.79)")


def test_base_asset_fee():
    # buy fee 0.001 TAO (base) → only 0.999 received; sell 0.999 @ 110 (proceeds 109.89), fee in USDT.
    _install({"TAO/USDT": [
        {"order": "b1", "side": "buy",  "amount": 1.0,   "cost": 100.0,  "fee": {"cost": 0.001,   "currency": "TAO"}},
        {"order": "s1", "side": "sell", "amount": 0.999, "cost": 109.89, "fee": {"cost": 0.10989, "currency": "USDT"}},
    ]})
    gross = ex.realized_pnl_by_order(_orders(sell_qty=0.999, sell_cost=109.89))
    fees = ex.order_fees_usdt({}, _orders(sell_qty=0.999, sell_cost=109.89))
    net = ex.realized_pnl_by_order(_enrich(_orders(sell_qty=0.999, sell_cost=109.89), fees))
    _report("BASE-asset-paid fee", gross[2], net[2], fees)
    assert round(fees[1]["baseFeeQty"], 4) == 0.001, fees   # base fee = coins not received
    assert round(fees[2]["feeUsdt"], 4) == 0.1099, fees
    # received 0.999 coins for $100 → avg 100.1001; sell 0.999 @110 − $0.10989 fee
    assert net[2] == 9.78, net
    assert net[2] < gross[2], (net, gross)
    print("  PASS ✓  base-asset fee reduces received qty + USDT sell fee subtracted")


def test_bnb_fee():
    _install({"TAO/USDT": [
        {"order": "b1", "side": "buy",  "amount": 1.0, "cost": 100.0, "fee": {"cost": 0.0002,  "currency": "BNB"}},
        {"order": "s1", "side": "sell", "amount": 1.0, "cost": 110.0, "fee": {"cost": 0.00022, "currency": "BNB"}},
    ]})
    fees = ex.order_fees_usdt({}, _orders())
    net = ex.realized_pnl_by_order(_enrich(_orders(), fees))
    gross = ex.realized_pnl_by_order(_orders())
    _report("BNB-paid fee (BNB=$500)", gross[2], net[2], fees)
    assert round(fees[1]["feeUsdt"], 4) == 0.10 and round(fees[2]["feeUsdt"], 4) == 0.11, fees  # 0.0002*500, 0.00022*500
    assert net[2] == 9.79, net
    print("  PASS ✓  BNB fee converted at BNB/USDT and subtracted (10.00 → 9.79)")


def test_graceful_fallback_no_fee_data():
    _install({}, raise_symbols=("TAO/USDT",))               # fetch_my_trades raises
    fees = ex.order_fees_usdt({}, _orders())
    net = ex.realized_pnl_by_order(_enrich(_orders(), fees))
    gross = ex.realized_pnl_by_order(_orders())
    print(f"\n=== graceful fallback (no fee data) ===\n  fee map: {fees}  →  NET==GROSS ${net[2]:.2f}")
    assert fees == {}, fees                                 # no data → empty (not a crash)
    assert net[2] == gross[2] == 10.00, (net, gross)        # falls back to GROSS, never zeroed
    print("  PASS ✓  no fee data → GROSS (never crashes or zeroes)")


def test_replay_aggregate_matches():
    _install({"TAO/USDT": [
        {"order": "b1", "side": "buy",  "amount": 1.0, "cost": 100.0, "fee": {"cost": 0.10, "currency": "USDT"}},
        {"order": "s1", "side": "sell", "amount": 1.0, "cost": 110.0, "fee": {"cost": 0.11, "currency": "USDT"}},
    ]})
    fees = ex.order_fees_usdt({}, _orders())
    rep = ex.replay_orders(_enrich(_orders(), fees))
    print(f"\n=== replay_orders aggregate (headline path) ===\n  realized (net): ${rep['realized']:.4f}")
    assert round(rep["realized"], 2) == 9.79, rep           # headline agrees with per-order net
    print("  PASS ✓  replay_orders headline realized is net + agrees with per-order")


if __name__ == "__main__":
    test_usdt_fee()
    test_base_asset_fee()
    test_bnb_fee()
    test_graceful_fallback_no_fee_data()
    test_replay_aggregate_matches()
    print("\nALL FEE DRY-RUN CHECKS PASSED ✓  (no exchange call was made)")
