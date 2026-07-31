import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Waves, LineChart, ShieldCheck, Zap, Crown, Sparkles, TrendingUp, TrendingDown,
  ArrowLeftRight, Activity, Timer, X, ArrowRight, ArrowLeft, CalendarRange, Target,
  Check, ShieldAlert, AlertTriangle, FlaskConical, Rocket, Lock, Info, CandlestickChart,
  Bot, ChevronRight, ChevronLeft, ScanLine, ListChecks, Wallet, Repeat, Layers,
  RefreshCw, Clock, ArrowUpRight, ArrowDownRight, Loader2, ListTree,
  Download, FileText, Printer, FileSearch, CheckCircle2, CircleHelp,
  KeyRound, Power, Radio, PlugZap, Pencil,
  HeartPulse, GraduationCap, Bitcoin, Backpack,
} from "lucide-react";
import { C, UI, MONO, onAccent } from "../theme";
import { input, btn } from "../ui";
import { track, ev } from "../lib/analytics";
import { useIsMobile } from "../lib/useIsMobile";
import { useViewMode, ViewToggle } from "./ViewToggle";
import WordmarkTitle from "./WordmarkTitle";
import { ClosedLogButton } from "./ClosedPositionsLog";
import InfoTip from "./InfoTip";
import { api, isOwner } from "../app/api";
import {
  AUTOPILOTS, SELF_VALIDATED_LABEL, VALIDATED_LABEL, SLIPPAGE_NOTE, CORRELATION_CAVEAT, PERF_DISCLAIMER, BACKTEST_VS_SIM_NOTE,
  type AutoPilot, type PilotDirection, type ArmedPilot,
} from "../lib/autopilots";
import type { ApSimPilot, ApSimPosition, ApSimActivity, ApEquityPoint, ApSimState, ApScanStatus, ApBybitStatus, ApLiveInfo, ApBybitBalance, ApRunPlan, ApPlanTrade, ApApproveItem, ApApproveResult } from "../lib/client";
import type { Bi } from "../lib/owners";
import { DraftBadge, useLegalCopy } from "../lib/legalCopy";

// React-query key for the server-side SIMULATION state (shared with the Home panel).
export const AP_STATE_KEY = ["autopilotsState"] as const;

// ── AutoPilots — OWNER-ONLY interface (PHASE 1) ──────────────────────────────────
// A real, understandable AutoPilots product surface built on the "owners-portal-menu"
// tile-grid language: a prominent entry tile → an onboarding screen (two wide feature
// tiles up top) → a grid of 5 RICH square pilot tiles (big illustrative equity-curve
// graphic + key metric + label) → a full per-pilot DETAIL view (plain-language "how it
// works" + backtest chart/metrics + risk note + ARM → the 3-step approval → SIMULATION).
//
// STRICT money-safety: NOTHING here places a trade or moves money. "Arming" only records
// the user's approved config in localStorage so a card shows an ARMED — SIMULATION badge.
// Real execution + payment are SEPARATE later phases.
//
// The backtest figures are HONEST SOURCE references quoted from the Trend Radar — NOT
// our-engine-verified. Every backtest surface carries "Trend Radar · source backtest",
// the "Past performance is not a guarantee of future results" disclaimer, and an
// "independent reproduction in our engine — pending" note. We claim nothing more.

const ICON: Record<string, any> = { Waves, LineChart, ShieldCheck, Zap, TrendingUp, Activity,
  HeartPulse, GraduationCap, Bitcoin, CandlestickChart, Backpack };

// Reuse the app's frosted-glass card treatment (same tokens as the Owners portal cards).
function glass(extra?: React.CSSProperties): React.CSSProperties {
  return {
    background: C.glass, backdropFilter: C.glassBlur, WebkitBackdropFilter: C.glassBlur as any,
    border: `1px solid ${C.glassBd}`, borderRadius: 18, padding: 18, boxShadow: C.glassHi, ...extra,
  };
}
// Soft, rounded surface card (the mockup's calmer tile body — no heavy frost).
function soft(extra?: React.CSSProperties): React.CSSProperties {
  return { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, boxShadow: C.glassHi, ...extra };
}
const bi = (b: Bi, he: boolean) => (he ? b.he : b.en);
const ACCENT_INK = "#0B0613"; // dark ink for text/icons over the accent gradient

const DIRECTION_META: Record<PilotDirection, { he: string; en: string; Icon: any; tone: string }> = {
  "long-short": { he: "לונג-שורט", en: "Long-Short", Icon: ArrowLeftRight, tone: "blue" },
  "long-only": { he: "לונג", en: "Long", Icon: TrendingUp, tone: "gain" },
};
const toneColor = (t: string): string => (t === "gain" ? C.gain : t === "loss" ? C.loss : t === "blue" ? C.blue : C.gold);
const marketLabelOf = (p: AutoPilot, he: boolean) => (p.market === "crypto" ? (he ? "קריפטו" : "Crypto") : (he ? "מניות" : "Stocks"));

// ── Small building blocks ────────────────────────────────────────────────────────
function Badge({ Icon, label, color }: { Icon?: any; label: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 800,
      color, background: `${color}1a`, border: `1px solid ${color}55`, borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>
      {Icon && <Icon size={12} />} {label}
    </span>
  );
}

function PremiumBadge({ he }: { he: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 900,
      color: ACCENT_INK, background: C.accentGrad, borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap", boxShadow: C.glassHi }}>
      <Crown size={12} /> {he ? "בתשלום" : "Premium"}
    </span>
  );
}

// One backtest metric tile.
function Metric({ Icon, label, value, color }: { Icon: any; label: string; value: string; color?: string }) {
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "9px 11px", minWidth: 0 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 800, color: C.faint, marginBottom: 4 }}>
        <Icon size={12} /> {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 900, color: color || C.text, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{value}</div>
    </div>
  );
}

// +9,041% style — thousands-separated, always signed for PnL.
const fmtPnl = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString("en-US")}%`;
// Max drawdown is stored positive; shown as a loss, one decimal.
const fmtDd = (n: number) => `-${n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

// One small labelled chip (chart timeframe · range · benchmark).
function Chip({ Icon, label }: { Icon: any; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, color: C.muted,
      background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>
      <Icon size={12} color={C.faint} /> {label}
    </span>
  );
}

// ── SIMULATION formatting + labels ────────────────────────────────────────────────
const fmtMoney = (n: number | null | undefined) =>
  `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtSignedMoney = (n: number | null | undefined) => `${Number(n || 0) >= 0 ? "+" : "-"}${fmtMoney(Math.abs(Number(n || 0)))}`;
const pnlColor = (n: number | null | undefined) => (Number(n || 0) > 0 ? C.gain : Number(n || 0) < 0 ? C.loss : C.muted);
const fmtWhen = (iso: string | null | undefined, he: boolean) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(he ? "he-IL" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
};
// The everywhere-visible honesty labels.
const SIM_LABEL: Bi = { he: "סימולציה — בלי כסף אמת", en: "Simulation — no real money" };
const APPROX_LABEL: Bi = { he: "סימולציה · קירוב על הנתונים הזמינים", en: "Simulation · approximation on available data" };

function SimBadge({ he }: { he: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 900, color: C.blue,
      background: `${C.blue}18`, border: `1px solid ${C.blue}55`, borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>
      <FlaskConical size={11} /> {bi(SIM_LABEL, he)}
    </span>
  );
}

// ── LIVE vs SIMULATION mode helpers (Yoav #E47L / #ZXXG) ──────────────────────────────
// A pilot in LIVE mode must NEVER surface the $1000 simulation sizing capital. The number
// that governs a live pilot's real orders is the owner-set LIVE CAP; the real connected
// sub-account balance is fetched read-only and shown alongside so the user sees their true
// money — never the sim default. Every mode-aware display keys off `isLivePilot(sim)`.
const isLivePilot = (sim?: ApSimPilot | null) => (sim?.mode || "simulation") === "live";
const liveCapOf = (sim?: ApSimPilot | null) => Number(sim?.liveCap || 0);
// The capital a display should show for a pilot: live cap in live mode, sim sizing otherwise.
const capitalOf = (sim?: ApSimPilot | null) =>
  isLivePilot(sim) ? liveCapOf(sim) : Number((sim?.capital ?? sim?.nav) || 0);
// Real connected-exchange wallet balance (READ-ONLY fetch_balance — NO trading). Shared via
// react-query so every live-mode display shows the SAME real number and reuses one network
// read. Only fetched when a pilot is actually live (enabled=false → never called).
function useApBalance(enabled: boolean) {
  return useQuery<ApBybitBalance>({
    queryKey: ["apBalance"],
    queryFn: () => api.autopilotBalance(),
    enabled,
    staleTime: 30000,
    retry: 0,
  });
}
const walletUsd = (b?: ApBybitBalance | null): number | undefined =>
  b && b.ok ? Number(b.totalUsd || 0) : undefined;

// ══ DATA-DRIVEN pilot numbers — read from each pilot's JSON `summary` ════════════════
// The cards + report modal are driven by the pilot's own trade-log JSON, NOT by numbers
// hardcoded in a component. So if the universe/test changes and we drop in new
// pilotN-validated-trades.json files, every card updates automatically. The values in
// lib/autopilots.ts stay as an honest baseline/fallback (used for the first paint and if
// the fetch fails) — currently identical to the JSON `summary`, so there is no flicker.
// card === log holds by construction: the same file feeds the tile, the card, and the report.
type PilotDoc = { summary?: any; config?: any; trades?: any[]; nav_curve?: any[] };
function usePilotDoc(url?: string) {
  return useQuery<PilotDoc>({
    queryKey: ["pilotDoc", url],
    queryFn: async () => {
      const r = await fetch(url!);
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    enabled: !!url,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
}
// Effective headline stats: prefer the JSON `summary`, fall back to the compiled baseline.
type PilotStats = { pnlPct: number; maxDrawdown: number; profitFactor: number; winPct: number; trades: number };
function effectiveStats(p: AutoPilot, summary?: any): PilotStats {
  const v = p.validated;
  const num = (x: any, fb: number) => (typeof x === "number" && isFinite(x) ? x : fb);
  return {
    pnlPct: num(summary?.net_profit_pct, v.pnlPct),
    maxDrawdown: Math.abs(num(summary?.max_drawdown_pct, v.maxDrawdown)),
    profitFactor: num(summary?.profit_factor, v.profitFactor),
    winPct: num(summary?.win_rate_pct, v.winPct),
    trades: num(summary?.trades, v.trades),
  };
}
// Average holding period (days) computed from the trade log; falls back to the baseline.
function avgHoldFrom(trades: any[] | undefined, fb: number): number {
  if (!trades || !trades.length) return fb;
  let sum = 0, n = 0;
  for (const t of trades) {
    const a = Date.parse(t.entry_date), b = Date.parse(t.exit_date);
    if (isFinite(a) && isFinite(b)) { sum += (b - a) / 86400000; n++; }
  }
  return n ? Math.round(sum / n) : fb;
}

// ── Windowed recompute (Dan's from→to date filter) ────────────────────────────────────
// A trade is included when its OPEN/ENTRY date falls within [from, to] (Bug 1). Every metric
// AND the equity curve are computed from that SAME set of window-opened trades, so the
// headline net% ALWAYS equals the curve's start→end change (Bug 2 — they tell one story):
//   • equity curve = cumulative realized equity of window-opened trades (in close order),
//                    starting from B = the portfolio's realized value at `from`
//                    (= initial capital + Σ pnl of everything that closed before `from`).
//   • net%   = (curveEnd / curveStart − 1) × 100  ← identical to the curve by construction.
//   • maxDD% = peak-to-trough on that same curve.
//   • PF / win% / trades / avgHold = over the window-opened trades.
// At full range this reduces to the whole log: B = initial capital, curve = the real equity
// path, curveEnd = final_equity → net% = the card's summary net (card === log preserved).
// ISO "YYYY-MM-DD" strings compare lexicographically, so plain string bounds are correct.
type WindowStats = {
  net: number; dd: number; pf: number | null; win: number; count: number; avgHold: number;
  filtered: any[]; curve: { date: string; equity: number }[]; equityStart: number; equityEnd: number;
};
function windowStats(doc: PilotDoc | undefined, from: string, to: string, baselineIC = 1000): WindowStats {
  const trades: any[] = Array.isArray(doc?.trades) ? doc!.trades! : [];
  const ic = Number(doc?.config?.initial_capital ?? baselineIC) || baselineIC;
  // Window = trades OPENED (entry_date) within [from, to].
  const opened = trades.filter((t) => { const d = String(t.entry_date); return d >= from && d <= to; });
  // B = realized portfolio equity at the window start (everything that closed before `from`).
  let B = ic;
  for (const t of trades) if (String(t.exit_date) < from) B += Number(t.pnl) || 0;
  // Curve = B, then cumulative realized P&L of window-opened trades in CLOSE order.
  const byClose = [...opened].sort((a, b) => String(a.exit_date) < String(b.exit_date) ? -1 : 1);
  const curve: { date: string; equity: number }[] = [{ date: from, equity: B }];
  let eq = B, peak = B, ddAbs = 0;
  for (const t of byClose) {
    eq += Number(t.pnl) || 0;
    curve.push({ date: String(t.exit_date), equity: eq });
    if (eq > peak) peak = eq;
    const d = peak > 0 ? (eq / peak - 1) * 100 : 0;
    if (d < ddAbs) ddAbs = d;
  }
  const equityEnd = eq;
  const net = B > 0 ? (equityEnd / B - 1) * 100 : 0;
  // PF / win over window-opened trades.
  let gp = 0, gl = 0, wins = 0;
  for (const t of opened) { const pnl = Number(t.pnl) || 0; if (pnl > 0) { gp += pnl; wins++; } else gl += -pnl; }
  const pf = gl > 0 ? gp / gl : (gp > 0 ? null : 0); // null = no losses (∞)
  const win = opened.length ? (wins / opened.length) * 100 : 0;
  // Trade table order = chronological by open date.
  const filtered = [...opened].sort((a, b) => String(a.entry_date) < String(b.entry_date) ? -1 : 1);
  return { net, dd: Math.abs(ddAbs), pf, win, count: opened.length, avgHold: avgHoldFrom(opened, 0), filtered, curve, equityStart: B, equityEnd };
}

// ── Equity curve (log-scaled line from a series of {date, equity} points) ─────────────
// Data-driven, not illustrative. Fed the windowed equity curve so the drawn line and the
// headline net% are always the same story.
function NavChart({ nav, h = 90 }: { nav: { date: string; equity: number }[]; h?: number }) {
  const pts = (nav || []).filter((p) => Number(p.equity) > 0);
  if (pts.length < 2) {
    return <div style={{ height: h, display: "grid", placeItems: "center", fontSize: 10.5, color: C.faint }}>—</div>;
  }
  const W = 640, H = h, PAD = 3;
  const ys = pts.map((p) => Math.log(Number(p.equity)));
  const minY = Math.min(...ys), maxY = Math.max(...ys), span = maxY - minY || 1;
  const px = (i: number) => (i / (pts.length - 1)) * W;
  const py = (v: number) => PAD + (1 - (v - minY) / span) * (H - PAD * 2);
  const line = ys.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const up = Number(pts[pts.length - 1].equity) >= Number(pts[0].equity);
  const stroke = up ? C.gain : C.loss;
  const gid = `navc-${pts.length}-${Math.round(minY * 10)}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block", direction: "ltr" }} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ══ VERIFY / PROVENANCE — export + "how is this computed?" drill-downs ══════════════
// Dan's #1: the user must be able to see WHERE every number comes from and independently
// verify it. Two mechanisms:
//   (a) ExplainValue — every shown number is a button; clicking opens a plain-language
//       "how it's computed + source" card.
//   (b) BacktestReportModal — the full source-backtest report (methodology + KPIs +
//       attribution) PLUS the pilot's OWN simulation trade log, with CSV + Print/PDF
//       export so the user can check everything offline.

// ── Client-side CSV + printable-report export (no deps) ─────────────────────────────
function csvEscape(v: any): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  const body = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
  // BOM so Excel reads UTF-8 (Hebrew) correctly.
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function escHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
// Opens a clean printable report in a new window; the user's browser Print → "Save as PDF".
function openPrintable(title: string, innerHtml: string, dir: "rtl" | "ltr"): void {
  const w = window.open("", "_blank", "width=860,height=1024");
  if (!w) { alert("Please allow pop-ups to open the printable report."); return; }
  w.document.write(`<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><title>${escHtml(title)}</title>
    <style>
      body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;margin:34px;line-height:1.5}
      h1{font-size:20px;margin:0 0 2px} h2{font-size:14px;margin:22px 0 8px;border-bottom:1px solid #dbe2ea;padding-bottom:5px}
      table{border-collapse:collapse;width:100%;font-size:12px;margin:6px 0}
      th,td{border:1px solid #cbd5e1;padding:6px 9px;text-align:${dir === "rtl" ? "right" : "left"}} th{background:#f1f5f9}
      .muted{color:#64748b;font-size:11px} pre{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;font-size:11px;white-space:pre-wrap}
      .tag{display:inline-block;background:#eef2ff;border:1px solid #c7d2fe;border-radius:999px;padding:2px 10px;font-size:11px;margin:0 6px 6px 0}
      .kpi{font-size:16px;font-weight:800} @media print{.noprint{display:none}}
    </style></head><body>${innerHtml}
    <p class="muted" style="margin-top:20px">Generated for independent verification · SIMULATION — no real money · past performance does not guarantee future results.</p>
    <button class="noprint" onclick="window.print()" style="margin-top:10px;padding:9px 18px;font-size:13px;border-radius:8px;border:1px solid #94a3b8;background:#fff;cursor:pointer">Print / Save as PDF</button>
    </body></html>`);
  w.document.close();
}

// ── "How is this computed?" drill-down ──────────────────────────────────────────────
type Explain = { title: string; how: string; source: string };

function ExplainModal({ ex, he, rtl, onClose }: { ex: Explain; he: boolean; rtl: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16, direction: rtl ? "rtl" : "ltr" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" dir={rtl ? "rtl" : "ltr"} aria-label={ex.title}
        style={{ width: "min(430px, 95vw)", background: C.surface, border: `1px solid ${C.gold}`, borderRadius: 16,
          boxShadow: "0 24px 70px rgba(0,0,0,0.6)", fontFamily: UI, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 15px", borderBottom: `1px solid ${C.line}`,
          background: `linear-gradient(135deg, ${C.gold}18, ${C.gold}08), ${C.surface}` }}>
          <FileSearch size={17} color={C.gold} />
          <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 900, color: C.text }}>{ex.title}</div>
          <button onClick={onClose} aria-label={he ? "סגור" : "Close"} className="tap44"
            style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={17} /></button>
        </div>
        <div style={{ padding: 15, display: "flex", flexDirection: "column", gap: 13 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 900, color: C.gold, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{he ? "איך זה מחושב" : "How it's computed"}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: C.text }}>{ex.how}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 900, color: C.gold, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{he ? "מקור הנתון" : "Source"}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: C.muted }}>{ex.source}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: C.faint, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
            <FlaskConical size={12} color={C.blue} /> {bi(SIM_LABEL, he)}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// A value rendered as a clickable, dotted-underline button that opens its explanation.
// Wrap any P&L / capital / metric so the user can drill into how it's computed.
function ExplainValue({ ex, he, rtl, children, color, style }: {
  ex: Explain; he: boolean; rtl: boolean; children: React.ReactNode; color?: string; style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); track("autopilot_verify_metric", { title: ex.title }); setOpen(true); }}
        title={he ? "איך זה מחושב? לחצו לאימות" : "How is this computed? Click to verify"}
        style={{ background: "none", border: "none", padding: 0, margin: 0, font: "inherit", color: color || "inherit",
          cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3,
          textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3, ...style }}>
        {children}<CircleHelp size={11} style={{ opacity: 0.55, flexShrink: 0 }} />
      </button>
      {open && <ExplainModal ex={ex} he={he} rtl={rtl} onClose={() => setOpen(false)} />}
    </>
  );
}

// ── Explanation builders — one per data point (honest, computation + source) ─────────
const perTradeUsd = (sim?: ApSimPilot) => {
  const cap = Number((sim?.capital ?? sim?.nav) || 0), pct = Number(sim?.perTradePct || 0);
  return cap > 0 && pct > 0 ? (cap * pct) / 100 : 0;
};
function exCapital(sim: ApSimPilot | undefined, he: boolean): Explain {
  return {
    title: he ? "הון (Capital)" : "Capital",
    how: he ? `ההון ההתחלתי שהגדרת בעת טעינת הטייס. כל גודל פוזיציה מחושב כאחוז ממנו (${sim?.perTradePct ?? "—"}% לעסקה ≈ ${fmtMoney(perTradeUsd(sim))}).`
            : `The starting capital you set when loading this pilot. Every position is sized as a percentage of it (${sim?.perTradePct ?? "—"}% per trade ≈ ${fmtMoney(perTradeUsd(sim))}).`,
    source: he ? `הגדרת ההפעלה שלך (חשבון: ${sim?.accountLabel || "—"}, נטען ${fmtWhen(sim?.armedAt, he)}). סימולציה — לא הופקד ולא נמשך כסף אמיתי.`
               : `Your activation config (account: ${sim?.accountLabel || "—"}, loaded ${fmtWhen(sim?.armedAt, he)}). Simulation — no real money is deposited or withdrawn.`,
  };
}
function exRealized(sim: ApSimPilot | undefined, he: boolean): Explain {
  return {
    title: he ? "רווח/הפסד ממומש" : "Realized P&L",
    how: he ? "סכום הרווח/הפסד מכל העסקאות המדומות שנסגרו מאז ההפעלה. לכל עסקה: (מחיר יציאה − מחיר כניסה) × כמות (הפוך עבור שורט)."
            : "The sum of profit/loss from every CLOSED simulated trade since activation. Per trade: (exit − entry) × qty (reversed for a short).",
    source: he ? "עסקאות הסימולציה של הטייס עצמו (מהטעינה ואילך). ראו את יומן העסקאות בדוח המלא. סימולציה בלבד."
               : "The pilot's own simulation trades (from load onward). See the trade log in the full report. Simulation only.",
  };
}
function exUnrealized(sim: ApSimPilot | undefined, he: boolean): Explain {
  return {
    title: he ? "רווח/הפסד לא-ממומש" : "Unrealized P&L",
    how: he ? "סכום הרווח/הפסד של הפוזיציות הפתוחות כרגע: (מחיר שוק חי − מחיר כניסה) × כמות. מתעדכן מול מחירי שוק אמיתיים."
            : "The sum across currently-open positions of (live market price − entry) × qty. Updated against REAL market prices.",
    source: he ? "מחירים חיים מספק נתוני השוק של האפליקציה (CCXT לקריפטו · נתוני מניות), ברענון כל ~45 שניות. אין ביצוע פקודות — תמחור בלבד."
               : "Live prices from the app's market-data layer (CCXT for crypto · equity data), refreshed ~every 45s. No orders are placed — pricing only.",
  };
}
function exTotal(he: boolean): Explain {
  return {
    title: he ? "סה״כ רווח/הפסד" : "Total P&L",
    how: he ? "ממומש + לא-ממומש, מאז רגע ההפעלה בלבד. אין היסטוריה שהומצאה לפני הטעינה."
            : "Realized + Unrealized, counted only since the activation moment. No fabricated pre-load history.",
    source: he ? "מחושב מעסקאות הסימולציה של הטייס. סימולציה — בלי כסף אמת." : "Computed from the pilot's simulation trades. Simulation — no real money.",
  };
}
function exOpen(p: AutoPilot, he: boolean): Explain {
  return {
    title: he ? "פוזיציות פתוחות" : "Open positions",
    how: he ? `מספר הפוזיציות המדומות הפתוחות כרגע. כל אחת נפתחה על סיגנל פריצה אמיתי מ-Trend Radar, מרגע ההפעלה ואילך. תקרה: עד ${p.maxPositions} פוזיציות בו-זמנית.`
            : `The number of simulated positions open right now. Each opened on a real Trend Radar breakout signal, from activation onward. Cap: up to ${p.maxPositions} at once.`,
    source: he ? "הסריקה היומית של Trend Radar + חוקי הטייס. הפוזיציות עצמן מדומות (dry-run), ממורקות למחירים חיים."
               : "The daily Trend Radar scan + the pilot's rules. The positions themselves are simulated (dry-run), marked to live prices.",
  };
}
function exBacktest(p: AutoPilot, metric: "pnl" | "dd" | "trades", he: boolean): Explain {
  const s = p.backtest;
  const common = he ? `${bi(SELF_VALIDATED_LABEL, he)} · חלון ${bi(s.range, he)} · יוניברס ${s.benchmark}. מחושב ישירות מיומן העסקאות של הטייס — הורידו את הדוח המלא ואמתו בעצמכם. החלקה 0 (לא הודמתה).`
                    : `${bi(SELF_VALIDATED_LABEL, he)} · window ${bi(s.range, he)} · universe ${s.benchmark}. Computed directly from the pilot's own trade log — download the full report and verify it yourself. Slippage 0 (not simulated).`;
  if (metric === "pnl") return { title: he ? "תשואה נטו (PnL%)" : "Net PnL %", how: he ? "התשואה נטו על פני כל החלון = סכום הרווח/הפסד של כל העסקאות ביומן." : "Net return across the whole window = the sum of every trade's P&L in the log.", source: common };
  if (metric === "dd") return { title: he ? "ירידה מקסימלית (Max DD)" : "Max drawdown", how: he ? "הירידה הגדולה ביותר משיא לשפל של עקומת ה-NAV (mark-to-market), משוחזרת מ-nav_curve בדוח." : "The largest peak-to-trough decline of the NAV (mark-to-market) curve, reproduced from nav_curve in the report.", source: common };
  return { title: he ? "מספר עסקאות" : "Trades", how: he ? "מספר העסקאות (round-trips) שבוצעו בהרצה — ספירת השורות ביומן העסקאות." : "The number of round-trips taken in the run — the row count of the trade log.", source: common };
}

