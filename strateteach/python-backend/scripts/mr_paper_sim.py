"""PHASE-2b · CHECKPOINT 3 — gated PAPER-SIM of the mean-reversion sleeve.

⚠️ PAPER-SIM ONLY. No orders, no capital, no live gate. This is a HISTORICAL REPLAY that
drives the EXACT strategy code that's wired (app.services.mr_strategies — imported here, so
the sim measures the same RSI2/Bollinger/200-SMA math the scan produces) through a faithful
paper-sim PORTFOLIO with REALISTIC execution:

  • SIGNAL on a bar's CLOSE  →  FILL on the NEXT bar's OPEN  (you cannot trade a close you're
    still observing — this is stricter/more honest than the Phase-2a close-to-close backtest).
  • MODELED slippage: a stated bps execution gap on every fill (buy = open·(1+bps),
    sell = open·(1−bps)). This is MODELED, not a live measurement — stated per run below.
  • Fees: 0.1%/side = 0.2% round-trip, charged on notional at entry and exit.
  • Paper-sim ACCOUNTING: per-pilot NAV, equal-weight sizing, hard maxPositions cap, daily
    mark-to-market equity curve → total/period profit + max drawdown. When more entry signals
    fire than free slots, the cap binds (ranked most-oversold first — a natural canonical
    ordering, NOT a tuned parameter).

KPI = EXPECTANCY × ROBUSTNESS (net of fees AND modeled slippage), NOT trades/day. If the edge
does not survive, the report says so plainly.

Fetch pipeline copied verbatim from phase2a_analysis/sim2.py (yfinance stocks + ccxt crypto).

RUN (Docker):
  docker run --rm -e STOCK_N=150 -e SINCE=2018-01-01 -v "$PWD":/app -w /app \
    python:3.11-slim sh -c "pip install -q ccxt yfinance pandas numpy && \
    python3 -u python-backend/scripts/mr_paper_sim.py"
"""
import os, sys, time, json, warnings, urllib.request
warnings.filterwarnings("ignore")
import numpy as np, pandas as pd

sys.path.insert(0, "python-backend")
from app.services import mr_strategies as mr   # the SAME wired strategy code

CRYPTO_N = int(os.environ.get("CRYPTO_N", "150"))
STOCK_N  = int(os.environ.get("STOCK_N", "150"))
SINCE    = os.environ.get("SINCE", "2018-01-01")   # warms 200-SMA well before 2020
FEE_SIDE = float(os.environ.get("FEE_SIDE", "0.001"))   # 0.1%/side => 0.2% round-trip
RUN_CRYPTO = os.environ.get("RUN_CRYPTO", "1") not in ("0", "false", "no")

# MODELED slippage per side, in basis points. Primary = conservative-realistic for the
# universe; STRESS = a harsher sensitivity check. Large-cap US stocks are very liquid
# (tight spreads); crypto is wider. All MODELED, disclosed in the header of each run.
SLIP_PRIMARY = {"stocks": 0.0005, "crypto": 0.0010}   # 5 bps / 10 bps per side
SLIP_STRESS  = {"stocks": 0.0010, "crypto": 0.0020}   # 10 bps / 20 bps per side

MAX_POS = 8                     # pilot position cap (from MR_PILOTS)
NAV0 = 100_000.0                # arbitrary paper NAV; results reported as %
WIN_CLIP = 1.0                  # winsorize per-trade ret to +/-100% for the typical-trade mean

