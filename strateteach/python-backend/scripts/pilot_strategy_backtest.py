"""Shared-NAV portfolio backtest for ALL 5 AutoPilot strategies. Backtest-only, historical,
NO money, NO live wiring, nothing touching Bot-21702.

RUN (self-contained; fetches live history from gate.io + yfinance):
    docker run --rm -v "$PWD":/app -w /app python:3.11-slim \\
      sh -c "pip install -q ccxt yfinance pandas numpy && python3 scripts/pilot_strategy_backtest.py"
Prints each pilot's net% / MaxDD / trades, with and without a stop-loss.

Dan-confirmed assumptions (labeled, honest):
  • slow_line = the GC FILTER / MIDLINE (f)  — no separate Bot2Slow indicator.
  • "drifted out" = asset no longer on the Trend-Radar long list = close crossed below the
    pilot's line (upper band for band-pilots, filter for slow_line-pilots). For these long
    strategies that coincides with the primary line-cross exit.
Universe = market-cap rank (crypto top-100 via CoinGecko; stocks curated top-150 large-caps).
Sizing = ONE shared NAV, 1x, NAV-% per trade; max concurrent per pilot. Run w/ and w/o stop.
"""
import warnings, math, time, json, urllib.request
warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
from math import comb

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
# CoinGecko ticker → gate.io /USDT base rebrand/alias map (tried as a fallback to the raw symbol).
RENAME={"RNDR":"RENDER","MIOTA":"IOTA","MATIC":"POL","FTM":"S","OKB":"OKT","CRO":"CRO",
        "NEAR":"NEAR","GALA":"GALA","BEAM":"BEAM","OM":"OM"}
def crypto_top100():
    try:
        url=("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=130&page=1")
        req=urllib.request.Request(url, headers={"User-Agent":"bt"})
        data=json.load(urllib.request.urlopen(req, timeout=25)); syms=[]
        for c in data:
            s=(c.get("symbol") or "").upper()
            if s and s not in STABLES and s not in WRAPPED and s not in syms: syms.append(s)
        if len(syms)>=80:
            print(f"  crypto universe: CoinGecko top-{len(syms)} by mcap"); return syms[:100]
    except Exception as e: print("  CoinGecko fallback:", str(e)[:60])
    return ["BTC","ETH","BNB","SOL","XRP","ADA","DOGE","TRX","LINK","AVAX","DOT","MATIC","TON","SHIB",
        "LTC","BCH","UNI","ATOM","XLM","ETC","FIL","APT","NEAR","ARB","OP","INJ","IMX","VET","HBAR",
        "GRT","AAVE","ALGO","QNT","RENDER","EGLD","SAND","MANA","AXS","THETA","FTM","XTZ","EOS","FLOW",
        "CHZ","MKR","CRV","SNX","LDO","GALA","APE","DYDX","COMP","ZEC","DASH","KSM","ZIL","YFI","SUSHI"]
