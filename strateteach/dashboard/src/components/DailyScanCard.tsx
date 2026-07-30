import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Plus, Clock, Loader2, X, TrendingUp, FlaskConical, ArrowRight, Trash2, ShieldCheck } from "lucide-react";
import { api, isAdmin, isOwner } from "../app/api";
import { useI18n } from "../i18n";
import { C, MONO } from "../theme";
import { tierInfo } from "../theme";
import { useScanChanges } from "../lib/useScanChanges";
import { strategyLabel, visibleBuiltinBots } from "../lib/builtinBots";

const L = {
  he: { title: "סריקה יומית", last: "סריקה אחרונה", next: "הסריקה הבאה בעוד", auto: "אוטומטי כל יום ב-00:05 UTC",
    top: "10 המובילים של היום", run: "סריקה חדשה", running: "סורק…", never: "טרם בוצעה סריקה", empty: "אין עדיין נתונים — הרץ סריקה",
    assets: "נכסים נסרקו", longs: "הזדמנויות לונג",
    allTitle: "כל התוצאות", allHint: (n: number) => `כל ${n} ההזדמנויות, מסודרות לפי דירוג`,
    th: { rank: "#", asset: "נכס", tier: "מצב", price: "מחיר", today: "היום", yest: "אתמול", green: "ירוק?", date: "פריצה", toGreen: "לירוק" } },
  en: { title: "Daily scan", last: "Last scan", next: "Next scan in", auto: "Automatic every day at 00:05 UTC",
    top: "Today's top 10", run: "New scan", running: "Scanning…", never: "No scan yet", empty: "No data yet — run a scan",
    assets: "assets scanned", longs: "long setups",
    allTitle: "All results", allHint: (n: number) => `All ${n} setups, ordered by rank`,
    th: { rank: "#", asset: "Asset", tier: "Status", price: "Price", today: "Today", yest: "Yesterday", green: "Green?", date: "Breakout", toGreen: "To green" } },
};

function fmtAgo(iso: string | null, lang: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return lang === "he" ? "הרגע" : "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return d.toLocaleString();
}

