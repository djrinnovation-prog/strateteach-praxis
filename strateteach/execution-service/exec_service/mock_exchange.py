"""MOCK exchange adapter (slice 4) — synthetic fills, ZERO network, ZERO keys.

This is the worker's test double: it talks to NOTHING. No import touches the
network, no key material exists, and the "fill" is arithmetic on a synthetic
price. Its entire purpose is to let the worker's gate/caps/idempotency logic
be exercised end-to-end on a throwaway database before any real adapter
exists (a real testnet adapter is slice 5+, under owner review, behind the
same gate).

The worker takes an adapter as an EXPLICIT argument. There is no default, no
registry, no env-var that selects an adapter — wiring a real one in will be a
deliberate, reviewable act.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class MockFill:
    """A synthetic execution result. `mock` is always True — rows written from
    this adapter are unmistakably fake, even in the database."""

    exchange_order_id: str
    price: float
    qty: float
    notional: float
    mock: bool = True


class MockExchange:
    """Fills every intent instantly at a fixed synthetic price."""

    name = "mock"

    def __init__(self, price: float | None = None) -> None:
        env_price = os.environ.get("EXEC_MOCK_PRICE")
        self.price = float(price if price is not None else (env_price or 100.0))
        self._seq = 0

    #: A real adapter NEEDS credentials; the mock explicitly does not. It accepts
    #: the `creds` kwarg only so the worker's resolve-then-call wiring is exercised
    #: end-to-end — and it immediately discards them (they are throwaway
    #: placeholders in tests anyway; a real key never reaches this slice).
    needs_credentials = False

    def submit_intent(self, *, side: str, symbol: str, notional: float, client_order_id: str, creds=None) -> MockFill:
        """Return a synthetic, fully-"filled" result. Sends nothing anywhere.
        `creds` is accepted and ignored — the mock touches no key, real or fake."""
        del creds  # never inspected, never stored, never logged
        if notional <= 0:
            raise ValueError("notional must be positive")
        self._seq += 1
        return MockFill(
            exchange_order_id=f"MOCK-{client_order_id}-{self._seq}",
            price=self.price,
            qty=round(notional / self.price, 12),
            notional=float(notional),
        )
