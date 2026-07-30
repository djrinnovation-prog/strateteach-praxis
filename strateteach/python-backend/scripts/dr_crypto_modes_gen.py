"""DR CRYPTO · generate the 3 RISK-MODE datasets (Aggressive / Smooth / Safe). SIMULATION only.

Each mode is a real COMPOUNDING config on the shipped DR engine (Donchian(20)+200-SMA+rolling
Chandelier(22,3)), full 2018→2026, net of 0.2% fees + 5 bps/side slippage, on a $1000 base. Emits one
pilot5-compatible trade-log JSON per mode (symbol/side/size($)/pnl($)/running_equity + true summary +
true mark-to-market nav curve) that the report panel reads. NO tune-to-target.

Modes (from the risk-controls R&D):
  🔴 aggressive = compound, no controls (12.5%/pos)          → biggest return, deepest DD
  🟡 smooth (DEFAULT) = compound + vol-target + dd-guard(25%) → most return under a ~-35% DD
  🟢 safe = compound + 8%/pos + vol-target + expo70 + dd25    → lower DD, lower return

summary.max_drawdown_pct is the TRUE mark-to-market drawdown (the number shown next to the return).
"""
import os, time, json, warnings, urllib.request
warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
CRYPTO_N=int(os.environ.get("CRYPTO_N","250")); SINCE=os.environ.get("SINCE","2018-01-01")
FEE_SIDE=0.001; SLIP=0.0005; MAX_POS=8; NAV0=1000.0; DONCH=20; ATRL=22; CH=3.0; WARM=210
CORE_N=80; TARGET_VOL=0.05
STABLES={"USDT","USDC","DAI","TUSD","FDUSD","USDE","USDS","BUSD","PYUSD","USDD","FRAX","GUSD"}
WRAPPED={"WBTC","WETH","WEETH","WBETH","WSTETH","STETH","RETH","CBETH","SUSDE","BSC-USD","LEO","WHYPE"}
RENAME={"RNDR":"RENDER","MIOTA":"IOTA","MATIC":"POL","FTM":"S","OKB":"OKT"}
def topN(n):
    try:
        url=("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1")
        d=json.load(urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"bt"}),timeout=25)); out=[]
        for c in d:
            s=(c.get("symbol") or "").upper()
            if s and s not in STABLES and s not in WRAPPED and s not in out: out.append(s)
        if len(out)>=80: print(f"  universe top-{len(out)}"); return out[:n]
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
        time.sleep(0.08)
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
    a14=atr(h,l,c,14)
    return {"dates":df.index.to_numpy(),"open":o,"high":h,"close":c,
            "donch":pd.Series(h).shift(1).rolling(DONCH).max().values,
            "sma200":pd.Series(c).rolling(200).mean().values,
            "chand":pd.Series(h).rolling(ATRL).max().values-CH*atr(h,l,c),
            "atrpct":np.divide(a14,c,out=np.full_like(a14,0.05),where=c>0)}
