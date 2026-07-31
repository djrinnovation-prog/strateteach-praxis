"""DRY-RUN proof for the LIVE protective OCO (stop-loss + take-profit).

No exchange, no creds, no real API call: we stub ``ccxt`` and replace the client
factory with a fake client that RECORDS every order call. It then asserts the exact
params place_order sends for a spot BUY armed with a 2% stop and a 5% take-profit —
side=SELL, quantity=filled base qty, take-profit LIMIT above the fill, STOP_LOSS_LIMIT
below it, and the trigger/stop-limit ordering the exchange requires.

Run directly:  python3 tests/test_live_oco_dryrun.py
"""
import math
import sys
import types

# ── stub ccxt so app.services.exchange imports without the real dependency ────────
_ccxt = types.ModuleType("ccxt")
class _Base(Exception):
    ...
_ccxt.AuthenticationError = type("AuthenticationError", (_Base,), {})
_ccxt.InsufficientFunds = type("InsufficientFunds", (_Base,), {})
_ccxt.BaseError = _Base
sys.modules.setdefault("ccxt", _ccxt)

import os
# This suite exercises the LEGACY direct-exchange engine, which is OFF by default in the unified app
# (Phase 2B · M4). Arm it so place_order takes the direct path under test.
os.environ.setdefault("STRATETEACH_ENGINE_ENABLED", "true")
os.environ.setdefault("STRATETEACH_LEGACY_ENGINE_ENABLED", "true")  # M7: engine-on now requires the master retirement flag too
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.services import exchange as ex  # noqa: E402


class FakeClient:
    """Minimal ccxt-like client that records order calls instead of sending them."""
    def __init__(self, last=400.0, free_usdt=1000.0, oco_supported=True, stop_supported=True,
                 base_fee=0.0):
        self.markets = {"TAO/USDT": True}
        self._last = last
        self._free = free_usdt
        self._base_fee = base_fee     # fee charged in the BASE asset on the buy (coins)
        self._base_free = 0.0         # free base after the buy (set in create_order)
        self.oco_supported = oco_supported
        self.stop_supported = stop_supported
        self.calls = []          # every create_order call
        self.oco_params = None   # the exact OCO payload

    def load_markets(self):
        return self.markets

    def market(self, symbol):
        return {"base": "TAO", "quote": "USDT", "id": symbol.replace("/", ""),
                "limits": {"cost": {"min": 5.0}}}

    def fetch_balance(self):
        return {"free": {"USDT": self._free, "TAO": self._base_free}}

    def fetch_ticker(self, symbol):
        return {"last": self._last, "close": self._last}

    # simulate LOT_SIZE (4dp step) as a TRUNCATING floor + tick size (2dp price), ccxt returns strings
    def amount_to_precision(self, symbol, x):
        step = 1e-4
        return f"{math.floor(float(x) / step) * step:.4f}"

    def price_to_precision(self, symbol, x):
        return f"{float(x):.2f}"

    def create_order(self, symbol, type_, side, amount, price=None, params=None):
        self.calls.append({"symbol": symbol, "type": type_, "side": side,
                           "amount": amount, "price": price, "params": params or {}})
        if type_ == "market" and side == "buy":
            received = float(amount) - self._base_fee          # coins actually credited
            self._base_free = received                          # what's now free to sell
            return {"id": "BUY-1", "filled": float(amount), "average": self._last,
                    "amount": float(amount), "cost": float(amount) * self._last,
                    "status": "closed", "symbol": symbol, "side": "buy", "type": "market",
                    "fee": {"currency": "TAO", "cost": self._base_fee} if self._base_fee else None}
        if type_ == "STOP_LOSS_LIMIT":
            if not self.stop_supported:
                raise _ccxt.BaseError("STOP_LOSS_LIMIT not supported for this symbol/region")
            return {"id": "STOP-1", "status": "open"}
        if type_ == "limit" and side == "sell":
            return {"id": "TP-1", "status": "open"}
        return {"id": "X", "status": "open"}

    def private_post_order_oco(self, params):
        self.oco_params = dict(params)
        if not self.oco_supported:
            raise _ccxt.BaseError("OCO endpoint unavailable for this account/region")
        return {"orderListId": 123, "listStatusType": "EXEC_STARTED",
                "orderReports": [{"orderId": 111, "type": "LIMIT_MAKER", "side": "SELL"},
                                 {"orderId": 222, "type": "STOP_LOSS_LIMIT", "side": "SELL"}]}


def _run(fake):
    ex._client_from_config = lambda cfg, default_type="spot": (fake, {"exchange": "binance", "environment": "live"})
    ex._resolve_symbol = lambda client, symbol, futures: symbol
    return ex.place_order({}, "TAO/USDT", "buy", pct=0.0, order_type="market",
                          market_type="spot", quote_amount=100.0,
                          stop_loss_pct=2.0, take_profit_pct=5.0)


