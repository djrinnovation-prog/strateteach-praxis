import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Loader2, TrendingUp, ChevronDown, ChevronRight, X, Activity } from "lucide-react";
import { api, loadExchangeCreds } from "../app/api";
import { useI18n } from "../i18n";
import { C, MONO } from "../theme";
import { winnersOnly } from "../lib/closeRouting";
import ConfirmModal from "./ConfirmModal";
import { ErrorState } from "./StateBlock";
import { toastError, toastSuccess } from "../lib/toast";
import { raceTimeout, honestMoneyError } from "../lib/money";
import { mapExchangeError } from "../lib/exchangeErrors";
import { track } from "../lib/analytics";
import { useViewMode, ViewToggle } from "./ViewToggle";
import { BreakoutChip, BreakoutDetail, breakoutStatus, buildSignalMap, WeekTrendArrow } from "./BreakoutInfo";
import InfoTip from "./InfoTip";
import CloseButtons from "./CloseButtons";

// LIVE open-positions panel — shown at the top of Home + the Trading Engine.
// Collapsed by default behind a "Live open positions (N)" tab (chevron); tapping
// expands the list. Each row: symbol, qty, entry → current price, P&L $ + %.
// The "Close in profit" button is TRANSPARENT: its label states exactly what will
// close (count · total $ · %), using the SAME predicate as the server's
// close_profitable_spot — in-profit (pnl > 0) AND non-dust (value ≥ $1) holdings —
// so the display never overstates what the action closes. Real money, no confirm
// (per request); the label is the safeguard. Always renders (connect/loading/empty states).
// `toggle` is an optional live/demo segmented control rendered in the header — Home passes
// it so the whole positions area is ONE panel with a mode switch (not two stacked panels).
export default function PositionsWidget({ toggle, bare = false }: { toggle?: React.ReactNode; bare?: boolean } = {}) {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const nav = useNavigate();
  const qc = useQueryClient();
  const connected = !!loadExchangeCreds();
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  // Which position row has its breakout-detail expanded (by symbol; "" = none).
  const [infoSym, setInfoSym] = useState<string>("");
  // Shared rows/squares view toggle (default rows — positions were a row list before).
  const [view, setView] = useViewMode("algo770_positions_view_v1", "list");

  // Decision-support (Yoav #1WCY): the cached daily breakout scan, matched to each
  // open position by symbol so a row can show the breakout date, distance to the
  // breakout line, yesterday/today momentum, and a LIVE green/grey/red status —
  // the very data the user needs to judge whether the profit ratio still holds.
  // READ-ONLY: pure display of already-computed scan fields (never recomputes,
  // never touches money). Cheap cached endpoint, refreshed on the live cadence.
  const scanQ = useQuery({ queryKey: ["dailyScan"], queryFn: () => api.dailyScan(), staleTime: 60000, refetchInterval: 60000, retry: 1 });
  const sigMap = buildSignalMap((scanQ.data as any)?.results);

  // ONE query feeds BOTH the rendered rows AND the "Close in profit" summary below,
  // so they are a single source of truth: the aggregate is summed from the exact same
  // `positions` the rows render → the P&L can never lag the positions (they update in
  // the very same render tick). Poll on the app's live cadence (15s, matching
  // dashboardLive) + refetch on window focus so rows+summary refresh atomically and
  // the panel stays close to the live market instead of trailing it by ~30s.
  const pnlQ = useQuery({ queryKey: ["livePnl"], queryFn: () => api.livePnl(), enabled: connected, retry: false, refetchInterval: 15000, refetchOnWindowFocus: true });
  const p: any = pnlQ.data;
  const positions: any[] = p?.ok ? (p.positions || []) : [];
  // Open positions = real (non-dust) holdings. Dust (<$1, e.g. a sell remainder) is
  // hidden — and excluded from the close-set, mirroring the server.
  const open = positions.filter((x) => Number(x.value || 0) >= 1);
  const winners = winnersOnly(open);                       // in-profit, non-dust → exactly what closes
  const wn = winners.length;
  // WINNERS-only aggregate — used ONLY by the "Close in profit" button (it must state
  // exactly what that action closes: the in-profit set's $ and %).
  const profit = winners.reduce((s, w) => s + (Number(w.pnl) || 0), 0);
  const cost = winners.reduce((s, w) => s + ((Number(w.value) || 0) - (Number(w.pnl) || 0)), 0);
  const profitPct = cost > 0 ? (profit / cost) * 100 : null;
  // PORTFOLIO unrealized return over ALL open (non-dust) positions that have a known
  // cost basis — value-weighted (Σ P&L / Σ cost-basis), i.e. the honest sum of the
  // rows below (winners AND losers). This is what the collapsed header shows, so a mix
  // of +/− positions reads correctly instead of the old winners-only figure (which
  // looked misleadingly high). Prefer the backend's totalPnlPct (identical basis),
  // fall back to a client compute so the header is never blank.
  const withBasis = open.filter((w) => w.pnl != null && !isNaN(Number(w.pnl)));
  const allPnl = withBasis.reduce((s, w) => s + Number(w.pnl), 0);
  const allBasis = withBasis.reduce((s, w) => s + ((Number(w.value) || 0) - Number(w.pnl)), 0);
  const allPct = (p?.totalPnlPct != null && !isNaN(Number(p.totalPnlPct)))
    ? Number(p.totalPnlPct)
    : (allBasis > 0 ? (allPnl / allBasis) * 100 : null);
  // "Close all" button hue tracks the SIGN of the combined open P&L (Yoav #CEQA):
  // GREEN when closing everything nets a profit, RED on a net loss, neutral/gray at
  // exactly $0 (threshold at the displayed 2-dp so a rounded $0.00 isn't tinted) or
  // when there's nothing to close. Display-only — the close action is unchanged.
  const closeAllTone: "gain" | "loss" | "neutral" =
    open.length === 0 || Math.abs(allPnl) < 0.005 ? "neutral" : allPnl > 0 ? "gain" : "loss";
  // HEADLINE for the summary = portfolio GROWTH vs. deposited capital (value − deposit),
  // NOT the sum of open positions. Server-computed; null when no deposit is recorded.
  const growthPnl: number | null = p?.growthPnl != null && !isNaN(Number(p.growthPnl)) ? Number(p.growthPnl) : null;
  const growthPct: number | null = p?.growthPct != null && !isNaN(Number(p.growthPct)) ? Number(p.growthPct) : null;

  // (The close-in-profit + close-all mutations moved to the shared CloseButtons component, which
  //  both /profit and the /overview dashboard render. Same closeProfitable()/closeSpot() + confirm.)

  // Per-position MANUAL close (the row "X"): closes THAT one position by reusing the
  // exact single-position close mechanic already in production (LivePositions) — a
  // 100% spot market SELL back to USDT via /exchange/order. It runs on the SAME
  // account/env that holds the position (active-account creds → LIVE real order vs
  // testnet/demo paper), scoped per-user + PIN-gated, so no new trade behavior is
  // introduced. Unlike the "close in profit" button below, this closes regardless of
  // P&L (manual), so it's gated behind an explicit confirm to prevent accidental sells.
  const [closing, setClosing] = useState<string>("");
  // Financial-safety gate (additive): a preview + confirm before any real-money close.
  const [confirm, setConfirm] = useState<Omit<React.ComponentProps<typeof ConfirmModal>, "onClose"> | null>(null);
  const isLive = String((loadExchangeCreds() as any)?.env || "").toLowerCase() === "live";
  const closeOneM = useMutation({
    mutationFn: (sym: string) => raceTimeout(api.placeOrder({ symbol: sym, side: "sell", pct: 100, orderType: "market", market: "spot" })),
    onSuccess: (r: any, sym: string) => {
      setClosing("");
      const base = String(sym).split("/")[0];
      // place_order returns {ok:false, message} on a rejected order WITHOUT throwing,
      // so check ok explicitly — a silent failure would otherwise read as success.
      if (r?.ok !== false) {
        ["livePnl", "exBalanceOv", "exPositionsOv", "tkPrices", "allAccountsPnl"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        setNote({ text: he ? `נסגרה ${base} ✓` : `Closed ${base} ✓`, ok: true });
        track("position_close", { op: "close_position" });
      } else {
        setNote({ text: (he ? `הסגירה נכשלה (${base}): ` : `Close failed (${base}): `) + mapExchangeError(r?.message, he).friendly, ok: false });
        toastError(he ? `סגירת ${base} נדחתה` : `Close order for ${base} was rejected`, { body: mapExchangeError(r?.message, he).friendly });
      }
      setTimeout(() => setNote(null), 6000);
    },
    onError: (e: any, sym: string) => { setClosing(""); setNote({ text: (he ? "שגיאה: " : "Error: ") + mapExchangeError(e, he).friendly, ok: false }); setTimeout(() => setNote(null), 8000); honestMoneyError(e, he ? `סגירת ${String(sym).split("/")[0]} נכשלה` : `Couldn't close ${String(sym).split("/")[0]}`, lang, undefined, "close_position"); },
  });
  const signedPnl = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const closeOne = (sym: string) => {
    if (closeOneM.isPending) return;
    const base = String(sym).split("/")[0];
    const w = open.find((x) => String(x.symbol || `${String(x.asset || "").split("/")[0]}/USDT`) === sym);
    const pnl = w ? Number(w.pnl) : NaN;
    const hasPnl = w && w.pnl != null && !isNaN(pnl);
    const envLine = isLive
      ? (he ? "מצב חי — כסף אמיתי. לא ניתן לבטל." : "LIVE — real money. Cannot be undone.")
      : (he ? "טסטנט (כסף דמו)." : "Testnet (demo funds).");
    setConfirm({
      title: he ? "סגירת פוזיציה" : "Close position",
      intro: he ? "תימכר כל האחזקה חזרה ל-USDT." : "Sells the whole holding back to USDT.",
      rows: [
        { label: he ? "סמל" : "Symbol", value: base, color: C.gold },
        { label: he ? "רווח/הפסד נוכחי" : "Current P&L", value: hasPnl ? signedPnl(pnl) : "—", color: !hasPnl ? C.muted : pnl >= 0 ? C.gain : C.loss },
      ],
      risk: envLine,
      confirmLabel: he ? "סגור פוזיציה" : "Close position",
      tone: "loss",
      onConfirm: async () => { setClosing(sym); const r: any = await closeOneM.mutateAsync(sym); if (r?.ok === false) throw new Error(r?.message || ""); },
    });
  };

  // The panel ALWAYS renders (never gated away on a missing/loading exchange — that is
  // what made it vanish and left the Home showing demo-only). When not connected it
  // shows a connect prompt; loading shows a spinner; connected+empty shows "no positions".
  const has = wn > 0;
  const signed = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const px = (v: any) => { const n = Number(v); return !n || isNaN(n) ? "—" : "$" + n.toLocaleString(undefined, { maximumFractionDigits: 6 }); };
  const syms = winners.map((w) => String(w.asset || w.symbol || "").split("/")[0]).filter(Boolean);
  const symList = syms.slice(0, 4).join(", ") + (syms.length > 4 ? "…" : "");

  // Clean card + rounded rows — a VISUAL SIBLING of the AutoPilots home panel
  // (ActiveAutoPilotsPanel): soft glassTint card, glass border, inner-highlight bevel.
  const rowCard: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 11, padding: "8px 11px", boxShadow: C.glassHi };
  return (
    <div style={bare
      ? { direction: he ? "rtl" : "ltr" }
      : { background: C.glassTint, border: `1px solid ${C.glassBd}`, borderRadius: 16, padding: 11, marginBottom: 5,
          boxShadow: `0 6px 16px -12px rgba(0,0,0,0.42), ${C.glassHi}`, direction: he ? "rtl" : "ltr" }}>
      {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
      {/* Summary bar — hidden in `bare` mode (the unified frame supplies its own header). */}
      {!bare && (
      <div style={{ display: "flex", alignItems: "center", gap: 9, direction: he ? "rtl" : "ltr" }}>
        <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="tap44"
          style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 9, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0, color: C.text, textAlign: he ? "right" : "left" }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0, display: "grid", placeItems: "center", background: C.accentGrad, boxShadow: C.glassHi }}>
            <TrendingUp size={16} color="#0B0613" />
          </div>
          <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 13.5, fontWeight: 900, color: C.text, lineHeight: 1.1, whiteSpace: "nowrap" }}>{he ? "פוזיציות לייב" : "Live positions"}</span>
            <span style={{ fontSize: 10, fontWeight: 800, color: C.gold, background: `${C.gold}18`, border: `1px solid ${C.gold}55`, borderRadius: 999, padding: "1px 7px" }}>{open.length}</span>
          </div>
          {connected && open.length > 0 ? (
            <div style={{ textAlign: he ? "left" : "right", flexShrink: 0, marginInlineStart: "auto" }}>
              <div style={{ fontSize: 13.5, fontWeight: 900, color: allPnl >= 0 ? C.gain : C.loss, fontFamily: MONO, lineHeight: 1, direction: "ltr" }}>
                {signed(allPnl)}{allPct != null ? ` (${allPct >= 0 ? "+" : ""}${allPct.toFixed(2)}%)` : ""}
              </div>
              <div style={{ fontSize: 8.5, fontWeight: 800, color: C.faint, marginTop: 2 }}>{he ? "רווח/הפסד" : "P&L"}</div>
            </div>
          ) : !connected ? (
            <span style={{ marginInlineStart: "auto", fontSize: 11, fontWeight: 800, color: C.gold, whiteSpace: "nowrap" }}>{he ? "חבר בורסה ←" : "connect →"}</span>
          ) : (
            <span style={{ marginInlineStart: "auto", fontSize: 11, fontWeight: 700, color: C.muted }}>{he ? "אין פוזיציות" : "no positions"}</span>
          )}
        </button>
        {toggle}
        <button onClick={() => setExpanded((v) => !v)} aria-label={expanded ? "collapse" : "expand"} className="tap44"
          style={{ flexShrink: 0, display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 8, background: C.surface2, border: `1px solid ${C.line}`, color: C.muted, cursor: "pointer" }}>
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} style={{ transform: he ? "scaleX(-1)" : "none" }} />}
        </button>
      </div>
      )}

      {(bare || expanded) && (<>
        {/* rows/squares toggle — only meaningful when there are positions to lay out. */}
        {connected && open.length > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10, marginBottom: -2 }}>
            <ViewToggle view={view} onChange={setView} he={he} />
          </div>
        )}
        {/* (#1Y8N) Removed the staleness/reassurance hint row per Yoav — the last-known
            positions still render on a failed background poll (the #1FE3 no-blank guard is
            unchanged); we simply no longer show the "couldn't refresh, retrying…" line. */}
        {/* positions list — clean rounded rows (matches the AutoPilots list). */}
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {!connected ? (
            <div style={{ ...rowCard, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
              <span style={{ color: C.muted, fontSize: 12.5 }}>{he ? "חברו בורסה כדי לראות את הפוזיציות החיות שלכם." : "Connect an exchange to see your live positions."}</span>
              <button onClick={() => nav("/exchange?sec=connect")} className="gbtn ptile"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 13px", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
                {he ? "חבר בורסה ←" : "Connect exchange →"}
              </button>
            </div>
          ) : (pnlQ.isError && !p) ? (
            /* Only show the error card when we have NOTHING to show. A FAILED
               BACKGROUND POLL keeps the last-good `p` (React-Query retains data on a
               refetch error), so we fall through to render the last-known positions
               instead of blanking the list — that background-blank was the "positions
               disappear consistently" bug (#1FE3): with retry:false a single 15s poll
               hiccup flipped isError and wiped the whole list until the next good poll. */
            <div style={rowCard}><ErrorState compact onRetry={() => pnlQ.refetch()} retrying={pnlQ.isFetching} screen="positions_widget"
              title={he ? "לא הצלחנו לטעון פוזיציות" : "Couldn't load positions"} /></div>
          ) : (pnlQ.isLoading && !p) ? (
            <div style={{ ...rowCard, color: C.muted, fontSize: 12.5 }}><Loader2 size={14} className="spin" /></div>
          ) : open.length === 0 ? (
            <div style={{ ...rowCard, color: C.muted, fontSize: 12.5 }}>{he ? "אין פוזיציות פתוחות כעת." : "No open positions right now."}</div>
          ) : (
            /* cards → real 2-up card GRID (compact vertical position cards); list →
               `display:contents` so rows stay direct children of the flex column above
               (identical to the original row layout). The grid floor is 158px — deliberately
               BELOW half a ~360px phone's content width so `auto-fill` yields 2 columns on
               mobile (a higher floor collapses to 1 column and looks identical to List). */
            <div style={view === "cards"
              ? { display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 158px), 1fr))" }
              : { display: "contents" }}>
            {open.map((w, i) => {
            const base = String(w.asset || w.symbol || "").split("/")[0];
            const sym = String(w.symbol || `${base}/USDT`);
            const pnl = Number(w.pnl);
            const hasPnl = w.pnl != null && !isNaN(pnl);
            const col = !hasPnl ? C.muted : pnl > 0 ? C.gain : pnl < 0 ? C.loss : C.muted;
            const rowClosing = closing === sym;
            const meta = `${Number(w.qty || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} · ${px(w.avgCost)} → ${px(w.price)}`;
            const pctStr = w.pnlPct != null ? `${Number(w.pnlPct) >= 0 ? "+" : ""}${Number(w.pnlPct).toFixed(2)}%` : "";
            // Decision-support (#1WCY): the matching daily-scan breakout signal for
            // this symbol (by base). A per-row chevron expands the full detail so the
            // row stays uncluttered.
            const sig = sigMap[base];
            const bstat = breakoutStatus(sig);
            const infoOpen = infoSym === sym;
            // The "נתונים" (data) button now renders on EVERY row incl. the last (Yoav
            // #1VXL): it was gated on a breakout scan match, so rows without coverage
            // (often the smallest/last one) silently dropped it. When there's no scan
            // data we still show the button in a neutral state — tapping it opens the
            // detail panel, which already explains "no fresh breakout data" gracefully.
            const infoTone = bstat === "green" ? C.gain : bstat === "red" ? C.loss : bstat === "grey" ? C.gold : C.muted;
            const infoBtn = (
              <button
                onClick={(e) => { e.stopPropagation(); setInfoSym(infoOpen ? "" : sym); }}
                title={sig ? (he ? "מידע פריצה — לקבלת החלטת מכירה" : "Breakout info — for the sell decision")
                           : (he ? "נתונים — אין נתוני פריצה עדכניים לסמל זה" : "Data — no fresh breakout data for this symbol")}
                aria-label={he ? "נתונים" : "Data"} aria-expanded={infoOpen}
                style={{ flexShrink: 0, alignSelf: "center", padding: 6, margin: -6, background: "none", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ width: 24, height: 24, minWidth: 24, borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center",
                  background: infoOpen ? `${C.gold}20` : C.surface2, border: `1px solid ${bstat ? infoTone + "66" : C.line}`, color: infoTone }}>
                  <Activity size={13} />
                </span>
              </button>
            );
            /* Per-position manual close — closes THIS one holding (100% spot sell to
               USDT) behind an explicit confirm. A SMALL semantic-red round X: a FIXED
               27px circle that must NEVER stretch to the row height. It does NOT use the
               .gbtn class — on coarse (mobile) pointers .gbtn forces min-height:44px,
               which with a fixed width turned this into a tall red OVAL. Instead we paint
               the same skin-aware red directly from the --btn-loss-* CSS vars (identical
               hue to LivePositions), with equal w/h, alignSelf:center and flexShrink:0 so
               it stays a neat circle. The transparent button keeps a ~40px tap target via
               padding/negative margin WITHOUT enlarging the visible circle. Shared by both
               the list row and the card so close behaviour is byte-identical. */
            const closeBtn = (
              <button
                onClick={(e) => { e.stopPropagation(); closeOne(sym); }}
                disabled={rowClosing || closeOneM.isPending}
                title={he ? `סגור את הפוזיציה ב-${base}` : `Close ${base} position`}
                aria-label={he ? `סגור את הפוזיציה ב-${base}` : `Close ${base} position`}
                style={{ flexShrink: 0, alignSelf: "center", padding: 7, margin: -7, background: "none", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: (rowClosing || closeOneM.isPending) ? 0.6 : 1 }}>
                <span style={{ width: 27, height: 27, minWidth: 27, minHeight: 27, flexShrink: 0, alignSelf: "center", borderRadius: 9999, background: "var(--btn-loss-bg)", border: "1px solid var(--btn-loss-bd)", color: "var(--btn-loss-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 0, pointerEvents: "none" }}>
                  {rowClosing ? <Loader2 size={14} className="spin" /> : <X size={14} />}
                </span>
              </button>
            );
            /* CARDS: a genuinely different compact vertical card (symbol + close-X on top,
               qty/entry→current meta, then a PROMINENT P&L line) — not the horizontal row. */
            if (view === "cards") return (
              <div key={i} style={{ ...rowCard, display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 900, color: C.text }}>{base}</span>
                    <BreakoutChip sig={sig} he={he} />
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}><WeekTrendArrow sig={sig} he={he} rtl={rtl} />{infoBtn}{closeBtn}</span>
                </div>
                <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{meta}</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 1, direction: "ltr", justifyContent: he ? "flex-end" : "flex-start" }}>
                  <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 900, color: col }}>{hasPnl ? signed(pnl) : "—"}</span>
                  <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 700, color: col }}>{pctStr}</span>
                </div>
                {infoOpen && <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 2, paddingTop: 5 }}><BreakoutDetail sig={sig} he={he} rtl={rtl} /></div>}
              </div>
            );
            /* LIST: the original full-width horizontal row. Wrapped with its optional
               breakout detail so the detail expands beneath THIS row (the wrapper is a
               flex column; in list mode it's a direct child of the outer flex column). */
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ ...rowCard, display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 900, color: C.text }}>{base}</span>
                      <BreakoutChip sig={sig} he={he} />
                    </span>
                    <span style={{ display: "block", fontFamily: MONO, fontSize: 9.5, color: C.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{meta}</span>
                  </span>
                  <span style={{ textAlign: he ? "left" : "right", fontFamily: MONO, flexShrink: 0 }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 900, color: col, direction: "ltr" }}>{hasPnl ? signed(pnl) : "—"}</span>
                    <span style={{ display: "block", fontSize: 9.5, color: col, direction: "ltr" }}>{pctStr}</span>
                  </span>
                  <WeekTrendArrow sig={sig} he={he} rtl={rtl} />
                  {infoBtn}
                  {closeBtn}
                </div>
                {infoOpen && <div style={{ ...rowCard, marginTop: -2 }}><BreakoutDetail sig={sig} he={he} rtl={rtl} /></div>}
              </div>
            );
          })}
            </div>
          )}
        </div>

        {/* GROWTH breakdown — the headline frame: portfolio value vs. the capital the user
            DEPOSITED (not the cost-basis churn, which is retired from the user view). The
            per-row unrealized P&L above stays real; this rolls up to true growth. Only
            when connected (no live figures to roll up otherwise). */}
        {connected && (() => {
          const totVal = p?.totalValue != null ? Number(p.totalValue) : null;
          const dep = p?.depositBase != null ? Number(p.depositBase) : null;
          const g = growthPnl;
          const openU = p?.unrealizedPnl != null ? Number(p.unrealizedPnl) : allPnl;
          const rowS: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 12 };
          const money = (v: number | null) => v == null ? "—" : "$" + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
          if (g == null || dep == null) {
            // No deposit recorded → can't show growth; prompt + still show open unrealized.
            return (
              <div style={{ marginTop: 9, borderTop: `1px solid ${C.line}`, paddingTop: 9, display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={rowS}>
                  <span style={{ color: C.muted }}>{he ? "פתוח כעת (מהכניסה)" : "Open now (vs entry)"}</span>
                  <span style={{ fontFamily: MONO, fontWeight: 800, color: openU >= 0 ? C.gain : C.loss }}>{signed(openU)}</span>
                </div>
                {/* Idle cash — uninvested USDT (incl. a rejected buy's untouched allocation). */}
                <div style={rowS}>
                  <span style={{ color: C.muted }}>{he ? "מזומן זמין (USDT)" : "Cash available (USDT)"}</span>
                  <span style={{ fontFamily: MONO, fontWeight: 800, color: C.text }}>{money(p?.available != null ? Number(p.available) : null)}</span>
                </div>
                <div style={{ fontSize: 11, color: C.gold, fontWeight: 700 }}>{he ? "הגדירו הון שהופקד כדי לראות צמיחה כוללת." : "Set your deposited capital to see total growth."}</div>
              </div>
            );
          }
          return (
            <div style={{ marginTop: 9, borderTop: `1px solid ${C.line}`, paddingTop: 9, display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={rowS}>
                <span style={{ color: C.muted }}>{he ? "שווי התיק" : "Portfolio value"}</span>
                <span style={{ fontFamily: MONO, fontWeight: 800, color: C.text }}>{money(totVal)}</span>
              </div>
              {/* Idle cash — so uninvested USDT (incl. a rejected buy's untouched allocation) is
                  visible and never looks "lost". It's ALREADY inside Portfolio value above. */}
              <div style={rowS}>
                <span style={{ color: C.muted }}>{he ? "מזומן זמין (USDT)" : "Cash available (USDT)"}</span>
                <span style={{ fontFamily: MONO, fontWeight: 800, color: C.text }}>{money(p?.available != null ? Number(p.available) : null)}</span>
              </div>
              <div style={rowS}>
                <span style={{ color: C.muted }}>{he ? "הון שהופקד" : "Deposited capital"}</span>
                <span style={{ fontFamily: MONO, fontWeight: 800, color: C.text }}>{money(dep)}</span>
              </div>
              <div style={{ ...rowS, borderTop: `1px dashed ${C.line}`, paddingTop: 6, marginTop: 1 }}>
                <span style={{ color: C.text, fontWeight: 800 }}>{he ? "צמיחה (מהפקדה)" : "Growth (vs deposit)"}</span>
                <span style={{ fontFamily: MONO, fontWeight: 900, color: g >= 0 ? C.gain : C.loss }}>{signed(g)}{growthPct != null ? ` (${growthPct >= 0 ? "+" : ""}${growthPct.toFixed(2)}%)` : ""}</span>
              </div>
              <div style={{ ...rowS, fontSize: 10.5, opacity: 0.85 }}>
                <span style={{ color: C.faint }}>{he ? "מזה — פוזיציות פתוחות (מהכניסה)" : "of which — open positions (vs entry)"}</span>
                <span style={{ fontFamily: MONO, fontWeight: 700, color: openU >= 0 ? C.gain : C.loss }}>{signed(openU)}</span>
              </div>
            </div>
          );
        })()}

        {/* close-in-profit + close-all — now the SHARED CloseButtons component (same flow the
            /overview dashboard uses). It runs the same closeProfitable()/closeSpot() mutations +
            ConfirmModal gate + winnersOnly + $/% labels + (i) tips + red/green-by-sign colouring,
            and self-guards on connected. Behaviour is byte-identical to the previous inline block. */}
        <CloseButtons />
        {/* Per-ROW close (the X) feedback note — its own status line (CloseButtons keeps its own). */}
        {note && <span style={{ display: "block", marginTop: 8, fontSize: 11.5, fontWeight: 700, color: note.ok ? C.gain : C.loss }}>{note.text}</span>}
      </>)}
    </div>
  );
}