// ── How-it-operates explainer (BEFORE and AFTER activation) ──────────────────────────
// Feature 3: plain-language cadence + %-of-capital sizing + what the user can change.
// `sim` present → concrete numbers (loaded); absent → "what will happen when you load it".
function AutoOperationCard({ p, sim, he, previewCapital, previewPct }: {
  p: AutoPilot; sim?: ApSimPilot; he: boolean; previewCapital?: number; previewPct?: number;
}) {
  const loaded = !!sim;
  // MODE-AWARE (Yoav #E47L/#ZXXG): a LIVE pilot sizes off the live cap, not the $1000 sim
  // capital. The real connected wallet is shown next to it so the numbers reflect real money.
  const live = loaded && isLivePilot(sim);
  const balQ = useApBalance(!!live);
  const wallet = walletUsd(balQ.data);
  const cap = loaded ? capitalOf(sim) : Number(previewCapital || 0);
  const pct = loaded ? Number(sim!.perTradePct || 0) : Number(previewPct || 0);
  const size = cap > 0 && pct > 0 ? (cap * pct) / 100 : 0;
  const hasNums = cap > 0 && pct > 0;
  const Row = ({ Icon, title, body }: { Icon: any; title: string; body: string }) => (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: "grid", placeItems: "center", background: `${C.blue}16`, border: `1px solid ${C.blue}44` }}>
        <Icon size={14} color={C.blue} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: C.text, marginBottom: 1 }}>{title}</div>
        <div style={{ fontSize: 11.5, lineHeight: 1.5, color: C.muted }}>{body}</div>
      </div>
    </div>
  );
  return (
    <div style={{ background: `${C.blue}0b`, border: `1px solid ${C.blue}44`, borderRadius: 14, padding: 13, display: "flex", flexDirection: "column", gap: 11 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <Bot size={15} color={C.blue} />
        <span style={{ fontSize: 12.5, fontWeight: 900, color: C.text }}>
          {loaded ? (he ? "איך הטייס פועל אוטומטית" : "How the pilot runs automatically")
                  : (he ? "איך הטייס יפעל אחרי טעינה" : "How the pilot will run once loaded")}
        </span>
      </div>
      <Row Icon={Clock} title={he ? "קצב הרצה" : "Run cadence"}
        body={he ? `רץ אוטומטית פעם ביום ב-00:10 UTC, מיד אחרי הסריקה היומית של Trend Radar${loaded ? `. הרצה הבאה: ${fmtWhen(sim!.nextRunAt, he)}` : ""}. אפשר גם ללחוץ "הרץ עכשיו" למעבר מיידי${live ? " — בלייב, כל הרצה מציעה עסקאות לאישורך ואינה קונה מעצמה." : "."}`
                 : `Runs automatically once a day at 00:10 UTC, right after the daily Trend Radar scan${loaded ? `. Next run: ${fmtWhen(sim!.nextRunAt, he)}` : ""}. You can also press "Run now" for an immediate pass${live ? " — on a live pilot, each run PROPOSES trades for your approval and never buys on its own." : "."}`} />
      <Row Icon={Wallet} title={live ? (he ? "גודל פוזיציה (% מתקרת הלייב)" : "Position sizing (% of live cap)") : (he ? "גודל פוזיציה (% מההון)" : "Position sizing (% of capital)")}
        body={hasNums ? (live
                          ? (he ? `כל פוזיציית לייב חדשה = ${pct}% מתקרת הלייב (${fmtMoney(cap)}) ≈ ${fmtMoney(size)}. עד ${p.maxPositions} פוזיציות בו-זמנית.${wallet != null ? ` יתרת ארנק בפועל: ${fmtMoney(wallet)}.` : ""}`
                                : `Each new live position = ${pct}% of the live cap (${fmtMoney(cap)}) ≈ ${fmtMoney(size)}. Up to ${p.maxPositions} positions at once.${wallet != null ? ` Real wallet balance: ${fmtMoney(wallet)}.` : ""}`)
                          : (he ? `כל פוזיציה חדשה = ${pct}% מההון (${fmtMoney(cap)}) ≈ ${fmtMoney(size)}. עד ${p.maxPositions} פוזיציות בו-זמנית.`
                                : `Each new position = ${pct}% of capital (${fmtMoney(cap)}) ≈ ${fmtMoney(size)}. Up to ${p.maxPositions} positions at once.`))
                      : (he ? `כל פוזיציה תוגדר כאחוז מההון שתקבע (ברירת מחדל 10%). עד ${p.maxPositions} פוזיציות בו-זמנית.`
                            : `Each position is a percentage of the capital you set (default 10%). Up to ${p.maxPositions} positions at once.`)} />
      <Row Icon={ScanLine} title={he ? "בחירת עסקאות" : "Trade selection"}
        body={he ? `פותח/סוגר ${p.direction === "long-short" ? "לונג ושורט" : "לונג בלבד"} לפי חוקי האסטרטגיה על הסריקה היומית (טופ 100/150). כניסות רק על פריצה טרייה מרגע ההפעלה.`
                 : `Opens/closes ${p.direction === "long-short" ? "long & short" : "long-only"} positions per the strategy rules on the daily scan (top 100/150). Entries only on a fresh breakout, from activation onward.`} />
      <Row Icon={ListChecks} title={he ? "מה אפשר לשנות ידנית" : "What you can change manually"}
        body={loaded ? (live
                          ? (he ? "אפשר: \"הרץ עכשיו\" (בדיקה מיידית — פותחת פאנל תוכנית לאישור) · \"עצור לייב\" (חזרה לסימולציה) · שינוי תקרת הלייב. הטייס מציע עסקאות; אתה מאשר — הוא אינו קונה מעצמו."
                                : "You can: \"Run now\" (immediate check — opens a plan panel to approve) · \"Stop live\" (back to simulation) · change the live cap. The pilot proposes trades; you approve — it never buys on its own.")
                          : (he ? "אפשר: \"הרץ עכשיו\" (מעבר סימולציה מיידי) · \"פרוק\" (ניקוי הטייס והפוזיציות המדומות) · טעינה מחדש עם הון/אחוז אחרים. אינך פותח עסקאות בעצמך — הטייס פועל אוטומטית."
                                : "You can: \"Run now\" (immediate sim pass) · \"Unload\" (clear the pilot + its sim positions) · re-load with different capital/size. You don't place trades yourself — the pilot acts automatically."))
                     : (he ? "אחרי טעינה תוכל: \"הרץ עכשיו\", \"פרוק\", או טעינה מחדש עם הון/אחוז אחרים. הטייס פועל אוטומטית; אינך פותח עסקאות בעצמך."
                           : "Once loaded you'll be able to: \"Run now\", \"Unload\", or re-load with a different capital/size. The pilot acts automatically; you don't place trades yourself.")} />
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: C.faint, borderTop: `1px solid ${C.line}`, paddingTop: 9 }}>
        {live ? <><Radio size={11} color={C.loss} /> {he ? "לייב · כסף אמיתי — כל הרצה מציעה עסקאות לאישורך" : "Live · real money — each run proposes trades for your approval"}</>
              : <><FlaskConical size={11} color={C.blue} /> {bi(SIM_LABEL, he)} · {bi(APPROX_LABEL, he)}</>}
      </div>
    </div>
  );
}

// ── FULL report — every pilot is self-validated, so this always renders the
// self-validated results modal (summary + full trade log + export). ──────────────────
function BacktestReportModal({ p, he, rtl, onClose }: { p: AutoPilot; sim?: ApSimPilot; he: boolean; rtl: boolean; onClose: () => void }) {
  return <ValidatedReportModal p={p} he={he} rtl={rtl} onClose={onClose} />;
}

// ── SELF-VALIDATED-results report — the full report Dan asked for ─────────────────────
// A clean "proven results" modal: the headline summary KPIs (our engine, = what the log
// reproduces) + the FULL trade log (date · symbol · side · size · entry · exit · pnl ·
// pnl% · running equity) loaded live from `p.validated.tradesUrl`. Keeps the two honest
// caveats visible (slippage 0; same-universe/same-family correlation). Print/PDF + CSV of
// the real trades. NO old-vs-new comparison — just the real result.
// ── DR Crypto RISK MODES (Aggressive/Smooth/Safe) — shared hook + reusable selector ──────
// The operational mode is a SHARED react-query value (queryKey ["drOpMode"]) so the MAIN pilot
// screen and the report modal stay IN SYNC: change it in either place → both reflect it → the
// paper sim runs that mode. Modes data (per-mode KPIs + curve) is dr-crypto-modes.json.
type DrMode = { key: string; emoji: string; label: { he: string; en: string };
  net_pct: number; maxdd_pct: number; ann_pct: number; win_pct: number; trades: number;
  pf: number; tradesUrl: string; nav?: { date: string; equity: number }[] };
function useDrModes(isDR: boolean) {
  const qc = useQueryClient();
  const modesQ = useQuery({
    queryKey: ["drModes"], enabled: isDR,
    queryFn: async () => { const r = await fetch("/dr-crypto-modes.json?v=1"); if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<{ default: string; modes: DrMode[] }>; },
    staleTime: Infinity, gcTime: Infinity, retry: 1,
  });
  // The owner's PERSISTED operational mode — shared cache so both selectors reflect a change instantly.
  const opQ = useQuery({ queryKey: ["drOpMode"], enabled: isDR, retry: 0, staleTime: 30000,
    queryFn: async () => (await api.autopilotDrModeGet()).mode });
  const modes = modesQ.data?.modes || [];
  const modeKey = (isDR && (opQ.data || modesQ.data?.default)) || "smooth";
  const activeMode = modes.find((m) => m.key === modeKey) || modes.find((m) => m.key === "smooth");
  // Selecting a mode PERSISTS it (dr_sim applies its sizing next run) + updates the shared cache.
  const pick = (k: string) => { qc.setQueryData(["drOpMode"], k); if (isDR) api.autopilotDrModeSet(k).catch(() => {}); };
  return { modes, modeKey: activeMode?.key || modeKey, activeMode, pick, pending: modesQ.isPending };
}
// Reusable 🔴🟡🟢 selector — each button shows the mode's RETURN and its DRAWDOWN together.
// ── Pilot NAME branding ──────────────────────────────────────────────────────────────────────
// The two "DR" pilots get a small inline glyph + a skin-adaptive accent tint on their name; every
// other pilot renders its plain name (inherits the caller's color/size). Display-only — the icon is
// sized relative to the caller's font size and both the icon and text take the brand accent so the
// treatment reads consistently in the tile, detail, list row, report modal and home panel.
const NAME_BRAND: Record<string, { Glyph: any; tone: string }> = {
  "DR-Crypto-Trend": { Glyph: Bitcoin, tone: C.gold },   // crypto → gold/amber (bitcoin-orange, skin-adaptive)
  "MR-BB-Stocks":    { Glyph: TrendingUp, tone: C.gain }, // stocks → green (rising-chart)
};

function PilotName({ p, he, size }: { p: AutoPilot; he: boolean; size: number }) {
  const nm = bi(p.name, he);
  const brand = NAME_BRAND[p.id];
  if (!brand) return <>{nm}</>;
  const { Glyph, tone } = brand;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0, color: tone, letterSpacing: "0.005em" }}>
      <Glyph size={Math.round(size * 0.92)} color={tone} strokeWidth={2.4} style={{ flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nm}</span>
    </span>
  );
}

// ── Pilot EMBLEMS ─────────────────────────────────────────────────────────────────────────────
// Professional, skin-adaptive badge emblems for the 5 visible pilots (Dan-approved design; "yes
// just colors like our skins"): a glossy rounded badge filled with the pilot's SKIN-TOKEN colour
// + a clean white/contrast geometric symbol. All colours come from design tokens (C.blue / C.gain
// / C.gold / C.accent / C.surface2) — NEVER hardcoded hex — so they re-theme across Navy/Peach/
// Nude/Sea. The symbol ink is onAccent(token) so it stays legible on that token in every skin.
// Any pilot WITHOUT a bespoke emblem falls back to its lucide persona icon on the accent gradient
// (unchanged). Display / UI only.
type Emblem = { badge: string; neutral?: boolean; sym: (ink: string) => any };
function pilotEmblem(id: string): Emblem | null {
  switch (id) {
    case "TR-GC-Crypto-LS-9": // Dr Long — up-trend line + arrowhead, on the app BLUE (tertiary) token
      return { badge: C.blue, sym: (ink) => (
        <g stroke={ink} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 16 9 10 13 14 20 6" />
          <polyline points="14 6 20 6 20 12" />
        </g>
      ) };
    case "TR-B2S-Crypto-17": // Short Professor — green up-arrow + red down-arrow (long/short), neutral badge
      return { badge: C.surface2, neutral: true, sym: () => (
        <g strokeWidth="2.1" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="19" x2="8" y2="6" stroke={C.gain} />
          <polyline points="4.5 9.5 8 6 11.5 9.5" stroke={C.gain} />
          <line x1="16" y1="5" x2="16" y2="18" stroke={C.loss} />
          <polyline points="12.5 14.5 16 18 19.5 14.5" stroke={C.loss} />
        </g>
      ) };
    case "TR-B2S-Crypto-LowDD-12": // Free Student — open book, on the green token
      return { badge: C.gain, sym: (ink) => (
        <g stroke={ink} strokeWidth="1.9" fill="none" strokeLinejoin="round" strokeLinecap="round">
          <path d="M12 6.5 C10 5.2, 6.5 5, 4 6 L4 17.6 C6.5 16.6, 10 16.8, 12 18.2" />
          <path d="M12 6.5 C14 5.2, 17.5 5, 20 6 L20 17.6 C17.5 16.6, 14 16.8, 12 18.2" />
          <line x1="12" y1="6.5" x2="12" y2="18.2" />
        </g>
      ) };
    case "DR-Crypto-Trend": // DR Crypto — ₿ mark, on C.gold (matches its name colour)
      return { badge: C.gold, sym: (ink) => (
        <text x="12" y="17.6" textAnchor="middle" fontSize="17" fontWeight="900" fill={ink}
          fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif">₿</text>
      ) };
    case "MR-BB-Stocks": // DR Stocks — 3 rising candlesticks, on C.gain green (matches its name colour)
      return { badge: C.gain, sym: (ink) => (
        <g stroke={ink} strokeWidth="1.5" strokeLinecap="round">
          <line x1="6" y1="12.5" x2="6" y2="19.5" /><rect x="4.5" y="14" width="3" height="4" rx="0.6" fill={ink} stroke="none" />
          <line x1="12" y1="8" x2="12" y2="17" /><rect x="10.5" y="10" width="3" height="5" rx="0.6" fill={ink} stroke="none" />
          <line x1="18" y1="4" x2="18" y2="14" /><rect x="16.5" y="6" width="3" height="5.5" rx="0.6" fill={ink} stroke="none" />
        </g>
      ) };
    default: return null;
  }
}

function PilotEmblem({ p, size, radius }: { p: AutoPilot; size: number; radius?: number }) {
  const r = radius ?? Math.round(size * 0.29);
  const em = pilotEmblem(p.id);
  if (!em) {  // fallback: original lucide persona icon on the accent gradient
    const Icon = ICON[p.icon] || Activity;
    return (
      <div style={{ width: size, height: size, borderRadius: r, flexShrink: 0, display: "grid", placeItems: "center", background: C.accentGrad, boxShadow: C.glassHi }}>
        <Icon size={Math.round(size * 0.5)} color={ACCENT_INK} />
      </div>
    );
  }
  const ink = em.neutral ? C.text : onAccent(em.badge);
  const bg = em.neutral ? C.surface2
    : `linear-gradient(158deg, rgba(255,255,255,0.22), rgba(0,0,0,0.16)), ${em.badge}`;
  return (
    <div style={{ width: size, height: size, borderRadius: r, flexShrink: 0, display: "grid", placeItems: "center",
      background: bg, boxShadow: C.glassHi, border: em.neutral ? `1px solid ${C.line}` : `1px solid rgba(255,255,255,0.16)` }}>
      <svg width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} viewBox="0 0 24 24" fill="none">{em.sym(ink)}</svg>
    </div>
  );
}

