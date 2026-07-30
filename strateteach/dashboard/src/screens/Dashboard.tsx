import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Loader2, RefreshCw, ArrowRight, ArrowRightLeft, TrendingUp, Layers,
  FlaskConical, Wallet, Radio, Link2, ExternalLink, History, Plug, ChevronRight,
  Rocket, Cpu } from "lucide-react";
import { api, loadExchangeCreds, loadAccounts, activeAccountId, isOwner } from "../app/api";
import { useCombinedLive } from "../lib/useCombinedLive";
import { apSummary, AP_STATE_KEY } from "../components/AutoPilots";
import { useI18n } from "../i18n";
import { UI, MONO, RADIUS } from "../theme";
import { Spin } from "../ui";
import CarvedTitle from "../components/CarvedTitle";
import CloseButtons from "../components/CloseButtons";
import { useIsMobile } from "../lib/useIsMobile";
import { ev as track12 } from "../lib/analytics";

// ── FIXED light-dashboard palette (Dan: /overview has its OWN light look, independent of the
//    app skin). We do NOT use the skin's C.* tokens for the dashboard's text/surfaces — those
//    are dark on dark skins and would be invisible on this light board. Card CONTENT sits on the
//    glass cards' darker inner cores, so it's WHITE/light; the bare light surface (header) uses
//    dark ink. gain/loss are bright variants that read on the dark cores. Skin-independent. ──
const D = {
  ink: "#ffffff",                    // primary text on the glass cards (white on the darker core)
  soft: "rgba(255,255,255,0.74)",    // muted text on cards
  faint: "rgba(255,255,255,0.5)",    // faint text on cards
  line: "rgba(255,255,255,0.18)",    // hairlines / borders on cards
  chip: "rgba(0,0,0,0.24)",          // inset sub-card / row background on the coloured glass
  icon: "#ffffff",                   // icons on cards (hex → safe for `${D.icon}55` alpha-append)
  gain: "#39e08d",                   // readable green on the dark cores
  loss: "#ff6d7a",                   // readable red on the dark cores
  blue: "#6ea8ff",                   // demo-mode accent
  onLight: "#1e2740",                // dark ink for the bare light surface (header)
  onLightSoft: "#5b6577",
};

// ── Formatters ────────────────────────────────────────────────────────────────
const money = (v: number | null | undefined, dp = 2) =>
  v == null || isNaN(v as number) ? "—"
    : `${(v as number) < 0 ? "-" : ""}$${Math.abs(v as number).toLocaleString(undefined, { maximumFractionDigits: dp })}`;
