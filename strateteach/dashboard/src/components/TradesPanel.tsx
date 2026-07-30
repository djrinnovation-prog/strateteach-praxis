import React, { useMemo, useState } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, MapPin } from "lucide-react";
import { C, MONO, UI, SHADOW, RADIUS } from "../theme";
import type { Trade } from "../lib/types";

/**
 * Reusable backtest trades viewer: a TRADE-MARKERS chart + a full trades table,
 * both driven straight from the run's own trade list (the engine's actual
 * fills — no TradingView account / external feed involved).
 *
 * Markers note: the embedded TradingView "Advanced Real-Time Chart" widget is a
 * closed iframe with NO public API to draw custom marks/shapes, so we plot the
 * entries (▲) and exits (▼) on our OWN price-vs-time chart here. Hovering a table
 * row spotlights that trade's markers (and vice-versa via the chart tooltip), so
 * the two stay cross-referenced.
 */

type Props = {
  trades: Trade[];
  /** Per-symbol starting capital — used only as a fallback to derive a dollar
   *  P&L for trades whose engine `pnl` is absent (older runs / open trades). */
  initialCapital?: number;
  rtl: boolean;
  lang: "he" | "en";
};

const L = {
  he: {
    onPrice: "עסקאות על המחיר", table: "טבלת עסקאות", num: "#", side: "כיוון",
    entry: "כניסה", exit: "יציאה", pnl: "רווח/הפסד", dur: "משך", open: "פתוחה",
    long: "לונג", short: "שורט", win: "רווח", loss: "הפסד", none: "אין עסקאות עדיין",
    entryM: "כניסה (קנייה)", exitM: "יציאה (מכירה)", days: "ימים", note:
      "הסימונים מצוירים מהעסקאות של הבדיקה עצמה. ▲ = כניסה · ▼ = יציאה (ירוק=רווח, אדום=הפסד).",
  },
  en: {
    onPrice: "Trades on price", table: "Trades", num: "#", side: "Side",
    entry: "Entry", exit: "Exit", pnl: "P&L", dur: "Duration", open: "open",
    long: "Long", short: "Short", win: "win", loss: "loss", none: "No trades yet",
    entryM: "Entry (buy)", exitM: "Exit (sell)", days: "d", note:
      "Markers are drawn from the backtest's own trades. ▲ = entry · ▼ = exit (green=win, red=loss).",
  },
};

// Compact, locale-agnostic number/price formatting.
const fmtPrice = (v?: number | null) => {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (a >= 1) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return v.toLocaleString(undefined, { maximumSignificantDigits: 4 });
};
const fmtMoney = (v?: number | null) => {
  if (v == null || !isFinite(v)) return null;
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};
const ts = (d?: string | null) => (d ? Date.parse(d) : NaN);
const durDays = (a: string, b?: string | null) => {
  if (!b) return null;
  const d = Math.round((ts(b) - ts(a)) / 86_400_000);
  return isFinite(d) ? Math.max(0, d) : null;
};
const isWin = (tr: Trade) =>
  tr.pnl != null ? tr.pnl >= 0 : (tr.returnPct ?? 0) >= 0;
const isLong = (tr: Trade) => (tr.side || "").toUpperCase().startsWith("L") || (tr.side || "").toUpperCase() === "BUY";

