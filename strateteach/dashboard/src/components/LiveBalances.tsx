import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, MONO } from "../theme";

const usd = (n: number | null) =>
  n == null || isNaN(n as number) ? "—" : "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

// Real exchange balances, shown as cards in the same style as the Positions
// panel (instead of a raw JSON dump). Each asset card shows the holding amount
// and its live USD value (from the same /exchange/live-pnl price map). USDT is
// your cash; everything else is valued at the live mark price.
export default function LiveBalances({ saved }: { saved: boolean }) {
  const { lang } = useI18n();
  const he = lang === "he";
  const balQ = useQuery({ queryKey: ["exBalanceOv"], queryFn: () => api.balance(), enabled: saved, retry: false, refetchInterval: 30000 });
  const pnlQ = useQuery({ queryKey: ["livePnl"], queryFn: () => api.livePnl(), enabled: saved, retry: false, refetchInterval: 30000 });

  const bal: any = balQ.data;
  // Per-asset live USD value from the P&L endpoint (avg cost / mark price map).
  const valMap: Record<string, number> = {};
  for (const p of ((pnlQ.data as any)?.positions || [])) {
    if (p && p.asset != null && p.value != null) valMap[String(p.asset).toUpperCase()] = Number(p.value);
  }

  // Rows whose USD value rounds to $0.00 are non-holdings (pure dust crumbs) — they
  // make the wallet look cluttered, so hide them. We only hide when we KNOW the value
  // is sub-cent (price-priced, < $0.01); rows we can't price are kept (shown as "—").
  // USDT cash is always shown. The "Clean dust" button clears the rest of the dust.
  const DUST_HIDE = 0.01;
  const rows = ((bal?.balances || []) as any[])
    .filter((b) => Number(b.total) > 0)
    .map((b) => {
      const asset = String(b.asset || "").toUpperCase();
      const total = Number(b.total);
      const value = asset === "USDT" ? total : (valMap[asset] != null ? valMap[asset] : null);
      return { asset, total, free: Number(b.free), value };
    })
    .filter((r) => r.asset === "USDT" || r.value == null || r.value >= DUST_HIDE)
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));

  if (!saved) return <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>{he ? "חברו בורסה כדי לראות יתרה." : "Connect an exchange to see your balance."}</p>;
  if (balQ.isLoading) return <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>…</p>;
  if (!rows.length) return <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>{he ? "אין יתרה." : "No balances."}</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((r, i) => (
        <div key={`b${i}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 12px" }}>
          <span style={{ minWidth: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{r.asset}{r.asset === "USDT" ? <span style={{ fontWeight: 600, fontSize: 11, color: C.muted }}> · {he ? "מזומן" : "cash"}</span> : null}</span>
            <span style={{ display: "block", fontFamily: MONO, fontSize: 11, color: C.muted }}>{r.total.toPrecision(6)}</span>
          </span>
          <span style={{ fontFamily: MONO, fontWeight: 700, color: C.text }}>{usd(r.value)}</span>
        </div>
      ))}
    </div>
  );
}
