"""Dedicated CRYPTO trend scan (Phase 2c). ⚠️ NEW · SIMULATION-ONLY.

Feeds the DR-Crypto trend pilot. Fully separate from the live crypto ``daily_scan`` (which produces
Gaussian-band tiers for pilots 1/2): this computes Donchian(20) + 200-SMA + rolling Chandelier(22,3)
signals (dr_strategies.py) and caches them under their OWN singleton ``daily_scan_dr_crypto`` — NEVER
the live ``daily_scan`` key. The DR paper-sim reads ONLY this singleton. Read-only market data; no
orders, no money.

Reuses the proven bounded crypto fetch (signals._gather_symbol_dfs), same per-symbol/overall deadlines
as the main scan. Scheduled at 00:08 UTC — after the 00:05 crypto scan + 00:06 MR scan, before the 00:10
pilot batch. ENABLED by default (DR_SCAN_ENABLED=0 disables). Bounded + fully guarded: a fetch hiccup
keeps the previous snapshot and never crashes the app.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

from app import database as db
from app.services import dr_strategies as dr
from app.services import signals as sig

logger = logging.getLogger("algo770")

CRYPTO_LIMIT = max(10, min(600, int(os.getenv("DR_CRYPTO_LIMIT", "250"))))
PER_SYMBOL_TIMEOUT = 25.0
OVERALL_TIMEOUT = 1000.0
SCAN_HOUR_UTC = 0
SCAN_MINUTE_UTC = 8
MIN_SAVE_SIGNALS = 10
STALE_AFTER_SECONDS = 6 * 3600

_running = False


def next_run(now: datetime) -> datetime:
    nxt = now.replace(hour=SCAN_HOUR_UTC, minute=SCAN_MINUTE_UTC, second=0, microsecond=0)
    if nxt <= now:
        nxt += timedelta(days=1)
    return nxt


def is_scanning() -> bool:
    return _running


async def run_dr_scan_now() -> dict:
    """Run the crypto trend scan once and cache it under the dedicated DR singleton. Returns the
    cached payload. Read-only market data — no orders, no money."""
    global _running
    if _running:
        return db.get_daily_scan_dr_crypto()
    _running = True
    try:
        rows = await sig._gather_symbol_dfs(
            ["crypto"], crypto_limit=CRYPTO_LIMIT, stock_limit=0,
            crypto_fetch_limit=260,   # ≥210 bars so the latest 200-SMA + Chandelier(22) are always valid
            per_symbol_timeout=PER_SYMBOL_TIMEOUT, overall_timeout=OVERALL_TIMEOUT,
        )
        from app.data import market_exchange as _mx
        exch = None
        try:
            exch = _mx.market_exchange_id()
        except Exception:  # noqa: BLE001
            exch = None
        signals = []
        for sym, name, bucket, df in rows:
            if bucket != "crypto" or df is None:
                continue
            s = dr.latest_signal(df, sym, name, exch)
            if s is not None:
                signals.append(s)
        n_entries = sum(1 for s in signals if s.get("entry"))
        logger.info("DR crypto scan: universe=%d classified=%d entries=%d exchange=%s",
                    CRYPTO_LIMIT, len(signals), n_entries, exch)
        if len(signals) >= MIN_SAVE_SIGNALS:
            now = datetime.now(timezone.utc)
            db.save_daily_scan_dr_crypto(signals, now.isoformat(), next_run(now).isoformat())
            logger.info("DR crypto scan cached: %d signals", len(signals))
        else:
            logger.error(
                "DR crypto scan produced only %d signals (<%d) — crypto data layer likely "
                "unreachable this pass; keeping the previous cached snapshot", len(signals), MIN_SAVE_SIGNALS)
    except Exception:
        logger.exception("DR crypto scan failed; keeping the previous cached snapshot")
    finally:
        _running = False
    return db.get_daily_scan_dr_crypto()


def _is_stale(cached: dict) -> bool:
    ran = (cached or {}).get("ranAt")
    if not ran:
        return True
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(ran)).total_seconds()
        return age > STALE_AFTER_SECONDS
    except (TypeError, ValueError):
        return True


async def dr_scan_loop() -> None:
    """Daily crypto trend scan at 00:08 UTC, feeding the DR-Crypto pilot. Runs once on startup if
    stale, then daily. ENABLED by default (DR_SCAN_ENABLED=0 disables). Bounded + guarded."""
    if os.getenv("DR_SCAN_ENABLED", "1").lower() in ("0", "false", "no"):
        logger.info("DR crypto scan loop disabled via DR_SCAN_ENABLED=0")
        return
    try:
        if _is_stale(db.get_daily_scan_dr_crypto()):
            await run_dr_scan_now()
    except Exception as exc:  # never block boot
        logger.warning("startup DR scan check failed: %s", str(exc)[:200])
    while True:
        try:
            now = datetime.now(timezone.utc)
            await asyncio.sleep(max(60.0, (next_run(now) - now).total_seconds()))
            await run_dr_scan_now()
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # never let one bad pass kill the loop
            logger.warning("DR scan loop error: %s", str(exc)[:200])
            await asyncio.sleep(300)
