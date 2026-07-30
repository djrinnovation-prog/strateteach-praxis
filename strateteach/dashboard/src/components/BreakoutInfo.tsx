import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { C, MONO } from "../theme";

// ── Decision-support: breakout signal on a position row ───────────────────────
// For an OPEN position, surface the cached daily-scan breakout signal (matched by
// symbol) so the user can judge — right where they decide to sell — whether the
// breakout is still strong. STRICTLY READ-ONLY: pure display of already-computed
// scan fields (breakoutDate / pctToGreen / changeYesterdayPct / stillGreen /
// weekHistory …). It NEVER recomputes signals and NEVER touches money/orders.
//
// The fields come from /signals/daily (api.dailyScan().results) — the same daily
// breakout scan that feeds the Trading Engine. Match is by BASE symbol (e.g. BTC).

export type BreakoutStatus = "green" | "grey" | "red" | null;

// Live status derived ONLY from the already-computed scan fields (no recompute):
//   green = still at/above the upper band (breaking out)
//   red   = at/below the lower band (below the line)
//   grey  = between the bands (cooling / holding)
export function breakoutStatus(sig: any): BreakoutStatus {
  if (!sig) return null;
  if (sig.stillGreen) return "green";
  if (typeof sig.pctToRed === "number" && sig.pctToRed <= 0) return "red";
  return "grey";
}

const STATUS_COLOR: Record<Exclude<BreakoutStatus, null>, string> = {
  green: C.gain, grey: C.gold, red: C.loss,
};
function statusLabel(s: Exclude<BreakoutStatus, null>, he: boolean): string {
  if (s === "green") return he ? "בפריצה" : "breaking out";
  if (s === "grey") return he ? "מתקרר" : "cooling";
  return he ? "מתחת לקו" : "below line";
}

// Build a base-symbol → signal map from the daily-scan results (BTC, ETH, …).
export function buildSignalMap(results: any[] | undefined): Record<string, any> {
  const map: Record<string, any> = {};
  for (const s of results || []) {
    const base = String(s?.symbol || s?.asset || "").split("/")[0].toUpperCase();
    if (base && !map[base]) map[base] = s;
  }
  return map;
}

// Small always-visible status pill (colored dot + word). Renders nothing when
// there's no matching signal, so rows without scan coverage stay clean.
export function BreakoutChip({ sig, he }: { sig: any; he: boolean }) {
  const st = breakoutStatus(sig);
  if (!st) return null;
  const col = STATUS_COLOR[st];
  return (
    <span title={he ? "מצב הפריצה עכשיו" : "Live breakout status"}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, fontWeight: 800,
        color: col, background: `${col}18`, border: `1px solid ${col}55`, borderRadius: 999, padding: "1px 6px", whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: col, flexShrink: 0 }} />
      {statusLabel(st, he)}
    </span>
  );
}

// ── Last-7-days trend (Yoav #2L18) ────────────────────────────────────────────
// Direction of the asset over the last 7 days, read from the daily-scan weekHistory
// — the only 7-day series the scan carries. Each day votes bullish/bearish/flat by
// the SAME above-/below-midline tiers the backend assigns (breaking_out / uptrend /
// near_breakout / building = up; breaking_down / downtrend / near_breakdown /
// falling = down; neutral = flat); the sign of the net vote is the trend. Returns
// null when there's no usable 7-day data so the arrow is simply hidden — NEVER a
// fabricated direction.
function dayDir(state: any): 1 | -1 | 0 {
  const s = String(state || "").toLowerCase();
  if (s === "breaking_out" || s === "uptrend" || s === "near_breakout" || s === "building") return 1;
  if (s === "breaking_down" || s === "downtrend" || s === "near_breakdown" || s === "falling") return -1;
  return 0;
}
export function weekTrend(sig: any): "up" | "down" | null {
  const days: any[] = Array.isArray(sig?.weekHistory) ? sig.weekHistory.slice(-7) : [];
  if (days.length < 2) return null;
  const net = days.reduce((a, d) => a + dayDir(d?.state), 0);
  if (net > 0) return "up";
  if (net < 0) return "down";
  return null;
}

