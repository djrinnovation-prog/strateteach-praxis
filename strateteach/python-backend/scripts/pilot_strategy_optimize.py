"""HONEST strategy-improvement pass for the 5 AutoPilots — anti-overfit by construction.

Backtest-only, NO money, NO live wiring, nothing touching Bot-21702. Companion to
scripts/pilot_strategy_backtest.py (same GC math + shared-NAV harness), extended with:
  1. A P4 "LowDD" exit fix (upper-band / trend-not-Green exit instead of the midline).
  2. Parameter exploration validated on a TRAIN/TEST split — a candidate is KEPT only if it
     improves BOTH the in-sample AND the held-out out-of-sample window (i.e. it generalizes);
     candidates that only help in-sample are REJECTED as curve-fits.

Data is fetched ONCE and disk-cached (_bt_cache.pkl) so re-runs don't re-fetch. Assumptions
(labeled): slow_line = GC filter/midline; drift = off-list (close below the pilot's line);
universe = market-cap rank (crypto top-100 CoinGecko→gate; stocks top-150 large-caps).
NEVER tuned to a target number.

RUN:
  docker run --rm -v "$PWD":/app -w /app python:3.11-slim \
    sh -c "pip install -q ccxt yfinance pandas numpy && python3 scripts/pilot_strategy_optimize.py"
"""
import warnings, math, time, json, os, pickle, urllib.request
warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
from math import comb

# ── GC (parametrized) ───────────────────────────────────────────────────────────────────
def _pole(series, pole_n, alpha):
    n=len(series); f=np.zeros(n); x=1.0-alpha; a_pow=alpha**pole_n
    binom=[comb(pole_n,k) for k in range(pole_n+1)]; xp=[x**k for k in range(pole_n+1)]
    for t in range(n):
        val=a_pow*float(series[t]) if not math.isnan(series[t]) else 0.0
        for k in range(1,pole_n+1):
            pv=f[t-k] if t-k>=0 else 0.0
            val+=(1 if k%2==1 else -1)*binom[k]*xp[k]*pv
        f[t]=val
    return f
def gc(df, poles=6, period=147, mult=1.414, source="ohlc4"):
    o,h,l,c=[df[x].values.astype(float) for x in ("open","high","low","close")]
    src=(h+l+c)/3.0 if source=="hlc3" else (o+h+l+c)/4.0
    n=len(c); tr=np.zeros(n); tr[0]=h[0]-l[0]
    for i in range(1,n): tr[i]=max(h[i]-l[i],abs(h[i]-c[i-1]),abs(l[i]-c[i-1]))
    beta=(1-math.cos(4*math.asin(1)/period))/(math.pow(1.414,2.0/poles)-1)
    alpha=-beta+math.sqrt(beta**2+2*beta)
    filt=_pole(src,poles,alpha); ft=_pole(tr,poles,alpha)
    return filt, filt+ft*mult, filt-ft*mult

STABLES={"USDT","USDC","DAI","TUSD","FDUSD","USDE","USDS","BUSD","PYUSD","USDD","FRAX","GUSD"}
WRAPPED={"WBTC","WETH","WEETH","WBETH","WSTETH","STETH","RETH","CBETH","SUSDE","BSC-USD","LEO","WHYPE"}
RENAME={"RNDR":"RENDER","MIOTA":"IOTA","MATIC":"POL","FTM":"S"}
def crypto_top100():
    try:
        url="https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=130&page=1"
        req=urllib.request.Request(url, headers={"User-Agent":"bt"})
        data=json.load(urllib.request.urlopen(req, timeout=25)); syms=[]
        for c in data:
            s=(c.get("symbol") or "").upper()
            if s and s not in STABLES and s not in WRAPPED and s not in syms: syms.append(s)
        if len(syms)>=80: return syms[:100]
    except Exception as e: print("  CoinGecko fallback:", str(e)[:60])
    return ["BTC","ETH","BNB","SOL","XRP","ADA","DOGE","TRX","LINK","AVAX","DOT","MATIC","TON","SHIB",
        "LTC","BCH","UNI","ATOM","XLM","ETC","FIL","APT","NEAR","ARB","OP","INJ","IMX","VET","HBAR",
        "GRT","AAVE","ALGO","QNT","RENDER","EGLD","SAND","MANA","AXS","THETA","FTM","XTZ","EOS","FLOW"]
