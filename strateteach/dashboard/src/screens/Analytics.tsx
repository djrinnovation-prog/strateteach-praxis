import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Link2, TrendingUp, Save, ArrowRight, FlaskConical, Activity, Target, History, Diamond } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { useIsMobile } from "../lib/useIsMobile";
import { C, SHADOW, UI } from "../theme";
import { Metric, Empty, btn, premSoft, errBox, okBox, Spin } from "../ui";
import { HubPanel } from "../components/HubScreen";
import HomeTop from "../components/HomeTop";
import FramedTitle from "../components/FramedTitle";
import { GlassTile, TileGrid, homeDim } from "../components/GlassTile";
import SquareRow from "../components/SquareRow";
import { centralExtras } from "../lib/centralExtras";
import ScreenShortcuts from "../components/ScreenShortcuts";
import ScreenBottom from "../components/ScreenBottom";
import { useViewMode, ViewToggle } from "../components/ViewToggle";

const L = {
  he: {
    title: "ביצועים ויעד הצלחה", sub: "כל הנתונים שלך במקום אחד — כדי להשתפר",
    target: "יעד אחוז הצלחה", setTarget: "שמור יעד", winRate: "אחוז הצלחה",
    trades: "עסקאות", wins: "מנצחות", losses: "מפסידות", net: "רווח/הפסד נטו",
    pf: "פקטור רווח", avgWin: "ממוצע רווח", avgLoss: "ממוצע הפסד",
    onTarget: "מעל היעד 🎯", below: "מתחת ליעד", gap: "פער ליעד",
    recent: "עסקאות אחרונות", none: "אין עדיין עסקאות סגורות — הרץ סשן דמו במנוע המסחר",
    tip: "טיפ", improving: "להעלאת אחוז ההצלחה: קח רווחים מוקדם יותר, צמצם מספר פוזיציות במקביל, והעדף דרגות 'פורץ' ו'קרוב לפריצה'.",
    info: "מסך הביצועים מסכם את כל העסקאות הסגורות שלך (כרגע מסשני הדמו של מנוע המסחר): אחוז ההצלחה מול היעד, רווח/הפסד נטו, פקטור רווח ועוד. הכפתורים למטה לוקחים אותך למסכים שמהם הנתונים נבנים.",
    sources: "מאיפה הנתונים נבנים", goSessions: "מנוע מסחר · סשנים", goActivity: "יומן פעילות", goBacktests: "בדיקות היסטוריות",
    fTarget: "יעד הצלחה", fPerf: "ביצועים", fRecent: "אחרונות", fSources: "מקורות",
  },
  en: {
    title: "Performance & win target", sub: "All your data in one place — to improve",
    target: "Win-rate target (%)", setTarget: "Save target", winRate: "Win rate",
    trades: "Trades", wins: "Wins", losses: "Losses", net: "Net P&L",
    pf: "Profit factor", avgWin: "Avg win", avgLoss: "Avg loss",
    onTarget: "Above target 🎯", below: "Below target", gap: "Gap to target",
    recent: "Recent trades", none: "No closed trades yet — run a demo session in the Trading engine",
    tip: "Tip", improving: "To lift your win rate: take profits earlier, run fewer concurrent positions, and favor the 'breaking out' / 'near breakout' tiers.",
    info: "The Performance screen summarizes all your closed trades (currently from the Trading engine's demo sessions): win rate vs your target, net P&L, profit factor and more. The buttons below jump to the screens the data is built from.",
    sources: "Where the data is built from", goSessions: "Trading engine · sessions", goActivity: "Activity log", goBacktests: "Backtests",
    fTarget: "Win target", fPerf: "Performance", fRecent: "Recent", fSources: "Sources",
  },
};

function Gauge({ value, target }: { value: number; target: number }) {
  // semicircle gauge 0..100
  const r = 80, cx = 100, cy = 100;
  const ang = (p: number) => Math.PI - (Math.max(0, Math.min(100, p)) / 100) * Math.PI;
  const pt = (p: number, rr = r) => [cx + rr * Math.cos(ang(p)), cy - rr * Math.sin(ang(p))];
  const [vx, vy] = pt(value);
  const [tx1, ty1] = pt(target, r - 14), [tx2, ty2] = pt(target, r + 6);
  const arc = (p: number) => {
    const [x, y] = pt(p);
    return `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x} ${y}`;
  };
  const col = value >= target ? C.gain : value >= target * 0.7 ? C.gold : C.loss;
  return (
    <svg viewBox="0 0 200 118" style={{ width: "100%", maxWidth: 260, display: "block", margin: "0 auto" }} preserveAspectRatio="xMidYMid meet">
      <path d={arc(100)} fill="none" stroke={C.line} strokeWidth="13" strokeLinecap="round" />
      <path d={arc(value)} fill="none" stroke={col} strokeWidth="13" strokeLinecap="round" />
      <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke={C.text} strokeWidth="2.5" />
      <circle cx={vx} cy={vy} r="5.5" fill={col} />
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize="27" fontWeight="800" fill={C.text}>{value.toFixed(0)}%</text>
      <text x={cx} y={cy + 13} textAnchor="middle" fontSize="10.5" fill={C.muted}>target {target.toFixed(0)}%</text>
    </svg>
  );
}

