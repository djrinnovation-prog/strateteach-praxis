"""DR CRYPTO validation — PROD-FAITHFUL stateless engine (canonical ROLLING Chandelier). SIM only.

The production paper-sim (dr_sim) must be STATELESS like Pilot 6 — the scan computes a per-symbol
chandelier stop and the engine just compares currentPrice to it (no per-position high-water storage).
The canonical Chandelier Exit IS rolling: chandStop = highest_high(22) - 3*ATR(22). This validates that
exact rule so the card numbers == what the prod engine produces == the trade log (card===log).

Strategy: Donchian(20) breakout + close>200-SMA entry; exit close < Chandelier(22,3) OR close<200-SMA.
Long-only. Signal@close/fill@next-open, 0.2% RT fees, 5 bps/side slippage, 8-pos cap, equal-weight.
"""
import os, time, json, warnings, urllib.request
warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
CRYPTO_N=int(os.environ.get("CRYPTO_N","200")); SINCE=os.environ.get("SINCE","2018-01-01")
FEE_SIDE=0.001; SLIP=0.0005; MAX_POS=8; NAV0=100_000.0; DONCH=20; ATRL=22; CH=3.0; WARM=210
STABLES={"USDT","USDC","DAI","TUSD","FDUSD","USDE","USDS","BUSD","PYUSD","USDD","FRAX","GUSD"}
WRAPPED={"WBTC","WETH","WEETH","WBETH","WSTETH","STETH","RETH","CBETH","SUSDE","BSC-USD","LEO","WHYPE"}
RENAME={"RNDR":"RENDER","MIOTA":"IOTA","MATIC":"POL","FTM":"S","OKB":"OKT"}
def topN(n):
    try:
        url=("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=%d&page=1"%min(n+50,250))
        d=json.load(urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"bt"}),timeout=25)); out=[]
        for c in d:
            s=(c.get("symbol") or "").upper()
            if s and s not in STABLES and s not in WRAPPED and s not in out: out.append(s)
        if len(out)>=80: print(f"  universe CoinGecko top-{len(out)}"); return out[:n]
    except Exception as e: print("  fallback",str(e)[:50])
    return ["BTC","ETH","BNB","SOL","XRP","ADA","DOGE","TRX","LINK","AVAX","DOT","MATIC","TON","LTC","BCH","UNI","ATOM","XLM","ETC","FIL"]
def _fp(ex,pair,sm):
    out=[];cur=sm
    for _ in range(20):
        try: b=ex.fetch_ohlcv(pair,"1d",since=cur,limit=1000)
        except Exception: return None
        if not b: break
        out+=b; cur=b[-1][0]+86400000
        if len(b)<1000: break
        time.sleep(0.1)
    if len(out)<260: return None
    df=pd.DataFrame(out,columns=["t","open","high","low","close","volume"]).drop_duplicates("t")
    df["ts"]=pd.to_datetime(df["t"],unit="ms"); return df.set_index("ts").sort_index()[["open","high","low","close","volume"]]
def fetch(exs,s,sm):
    for ex in exs:
        for cand in [s]+([RENAME[s]] if s in RENAME else []):
            p=f"{cand}/USDT"
            if p in ex.markets:
                df=_fp(ex,p,sm)
                if df is not None: return df
    return None
def atr(h,l,c,p=ATRL):
    pc=np.roll(c,1);pc[0]=c[0];tr=np.maximum(h-l,np.maximum(np.abs(h-pc),np.abs(l-pc)))
    return pd.Series(tr).ewm(alpha=1/p,adjust=False).mean().values
def prep(df):
    o=df["open"].values.astype(float);h=df["high"].values.astype(float);l=df["low"].values.astype(float);c=df["close"].values.astype(float)
    donch=pd.Series(h).shift(1).rolling(DONCH).max().values
    sma200=pd.Series(c).rolling(200).mean().values
    chand=pd.Series(h).rolling(ATRL).max().values - CH*atr(h,l,c)   # ROLLING Chandelier(22,3)
    return {"dates":df.index.to_numpy(),"open":o,"close":c,"donch":donch,"sma200":sma200,"chand":chand}