STOCKS_TOP150=["AAPL","MSFT","NVDA","GOOGL","AMZN","META","BRK-B","LLY","AVGO","TSLA","JPM","WMT","V",
  "XOM","UNH","MA","PG","JNJ","COST","HD","ORCL","ABBV","BAC","KO","MRK","CVX","NFLX","AMD","PEP","CRM",
  "TMO","ADBE","LIN","MCD","CSCO","ACN","WFC","ABT","DHR","INTC","QCOM","TXN","DIS","VZ","INTU","AMGN",
  "CAT","IBM","PFE","CMCSA","NOW","PM","UNP","GE","NKE","HON","COP","AMAT","LOW","SPGI","GS","UBER","AXP",
  "ISRG","NEE","BKNG","RTX","MS","T","ELV","PGR","SYK","LMT","BLK","TJX","MDT","VRTX","C","BSX","REGN",
  "CB","ADP","MU","PLD","CI","SO","ZTS","DE","BMY","MO","SCHW","DUK","ETN","SLB","BDX","GILD","AON",
  "ITW","EOG","APD","WM","CME","NOC","CSX","FCX","MPC","TGT","USB","EMR","PNC","MAR","GD","MCK","HCA","ORLY",
  "PSX","ROP","APH","MSI","PH","AJG","NXPI","PCAR","CARR","TT","CMG","ECL","AZO","OXY","VLO","F","GM",
  "TFC","EW","SRE","ADI","KLAC","MCHP","HUM","DXCM","IDXX","KMB","JCI","AEP","D","LRCX","ADSK","PAYX","ROST","ODFL"]

def _fetch_pair(ex, pair, since_ms):
    out=[]; cur=since_ms
    for _ in range(12):
        try: batch=ex.fetch_ohlcv(pair,"1d",since=cur,limit=1000)
        except Exception: return None
        if not batch: break
        out+=batch; cur=batch[-1][0]+86400000
        if len(batch)<1000: break
        time.sleep(0.2)
    if len(out)<210: return None
    df=pd.DataFrame(out,columns=["t","open","high","low","close","volume"]).drop_duplicates("t")
    df["ts"]=pd.to_datetime(df["t"],unit="ms"); df=df.set_index("ts").sort_index()
    return df[["open","high","low","close","volume"]]

CACHE="_bt_cache.pkl"
def fetch_all(since):
    if os.path.exists(CACHE):
        print(f"  loading cached data ({CACHE})")
        with open(CACHE,"rb") as fh: return pickle.load(fh)
    import ccxt, yfinance as yf
    since_ms=int(pd.Timestamp(since).timestamp()*1000)
    ex=None
    for exid in ["gate","kucoin","binanceus"]:
        try: ex=getattr(ccxt,exid)({"enableRateLimit":True,"timeout":15000}); ex.load_markets(); break
        except Exception: ex=None
    craw={}
    for s in crypto_top100():
        cands=[s]+([RENAME[s]] if (s in RENAME and RENAME[s]!=s) else [])
        for cand in cands:
            if f"{cand}/USDT" not in ex.markets: continue
            df=_fetch_pair(ex,f"{cand}/USDT",since_ms)
            if df is not None: craw[s]=df; break
    print(f"  crypto raw: {len(craw)}")
    sd=yf.download(STOCKS_TOP150, start=since, interval="1d", progress=False, group_by="ticker", threads=True)
    sraw={}
    for s in STOCKS_TOP150:
        try:
            df=sd[s][["Open","High","Low","Close","Volume"]].dropna(); df.columns=["open","high","low","close","volume"]
            if len(df)>=210: sraw[s]=df
        except Exception: continue
    print(f"  stock raw: {len(sraw)}")
    data={"crypto":craw,"stocks":sraw}
    with open(CACHE,"wb") as fh: pickle.dump(data,fh)
    return data

