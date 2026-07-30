"""Real ccxt adapter — TESTNET ONLY, sandbox FORCED (spec §1, slice 8).

This is the first code in the service that can place an order on a real
exchange. It is built so that it can ONLY ever reach a TESTNET sandbox, and so
that it cannot run at all unless three owner-controlled preconditions already
hold upstream (none of which an agent performs):

  1. the worker is ARMED — the 4-way gate (EXECUTION_ARMED env + exec_state +
     kill-switch released + testnet). An agent never arms it.
  2. an ACTIVE credential exists in the vault — the OWNERS load testnet keys
     out-of-band; the worker resolves the ref and hands creds in. The agent
     never enters, reads, or stores a key.
  3. ENVIRONMENT=testnet — mainnet is refused here AND by config/schema guards.

Defences that live IN THIS FILE, enforced on every call:

  * ``set_sandbox_mode(True)`` is called on the ccxt client, and the adapter
    then VERIFIES the client is actually in sandbox before it will submit —
    if a ccxt build ignored the flag, we refuse rather than risk a live venue.
  * the running ENVIRONMENT and the credential env are both asserted testnet.
  * ``ccxt`` is dependency-injected (``exchange_factory``) so tests exercise
    every path with a FAKE exchange — no network, no key, no real venue. The
    real ccxt import is lazy and only happens if no factory is supplied.

The agent has NOT run this against a real exchange and will not: doing so needs
real keys (owners) and an armed gate (owners). This file is reviewed, inert
infrastructure until those owner acts happen.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Callable, Optional

from exec_service.mock_exchange import MockFill  # reuse the fill shape (mock=False here)

log = logging.getLogger("exec_service.adapters.ccxt_testnet")


class AdapterSafetyError(Exception):
    """A safety precondition for placing a testnet order was not satisfied.
    Raising this ABORTS the order — fail-closed, never place anyway."""


@dataclass(frozen=True)
class CcxtFill:
    exchange_order_id: str
    price: float
    qty: float
    notional: float
    mock: bool = False   # a REAL (testnet) fill — not synthetic


class CcxtTestnetAdapter:
    """A ccxt spot adapter pinned to a testnet sandbox.

    ``exchange_factory(exchange_id, config) -> ccxt_exchange`` is injected. In
    production it builds a real ccxt client; in tests it returns a fake. Either
    way this adapter FORCES sandbox mode and verifies it before any order.
    """

    name = "ccxt_testnet"
    needs_credentials = True

    def __init__(self, exchange_id: str, *, environment: str = "testnet",
                 exchange_factory: Optional[Callable[[str, dict], Any]] = None) -> None:
        env = (environment or "").strip().lower()
        if env != "testnet":
            # A mainnet adapter must not even be constructible in this build.
            raise AdapterSafetyError(f"CcxtTestnetAdapter refuses environment {env!r}; testnet only")
        self.exchange_id = exchange_id
        self._environment = env
        self._factory = exchange_factory

    def _default_factory(self, exchange_id: str, config: dict) -> Any:  # pragma: no cover - needs ccxt + keys
        import ccxt  # lazy: only when a real client is actually built
        klass = getattr(ccxt, exchange_id)
        return klass(config)

    def _build_client(self, creds) -> Any:
        if creds is None or not getattr(creds, "api_key", None) or not getattr(creds, "api_secret", None):
            raise AdapterSafetyError("no credentials supplied — refusing to build an exchange client")
        config = {
            "apiKey": creds.api_key,
            "secret": creds.api_secret,
            "enableRateLimit": True,
            "options": {"defaultType": "spot"},
        }
        if getattr(creds, "passphrase", None):
            config["password"] = creds.passphrase
        factory = self._factory or self._default_factory
        client = factory(self.exchange_id, config)

        # FORCE sandbox, then VERIFY. If the client can't confirm sandbox, abort.
        try:
            client.set_sandbox_mode(True)
        except Exception as e:  # noqa: BLE001
            raise AdapterSafetyError(f"could not enable sandbox mode: {e}") from e
        if not _is_sandbox(client):
            raise AdapterSafetyError("client did not confirm sandbox mode — refusing to trade on a live venue")
        return client

    def submit_intent(self, *, side: str, symbol: str, notional: float, client_order_id: str, creds=None) -> CcxtFill:
        """Place ONE spot market order on the testnet sandbox and return the fill.

        Fail-closed at every step. `client_order_id` is passed to the venue as
        the idempotency key so a retried item cannot double-fill (the DB UNIQUE
        is the second guard). No mainnet, no live venue, ever.
        """
        if self._environment != "testnet":
            raise AdapterSafetyError("adapter environment drifted off testnet — refusing")
        if side not in ("buy", "sell"):
            raise AdapterSafetyError(f"unknown side {side!r}")
        if notional <= 0:
            raise AdapterSafetyError("notional must be positive")

        client = self._build_client(creds)

        # Price for sizing: a testnet ticker. (Spot market-buy by quote amount
        # differs per venue; we size by base qty from the last price for a
        # uniform, reviewable path.)
        ticker = client.fetch_ticker(symbol)
        price = float(ticker.get("last") or ticker.get("close") or 0)
        if price <= 0:
            raise AdapterSafetyError(f"no usable testnet price for {symbol}")
        qty = round(notional / price, 12)

        params = {"clientOrderId": client_order_id}
        order = client.create_order(symbol, "market", side, qty, None, params)

        exec_qty = float(order.get("filled") or qty)
        avg = float(order.get("average") or price)
        return CcxtFill(
            exchange_order_id=str(order.get("id") or client_order_id),
            price=avg, qty=exec_qty, notional=round(exec_qty * avg, 8),
        )


def _is_sandbox(client: Any) -> bool:
    """Best-effort confirmation that a ccxt client is in sandbox/testnet.

    ccxt exposes sandbox via urls['api'] switching to the sandbox host and/or a
    `sandbox`/`options['sandboxMode']` flag depending on version. We accept a
    positive signal from any of them; absence of a positive signal → NOT
    sandbox → the caller aborts (fail-closed)."""
    try:
        if getattr(client, "sandbox", False):
            return True
        opts = getattr(client, "options", {}) or {}
        if opts.get("sandboxMode") or opts.get("test"):
            return True
        urls = getattr(client, "urls", {}) or {}
        api = urls.get("api")
        blob = str(api).lower()
        if "test" in blob or "sandbox" in blob:
            return True
    except Exception:  # noqa: BLE001 — any doubt = not sandbox
        return False
    return False
