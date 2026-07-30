"""Batch backtest runner with async execution and progress tracking."""
from __future__ import annotations
import asyncio
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Optional

from app.models import BacktestResult, RunInput, StrategyConfig, DEFAULT_BUCKET_AMOUNT
from app.backtest.engine_adapter import run_engine_backtest
from app.data.symbols import BUCKET_MAP, get_all_symbols_for_run
from app.data.crypto import fetch_crypto_ohlcv
from app.data.equities import fetch_equity_ohlcv
from app import database as db


logger = logging.getLogger(__name__)

# Global executor for CPU-bound backtest work
_executor = ThreadPoolExecutor(max_workers=4)

# Track active run tasks
_active_runs: dict[str, asyncio.Task] = {}
_current_symbols: dict[str, str] = {}
_start_times: dict[str, float] = {}


def _notify_run_finished(run_id: str) -> None:
    """Fire a Telegram 'run finished' notification without blocking the run.

    Lazy-imported to avoid a circular import, and scheduled as a background task
    so a Telegram failure can never fail the backtest itself.
    """
    try:
        from app.services import telegram as tg  # local import: avoids circular import

        async def _send():
            try:
                await tg.notify_run_finished(run_id)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Run-finished Telegram notify failed: %s", exc)

        asyncio.create_task(_send())
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not schedule run-finished notify: %s", exc)


def _warmup_bars(config: StrategyConfig) -> int:
    """Bars of history the Gaussian channel needs before its signals are usable.

    The N-pole IIR filter settles over roughly the sampling period, so we require
    the sampling period plus a comfortable buffer — and never fewer than 60, the
    same floor the live scanner uses (``signals._gaussian_channel``)."""
    try:
        per = int(getattr(config, "samplingPeriod", 147) or 147)
    except (TypeError, ValueError):
        per = 147
    return max(60, per + 50)


def _fetch_ohlcv(symbol: str, bucket: str, config: StrategyConfig):
    """Fetch OHLCV data based on asset type.

    Crypto warm-up parity with the daily scan: the scanner calls
    ``fetch_crypto_ohlcv`` with NO ``start_date``, so the exchange returns the
    most-recent ~1000 bars and the Gaussian filter always has ample warm-up. The
    backtest instead fetches *from* ``startDate`` (``since`` = 2018-01-01 by
    default) — which can either return too few bars OR **hard-fail**: when the
    region geo-blocks Binance (HTTP 451) the resolved source is a fallback such
    as gate/kucoin, and those reject a far-past ``since``+``limit`` range, so the
    start-date fetch RAISES even though the scan's ``since=None`` fetch works on
    the very same source. Either way we must fall back to the scan-parity fetch;
    otherwise every symbol fails and the backtest looks dead while the scan is
    fine. So we treat a raised start-date fetch the same as a short one and refetch
    the most-recent full history exactly like the scan — the engine still masks
    trading to ``startDate..endDate``, so a healthy long backtest (whose first
    fetch already covers the warm-up need) is unaffected.

    If the scan-parity refetch itself fails, that error is RAISED for crypto
    (``raise_errors=True``) so the caller reports the REAL exchange error rather
    than a generic "Insufficient data"."""
    if bucket == "crypto":
        warmup = _warmup_bars(config)
        # Per-symbol retry parity with the daily scan (``signals._fetch_crypto_df``):
        # a transient 429/timeout shouldn't fail the symbol. Retry the whole fetch
        # 3× with light backoff (0.4s, 0.8s — which also paces the exchange). The
        # underlying ``fetch_crypto_ohlcv`` already cascades across exchanges per
        # attempt; this adds resilience to transient throttling on top of that.
        attempts = 3
        last_exc: Optional[Exception] = None
        for attempt in range(attempts):
            try:
                # Try the precise start-date window first, but never let its failure
                # abort the symbol: the geo-fallback exchanges raise on a far-past
                # ``since``.
                df = None
                try:
                    df = fetch_crypto_ohlcv(
                        symbol, timeframe=config.timeframe,
                        start_date=config.startDate, raise_errors=True,
                    )
                except Exception as e:  # noqa: BLE001 — fall through to scan-parity fetch
                    logger.debug("Backtest start-date fetch failed for %s (falling back "
                                 "to scan-parity fetch): %s", symbol, e)
                if df is None or len(df) < warmup:
                    # Scan parity: no start_date → most-recent ~1000 bars (ample
                    # warm-up). raise_errors=True so a genuine outage surfaces the
                    # real error.
                    df = fetch_crypto_ohlcv(
                        symbol, timeframe=config.timeframe,
                        start_date=None, raise_errors=True,
                    )
                return df
            except Exception as e:  # noqa: BLE001 — transient: retry with backoff
                last_exc = e
                logger.debug("Crypto fetch attempt %d/%d failed for %s: %s",
                             attempt + 1, attempts, symbol, e)
                if attempt + 1 < attempts:
                    time.sleep(0.4 * (attempt + 1))
        # All retries exhausted — surface the REAL exchange error (not "Insufficient
        # data") so the per-symbol result reports what actually went wrong.
        raise last_exc
    try:
        return fetch_equity_ohlcv(
            symbol,
            timeframe=config.timeframe,
            start_date=config.startDate,
            end_date=config.endDate if config.endDate != "2069-12-31" else None,
            raise_errors=True,
        )
    except Exception as e:
        # Surface the REAL yfinance/Stooq error per symbol instead of collapsing
        # every failure to the generic "Insufficient data" (mirrors the crypto
        # branch). Propagates to ``_run_single_backtest`` → ``errorMessage``.
        logger.warning(f"Data fetch failed for {symbol}: {e}")
        raise


