import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Layers, AlertTriangle, Sliders, Microscope, Wallet, Play, Zap, Settings, ArrowLeftRight, FlaskConical, Activity, BarChart3 } from "lucide-react";
import { api, loadExchangeCreds } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI, onAccent } from "../theme";
import { errBox, okBox, Spin } from "../ui";
import PositionsWidget from "../components/PositionsWidget";
import TourLauncher from "../components/TourLauncher";
import ScreenShortcuts from "../components/ScreenShortcuts";
import ConfirmModal from "../components/ConfirmModal";
import FramedTitle from "../components/FramedTitle";
import { GlassTile, TileGrid, homeDim } from "../components/GlassTile";
import SquareRow from "../components/SquareRow";
import { centralExtras } from "../lib/centralExtras";
import ScreenBottom from "../components/ScreenBottom";
import { useViewMode, ViewToggle } from "../components/ViewToggle";
import { HubPanel } from "../components/HubScreen";
import { useIsMobile } from "../lib/useIsMobile";
import { track } from "../lib/analytics";
import HomeTop from "../components/HomeTop";
import ProfitEngine from "./ProfitEngine";

// Last-used LIVE allocation/strategy, cached client-side so the real-money start gate pre-fills
// instantly (no "—" flash) and starting live is closer to one tap. DISPLAY-ONLY: the engine still
// runs off the server config; this only seeds the confirmation PREVIEW until live data resolves.
const LAST_ALLOC_KEY = "algo770_profit_live_alloc_v1";
function loadLastAlloc(): { alloc?: string; strat?: string } {
  try { return JSON.parse(localStorage.getItem(LAST_ALLOC_KEY) || "{}") || {}; } catch { return {}; }
}
function saveLastAlloc(v: { alloc: string; strat: string }) {
  try { localStorage.setItem(LAST_ALLOC_KEY, JSON.stringify(v)); } catch { /* ignore quota/private-mode */ }
}

// Trading engine hero copy. The engine flow itself lives in <ProfitEngine/>.
const HERO = {
  he: { concept: "ATS — מערכת מסחר אלגוריתמית", title: "מנוע מסחר יומי", tagline: "דיוק אלגוריתמי, שליטה מלאה",
    sub: "כל בחירה היא כניסה מחושבת — המערכת בונה לכם תוכנית יומית מהסיגנלים, ואתם מאשרים כל פקודה.",
    chips: ["הסיגנלים של היום → הקלט", "כל בחירה → פוזיציה", "אתם מאשרים כל פקודה"], harvest: "מימוש רווחים", harvested: "הרווחים מומשו" },
  en: { concept: "ATS — Algo Trading System", title: "Daily Trading Engine", tagline: "Algorithmic precision, full control",
    sub: "Every pick is a calculated entry — the system builds your daily plan from live signals, and you approve every order.",
    chips: ["Today's signals → the inputs", "Each pick → a position", "You approve every order"], harvest: "Harvest profits", harvested: "Profits harvested" },
};
const MODESEL = {
  he: { choose: "בחרו מצב", chooseSub: "להתאמן בלי סיכון, או לסחור באמת",
    demo: "דמו", demoTag: "כסף וירטואלי", demoSub: "מתאמנים עם כסף וירטואלי. בלי בורסה, בלי סיכון, בלי סיסמה.",
    live: "לייב", liveTag: "כסף אמיתי", liveSub: "מסחר בכסף אמיתי בבורסה המחוברת. אתם מאשרים כל פקודה.",
    change: "שנה מצב", demoBadge: "מצב דמו", liveBadge: "מצב לייב", needKeys: "חברו בורסה (מסך בורסה) כדי לסחור בלייב." },
  en: { choose: "Choose a mode", chooseSub: "Practice risk-free, or trade for real",
    demo: "Demo", demoTag: "virtual money", demoSub: "Practice with virtual money. No exchange, no risk, no password.",
    live: "Live", liveTag: "real money", liveSub: "Trade real money on your connected exchange. You approve every order.",
    change: "Change mode", demoBadge: "Demo mode", liveBadge: "Live mode", needKeys: "Connect your exchange (Exchange screen) to trade live." },
};