export default function TradesPanel({ trades, initialCapital, rtl, lang }: Props) {
  const t = L[lang];
  const [hover, setHover] = useState<number | null>(null);

  // Dollar P&L: prefer the engine's exact per-trade `pnl`; if absent (older runs)
  // fall back to an approximation from the % return × starting capital, when known.
  const moneyFor = (tr: Trade): number | null => {
    if (tr.pnl != null) return tr.pnl;
    if (initialCapital != null && tr.returnPct != null && tr.exitPrice != null) {
      return (initialCapital * tr.returnPct) / 100;
    }
    return null;
  };

  // Build the marker dataset: one ▲ at the entry price/time and one ▼ at the exit
  // price/time per trade. Open trades (no exit) contribute only the entry marker.
  const { entries, exits } = useMemo(() => {
    const en: any[] = [], ex: any[] = [];
    trades.forEach((tr, i) => {
      const et = ts(tr.entryDate);
      if (isFinite(et)) en.push({ x: et, y: tr.entryPrice, i, win: isWin(tr), long: isLong(tr) });
      const xt = ts(tr.exitDate || "");
      if (isFinite(xt) && tr.exitPrice != null) ex.push({ x: xt, y: tr.exitPrice, i, win: isWin(tr), long: isLong(tr) });
    });
    return { entries: en, exits: ex };
  }, [trades]);

  if (!trades.length) {
    return (
      <div style={{ background: C.surface, border: `1px dashed ${C.line}`, borderRadius: RADIUS.md, padding: 28, textAlign: "center", color: C.muted, fontFamily: UI }}>
        {t.none}
      </div>
    );
  }

  // Marker shape: a triangle that points up (entry) or down (exit). The hovered
  // trade's markers grow + gain a white halo so the row↔chart link is obvious.
  const mkShape = (dir: "up" | "down") => (props: any) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null || payload == null) return <g />;
    const active = hover === payload.i;
    const s = active ? 9 : 6;
    const up = dir === "up";
    const pts = up
      ? `${cx},${cy - s} ${cx - s},${cy + s} ${cx + s},${cy + s}`
      : `${cx},${cy + s} ${cx - s},${cy - s} ${cx + s},${cy - s}`;
    // Entry markers ride the accent; exits are coloured by win/loss.
    const fill = up ? C.blue : (payload.win ? C.gain : C.loss);
    return (
      <polygon
        points={pts} fill={fill}
        stroke={active ? "#fff" : C.surface} strokeWidth={active ? 1.6 : 0.8}
        style={{ cursor: "pointer", transition: "all .12s" }}
        opacity={hover == null || active ? 1 : 0.4}
        onMouseEnter={() => setHover(payload.i)} onMouseLeave={() => setHover(null)}
      />
    );
  };

  const tip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload; if (!p) return null;
    const tr = trades[p.i]; if (!tr) return null;
    const money = fmtMoney(moneyFor(tr));
    return (
      <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", fontFamily: UI, fontSize: 12, color: C.text }}>
        <div style={{ fontWeight: 700, marginBottom: 3 }}>#{p.i + 1} · {isLong(tr) ? t.long : t.short}</div>
        <div style={{ color: C.muted }}>{t.entry}: <span style={{ fontFamily: MONO }}>{fmtPrice(tr.entryPrice)}</span> · {tr.entryDate}</div>
        <div style={{ color: C.muted }}>{t.exit}: <span style={{ fontFamily: MONO }}>{tr.exitPrice != null ? fmtPrice(tr.exitPrice) : t.open}</span>{tr.exitDate ? ` · ${tr.exitDate}` : ""}</div>
        <div style={{ marginTop: 3, fontFamily: MONO, color: isWin(tr) ? C.gain : C.loss }}>
          {tr.returnPct != null ? `${tr.returnPct >= 0 ? "+" : ""}${tr.returnPct.toFixed(2)}%` : "—"}{money ? ` · ${money}` : ""}
        </div>
      </div>
    );
  };

  const legendDot = (color: string, glyph: string, label: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: C.muted }}>
      <span style={{ color, fontSize: 13, lineHeight: 1 }}>{glyph}</span>{label}
    </span>
  );

  return (
    <div style={{ fontFamily: UI }} dir={rtl ? "rtl" : "ltr"}>
      {/* ── Trade-markers chart (our own; the TradingView embed can't take marks) ── */}
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: RADIUS.md, padding: 16, marginBottom: 14, boxShadow: SHADOW }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
          <MapPin size={15} color={C.gold} />
          <span style={{ fontSize: 15, fontWeight: 600 }}>{t.onPrice}</span>
          <span style={{ flex: 1 }} />
          {legendDot(C.blue, "▲", t.entryM)}
          {legendDot(C.gain, "▼", t.win)}
          {legendDot(C.loss, "▼", t.loss)}
        </div>
        <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 10 }}>{t.note}</div>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={C.line} strokeDasharray="3 3" />
              <XAxis
                type="number" dataKey="x" name="date" domain={["dataMin", "dataMax"]}
                stroke={C.faint} fontSize={11} tick={{ fill: C.muted }} reversed={rtl}
                tickFormatter={(v) => { try { return new Date(v).toISOString().slice(0, 7); } catch { return ""; } }}
              />
              <YAxis type="number" dataKey="y" name="price" domain={["auto", "auto"]} stroke={C.faint} fontSize={11} tick={{ fill: C.muted }} width={52} tickFormatter={(v) => fmtPrice(v)} orientation={rtl ? "right" : "left"} />
              <ZAxis range={[60, 60]} />
              {hover != null && trades[hover] && isFinite(ts(trades[hover].entryDate)) && (
                <ReferenceLine x={ts(trades[hover].entryDate)} stroke={C.gold} strokeDasharray="4 3" strokeOpacity={0.6} />
              )}
              <Tooltip cursor={{ strokeDasharray: "3 3", stroke: C.line }} content={tip} />
              <Scatter data={entries} shape={mkShape("up")} isAnimationActive={false} />
              <Scatter data={exits} shape={mkShape("down")} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Trades table ── */}
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: RADIUS.md, boxShadow: SHADOW, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "13px 16px 4px" }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{t.table}</span>
          <span style={{ fontSize: 12, color: C.muted, fontFamily: MONO }}>· {trades.length}</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 560 }}>
            <thead>
              <tr>
                {[t.num, t.side, t.entry, t.exit, t.pnl, t.dur].map((h, i) => (
                  <th key={i} style={th(rtl, i === 0)}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.map((tr, i) => {
                const win = isWin(tr);
                const lng = isLong(tr);
                const money = fmtMoney(moneyFor(tr));
                const d = durDays(tr.entryDate, tr.exitDate);
                const active = hover === i;
                return (
                  <tr key={i}
                    onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                    style={{ background: active ? `${C.gold}14` : "transparent", transition: "background .12s" }}>
                    <td style={{ ...td(rtl), fontFamily: MONO, color: C.faint, textAlign: "center" }}>{i + 1}</td>
                    <td style={td(rtl)}>
                      <span style={sideBadge(lng)}>
                        {lng ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{lng ? t.long : t.short}
                      </span>
                    </td>
                    <td style={td(rtl)}>
                      <div style={{ fontFamily: MONO }}>{fmtPrice(tr.entryPrice)}</div>
                      <div style={{ fontSize: 11, color: C.faint }}>{tr.entryDate}</div>
                    </td>
                    <td style={td(rtl)}>
                      {tr.exitPrice != null ? (
                        <>
                          <div style={{ fontFamily: MONO }}>{fmtPrice(tr.exitPrice)}</div>
                          <div style={{ fontSize: 11, color: C.faint }}>{tr.exitDate || "—"}</div>
                        </>
                      ) : <span style={openBadge()}>{t.open}</span>}
                    </td>
                    <td style={{ ...td(rtl), fontFamily: MONO, color: win ? C.gain : C.loss, whiteSpace: "nowrap" }}>
                      <div style={{ fontWeight: 700 }}>{tr.returnPct != null ? `${tr.returnPct >= 0 ? "+" : ""}${tr.returnPct.toFixed(2)}%` : "—"}</div>
                      {money && <div style={{ fontSize: 11, opacity: 0.85 }}>{money}</div>}
                    </td>
                    <td style={{ ...td(rtl), fontFamily: MONO, color: C.muted }}>{d == null ? "—" : `${d}${t.days === "d" ? "d" : ` ${t.days}`}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const th = (rtl: boolean, center = false): React.CSSProperties => ({
  padding: "9px 12px", borderBottom: `1px solid ${C.line}`,
  textAlign: center ? "center" : (rtl ? "right" : "left"),
  color: C.muted, fontWeight: 500, fontSize: 12, whiteSpace: "nowrap",
});
const td = (rtl: boolean): React.CSSProperties => ({
  padding: "10px 12px", borderBottom: `1px solid ${C.line}`,
  textAlign: rtl ? "right" : "left", verticalAlign: "top",
});
const sideBadge = (lng: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700,
  color: lng ? C.gain : C.loss, background: `${lng ? C.gain : C.loss}1a`,
  border: `1px solid ${lng ? C.gain : C.loss}33`, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap",
});
const openBadge = (): React.CSSProperties => ({
  fontSize: 11, fontWeight: 700, color: C.gold, background: `${C.gold}1a`,
  border: `1px solid ${C.gold}40`, padding: "2px 8px", borderRadius: 999,
});