def _run_single_backtest(
    symbol: str,
    name: str,
    bucket: str,
    config: StrategyConfig,
    initial_capital: float = DEFAULT_BUCKET_AMOUNT,
) -> BacktestResult:
    """Run one backtest synchronously (called in thread pool)."""
    try:
        df = _fetch_ohlcv(symbol, bucket, config)
        warmup = _warmup_bars(config)
        if df is None or len(df) < warmup:
            got = 0 if df is None else len(df)
            per = int(getattr(config, "samplingPeriod", 147) or 147)
            return BacktestResult(
                symbol=symbol, name=name, bucket=bucket,
                totalReturn=0, cagr=0, maxDrawdown=0, winRate=0,
                sharpe=0, tradeCount=0, initialCapital=initial_capital,
                errorMessage=f"Insufficient data: {got} bars (need ≥{warmup} to warm up the {per}-period filter)"
            )

        outcome = run_engine_backtest(df, config, initial_capital=initial_capital)

        result = BacktestResult(
            symbol=symbol, name=name, bucket=bucket,
            totalReturn=outcome.totalReturn, cagr=outcome.cagr,
            maxDrawdown=outcome.maxDrawdown, winRate=outcome.winRate,
            sharpe=outcome.sharpe, tradeCount=outcome.tradeCount,
            initialCapital=initial_capital,
        )
        return result, outcome.trades, outcome.equityCurve

    except Exception as e:
        logger.error(f"Backtest error for {symbol}: {e}", exc_info=True)
        err_result = BacktestResult(
            symbol=symbol, name=name, bucket=bucket,
            totalReturn=0, cagr=0, maxDrawdown=0, winRate=0,
            sharpe=0, tradeCount=0, initialCapital=initial_capital,
            errorMessage=str(e)[:200]
        )
        return err_result, [], []


