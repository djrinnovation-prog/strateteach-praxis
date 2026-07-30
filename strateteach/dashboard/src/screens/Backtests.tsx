import React, { useMemo, useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Play, Loader2, Trash2, Download, ChevronRight, ChevronLeft, ChevronDown, History, ShieldCheck, Diamond, Save, Microscope, Calendar, BarChart3 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ScreenShortcuts from "../components/ScreenShortcuts";
import { ErrorState } from "../components/StateBlock";
import { track, ev, durationBucket } from "../lib/analytics";
import { api, isAdmin, isOwner } from "../app/api";
import { strategyLabel, isStrategyVisible, visibleBuiltinBots } from "../lib/builtinBots";
import { useI18n } from "../i18n";
import { C, UI, MONO, SHADOW } from "../theme";
import { ExportBar } from "../ui";
import { HubPanel } from "../components/HubScreen";
import FramedTitle from "../components/FramedTitle";
import { GlassTile, TileGrid, homeDim } from "../components/GlassTile";
import SquareRow from "../components/SquareRow";
import { centralExtras } from "../lib/centralExtras";
import ScreenBottom from "../components/ScreenBottom";
import { useViewMode, ViewToggle } from "../components/ViewToggle";
import { useIsMobile } from "../lib/useIsMobile";
import HomeTop from "../components/HomeTop";
import TradingViewChart from "../components/TradingViewChart";
import TradesPanel from "../components/TradesPanel";
import { Search, TrendingUp, Activity } from "lucide-react";
import type { BacktestResult, Run } from "../lib/types";

const BUCKETS = ["crypto", "stocks", "metals", "commodities"] as const;
const STRATS = ["bot8c", "bot4", "bot1"] as const;

const BT = {
  he: { start: "מתאריך", end: "עד תאריך", addStrat: "הוסף אסטרטגיה (Pine)", check: "בדוק", loaded: "נטענה ✓", paste: "הדביקו קוד Pine…" },
  en: { start: "From date", end: "To date", addStrat: "Add strategy (Pine)", check: "Check", loaded: "Loaded ✓", paste: "Paste Pine script…" },
};

export default function Backtests() {
  const { t, rtl, lang } = useI18n();
  const he = lang === "he";
  const b = BT[lang];
  const qc = useQueryClient();
  const nav = useNavigate();
  const mobile = useIsMobile();
  const [name, setName] = useState("");
  const [buckets, setBuckets] = useState<string[]>(["crypto"]);
  const [strat, setStrat] = useState<string>("bot8c");
  const [limit, setLimit] = useState<number>(100); // per-bucket cap. Crypto is fast; equities (yfinance) are rate-limited, so keep modest.
  const [startDate, setStartDate] = useState(""); const [endDate, setEndDate] = useState("");
  const [pine, setPine] = useState(""); const [pineConfig, setPineConfig] = useState<any>(null); const [showPine, setShowPine] = useState(false);
  const [selRun, setSelRun] = useState<Run | null>(null);
  const [selSym, setSelSym] = useState<string | null>(null);
  const [oneSymbol, setOneSymbol] = useState(""); // "" = all symbols; else one picked symbol (single-symbol mode)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set()); // runs the user explicitly saved this session
  const [sort, setSort] = useState<{ by: keyof BacktestResult; dir: "asc" | "desc" }>({ by: "cagr", dir: "desc" });
  const [tab, setTab] = useState<string>("all");
  const [err, setErr] = useState("");
  const [runsHistOpen, setRunsHistOpen] = useState(false); // past runs list: collapsed by default
  // URL-driven child navigation (Back returns to the launcher) — the finalized model.
  // `bsec`/`setBsec` are ALIASED to the ?sec= URL param so every existing `bsec === …`
  // + `setBsec(…)` call site keeps working unchanged; default = "" (launcher).
  const [sp, setSp] = useSearchParams();
  const bsec = sp.get("sec") || "";
  const setBsec = (v: string) => setSp(v ? { sec: v } : {});
  const [moreView, setMoreView] = useViewMode("algo770_backtests_more_view_v1", "cards");
  const formRef = useRef<HTMLDivElement>(null);
  const runsRef = useRef<HTMLDivElement>(null);
  const scrollTo = (r: React.RefObject<HTMLDivElement>) => setTimeout(() => r.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  const [exOpen, setExOpen] = useState(true); // example trades demo: open by default so the feature shows on arrival

  const runsQ = useQuery({ queryKey: ["runs"], queryFn: () => api.listRuns(), refetchInterval: 4000 });
  const savedQ = useQuery({ queryKey: ["savedStrategies"], queryFn: () => api.savedStrategies() });
  const saved = (savedQ.data || []) as any[];
  const meQ = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  const myUser = (meQ.data as any)?.username;
  const mainAdmin = isOwner();
  // Same admin flag used app-wide: regular users see only strategy 1 & 8.
  const admin = isAdmin();
  const visBots = visibleBuiltinBots(isOwner());
  const visStrats = STRATS.filter((s) => isStrategyVisible(s, isOwner()));
  // Single-symbol picker: the universe comes from the SAME source the run/scan use
  // (get_all_symbols_for_run → /symbols/{bucket}), bounded so the dropdown is light.
  // It reflects the first selected bucket; switching buckets resets the picked symbol.
  const symBucket = buckets[0] || "crypto";
  const symUniverseQ = useQuery({ queryKey: ["symUniverse", symBucket], queryFn: () => api.symbols(symBucket, 300), enabled: !!symBucket && bsec === "new" });
  const symUniverse = (symUniverseQ.data as { symbol: string; name: string }[] | undefined) || [];
  React.useEffect(() => { setOneSymbol(""); }, [symBucket]);
  // A run counts as saved if persisted server-side (run.saved) or saved this session.
  const isSaved = (r: Run | null) => !!r && (savedIds.has(r.id) || !!(r as any).saved);
  // Load a saved strategy INTO THE RUN (parsed config only). We intentionally do
  // NOT copy its pineSource into the editor: real strategy code must never auto-fill
  // the default Pine box — it appears only when the user explicitly pastes/opens it.
  const loadSaved = (s: any) => { const c = s?.config || {}; setStrat(c.strategyId || "bot8c"); setPineConfig(c); };
  // Select a built-in 770 bot to backtest (engine accepts the preset id directly).
  const loadBuiltin = (id: string) => { setStrat(id); setPineConfig(null); };
  const runStartRef = useRef<number>(0);       // ms stamp of the current run's start (for duration bucket)
  const completedRunRef = useRef<string>("");  // guard: emit backtest_completed at most once per run
  const createM = useMutation({
    mutationFn: () => api.createRun(
      // Single-symbol mode runs only the picked symbol in its bucket; else all buckets.
      oneSymbol ? [symBucket] : buckets,
      { strategyId: strat, ...(pineConfig || {}), ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) } as any,
      Number(limit) || 1000, name.trim() || undefined,
      oneSymbol ? [oneSymbol] : undefined,
    ),
    onSuccess: (run: any) => {
      // Runs are ephemeral: discard the previously-viewed run if it was never saved,
      // then auto-open the new one (it isn't in the saved-only history list).
      const prev = selRun;
      if (prev && prev.id !== run.id && !isSaved(prev)) api.deleteRun(prev.id).catch(() => {});
      track("backtest_run", { source: oneSymbol ? "single" : "multi" });
      // Canonical: backtest_started (kind stays "other" — never the Pine source). Stamp
      // the start so backtest_completed can bucket the duration when the run terminates.
      runStartRef.current = Date.now();
      ev.backtestStarted("other");
      setName(""); setSelSym(null); setSelRun(run); qc.invalidateQueries({ queryKey: ["runs"] });
    },
    onError: (e: any) => { ev.validationErrorSeen("backtest", "run_start_failed"); setErr(e?.message || "Could not start run"); },
  });
  const parsePineM = useMutation({
    mutationFn: () => api.parsePine(pine),
    onSuccess: (c: any) => { setErr(""); setPineConfig(c); }, onError: (e: any) => setErr(e?.message || "Parse failed"),
  });
  const delM = useMutation({
    mutationFn: (id: string) => api.deleteRun(id),
    onSuccess: () => { setSelRun(null); qc.invalidateQueries({ queryKey: ["runs"] }); },
  });
  // Explicit "Save run": persist this ephemeral run into the saved history.
  const saveM = useMutation({
    mutationFn: (id: string) => api.saveRun(id),
    onSuccess: (r: any) => { setSavedIds((p) => new Set(p).add(r.id)); qc.invalidateQueries({ queryKey: ["runs"] }); },
    onError: (e: any) => setErr(e?.message || "Save failed"),
  });
  // Re-run a failed/cancelled backtest with the same buckets + strategy config.
  const rerunM = useMutation({
    mutationFn: (run: any) => api.createRun(run.buckets || ["crypto"], run.config || { strategyId: strat }, run.totalSymbols || undefined, run.name),
    onSuccess: (r: any) => { setErr(""); setSelSym(null); setSelRun(r); qc.invalidateQueries({ queryKey: ["runs"] }); },
    onError: (e: any) => setErr(e?.message || "Rerun failed"),
  });
  // Poll the selected run BY ID (works for the ephemeral run, which isn't in the
  // saved-only list). Stops once the run reaches a terminal state.
  const liveRunQ = useQuery({
    queryKey: ["run", selRun?.id],
    queryFn: () => api.getRun(selRun!.id),
    enabled: !!selRun,
    refetchInterval: (query: any) => {
      const s = (query?.state?.data as any)?.status;
      return (s === "completed" || s === "failed" || s === "cancelled") ? false : 2500;
    },
  });
  // Results refresh while the run is still in flight (we auto-open it immediately).
  const resultsQ = useQuery({
    queryKey: ["results", selRun?.id],
    queryFn: () => api.results(selRun!.id),
    enabled: !!selRun && !selSym,
    refetchInterval: () => {
      const s = (liveRunQ.data as any)?.status;
      return (s === "running" || s === "pending") ? 3000 : false;
    },
  });
  // Force one final results fetch the moment the run completes (the last polled
  // fetch can be up to a few seconds stale).
  React.useEffect(() => {
    const s = (liveRunQ.data as any)?.status;
    if (s === "completed" && selRun) qc.invalidateQueries({ queryKey: ["results", selRun.id] });
    // Canonical: backtest_completed once per run reaching a terminal state.
    if ((s === "completed" || s === "failed") && selRun && completedRunRef.current !== selRun.id) {
      completedRunRef.current = selRun.id;
      const elapsed = runStartRef.current ? Date.now() - runStartRef.current : 0;
      ev.backtestCompleted("other", durationBucket(elapsed));
    }
  }, [(liveRunQ.data as any)?.status]); // eslint-disable-line
  const detailQ = useQuery({ queryKey: ["detail", selRun?.id, selSym], queryFn: () => api.symbolDetail(selRun!.id, selSym!), enabled: !!selRun && !!selSym });

  const sorted = useMemo(() => {
    const rows = ((resultsQ.data as BacktestResult[]) || []).slice();
    rows.sort((a, b) => {
      const va = a[sort.by] as number, vb = b[sort.by] as number;
      return (sort.dir === "asc" ? 1 : -1) * ((va as number) - (vb as number));
    });
    return rows;
  }, [resultsQ.data, sort]);

  async function exportCsv(id: string) {
    try {
      const r: any = await api.exportCsv(id);
      const blob = new Blob([r.data], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = r.filename || "export.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setErr(e?.message || "Export failed"); }
  }

  const toggleBucket = (b: string) => setBuckets((p) => (p.includes(b) ? p.filter((x) => x !== b) : [...p, b]));
  const Back = rtl ? ChevronRight : ChevronLeft;

  // ── symbol detail ──
  if (selSym && selRun) {
    const d: any = detailQ.data;
    return (
      <div>
        <button onClick={() => setSelSym(null)} style={linkBtn(C)}><Back size={16} /> {t.results}</button>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: "12px 0 16px" }}>{selSym}</h1>
        {detailQ.isLoading ? <Empty C={C}><Loader2 size={16} className="spin" /> &nbsp;{t.loading}</Empty> : d ? (
          <>
            <Card C={C} title={t.equity}>
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={(d.equityCurve || []).map((p: any) => ({ date: p.date, value: p.value }))}>
                    <CartesianGrid stroke={C.line} strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke={C.faint} fontSize={11} tick={{ fill: C.muted }} />
                    <YAxis stroke={C.faint} fontSize={11} tick={{ fill: C.muted }} width={48} />
                    <Tooltip contentStyle={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, color: C.text }} />
                    <Line type="monotone" dataKey="value" stroke={C.gold} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
            {/* ACTUAL trades the strategy generated — full table + entry/exit
                markers on our own price chart (the TradingView embed is a closed
                iframe that can't take custom marks; see TradesPanel). */}
            <TradesPanel trades={(d.trades || []) as any} initialCapital={d.result?.initialCapital} rtl={rtl} lang={lang} />
          </>
        ) : <Empty C={C}>{t.noData}</Empty>}
        <Spin />
      </div>
    );
  }

  // ── results table ──
  if (selRun) {
    const liveRun = (liveRunQ.data as Run) || ((runsQ.data as Run[]) || []).find((r) => r.id === selRun.id) || selRun;
    const runSaved = isSaved(liveRun);
    const filtered = tab === "all" ? sorted : sorted.filter((r) => r.bucket === tab);
    const avg = (f: (r: BacktestResult) => number) => (filtered.length ? filtered.reduce((s, r) => s + f(r), 0) / filtered.length : 0);
    // "Best return" headline ignores flagged outliers so a degenerate blow-up
    // (e.g. +15,333% on a micro-priced coin) never becomes the showcased number.
    const best = filtered.reduce((m, r) => (!r.isReturnOutlier && r.totalReturn > m ? r.totalReturn : m), -Infinity);
    const K = lang === "he"
      ? { assets: "נכסים", avgRet: "תשואה שנתית ממוצעת", avgSharpe: "שארפ ממוצע", best: "תשואה הטובה ביותר", processing: "מעבד", of: "מתוך", failed: "נכשלו", all: "הכל" }
      : { assets: "Symbols", avgRet: "Avg annual return", avgSharpe: "Avg Sharpe", best: "Best return", processing: "Processing", of: "of", failed: "failed", all: "all" };
    const running = liveRun.status === "running" || liveRun.status === "pending";
    const done = liveRun.completedSymbols || 0, total = liveRun.totalSymbols || 0, fail = liveRun.failedSymbols || 0;
    const pct = total ? Math.min(100, Math.round(((done + fail) / total) * 100)) : 0;

    return (
      <div>
        <button onClick={() => { if (selRun && !runSaved) api.deleteRun(selRun.id).catch(() => {}); setSelRun(null); }} style={linkBtn(C)}><Back size={16} /> {t.backtests}</button>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "12px 0 16px", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{selRun.name || selRun.id.slice(0, 8)}</h1>
            <span style={statusPill(C, liveRun.status)}>{liveRun.status}</span>
            {!runSaved && <span style={{ fontSize: 11, color: C.faint }}>{lang === "he" ? "· לא נשמר" : "· not saved"}</span>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {/* Opt-in persistence: only a saved run is kept in history (others are discarded). */}
            <button onClick={() => saveM.mutate(selRun.id)} disabled={runSaved || saveM.isPending} style={btn(C, !runSaved)} title={runSaved ? "" : (lang === "he" ? "שמור את הריצה להיסטוריה" : "Keep this run in your history")}>
              {saveM.isPending ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {runSaved ? (lang === "he" ? "נשמר ✓" : "Saved ✓") : (lang === "he" ? "שמור ריצה" : "Save run")}
            </button>
            <ExportBar name="backtest" title={selRun.name || selRun.id.slice(0, 8)} rtl={rtl}
              headers={[t.asset, t.tier, t.ret, t.cagr, t.maxdd, t.winrate, t.sharpe, t.trades]}
              rows={filtered.map((r) => [r.symbol, (t as any)[r.bucket] || r.bucket, `${r.totalReturn.toFixed(1)}%`, `${r.cagr.toFixed(1)}%`, `${r.maxDrawdown.toFixed(1)}%`, `${r.winRate.toFixed(0)}%`, r.sharpe.toFixed(2), r.tradeCount])} />
            <button onClick={() => exportCsv(selRun.id)} style={btn(C)}><Download size={15} /> {t.excel}</button>
          </div>
        </div>
        {err && <div style={errBox(C)}>{err}</div>}

        {running && (
          <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, marginBottom: 14, boxShadow: SHADOW }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, marginBottom: 10 }}>
              <span style={{ color: C.gold, display: "inline-flex", alignItems: "center", gap: 7 }}><Loader2 size={14} className="spin" /> {K.processing}{liveRun.currentSymbol ? `: ${liveRun.currentSymbol}` : ""}</span>
              <span style={{ fontFamily: MONO, color: C.muted }}>{done} {K.of} {total || "…"}{fail ? ` · ${fail} ${K.failed}` : ""}</span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: C.surface2, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "var(--btn-bg)", transition: "width 0.4s" }} />
            </div>
          </div>
        )}

        {resultsQ.isLoading ? <Empty C={C}><Loader2 size={16} className="spin" /> &nbsp;{t.loading}</Empty>
          : sorted.length === 0 ? <Empty C={C}>{running ? `${t.running}…` : t.noResults}</Empty> : (
          <>
            {/* KPI cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 14 }}>
              <Kpi C={C} label={K.assets} value={String(filtered.length)} />
              <Kpi C={C} label={K.avgRet} value={`${avg((r) => r.cagr).toFixed(1)}%`} color={avg((r) => r.cagr) >= 0 ? C.gain : C.loss} />
              <Kpi C={C} label={K.avgSharpe} value={avg((r) => r.sharpe).toFixed(2)} color={C.gold} />
              <Kpi C={C} label={K.best} value={best > -Infinity ? `+${best.toFixed(1)}%` : "—"} color={C.gain} />
            </div>

            {/* category tabs */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {(["all", ...BUCKETS] as const).map((b) => (
                <button key={b} onClick={() => setTab(b)} style={pill(C, tab === b)}>{b === "all" ? K.all : (t as any)[b]}</button>
              ))}
            </div>

            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, overflowX: "auto", boxShadow: SHADOW }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead><tr>
                  <SortTh C={C} rtl={rtl} label={t.asset} />
                  <SortTh C={C} rtl={rtl} label={t.tier} />
                  {([["ret", "totalReturn"], ["cagr", "cagr"], ["maxdd", "maxDrawdown"], ["winrate", "winRate"], ["sharpe", "sharpe"], ["trades", "tradeCount"]] as const).map(([lbl, key]) => (
                    <SortTh key={key} C={C} rtl={rtl} label={(t as any)[lbl]} active={sort.by === key} dir={sort.dir}
                      onClick={() => setSort((s) => ({ by: key as any, dir: s.by === key && s.dir === "desc" ? "asc" : "desc" }))} />
                  ))}
                </tr></thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={r.symbol + i} onClick={() => setSelSym(r.symbol)} style={{ cursor: "pointer" }}>
                      <td style={td(C, rtl)}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><ChevronRight size={13} color={C.faint} style={{ transform: rtl ? "scaleX(-1)" : "none" }} /> <b>{r.symbol}</b>{(r.isReturnOutlier || r.isDrawdownOutlier) && <span style={outlierBadge(C)} title={lang === "he" ? "תוצאה חריגה (כנראה ארטיפקט נתונים) — לא נכללת ב״תשואה הטובה ביותר״" : "Outlier (likely a data artifact) — excluded from the “Best return” headline"}>{lang === "he" ? "חריג" : "outlier"}</span>}</span></td>
                      <td style={td(C, rtl)}><span style={bucketBadge(C, r.bucket)}>{(t as any)[r.bucket] || r.bucket}</span></td>
                      <td style={{ ...td(C, rtl), fontFamily: MONO, color: r.totalReturn >= 0 ? C.gain : C.loss, opacity: r.isReturnOutlier ? 0.55 : 1 }}>{r.totalReturn.toFixed(1)}%</td>
                      <td style={{ ...td(C, rtl), fontFamily: MONO, color: r.cagr >= 0 ? C.gain : C.loss }}>{r.cagr.toFixed(1)}%</td>
                      <td style={{ ...td(C, rtl), fontFamily: MONO, color: C.loss }}>{r.maxDrawdown.toFixed(1)}%</td>
                      <td style={{ ...td(C, rtl), fontFamily: MONO }}>{r.winRate.toFixed(0)}%</td>
                      <td style={{ ...td(C, rtl), fontFamily: MONO }}>{r.sharpe.toFixed(2)}</td>
                      <td style={{ ...td(C, rtl), fontFamily: MONO }}>{r.tradeCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <Spin />
      </div>
    );
  }

  // ── launcher + runs list ──
  const runs = (runsQ.data as Run[]) || [];
  return (
    <div style={{ direction: rtl ? "rtl" : "ltr", fontFamily: UI, color: C.text, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>

      {bsec === "" && (
        <>
          <FramedTitle variant="emboss" text={t.backtests} subtitle={runs.length
            ? (he ? `${runs.length} ריצות` : `${runs.length} runs`)
            : (he ? "בדיקות אסטרטגיה היסטוריות" : "Historical strategy backtests")} />

          {/* Editable top shortcuts — the "עוד במערכת" chip opens the More CHILD (not a modal). */}
          <ScreenShortcuts
            screenKey="backtests"
            defaultKeys={["strat", "range", "market", "results"]}
            onMore={() => setBsec("more")}
            catalog={[
              { key: "strat", label: he ? "אסטרטגיה" : "Strategy", Icon: Microscope, onClick: () => setBsec("new") },
              { key: "range", label: he ? "טווח" : "Range", Icon: Calendar, onClick: () => setBsec("new") },
              { key: "market", label: he ? "שוק" : "Market", Icon: BarChart3, onClick: () => setBsec("new") },
              { key: "results", label: he ? "תוצאות" : "Results", Icon: History, onClick: () => setBsec("runs") },
            ]}
          />

          {/* 2 central glass buttons — now EDITABLE via SquareRow (choose which appear + order +
              APPROVE + reset). The screen's own 2 are shown by default; the shared app-destinations
              pool is addable from the ✎ editor. */}
          <SquareRow screenKey="backtests-central" mobile={mobile} defaultShown={["run", "results"]}
            squares={[
              { id: "run", variant: "primary", Icon: Play, label: he ? "הרץ באקטסט" : "Run backtest", sub: he ? "בדיקה חדשה" : "new run", onClick: () => setBsec("new") },
              { id: "results", variant: "secondary", Icon: History, label: he ? "תוצאות" : "Results", sub: he ? "ריצות והיסטוריה" : "runs & history", onClick: () => setBsec("runs") },
              ...centralExtras(he, nav, { exclude: ["backtests"] }),
            ]} />
        </>
      )}

      {/* ── "עוד במערכת" CHILD — the backtest areas as a tile grid with a rows/tiles toggle. ── */}
      {bsec === "more" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FramedTitle text={he ? "עוד במערכת" : "More"} subtitle={he ? "כל אזורי הבדיקות" : "All backtest areas"} />
          <div style={{ display: "flex", justifyContent: "flex-end", margin: "2px 2px 0" }}>
            <ViewToggle view={moreView} onChange={setMoreView} he={he} />
          </div>
          <TileGrid screenKey="backtests-more" view={moreView} columns={3} aspect={1.08} tiles={[
            { id: "new", label: he ? "הרץ באקטסט" : "Run backtest", Icon: Play, onClick: () => setBsec("new") },
            { id: "runs", label: he ? "תוצאות וריצות" : "Runs & results", Icon: History, onClick: () => setBsec("runs") },
            { id: "strategy", label: he ? "מעבדת אסטרטגיות" : "Strategy Lab", Icon: Microscope, onClick: () => nav("/strategy") },
            { id: "scan", label: he ? "סריקה יומית" : "Daily scan", Icon: Search, onClick: () => nav("/scanner") },
            { id: "engine", label: he ? "מנוע מסחר" : "Trading Engine", Icon: TrendingUp, onClick: () => nav("/profit") },
            { id: "activity", label: he ? "יומן פעילות" : "Activity", Icon: Activity, onClick: () => nav("/activity") },
          ]} />
        </div>
      )}

      <div ref={formRef} aria-hidden style={{ scrollMarginTop: 8 }} />
      {bsec === "new" && (
      <HubPanel ns="backtests" id="new" title={t.newBacktest} icon={<Play size={15} />} onClose={() => setBsec("")}>
        {/* P&L card + live TradingView view + the worked "Example" trades demo — moved here
            from the old always-on landing so they lead the run form (nothing removed). */}
        <HomeTop />
        <TradingViewChart symbol={oneSymbol ? `BINANCE:${oneSymbol.replace("/", "").toUpperCase()}` : "BINANCE:BTCUSDT"} />
        <div style={{ fontSize: 11.5, color: C.faint, margin: "-6px 2px 14px", lineHeight: 1.5 }}>
          {he
            ? "מסך המסחר למעלה הוא תצוגת TradingView חיה. סימוני הכניסה/יציאה של הבדיקה מצוירים על גרף ״עסקאות על המחיר״ שבתוצאות כל ריצה — ראו דוגמה למטה."
            : "The screen above is a live TradingView view. Your backtest's entry/exit markers are drawn on the “Trades on price” chart inside each run's results — see the example below."}
        </div>
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, marginBottom: 14, boxShadow: SHADOW }}>
          <button onClick={() => setExOpen((v) => !v)} aria-expanded={exOpen}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: 0, color: C.text, fontFamily: "inherit", textAlign: rtl ? "right" : "left" }}>
            <Diamond size={15} color={C.gold} fill={C.gold} />
            <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{he ? "דוגמה — עסקאות וסימונים על הגרף" : "Example — trades & chart markers"}</span>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase", color: C.gold, background: `${C.gold}1a`, border: `1px solid ${C.gold}40`, padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap" }}>{he ? "לדוגמה" : "sample"}</span>
            {exOpen ? <ChevronDown size={16} color={C.muted} /> : (rtl ? <ChevronLeft size={16} color={C.muted} /> : <ChevronRight size={16} color={C.muted} />)}
          </button>
          {exOpen && <div style={{ marginTop: 12 }}><TradesPanel trades={EXAMPLE_TRADES as any} initialCapital={1000} rtl={rtl} lang={lang} /></div>}
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.runName} style={input(C)} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
          {(() => {
            // "All assets" — run the backtest across EVERY asset class at once.
            const allOn = BUCKETS.every((x) => buckets.includes(x));
            return <button onClick={() => setBuckets(allOn ? [] : [...BUCKETS])} style={pill(C, allOn)}>{lang === "he" ? "כל הנכסים" : "All assets"}</button>;
          })()}
          {BUCKETS.map((b) => {
            const on = buckets.includes(b);
            return <button key={b} onClick={() => toggleBucket(b)} style={pill(C, on)}>{(t as any)[b]}</button>;
          })}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 11.5, color: C.muted }}>{lang === "he" ? "האסטרטגיות שלך:" : "Your strategies:"}</span>
          {/* Built-in 770 bots — selectable presets the engine runs directly. Regular
              users see only strategy 1 & 8; admins see all (visBots is gated). */}
          {visBots.map((bot) => (
            <button key={bot.id} onClick={() => loadBuiltin(bot.id)} style={pill(C, !pineConfig && strat === bot.id)} title={bot.desc[lang]}>
              <ShieldCheck size={11} /> {strategyLabel(bot.id, lang)} <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.7 }}>{lang === "he" ? "מובנה" : "built-in"}</span>
            </button>
          ))}
          {saved.map((s) => {
            const otherOwner = !!s?.owner && s.owner !== myUser; // main-admin cross-view
            return (
              <button key={s.id} onClick={() => loadSaved(s)} style={pill(C, false)} title={otherOwner ? (lang === "he" ? `בעלים: ${s.owner}` : `owner: ${s.owner}`) : (lang === "he" ? "טען אסטרטגיה לריצה" : "Load strategy into the run")}>
                {s.name && s.name !== "Strategy" ? s.name : `${strategyLabel(s.config?.strategyId || s.strategyId || "770", lang)} #${s.id}`}
                {otherOwner && <span style={{ fontSize: 9, color: C.faint, marginInlineStart: 5 }}>{lang === "he" ? `· ${s.owner}` : `· ${s.owner}`}</span>}
              </button>
            );
          })}
        </div>
        {mainAdmin && saved.some((s) => s?.owner && s.owner !== myUser) && (
          <div style={{ fontSize: 11, color: C.faint, marginTop: -4, marginBottom: 12 }}>{lang === "he" ? "אסטרטגיות עם תווית בעלים שייכות למשתמשים אחרים — להרצה בלבד." : "Strategies tagged with an owner belong to other users — run-only."}</div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <select value={pineConfig ? "pine" : strat} onChange={(e) => { if (e.target.value !== "pine") { setStrat(e.target.value); setPineConfig(null); } }} style={{ ...input(C), width: "auto" }}>
            {visStrats.map((s) => <option key={s} value={s}>{strategyLabel(s, lang)}</option>)}
            {pineConfig && <option value="pine">Pine ✓</option>}
          </select>
          <label style={{ display: "inline-flex", flexDirection: "column", gap: 3, fontSize: 11, color: C.muted }}>
            {b.start}
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ ...input(C), width: 150 }} />
          </label>
          <label style={{ display: "inline-flex", flexDirection: "column", gap: 3, fontSize: 11, color: C.muted }}>
            {b.end}
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ ...input(C), width: 150 }} />
          </label>
          <label style={{ display: "inline-flex", flexDirection: "column", gap: 3, fontSize: 11, color: C.muted, opacity: oneSymbol ? 0.45 : 1 }}>
            {t.maxAssets}
            <input type="number" min={1} max={1000} value={limit} disabled={!!oneSymbol} onChange={(e) => setLimit(Number(e.target.value))} style={{ ...input(C), width: 92 }} />
          </label>
          {/* Single-symbol mode: "All symbols" or pick exactly one from the universe. */}
          <label style={{ display: "inline-flex", flexDirection: "column", gap: 3, fontSize: 11, color: C.muted }}>
            {lang === "he" ? "סמל" : "Symbol"}
            <select value={oneSymbol} onChange={(e) => setOneSymbol(e.target.value)} style={{ ...input(C), width: "auto", minWidth: 150, maxWidth: 220 }} title={lang === "he" ? `מתוך ${(t as any)[symBucket] || symBucket}` : `from ${(t as any)[symBucket] || symBucket}`}>
              <option value="">{lang === "he" ? "כל הסמלים" : "All symbols"}</option>
              {symUniverse.map((s) => <option key={s.symbol} value={s.symbol}>{s.symbol}{s.name ? ` — ${s.name}` : ""}</option>)}
            </select>
          </label>
          <button onClick={() => { setErr(""); createM.mutate(); }} disabled={createM.isPending || (!buckets.length && !oneSymbol)} style={{ ...btn(C, true), alignSelf: "flex-end" }}>
            {createM.isPending ? <Loader2 size={15} className="spin" /> : <Play size={15} />} {createM.isPending ? t.running : t.run}
          </button>
        </div>

        {/* Add a strategy by pasting Pine (quick check) */}
        <div style={{ marginTop: 12, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
          <button onClick={() => setShowPine((s) => !s)} style={{ ...btn(C), fontSize: 12 }}>{showPine ? "▾" : "▸"} {b.addStrat}</button>
          {showPine && (
            <div style={{ marginTop: 10 }}>
              <textarea value={pine} onChange={(e) => setPine(e.target.value)} placeholder={b.paste} spellCheck={false}
                style={{ ...input(C), fontFamily: MONO, minHeight: 90, resize: "vertical", direction: "ltr", textAlign: "left" }} />
              <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                <button onClick={() => { setErr(""); parsePineM.mutate(); }} disabled={!pine.trim() || parsePineM.isPending} style={btn(C)}>
                  {parsePineM.isPending ? <Loader2 size={14} className="spin" /> : null} {b.check}
                </button>
                {pineConfig && <span style={{ fontSize: 12, color: C.gain }}>{b.loaded}</span>}
              </div>
            </div>
          )}
        </div>
      </HubPanel>
      )}

      {err && <div style={errBox(C)}>{err}</div>}

      <div ref={runsRef} aria-hidden style={{ scrollMarginTop: 8 }} />
      {bsec === "runs" && (
      <HubPanel ns="backtests" id="runs" title={lang === "he" ? "ריצות" : "Runs"} icon={<History size={15} />} onClose={() => setBsec("")}>
      {runsQ.isError ? (
        <ErrorState onRetry={() => runsQ.refetch()} retrying={runsQ.isFetching} screen="backtests"
          title={lang === "he" ? "לא הצלחנו לטעון את הריצות" : "Couldn't load your runs"} />
      ) : runs.length === 0 ? <Empty C={C}>{t.noRuns}</Empty> : (
        <div>
          <button onClick={() => setRunsHistOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", color: C.text, fontSize: 14, fontWeight: 700, padding: "4px 0 10px", width: "100%", textAlign: "start" }}>
            {runsHistOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />} {lang === "he" ? "ריצות אחרונות" : "Runs"}
            <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 500 }}>· {runs.length}{!runsHistOpen && runs[0] ? ` · ${lang === "he" ? "האחרונה" : "latest"}: ${runs[0].name || runs[0].id.slice(0, 8)} (${runs[0].status})` : ""}</span>
          </button>
          {runsHistOpen && (
          <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, overflowX: "hidden", overflowY: "auto", maxHeight: "58svh", boxShadow: SHADOW }}>
          {runs.map((run, i) => (
            <div key={run.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: i === runs.length - 1 ? "none" : `1px solid ${C.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{run.name || run.id.slice(0, 8)}</div>
                <div style={{ fontSize: 12, color: C.muted }}>{(run.buckets || []).join(", ")} · {progress(run)}</div>
                {(run.status === "failed" || run.status === "cancelled") && (run as any).errorMessage && (
                  <div style={{ fontSize: 11, color: C.loss, marginTop: 4 }}>{(run as any).errorMessage}</div>
                )}
                {(run.status === "running" || run.status === "pending") && (() => {
                  const d = run.completedSymbols || 0, total = run.totalSymbols || 0;
                  const pct = total ? Math.min(100, Math.round((d / total) * 100)) : 0;
                  return (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                      <div style={{ flex: 1, height: 5, borderRadius: 5, background: C.surface2, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: "var(--btn-bg)", transition: "width .5s ease" }} />
                      </div>
                      <span style={{ fontSize: 11, color: C.gold, fontFamily: MONO, flexShrink: 0 }}>{pct}%</span>
                    </div>
                  );
                })()}
              </div>
              <span style={statusPill(C, run.status)}>{run.status}</span>
              {run.status === "completed" && <button onClick={() => setSelRun(run)} style={btn(C)}>{t.viewResults}</button>}
              {(run.status === "failed" || run.status === "cancelled") && (
                <button onClick={() => rerunM.mutate(run)} disabled={rerunM.isPending} style={btn(C, true)}>
                  <Play size={13} /> {lang === "he" ? "הרץ שוב" : "Rerun"}
                </button>
              )}
              <button onClick={() => { const r = run.status === "running" || run.status === "pending"; if (confirm(r ? (lang === "he" ? "לבטל את הריצה הזו?" : "Cancel this run?") : t.confirmDelete)) delM.mutate(run.id); }}
                title={run.status === "running" || run.status === "pending" ? (lang === "he" ? "בטל ריצה" : "Cancel run") : (lang === "he" ? "מחק" : "Delete")} style={iconBtn(C)}><Trash2 size={15} /></button>
            </div>
          ))}
          </div>
          )}
        </div>
      )}
      </HubPanel>
      )}
      {/* Persistent bottom cluster (like Home): live/demo P&L + Help-Portal, above the tab bar. */}
      <ScreenBottom />
      <Spin />
    </div>
  );
}

/* ── helpers ── */
// Illustrative trade set for the landing "Example" card — a handful of realistic
// BTC long/short trades (wins, losses, and one still open) so the trades table +
// chart markers are populated the moment Backtest opens, before any real run. The
// shape matches the live `Trade` model, so the SAME TradesPanel renders it.
const EXAMPLE_TRADES = [
  { entryDate: "2023-01-12", exitDate: "2023-03-20", side: "LONG", entryPrice: 18900, exitPrice: 27750, returnPct: 46.8, pnl: 468.0, qty: 0.0529 },
  { entryDate: "2023-04-19", exitDate: "2023-05-11", side: "SHORT", entryPrice: 30200, exitPrice: 27600, returnPct: 8.6, pnl: 126.3, qty: 0.0526 },
  { entryDate: "2023-06-21", exitDate: "2023-08-17", side: "LONG", entryPrice: 30050, exitPrice: 26450, returnPct: -12.0, pnl: -190.6, qty: 0.0529 },
  { entryDate: "2023-10-23", exitDate: "2024-01-08", side: "LONG", entryPrice: 33000, exitPrice: 46800, returnPct: 41.6, pnl: 580.4, qty: 0.0424 },
  { entryDate: "2024-03-14", exitDate: "2024-05-01", side: "SHORT", entryPrice: 71500, exitPrice: 58200, returnPct: 18.4, pnl: 364.1, qty: 0.0277 },
  { entryDate: "2024-10-15", exitDate: null, side: "LONG", entryPrice: 67000, exitPrice: null, returnPct: null, pnl: null, qty: 0.0353 },
];

function progress(run: Run) {
  const d = run.completedSymbols || 0, total = run.totalSymbols || 0, f = run.failedSymbols || 0;
  if (run.status === "completed") return `${d} symbols`;
  if (run.status === "running") return `${d}${total ? ` / ${total}` : ""}${f ? `, ${f} failed` : ""}`;
  return run.status;
}
const td = (C: any, rtl: boolean): React.CSSProperties => ({ padding: "11px 12px", borderBottom: `1px solid ${C.line}`, textAlign: rtl ? "right" : "left" });
const input = (C: any): React.CSSProperties => ({ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", color: C.text, fontSize: 14, fontFamily: UI, outline: "none", width: "100%" });
// Premium toggle chip — skin-accent (no hardcoded orange), tile-family radius, a
// 1.5px accent border when on + a soft inner top-highlight. whiteSpace:nowrap keeps
// bucket/strategy labels ("commodities" / "סחורות", "All assets" / "כל הנכסים") on
// one line; built-in bot pills wrap their icon+name via the flex centering.
const pill = (C: any, on: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  background: on ? `${C.gold}1f` : `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
  border: `1.5px solid ${on ? C.gold : C.line}`, color: on ? C.text : C.muted,
  borderRadius: 999, padding: "6px 14px", fontSize: 13, fontFamily: UI, fontWeight: on ? 700 : 600,
  whiteSpace: "nowrap", cursor: "pointer",
  boxShadow: on ? "inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px -12px rgba(0,0,0,0.35)" : "inset 0 1px 0 rgba(255,255,255,0.20)",
});
// Premium button — primary keeps the skin --btn-* fill; secondary is the soft
// surface-gradient finish. Tile-family radius + 1.5px border + soft depth. Labels
// ("View results" / "צפה בתוצאות", "Rerun" / "הרץ שוב") stay on one line, centered.
const btn = (C: any, primary = false): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
  background: primary ? "var(--btn-bg)" : `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
  border: `1.5px solid ${primary ? "var(--btn-bd)" : C.gold}`, color: primary ? "var(--btn-ink)" : C.text,
  borderRadius: 12, padding: "8px 14px", fontSize: 13, fontFamily: UI, fontWeight: primary ? 800 : 700,
  whiteSpace: "nowrap", cursor: "pointer",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -10px 20px -14px rgba(0,0,0,0.30), 0 8px 20px -13px rgba(0,0,0,0.30)",
});
const iconBtn = (C: any): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", background: C.surface2, border: `1px solid ${C.line}`, color: C.loss, borderRadius: 10, padding: "8px", cursor: "pointer", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22)" });
const linkBtn = (C: any): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", color: C.muted, cursor: "pointer", fontFamily: UI, fontSize: 13, padding: 0 });
const statusPill = (C: any, s: string): React.CSSProperties => {
  const map: Record<string, string> = { completed: C.gain, running: C.gold, failed: C.loss, pending: C.muted, cancelled: C.faint };
  const c = map[s] || C.muted;
  return { fontSize: 12, color: c, background: `${c}22`, border: `1px solid ${c}55`, padding: "4px 10px", borderRadius: 8 };
};
const errBox = (C: any): React.CSSProperties => ({ background: `${C.loss}1f`, border: `1px solid ${C.loss}66`, color: C.loss, borderRadius: 9, padding: "9px 12px", fontSize: 13, margin: "12px 0", fontFamily: MONO });
function Card({ C, title, children }: any) {
  return <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, marginBottom: 14, boxShadow: SHADOW }}><div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{title}</div>{children}</div>;
}
function Kpi({ C, label, value, color }: any) {
  return <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 16px", boxShadow: SHADOW }}>
    <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: MONO, color: color || C.text }}>{value}</div>
  </div>;
}
const bucketBadge = (C: any, bucket: string): React.CSSProperties => {
  const map: Record<string, string> = { crypto: C.blue, metals: C.gold, stocks: C.gain, commodities: C.accent };
  const c = map[bucket] || C.muted;
  return { fontSize: 11, fontWeight: 600, color: c, background: `${c}1a`, border: `1px solid ${c}33`, padding: "2px 8px", borderRadius: 6 };
};
// Small amber "outlier" chip on a flagged row — the result stays visible (and the
// row is still clickable), it's just marked as implausible and kept out of the
// "Best return" headline. Mirrors the bucketBadge look in a warning hue.
const outlierBadge = (C: any): React.CSSProperties => ({
  fontSize: 9.5, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase",
  color: C.gold, background: `${C.gold}24`, border: `1px solid ${C.gold}66`,
  padding: "1px 6px", borderRadius: 999, whiteSpace: "nowrap",
});
function Empty({ children, C }: any) {
  return <div style={{ background: C.surface, border: `1px dashed ${C.line}`, borderRadius: 12, padding: 32, textAlign: "center", color: C.muted, display: "flex", alignItems: "center", justifyContent: "center" }}>{children}</div>;
}
function SortTh({ C, rtl, label, active, dir, onClick }: any) {
  return <th onClick={onClick} style={{ padding: "11px 12px", borderBottom: `1px solid ${C.line}`, textAlign: rtl ? "right" : "left", color: active ? C.gold : C.muted, fontWeight: 500, fontSize: 12, cursor: onClick ? "pointer" : "default", userSelect: "none" }}>{label}{active ? (dir === "desc" ? " ↓" : " ↑") : ""}</th>;
}
const Spin = () => <style>{".spin{animation:spin 0.8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}"}</style>;