# ── prep (parametrized GC → per-bar signals). Cached by (source,period,mult). ─────────────
_PREP={}
def prep_set(raw, source, period, mult):
    key=(id(raw),source,period,mult)
    if key in _PREP: return _PREP[key]
    out={}
    for s,df in raw.items():
        g=gc(df,period=period,mult=mult,source=source)
        if g is None: continue
        f,h,l=g; c=df["close"].values; hi=df["high"].values; N=len(c)
        green=c>=h; red=c<=l
        flip=np.zeros(N,bool); cuf=np.zeros(N,bool); rec=np.full(N,9999); ff=np.zeros(N,bool); last=None
        for t in range(1,N):
            if c[t]>=h[t] and c[t-1]<h[t-1]: flip[t]=True; last=t
            if c[t]>=f[t] and c[t-1]<f[t-1]: cuf[t]=True
            if last is not None: rec[t]=t-last
            ff[t]=f[t]<f[t-1]
        out[s]=dict(idx=df.index, close=c, high=hi, f=f, h=h, l=l, green=green, red=red,
                    flip=flip, cuf=cuf, rec=rec, ff=ff)
    _PREP[key]=out
    return out

def run(assets, pilot, max_pos, long_exit="band", stop=None, window=None, btc=None):
    """long_exit: 'band' (close<upper) or 'filter' (close<midline). window: (start,end) or None."""
    ws=pd.Timestamp(window[0]) if window else None; we=pd.Timestamp(window[1]) if window else None
    all_dates=sorted(set().union(*[set(a["idx"]) for a in assets.values()]))
    rows={s:{d:i for i,d in enumerate(a["idx"])} for s,a in assets.items()}
    btc_rows={d:i for i,d in enumerate(btc["idx"])} if btc is not None else {}
    pos={}; realized=100000.0; peak=100000.0; mdd=0.0; nl=ns=0; marked=100000.0; warm=210; started=False
    for d in all_dates:
        if ws is not None and (d<ws or d>we): continue
        for s in list(pos.keys()):
            i=rows[s].get(d)
            if i is None: continue
            a=assets[s]; p=pos[s]; c=a["close"][i]; side=p["side"]; e=p["entry"]; ex=False
            if side==1:
                ex = (c<a["h"][i]) if long_exit=="band" else (c<a["f"][i])
                if stop and c<=e*(1-stop): ex=True
            else:
                tp=0.70 if pilot=="P3" else 0.65
                if c>a["f"][i] or c<=tp*e or (not a["red"][i]): ex=True
                if stop and c>=e*(1+stop): ex=True
            if ex: realized+=(c-e)*p["qty"]*side; del pos[s]
        marked=realized
        for s,p in pos.items():
            i=rows[s].get(d)
            if i is not None: marked+=(assets[s]["close"][i]-p["entry"])*p["qty"]*p["side"]
        if not started: peak=marked; started=True
        peak=max(peak,marked); mdd=min(mdd,(marked-peak)/peak)
        deployed=sum(p["notional"] for p in pos.values())
        btc_down=False
        if btc is not None:
            bi=btc_rows.get(d)
            if bi is not None: btc_down=btc["close"][bi]<btc["f"][bi]
        for s,a in assets.items():
            if len(pos)>=max_pos: break
            if s in pos: continue
            i=rows[s].get(d)
            if i is None or i<warm: continue
            side=0; pct=0.0; c=a["close"][i]; f=a["f"][i]; hi=a["high"][i]
            sz=lambda: 0.08 if a["rec"][i]<=25 else 0.02
            if pilot=="P1":
                if a["green"][i]: side,pct=1,sz()
                elif btc_down and a["red"][i] and hi>=0.98*f and c<f: side,pct=-1,0.05
                elif a["red"][i] and c<f and a["close"][i-1]>=a["f"][i-1]: side,pct=-1,0.03
            elif pilot=="P2":
                if c>=f: side,pct=1,sz()
            elif pilot=="P3":
                if c>=f: side,pct=1,sz()
                elif a["red"][i] and hi>=0.98*f and c<f and a["ff"][i]: side,pct=-1,0.03
            elif pilot=="P4":
                if a["flip"][i]: side,pct=1,sz()
            elif pilot=="P5":
                if a["flip"][i]: side,pct=1,0.05
            if side==0: continue
            size=pct*marked
            if deployed+size>marked: continue
            pos[s]={"side":side,"entry":c,"qty":size/c,"notional":size}
            deployed+=size; nl+=side==1; ns+=side==-1
    return dict(net=(marked-100000.0)/1000.0, mdd=mdd*100, trades=nl+ns)

def score(r):  # return per unit drawdown (MAR-like); higher = better risk-adjusted
    return r["net"]/max(abs(r["mdd"]),1.0)

