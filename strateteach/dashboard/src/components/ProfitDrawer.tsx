import React, { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TrendingUp, X, Loader2, Coins, ShieldAlert } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, MONO } from "../theme";
import { routeFor, normalizeMode, winnersOnly, assertBookMatch, type ProfitMode } from "../lib/closeRouting";

const L = {
  he: { tab: "רווחים", title: "פוזיציות ברווח", total: "סה\"כ רווח פתוח", closeAll: "סגור הכל ברווח",
    none: "אין פוזיציות ברווח כעת", session: "מפגש", closing: "סוגר…", positions: "פוזיציות פתוחות ברווח",
    demoBadge: "מצב דמו · כסף וירטואלי", liveBadge: "מצב לייב · כסף אמיתי",
    demoNote: "פעולות כאן נוגעות אך ורק בחשבון הדמו (כסף וירטואלי).",
    liveNote: "פעולות כאן נוגעות בכסף אמיתי בבורסה המחוברת. כל פעולה דורשת PIN ואישור.",
    closeProfitLive: "סגור פוזיציות ברווח", flattenAll: "סגור הכל → USDT",
    confirmProfit: "לסגור את כל הפוזיציות שברווח בבורסה? כסף אמיתי.",
    confirmFlatten: "למכור את כל האחזקות חזרה ל-USDT? כסף אמיתי — כולל פוזיציות בהפסד." },
  en: { tab: "Profits", title: "Positions in profit", total: "Total open profit", closeAll: "Close all in profit",
    none: "No positions in profit right now", session: "session", closing: "Closing…", positions: "open positions in profit",
    demoBadge: "Demo mode · virtual money", liveBadge: "Live mode · real money",
    demoNote: "Actions here only touch the demo (paper) book — virtual money.",
    liveNote: "Actions here touch real money on the connected exchange. Each one needs a PIN + confirmation.",
    closeProfitLive: "Close positions in profit", flattenAll: "Close all → USDT",
    confirmProfit: "Close every in-profit position on the exchange? Real money.",
    confirmFlatten: "Sell all holdings back to USDT? Real money — includes losing positions." },
};