function DrModeButtons({ modes, activeKey, onPick, he }: { modes: DrMode[]; activeKey?: string; onPick: (k: string) => void; he: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
      {modes.map((m) => {
        const on = m.key === activeKey;
        return (
          <button key={m.key} onClick={() => onPick(m.key)}
            style={{ textAlign: "start", cursor: "pointer", borderRadius: 10, padding: "7px 9px",
              border: `1px solid ${on ? `${C.blue}88` : C.line}`, background: on ? `${C.blue}18` : C.surface2 }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: C.text }}>{m.emoji} {bi(m.label, he)}</div>
            <div style={{ fontSize: 13, fontWeight: 900, color: C.gain, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{fmtPnl(m.net_pct)}</div>
            <div style={{ fontSize: 10, fontWeight: 800, color: C.loss, fontVariantNumeric: "tabular-nums" }}>DD {fmtDd(Math.abs(m.maxdd_pct))}</div>
          </button>
        );
      })}
    </div>
  );
}

function ValidatedReportModal({ p, he, rtl, onClose }: { p: AutoPilot; he: boolean; rtl: boolean; onClose: () => void }) {
  const v = p.validated;
  // DR Crypto RISK MODES — Aggressive / Smooth (default) / Safe. Each is a real COMPOUNDING config;
  // selecting a mode swaps the whole report (KPIs from summary + equity curve + trade log) to that
  // mode's real data. Every mode shows its return AND its drawdown together (button label + KPIs).
  const isDR = p.id === "DR-Crypto-Trend";
  // Shared risk-mode state (in sync with the main pilot screen's selector via react-query).
  const { modes: drModes, activeMode, pick: pickMode } = useDrModes(isDR);
  const effUrl = (isDR && activeMode?.tradesUrl) || v.tradesUrl;
  // Data-driven: the selected JSON drives KPIs (from `summary`) + the full trade table + the
  // config caveats. Shares the react-query cache with the tiles/card via usePilotDoc.
  const doc = usePilotDoc(effUrl);
  const allTrades: any[] = Array.isArray(doc.data?.trades) ? doc.data!.trades! : [];
  const navAll: any[] = Array.isArray(doc.data?.nav_curve) ? doc.data!.nav_curve! : [];
  const meta = { summary: doc.data?.summary, config: doc.data?.config };
  const loadErr = doc.isError;
  const isPending = doc.isPending;
  useEffect(() => {
    track("autopilot_report_opened", { pilot: p.id });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, p.id]);

  const fmtPx = (n: any) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 4 });
  const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${Number(n).toFixed(2)}%`;
  const fmtPf = (pf: number | null) => (pf === null ? "∞" : Number(pf).toFixed(2));

  // ── Date-range filter (Dan): slice from→to, recompute live. Default = full range. ──
  const minDate = navAll.length ? String(navAll[0].date) : (allTrades[0]?.entry_date || "");
  const maxDate = navAll.length ? String(navAll[navAll.length - 1].date) : (allTrades[allTrades.length - 1]?.exit_date || "");
  // Selectable ceiling = TODAY (Dan: must be able to pick "Today"). The backtest data ends
  // at maxDate, but the picker allows any date up to today; the window logic clamps
  // gracefully — a To beyond the last trade just includes everything through it.
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const maxSel = maxDate ? (today >= maxDate ? today : maxDate) : today;
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const clamp = (d: string, lo: string, hi: string) => (lo && d < lo ? lo : hi && d > hi ? hi : d);
  const effFrom = minDate ? clamp(from || minDate, minDate, maxSel) : (from || "");
  let effTo = maxDate ? clamp(to || maxDate, minDate, maxSel) : (to || "");
  if (effTo && effFrom && effTo < effFrom) effTo = effFrom;
  // Treat "no data yet" as full range so the headline shows the authoritative baseline
  // (never a flash of zeros) while the log loads. A To at/after the data end (incl. Today)
  // with From at the start = full range.
  const isFull = !minDate || (effFrom <= minDate && effTo >= maxDate);

  // Full-range authoritative numbers (from `summary`) so the default reproduces the card.
  const stFull = effectiveStats(p, meta.summary);
  const avgHoldFull = avgHoldFrom(allTrades, v.avgHoldDays);
  // Windowed recompute (same methodology as summary).
  const win = useMemo(() => windowStats(doc.data, effFrom, effTo), [doc.data, effFrom, effTo]);

  // Unified KPI values: authoritative summary at full range, live recompute when narrowed.
  const K = isFull
    ? { net: stFull.pnlPct, dd: stFull.maxDrawdown, pf: stFull.profitFactor as number | null, win: stFull.winPct, count: stFull.trades, avgHold: avgHoldFull }
    : { net: win.net, dd: win.dd, pf: win.pf, win: win.win, count: win.count, avgHold: win.avgHold };
  const trades: any[] | null = isPending ? null : (isFull ? allTrades : win.filtered);
  const curve = win.curve;
  // Trade-log display order — default NEWEST-first (Dan: "show last trades up"), toggleable.
  const [logDesc, setLogDesc] = useState(true);
  // Winners/losers filter (display only).
  const [logFilter, setLogFilter] = useState<"all" | "win" | "loss">("all");
  // Capital "what-if" — the sim is FIXED-FRACTIONAL, so $ scale LINEARLY. `factor` rescales every
  // $ display (size / $P&L / running-equity / equity-curve) off the log's base capital; %/return
  // stay identical. Display-only simulation — does not touch the loaded pilot or any live path.
  const ic0 = Number((doc.data as any)?.config?.initial_capital ?? 1000) || 1000;
  const [capital, setCapital] = useState<number>(ic0);
  const factor = (Number(capital) > 0 ? Number(capital) : ic0) / ic0;
  // Equity curve rescaled to the chosen capital for display (values only; shape/%/return identical).
  const dispCurve = useMemo(() => curve.map((pt) => ({ date: pt.date, equity: pt.equity * factor })), [curve, factor]);
  // running_equity is a STORED per-row value (computed chronologically in close order); we only
  // REORDER / FILTER rows for display — never recompute — so each row stays correct in any order.
  const displayTrades = useMemo(() => {
    if (!trades) return trades;
    let s = [...trades].sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)));
    if (logDesc) s.reverse();
    if (logFilter === "win") s = s.filter((t) => Number(t.pnl || 0) > 0);
    else if (logFilter === "loss") s = s.filter((t) => Number(t.pnl || 0) <= 0);
    return s;
  }, [trades, logDesc, logFilter]);

  const kpis: [string, string, string | undefined][] = [
    [he ? "תשואה נטו" : "Net return", fmtPnl(Number(K.net.toFixed(1))), C.gain],
    [he ? "ירידה מקס' (NAV)" : "Max DD (NAV)", fmtDd(K.dd), C.loss],
    [he ? "פקטור רווח" : "Profit factor", fmtPf(K.pf), undefined],
    [he ? "עסקאות" : "Trades", K.count.toLocaleString("en-US"), undefined],
    [he ? "אחוז הצלחה" : "Win rate", `${K.win.toFixed(1)}%`, undefined],
    [he ? "החזקה ממוצעת" : "Avg hold", `${K.avgHold} ${he ? "ימים" : "days"}`, undefined],
  ];

  // The full trade columns Dan asked for, incl. running equity.
  const cols = ["#", he ? "תאריך" : "Date", he ? "סימבול" : "Symbol", he ? "צד" : "Side",
    he ? "גודל ($)" : "Size ($)", he ? "כניסה" : "Entry", he ? "יציאה" : "Exit",
    "P&L ($)", "P&L (%)", he ? "הון מצטבר ($)" : "Running equity ($)"];
  const numFrom = 4; // right-align numeric columns from this index
  const winSuffix = isFull ? "" : `_${effFrom}_to_${effTo}`;

  const exportCsv = () => {
    const rows = (trades || []).map((t, i) => [i + 1, t.entry_date, t.symbol, t.side,
      t.size, t.entry_price, t.exit_price, t.pnl, t.pnl_pct, t.running_equity]);
    downloadCsv(`${p.id}_validated_trades${winSuffix}.csv`, [
      [`# window: ${effFrom} → ${effTo}${isFull ? " (full range)" : " (filtered)"}`],
      ["#", "Date", "Symbol", "Side", "Size", "Entry price", "Exit price", "PnL USD", "PnL %", "Running equity"],
      ...rows,
    ]);
    track("autopilot_export_csv", { pilot: p.id, kind: "validated_trades", windowed: !isFull });
  };

  const printReport = () => {
    const kpiHtml = `<table><tbody>${kpis.map(([k, val]) => `<tr><th style="width:40%">${escHtml(k)}</th><td>${escHtml(val)}</td></tr>`).join("")}</tbody></table>`;
    const t = trades || [];
    const windowLine = `<div class="muted">${he ? "חלון" : "Window"}: ${escHtml(effFrom)} → ${escHtml(effTo)}${isFull ? (he ? " (טווח מלא)" : " (full range)") : (he ? " (מסונן)" : " (filtered)")}</div>`;
    const tradesHtml = `<h2>${he ? "יומן עסקאות" : "Trade log"} (${t.length})</h2>
      <table><thead><tr>${cols.map((c) => `<th>${escHtml(c)}</th>`).join("")}</tr></thead>
      <tbody>${t.map((tr, i) => `<tr><td>${i + 1}</td><td>${escHtml(String(tr.entry_date))}</td><td>${escHtml(String(tr.symbol))}</td><td>${escHtml(String(tr.side))}</td><td>${escHtml(fmtMoney(tr.size))}</td><td>${escHtml(fmtPx(tr.entry_price))}</td><td>${escHtml(fmtPx(tr.exit_price))}</td><td>${escHtml(fmtSignedMoney(Number(tr.pnl || 0)))}</td><td>${escHtml(fmtPct(Number(tr.pnl_pct || 0)))}</td><td>${escHtml(fmtMoney(tr.running_equity))}</td></tr>`).join("")}</tbody></table>`;
    const html = `
      <h1>${escHtml(bi(p.name, he))}</h1>
      <div class="muted">${escHtml(p.id)} &middot; ${escHtml(bi(SELF_VALIDATED_LABEL, he))}</div>
      ${windowLine}
      <p>${escHtml(bi(v.method, he))}</p>
      <h2>${escHtml(bi(VALIDATED_LABEL, he))}</h2>${kpiHtml}
      <p><span class="tag">${escHtml(bi(BACKTEST_VS_SIM_NOTE, he))}</span></p>
      <p><span class="tag">${escHtml(bi(SLIPPAGE_NOTE, he))}</span></p>
      <p><span class="tag">${escHtml(bi(CORRELATION_CAVEAT, he))}</span></p>
      ${tradesHtml}
      <p class="muted">${escHtml(bi(PERF_DISCLAIMER, he))}.</p>`;
    openPrintable(`${bi(p.name, he)} — ${bi(SELF_VALIDATED_LABEL, he)}`, html, rtl ? "rtl" : "ltr");
    track("autopilot_export_pdf", { pilot: p.id, kind: "validated", windowed: !isFull });
  };

  const ExpBtn = ({ Icon, label, onClick, primary }: { Icon: any; label: string; onClick: () => void; primary?: boolean }) => (
    <button onClick={onClick} className="tap44" style={{ ...btn(primary), flex: 1, minWidth: 130, justifyContent: "center" }}>
      <Icon size={14} /> {label}
    </button>
  );
  // One honest caveat line (kept visible in the report).
  const Caveat = ({ Icon, text }: { Icon: any; text: string }) => (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 10.5, lineHeight: 1.45, color: C.faint }}>
      <Icon size={12} style={{ flexShrink: 0, marginTop: 1 }} /><span>{text}</span>
    </div>
  );
  const dateInput: React.CSSProperties = { ...input, fontFamily: UI, padding: "6px 8px", fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box", colorScheme: "dark" as any };
  const equityStart = win.equityStart;
  const equityEnd = win.equityEnd;

  return createPortal(
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 2050, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16, direction: rtl ? "rtl" : "ltr" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" dir={rtl ? "rtl" : "ltr"} aria-label={he ? "דוח תוצאות מאומת" : "Validated results report"}
        style={{ width: "min(720px, 96vw)", maxHeight: "calc(100dvh - 32px)", overflowY: "auto", background: C.surface,
          border: `1px solid ${C.line}`, borderRadius: 18, boxShadow: "0 28px 80px rgba(0,0,0,0.6)", fontFamily: UI }}>
        {/* Header — green (validated). */}
        <div style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", alignItems: "center", gap: 10, padding: "14px 16px",
          borderBottom: `1px solid ${C.line}`, background: `linear-gradient(135deg, ${C.gain}18, ${C.gain}08), ${C.surface}` }}>
          <ShieldCheck size={18} color={C.gain} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 900, color: C.text }}>{he ? "תוצאות שאומתו עצמאית · דוח מלא" : "Self-validated results · full report"}</div>
            <div style={{ fontSize: 10.5, color: C.faint }}>{bi(p.name, he)} · {p.id}</div>
          </div>
          <button onClick={onClose} aria-label={he ? "סגור" : "Close"} className="tap44"
            style={{ flexShrink: 0, background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={18} /></button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Headline summary — our-engine numbers (each = what the log reproduces). */}
          <div style={{ background: `${C.gain}0e`, border: `1px solid ${C.gain}55`, borderRadius: 14, padding: "12px 13px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <Badge Icon={ShieldCheck} label={bi(VALIDATED_LABEL, he)} color={C.gain} />
              <span style={{ fontSize: 9.5, fontWeight: 700, color: isFull ? C.faint : C.gold }}>
                {isFull
                  ? (he ? "כל מספר שווה למה שהיומן משחזר" : "each number equals what the log reproduces")
                  : (he ? `מחושב מחדש על החלון ${effFrom} → ${effTo}` : `recomputed over ${effFrom} → ${effTo}`)}
              </span>
              <InfoTip he={he} align="start" title={he ? "המדדים (KPI)" : "The KPIs"}
                lines={[he ? "net% = שינוי עקומת ההון · DD = ירידה מקסימלית (שיא→שפל) · PF = פקטור רווח (רווחים/הפסדים) · Win = אחוז עסקאות מרוויחות." : "net% = equity-curve change · DD = max drawdown (peak→trough) · PF = profit factor (gains/losses) · Win = % winning trades.",
                        he ? "מחושבים מחדש מיומן הסימולציה של הטייס עצמו (ניתן לשחזור) על החלון שנבחר." : "Recomputed from the pilot's OWN simulation trade log (reproducible) over the selected window.",
                        he ? "האסטרטגיה עצמה ממקור Trend Radar (בקטסט מקור) — שחזור עצמאי בלייב עדיין ממתין." : "The underlying strategy is sourced from Trend Radar (source backtest) — independent live reproduction is still pending."]} />
            </div>
            {/* DR Crypto RISK-MODE selector — return AND drawdown together, default Smooth. */}
            {isDR && drModes.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, background: `${C.blue}0d`, border: `1px solid ${C.blue}44`, borderRadius: 12, padding: "9px 11px", marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: C.text, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <ShieldCheck size={13} color={C.blue} /> {he ? "מצב סיכון — קובע גם איך הטייס רץ בסימולציה" : "Risk mode — also sets how the pilot runs in simulation"}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                  {drModes.map((m) => {
                    const on = m.key === activeMode?.key;
                    return (
                      <button key={m.key} onClick={() => pickMode(m.key)}
                        style={{ textAlign: "start", cursor: "pointer", borderRadius: 10, padding: "7px 9px",
                          border: `1px solid ${on ? `${C.blue}88` : C.line}`, background: on ? `${C.blue}18` : C.surface2 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: C.text }}>{m.emoji} {bi(m.label, he)}</div>
                        <div style={{ fontSize: 13, fontWeight: 900, color: C.gain, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{fmtPnl(m.net_pct)}</div>
                        <div style={{ fontSize: 10, fontWeight: 800, color: C.loss, fontVariantNumeric: "tabular-nums" }}>DD {fmtDd(Math.abs(m.maxdd_pct))}</div>
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 9, lineHeight: 1.4, color: C.faint }}>
                  {he ? "מצב אגרסיבי יותר = תשואה גבוהה יותר אך drawdown עמוק יותר — אף פעם לא תשואה לבד. סימולציה מקומפאונדת נטו אחרי עמלות+החלקה. לא רווח בפועל; מוטה-שרידות ונשען על שוק השור 2020-21." : "A more aggressive mode = higher return but DEEPER drawdown — never return alone. Compounding simulation, net of fees + slippage. Not earned P&L; survivorship-flattered and leans on the 2020-21 bull."}
                </div>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {kpis.map(([label, val, color]) => (
                <div key={label} style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "9px 11px" }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: C.faint, marginBottom: 3 }}>{label}</div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: color || C.text, fontVariantNumeric: "tabular-nums" }}>{val}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
              <Chip Icon={TrendingUp} label={v.direction === "long-only" ? (he ? "לונג בלבד" : "Long-only") : (he ? "לונג/שורט" : "Long/short")} />
              <Chip Icon={CalendarRange} label={bi(v.range, he)} />
              <Chip Icon={Target} label={`${v.symbols.length} ${he ? "שווי-שוק גדולים" : "large-caps"}: ${v.symbols.join(" ")}`} />
              <InfoTip he={he} align="start" title={he ? "כיוון · טווח · שוק" : "Direction · range · market"}
                lines={[he ? `כיוון: ${v.direction === "long-only" ? "לונג בלבד (רווח מעלייה)" : "לונג ושורט (גם מירידה)"}.` : `Direction: ${v.direction === "long-only" ? "long-only (profits from a rise)" : "long & short (also from a fall)"}.`,
                        he ? "טווח = תקופת נתוני המקור. השוק = היקום שנסרק (שווי-שוק גדולים)." : "Range = the source-data period. Market = the scanned universe (large-caps)."]} />
            </div>
            <p style={{ margin: "9px 0 0", fontSize: 11.5, lineHeight: 1.5, color: C.muted }}>{bi(v.method, he)}</p>
          </div>

          {/* ── Date-range filter + REAL equity curve (Dan): slice from→to, KPIs above + table
              below recompute live. Default = full range → reproduces the card numbers. ── */}
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: "11px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
              <CalendarRange size={14} color={C.gold} />
              <span style={{ fontSize: 12, fontWeight: 900, color: C.text }}>{he ? "טווח תאריכים · חי" : "Date range · live"}</span>
              <span style={{ fontSize: 9.5, fontWeight: 700, color: C.faint }}>
                {isFull ? (he ? "טווח מלא" : "full range") : (he ? `${K.count.toLocaleString("en-US")} עסקאות בחלון` : `${K.count.toLocaleString("en-US")} trades in window`)}
              </span>
              <InfoTip he={he} align="start" title={he ? "מסע הרווח/הפסד (עקומת הון)" : "P&L journey (equity curve)"}
                lines={[he ? "העקומה = ההון המצטבר של עסקאות הסימולציה, בסדר סגירה. שינוי ההתחלה→סוף שווה ל-net% למעלה — אותו סיפור." : "The curve = cumulative equity of the simulation trades, in close order. Its start→end change equals the net% above — one story.",
                        he ? "בחר From/To כדי לחשב מחדש את המדדים והעקומה על חלון. סימולציה בלבד — לא כסף אמת." : "Pick From/To to recompute the KPIs + curve over a window. Simulation only — no real money."]} />
              {!isFull && (
                <button onClick={() => { setFrom(null); setTo(null); }} className="tap44"
                  style={{ marginInlineStart: "auto", ...btn(), padding: "4px 10px", fontSize: 11 }}>
                  <RefreshCw size={12} /> {he ? "אפס לטווח מלא" : "Reset to full range"}
                </button>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <label style={{ flex: 1, minWidth: 130, display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 9.5, fontWeight: 800, color: C.faint }}>{he ? "מתאריך" : "From"}</span>
                <input type="date" dir="ltr" value={effFrom} min={minDate} max={maxSel} disabled={isPending || !minDate}
                  onChange={(e) => setFrom(e.target.value || null)} style={dateInput} />
              </label>
              <label style={{ flex: 1, minWidth: 130, display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 9.5, fontWeight: 800, color: C.faint }}>{he ? "עד תאריך" : "To"}</span>
                <input type="date" dir="ltr" value={effTo} min={minDate} max={maxSel} disabled={isPending || !minDate}
                  onChange={(e) => setTo(e.target.value || null)} style={dateInput} />
              </label>
              {/* Explicit "Today" quick-set — always works regardless of the native picker. */}
              <button onClick={() => setTo(today)} disabled={isPending || !minDate} className="tap44"
                title={he ? `היום (${today})` : `Today (${today})`}
                style={{ ...btn(), padding: "6px 12px", fontSize: 11, opacity: (isPending || !minDate) ? 0.5 : 1 }}>
                {he ? "היום" : "Today"}
              </button>
            </div>
            {/* Equity curve — same story as the headline: start→end change === net% above.
                Full range = the real equity path; windowed = equity of trades opened in the
                window, cumulative from the portfolio value at `from`. */}
            {!isPending && curve.length >= 2 && (
              <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "8px 10px 4px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 9.5, fontWeight: 700, color: C.faint, marginBottom: 2 }}>
                  <span>{fmtMoney(equityStart * factor)} · {effFrom}</span>
                  <span style={{ color: K.net >= 0 ? C.gain : C.loss }}>{fmtPnl(Number(K.net.toFixed(1)))}</span>
                  <span>{fmtMoney(equityEnd * factor)} · {effTo}</span>
                </div>
                <NavChart nav={dispCurve} h={92} />
                {!isFull && (
                  <div style={{ marginTop: 3, fontSize: 9, lineHeight: 1.4, color: C.faint, textAlign: "center" }}>
                    {he ? "סימולציית האסטרטגיה על החלון (לא רווח שנצבר בפועל): הון מצטבר של עסקאות שנפתחו בחלון, החל משווי התיק ב-From. תשואה = שינוי העקומה." : "Strategy simulated over the window (NOT your actually-earned P&L): cumulative equity of trades opened in the window, from the portfolio value at From. Return = the curve's change."}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Honest caveats — historical-backtest-vs-live-sim + slippage=0 + correlation. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7, background: `${C.gold}0d`, border: `1px solid ${C.gold}44`, borderRadius: 12, padding: "10px 12px" }}>
            <Caveat Icon={FlaskConical} text={bi(BACKTEST_VS_SIM_NOTE, he)} />
            <Caveat Icon={AlertTriangle} text={bi(SLIPPAGE_NOTE, he)} />
            <Caveat Icon={ArrowLeftRight} text={bi(CORRELATION_CAVEAT, he)} />
          </div>

          {/* (The DR target slider was folded into the risk-mode selector above — modes are the
              compounding-aware transparency control; the fixed-sizing TP sweep no longer matches.) */}

          {/* Export actions — Print/PDF + CSV of the REAL validated trades. */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ExpBtn Icon={Printer} label={he ? "הדפסה / PDF" : "Print / PDF"} onClick={printReport} primary />
            <ExpBtn Icon={FileText} label={he ? "ייצוא עסקאות (CSV)" : "Trades (CSV)"} onClick={exportCsv} />
          </div>

          {/* Full trade log — date · symbol · side · size · entry · exit · pnl · pnl% · running equity. */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 900, color: C.text, marginBottom: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <ListChecks size={14} color={C.gain} /> {isFull ? (he ? "יומן עסקאות מלא" : "Full trade log") : (he ? "עסקאות שנפתחו בחלון" : "Trades opened in window")}
              {trades && <span style={{ fontSize: 10, fontWeight: 800, color: C.faint }}>({trades.length.toLocaleString("en-US")})</span>}
              {trades && trades.length > 1 && (
                <button onClick={() => setLogDesc((v) => !v)} title={he ? "שינוי סדר מיון" : "Change sort order"}
                  style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9.5, fontWeight: 800,
                    color: C.muted, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: "3px 9px", cursor: "pointer", whiteSpace: "nowrap" }}>
                  {logDesc ? <ArrowDownRight size={11} /> : <ArrowUpRight size={11} />}
                  {logDesc ? (he ? "החדשות למעלה" : "Newest first") : (he ? "הישנות למעלה" : "Oldest first")}
                </button>
              )}
            </div>
            {!isPending && trades && trades.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {/* winners / losers filter (display only) */}
                <div style={{ display: "inline-flex", border: `1px solid ${C.line}`, borderRadius: 999, overflow: "hidden" }}>
                  {([["all", he ? "הכל" : "All"], ["win", he ? "מרוויחות" : "Winners"], ["loss", he ? "מפסידות" : "Losers"]] as const).map(([k, lab]) => (
                    <button key={k} onClick={() => setLogFilter(k)}
                      style={{ fontSize: 9.5, fontWeight: 800, padding: "4px 10px", cursor: "pointer", border: "none",
                        background: logFilter === k ? C.accentGrad : "transparent", color: logFilter === k ? ACCENT_INK : C.muted }}>{lab}</button>
                  ))}
                </div>
                {/* capital what-if — rescales every $ display (simulation) */}
                <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9.5, fontWeight: 800, color: C.muted }}>
                  {he ? "הון (סימולציה)" : "Capital (sim)"}
                  <span style={{ display: "inline-flex", alignItems: "center", border: `1px solid ${C.line}`, borderRadius: 8, background: C.surface2, paddingInlineStart: 6 }}>
                    <span style={{ color: C.faint }}>$</span>
                    <input type="number" min={1} step={100} value={capital}
                      onChange={(e) => setCapital(Math.max(0, Number(e.target.value) || 0))}
                      style={{ width: 78, border: "none", background: "transparent", color: C.text, fontSize: 11, fontWeight: 800, padding: "3px 6px", outline: "none" }} />
                  </span>
                </label>
                <span style={{ fontSize: 8.5, color: C.faint }}>{he ? "משנה גודל ורווח ב-$ (סימולציה — לא רווח בפועל)" : "rescales $ size & P&L (simulation — not earned)"}</span>
              </div>
            )}
            {loadErr ? (
              <div style={{ fontSize: 11.5, color: C.loss, padding: "6px 2px" }}>{he ? "טעינת יומן העסקאות נכשלה." : "Failed to load the trade log."}</div>
            ) : !trades ? (
              <div style={{ fontSize: 11.5, color: C.faint, padding: "6px 2px", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Loader2 size={13} className="spin" /> {he ? "טוען עסקאות…" : "Loading trades…"}
              </div>
            ) : trades.length === 0 ? (
              <div style={{ fontSize: 11.5, color: C.faint, padding: "6px 2px" }}>{he ? "אין עסקאות שנפתחו בטווח שנבחר." : "No trades opened in the selected range."}</div>
            ) : (
              <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
                <div style={{ maxHeight: 360, overflow: "auto" }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 680, fontSize: 10.5, direction: "ltr" }}>
                    <thead>
                      <tr>
                        {cols.map((c, ci) => (
                          <th key={ci} style={{ position: "sticky", top: 0, background: C.surface2, color: C.faint, fontWeight: 800, fontSize: 9,
                            textAlign: ci >= numFrom ? "right" : "left", padding: "7px 9px", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" }}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayTrades!.map((t, i) => {
                        const pnl = Number(t.pnl || 0) * factor;   // $ rescaled to the chosen capital
                        const col = pnlColor(pnl);
                        const long = String(t.side || "").toLowerCase() === "long";
                        return (
                          <tr key={i} style={{ background: i % 2 ? "transparent" : C.surface2 }}>
                            <td style={{ padding: "6px 9px", color: C.faint, fontVariantNumeric: "tabular-nums" }}>{i + 1}</td>
                            <td style={{ padding: "6px 9px", color: C.muted, whiteSpace: "nowrap" }}>{t.entry_date}</td>
                            <td style={{ padding: "6px 9px", color: C.text, fontWeight: 800 }}>{t.symbol}</td>
                            <td style={{ padding: "6px 9px", color: long ? C.gain : C.loss, fontWeight: 700 }}>{t.side}</td>
                            <td style={{ padding: "6px 9px", textAlign: "right", color: C.muted, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(Number(t.size || 0) * factor)}</td>
                            <td style={{ padding: "6px 9px", textAlign: "right", color: C.muted, fontVariantNumeric: "tabular-nums" }}>{fmtPx(t.entry_price)}</td>
                            <td style={{ padding: "6px 9px", textAlign: "right", color: C.muted, fontVariantNumeric: "tabular-nums" }}>{fmtPx(t.exit_price)}</td>
                            <td style={{ padding: "6px 9px", textAlign: "right", color: col, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtSignedMoney(pnl)}</td>
                            <td style={{ padding: "6px 9px", textAlign: "right", color: col, fontVariantNumeric: "tabular-nums" }}>{fmtPct(Number(t.pnl_pct || 0))}</td>
                            <td style={{ padding: "6px 9px", textAlign: "right", color: C.text, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(Number(t.running_equity || 0) * factor)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {/* Honest source of the log — from the JSON's own config (commission + fills). */}
            {meta.config && (
              <div style={{ marginTop: 7, fontSize: 10, lineHeight: 1.5, color: C.faint }}>
                {he ? "בסיס: " : "Basis: "}
                {he ? "הון התחלתי" : "initial capital"} {fmtMoney(meta.config.initial_capital)} · {String(meta.config.position_size || "")} · {he ? "עמלה" : "commission"} {meta.config.commission_pct}% · {String(meta.config.fills || "")}
              </div>
            )}
          </div>

          {/* Disclaimer — kept. */}
          <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
            <Caveat Icon={Info} text={`${bi(PERF_DISCLAIMER, he)}.`} />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Rising equity-curve sparkline ─────────────────────────────────────────────────
// A deterministic (no RNG), log-scaled rising curve from 10k to 10k·(1+PnL/100). The
// crypto pilots (huge PnL) sweep 10k→~1M; the stocks pilot 10k→~60k — exactly matching
// each tile's headline PnL. Purely illustrative of the SOURCE curve's shape, not our data.
// `h` lets the same curve render small (tiles) or large (detail header).
function EquitySparkline({ pnlPct, up = true, h = 48 }: { pnlPct: number; up?: boolean; h?: number }) {
  const W = 260, N = 48, H = h;
  const logEnd = Math.log(1 + Math.max(pnlPct, 1) / 100); // total rise in log-space
  const ys: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    // Monotone-ish log rise + gentle deterministic wobble that fades toward the end.
    const wobble = (Math.sin(t * 9.2) * 0.05 + Math.sin(t * 21) * 0.025) * (1 - t) * logEnd;
    ys.push(t * logEnd + wobble);
  }
  const min = Math.min(...ys), max = Math.max(...ys) || 1;
  const px = (i: number) => (i / (N - 1)) * W;
  const py = (v: number) => H - 3 - ((v - min) / (max - min || 1)) * (H - 6);
  const line = ys.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const stroke = up ? C.gain : C.loss;
  const gid = `apspark-${Math.round(pnlPct)}-${h}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
      style={{ display: "block", direction: "ltr" }} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.30" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Backtest results block — HONEST source reference (Trend Radar), NOT our-engine ──
// Every block is labelled "Trend Radar · source backtest", carries the performance
// disclaimer and the "reproduction in our engine — pending" note. No engine-verified claim.
function BacktestBlock({ p, he, rtl, sim }: { p: AutoPilot; he: boolean; rtl: boolean; sim?: ApSimPilot }) {
  const s = p.backtest;
  const v = p.validated;
  const [report, setReport] = useState(false);
  // Each headline metric is a clickable ExplainValue → "how it's computed + source" (verify).
  const MetricV = ({ Icon, label, value, color, ex }: { Icon: any; label: string; value: string; color?: string; ex: Explain }) => (
    <div style={soft({ padding: "8px 10px" })}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9, fontWeight: 800, color: C.faint, marginBottom: 3 }}>
        <Icon size={11} color={C.faint} /> {label}
      </div>
      <ExplainValue ex={ex} he={he} rtl={rtl} color={color || C.text}
        style={{ fontSize: 14, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{value}</ExplainValue>
    </div>
  );
  // Plain metric tile (PF · Win — no drill-down).
  const MetricP = ({ Icon, label, value }: { Icon: any; label: string; value: string }) => (
    <div style={soft({ padding: "8px 10px" })}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9, fontWeight: 800, color: C.faint, marginBottom: 3 }}>
        <Icon size={11} color={C.faint} /> {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 900, color: C.text, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 900, color: C.text }}>
          <Activity size={14} color={C.gain} /> {he ? "תוצאות בקטסט" : "Backtest results"}
        </span>
        {/* Honest provenance — our-engine, self-validated (each number = what the log reproduces). */}
        <Badge Icon={ShieldCheck} label={bi(SELF_VALIDATED_LABEL, he)} color={C.gain} />
      </div>

      {/* Rising equity curve (self-validated net). */}
      <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "8px 10px 4px", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 9.5, fontWeight: 700, color: C.faint, marginBottom: 2 }}>
          <span>$10K</span>
          <span style={{ color: C.gain }}>{fmtPnl(s.pnlPct)}</span>
        </div>
        <EquitySparkline pnlPct={s.pnlPct} h={64} />
      </div>

      {/* Headline metrics: Net · Max DD · PF · Win · Trades — each equals what the log reproduces. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
        <MetricV Icon={TrendingUp} label={he ? "תשואה נטו" : "Net"} value={fmtPnl(v.pnlPct)} color={C.gain} ex={exBacktest(p, "pnl", he)} />
        <MetricV Icon={TrendingDown} label={he ? "ירידה מקס'" : "Max DD"} value={fmtDd(v.maxDrawdown)} color={C.loss} ex={exBacktest(p, "dd", he)} />
        <MetricP Icon={Activity} label={he ? "פקטור" : "PF"} value={v.profitFactor.toFixed(2)} />
        <MetricP Icon={Target} label={he ? "הצלחה" : "Win"} value={`${v.winPct.toFixed(1)}%`} />
        <MetricV Icon={Timer} label={he ? "עסקאות" : "Trades"} value={v.trades.toLocaleString("en-US")} ex={exBacktest(p, "trades", he)} />
      </div>

      {/* Direction · window · universe. */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
        <Chip Icon={v.direction === "long-only" ? TrendingUp : ArrowLeftRight} label={v.direction === "long-only" ? (he ? "לונג בלבד" : "Long-only") : (he ? "לונג/שורט" : "Long/short")} />
        <Chip Icon={CalendarRange} label={bi(s.range, he)} />
        <Chip Icon={Target} label={`${v.symbols.length} ${he ? "שווי-שוק" : "large-caps"}: ${s.benchmark}`} />
      </div>

      <div style={{ marginTop: 9, fontSize: 10.5, lineHeight: 1.5, color: C.muted }}>{bi(v.method, he)}</div>

      {/* VERIFY — open the full report (summary + full trade log + export). */}
      <button onClick={() => setReport(true)} className="tap44"
        style={{ ...btn(true), width: "100%", justifyContent: "center", marginTop: 11 }}>
        <FileSearch size={15} /> {he ? "דוח מלא · כל העסקאות + ייצוא (CSV/PDF)" : "Full report · all trades + export (CSV/PDF)"}
      </button>

      {/* Honest caveats — kept visible: slippage=0 · same-universe/same-family · perf disclaimer. */}
      <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 10.5, lineHeight: 1.45, color: C.faint }}>
          <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} /><span>{bi(SLIPPAGE_NOTE, he)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 10.5, lineHeight: 1.45, color: C.faint }}>
          <ArrowLeftRight size={12} style={{ flexShrink: 0, marginTop: 1 }} /><span>{bi(CORRELATION_CAVEAT, he)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 10.5, lineHeight: 1.45, color: C.faint }}>
          <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} /><span>{bi(PERF_DISCLAIMER, he)}.</span>
        </div>
      </div>

      {report && <BacktestReportModal p={p} sim={sim} he={he} rtl={rtl} onClose={() => setReport(false)} />}
    </div>
  );
}

// ── Plain-language "how it works" steps (shared across pilots) ────────────────────
const HOW_STEPS: { Icon: any; he: string; en: string }[] = [
  { Icon: ScanLine, he: "סורק את השוק כל יום (רדאר המגמות — טופ 100/150).", en: "Scans the market every day (the Trend Radar — top 100/150)." },
  { Icon: ListChecks, he: "מיישם את חוקי האסטרטגיה כדי לבחור כניסות ויציאות.", en: "Applies the strategy's rules to pick entries and exits." },
  { Icon: Wallet, he: "מתאים את גודל כל פוזיציה כחלק יחסי מההון שלך.", en: "Sizes each position as a fraction of your capital." },
  { Icon: Repeat, he: "פותח וסוגר פוזיציות לונג (ובחלק מהטייסים גם שורט) אוטומטית.", en: "Opens and closes long (and, in some pilots, short) positions automatically." },
];

// The action row (ARM / armed-state + run-now / disarm) — reused by the detail view.
function ArmAction({ p, he, sim, onArm, onDisarm, onRun, running, onApplyState }: {
  p: AutoPilot; he: boolean; sim?: ApSimPilot; onArm: () => void; onDisarm: () => void; onRun: () => void;
  running: boolean; onApplyState: (s: ApSimState) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [capIn, setCapIn] = useState("");
  const [saving, setSaving] = useState(false);
  if (sim) {
    const pct = Number(sim.perTradePct || 0);
    const capNum = Number(capIn);
    const previewSize = capNum > 0 && pct > 0 ? (capNum * pct) / 100 : 0;
    const isLive = (sim.mode || "simulation") === "live";
    const openEdit = () => { setCapIn(String(Math.round(Number(sim.capital ?? sim.nav) || 0))); setEditing(true); };
    const save = async () => {
      if (!(capNum > 0)) { ev.blockedActionSeen("edit_capital", "invalid_amount"); return; }
      if (saving) return;                                   // duplicate-submit guard (idempotent intent)
      setSaving(true);
      try {
        const s = await api.autopilotEditCapital({ pilotId: p.id, nav: capNum });
        onApplyState(s as any); setEditing(false); track("autopilot_edit_capital", { pilot: p.id, nav: capNum });
      } catch (e: any) { ev.blockedActionSeen("edit_capital", "rejected"); alert(he ? `עדכון ההון נכשל: ${e?.message || e}` : `Edit capital failed: ${e?.message || e}`); }
      finally { setSaving(false); }
    };
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* MODE-AWARE status banner (Yoav #ZXXG): live shows the live cap + per-trade of the
            cap and that real orders need approval; simulation shows the sim capital. */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11.5, lineHeight: 1.5, color: C.muted,
          background: isLive ? `${C.loss}0e` : C.surface2, border: `1px solid ${isLive ? `${C.loss}55` : C.line}`, borderRadius: 12, padding: "9px 12px" }}>
          {isLive ? <Radio size={14} color={C.loss} style={{ flexShrink: 0, marginTop: 1 }} />
                  : <FlaskConical size={14} color={C.gold} style={{ flexShrink: 0, marginTop: 1 }} />}
          <span>{isLive
            ? (he
              ? `לייב · כסף אמיתי · ${sim.accountLabel || "—"} · תקרת לייב ${fmtMoney(liveCapOf(sim))} · ${sim.perTradePct}% לעסקה (≈ ${fmtMoney((liveCapOf(sim) * Number(sim.perTradePct || 0)) / 100)}). כל פקודה דורשת אישור — הטייס אינו קונה מעצמו.`
              : `Live · real money · ${sim.accountLabel || "—"} · live cap ${fmtMoney(liveCapOf(sim))} · ${sim.perTradePct}% per trade (≈ ${fmtMoney((liveCapOf(sim) * Number(sim.perTradePct || 0)) / 100)}). Every order needs your approval — the pilot never buys on its own.`)
            : (he
              ? `טעון במצב סימולציה · ${sim.accountLabel || "—"} · הון ${fmtMoney(sim.capital ?? sim.nav)} · ${sim.perTradePct}% לעסקה (≈ ${fmtMoney(perTradeUsd(sim))}). לא מבוצעות פקודות אמיתיות.`
              : `Loaded in simulation · ${sim.accountLabel || "—"} · capital ${fmtMoney(sim.capital ?? sim.nav)} · ${sim.perTradePct}% per trade (≈ ${fmtMoney(perTradeUsd(sim))}). No real orders are placed.`)}</span>
        </div>

        {/* EDIT CAPITAL — change the sizing capital in place (no disarm/reload); per-trade $ re-derives. */}
        {editing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 7, background: C.surface2, border: `1px solid ${C.gold}66`, borderRadius: 12, padding: "10px 12px" }}>
            <label style={{ fontSize: 11, fontWeight: 800, color: C.muted }}>{he ? "הון חדש (USD)" : "New capital (USD)"}</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input value={capIn} onChange={(e) => setCapIn(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" dir="ltr"
                placeholder="1000" style={{ ...input, flex: 1, minWidth: 110, boxSizing: "border-box", fontFamily: UI }} />
              <button onClick={save} disabled={saving || !(capNum > 0)} className="tap44"
                style={{ ...btn(true), justifyContent: "center", opacity: (saving || !(capNum > 0)) ? 0.6 : 1 }}>
                {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />} {he ? "שמור" : "Save"}
              </button>
              <button onClick={() => setEditing(false)} className="tap44" style={{ ...btn(), justifyContent: "center" }}>{he ? "ביטול" : "Cancel"}</button>
            </div>
            <div style={{ fontSize: 10.5, color: C.faint }}>
              {he ? `גודל חדש לעסקה: ${pct}% × ${fmtMoney(capNum)} ≈ ` : `New per-trade size: ${pct}% × ${fmtMoney(capNum)} ≈ `}
              <b style={{ color: C.gold }}>{fmtMoney(previewSize)}</b>
              {isLive && <>{" · "}<span style={{ color: C.loss }}>{he ? `תקרת הלייב (${fmtMoney(sim.liveCap)}) לא משתנה` : `live cap (${fmtMoney(sim.liveCap)}) unchanged`}</span></>}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {/* Run-now opens the REVIEW panel — it does NOT place anything itself. It
                computes a read-only plan; the owner approves (all or a subset) there, and
                ONLY then does anything execute (a real Bybit order for a live pilot). The
                button stays RED on a live pilot as a visual cue that approval = real money. */}
            <button
              onClick={() => onRun()}
              disabled={running} className="tap44"
              style={isLive
                ? { ...btn(true), flex: 1, minWidth: 140, justifyContent: "center", opacity: running ? 0.6 : 1,
                    background: C.loss, border: `1px solid ${C.loss}`, color: "#fff" }
                : { ...btn(true), flex: 1, minWidth: 140, justifyContent: "center", opacity: running ? 0.6 : 1 }}>
              {running ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}{" "}
              {isLive
                ? (he ? "הרץ עכשיו · בדיקה ואישור" : "Run now · review & approve")
                : (he ? "הרץ עכשיו · בדיקה ואישור" : "Run now · review & approve")}
            </button>
            <InfoTip he={he} title={he ? "הרץ עכשיו" : "Run now"}
              lines={isLive
                ? [he ? "מריץ מעבר מיידי ופותח פאנל תוכנית לקריאה בלבד." : "Runs an immediate pass and opens a read-only plan panel.",
                   he ? "בטייס לייב — אישור בפאנל = פקודות אמיתיות בכסף אמת." : "On a LIVE pilot, approving in the panel = real orders, real money."]
                : [he ? "מבצע מעבר סימולציה מיידי (במקום להמתין להרצה היומית 00:10 UTC)." : "Runs an immediate SIMULATION pass (instead of waiting for the 00:10 UTC daily run).",
                   he ? "פותח פאנל תוכנית לקריאה בלבד — אתה מאשר לפני שנפתחת פוזיציה. בלי כסף אמת." : "Opens a read-only plan panel — you approve before any position opens. No real money."]} />
            {/* In live mode this edits the SIMULATION capital only (live cap is set at go-live
                and is unchanged) — labelled explicitly so it's never mistaken for the live cap. */}
            <button onClick={openEdit} className="tap44" style={{ ...btn(), justifyContent: "center" }}>
              <Wallet size={15} /> {isLive ? (he ? "ערוך הון סימולציה" : "Edit sim capital") : (he ? "ערוך הון" : "Edit capital")}
            </button>
            <InfoTip he={he} title={isLive ? (he ? "ערוך הון סימולציה" : "Edit sim capital") : (he ? "ערוך הון" : "Edit capital")}
              lines={[he ? "מגדיר את ההון וגודל הפוזיציה (% מההון) שהסימולציה משתמשת בהם." : "Sets the capital + position size (% of capital) the simulation uses.",
                      isLive ? (he ? "משנה רק את מספרי הסימולציה — תקרת הלייב (כסף אמת) לא משתנה." : "Changes the simulation figures only — the live cap (real money) is unchanged.")
                             : (he ? "משנה רק את מספרי הסימולציה — לא נוגע בכסף אמת." : "Changes the simulation figures only — never touches real money.")]} />
            <button onClick={onDisarm} className="tap44"
              style={{ ...btn(), color: C.loss, borderColor: `${C.loss}66`, justifyContent: "center" }}>
              <X size={15} /> {he ? "פרוק טייס" : "Unload"}
            </button>
            <InfoTip he={he} title={he ? "פרוק טייס" : "Unload"}
              lines={[he ? "מנקה את הטייס ואת פוזיציות הסימולציה שלו." : "Clears the pilot and its simulation positions.",
                      he ? "לא סוגר ולא מבטל שום עסקה אמיתית בבורסה." : "Closes/cancels no real exchange order."]} />
          </div>
        )}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
      <button onClick={onArm} className="tap44" style={{ ...btn(true), flex: 1, justifyContent: "center" }}>
        <ShieldAlert size={16} /> {he ? "טען טייס (3 שלבי אישור)" : "Load pilot (3-step approval)"}
      </button>
      <InfoTip he={he} title={he ? "טען טייס" : "Load pilot"}
        lines={[he ? "מפעיל את הטייס במצב סימולציה (dry-run) בלבד — בלי כסף אמת." : "Activates the pilot in SIMULATION (dry-run) only — no real money.",
                he ? "3 שלבי אישור: (1) הבנת האסטרטגיה, (2) הון/גודל פוזיציה, (3) אישור סופי." : "3-step approval: (1) understand the strategy, (2) capital/position size, (3) final confirm.",
                he ? "אינך פותח עסקאות בעצמך — הטייס פועל אוטומטית על הסריקה היומית." : "You don't place trades yourself — the pilot acts automatically on the daily scan."]} />
    </div>
  );
}

// ── Reusable "Edit capital" modal — opened from the detail action row AND the compact
// views (dashboard row Capital cell + trade-panel Capital chip). Changes ONLY the sizing
// capital (nav); the per-trade $ re-derives; live_cap is untouched; no disarm/reload. It
// writes the returned state straight into the shared AP_STATE_KEY cache, so every view
// (row · card · trade panel · detail) refreshes — no onApplyState threading needed.
function EditCapitalModal({ p, sim, he, rtl, onClose }: {
  p: AutoPilot; sim: ApSimPilot; he: boolean; rtl: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [capIn, setCapIn] = useState(String(Math.round(Number(sim.capital ?? sim.nav) || 0)));
  const [saving, setSaving] = useState(false);
  const pct = Number(sim.perTradePct || 0);
  const capNum = Number(capIn);
  const previewSize = capNum > 0 && pct > 0 ? (capNum * pct) / 100 : 0;
  const isLive = (sim.mode || "simulation") === "live";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const save = async () => {
    if (!(capNum > 0)) return;
    setSaving(true);
    try {
      const s = await api.autopilotEditCapital({ pilotId: p.id, nav: capNum });
      qc.setQueryData(AP_STATE_KEY, s); track("autopilot_edit_capital", { pilot: p.id, nav: capNum, from: "compact" });
      onClose();
    } catch (e: any) { alert(he ? `עדכון ההון נכשל: ${e?.message || e}` : `Edit capital failed: ${e?.message || e}`); }
    finally { setSaving(false); }
  };
  return createPortal(
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16, direction: rtl ? "rtl" : "ltr" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" dir={rtl ? "rtl" : "ltr"}
        style={{ width: "min(420px, 95vw)", background: C.surface, border: `1px solid ${C.gold}`, borderRadius: 16,
          boxShadow: "0 24px 70px rgba(0,0,0,0.6)", fontFamily: UI, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 15px", borderBottom: `1px solid ${C.line}`,
          background: `linear-gradient(135deg, ${C.gold}18, ${C.gold}08), ${C.surface}` }}>
          <Wallet size={17} color={C.gold} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 900, color: C.text }}>{he ? "עריכת הון" : "Edit capital"}</div>
            <div style={{ fontSize: 10.5, color: C.faint }}>{bi(p.name, he)}</div>
          </div>
          <button onClick={onClose} aria-label={he ? "סגור" : "Close"} className="tap44"
            style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={17} /></button>
        </div>
        <div style={{ padding: 15, display: "flex", flexDirection: "column", gap: 9 }}>
          <label style={{ fontSize: 11, fontWeight: 800, color: C.muted }}>{he ? "הון חדש (USD)" : "New capital (USD)"}</label>
          <input value={capIn} onChange={(e) => setCapIn(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" dir="ltr" autoFocus
            placeholder="1000" style={{ ...input, width: "100%", boxSizing: "border-box", fontFamily: UI }} />
          <div style={{ fontSize: 10.5, color: C.faint }}>
            {he ? `גודל חדש לעסקה: ${pct}% × ${fmtMoney(capNum)} ≈ ` : `New per-trade size: ${pct}% × ${fmtMoney(capNum)} ≈ `}
            <b style={{ color: C.gold }}>{fmtMoney(previewSize)}</b>
            {isLive && <>{" · "}<span style={{ color: C.loss }}>{he ? `תקרת הלייב (${fmtMoney(sim.liveCap)}) לא משתנה` : `live cap (${fmtMoney(sim.liveCap)}) unchanged`}</span></>}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
            <button onClick={save} disabled={saving || !(capNum > 0)} className="tap44"
              style={{ ...btn(true), flex: 1, justifyContent: "center", opacity: (saving || !(capNum > 0)) ? 0.6 : 1 }}>
              {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />} {he ? "שמור" : "Save"}
            </button>
            <button onClick={onClose} className="tap44" style={{ ...btn(), justifyContent: "center" }}>{he ? "ביטול" : "Cancel"}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// A tiny, subtle tap-to-edit-capital affordance for the compact views. With `children` it
// renders the capital VALUE as a dotted-underline tappable (+ optional pencil) — used in the
// dashboard row's Capital cell. Without children it's a pencil-only trigger — used beside the
// trade-panel's Capital chip (whose value already opens the verify explainer). Manages its own
// modal and stops propagation so it never triggers the parent row/tile click. Owner-only,
// loaded pilots only (the caller only renders it when sim is present).
function EditCapitalControl({ p, sim, he, rtl, children, pencil = true, pencilSize = 11, valueStyle }: {
  p: AutoPilot; sim: ApSimPilot; he: boolean; rtl: boolean; children?: React.ReactNode;
  pencil?: boolean; pencilSize?: number; valueStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const trigger = () => setOpen(true);
  // MONEY-SAFETY: editing capital is an owner-only action (backend is require_owner). For a
  // non-owner viewer (the IT editor / Oren) render the value READ-ONLY — no pencil, no modal.
  if (!isOwner()) return <span style={valueStyle}>{children}</span>;
  return (
    <>
      <span role="button" tabIndex={0} aria-label={he ? "ערוך הון" : "Edit capital"} title={he ? "ערוך הון · לחצו לעריכה" : "Edit capital"}
        onClick={(e) => { e.stopPropagation(); trigger(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); trigger(); } }}
        style={{ display: "inline-flex", alignItems: "center", gap: children ? 3 : 0, cursor: "pointer", flexShrink: 0,
          ...(children ? { textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 2 } : { color: C.gold, opacity: 0.75, padding: 1 }),
          ...valueStyle }}>
        {children}{pencil && <Pencil size={pencilSize} color={C.gold} style={{ opacity: 0.7, flexShrink: 0 }} />}
      </span>
      {open && <EditCapitalModal p={p} sim={sim} he={he} rtl={rtl} onClose={() => setOpen(false)} />}
    </>
  );
}

// ── Simulated P&L journey curve (the backfilled recent history up to the load moment) ──
function SimEquityCurve({ points, capital, he }: { points: ApEquityPoint[]; capital: number; he: boolean }) {
  const pts = (points || []).filter((p) => p && typeof p.v === "number");
  if (pts.length < 2) {
    return <div style={{ fontSize: 11.5, color: C.faint, padding: "4px 2px" }}>{he ? "אין עדיין מספיק היסטוריה לגרף." : "Not enough recent history yet for a curve."}</div>;
  }
  const W = 300, H = 92;
  const vals = pts.map((p) => p.v);
  const min = Math.min(...vals, capital), max = Math.max(...vals, capital);
  const span = (max - min) || 1;
  const px = (i: number) => (i / (pts.length - 1)) * W;
  const py = (v: number) => H - 4 - ((v - min) / span) * (H - 8);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const first = pts[0].v, last = pts[pts.length - 1].v;
  const up = last >= first;
  const stroke = up ? C.gain : C.loss;
  const baseY = py(capital);
  const gid = `apeq-${Math.round(capital)}-${pts.length}`;
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "9px 11px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10.5, fontWeight: 800, marginBottom: 4 }}>
        <span style={{ color: C.faint }}>{he ? "הון" : "capital"} {fmtMoney(capital)}</span>
        <span style={{ color: pnlColor(last - capital) }}>{he ? "שווי" : "value"} {fmtMoney(last)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block", direction: "ltr" }} aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.26" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* capital baseline */}
        <line x1="0" y1={baseY.toFixed(1)} x2={W} y2={baseY.toFixed(1)} stroke={C.faint} strokeWidth={0.8} strokeDasharray="3 3" opacity={0.6} />
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={stroke} strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}


// ── LIVE trade panel (SIMULATION) — leads with OPEN POSITIONS, then closed history ──
// Open positions are marked to REAL live market prices (server-side); this view is the
// "trade panel" that opens when a dashboard row is clicked. Focused on live trading, not
// education (the how-it-works explainers live in the screen's info cards).
function PilotTradePanel({ p, sim, he, rtl, hasScan, onOpenReport }: { p: AutoPilot; sim: ApSimPilot; he: boolean; rtl: boolean; hasScan: boolean; onOpenReport: () => void }) {
  const positions = sim.positions || [];
  const closed = sim.closedPositions || [];
  const ls = p.direction === "long-short";
  const planEntry = he
    ? (ls ? "כניסה בפריצה מעל הרצועה העליונה (לונג) או מתחת לתחתונה (שורט); יציאה בחזרה מעבר לקו האמצע."
          : "כניסה בלונג בפריצה מעל הרצועה העליונה; יציאה כשהמחיר יורד מתחת לקו.")
    : (ls ? "Enters on a break above the upper band (long) or below the lower band (short); exits back across the midline."
          : "Enters long on a break above the upper band; exits when price falls below the line.");

  const StatCell = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "8px 10px", minWidth: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 800, color: C.faint, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 900, color: color || C.text, fontVariantNumeric: "tabular-nums", direction: "ltr" }}>{value}</div>
    </div>
  );
  const StatCellV = ({ label, value, color, ex }: { label: string; value: string; color?: string; ex: Explain }) => (
    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "8px 10px", minWidth: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 800, color: C.faint, marginBottom: 2 }}>{label}</div>
      <ExplainValue ex={ex} he={he} rtl={rtl} color={color || C.text}
        style={{ fontSize: 13, fontWeight: 900, fontVariantNumeric: "tabular-nums", direction: "ltr" }}>{value}</ExplainValue>
    </div>
  );
  const Chip2 = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 800,
      background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>
      <span style={{ color: C.faint }}>{label}</span> <span style={{ color: color || C.text, direction: "ltr" }}>{value}</span>
    </span>
  );
  const SideChip = ({ side }: { side: string }) => {
    const up = side === "long";
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, fontWeight: 900,
        color: up ? C.gain : C.loss, background: `${up ? C.gain : C.loss}18`, borderRadius: 999, padding: "2px 7px", flexShrink: 0 }}>
        {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />} {up ? (he ? "לונג" : "LONG") : (he ? "שורט" : "SHORT")}
      </span>
    );
  };

  const panelLive = (sim.mode || "simulation") === "live";
  // Real connected-wallet balance (READ-ONLY) — shown as the pilot's true money in live mode.
  const balQ = useApBalance(panelLive);
  // CORRECTNESS: a LIVE pilot's headline REAL figures must reflect ONLY genuine live
  // activity (the executor's real fills) from the moment LIVE was activated — NEVER its
  // simulation P&L. With the master gate OFF, that means $0 + "no live positions yet".
  // The leftover SIM positions move to a clearly-labelled paper section below.
  const _isLiveMode = panelLive;
  const livePosArr = positions.filter((p) => (p.mode || "simulation") === "live");
  const simPosArr = positions.filter((p) => (p.mode || "simulation") !== "live");
  const liveClosedArr = closed.filter((p) => (p.mode || "simulation") === "live");
  const simClosedArr = closed.filter((p) => (p.mode || "simulation") !== "live");
  const dispPositions = _isLiveMode ? livePosArr : positions;
  const dispClosed = _isLiveMode ? liveClosedArr : closed;
  const dispOpenCount = _isLiveMode ? Number(sim.liveOpenCount ?? livePosArr.length) : sim.openCount;
  const dispTotal = _isLiveMode ? Number(sim.livePnl ?? 0) : sim.totalPnl;
  const dispUnreal = _isLiveMode ? livePosArr.reduce((s, p) => s + Number(p.unrealizedPnl || 0), 0) : sim.unrealizedPnl;
  const dispRealized = _isLiveMode ? (dispTotal - dispUnreal) : sim.realizedPnl;
  const liveNoActivity = _isLiveMode && dispOpenCount === 0 && liveClosedArr.length === 0;
  const hasSimLeftover = _isLiveMode && (simPosArr.length > 0 || simClosedArr.length > 0 || Number(sim.simPnl || 0) !== 0);
  return (
    <div style={soft({ padding: 15, display: "flex", flexDirection: "column", gap: 13,
      // LIVE pilot → the whole trade panel gets a RED border so real money is unmistakable.
      border: `${panelLive ? 2 : 1}px solid ${panelLive ? C.loss : C.line}` })}>
      {/* REAL-MONEY banner — only for a LIVE pilot, so it's impossible to miss. */}
      {panelLive && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.loss, color: "#fff",
          borderRadius: 12, padding: "9px 12px", fontSize: 12.5, fontWeight: 900 }}>
          <Radio size={15} /> {he ? "מצב לייב · כסף אמיתי — מוצגים כאן רק פוזיציות ורווח/הפסד אמיתיים מרגע הפעלת הלייב." : "LIVE mode · REAL MONEY — only genuine live positions & P&L (since live was activated) are shown here."}
        </div>
      )}
      {/* OPEN POSITIONS lead — count + total P&L are clickable to verify. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 900, color: C.text }}>
          <ListTree size={16} color={C.gold} /> {he ? "פוזיציות פתוחות" : "Open positions"} ·{" "}
          <ExplainValue ex={exOpen(p, he)} he={he} rtl={rtl} color={C.text} style={{ fontSize: 14, fontWeight: 900 }}>{dispOpenCount}</ExplainValue>
        </span>
        <span style={{ fontSize: 9, fontWeight: 800, color: C.gain, background: `${C.gain}14`, border: `1px solid ${C.gain}44`, borderRadius: 999, padding: "1px 7px" }}>{he ? "מחירים חיים" : "LIVE prices"}</span>
        {panelLive ? <LiveBadge he={he} /> : <SimBadge he={he} />}
        <ExplainValue ex={exTotal(he)} he={he} rtl={rtl} color={pnlColor(dispTotal)}
          style={{ marginInlineStart: "auto", fontSize: 15, fontWeight: 900, fontVariantNumeric: "tabular-nums", direction: "ltr", opacity: 1 }}>{fmtSignedMoney(dispTotal)}</ExplainValue>
      </div>

      {/* Provenance line — mode-aware: live shows only REAL live activity; sim shows sim. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, color: C.faint }}>
        <CheckCircle2 size={12} color={C.gain} style={{ flexShrink: 0 }} />
        <span>{panelLive
          ? (he ? `מציג רק פעילות לייב אמיתית מרגע הפעלת הלייב (${fmtWhen(sim.liveStartedAt || sim.armedAt, he)}) — לא כולל את פוזיציות הסימולציה.`
                : `Showing only REAL live activity since live was activated (${fmtWhen(sim.liveStartedAt || sim.armedAt, he)}) — simulation positions are excluded.`)
          : (he ? `מציג רק עסקאות שנפתחו בסימולציה מרגע ההפעלה (${fmtWhen(sim.armedAt, he)}) — אין היסטוריה שהומצאה מראש.`
                : `Showing only positions opened in simulation from activation (${fmtWhen(sim.armedAt, he)}) forward — no pre-load history.`)}</span>
      </div>

      {/* VERIFY — full report + export (Dan's #1: check where the numbers came from). */}
      <button onClick={onOpenReport} className="tap44" style={{ ...btn(true), width: "100%", justifyContent: "center" }}>
        <FileSearch size={15} /> {he ? "דוח מלא · אימות וייצוא (CSV/PDF)" : "Full report · verify & export (CSV/PDF)"}
      </button>

      {/* Compact status — MODE-AWARE capital (Yoav #E47L/#ZXXG). Live shows the live cap +
          the REAL connected wallet balance (never the $1000 sim default); sim shows the sim
          capital (clickable to verify + editable). */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {panelLive ? (
          <>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 800,
              background: `${C.loss}12`, border: `1px solid ${C.loss}55`, borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>
              <span style={{ color: C.faint }}>{he ? "תקרת לייב" : "Live cap"}</span>{" "}
              <span style={{ color: C.loss, direction: "ltr", fontWeight: 900 }}>{fmtMoney(liveCapOf(sim))}</span>
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 800,
              background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>
              <Wallet size={11} color={C.gold} />
              <span style={{ color: C.faint }}>{he ? "ארנק" : "Wallet"}</span>{" "}
              <span style={{ color: C.text, direction: "ltr", fontWeight: 900, fontFamily: MONO }}>{walletUsd(balQ.data) != null ? fmtMoney(walletUsd(balQ.data)) : "…"}</span>
            </span>
          </>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 800,
            background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>
            <span style={{ color: C.faint }}>{he ? "הון" : "Capital"}</span>{" "}
            {/* value → verify explainer; pencil → tap-to-edit capital (same editor). */}
            <ExplainValue ex={exCapital(sim, he)} he={he} rtl={rtl} color={C.gold} style={{ direction: "ltr", fontWeight: 900 }}>{fmtMoney(sim.capital ?? sim.nav)}</ExplainValue>
            <EditCapitalControl p={p} sim={sim} he={he} rtl={rtl} pencilSize={12} />
          </span>
        )}
        <Chip2 label={he ? "טעון" : "Loaded"} value={fmtWhen(sim.armedAt, he)} />
        <Chip2 label={he ? "הרצה אחרונה" : "Last run"} value={fmtWhen(sim.lastRunAt, he)} />
        <Chip2 label={he ? "הבאה" : "Next"} value={fmtWhen(sim.nextRunAt, he)} />
      </div>

      {/* LIVE-WAITING state — live pilot with NO real live positions yet (e.g. master gate
          off → no real order ever placed). Honest: $0 real P&L, never the sim numbers. */}
      {liveNoActivity && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12, lineHeight: 1.55, color: C.text,
          background: `${C.loss}12`, border: `1px solid ${C.loss}66`, borderRadius: 12, padding: "10px 12px" }}>
          <Clock size={16} color={C.loss} style={{ flexShrink: 0, marginTop: 1 }} />
          <span><b>{he ? "לייב פעיל · אין עדיין פוזיציות אמיתיות · רווח/הפסד אמיתי $0.00" : "LIVE · no real positions yet · $0.00 real P&L"}</b>{" — "}
            {he ? "טרם בוצעו פקודות אמיתיות. ביצוע לייב מתבצע רק כשהמפעיל מפעיל אותו בשרת. רווח/ההפסד מהסימולציה מוצג בנפרד למטה ואינו כסף אמיתי."
                : "no real orders have executed. Live execution runs only when the operator enables it server-side. The pilot's simulation P&L is shown separately below and is NOT real money."}</span>
        </div>
      )}
      {/* SIM waiting — a simulation pilot loaded but nothing bought yet (no fabricated P&L). */}
      {!panelLive && sim.waiting && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12, lineHeight: 1.55, color: C.text,
          background: `${C.gold}12`, border: `1px solid ${C.gold}55`, borderRadius: 12, padding: "10px 12px" }}>
          <Clock size={16} color={C.gold} style={{ flexShrink: 0, marginTop: 1 }} />
          <span><b>{he ? "טעון · מצב אוטומטי · ממתין לקנייה ראשונה" : "Loaded · automatic mode · waiting for first buy"}</b>{" — "}
            {he ? "עדיין לא נקנה כלום. הטייס יקנה אוטומטית בסריקה/סיגנל הבאים — או לחצו \"הרץ עכשיו\" לקנייה מיידית (סימולציה)."
                : "nothing bought yet. The pilot buys automatically at the next scan/signal — or press \"Run now\" to buy immediately (simulation)."}</span>
        </div>
      )}

      {/* Open positions rows — symbol · buy time · current price · P&L (LIVE slice only for
          a live pilot; all sim positions for a sim pilot). */}
      {dispPositions.length === 0 ? (
        <div style={{ fontSize: 11.5, color: C.faint, padding: "4px 2px" }}>{panelLive ? (he ? "אין פוזיציות לייב אמיתיות כרגע." : "No real live positions right now.") : (he ? "אין פוזיציות פתוחות כרגע." : "No open positions right now.")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {dispPositions.map((pos: ApSimPosition, i: number) => {
            // LIVE positions (real Bybit fills) get a DISTINCT red-tinted card so they're
            // never mistaken for the neutral simulation rows.
            const posLive = (pos.mode || "simulation") === "live";
            return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, borderRadius: 10, padding: "8px 11px",
              background: posLive ? `${C.loss}12` : C.surface2, border: `1px solid ${posLive ? C.loss : C.line}` }}>
              <SideChip side={pos.side} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 900, color: C.text, direction: "ltr" }}>{pos.symbol}</span>
                  {posLive && <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 7.5, fontWeight: 900, color: "#fff", background: C.loss, borderRadius: 999, padding: "1px 5px" }}><Radio size={7} /> {he ? "לייב" : "LIVE"}</span>}
                </div>
                <div style={{ fontSize: 9.5, color: C.faint, fontWeight: 700 }}>
                  {he ? "זמן קנייה" : "bought"} {fmtWhen(pos.openedAt, he)} · {he ? "מחיר נוכחי" : "now"} <span style={{ direction: "ltr" }}>{fmtMoney(pos.lastPrice ?? pos.entryPrice)}</span>
                </div>
              </div>
              <span style={{ fontSize: 13, fontWeight: 900, color: pnlColor(pos.unrealizedPnl), fontVariantNumeric: "tabular-nums", direction: "ltr", flexShrink: 0 }}>{fmtSignedMoney(pos.unrealizedPnl)}</span>
            </div>
            );
          })}
        </div>
      )}

      {/* P&L cells — the LIVE slice for a live pilot ($0 with the gate off), sim otherwise. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <StatCellV label={he ? "ממומש" : "Realized"} value={fmtSignedMoney(dispRealized)} color={pnlColor(dispRealized)} ex={exRealized(sim, he)} />
        <StatCellV label={he ? "לא ממומש" : "Unrealized"} value={fmtSignedMoney(dispUnreal)} color={pnlColor(dispUnreal)} ex={exUnrealized(sim, he)} />
        <StatCellV label={he ? "סה״כ" : "Total"} value={fmtSignedMoney(dispTotal)} color={pnlColor(dispTotal)} ex={exTotal(he)} />
      </div>

      {/* Next / plan — the strategy's real logic + next run (no price predictions). */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11, lineHeight: 1.5, color: C.muted,
        background: `${C.blue}0e`, border: `1px solid ${C.blue}44`, borderRadius: 12, padding: "8px 11px" }}>
        <Bot size={14} color={C.blue} style={{ flexShrink: 0, marginTop: 1 }} />
        <span><b style={{ color: C.text }}>{he ? "התוכנית" : "Plan"}:</b> {planEntry} {he ? "הרצה הבאה" : "Next run"} {fmtWhen(sim.nextRunAt, he)}.</span>
      </div>

      {/* CLOSED history — the display slice (live-only for a live pilot). */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 900, color: C.text, marginBottom: 7, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <ListChecks size={14} color={C.gold} /> {he ? "היסטוריה — עסקאות סגורות" : "History — closed trades"} · {dispClosed.length}
        </div>
        {dispClosed.length === 0 ? (
          <div style={{ fontSize: 11.5, color: C.faint, padding: "4px 2px" }}>{panelLive ? (he ? "אין עדיין עסקאות לייב סגורות." : "No closed live trades yet.") : (he ? "אין עדיין עסקאות סגורות." : "No closed trades yet.")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {dispClosed.map((pos: ApSimPosition, i: number) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 11, padding: "5px 2px", borderBottom: i < dispClosed.length - 1 ? `1px solid ${C.line}` : "none" }}>
                <SideChip side={pos.side} />
                <span style={{ fontWeight: 800, color: C.text, direction: "ltr" }}>{pos.symbol}</span>
                <span style={{ color: C.faint, direction: "ltr", fontSize: 9.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fmtWhen(pos.openedAt, he)} → {fmtWhen(pos.closedAt, he)}</span>
                <span style={{ marginInlineStart: "auto", fontWeight: 900, color: pnlColor(pos.realizedPnl), direction: "ltr", flexShrink: 0 }}>{fmtSignedMoney(pos.realizedPnl)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SIMULATION (paper) subsection — a LIVE pilot's leftover sim positions/P&L, kept
          VISIBLE but clearly tagged NOT-real so they're never confused with live money. */}
      {hasSimLeftover && (
        <div style={{ border: `1px solid ${C.blue}55`, borderRadius: 12, background: `${C.blue}0a`, padding: "11px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <FlaskConical size={14} color={C.blue} />
            <span style={{ fontSize: 12, fontWeight: 900, color: C.text }}>{he ? "סימולציה (נייר) — לא כסף אמיתי" : "Simulation (paper) — not real money"}</span>
            <SimBadge he={he} />
            <span style={{ marginInlineStart: "auto", fontSize: 13, fontWeight: 900, color: pnlColor(Number(sim.simPnl || 0)), fontVariantNumeric: "tabular-nums", direction: "ltr" }}>{fmtSignedMoney(Number(sim.simPnl || 0))}</span>
          </div>
          <div style={{ fontSize: 10, color: C.faint, fontWeight: 700 }}>
            {he ? `${simPosArr.length} פוזיציות סימולציה פתוחות · ${simClosedArr.length} סגורות. אלו אינן כסף אמיתי ואינן נספרות ברווח הלייב.`
                : `${simPosArr.length} open sim position(s) · ${simClosedArr.length} closed. These are NOT real money and do not count toward the live P&L.`}
          </div>
        </div>
      )}

      {/* Compact simulated P&L journey — a SIMULATION artifact, so it's shown in sim mode only
          (in live mode it would mix sim numbers into the live view — Yoav #ZXXG). */}
      {!panelLive && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.faint, marginBottom: 6, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <LineChart size={13} color={C.gold} /> {he ? "מסע P&L (מהטעינה)" : "P&L journey (since load)"}
          </div>
          <SimEquityCurve points={sim.equityCurve} capital={sim.capital ?? sim.nav} he={he} />
        </div>
      )}

      {/* Honest mode label. */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 10, lineHeight: 1.45, color: C.faint }}>
        <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>{panelLive
          ? (he ? "מוצגים כאן רק נתוני לייב אמיתיים." : "Only real live data is shown here.")
          : bi(APPROX_LABEL, he)}{!hasScan ? (he ? " · ממתין לסריקה." : " · waiting for scan.") : ""}</span>
      </div>
    </div>
  );
}

// ── Info + history modal (behind the ⓘ) — the full explainer + FULL backtest chart ──
// Moved off the main pilot screen so the detail stays live-trading-first.
function PilotInfoModal({ p, he, rtl, sim, onClose }: { p: AutoPilot; he: boolean; rtl: boolean; sim?: ApSimPilot; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16, direction: rtl ? "rtl" : "ltr" }}>
      <div onClick={(e) => e.stopPropagation()} dir={rtl ? "rtl" : "ltr"} role="dialog" aria-modal="true" aria-label={bi(p.name, he)}
        style={{ width: "min(560px, 96vw)", maxHeight: "calc(100dvh - 32px)", overflowY: "auto", background: C.surface,
          border: `1px solid ${C.line}`, borderRadius: 18, boxShadow: "0 28px 80px rgba(0,0,0,0.6)", fontFamily: UI }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${C.line}`,
          background: `linear-gradient(135deg, ${C.gold}18, ${C.gold}08), ${C.surface}` }}>
          <Info size={18} color={C.gold} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 900, color: C.text }}>{he ? "מידע והיסטוריה" : "Info & history"}</div>
            <div style={{ fontSize: 10.5, color: C.faint }}>{bi(p.name, he)}</div>
          </div>
          <button onClick={onClose} aria-label={he ? "סגור" : "Close"} className="tap44"
            style={{ flexShrink: 0, background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={18} /></button>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* What it is & how it works */}
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 900, color: C.text }}>
              <Bot size={16} color={C.gold} /> {he ? "מה זה ואיך זה עובד" : "What it is & how it works"}
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: C.muted }}>{bi(p.description, he)}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {HOW_STEPS.map((st, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, display: "grid", placeItems: "center", background: `${C.gold}18`, border: `1px solid ${C.gold}44` }}>
                    <st.Icon size={14} color={C.gold} />
                  </div>
                  <span style={{ fontSize: 12.5, lineHeight: 1.5, color: C.text, paddingTop: 3 }}>{he ? st.he : st.en}</span>
                </div>
              ))}
            </div>
          </div>
          {/* How it operates automatically — cadence · %-sizing · manual controls (before load) */}
          <AutoOperationCard p={p} sim={sim} he={he} />
          {/* FULL backtest chart + KPIs + attribution + the verify/export report */}
          <div style={soft({ padding: 15 })}>
            <BacktestBlock p={p} he={he} rtl={rtl} sim={sim} />
          </div>
          {/* Risk */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12, lineHeight: 1.55, color: C.text,
            background: `${C.loss}12`, border: `1px solid ${C.loss}55`, borderRadius: 14, padding: "11px 13px" }}>
            <AlertTriangle size={16} color={C.loss} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{he
              ? "אזהרת סיכון: מסחר אלגוריתמי כרוך בסיכון מהותי, כולל אובדן מלא של ההון. תוצאות עבר (כולל בקטסט) אינן מבטיחות תוצאות עתידיות."
              : "Risk warning: algorithmic trading carries substantial risk, including total loss of capital. Past performance (including backtests) does not guarantee future results."}</span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ══ REAL-MONEY (Bybit) surface — heavily-safeguarded, GATED, owner-only ═════════════════
// NOTHING here places an order. It connects the owner's OWN keys, records GO-LIVE intent
// (multi-step confirm + cap), and offers the STOP-LIVE kill-switch. Real orders execute
// ONLY server-side, and ONLY when the operator's master gate is on (state.live.masterEnabled).

function LiveBadge({ he, small }: { he: boolean; small?: boolean }) {
  // COMPACT (small, e.g. in a dense pilot row) = just "LIVE" — the red already signals real
  // money, so the full "REAL MONEY" wording (which clipped the row) is dropped here. The full
  // label stays on the larger badges/banners where there's room.
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: small ? 2 : 4, fontSize: small ? 8.5 : 10, fontWeight: 900,
      color: "#fff", background: C.loss, borderRadius: 999, padding: small ? "1px 5px" : "2px 9px", whiteSpace: "nowrap",
      boxShadow: `0 0 0 1px ${C.loss}`, letterSpacing: "0.03em", flexShrink: 0 }}>
      <Radio size={small ? 8 : 11} /> {small ? (he ? "לייב" : "LIVE") : (he ? "לייב · כסף אמיתי" : "LIVE · REAL MONEY")}
    </span>
  );
}

// Every pilot's LIVE/DEMO classification badge — LIVE (real money, red) when the pilot is
// in live mode, else DEMO (simulation, blue). Shown on the row, card, and detail.
function ModeBadge({ live, he, small }: { live: boolean; he: boolean; small?: boolean }) {
  if (live) return <LiveBadge he={he} small={small} />;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: small ? 2 : 4, fontSize: small ? 8.5 : 10, fontWeight: 900,
      color: C.blue, background: `${C.blue}18`, border: `1px solid ${C.blue}66`, borderRadius: 999,
      padding: small ? "1px 5px" : "2px 9px", whiteSpace: "nowrap", letterSpacing: "0.03em", flexShrink: 0 }}>
      <FlaskConical size={small ? 8 : 11} /> {small ? (he ? "דמו" : "DEMO") : (he ? "דמו · סימולציה" : "DEMO · SIM")}
    </span>
  );
}

// Display name for whichever exchange the owner connected (Bybit or Binance). The live path
// supports both (spot · long-only) — this keeps the real-money copy accurate for each.
const exLabelOf = (b?: { exchange?: string } | null): string => (b?.exchange === "binance" ? "Binance" : "Bybit");

// Connect / manage the owner's OWN exchange keys — Bybit or Binance (encrypted server-side; never shown after save).
function BybitConnectModal({ he, rtl, bybit, onApplyState, onClose }: {
  he: boolean; rtl: boolean; bybit?: ApBybitStatus; onApplyState: (s: ApSimState) => void; onClose: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [environment, setEnvironment] = useState<"testnet" | "live">((bybit?.environment as any) || "testnet");
  // Which exchange the owner is connecting — Bybit or Binance (both spot · long-only). Additive:
  // the whole safety framework (master gate, go-live confirm, caps) is identical for both.
  const [exchange, setExchange] = useState<"bybit" | "binance">((bybit?.exchange as any) || "bybit");
  const exName = exchange === "binance" ? "Binance" : "Bybit";
  const [busy, setBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [balance, setBalance] = useState<ApBybitBalance | null>(null);
  const [balLoading, setBalLoading] = useState(false);
  const connected = !!bybit?.connected;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  // READ-ONLY wallet balance (fetch_balance) — shown when connected. No trading.
  const loadBalance = async () => {
    setBalLoading(true);
    try { setBalance(await api.autopilotBalance()); } catch { setBalance(null); } finally { setBalLoading(false); }
  };
  useEffect(() => { if (connected) loadBalance(); else setBalance(null); }, [connected]);
  const refresh = async () => { const s = await api.autopilotsState(); onApplyState(s as any); };
  const connect = async () => {
    // M7 (legacy retirement): the exchange key must NEVER be POSTed to StrateTeach. Key custody +
    // execution live only in Praxis (browser → Praxis Vault). Do NOT transmit the key here — wipe
    // whatever was typed and send the user to the secure Praxis connect flow. The backend also 410s
    // /autopilots/keys, but the real fix is to never let the key leave the browser toward StrateTeach.
    setApiKey(""); setApiSecret("");
    alert(he
      ? "חיבור מפתחות עבר למסלול המאובטח של Praxis — המפתח נשלח ישירות לכספת ולא עובר דרך StrateTeach."
      : "Key connection has moved to the secure Praxis flow — your key goes straight to the vault and never through StrateTeach.");
    window.location.assign("/praxis-connect");
  };
  const test = async () => {
    setBusy(true); setTestMsg(null);
    try { const r = await api.autopilotTestKeys(); setTestMsg({ ok: !!r.ok, text: r.message || "" }); await refresh(); await loadBalance(); }
    catch (e: any) { setTestMsg({ ok: false, text: String(e?.message || e) }); } finally { setBusy(false); }
  };
  const disconnect = async () => {
    if (!confirm(he ? `לנתק את מפתחות ה-${exName}? כל הטייסים יחזרו לסימולציה.` : `Disconnect ${exName} keys? All pilots return to simulation.`)) return;
    setBusy(true);
    try { await api.autopilotDisconnectKeys(); await refresh(); track("autopilot_keys_disconnected", {}); }
    catch (e: any) { alert(String(e?.message || e)); } finally { setBusy(false); }
  };
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 5, display: "block" };
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16, direction: rtl ? "rtl" : "ltr" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" dir={rtl ? "rtl" : "ltr"}
        style={{ width: "min(500px, 96vw)", maxHeight: "calc(100dvh - 32px)", overflowY: "auto", background: C.surface,
          border: `1.5px solid ${C.gold}`, borderRadius: 18, boxShadow: "0 28px 80px rgba(0,0,0,0.6)", fontFamily: UI }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${C.line}`,
          background: `linear-gradient(135deg, ${C.gold}18, ${C.gold}08), ${C.surface}` }}>
          <KeyRound size={18} color={C.gold} />
          <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 900, color: C.text }}>{he ? `חיבור ${exName} (כסף אמיתי)` : `Connect ${exName} (real money)`}</div>
          <button onClick={onClose} aria-label={he ? "סגור" : "Close"} className="tap44" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={18} /></button>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 13 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, lineHeight: 1.55, color: C.text,
            background: `${C.loss}12`, border: `1px solid ${C.loss}55`, borderRadius: 10, padding: "10px 12px" }}>
            <ShieldAlert size={15} color={C.loss} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{he ? "השתמשו במפתח ייעודי למסחר-בלבד עם משיכות מושבתות (רצוי תת-חשבון נפרד). המפתחות נשמרים מוצפנים בשרת, לעולם לא מוצגים שוב ולא נרשמים בלוגים."
                     : "Use a dedicated TRADE-ONLY key with withdrawals DISABLED (ideally a separate sub-account). Keys are stored encrypted server-side, never shown again, never logged."}</span>
          </div>
          {connected && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, fontWeight: 800 }}>
                <CheckCircle2 size={15} color={C.gain} />
                <span style={{ color: C.text }}>{he ? "מחובר" : "Connected"}</span>
                <span style={{ fontSize: 9, fontWeight: 900, color: C.gold, background: `${C.gold}1e`, borderRadius: 999, padding: "2px 8px", textTransform: "uppercase" }}>
                  {(bybit?.exchange === "binance") ? "Binance" : "Bybit"}
                </span>
                <span style={{ color: C.faint, fontFamily: "ui-monospace, monospace" }}>{bybit?.keyHint}</span>
                <span style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 900,
                  color: bybit?.environment === "live" ? C.loss : C.blue, background: `${bybit?.environment === "live" ? C.loss : C.blue}18`, borderRadius: 999, padding: "2px 8px" }}>
                  {bybit?.environment === "live" ? (he ? "רשת אמיתית" : "MAINNET") : (he ? "טסטנט" : "TESTNET")}
                </span>
              </div>
              {/* READ-ONLY wallet balance (fetch_balance) — no trading. */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
                <Wallet size={14} color={C.gold} />
                <span style={{ fontSize: 11.5, fontWeight: 800, color: C.muted }}>{he ? "יתרת ארנק" : "Wallet balance"}</span>
                <span style={{ marginInlineStart: "auto", fontSize: 14, fontWeight: 900, color: C.text, fontFamily: MONO, direction: "ltr" }}>
                  {balLoading ? "…" : (balance?.ok ? fmtMoney(balance.totalUsd) : "—")}
                </span>
                <button onClick={loadBalance} disabled={balLoading} aria-label={he ? "רענן יתרה" : "Refresh balance"} className="tap44"
                  style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", padding: 2 }}>
                  <RefreshCw size={12} className={balLoading ? "spin" : ""} />
                </button>
              </div>
              {balance?.ok && (balance.freeUsdt ?? 0) > 0 && (
                <div style={{ fontSize: 9.5, color: C.faint, fontWeight: 700 }}>{he ? "USDT פנוי" : "Free USDT"}: {fmtMoney(balance.freeUsdt)} · {he ? "קריאה בלבד" : "read-only"}</div>
              )}
              {balance && balance.ok === false && (
                <div style={{ fontSize: 10, color: C.loss, fontWeight: 700 }}>{balance.message || (he ? "טעינת יתרה נכשלה" : "Balance load failed")}</div>
              )}
            </div>
          )}
          <div>
            <label style={lbl}>{he ? "בורסה" : "Exchange"}</label>
            <div style={{ display: "flex", gap: 8 }}>
              {(["bybit", "binance"] as const).map((exg) => (
                <button key={exg} onClick={() => setExchange(exg)} className="tap44"
                  style={{ flex: 1, justifyContent: "center", ...btn(exchange === exg) }}>
                  {exg === "bybit" ? "Bybit" : "Binance"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={lbl}>{he ? `מפתח API (${exName})` : `${exName} API key`}</label>
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} dir="ltr" autoComplete="off" spellCheck={false}
              placeholder={connected ? (he ? "החלף מפתח…" : "replace key…") : "API key"} style={{ ...input, width: "100%", boxSizing: "border-box", fontFamily: "ui-monospace, monospace" }} />
          </div>
          <div>
            <label style={lbl}>{he ? "סוד API" : "API secret"}</label>
            <input value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} dir="ltr" type="password" autoComplete="off" spellCheck={false}
              placeholder="API secret" style={{ ...input, width: "100%", boxSizing: "border-box", fontFamily: "ui-monospace, monospace" }} />
          </div>
          <div>
            <label style={lbl}>{he ? "סביבה" : "Environment"}</label>
            <div style={{ display: "flex", gap: 8 }}>
              {(["testnet", "live"] as const).map((env) => (
                <button key={env} onClick={() => setEnvironment(env)} className="tap44"
                  style={{ flex: 1, justifyContent: "center", ...btn(environment === env),
                    ...(env === "live" && environment === "live" ? { background: C.loss, borderColor: C.loss, color: "#fff" } : {}) }}>
                  {env === "testnet" ? (he ? "טסטנט (מומלץ להתחלה)" : "Testnet (recommended)") : (he ? "רשת אמיתית" : "Mainnet (real)")}
                </button>
              ))}
            </div>
          </div>
          {testMsg && (
            <div style={{ fontSize: 12, fontWeight: 700, color: testMsg.ok ? C.gain : C.loss }}>
              {testMsg.ok ? "✓ " : "✕ "}{testMsg.text}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={connect} disabled={busy || !apiKey.trim() || !apiSecret.trim()} className="tap44"
              style={{ ...btn(true), flex: 1, minWidth: 150, justifyContent: "center", opacity: (busy || !apiKey.trim() || !apiSecret.trim()) ? 0.6 : 1 }}>
              {busy ? <Loader2 size={15} className="spin" /> : <PlugZap size={15} />} {connected ? (he ? "עדכן מפתחות" : "Update keys") : (he ? "חבר מפתחות" : "Connect keys")}
            </button>
            {connected && <button onClick={test} disabled={busy} className="tap44" style={{ ...btn(), justifyContent: "center" }}><RefreshCw size={14} /> {he ? "בדיקה" : "Test"}</button>}
            {connected && <button onClick={disconnect} disabled={busy} className="tap44" style={{ ...btn(), color: C.loss, borderColor: `${C.loss}66`, justifyContent: "center" }}><X size={14} /> {he ? "נתק" : "Disconnect"}</button>}
          </div>
        </div>
      </div>
    </div>, document.body);
}

// GO-LIVE multi-step confirm: keys required · risk disclosure · typed phrase · mandatory
// low cap · real-money ack. Records intent only — the server master gate still governs orders.
function GoLiveModal({ p, sim, he, rtl, bybit, live, onApplyState, onNeedKeys, onClose }: {
  p: AutoPilot; sim: ApSimPilot; he: boolean; rtl: boolean; bybit?: ApBybitStatus; live?: ApLiveInfo;
  onApplyState: (s: ApSimState) => void; onNeedKeys: () => void; onClose: () => void;
}) {
  const capMin = live?.capMin ?? 10, capMax = live?.capMax ?? 250;
  const exName = exLabelOf(bybit);
  const phrase = live?.goLivePhrase ?? "GO LIVE";
  const riskCopy = useLegalCopy().get("risk", he);   // live, Raz-editable risk disclosure (Block B)
  const [cap, setCap] = useState(String(capMin));
  const [typed, setTyped] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const connected = !!bybit?.connected;
  const capNum = Number(cap);
  const capOk = capNum >= capMin && capNum <= capMax;
  const valid = connected && capOk && typed.trim().toUpperCase() === phrase && ack;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const go = async () => {
    if (!valid) {
      // A limit/precondition blocked the action — record WHY (aggregate safety KPI).
      ev.blockedActionSeen("go_live", !connected ? "no_keys" : !capOk ? "cap_out_of_range" : "confirm_incomplete");
      return;
    }
    if (busy) return;                                        // duplicate-submit guard
    setBusy(true);
    try {
      const s = await api.autopilotGoLive({ pilotId: p.id, cap: capNum, confirm: typed.trim(), ackReal: ack });
      onApplyState(s as any); track("autopilot_go_live", { pilot: p.id, cap: capNum });
      onClose();
    } catch (e: any) { ev.blockedActionSeen("go_live", "rejected"); alert(he ? `הפעלת לייב נכשלה: ${e?.message || e}` : `Go-live failed: ${e?.message || e}`); }
    finally { setBusy(false); }
  };
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 5, display: "block" };
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16, direction: rtl ? "rtl" : "ltr" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" dir={rtl ? "rtl" : "ltr"}
        style={{ width: "min(520px, 96vw)", maxHeight: "calc(100dvh - 32px)", overflowY: "auto", background: C.surface,
          border: `2px solid ${C.loss}`, borderRadius: 18, boxShadow: "0 28px 80px rgba(0,0,0,0.65)", fontFamily: UI }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${C.line}`,
          background: `linear-gradient(135deg, ${C.loss}22, ${C.loss}0c), ${C.surface}` }}>
          <ShieldAlert size={19} color={C.loss} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 900, color: C.text }}>{he ? "מעבר ללייב · כסף אמיתי" : "Go live · real money"}</div>
            <div style={{ fontSize: 10.5, color: C.faint }}>{bi(p.name, he)} · {p.id}</div>
          </div>
          <button onClick={onClose} aria-label={he ? "סגור" : "Close"} className="tap44" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={18} /></button>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 13 }}>
          {/* Risk disclosure */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12.5, lineHeight: 1.6, color: C.text,
            background: `${C.loss}12`, border: `1px solid ${C.loss}55`, borderRadius: 12, padding: "11px 13px" }}>
            <AlertTriangle size={16} color={C.loss} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{he ? `מרגע זה הטייס יבצע פקודות אמיתיות בחשבון ה-${exName} שלך עם הכסף שלך. מסחר אלגוריתמי כרוך בסיכון מהותי כולל אובדן מלא של ההון. v1 מבצע ספוט לונג בלבד, מוגבל לתקרת ההון שתגדיר.`
                     : `From now the pilot will place REAL orders on your ${exName} account with your own money. Algorithmic trading carries substantial risk including total loss of capital. v1 is SPOT LONG-ONLY, capped to the starting capital you set.`}</span>
          </div>
          {/* Standardized commitment risk disclosure (Block B · live, Raz-editable) — same
              wording shown before every commitment point (plan / unlock / go-live). */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: C.text }}>{he ? "גילוי סיכונים" : "Risk disclosure"}</span>
              {!riskCopy.approved && <DraftBadge item="risk" he={he} />}
            </div>
            <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.55 }}>{riskCopy.text}</div>
          </div>
          {/* Keys prerequisite */}
          {!connected ? (
            <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12, fontWeight: 700, color: C.text,
              background: `${C.gold}12`, border: `1px solid ${C.gold}55`, borderRadius: 10, padding: "10px 12px" }}>
              <KeyRound size={15} color={C.gold} />
              <span style={{ flex: 1 }}>{he ? `צריך לחבר מפתחות ${exName} קודם.` : `Connect your ${exName} keys first.`}</span>
              <button onClick={onNeedKeys} className="tap44" style={{ ...btn(true), padding: "6px 12px" }}>{he ? "חבר" : "Connect"}</button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, fontWeight: 800, color: C.muted }}>
              <CheckCircle2 size={14} color={C.gain} /> {he ? `מחובר ל-${exName}` : `${exName} connected`} · <span style={{ fontFamily: "ui-monospace, monospace" }}>{bybit?.keyHint}</span>
              · {bybit?.environment === "live" ? (he ? "רשת אמיתית" : "MAINNET") : (he ? "טסטנט" : "TESTNET")}
            </div>
          )}
          {/* Mandatory cap */}
          <div>
            <label style={lbl}>{he ? `תקרת הון להרצה הראשונה (USD) · חובה · ${capMin}–${capMax}` : `Starting-capital cap for the first live run (USD) · required · ${capMin}–${capMax}`}</label>
            <input value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" dir="ltr"
              style={{ ...input, width: "100%", boxSizing: "border-box", fontFamily: UI, borderColor: capOk ? C.gain : C.line }} />
            {!capOk && cap !== "" && <div style={{ fontSize: 10.5, color: C.loss, marginTop: 4 }}>{he ? `הזן ערך בין ${capMin} ל-${capMax}.` : `Enter a value between ${capMin} and ${capMax}.`}</div>}
            <div style={{ fontSize: 10.5, color: C.faint, marginTop: 4 }}>{he ? `הטייס לעולם לא יפרוס יותר מ-$${capNum || 0} סה״כ. גודל לעסקה: ${sim.perTradePct}% מהתקרה.` : `The pilot will never deploy more than $${capNum || 0} total. Per-trade size: ${sim.perTradePct}% of the cap.`}</div>
          </div>
          {/* Typed phrase */}
          <div>
            <label style={lbl}>{he ? `הקלד "${phrase}" לאישור` : `Type "${phrase}" to confirm`}</label>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} dir="ltr" autoCapitalize="characters" spellCheck={false}
              placeholder={phrase} style={{ ...input, width: "100%", boxSizing: "border-box", fontFamily: "ui-monospace, monospace", letterSpacing: "0.15em",
                borderColor: typed.trim().toUpperCase() === phrase ? C.gain : C.line }} />
          </div>
          {/* Ack */}
          <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer", fontSize: 12.5, lineHeight: 1.5, color: C.text }}>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: 2, width: 17, height: 17, accentColor: C.loss, flexShrink: 0 }} />
            <span>{he ? `אני מאשר/ת ביצוע פקודות בכסף אמיתי בחשבון ה-${exName} שלי, ומבין/ה שאני עלול/ה להפסיד כסף.` : `I approve real-money orders on my ${exName} account, and understand I may lose money.`}</span>
          </label>
          {/* Master-gate honesty notice */}
          {!live?.masterEnabled && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11.5, lineHeight: 1.5, color: C.text,
              background: `${C.blue}0e`, border: `1px solid ${C.blue}55`, borderRadius: 10, padding: "9px 12px" }}>
              <Info size={14} color={C.blue} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{he ? "כרגע ביצוע לייב מושבת בשרת. המעבר ללייב נרשם, אך שום פקודה לא תבוצע עד שהמפעיל יפעיל ביצוע לייב." : "Server live-execution is currently DISABLED. Going live records your intent, but no order will execute until the operator enables live execution."}</span>
            </div>
          )}
          <button onClick={go} disabled={!valid || busy} className="tap44"
            style={{ width: "100%", justifyContent: "center", display: "inline-flex", alignItems: "center", gap: 8,
              background: valid ? C.loss : C.surface2, color: valid ? "#fff" : C.faint, border: `1px solid ${valid ? C.loss : C.line}`,
              borderRadius: 12, padding: "12px 16px", fontSize: 14, fontWeight: 900, cursor: valid ? "pointer" : "not-allowed", fontFamily: UI }}>
            {busy ? <Loader2 size={16} className="spin" /> : <Radio size={16} />} {he ? "הפעל לייב · כסף אמיתי" : "GO LIVE · real money"}
          </button>
        </div>
      </div>
    </div>, document.body);
}