def run(assets, dump=False):
    ad=sorted({d for a in assets.values() for d in a["dates"]}); D=len(ad); di={d:i for i,d in enumerate(ad)}
    km={s:{di[d]:j for j,d in enumerate(a["dates"])} for s,a in assets.items()}
    op={};pe=[];pen=[];cash=NAV0;tr=[];eq=[];frac=1/MAX_POS
    for k in range(D):
        d=ad[k]
        for s in list(pe):
            p=op.get(s)
            if not p: continue
            j=km[s].get(k); o=assets[s]["open"][j] if j is not None else p["e"]
            if not(o>0 and np.isfinite(o)): o=p["e"]
            sell=o*(1-SLIP); pr=p["qty"]*sell*(1-FEE_SIDE); co=p["qty"]*p["e"]*(1+FEE_SIDE); cash+=pr
            tr.append({"sym":s,"entry_date":str(pd.Timestamp(ad[p["k"]]).date()),"exit_date":str(pd.Timestamp(d).date()),
                       "entry_price":round(p["e"],6),"exit_price":round(sell,6),"pnl_pct":round((pr/co-1)*100,3),"hold_days":k-p["k"]})
            del op[s]
        pe=[]
        for s in pen:
            if len(op)>=MAX_POS: break
            if s in op: continue
            j=km[s].get(k)
            if j is None: continue
            o=assets[s]["open"][j]
            if not(o>0 and np.isfinite(o)): continue
            sp=min(NAV0*frac,cash)
            if sp<1: continue
            buy=o*(1+SLIP); op[s]={"e":buy,"qty":sp/buy,"k":k}; cash-=sp/buy*buy*(1+FEE_SIDE)
        pen=[]
        m=cash
        for s,p in op.items():
            j=km[s].get(k); px=assets[s]["close"][j] if j is not None else p["e"]
            if px>0 and np.isfinite(px): m+=p["qty"]*px
        eq.append(m)
        for s,p in list(op.items()):
            j=km[s].get(k)
            if j is None or j<WARM: continue
            a=assets[s];c=a["close"][j]
            if (not np.isnan(a["chand"][j]) and c<a["chand"][j]) or c<a["sma200"][j]:
                if s not in pe: pe.append(s)
        free=MAX_POS-(len(op)-len(pe)); cands=[]
        for s,a in assets.items():
            if s in op: continue
            j=km[s].get(k)
            if j is None or j<WARM: continue
            if not np.isnan(a["donch"][j]) and a["close"][j]>a["donch"][j] and a["close"][j]>a["sma200"][j]:
                cands.append((s,j,-(a["close"][j]-a["donch"][j])))
        cands.sort(key=lambda x:x[2])
        for s,j,_ in cands[:max(0,free)]: pen.append(s)
    last=D-1
    for s,p in list(op.items()):
        j=km[s].get(last);px=assets[s]["close"][j] if j is not None else p["e"]
        sell=px*(1-SLIP);pr=p["qty"]*sell*(1-FEE_SIDE);co=p["qty"]*p["e"]*(1+FEE_SIDE);cash+=pr
        tr.append({"sym":s,"entry_date":str(pd.Timestamp(ad[p["k"]]).date()),"exit_date":str(pd.Timestamp(ad[last]).date()),
                   "entry_price":round(p["e"],6),"exit_price":round(sell,6),"pnl_pct":round((pr/co-1)*100,3),"hold_days":last-p["k"]})
    eq=np.array(eq); net=(eq[-1]/eq[0]-1)*100; peak=np.maximum.accumulate(eq); mdd=((eq-peak)/peak).min()*100
    yrs=(pd.Timestamp(ad[-1])-pd.Timestamp(ad[0])).days/365.25
    ann=((eq[-1]/eq[0])**(1/yrs)-1)*100; r=np.array([t["pnl_pct"] for t in tr])/100
    return dict(net=net,ann=ann,mdd=mdd,n=len(tr),win=(r>0).mean()*100,hold=np.mean([t["hold_days"] for t in tr]),tday=len(tr)/D,yrs=yrs,tr=tr,eq=eq,ad=ad)
def main():
    import ccxt; sm=int(pd.Timestamp(SINCE).timestamp()*1000)
    exs=[]
    for x in ["gate","kucoin","binanceus"]:
        try: e=getattr(ccxt,x)({"enableRateLimit":True,"timeout":15000});e.load_markets();exs.append(e);print("  up",x)
        except Exception: pass
    assets={}
    for s in topN(CRYPTO_N):
        df=fetch(exs,s,sm) if exs else None
        if df is not None and len(df)>=WARM+20: assets[s]=prep(df)
    print(f"  assets {len(assets)}")
    R=run(assets)
    print(f"\nDR CRYPTO (Donchian20+200SMA+rolling Chandelier22/3), net of fees+slip, {SINCE}->now ~{R['yrs']:.1f}y")
    print(f"  NET {R['net']:+.1f}%  ~ann {R['ann']:+.1f}%/yr  maxDD {R['mdd']:.1f}%  trades {R['n']}  win {R['win']:.1f}%  hold {R['hold']:.1f}d  t/day {R['tday']:.2f}")
    # Emit the pilot5-compatible trade-log schema the report panel reads: symbol/side/size($)/
    # pnl($)/running_equity + config.initial_capital. Fixed fractional sizing (12.5%/pos) on a
    # $1000 base so the panel's sequential pnl-sum reproduces the portfolio net (card===log).
    IC=1000.0; SIZE=round(IC*0.125,2); tr=R["tr"]
    for t in tr:
        t["symbol"]=t.pop("sym"); t["side"]="long"; t["size"]=SIZE
        t["pnl"]=round(SIZE*t["pnl_pct"]/100.0,2)
    eq=IC
    for t in sorted(tr,key=lambda x:x["exit_date"]):
        eq=round(eq+t["pnl"],2); t["running_equity"]=eq
    full_net=round((eq/IC-1)*100,2)
    doc={"summary":{"net_profit_pct":full_net,"max_drawdown_pct":round(abs(R["mdd"]),2),
                    "profit_factor":round(float(np.array([t['pnl_pct'] for t in tr if t['pnl_pct']>0]).sum()/max(1e-9,-np.array([t['pnl_pct'] for t in tr if t['pnl_pct']<=0]).sum())),2),
                    "trades":R["n"],"win_rate_pct":round(R["win"],1),"avg_hold_days":round(R["hold"],1),
                    "annualized_pct":round(R["ann"],1),
                    "config":"Donchian(20) breakout + 200-SMA regime + rolling Chandelier(22,3) trailing stop, long-only, "
                             "net 0.2%rt fees + 5bps/side slippage, signal@close/fill@next-open, 8-pos cap, no tuning"},
          "config":{"initial_capital":IC,"position_size":"12.5% of capital per position (8-position cap)",
                    "commission_pct":0.1,"slippage_bps_per_side":5.0,
                    "note":"Simulation of the strategy over the window on the pilot's capital — NOT the user's earned P&L."},
          "trades":sorted(tr,key=lambda t:t["entry_date"])}
    open("dashboard/public/dr-crypto-validated-trades.json","w").write(json.dumps(doc,separators=(",",":")))
    print(f"  trade log -> dashboard/public/dr-crypto-validated-trades.json ({R['n']} trades) net {full_net}%")
if __name__=="__main__": main()