def test_oco_params():
    print("\n=== SCENARIO 1: OCO supported (stop 2% + take-profit 5%) ===")
    fake = FakeClient(last=400.0)
    res = _run(fake)
    print("buy result ok:", res["ok"])
    print("buy fill price:", fake._last, " filled qty:", res["order"]["filled"])
    print("EXACT OCO PARAMS SENT TO EXCHANGE (no real call):")
    for k, v in fake.oco_params.items():
        print(f"    {k} = {v!r}")
    print("stopOrder:", res["stopOrder"])
    p = fake.oco_params
    # side/quantity/legs
    assert p["side"] == "SELL", p
    assert float(p["quantity"]) == 0.25, p                     # == filled base qty (LOT_SIZE 4dp)
    assert float(p["price"]) == 420.00, p                      # take-profit LIMIT = fill*(1+5%)
    assert float(p["stopPrice"]) == 392.00, p                  # stop trigger  = fill*(1-2%)
    assert float(p["stopLimitPrice"]) == 390.82, p             # stop-limit a touch below trigger
    assert p["stopLimitTimeInForce"] == "GTC", p
    # exchange ordering constraint for a SELL OCO: TP > last > stopPrice > stopLimit
    assert float(p["price"]) > fake._last > float(p["stopPrice"]) > float(p["stopLimitPrice"]), p
    # result surfaced for the UI + Binance verification
    so = res["stopOrder"]
    assert so["ok"] is True and so["type"] == "oco", so
    assert so["orderIds"] == [111, 222] and so["ocoId"] == 123, so
    assert "+5.0%" in so["message"] and "-2.0%" in so["message"].replace("−", "-"), so["message"]
    print("PASS ✓  both legs constructed, IDs surfaced")


def test_oco_unavailable_falls_back_to_stop_only():
    print("\n=== SCENARIO 2: OCO unavailable → stop-only fallback, TP flagged missing ===")
    fake = FakeClient(last=400.0, oco_supported=False, stop_supported=True)
    res = _run(fake)
    so = res["stopOrder"]
    print("stopOrder:", so)
    assert res["ok"] is True, res                              # buy still succeeded
    assert so["ok"] is True and so["type"] == "stop_only", so
    assert "TAKE-PROFIT was NOT attached" in so["message"], so
    print("PASS ✓  stop placed, take-profit honestly reported as NOT attached")


def test_both_legs_rejected_reports_unprotected():
    print("\n=== SCENARIO 3: OCO + stop both rejected → UNPROTECTED, never 'ok' ===")
    fake = FakeClient(last=400.0, oco_supported=False, stop_supported=False)
    res = _run(fake)
    so = res["stopOrder"]
    print("stopOrder:", so)
    assert res["ok"] is True, res                              # the BUY itself succeeded...
    assert so["ok"] is False and so["type"] == "none", so      # ...but protection did NOT
    assert "REJECTED" in so["message"], so
    print("PASS ✓  rejection surfaced (buy ok, protection FAILED — position flagged unprotected)")


def test_fee_paid_in_base_shrinks_sell_qty():
    print("\n=== SCENARIO 4: buy fee paid in BASE asset → OCO qty = RECEIVED coins, not filled ===")
    # 0.25 filled, 0.00025 fee in TAO → only 0.24975 credited & free to sell.
    fake = FakeClient(last=400.0, base_fee=0.00025)
    res = _run(fake)
    p = fake.oco_params
    print("filled qty:", res["order"]["filled"], " base fee:", fake._base_fee,
          " free base after buy:", fake._base_free)
    print("OCO quantity SENT:", p["quantity"])
    q = float(p["quantity"])
    assert q == 0.2497, p                                       # floored to LOT_SIZE from 0.24975
    assert q < float(res["order"]["filled"]), (q, res["order"]["filled"])   # LESS than the gross fill
    assert q <= fake._base_free + 1e-12, (q, fake._base_free)   # never exceeds the free balance
    assert res["stopOrder"]["ok"] is True and res["stopOrder"]["type"] == "oco", res["stopOrder"]
    print("PASS ✓  sells the received (post-fee) qty — OCO won't be rejected for insufficient balance")


if __name__ == "__main__":
    test_oco_params()
    test_oco_unavailable_falls_back_to_stop_only()
    test_both_legs_rejected_reports_unprotected()
    test_fee_paid_in_base_shrinks_sell_qty()
    print("\nALL DRY-RUN CHECKS PASSED ✓  (no exchange call was made)")
