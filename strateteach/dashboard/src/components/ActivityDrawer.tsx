import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity as ActivityIcon, ChevronLeft, ChevronRight, X, Lock, Loader2 } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, MONO } from "../theme";
import ProfitCalendar from "./ProfitCalendar";

// Slide-out activity panel — hidden by default, opened with an edge arrow so it
// never crowds the main screen (per the product spec).
export default function ActivityDrawer() {
  const { t, rtl, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"demo" | "live">(() => { try { return localStorage.getItem("algo770_profit_mode") === "live" ? "live" : "demo"; } catch { return "demo"; } });
  const q = useQuery({ queryKey: ["activityDrawer", mode], queryFn: () => api.activity(60, mode), enabled: open, refetchInterval: open ? 10000 : false });

  const data: any = q.data;
  const events: any[] = data?.events || [];
  const locked = mode === "live" && data?.liveLocked;
  const edge = rtl ? "left" : "right";
  const Arrow = open ? (rtl ? ChevronLeft : ChevronRight) : (rtl ? ChevronRight : ChevronLeft);

  return (
    <>
      {/* edge toggle */}
      <button onClick={() => setOpen((o) => !o)} aria-label={t.activity}
        style={{ position: "fixed", [edge]: open ? 332 : 0, top: "calc(50% - 120px)", zIndex: 60, display: "flex", alignItems: "center", gap: 6,
          background: "var(--btn-bg)", color: "var(--btn-ink)", border: "none", cursor: "pointer", padding: "10px 8px",
          borderRadius: rtl ? "0 10px 10px 0" : "10px 0 0 10px", boxShadow: "0 6px 20px rgba(0,0,0,0.4)", transition: "all 0.25s",
          writingMode: open ? "horizontal-tb" : "vertical-rl" } as React.CSSProperties}>
        {open ? <Arrow size={16} /> : <><ActivityIcon size={15} /> <span style={{ fontSize: 12, fontWeight: 700 }}>{t.activity}</span></>}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 55 }} />
          <aside style={{ position: "fixed", top: 0, bottom: 0, [edge]: 0, width: 332, background: C.surface, borderInlineStart: `1px solid ${C.line}`,
            zIndex: 56, display: "flex", flexDirection: "column", boxShadow: "0 0 40px rgba(0,0,0,0.5)" } as React.CSSProperties}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: `1px solid ${C.line}` }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700 }}><ActivityIcon size={16} color={C.gold} /> {t.activity}</span>
              <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={16} /></button>
            </div>

            <div style={{ display: "flex", gap: 6, padding: "10px 16px" }}>
              {(["demo", "live"] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)} style={{ flex: 1, padding: "6px 0", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
                  border: `1px solid ${mode === m ? C.gold : C.line}`, background: mode === m ? "var(--btn-bg)" : C.surface2, color: mode === m ? "var(--btn-ink)" : C.muted }}>
                  {m === "demo" ? t.demoActivity : t.liveActivity}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
              {/* Profit calendar (demo) — green/red days, tap a day for its trades */}
              {mode === "demo" && !locked && <div style={{ paddingTop: 12 }}><ProfitCalendar lang={lang} rtl={rtl} /></div>}
              {mode === "demo" && !locked && events.length > 0 && (
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", color: C.faint, textTransform: "uppercase", margin: "4px 0 6px" }}>{lang === "he" ? "פעילות אחרונה" : "Recent activity"}</div>
              )}
              {q.isLoading ? <Mid><Loader2 size={16} className="spin" /></Mid>
                : locked ? <Mid><Lock size={15} /> &nbsp;{t.liveLocked}</Mid>
                : events.length === 0 ? (mode === "demo" ? null : <Mid>{t.noActivity}</Mid>)
                : events.map((e) => (
                  <div key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "9px 0", borderBottom: `1px solid ${C.line}` }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{e.kind}{e.symbol ? ` · ${e.symbol}` : ""}</div>
                      <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>{e.ts ? new Date(e.ts).toLocaleString(lang === "he" ? "he-IL" : "en-US") : ""}</div>
                    </div>
                    {e.pnl != null && <div style={{ fontFamily: MONO, fontSize: 13, color: e.pnl >= 0 ? C.gain : C.loss, whiteSpace: "nowrap" }}>{e.pnl >= 0 ? "+" : "-"}${Math.abs(e.pnl).toFixed(2)}</div>}
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

function Mid({ children }: any) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, padding: "40px 0", textAlign: "center", fontSize: 13 }}>{children}</div>;
}
