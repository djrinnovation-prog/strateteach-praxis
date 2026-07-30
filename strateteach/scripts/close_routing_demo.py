#!/usr/bin/env python3
"""LIVE/DEMO separation demo for the "close positions in profit" button.

This is a *logic* demonstration only — it makes NO exchange calls and moves NO
money. It mirrors the routing table in dashboard/src/lib/closeRouting.ts and the
backend endpoint split (paper.py vs exchange.py) and proves three things:

  1. A "close in profit" tap in DEMO mode touches ONLY the paper book.
  2. A "close in profit" tap in LIVE mode touches ONLY the exchange book.
  3. Either way it closes ONLY winners (pnl > 0), never losers — and a missing
     mode falls back to DEMO (never silently to real money).

Run:  python3 scripts/close_routing_demo.py
"""
from __future__ import annotations

# ── routing table — mirrors dashboard/src/lib/closeRouting.ts ──────────────────
CLOSE_ROUTES = {
    "demo": {
        "book": "paper",
        "real_money": False,
        "pin_required": False,            # paper_* endpoints carry no PIN
        "close_in_profit_api": "paperCloseProfitableAll",   # POST /exchange/paper/close-profitable-all
        "close_all_api": "paperCloseAllActive",             # POST /exchange/paper/close-all-active
    },
    "live": {
        "book": "exchange",
        "real_money": True,
        "pin_required": True,             # every exchange/* endpoint is PIN-gated
        "close_in_profit_api": "closeProfitable",           # POST /exchange/close-profitable
        "close_all_api": "closeSpot",                       # POST /exchange/close-spot
    },
}


def normalize_mode(raw):
    """Anything that is not exactly 'live' collapses to 'demo' (safe default)."""
    return "live" if raw == "live" else "demo"


def route_for(raw):
    return CLOSE_ROUTES[normalize_mode(raw)]


def winners_only(positions):
    """The only positions a 'close in profit' action may ever touch."""
    return [p for p in positions if float(p.get("pnl", 0)) > 0]


def assert_book_match(raw, api):
    """Guard: a close intent for one book must never carry the other's endpoint."""
    r = route_for(raw)
    if api not in (r["close_in_profit_api"], r["close_all_api"]):
        raise AssertionError(
            f"close-routing leak blocked: mode='{normalize_mode(raw)}' "
            f"(book={r['book']}) may not call '{api}'"
        )


# ── simulated mixed book (NO real positions — illustrative numbers) ────────────
PAPER_BOOK = [   # virtual money
    {"symbol": "BTC/USDT", "pnl": 120.0, "pnlPct": 3.1},
    {"symbol": "ETH/USDT", "pnl": -45.0, "pnlPct": -1.8},
    {"symbol": "SOL/USDT", "pnl": 30.0, "pnlPct": 2.0},
]
EXCHANGE_BOOK = [  # REAL money
    {"symbol": "BTC/USDT", "pnl": 210.0, "pnlPct": 1.4},
    {"symbol": "XRP/USDT", "pnl": -80.0, "pnlPct": -2.2},
    {"symbol": "ADA/USDT", "pnl": 15.0, "pnlPct": 0.9},
]


def close_in_profit(mode, paper_book, exchange_book):
    """Resolve what a 'close in profit' tap does for `mode`. Returns a report.

    Crucially: it reads + closes from EXACTLY ONE book, chosen by the route. The
    other book is never read and never touched.
    """
    r = route_for(mode)
    api = r["close_in_profit_api"]
    assert_book_match(mode, api)  # belt-and-suspenders
    book = exchange_book if r["book"] == "exchange" else paper_book
    untouched = paper_book if r["book"] == "exchange" else exchange_book
    closed = winners_only(book)
    return {
        "mode": normalize_mode(mode),
        "book": r["book"],
        "api": api,
        "real_money": r["real_money"],
        "pin_required": r["pin_required"],
        "closed": closed,
        "closed_pnl": round(sum(p["pnl"] for p in closed), 2),
        "left_open_in_book": [p for p in book if p not in closed],
        "other_book_untouched": untouched,
    }


def _fmt_positions(positions):
    if not positions:
        return "—"
    return ", ".join(f"{p['symbol']} {p['pnl']:+.2f}" for p in positions)


