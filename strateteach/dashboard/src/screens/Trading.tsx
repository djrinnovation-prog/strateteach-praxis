import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Cpu, Bot, Radio, Search, FlaskConical, Wand2, BarChart3, Activity, LayoutDashboard, ArrowLeftRight } from "lucide-react";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";
import { isOwner } from "../app/api";
import FramedTitle from "../components/FramedTitle";
import { TileGrid } from "../components/GlassTile";
import ScreenShortcuts from "../components/ScreenShortcuts";
import SquareRow from "../components/SquareRow";
import { centralExtras } from "../lib/centralExtras";
import ScreenBottom from "../components/ScreenBottom";
import { useViewMode, ViewToggle } from "../components/ViewToggle";
import TourLauncher from "../components/TourLauncher";
import { useIsMobile } from "../lib/useIsMobile";

// ── TRADING PARENT (Dan's option A) ───────────────────────────────────────────
// Home's "Trading" tile opens THIS hub. LOCKED launcher (title + shortcuts + 3 central
// buttons + footer); every extra opens a CHILD screen via URL navigation (?sec=more) —
// never a modal popup. Pure navigation; money/safety logic lives in each destination.
export default function Trading() {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const nav = useNavigate();
  const mobile = useIsMobile();
  // URL-driven child navigation (Back button returns to the launcher) — same model as Exchange.
  const [sp, setSp] = useSearchParams();
  const sec = sp.get("sec") || "";
  const setSec = (v: string) => setSp(v ? { sec: v } : {});
  const [moreView, setMoreView] = useViewMode("algo770_trading_more_view_v1", "cards");
  const openPilots = () => nav("/owners?tab=autopilots");

  return (
    <div style={{ direction: rtl ? "rtl" : "ltr", fontFamily: UI, color: C.text,
      display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <TourLauncher screen="profit" />

      {sec === "" && (
        <>
          <FramedTitle text={he ? "מסחר" : "Trading"}
            subtitle={he ? "מנוע מסחר יומי · טייסים אוטומטיים · סיגנל בוט" : "Daily Engine · Auto Pilots · Signal Bot"} />

          {/* Editable top shortcuts — the "עוד במערכת" chip opens the More CHILD (not a modal). */}
          <ScreenShortcuts
            screenKey="trading"
            defaultKeys={["scan", "backtest", "strategy", "activity"]}
            onMore={() => setSec("more")}
            catalog={[
              { key: "scan", label: he ? "סריקה" : "Scan", Icon: Search, onClick: () => nav("/scanner") },
              { key: "backtest", label: he ? "בדיקות" : "Backtest", Icon: FlaskConical, onClick: () => nav("/backtests") },
              { key: "strategy", label: he ? "אסטרטגיה" : "Strategy", Icon: Wand2, onClick: () => nav("/strategy") },
              { key: "activity", label: he ? "פעילות" : "Activity", Icon: Activity, onClick: () => nav("/activity") },
              { key: "performance", label: he ? "ביצועים" : "Perf", Icon: BarChart3, onClick: () => nav("/analytics") },
              { key: "dashboard", label: he ? "לוח" : "Dashboard", Icon: LayoutDashboard, onClick: () => nav("/overview") },
            ]}
          />

          {/* Central glass buttons — Home's exact SQUARES, now editable via SquareRow
              (choose which appear + order + APPROVE; owner sets the default, users override). */}
          <SquareRow screenKey="trading-central" mobile={mobile} defaultShown={["engine", "pilots", "signal"]} squares={[
            { id: "engine", variant: "primary", Icon: Cpu, label: he ? "מנוע מסחר יומי" : "Daily Engine", sub: he ? "דמו ולייב" : "Demo & live", onClick: () => nav("/profit") },
            { id: "pilots", variant: "secondary", Icon: Bot, label: he ? "טייסים" : "Auto Pilots", sub: he ? "סימולציה" : "simulation", onClick: openPilots },
            { id: "signal", variant: "secondary", Icon: Radio, label: he ? "סיגנל בוט" : "Signal Bot", sub: "TradingView", onClick: () => nav("/bots") },
            ...centralExtras(he, nav, { exclude: ["trading", "engine", "signalbot", "pilots"] }),
          ]} />

          {!isOwner() && (
            <p style={{ margin: "2px auto 0", fontSize: 10.5, color: C.faint, textAlign: "center" }}>
              {he ? "טייסים אוטומטיים זמינים לבעלים בלבד בשלב זה." : "Auto Pilots are owner-only at this stage."}
            </p>
          )}
        </>
      )}

      {/* ── "עוד במערכת" CHILD — trading tools as a tile grid with a rows/tiles toggle. ── */}
      {sec === "more" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FramedTitle text={he ? "עוד במערכת" : "More"} subtitle={he ? "כל כלי המסחר" : "All trading tools"} />
          <div style={{ display: "flex", justifyContent: "flex-end", margin: "2px 2px 0" }}>
            <ViewToggle view={moreView} onChange={setMoreView} he={he} />
          </div>
          <TileGrid screenKey="trading-more" view={moreView} columns={3} aspect={1.08} tiles={[
            { id: "engine", label: he ? "מנוע מסחר יומי" : "Daily Engine", Icon: Cpu, onClick: () => nav("/profit") },
            { id: "pilots", label: he ? "טייסים אוטומטיים" : "Auto Pilots", Icon: Bot, onClick: openPilots },
            { id: "signal", label: he ? "סיגנל בוט" : "Signal Bot", Icon: Radio, onClick: () => nav("/bots") },
            { id: "scan", label: he ? "סריקה יומית" : "Daily scan", Icon: Search, onClick: () => nav("/scanner") },
            { id: "backtest", label: he ? "בדיקות" : "Backtest", Icon: FlaskConical, onClick: () => nav("/backtests") },
            { id: "strategy", label: he ? "אסטרטגיות" : "Strategy", Icon: Wand2, onClick: () => nav("/strategy") },
            { id: "performance", label: he ? "ביצועים" : "Performance", Icon: BarChart3, onClick: () => nav("/analytics") },
            { id: "activity", label: he ? "יומן פעילות" : "Activity", Icon: Activity, onClick: () => nav("/activity") },
            { id: "exchange", label: he ? "בורסה" : "Exchange", Icon: ArrowLeftRight, onClick: () => nav("/exchange") },
          ]} />
        </div>
      )}

      {/* Persistent bottom cluster (like Home): live/demo P&L + Help-Portal, above the tab bar. */}
      <ScreenBottom />
    </div>
  );
}