// The per-pilot real-money control card in the detail view (connect · go-live · kill-switch).
function LiveControlPanel({ p, sim, he, rtl, bybit, live, onApplyState }: {
  p: AutoPilot; sim: ApSimPilot; he: boolean; rtl: boolean; bybit?: ApBybitStatus; live?: ApLiveInfo;
  onApplyState: (s: ApSimState) => void;
}) {
  const [connect, setConnect] = useState(false);
  const [goLive, setGoLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState<ApBybitBalance | null>(null);
  const isLive = (sim.mode || "simulation") === "live";
  const exName = exLabelOf(bybit);
  // READ-ONLY wallet balance on a LIVE pilot (fetch_balance only — no trading).
  useEffect(() => {
    let alive = true;
    if (isLive && bybit?.connected) {
      api.autopilotBalance().then((b) => { if (alive) setBalance(b); }).catch(() => { if (alive) setBalance(null); });
    } else setBalance(null);
    return () => { alive = false; };
  }, [isLive, bybit?.connected]);
  const stop = async () => {
    if (!confirm(he ? "לעצור לייב מיד? הטייס יחזור לסימולציה ולא ייפתחו פקודות חדשות." : "Stop live now? The pilot returns to simulation; no new orders open.")) return;
    setBusy(true);
    try { const s = await api.autopilotStopLive(p.id); onApplyState(s as any); track("autopilot_stop_live", { pilot: p.id }); }
    catch (e: any) { alert(String(e?.message || e)); } finally { setBusy(false); }
  };
  return (
    <div style={{ border: `1.5px solid ${isLive ? C.loss : C.line}`, borderRadius: 16, overflow: "hidden",
      background: isLive ? `${C.loss}0a` : C.surface }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderBottom: `1px solid ${C.line}`,
        background: isLive ? `${C.loss}14` : C.surface2 }}>
        <Radio size={15} color={isLive ? C.loss : C.gold} />
        <span style={{ fontSize: 13, fontWeight: 900, color: C.text }}>{he ? `כסף אמיתי · ${exName}` : `Real money · ${exName}`}</span>
        {isLive ? <LiveBadge he={he} /> : <SimBadge he={he} />}
        <span style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 800,
          color: C.faint }}><Lock size={10} /> {he ? "בעלים בלבד" : "Owners only"}</span>
      </div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 11 }}>
        {isLive ? (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12, lineHeight: 1.55, color: C.text,
              background: `${C.loss}12`, border: `1px solid ${C.loss}55`, borderRadius: 12, padding: "11px 13px" }}>
              <AlertTriangle size={16} color={C.loss} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{he ? <><b>הטייס במצב לייב.</b> פקודות אמיתיות עד תקרת הון של <b>{fmtMoney(sim.liveCap)}</b>. ספוט לונג בלבד.</>
                       : <><b>Pilot is LIVE.</b> Real orders up to a <b>{fmtMoney(sim.liveCap)}</b> capital cap. Spot long-only.</>}
                {" "}{live?.masterEnabled
                  ? (he ? "ביצוע לייב פעיל בשרת." : "Server live-execution is ON.")
                  : (he ? "ביצוע לייב מושבת בשרת — ממתין להפעלת המפעיל (לא בוצעו פקודות)." : "Server live-execution is OFF — pending operator activation (no orders placed).")}</span>
            </div>
            {/* READ-ONLY exchange wallet balance on the live pilot. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 12px" }}>
              <Wallet size={14} color={C.gold} />
              <span style={{ fontSize: 11.5, fontWeight: 800, color: C.muted }}>{he ? `יתרת ארנק ${exName}` : `${exName} wallet`}</span>
              <span style={{ marginInlineStart: "auto", fontSize: 14, fontWeight: 900, color: C.text, fontFamily: MONO, direction: "ltr" }}>
                {balance?.ok ? fmtMoney(balance.totalUsd) : "…"}
              </span>
              {balance?.environment && (
                <span style={{ fontSize: 8.5, fontWeight: 900, color: balance.environment === "live" ? C.loss : C.blue,
                  background: `${balance.environment === "live" ? C.loss : C.blue}18`, borderRadius: 999, padding: "2px 7px" }}>
                  {balance.environment === "live" ? (he ? "רשת אמיתית" : "MAINNET") : (he ? "טסטנט" : "TESTNET")}
                </span>
              )}
            </div>
            {/* KILL-SWITCH — big, prominent, one tap. */}
            <button onClick={stop} disabled={busy} className="tap44"
              style={{ width: "100%", justifyContent: "center", display: "inline-flex", alignItems: "center", gap: 9,
                background: C.loss, color: "#fff", border: "none", borderRadius: 14, padding: "14px 16px", fontSize: 15, fontWeight: 900,
                cursor: "pointer", fontFamily: UI, boxShadow: `0 10px 26px -14px ${C.loss}` }}>
              {busy ? <Loader2 size={18} className="spin" /> : <Power size={18} />} {he ? "עצור לייב · חזרה לסימולציה" : "STOP LIVE · back to simulation"}
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, lineHeight: 1.55, color: C.muted }}>
              {he ? `החיבור ללייב מריץ את הטייס עם כסף אמיתי בחשבון ה-${exName} שלך — עם תקרת הון נמוכה שתגדיר, אישור רב-שלבי, ומתג עצירה. סימולציה נשארת ברירת המחדל.`
                  : `Going live runs this pilot with real money on your ${exName} account — with a low capital cap you set, a multi-step confirm, and a kill-switch. Simulation stays the default.`}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, fontWeight: 800, color: C.muted, flexWrap: "wrap" }}>
              <KeyRound size={13} color={bybit?.connected ? C.gain : C.faint} />
              {bybit?.connected
                ? <span style={{ color: C.text }}>{he ? `${exName} מחובר` : `${exName} connected`} · <span style={{ fontFamily: "ui-monospace, monospace", color: C.faint }}>{bybit.keyHint}</span> · {bybit.environment === "live" ? (he ? "רשת אמיתית" : "MAINNET") : (he ? "טסטנט" : "TESTNET")}</span>
                : <span style={{ color: C.faint }}>{he ? "אין מפתחות בורסה" : "No exchange keys"}</span>}
              <button onClick={() => setConnect(true)} className="tap44" style={{ marginInlineStart: "auto", ...btn(), padding: "6px 12px" }}>
                <KeyRound size={13} /> {bybit?.connected ? (he ? "נהל מפתחות" : "Manage keys") : (he ? "חבר בורסה" : "Connect exchange")}
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
              <button onClick={() => (bybit?.connected ? setGoLive(true) : setConnect(true))} className="tap44"
                style={{ flex: 1, justifyContent: "center", display: "inline-flex", alignItems: "center", gap: 8,
                  background: "transparent", color: C.loss, border: `1.5px solid ${C.loss}77`, borderRadius: 12, padding: "11px 16px",
                  fontSize: 13.5, fontWeight: 900, cursor: "pointer", fontFamily: UI }}>
                <Radio size={15} /> {he ? "מעבר ללייב (כסף אמיתי)…" : "Go live with real money…"}
              </button>
              <InfoTip he={he} rtl={rtl} title={he ? "מעבר ללייב" : "Go live"}
                lines={[he ? `מעביר את הטייס מסימולציה לכסף אמיתי בבורסת ${exName} המחוברת.` : `Switches the pilot from simulation to real money on the connected ${exName} exchange.`,
                        he ? `מוגן במספר שערים: מפתחות ${exName} + שער-אב כללי + ביטוי-אישור מפורש. עד שכל אלה נפתחים — לא נשלחת אף פקודה אמיתית.` : `Guarded by several gates: ${exName} keys + a master switch + an explicit confirm phrase. Until all are open, no real order is sent.`,
                        he ? "אחרי הפעלה, כל הרצה עדיין דורשת אישור פקודות לפני ביצוע." : "Even after enabling, every run still requires approving the orders before they execute."]} />
            </div>
          </>
        )}
      </div>
      {connect && <BybitConnectModal he={he} rtl={rtl} bybit={bybit} onApplyState={onApplyState} onClose={() => setConnect(false)} />}
      {goLive && <GoLiveModal p={p} sim={sim} he={he} rtl={rtl} bybit={bybit} live={live} onApplyState={onApplyState}
        onNeedKeys={() => { setGoLive(false); setConnect(true); }} onClose={() => setGoLive(false)} />}
    </div>
  );
}

