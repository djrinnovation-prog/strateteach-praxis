"""DR CRYPTO · honest TARGET (take-profit) sweep on the SHIPPED engine. SIMULATION only.

Regenerates the take-profit tradeoff on the EXACT shipped DR Crypto engine (Donchian(20)+200-SMA+
rolling Chandelier(22,3), the +526% no-cap baseline) so the "no cap" setting matches the live card.
Settings: no-cap (ride the trend) / TP 3% / TP 2% / TP 1%.

Per setting reports (net of 0.2% RT fees + 5 bps/side slippage, same rigor): total return, ~annual,
win%, max drawdown, % of DAYS that actually hit the target, and a sampled equity curve on a $1000 base.
Feeds the honest target slider — tighter target = higher win% + more green days but LOWER return +
deeper drawdown. NO tune-to-target.

Writes dashboard/public/dr-crypto-target-sweep.json.
"""
import os, time, json, warnings, urllib.request
warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
CRYPTO_N=int(os.environ.get("CRYPTO_N","200")); SINCE=os.environ.get("SINCE","2018-01-01")
FEE_SIDE=0.001; SLIP=0.0005; MAX_POS=8; NAV0=1000.0; DONCH=20; ATRL=22; CH=3.0; WARM=210
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
    return {"dates":df.index.to_numpy(),"open":o,"high":h,"close":c,
            "donch":pd.Series(h).shift(1).rolling(DONCH).max().values,
            "sma200":pd.Series(c).rolling(200).mean().values,
            "chand":pd.Series(h).rolling(ATRL).max().values-CH*atr(h,l,c)}
def run(assets, tp):
    """tp=None (no-cap, ride trend) or fraction. TP = intraday limit fill at +tp; else chandelier/regime."""
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
            sell=o*(1-SLIP); tr.append(p["qty"]*(sell*(1-FEE_SIDE))-p["qty"]*p["e"]*(1+FEE_SIDE)); cash+=p["qty"]*sell*(1-FEE_SIDE); del op[s]
        pe=[]
        for s in pen:
            if len(op)>=MAX_POS: break
            if s in op: continue
            j=km[s].get(k)
            if j is None: continue
            o=assets[s]["open"][j]
            if not(o>0 and np.isfinite(o)): continue
            sp=min(NAV0*frac,cash)
            if sp<0.01: continue
            buy=o*(1+SLIP); op[s]={"e":buy,"qty":sp/buy}; cash-=sp/buy*buy*(1+FEE_SIDE)
        pen=[]
        # intraday TP (limit) — fills same day when the high touches +tp
        if tp is not None:
            for s in list(op):
                p=op[s]; j=km[s].get(k)
                if j is None: continue
                tgt=p["e"]*(1+tp)
                if assets[s]["high"][j]>=tgt:
                    sell=tgt*(1-SLIP); tr.append(p["qty"]*(sell*(1-FEE_SIDE))-p["qty"]*p["e"]*(1+FEE_SIDE)); cash+=p["qty"]*sell*(1-FEE_SIDE); del op[s]
        m=cash
        for s,p in op.items():
            j=km[s].get(k); px=assets[s]["close"][j] if j is not None else p["e"]
            if px>0 and np.isfinite(px): m+=p["qty"]*px
        eq.append(m)
        for s,p in list(op.items()):
            j=km[s].get(k)
            if j is None or j<WARM: continue
            a=assets[s]; c=a["close"][j]
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
        sell=px*(1-SLIP); tr.append(p["qty"]*(sell*(1-FEE_SIDE))-p["qty"]*p["e"]*(1+FEE_SIDE)); cash+=p["qty"]*sell*(1-FEE_SIDE)
    eq=np.array(eq); trr=np.array(tr)
    net=(eq[-1]/eq[0]-1)*100; peak=np.maximum.accumulate(eq); mdd=((eq-peak)/peak).min()*100
    yrs=(pd.Timestamp(ad[-1])-pd.Timestamp(ad[0])).days/365.25; ann=((eq[-1]/eq[0])**(1/yrs)-1)*100
    win=(trr>0).mean()*100 if len(trr) else 0
    dr=eq[1:]/eq[:-1]-1.0
    # sampled nav curve (every ~11 days) for a compact chart
    step=max(1,len(eq)//120); nav=[{"date":str(pd.Timestamp(ad[i]).date()),"equity":round(float(eq[i]),2)} for i in range(0,len(eq),step)]
    if nav[-1]["date"]!=str(pd.Timestamp(ad[-1]).date()): nav.append({"date":str(pd.Timestamp(ad[-1]).date()),"equity":round(float(eq[-1]),2)})
    return dict(net=round(net,1),ann=round(ann,1),mdd=round(mdd,1),win=round(win,1),trades=len(trr),
                nav=nav,dr=dr,yrs=yrs)
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
    SET=[("nocap",None,{"he":"בלי תקרה · רכיבה על המגמה","en":"No cap · ride the trend"}),
         ("tp3",0.03,{"he":"תקרה 3%","en":"Target 3%"}),
         ("tp2",0.02,{"he":"תקרה 2%","en":"Target 2%"}),
         ("tp1",0.01,{"he":"תקרה 1%","en":"Target 1%"})]
    out=[]
    for key,tp,lab in SET:
        R=run(assets,tp)
        target=(tp or 0)*100
        hit=round(float((R["dr"]>= (tp if tp else 0.02)).mean()*100),1)   # % days clearing the target (no-cap uses +2% ref)
        out.append({"key":key,"label":lab,"tp_pct":(round(target,0) if tp else None),
                    "net_pct":R["net"],"ann_pct":R["ann"],"win_pct":R["win"],"maxdd_pct":R["mdd"],
                    "trades":R["trades"],"pct_days_hit":hit,"nav":R["nav"]})
        print(f"  {key:6} net {R['net']:+.1f}%  ann {R['ann']:+.1f}%  win {R['win']:.1f}%  DD {R['mdd']:.1f}%  daysHit {hit}%")
    doc={"base_capital":NAV0,"period":{"since":SINCE},"assets":len(assets),
         "note":"SIMULATION over 2018→now, net of 0.2% RT fees + 5 bps/side slippage, no tune-to-target. "
                "Tighter target raises win-rate but LOWERS total return and deepens drawdown.",
         "settings":out}
    open("dashboard/public/dr-crypto-target-sweep.json","w").write(json.dumps(doc,separators=(",",":")))
    print("  -> dashboard/public/dr-crypto-target-sweep.json")
if __name__=="__main__": main()
