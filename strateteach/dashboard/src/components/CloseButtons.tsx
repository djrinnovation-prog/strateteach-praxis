import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, TrendingUp, X } from "lucide-react";
import { api, loadExchangeCreds } from "../app/api";
import { useI18n } from "../i18n";
import { C } from "../theme";
import { winnersOnly } from "../lib/closeRouting";
import ConfirmModal from "./ConfirmModal";
import { toastError, toastSuccess } from "../lib/toast";
import { raceTimeout, honestMoneyError } from "../lib/money";
import { track } from "../lib/analytics";
import InfoTip from "./InfoTip";

// ── CloseButtons — the "Close in profit" (green) + "Close all" (red/green by combined P&L sign)
//    real-money close buttons, EXTRACTED verbatim from PositionsWidget so /profit AND the /overview
//    dashboard render the byte-identical flow: the SAME closeProfitable() / closeSpot() mutations,
//    the SAME ConfirmModal confirmation gate (nothing closes without the user confirming), the SAME
//    winnersOnly predicate, the SAME $/% labels + (i) info tooltips + red/green-by-sign colouring
//    (Yoav #AOAY / #CEQA). It reads the SAME read-only ["livePnl"] query (browser X-Exchange-*
//    creds) — no new close path, no auto-execute, no gate/confirm bypass. Renders nothing when the
//    exchange isn't connected; the buttons are disabled when there's nothing to close. ──
export default function CloseButtons() {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const qc = useQueryClient();
  const connected = !!loadExchangeCreds();
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  // Financial-safety gate (additive): a preview + confirm before any real-money close.
  const [confirm, setConfirm] = useState<Omit<React.ComponentProps<typeof ConfirmModal>, "onClose"> | null>(null);
  const isLive = String((loadExchangeCreds() as any)?.env || "").toLowerCase() === "live";

  // SAME query/key PositionsWidget uses → shared cache, same read-only source of truth.
  const pnlQ = useQuery({ queryKey: ["livePnl"], queryFn: () => api.livePnl(), enabled: connected, retry: false, refetchInterval: 15000, refetchOnWindowFocus: true });
  const p: any = pnlQ.data;
  const positions: any[] = p?.ok ? (p.positions || []) : [];
  // Open positions = real (non-dust) holdings. Dust (<$1) is hidden + excluded, mirroring the server.
  const open = positions.filter((x) => Number(x.value || 0) >= 1);
  const winners = winnersOnly(open);                       // in-profit, non-dust → exactly what closes
  const wn = winners.length;
  // WINNERS-only aggregate — used ONLY by the green button (it states exactly what closes).
  const profit = winners.reduce((s, w) => s + (Number(w.pnl) || 0), 0);
  const cost = winners.reduce((s, w) => s + ((Number(w.value) || 0) - (Number(w.pnl) || 0)), 0);
  const profitPct = cost > 0 ? (profit / cost) * 100 : null;
  // COMBINED open P&L over ALL open (non-dust) positions with a known cost basis (winners + losers).
  const withBasis = open.filter((w) => w.pnl != null && !isNaN(Number(w.pnl)));
  const allPnl = withBasis.reduce((s, w) => s + Number(w.pnl), 0);
  const allBasis = withBasis.reduce((s, w) => s + ((Number(w.value) || 0) - Number(w.pnl)), 0);
  const allPct = (p?.totalPnlPct != null && !isNaN(Number(p.totalPnlPct)))
    ? Number(p.totalPnlPct)
    : (allBasis > 0 ? (allPnl / allBasis) * 100 : null);
  // "Close all" hue tracks the SIGN of the combined open P&L (Yoav #CEQA): green net-profit, red
  // net-loss, neutral/gray at ~$0 or nothing to close. Display-only — the close action is unchanged.
  const closeAllTone: "gain" | "loss" | "neutral" =
    open.length === 0 || Math.abs(allPnl) < 0.005 ? "neutral" : allPnl > 0 ? "gain" : "loss";

  const closeM = useMutation({
    mutationFn: () => raceTimeout(api.closeProfitable()),
    onSuccess: (r: any) => {
      ["livePnl", "exBalanceOv", "exPositionsOv", "allAccountsPnl"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      const n = Number(r?.closedCount ?? r?.closed?.length ?? 0);
      const failed = Number(r?.errors?.length ?? 0);
      if (n > 0) { setNote({ text: he ? `נסגרו ${n} פוזיציות ✓` : `Closed ${n} ✓`, ok: true }); toastSuccess(he ? `נסגרו ${n} פוזיציות ברווח` : `Closed ${n} in-profit position(s)`); track("position_close", { op: "close_profit", count: n }); }
      else if (failed > 0) { setNote({ text: he ? `הסגירה נכשלה (${failed}) — נסה שוב` : `Close failed (${failed}) — try again`, ok: false }); toastError(he ? "סגירת הרווחים נכשלה" : "Couldn't close in-profit positions", { body: he ? `${failed} פוזיציות לא נסגרו. בדקו את הרשימה ונסו שוב.` : `${failed} position(s) didn't close. Check the list and try again.` }); }
      else setNote({ text: he ? "אין פוזיציות לסגור כעת" : "Nothing to close right now", ok: false });
      setTimeout(() => setNote(null), 6000);
    },
    onError: (e: any) => { setNote({ text: (he ? "שגיאה: " : "Error: ") + String(e?.message || e), ok: false }); setTimeout(() => setNote(null), 8000); honestMoneyError(e, he ? "סגירת הרווחים נכשלה" : "Couldn't close in-profit positions", lang, undefined, "close_profit"); },
  });

  // Close ALL open positions → USDT (winners AND losers), via the SAME /exchange/close-spot endpoint
  // the Exchange screen uses. Real money — gated by the branded confirm below; honest result note.
  const closeAllM = useMutation({
    mutationFn: () => raceTimeout(api.closeSpot()),
    onSuccess: (r: any) => {
      ["livePnl", "exBalanceOv", "exPositionsOv", "tkPrices", "allAccountsPnl"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      const n = Number(r?.closed?.length ?? 0);
      const failed = Number(r?.errors?.length ?? 0);
      if (n > 0) { setNote({ text: (he ? `נסגרו ${n} פוזיציות ✓` : `Closed ${n} ✓`) + (failed ? (he ? ` · ${failed} נכשלו` : ` · ${failed} failed`) : ""), ok: true }); toastSuccess(he ? `נסגרו ${n} פוזיציות → USDT` : `Closed ${n} position(s) → USDT`); track("position_close", { op: "close_all", count: n }); }
      else if (failed > 0) { setNote({ text: he ? `הסגירה נכשלה (${failed}) — נסה שוב` : `Close failed (${failed}) — try again`, ok: false }); toastError(he ? "הסגירה ל-USDT נכשלה" : "Couldn't close to USDT", { body: he ? `${failed} פוזיציות לא נסגרו. בדקו ונסו שוב.` : `${failed} position(s) didn't close. Check and try again.` }); }
      else setNote({ text: he ? "אין פוזיציות לסגור כעת" : "Nothing to close right now", ok: false });
      setTimeout(() => setNote(null), 6000);
    },
    onError: (e: any) => { setNote({ text: (he ? "שגיאה: " : "Error: ") + String(e?.message || e), ok: false }); setTimeout(() => setNote(null), 8000); honestMoneyError(e, he ? "הסגירה ל-USDT נכשלה" : "Couldn't close all to USDT", lang, undefined, "close_all"); },
  });

  const has = wn > 0;
  const signed = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const syms = winners.map((w) => String(w.asset || w.symbol || "").split("/")[0]).filter(Boolean);
  const symList = syms.slice(0, 4).join(", ") + (syms.length > 4 ? "…" : "");

  // Not connected → nothing to close; render nothing (the host decides where to place this).
  if (!connected) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 9, direction: he ? "rtl" : "ltr" }}>
      {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
      {/* close-in-profit — the transparent-label green button. Its label states exactly what will
          close (count · total $ · %), the safeguard; the confirm is the gate. */}
      <button
        onClick={() => { if (has && !closeM.isPending) setConfirm({
          title: he ? "סגירת פוזיציות ברווח" : "Close in-profit positions",
          intro: he ? `ייסגרו ${wn} פוזיציות שברווח, חזרה ל-USDT.` : `Closes ${wn} in-profit position(s) back to USDT.`,
          rows: [
            { label: he ? "פוזיציות" : "Positions", value: `${wn}${symList ? ` · ${symList}` : ""}`, color: C.gold },
            { label: he ? "רווח כולל" : "Total profit", value: `${signed(profit)}${profitPct != null ? ` · +${profitPct.toFixed(2)}%` : ""}`, color: C.gain },
          ],
          risk: isLive ? (he ? "כסף אמיתי — לא ניתן לבטל." : "Real money — cannot be undone.") : (he ? "טסטנט (כסף דמו)." : "Testnet (demo funds)."),
          confirmLabel: he ? "סגור ברווח" : "Close in profit",
          tone: "gain",
          onConfirm: async () => { const r: any = await closeM.mutateAsync(); if (r?.ok === false) throw new Error(r?.message || ""); },
        }); }}
        disabled={!has || closeM.isPending}
        title={has ? (he ? `יסגור: ${symList}` : `Will close: ${symList}`) : undefined}
        className="gbtn gbtn-gain ptile"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", fontWeight: 800, fontSize: 12, cursor: has ? "pointer" : "default", fontFamily: "inherit", opacity: has ? 1 : 0.45 }}>
        {closeM.isPending ? <Loader2 size={13} className="spin" /> : <TrendingUp size={13} />}
        {has
          ? (he ? `סגור ${wn} ברווח · ${signed(profit)}${profitPct != null ? ` · +${profitPct.toFixed(2)}%` : ""}`
                : `Close ${wn} in profit · ${signed(profit)}${profitPct != null ? ` · +${profitPct.toFixed(2)}%` : ""}`)
          : (he ? "0 ברווח" : "0 in profit")}
      </button>
      {/* (i) — the green button's $/% are the IN-PROFIT set only; the click closes only those. */}
      <InfoTip he={he} rtl={rtl}
        title={he ? "מה המספרים אומרים?" : "What these numbers mean"}
        lines={he ? [
          "ה־$ וה־% כאן הם רק הפוזיציות שנמצאות ברווח — לא שקלול של כל הפוזיציות המוצגות.",
          "בלחיצה נסגרות כעת רק הפוזיציות שברווח, חזרה ל־USDT. הפוזיציות בהפסד נשארות פתוחות.",
        ] : [
          "The $ and % here are ONLY the in-profit positions — not a total of all the rows shown.",
          "Clicking closes just the positions currently in profit (back to USDT). Losing positions stay open.",
        ]} />
      {/* Small "Close all" — closes EVERY open position (winners + losers) → USDT via the same
          close-spot endpoint. Branded confirm first (real money); red/green by combined P&L sign. */}
      <button
        onClick={() => { if (open.length > 0 && !closeAllM.isPending) setConfirm({
          title: he ? "סגירת כל הפוזיציות" : "Close all positions",
          intro: he ? `ייסגרו כל הפוזיציות הפתוחות (${open.length}) חזרה ל-USDT — כולל ההפסדיות.` : `Closes ALL open positions (${open.length}) back to USDT — including losers.`,
          rows: [
            { label: he ? "פוזיציות" : "Positions", value: `${open.length}`, color: C.gold },
            { label: he ? "רווח/הפסד פתוח" : "Open P&L", value: `${signed(allPnl)}${allPct != null ? ` · ${allPct >= 0 ? "+" : ""}${allPct.toFixed(2)}%` : ""}`, color: allPnl >= 0 ? C.gain : C.loss },
          ],
          risk: isLive ? (he ? "כסף אמיתי — לא ניתן לבטל." : "Real money — cannot be undone.") : (he ? "טסטנט (כסף דמו)." : "Testnet (demo funds)."),
          confirmLabel: he ? "סגור הכל" : "Close all",
          tone: "loss",
          onConfirm: async () => { const r: any = await closeAllM.mutateAsync(); if (r?.ok === false) throw new Error(r?.message || ""); },
        }); }}
        disabled={open.length === 0 || closeAllM.isPending}
        title={open.length > 0 ? (he ? "סגור את כל הפוזיציות → USDT" : "Close every position → USDT") : undefined}
        aria-label={he ? "סגור את כל הפוזיציות" : "Close all positions"}
        className={closeAllTone === "gain" ? "gbtn gbtn-gain ptile" : closeAllTone === "loss" ? "gbtn gbtn-loss ptile" : "ptile"}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 11px", fontWeight: 800, fontSize: 11.5, cursor: open.length > 0 ? "pointer" : "default", fontFamily: "inherit", opacity: open.length > 0 ? 1 : 0.45,
          ...(closeAllTone === "neutral" ? { background: C.surface2, border: `1px solid ${C.line}`, color: C.muted } : {}) }}>
        {closeAllM.isPending ? <Loader2 size={12} className="spin" /> : <X size={12} />}
        {open.length > 0
          ? `${he ? "סגור הכל" : "Close all"} · ${signed(allPnl)}${allPct != null ? ` · ${allPct >= 0 ? "+" : ""}${allPct.toFixed(2)}%` : ""}`
          : (he ? "סגור הכל" : "Close all")}
      </button>
      {/* (i) — the red button's $/% is the COMBINED P&L of ALL open positions (incl. losers). */}
      <InfoTip he={he} rtl={rtl}
        title={he ? "מה המספרים אומרים?" : "What these numbers mean"}
        lines={he ? [
          "ה־$ וה־% כאן הם הרווח/הפסד של כל הפוזיציות הפתוחות ביחד — כולל ההפסדיות.",
          "בלחיצה נסגרות כל הפוזיציות הפתוחות חזרה ל־USDT, לא רק הרווחיות.",
        ] : [
          "The $ and % here are the COMBINED P&L of every open position — including the losing ones.",
          "Clicking closes ALL open positions back to USDT, not just the profitable ones.",
        ]} />
      {note && <span style={{ fontSize: 11.5, fontWeight: 700, color: note.ok ? C.gain : C.loss, width: "100%" }}>{note.text}</span>}
    </div>
  );
}