IS=("2020-01-01","2022-06-30"); OOS=("2022-07-01","2025-12-31")
BASE_EXIT={"P1":"band","P2":"filter","P3":"filter","P4":"filter","P5":"band"}
MAXP={"P1":8,"P2":8,"P3":8,"P4":5,"P5":6}; STOP={"P1":None,"P2":None,"P3":None,"P4":None,"P5":None}

def main():
    data=fetch_all("2020-01-01")
    craw, sraw = data["crypto"], data["stocks"]
    def assets_for(pilot, source, period, mult):
        raw = sraw if pilot=="P5" else craw
        ps = prep_set(raw, source, period, mult)
        btc = ps.get("BTC") if pilot=="P1" else None
        return ps, btc
    def ev(pilot, source, period, mult, long_exit, window):
        ps,btc=assets_for(pilot,source,period,mult)
        return run(ps, pilot, MAXP[pilot], long_exit=long_exit, stop=STOP[pilot], window=window, btc=btc)

    src=lambda p: "hlc3" if p=="P5" else "ohlc4"

    # ── 1) P4 exit fix ────────────────────────────────────────────────────────────────────
    print("\n===== 1) P4 'LowDD' EXIT FIX (period=147, mult=1.414) — DD before/after =====")
    print(f"{'exit rule':22}{'window':6}{'net%':>9}{'maxDD%':>9}{'trades':>8}")
    for exit_rule,label in [("filter","midline (current)"),("band","upper-band (fix)")]:
        for wlab,w in [("FULL",None),("IS",IS),("OOS",OOS)]:
            r=ev("P4","ohlc4",147,1.414,exit_rule,w)
            print(f"{label:22}{wlab:6}{r['net']:>9.1f}{r['mdd']:>9.1f}{r['trades']:>8}")

    # ── 2) Parameter exploration, TRAIN(IS)/TEST(OOS) validated ───────────────────────────
    # Small principled grid (NOT a sweep): GC period {120,147,175}, mult {1.414,1.6}. Select
    # the best risk-adjusted (net/|DD|) on IS; ACCEPT only if it ALSO beats baseline on OOS.
    print("\n===== 2) PARAM EXPLORATION — select on IS, validate on OOS (keep only if BOTH improve) =====")
    grid=[(p,m) for p in (120,147,175) for m in (1.414,1.6)]
    for pilot in ["P1","P2","P3","P4","P5"]:
        le=BASE_EXIT[pilot] if pilot!="P4" else "band"   # P4 uses its fixed (band) exit here
        base_is=ev(pilot,src(pilot),147,1.414,le,IS); base_oos=ev(pilot,src(pilot),147,1.414,le,OOS)
        # optimize on IS
        best=None
        for (p,m) in grid:
            r=ev(pilot,src(pilot),p,m,le,IS)
            if best is None or score(r)>score(best[0]): best=(r,p,m)
        br,bp,bm=best
        cand_oos=ev(pilot,src(pilot),bp,bm,le,OOS)
        improves_is = score(br)>score(base_is)*1.02
        improves_oos = score(cand_oos)>=score(base_oos)
        verdict = "KEEP (generalizes)" if (improves_is and improves_oos) else \
                  ("REJECT overfit (IS-only)" if improves_is else "no better than baseline")
        print(f"\n{pilot}  baseline period=147 mult=1.414 exit={le}")
        print(f"   IS : net={base_is['net']:+8.1f}% DD={base_is['mdd']:6.1f}%  score={score(base_is):.2f}")
        print(f"   OOS: net={base_oos['net']:+8.1f}% DD={base_oos['mdd']:6.1f}%  score={score(base_oos):.2f}")
        print(f"   best-on-IS: period={bp} mult={bm}")
        print(f"   IS : net={br['net']:+8.1f}% DD={br['mdd']:6.1f}%  score={score(br):.2f}")
        print(f"   OOS: net={cand_oos['net']:+8.1f}% DD={cand_oos['mdd']:6.1f}%  score={score(cand_oos):.2f}")
        print(f"   -> {verdict}")

    print("\nAssumptions: slow_line=GC midline; drift=off-list; universe=mcap rank; sizing 8%/2%")
    print("(P1-P4) & 5% (P5). IS=2020-01..2022-06, OOS=2022-07..now. Small sample (37 crypto)")
    print("→ one split = limited evidence; only BOTH-window improvements kept. NOT tuned to target.")

if __name__=="__main__": main()