STOCKS_TOP150=["AAPL","MSFT","NVDA","GOOGL","AMZN","META","BRK-B","LLY","AVGO","TSLA","JPM","WMT","V",
  "XOM","UNH","MA","PG","JNJ","COST","HD","ORCL","ABBV","BAC","KO","MRK","CVX","NFLX","AMD","PEP","CRM",
  "TMO","ADBE","LIN","MCD","CSCO","ACN","WFC","ABT","DHR","INTC","QCOM","TXN","DIS","VZ","INTU","AMGN",
  "CAT","IBM","PFE","CMCSA","NOW","PM","UNP","GE","NKE","HON","COP","AMAT","LOW","SPGI","GS","UBER","AXP",
  "ISRG","NEE","BKNG","RTX","MS","T","ELV","PGR","SYK","LMT","BLK","TJX","MDT","VRTX","C","BSX","REGN",
  "CB","ADP","MU","PLD","MMC","CI","SO","ZTS","DE","BMY","MO","SCHW","DUK","ETN","SLB","BDX","GILD","AON",
  "ITW","EOG","APD","WM","CME","NOC","CSX","FCX","MPC","TGT","USB","EMR","PNC","MAR","GD","MCK","HCA","ORLY",
  "PSX","ROP","APH","MSI","PH","AJG","NXPI","PCAR","CARR","TT","CMG","ECL","AZO","OXY","VLO","MMM","F","GM",
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
def fetch_crypto(ex, sym, since_ms):
    # Try the raw ticker, then its rebrand alias — captures MATIC→POL, RNDR→RENDER, FTM→S, etc.
    cands=[sym]+([RENAME[sym]] if (sym in RENAME and RENAME[sym]!=sym) else [])
    for cand in cands:
        pair=f"{cand}/USDT"
        if pair not in ex.markets: continue
        df=_fetch_pair(ex, pair, since_ms)
        if df is not None: return df
    return None

def prep(df, source):
    g=gc(df,source=source)
    if g is None: return None
    f,h,l=g; c=df["close"].values; hi=df["high"].values; N=len(c)
    green=c>=h; red=c<=l
    flip_green=np.zeros(N,bool); cross_up_f=np.zeros(N,bool); rec=np.full(N,9999); last=None
    f_fall=np.zeros(N,bool)
    for t in range(1,N):
        if c[t]>=h[t] and c[t-1]<h[t-1]: flip_green[t]=True; last=t
        if c[t]>=f[t] and c[t-1]<f[t-1]: cross_up_f[t]=True
        if last is not None: rec[t]=t-last
        f_fall[t]= f[t]<f[t-1]
    return dict(idx=df.index, close=c, high=hi, f=f, h=h, l=l, green=green, red=red,
                flip_green=flip_green, cross_up_f=cross_up_f, rec=rec, f_fall=f_fall)

def run(assets, pilot, max_pos, stop=None, btc=None):
    all_dates=sorted(set().union(*[set(a["idx"]) for a in assets.values()]))
    rows={s:{d:i for i,d in enumerate(a["idx"])} for s,a in assets.items()}
    btc_rows={d:i for i,d in enumerate(btc["idx"])} if btc is not None else {}
    pos={}; realized=100000.0; peak=100000.0; mdd=0.0; nl=ns=0; marked=100000.0; warm=210
    for d in all_dates:
        for s in list(pos.keys()):
            i=rows[s].get(d)
            if i is None: continue
            a=assets[s]; p=pos[s]; c=a["close"][i]; side=p["side"]; e=p["entry"]; ex=False
            if side==1:
                if pilot in("P1","P4"): ex = c<a["h"][i] if pilot=="P1" else c<a["f"][i]
                elif pilot in("P2","P3"): ex = c<a["f"][i]
                elif pilot=="P5": ex = c<a["h"][i]
                if stop and c<=e*(1-stop): ex=True
            else:
                tp = 0.70 if pilot=="P3" else 0.65
                if c>a["f"][i] or c<=tp*e or (not a["red"][i]): ex=True
                if stop and c>=e*(1+stop): ex=True
            if ex: realized+=(c-e)*p["qty"]*side; del pos[s]
        marked=realized
        for s,p in pos.items():
            i=rows[s].get(d)
            if i is not None: marked+=(assets[s]["close"][i]-p["entry"])*p["qty"]*p["side"]
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
            side=0; pct=0.0; c=a["close"][i]; f=a["f"][i]; h=a["h"][i]; hi=a["high"][i]
            sz=lambda: 0.08 if a["rec"][i]<=25 else 0.02
            if pilot=="P1":
                if a["green"][i]: side,pct=1,sz()
                elif btc_down and a["red"][i] and hi>=0.98*f and c<f: side,pct=-1,0.05
                elif a["red"][i] and c<f and a["close"][i-1]>=a["f"][i-1]: side,pct=-1,0.03
            elif pilot=="P2":
                if c>=f: side,pct=1,sz()
            elif pilot=="P3":
                if c>=f: side,pct=1,sz()
                elif a["red"][i] and hi>=0.98*f and c<f and a["f_fall"][i]: side,pct=-1,0.03
            elif pilot=="P4":
                if a["flip_green"][i]: side,pct=1,sz()
            elif pilot=="P5":
                if a["flip_green"][i]: side,pct=1,0.05
            if side==0: continue
            size=pct*marked
            if deployed+size>marked: continue
            pos[s]={"side":side,"entry":c,"qty":size/c,"notional":size}
            deployed+=size; nl+=side==1; ns+=side==-1
    return dict(net=(marked-100000.0)/1000.0, mdd=mdd*100, trades=nl+ns, longs=nl, shorts=ns, held=len(pos))

def main():
    import ccxt, yfinance as yf
    SINCE="2020-01-01"; since_ms=int(pd.Timestamp(SINCE).timestamp()*1000)
    print("Fetching crypto (gate.io)…"); ex=None
    for exid in ["gate","kucoin","binanceus"]:
        try: ex=getattr(ccxt,exid)({"enableRateLimit":True,"timeout":15000}); ex.load_markets(); break
        except Exception: ex=None
    cassets={}; btc=None
    for s in crypto_top100():
        df=fetch_crypto(ex,s,since_ms) if ex else None
        if df is None: continue
        pp=prep(df,"ohlc4")
        if pp: cassets[s]=pp
        if s=="BTC": btc=pp
    print(f"  crypto assets: {len(cassets)}")
    print("Fetching stocks (yfinance)…")
    sd=yf.download(STOCKS_TOP150, start=SINCE, interval="1d", progress=False, group_by="ticker", threads=True)
    sassets={}
    for s in STOCKS_TOP150:
        try:
            df=sd[s][["Open","High","Low","Close","Volume"]].dropna(); df.columns=["open","high","low","close","volume"]
            if len(df)<210: continue
            pp=prep(df,"hlc3")
            if pp: sassets[s]=pp
        except Exception: continue
    print(f"  stock assets: {len(sassets)}")
    C=dict(P1=(cassets,8,btc),P2=(cassets,8,None),P3=(cassets,8,None),P4=(cassets,5,None),P5=(sassets,6,None))
    STOP=dict(P1=0.15,P2=0.15,P3=0.15,P4=0.15,P5=0.10)
    NAMES={"P1":"P1 TR-GC-Crypto-LS","P2":"P2 TR-B2S-Crypto (long)","P3":"P3 TR-B2S-Crypto-LS",
           "P4":"P4 TR-B2S-Crypto-LowDD","P5":"P5 TR-B2S-Stocks (long)"}
    print(f"\n============ 5 PILOTS · shared-NAV 1x · {SINCE}→now · slow_line=GC-midline ============")
    print(f"{'pilot':26}{'variant':12}{'net%':>9}{'maxDD%':>9}{'trades':>8}{'L/S':>10}")
    for p in ["P1","P2","P3","P4","P5"]:
        assets,mx,btcref=C[p]
        for lab,stop in [("no-stop",None),(f"{int(STOP[p]*100)}%-stop",STOP[p])]:
            r=run(assets,p,mx,stop=stop,btc=btcref)
            ls=f"{r['longs']}/{r['shorts']}"
            print(f"{NAMES[p]:26}{lab:12}{r['net']:>9.1f}{r['mdd']:>9.1f}{r['trades']:>8}{ls:>10}")
    print("\nAssumptions: slow_line=GC filter/midline; drift=off-list (close below pilot's line);")
    print("universe=mcap rank; sizing 8%/2% by breakout recency (P1-P4), 5% flat (P5). NOT tuned.")

if __name__=="__main__": main()
