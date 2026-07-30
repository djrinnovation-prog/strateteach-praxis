import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, RefreshCw, Loader2 } from "lucide-react";
import { api } from "../app/api";
import { type RunRow } from "../lib/client";
import { useI18n } from "../i18n";
import { C, UI, MONO } from "../theme";

// Admin "Runs report" — every run/position the system logged (live + demo), newest
// first, with duration + result. Read-only view over runs_log. Rendered inside the
// Admin hub's panel (Trading & P&L), so it's child content (no own Back/Home).
export default function RunsReport() {
  const { lang, rtl } = useI18n();
  const TT = (en: string, he: string) => (lang === "he" ? he : en);
  const qc = useQueryClient();
  const [mode, setMode] = useState<"" | "live" | "demo">("");
  const [status, setStatus] = useState<"" | "open" | "closed">("");
  const q = useQuery({ queryKey: ["adminRuns", mode, status], queryFn: () => api.adminRuns({ mode: mode || undefined, status: status || undefined, limit: 1000 }) });
  const runs: RunRow[] = (q.data as any)?.runs || [];

  const fmtTime = (iso: string | null) => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString(lang === "he" ? "he-IL" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch { return "—"; }
  };
  const fmtDur = (s: number | null) => {
    if (s == null) return "—";
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  };
  const money = (v: number | null) => v == null ? "—" : `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const px = (v: number | null) => v == null ? "—" : "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 6 });
  const pcol = (v: number | null) => v == null ? C.muted : v > 0 ? C.gain : v < 0 ? C.loss : C.muted;

  const chip = (active: boolean): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", fontFamily: UI,
    background: active ? "var(--btn-bg)" : C.surface2, color: active ? "var(--btn-ink)" : C.muted,
    border: `1px solid ${active ? C.gold : C.line}`, borderRadius: 9, padding: "6px 11px", fontSize: 12, fontWeight: 700 });
  const tag = (text: string, color: string, bg: string): React.CSSProperties => ({ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.03em", textTransform: "uppercase", color, background: bg, borderRadius: 6, padding: "1px 6px", whiteSpace: "nowrap" });

  return (
    <div style={{ fontFamily: UI, maxWidth: 760 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Activity size={17} color={C.gold} />
        <div style={{ fontSize: 15, fontWeight: 800 }}>{TT("Runs report", "דוח ריצות")}</div>
        <button onClick={() => qc.invalidateQueries({ queryKey: ["adminRuns"] })} title={TT("Refresh", "רענן")}
          style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 6, background: C.surface2, border: `1px solid ${C.line}`, color: C.muted, borderRadius: 9, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: UI }}>
          <RefreshCw size={13} className={q.isFetching ? "spin" : undefined} /> {TT("Refresh", "רענן")}
        </button>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
        {TT("Every run/position the system logged (live + demo), newest first — with how long it ran and its result.",
            "כל ריצה/פוזיציה שתועדה (לייב + דמו), מהחדש לישן — כולל כמה זמן רצה והתוצאה.")}
      </div>

      {/* filters */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {([["", TT("All", "הכל")], ["live", "LIVE"], ["demo", TT("Demo", "דמו")]] as const).map(([k, l]) => (
          <button key={`m${k}`} onClick={() => setMode(k as any)} style={chip(mode === k)}>{l}</button>
        ))}
        <span style={{ width: 1, background: C.line, margin: "0 4px" }} />
        {([["", TT("Any", "כל סטטוס")], ["open", TT("Open", "פתוח")], ["closed", TT("Closed", "סגור")]] as const).map(([k, l]) => (
          <button key={`s${k}`} onClick={() => setStatus(k as any)} style={chip(status === k)}>{l}</button>
        ))}
      </div>

      {q.isLoading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.muted, fontSize: 13, padding: "20px 0" }}>
          <Loader2 size={15} className="spin" /> {TT("Loading…", "טוען…")}
        </div>
      ) : runs.length === 0 ? (
        <div style={{ background: C.surface2, border: `1px dashed ${C.line}`, borderRadius: 12, padding: 22, textAlign: "center", color: C.muted, fontSize: 13 }}>
          {TT("No runs logged yet.", "אין ריצות מתועדות עדיין.")}
        </div>
      ) : (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflowY: "auto", maxHeight: "70svh", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
          {runs.map((r, i) => {
            const live = r.mode === "live";
            const open = r.status === "open";
            return (
              <div key={r.id} style={{ padding: "10px 12px", borderBottom: i < runs.length - 1 ? `1px solid ${C.line}` : "none", background: i % 2 ? "transparent" : C.surface2 }}>
                {/* line 1: who · symbol · side · mode/status */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{r.symbol || "—"}</span>
                  {r.side && <span style={tag(r.side, C.muted, C.surface)}>{r.side}</span>}
                  <span style={tag(live ? "LIVE" : "DEMO", live ? C.loss : C.gain, live ? `${C.loss}22` : `${C.gain}22`)}>{live ? "LIVE" : "DEMO"}</span>
                  <span style={tag(open ? TT("open", "פתוח") : r.status, open ? C.gold : C.muted, open ? `${C.gold}22` : C.surface)}>{open ? TT("open", "פתוח") : (r.status === "stopped" ? TT("stopped", "נעצר") : TT("closed", "סגור"))}</span>
                  {r.source && <span style={tag(r.source === "auto" ? TT("auto", "אוטו") : TT("manual", "ידני"), C.faint, C.surface)}>{r.source === "auto" ? TT("auto", "אוטו") : TT("manual", "ידני")}</span>}
                  <span style={{ marginInlineStart: "auto", fontSize: 11.5, color: C.muted, fontWeight: 700 }}>{r.username || "—"}</span>
                </div>
                {/* line 2: times + duration */}
                <div style={{ fontSize: 11, color: C.faint, marginTop: 4, fontFamily: MONO }}>
                  {fmtTime(r.opened_at)} → {fmtTime(r.closed_at)} · {TT("dur", "משך")} {fmtDur(r.duration_seconds)}
                </div>
                {/* line 3: entry/exit · qty · P&L */}
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>{px(r.entry_price)} → {px(r.exit_price)}{r.qty != null ? ` · ${Number(r.qty).toLocaleString(undefined, { maximumFractionDigits: 6 })}` : ""}</span>
                  <span style={{ marginInlineStart: "auto", fontFamily: MONO, fontSize: 13, fontWeight: 800, color: pcol(r.pnl) }}>
                    {money(r.pnl)}{r.pnl_pct != null ? ` (${r.pnl_pct >= 0 ? "+" : ""}${r.pnl_pct.toFixed(2)}%)` : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ fontSize: 10.5, color: C.faint, marginTop: 8 }}>{runs.length ? `${runs.length} ${TT("runs", "ריצות")}` : ""}</div>
    </div>
  );
}
