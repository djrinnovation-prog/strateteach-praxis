"""Post-process the Dan-approved StrateTeach wordmark PNGs so the LEADING letters
(S t r a…) start from a darker, more-saturated tone for readable contrast — while
keeping the exact approved letterforms, 3D extrusion, and white segment-cuts.

Why post-process instead of re-render: there was never a render script in the repo,
and a from-scratch recreation would not match the approved art. This shifts ONLY the
leading letters darker: a left-weighted darken+saturate in HSV that fades to zero by
~mid-word, applied per-skin (each PNG keeps its own palette). White segment-cuts are
preserved by skipping near-white (low-saturation) pixels. Idempotent-ish knobs below.

Run (in a Pillow+numpy container):  python dashboard/tools_logo_darken.py
"""
import numpy as np
from PIL import Image
import os

PUB = os.environ.get("PUB", "/pub")
SKINS = ["navy", "peach", "nude", "sea"]

# ── knobs (Dan may fine-tune darkness) ──────────────────────────────────────────
DARK   = 0.15   # max value-multiply reduction at the far-left edge (15% darker — softened
                # from 0.30 per Dan "ההכהיה חזקה מדי"; leading letters just barely darker)
SAT    = 0.22   # max saturation boost at the far-left edge (+22%, softened from 0.45)
CUTOFF = 0.42   # weight fades from 1.0 at x=0 to 0.0 at CUTOFF*width (≈ mid "Strate")
GAMMA  = 1.15   # fade curve
S_MIN  = 0.12   # pixels below this saturation are near-white (segment-cuts) → untouched

def rgb_to_hsv(rgb):
    r,g,b = rgb[...,0], rgb[...,1], rgb[...,2]
    mx = np.max(rgb, axis=-1); mn = np.min(rgb, axis=-1); df = mx-mn
    v = mx
    s = np.where(mx>0, df/np.where(mx==0,1,mx), 0)
    h = np.zeros_like(mx)
    mask = df>1e-6
    # per-channel hue
    rc = (mx-r); gc=(mx-g); bc=(mx-b)
    hr = np.where((mx==r)&mask, (g-b)/np.where(df==0,1,df), 0)
    hg = np.where((mx==g)&mask, 2.0+(b-r)/np.where(df==0,1,df), 0)
    hb = np.where((mx==b)&mask, 4.0+(r-g)/np.where(df==0,1,df), 0)
    h = (hr+hg+hb)
    h = (h/6.0) % 1.0
    return h,s,v

def hsv_to_rgb(h,s,v):
    i = np.floor(h*6.0).astype(int)
    f = h*6.0 - i
    p = v*(1-s); q = v*(1-f*s); t = v*(1-(1-f)*s)
    i = i % 6
    r = np.select([i==0,i==1,i==2,i==3,i==4,i==5],[v,q,p,p,t,v])
    g = np.select([i==0,i==1,i==2,i==3,i==4,i==5],[t,v,v,q,p,p])
    b = np.select([i==0,i==1,i==2,i==3,i==4,i==5],[p,p,t,v,v,q])
    return np.stack([r,g,b], axis=-1)

def lead_avg(arr):
    a = arr[...,3]; rgb = arr[...,:3]
    W = arr.shape[1]
    xs = np.arange(W); colmask = xs < int(W*0.09)
    m = (a>40) & colmask[None,:]
    if m.sum()==0: return (0,0,0)
    return tuple(int(v) for v in rgb[m].mean(axis=0))

for skin in SKINS:
    p = os.path.join(PUB, f"logo-{skin}.png")
    im = Image.open(p).convert("RGBA")
    arr = np.asarray(im).astype(np.float64)
    before = lead_avg(arr)
    H, W, _ = arr.shape
    rgb = arr[...,:3]/255.0
    a = arr[...,3]
    h,s,v = rgb_to_hsv(rgb)
    # left-weighted column weight
    xfrac = np.arange(W)/W
    wcol = np.clip((CUTOFF - xfrac)/CUTOFF, 0, 1) ** GAMMA          # (W,)
    w2d = np.broadcast_to(wcol[None,:], (H,W))
    colored = (a>40) & (s > S_MIN)                                  # skip near-white cuts + transparent
    we = np.where(colored, w2d, 0.0)
    v2 = v * (1 - DARK*we)
    s2 = np.clip(s * (1 + SAT*we), 0, 1)
    new_rgb = hsv_to_rgb(h, s2, v2)
    out_rgb = np.where(colored[...,None], new_rgb*255.0, arr[...,:3])
    out = np.concatenate([out_rgb, a[...,None]], axis=-1)
    out = np.clip(out, 0, 255).astype(np.uint8)
    after = lead_avg(out.astype(np.float64))
    Image.fromarray(out, "RGBA").save(p)
    print(f"{skin}: leadAvgRGB {before} -> {after}")
print("done")
