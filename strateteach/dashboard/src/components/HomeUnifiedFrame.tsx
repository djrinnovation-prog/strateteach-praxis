import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Wallet, TrendingUp, FlaskConical, Cpu, Rocket, Eye, EyeOff, Info,
  ChevronDown, ChevronUp, ChevronRight, ChevronLeft, PlugZap, Plus, Radio, Pencil, X,
} from "lucide-react";
import { C, MONO, onAccent } from "../theme";
import { api, isOwner, loadExchangeCreds } from "../app/api";
import { useI18n } from "../i18n";
import { useIsMobile } from "../lib/useIsMobile";
import { createPortal } from "react-dom";
import PositionsWidget from "./PositionsWidget";
import DemoPositionsWidget from "./DemoPositionsWidget";
import ClosedPositionsLog from "./ClosedPositionsLog";
import { AP_STATE_KEY, AutoPilotsDashboard, apSummary } from "./AutoPilots";
import type { ApSimPilot } from "../lib/client";

// ── ONE unified Home frame — a GLOBAL LIVE ⇄ DEMO mode toggle that switches the ENTIRE
// frame + all its calculations, then SOURCE buttons (Profit Engine · Pilots · Signal Bot)
// to drill into a source WITHIN the current mode.
//   • LIVE  = real money ONLY: live-mode AutoPilots + the live Trading Engine (real
//     auto-runs) + Signal Bots (real orders) + real exchange open positions.
//   • DEMO  = simulation ONLY: paper/demo positions + simulation AutoPilots.
// The two totals are computed + shown separately (the toggle picks which). LIVE = red,
// DEMO = blue. Honesty invariant: NO sim P&L ever crosses into LIVE (position-mode split);
// a live pilot shows $0 while the master gate is off. Default mode = LIVE when the exchange
// is connected, DEMO otherwise (or logged-out).

type Mode = "live" | "demo";
type Source = "overview" | "engine" | "pilots" | "bots";
// One trading tool's line in the Home portfolio breakdown: its own sub-account capital +
// profit, plus how to drill into / connect it. `capitalKnown === false` → show "—" honestly.
type ToolLine = {
  source: Source; Icon: any; label: string;
  capital: number | null; capitalKnown: boolean; pnl: number | null;
  connected: boolean; onOpen: () => void; onConnect?: () => void; onSetCapital?: () => void;
};