export default function Profit() {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const h = HERO[lang];
  const ms = MODESEL[lang];
  const qc = useQueryClient();
  const nav = useNavigate();
  const mobile = useIsMobile();
  // URL-driven child navigation (Back returns to the launcher) — the finalized model.
  const [sp, setSp] = useSearchParams();
  const sec = sp.get("sec") || "";
  const setSec = (v: string) => setSp(v ? { sec: v } : {});
  const [moreView, setMoreView] = useViewMode("algo770_profit_more_view_v1", "cards");
  // Config drives the LIVE-start confirmation preview (allocation / strategy). The
  // engine flow itself lives in <ProfitEngine/>; here we only need the config for
  // that preview, plus the mode wiring + live-status pill.
  const cfgQ = useQuery({ queryKey: ["profitConfig"], queryFn: () => api.profitConfig() });
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (cfgQ.data && !f) setF({ ...cfgQ.data }); }, [cfgQ.data]); // eslint-disable-line
  // Running demo/live session count for the live-status pill.
  const liveQ = useQuery({ queryKey: ["dashboardLive"], queryFn: () => api.dashboardLive(), refetchInterval: 15000, retry: 0 });
  const runs = Number((liveQ.data as any)?.runningSessions || 0);
  // Live (real-money) context: connection + available USDT (for the start preview).
  const exConn = !!loadExchangeCreds();
  const exBalQ = useQuery({ queryKey: ["exBalanceOv"], queryFn: () => api.balance(), enabled: exConn, retry: false, refetchInterval: 30000 });
  const exBal: any = exBalQ.data;
  const exUsdt = (exBal?.balances || []).find((b: any) => String(b.asset || "").toUpperCase() === "USDT");
  const liveAvail = exUsdt ? Number(exUsdt.free) : null;
  const moneyS = (n: number | null) => (n == null ? "—" : "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));

  const [mode, setMode] = useState<"demo" | "live" | null>(() => (localStorage.getItem("algo770_profit_mode") as any) || null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const chooseMode = (mm: "demo" | "live") => { localStorage.setItem("algo770_profit_mode", mm); setMode(mm); setErr(""); };
  // Home-methodology hero wiring (re-layout; every target is a REAL existing action).
  const engineRef = useRef<HTMLDivElement>(null);
  const positionsRef = useRef<HTMLDivElement>(null);
  const scrollTo = (r: React.RefObject<HTMLDivElement>) => setTimeout(() => r.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  const startMode = (mm: "demo" | "live") => {
    chooseMode(mm); setSec("engine"); scrollTo(engineRef);
    track("engine_start", { mode: mm });
    // Activation: the first time the user ever starts the engine (either mode) is a
    // "first value" moment. Guarded once per browser.
    try { if (!localStorage.getItem("algo770_first_value")) { localStorage.setItem("algo770_first_value", "engine"); track("first_value_action", { action: "engine_start", mode: mm }); } } catch (_e) { /* */ }
  };
  // Financial-safety gate (additive): a preview + confirm before starting LIVE.
  // `confirm` holds the modal's props (minus onClose). DEMO is never gated.
  const [confirm, setConfirm] = useState<Omit<React.ComponentProps<typeof ConfirmModal>, "onClose"> | null>(null);
  // Start the engine in LIVE mode - confirm first (allocation / strategy / risk).
  const requestStart = (mm: "demo" | "live") => {
    if (mm === "demo") { startMode("demo"); return; }   // demo: no gate
    const invest = Number(f?.investAmount) || 0;
    const allocLive = invest > 0 ? moneyS(invest)
      : (f?.deployPct ? `${f.deployPct}% ${lang === "he" ? "מהיתרה" : "of balance"}` : (liveAvail != null ? moneyS(liveAvail) : "—"));
    const stratLive = f?.profitPctEnabled
      ? `${lang === "he" ? "Top" : "Top"} ${f?.maxPositions ?? "—"} · ${f?.profitPctPerPosition || 0}% ${lang === "he" ? "לפוזיציה" : "per position"}`
      : `${lang === "he" ? "Top" : "Top"} ${f?.maxPositions ?? "—"} ${lang === "he" ? "פריצות" : "breakouts"}${(f?.targetMode ? ` · ${lang === "he" ? "יעד" : "target"} ${moneyS(Number(f.targetMode === "weekly" ? f.weeklyTarget : f.dailyTarget) || 0)}` : "")}`;
    // Remember the last-used allocation/strategy so the gate PRE-FILLS instantly (no "—" flash
    // while the live balance/config load) and starting live is closer to one tap. Display-only
    // cache: the engine still runs off the SAME server config — we only seed the preview from the
    // last shown values until live data resolves, then re-cache the current ones.
    const last = loadLastAlloc();
    const ready = allocLive !== "—";
    const alloc = ready ? allocLive : (last.alloc || "—");
    const strat = ready ? stratLive : (last.strat || stratLive);
    if (ready) saveLastAlloc({ alloc: allocLive, strat: stratLive });
    setConfirm({
      title: lang === "he" ? "הפעלת מנוע — כסף אמיתי" : "Start engine — real money",
      intro: lang === "he" ? "כסף אמיתי. המנוע בונה תוכנית מהפריצות של היום — אתם מאשרים כל פקודה." : "Real money. The engine builds a plan from today's breakouts — you approve every order.",
      rows: [
        { label: lang === "he" ? "הקצאה" : "Allocation", value: alloc, color: C.gold, emphasis: true },
        { label: lang === "he" ? "אסטרטגיה" : "Strategy", value: strat },
      ],
      risk: lang === "he" ? "מסחר בכסף אמיתי כרוך בסיכון לאובדן ההון." : "Live trading involves risk to your capital.",
      confirmLabel: lang === "he" ? "אני מאשר · הפעל LIVE" : "I confirm · Start LIVE",
      tone: "loss",
      onConfirm: () => { startMode("live"); },
    });
  };
  // Related-row jumps: ensure the engine is shown (default demo when none chosen) and
  // scroll to it. (Section deep-links were retired with the old inline live block;
  // ProfitEngine now owns its own sections, so this just reveals + scrolls.)
  const openEngine = (_sec?: "" | "dash" | "breakouts" | "newrun" | "openruns", _adv?: boolean) => {
    if (!mode) chooseMode("demo");
    setSec("engine"); scrollTo(engineRef);
  };


  // The Demo|Live segmented toggle + honest live-status pill — rendered inside the engine
  // child so a user can switch mode there. Live-switch stays gated via requestStart().
  const modeToggle = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 14 }}>
      <div role="group" data-tour="profit-mode" aria-label={ms.choose} style={{ display: "inline-flex", gap: 4, padding: 4, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999 }}>
        <button onClick={() => chooseMode("demo")} aria-pressed={mode === "demo"} style={segBtn(mode === "demo", C.gain)}>● {ms.demo}</button>
        <button onClick={() => { if (mode !== "live") requestStart("live"); }} aria-pressed={mode === "live"} style={segBtn(mode === "live", C.loss)}>● {ms.live}</button>
      </div>
      {mode === "live" && (
        <span role="status" aria-live="polite" style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 800,
          color: exConn ? C.loss : C.muted, background: `${(exConn ? C.loss : C.muted)}14`, border: `1px solid ${(exConn ? C.loss : C.muted)}55`, borderRadius: 999, padding: "5px 12px" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: exConn ? C.loss : C.muted, animation: exConn ? "xstatpulse 1.8s infinite" : undefined }} />
          {exConn
            ? ((lang === "he" ? "מנוע לייב פעיל · כסף אמיתי" : "LIVE engine active · real money") + (runs > 0 ? (lang === "he" ? ` · ${runs} ריצות` : ` · ${runs} running`) : ""))
            : (lang === "he" ? "לייב — חברו בורסה כדי לסחור" : "LIVE — connect an exchange to trade")}
          <style>{"@keyframes xstatpulse{0%{box-shadow:0 0 0 0 rgba(240,97,109,.5)}70%{box-shadow:0 0 0 6px rgba(240,97,109,0)}100%{box-shadow:0 0 0 0 rgba(240,97,109,0)}}"}</style>
        </span>
      )}
    </div>
  );

  return (
    <div style={{ direction: rtl ? "rtl" : "ltr", fontFamily: UI, color: C.text,
      display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      {/* Money-safety gate: the LIVE-start preview+confirm modal — mounted at TOP LEVEL so it
          overlays the launcher AND every child. UNCHANGED (requestStart → ConfirmModal → startMode). */}
      {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
      <TourLauncher screen="profit" />

      {sec === "" && (
        <>
          <FramedTitle text={he ? "מנוע מסחר" : "Trading Engine"} subtitle={h.tagline} />

          {/* Editable top shortcuts — the "עוד במערכת" chip opens the More CHILD (not a modal). */}
          <ScreenShortcuts
            screenKey="profit"
            defaultKeys={["breakouts", "alloc", "openruns", "pos", "strat"]}
            onMore={() => setSec("more")}
            catalog={[
              { key: "breakouts", label: he ? "פריצות היום" : "Breakouts", Icon: Search, onClick: () => openEngine("breakouts") },
              { key: "alloc", label: he ? "ריצה חדשה" : "New run", Icon: Sliders, onClick: () => openEngine("newrun") },
              { key: "openruns", label: he ? "ריצות פתוחות" : "Open runs", Icon: Layers, onClick: () => openEngine("openruns") },
              { key: "pos", label: he ? "פוזיציות" : "Positions", Icon: Wallet, onClick: () => setSec("positions") },
              { key: "strat", label: he ? "אסטרטגיה" : "Strategy", Icon: Microscope, onClick: () => nav("/strategy") },
              { key: "set", label: he ? "הגדרות מנוע" : "Engine settings", Icon: Settings, onClick: () => openEngine("dash", true) },
              { key: "exchange", label: he ? "בורסה" : "Exchange", Icon: ArrowLeftRight, onClick: () => nav("/exchange") },
              { key: "backtest", label: he ? "בדיקות" : "Backtest", Icon: FlaskConical, onClick: () => nav("/backtests") },
              { key: "scan", label: he ? "סריקה יומית" : "Daily scan", Icon: Search, onClick: () => nav("/scanner") },
              { key: "activity", label: he ? "יומן פעילות" : "Activity", Icon: Activity, onClick: () => nav("/activity") },
              { key: "perf", label: he ? "ביצועים" : "Performance", Icon: BarChart3, onClick: () => nav("/analytics") },
            ]}
          />

          {/* 2 central glass buttons — Home's exact SQUARES (centered), LIVE is the bigger
              primary. Each is the SAME real action: requestStart() (LIVE stays confirm-gated). */}
          <SquareRow screenKey="profit-central" mobile={mobile} defaultShown={["live", "demo"]}
            squares={[
              { id: "live", variant: "primary", Icon: Play, label: he ? "הפעל LIVE" : "Start LIVE", sub: he ? "כסף אמיתי" : "real money", onClick: () => requestStart("live") },
              { id: "demo", variant: "secondary", Icon: Zap, label: he ? "הפעל DEMO" : "Start DEMO", sub: he ? "תרגול · וירטואלי" : "practice · virtual", onClick: () => requestStart("demo") },
              ...centralExtras(he, nav, { exclude: ["engine"] }),
            ]} />
        </>
      )}

      {/* ── "עוד במערכת" CHILD — the engine areas as a tile grid with a rows/tiles toggle. ── */}
      {sec === "more" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FramedTitle text={he ? "עוד במערכת" : "More"} subtitle={he ? "כל אזורי המנוע" : "All engine areas"} />
          <div style={{ display: "flex", justifyContent: "flex-end", margin: "2px 2px 0" }}>
            <ViewToggle view={moreView} onChange={setMoreView} he={he} />
          </div>
          <TileGrid screenKey="profit-more" view={moreView} columns={3} aspect={1.08} tiles={[
            { id: "engine", label: he ? "מנוע מסחר" : "Trading Engine", Icon: Play, onClick: () => openEngine() },
            { id: "pos", label: he ? "פוזיציות" : "Positions", Icon: Wallet, onClick: () => setSec("positions") },
            { id: "breakouts", label: he ? "פריצות היום" : "Breakouts", Icon: Search, onClick: () => openEngine("breakouts") },
            { id: "alloc", label: he ? "ריצה חדשה" : "New run", Icon: Sliders, onClick: () => openEngine("newrun") },
            { id: "openruns", label: he ? "ריצות פתוחות" : "Open runs", Icon: Layers, onClick: () => openEngine("openruns") },
            { id: "set", label: he ? "הגדרות מנוע" : "Engine settings", Icon: Settings, onClick: () => openEngine("dash", true) },
            { id: "strat", label: he ? "אסטרטגיה" : "Strategy", Icon: Microscope, onClick: () => nav("/strategy") },
            { id: "scan", label: he ? "סריקה יומית" : "Daily scan", Icon: Search, onClick: () => nav("/scanner") },
            { id: "backtest", label: he ? "בדיקות" : "Backtest", Icon: FlaskConical, onClick: () => nav("/backtests") },
            { id: "exchange", label: he ? "בורסה" : "Exchange", Icon: ArrowLeftRight, onClick: () => nav("/exchange") },
            { id: "activity", label: he ? "יומן פעילות" : "Activity", Icon: Activity, onClick: () => nav("/activity") },
            { id: "perf", label: he ? "ביצועים" : "Performance", Icon: BarChart3, onClick: () => nav("/analytics") },
          ]} />
        </div>
      )}

      {/* ── ENGINE CHILD — the mode toggle + P&L + chart + positions + the ProfitEngine flow.
          Money/order logic is UNCHANGED — it all lives inside <ProfitEngine/>, gated exactly
          as before (demo vs live={mode==="live"} with the engine's own batch-confirm + PIN). ── */}
      {sec === "engine" && (
        <HubPanel alwaysOpen ns="profit" id="engine" title={he ? "מנוע מסחר" : "Trading Engine"} icon={<Play size={15} />} onClose={() => setSec("")}>
          {modeToggle}
          {err && <div style={errBox}>{err}</div>}
          {ok && <div style={okBox}>{ok}</div>}
          {!mode ? (
            <div style={{ textAlign: "center", fontSize: 12.5, color: C.muted, marginBottom: 12 }}>{ms.chooseSub}</div>
          ) : (mode === "live" && !loadExchangeCreds()) ? (
            <div style={{ marginBottom: 12, fontSize: 12, color: C.gold }}>{ms.needKeys}</div>
          ) : null}
          {/* P&L card + live-trading caveat. The embedded "Live trading screen" (TradingView)
              chart was removed from the engine view per Dan; it still lives on other screens. */}
          <HomeTop />
          <div style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 11.5, color: C.muted, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 12px", marginBottom: 14, lineHeight: 1.5 }}>
            <AlertTriangle size={13} color={C.gold} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{he ? "מסחר בלייב מוגבל לסימבולים שבבורסה המחוברת." : "Live trading is limited to symbols on your connected exchange."}</span>
          </div>
          <div data-tour="profit-positions" ref={positionsRef}><PositionsWidget /></div>
          <div ref={engineRef} aria-hidden style={{ scrollMarginTop: 8 }} />
          {!mode ? null : mode === "demo" ? <ProfitEngine /> : <ProfitEngine live />}
        </HubPanel>
      )}

      {/* ── POSITIONS CHILD — live open positions on their own. ── */}
      {sec === "positions" && (
        <HubPanel alwaysOpen ns="profit" id="positions" title={he ? "פוזיציות" : "Positions"} icon={<Wallet size={15} />} onClose={() => setSec("")}>
          <div data-tour="profit-positions" ref={positionsRef}><PositionsWidget /></div>
        </HubPanel>
      )}

      {/* Persistent bottom cluster (like Home): live/demo P&L + Help-Portal, above the tab bar. */}
      <ScreenBottom />
      <Spin />
    </div>
  );
}

// One half of the prominent Demo|Live segmented toggle. Active = filled accent with
// dark ink (impossible to miss which mode is live); inactive = transparent + muted.
const segBtn = (active: boolean, accent: string): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, border: "none",
  cursor: "pointer", fontFamily: "inherit", borderRadius: 999, padding: "10px 26px", fontWeight: 800,
  fontSize: 14.5, letterSpacing: "0.01em", minWidth: 118,
  background: active ? accent : "transparent", color: active ? onAccent(accent) : C.muted,
  boxShadow: active ? "0 3px 10px -3px rgba(0,0,0,0.45)" : "none", transition: "background .15s, color .15s",
});