// ── LIVE status explainer (Yoav #1A4X) — a plain-language "what happens now" card shown on
// a pilot the owner just took live. Answers the exact questions Yoav raised: when the next
// run is, that it scans on the daily schedule AND on-demand via "Run now", that a signal
// PROPOSES a trade for the owner's approval (it does NOT auto-execute), and that the owner
// does NOT need to keep pressing "Run now". Read-only / display copy only.
function LiveStatusExplainer({ p, sim, he, live }: { p: AutoPilot; sim: ApSimPilot; he: boolean; live?: ApLiveInfo }) {
  const balQ = useApBalance(true);
  const wallet = walletUsd(balQ.data);
  const masterOn = !!live?.masterEnabled;
  const Line = ({ Icon, title, body }: { Icon: any; title: string; body: string }) => (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <div style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, display: "grid", placeItems: "center", background: `${C.loss}14`, border: `1px solid ${C.loss}44` }}>
        <Icon size={13} color={C.loss} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: C.text, marginBottom: 1 }}>{title}</div>
        <div style={{ fontSize: 11.5, lineHeight: 1.5, color: C.muted }}>{body}</div>
      </div>
    </div>
  );
  return (
    <div style={{ border: `1.5px solid ${C.loss}66`, background: `${C.loss}0a`, borderRadius: 14, padding: 13, display: "flex", flexDirection: "column", gap: 11 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Radio size={15} color={C.loss} />
        <span style={{ fontSize: 13, fontWeight: 900, color: C.text }}>{he ? "מה קורה עכשיו · לייב" : "What's happening now · Live"}</span>
        <LiveBadge he={he} />
        <span style={{ marginInlineStart: "auto", fontSize: 10.5, fontWeight: 800, color: C.muted }}>
          {he ? "תקרת לייב" : "Live cap"} <b style={{ color: C.loss }}>{fmtMoney(liveCapOf(sim))}</b>
          {wallet != null ? <> · {he ? "ארנק" : "wallet"} <b style={{ color: C.text }}>{fmtMoney(wallet)}</b></> : null}
        </span>
      </div>
      <Line Icon={Clock} title={he ? "מתי הטייס רץ" : "When the pilot runs"}
        body={he ? `הטייס סורק אוטומטית פעם ביום ב-00:10 UTC. הרצה הבאה: ${fmtWhen(sim.nextRunAt, he)}. אפשר גם ללחוץ "הרץ עכשיו" לבדיקה מיידית — אבל אין צורך לחזור וללחוץ; הוא ימשיך לסרוק לבד לפי הלו״ז.`
                 : `The pilot scans automatically once a day at 00:10 UTC. Next run: ${fmtWhen(sim.nextRunAt, he)}. You can also press "Run now" for an immediate check — but you don't need to keep pressing it; it keeps scanning on its own schedule.`} />
      <Line Icon={ListChecks} title={he ? "מה קורה כשמופיע סיגנל" : "What happens when a signal appears"}
        body={he ? "כשהסריקה מוצאת מועמד, הטייס מציג לך תוכנית עסקאות מוצעות לאישור. שום דבר לא מבוצע עד שתאשר — הטייס לעולם אינו קונה או מוכר מעצמו."
                 : "When the scan finds a candidate, the pilot shows you a plan of PROPOSED trades to approve. Nothing executes until you approve — the pilot never buys or sells on its own."} />
      <Line Icon={ShieldCheck} title={he ? "אם לא הוצעו עסקאות" : "If no trades were offered"}
        body={he ? "זה תקין — פשוט אין כרגע פריצה טרייה שעומדת בכללי הטייס (או שגודל העסקה נמוך מהמינימום). לא צריך לעשות דבר; בהרצה הבאה הטייס יבדוק שוב."
                 : "That's normal — there simply isn't a fresh breakout that meets the pilot's rules right now (or the per-trade size is below the exchange minimum). You don't need to do anything; the pilot checks again on the next run."} />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 10.5, lineHeight: 1.45, color: C.faint, borderTop: `1px solid ${C.line}`, paddingTop: 9 }}>
        <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>{masterOn
          ? (he ? "ביצוע לייב פעיל בשרת — עסקאות שתאשר יבוצעו בפועל." : "Server live-execution is ON — trades you approve will actually execute.")
          : (he ? "ביצוע לייב מושבת בשרת כרגע — גם עסקאות שתאשר לא יבוצעו עד שהמפעיל יפעיל את הביצוע." : "Server live-execution is currently OFF — even trades you approve won't execute until the operator enables it.")}</span>
      </div>
    </div>
  );
}