const usd = (v: number | null | undefined) => `$${Math.abs(Number(v || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const signed = (v: number | null | undefined) => `${Number(v || 0) >= 0 ? "+" : "-"}${usd(v)}`;
const pnlColor = (v: number | null | undefined) => (Number(v || 0) > 0 ? C.gain : Number(v || 0) < 0 ? C.loss : C.muted);

export default function HomeUnifiedFrame({ onExpandedChange }: { onExpandedChange?: (expanded: boolean) => void } = {}) {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const mobile = useIsMobile();
  const nav = useNavigate();
  const owner = isOwner();
  const Fwd = rtl ? ChevronLeft : ChevronRight;

  const creds = loadExchangeCreds() as any;
  const liveConnected = !!(creds && creds.key && creds.secret);

  // DEFAULT MODE — LIVE for a connected user, DEMO otherwise / logged-out.
  const [mode, setMode] = useState<Mode>(liveConnected ? "live" : "demo");
  const [source, setSource] = useState<Source>("overview");
  const [expanded, setExpanded] = useState(false);
  // Report expand state up so Home can DROP its desktop fit-to-viewport transform while the card
  // is open and let the page SCROLL instead — otherwise the fit-scale shrinks the whole column
  // (transform:scale) every time the card grows, which reads as "the screen moves to be smaller".
  useEffect(() => { onExpandedChange?.(expanded); }, [expanded, onExpandedChange]);
  // Tapping a source chip drills into it AND opens the detail (the chips are now always visible,
  // so from the collapsed default a chip must also expand to reveal that source's view).
  const drill = (s: Source) => { setSource(s); setExpanded(true); };
  const [hide, setHide] = useState(false);
  const [info, setInfo] = useState(false);
  const [showLog, setShowLog] = useState(false);  // closed-positions log (opens as a portal modal)
  // Inline "deposited capital" (cost basis) editor for the LIVE sub-account, so the total-
  // growth figure has a baseline to compute against. Per (user, env=live); server-authoritative.
  const [cbEdit, setCbEdit] = useState(false);
  const [cbInput, setCbInput] = useState("");
  const [cbSaving, setCbSaving] = useState(false);
  const openCbEdit = async () => {
    setCbEdit(true); setCbInput("");
    try { const r = await api.getCostBasis("live"); if (r?.costBasis != null) setCbInput(String(r.costBasis)); } catch { /* leave blank */ }
  };
  const saveCb = async () => {
    const v = parseFloat(cbInput);
    if (cbInput.trim() !== "" && (isNaN(v) || v < 0)) return;   // block obvious bad input; empty = clear/0
    setCbSaving(true);
    try { await api.setCostBasis("live", isNaN(v) ? 0 : v); setCbEdit(false); liveQ.refetch(); }
    catch { /* keep editor open on failure */ }
    finally { setCbSaving(false); }
  };

  // ── Source queries (keys shared with the embedded widgets → react-query dedupes). ──
  const liveQ = useQuery({ queryKey: ["livePnl"], queryFn: () => api.livePnl(), enabled: liveConnected, retry: false, refetchInterval: 30000 });
  const demoQ = useQuery({ queryKey: ["paperState"], queryFn: () => api.paperState(), retry: false, refetchInterval: 15000 });
  const pilotsQ = useQuery({ queryKey: AP_STATE_KEY, queryFn: () => api.autopilotsState(), enabled: owner, refetchInterval: 45000, staleTime: 15000 });
  const botsQ = useQuery({ queryKey: ["botsDashboard"], queryFn: () => api.botsDashboard(), retry: false, refetchInterval: 30000 });
  // Engine-only LIVE realized P&L (real auto-runs) — no PIN/creds needed, so always enabled.
  const engineQ = useQuery({ queryKey: ["engineLivePnl"], queryFn: () => api.engineLivePnl(), retry: false, refetchInterval: 45000 });

  const live: any = liveQ.data;
  const livePos: any[] = live?.ok ? (live.positions || []).filter((x: any) => Number(x.value || 0) >= 1) : [];
  const exchangeOpenUnreal: number = liveConnected && live?.ok ? Number(live.unrealizedPnl || 0) : 0;
  // TOTAL GROWTH of the connected LIVE sub-account (the account the trading engine uses):
  // current value − deposited/baseline (server-computed `growthPnl`, deposit-aware). This is
  // the "how much has it grown since I put money in" figure — distinct from today's change and
  // from the composite trading P&L below. `null` when no deposit baseline is stored yet (no
  // cost-basis set + no exchange deposit history) → we prompt to set it rather than invent one.
  const liveGrowthPnl: number | null = live?.ok && live.growthPnl != null ? Number(live.growthPnl) : null;
  const liveGrowthPct: number | null = live?.ok && live.growthPct != null ? Number(live.growthPct) : null;
  const liveTotalValue: number | null = live?.ok && live.totalValue != null ? Number(live.totalValue) : null;
  const liveToday: number | null = live?.ok && live.period?.today != null ? Number(live.period.today) : null;
  const liveTodayPct: number | null = liveToday != null && liveTotalValue != null && liveTotalValue > 0 ? (liveToday / liveTotalValue) * 100 : null;

  const demo: any = demoQ.data;
  const demoPos: any[] = Array.isArray(demo?.positions) ? demo.positions.filter((x: any) => (x?.status ? x.status === "open" : true) && Number(x.value || 0) >= 1) : [];
  const demoPnl: number | null = demo ? Number(demo.totalPnl || 0) : null;
  // Paper (demo Trading-Engine) capital = the cost/value of the currently-open sim positions
  // (marked to market by the server). totalCost = invested now; totalValue = invested + P&L.
  const demoCost: number | null = demo ? Number(demo.totalCost || 0) : null;

  const pilots = useMemo(() => (pilotsQ.data?.pilots || []) as ApSimPilot[], [pilotsQ.data]);
  const simByPilot = useMemo(() => { const m: Record<string, ApSimPilot> = {}; for (const p of pilots) m[p.pilotId] = p; return m; }, [pilots]);
  const pilotsSum = apSummary(pilots);

  const botsData: any = botsQ.data;
  const bots: any[] = Array.isArray(botsData?.bots) ? botsData.bots : [];
  const botsPnl: number = botsData?.ok ? Number(botsData.totalPnl || 0) : 0;
  const botsCount: number = botsData?.ok ? Number(botsData.count || bots.length) : 0;

  // ── LIVE vs DEMO totals — Dan's exact split, honesty invariant intact. ──
  // LIVE = live-mode pilots' LIVE-slice P&L (position-mode strict) + engine-only live
  //   realized closes (manual + auto-batch, bot_id NULL) + Signal Bots + real exchange OPEN
  //   unrealized. DISJOINT slices, no double-count, no sim crossover. DEMO = paper/demo
  //   positions + simulation pilots.
  const livePilotPnl = owner ? pilotsSum.livePnl : 0;
  const simPilotPnl = owner ? pilotsSum.simPnl : 0;
  const engineLiveRealized = engineQ.data?.ok ? Number(engineQ.data.realizedPnl || 0) : 0;
  const enginePnl = engineLiveRealized + exchangeOpenUnreal;   // Trading Engine live contribution
  const liveTotal = livePilotPnl + enginePnl + botsPnl;
  const demoTotal = Number(demoPnl || 0) + simPilotPnl;
  // Any genuinely-live source present (drives the LIVE connect-CTA vs a real number).
  const hasLive = liveConnected || (owner && pilotsSum.liveCount > 0) || botsCount > 0 || engineLiveRealized !== 0;

  const modeIsLive = mode === "live";

  // ── PER-TOOL CAPITAL + P&L BREAKDOWN (Yoav #1E0T) ──────────────────────────────────────
  // Every trading tool's own sub-account capital + its profit, plus a grand portfolio total.
  // Mode-aware & mode-disjoint. Capital is the "money referred to each tool"; where a tool
  // doesn't reliably expose it (Signal Bots size per-order off a % of free balance, so there
  // is no stored "allocated capital"), we show it HONESTLY as "—" rather than invent a figure.
  // DATA SOURCES: Engine LIVE = live-pnl (deposited baseline = totalValue − growthPnl, current
  // value = totalValue); Engine DEMO = paper state (totalCost invested); Pilots = autopilots
  // state (per-pilot liveCap/capital, mode-split); Signal Bots = bots dashboard (P&L only).
  // Live engine "invested" = the deposit baseline the growth figure is computed against.
  const engineInvestedLive: number | null =
    liveGrowthPnl != null && liveTotalValue != null ? liveTotalValue - liveGrowthPnl
    : (live?.ok && live.costBasis != null ? Number(live.costBasis)
    : (live?.ok && live.netDeposits != null ? Number(live.netDeposits) : null));
  const toolLines: ToolLine[] = modeIsLive
    ? [
        // Engine P&L = the SAME live trading P&L that feeds the headline total (realized auto-run
        // closes + open exchange unrealized), so the breakdown rows sum to the big number above —
        // one honest total, not two. Capital = the deposited baseline (set via the pencil editor).
        { source: "engine", Icon: TrendingUp, label: he ? "מנוע" : "Engine",
          capital: engineInvestedLive, capitalKnown: engineInvestedLive != null, pnl: enginePnl,
          connected: liveConnected || engineLiveRealized !== 0, onOpen: () => drill("engine"),
          onConnect: () => nav("/exchange?sec=connect"), onSetCapital: openCbEdit },
        ...(owner ? [{ source: "pilots" as Source, Icon: Rocket, label: he ? "טייסים" : "Pilots",
          capital: pilotsSum.liveCount > 0 ? pilotsSum.liveCapital : null, capitalKnown: pilotsSum.liveCount > 0,
          pnl: pilotsSum.livePnl, connected: pilotsSum.liveCount > 0, onOpen: () => drill("pilots"),
          onConnect: () => nav("/owners?tab=autopilots") }] : []),
        { source: "bots", Icon: Cpu, label: he ? "סיגנל בוט" : "Signal Bot",
          capital: null, capitalKnown: false, pnl: botsCount > 0 ? botsPnl : null,
          connected: botsCount > 0, onOpen: () => drill("bots"), onConnect: () => nav("/bots") },
      ]
    : [
        { source: "engine", Icon: FlaskConical, label: he ? "מנוע" : "Engine",
          capital: demoCost, capitalKnown: demo != null, pnl: demoPnl, connected: true, onOpen: () => drill("engine") },
        ...(owner ? [{ source: "pilots" as Source, Icon: Rocket, label: he ? "טייסים" : "Pilots",
          capital: (pilotsSum.loaded - pilotsSum.liveCount) > 0 ? pilotsSum.simCapital : null,
          capitalKnown: (pilotsSum.loaded - pilotsSum.liveCount) > 0, pnl: pilotsSum.simPnl,
          connected: (pilotsSum.loaded - pilotsSum.liveCount) > 0, onOpen: () => drill("pilots"),
          onConnect: () => nav("/owners?tab=autopilots") }] : []),
      ];
  // Grand totals across the tools whose capital is known (bots excluded honestly when unknown).
  const totalCapital = toolLines.reduce((s, t) => s + (t.capitalKnown && t.capital != null ? t.capital : 0), 0);
  const totalToolPnl = toolLines.reduce((s, t) => s + (t.pnl != null ? t.pnl : 0), 0);
  const totalValueAll = totalCapital + totalToolPnl;             // portfolio value = capital + profit
  const anyCapitalKnown = toolLines.some((t) => t.capitalKnown);
  const someCapitalUnknown = toolLines.some((t) => t.connected && !t.capitalKnown);  // e.g. Signal Bots

  const modeColor = modeIsLive ? C.loss : C.blue;
  const modeTotal = modeIsLive ? liveTotal : demoTotal;
  const modeCta = modeIsLive && !hasLive ? { label: he ? "חבר בורסה" : "Connect", to: "/exchange?sec=connect" } : null;

  // Source buttons available in the current mode (Signal Bots are real → LIVE only; Pilots
  // are owner-only). Overview + Profit Engine are always present.
  const sources: Source[] = [
    "overview", "engine",
    ...(owner ? (["pilots"] as Source[]) : []),
    ...(modeIsLive ? (["bots"] as Source[]) : []),
  ];
  const effSource: Source = sources.includes(source) ? source : "overview";

  const card: React.CSSProperties = { background: C.glassTint, backdropFilter: C.glassBlur, WebkitBackdropFilter: C.glassBlur as any,
    border: `1.5px solid ${C.frameAccent}`, borderRadius: 18, boxShadow: `0 14px 30px -18px rgba(0,0,0,0.5), ${C.glassHi}`,
    // marginBottom trimmed 8→2 (the hero column's own gap already separates this card from the help
    // row) as part of the Home zero-mobile-scroll pass.
    direction: rtl ? "rtl" : "ltr", overflow: "hidden", marginBottom: 2 };

  const setModeAnd = (m: Mode) => { setMode(m); setSource("overview"); };

  return (
    <div style={card}>
      {/* Row 1 — controls: icon + title + info + expand. */}
      <div style={{ padding: mobile ? "6px 12px 0" : "13px 14px 0", display: "flex", alignItems: "center", gap: 9 }}>
        <div style={{ width: mobile ? 30 : 34, height: mobile ? 30 : 34, borderRadius: 10, flexShrink: 0, display: "grid", placeItems: "center", background: C.accentGrad, boxShadow: C.glassHi }}>
          <Wallet size={mobile ? 16 : 18} color="#0B0613" />
        </div>
        <span style={{ minWidth: 0, flex: 1, fontSize: mobile ? 14 : 15, fontWeight: 900, color: C.text, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{he ? "התיק שלי" : "Portfolio"}</span>
        {/* Small closed-log trigger — quick "what closed" the moment you open the app (Dan). */}
        <button onClick={(e) => { e.stopPropagation(); setShowLog(true); }} aria-label={he ? "יומן סגירות" : "Closed log"} title={he ? "יומן פוזיציות סגורות" : "Closed positions log"} className="tap44"
          style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: mobile ? "3px 8px" : "4px 9px", color: C.muted, cursor: "pointer", fontFamily: "inherit", fontSize: mobile ? 10.5 : 11, fontWeight: 800 }}>
          🧾 <span style={{ color: C.muted }}>{he ? "יומן" : "log"}</span>
        </button>
        <button onClick={() => setInfo((v) => !v)} aria-label={he ? "מידע" : "info"} className="tap44"
          style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", padding: 2, color: info ? C.gold : C.faint }}>
          <Info size={14} />
        </button>
        <button onClick={() => { const nv = !expanded; if (nv && effSource === "overview") setSource("engine"); setExpanded(nv); }} aria-label={expanded ? "collapse" : "expand"} className="tap44"
          style={{ flexShrink: 0, display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 8, background: C.surface2, border: `1px solid ${C.line}`, color: C.muted, cursor: "pointer" }}>
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      {/* Closed-positions log — opens as a body-portal modal (the frame is transform-scaled for
          fit, so a portal avoids the zoom/transform positioning trap). Same shared component as
          the Trading Engine: demo + live closes with reason, buy→sell price, and %P&L. */}
      {showLog && createPortal(
        <div onClick={() => setShowLog(false)}
          style={{ position: "fixed", inset: 0, zIndex: 9990, background: "rgba(0,0,0,0.66)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 14px", overflowY: "auto" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", width: "100%", maxWidth: 560 }}>
            <button onClick={() => setShowLog(false)} aria-label={he ? "סגור" : "close"}
              style={{ position: "absolute", top: -12, insetInlineEnd: -6, zIndex: 2, width: 30, height: 30, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", background: C.surface2, border: `1px solid ${C.line}`, color: C.muted, cursor: "pointer" }}>
              <X size={16} />
            </button>
            <ClosedPositionsLog onClose={() => setShowLog(false)} />
          </div>
        </div>, document.body)}

      {/* MODE TOGGLE — LIVE (red) ⇄ DEMO (blue). Switches the whole frame + its totals. */}
      <div style={{ padding: mobile ? "5px 12px 0" : "10px 14px 0" }}>
        <div style={{ display: "flex", gap: 4, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: 3 }}>
          {(["live", "demo"] as Mode[]).map((m) => {
            const active = mode === m;
            const c = m === "live" ? C.loss : C.blue;
            return (
              <button key={m} onClick={() => setModeAnd(m)} className="tap44"
                style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                  fontSize: mobile ? 11.5 : 12.5, fontWeight: 900, borderRadius: 9, padding: mobile ? "6px 8px" : "8px 10px", border: "none", cursor: "pointer",
                  background: active ? c : "transparent", color: active ? "#fff" : C.muted, letterSpacing: "0.02em" }}>
                {m === "live" ? <Radio size={14} /> : <FlaskConical size={14} />}
                {m === "live" ? (he ? "לייב · כסף אמיתי" : "LIVE · real money") : (he ? "דמו · סימולציה" : "DEMO · simulation")}
              </button>
            );
          })}
        </div>
      </div>

      {/* BIG TOTAL for the active mode — bold, fully opaque, colored by mode. Bottom padding is
          trimmed because the growth line sits directly below it (its own padding provides the
          gap), reclaiming the few px the growth line adds so the loaded Home still fits. */}
      <div style={{ padding: mobile ? "5px 12px 3px" : "11px 14px 6px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9.5, fontWeight: 900, color: modeColor, letterSpacing: "0.04em" }}>
            {modeIsLive ? <Radio size={10} /> : <FlaskConical size={10} />}
            {modeIsLive ? (he ? "לייב · כסף אמיתי" : "LIVE · REAL MONEY") : (he ? "דמו · סימולציה" : "DEMO · SIMULATION")}
          </div>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: C.faint, marginTop: 2 }}>{he ? "רווח/הפסד כולל" : "Total P&L"}</div>
        </div>
        {modeCta ? (
          <button onClick={(e) => { e.stopPropagation(); nav(modeCta.to); }} className="tap44"
            style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap",
              color: C.gold, background: `${C.gold}14`, border: `1px solid ${C.gold}55`, borderRadius: 999, padding: "6px 13px", cursor: "pointer" }}>
            <PlugZap size={13} /> {modeCta.label} <Fwd size={12} />
          </button>
        ) : (
          <button onClick={() => setHide((v) => !v)} aria-label={he ? "הצג/הסתר" : "show/hide"}
            style={{ marginInlineStart: "auto", textAlign: rtl ? "left" : "right", flexShrink: 0, background: "none", border: "none", cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "flex-end", gap: 6 }}>
            <div style={{ fontSize: mobile ? 23 : 30, fontWeight: 900, opacity: 1, color: pnlColor(modeTotal), fontFamily: MONO, lineHeight: 1, direction: "ltr", whiteSpace: "nowrap", letterSpacing: "-0.02em" }}>
              {hide ? "••••" : signed(modeTotal)}
            </div>
            {hide ? <EyeOff size={15} color={C.muted} /> : <Eye size={15} color={C.muted} />}
          </button>
        )}
      </div>

      {/* Connected LIVE sub-account — its TOTAL GROWTH (value − deposited) alongside today's
          change. This is the "how much has the account grown since I funded it" figure Dan
          asked for, distinct from the composite trading P&L above (which is $0 until a run/bot
          trades). Read-only: reuses livePnl's deposit-aware growthPnl + period.today. When no
          deposit baseline is stored yet, prompt to set it rather than show a fake number.
          ── LAYOUT: this line renders in EVERY state (prompt before data → growth · today after)
          and is forced to ONE constant-height line (nowrap + fixed minHeight + overflow hidden),
          so it can't wrap/grow when the data loads. That keeps the loaded Home the SAME height as
          the initial load → no post-load reflow, the bottom buttons stay visible, no scroll. */}
      {modeIsLive && liveConnected && (
        <div style={{ padding: mobile ? "0 12px 8px" : "0 14px 10px", marginTop: -3, minHeight: mobile ? 20 : 22,
          display: "flex", alignItems: "baseline", gap: mobile ? 6 : 10, whiteSpace: "nowrap", overflow: "hidden", fontFamily: MONO }}>
          {/* Hidden via the eye toggle → keep the SAME reserved height (empty), so toggling the eye
              can't change the column height and make the desktop fit-scale rescale the screen. */}
          {!hide && (<>
          {liveGrowthPnl != null ? (
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4, minWidth: 0 }}>
              <span style={{ fontSize: mobile ? 12.5 : 13.5, fontWeight: 900, color: pnlColor(liveGrowthPnl) }}>
                {signed(liveGrowthPnl)}{liveGrowthPct != null ? ` (${liveGrowthPct >= 0 ? "+" : ""}${liveGrowthPct.toFixed(2)}%)` : ""}
              </span>
              <span style={{ fontSize: 8.5, fontWeight: 800, color: C.muted, fontFamily: "inherit" }}>{he ? "מהפקדה" : "vs dep."}</span>
              <button onClick={(e) => { e.stopPropagation(); openCbEdit(); }} title={he ? "ערוך הון שהופקד" : "edit deposited capital"} aria-label={he ? "ערוך הון שהופקד" : "edit deposited capital"}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginInlineStart: 2, display: "inline-flex", color: C.faint }}>
                <Pencil size={10} />
              </button>
            </span>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); openCbEdit(); }}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: 11, fontWeight: 800, color: C.gold, whiteSpace: "nowrap" }}>
              {he ? "הגדר הון שהופקד לצמיחה ←" : "set deposited capital for growth →"}
            </button>
          )}
          {liveToday != null && (
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4, minWidth: 0 }}>
              <span style={{ color: C.faint, fontWeight: 900 }}>·</span>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: pnlColor(liveToday) }}>
                {signed(liveToday)}{liveTodayPct != null ? ` (${liveTodayPct >= 0 ? "+" : ""}${liveTodayPct.toFixed(2)}%)` : ""}
              </span>
              <span style={{ fontSize: 8.5, fontWeight: 800, color: C.muted, fontFamily: "inherit" }}>{he ? "היום" : "today"}</span>
            </span>
          )}
          </>)}
        </div>
      )}

      {/* Inline deposited-capital editor — sets the baseline the total-growth figure needs. */}
      {modeIsLive && liveConnected && cbEdit && (
        <div style={{ padding: mobile ? "0 12px 10px" : "0 14px 12px", display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", direction: rtl ? "rtl" : "ltr" }}>
          <span style={{ fontSize: 10, color: C.muted, fontWeight: 700 }}>{he ? "הון שהופקד ($)" : "Deposited capital ($)"}</span>
          <input type="number" inputMode="decimal" autoFocus value={cbInput}
            onChange={(e) => setCbInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveCb(); if (e.key === "Escape") setCbEdit(false); }}
            placeholder="0" style={{ width: 96, fontFamily: MONO, fontSize: 12, fontWeight: 700, padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.gold}`, background: C.surface, color: C.text, textAlign: rtl ? "right" : "left" }} />
          <button onClick={saveCb} disabled={cbSaving}
            style={{ fontSize: 10, fontWeight: 900, padding: "5px 11px", borderRadius: 6, border: "none", background: "var(--btn-bg)", color: "var(--btn-ink)", cursor: cbSaving ? "default" : "pointer", opacity: cbSaving ? 0.6 : 1 }}>
            {cbSaving ? "…" : (he ? "שמור" : "Save")}
          </button>
          <button onClick={() => setCbEdit(false)} aria-label={he ? "בטל" : "Cancel"}
            style={{ fontSize: 12, fontWeight: 700, padding: "4px 7px", borderRadius: 6, border: "none", background: "none", color: C.muted, cursor: "pointer" }}>✕</button>
        </div>
      )}

      {info && (
        <div style={{ margin: "0 14px 10px", fontSize: 10.5, lineHeight: 1.5, color: C.muted, background: `${C.blue}0e`, border: `1px solid ${C.blue}44`, borderRadius: 10, padding: "8px 11px" }}>
          {he ? "המתג בוחר את הקשר כל המסגרת. \"לייב\" = כסף אמיתי בלבד: טייסים במצב לייב + מנוע הרווח החי + סיגנל בוטים + פוזיציות אמיתיות בבורסה. \"דמו\" = סימולציה בלבד: פוזיציות דמו + טייסים בסימולציה. הסכומים מחושבים ומוצגים בנפרד — לייב לעולם לא כולל סימולציה."
              : "The toggle sets the whole frame's context. \"LIVE\" = real money only: live-mode AutoPilots + the live Profit Engine + Signal Bots + real exchange positions. \"DEMO\" = simulation only: demo/paper positions + simulation AutoPilots. The totals are computed & shown separately — LIVE never includes any simulation."}
        </div>
      )}

      {/* ── ALWAYS-VISIBLE PER-TOOL CAPITAL + P&L BREAKDOWN (Yoav #1E0T) — every trading tool's
          own capital ("what capital referred to each tool") alongside its profit, then a grand
          PORTFOLIO TOTAL across all connected sub-accounts. Replaces the old P&L-only chips: a
          row that just showed profit read as "today's change"; each row now shows the tool's
          invested capital → and its profit, and the total row sums the whole portfolio. Each row
          is still tappable → drills into that source (an unconnected source shows a gold plug;
          the live Engine with no deposited baseline shows a "set" link). Capital the tool can't
          expose (Signal Bots) is shown honestly as "—", never invented, and left out of the
          summed total (with a note). The active drilled source's row is highlighted. ── */}
      <PortfolioBreakdown he={he} rtl={rtl} mobile={mobile} lines={toolLines}
        totalCapital={totalCapital} totalPnl={totalToolPnl} totalValue={totalValueAll}
        anyCapitalKnown={anyCapitalKnown} someCapitalUnknown={someCapitalUnknown} modeColor={modeColor}
        activeSource={expanded ? effSource : null} />

      {/* Expanded → the SELECTED source's detail view. grid-rows 0fr→1fr glides open/closed; heavy
          views stay gated on `expanded` so they never fetch while collapsed. This region stays IN
          FLOW and scrolls — Home drops its desktop fit-scale transform while the card is expanded,
          so opening it NEVER rescales/shrinks the whole screen; it reveals + scrolls in place. */}
      <div style={{ display: "grid", gridTemplateRows: expanded ? "1fr" : "0fr", transition: "grid-template-rows 280ms ease" }}>
        <div style={{ overflow: "hidden", minHeight: 0 }}>
        {/* The detail list is CONTAINED: its own bounded max-height + internal scroll, so a long
            positions list can never push the card past the viewport / off the top nav. The bottom
            of the list is always reachable by scrolling INSIDE this box (overscroll contained so it
            doesn't chain to the page). Kept in px (no vh — html{zoom} would mis-size vh). */}
        <div style={{ padding: "0 14px 12px", borderTop: `1px solid ${C.line}`,
          maxHeight: mobile ? 300 : 360, overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain" }}>
          {/* PROFIT ENGINE — real exchange positions (live) or paper positions (demo). */}
          {expanded && effSource === "engine" && (modeIsLive ? <PositionsWidget bare /> : <DemoPositionsWidget bare />)}

          {/* PILOTS — filtered by mode (live pilots vs simulation pilots). */}
          {expanded && effSource === "pilots" && owner && (
            <AutoPilotsDashboard he={he} rtl={rtl} simByPilot={simByPilot} filter={modeIsLive ? "live" : "sim"}
              onOpenRow={(id) => nav(`/owners?tab=autopilots&pilot=${encodeURIComponent(id)}`)} />
          )}

          {/* SIGNAL BOT — LIVE only (real orders). */}
          {expanded && effSource === "bots" && modeIsLive && <SignalBotsList he={he} rtl={rtl} bots={bots} onOpen={() => nav("/bots")} />}
        </div>
        </div>
      </div>
    </div>
  );
}