# ---- fetch pipeline — verbatim from phase2a_analysis/sim2.py ------------------------------------
STABLES={"USDT","USDC","DAI","TUSD","FDUSD","USDE","USDS","BUSD","PYUSD","USDD","FRAX","GUSD"}
WRAPPED={"WBTC","WETH","WEETH","WBETH","WSTETH","STETH","RETH","CBETH","SUSDE","BSC-USD","LEO","WHYPE"}
RENAME={"RNDR":"RENDER","MIOTA":"IOTA","MATIC":"POL","FTM":"S","OKB":"OKT","CRO":"CRO"}
def crypto_topN(n):
    try:
        url=("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=%d&page=1"%min(n+50,250))
        req=urllib.request.Request(url, headers={"User-Agent":"bt"})
        data=json.load(urllib.request.urlopen(req, timeout=25)); syms=[]
        for c in data:
            s=(c.get("symbol") or "").upper()
            if s and s not in STABLES and s not in WRAPPED and s not in syms: syms.append(s)
        if len(syms)>=80:
            print(f"  crypto universe: CoinGecko top-{len(syms)} by mcap"); return syms[:n]
    except Exception as e: print("  CoinGecko fallback:", str(e)[:60])
    return ["BTC","ETH","BNB","SOL","XRP","ADA","DOGE","TRX","LINK","AVAX","DOT","MATIC","TON","SHIB",
        "LTC","BCH","UNI","ATOM","XLM","ETC","FIL","APT","NEAR","ARB","OP","INJ","IMX","VET","HBAR",
        "GRT","AAVE","ALGO","QNT","RENDER","EGLD","SAND","MANA","AXS","THETA","XTZ","EOS","FLOW",
        "CHZ","MKR","CRV","SNX","LDO","GALA","APE","COMP","ZEC","DASH","KSM","ZIL","YFI","SUSHI"]
def _fetch_pair(ex, pair, since_ms):
    out=[]; cur=since_ms
    for _ in range(20):
        try: batch=ex.fetch_ohlcv(pair,"1d",since=cur,limit=1000)
        except Exception: return None
        if not batch: break
        out+=batch; cur=batch[-1][0]+86400000
        if len(batch)<1000: break
        time.sleep(0.15)
    if len(out)<260: return None
    df=pd.DataFrame(out,columns=["t","open","high","low","close","volume"]).drop_duplicates("t")
    df["ts"]=pd.to_datetime(df["t"],unit="ms"); df=df.set_index("ts").sort_index()
    return df[["open","high","low","close","volume"]]
def fetch_crypto(ex, sym, since_ms):
    cands=[sym]+([RENAME[sym]] if (sym in RENAME and RENAME[sym]!=sym) else [])
    for cand in cands:
        pair=f"{cand}/USDT"
        if pair not in ex.markets: continue
        df=_fetch_pair(ex, pair, since_ms)
        if df is not None: return df
    return None

# ---- per-asset prep: dates, open, close, indicators (via the WIRED mr_strategies) ---------------
def prep(df):
    ind = mr.compute_indicators(df)   # rsi2/sma5/sma20/sma200/bb_lo/c — the wired math
    return {
        "dates": df.index.to_numpy(),
        "open":  df["open"].values.astype(float),
        "c":     ind["c"], "rsi2": ind["rsi2"], "sma5": ind["sma5"],
        "sma20": ind["sma20"], "sma200": ind["sma200"], "bb_lo": ind["bb_lo"],
    }

# ---- entry-strength rank (canonical, NOT tuned): most-oversold first when the cap binds -------
def _rank(strat_key, a, j):
    if strat_key == "rsi2":
        return a["rsi2"][j]                       # lower RSI2 = more oversold → higher priority
    return (a["c"][j] - a["bb_lo"][j])            # further below the lower band → higher priority