function Countdown({ target }: { target: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, []);
  if (!target) return <span style={{ fontFamily: MONO }}>—</span>;
  let s = Math.max(0, Math.floor((new Date(target).getTime() - now) / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  const Box = ({ v, k }: { v: string; k: string }) => (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
      <span style={{ fontFamily: MONO, fontSize: 26, fontWeight: 800, color: C.gold, lineHeight: 1,
        background: "rgba(247,147,26,0.08)", border: `1px solid ${C.goldDim}`, borderRadius: 8, padding: "6px 9px", minWidth: 44, textAlign: "center" }}>{v}</span>
      <span style={{ fontSize: 9, color: C.faint, marginTop: 3, letterSpacing: "0.1em" }}>{k}</span>
    </span>
  );
  return (
    <span style={{ display: "inline-flex", alignItems: "flex-start", gap: 6, direction: "ltr" }}>
      <Box v={hh} k="HRS" /><Box v={mm} k="MIN" /><Box v={ss} k="SEC" />
    </span>
  );
}

export default function DailyScanCard() {
  const { lang, rtl } = useI18n();
  const nav = useNavigate();
  const [sel, setSel] = useState<any>(null);
  const t = L[lang];
  const qc = useQueryClient();
  // Auto-refresh: poll every 30s and refetch on tab refocus so the list reflects
  // the automatic daily scan without a manual tap (manual "New scan" stays too).
  const q = useQuery({ queryKey: ["dailyScan"], queryFn: () => api.dailyScan(), refetchInterval: 30000, refetchOnWindowFocus: true });
  const runM = useMutation({ mutationFn: () => api.runDailyScan(), onSuccess: () => qc.invalidateQueries({ queryKey: ["dailyScan"] }) });
  const savedQ = useQuery({ queryKey: ["savedStrategies"], queryFn: () => api.savedStrategies() });
  const saved = (savedQ.data || []) as any[];
  const meQ = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  const myUser = (meQ.data as any)?.username;
  const mainAdmin = isOwner();
  // Same admin flag used app-wide: regular users see only strategy 1 & 8.
  const visBots = visibleBuiltinBots(isOwner());
  // Only the owner (or main admin for legacy ownerless rows) may delete a strategy
  // from this list — never another user's strategy.
  const canDelete = (s: any) => (s?.owner ? s.owner === myUser : mainAdmin);
  const delStratM = useMutation({ mutationFn: (id: number) => api.deleteSavedStrategy(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["savedStrategies"] }) });
  const d: any = q.data || {};
  const top: any[] = d.top10 || [];
  // The FULL ordered long list (every result, not just the top 10) — restores the
  // organized results table at the bottom. Falls back to `top` for older payloads.
  const all: any[] = (d.results && d.results.length ? d.results : top) as any[];
  // Which coins entered / left the list since the previous scan.
  const chg = useScanChanges("algo770_seen_breakouts_card", d.lastScanAt, top.map((s: any) => String(s.symbol || "")));

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 800 }}>
            <RefreshCw size={15} color={C.gold} /> {t.title}
          </div>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 3 }}>{t.auto}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
            {t.last}: <b style={{ color: C.text }}>{fmtAgo(d.lastScanAt, lang)}</b>
            {d.count ? <span> · {d.count} {t.assets} · {d.longCount} {t.longs}</span> : null}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 6, display: "flex", alignItems: "center", gap: 4, justifyContent: "center" }}><Clock size={11} /> {t.next}</div>
            <Countdown target={d.nextScanAt} />
          </div>
          <button onClick={() => runM.mutate()} disabled={runM.isPending}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "var(--btn-bg)", color: "var(--btn-ink)", border: "none",
              borderRadius: 10, padding: "10px 14px", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
            {runM.isPending ? <Loader2 size={15} className="spin" /> : <Plus size={16} />} {runM.isPending ? t.running : t.run}
          </button>
        </div>
      </div>

      {/* Your strategies — view, remove, or add (shared across all screens) */}
      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11.5, color: C.muted }}>{lang === "he" ? "האסטרטגיות שלך:" : "Your strategies:"}</span>
        {/* Built-in 770 bots — read-only (no delete). Regular users see only strategy
            1 & 8; admins see all (visBots is gated). */}
        {visBots.map((bot) => (
          <span key={bot.id} title={bot.desc[lang]} style={{ display: "inline-flex", alignItems: "center", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, paddingInlineStart: 10 }}>
            <button onClick={() => nav("/strategy")} title={lang === "he" ? "פתח במעבדה" : "Open in the lab"} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", color: C.text, fontSize: 11.5, fontWeight: 700, padding: "6px 2px", display: "inline-flex", alignItems: "center", gap: 4 }}><ShieldCheck size={10} color={C.gold} /> {strategyLabel(bot.id, lang)}</button>
            <span style={{ fontSize: 9, fontWeight: 700, color: C.gold, padding: "0 8px 0 5px" }}>{lang === "he" ? "מובנה" : "built-in"}</span>
          </span>
        ))}
        {saved.map((s: any) => {
          const otherOwner = !!s?.owner && s.owner !== myUser; // main-admin cross-view
          return (
            <span key={s.id} style={{ display: "inline-flex", alignItems: "center", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, paddingInlineStart: 10 }}>
              <button onClick={() => nav("/strategy")} title={lang === "he" ? "פתח במעבדה" : "Open in the lab"} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", color: C.text, fontSize: 11.5, fontWeight: 700, padding: "6px 2px" }}>{s.name && s.name !== "Strategy" ? s.name : `${strategyLabel(s.config?.strategyId || s.strategyId || "770", lang)} #${s.id}`}</button>
              {otherOwner && <span style={{ fontSize: 9, color: C.faint, padding: "0 5px" }}>{lang === "he" ? `בעלים: ${s.owner}` : `owner: ${s.owner}`}</span>}
              {canDelete(s)
                ? <button onClick={() => { if (window.confirm(lang === "he" ? "להסיר מהרשימה?" : "Remove from the list?")) delStratM.mutate(s.id); }} title={lang === "he" ? "הסר" : "Remove"} style={{ background: "none", border: "none", cursor: "pointer", color: C.faint, padding: "6px 8px 6px 3px", display: "inline-flex" }}><Trash2 size={11} /></button>
                : <span style={{ paddingInlineEnd: 8 }} />}
            </span>
          );
        })}
        <button onClick={() => nav("/strategy")} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: `1px dashed ${C.line}`, borderRadius: 8, color: C.gold, fontSize: 11.5, fontWeight: 700, padding: "6px 10px", cursor: "pointer", fontFamily: "inherit" }}><Plus size={12} /> {lang === "he" ? "הוסף" : "Add"}</button>
      </div>

      <div style={{ marginTop: 14, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>{t.top}</div>
        {chg.dropped.length > 0 && (
          <div style={{ fontSize: 11.5, color: C.muted, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 9, padding: "7px 11px", marginBottom: 8 }}>
            {lang === "he" ? "כבר לא פורצים: " : "No longer breaking out: "}
            <b style={{ color: C.loss }}>{chg.dropped.map((x) => x.split("/")[0]).join(", ")}</b>
          </div>
        )}
        {top.length === 0 ? <div style={{ fontSize: 12.5, color: C.faint }}>{runM.isPending ? t.running : t.empty}</div> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
            {top.map((s: any, i: number) => {
              const ti = tierInfo(s.tier);
              return (
                <button key={i} className="scanCard" onClick={() => setSel({ ...s, rank: i + 1, ti })}
                  style={{ textAlign: "start", cursor: "pointer", fontFamily: "inherit", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 10px", transition: "all .15s" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: C.text, display: "inline-flex", alignItems: "center", gap: 5 }}>
                      {i + 1}. {s.symbol}
                      {chg.isNew(String(s.symbol || "")) && <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.04em", color: "var(--btn-ink)", background: "var(--btn-bg)", borderRadius: 999, padding: "1px 5px" }}>{lang === "he" ? "חדש" : "NEW"}</span>}
                    </span>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: ti.c, transform: "rotate(45deg)" }} />
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 12, color: C.muted, marginTop: 3 }}>${s.currentPrice}</div>
                  <div style={{ fontSize: 10.5, color: ti.c, marginTop: 2 }}>{(ti as any)[lang] || s.tier}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Full, organized results list — every result (not just the top 10), ordered
          by rank, with all the per-asset columns. Scrolls internally so the whole
          set stays reachable. Clicking a row opens the same quick-view modal. */}
      {all.length > 0 && (
        <div style={{ marginTop: 14, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>{t.allTitle}</span>
            <span style={{ fontSize: 11, color: C.faint }}>{t.allHint(all.length)}</span>
          </div>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflowX: "auto", overflowY: "auto", maxHeight: "52svh" }}>
            <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.line}` }}>
                  <th style={dsh("center")}>{t.th.rank}</th>
                  <th style={dsh("start")}>{t.th.asset}</th>
                  <th style={dsh("start")}>{t.th.tier}</th>
                  <th style={dsh("end")}>{t.th.price}</th>
                  <th style={dsh("end")}>{t.th.today}</th>
                  <th style={dsh("end")}>{t.th.yest}</th>
                  <th style={dsh("center")}>{t.th.green}</th>
                  <th style={dsh("start")}>{t.th.date}</th>
                  <th style={dsh("end")}>{t.th.toGreen}</th>
                </tr>
              </thead>
              <tbody>
                {all.map((s: any, i: number) => {
                  const ti = tierInfo(s.tier);
                  const today = typeof s.changeTodayPct === "number" ? s.changeTodayPct : null;
                  const yest = typeof s.changeYesterdayPct === "number" ? s.changeYesterdayPct : null;
                  const ptg = typeof s.pctToGreen === "number" ? s.pctToGreen : null;
                  return (
                    <tr key={`${s.symbol}:${i}`} onClick={() => setSel({ ...s, rank: i + 1, ti })}
                      style={{ borderBottom: i === all.length - 1 ? "none" : `1px solid ${C.line}`, cursor: "pointer" }}>
                      <td style={{ ...dst(rtl), textAlign: "center", color: C.faint, fontFamily: MONO }}>{i + 1}</td>
                      <td style={{ ...dst(rtl), fontWeight: 700, whiteSpace: "nowrap" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: ti.c, transform: "rotate(45deg)", flexShrink: 0 }} />
                          {s.symbol}
                          {chg.isNew(String(s.symbol || "")) && <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.04em", color: "var(--btn-ink)", background: "var(--btn-bg)", borderRadius: 999, padding: "1px 5px" }}>{lang === "he" ? "חדש" : "NEW"}</span>}
                        </span>
                      </td>
                      <td style={{ ...dst(rtl), color: ti.c, whiteSpace: "nowrap" }}>{(ti as any)[lang] || s.tier}</td>
                      <td style={{ ...dst(rtl), textAlign: "end", fontFamily: MONO, color: C.muted, whiteSpace: "nowrap" }}>${s.currentPrice}</td>
                      <td style={{ ...dst(rtl), textAlign: "end", fontFamily: MONO, whiteSpace: "nowrap", color: today == null ? C.faint : today >= 0 ? C.gain : C.loss }}>{today == null ? "—" : `${today > 0 ? "+" : ""}${today.toFixed(1)}%`}</td>
                      <td style={{ ...dst(rtl), textAlign: "end", fontFamily: MONO, whiteSpace: "nowrap", color: yest == null ? C.faint : yest >= 0 ? C.gain : C.loss }}>{yest == null ? "—" : `${yest > 0 ? "+" : ""}${yest.toFixed(1)}%`}</td>
                      <td style={{ ...dst(rtl), textAlign: "center", whiteSpace: "nowrap", color: s.stillGreen ? C.gain : C.loss }}>{s.stillGreen ? (lang === "he" ? "כן ✓" : "Yes ✓") : (lang === "he" ? "לא" : "No")}</td>
                      <td style={{ ...dst(rtl), color: C.muted, whiteSpace: "nowrap" }}>{s.breakoutDate || "—"}</td>
                      <td style={{ ...dst(rtl), textAlign: "end", fontFamily: MONO, whiteSpace: "nowrap", color: ptg == null ? C.faint : ptg <= 0 ? C.gain : C.gold }}>{ptg == null ? "—" : `${ptg > 0 ? "+" : ""}${ptg.toFixed(1)}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`.scanCard:hover{border-color:${C.gold} !important;transform:translateY(-2px);box-shadow:0 8px 22px rgba(0,0,0,0.35)}`}</style>
      {sel && (
        <div onClick={() => setSel(null)} style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)", direction: rtl ? "rtl" : "ltr" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", width: "100%", maxWidth: 360, background: "linear-gradient(170deg,#15101f,#0B0613)", border: `1px solid ${sel.ti.c}66`, borderRadius: 18, padding: 22, boxShadow: "0 22px 60px rgba(0,0,0,0.55)" }}>
            <button onClick={() => setSel(null)} aria-label="close" style={{ position: "absolute", top: 12, insetInlineEnd: 12, width: 30, height: 30, borderRadius: 8, background: C.surface2, border: `1px solid ${C.line}`, cursor: "pointer", color: C.muted, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><X size={15} /></button>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: sel.ti.c, transform: "rotate(45deg)" }} />
              <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#fff" }}>{sel.symbol}</h3>
            </div>
            <div style={{ fontSize: 13, color: sel.ti.c, marginBottom: 12 }}>#{sel.rank} · {(sel.ti as any)[lang] || sel.tier}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              <div style={{ background: C.surface2, borderRadius: 9, padding: "9px 11px" }}><div style={{ fontSize: 11, color: C.muted }}>{lang === "he" ? "מחיר" : "Price"}</div><div style={{ fontFamily: MONO, fontSize: 15, color: C.text }}>${sel.currentPrice}</div></div>
              {sel.netPnlPct != null && <div style={{ background: C.surface2, borderRadius: 9, padding: "9px 11px" }}><div style={{ fontSize: 11, color: C.muted }}>{lang === "he" ? "רווח/הפסד" : "Net P&L"}</div><div style={{ fontFamily: MONO, fontSize: 15, color: Number(sel.netPnlPct) >= 0 ? C.gain : C.loss }}>{Number(sel.netPnlPct).toFixed(2)}%</div></div>}
            </div>
            {/* breakout detail: when it started, yesterday, still green?, today */}
            <div style={{ background: C.surface2, borderRadius: 9, padding: "10px 12px", marginBottom: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "9px 12px", fontSize: 12 }}>
              <div><span style={{ color: C.muted }}>{lang === "he" ? "פריצה החלה" : "Breakout started"}</span><div style={{ fontWeight: 700, marginTop: 1 }}>{sel.breakoutDate || "—"}</div></div>
              <div><span style={{ color: C.muted }}>{lang === "he" ? "עדיין ירוק?" : "Still green?"}</span><div style={{ fontWeight: 700, marginTop: 1, color: sel.stillGreen ? C.gain : C.loss }}>{sel.stillGreen ? (lang === "he" ? "כן ✓" : "Yes ✓") : (lang === "he" ? "לא" : "No")}</div></div>
              <div><span style={{ color: C.muted }}>{lang === "he" ? "אתמול" : "Yesterday"}</span><div style={{ fontWeight: 700, marginTop: 1, fontFamily: MONO, color: (sel.changeYesterdayPct ?? 0) >= 0 ? C.gain : C.loss }}>{typeof sel.changeYesterdayPct === "number" ? `${sel.changeYesterdayPct > 0 ? "+" : ""}${sel.changeYesterdayPct.toFixed(1)}%` : "—"}</div></div>
              <div><span style={{ color: C.muted }}>{lang === "he" ? "היום" : "Today"}</span><div style={{ fontWeight: 700, marginTop: 1, fontFamily: MONO, color: (sel.changeTodayPct ?? 0) >= 0 ? C.gain : C.loss }}>{typeof sel.changeTodayPct === "number" ? `${sel.changeTodayPct > 0 ? "+" : ""}${sel.changeTodayPct.toFixed(1)}%` : "—"}</div></div>
              {sel.desc && <div style={{ gridColumn: "1 / -1", color: C.faint, fontSize: 11.5, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>{sel.desc}</div>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button onClick={() => { setSel(null); nav("/profit"); }} className="gbtn" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 11, padding: "11px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}><TrendingUp size={15} /> {lang === "he" ? "בנה תוכנית רווח" : "Build profit plan"} <ArrowRight size={13} /></button>
              <button onClick={() => { setSel(null); nav("/backtests"); }} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 11, padding: "11px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}><FlaskConical size={15} /> {lang === "he" ? "בדוק בבקטסט" : "Test in backtest"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Full-results table cell styles — shared header/row look for the "All results"
// list, kept in line with the app's other scan tables (muted uppercase headers,
// RTL-aware row alignment).
const dsh = (align: "start" | "end" | "center"): React.CSSProperties => ({
  textAlign: align as any, fontWeight: 600, padding: "8px 10px", fontSize: 10.5,
  textTransform: "uppercase", letterSpacing: 0.5, color: C.muted, whiteSpace: "nowrap",
  position: "sticky", top: 0, background: C.surface, zIndex: 1,
});
const dst = (rtl: boolean): React.CSSProperties => ({ padding: "8px 10px", textAlign: rtl ? "right" : "left", color: C.text });
