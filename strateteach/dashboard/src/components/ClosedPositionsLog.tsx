import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "../app/api";
import { C, MONO } from "../theme";
import { useI18n } from "../i18n";
import { ExportBar } from "../ui";

// Closed-positions log — read-only history for review after a close: per position the asset,
// close time, entry/exit price, %P&L (colored), and WHY it closed (stop-loss / take-profit /
// target / manual). DEMO rows are exact (paper engine); LIVE rows are reconciled from the
// exchange (OCO stop/take-profit fill, or a manual sell) with the reason + order id. Newest
// first. Self-contained + shared so it opens from the Trading Engine AND the Home P&L card.

const signed = (v: any) => `${Number(v) >= 0 ? "+" : ""}${Number(v || 0).toFixed(2)}`;
const cardStyle: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14 };
function chip(active: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 6, background: active ? "var(--btn-bg)" : C.surface2, color: active ? "var(--btn-ink)" : C.muted, border: `1px solid ${active ? C.gold : C.line}`, borderRadius: 9, padding: "6px 10px", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" };
}
function pill(c: string): React.CSSProperties {
  return { fontSize: 10, fontWeight: 700, color: c, background: `${c}22`, border: `1px solid ${c}66`, borderRadius: 999, padding: "1px 7px" };
}

type Src = "engine" | "signal_bot" | "autopilot";
export default function ClosedPositionsLog({ onClose: _onClose, defaultSource = "all" }: { onClose?: () => void; defaultSource?: "all" | Src }) {
  const { lang } = useI18n();
  const he = lang === "he";
  const q = useQuery({ queryKey: ["paperClosedLog"], queryFn: () => api.paperClosedLog(), refetchInterval: 20000 });
  const [mode, setMode] = useState<"all" | "demo" | "live">("all");
  // Source filter (checkboxes): engine (Trading Engines) · signal_bot (Signal Bots) · autopilot
  // (AutoPilots/"טיסים"). DEFAULT: ALL sources selected (incl. Engines) so a user's own engine
  // closes are NEVER hidden by default (Dan: engine stop-losses were invisible because Engines
  // wasn't selected). `defaultSource` is kept for callers but no longer EXCLUDES the others — the
  // user can still narrow the filter manually. Selecting none falls back to all (never empty).
  const ALL_SRC: Src[] = ["engine", "signal_bot", "autopilot"];
  const [srcSel, setSrcSel] = useState<Set<Src>>(() => new Set(ALL_SRC));
  const srcLabel = (s: Src) => s === "signal_bot" ? (he ? "סיגנל" : "Signal Bots") : s === "autopilot" ? (he ? "טיסים" : "AutoPilots") : (he ? "מנועים" : "Engines");
  const srcBadge = (s: string) => s === "signal_bot" ? { label: he ? "בוט" : "Bot", c: C.blue } : s === "autopilot" ? { label: he ? "טייס" : "Pilot", c: C.gold } : { label: he ? "מנוע" : "Engine", c: C.muted };
  const toggleSrc = (k: Src) => setSrcSel((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n.size ? n : new Set(ALL_SRC); });
  const rows = (((q.data as any)?.rows || []) as any[]).filter((r) => (mode === "all" || r.mode === mode) && srcSel.has((r.source || "engine") as Src));
  const reasonMeta = (reason: string): { label: string; c: string } => {
    switch (reason) {
      case "stop_loss": return { label: he ? "סטופ-לוס" : "Stop-loss", c: C.loss };
      case "take_profit": return { label: he ? "טייק-פרופיט" : "Take-profit", c: C.gain };
      case "target_hit": return { label: he ? "יעד" : "Target", c: C.gold };
      case "daily_reset": return { label: he ? "איפוס יומי" : "Daily reset", c: C.muted };
      case "live": return { label: he ? "לייב" : "Live", c: C.blue };
      default: return { label: he ? "ידני" : "Manual", c: C.muted };
    }
  };
  const fmtTime = (iso?: string) => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString(he ? "he-IL" : "en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch (_e) { return String(iso).slice(0, 16).replace("T", " "); }
  };
  const num = (v: any, d = 6) => (v == null || v === "" ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));
  return (
    <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: `1px solid ${C.line}`, flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>🧾 {he ? "יומן פוזיציות סגורות" : "Closed positions log"}</span>
        <span style={{ display: "flex", gap: 6 }}>
          {(["all", "demo", "live"] as const).map((m) => <button key={m} onClick={() => setMode(m)} style={chip(mode === m)}>{m === "all" ? (he ? "הכל" : "All") : m === "demo" ? (he ? "דמו" : "Demo") : (he ? "לייב" : "Live")}</button>)}
        </span>
      </div>
      {/* Source filter — show all sources, or each separately, via toggles (Dan). */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderBottom: `1px solid ${C.line}`, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, color: C.faint, fontWeight: 700 }}>{he ? "מקור:" : "Source:"}</span>
        <button onClick={() => setSrcSel(new Set(ALL_SRC))} style={chip(srcSel.size >= 3)}>{he ? "הכל" : "All"}</button>
        {ALL_SRC.map((s) => (
          <button key={s} onClick={() => toggleSrc(s)} style={chip(srcSel.has(s) && srcSel.size < 3)}>
            <span style={{ fontSize: 11 }}>{srcSel.has(s) ? "☑" : "☐"}</span> {srcLabel(s)}
          </button>
        ))}
      </div>
      {/* Export — Email / PDF / Excel of the (filtered) history, like the /activity trades table. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${C.line}`, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, color: C.faint, fontWeight: 700 }}>{rows.length} {he ? "סגירות" : "closes"}</span>
        <ExportBar name="closed-positions" title={he ? "יומן פוזיציות סגורות" : "Closed positions log"} rtl={he}
          headers={[he ? "מתי" : "When", he ? "מקור" : "Source", he ? "סימבול" : "Symbol", he ? "סיבה" : "Reason", he ? "קנייה" : "Buy", he ? "מכירה" : "Sell", he ? "רווח/הפסד" : "P&L", "%", he ? "מצב" : "Mode"]}
          rows={rows.map((r) => [
            r.closedAt ? new Date(r.closedAt).toLocaleString() : "",
            srcLabel((r.source || "engine") as Src),
            `${r.symbol}${r.mode === "live" ? "" : "/USDT"}`,
            reasonMeta(r.reason).label,
            r.entryPrice ?? "", r.closePrice ?? "",
            r.pnl == null ? "" : r.pnl, r.pnlPct == null ? "" : r.pnlPct,
            r.mode === "live" ? "LIVE" : "DEMO",
          ])} />
      </div>
      {q.isLoading ? (
        <div style={{ padding: 16, textAlign: "center", color: C.muted }}><Loader2 size={16} className="spin" /></div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 16, textAlign: "center", color: C.muted, fontSize: 13 }}>{he ? "אין עדיין פוזיציות סגורות" : "No closed positions yet"}</div>
      ) : (
        <div style={{ maxHeight: 440, overflowY: "auto" }}>
          {rows.map((r, i) => {
            const rm = reasonMeta(r.reason);
            const gain = Number(r.pnl ?? r.pnlPct ?? 0) >= 0;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderBottom: `1px solid ${C.line}` }}>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 800, fontSize: 13, whiteSpace: "nowrap" }}>{r.symbol}{r.mode === "live" ? "" : "/USDT"}</span>
                    {(() => { const sb = srcBadge(r.source || "engine"); return <span style={{ ...pill(sb.c), flexShrink: 0 }}>{sb.label}</span>; })()}
                    <span style={{ ...pill(rm.c), flexShrink: 0 }}>{rm.label}</span>
                    <span style={{ ...pill(r.mode === "live" ? C.loss : C.muted), flexShrink: 0 }}>{r.mode === "live" ? "LIVE" : "DEMO"}</span>
                  </span>
                  <span style={{ fontSize: 10.5, color: C.faint, fontFamily: MONO }}>{fmtTime(r.closedAt)} · {he ? "קנייה" : "buy"} {num(r.entryPrice)} → {he ? "מכירה" : "sell"} {num(r.closePrice)}{r.orderId ? ` · #${r.orderId}` : ""}</span>
                </span>
                {/* %P&L + amount on EVERY row — winners AND losers — colored green/red (never hidden). */}
                <span style={{ textAlign: "end", fontFamily: MONO, whiteSpace: "nowrap", flexShrink: 0, color: gain ? C.gain : C.loss }}>
                  <span style={{ display: "block", fontWeight: 800 }}>{r.pnl != null ? signed(r.pnl) : "—"}</span>
                  <span style={{ display: "block", fontSize: 11 }}>{r.pnlPct != null ? `(${r.pnlPct >= 0 ? "+" : ""}${Number(r.pnlPct).toFixed(2)}%)` : "—"}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Small reusable trigger: a compact "🧾 Closed log" button that opens the log as a body-portal