# ---- portfolio replay: signal@close → fill@next-open, slippage+fee, cap, NAV mark-to-market ----
def replay(assets, strat, slip, warm=mr.WARMUP_BARS):
    """assets: {sym: prepped}. strat: mr strategy dict. slip: per-side fraction.
    Returns (trades list, equity list, union_days)."""
    entry_fn, exit_fn = strat["entry"], strat["exit"]
    # union calendar
    all_dates = sorted({d for a in assets.values() for d in a["dates"]})
    D = len(all_dates); di = {d: k for k, d in enumerate(all_dates)}
    # per-asset: map union-k -> local bar index (only where the asset has a bar)
    kmap = {}
    for sym, a in assets.items():
        kmap[sym] = {di[d]: j for j, d in enumerate(a["dates"])}
    open_pos = {}                 # sym -> dict(entry_fill, qty, ei, entered_k, entry_close)
    pend_exit = []                # [(sym)]  queued at close of k, filled at open of k+1
    pend_entry = []               # [(sym, ei)] queued at close of k, filled at open of k+1
    cash = NAV0; trades = []; equity = []
    per_trade_usd_frac = 1.0 / MAX_POS    # equal-weight, fully deployed at the cap

    for k in range(D):
        d = all_dates[k]
        # 1) fill queued EXITS at today's open (with slippage), realize P&L, free slot+cash
        for sym in pend_exit:
            pos = open_pos.get(sym)
            if not pos: continue
            j = kmap[sym].get(k)
            op = assets[sym]["open"][j] if (j is not None) else assets[sym]["c"][pos["ei"]]
            if not (op > 0 and np.isfinite(op)):
                op = float(assets[sym]["c"][j]) if j is not None else pos["entry_fill"]
            sell = op * (1.0 - slip)
            proceeds = pos["qty"] * sell * (1.0 - FEE_SIDE)
            cost     = pos["qty"] * pos["entry_fill"] * (1.0 + FEE_SIDE)
            ret = proceeds / cost - 1.0
            cash += proceeds
            trades.append({"sym": sym, "ed": all_dates[pos["entered_k"]], "xd": d,
                           "ret": ret, "hold": (k - pos["entered_k"]),
                           "entry_fill": pos["entry_fill"], "exit_fill": sell,
                           "qty": pos["qty"], "pnl_usd": proceeds - cost})
            del open_pos[sym]
        pend_exit = []
        # 2) fill queued ENTRIES at today's open (ranked, cap- and cash-bound)
        for sym, ei in pend_entry:
            if len(open_pos) >= MAX_POS: break
            if sym in open_pos: continue
            j = kmap[sym].get(k)
            if j is None: continue
            op = assets[sym]["open"][j]
            if not (op > 0 and np.isfinite(op)): continue
            buy = op * (1.0 + slip)
            spend = NAV0 * per_trade_usd_frac
            if spend > cash: spend = cash
            if spend < 1.0: continue
            qty = spend / buy
            cash -= qty * buy * (1.0 + FEE_SIDE)
            open_pos[sym] = {"entry_fill": buy, "qty": qty, "ei": ei,
                             "entered_k": k, "entry_close": float(assets[sym]["c"][ei])}
        pend_entry = []
        # 3) mark-to-market equity (cash + open positions at today's close)
        mtm = cash
        for sym, pos in open_pos.items():
            j = kmap[sym].get(k)
            px = assets[sym]["c"][j] if j is not None else pos["entry_fill"]
            if px > 0 and np.isfinite(px): mtm += pos["qty"] * px
        equity.append(mtm)
        # 4) generate signals on today's CLOSE → queue fills for k+1
        for sym, pos in list(open_pos.items()):
            j = kmap[sym].get(k)
            if j is None or j < warm: continue
            done, _why = exit_fn(assets[sym], j, pos["ei"], pos["entry_close"])
            if done: pend_exit.append(sym)
        free_slots = MAX_POS - (len(open_pos) - len(pend_exit))
        if free_slots > 0:
            cands = []
            for sym, a in assets.items():
                if sym in open_pos: continue
                j = kmap[sym].get(k)
                if j is None or j < warm: continue
                if entry_fn(a, j): cands.append((sym, j, _rank(strat["key"], a, j)))
            cands.sort(key=lambda x: x[2])          # most-oversold first
            for sym, j, _r in cands[:free_slots]:
                pend_entry.append((sym, j))
    return trades, equity, D

# ---- stats ----
def _w(x): return np.clip(np.asarray(x, float), -WIN_CLIP, WIN_CLIP)
def trade_stats(trades):
    n = len(trades)
    if n == 0: return None
    r = np.array([t["ret"] for t in trades])
    w = r[r > 0]; l = r[r <= 0]
    return dict(n=n, win=len(w)/n*100, avgW=(w.mean()*100 if len(w) else 0),
                avgL=(l.mean()*100 if len(l) else 0), expW=_w(r).mean()*100,
                med=np.median(r)*100, hold=np.mean([t["hold"] for t in trades]))
def equity_stats(equity):
    if not equity: return 0.0, 0.0
    eq = np.array(equity); peak = np.maximum.accumulate(eq)
    mdd = ((eq - peak) / peak).min() * 100
    return (eq[-1] / eq[0] - 1.0) * 100, mdd
def period_bucket(ts):
    y = pd.Timestamp(ts).year
    return "20-21" if y <= 2021 else "2022" if y == 2022 else "23-24" if y <= 2024 else "25-26"

def per_asset_expW(assets, strat, slip):
    """Per-asset winsorized expectancy (single-asset, cap=1) for the +assets% robustness read."""
    pos = 0; tot = 0
    for sym, a in assets.items():
        tr, _e, _d = replay({sym: a}, strat, slip)
        st = trade_stats(tr)
        if st and st["n"] >= 5:
            tot += 1
            if st["expW"] > 0: pos += 1
    return (pos / tot * 100) if tot else 0.0, tot