export default function Analytics() {
  const { lang, rtl } = useI18n();
  const t = L[lang];
  const he = lang === "he";
  const nav = useNavigate();
  const mobile = useIsMobile();
  const qc = useQueryClient();
  const [target, setTarget] = useState<number>(60);
  const [touched, setTouched] = useState(false);
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");
  // URL-driven child navigation (Back returns to the launcher) — the finalized model.
  const [sp, setSp] = useSearchParams();
  const sec = sp.get("sec") || "";
  const setSec = (v: string) => setSp(v ? { sec: v } : {});
  const [moreView, setMoreView] = useViewMode("algo770_analytics_more_view_v1", "cards");

  const profQ = useQuery({ queryKey: ["myProfile"], queryFn: () => api.myProfile() });
  const aQ = useQuery({ queryKey: ["myAnalytics"], queryFn: () => api.myAnalytics(), refetchInterval: 20000 });
  useEffect(() => { if (profQ.data && !touched) setTarget(Number((profQ.data as any).winTarget) || 60); }, [profQ.data]); // eslint-disable-line

  const saveM = useMutation({
    mutationFn: () => api.setWinTarget(target),
    onSuccess: () => { setErr(""); setOk("✓"); qc.invalidateQueries({ queryKey: ["myAnalytics"] }); qc.invalidateQueries({ queryKey: ["myProfile"] }); },
    onError: (e: any) => { setOk(""); setErr(e?.message || String(e)); },
  });

  const a: any = aQ.data || {};
  const wr = Number(a.winRate || 0);

  // The trading-success HERO — the visual focal point Dan wants front & centre.
  // Reuses the existing win-rate ring (Gauge) + the SAME myAnalytics() data: the two
  // headline numbers (net P&L + win rate) are large and bold, with the supporting
  // stats (trades / wins / losses / profit factor / vs-target) beneath. Always
  // visible (composed into topCard), so it stays prominent on every sub-screen.
  const heroView = () => {
    const net = Number(a.netPnl || 0);
    const onTarget = wr >= target;
    const supp: [string, React.ReactNode, string][] = [
      [t.trades, a.trades ?? 0, C.text],
      [t.wins, a.wins ?? 0, C.gain],
      [t.losses, a.losses ?? 0, C.loss],
      [t.pf, a.profitFactor ?? 0, C.text],
      [t.fTarget, `${target}%`, C.gold],
    ];
    return (
      <div style={{ marginBottom: 14, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, border: `1px solid ${C.line}`, borderRadius: 18, padding: mobile ? "18px 16px" : "22px 24px", boxShadow: SHADOW, textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 800, color: C.gold, letterSpacing: 0.4, textTransform: "uppercase" }}>
          <Diamond size={13} color={C.gold} fill={C.gold} /> {lang === "he" ? "הצלחת המסחר שלך" : "Your trading success"}
        </div>
        <div style={{ fontSize: 11, color: C.faint, marginTop: 3 }}>{lang === "he" ? "דמו · סימולציה" : "Demo · simulation"}</div>
        {/* Two headline numbers: win-rate ring + the net-P&L profit figure, large & bold. */}
        <div style={{ display: "flex", flexDirection: mobile ? "column" : "row", alignItems: "center", justifyContent: "center", gap: mobile ? 6 : 40, marginTop: 14 }}>
          <div style={{ width: mobile ? "100%" : 240, maxWidth: 260, flexShrink: 0 }}><Gauge value={wr} target={target} /></div>
          <div>
            <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 600 }}>{t.net}</div>
            <div style={{ fontSize: mobile ? 40 : 52, fontWeight: 800, lineHeight: 1.05, color: net >= 0 ? C.gain : C.loss }}>
              {net >= 0 ? "+" : "-"}${Math.abs(net).toLocaleString()}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 6, color: onTarget ? C.gain : C.muted }}>
              {t.winRate}: {wr.toFixed(1)}% · {onTarget ? t.onTarget : `${t.gap}: ${(target - wr).toFixed(1)}%`}
            </div>
          </div>
        </div>
        {/* Supporting stats beneath the headline. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(92px,1fr))", gap: 10, marginTop: 18, maxWidth: 560, marginInline: "auto" }}>
          {supp.map(([lbl, val, col], i) => (
            <div key={i} style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "9px 8px" }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: col }}>{val}</div>
              <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>{lbl}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const targetView = () => (
    <div style={{ display: "flex", flexDirection: mobile ? "column" : "row", flexWrap: "wrap", gap: mobile ? 14 : 24, alignItems: "center" }}>
      <div style={{ width: mobile ? "100%" : 240, flexShrink: 0 }}><Gauge value={wr} target={target} /></div>
      <div style={{ flex: 1, minWidth: mobile ? "auto" : 220, width: mobile ? "100%" : "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <input type="range" min={0} max={100} value={target}
            onChange={(e) => { setTouched(true); setTarget(Number(e.target.value)); }}
            style={{ flex: 1, accentColor: C.gold }} />
          <span style={{ fontWeight: 800, width: 56, textAlign: "end", color: C.gold, fontSize: 19 }}>{target}%</span>
        </div>
        <div style={{ fontSize: 13, color: wr >= target ? C.gain : C.muted, marginBottom: 12 }}>
          {wr >= target ? t.onTarget : `${t.gap}: ${(target - wr).toFixed(1)}%`}
        </div>
        <button onClick={() => { setErr(""); saveM.mutate(); }} disabled={saveM.isPending} className="gbtn ptile" style={btn(true)}>
          {saveM.isPending ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {t.setTarget}
        </button>
      </div>
    </div>
  );

  const perfView = () => (
    <>
      <div onClick={() => nav("/profit")} title={lang === "he" ? "מקור הנתונים: מנוע המסחר" : "Source: Trading Engine"} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px,1fr))", gap: 12, cursor: "pointer", marginTop: 12 }}>
        <Metric label={t.winRate} value={`${wr.toFixed(1)}%`} color={wr >= target ? C.gain : C.loss} />
        <Metric label={t.trades} value={a.trades ?? 0} />
        <Metric label={t.wins} value={a.wins ?? 0} color={C.gain} />
        <Metric label={t.losses} value={a.losses ?? 0} color={C.loss} />
        <Metric label={t.net} value={`$${Number(a.netPnl || 0).toLocaleString()}`} color={Number(a.netPnl || 0) >= 0 ? C.gain : C.loss} />
        <Metric label={t.pf} value={a.profitFactor ?? 0} />
        <Metric label={t.avgWin} value={`$${Number(a.avgWin || 0).toLocaleString()}`} color={C.gain} />
        <Metric label={t.avgLoss} value={`$${Number(a.avgLoss || 0).toLocaleString()}`} color={C.loss} />
      </div>
      <div style={{ fontSize: 10.5, color: C.faint, marginTop: 8 }}>{lang === "he" ? "↳ לחצו לצפייה במקור (מנוע המסחר)" : "↳ tap to see the source (Trading Engine)"}</div>
      <div style={{ marginTop: 14, fontSize: 12.5, color: C.muted, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px", boxShadow: SHADOW }}>
        <b style={{ color: C.gold }}>{t.tip}:</b> {t.improving}
      </div>
    </>
  );

  const recentView = () => (
    (!a.recent || a.recent.length === 0) ? <Empty>{t.none}</Empty> : (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {a.recent.map((r: any, i: number) => (
          <span key={i} role="button" onClick={() => nav("/activity")} title={lang === "he" ? "צפו ביומן הפעילות" : "Open activity log"}
            style={{ fontSize: 12, fontFamily: "monospace", padding: "6px 11px", borderRadius: 10, cursor: "pointer", whiteSpace: "nowrap",
            border: `1px solid ${C.line}`, background: C.surface2, color: Number(r.pnl) >= 0 ? C.gain : C.loss, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)" }}>
            {r.symbol || "—"} {Number(r.pnl) >= 0 ? "+" : ""}{r.pnl}
          </span>
        ))}
      </div>
    )
  );

  const sourcesView = () => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button onClick={() => nav("/profit")} style={{ ...btn(), ...premSoft(), display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 15px", whiteSpace: "nowrap" }}><TrendingUp size={14} color={C.gold} /> {t.goSessions} <ArrowRight size={13} /></button>
      <button onClick={() => nav("/activity")} style={{ ...btn(), ...premSoft(), display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 15px", whiteSpace: "nowrap" }}><Activity size={14} color={C.gold} /> {t.goActivity} <ArrowRight size={13} /></button>
      <button onClick={() => nav("/backtests")} style={{ ...btn(), ...premSoft(), display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 15px", whiteSpace: "nowrap" }}><FlaskConical size={14} color={C.gold} /> {t.goBacktests} <ArrowRight size={13} /></button>
    </div>
  );

  const bannerEl = <>{err && <div style={errBox}>{err}</div>}{ok && <div style={okBox}>{ok}</div>}</>;

  return (
    <div style={{ direction: rtl ? "rtl" : "ltr", fontFamily: UI, color: C.text,
      display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>

      {sec === "" && (
        <>
          <FramedTitle text={t.title} subtitle={t.sub} />

          {/* Editable top shortcuts — the "עוד במערכת" chip opens the More CHILD (not a modal). */}
          <ScreenShortcuts
            screenKey="analytics"
            defaultKeys={["perf", "target", "recent", "sources"]}
            onMore={() => setSec("more")}
            catalog={[
              { key: "perf", label: t.fPerf, Icon: TrendingUp, onClick: () => setSec("perf") },
              { key: "target", label: t.fTarget, Icon: Target, onClick: () => setSec("target") },
              { key: "recent", label: t.fRecent, Icon: History, onClick: () => setSec("recent") },
              { key: "sources", label: t.fSources, Icon: Link2, onClick: () => setSec("sources") },
            ]}
          />

          {/* 2 central glass buttons — Home's exact SQUARES (centered), primary bigger. */}
          <SquareRow screenKey="analytics-central" mobile={mobile} defaultShown={["perf", "target"]}
            squares={[
              { id: "perf", variant: "primary", Icon: TrendingUp, label: t.fPerf, sub: t.winRate, onClick: () => setSec("perf") },
              { id: "target", variant: "secondary", Icon: Target, label: t.fTarget, sub: `${target}%`, onClick: () => setSec("target") },
              ...centralExtras(he, nav, { exclude: ["analytics"] }),
            ]} />
        </>
      )}

      {/* ── "עוד במערכת" CHILD — the performance areas as a tile grid with a rows/tiles toggle. ── */}
      {sec === "more" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FramedTitle text={he ? "עוד במערכת" : "More"} subtitle={t.sources} />
          <div style={{ display: "flex", justifyContent: "flex-end", margin: "2px 2px 0" }}>
            <ViewToggle view={moreView} onChange={setMoreView} he={he} />
          </div>
          <TileGrid screenKey="analytics-more" view={moreView} columns={3} aspect={1.08} tiles={[
            { id: "perf", label: t.fPerf, Icon: TrendingUp, onClick: () => setSec("perf") },
            { id: "target", label: t.fTarget, Icon: Target, onClick: () => setSec("target") },
            { id: "recent", label: t.recent, Icon: History, onClick: () => setSec("recent") },
            { id: "sources", label: t.sources, Icon: Link2, onClick: () => setSec("sources") },
            { id: "sessions", label: t.goSessions, Icon: TrendingUp, onClick: () => nav("/profit") },
            { id: "activity", label: t.goActivity, Icon: Activity, onClick: () => nav("/activity") },
            { id: "backtests", label: t.goBacktests, Icon: FlaskConical, onClick: () => nav("/backtests") },
          ]} />
        </div>
      )}

      {/* ── Performance CHILD — the win-rate hero + the full metrics grid. ── */}
      {sec === "perf" && (
        <HubPanel alwaysOpen ns="analytics" id="perf" title={t.fPerf} icon={<TrendingUp size={15} />} onClose={() => setSec("")}>
          <HomeTop />
          {heroView()}
          {perfView()}
        </HubPanel>
      )}

      {/* ── Win-target CHILD — the target slider + save. ── */}
      {sec === "target" && (
        <HubPanel alwaysOpen ns="analytics" id="target" title={t.target} icon={<Target size={15} />} onClose={() => setSec("")}>
          {bannerEl}
          {targetView()}
        </HubPanel>
      )}

      {/* ── Recent-trades CHILD. ── */}
      {sec === "recent" && (
        <HubPanel alwaysOpen ns="analytics" id="recent" title={t.recent} icon={<History size={15} />} onClose={() => setSec("")}>
          {recentView()}
        </HubPanel>
      )}

      {/* ── Sources CHILD — where the data is built from. ── */}
      {sec === "sources" && (
        <HubPanel alwaysOpen ns="analytics" id="sources" title={t.sources} icon={<Link2 size={15} />} onClose={() => setSec("")}>
          {sourcesView()}
        </HubPanel>
      )}

      {/* Persistent bottom cluster (like Home): live/demo P&L + Help-Portal, above the tab bar. */}
      <ScreenBottom />
      <Spin />
    </div>
  );
}
