import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { api, loadExchangeCreds } from "../app/api";
import { useI18n } from "../i18n";
import { C, MONO } from "../theme";
import ConfirmModal from "./ConfirmModal";
import { ErrorState } from "./StateBlock";
import { toastError } from "../lib/toast";
import { raceTimeout, honestMoneyError } from "../lib/money";
import { mapExchangeError } from "../lib/exchangeErrors";
import { track } from "../lib/analytics";

const usd = (n: number | null) =>
  n == null || isNaN(n as number) ? "—" : "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
const signed = (n: number) => (n >= 0 ? "+" : "") + "$" + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

// Real exchange positions: futures positions (if the key has Futures) + spot
// holdings (non-USDT) valued at the live mark price, with per-position P&L from
// the order log. "Close" sells that holding fully back to USDT (you confirm) —
// no second trip to the Exchange screen.
export default function LivePositions({ saved }: { saved: boolean; onPlace?: (symbol: string, side: "buy" | "sell") => void }) {
  const { lang } = useI18n();
  const he = lang === "he";
  const qc = useQueryClient();
  const balQ = useQuery({ queryKey: ["exBalanceOv"], queryFn: () => api.balance(), enabled: saved, retry: false, refetchInterval: 30000 });
  const posQ = useQuery({ queryKey: ["exPositionsOv"], queryFn: () => api.positions(), enabled: saved, retry: false, refetchInterval: 30000 });
  // Same cadence as PositionsWidget so the shared ["livePnl"] cache (which carries
  // every row's value + P&L) refreshes on one timer — the rows and any P&L summary
  // built from them update in the same tick, never on drifting independent schedules.
  const pnlQ = useQuery({ queryKey: ["livePnl"], queryFn: () => api.livePnl(), enabled: saved, retry: false, refetchInterval: 15000, refetchOnWindowFocus: true });
  // Resting protective orders (stop-loss / OCO / take-profit) — so the user can SEE
  // their stop IS active and waiting, instead of assuming "the stop isn't working".
  const protQ = useQuery({ queryKey: ["protectiveOrders"], queryFn: () => api.protectiveOrders(), enabled: saved, retry: false, refetchInterval: 30000 });
  const bal: any = balQ.data;
  const pos: any = posQ.data;

  const allHolds: any[] = (bal?.balances || []).filter((b: any) => String(b.asset || "").toUpperCase() !== "USDT" && Number(b.total) > 0);
  // Per-asset P&L map from the order log (avg buy cost vs live value).
  const pnlMap: Record<string, any> = {};
  for (const p of ((pnlQ.data as any)?.positions || [])) pnlMap[String(p.asset).toUpperCase()] = p;
  // Hide dust: after a market sell a tiny remainder is left (rounding / below the
  // exchange min), which kept "closed" positions on screen. Drop sub-$1 leftovers.
  const holds = allHolds.filter((h: any) => { const m = pnlMap[String(h.asset).toUpperCase()]; return !(m && m.value != null && Number(m.value) < 1); });

  const fut: any[] = pos?.ok && (pos.positions || []).length ? pos.positions : [];

  const [closing, setClosing] = React.useState<string>("");
  const [expanded, setExpanded] = React.useState<string>("");
  // Financial-safety gate (additive): a preview + confirm before any real-money close.
  const [confirm, setConfirm] = React.useState<Omit<React.ComponentProps<typeof ConfirmModal>, "onClose"> | null>(null);
  // Honest per-close feedback (green ✓ / red ✗), same pattern as the buy ticket.
  const [note, setNote] = React.useState<{ text: string; ok: boolean } | null>(null);
  // Env-aware confirm: closing happens on the SAME account/env that holds the
  // position (the active account's creds, mirrored into the single-creds slot).
  const isLive = String((loadExchangeCreds() as any)?.env || "").toLowerCase() === "live";
  const closeM = useMutation({
    mutationFn: (sym: string) => raceTimeout(api.placeOrder({ symbol: sym, side: "sell", pct: 100, orderType: "market", market: "spot" })),
    onSuccess: (r: any, sym: string) => {
      setClosing("");
      // place_order returns {ok:false, message} on a rejected order WITHOUT throwing,
      // so a silent failure would otherwise read as success — check ok explicitly.
      if (r?.ok !== false) {
        setNote({ text: he ? `נסגרה ${sym} ✓` : `Closed ${sym} ✓`, ok: true });
        track("position_close", { op: "close_position" });
        ["exBalanceOv", "exPositionsOv", "tkPrices", "livePnl", "allAccountsPnl"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      } else {
        setNote({ text: (he ? `הסגירה נכשלה (${sym}): ` : `Close failed (${sym}): `) + mapExchangeError(r?.message, he).friendly, ok: false });
        toastError(he ? `סגירת ${sym} נדחתה` : `Close order for ${sym} was rejected`, { body: mapExchangeError(r?.message, he).friendly });
      }
      setTimeout(() => setNote(null), 6000);
    },
    onError: (e: any, sym: string) => { setClosing(""); setNote({ text: (he ? "שגיאה: " : "Error: ") + mapExchangeError(e, he).friendly, ok: false }); setTimeout(() => setNote(null), 8000); honestMoneyError(e, he ? `סגירת ${sym} נכשלה` : `Couldn't close ${sym}`, lang, undefined, "close_position"); },
  });
  const closePos = (sym: string, pnl?: number | null) => {
    if (closeM.isPending) return;
    const envLine = isLive
      ? (he ? "מצב חי — כסף אמיתי. לא ניתן לבטל." : "LIVE — real money. Cannot be undone.")
      : (he ? "טסטנט (כסף דמו)." : "Testnet (demo funds).");
    const hasPnl = pnl != null && !isNaN(Number(pnl));
    setConfirm({
      title: he ? "סגירת פוזיציה" : "Close position",
      intro: he ? "תימכר כל האחזקה חזרה ל-USDT." : "Sells the whole holding back to USDT.",
      rows: [
        { label: he ? "סמל" : "Symbol", value: sym, color: C.gold },
        { label: he ? "רווח/הפסד נוכחי" : "Current P&L", value: hasPnl ? signed(Number(pnl)) : "—", color: !hasPnl ? C.muted : Number(pnl) >= 0 ? C.gain : C.loss },
      ],
      risk: envLine,
      confirmLabel: he ? "סגור פוזיציה" : "Close position",
      tone: "loss",
      onConfirm: async () => { setClosing(sym); const r: any = await closeM.mutateAsync(sym); if (r?.ok === false) throw new Error(r?.message || ""); },
    });
  };

  if (!saved) return <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>{he ? "חברו בורסה כדי לראות פוזיציות." : "Connect an exchange to see positions."}</p>;
  // Wait for live-P&L before rendering spot holdings: it carries the prices that
  // tell dust (sub-$1 leftovers) from real positions. Rendering early would flash
  // the raw dust list for a second, then collapse to "none" — which looks broken.
  // Error: the balance/positions fetch failed — offer an honest retry + support path
  // instead of a misleading "no positions".
  if (balQ.isError || posQ.isError)
    return <ErrorState compact onRetry={() => { balQ.refetch(); posQ.refetch(); pnlQ.refetch(); }} retrying={balQ.isFetching || posQ.isFetching} screen="positions"
      title={he ? "לא הצלחנו לטעון פוזיציות" : "Couldn't load positions"} />;
  if (balQ.isLoading || (pnlQ.isLoading && allHolds.length > 0)) return <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>…</p>;
  if (!fut.length && !holds.length)
    return <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>{he ? "אין פוזיציות פתוחות. פִּתחו אחת למטה." : "No open positions yet — open one below."}</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
      {note && (
        <div style={{ fontSize: 12, fontWeight: 700, color: note.ok ? C.gain : C.loss, background: (note.ok ? C.gain : C.loss) + "14", border: `1px solid ${(note.ok ? C.gain : C.loss)}55`, borderRadius: 9, padding: "8px 11px" }}>
          {note.text}
        </div>
      )}
      {fut.map((p: any, i: number) => {
        const u = Number(p.unrealizedPnl ?? p.unrealized ?? 0);
        const uPct = p.percentage != null ? Number(p.percentage) : null;
        const sz = Number(p.contracts ?? p.size ?? 0);
        const side = String(p.side || (sz >= 0 ? "long" : "short"));
        return (
          <div key={`f${i}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 12px" }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{p.symbol} · {side.toUpperCase()}</span>
              <span style={{ display: "block", fontFamily: MONO, fontSize: 11, color: C.muted }}>{he ? "כניסה" : "entry"} {p.entryPrice ?? "—"} · {Math.abs(sz)}</span>
            </span>
            <span style={{ textAlign: "end", fontFamily: MONO }}>
              <span style={{ fontWeight: 700, color: u >= 0 ? C.gain : C.loss }}>{signed(u)}</span>
              {uPct != null && <span style={{ display: "block", fontSize: 11, color: uPct >= 0 ? C.gain : C.loss }}>({uPct >= 0 ? "+" : ""}{uPct.toFixed(2)}%)</span>}
            </span>
          </div>
        );
      })}
      {holds.map((h: any, i: number) => {
        const base = String(h.asset).toUpperCase();
        const sym = `${base}/USDT`;
        const m = pnlMap[base];
        const value = m ? Number(m.value) : null;
        const pnl = m && m.pnl != null ? Number(m.pnl) : null;
        const pnlPct = m && m.pnlPct != null ? Number(m.pnlPct) : null;
        const avg = m && m.avgCost != null ? Number(m.avgCost) : null;
        const price = m && m.price != null ? Number(m.price) : null;
        const exp = expanded === base;
        return (
          <div key={`s${i}`} style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10 }}>
            <div onClick={() => setExpanded(exp ? "" : base)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 12px", cursor: "pointer" }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{exp ? "▾" : "▸"} {base}</span>
                <span style={{ display: "block", fontFamily: MONO, fontSize: 11, color: C.muted }}>{Number(h.total).toPrecision(6)} · {usd(value)}</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ textAlign: "end", fontFamily: MONO }}>
                  <span style={{ fontWeight: 700, color: pnl == null ? C.muted : (pnl >= 0 ? C.gain : C.loss) }}>{pnl == null ? "P&L —" : signed(pnl)}</span>
                  {pnlPct != null && <span style={{ display: "block", fontSize: 11, color: pnlPct >= 0 ? C.gain : C.loss }}>({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)</span>}
                </span>
                <button onClick={(e) => { e.stopPropagation(); closePos(sym, pnl); }} disabled={closing === sym} title={he ? "סגור פוזיציה" : "Close position"} className="gbtn gbtn-loss" style={{ width: 30, height: 30, borderRadius: "50%", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: closing === sym ? 0.6 : 1 }}>
                  {closing === sym ? <Loader2 size={14} className="spin" /> : <X size={15} />}
                </button>
              </span>
            </div>
            {exp && (
              <div style={{ padding: "0 12px 10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", fontFamily: MONO, fontSize: 11.5, color: C.muted }}>
                <span>{he ? "כמות" : "Qty"}: {Number(h.total).toPrecision(6)}</span>
                <span>{he ? "מחיר נוכחי" : "Price"}: {usd(price)}</span>
                <span>{he ? "עלות ממוצעת" : "Avg cost"}: {avg != null ? usd(avg) : "—"}</span>
                <span>{he ? "שווי שוק" : "Value"}: {usd(value)}</span>
                <span style={{ color: pnl == null ? C.muted : (pnl >= 0 ? C.gain : C.loss) }}>{he ? "רווח/הפסד" : "P&L"}: {pnl == null ? "—" : signed(pnl)}{pnlPct != null ? ` (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)` : ""}</span>
                <span>{avg == null ? (he ? "אין עלות במאגר" : "no cost basis in log") : ""}</span>
              </div>
            )}
          </div>
        );
      })}

      {/* RESTING PROTECTIVE ORDERS — makes the stop-loss visible so it never looks "broken". */}
      {(() => {
        const prot = (protQ.data as any);
        const orders: any[] = (prot?.ok && prot.orders) ? prot.orders : [];
        if (!orders.length) return null;
        const kindLabel = (k: string) => k === "stop" ? (he ? "סטופ-לוס" : "Stop-loss")
          : k === "take_profit" ? (he ? "יעד-רווח" : "Take-profit") : (he ? "הגנה" : "Protective");
        return (
          <div style={{ marginTop: 12, background: `${C.gain}0d`, border: `1px solid ${C.gain}44`, borderRadius: 12, padding: "11px 13px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 900, color: C.gain }}>🛡 {he ? "הגנות פעילות בבורסה" : "Active protection on the exchange"}</span>
              <span style={{ fontSize: 11, color: C.muted }}>{he ? "ממתינות ותופסות אוטומטית" : "resting, auto-triggered"}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {orders.map((o: any, i: number) => (
                <div key={o.id || i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
                  <span style={{ fontWeight: 800, color: C.text, direction: "ltr" }}>{o.symbol}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: o.kind === "stop" ? C.loss : C.gain,
                    background: `${o.kind === "stop" ? C.loss : C.gain}18`, border: `1px solid ${o.kind === "stop" ? C.loss : C.gain}44`,
                    borderRadius: 999, padding: "2px 9px" }}>{kindLabel(o.kind)}</span>
                  <span style={{ color: C.muted, fontFamily: MONO }}>
                    {he ? "ב-" : "@ "}{usd(o.stopPrice || o.price)}
                  </span>
                  {o.qty != null && <span style={{ color: C.faint, fontFamily: MONO }}>· {Number(o.qty).toPrecision(4)}</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