def run_market(name, assets, slip_map):
    print(f"\n{'='*96}\nMARKET: {name.upper()}   ·   {len(assets)} assets   ·   fees {FEE_SIDE*200:.1f}% round-trip")
    for tag, sm in [("PRIMARY", SLIP_PRIMARY), ("STRESS", SLIP_STRESS)]:
        slip = sm[name]
        print(f"\n--- slippage {tag}: {slip*1e4:.0f} bps/side (MODELED, {slip*2e4:.0f} bps round-trip) · next-open fills ---")
        hdr=f"{'strategy':26}{'win%':>7}{'avgW%':>7}{'avgL%':>7}{'expW%':>8}{'med%':>7}{'hold':>6}{'trades':>8}{'t/day':>7}{'net%':>9}{'maxDD%':>8}{'+assets':>9}"
        print(hdr)
        for key in ("rsi2", "bb"):
            strat = mr.strategy(key)
            trades, equity, D = replay(assets, strat, slip)
            st = trade_stats(trades); net, mdd = equity_stats(equity)
            if not st:
                print(f"{strat['label']:26}{'no trades':>7}"); continue
            pa, _ = per_asset_expW(assets, strat, slip)
            print(f"{strat['label']:26}{st['win']:>7.1f}{st['avgW']:>7.2f}{st['avgL']:>7.2f}"
                  f"{st['expW']:>8.3f}{st['med']:>7.3f}{st['hold']:>6.1f}{st['n']:>8}"
                  f"{st['n']/D:>7.2f}{net:>9.1f}{mdd:>8.1f}{pa:>8.0f}%")
    # robustness by sub-period at PRIMARY slippage
    print(f"\n--- ROBUSTNESS · winsorized expectancy% (net of fees + PRIMARY slippage), by entry sub-period ---")
    print(f"{'strategy':26}{'20-21':>12}{'2022':>12}{'23-24':>12}{'25-26':>12}{'ALL':>12}   (n)")
    for key in ("rsi2", "bb"):
        strat = mr.strategy(key)
        trades, _e, _D = replay(assets, strat, SLIP_PRIMARY[name])
        b = {"20-21": [], "2022": [], "23-24": [], "25-26": []}
        for t in trades: b[period_bucket(t["ed"])].append(t["ret"])
        allr = [t["ret"] for t in trades]
        def cell(x): return f"{_w(x).mean()*100:>6.3f}({len(x)})" if x else "    -    "
        row = f"{strat['label']:26}" + "".join(f"{cell(b[k]):>12}" for k in ["20-21","2022","23-24","25-26"])
        print(row + f"{cell(allr):>12}")

