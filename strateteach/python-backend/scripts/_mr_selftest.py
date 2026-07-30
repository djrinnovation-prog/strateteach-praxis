"""Self-test: prove mr_strategies.py math == phase2a sim2.py (provenance parity), and that
entry/exit + latest_signal behave correctly. No app deps (numpy/pandas only)."""
import sys, numpy as np, pandas as pd
sys.path.insert(0, "python-backend")
from app.services import mr_strategies as mr

# ---- reference impls copied verbatim from phase2a_analysis/sim2.py ----
def ref_rsi(close, period):
    d=np.diff(close, prepend=close[0]); up=np.clip(d,0,None); dn=np.clip(-d,0,None)
    ru=pd.Series(up).ewm(alpha=1/period, adjust=False).mean().values
    rd=pd.Series(dn).ewm(alpha=1/period, adjust=False).mean().values
    rs=np.divide(ru, rd, out=np.full_like(ru,np.inf), where=rd!=0)
    return 100-100/(1+rs)
def ref_sma(x,n): return pd.Series(x).rolling(n).mean().values
def ref_bb_lo(c): return ref_sma(c,20)-2*pd.Series(c).rolling(20).std(ddof=0).values

rng = np.random.default_rng(42)
c = 100 + np.cumsum(rng.normal(0, 1.5, 800))
c = np.abs(c) + 5.0
df = pd.DataFrame({"open": c, "high": c*1.01, "low": c*0.99, "close": c, "volume": 1.0})

ind = mr.compute_indicators(df)
def close(a, b, name):
    a, b = np.asarray(a, float), np.asarray(b, float)
    m = np.isfinite(a) & np.isfinite(b)
    ok = np.allclose(a[m], b[m], rtol=1e-9, atol=1e-9)
    print(f"  {name:10} parity={'OK' if ok else 'FAIL'}  (finite pts={m.sum()})")
    assert ok, name

print("Indicator parity vs sim2.py:")
close(ind["rsi2"], ref_rsi(c,2), "rsi2")
close(ind["sma5"], ref_sma(c,5), "sma5")
close(ind["sma20"], ref_sma(c,20), "sma20")
close(ind["sma200"], ref_sma(c,200), "sma200")
close(ind["bb_lo"], ref_bb_lo(c), "bb_lo")

# ---- entry/exit rule parity (verbatim rules from sim2.py, BB WITHOUT guard for the compare) ----
def ref_rsi2_entry(a,i): return (a["rsi2"][i] < 10) and (a["c"][i] > a["sma200"][i])
def ref_bb_entry_noguard(a,i): return a["c"][i] < a["bb_lo"][i]
n = len(c); rsi2_match = bb_guard_effect = 0
for i in range(210, n):
    assert mr._rsi2_entry(ind, i) == ref_rsi2_entry(ind, i)
    rsi2_match += int(mr._rsi2_entry(ind, i))
    # our BB entry adds the 200-SMA guard → it must be a SUBSET of the no-guard version
    ours = mr._bb_entry(ind, i); base = ref_bb_entry_noguard(ind, i)
    assert (not ours) or base, "guarded BB entry must imply the base BB entry"
    if base and not ours: bb_guard_effect += 1
print(f"\nRSI2 entry rule parity: OK ({rsi2_match} entries fired)")
print(f"BB 200-SMA guard suppressed {bb_guard_effect} below-regime dip-buys (Phase-2a 2022 fix)")

# ---- exit rule sanity ----
assert mr._rsi2_exit({"c":[0,5],"sma5":[0,10]}, 1, 0, 1.0)[0] is False  # 5<10, not time → hold
assert mr._rsi2_exit({"c":[0,50],"sma5":[0,10]}, 1, 0, 1.0) == (True, "target")  # 50>=10
assert mr._rsi2_exit({"c":[0]*11,"sma5":[1e9]*11}, 10, 0, 1.0) == (True, "time")  # 10-bar stop
assert mr._bb_exit({"c":[0,50],"sma20":[0,10]}, 1, 0, 1.0) == (True, "target")
print("Exit rules (target / time-stop): OK")

# ---- latest_signal payload ----
sig = mr.latest_signal(df, "TEST", "Test Co")
assert sig and sig["bucket"] == "stocks" and sig["currentPrice"] > 0
assert set(sig["entry"]) == {"rsi2", "bb"} and isinstance(sig["aboveRegime"], bool)
assert mr.latest_signal(df.iloc[:50], "X", "X") is None  # too little history → no fabricated signal
print("latest_signal payload + thin-data guard: OK")
print(f"\nPILOTS: {list(mr.MR_PILOTS)} (all paperSimOnly={all(p['paperSimOnly'] for p in mr.MR_PILOTS.values())})")
print("\nALL SELF-TESTS PASSED ✅")
