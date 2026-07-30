"""ccxt testnet adapter (slice 8) — safety, with a FAKE ccxt only.

No real ccxt, no network, no key: every path uses an injected fake exchange.
These tests assert the adapter's non-negotiable safety: sandbox is forced AND
verified, mainnet is refused, missing creds abort, and the order is shaped
correctly. They are the reason the structural guard trusts adapters/."""
from __future__ import annotations

import pytest

from exec_service.adapters.ccxt_testnet import AdapterSafetyError, CcxtTestnetAdapter
from exec_service.vault import ExchangeCreds

CREDS = ExchangeCreds(api_key="PLACEHOLDER-key", api_secret="PLACEHOLDER-secret")


class FakeExchange:
    """A stand-in ccxt client. Records whether sandbox was enabled; refuses to
    'trade' unless it was (mirroring the real safety contract)."""

    def __init__(self, config, *, honors_sandbox=True, price=100.0):
        self.config = config
        self._honors_sandbox = honors_sandbox
        self.sandbox = False
        self.options = {}
        self.urls = {"api": "https://api-mainnet.example.com"}
        self._price = price
        self.orders = []

    def set_sandbox_mode(self, on):
        if self._honors_sandbox:
            self.sandbox = bool(on)
            self.urls = {"api": "https://api-testnet.example.com"}
        # a client that ignores the flag leaves sandbox False → adapter aborts

    def fetch_ticker(self, symbol):
        return {"last": self._price}

    def create_order(self, symbol, type_, side, qty, price, params):
        assert self.sandbox, "create_order reached a NON-sandbox client"
        o = {"id": f"TESTNET-{params.get('clientOrderId')}", "filled": qty, "average": self._price}
        self.orders.append((symbol, type_, side, qty, params))
        return o


def _adapter(**over):
    factory_kw = over.pop("factory_kw", {})
    return CcxtTestnetAdapter(
        "bybit", environment=over.pop("environment", "testnet"),
        exchange_factory=lambda ex, cfg: FakeExchange(cfg, **factory_kw),
    )


# ── environment guard ───────────────────────────────────────────────────────

def test_mainnet_adapter_cannot_be_constructed():
    with pytest.raises(AdapterSafetyError):
        CcxtTestnetAdapter("bybit", environment="mainnet")


def test_testnet_adapter_constructs():
    a = _adapter()
    assert a.needs_credentials is True and a.name == "ccxt_testnet"


# ── sandbox is forced AND verified ──────────────────────────────────────────

def test_happy_path_places_a_sandbox_order():
    a = _adapter(factory_kw={"price": 50.0})
    fill = a.submit_intent(side="buy", symbol="BTC/USDT", notional=100.0, client_order_id="sig-1", creds=CREDS)
    assert fill.mock is False               # a REAL (testnet) fill
    assert fill.qty == 2.0                  # 100 / 50
    assert fill.exchange_order_id.startswith("TESTNET-")


def test_adapter_aborts_if_client_ignores_sandbox():
    """A ccxt build that silently ignores set_sandbox_mode must NOT trade."""
    a = _adapter(factory_kw={"honors_sandbox": False})
    with pytest.raises(AdapterSafetyError, match="sandbox"):
        a.submit_intent(side="buy", symbol="BTC/USDT", notional=100.0, client_order_id="sig-2", creds=CREDS)


# ── credentials + inputs are fail-closed ────────────────────────────────────

def test_missing_credentials_abort():
    a = _adapter()
    with pytest.raises(AdapterSafetyError):
        a.submit_intent(side="buy", symbol="BTC/USDT", notional=100.0, client_order_id="s", creds=None)


def test_incomplete_credentials_abort():
    a = _adapter()
    with pytest.raises(AdapterSafetyError):
        a.submit_intent(side="buy", symbol="BTC/USDT", notional=100.0, client_order_id="s",
                        creds=ExchangeCreds(api_key="", api_secret=""))


def test_bad_side_and_nonpositive_notional_abort():
    a = _adapter()
    with pytest.raises(AdapterSafetyError):
        a.submit_intent(side="short", symbol="BTC/USDT", notional=100.0, client_order_id="s", creds=CREDS)
    with pytest.raises(AdapterSafetyError):
        a.submit_intent(side="buy", symbol="BTC/USDT", notional=0, client_order_id="s", creds=CREDS)


def test_zero_price_aborts():
    a = _adapter(factory_kw={"price": 0.0})
    with pytest.raises(AdapterSafetyError):
        a.submit_intent(side="buy", symbol="BTC/USDT", notional=100.0, client_order_id="s", creds=CREDS)


def test_client_order_id_is_passed_as_idempotency_key():
    fake_holder = {}

    def factory(ex, cfg):
        f = FakeExchange(cfg)
        fake_holder["f"] = f
        return f

    a = CcxtTestnetAdapter("bybit", environment="testnet", exchange_factory=factory)
    a.submit_intent(side="sell", symbol="ETH/USDT", notional=10.0, client_order_id="sig-42", creds=CREDS)
    _, _, _, _, params = fake_holder["f"].orders[0]
    assert params["clientOrderId"] == "sig-42"
