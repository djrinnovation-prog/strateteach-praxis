import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../app/api";
import { C, MONO } from "../theme";

// Compact profit calendar: each day tinted green (profit) / red (loss); tap a day
// to see that day's trades. Reused in the Activity drawer + Trading Engine.
const signed = (v: number) => `${v >= 0 ? "+" : ""}${Number(v || 0).toFixed(2)}`;

export default function ProfitCalendar({ lang, rtl }: { lang: string; rtl: boolean }) {
  const dailyQ = useQuery({ queryKey: ["paperDaily"], queryFn: () => api.paperDailyPnl(), refetchInterval: 30000 });
  const byDay = useMemo(() => {
    const m: Record<string, { pnl: number; trades: any[] }> = {};
    ((dailyQ.data as any)?.days || []).forEach((d: any) => { m[d.day] = { pnl: d.pnl, trades: d.trades }; });
    return m;
  }, [dailyQ.data]);
  const today = new Date();
  const [cur, setCur] = useState(() => ({ y: today.getFullYear(), m: today.getMonth() }));
  const [openDay, setOpenDay] = useState<string | null>(null);
  const pad = (n: number) => String(n).padStart(2, "0");
  const startW = new Date(cur.y, cur.m, 1).getDay();
  const daysIn = new Date(cur.y, cur.m + 1, 0).getDate();
  const key = (d: number) => `${cur.y}-${pad(cur.m + 1)}-${pad(d)}`;
  const prefix = `${cur.y}-${pad(cur.m + 1)}`;
  const monthTotal = Object.entries(byDay).filter(([k]) => k.startsWith(prefix)).reduce((a, [, v]) => a + v.pnl, 0);
  const monthName = new Date(cur.y, cur.m, 1).toLocaleDateString(lang === "he" ? "he-IL" : "en-US", { month: "long", year: "numeric" });
  const WD = lang === "he" ? ["א", "ב", "ג", "ד", "ה", "ו", "ש"] : ["S", "M", "T", "W", "T", "F", "S"];
  const cells: (number | null)[] = [];
  for (let i = 0; i < startW; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);
  const shift = (n: number) => setCur((c) => { const d = new Date(c.y, c.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const dayData = openDay ? byDay[openDay] : null;
  const chip: React.CSSProperties = { width: 26, height: 26, borderRadius: 7, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: C.surface2, border: `1px solid ${C.line}`, color: C.muted };

  return (
    <div style={{ borderRadius: 12, border: `1px solid ${C.line}`, background: C.surface2, padding: 12, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button onClick={() => shift(-1)} style={chip}>{rtl ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800 }}>{monthName}</div>
          <div style={{ fontSize: 10.5, fontFamily: MONO, color: monthTotal >= 0 ? C.gain : C.loss }}>{signed(monthTotal)}</div>
        </div>
        <button onClick={() => shift(1)} style={chip}>{rtl ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3 }}>
        {WD.map((w, i) => <div key={"wd" + i} style={{ textAlign: "center", fontSize: 9, color: C.faint }}>{w}</div>)}
        {cells.map((d, i) => {
          if (d === null) return <div key={"e" + i} />;
          const k = key(d); const dd = byDay[k]; const pnl = dd?.pnl;
          const bg = pnl == null ? "transparent" : pnl > 0 ? "rgba(22,199,126,0.20)" : pnl < 0 ? "rgba(240,97,109,0.20)" : "transparent";
          const bc = openDay === k ? C.gold : (pnl == null ? C.line : pnl > 0 ? `${C.gain}66` : pnl < 0 ? `${C.loss}66` : C.line);
          return (
            <button key={k} onClick={() => dd && setOpenDay(openDay === k ? null : k)} style={{ background: bg, border: `1px solid ${bc}`, borderRadius: 6, padding: "3px 1px", cursor: dd ? "pointer" : "default", fontFamily: "inherit", minHeight: 32 }}>
              <div style={{ fontSize: 9.5, color: C.muted }}>{d}</div>
              {pnl != null && <div style={{ fontSize: 8.5, fontWeight: 800, fontFamily: MONO, color: pnl >= 0 ? C.gain : C.loss }}>{pnl >= 0 ? "+" : ""}{Math.round(pnl)}</div>}
            </button>
          );
        })}
      </div>
      {dayData && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{openDay} · <span style={{ fontFamily: MONO, color: dayData.pnl >= 0 ? C.gain : C.loss }}>{signed(dayData.pnl)}</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {dayData.trades.map((tr: any, i: number) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11.5 }}>
                <span><b>{tr.symbol}</b> <span style={{ color: C.faint, fontSize: 10 }}>· {tr.session}</span></span>
                <span style={{ fontFamily: MONO, color: tr.pnl >= 0 ? C.gain : C.loss, fontWeight: 700 }}>{signed(tr.pnl)}{tr.pnlPct != null ? ` (${tr.pnlPct >= 0 ? "+" : ""}${Number(tr.pnlPct).toFixed(2)}%)` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
