import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, TrendingUp, ChevronDown, ChevronRight, X, Diamond } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, MONO } from "../theme";
import { ErrorState } from "./StateBlock";
import { toastError, toastSuccess } from "../lib/toast";
import { raceTimeout } from "../lib/money";
import { useViewMode, ViewToggle } from "./ViewToggle";

// DEMO open-positions panel — the paper-trading twin of the LIVE PositionsWidget,
// shown on Home ONLY when no exchange is connected (the "Demo" view). It renders the
// user's open demo (paper) positions with the SAME card chrome, collapsed header and
// growth breakdown as the live widget, so the demo Home looks/behaves like the live
// one. Data comes from /exchange/paper/state (open positions marked to market): the
// portfolio VALUE, the capital deployed (deposited), and their growth (value − cost).
// Each row can be closed (paper close — demo funds only, no real money, no PIN).
export default function DemoPositionsWidget({ toggle, bare = false }: { toggle?: React.ReactNode; bare?: boolean } = {}) {
  const { lang } = useI18n();
  const he = lang === "he";
  const nav = useNavigate();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState<string>("");
  // Shared rows/squares view toggle (mirrors the live PositionsWidget).
  const [view, setView] = useViewMode("algo770_positions_view_v1", "list");

  // The DEMO (paper) portfolio renders INDEPENDENTLY of the exchange connection, so
  // Home shows BOTH portfolios together (live panel + demo panel). It renders whenever
  // there are open demo positions — regardless of whether a live exchange is connected.
  const stateQ = useQuery({ queryKey: ["paperState"], queryFn: () => api.paperState(), retry: false, refetchInterval: 15000, refetchOnWindowFocus: true });
  const s: any = stateQ.data;
  const positions: any[] = Array.isArray(s?.positions) ? s.positions : [];
  const open = positions.filter((x) => (x?.status ? x.status === "open" : true) && Number(x.value || 0) >= 1);
  // Demo portfolio frame (mirrors live value / deposited / growth):
  const value: number | null = s ? Number(s.totalValue || 0) : null;      // Σ open positions' current value
  const deposited: number | null = s ? Number(s.totalCost || 0) : null;    // capital deployed into them
  const growthPnl: number | null = s ? Number(s.totalPnl || 0) : null;     // value − deposited (unrealized)
  const growthPct: number | null = s && s.totalPnlPct != null ? Number(s.totalPnlPct) : null;

  const closeM = useMutation({
    mutationFn: (v: { sessionId: number; id: number }) => raceTimeout(api.paperClose(v.sessionId, v.id)),
    onSuccess: (_r: any, v) => {
      setClosing("");
      ["paperState", "paperSessions", "dashboardLive"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toastSuccess(he ? "הפוזיציה נסגרה (דמו)" : "Position closed (demo)");
      void v;
    },
    onError: (e: any) => { setClosing(""); toastError(he ? "סגירת הפוזיציה נכשלה" : "Couldn't close the position", { body: String(e?.message || e) }); },
  });

  // This is the ACTIVE positions panel when demo mode is selected, so it always renders
  // (it shows an empty state when there are no open demo positions) — the parent decides
  // whether to mount it via the live/demo toggle.
  const signed = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const money = (v: number | null) => v == null ? "—" : "$" + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const px = (v: any) => { const n = Number(v); return !n || isNaN(n) ? "—" : "$" + n.toLocaleString(undefined, { maximumFractionDigits: 6 }); };

  return (
    <div style={bare
      ? { direction: he ? "rtl" : "ltr" }
      : { background: `linear-gradient(135deg, ${C.gold}3d, ${C.gold}1f), ${C.surface}`, border: `1.5px solid ${C.gold}`, borderRadius: 13, padding: "9px 11px", marginBottom: 5, boxShadow: "0 10px 24px -16px rgba(0,0,0,0.3)", direction: he ? "rtl" : "ltr" }}>
      {!bare && (
      <div style={{ display: "flex", alignItems: "center", gap: 8, direction: he ? "rtl" : "ltr" }}>
      <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0, color: C.text, direction: he ? "rtl" : "ltr" }}>
        {expanded ? <ChevronDown size={15} color={C.muted} /> : <ChevronRight size={15} color={C.muted} style={{ transform: he ? "scaleX(-1)" : "none" }} />}
        <TrendingUp size={13} color={C.gold} />
        <span style={{ fontSize: 11.5, fontWeight: 800, color: C.text }}>{he ? "פוזיציות דמו פתוחות" : "Demo open positions"} ({open.length})</span>
        {/* Collapsed summary = the demo positions' OWN aggregate unrealized P&L (for the
            demo portfolio this equals value − deployed = totalPnl, since it's bounded to
            the open positions). Labeled as P&L (not "growth") to match the live panel and
            avoid duplicating the P&L card's headline. */}
        {!expanded && (
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4, marginInlineStart: "auto" }}>
            {growthPnl != null && open.length > 0 ? (
              <>
                <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 800, color: growthPnl >= 0 ? C.gain : C.loss }}>
                  {signed(growthPnl)}{growthPct != null ? ` (${growthPct >= 0 ? "+" : ""}${growthPct.toFixed(2)}%)` : ""}
                </span>
                <span style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, whiteSpace: "nowrap" }}>{he ? "רווח/הפסד" : "P&L"}</span>
              </>
            ) : (
              <span style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>{he ? "אין פוזיציות" : "no positions"}</span>
            )}
          </span>
        )}
      </button>
        {toggle}
      </div>
      )}

      {(bare || expanded) && (<>
        {/* rows/squares toggle — only meaningful when there are positions to lay out. */}
        {open.length > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 9, marginBottom: -3 }}>
            <ViewToggle view={view} onChange={setView} he={he} />
          </div>
        )}
        {/* list → bordered striped table box; cards → real 2-up card grid. The grid floor
            is 158px — below half a ~360px phone's content width so `auto-fill` yields 2
            columns on mobile (a higher floor collapses to 1 column and mimics List). */}
        <div style={view === "cards"
          ? { marginTop: 9, display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 158px), 1fr))" }
          : { marginTop: 9, border: `1px solid ${C.line}`, borderRadius: 10, background: C.surface, overflow: "hidden" }}>
          {stateQ.isError ? (
            <div style={{ padding: 10, gridColumn: "1 / -1" }}><ErrorState compact onRetry={() => stateQ.refetch()} retrying={stateQ.isFetching} screen="demo_positions_widget"
              title={he ? "לא הצלחנו לטעון פוזיציות דמו" : "Couldn't load demo positions"} /></div>
          ) : stateQ.isLoading ? (
            <div style={{ padding: "12px", color: C.muted, fontSize: 12.5, gridColumn: "1 / -1" }}><Loader2 size={14} className="spin" /></div>
          ) : open.length === 0 ? (
            <div style={{ padding: "12px", color: C.muted, fontSize: 12.5, gridColumn: "1 / -1" }}>{he ? "אין פוזיציות דמו פתוחות כעת." : "No open demo positions right now."}</div>
          ) : open.map((w, i) => {
            const base = String(w.symbol || w.asset || "").split("/")[0];
            const pnl = Number(w.pnl);
            const hasPnl = w.pnl != null && !isNaN(pnl);
            const col = !hasPnl ? C.muted : pnl > 0 ? C.gain : pnl < 0 ? C.loss : C.muted;
            const key = `${w.sessionId}:${w.id}`;
            const rowClosing = closing === key;
            const canClose = w.sessionId != null && w.id != null;
            const meta = `${Number(w.qty || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} · ${px(w.entryPrice)} → ${px(w.currentPrice)}`;
            const pctStr = w.pnlPct != null ? `${Number(w.pnlPct) >= 0 ? "+" : ""}${Number(w.pnlPct).toFixed(2)}%` : "";
            /* Per-position close — demo (paper) funds only, so no confirm/PIN. Same small
               red round X as the live widget (fixed 27px circle). Shared by the list row
               and the card so close behaviour is byte-identical across views. */
            const closeBtn = (
              <button
                onClick={(e) => { e.stopPropagation(); if (canClose && !closeM.isPending) { setClosing(key); closeM.mutate({ sessionId: Number(w.sessionId), id: Number(w.id) }); } }}
                disabled={!canClose || rowClosing || closeM.isPending}
                title={he ? `סגור את פוזיציית הדמו ב-${base}` : `Close demo ${base} position`}
                aria-label={he ? `סגור את פוזיציית הדמו ב-${base}` : `Close demo ${base} position`}
                style={{ flexShrink: 0, alignSelf: "center", padding: 7, margin: -7, background: "none", border: "none", cursor: canClose ? "pointer" : "default", display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: (!canClose || rowClosing || closeM.isPending) ? 0.5 : 1 }}>
                <span style={{ width: 27, height: 27, minWidth: 27, minHeight: 27, flexShrink: 0, alignSelf: "center", borderRadius: 9999, background: "var(--btn-loss-bg)", border: "1px solid var(--btn-loss-bd)", color: "var(--btn-loss-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 0, pointerEvents: "none" }}>
                  {rowClosing ? <Loader2 size={14} className="spin" /> : <X size={14} />}
                </span>
              </button>
            );
            /* CARDS: a genuinely different compact vertical card (symbol + close-X on top,
               qty/entry→current meta, then a PROMINENT P&L line) — not the horizontal row. */
            if (view === "cards") return (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 5, padding: "9px 11px", border: `1px solid ${C.line}`, borderRadius: 10, background: C.surface2, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{base}</span>
                  {closeBtn}
                </div>
                <span style={{ fontFamily: MONO, fontSize: 10, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{meta}</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 1 }}>
                  <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 900, color: col }}>{hasPnl ? signed(pnl) : "—"}</span>
                  <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 700, color: col }}>{pctStr}</span>
                </div>
              </div>
            );
            /* LIST: the original striped full-width horizontal row. */
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 11px", borderTop: i ? `1px solid ${C.line}` : "none", background: i % 2 ? "transparent" : C.surface2 }}>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{base}</span>
                  <span style={{ display: "block", fontFamily: MONO, fontSize: 10.5, color: C.muted }}>{meta}</span>
                </span>
                <span style={{ textAlign: he ? "left" : "right", fontFamily: MONO, flexShrink: 0 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, color: col }}>{hasPnl ? signed(pnl) : "—"}</span>
                  <span style={{ display: "block", fontSize: 10.5, color: col }}>{pctStr}</span>
                </span>
                {closeBtn}
              </div>
            );
          })}
        </div>

        {/* GROWTH breakdown — identical frame to the live widget: portfolio value vs. the
            demo capital deployed, and their growth. Honest, bounded (open positions only —
            never the cumulative-turnover figure). */}
        {open.length > 0 && (
          <div style={{ marginTop: 9, borderTop: `1px solid ${C.line}`, paddingTop: 9, display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
              <span style={{ color: C.muted }}>{he ? "שווי התיק (דמו)" : "Portfolio value (demo)"}</span>
              <span style={{ fontFamily: MONO, fontWeight: 800, color: C.text }}>{money(value)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
              <span style={{ color: C.muted }}>{he ? "הון שהושקע" : "Capital deployed"}</span>
              <span style={{ fontFamily: MONO, fontWeight: 800, color: C.text }}>{money(deposited)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 12, borderTop: `1px dashed ${C.line}`, paddingTop: 6, marginTop: 1 }}>
              <span style={{ color: C.text, fontWeight: 800 }}>{he ? "צמיחה" : "Growth"}</span>
              <span style={{ fontFamily: MONO, fontWeight: 900, color: (growthPnl ?? 0) >= 0 ? C.gain : C.loss }}>{signed(growthPnl ?? 0)}{growthPct != null ? ` (${growthPct >= 0 ? "+" : ""}${growthPct.toFixed(2)}%)` : ""}</span>
            </div>
          </div>
        )}

        {/* Manage in the Trading Engine — demo positions are opened/managed there. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 9 }}>
          <button onClick={() => nav("/profit")} className="gbtn ptile"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
            <Diamond size={13} /> {he ? "נהל במנוע המסחר" : "Manage in Trading Engine"}
          </button>
        </div>
      </>)}
    </div>
  );
}