async def run_backtest_batch(run_id: str, run_input: RunInput):
    """Main async runner. Fetches and backtests all symbols, saving progress to DB."""
    loop = asyncio.get_event_loop()
    config = run_input.config

    if run_input.symbols:
        # Single-/multi-symbol mode: backtest ONLY the exact symbols the user picked
        # (from the same universe the scan draws from). Their bucket is buckets[0];
        # names come from the static bucket list when known, else the symbol itself.
        bkt = run_input.buckets[0] if run_input.buckets else "crypto"
        static = dict(BUCKET_MAP.get(bkt, []))
        symbols = [(s, static.get(s, s), bkt) for s in run_input.symbols]
    else:
        symbols = get_all_symbols_for_run(run_input.buckets, run_input.symbolLimit)
    total = len(symbols)

    bucket_amounts = run_input.bucketAmounts or {}

    def _amount_for(bucket: str) -> float:
        amt = bucket_amounts.get(bucket, DEFAULT_BUCKET_AMOUNT)
        return amt if amt and amt > 0 else DEFAULT_BUCKET_AMOUNT

    db.update_run_status(run_id, "running", total_symbols=total,
                         completed_symbols=0, failed_symbols=0)
    _start_times[run_id] = time.time()

    try:
        sem = asyncio.Semaphore(4)

        async def process_symbol(symbol: str, name: str, bucket: str):
            async with sem:
                _current_symbols[run_id] = symbol
                try:
                    # Per-symbol timeout: a single slow/hung data fetch must never
                    # stall the whole run. If a symbol exceeds the budget, skip it.
                    outcome = await asyncio.wait_for(
                        loop.run_in_executor(
                            _executor, _run_single_backtest, symbol, name, bucket, config,
                            _amount_for(bucket),
                        ),
                        timeout=45,
                    )
                    if isinstance(outcome, tuple):
                        result, trades, equity_curve = outcome
                    else:
                        result, trades, equity_curve = outcome, [], []

                    db.save_result(run_id, result, equity_curve, trades)
                    db.increment_run_progress(run_id, success=(result.errorMessage is None))
                except asyncio.TimeoutError:
                    logger.warning("Backtest timed out for %s (skipped)", symbol)
                    db.increment_run_progress(run_id, success=False)
                except Exception as e:
                    logger.error(f"Failed to process {symbol}: {e}", exc_info=True)
                    db.increment_run_progress(run_id, success=False)

        tasks = [process_symbol(sym, name, bucket) for sym, name, bucket in symbols]
        await asyncio.gather(*tasks, return_exceptions=True)

        db.flag_outliers(run_id)
        db.update_run_status(
            run_id, "completed",
            completed_at=datetime.now(timezone.utc).isoformat()
        )
        _notify_run_finished(run_id)

    except asyncio.CancelledError:
        db.update_run_status(run_id, "cancelled",
                             completed_at=datetime.now(timezone.utc).isoformat())
        raise
    except Exception as e:
        logger.error(f"Run {run_id} failed: {e}", exc_info=True)
        db.update_run_status(
            run_id, "failed",
            completed_at=datetime.now(timezone.utc).isoformat(),
            error_message=str(e)[:500]
        )
    finally:
        _active_runs.pop(run_id, None)
        _current_symbols.pop(run_id, None)
        _start_times.pop(run_id, None)


async def run_preview(config: StrategyConfig, symbols, initial_capital: float = DEFAULT_BUCKET_AMOUNT):
    """Run the strategy on a small symbol set synchronously and return results.

    Used by the 'top-N coins' preview dashboard — no run record is persisted.
    ``symbols`` is a list of (symbol, name) tuples; all are treated as crypto.
    """
    loop = asyncio.get_event_loop()
    sem = asyncio.Semaphore(4)

    async def _one(symbol: str, name: str) -> BacktestResult:
        async with sem:
            outcome = await loop.run_in_executor(
                _executor, _run_single_backtest, symbol, name, "crypto", config, initial_capital,
            )
            return outcome[0] if isinstance(outcome, tuple) else outcome

    tasks = [_one(sym, name) for sym, name in symbols]
    return await asyncio.gather(*tasks)


def start_run(run_id: str, run_input: RunInput):
    """Schedule a backtest run as a background asyncio task."""
    task = asyncio.create_task(run_backtest_batch(run_id, run_input))
    _active_runs[run_id] = task
    return task


def cancel_run(run_id: str) -> bool:
    task = _active_runs.get(run_id)
    if task and not task.done():
        task.cancel()
        return True
    return False


def get_current_symbol(run_id: str) -> Optional[str]:
    return _current_symbols.get(run_id)


def get_estimated_remaining(run_id: str, completed: int, total: int) -> Optional[float]:
    if completed == 0 or total == 0:
        return None
    elapsed = time.time() - _start_times.get(run_id, time.time())
    rate = completed / elapsed if elapsed > 0 else None
    if not rate:
        return None
    remaining = (total - completed) / rate
    return round(remaining, 1)