// ── Pilot DETAIL view — LIVE-TRADING FIRST. Open positions + closed history lead; the
// educational explainer + FULL backtest chart live behind the ⓘ info icon. Only a single
// compact one-line backtest summary stays inline.
function PilotDetail({ p, he, rtl, sim, hasScan, running, bybit, live, canManage, onApplyState, onBack, onArm, onDisarm, onRun }: {
  p: AutoPilot; he: boolean; rtl: boolean; sim?: ApSimPilot; hasScan: boolean; running: boolean;
  bybit?: ApBybitStatus; live?: ApLiveInfo; canManage: boolean; onApplyState: (s: ApSimState) => void;
  onBack: () => void; onArm: () => void; onDisarm: () => void; onRun: () => void;
}) {
  const Icon = ICON[p.icon] || Activity;
  const dir = DIRECTION_META[p.direction];
  const Back = rtl ? ArrowRight : ArrowLeft;
  const [info, setInfo] = useState(false);
  const [report, setReport] = useState(false);
  useEffect(() => {
    track("autopilot_detail_opened", { pilot: p.id });
    // Canonical: autopilot_viewed { pilot_no } — the pilot's 1-based position (1..5).
    ev.autopilotViewed(AUTOPILOTS.findIndex((x) => x.id === p.id) + 1);
  }, [p.id]);

  // DR Crypto: the MAIN pilot screen shows a risk-mode selector; the headline reflects the SELECTED
  // mode (return + drawdown together). Shared with the report modal via useDrModes.
  const isDR = p.id === "DR-Crypto-Trend";
  const dm = useDrModes(isDR);
  const am = isDR ? dm.activeMode : undefined;
  const kNet = am ? am.net_pct : p.backtest.pnlPct;
  const kDd = am ? am.maxdd_pct : p.backtest.maxDrawdown;
  const kPf = am ? am.pf : p.validated.profitFactor;
  const kTr = am ? am.trades : p.backtest.trades;
  const backtestLine = `${bi(SELF_VALIDATED_LABEL, he)} · ${fmtPnl(kNet)} · DD ${fmtDd(Math.abs(kDd))} · PF ${kPf.toFixed(2)} · ${kTr.toLocaleString("en-US")} ${he ? "עסקאות" : "trades"}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, direction: rtl ? "rtl" : "ltr" }}>
      <button onClick={onBack} className="tap44"
        style={{ ...btn(), alignSelf: rtl ? "flex-end" : "flex-start", justifyContent: "center" }}>
        <Back size={15} /> {he ? "חזרה לכל הטייסים" : "Back to all pilots"}
      </button>

      {/* Compact header — name + id + badges + ⓘ info icon + ONE-LINE backtest. */}
      <div style={glass({ display: "flex", flexDirection: "column", gap: 10 })}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <PilotEmblem p={p} size={44} radius={13} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
              <span style={{ fontSize: 15.5, fontWeight: 900, color: C.text, lineHeight: 1.15, letterSpacing: "-0.01em" }}><PilotName p={p} he={he} size={15} /></span>
              {p.premium && <PremiumBadge he={he} />}
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, marginBottom: 7, fontFamily: "ui-monospace, monospace" }}>{p.id}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
              {/* LIVE/DEMO classification — always shown on the detail header. */}
              <ModeBadge live={(sim?.mode || "simulation") === "live"} he={he} />
              <Badge Icon={p.market === "crypto" ? Sparkles : LineChart} label={marketLabelOf(p, he)} color={C.gold} />
              <Badge Icon={dir.Icon} label={he ? dir.he : dir.en} color={toneColor(dir.tone)} />
            </div>
          </div>
          {/* ⓘ info + history — the explainer + FULL backtest chart open here. */}
          <button onClick={() => setInfo(true)} aria-label={he ? "מידע והיסטוריה" : "Info & history"} className="tap44"
            style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center",
              background: C.surface2, border: `1px solid ${C.line}`, color: C.gold, cursor: "pointer" }}>
            <Info size={17} />
          </button>
        </div>
        {/* Backtest — ONE compact line + a VERIFY button (full report + export). */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, color: C.muted,
          background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "6px 10px", flexWrap: "wrap" }}>
          <CandlestickChart size={12} color={C.gold} style={{ flexShrink: 0 }} />
          <span style={{ direction: rtl ? "rtl" : "ltr" }}>{backtestLine}</span>
          <button onClick={() => setReport(true)} className="tap44"
            style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, fontWeight: 900,
              color: C.gold, background: `${C.gold}14`, border: `1px solid ${C.gold}55`, borderRadius: 999, padding: "3px 9px", cursor: "pointer", whiteSpace: "nowrap" }}>
            <FileSearch size={11} /> {he ? "דוח מלא · אימות" : "Full report · verify"}
          </button>
        </div>
        <div style={{ fontSize: 9, color: C.faint }}>{bi(PERF_DISCLAIMER, he)}.</div>
      </div>

      {/* DR Crypto RISK-MODE selector — ON THE MAIN PILOT SCREEN (no need to open the report).
          Selecting a mode updates the headline (return + DD) AND persists as the operational mode. */}
      {isDR && dm.modes.length > 0 && (
        <div style={{ ...glass({ display: "flex", flexDirection: "column", gap: 7 }) }}>
          <div style={{ fontSize: 11.5, fontWeight: 900, color: C.text, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <ShieldCheck size={14} color={C.blue} /> {he ? "מצב סיכון — בחר איך הטייס ירוץ (תשואה ו-drawdown יחד)" : "Risk mode — choose how the pilot runs (return AND drawdown, together)"}
          </div>
          <DrModeButtons modes={dm.modes} activeKey={dm.activeMode?.key} onPick={dm.pick} he={he} />
          <div style={{ fontSize: 9, lineHeight: 1.4, color: C.faint }}>
            {he ? "המצב הנבחר קובע גם את הגדלים והבקרות שהסימולציה מריצה. מצב אגרסיבי יותר = תשואה גבוהה יותר אך drawdown עמוק יותר. סימולציה נטו אחרי עמלות — לא רווח בפועל." : "The selected mode also sets the sizing/risk the simulation runs. A more aggressive mode = higher return but deeper drawdown. Simulation, net of fees — not earned P&L."}
          </div>
        </div>
      )}

      {/* LIVE status explainer (Yoav #1A4X) — only when the pilot is live: what's happening
          now, next run, "proposes for approval / never auto-executes", no need to keep pressing. */}
      {sim && isLivePilot(sim) && <LiveStatusExplainer p={p} sim={sim} he={he} live={live} />}

      {/* LIVE-FIRST: once loaded, the trade panel (open positions + closed history) LEADS. */}
      {sim && <PilotTradePanel p={p} sim={sim} he={he} rtl={rtl} hasScan={hasScan} onOpenReport={() => setReport(true)} />}

      {/* How it operates automatically — always available (BEFORE and after activation). */}
      <AutoOperationCard p={p} sim={sim} he={he} />

      {/* Action — LOAD → 3-step approval → SIMULATION (or run-now / unload once loaded).
          OWNER-ONLY: a non-owner full-viewer (the IT editor / Oren) gets a READ-ONLY pilot view
          — no arm/run/unload controls (the backend also blocks those writes with require_owner). */}
      {canManage && (
        <div style={soft({ padding: 15 })}>
          <ArmAction p={p} he={he} sim={sim} onArm={onArm} onDisarm={onDisarm} onRun={onRun} running={running} onApplyState={onApplyState} />
        </div>
      )}

      {/* REAL-MONEY (Bybit keys / go-live / kill-switch) — OWNER-ONLY, never shown to a
          non-owner viewer (and every underlying endpoint is require_owner). */}
      {canManage && sim && <LiveControlPanel p={p} sim={sim} he={he} rtl={rtl} bybit={bybit} live={live} onApplyState={onApplyState} />}

      {info && <PilotInfoModal p={p} he={he} rtl={rtl} sim={sim} onClose={() => setInfo(false)} />}
      {report && <BacktestReportModal p={p} sim={sim} he={he} rtl={rtl} onClose={() => setReport(false)} />}
    </div>
  );
}

// ── 3-step arming wizard ───────────────────────────────────────────────────────
function StepDots({ step, he }: { step: number; he: boolean }) {
  const labels = he ? ["אסטרטגיה", "חשבון", "אישור"] : ["Strategy", "Account", "Approve"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {labels.map((lb, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <React.Fragment key={i}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 22, height: 22, borderRadius: 999, display: "grid", placeItems: "center", flexShrink: 0,
                fontSize: 11, fontWeight: 900, fontVariantNumeric: "tabular-nums",
                color: active || done ? ACCENT_INK : C.muted, background: active || done ? C.accentGrad : C.surface2,
                border: `1px solid ${active || done ? "transparent" : C.line}` }}>
                {done ? <Check size={12} /> : n}
              </span>
              <span style={{ fontSize: 11, fontWeight: 800, color: active ? C.text : C.faint }}>{lb}</span>
            </span>
            {i < labels.length - 1 && <span style={{ flex: 1, height: 1, background: C.line, minWidth: 12 }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function ArmWizard({ p, he, rtl, onClose, onArmed }: {
  p: AutoPilot; he: boolean; rtl: boolean; onClose: () => void; onArmed: (cfg: ArmedPilot) => void;
}) {
  const [step, setStep] = useState(1);
  // Step 1
  const [readRisk, setReadRisk] = useState(false);
  // Step 2
  const [accountLabel, setAccountLabel] = useState("");
  const [nav, setNav] = useState("1000"); // defined starting capital (default $1,000)
  const [perTradePct, setPerTradePct] = useState("10");
  // Step 3
  const [typed, setTyped] = useState("");
  const [approveReal, setApproveReal] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => { track("autopilot_arm_opened", { pilot: p.id }); }, [p.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const navNum = Number(nav);
  const pctNum = Number(perTradePct);
  const perTradeSize = navNum > 0 && pctNum > 0 ? (navNum * pctNum) / 100 : 0;

  const step2Valid = accountLabel.trim().length > 0 && navNum > 0 && pctNum > 0 && pctNum <= 100;
  const step3Valid = typed.trim().toUpperCase() === "APPROVE" && approveReal;

  const dir = DIRECTION_META[p.direction];
  const Icon = ICON[p.icon] || Activity;

  const finish = () => {
    if (!step3Valid) return;
    const cfg: ArmedPilot = {
      armedAt: new Date().toISOString(),
      accountLabel: accountLabel.trim(),
      nav: navNum,
      perTradePct: pctNum,
      mode: "simulation",
    };
    track("autopilot_armed", { pilot: p.id, mode: "simulation" });
    onArmed(cfg);
  };

  const Next = rtl ? ArrowLeft : ArrowRight;
  const Back = rtl ? ArrowRight : ArrowLeft;
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 5, display: "block" };

  return createPortal(
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16, direction: rtl ? "rtl" : "ltr" }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={bi(p.name, he)} dir={rtl ? "rtl" : "ltr"}
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(520px, 96vw)", maxHeight: "calc(100dvh - 32px)", overflowY: "auto",
          background: C.surface, border: `1.5px solid ${C.gold}`, borderRadius: 18,
          boxShadow: "0 28px 80px rgba(0,0,0,0.6)", fontFamily: UI }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "14px 16px", borderBottom: `1px solid ${C.line}`,
          background: `linear-gradient(135deg, ${C.gold}26, ${C.gold}0f), ${C.surface}` }}>
          <PilotEmblem p={p} size={38} radius={11} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 900, color: C.text, lineHeight: 1.2 }}><PilotName p={p} he={he} size={14} /></div>
            <div style={{ fontSize: 10.5, color: C.faint, fontFamily: "ui-monospace, monospace" }}>{p.id}</div>
          </div>
          <button onClick={onClose} aria-label={he ? "סגור" : "Close"} className="tap44"
            style={{ flexShrink: 0, background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={18} /></button>
        </div>

        {/* Step dots */}
        <div style={{ padding: "14px 16px 0" }}><StepDots step={step} he={he} /></div>

        {/* Body */}
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 13 }}>
          {/* STEP 1 — strategy review + risk disclaimer */}
          {step === 1 && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                <Badge Icon={p.market === "crypto" ? Sparkles : LineChart} label={p.market === "crypto" ? (he ? "קריפטו" : "Crypto") : (he ? "מניות" : "Stocks")} color={C.gold} />
                <Badge Icon={dir.Icon} label={he ? dir.he : dir.en} color={toneColor(dir.tone)} />
              </div>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: C.muted }}>{bi(p.description, he)}</p>
              <div>
                <label style={lbl}>{he ? "הגדרת האסטרטגיה" : "Strategy definition"}</label>
                <pre style={{ margin: 0, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "11px 12px",
                  fontSize: 11, lineHeight: 1.55, color: C.muted, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 160, overflowY: "auto",
                  fontFamily: "ui-monospace, monospace", direction: "ltr", textAlign: "left" }}>{p.rules}</pre>
              </div>
              {/* Simulation notice */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, lineHeight: 1.5, color: C.text,
                background: `${C.blue}12`, border: `1px solid ${C.blue}55`, borderRadius: 10, padding: "9px 12px" }}>
                <FlaskConical size={15} color={C.blue} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{he
                  ? "בשלב זה הטייס פועל בסימולציה בלבד — לא מבוצעות פקודות אמיתיות ולא זז כסף. מנוע ההרצה האמיתי הוא שלב נפרד."
                  : "In this phase the pilot runs in SIMULATION only — no real orders are placed and no money moves. The real execution engine is a separate phase."}</span>
              </div>
              {/* Risk disclaimer */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, lineHeight: 1.5, color: C.text,
                background: `${C.loss}12`, border: `1px solid ${C.loss}55`, borderRadius: 10, padding: "9px 12px" }}>
                <AlertTriangle size={15} color={C.loss} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{he
                  ? "אזהרת סיכון: מסחר אלגוריתמי כרוך בסיכון מהותי, כולל אובדן מלא של ההון. תוצאות עבר (כולל בקטסט) אינן מבטיחות תוצאות עתידיות."
                  : "Risk warning: algorithmic trading carries substantial risk, including total loss of capital. Past performance (including backtests) does not guarantee future results."}</span>
              </div>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer", fontSize: 12.5, lineHeight: 1.5, color: C.text }}>
                <input type="checkbox" checked={readRisk} onChange={(e) => setReadRisk(e.target.checked)}
                  style={{ marginTop: 2, width: 17, height: 17, accentColor: C.gold, flexShrink: 0, cursor: "pointer" }} />
                <span>{he ? "קראתי והבנתי את האסטרטגיה ואת אזהרת הסיכון." : "I have read and understand the strategy and the risk warning."}</span>
              </label>
            </>
          )}

          {/* STEP 2 — account + NAV + sizing */}
          {step === 2 && (
            <>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: C.muted }}>
                {he ? "הגדירו את ההון וגודל הפוזיציה לעסקה. בטעינה הטייס מתחיל ריק (0 פוזיציות, 0 רווח) — הוא יקנה בסריקה/סיגנל הבאים. הנתונים לתצוגה בלבד — לא נשלחת שום פקודה."
                    : "Set the capital and per-trade size. On load the pilot starts flat (0 positions, 0 P&L) — it buys at the next scan/signal. Captured for display only — no order is sent."}
              </p>
              <div>
                <label style={lbl}>{he ? "בורסה / חשבון" : "Exchange / account"}</label>
                <input value={accountLabel} onChange={(e) => setAccountLabel(e.target.value)} dir={rtl ? "rtl" : "ltr"}
                  placeholder={he ? "למשל: Binance — חשבון ראשי" : "e.g. Binance — main account"}
                  style={{ ...input, width: "100%", boxSizing: "border-box", fontFamily: UI }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={lbl}>{he ? "הון (USD)" : "Capital (USD)"}</label>
                  <input value={nav} onChange={(e) => setNav(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" dir="ltr"
                    placeholder="1000" style={{ ...input, width: "100%", boxSizing: "border-box", fontFamily: UI }} />
                </div>
                <div>
                  <label style={lbl}>{he ? "גודל לעסקה (% מההון)" : "Per-trade (% of capital)"}</label>
                  <input value={perTradePct} onChange={(e) => setPerTradePct(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" dir="ltr"
                    placeholder="10" style={{ ...input, width: "100%", boxSizing: "border-box", fontFamily: UI }} />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "11px 13px" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>{he ? "גודל משוער לעסקה" : "Estimated size per trade"}</span>
                <span style={{ fontSize: 15, fontWeight: 900, color: C.gold, fontVariantNumeric: "tabular-nums" }}>
                  ${perTradeSize.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              </div>
              {pctNum > 25 && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11.5, lineHeight: 1.5, color: C.text,
                  background: `${C.loss}12`, border: `1px solid ${C.loss}55`, borderRadius: 10, padding: "9px 12px" }}>
                  <AlertTriangle size={14} color={C.loss} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{he ? "גודל לעסקה גבוה מ-25% מההון מגדיל משמעותית את הסיכון." : "A per-trade size above 25% of capital materially increases risk."}</span>
                </div>
              )}
              {/* Live "how it will operate" preview using the entered capital / %. */}
              <AutoOperationCard p={p} he={he} previewCapital={navNum} previewPct={pctNum} />
            </>
          )}

          {/* STEP 3 — explicit final confirm */}
          {step === 3 && (
            <>
              <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, background: C.surface2, overflow: "hidden" }}>
                {[
                  [he ? "טייס" : "Pilot", bi(p.name, he)],
                  [he ? "חשבון" : "Account", accountLabel.trim()],
                  [he ? "הון" : "Capital", `$${navNum.toLocaleString()}`],
                  [he ? "גודל לעסקה" : "Per-trade", `${pctNum}%  ·  $${perTradeSize.toLocaleString(undefined, { maximumFractionDigits: 2 })}`],
                  [he ? "מצב" : "Mode", he ? "סימולציה (ללא פקודות אמיתיות)" : "Simulation (no real orders)"],
                ].map(([k, v], i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                    padding: "10px 13px", borderTop: i ? `1px solid ${C.line}` : "none" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>{k}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: i === 4 ? C.blue : C.text, textAlign: rtl ? "left" : "right" }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, lineHeight: 1.5, color: C.text,
                background: `${C.loss}12`, border: `1px solid ${C.loss}55`, borderRadius: 10, padding: "9px 12px" }}>
                <ShieldAlert size={15} color={C.loss} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{he
                  ? "זהו שלב האישור הסופי לפני טעינת טייס אוטומטי. בשלב זה הטייס ייטען בסימולציה בלבד — כשמנוע ההרצה האמיתי יעלה, אישור זה יידרש עבור כסף אמיתי."
                  : "This is the final approval before loading an auto-pilot. In this phase it loads in SIMULATION only — once the real execution engine ships, this same approval will gate real money."}</span>
              </div>
              <div>
                <label style={lbl}>{he ? 'הקלד/י APPROVE לאישור' : 'Type APPROVE to confirm'}</label>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} dir="ltr" autoCapitalize="characters"
                  placeholder="APPROVE" style={{ ...input, width: "100%", boxSizing: "border-box", fontFamily: "ui-monospace, monospace",
                    letterSpacing: "0.15em", borderColor: step3Valid ? C.gain : C.line }} />
              </div>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer", fontSize: 12.5, lineHeight: 1.5, color: C.text }}>
                <input type="checkbox" checked={approveReal} onChange={(e) => setApproveReal(e.target.checked)}
                  style={{ marginTop: 2, width: 17, height: 17, accentColor: C.gold, flexShrink: 0, cursor: "pointer" }} />
                <span>{he ? "אני מאשר/ת הפעלת ביצוע בכסף אמיתי (יחול כשמנוע ההרצה יעלה; כרגע סימולציה)."
                          : "I approve real-money execution (applies once the engine ships; simulation for now)."}</span>
              </label>
            </>
          )}
        </div>

        {/* Footer nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px 16px", flexDirection: rtl ? "row-reverse" : "row" }}>
          {step > 1 ? (
            <button onClick={() => setStep((s) => s - 1)} className="tap44"
              style={{ ...btn(), justifyContent: "center" }}>
              <Back size={15} /> {he ? "חזרה" : "Back"}
            </button>
          ) : (
            <button onClick={onClose} className="tap44" style={{ ...btn(), justifyContent: "center" }}>{he ? "ביטול" : "Cancel"}</button>
          )}
          {step < 3 ? (
            <button onClick={() => setStep((s) => s + 1)} disabled={step === 1 ? !readRisk : !step2Valid} className="tap44"
              style={{ ...btn(true), marginInlineStart: "auto", justifyContent: "center", opacity: (step === 1 ? readRisk : step2Valid) ? 1 : 0.5 }}>
              {he ? "המשך" : "Continue"} <Next size={15} />
            </button>
          ) : (
            <button onClick={finish} disabled={!step3Valid} className="tap44"
              style={{ ...btn(true), marginInlineStart: "auto", justifyContent: "center", opacity: step3Valid ? 1 : 0.5 }}>
              <FlaskConical size={16} /> {he ? "טען בסימולציה" : "Load in simulation"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Prominent ENTRY tile (rendered in the Owners portal) ─────────────────────────
// The "top wide feature tile" from the mockup: a big graphic + a key metric + label +
// sublabel. Tapping it opens the AutoPilots screen. Owners-only (gated by the caller).
export function AutoPilotsEntryTile({ he, rtl, onOpen }: { he: boolean; rtl: boolean; onOpen: () => void }) {
  const Fwd = rtl ? ChevronLeft : ChevronRight;
  return (
    <button onClick={onOpen} className="tap44"
      style={{ width: "100%", textAlign: rtl ? "right" : "left", cursor: "pointer", border: `1px solid ${C.glassBd}`,
        borderRadius: 20, padding: 0, overflow: "hidden", background: "transparent", fontFamily: UI, display: "block", boxShadow: C.glassHi }}>
      <div style={{ display: "flex", alignItems: "center", gap: 15, padding: "16px 18px",
        background: `linear-gradient(140deg, ${C.gold}30 0%, ${C.surface2} 72%)` }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, flexShrink: 0, display: "grid", placeItems: "center", background: C.accentGrad, boxShadow: C.glassHi }}>
          <Rocket size={28} color={ACCENT_INK} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
            <span style={{ fontSize: 16, fontWeight: 900, color: C.text, lineHeight: 1.15 }}>
              {he ? "טייסים אוטומטיים · AutoPilots" : "AutoPilots · טייסים אוטומטיים"}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800, color: C.gold,
              background: `${C.gold}18`, border: `1px solid ${C.gold}55`, borderRadius: 999, padding: "2px 8px" }}>
              <Lock size={11} /> {he ? "בעלים בלבד" : "Owners only"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.45, marginBottom: 7 }}>
            {he ? "אסטרטגיות שסוחרות בשבילך — סימולציה בלבד, באישורך המלא." : "Strategies that trade for you — simulation-only, on your full approval."}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Chip Icon={Layers} label={he ? "5 טייסים" : "5 pilots"} />
            <Chip Icon={FlaskConical} label={he ? "סימולציה" : "Simulation"} />
          </div>
        </div>
        {/* KEY METRIC */}
        <div style={{ flexShrink: 0, textAlign: "center", paddingInline: 4 }}>
          <div style={{ fontSize: 30, fontWeight: 900, color: C.gold, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>5</div>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: C.faint, marginTop: 3 }}>{he ? "טייסים" : "pilots"}</div>
        </div>
        <Fwd size={22} color={C.gold} style={{ flexShrink: 0 }} />
      </div>
    </button>
  );
}

// ── Slim onboarding strip (condensed — keeps both explainers, fits one screen) ─────
function IntroTiles({ he }: { he: boolean }) {
  const Item = ({ Icon, iconBg, iconColor, title, body }: { Icon: any; iconBg: string; iconColor: string; title: string; body: string }) => (
    <div style={soft({ padding: "9px 12px", display: "flex", alignItems: "center", gap: 10, minWidth: 0 })}>
      <div style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: "grid", placeItems: "center", background: iconBg }}>
        <Icon size={16} color={iconColor} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: C.text, lineHeight: 1.1, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 10.5, lineHeight: 1.4, color: C.muted }}>{body}</div>
      </div>
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 10 }}>
      <Item Icon={Bot} iconBg={C.accentGrad} iconColor={ACCENT_INK}
        title={he ? "מה זה טייס אוטומטי?" : "What is an AutoPilot?"}
        body={he ? "אסטרטגיה שמריצה את עצמה: סורקת יומית, פועלת לפי חוקים, ופותחת/סוגרת פוזיציות בשבילך."
                 : "A strategy that runs itself: scans daily, follows rules, opens & closes positions for you."} />
      <Item Icon={ShieldCheck} iconBg={`${C.blue}22`} iconColor={C.blue}
        title={he ? "איך זה בטוח?" : "How it stays safe"}
        body={he ? "כרגע סימולציה בלבד — בלי פקודות אמת ובלי כסף. טעינת טייס דורשת אישור ב-3 שלבים."
                 : "Simulation only for now — no real orders, no money. Loading a pilot takes a 3-step approval."} />
    </div>
  );
}

// ── Reusable one-line-per-pilot DASHBOARD (used on the AutoPilots screen AND Home) ──
// A clean LIST: each row is NAME first → total capital → P&L now → open positions →
// affordance (chevron for loaded, "load" chip for not-yet-loaded). Click a row → the
// caller opens the pilot's trade panel (history + open positions). SIMULATION only.

export function apSummary(pilots: ApSimPilot[]) {
  const isLive = (p: ApSimPilot) => (p.mode || "simulation") === "live";
  const sum = (arr: ApSimPilot[], f: (p: ApSimPilot) => number) => arr.reduce((s, p) => s + Number(f(p) || 0), 0);
  const loaded = pilots.length;
  const liveCount = pilots.filter(isLive).length;
  const totalPnl = sum(pilots, (p) => p.totalPnl);
  // STRICT attribution by POSITION mode (backend split: livePnl + simPnl == totalPnl). This
  // guarantees a live pilot's leftover SIM positions never leak into the LIVE bucket, and a
  // sim pilot never contributes to LIVE. Falls back to whole-pilot classification if the
  // per-position split isn't present (older payloads).
  const livePnl = sum(pilots, (p) => p.livePnl != null ? Number(p.livePnl) : (isLive(p) ? Number(p.totalPnl || 0) : 0));
  const simPnl = sum(pilots, (p) => p.simPnl != null ? Number(p.simPnl) : (isLive(p) ? 0 : Number(p.totalPnl || 0)));
  const totalValue = sum(pilots, (p) => Number((p.capital ?? p.nav) || 0) + Number(p.totalPnl || 0));
  // CAPITAL (allocated / sizing NAV) split by mode — for the Home portfolio breakdown. A live
  // pilot's capital = its owner-set live cap (falls back to nav/capital); a sim pilot's = its
  // simulation NAV. These are the "money referred to each tool" figures, kept mode-disjoint so
  // LIVE capital never mixes with SIM capital.
  const liveCapital = sum(pilots.filter(isLive), (p) => Number((p.liveCap ?? p.capital ?? p.nav) || 0));
  const simCapital = sum(pilots.filter((p) => !isLive(p)), (p) => Number((p.capital ?? p.nav) || 0));
  const openPositions = sum(pilots, (p) => p.openCount);
  const liveOpen = sum(pilots, (p) => p.liveOpenCount != null ? Number(p.liveOpenCount) : (isLive(p) ? Number(p.openCount || 0) : 0));
  const simOpen = sum(pilots, (p) => p.simOpenCount != null ? Number(p.simOpenCount) : (isLive(p) ? 0 : Number(p.openCount || 0)));
  // "today" ≈ the last step of each pilot's simulated equity journey.
  const todayPnl = sum(pilots, (p) => {
    const c = p.equityCurve || [];
    return c.length >= 2 ? Number(c[c.length - 1].v) - Number(c[c.length - 2].v) : 0;
  });
  return { loaded, liveCount, totalPnl, simPnl, livePnl, totalValue, liveCapital, simCapital, openPositions, simOpen, liveOpen, todayPnl };
}


// Explicit column tracks so nothing overlaps/clips at any width: icon · NAME(flex) ·
// Capital · P&L · Open · tail(chevron/Load). The name column is minmax(0,1fr) so it
// grows on wide screens and ellipsizes on narrow ones; the numeric columns are fixed so
// the header labels line up over their values. MOBILE uses tighter tracks (+ a compact
// $ format) so the rightmost "Open" column stays fully on-screen at ~380px — never clipped.
// List rows mirror the CARD KPIs: icon · name · backtest RETURN · max DD · tail.
const apRowGrid = (mobile: boolean) => mobile
  ? "24px minmax(38px, 1fr) 66px 52px 14px"
  : "30px minmax(84px, 1fr) 98px 82px auto";
// Compact $ (no decimals) for the tight mobile rows: "$1,000" not "$1,000.00".
const fmtMoney0 = (n: number | null | undefined) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtSignedMoney0 = (n: number | null | undefined) => `${Number(n || 0) >= 0 ? "+" : "-"}${fmtMoney0(Math.abs(Number(n || 0)))}`;

function AutoPilotRow({ p, he, rtl, sim, onOpen }: { p: AutoPilot; he: boolean; rtl: boolean; sim?: ApSimPilot; onOpen: () => void }) {
  const Icon = ICON[p.icon] || Activity;
  const dir = DIRECTION_META[p.direction];
  const Fwd = rtl ? ChevronLeft : ChevronRight;
  const mobile = useIsMobile();
  const loaded = !!sim;
  // LIST rows now mirror the CARDS: show the pilot's backtest RETURN + max DD (Dan). For DR Crypto
  // that's the SELECTED risk mode (in sync with the card/report via the shared useDrModes hook).
  const isDR = p.id === "DR-Crypto-Trend";
  const dm = useDrModes(isDR);
  const am = isDR ? dm.activeMode : undefined;
  const kNet = am ? am.net_pct : p.backtest.pnlPct;
  const kDd = am ? am.maxdd_pct : p.backtest.maxDrawdown;
  const numCell: React.CSSProperties = { textAlign: "end", fontVariantNumeric: "tabular-nums", direction: "ltr", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: mobile ? 11 : 12.5, fontWeight: 900 };
  return (
    <button onClick={onOpen} className="tap44"
      style={{ ...soft({ padding: mobile ? "8px 9px" : "8px 11px", display: "grid", gridTemplateColumns: apRowGrid(mobile), alignItems: "center", columnGap: mobile ? 6 : 9,
        cursor: "pointer", fontFamily: UI, width: "100%", textAlign: rtl ? "right" : "left",
        borderColor: (loaded && (sim!.mode || "simulation") === "live") ? C.loss : loaded ? `${C.gold}66` : C.line,
        borderWidth: (loaded && (sim!.mode || "simulation") === "live") ? 1.5 : 1 }) }}>
      {/* emblem */}
      <PilotEmblem p={p} size={mobile ? 26 : 32} radius={9} />
      {/* NAME + subtitle (id + direction chip) — all constrained INSIDE this cell. */}
      <div style={{ minWidth: 0, overflow: "hidden" }}>
        <div style={{ fontSize: 12.5, fontWeight: 900, color: C.text, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><PilotName p={p} he={he} size={12} /></div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, minWidth: 0, overflow: "hidden" }}>
          <span style={{ fontSize: 8.5, fontWeight: 700, color: C.faint, fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.id}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 8.5, fontWeight: 800, color: toneColor(dir.tone), flexShrink: 0, whiteSpace: "nowrap" }}>
            <dir.Icon size={9} /> {he ? dir.he : dir.en}
          </span>
          {/* DR Crypto: show the SELECTED mode chip (🔴/🟡/🟢) so the row matches the card headline. */}
          {isDR && am && <span style={{ fontSize: 8.5, fontWeight: 800, color: C.blue, flexShrink: 0, whiteSpace: "nowrap" }}>{am.emoji} {bi(am.label, he)}</span>}
          {/* Every pilot labeled: LIVE (red) or DEMO (blue) by its current mode. */}
          <ModeBadge live={loaded && (sim!.mode || "simulation") === "live"} he={he} small />
        </div>
      </div>
      {/* RETURN (backtest / self-validated) — same headline as the card. */}
      <div style={{ ...numCell, color: kNet >= 0 ? C.gain : C.loss }}>{fmtPnl(Number(kNet.toFixed(kNet >= 1000 ? 0 : 1)))}</div>
      {/* MAX DD — shown next to the return (never return alone). */}
      <div style={{ ...numCell, color: C.loss }}>{fmtDd(Math.abs(kDd))}</div>
      {/* tail */}
      {loaded ? (
        <Fwd size={16} color={C.faint} style={{ justifySelf: "end" }} />
      ) : (
        <span style={{ justifySelf: "end", display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 800, color: C.gold,
          background: `${C.gold}14`, border: `1px solid ${C.gold}55`, borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>
          {he ? "טען" : "Load"} <Fwd size={12} />
        </span>
      )}
    </button>
  );
}

export function AutoPilotsDashboard({ he, rtl, simByPilot, onOpenRow, filter, pilots }: {
  he: boolean; rtl: boolean; simByPilot: Record<string, ApSimPilot>; onOpenRow: (id: string) => void;
  // Optional mode filter — 'live' shows only pilots currently in LIVE mode; 'sim' shows the
  // rest (simulation-loaded OR not-yet-loaded, i.e. the DEMO side). Undefined shows all.
  filter?: "live" | "sim";
  // Optional pre-filtered catalog (Phase 2c 4-pilot lineup). Defaults to the full list.
  pilots?: AutoPilot[];
}) {
  const mobile = useIsMobile();
  const hLabel: React.CSSProperties = { textAlign: "end", fontSize: 8.5, fontWeight: 800, color: C.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  // Default to the visible 4-pilot lineup (hidden pilots 3/4/5 never leak into embeddings);
  // the main screen passes an explicit `pilots` catalog (owner toggle-aware).
  const shown = (pilots || AUTOPILOTS.filter((x) => x.visible !== false)).filter((p) => {
    if (!filter) return true;
    const isLive = (simByPilot[p.id]?.mode || "simulation") === "live" && !!simByPilot[p.id];
    return filter === "live" ? isLive : !isLive;
  });
  if (shown.length === 0) {
    return (
      <div style={{ fontSize: 12, color: C.muted, textAlign: "center", padding: "16px 8px" }}>
        {filter === "live"
          ? (he ? "אין טייסים במצב לייב. טענו טייס והפעילו אותו ללייב." : "No pilots in LIVE mode yet. Load a pilot and switch it to live.")
          : (he ? "אין טייסים בסימולציה." : "No simulation pilots.")}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Column header — labels aligned over their value columns (mobile grid matches the rows). */}
      <div style={{ display: "grid", gridTemplateColumns: apRowGrid(mobile), alignItems: "center", columnGap: mobile ? 6 : 9, padding: mobile ? "0 9px" : "0 11px" }}>
        <span />
        <span style={{ fontSize: 8.5, fontWeight: 800, color: C.faint }}>{he ? "טייס" : "Pilot"}</span>
        <span style={hLabel}>{he ? "תשואה" : "Return"}</span>
        <span style={hLabel}>{he ? "ירידה מקס'" : "Max DD"}</span>
        <span />
      </div>
      {shown.map((p) => (
        <AutoPilotRow key={p.id} p={p} he={he} rtl={rtl} sim={simByPilot[p.id]} onOpen={() => onOpenRow(p.id)} />
      ))}
    </div>
  );
}

// ── Rich CARD (Cards view) — compact so all 5 fit ONE row at zoom 1.15, no scroll ───
function PilotCard({ p, he, rtl, sim, onOpen }: { p: AutoPilot; he: boolean; rtl: boolean; sim?: ApSimPilot; onOpen: () => void }) {
  const Icon = ICON[p.icon] || Activity;
  const dir = DIRECTION_META[p.direction];
  const Fwd = rtl ? ChevronLeft : ChevronRight;
  const loaded = !!sim;
  // DR Crypto grid tile reflects the PERSISTED selected mode (shared useDrModes → in sync with the
  // main screen / report / list-row). Other pilots keep their static backtest headline.
  const isDR = p.id === "DR-Crypto-Trend";
  const dm = useDrModes(isDR);
  const am = isDR ? dm.activeMode : undefined;
  const kNet = am ? am.net_pct : p.backtest.pnlPct;
  const kDd = am ? am.maxdd_pct : p.backtest.maxDrawdown;
  const kTr = am ? am.trades : p.backtest.trades;
  return (
    <button onClick={onOpen} className="tap44"
      style={{ ...soft({ padding: 8, display: "flex", flexDirection: "column", gap: 7, textAlign: rtl ? "right" : "left",
        cursor: "pointer", fontFamily: UI, overflow: "hidden",
        borderColor: (loaded && (sim!.mode || "simulation") === "live") ? C.loss : loaded ? `${C.gold}88` : C.line,
        borderWidth: (loaded && (sim!.mode || "simulation") === "live") ? 1.5 : 1 }) }}>
      {/* backtest-curve graphic */}
      <div style={{ position: "relative", borderRadius: 11, overflow: "hidden", height: 54,
        background: `linear-gradient(155deg, ${C.gold}24 0%, ${C.surface2} 62%)`, border: `1px solid ${C.line}` }}>
        <div style={{ position: "absolute", insetInlineStart: 7, top: 7, zIndex: 2 }}>
          <PilotEmblem p={p} size={32} radius={10} />
        </div>
        <div style={{ position: "absolute", insetInlineEnd: 7, top: 7, zIndex: 2, display: "flex", flexDirection: "column", alignItems: rtl ? "flex-start" : "flex-end", gap: 4 }}>
          <span style={{ fontSize: 8.5, fontWeight: 900, color: C.text, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 999, padding: "1px 6px" }}>{marketLabelOf(p, he)}</span>
          {/* LIVE/DEMO classification — shown on every pilot card. */}
          <ModeBadge live={loaded && (sim!.mode || "simulation") === "live"} he={he} small />
        </div>
        <div style={{ position: "absolute", insetInline: 0, bottom: 0 }}><EquitySparkline pnlPct={kNet} h={38} /></div>
      </div>
      {/* PnL + details */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 6 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: C.gain, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", lineHeight: 1 }}>{fmtPnl(kNet)}</div>
          <div style={{ fontSize: 8, fontWeight: 800, color: am ? C.blue : C.faint, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{am ? `${am.emoji} ${bi(am.label, he)}` : (he ? "בקטסט מאומת" : "self-validated")}</div>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, fontWeight: 800, color: C.gold, background: `${C.gold}14`, borderRadius: 999, padding: "2px 6px", whiteSpace: "nowrap" }}>{he ? "פרטים" : "Details"} <Fwd size={11} /></span>
      </div>
      {/* Max DD + trades */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 8.5, fontWeight: 800, color: C.loss, background: `${C.loss}14`, border: `1px solid ${C.loss}44`, borderRadius: 999, padding: "2px 6px", whiteSpace: "nowrap" }}><TrendingDown size={9} /> DD {fmtDd(kDd)}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 8.5, fontWeight: 800, color: C.muted, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: "2px 6px", whiteSpace: "nowrap" }}><Timer size={9} /> {kTr.toLocaleString("en-US")}</span>
      </div>
      {/* name / id / direction */}
      <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 6 }}>
        <div style={{ fontSize: 10.5, fontWeight: 900, color: C.text, marginBottom: 2, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><PilotName p={p} he={he} size={11} /></div>
        <div style={{ fontSize: 8, fontWeight: 700, color: C.faint, marginBottom: 5, fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.id}</div>
        <Badge Icon={dir.Icon} label={he ? dir.he : dir.en} color={toneColor(dir.tone)} />
      </div>
      {/* live sim */}
      {sim && (() => {
        // A live pilot's card shows its LIVE slice ($0 with the gate off) in red — never
        // its sim P&L as real. A sim pilot shows its sim P&L in blue.
        const cardLive = (sim.mode || "simulation") === "live";
        const cardPnl = cardLive ? Number(sim.livePnl ?? 0) : Number(sim.totalPnl || 0);
        const cardOpen = cardLive ? Number(sim.liveOpenCount ?? 0) : Number(sim.openCount || 0);
        return (
        <div style={{ borderRadius: 9, background: cardLive ? `${C.loss}12` : `${C.blue}0e`, border: `1px solid ${cardLive ? C.loss : `${C.blue}44`}`, padding: "6px 7px", display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 5 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 8.5, fontWeight: 900, color: cardLive ? C.loss : C.blue }}>{cardLive ? <Radio size={9} /> : <FlaskConical size={9} />} {cardLive ? (he ? "לייב" : "live") : (he ? "סים" : "sim")}</span>
            <span style={{ fontSize: 12, fontWeight: 900, color: pnlColor(cardPnl), fontVariantNumeric: "tabular-nums", direction: "ltr" }}>{fmtSignedMoney(cardPnl)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 8, color: C.faint, fontWeight: 700 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}><ListTree size={9} /> {cardOpen}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}><Clock size={9} /> {fmtWhen(sim.lastRunAt, he)}</span>
          </div>
        </div>
        );
      })()}
    </button>
  );
}

// ── Run-plan review panel ─────────────────────────────────────────────────────────
// "Run now" computes a READ-ONLY plan (no writes, no orders); this panel shows the
// proposed exits/entries with checkboxes; the owner ticks all or a subset and APPROVES
// — ONLY then does the server execute the approved items (real Bybit orders for a live
// pilot, sim writes otherwise). Cancel places nothing. This is the money-safety gate.
function PlanGroup({ title, trades, checked, setChecked, he, kind }: {
  title: string; trades: ApPlanTrade[]; checked: Record<string, boolean>;
  setChecked: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  he: boolean; kind: "enter" | "exit";
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, margin: "6px 0 4px" }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {trades.map((t) => {
          const on = !!checked[t.key];
          return (
            <label key={t.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px",
              borderRadius: 9, border: `1px solid ${on ? `${C.accent}66` : C.line}`,
              background: on ? `${C.accent}12` : "transparent", cursor: "pointer" }}>
              <input type="checkbox" checked={on}
                onChange={(e) => setChecked((c) => ({ ...c, [t.key]: e.target.checked }))} />
              <span style={{ fontWeight: 800, fontSize: 12.5, color: C.text }}>{t.symbol}</span>
              <span style={{ fontSize: 10.5, color: C.muted }}>
                {kind === "enter"
                  ? `${t.side === "short" ? (he ? "שורט" : "short") : (he ? "לונג" : "long")} · ${fmtMoney(t.spendUsd)}`
                  : (he ? "סגירה" : "close")}
              </span>
              {kind === "exit" && t.estPnl != null && (
                <span style={{ marginInlineStart: "auto", fontSize: 12, fontWeight: 800, direction: "ltr",
                  color: (t.estPnl >= 0) ? C.gain : C.loss }}>{fmtSignedMoney(t.estPnl)}</span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function RunPlanPanel({ pilot, sim, he, rtl, exName = "Bybit", onClose, onApplied }: {
  pilot: AutoPilot; sim?: ApSimPilot; he: boolean; rtl: boolean; exName?: string;
  onClose: () => void; onApplied: (state: ApSimState) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<ApRunPlan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [approving, setApproving] = useState(false);
  const [outcome, setOutcome] = useState<ApApproveResult | null>(null); // shown after Approve — no silent close

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.autopilotPlan(pilot.id);
        if (!alive) return;
        setPlan(r.plan);
        const init: Record<string, boolean> = {};
        [...(r.plan.exits || []), ...(r.plan.entries || [])].forEach((t) => { init[t.key] = true; });
        setChecked(init);
      } catch (e: any) {
        if (alive) setErr(e?.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [pilot.id]);

  const trades: ApPlanTrade[] = plan ? [...(plan.exits || []), ...(plan.entries || [])] : [];
  const selectedCount = trades.filter((t) => checked[t.key]).length;
  const isLive = plan?.mode === "live";
  const setAll = (v: boolean) => {
    const next: Record<string, boolean> = {};
    trades.forEach((t) => { next[t.key] = v; });
    setChecked(next);
  };
  const approve = async () => {
    if (!plan) return;
    const approved: ApApproveItem[] = trades.filter((t) => checked[t.key]).map((t) => ({ action: t.action, symbol: t.symbol }));
    setApproving(true);
    try {
      const state = await api.autopilotApprove(pilot.id, approved);
      track("autopilot_approved", { pilot: pilot.id, count: approved.length, mode: plan.mode });
      onApplied(state);
      // Do NOT close silently — surface what actually happened (placed vs skipped + why).
      setOutcome(state.result || { opened: 0, closed: 0 });
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setApproving(false);
    }
  };
  const linkBtn: React.CSSProperties = { background: "transparent", border: "none", color: C.accent, cursor: "pointer", fontWeight: 700, padding: 0 };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)",
      display: "grid", placeItems: "center", zIndex: 1000, padding: 16, direction: rtl ? "rtl" : "ltr" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 96vw)", maxHeight: "90vh",
        overflow: "auto", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16,
        boxShadow: "0 20px 60px rgba(0,0,0,.5)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <ScanLine size={18} color={C.gold} />
          <div style={{ fontWeight: 900, fontSize: 15, color: C.text }}>{he ? "תוצאות ההרצה — אישור" : "Run results — approve"}</div>
          <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 999,
            color: isLive ? "#fff" : C.accent, background: isLive ? C.loss : `${C.accent}22`,
            border: `1px solid ${isLive ? C.loss : `${C.accent}55`}` }}>
            {isLive ? (he ? "לייב · כסף אמיתי" : "LIVE · real money") : (he ? "סימולציה" : "SIM")}
          </span>
          <button onClick={onClose} className="tap44" style={{ marginInlineStart: "auto", background: "transparent", border: "none", color: C.muted, cursor: "pointer" }}><X size={18} /></button>
        </div>

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "18px 4px", color: C.muted, fontSize: 13 }}>
            <Loader2 size={16} className="spin" /> {he ? "מעריך נכסים ובונה תכנית…" : "Evaluating assets & building the plan…"}
          </div>
        )}
        {err && !loading && (<div style={{ color: C.loss, fontSize: 12.5, padding: "10px 0" }}>{he ? "שגיאה: " : "Error: "}{err}</div>)}

        {plan && !loading && (
          <>
            <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 8 }}>
              {he ? `נסרקו ${plan.assetsEvaluated} נכסים` : `${plan.assetsEvaluated} assets evaluated`}
              {isLive && plan.cap != null ? ` · ${he ? "מכסה" : "cap"} ${fmtMoney(plan.remaining)} / ${fmtMoney(plan.cap)}` : ""}
            </div>
            {/* REAL exchange free USDT — the TRUE spendable amount, distinct from the app cap. */}
            {isLive && plan.freeUsdt != null && (
              <div style={{ fontSize: 11.5, marginBottom: 8, fontWeight: 700,
                color: plan.freeUsdt < (plan.perTradeUsd || plan.minNotionalUsd || 0) ? C.loss : C.gain }}>
                {he ? `USDT פנוי ב-${exName} (בפועל): ` : `Real ${exName} free USDT: `}{fmtMoney(plan.freeUsdt)}
                {plan.freeUsdt < (plan.perTradeUsd || plan.minNotionalUsd || 0)
                  ? (he ? " — לא מספיק לקנייה" : " — not enough to buy") : ""}
              </div>
            )}
            {outcome ? (
              <>
                {/* HONEST outcome — placed vs skipped + per-order reasons (no silent close). */}
                {(() => {
                  const placed = outcome.placed ?? ((outcome.opened || 0) + (outcome.closed || 0));
                  const skipped = outcome.skippedCount ?? 0;
                  const none = placed === 0;
                  const good = placed > 0 && skipped === 0;
                  const reasons = (outcome.skips || []).map((s) => s.symbol ? `${s.symbol.replace("/USDT", "")} — ${s.reason}` : s.reason);
                  return (
                    <div style={{ background: none ? `${C.loss}14` : good ? `${C.gain}14` : `${C.gold}14`,
                      border: `1px solid ${none ? `${C.loss}55` : good ? `${C.gain}55` : `${C.gold}55`}`,
                      borderRadius: 10, padding: "10px 12px", margin: "4px 0 10px", color: none ? C.loss : good ? C.gain : C.text }}>
                      <div style={{ fontWeight: 900, fontSize: 13 }}>
                        {he ? `בוצעו ${placed} · דולגו ${skipped}` : `${placed} placed · ${skipped} skipped`}
                      </div>
                      {outcome.reason && (<div style={{ fontSize: 11.5, marginTop: 4, color: C.loss }}>{outcome.reason}</div>)}
                      {reasons.length > 0 && (
                        <ul style={{ margin: "6px 0 0", paddingInlineStart: 16, fontSize: 11, color: C.muted }}>
                          {reasons.slice(0, 8).map((r, i) => (<li key={i}>{r}</li>))}
                        </ul>
                      )}
                      {none && !outcome.reason && reasons.length === 0 && (
                        <div style={{ fontSize: 11.5, marginTop: 4, color: C.muted }}>{he ? "לא בוצעו הזמנות." : "No orders were placed."}</div>
                      )}
                    </div>
                  );
                })()}
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                  <button onClick={onClose} className="tap44" style={{ ...btn(true) }}>{he ? "סגור" : "Done"}</button>
                </div>
              </>
            ) : (
              <>
                {isLive && !plan.eligible && (
                  <div style={{ background: `${C.loss}14`, border: `1px solid ${C.loss}55`, borderRadius: 10, padding: "8px 10px", marginBottom: 8, fontSize: 11.5, color: C.loss }}>
                    {he ? "אישור לא יבצע הזמנות כרגע: " : "Approve will place no orders right now: "}{plan.reason}
                  </div>
                )}
                {trades.length === 0 ? (
                  /* WHY zero? (Yoav #15ER/#1A4X) — surface the real reason instead of a bare
                     "no trades". Distinguishes: empty/stale scan · per-trade below the min
                     order · not enough real USDT · no qualifying signal today (normal). */
                  (() => {
                    const evaluated = Number(plan.assetsEvaluated || 0);
                    const ptu = Number(plan.perTradeUsd || 0);
                    const minN = Number(plan.minNotionalUsd || 0);
                    const nextRun = sim?.nextRunAt;
                    let title: string, body: string;
                    if (evaluated === 0) {
                      title = he ? "הסריקה היומית עדיין ריקה" : "The daily scan is empty right now";
                      body = he ? "אין כרגע נכסים לבדיקה — הסריקה מתרעננת לפי הלו״ז היומי. נסה שוב אחרי הסריקה הבאה."
                                : "There are no assets to evaluate yet — the scan refreshes on the daily schedule. Try again after the next scan.";
                    } else if (isLive && ptu > 0 && minN > 0 && ptu < minN) {
                      title = he ? "גודל העסקה נמוך מהמינימום של הבורסה" : "The per-trade size is below the exchange minimum";
                      body = he ? `כל עסקה תהיה כ-${fmtMoney(ptu)}, מתחת למינימום של ${fmtMoney(minN)} להזמנה. העלה את תקרת הלייב או את האחוז לעסקה כדי לאפשר קנייה. (נסרקו ${evaluated} נכסים.)`
                                : `Each trade would be ~${fmtMoney(ptu)}, below the ${fmtMoney(minN)} minimum order. Raise the live cap or the per-trade % so a buy can be placed. (${evaluated} assets scanned.)`;
                    } else if (isLive && plan.freeUsdt != null && Number(plan.freeUsdt) < Math.max(ptu, minN)) {
                      title = he ? `אין מספיק USDT פנוי ב-${exName}` : `Not enough free USDT on ${exName}`;
                      body = he ? `USDT פנוי בפועל: ${fmtMoney(plan.freeUsdt)}, פחות מגודל עסקה (${fmtMoney(Math.max(ptu, minN))}). הפקד/פנה USDT או הקטן את גודל העסקה.`
                                : `Real free USDT: ${fmtMoney(plan.freeUsdt)}, less than one trade (${fmtMoney(Math.max(ptu, minN))}). Add/free USDT or reduce the per-trade size.`;
                    } else {
                      title = he ? "אין כרגע סיגנל מתאים — זה תקין" : "No qualifying signal right now — this is normal";
                      body = he ? `נסרקו ${evaluated} נכסים, ואף אחד לא עומד כרגע בכלל הכניסה של הטייס (פריצה טרייה שעדיין מעל הרצועה היום). הטייס קונה רק על סיגנל טרי — אין צורך ללחוץ "הרץ עכשיו" שוב; הוא ימשיך לסרוק לבד.`
                                : `${evaluated} assets scanned, and none currently meet the pilot's entry rule (a fresh breakout still above the band today). The pilot only buys on a fresh signal — no need to press "Run now" again; it keeps scanning on its own.`;
                    }
                    return (
                      <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 13px", margin: "4px 0 6px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                          <Info size={15} color={C.gold} />
                          <div style={{ fontSize: 13, fontWeight: 900, color: C.text }}>{title}</div>
                        </div>
                        <div style={{ fontSize: 12, lineHeight: 1.55, color: C.muted }}>{body}</div>
                        {nextRun && (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, fontSize: 11, fontWeight: 800, color: C.faint }}>
                            <Clock size={12} /> {he ? "הרצה מתוזמנת הבאה:" : "Next scheduled run:"} {fmtWhen(nextRun, he)}
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 12, marginBottom: 6, fontSize: 11 }}>
                      <button onClick={() => setAll(true)} style={linkBtn}>{he ? "בחר הכל" : "Select all"}</button>
                      <button onClick={() => setAll(false)} style={linkBtn}>{he ? "נקה" : "Clear"}</button>
                    </div>
                    {plan.exits.length > 0 && (<PlanGroup title={he ? "יציאות מוצעות" : "Proposed exits"} trades={plan.exits} checked={checked} setChecked={setChecked} he={he} kind="exit" />)}
                    {plan.entries.length > 0 && (<PlanGroup title={he ? "כניסות מוצעות" : "Proposed entries"} trades={plan.entries} checked={checked} setChecked={setChecked} he={he} kind="enter" />)}
                  </>
                )}
                {isLive && selectedCount > 0 && plan.eligible && (
                  <div style={{ background: `${C.loss}14`, border: `1px solid ${C.loss}55`, borderRadius: 10, padding: "8px 10px", margin: "8px 0", fontSize: 11.5, color: C.loss, fontWeight: 700 }}>
                    {he ? `אישור יבצע קניות/מכירות אמיתיות בכסף אמיתי ב-${exName}.` : `Approving places REAL buy/sell orders on ${exName} with real money.`}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                  <button onClick={onClose} disabled={approving} className="tap44" style={{ ...btn(false) }}>{he ? "ביטול" : "Cancel"}</button>
                  <button onClick={approve} disabled={approving || selectedCount === 0} className="tap44"
                    style={{ ...btn(true), opacity: (approving || selectedCount === 0) ? 0.5 : 1,
                      background: isLive ? C.loss : undefined, borderColor: isLive ? C.loss : undefined, color: isLive ? "#fff" : undefined }}>
                    {approving ? <Loader2 size={13} className="spin" /> : <Check size={13} />}{" "}
                    {he ? `אשר ${selectedCount}` : `Approve ${selectedCount}`}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Live scan telemetry ───────────────────────────────────────────────────────────
// HONEST status of the daily asset scan that feeds the pilots: a live HH:MM:SS
// countdown to the next scheduled scan (00:05 UTC, computed server-side), a real
// "scanning now" pulse driven by the backend's is_scanning() (not a decorative
// animation), and the last-scan time + how many assets it covered. The pilot dry-run
// batch runs ~5 min after the scan, so a note says so. Ticks client-side each second.
function ScanTelemetry({ scan, he }: { scan?: ApScanStatus; he: boolean }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!scan) return null;
  const scanning = !!scan.scanInProgress;
  const nextMs = scan.nextScanAt ? new Date(scan.nextScanAt).getTime() : null;
  const remain = nextMs != null ? Math.max(0, nextMs - nowMs) : null;
  const hhmmss = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      background: scanning ? `${C.gold}12` : C.bg, border: `1px solid ${scanning ? `${C.gold}66` : C.line}`,
      borderRadius: 12, padding: "8px 12px" }}>
      <style>{`@keyframes apScanPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.6)}}`}</style>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {scanning ? (
          <Loader2 size={16} className="spin" color={C.gold} />
        ) : (
          <span style={{ width: 9, height: 9, borderRadius: 999, background: C.accent, flexShrink: 0,
            animation: "apScanPulse 1.8s ease-in-out infinite" }} />
        )}
        <span style={{ fontSize: 12.5, fontWeight: 800, color: scanning ? C.gold : C.text }}>
          {scanning ? (he ? "סורק נכסים…" : "Scanning assets…") : (he ? "הסריקה הבאה בעוד" : "Next scan in")}
        </span>
        {!scanning && remain != null && (
          <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 800, color: C.text, letterSpacing: 0.5 }}>
            {hhmmss(remain)}
          </span>
        )}
      </div>
      <div style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 10,
        fontSize: 11, color: C.muted, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {scan.symbolCount > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <ScanLine size={12} /> {he ? `${scan.symbolCount} נכסים נסרקו` : `${scan.symbolCount} assets scanned`}
          </span>
        )}
        {scan.lastScanAt && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Clock size={12} /> {he ? "אחרונה:" : "Last:"} {fmtWhen(scan.lastScanAt, he)}
          </span>
        )}
        <span style={{ opacity: 0.8 }}>
          {he ? "· הטייסים רצים ~5 ד׳ אחרי הסריקה" : "· pilots run ~5 min after the scan"}
        </span>
      </div>
    </div>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────────

