"""StrateTeach isolated execution service — Phase 1, slice 1 (DISARMED scaffold).

What exists here: the schema, the disarmed master gate + kill-switch state, the
role boundary, and the append-only audit writer.

What deliberately does NOT exist yet (later slices, spec §9):
  * signal ingress / HMAC verification (slice 2)
  * durable queue + sweeper            (slice 3)
  * worker, sizing, order placement    (slice 4)
  * vault client / any credential resolution (slice 5)
  * any exchange adapter, any ccxt import, any network call to an exchange

Nothing in this package can place an order, move money, or read a key. That is
the point of the slice, not an omission.
"""
from __future__ import annotations

__version__ = "0.1.0-slice1-disarmed"

#: This build is testnet-only and cannot be armed by editing a constant.
#: See config.py (env-guard) and state.py (the four-way AND).
PHASE = 1
SLICE = 1
