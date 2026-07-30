"""Automatic daily breakout scan that feeds the Profit Engine.

Runs once every 24h at 00:05 UTC, plus once on startup if the cache is stale.
The result (the day's crypto breakouts) is cached in the DB so the Profit Engine
and the scan card read a single, consistent snapshot instead of re-scanning. A
manual run can be triggered from the UI ("+" button) via run_scan_now().

Implemented as a plain asyncio loop — no extra scheduler dependency. The task is
launched from the FastAPI startup hook and re-arms itself after every run, so a
redeploy simply restarts the loop.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

from app import database as db
from app.services import notify
from app.services import signals as sig

logger = logging.getLogger("algo770")

SCAN_HOUR_UTC = 0
SCAN_MINUTE_UTC = 5
# Crypto universe size (top-N USDT pairs ranked by 24h volume) scanned in the
# background; this cached snapshot is what the Profit Engine + AutoPilots consume,
# so breadth here = the opportunity set. The top-N by volume are the most liquid /
# tradeable, so a smaller N is not "worse coverage" — it's the relevant coverage.
#
# WHY 250 (Dan's call): prod proved the fetch is LATENCY-bound — binance is
# reachable but SLOW from prod's egress, so a 500-universe was ~95% timing out and
# returning fewer real candidates than a smaller universe that actually COMPLETES.
# 250 halves the wall-clock and, with the latency re-tune (fetch client 20s,
# CRYPTO_FETCH_CONCURRENCY=12, per-symbol 25s, overall 1000s, loose rate gate),
# should finish with a HIGH fraction fetched. A stuck/slow symbol is DROPPED (not
# retried-to-death) and whatever completed (≥MIN_SAVE_SIGNALS) is saved — never
# hangs. Env-overridable (SCAN_CRYPTO_LIMIT) so we can retune without a code change;
# confirm the live value via /signals/scan-cache → tuning.universe.
def _env_int(name: str, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(os.getenv(name, str(default)))))
    except (TypeError, ValueError):
        return default


CRYPTO_LIMIT = _env_int("SCAN_CRYPTO_LIMIT", 250, 10, 600)

# Save the scan whenever it yields at least this many signals. A full scan of 120
# normally returns dozens; a result below this almost certainly means the data
# layer was mostly unreachable this pass, so we keep the last good snapshot rather
# than overwrite it with a near-empty board. Crucially this is NOT all-or-nothing:
# a healthy partial scan (e.g. 60 of 120 symbols fetched) is still saved.
MIN_SAVE_SIGNALS = 10

# Re-run on startup if the cached scan is older than this. Kept short (6h, not 24h)
# so each deploy/restart refreshes reasonably-fresh data: with frequent deploys a
# 24h gate meant the startup self-heal almost never fired and the board could sit
# stale for a full day. The scheduled 00:05 UTC run is unaffected.
STALE_AFTER_SECONDS = 6 * 3600

# Per-symbol + overall fetch deadlines for the daily scan (module constants so the
# /signals/scan-cache diagnostic can echo the LIVE tuning to confirm a re-tune has
# deployed). Tuned for a LATENCY-bound (slow-binance) prod: per-symbol sits above
# the 20s fetch-client timeout so the client governs; overall gives the 12-wide
# pool room to attempt all 500 even when many run long. Hard caps — can't hang.
DAILY_PER_SYMBOL_TIMEOUT = 25.0
DAILY_OVERALL_TIMEOUT = 1000.0

_running = False  # guard so two scans never overlap


def next_run(now: datetime) -> datetime:
    """The next 00:05 UTC at or after `now`."""
    nxt = now.replace(hour=SCAN_HOUR_UTC, minute=SCAN_MINUTE_UTC, second=0, microsecond=0)
    if nxt <= now:
        nxt += timedelta(days=1)
    return nxt


def _breakout_digest(signals: list[dict], top: int = 5) -> str:
    """A short breakout digest for the alert channels (top movers by today's %)."""
    ranked = sorted(signals, key=lambda s: abs(float(s.get("changeTodayPct") or 0)), reverse=True)
    lines = []
    for s in ranked[:top]:
        sym = s.get("symbol") or "?"
        chg = float(s.get("changeTodayPct") or 0)
        arrow = "▲" if chg >= 0 else "▼"
        lines.append(f"{sym} {arrow}{abs(chg):.1f}%")
    body = "📈 Strateteach breakout scan — top movers: " + ", ".join(lines)
    return body[:900]


def notify_breakout_subscribers(signals: list[dict]) -> int:
    """Send the day's breakout digest to each user who opted into `breakout` alerts
    AND has a delivery channel enabled. Strictly per-user via notify_user (which
    enforces per-user opt-in + channel) — no global fan-out, no shared state.
    Deduped to once per calendar day so a startup + scheduled run don't double-send.
    Returns how many users were queued."""
    if not signals:
        return 0
    today = datetime.now(timezone.utc).date().isoformat()
    if db._get_singleton("breakout_notify_last", None) == today:
        return 0
    text = _breakout_digest(signals)
    sent = 0
    try:
        users = db.list_users()
    except Exception as exc:  # noqa: BLE001
        logger.warning("breakout notify: list_users failed: %s", exc)
        return 0
    for u in users:
        try:
            if notify.notify_user(u["username"], text, kind="breakout"):
                sent += 1
        except Exception as exc:  # noqa: BLE001 — one user must never break the loop
            logger.warning("breakout notify failed for %s: %s", u.get("username"), exc)
    db._set_singleton("breakout_notify_last", today)
    if sent:
        logger.info("breakout digest queued for %d subscriber(s)", sent)
    return sent


async def run_scan_now(*, notify_subscribers: bool = False) -> dict:
    """Run the breakout scan immediately and cache it. Returns the cached payload.

    ``notify_subscribers`` (only the scheduled daily run sets this) additionally
    fans the day's breakout digest to opted-in users' channels (incl. WhatsApp).
    """
    global _running
    if _running:
        return db.get_daily_scan()
    _running = True
    try:
        # Background job: bound each symbol (drop a stuck/geo-blocked one instead of
        # hanging the whole scan) but give the WHOLE gather a generous ceiling so the
        # full Top-CRYPTO_LIMIT universe has time to complete — this is the snapshot the
        # AutoPilots consume, so it must reliably carry the large universe, not collapse
        # to a partial/stale board when the exchange throttles.
        signals = await sig.run_breakout_scan(
            ["crypto"], crypto_limit=CRYPTO_LIMIT, stock_limit=0,
            # per_symbol raised 12→25s so the 20s fetch-client timeout (not the outer
            # bound) governs — binance is reachable but SLOW from prod, and the old
            # 12s bound was cutting off responses that just needed more time. overall
            # raised 720→1000s so the 12-wide pool can attempt all 500 even when many
            # run long. Constants so scan-cache can echo them. Hard cap, can't hang.
            per_symbol_timeout=DAILY_PER_SYMBOL_TIMEOUT,
            overall_timeout=DAILY_OVERALL_TIMEOUT,
        )
        # One-line observability on EVERY run: which exchange the data layer
        # resolved to, how many symbols were attempted vs fetched, and a couple of
        # representative failure reasons — so a degraded/partial pass (e.g. the
        # ~49-of-500 collapse) is diagnosable straight from the logs without
        # re-running /signals/scan-diag. Best-effort; never affects the scan.
        try:
            st = dict(getattr(sig, "_LAST_CRYPTO_FETCH", {}) or {})
            logger.info(
                "daily scan fetch: exchange=%s universe=%d attempted=%d ok=%d fail=%d "
                "classified=%d errors=%s",
                st.get("exchange"), CRYPTO_LIMIT, st.get("attempted", 0),
                st.get("ok", 0), st.get("fail", 0), len(signals),
                "; ".join(st.get("errors") or []) or "none",
            )
            # Persist the snapshot to the DB (survives restarts) so the CACHED
            # diagnostic — /signals/scan-cache — can report the LAST real full-500
            # pass instantly, with NO live probe. Persisted on EVERY run, including
            # a degraded <MIN_SAVE pass (that's exactly the case we need to see).
            db._set_singleton("scan_diag_last", {
                "at": datetime.now(timezone.utc).isoformat(),
                "exchange": st.get("exchange"),
                "universe": CRYPTO_LIMIT,
                "attempted": st.get("attempted", 0),
                "ok": st.get("ok", 0),
                "fail": st.get("fail", 0),
                "classified": len(signals),
                "errors": st.get("errors") or [],
            })
        except Exception as exc:  # noqa: BLE001 — logging/persist must never break the scan
            logger.debug("daily scan fetch-log/persist failed: %s", exc)
        if len(signals) >= MIN_SAVE_SIGNALS:
            # Save even a partial scan — a healthy subset of the universe is fresh
            # and useful, and far better than letting the board freeze at yesterday.
            now = datetime.now(timezone.utc)
            db.save_daily_scan(signals, now.isoformat(), next_run(now).isoformat())
            logger.info("daily scan cached: %d signals", len(signals))
            if notify_subscribers:
                try:
                    notify_breakout_subscribers(signals)
                except Exception as exc:  # never let notify break the scan loop
                    logger.warning("breakout subscriber notify failed: %s", exc)
        else:
            # Near-empty almost always means the public crypto data layer was mostly
            # unreachable for this run (e.g. Binance 451 from the server's region AND
            # the gate/kucoin/binanceus/kraken fallbacks failing/throttling), NOT that
            # there are genuinely zero breakouts. Do NOT overwrite the last good
            # snapshot with an empty board — keep yesterday's breakouts visible and
            # surface the condition loudly so the root cause is diagnosable.
            logger.error(
                "daily scan produced only %d signals (<%d) — crypto data layer "
                "likely unreachable/throttled; keeping the previous cached snapshot "
                "(lastScanAt unchanged)", len(signals), MIN_SAVE_SIGNALS
            )
    except Exception:  # never let a scan failure crash the loop
        # Full traceback (the previous truncated warning hid the real cause). On any
        # error we keep the previous cached snapshot rather than blanking the board.
        logger.exception("daily scan failed; keeping the previous cached snapshot")
    finally:
        _running = False
    return db.get_daily_scan()


def is_scanning() -> bool:
    """True while a breakout scan is in flight (manual "+" run or the scheduled
    job). The API surfaces this so the UI can show a live "scanning…" state and
    fast-poll for completion instead of silently waiting out the 3-4 min run."""
    return _running


def _is_stale(cached: dict) -> bool:
    ran = (cached or {}).get("ranAt")
    if not ran:
        return True
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(ran)).total_seconds()
        return age > STALE_AFTER_SECONDS
    except (TypeError, ValueError):
        return True


async def daily_scan_loop() -> None:
    """Run once on startup if stale, then every day at 00:05 UTC."""
    try:
        if _is_stale(db.get_daily_scan()):
            await run_scan_now()
    except Exception as exc:
        logger.warning("startup daily scan check failed: %s", str(exc)[:200])

    while True:
        now = datetime.now(timezone.utc)
        wait = max(60.0, (next_run(now) - now).total_seconds())
        await asyncio.sleep(wait)
        # The scheduled daily run also fans the breakout digest to opted-in users.
        await run_scan_now(notify_subscribers=True)