export default function AutoPilots({ he, rtl, initialPilotId }: { he: boolean; rtl: boolean; initialPilotId?: string | null }) {
  const qc = useQueryClient();
  const mobile = useIsMobile();
  const [wizard, setWizard] = useState<AutoPilot | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialPilotId || null); // detail view target
  const [running, setRunning] = useState(false);
  const [planPilot, setPlanPilot] = useState<AutoPilot | null>(null); // "Run now" → review-plan panel
  // List vs Cards view — the shared, persisted rows/squares toggle used across screens.
  const [view, setView] = useViewMode("algo770_autopilots_view_v1", "list");
  // Phase 2c 4-pilot lineup: by default show ONLY the 4 visible pilots (Pilots 1/2 + DR Crypto
  // + DR Stocks). The older pilots 3/4/5 are hidden here but fully preserved in the backend;
  // owners on this owner-only screen can reveal them via the toggle. UI-only filter.
  const [showHidden, setShowHidden] = useState(false);
  const catalog = useMemo(() => showHidden ? AUTOPILOTS : AUTOPILOTS.filter((p) => p.visible !== false), [showHidden]);
  const hiddenCount = AUTOPILOTS.filter((p) => p.visible === false).length;
  // Dan: the IT editor (Oren) may SEE the pilots (trading/sim data), but only a product OWNER
  // may MANAGE them (arm / run / unload / keys / go-live). A non-owner viewer gets a read-only
  // view; the backend also enforces this (every mutating endpoint stays require_owner).
  const canManage = isOwner();

  // Server-side SIMULATION state (armed pilots + live sim P&L/positions/activity).
  const stateQ = useQuery({ queryKey: AP_STATE_KEY, queryFn: () => api.autopilotsState(), refetchInterval: 30000, staleTime: 15000 });
  const simByPilot = useMemo(() => {
    const m: Record<string, ApSimPilot> = {};
    for (const s of (stateQ.data?.pilots || [])) m[s.pilotId] = s;
    return m;
  }, [stateQ.data]);
  const hasScan = !!stateQ.data?.hasScan;

  const applyState = (data: any) => { qc.setQueryData(AP_STATE_KEY, data); };

  const doArm = async (p: AutoPilot, cfg: ArmedPilot) => {
    if (!canManage) return;   // owner-only (defense-in-depth; the UI controls are hidden + backend is require_owner)
    try {
      const data = await api.autopilotArm({ pilotId: p.id, direction: p.direction, market: p.market,
        nav: cfg.nav, perTradePct: cfg.perTradePct, accountLabel: cfg.accountLabel });
      applyState(data);
      track("autopilot_armed", { pilot: p.id, mode: "simulation" });
    } catch (e: any) {
      alert(he ? `טעינה נכשלה: ${e?.message || e}` : `Load failed: ${e?.message || e}`);
    } finally { setWizard(null); }
  };
  const doDisarm = async (p: AutoPilot) => {
    if (!canManage) return;   // owner-only (defense-in-depth)
    if (!confirm(he ? "לפרוק את הטייס? הפוזיציות המדומות יימחקו." : "Unload this pilot? Its simulated positions will be cleared.")) return;
    try { const data = await api.autopilotDisarm(p.id); applyState(data); track("autopilot_disarmed", { pilot: p.id }); }
    catch (e: any) { alert(he ? `פריקה נכשלה: ${e?.message || e}` : `Unload failed: ${e?.message || e}`); }
  };
  // "Run now" no longer auto-executes — it opens the review panel. The run is computed as
  // a READ-ONLY plan; nothing (sim OR real order) happens until the owner approves there.
  const doRun = (p: AutoPilot) => { if (!canManage) return; track("autopilot_run_now", { pilot: p.id }); setPlanPilot(p); };

  const armedCount = (stateQ.data?.pilots || []).length;
  const openPilot = useMemo(() => AUTOPILOTS.find((p) => p.id === openId) || null, [openId]);

  // DETAIL view.
  if (openPilot) {
    return (
      <>
        <PilotDetail p={openPilot} he={he} rtl={rtl} sim={simByPilot[openPilot.id]} hasScan={hasScan} running={running}
          bybit={stateQ.data?.bybit} live={stateQ.data?.live} canManage={canManage} onApplyState={applyState}
          onBack={() => setOpenId(null)} onArm={() => setWizard(openPilot)}
          onDisarm={() => doDisarm(openPilot)} onRun={() => doRun(openPilot)} />
        {wizard && (
          <ArmWizard p={wizard} he={he} rtl={rtl} onClose={() => setWizard(null)} onArmed={(cfg) => doArm(wizard, cfg)} />
        )}
        {planPilot && (
          <RunPlanPanel pilot={planPilot} sim={simByPilot[planPilot.id]} he={he} rtl={rtl} exName={exLabelOf(stateQ.data?.bybit)} onClose={() => setPlanPilot(null)} onApplied={applyState} />
        )}
      </>
    );
  }

  // GRID view — intro + rich square tiles. Compact so all 5 fit ONE screen (no scroll)
  // on desktop; on true mobile it degrades to a readable stack that may scroll.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, direction: rtl ? "rtl" : "ltr" }}>
      {/* Screen title + owners chip */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0, display: "grid", placeItems: "center", background: C.accentGrad, boxShadow: C.glassHi }}>
          <Rocket size={17} color={ACCENT_INK} />
        </div>
        <div style={{ minWidth: 0 }}>
          {/* Structure pattern: the screen's own name in Home's wordmark visual design. */}
          <WordmarkTitle text={he ? "טייסים אוטומטיים" : "AutoPilots"} size="md" />
          <div style={{ fontSize: 11, color: C.muted }}>{he ? "בחר טייס כדי להבין אותו ולטעון בסימולציה." : "Pick a pilot to understand it and load it in simulation."}</div>
        </div>
        {/* Closed-log — defaults to this screen's source (AutoPilots), toggles to others. */}
        <div style={{ marginInlineStart: "auto" }}><ClosedLogButton defaultSource="autopilot" /></div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 800,
          color: C.gold, background: `${C.gold}18`, border: `1px solid ${C.gold}55`, borderRadius: 999, padding: "4px 10px" }}>
          <Lock size={11} /> {he ? "בעלים בלבד · בדיקה" : "Owners only · testing"}
        </span>
      </div>

      {/* Condensed onboarding strip. */}
      <IntroTiles he={he} />

      {/* Live scan telemetry — countdown to the next daily scan + honest "scanning now". */}
      <ScanTelemetry scan={stateQ.data?.scan} he={he} />

      {/* Toolbar — loaded count / run-all (start) + List/Cards toggle (end). */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: -2, flexWrap: "wrap" }}>
        {canManage && armedCount > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: C.muted, flexWrap: "wrap" }}>
            <span>{he ? `${armedCount} טעונים` : `${armedCount} loaded`}</span>
            {/* Run-all passes EVERY loaded pilot through the run router — so any pilot in
                live mode places a REAL Bybit order. If any loaded pilot is live, warn +
                confirm (and tint the control red) before firing. */}
            {(() => {
              const anyLive = (Object.values(simByPilot) as ApSimPilot[]).some((s) => ((s?.mode || "simulation") === "live"));
              return (
                <>
                <button
                  onClick={async () => {
                    const exN = exLabelOf(stateQ.data?.bybit);
                    if (anyLive && !confirm(he
                      ? `חלק מהטייסים במצב לייב — הרצת כולם תבצע קניות אמיתיות בכסף אמיתי ב-${exN}. להמשיך?`
                      : `Some pilots are LIVE — running all will place REAL orders on ${exN} with real money. Continue?`)) return;
                    setRunning(true);
                    try { applyState(await api.autopilotRun()); } catch { /* noop */ } finally { setRunning(false); }
                  }}
                  disabled={running} className="tap44"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 800,
                    color: anyLive ? "#fff" : C.gold,
                    background: anyLive ? C.loss : `${C.gold}14`,
                    border: `1px solid ${anyLive ? C.loss : `${C.gold}55`}`,
                    borderRadius: 999, padding: "3px 10px", cursor: "pointer", opacity: running ? 0.6 : 1 }}>
                  {running ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}{" "}
                  {anyLive ? (he ? "הרץ את כולם · אמיתי" : "Run all · REAL") : (he ? "הרץ את כולם" : "Run all")}
                </button>
                <InfoTip he={he} align="start" title={he ? "הרץ את כולם" : "Run all"}
                  lines={[he ? "מעביר את כל הטייסים הטעונים דרך נתב ההרצה במעבר אחד." : "Passes every loaded pilot through the run router in one pass.",
                          he ? `טייסי סימולציה — מעבר יבש בלבד. טייס במצב לייב — יבצע פקודה אמיתית ב-${exLabelOf(stateQ.data?.bybit)} (לכן אזהרה + אישור אדום).` : `Simulation pilots — dry-run only. A LIVE pilot — will place a REAL ${exLabelOf(stateQ.data?.bybit)} order (hence the red warning + confirm).`]} />
                </>
              );
            })()}
          </div>
        )}
        {/* Owner-only reveal for the hidden (older) pilots — the user lineup is exactly 4. */}
        {hiddenCount > 0 && (
          <button onClick={() => setShowHidden((v) => !v)} title={he ? "בעלים בלבד" : "Owners only"}
            style={{ marginInlineStart: "auto", fontSize: 10.5, fontWeight: 800, color: C.muted, background: "transparent",
              border: `1px solid ${C.line}`, borderRadius: 999, padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>
            {showHidden ? (he ? `הצג ראשי (4)` : `Show lineup (4)`) : (he ? `הצג הכל (+${hiddenCount})` : `Show all (+${hiddenCount})`)}
          </button>
        )}
        {/* List / Cards toggle — the shared component (styled like the Live/Demo pill). */}
        <ViewToggle view={view} onChange={setView} he={he} style={{ marginInlineStart: hiddenCount > 0 ? 8 : "auto" }} />
      </div>

      {view === "list" ? (
        /* Clean one-line-per-pilot dashboard — the 4-pilot lineup (owners can reveal all). */
        <AutoPilotsDashboard he={he} rtl={rtl} simByPilot={simByPilot} pilots={catalog} onOpenRow={(id) => setOpenId(id)} />
      ) : (
        /* Rich cards — DESKTOP a single row of the visible pilots; MOBILE a readable stack. */
        <div style={{ display: "grid", gap: 10, alignItems: "stretch",
          gridTemplateColumns: mobile ? "repeat(auto-fill, minmax(min(100%, 150px), 1fr))" : `repeat(${catalog.length}, minmax(0, 1fr))` }}>
          {catalog.map((p) => (
            <PilotCard key={p.id} p={p} he={he} rtl={rtl} sim={simByPilot[p.id]} onOpen={() => setOpenId(p.id)} />
          ))}
        </div>
      )}

      {wizard && (
        <ArmWizard p={wizard} he={he} rtl={rtl} onClose={() => setWizard(null)} onArmed={(cfg) => doArm(wizard, cfg)} />
      )}
      {planPilot && (
        <RunPlanPanel pilot={planPilot} sim={simByPilot[planPilot.id]} he={he} rtl={rtl} exName={exLabelOf(stateQ.data?.bybit)} onClose={() => setPlanPilot(null)} onApplied={applyState} />
      )}
    </div>
  );
}