// A tiny "last 7 days trend" arrow shown on a position row, just before the row's
// end controls. Direction (up/down) from weekTrend; oriented per language so it
// points along the reading direction (up/down-RIGHT in LTR, mirrored to the LEFT in
// RTL). Skin-tokened (gain/loss). Renders nothing when there's no usable 7-day data.
export function WeekTrendArrow({ sig, he, rtl }: { sig: any; he: boolean; rtl: boolean }) {
  const dir = weekTrend(sig);
  if (!dir) return null;
  const up = dir === "up";
  const col = up ? C.gain : C.loss;
  const Icon = up ? TrendingUp : TrendingDown;
  const label = he ? `מגמת 7 ימים: ${up ? "עולה" : "יורדת"}` : `7-day trend: ${up ? "up" : "down"}`;
  return (
    <span title={label} aria-label={label} role="img"
      style={{ flexShrink: 0, alignSelf: "center", display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 20, height: 20, minWidth: 20, borderRadius: 7, background: `${col}14`, border: `1px solid ${col}44`,
        color: col, transform: rtl ? "scaleX(-1)" : "none" }}>
      <Icon size={12} strokeWidth={2.6} />
    </span>
  );
}

const fmtPct = (v: any) => (typeof v === "number" && !isNaN(v)) ? `${v > 0 ? "+" : ""}${v.toFixed(1)}%` : "—";

function daysSince(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (isNaN(t)) return null;
  const d = Math.floor((Date.now() - t) / 86400000);
  return d >= 0 ? d : null;
}

// Map a weekHistory state string to a trail-dot color (green up / red down / grey).
function stateColor(state: string): string {
  const s = String(state || "").toLowerCase();
  if (s.includes("up") || s.includes("breaking_out") || s.includes("green")) return C.gain;
  if (s.includes("down") || s.includes("red") || s.includes("falling")) return C.loss;
  return C.muted;
}

// The full expandable detail block: breakout date + age, distance to the breakout
// line, yesterday/today momentum, live status, and the 7-day state trail — every
// value read straight from the scan signal.
export function BreakoutDetail({ sig, he, rtl }: { sig: any; he: boolean; rtl: boolean }) {
  if (!sig) {
    return (
      <div style={{ fontSize: 11, color: C.faint, padding: "2px 2px 4px" }}>
        {he ? "אין נתוני פריצה עדכניים לסמל הזה בסריקה היומית." : "No fresh breakout data for this symbol in today's scan."}
      </div>
    );
  }
  const st = breakoutStatus(sig);
  const col = st ? STATUS_COLOR[st] : C.muted;
  const age = daysSince(sig.breakoutDate);
  const ptg = typeof sig.pctToGreen === "number" ? sig.pctToGreen : null;
  // pctToGreen<=0 → price is ABOVE the upper band by |ptg|% (in breakout);
  // >0 → still that % BELOW the breakout line.
  const lineTxt = ptg == null ? "—"
    : ptg <= 0 ? (he ? `+${Math.abs(ptg).toFixed(1)}% מעל` : `+${Math.abs(ptg).toFixed(1)}% above`)
               : (he ? `${ptg.toFixed(1)}% מתחת` : `${ptg.toFixed(1)}% below`);
  const lineCol = ptg == null ? C.muted : ptg <= 0 ? C.gain : C.loss;
  const item: React.CSSProperties = { whiteSpace: "nowrap" };
  const b: React.CSSProperties = { color: C.text, fontFamily: MONO };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px",
      fontSize: 11, color: C.muted, direction: rtl ? "rtl" : "ltr", paddingTop: 2 }}>
      {st && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 800, color: col }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: col }} />
          {statusLabel(st, he)}
        </span>
      )}
      <span style={item}>{he ? "פריצה" : "Breakout"}: <b style={{ color: C.text }}>{sig.breakoutDate || "—"}</b>
        {age != null && <span style={{ color: C.faint }}> ({age === 0 ? (he ? "היום" : "today") : (he ? `לפני ${age} י׳` : `${age}d ago`)})</span>}</span>
      <span style={item}>{he ? "מהפריצה" : "vs line"}: <b style={{ ...b, color: lineCol }}>{lineTxt}</b></span>
      <span style={item}>{he ? "אתמול" : "Yesterday"}: <b style={{ ...b, color: (sig.changeYesterdayPct ?? 0) >= 0 ? C.gain : C.loss }}>{fmtPct(sig.changeYesterdayPct)}</b></span>
      <span style={item}>{he ? "היום" : "Today"}: <b style={{ ...b, color: (sig.changeTodayPct ?? 0) >= 0 ? C.gain : C.loss }}>{fmtPct(sig.changeTodayPct)}</b></span>
      {Array.isArray(sig.weekHistory) && sig.weekHistory.length > 0 && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }} title={he ? "7 ימים אחרונים" : "Last 7 days"}>
          {sig.weekHistory.slice(-7).map((d: any, i: number) => (
            <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: stateColor(d?.state), flexShrink: 0 }} />
          ))}
        </span>
      )}
    </div>
  );
}