// modal. Used to drop the source-aware log onto any screen with the right context default
// (engine / signal_bot / autopilot). Portal avoids transform/zoom positioning traps; px padding.
export function ClosedLogButton({ defaultSource = "all", label, style }: { defaultSource?: "all" | Src; label?: string; style?: React.CSSProperties }) {
  const { lang } = useI18n();
  const he = lang === "he";
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} title={he ? "יומן פוזיציות סגורות" : "Closed positions log"}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: "5px 11px", color: C.muted, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 800, ...style }}>
        🧾 {label || (he ? "יומן סגירות" : "Closed log")}
      </button>
      {open && createPortal(
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9990, background: "rgba(0,0,0,0.66)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 14px", overflowY: "auto" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", width: "100%", maxWidth: 560 }}>
            <button onClick={() => setOpen(false)} aria-label={he ? "סגור" : "close"}
              style={{ position: "absolute", top: -12, insetInlineEnd: -6, zIndex: 2, width: 30, height: 30, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", background: C.surface2, border: `1px solid ${C.line}`, color: C.muted, cursor: "pointer", fontWeight: 900 }}>✕</button>
            <ClosedPositionsLog onClose={() => setOpen(false)} defaultSource={defaultSource} />
          </div>
        </div>, document.body)}
    </>
  );
}
