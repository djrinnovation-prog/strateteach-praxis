"""Unit tests for the Signal Bot 100%-of-balance sizing math (SPOT, LONG-ONLY).

These tests are MONEY-CRITICAL sizing checks. They exercise ONLY the pure sizing
helper `app.api.routes.bots._balance_buy_quote` and a MOCKED exchange balance fetch —
they never touch a real exchange and place NO orders.

Covered:
  • the fee/slippage buffer is applied (a 100% buy never spends the whole balance);
  • size_pct scales the spend and is clamped to [0, 100];
  • zero / negative / invalid inputs size to 0 (caller → "insufficient balance");
  • the min-notional gate: a tiny balance sizes BELOW the exchange minimum (rejected),
    a healthy balance sizes ABOVE it (allowed);
  • the mocked balance fetch feeds the sizing (no real exchange call).
"""
import pytest

import app.api.routes.bots as bots

BUF = bots._SIZE_BUFFER  # 0.5%


def test_full_balance_buy_leaves_the_fee_buffer():
    # 100% of a 1000 USDT free balance, minus the 0.5% buffer → 995 USDT.
    q = bots._balance_buy_quote(1000.0, 100)
    assert q == pytest.approx(1000.0 * (1 - BUF))      # 995.0
    assert q < 1000.0                                   # NEVER spends the whole balance


def test_size_pct_scales_the_spend():
    assert bots._balance_buy_quote(1000.0, 50) == pytest.approx(500.0 * (1 - BUF))   # 497.5
    assert bots._balance_buy_quote(1000.0, 25) == pytest.approx(250.0 * (1 - BUF))   # 248.75


def test_size_pct_is_clamped_to_0_100():
    # >100 is clamped to 100 (can't spend more than the balance minus buffer)…
    assert bots._balance_buy_quote(1000.0, 150) == pytest.approx(1000.0 * (1 - BUF))
    # …and <=0 sizes to nothing.
    assert bots._balance_buy_quote(1000.0, 0) == 0.0
    assert bots._balance_buy_quote(1000.0, -20) == 0.0


def test_non_positive_or_invalid_balance_sizes_to_zero():
    assert bots._balance_buy_quote(0.0, 100) == 0.0
    assert bots._balance_buy_quote(-5.0, 100) == 0.0
    assert bots._balance_buy_quote(None, 100) == 0.0
    assert bots._balance_buy_quote("not-a-number", 100) == 0.0
    # A None size_pct defaults to 100%.
    assert bots._balance_buy_quote(1000.0, None) == pytest.approx(1000.0 * (1 - BUF))


def test_explicit_buffer_argument():
    assert bots._balance_buy_quote(1000.0, 100, buffer=0.01) == pytest.approx(990.0)
    assert bots._balance_buy_quote(1000.0, 100, buffer=0.0) == pytest.approx(1000.0)


def test_min_notional_gate():
    # The exchange min-notional (e.g. Binance ~10 USDT) is enforced downstream by
    # place_order, which refuses to place a sub-minimum order. Here we assert the sizing
    # produces a quote BELOW that minimum for a tiny balance (so the gate triggers) and
    # ABOVE it for a healthy balance (so a real order is allowed).
    MIN_NOTIONAL = 10.0
    assert bots._balance_buy_quote(5.0, 100) < MIN_NOTIONAL       # tiny → rejected
    assert bots._balance_buy_quote(1000.0, 100) > MIN_NOTIONAL    # healthy → allowed


def test_mocked_balance_fetch_feeds_sizing(monkeypatch):
    # MOCK the exchange balance fetch — never hit a real exchange, place NO orders.
    calls = {}

    def fake_get_free_quote(cfg, quote):
        calls["quote"] = quote
        return {"ok": True, "free": 2000.0, "message": ""}

    monkeypatch.setattr(bots.ex, "get_free_quote", fake_get_free_quote)

    fq = bots.ex.get_free_quote({"exchange": "binance"}, "USDT")
    assert fq["ok"] and fq["free"] == 2000.0
    assert calls["quote"] == "USDT"

    # This is exactly what the webhook computes for a balance_pct BUY.
    buy_quote = bots._balance_buy_quote(fq["free"], 100)
    assert buy_quote == pytest.approx(2000.0 * (1 - BUF))         # 1990.0
    assert buy_quote < fq["free"]                                 # buffer preserved


def test_failed_balance_fetch_is_handled(monkeypatch):
    # A failed balance read (bad/again key) must not size an order.
    monkeypatch.setattr(bots.ex, "get_free_quote",
                        lambda cfg, quote: {"ok": False, "free": 0.0, "message": "auth error"})
    fq = bots.ex.get_free_quote({}, "USDT")
    assert not fq["ok"]
    assert bots._balance_buy_quote(fq.get("free"), 100) == 0.0