def main():
    since_ms = int(pd.Timestamp(SINCE).timestamp() * 1000)
    print(f"CONFIG: SINCE={SINCE} STOCK_N={STOCK_N} CRYPTO_N={CRYPTO_N} FEE={FEE_SIDE*200:.1f}%rt "
          f"MAX_POS={MAX_POS} · fills=NEXT-OPEN · slippage=MODELED (bps stated per run)")
    import yfinance as yf
    # stocks — the sleeve's universe
    from app.data.stock_universe import get_stock_symbols_for_limit
    su = get_stock_symbols_for_limit(STOCK_N); syms = [s for s, _ in su]
    print(f"\nFetching {len(syms)} stocks via yfinance…")
    sd = yf.download(syms, start=SINCE, interval="1d", progress=False, group_by="ticker",
                     auto_adjust=True, threads=True)
    sassets = {}
    for s in syms:
        try:
            df = sd[s][["Open","High","Low","Close","Volume"]].dropna()
            df.columns = ["open","high","low","close","volume"]
            if len(df) < mr.WARMUP_BARS + 20: continue
            sassets[s] = prep(df)
        except Exception: continue
    print(f"  stock assets usable: {len(sassets)}")
    run_market("stocks", sassets, SLIP_PRIMARY)

    if RUN_CRYPTO:
        print("\nFetching crypto (reference cross-check — the sleeve itself is STOCKS-only)…")
        import ccxt; ex = None
        for exid in ["gate","kucoin","binanceus"]:
            try: ex=getattr(ccxt,exid)({"enableRateLimit":True,"timeout":15000}); ex.load_markets(); print(f"  exchange: {exid}"); break
            except Exception as e: print(f"  {exid} failed: {str(e)[:40]}"); ex=None
        cassets = {}
        if ex:
            for s in crypto_topN(CRYPTO_N):
                df = fetch_crypto(ex, s, since_ms)
                if df is not None and len(df) >= mr.WARMUP_BARS + 20: cassets[s] = prep(df)
        print(f"  crypto assets usable: {len(cassets)}")
        if cassets: run_market("crypto", cassets, SLIP_PRIMARY)
        else: print("  (crypto data unavailable this run — stocks result stands on its own)")

    # Optional: dump the Bollinger STOCKS paper-sim trade log (PRIMARY slippage) for the UI
    # card, so "card === log" holds honestly (real paper-sim trades, net of fees + slippage).
    if os.environ.get("DUMP_MR_BB") == "1":
        strat = mr.strategy("bb")
        trades, equity, D = replay(sassets, strat, SLIP_PRIMARY["stocks"])
        st = trade_stats(trades); net, mdd = equity_stats(equity)
        r = np.array([t["ret"] for t in trades])
        gp = float(r[r > 0].sum()); gl = float(-r[r <= 0].sum())
        pf = (gp / gl) if gl > 0 else 0.0
        # nav curve on trade exit dates (compact) — running equity from the daily curve
        # sampled at each exit; use the per-day equity indexed by union date.
        udates = sorted({d for a in sassets.values() for d in a["dates"]})
        eq_by_date = {udates[i]: equity[i] for i in range(len(equity))}
        rows = []
        for t in sorted(trades, key=lambda x: x["xd"]):
            rows.append({
                "entry_date": pd.Timestamp(t["ed"]).strftime("%Y-%m-%d"),
                "exit_date": pd.Timestamp(t["xd"]).strftime("%Y-%m-%d"),
                "symbol": t["sym"], "side": "long",
                "entry_price": round(t["entry_fill"], 4), "exit_price": round(t["exit_fill"], 4),
                "qty": round(t["qty"], 6), "pnl": round(t["pnl_usd"], 2),
                "pnl_pct": round(t["ret"] * 100, 3),
                "running_equity": round(eq_by_date.get(t["xd"], NAV0), 2),
            })
        nav_curve = [{"date": pd.Timestamp(udates[i]).strftime("%Y-%m-%d"),
                      "equity": round(equity[i], 2)} for i in range(0, len(equity), 5)]
        doc = {
            "summary": {"net_profit_pct": round(net, 2), "max_drawdown_pct": round(abs(mdd), 2),
                        "profit_factor": round(pf, 2), "trades": st["n"],
                        "win_rate_pct": round(st["win"], 1), "avg_hold_days": round(st["hold"], 1)},
            "config": {"strategy": "Bollinger(20,2)+200-SMA mean-reversion (stocks)",
                       "universe": f"{len(sassets)} US large-caps", "position_cap": MAX_POS,
                       "fee_round_trip_pct": round(FEE_SIDE * 200, 2),
                       "slippage_bps_per_side": round(SLIP_PRIMARY["stocks"] * 1e4, 1),
                       "execution": "signal@close / fill@next-open (paper-sim, net of fees + modeled slippage)"},
            "trades": rows, "nav_curve": nav_curve,
        }
        out_path = "dashboard/public/pilot-mr-bb-validated-trades.json"
        with open(out_path, "w") as f:
            json.dump(doc, f, separators=(",", ":"))
        print(f"\nDUMP: wrote {out_path} — {st['n']} trades, net {net:.1f}%, DD {mdd:.1f}%, PF {pf:.2f}, "
              f"win {st['win']:.1f}%, hold {st['hold']:.1f}d")

    print(f"\n{'='*96}")
    print("READING: KPI = expectancy × robustness. PASS = expW POSITIVE net of fees AND modeled")
    print("slippage, with margin, CONSISTENT across sub-periods + a majority of assets (+assets%).")
    print("Slippage is MODELED (stated bps), not a live fill. Live-forward paper (option b) remains")
    print("the next step to confirm real fills before any capital. PAPER-SIM ONLY — no orders, no money.")

if __name__ == "__main__":
    main()