// ── PORTFOLIO BREAKDOWN — per-tool capital + P&L, then a grand portfolio total (Yoav #1E0T).
// A compact stacked list: each tool row shows its own sub-account CAPITAL (invested) and its
// PROFIT; a final TOTAL row sums the whole portfolio (capital + P&L → value). Each tool row is
// tappable → drills into that source (or connects it if unconnected). Capital a tool can't
// expose is shown as "—" and excluded from the summed total (a note flags it). Replaces the old
// P&L-only chip strip (which read as a "daily change" pill). ──
function PortfolioBreakdown({ he, rtl, mobile, lines, totalCapital, totalPnl, totalValue, anyCapitalKnown, someCapitalUnknown, modeColor, activeSource }: {
  he: boolean; rtl: boolean; mobile: boolean; lines: ToolLine[];
  totalCapital: number; totalPnl: number; totalValue: number;
  anyCapitalKnown: boolean; someCapitalUnknown: boolean; modeColor: string; activeSource: Source | null;
}) {
  // icon · NAME(flex) · CAPITAL · P&L — fixed numeric tracks so the two money columns line up.
  const grid = mobile ? "18px minmax(40px,1fr) 78px 66px" : "20px minmax(70px,1fr) 96px 82px";
  const cap0 = (n: number) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const num: React.CSSProperties = { textAlign: "end", fontFamily: MONO, direction: "ltr", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  return (
    <div style={{ padding: mobile ? "0 12px 10px" : "0 14px 12px", direction: rtl ? "rtl" : "ltr" }}>
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, background: C.surface2, overflow: "hidden" }}>
        {/* column headers */}
        <div style={{ display: "grid", gridTemplateColumns: grid, alignItems: "center", columnGap: mobile ? 7 : 9, padding: mobile ? "5px 10px" : "6px 12px", borderBottom: `1px solid ${C.line}` }}>
          <span /><span />
          <span style={{ ...num, fontSize: 8.5, fontWeight: 800, color: C.faint, letterSpacing: "0.03em" }}>{he ? "הון" : "capital"}</span>
          <span style={{ ...num, fontSize: 8.5, fontWeight: 800, color: C.faint, letterSpacing: "0.03em" }}>{he ? "רווח/הפסד" : "P&L"}</span>
        </div>
        {lines.map((t, i) => {
          const active = activeSource === t.source;
          const pc = t.pnl == null || Math.abs(t.pnl) < 0.005 ? C.muted : t.pnl > 0 ? C.gain : C.loss;
          return (
            <button key={i} onClick={() => (t.connected ? t.onOpen() : (t.onConnect && t.onConnect()))} className="tap44"
              aria-pressed={active}
              title={t.connected ? t.label : (he ? `${t.label} — הגדרה` : `${t.label} — set up`)}
              style={{ display: "grid", gridTemplateColumns: grid, alignItems: "center", columnGap: mobile ? 7 : 9, width: "100%",
                padding: mobile ? "7px 10px" : "8px 12px", border: "none", borderTop: i === 0 ? "none" : `1px solid ${C.line}`,
                background: active ? C.surface : "transparent", cursor: "pointer", fontFamily: "inherit", textAlign: rtl ? "right" : "left" }}>
              <t.Icon size={mobile ? 13 : 14} color={t.connected ? C.text : C.gold} />
              <span style={{ minWidth: 0, fontSize: mobile ? 11.5 : 12.5, fontWeight: 800, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.label}</span>
              {/* CAPITAL — a number, an honest "—", or (live engine, no baseline) a "set" link. */}
              {!t.connected ? (
                <span style={{ ...num, display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 4, fontSize: 11, fontWeight: 800, color: C.gold }}>
                  <PlugZap size={11} color={C.gold} /> {he ? "חבר" : "connect"}
                </span>
              ) : t.capitalKnown && t.capital != null ? (
                <span style={{ ...num, fontSize: mobile ? 11.5 : 12.5, fontWeight: 900, color: C.text }}>{cap0(t.capital)}</span>
              ) : t.onSetCapital ? (
                <span onClick={(e) => { e.stopPropagation(); t.onSetCapital!(); }}
                  style={{ ...num, fontSize: 10, fontWeight: 800, color: C.gold, cursor: "pointer" }}>{he ? "הגדר ←" : "set →"}</span>
              ) : (
                <span style={{ ...num, fontSize: 12, fontWeight: 800, color: C.faint }}>—</span>
              )}
              {/* P&L */}
              <span style={{ ...num, fontSize: mobile ? 11.5 : 12.5, fontWeight: 900, color: pc }}>
                {t.pnl == null ? "—" : signed(t.pnl)}
              </span>
            </button>
          );
        })}
        {/* TOTAL — the whole-portfolio roll-up (capital + P&L → value) across all tools. */}
        <div style={{ display: "grid", gridTemplateColumns: grid, alignItems: "center", columnGap: mobile ? 7 : 9,
          padding: mobile ? "8px 10px" : "9px 12px", borderTop: `1.5px solid ${modeColor}55`, background: `${modeColor}0e` }}>
          <Wallet size={mobile ? 13 : 14} color={modeColor} />
          <span style={{ minWidth: 0, fontSize: mobile ? 11.5 : 12.5, fontWeight: 900, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {he ? "תיק — סה״כ" : "Portfolio — total"}
          </span>
          <span style={{ ...num, fontSize: mobile ? 12 : 13, fontWeight: 900, color: C.text }}>{anyCapitalKnown ? cap0(totalCapital) : "—"}</span>
          <span style={{ ...num, fontSize: mobile ? 12 : 13, fontWeight: 900, color: totalPnl > 0 ? C.gain : totalPnl < 0 ? C.loss : C.muted }}>{signed(totalPnl)}</span>
        </div>
      </div>
      {/* Portfolio VALUE (capital + profit) + honesty note for any tool whose capital is n/a. */}
      <div style={{ marginTop: 6, display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", fontSize: 9.5, fontWeight: 800, color: C.muted }}>
        {anyCapitalKnown && (
          <span>{he ? "שווי תיק כולל" : "Total portfolio value"}: <span style={{ fontFamily: MONO, color: C.text, fontWeight: 900 }}>{cap0(totalValue)}</span></span>
        )}
        {someCapitalUnknown && (
          <span style={{ color: C.faint, fontWeight: 700 }}>
            {he ? "· הון סיגנל בוט אינו זמין (לא נספר)" : "· Signal Bot capital n/a (not counted)"}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Signal Bots list — the user's real /bots (label · exchange · status · P&L · open). ──
function SignalBotsList({ he, rtl, bots, onOpen }: { he: boolean; rtl: boolean; bots: any[]; onOpen: () => void }) {
  const Fwd = rtl ? ChevronLeft : ChevronRight;
  if (!bots || bots.length === 0) {
    return (
      <button onClick={onOpen} className="tap44"
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: C.surface, border: `1px solid ${C.line}`,
          borderRadius: 11, padding: "10px 12px", boxShadow: C.glassHi, cursor: "pointer", textAlign: rtl ? "right" : "left" }}>
        <span style={{ fontSize: 12, color: C.muted, flex: 1 }}>{he ? "עדיין אין בוטים." : "No signal bots yet."}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 800, color: C.gold,
          background: `${C.gold}14`, border: `1px solid ${C.gold}55`, borderRadius: 999, padding: "4px 11px" }}>
          <Plus size={12} /> {he ? "צור בוט" : "Create a bot"} <Fwd size={12} />
        </span>
      </button>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {bots.map((b: any, i: number) => {
        const active = String(b.status) === "active";
        const pnl = Number(b.pnl || 0);
        return (
          <button key={b.id ?? i} onClick={onOpen} className="tap44"
            style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: `${C.loss}08`, border: `1px solid ${C.loss}55`,
              borderRadius: 11, padding: "9px 11px", boxShadow: C.glassHi, cursor: "pointer", textAlign: rtl ? "right" : "left" }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: active ? C.gain : C.faint }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.label || (he ? "בוט" : "Bot")}</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.faint, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {b.exchange || "—"}{b.market ? ` · ${b.market}` : ""} · {b.openPositions ?? 0} {he ? "פתוחות" : "open"}
              </div>
            </div>
            <span style={{ fontSize: 12.5, fontWeight: 900, color: pnlColor(pnl), fontFamily: MONO, direction: "ltr", flexShrink: 0 }}>{signed(pnl)}</span>
            <Fwd size={15} color={C.faint} style={{ flexShrink: 0 }} />
          </button>
        );
      })}
    </div>
  );
}