def run(assets, per_frac=0.125, expo_cap=1.0, vol_tgt=False, dd_guard=None):
    ad=sorted({d for a in assets.values() for d in a["dates"]}); D=len(ad); di={d:i for i,d in enumerate(ad)}
    lk={s:{di[d]:j for j,d in enumerate(a["dates"])} for s,a in assets.items()}
    op={};pe=[];pen=[];cash=NAV0;eq=[];peak=NAV0; trades=[]
    def equity_now(k):
        m=cash
        for s,p in op.items():
            j=lk[s].get(k); px=assets[s]["close"][j] if j is not None else p["e"]
            if px>0 and np.isfinite(px): m+=p["qty"]*px
        return m
    for k in range(D):
        d=ad[k]
        for s in list(pe):
            p=op.get(s)
            if not p: continue
            j=lk[s].get(k); o=assets[s]["open"][j] if j is not None else p["e"]
            if not(o>0 and np.isfinite(o)): o=p["e"]
            sell=o*(1-SLIP); proceeds=p["qty"]*sell*(1-FEE_SIDE); cost=p["qty"]*p["e"]*(1+FEE_SIDE)
            cash+=proceeds
            trades.append({"symbol":s,"side":"long","entry_date":str(pd.Timestamp(ad[p["k"]]).date()),
                           "exit_date":str(pd.Timestamp(d).date()),"entry_price":round(p["e"],8),
                           "exit_price":round(sell,8),"size":round(p["sz"],2),"qty":round(p["qty"],8),
                           "pnl":round(proceeds-cost,2),"pnl_pct":round((proceeds/cost-1)*100,3)})
            del op[s]
        pe=[]
        equity=equity_now(k); peak=max(peak,equity); ddown=equity/peak-1.0
        # dd-guard = RESIZE (halve position size while >X% below the equity high). Tested a full
        # PAUSE variant: it costs ~900% return for ~1% less DD and makes counts incoherent, so
        # resize is the honest better control. Modes differ in SIZING, not signals → same trade set.
        risk_mult = 0.5 if (dd_guard is not None and ddown < -dd_guard) else 1.0
        deployed=equity-cash
        for s,ei in pen:
            if len(op)>=MAX_POS: break
            if s in op: continue
            j=lk[s].get(k)
            if j is None: continue
            o=assets[s]["open"][j]
            if not(o>0 and np.isfinite(o)): continue
            base=per_frac*equity*risk_mult
            if vol_tgt:
                apct=assets[s]["atrpct"][j] if np.isfinite(assets[s]["atrpct"][j]) and assets[s]["atrpct"][j]>0 else 0.05
                base*=min(1.5,max(0.3,TARGET_VOL/apct))
            avail=expo_cap*equity-deployed; sp=min(base,avail,cash)
            if sp<0.01: continue
            buy=o*(1+SLIP); op[s]={"e":buy,"qty":sp/buy,"k":k,"sz":sp,"seen":k,"lastpx":buy}; cash-=sp/buy*buy*(1+FEE_SIDE); deployed+=sp
        pen=[]
        eq.append(equity_now(k))
        for s,p in list(op.items()):
            j=lk[s].get(k)
            if j is not None: p["seen"]=k; p["lastpx"]=assets[s]["close"][j]
            if k-p["seen"]>45:   # delisting / prolonged data gap → force-close at last known price (cleans stuck positions)
                px=p["lastpx"]; sell=px*(1-SLIP); proceeds=p["qty"]*sell*(1-FEE_SIDE); cost=p["qty"]*p["e"]*(1+FEE_SIDE); cash+=proceeds
                trades.append({"symbol":s,"side":"long","entry_date":str(pd.Timestamp(ad[p["k"]]).date()),
                               "exit_date":str(pd.Timestamp(ad[k]).date()),"entry_price":round(p["e"],8),
                               "exit_price":round(sell,8),"size":round(p["sz"],2),"qty":round(p["qty"],8),
                               "pnl":round(proceeds-cost,2),"pnl_pct":round((proceeds/cost-1)*100,3)}); del op[s]; continue
            if j is None or j<WARM: continue
            a=assets[s]; c=a["close"][j]
            if (not np.isnan(a["chand"][j]) and c<a["chand"][j]) or c<a["sma200"][j]:
                if s not in pe: pe.append(s)
        free=MAX_POS-(len(op)-len(pe)); cands=[]
        for s,a in assets.items():
            if s in op: continue
            j=lk[s].get(k)
            if j is None or j<WARM: continue
            if np.isnan(a["donch"][j]) or a["close"][j]<=a["donch"][j] or a["close"][j]<=a["sma200"][j]: continue
            cands.append((s,j,-(a["close"][j]-a["donch"][j])))
        cands.sort(key=lambda x:x[2])
        for s,j,_ in cands[:max(0,free)]: pen.append((s,j))
    last=D-1
    for s,p in list(op.items()):
        j=lk[s].get(last); px=assets[s]["close"][j] if j is not None else p["e"]
        sell=px*(1-SLIP); proceeds=p["qty"]*sell*(1-FEE_SIDE); cost=p["qty"]*p["e"]*(1+FEE_SIDE); cash+=proceeds
        trades.append({"symbol":s,"side":"long","entry_date":str(pd.Timestamp(ad[p["k"]]).date()),
                       "exit_date":str(pd.Timestamp(ad[last]).date()),"entry_price":round(p["e"],8),
                       "exit_price":round(sell,8),"size":round(p["sz"],2),"qty":round(p["qty"],8),
                       "pnl":round(proceeds-cost,2),"pnl_pct":round((proceeds/cost-1)*100,3)})
    eq=np.array(eq); net=(eq[-1]/eq[0]-1)*100; peak=np.maximum.accumulate(eq); mdd=((eq-peak)/peak).min()*100
    yrs=(pd.Timestamp(ad[-1])-pd.Timestamp(ad[0])).days/365.25; ann=((eq[-1]/eq[0])**(1/yrs)-1)*100 if eq[-1]>0 else -100
    # running_equity in CLOSE order (realized path); the panel sums pnl to reproduce it
    reo=1000.0
    for t in sorted(trades,key=lambda x:x["exit_date"]):
        reo=round(reo+t["pnl"],2); t["running_equity"]=reo
    r=np.array([t["pnl_pct"] for t in trades]); win=(r>0).mean()*100 if len(r) else 0
    gp=float(np.array([t["pnl"] for t in trades if t["pnl"]>0]).sum()); gl=float(-np.array([t["pnl"] for t in trades if t["pnl"]<=0]).sum())
    pf=round(gp/gl,2) if gl>0 else 0
    step=max(1,len(eq)//120); nav=[{"date":str(pd.Timestamp(ad[i]).date()),"equity":round(float(eq[i]),2)} for i in range(0,len(eq),step)]
    nav.append({"date":str(pd.Timestamp(ad[-1]).date()),"equity":round(float(eq[-1]),2)})
    return dict(net=round(net,1),mdd=round(abs(mdd),1),ann=round(ann,1),win=round(win,1),trades=len(trades),pf=pf,
                nav=nav, tr=sorted(trades,key=lambda t:t["entry_date"]))
def main():
    import ccxt; sm=int(pd.Timestamp(SINCE).timestamp()*1000)
    exs=[]
    for x in ["gate","kucoin","binanceus"]:
        try: e=getattr(ccxt,x)({"enableRateLimit":True,"timeout":15000});e.load_markets();exs.append(e);print("  up",x)
        except Exception: pass
    usable=[]
    for s in topN(CRYPTO_N):
        df=fetch(exs,s,sm) if exs else None
        if df is not None and len(df)>=WARM+20: usable.append((s,prep(df)))
    core={s:a for s,a in usable[:CORE_N]}
    print(f"  core universe {len(core)}\n")
    MODES=[("aggressive","🔴",{"he":"אגרסיבי","en":"Aggressive"},dict(per_frac=0.125)),
           ("smooth","🟡",{"he":"מאוזן","en":"Smooth"},dict(per_frac=0.125,vol_tgt=True,dd_guard=0.25)),
           ("safe","🟢",{"he":"בטוח","en":"Safe"},dict(per_frac=0.08,vol_tgt=True,expo_cap=0.70,dd_guard=0.25))]
    modes_meta=[]
    for key,emoji,lab,kw in MODES:
        R=run(core,**kw)
        doc={"summary":{"net_profit_pct":R["net"],"max_drawdown_pct":R["mdd"],"annualized_pct":R["ann"],
                        "win_rate_pct":R["win"],"trades":R["trades"],"profit_factor":R["pf"]},
             "config":{"initial_capital":1000.0,"mode":key,
                       "sizing":"compound · " + ", ".join(f"{k}={v}" for k,v in kw.items()),
                       "note":"SIMULATION over 2018→now, net of fees + slippage, on a $1000 base. Compounding. "
                              "Survivorship-flattered (current top-80) and leans on the 2020-21 bull. Not earned P&L."},
             "trades":R["tr"]}
        open(f"dashboard/public/dr-crypto-{key}-trades.json","w").write(json.dumps(doc,separators=(",",":")))
        modes_meta.append({"key":key,"emoji":emoji,"label":lab,"net_pct":R["net"],"maxdd_pct":R["mdd"],
                           "ann_pct":R["ann"],"win_pct":R["win"],"trades":R["trades"],"pf":R["pf"],
                           "tradesUrl":f"/dr-crypto-{key}-trades.json?v=1","nav":R["nav"]})
        print(f"  {emoji} {key:11} net {R['net']:+,.0f}%  DD -{R['mdd']:.0f}%  ann {R['ann']:+.0f}%  win {R['win']:.0f}%  trades {R['trades']}")
    open("dashboard/public/dr-crypto-modes.json","w").write(json.dumps({"default":"smooth","modes":modes_meta},separators=(",",":")))
    print("  -> dashboard/public/dr-crypto-modes.json + 3 per-mode trade logs")
if __name__=="__main__": main()
