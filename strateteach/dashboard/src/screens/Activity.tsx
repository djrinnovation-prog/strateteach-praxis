import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, RefreshCw, Lock, FlaskConical, Activity as ActivityIcon, BarChart3, TrendingUp } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI, MONO, SHADOW } from "../theme";
import { Empty, premSoft, Spin, ExportBar } from "../ui";
import HomeUnifiedFrame from "../components/HomeUnifiedFrame";
import FramedTitle from "../components/FramedTitle";
import { GlassTile, TileGrid, homeDim } from "../components/GlassTile";
import SquareRow from "../components/SquareRow";
import { centralExtras } from "../lib/centralExtras";
import ScreenShortcuts from "../components/ScreenShortcuts";
import ScreenBottom from "../components/ScreenBottom";
import { useViewMode, ViewToggle } from "../components/ViewToggle";
import { HubPanel } from "../components/HubScreen";
import { useIsMobile } from "../lib/useIsMobile";

// Portfolio activity log — the finalized locked-launcher model. Two central buttons
// (Demo · Live) open their own ?sec= child table (each scrolls internally); Live is
// locked until the exchange PIN is set (honest locked state kept). Nothing removed.
export default function Activity() {
  const { t, lang, rtl } = useI18n();
  const he = lang === "he";
  const nav = useNavigate();
  const mobile = useIsMobile();
  const [sp, setSp] = useSearchParams();
  const sec = sp.get("sec") || "";
  const setSec = (v: string) => setSp(v ? { sec: v } : {});
  const [moreView, setMoreView] = useViewMode("algo770_activity_more_view_v1", "cards");

  return (
    <div style={{ direction: rtl ? "rtl" : "ltr", fontFamily: UI, color: C.text,
      display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>

      {sec === "" && (
        <>
          <FramedTitle text={t.activity} subtitle={he ? "יומן פעילות התיק — דמו וחי" : "Portfolio activity log — demo & live"} />

          {/* Editable top shortcuts — the "עוד במערכת" chip opens the More CHILD (not a modal). */}
          <ScreenShortcuts
            screenKey="activity"
            defaultKeys={["demo", "live", "perf", "engine"]}
            onMore={() => setSec("more")}
            catalog={[
              { key: "demo", label: t.demoActivity, Icon: FlaskConical, onClick: () => setSec("demo") },
              { key: "live", label: t.liveActivity, Icon: ActivityIcon, onClick: () => setSec("live") },
              { key: "perf", label: he ? "ביצועים" : "Performance", Icon: BarChart3, onClick: () => nav("/analytics") },
              { key: "engine", label: he ? "מנוע מסחר" : "Trading Engine", Icon: TrendingUp, onClick: () => nav("/profit") },
            ]}
          />

          {/* 2 central glass buttons — Home's exact SQUARES (centered), primary bigger. */}
          <SquareRow screenKey="activity-central" mobile={mobile} defaultShown={["actdemo", "actlive"]}
            squares={[
              { id: "actdemo", variant: "primary", Icon: FlaskConical, label: t.demoActivity, sub: he ? "סימולציה" : "simulation", onClick: () => setSec("demo") },
              { id: "actlive", variant: "secondary", Icon: ActivityIcon, label: t.liveActivity, sub: he ? "כסף אמיתי" : "real money", onClick: () => setSec("live") },
              ...centralExtras(he, nav, { exclude: ["activity"] }),
            ]} />
        </>
      )}

      {/* ── "עוד במערכת" CHILD — the activity areas as a tile grid with a rows/tiles toggle. ── */}
      {sec === "more" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FramedTitle text={he ? "עוד במערכת" : "More"} subtitle={he ? "כל אזורי הפעילות" : "All activity areas"} />
          <div style={{ display: "flex", justifyContent: "flex-end", margin: "2px 2px 0" }}>
            <ViewToggle view={moreView} onChange={setMoreView} he={he} />
          </div>
          <TileGrid screenKey="activity-more" view={moreView} columns={3} aspect={1.08} tiles={[
            { id: "demo", label: t.demoActivity, Icon: FlaskConical, onClick: () => setSec("demo") },
            { id: "live", label: t.liveActivity, Icon: ActivityIcon, onClick: () => setSec("live") },
            { id: "perf", label: he ? "ביצועים" : "Performance", Icon: BarChart3, onClick: () => nav("/analytics") },
            { id: "engine", label: he ? "מנוע מסחר" : "Trading Engine", Icon: TrendingUp, onClick: () => nav("/profit") },
          ]} />
        </div>
      )}

      {/* ── DEMO / LIVE CHILDREN — each mounts its own lazy per-mode fetch (unchanged). ── */}
      {sec === "demo" && (
        <HubPanel alwaysOpen ns="activity" id="demo" title={t.demoActivity} icon={<FlaskConical size={15} />} onClose={() => setSec("")}>
          {/* Unified P&L card — SAME component as Home (single source of truth): live/demo toggle,
              growth-vs-deposit, cash-available line, closed-log button. Replaces the old HomeTop. */}
          <div style={{ marginBottom: 12 }}><HomeUnifiedFrame /></div>
          <ActivityTable mode="demo" />
        </HubPanel>
      )}
      {sec === "live" && (
        <HubPanel alwaysOpen ns="activity" id="live" title={t.liveActivity} icon={<ActivityIcon size={15} />} onClose={() => setSec("")}>
          {/* Unified P&L card — SAME component as Home (single source of truth). */}
          <div style={{ marginBottom: 12 }}><HomeUnifiedFrame /></div>
          <ActivityTable mode="live" />
        </HubPanel>
      )}

      {/* Persistent bottom cluster (like Home): live/demo P&L + Help-Portal, above the tab bar. */}
      <ScreenBottom />
    </div>
  );
}

// Mounts only while its section is open → keeps the old lazy, per-mode fetch.
function ActivityTable({ mode }: { mode: "demo" | "live" }) {
  const { t, rtl } = useI18n();
  const q = useQuery({ queryKey: ["activity", mode], queryFn: () => api.activity(1000, mode) });
  const data: any = q.data;
  const events: any[] = data?.events || [];
  const locked = mode === "live" && data?.liveLocked;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
        <ExportBar name="activity" title={t.activity} rtl={rtl}
          headers={[t.when, t.kind, t.symbol, t.side, t.qty, t.price, t.pnl]}
          rows={events.map((e: any) => [e.ts ? new Date(e.ts).toLocaleString() : "", e.kind, e.symbol || "", e.side || e.direction || "", e.qty ?? "", e.price ?? "", e.pnl == null ? "" : e.pnl])} />
        <button onClick={() => q.refetch()} disabled={q.isFetching}
          style={{ ...premSoft(), display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "9px 15px", fontSize: 13, whiteSpace: "nowrap", opacity: q.isFetching ? 0.6 : 1 }}>
          {q.isFetching ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} {t.refresh}
        </button>
      </div>

      {q.isLoading ? <Empty><Loader2 size={16} className="spin" /> &nbsp;{t.loading}</Empty>
        : locked ? <Empty><Lock size={15} /> &nbsp;{t.liveLocked}</Empty>
        : events.length === 0 ? <Empty>{t.noActivity}</Empty>
        : <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), " + SHADOW, overflowX: "auto", maxHeight: "62svh", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr>{[t.when, t.kind, t.symbol, t.side, t.qty, t.price, t.pnl].map((h, i) =>
                <th key={i} style={th(rtl)}>{h}</th>)}</tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td style={{ ...td(rtl), color: C.muted, fontFamily: MONO, whiteSpace: "nowrap" }}>{e.ts ? new Date(e.ts).toLocaleString() : "—"}</td>
                    <td style={td(rtl)}>{e.kind}</td>
                    <td style={td(rtl)}>{e.symbol || "—"}</td>
                    <td style={{ ...td(rtl), color: e.side === "sell" || e.direction === "short" ? C.loss : C.gain }}>{e.side || e.direction || "—"}</td>
                    <td style={{ ...td(rtl), fontFamily: MONO }}>{fmt(e.qty)}</td>
                    <td style={{ ...td(rtl), fontFamily: MONO }}>{fmt(e.price)}</td>
                    <td style={{ ...td(rtl), fontFamily: MONO, color: num(e.pnl) >= 0 ? C.gain : C.loss }}>{e.pnl == null ? "—" : money(e.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      <Spin />
    </div>
  );
}

const num = (v: any) => (typeof v === "number" ? v : 0);
const fmt = (v: any) => (v == null ? "—" : typeof v === "number" ? (Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(6)) : String(v));
const money = (v: any) => `${num(v) >= 0 ? "+" : "-"}$${Math.abs(num(v)).toFixed(2)}`;
const th = (rtl: boolean): React.CSSProperties => ({ padding: "10px 12px", borderBottom: `1px solid ${C.line}`, textAlign: rtl ? "right" : "left", color: C.muted, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, background: C.surface2, position: "sticky", top: 0, zIndex: 1 });
const td = (rtl: boolean): React.CSSProperties => ({ padding: "10px 12px", borderBottom: `1px solid ${C.line}`, textAlign: rtl ? "right" : "left" });
