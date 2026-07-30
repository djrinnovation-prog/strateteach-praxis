"""Dedicated STOCKS mean-reversion scan (Phase 2b). ⚠️ NEW · PAPER-SIM-ONLY.

Why a SEPARATE scan (Dan-approved, money-safe isolation)
────────────────────────────────────────────────────────
The existing daily scan is crypto-only and produces Gaussian-band BREAKOUT tiers — a
different computation from mean-reversion, and its snapshot feeds the LIVE daily batch.
Rather than perturb that live-consumed path, this is a fully separate scan that:

  • reuses the PROVEN, battle-tested yfinance equity batch fetch (fetch_equity_batch_ohlcv,
    the same path Phase-2a validated on 150 stocks) — free, no API key,
  • computes the canonical RSI(2) / Bollinger(20,2) / 200-SMA signals (mr_strategies.py), and
  • caches them under their OWN singleton (``daily_scan_stocks_mr``) via
    db.save_daily_scan_stocks_mr — NEVER the crypto ``daily_scan`` key.

The mean-reversion paper-sim reads ONLY this singleton. This scan places no orders and
moves no money; it is pure read-only market data + strategy math.

CADENCE: once daily (these are end-of-day daily-bar strategies). The background loop is
OPT-IN via the ``MR_SCAN_ENABLED`` env flag and is intentionally NOT wired into app startup
yet — during Phase 2b the scan is driven on-demand by the paper-sim / replay harness. This
keeps prod behaviour unchanged until the sleeve is approved past the paper stage.
"""
from __future__ import annotations

import asyncio
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from app import database as db
from app.data.equities import fetch_equity_batch_ohlcv
from app.data.stock_universe import get_stock_symbols_for_limit
from app.services import mr_strategies as mr

logger = logging.getLogger("algo770")

# Universe locked to Phase-2a's tested top-150 (configurable to widen later, per Dan).
STOCK_LIMIT = max(10, min(500, int(os.getenv("MR_STOCK_LIMIT", "150"))))

# Fetch history start — generous fixed warmup so the 200-SMA is always valid for the latest
# bar (NOT a strategy parameter; pure data warmup). ~3.5y covers 200-SMA with wide headroom.
FETCH_START = os.getenv("MR_FETCH_START", "2023-01-01")

# Scheduled at 00:06 UTC — after the 00:05 crypto scan starts, and BEFORE the 00:10 pilot
# batch so the MR pilot reads a fresh snapshot. US daily bars have settled by UTC midnight,
# so an end-of-day daily-bar scan here is correct. yfinance batch of ~150 completes in well
# under a minute; the overall timeout below is a hard backstop so it can never hang the app.
SCAN_HOUR_UTC = 0
SCAN_MINUTE_UTC = 6

MIN_SAVE_SIGNALS = 10          # don't overwrite a good snapshot with a mostly-unreachable pass
OVERALL_TIMEOUT = 300.0        # hard cap on the fetch+compute (s) — bounded, can't hang the loop
STALE_AFTER_SECONDS = 6 * 3600  # re-run on startup if the cached snapshot is older than this

_running = False


def next_run(now: datetime) -> datetime:
    nxt = now.replace(hour=SCAN_HOUR_UTC, minute=SCAN_MINUTE_UTC, second=0, microsecond=0)
    if nxt <= now:
        nxt += timedelta(days=1)
    return nxt


def is_scanning() -> bool:
    return _running


def _fetch_universe() -> "list[tuple[str, str]]":
    """Top-N stock (symbol, name) pairs from the existing 500-symbol universe."""
    return get_stock_symbols_for_limit(STOCK_LIMIT)


def build_signals() -> "list[dict]":
    """Fetch the stock universe and compute the per-symbol mean-reversion snapshot for
    BOTH strategies. Pure/synchronous — reusable by the loop and by the replay harness.
    Returns the list of latest-bar signal dicts (one per symbol with valid 200-SMA)."""
    universe = _fetch_universe()
    symbols = [s for s, _n in universe]
    names = {s: n for s, n in universe}
    df_map = fetch_equity_batch_ohlcv(symbols, start_date=FETCH_START)
    signals: list[dict] = []
    for sym in symbols:
        df = df_map.get(sym)
        sig = mr.latest_signal(df, sym, names.get(sym, sym)) if df is not None else None
        if sig is not None:
            signals.append(sig)
    return signals


async def run_mr_scan_now() -> dict:
    """Run the stocks mean-reversion scan once and cache it under the dedicated singleton.
    Returns the cached payload. Read-only market data — no orders, no money."""
    global _running
    if _running:
        return db.get_daily_scan_stocks_mr()
    _running = True
    try:
        loop = asyncio.get_event_loop()
        with ThreadPoolExecutor(max_workers=1) as pool:
            # Hard overall timeout so a yfinance hiccup can never hang the app; on timeout we
            # keep the previous cached snapshot (below) rather than blanking the board.
            signals = await asyncio.wait_for(
                loop.run_in_executor(pool, build_signals), timeout=OVERALL_TIMEOUT)
        n_entries_rsi2 = sum(1 for s in signals if (s.get("entry") or {}).get("rsi2"))
        n_entries_bb = sum(1 for s in signals if (s.get("entry") or {}).get("bb"))
        logger.info(
            "MR stocks scan: universe=%d classified=%d rsi2_entries=%d bb_entries=%d",
            STOCK_LIMIT, len(signals), n_entries_rsi2, n_entries_bb,
        )
        if len(signals) >= MIN_SAVE_SIGNALS:
            now = datetime.now(timezone.utc)
            db.save_daily_scan_stocks_mr(signals, now.isoformat(), next_run(now).isoformat())
            logger.info("MR stocks scan cached: %d signals", len(signals))
        else:
            logger.error(
                "MR stocks scan produced only %d signals (<%d) — yfinance likely "
                "unreachable this pass; keeping the previous cached snapshot",
                len(signals), MIN_SAVE_SIGNALS,
            )
    except Exception:
        logger.exception("MR stocks scan failed; keeping the previous cached snapshot")
    finally:
        _running = False
    return db.get_daily_scan_stocks_mr()


def _is_stale(cached: dict) -> bool:
    ran = (cached or {}).get("ranAt")
    if not ran:
        return True
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(ran)).total_seconds()
        return age > STALE_AFTER_SECONDS
    except (TypeError, ValueError):
        return True


async def mr_scan_loop() -> None:
    """Daily stocks mean-reversion scan at 00:06 UTC, feeding the MR pilot. Runs once on
    startup if the cached snapshot is stale, then every day. ENABLED by default in prod; set
    MR_SCAN_ENABLED=0 to disable. Bounded (OVERALL_TIMEOUT) and fully guarded — a yfinance
    hiccup keeps the previous snapshot and never crashes the app or the loop."""
    if os.getenv("MR_SCAN_ENABLED", "1").lower() in ("0", "false", "no"):
        logger.info("MR stocks scan loop disabled via MR_SCAN_ENABLED=0")
        return
    try:
        if _is_stale(db.get_daily_scan_stocks_mr()):
            await run_mr_scan_now()
    except Exception as exc:  # never block boot
        logger.warning("startup MR scan check failed: %s", str(exc)[:200])
    while True:
        try:
            now = datetime.now(timezone.utc)
            await asyncio.sleep(max(60.0, (next_run(now) - now).total_seconds()))
            await run_mr_scan_now()
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # never let one bad pass kill the loop
            logger.warning("MR scan loop error: %s", str(exc)[:200])
            await asyncio.sleep(300)