// Slide-out panel for the Trading engine: every open position currently in profit
// for the active book, with total + per-position profit and a one-tap "close in
// profit". Strict LIVE/DEMO separation is delegated to ../lib/closeRouting so the
// two books can never be mixed by this component.
export default function ProfitDrawer({ mode }: { mode?: ProfitMode | "demo" | "live" | null }) {
  const { lang, rtl } = useI18n();
  const t = L[lang];
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  // Opened from an in-page button (no floating edge tab any more). The Profit
  // screen dispatches this event; we listen for it instead of docking a handle.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("algo770-open-profit-drawer", onOpen);
    return () => window.removeEventListener("algo770-open-profit-drawer", onOpen);
  }, []);

  // Mode is an explicit prop (single source of truth = the Profit screen's state).
  // Only if it isn't supplied do we fall back to the stored flag — and even then
  // normalizeMode() collapses anything non-"live" to the safe demo default.
  const resolvedMode: ProfitMode = normalizeMode(
    mode != null ? mode : (() => { try { return localStorage.getItem("algo770_profit_mode"); } catch { return null; } })(),
  );
  const route = routeFor(resolvedMode);
  const liveMode = route.mode === "live";

  const q = useQuery({
    queryKey: [route.pnlQueryKey],
    queryFn: () => (liveMode ? api.livePnl() : api.paperSessions()),
    enabled: open,
    refetchInterval: open ? 8000 : false,
  });

  // Winners = positions in the green for THIS book only. winnersOnly() is the same
  // filter for both, so the list shown always matches what the close button closes.
  let winners: any[] = [];
  if (liveMode) {
    winners = winnersOnly(((q.data as any)?.positions) || [])
      .map((p: any) => ({ symbol: p.symbol, pnl: p.pnl, pnlPct: p.pnlPct, session: "live" }));
  } else {
    const running = (((q.data as any)?.sessions) || []).filter((s: any) => s.status === "running");
    for (const s of running) {
      for (const p of winnersOnly((s.positions || []).filter((p: any) => p.status === "open"))) {
        winners.push({ ...p, session: s.strategyLabel || s.label, sid: s.id });
      }
    }
  }
  const totalProfit = winners.reduce((a, p) => a + Number(p.pnl || 0), 0);
  // Total % = total profit over the combined cost basis (recovered per-winner from
  // its own pnl/pnlPct), so the headline carries a % like each row does.
  const totalBasis = winners.reduce((a, p) => a + (Number(p.pnlPct) ? Number(p.pnl || 0) / (Number(p.pnlPct) / 100) : 0), 0);
  const totalProfitPct = totalBasis > 0 ? (totalProfit / totalBasis) * 100 : null;
  const liveHasPositions = liveMode && (((q.data as any)?.positions) || []).length > 0;

  // Close only the in-profit positions of the active book. The book guard turns a
  // would-be cross-book call into a thrown error instead of a wrong trade.
  const closeProfitM = useMutation({
    mutationFn: () => {
      assertBookMatch(resolvedMode, route.closeInProfitApi);
      return liveMode ? api.closeProfitable() : api.paperCloseProfitableAll();
    },
    onSuccess: () => route.invalidateKeys.forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
  // Live-only secondary action: fully flatten the book to USDT (winners + losers).
  const flattenM = useMutation({
    mutationFn: () => { assertBookMatch(resolvedMode, route.closeAllApi); return api.closeSpot(); },
    onSuccess: () => route.invalidateKeys.forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });

  const busy = closeProfitM.isPending || flattenM.isPending;
  const canCloseProfit = winners.length > 0 && !busy;
  const runProfit = () => {
    if (liveMode && !window.confirm(t.confirmProfit)) return;
    closeProfitM.mutate();
  };
  const runFlatten = () => { if (window.confirm(t.confirmFlatten)) flattenM.mutate(); };

  const edge = rtl ? "left" : "right";
  const accent = liveMode ? C.loss : C.gain;

  return (
    <>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 55 }} />
          <aside style={{ position: "fixed", top: 0, bottom: 0, [edge]: 0, width: 332, background: C.surface, borderInlineStart: `1px solid ${C.line}`,
            zIndex: 56, display: "flex", flexDirection: "column", boxShadow: "0 0 40px rgba(0,0,0,0.5)" } as React.CSSProperties}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: `1px solid ${C.line}` }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700 }}><TrendingUp size={16} color={accent} /> {t.title}</span>
              <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={16} /></button>
            </div>

            {/* Mode banner — makes the active book (and whether it is real money) unmistakable. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 16px", background: liveMode ? "rgba(240,97,109,0.12)" : "rgba(22,199,126,0.10)",
              borderBottom: `1px solid ${liveMode ? "rgba(240,97,109,0.4)" : "rgba(22,199,126,0.35)"}` }}>
              {liveMode ? <ShieldAlert size={15} color={C.loss} /> : <Coins size={15} color={C.gain} />}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: accent }}>● {liveMode ? t.liveBadge : t.demoBadge}</div>
                <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.4 }}>{liveMode ? t.liveNote : t.demoNote}</div>
              </div>
            </div>

            <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 11, color: C.muted }}>{t.total}</div>
              <div style={{ fontFamily: MONO, fontSize: 26, fontWeight: 800, color: C.gain }}>+${totalProfit.toLocaleString(undefined, { maximumFractionDigits: 2 })}{totalProfitPct != null ? <span style={{ fontSize: 15 }}> ({totalProfitPct >= 0 ? "+" : ""}{totalProfitPct.toFixed(2)}%)</span> : null}</div>
              <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>{winners.length} {t.positions}</div>

              {/* Primary: close only the in-profit positions of the active book. */}
              <button onClick={runProfit} disabled={!canCloseProfit} className={canCloseProfit ? "gbtn gbtn-gain" : undefined}
                style={{ marginTop: 10, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
                  background: canCloseProfit ? undefined : C.surface2, color: canCloseProfit ? undefined : C.muted, border: "none",
                  borderRadius: 10, padding: "10px", fontWeight: 800, fontSize: 13, cursor: canCloseProfit ? "pointer" : "default", fontFamily: "inherit" }}>
                {closeProfitM.isPending ? <><Loader2 size={14} className="spin" /> {t.closing}</>
                  : <><Coins size={15} /> {liveMode ? t.closeProfitLive : t.closeAll}</>}
              </button>

              {/* Live-only secondary: fully flatten to USDT (winners + losers). Clearly distinct. */}
              {liveMode && (
                <button onClick={runFlatten} disabled={busy || !liveHasPositions}
                  style={{ marginTop: 8, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
                    background: "transparent", color: C.loss, border: `1px solid rgba(240,97,109,0.45)`,
                    borderRadius: 10, padding: "9px", fontWeight: 700, fontSize: 12.5, cursor: busy ? "default" : "pointer", fontFamily: "inherit" }}>
                  {flattenM.isPending ? <Loader2 size={14} className="spin" /> : <Coins size={14} />} {t.flattenAll}
                </button>
              )}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
              {q.isLoading ? <div style={mid}><Loader2 size={16} className="spin" /></div>
                : winners.length === 0 ? <div style={mid}>{t.none}</div>
                : winners.map((p, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "9px 0", borderBottom: `1px solid ${C.line}` }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{p.symbol}</div>
                      <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>{p.session} · {Number(p.pnlPct || 0).toFixed(2)}%</div>
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 13, color: C.gain, whiteSpace: "nowrap", fontWeight: 700 }}>+${Number(p.pnl || 0).toFixed(2)}</div>
                  </div>
                ))}
            </div>
          </aside>
        </>
      )}
      <style>{".spin{animation:spin 0.8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}"}</style>
    </>
  );
}

const mid: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, padding: "40px 0", textAlign: "center", fontSize: 13 };