def _print_report(title_en, title_he, rep):
    print(f"\n{'='*72}")
    print(f"{title_en}\n{title_he}")
    print("-" * 72)
    print(f"  mode / מצב            : {rep['mode'].upper()}  (book={rep['book']})")
    print(f"  endpoint / נקודת קצה   : api.{rep['api']}()")
    print(f"  real money / כסף אמיתי : {'YES — needs PIN' if rep['real_money'] else 'no (virtual)'}")
    print(f"  CLOSED (winners only) : {_fmt_positions(rep['closed'])}")
    print(f"  realized P&L          : {rep['closed_pnl']:+.2f}")
    print(f"  left open (this book) : {_fmt_positions(rep['left_open_in_book'])}  ← losers stay open")
    print(f"  OTHER book untouched  : {_fmt_positions(rep['other_book_untouched'])}  ← never read, never closed")


def main():
    print("LIVE vs DEMO — 'close positions in profit' separation demo")
    print("הפרדה בין לייב לדמו בכפתור 'סגירת פוזיציות ברווח' — הדגמה לוגית בלבד (אין עסקאות אמיתיות)")

    # Scenario 1 — DEMO only
    rep = close_in_profit("demo", PAPER_BOOK, EXCHANGE_BOOK)
    _print_report("SCENARIO 1 — DEMO mode: close in profit",
                  "תרחיש 1 — מצב דמו: סגירת רווחים", rep)
    assert rep["book"] == "paper" and not rep["real_money"]
    assert all(p["pnl"] > 0 for p in rep["closed"])               # winners only
    assert rep["other_book_untouched"] == EXCHANGE_BOOK            # live untouched

    # Scenario 2 — LIVE only
    rep = close_in_profit("live", PAPER_BOOK, EXCHANGE_BOOK)
    _print_report("SCENARIO 2 — LIVE mode: close in profit",
                  "תרחיש 2 — מצב לייב: סגירת רווחים", rep)
    assert rep["book"] == "exchange" and rep["real_money"] and rep["pin_required"]
    assert all(p["pnl"] > 0 for p in rep["closed"])               # winners only
    assert rep["other_book_untouched"] == PAPER_BOOK              # demo untouched

    # Scenario 3 — MIXED: same books, switch mode back-to-back. Each tap stays in
    # its own book; nothing ever crosses over.
    print(f"\n{'='*72}")
    print("SCENARIO 3 — MIXED: demo tap then live tap on the SAME books")
    print("תרחיש 3 — מעורב: לחיצה בדמו ואז בלייב על אותם ספרים")
    print("-" * 72)
    d = close_in_profit("demo", PAPER_BOOK, EXCHANGE_BOOK)
    l = close_in_profit("live", PAPER_BOOK, EXCHANGE_BOOK)
    print(f"  demo tap closed (paper)    : {_fmt_positions(d['closed'])}")
    print(f"  live tap closed (exchange) : {_fmt_positions(l['closed'])}")
    demo_syms = {p["symbol"] for p in d["closed"]}
    live_syms = {p["symbol"] for p in l["closed"]}
    # Same symbol can exist in both books — separation is by BOOK, not symbol.
    # Prove the demo tap never used a live endpoint and vice-versa:
    assert d["api"] == "paperCloseProfitableAll" and l["api"] == "closeProfitable"
    assert d["real_money"] is False and l["real_money"] is True
    print("  ✓ demo tap used a paper endpoint; live tap used an exchange endpoint")
    print("  ✓ no shared endpoint, no shared book — zero crossover")

    # Scenario 4 — safety: missing / unknown mode falls back to DEMO, and the
    # cross-book guard blocks a mismatched endpoint.
    print(f"\n{'='*72}")
    print("SCENARIO 4 — SAFETY: unknown mode + cross-book guard")
    print("תרחיש 4 — בטיחות: מצב לא ידוע + חסם הצלבת ספרים")
    print("-" * 72)
    for bad in (None, "", "LIVE ", "paper", "xyz"):
        m = normalize_mode(bad)
        print(f"  normalize_mode({bad!r:8}) -> {m!r}  (real_money={CLOSE_ROUTES[m]['real_money']})")
        assert m == "demo"          # nothing dubious ever resolves to live
    try:
        assert_book_match("demo", "closeSpot")   # demo trying a LIVE endpoint
        print("  ✗ guard FAILED to block a cross-book call")
    except AssertionError as e:
        print(f"  ✓ guard blocked cross-book call: {e}")

    print(f"\n{'='*72}")
    print("ALL CHECKS PASSED — live and demo never mix; only winners close.")
    print("כל הבדיקות עברו — לייב ודמו לעולם לא מתערבבים; נסגרות רק פוזיציות ברווח.")


if __name__ == "__main__":
    main()