const signed = (v: number | null | undefined) =>
  v == null || isNaN(v as number) ? "—"
    : `${(v as number) >= 0 ? "+" : "-"}$${Math.abs(v as number).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const pctStr = (p: number | null | undefined) =>
  p == null || isNaN(p as number) ? "" : `${(p as number) >= 0 ? "+" : ""}${(p as number).toFixed(2)}%`;
// Non-colour direction cue (WCAG "not colour alone") — a ▲/▼ glyph alongside the hue.
const arrow = (v: number | null | undefined) => (v == null || isNaN(Number(v))) ? "" : (Number(v) >= 0 ? "▲ " : "▼ ");
const gl = (v: number | null | undefined) => (v == null || isNaN(Number(v))) ? D.ink : (Number(v) >= 0 ? D.gain : D.loss);

// ── The majors shown in the market strip (real live prices via the ticker source;
//    24h change joined from the daily scan when the symbol is covered). ──
type Coin = { base: string; name: string; tint: string };
const COINS: Coin[] = [
  { base: "BTC", name: "Bitcoin", tint: "#F7931A" },
  { base: "ETH", name: "Ethereum", tint: "#627EEA" },
  { base: "BNB", name: "BNB", tint: "#F0B90B" },
  { base: "SOL", name: "Solana", tint: "#14F195" },
  { base: "XRP", name: "XRP", tint: "#23292F" },
  { base: "ADA", name: "Cardano", tint: "#0033AD" },
  { base: "DOGE", name: "Dogecoin", tint: "#C2A633" },
];
const MARKET_SYMS = COINS.map((c) => `${c.base}/USDT`);
const tintOf = (base: string) => COINS.find((c) => c.base === base)?.tint || D.icon;

// ── Option-7 clear-glass card shell (.o7card: clear coloured glass on the light board, darker
//    inner core + diamond edge). `hue` is an "r,g,b" triplet that tints this section's rim /
//    glints / core-hue / halo via --h; child buttons INHERIT it. Omitted → the .o7dash default. ──
// A flex COLUMN that fills its grid cell (height:100%) so every card is the SAME size in the
// uniform grid; a card's scroll region (below) flexes + scrolls INSIDE the fixed-height cell.
function Card({ children, pad = 16, hue, style }: { children: React.ReactNode; pad?: number; hue?: string; style?: React.CSSProperties }) {
  const hueVar = hue ? ({ ["--h"]: hue } as React.CSSProperties) : undefined;
  return (
    <div className="o7card" style={{ borderRadius: RADIUS.lg, padding: pad, minHeight: 0, display: "flex", flexDirection: "column", boxSizing: "border-box", ...hueVar, ...style }}>
      {children}
    </div>
  );
}
function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span style={{ display: "block", fontSize: 11, fontWeight: 800, letterSpacing: "0.03em", color: D.soft }}>{children}</span>;
}
// A round coin badge (fixed coin identity colour, like the app's brand tiles) with the ticker.
function CoinBadge({ base, size = 30 }: { base: string; size?: number }) {
  const tint = tintOf(base);
  return (
    <span aria-hidden style={{
      // On the dark glass cores the coin's own tint (some are near-black, e.g. XRP) would be
      // unreadable as text — so the ticker is WHITE and the coin identity lives in the tint fill+rim.
      width: size, height: size, flexShrink: 0, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: `${tint}44`, border: `1.5px solid ${tint}`, color: "#fff", fontFamily: MONO, fontWeight: 900,
      fontSize: base.length > 3 ? 9 : 10.5, letterSpacing: "-0.02em", textShadow: "0 1px 2px rgba(0,0,0,0.5)",
    }}>{base}</span>
  );
}

// ── DashTitle — the app's STANDARD framed-title structure (like FramedTitle: a centered rounded
//    frame hugging a CarvedTitle + a subtitle), LIGHT-adapted for the dashboard board: the frame
//    is our approved clean GLASS (.o7card, skin-independent) instead of the skin gold-glass, and
//    the subtitle is white — so it reads on the light board on ANY skin (the skin-coupled gold
//    frame/subtitle would go low-contrast on light). CarvedTitle keeps the per-skin carved wordmark
//    (matching every other screen's title), and pops on the glass's deep core. Same DOM nesting as
//    FramedTitle (centering row › frame › CarvedTitle) so CarvedTitle's auto-fit works. ──
function DashTitle({ text, subtitle, mobile }: { text: string; subtitle?: React.ReactNode; mobile: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", width: "100%", marginTop: 2, marginBottom: 2 }}>
      <div className="o7card" style={{
        width: mobile ? "100%" : "fit-content", minWidth: mobile ? undefined : 320, maxWidth: mobile ? "100%" : "92vw",
        boxSizing: "border-box", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
        borderRadius: mobile ? 16 : 20, padding: mobile ? "9px 18px 8px" : "13px 34px 12px",
      }}>
        <CarvedTitle text={text} size={mobile ? 32 : 40} variant="emboss" />
        {subtitle != null && (
          <span dir="auto" style={{ display: "block", textAlign: "center", fontSize: mobile ? 12 : 13, fontWeight: 600,
            color: "rgba(255,255,255,0.86)", letterSpacing: "0.02em", lineHeight: 1.35, maxWidth: 460, paddingInline: 4, textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Financial dashboard (route /overview) — ONE screen, liquid-glass, showing the WHOLE
// portfolio across ALL THREE trading tools, all REAL + read-only + money-safe:
//   • total portfolio value + combined P&L (aggregating Engine + Pilots + Signal Bot)
//   • PER-TOOL P&L broken out (Engine / Pilots / Signal Bot each on its own)
//   • Engine open positions · Pilots active runs · Signal Bot runs (read-only)
//   • coin holdings (wallet) · connected exchanges (status only, NEVER keys)
// No chart. No arm/go-live/keys/kill controls. No orders/transfers/withdraws. The
// convert panel is illustrative and routes to the gated /exchange.
// ═══════════════════════════════════════════════════════════════════════════════
export default function Dashboard() {
  const { t, rtl, lang } = useI18n();
  const he = lang === "he";
  const nav = useNavigate();
  const mobile = useIsMobile();
  const exConn = !!loadExchangeCreds();
  const owner = isOwner();
  useEffect(() => { track12.dashboardViewed(); }, []); // canonical analytics

  // ── UI state (declared BEFORE any derived value that reads it — TDZ-safe) ──
  const [mode, setMode] = useState<"live" | "demo">(exConn ? "live" : "demo");
  const [selBase, setSelBase] = useState<string>("BTC");
  const modeIsLive = mode === "live";

  // ── Data (same query keys the rest of the app uses → shared cache, per-user, no singletons) ──
  const pnlQ = useQuery({ queryKey: ["livePnl"], queryFn: () => api.livePnl(), enabled: exConn, retry: false, refetchInterval: 30000 });
  const balQ = useQuery({ queryKey: ["exBalanceOv"], queryFn: () => api.balance(), enabled: exConn, retry: false, refetchInterval: 30000 });
  const posQ = useQuery({ queryKey: ["exPositionsOv"], queryFn: () => api.positions(), enabled: exConn, retry: false, refetchInterval: 30000 });
  const paperQ = useQuery({ queryKey: ["paperState"], queryFn: () => api.paperState(), retry: false, refetchInterval: 15000 });
  const liveDashQ = useQuery({ queryKey: ["dashboardLive"], queryFn: () => api.dashboardLive(), refetchInterval: 15000 });
  const botsQ = useQuery({ queryKey: ["botsDashboard"], queryFn: () => api.botsDashboard(), retry: false, refetchInterval: 30000 });
  const engineQ = useQuery({ queryKey: ["engineLivePnl"], queryFn: () => api.engineLivePnl(), retry: false, refetchInterval: 45000 });
  const pilotsQ = useQuery({ queryKey: AP_STATE_KEY, queryFn: () => api.autopilotsState(), enabled: owner, refetchInterval: 45000, staleTime: 15000 });
  const pricesQ = useQuery({ queryKey: ["tkPrices", MARKET_SYMS], queryFn: () => api.tickerPrices(MARKET_SYMS), refetchInterval: 15000, retry: 1 });
  const scanQ = useQuery({ queryKey: ["dailyScan"], queryFn: () => api.dailyScan(), retry: false, staleTime: 60000 });

  // ── Multi-account REAL-balance aggregation (Dan: the LIVE total must combine ALL his money now).
  // Extracted into the SHARED useCombinedLive hook so Home (HomeGlance) and /overview compute the
  // identical combined real-money headline and can never drift. It sums the browser sub-accounts
  // (loadAccounts → livePnl per creds) + the autopilots' Bybit balance (/autopilots/balance); sim
  // P&L is NEVER folded in. See useCombinedLive.ts for the per-user / pilots-base reasoning. ──
  const cl = useCombinedLive();

  const pnlD: any = pnlQ.data;
  const bal: any = balQ.data;
  const pos: any = posQ.data;
  const paper: any = paperQ.data;
  const dl: any = liveDashQ.data;
  const bd: any = botsQ.data;
  const prices: Record<string, number> = ((pricesQ.data as any)?.prices) || {};

  // 24h change map, joined from the daily-scan results by symbol (honest "—" when uncovered).
  const changeBySym: Record<string, number> = {};
  for (const r of (((scanQ.data as any)?.results) || [])) {
    const s = String(r.symbol || "").toUpperCase();
    if (typeof r.changeTodayPct === "number") changeBySym[s] = r.changeTodayPct;
  }
  const changeOf = (base: string): number | null => {
    const v = changeBySym[`${base}/USDT`];
    return typeof v === "number" ? v : null;
  };

  // ── LIVE exchange account (Trading Engine live sub-account) ──
  const liveTotalValue: number | null = pnlD?.ok && pnlD.totalValue != null ? Number(pnlD.totalValue) : null;
  const liveGrowthPnl: number | null = pnlD?.ok && pnlD.growthPnl != null ? Number(pnlD.growthPnl) : null;
  const liveToday: number | null = pnlD?.ok && pnlD.period?.today != null ? Number(pnlD.period.today) : null;
  const positions: any[] = pnlD?.ok ? (pnlD.positions || []) : []; // spot holdings valued + P&L
  const exchangeOpenUnreal: number = exConn && pnlD?.ok ? Number(pnlD.unrealizedPnl || 0) : 0;

  // ── Wallet balances (read-only fetch_balance): total funds + available + per-coin ──
  const balances: any[] = (bal?.balances || []);
  const usdtRow = balances.find((b) => String(b.asset || "").toUpperCase() === "USDT");
  const walletFunds: number | null = usdtRow ? Number(usdtRow.total) : (bal?.ok ? 0 : null);
  const walletAvail: number | null = pnlD?.ok && pnlD.available != null ? Number(pnlD.available) : (usdtRow ? Number(usdtRow.free) : null);
  const posByAsset: Record<string, any> = {};
  for (const p of positions) posByAsset[String(p.asset || "").toUpperCase()] = p;
  const coinRows: any[] = balances
    .filter((b) => String(b.asset || "").toUpperCase() !== "USDT" && Number(b.total) > 0)
    .filter((b) => { const m = posByAsset[String(b.asset).toUpperCase()]; return !(m && m.value != null && Number(m.value) < 1); });

  // ── Engine open positions — LIVE: exchange futures + spot; DEMO: paper positions ──
  const futures: any[] = pos?.ok && (pos.positions || []).length ? pos.positions : [];
  const spotOpen: any[] = positions.filter((p) => p.value == null || Number(p.value) >= 1);
  const demoPositions: any[] = Array.isArray(paper?.positions)
    ? paper.positions.filter((x: any) => (x?.status ? x.status === "open" : true) && Number(x?.value || 0) >= 1) : [];
  const engineOpenCount = modeIsLive ? (futures.length + spotOpen.length) : demoPositions.length;

  // ── DEMO (simulation) engine — paper state ──
  const demoCost: number | null = paper ? Number(paper.totalCost || 0) : null;
  const demoPnlPaper: number | null = paper ? Number(paper.totalPnl || 0) : null;
  const demoToday: number | null = dl?.demo?.today != null ? Number(dl.demo.today) : null;

  // ── TOOL 1 · ENGINE (Trading/Profit Engine) ──
  const engineRealized: number = (engineQ.data as any)?.ok ? Number((engineQ.data as any).realizedPnl || 0) : 0;
  const enginePnlLive: number = engineRealized + exchangeOpenUnreal;         // live: realized closes + open unrealized
  const enginePnl: number | null = modeIsLive ? enginePnlLive : demoPnlPaper; // mode-aware engine P&L
  const engineCapLive: number | null = liveGrowthPnl != null && liveTotalValue != null ? liveTotalValue - liveGrowthPnl
    : (pnlD?.ok && pnlD.costBasis != null ? Number(pnlD.costBasis) : (pnlD?.ok && pnlD.netDeposits != null ? Number(pnlD.netDeposits) : null));

  // ── TOOL 2 · PILOTS (AutoPilots) — owner-only, READ-ONLY (no arm/go-live/keys here) ──
  const pilots: any[] = (pilotsQ.data as any)?.pilots || [];
  const psum = apSummary(pilots);
  const pilotIsLive = (p: any) => (p.mode || "simulation") === "live";
  const livePilots = pilots.filter(pilotIsLive);
  // Active SIM pilots only (ran / open / non-zero P&L) — dormant sims stay hidden.
  const simPilotsActive = pilots.filter((p) => !pilotIsLive(p) && (p.hasRun || Number(p.openCount) > 0 || Number(p.totalPnl || 0) !== 0));
  // MODE-AWARE (Dan): LIVE view shows ALL live-mode pilots — a pilot set to LIVE + funds BELONGS in
  // the live view even though the master gate (AUTOPILOT_LIVE_ENABLED) is OFF, so it hasn't placed
  // real orders yet (its live P&L is then honestly $0). It must appear as a LIVE pilot, NOT as demo.
  // (Bug it fixes: the old activity filter — hasRun/openCount/totalPnl, which reflect SIM history —
  // dropped un-executed live pilots from the live view, so the section fell back to sim/demo.)
  const modePilots = modeIsLive ? livePilots : simPilotsActive;
  // Per-pilot figure: LIVE view uses the pilot's LIVE slice ONLY — honest $0 when not executed;
  // NEVER fall back to totalPnl (that's the SIM total). DEMO view uses the sim slice.
  const pilotPnlOf = (p: any): number => modeIsLive
    ? (p.livePnl != null ? Number(p.livePnl) : 0)
    : (p.simPnl != null ? Number(p.simPnl) : Number(p.totalPnl || 0));
  const pilotOpenOf = (p: any): number => modeIsLive
    ? (p.liveOpenCount != null ? Number(p.liveOpenCount) : 0)
    : (p.simOpenCount != null ? Number(p.simOpenCount) : Number(p.openCount || 0));
  const pilotCapOf = (p: any): number => modeIsLive ? Number((p.liveCap ?? p.capital ?? p.nav) || 0) : Number((p.capital ?? p.nav) || 0);
  // Card/chip totals track the SHOWN pilots (live slice in live view, sim slice in demo view).
  const pilotPnl: number | null = owner ? modePilots.reduce((s, p) => s + pilotPnlOf(p), 0) : null;
  const pilotOpen: number = owner ? modePilots.reduce((s, p) => s + pilotOpenOf(p), 0) : 0;
  const pilotCap: number | null = owner ? (modePilots.length > 0 ? modePilots.reduce((s, p) => s + pilotCapOf(p), 0) : null) : null;
  const prettyPilot = (id: string) => String(id || "").replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

  // ── TOOL 3 · SIGNAL BOT — read-only (always live in this model) ──
  const bots: any[] = bd?.bots || [];
  const activeBots = bots.filter((b) => (b.status || "active") === "active").length;
  const botsPnl: number | null = bd?.ok && bd.totalPnl != null ? Number(bd.totalPnl) : null;
  const botOpen = bots.reduce((s, b) => s + (Number(b.openPositions) || 0), 0);

  // ── Combined REAL value across ALL connected accounts — from the shared useCombinedLive hook
  // (identical math on Home + /overview). `acctFailed` drives the honest "couldn't load" note. ──
  const combinedRealValue = cl.value;
  const combinedInvested = cl.invested;                                          // engine real base + pilots deposit
  const combinedRealPnl = cl.pnl;                                               // engine growth + pilots $0 (gate off); NOT sim
  const combinedRealToday = cl.today;
  const acctFailed = cl.failed;

  // ── LIVE total = combined REAL wallet value of EVERY connected account (NOT engine-only). Simulated
  // pilot P&L is still NEVER folded into this real-money headline — only real balances. DEMO = all sim. ──
  const liveCombined = combinedRealPnl;
  const demoCombined = Number(demoPnlPaper || 0) + (owner ? Number(psum.simPnl || 0) : 0);
  const combinedPnl = modeIsLive ? liveCombined : demoCombined;

  const liveValueAll = combinedRealValue;
  const demoCaps = [demoCost, owner ? Number(psum.simCapital || 0) : null].filter((v) => v != null) as number[];
  const demoValueAll = demoCaps.length ? demoCaps.reduce((a, b) => a + b, 0) + demoCombined : null;
  const heroValue = modeIsLive ? liveValueAll : demoValueAll;
  const heroToday = modeIsLive ? combinedRealToday : demoToday;
  // % is over the COMBINED invested capital (engine real base + pilots deposit) in live / demo capital.
  const heroBase = modeIsLive ? (combinedInvested > 0 ? combinedInvested : null) : (heroValue != null ? heroValue - combinedPnl : null);
  const heroPct = heroBase != null && heroBase > 0 ? (combinedPnl / heroBase) * 100 : null;
  const heroLoading = modeIsLive ? cl.loading : (paperQ.isLoading || liveDashQ.isLoading);
  const heroNA = modeIsLive ? (combinedRealValue == null && !heroLoading) : false;

  // ── Connected exchanges (status only — NEVER keys/secrets) ──
  const accounts = loadAccounts();
  const activeId = activeAccountId();

  const refreshAll = () => { pnlQ.refetch(); balQ.refetch(); posQ.refetch(); paperQ.refetch(); liveDashQ.refetch(); botsQ.refetch(); engineQ.refetch(); if (owner) pilotsQ.refetch(); pricesQ.refetch(); scanQ.refetch(); };
  const anyFetching = pnlQ.isFetching || balQ.isFetching || paperQ.isFetching || botsQ.isFetching || engineQ.isFetching || (owner && pilotsQ.isFetching);

  // A card's scroll region: a max-height CAP + internal scroll on both desktop & mobile — so a long
  // list (pilots/wallet/positions) never makes the card huge, while the card stays CONTENT-height and
  // fully contains its own header/list/footer (grid rows are auto-height, so nothing overflows a cell).
  // Desktop: the list FLEX-FILLS the FIXED-height card (the cell is a fixed size — see gridAutoRows)
  // and scrolls internally, so the card height is CONSTANT no matter how many rows load (0, 3, or 10)
  // — the grid stays aligned before AND after data arrives (Dan: "a precise bound that holds after
  // loading"). Mobile: a plain max-height cap in the natural stack.
  const listScroll = (maxH: number): React.CSSProperties =>
    mobile ? { maxHeight: maxH, overflowY: "auto" } : { flex: 1, minHeight: 0, overflowY: "auto" };

  // styling helpers (skin-adaptive)
  const ghostBtn: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "9px 13px", borderRadius: 12,
    fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", background: "transparent",
    border: `1px solid ${D.line}`, color: D.ink, minHeight: 42,
  };
  const linkAction = (label: React.ReactNode, onClick: () => void, Icon: React.FC<any> = ArrowRight) => (
    <button onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", color: D.icon, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
      {label} <Icon size={13} style={{ transform: rtl && Icon === ArrowRight ? "scaleX(-1)" : "none" }} />
    </button>
  );
  const Head = ({ Icon, title, pnl, action }: { Icon: React.FC<any>; title: React.ReactNode; pnl?: number | null; action?: React.ReactNode }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 11 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 800, color: D.ink, minWidth: 0 }}>
        <Icon size={15} color={D.icon} /> <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
        {pnl !== undefined && <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 12, color: gl(pnl) }}>{pnl == null ? "" : signed(pnl)}</span>}
      </span>
      {action}
    </div>
  );
  // slim per-tool P&L chip in the hero. `dim` = this tool's P&L is NOT counted in the mode's
  // headline total (LIVE: sim pilots/bots) → render the figure MUTED (never red/green) so it
  // can't read as a real-money gain/loss, while still showing it (nothing disappears).
  const pnlChip = (Icon: React.FC<any>, label: string, v: number | null, note: React.ReactNode, onClick: () => void, dim = false) => (
    <button onClick={onClick} className="tap44" style={{ flex: 1, minWidth: 0, textAlign: "start", cursor: "pointer", fontFamily: "inherit", background: D.chip, border: `1px solid ${D.line}`, borderRadius: RADIUS.md, padding: "8px 9px", color: D.ink }}>
      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9.5, fontWeight: 800, color: D.soft }}><Icon size={11} color={D.icon} /><span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span></span>
      <span style={{ display: "block", fontFamily: MONO, fontWeight: 800, fontSize: 12.5, marginTop: 3, color: v == null || dim ? D.soft : gl(v), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v == null ? "—" : signed(v)}</span>
      <span style={{ display: "block", fontSize: 9.5, color: D.soft, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{note}</span>
    </button>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // CARDS — defined as elements after all data is in scope (no forward refs).
  // ─────────────────────────────────────────────────────────────────────────────

  // MARKET STRIP — compact one-row ticker + History/Refresh cluster (full-width, NOT a grid cell).
  const marketStrip = (
    <Card pad={10} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, height: "auto" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
        {COINS.map((c) => {
          const price = prices[`${c.base}/USDT`];
          const chg = changeOf(c.base);
          const active = selBase === c.base;
          return (
            <button key={c.base} onClick={() => setSelBase(c.base)} className="tap44"
              style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontFamily: "inherit",
                background: active ? `${D.icon}14` : D.chip, border: `1px solid ${active ? D.icon + "77" : D.line}`, borderRadius: RADIUS.pill, padding: "5px 11px 5px 6px", color: D.ink }}>
              <CoinBadge base={c.base} size={26} />
              <span style={{ textAlign: "start" }}>
                <span style={{ display: "block", fontWeight: 800, fontSize: 12, fontFamily: MONO, lineHeight: 1.1 }}>{price != null ? money(price, price >= 100 ? 2 : 4) : "—"}</span>
                <span style={{ display: "block", fontSize: 10, fontWeight: 700, lineHeight: 1.1, color: chg == null ? D.soft : gl(chg) }}>{c.base} {chg == null ? "" : pctStr(chg)}</span>
              </span>
            </button>
          );
        })}
      </div>
      <button onClick={() => nav("/activity")} className="tap44" title={he ? "היסטוריה" : "History"}
        style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: RADIUS.pill, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: "transparent", border: `1px solid ${D.line}`, color: D.ink }}>
        <History size={14} color={D.icon} />{!mobile && <span>{he ? "היסטוריה" : "History"}</span>}
      </button>
      <button onClick={refreshAll} disabled={anyFetching} className="tap44" title={t.refresh}
        style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: "50%", cursor: "pointer", fontFamily: "inherit", background: "transparent", border: `1px solid ${D.line}`, color: D.soft, opacity: anyFetching ? 0.6 : 1 }}>
        {anyFetching ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
      </button>
    </Card>
  );

  // HERO — total portfolio value + combined P&L + per-tool chips (Engine / Pilots / Signal Bot).
  const portfolioCard = (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 800, color: D.ink }}>
          <Wallet size={15} color={D.icon} /> {he ? "התיק שלי" : "My Portfolio"}
        </span>
        <div style={{ display: "flex", gap: 4, background: D.chip, border: `1px solid ${D.line}`, borderRadius: RADIUS.pill, padding: 3 }}>
          {(["live", "demo"] as const).map((m) => {
            const active = mode === m;
            const c = m === "live" ? D.loss : D.blue;
            return (
              <button key={m} onClick={() => setMode(m)} className="tap44" aria-pressed={active}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: RADIUS.pill, fontSize: 11, fontWeight: 800,
                  cursor: "pointer", fontFamily: "inherit", border: "none", background: active ? c : "transparent", color: active ? "#fff" : D.soft }}>
                {m === "live" ? <Radio size={12} /> : <FlaskConical size={12} />}
                {m === "live" ? (he ? "לייב" : "LIVE") : (he ? "דמו" : "DEMO")}
              </button>
            );
          })}
        </div>
      </div>

      <Eyebrow>{modeIsLive ? (he ? "סה\"כ שווי · כל החשבונות" : "Total value · all connected accounts") : (he ? "סה\"כ שווי · סימולציה" : "Total portfolio value · simulation")}</Eyebrow>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 5, flexWrap: "wrap" }}>
        <span style={{ fontFamily: MONO, fontWeight: 900, fontSize: 27, lineHeight: 1.05, color: D.ink }}>
          {heroLoading ? "…" : (heroNA ? "—" : money(heroValue))}
        </span>
        <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 14, color: gl(combinedPnl) }}>
          {heroLoading || heroNA ? "" : `${arrow(combinedPnl)}${signed(combinedPnl)}`}
          {heroPct != null && !heroNA ? <span style={{ marginInlineStart: 5, fontSize: 12 }}>({pctStr(heroPct)})</span> : null}
        </span>
        {heroToday != null && !heroNA && (
          <span style={{ fontSize: 11.5, color: D.soft, fontFamily: MONO }}>{he ? "היום" : "today"} <b style={{ color: gl(heroToday) }}>{signed(heroToday)}</b></span>
        )}
      </div>
      {/* Clamp to 2 lines: this is the only elastic element in the (non-scrolling) hero, so bounding it
          keeps the card deterministically under the fixed cell height — no CTA spill after load. */}
      <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: 10.5, color: D.soft, marginTop: 4, lineHeight: 1.35 }}>
        {modeIsLive
          ? (he ? "יתרה אמיתית משולבת — כל החשבונות המחוברים (מנוע + טייסים). רווח סימולציה לא נכלל." : "Combined REAL balance — all connected accounts (engine + pilots). Simulated P&L is excluded.")
          : (he ? "רווח סימולציה משולב — מנוע + טייסים" : "Combined simulation P&L — Engine + Pilots")}
      </span>
      {/* Honest gap (never fabricated): an account's balance couldn't be read. (The pilots' invested
          capital is now included in the P&L base, so its balance no longer sits in the total untracked.) */}
      {modeIsLive && !heroLoading && acctFailed > 0 && (
        <span style={{ display: "block", fontSize: 9.5, color: D.faint, marginTop: 3, lineHeight: 1.4 }}>
          {he ? `${acctFailed} חשבון(ות) לא נטענו.` : `${acctFailed} account(s) couldn't load.`}
        </span>
      )}

      {/* PER-TOOL P&L, each on its own (Dan). In LIVE, sim tools (pilots/bots) render MUTED with a
          "not in total" note so they're visible but never read as a real-money gain/loss. */}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {pnlChip(TrendingUp, he ? "מנוע" : "Engine", enginePnl, modeIsLive ? (he ? "כסף אמיתי" : "real money") : (he ? "סימולציה" : "sim"), () => nav(exConn ? "/exchange?sec=funds" : "/exchange"))}
        {owner && pnlChip(Rocket, he ? "טייסים" : "Pilots", pilotPnl, `${modePilots.length} ${modeIsLive ? (he ? "חיים" : "live") : (he ? "סים" : "sim")}`, () => nav("/owners?tab=autopilots"), modeIsLive)}
        {pnlChip(Cpu, he ? "סיגנל בוט" : "Signal Bot", botsPnl, modeIsLive ? (he ? "סים · לא בסה\"כ" : "sim · not in total") : (he ? "לייב בלבד" : "live only"), () => nav("/bots"), true)}
      </div>

      {/* CTAs — real gated flows only. No card number, no transfer/withdraw. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginTop: "auto", paddingTop: 12 }}>
        <button onClick={() => nav("/exchange")} className="o7btn" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "11px 12px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
          <Link2 size={14} /> {exConn ? (he ? "הבורסה שלי" : "My Exchange") : (he ? "חבר בורסה" : "Connect")}
        </button>
        <button onClick={() => nav("/profit")} className="o7btn" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "11px 12px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
          <TrendingUp size={14} /> {he ? "התחל מסחר" : "Start trading"}
        </button>
      </div>
    </Card>
  );

  // CONNECTED EXCHANGES — status only, NEVER keys/secrets.
  const connectionsCard = (
    <Card hue="99,102,241">
      <Head Icon={Plug} title={he ? "בורסות מחוברות" : "Connected exchanges"}
        action={accounts.length ? linkAction(he ? "נהל" : "Manage", () => nav("/exchange")) : undefined} />
      {accounts.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: D.soft }}>{he ? "אין בורסה מחוברת עדיין." : "No exchange connected yet."}</span>
          <button onClick={() => nav("/exchange")} className="o7btn" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
            <Link2 size={14} /> {he ? "חבר בורסה" : "Connect"}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, ...listScroll(150) }}>
          {accounts.map((a) => {
            const isActive = a.id === activeId;
            const isLiveAcc = String(a.env || "").toLowerCase() === "live";
            return (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, background: D.chip, border: `1px solid ${isActive ? D.icon + "66" : D.line}`, borderRadius: RADIUS.md, padding: "8px 11px" }}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: D.gain }} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontWeight: 700, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.label || (he ? "חשבון" : "Account")}</span>
                  <span style={{ display: "block", fontSize: 10.5, color: D.soft, fontFamily: MONO }}>
                    {(a.name ? String(a.name).toUpperCase() : (he ? "בורסה" : "Exchange"))} · {isLiveAcc ? (he ? "לייב" : "LIVE") : (he ? "טסטנט" : "TEST")}
                  </span>
                </span>
                {isActive && <span style={{ fontSize: 10, fontWeight: 800, color: "#12131a", background: "rgba(255,255,255,0.9)", borderRadius: 999, padding: "2px 8px" }}>{he ? "פעיל" : "ACTIVE"}</span>}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );

  // ENGINE · OPEN POSITIONS (read-only) — mode-aware (live exchange / demo paper).
  const positionsCard = (
    <Card hue="59,130,246">
      <Head Icon={TrendingUp} pnl={enginePnl}
        title={<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{he ? "מנוע · פוזיציות" : "Engine · positions"}{engineOpenCount > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: D.soft }}>({engineOpenCount})</span>}</span>}
        action={linkAction(<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><History size={13} /> {he ? "היסטוריה" : "History"}</span>, () => nav("/activity"), ChevronRight)} />
      {modeIsLive && !exConn ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: D.soft }}>{he ? "חברו בורסה כדי לראות פוזיציות." : "Connect an exchange to see positions."}</span>
          <button onClick={() => nav("/exchange")} className="o7btn" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
            <Link2 size={14} /> {he ? "חבר בורסה" : "Connect"}
          </button>
        </div>
      ) : engineOpenCount === 0 ? (
        // Empty state CENTERED in the fixed cell (flex:1) so the card reads as intentional, not a void.
        <div style={{ flex: 1, minHeight: 80, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, textAlign: "center" }}>
          <Layers size={26} color={D.faint} />
          <span style={{ color: D.soft, fontSize: 12.5 }}>{he ? "אין פוזיציות פתוחות." : "No open positions right now."}</span>
        </div>
      ) : (
        // Plain VERTICAL-scroll list — NO overflowX:hidden and NO mask here (both were clipping the
        // per-row value at the inline-end edge in the RTL card: "+$2.63" showed as "2.63", cut worse
        // for longer numbers — Dan reproduced at ~1568px). A ~50px value never overflows a 3-col card,
        // so there is nothing to clip; overflow-y stays auto for tall lists. GENEROUS paddingInline (14)
        // + each row's own 11px inline padding = ~25px REAL clearance (BASE zoom) from the card's inner
        // edge to the value on BOTH sides — esp. the inline-END/left in RTL — so the value can never sit
        // tight to the edge even once html{zoom:1.15} scales it (~29px rendered). Dan kept seeing it
        // tight at his wide+zoom display; err on the side of too much space. The row layout below
        // (identity flex:1+truncate, value flex-shrink:0) guarantees the fit at any width.
        <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingInline: 14, paddingBlock: 1, ...listScroll(230) }}>
          {modeIsLive && futures.map((p, i) => {
            const u = Number(p.unrealizedPnl ?? p.unrealized ?? 0);
            const uPct = p.percentage != null ? Number(p.percentage) : null;
            const sz = Number(p.contracts ?? p.size ?? 0);
            const side = String(p.side || (sz >= 0 ? "long" : "short"));
            return (
              // Robust row: identity flex:1+minWidth:0 (truncates with ellipsis), values flex-shrink:0
              // (never squeezed) + dir="ltr" so the leading +/- sign in the number can't be bidi-reordered
              // into a chopped ".72+" inside the RTL card. Holds at ANY card width by construction.
              <div key={`f${i}`} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, background: D.chip, border: `1px solid ${D.line}`, borderRadius: RADIUS.md, padding: "8px 11px" }}>
                <span style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                  <span style={{ display: "block", fontWeight: 700, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.symbol} · {side.toUpperCase()}</span>
                  <span style={{ display: "block", fontFamily: MONO, fontSize: 10.5, color: D.soft, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{he ? "כניסה" : "entry"} {p.entryPrice ?? "—"} · {Math.abs(sz)}</span>
                </span>
                <span dir="ltr" style={{ flexShrink: 0, textAlign: "end", fontFamily: MONO, whiteSpace: "nowrap" }}>
                  <span style={{ display: "block", fontWeight: 800, fontSize: 12.5, color: gl(u) }}>{signed(u)}</span>
                  {uPct != null && <span style={{ display: "block", fontSize: 10.5, color: gl(uPct) }}>{pctStr(uPct)}</span>}
                </span>
              </div>
            );
          })}
          {(modeIsLive ? spotOpen : demoPositions).map((p, i) => {
            const base = String(p.asset || p.symbol || "").split("/")[0].toUpperCase();
            const pnl = p.pnl != null ? Number(p.pnl) : null;
            const pnlPct = p.pnlPct != null ? Number(p.pnlPct) : null;
            return (
              <div key={`s${i}`} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, background: D.chip, border: `1px solid ${D.line}`, borderRadius: RADIUS.md, padding: "8px 11px" }}>
                <CoinBadge base={base} size={28} />
                <span style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                  <span style={{ display: "block", fontWeight: 700, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{base}</span>
                  <span style={{ display: "block", fontSize: 10.5, color: D.soft, fontFamily: MONO, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.qty != null ? Number(p.qty).toPrecision(4) : "—"} · {money(p.value != null ? Number(p.value) : null)}</span>
                </span>
                <span dir="ltr" style={{ flexShrink: 0, textAlign: "end", fontFamily: MONO, whiteSpace: "nowrap" }}>
                  <span style={{ display: "block", fontWeight: 800, fontSize: 12, color: gl(pnl) }}>{pnl == null ? "—" : signed(pnl)}</span>
                  {pnlPct != null && <span style={{ display: "block", fontSize: 10.5, color: gl(pnlPct) }}>{pctStr(pnlPct)}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {/* The SAME confirmed close flow /profit uses (close-in-profit + close-all) — surfaced here.
          Shown only in LIVE view when there ARE open live positions to close; nothing closes
          without the user confirming (CloseButtons runs the shared closeProfitable/closeSpot +
          ConfirmModal). Read-only creds via the browser X-Exchange-* headers, exactly as before. */}
      {modeIsLive && spotOpen.length > 0 && <CloseButtons />}
    </Card>
  );

  // PILOTS (AutoPilots) — owner-only, READ-ONLY: active pilot runs + P&L. No controls.
  const pilotsCard = owner ? (
    <Card hue="168,85,247">
      <Head Icon={Rocket} pnl={pilotPnl}
        title={<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{he ? "טייסים" : "Pilots"}{pilotOpen > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: D.soft }}>({pilotOpen} {he ? "פתוחות" : "open"})</span>}</span>}
        action={linkAction(he ? "לצפייה" : "View", () => nav("/owners?tab=autopilots"))} />
      {pilotsQ.isLoading ? (
        <p style={{ color: D.soft, fontSize: 12.5, margin: 0 }}>…</p>
      ) : modePilots.length === 0 ? (
        <p style={{ color: D.soft, fontSize: 12.5, margin: 0 }}>{modeIsLive ? (he ? "אין טייסים במצב חי." : "No live-mode pilots.") : (he ? "אין ריצות סימולציה פעילות." : "No active sim runs.")}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, ...listScroll(210) }}>
          {modePilots.map((p) => {
            const isLiveP = pilotIsLive(p);
            const pv = pilotPnlOf(p);
            const cap = pilotCapOf(p);
            return (
              <div key={p.pilotId} style={{ display: "flex", alignItems: "center", gap: 10, background: D.chip, border: `1px solid ${D.line}`, borderRadius: RADIUS.md, padding: "8px 11px" }}>
                <Rocket size={15} color={D.icon} style={{ flexShrink: 0 }} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontWeight: 700, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{prettyPilot(p.pilotId)}</span>
                  <span style={{ display: "block", fontSize: 10.5, color: D.soft, fontFamily: MONO }}>
                    <span style={{ color: isLiveP ? D.loss : D.blue, fontWeight: 800 }}>{isLiveP ? (he ? "לייב" : "LIVE") : (he ? "סים" : "SIM")}</span>
                    {" · "}{pilotOpenOf(p)} {he ? "פתוחות" : "open"}{cap > 0 ? ` · ${he ? "הון" : "cap"} ${money(cap, 0)}` : ""}
                  </span>
                </span>
                <span style={{ textAlign: "end", fontFamily: MONO }}>
                  <span style={{ display: "block", fontWeight: 800, fontSize: 12.5, color: gl(pv) }}>{signed(pv)}</span>
                  {isLiveP && pv === 0 && <span style={{ display: "block", fontSize: 9.5, color: D.faint }}>{he ? "טרם בוצע" : "not executed"}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <span style={{ display: "block", fontSize: 10, color: D.faint, marginTop: "auto", paddingTop: 8 }}>{he ? "תצוגה בלבד · ניהול בלוח הבעלים" : "View only · manage in the Owners portal"}</span>
    </Card>
  ) : null;

  // SIGNAL BOT — read-only: active bots + P&L.
  const botsCard = (
    <Card hue="20,184,166">
      <Head Icon={Cpu} pnl={botsPnl}
        title={<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{he ? "סיגנל בוט" : "Signal Bot"}{bots.length > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: D.soft }}>({activeBots}/{bots.length})</span>}</span>}
        action={linkAction(he ? "כל הבוטים" : "All bots", () => nav("/bots"))} />
      {botsQ.isLoading ? (
        <p style={{ color: D.soft, fontSize: 12.5, margin: 0 }}>…</p>
      ) : bots.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: D.soft }}>{he ? "אין בוטים אוטומטיים עדיין." : "No automated bots yet."}</span>
          <button onClick={() => nav("/bots")} className="o7btn" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
            <Cpu size={14} /> {he ? "צור בוט" : "Create a bot"}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, ...listScroll(210) }}>
          {botOpen > 0 && <span style={{ fontSize: 10.5, color: D.soft, padding: "0 2px" }}>{botOpen} {he ? "פוזיציות פתוחות" : "open positions"}</span>}
          {bots.map((b) => {
            const active = (b.status || "active") === "active";
            const bp = b.pnl != null ? Number(b.pnl) : null;
            return (
              <div key={String(b.id)} style={{ display: "flex", alignItems: "center", gap: 10, background: D.chip, border: `1px solid ${D.line}`, borderRadius: RADIUS.md, padding: "8px 11px" }}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: active ? D.gain : "transparent", border: active ? "none" : `2px solid ${D.soft}`, boxSizing: "border-box" }} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontWeight: 700, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.label || `${he ? "בוט" : "Bot"} #${b.id}`}</span>
                  <span style={{ display: "block", fontSize: 10.5, color: D.soft, fontFamily: MONO }}>{String(b.exchange || "").toUpperCase()} · {b.market || "spot"}{b.openPositions ? ` · ${b.openPositions} ${he ? "פתוחות" : "open"}` : ""}</span>
                </span>
                <span style={{ textAlign: "end", fontFamily: MONO }}>
                  <span style={{ display: "block", fontWeight: 800, fontSize: 12.5, color: gl(bp) }}>{bp == null ? "—" : signed(bp)}</span>
                  <span style={{ display: "block", fontSize: 10, color: D.soft }}>{Number(b.trades || 0)} {he ? "עסקאות" : "trades"}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );

  // COIN HOLDINGS / WALLET BALANCES (read-only fetch_balance): totals + per-coin.
  const walletCard = (
    <Card hue="16,185,129">
      <Head Icon={Wallet} title={he ? "הארנק שלי" : "Your wallet"}
        action={exConn ? linkAction(he ? "כל הקרנות" : "All funds", () => nav("/exchange?sec=funds")) : undefined} />
      {!exConn ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: D.soft }}>{he ? "חברו בורסה כדי לראות יתרות." : "Connect an exchange to see balances."}</span>
          <button onClick={() => nav("/exchange")} className="o7btn" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
            <Link2 size={14} /> {he ? "חבר בורסה" : "Connect"}
          </button>
        </div>
      ) : (balQ.isLoading && !bal) ? (
        <p style={{ color: D.soft, fontSize: 12.5, margin: 0 }}>…</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 20, marginBottom: 11, flexWrap: "wrap" }}>
            <span><Eyebrow>{he ? "יתרה (USDT)" : "Funds (USDT)"}</Eyebrow><b style={{ fontFamily: MONO, fontSize: 14 }}>{money(walletFunds)}</b></span>
            <span><Eyebrow>{he ? "זמין" : "Available"}</Eyebrow><b style={{ fontFamily: MONO, fontSize: 14 }}>{money(walletAvail)}</b></span>
          </div>
          {coinRows.length === 0 ? (
            <p style={{ color: D.soft, fontSize: 12.5, margin: 0 }}>{he ? "אין אחזקות מטבע (רק USDT)." : "No coin holdings (USDT only)."}</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, ...listScroll(210) }}>
              {coinRows.map((b, i) => {
                const base = String(b.asset).toUpperCase();
                const m = posByAsset[base];
                const value = m && m.value != null ? Number(m.value) : null;
                const pnlPct = m && m.pnlPct != null ? Number(m.pnlPct) : null;
                return (
                  <button key={i} onClick={() => nav("/exchange?sec=funds")} className="tap44"
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "start", cursor: "pointer", fontFamily: "inherit",
                      background: "transparent", border: "1px solid transparent", borderRadius: 11, padding: "7px 9px", color: D.ink }}>
                    <CoinBadge base={base} size={28} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontWeight: 700, fontSize: 12.5 }}>{base}</span>
                      <span style={{ display: "block", fontSize: 10.5, color: D.soft, fontFamily: MONO }}>{Number(b.total).toPrecision(4)}</span>
                    </span>
                    <span style={{ textAlign: "end", fontFamily: MONO }}>
                      <span style={{ display: "block", fontWeight: 800, fontSize: 12.5 }}>{value != null ? money(value) : "—"}</span>
                      {pnlPct != null && <span style={{ display: "block", fontSize: 10.5, color: gl(pnlPct) }}>{pctStr(pnlPct)}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </Card>
  );

  // TRADING TOOLS — illustrative convert visual that routes into the REAL gated Exchange.
  const toolsCard = (
    <Card hue="244,63,94">
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 800, color: D.ink, marginBottom: 3 }}>
        <ArrowRightLeft size={15} color={D.icon} /> {he ? "כלי מסחר" : "Trading tools"}
      </span>
      <p style={{ margin: "5px 2px 12px", fontSize: 11.5, color: D.soft, lineHeight: 1.5 }}>
        {he ? "המרה ומסחר מתבצעים במסך הבורסה המאובטח." : "Convert & trade happen on the secure Exchange screen."}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <div style={{ flex: 1, background: D.chip, border: `1px solid ${D.line}`, borderRadius: 11, padding: "9px 11px" }}>
          <Eyebrow>{he ? "מ־" : "From"}</Eyebrow>
          <span style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 5 }}><CoinBadge base="USDT" size={24} /> <b style={{ fontSize: 12.5 }}>USDT</b></span>
        </div>
        <span aria-hidden style={{ flexShrink: 0, width: 32, height: 32, borderRadius: "50%", background: `${D.icon}18`, border: `1px solid ${D.icon}55`, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <ArrowRightLeft size={14} color={D.icon} />
        </span>
        <div style={{ flex: 1, background: D.chip, border: `1px solid ${D.line}`, borderRadius: 11, padding: "9px 11px" }}>
          <Eyebrow>{he ? "ל־" : "To"}</Eyebrow>
          <span style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 5 }}><CoinBadge base={selBase} size={24} /> <b style={{ fontSize: 12.5 }}>{selBase}</b></span>
        </div>
      </div>
      <button onClick={() => nav("/exchange")} className="o7btn" style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "11px", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", marginTop: "auto", paddingTop: 11 }}>
        <ExternalLink size={15} /> {exConn ? (he ? "פתח בורסה" : "Open Exchange") : (he ? "חבר וסחר" : "Connect & trade")}
      </button>
    </Card>
  );

  return (
    // .o7dash paints the dashboard's OWN dedicated LIGHT surface (skin-independent — stays light
    // even on dark skins). It's a rounded light board; the coloured glass cards sit on it. Default
    // ink is dark (for the header on the bare light surface); card content overrides to white.
    <div className="o7dash" style={{ direction: rtl ? "rtl" : "ltr", fontFamily: UI, color: D.onLight, display: "flex", flexDirection: "column", gap: mobile ? 12 : 14, minHeight: 0, borderRadius: 24, padding: mobile ? "16px 14px" : "22px 22px 26px" }}>
      {/* Standard framed-title structure (FramedTitle-style), light-adapted via our glass frame. */}
      <DashTitle text={t.dashboard} mobile={mobile}
        subtitle={he ? "כל התיק במבט אחד · מנוע · טייסים · סיגנל בוט" : "Your whole portfolio at a glance · Engine · Pilots · Signal Bot"} />

      {marketStrip}

      {/* TIDY 3-COLUMN GLASS GRID — FIXED-HEIGHT rows (grid-auto-rows: ROW_H): every cell is EXACTLY
          ROW_H tall regardless of how much data has loaded, so the grid looks IDENTICAL before and
          after balances/positions/pilots/holdings arrive — no reflow/jump, no overhang (Dan: "a
          precise bound that holds after loading"). Each card fills its fixed cell; its internal list
          flex-fills + scrolls (listScroll), so a 10-row list scrolls inside instead of growing the
          card. Footers/actions sit at the bottom. Last card spans the incomplete last row.
          Mobile stacks in one clean column (natural heights). */}
      {(() => {
        const cards = [portfolioCard, positionsCard, ...(owner ? [pilotsCard] : []), botsCard, walletCard, connectionsCard, toolsCard].filter(Boolean);
        if (mobile) {
          return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{cards.map((card, i) => <React.Fragment key={i}>{card}</React.Fragment>)}</div>;
        }
        const n = cards.length;
        const rem = n % 3;   // items in the last row (0 = full)
        const ROW_H = 324;   // fixed cell height — load-independent (equal for every cell). Raised 300→324
                             // so the ENGINE POSITIONS card fits header + ~4 whole rows + the close-buttons
                             // footer with no half-clipped row (at 300 the list got only ~194px → 4 spot
                             // rows need ~205px, so the 4th was cut — Dan, wide/zoom 1.15). Also comfortably
                             // clears the portfolio hero (~284px). List cards fill it + scroll internally.
        return (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16, gridAutoRows: `${ROW_H}px`, alignItems: "stretch" }}>
            {cards.map((card, i) => {
              // Only the LAST card spans, filling the incomplete last row (rem 1 → span 3, rem 2 → span 2).
              const span = (i === n - 1 && rem !== 0) ? 4 - rem : 1;
              // display:grid on the wrapper → the card stretches to fill the (equal-height) cell.
              return (
                <div key={i} style={{ display: "grid", minWidth: 0, ...(span > 1 ? { gridColumn: `span ${span}` } : {}) }}>
                  {card}
                </div>
              );
            })}
          </div>
        );
      })()}

      <Spin />
    </div>
  );
}
