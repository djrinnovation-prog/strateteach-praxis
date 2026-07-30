import React, { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Play, Info, ChevronDown, ChevronRight, ShieldCheck, Sparkles, GraduationCap, Copy, ArrowLeft, Save, SlidersHorizontal, Trash2, FolderOpen, Pencil, Lock, LifeBuoy, Diamond, BarChart3, Layers, FlaskConical } from "lucide-react";
import ScreenShortcuts from "../components/ScreenShortcuts";
import GuidedBuilder from "./GuidedBuilder";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import CodeEditor from "../components/CodeEditor";
import { api, isAdmin, isOwner } from "../app/api";
import { strategyLabel, visibleBuiltinBots } from "../lib/builtinBots";
import { useI18n } from "../i18n";
import { C, UI, MONO } from "../theme";
import { Card, input, btn, errBox, okBox, Spin } from "../ui";
import { useGate, UpgradeCard } from "../lib/entitlements";
import { HubPanel } from "../components/HubScreen";
import { ev as track12 } from "../lib/analytics";
import FramedTitle from "../components/FramedTitle";
import { GlassTile, TileGrid, homeDim } from "../components/GlassTile";
import SquareRow from "../components/SquareRow";
import { centralExtras } from "../lib/centralExtras";
import ScreenBottom from "../components/ScreenBottom";
import { useViewMode, ViewToggle } from "../components/ViewToggle";
import { useIsMobile } from "../lib/useIsMobile";
import HomeTop from "../components/HomeTop";

const SAMPLE = "";

// A ready-made prompt the user can hand to any AI (or our AI guide) to adapt
// their Pine into a clean, backtest-ready strategy for this engine.
// ── "YOUR STRATEGIES" — the lab's landing once you've built at least one ──────
// Repeating the wizard to someone who already finished it is the fastest way to
// make a product feel broken. So a returning user sees what THEY built, can run
// it again, and builds another only when they choose to.
function MyStrategies({ rows, he, rtl, onBuildNew }: {
  rows: any[]; he: boolean; rtl: boolean; onBuildNew: () => void;
}) {
  const nav = useNavigate();
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ id: number; text: string; ok: boolean } | null>(null);
  const T = (h: string, e: string) => (he ? h : e);

  const cfgOf = (r: any) => r.config || {};
  const bucketsOf = (r: any) => (cfgOf(r).buckets as string[]) || ["crypto"];

  async function runDemo(r: any) {
    setBusy(r.id); setMsg(null);
    try {
      const res: any = await api.paperStart({
        capital: 1000, buckets: bucketsOf(r), maxPositions: 2,
        strategy: cfgOf(r).strategyId || "bot8c",
        label: r.name || T("האסטרטגיה שלי", "My strategy"),
      });
      const n = (res?.sessions || []).length;
      setMsg({ id: r.id, ok: n > 0, text: n > 0
        ? T(`הדמו התחיל — ${n} פוזיציה. פתח את מנוע המסחר לצפייה.`, `Demo started — ${n} position. Open the Trading Engine to watch.`)
        : T("אין כרגע פריצה מתאימה. זה נורמלי — נסה שוב מאוחר יותר.", "No matching breakout right now. That's normal — try again later.") });
    } catch (e: any) {
      setMsg({ id: r.id, ok: false, text: e?.message || T("ההרצה נכשלה.", "The run failed.") });
    } finally { setBusy(null); }
  }

  async function runBacktest(r: any) {
    setBusy(r.id); setMsg(null);
    try {
      await api.createRun(bucketsOf(r), cfgOf(r), undefined, r.name || T("האסטרטגיה שלי", "My strategy"));
      nav("/backtests");
    } catch (e: any) {
      setMsg({ id: r.id, ok: false, text: e?.message || T("הבדיקה נכשלה.", "The test failed.") });
    } finally { setBusy(null); }
  }

  const box: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16 };
  const act: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    borderRadius: 11, padding: "9px 13px", fontSize: 12.5, fontWeight: 900, cursor: "pointer", fontFamily: UI };

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", direction: rtl ? "rtl" : "ltr" }}>
      <div style={{ ...box, background: `${C.gold}0d`, border: `1px solid ${C.gold}44`, marginBottom: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: C.text, marginBottom: 4 }}>
          {T("האסטרטגיות שלך", "Your strategies")}
        </div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
          {T(`בנית ${rows.length} ${rows.length === 1 ? "אסטרטגיה" : "אסטרטגיות"}. אפשר להריץ אותן שוב, לבדוק על היסטוריה, או לבנות עוד אחת.`,
             `You've built ${rows.length} ${rows.length === 1 ? "strategy" : "strategies"}. Run them again, test on history, or build another.`)}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((r) => {
          const c = cfgOf(r);
          const chips = [c.timeframe, c.strategyId ? strategyLabel(c.strategyId, he ? "he" : "en") : null].filter(Boolean);
          return (
            <div key={r.id} style={box}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", marginBottom: 9 }}>
                <Layers size={16} color={C.gold} />
                <span style={{ fontSize: 15, fontWeight: 900, color: C.text }}>
                  {r.name && r.name !== "Strategy" ? r.name : `${T("אסטרטגיה", "Strategy")} #${r.id}`}
                </span>
                {chips.map((t: any, i: number) => (
                  <span key={i} style={{ fontSize: 11, fontWeight: 800, color: C.muted, background: C.surface,
                    border: `1px solid ${C.line}`, borderRadius: 999, padding: "3px 9px", fontFamily: MONO }}>{t}</span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => runDemo(r)} disabled={busy === r.id} className="tap44"
                  style={{ ...act, background: C.gold, color: "#16110a", border: "none" }}>
                  {busy === r.id ? <Loader2 size={14} className="spin" /> : <Play size={14} />} {T("הרץ בדמו", "Run in demo")}
                </button>
                <button onClick={() => runBacktest(r)} disabled={busy === r.id} className="tap44"
                  style={{ ...act, background: C.surface, color: C.text, border: `1px solid ${C.line}` }}>
                  <FlaskConical size={14} /> {T("בדוק על היסטוריה", "Test on history")}
                </button>
              </div>
              {msg && msg.id === r.id && (
                <div style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.5, color: msg.ok ? C.gain : C.muted }}>
                  {msg.text}
                  {msg.ok && (
                    <button onClick={() => nav("/profit")}
                      style={{ marginInlineStart: 8, background: "none", border: "none", color: C.gold,
                        fontWeight: 900, fontSize: 12.5, cursor: "pointer", fontFamily: UI }}>
                      {T("פתח את המנוע ←", "Open the engine →")}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button onClick={onBuildNew} className="tap44"
        style={{ marginTop: 12, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
          background: C.surface, color: C.gold, border: `1px solid ${C.gold}66`, borderRadius: 14,
          padding: "13px 18px", fontSize: 14, fontWeight: 900, cursor: "pointer", fontFamily: UI }}>
        <Sparkles size={16} /> {T("בנה אסטרטגיה נוספת", "Build another strategy")}
      </button>
    </div>
  );
}

function aiFixPrompt(source: string, _lang: string) {
  return `Hi please adjust my pine script to version 6 please with the following setting :

Avoid forward looking & repainting at all costs.
Don't add tables to the chart.
Don't ever use line breaks in function calls!


2018-01-01 -2069-01-01 (trade only in this timeframe).
1D chart.
100% of equity per trade.
0.05% commission.
1 tick slippage.

--- MY STRATEGY ---
${source}`;
}

export default function Strategy() {
  const { t, lang, rtl } = useI18n();
  const he = lang === "he";
  const TT = (en: string, he: string) => (lang === "he" ? he : en);
  const qc = useQueryClient();
  const nav = useNavigate();
  const mobile = useIsMobile();

  const [source, setSource] = useState(SAMPLE);
  const [config, setConfig] = useState<any>(null);          // parsed params (null until checked)
  const [target, setTarget] = useState<"breakouts" | "market10">("breakouts");
  const [runId, setRunId] = useState<string | null>(null);  // full backtest run
  const [selSym, setSelSym] = useState<string | null>(null);
  const [chartOpen, setChartOpen] = useState(false);        // top chart: closed by default
  const [chartSym, setChartSym] = useState("BTC/USDT");
  const [aiOpen, setAiOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false); // Pine editor minimized by default
  const [propsOpen, setPropsOpen] = useState(false); // properties: closed by default
  // Backtest properties (TradingView strategy() settings). These drive the engine.
  const [props, setProps] = useState({ commissionPct: 0.05, slippageTicks: 1, positionPct: 100, pyramiding: 1 });
  const setProp = (k: string, v: any) => setProps((p) => ({ ...p, [k]: v }));
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [loadedId, setLoadedId] = useState<number | null>(null); // the saved strategy currently loaded in the editor
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpMsg, setHelpMsg] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  // URL-driven child navigation (Back returns to the launcher) — the finalized model.
  // `ssec`/`setSsec` are ALIASED to the ?sec= URL param so every existing `ssec === …`
  // section + `setSsec(…)` call site keeps working unchanged; default = "" (launcher).
  const [sp, setSp] = useSearchParams();
  const ssec = sp.get("sec") || "";
  const setSsec = (v: string) => setSp(v ? { sec: v } : {});
  // The lab opens on the guided builder ("build your own"); the classic advanced
  // surface is one click away. Landing on a ?sec= deep link skips straight to it.
  const [mode, setMode] = useState<"builder" | "advanced">(sp.get("sec") ? "advanced" : "builder");
  // Once you've built a strategy the lab must not greet you with the same wizard
  // again — it shows YOUR strategies, and building another is a deliberate choice.
  const [buildNew, setBuildNew] = useState(false);
  const [moreView, setMoreView] = useViewMode("algo770_strategy_more_view_v1", "cards");
  const sectionRef = useRef<HTMLDivElement>(null);
  const scrollTo = (r: React.RefObject<HTMLDivElement>) => setTimeout(() => r.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);

  const labGate = useGate("strategy_lab");
  const fail = (e: any) => { setOk(""); setErr(e?.message || String(e)); };
  const flash = (m: string) => { setErr(""); setOk(m); setTimeout(() => setOk(""), 3000); };

  // Parse first (extracts supported params), then run a quick backtest on today's
  // breakouts. If it errors, the strategy isn't usable; if it runs, we show results.
  const checkM = useMutation({
    mutationFn: async () => {
      const cfg = await api.parsePine(source);
      const res = await api.previewTop10({ ...(cfg as any), ...props }, 10);
      return { cfg, res };
    },
    onSuccess: ({ cfg, res }: any) => {
      setConfig(cfg); // params recognized → keep "checked" so the user can still run/adjust
      const rows = (res?.results || []) as any[];
      // The engine call succeeded, but if EVERY symbol came back with an error
      // (e.g. insufficient warm-up data), surface the REAL reason instead of a
      // misleading "Strategy runs ✓".
      if (rows.length > 0 && rows.every((r: any) => r.errorMessage)) {
        fail(new Error(TT("Engine ran, but every symbol failed: ", "המנוע רץ, אך כל הסמלים נכשלו: ") + (rows.find((r: any) => r.errorMessage)?.errorMessage || TT("unknown error", "שגיאה לא ידועה"))));
        return;
      }
      flash(TT("Strategy runs ✓ — the engine recognized your parameters.", "האסטרטגיה רצה ✓ — המנוע זיהה את הפרמטרים."));
      // strategy_kind stays "other" — we never classify or expose the indicator family / Pine source.
      track12.strategyCreated("other");
    },
    onError: (e: any) => { setConfig(null); track12.validationErrorSeen("strategy", "engine_incompatible"); fail(new Error(TT("This strategy didn't run — it's not compatible with the engine. Use “Ask AI to fix it”, or learn at the Reels school.", "האסטרטגיה לא רצה — אינה תואמת למנוע. השתמשו ב“בקשו מ-AI לתקן”, או למדו בבית הספר רילס.") + " (" + (e?.message || e) + ")")); },
  });
  const previewM = useMutation({ mutationFn: () => api.previewTop10({ ...config, ...props }, 10), onError: fail });
  const createM = useMutation({
    mutationFn: () => api.createRun(["crypto"], { ...config, ...props }, 10, `Lab ${new Date().toLocaleTimeString()}`),
    // Lab runs are ephemeral (never saved): discard the previous one when starting a new one.
    onSuccess: (r: any) => { setSelSym(null); if (runId && runId !== r.id) api.deleteRun(runId).catch(() => {}); setRunId(r.id); flash(TT("Backtest started…", "בקטסט התחיל…")); },
    onError: fail,
  });
  // Built-in "Demo strategy" (BOT1) — run-only showcase; no editing, no Pine exposed.
  const runDemoM = useMutation({
    mutationFn: () => api.createRun(["crypto"], { strategyId: "bot1", timeframe: "1d", poles: 2, samplingPeriod: 40, ftrMultiplier: 2, enableShorts: false, ...props }, 10, "Demo strategy"),
    onSuccess: (r: any) => { setSelSym(null); if (runId && runId !== r.id) api.deleteRun(runId).catch(() => {}); setTarget("market10"); setRunId(r.id); flash(TT("Demo strategy running — results appear below in a moment.", "אסטרטטיית הדמו רצה — התוצאות יופיעו למטה עוד רגע.")); },
    onError: fail,
  });
  const saveM = useMutation({
    mutationFn: async () => {
      let cfg: any = config;
      if (!cfg) cfg = await api.parsePine(source);   // allow saving even before an explicit Check
      return api.saveStrategy(saveName.trim() || `Strategy ${new Date().toLocaleDateString()}`, { ...cfg, ...props }, source);
    },
    onSuccess: () => { setSaveOpen(false); setSaveName(""); track12.strategySaved("other"); flash(TT("🎉 Strategy added — it's now in your strategies, ready to load anywhere.", "🎉 האסטרטגיה נוספה — היא ברשימת האסטרטגיות שלכם וזמינה לטעינה.")); qc.invalidateQueries({ queryKey: ["savedStrategies"] }); },
    onError: fail,
  });
  const savedQ = useQuery({ queryKey: ["savedStrategies"], queryFn: () => api.savedStrategies() });
  const saved = (savedQ.data || []) as any[];
  const meQ = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  const myUser = (meQ.data as any)?.username;
  const admin = isAdmin();
  // Built-in 770 bots this user may see/select: all for admin; only strategy 1 & 8
  // for regular users (the same admin flag used app-wide).
  const visBots = visibleBuiltinBots(isOwner());
  // Edit/rename/delete ONLY your own saved strategy. Legacy ownerless rows stay
  // owner-editable; only an OWNER sees + edits OTHER users' strategies (read-only cross-view,
  // labelled by owner below). A non-owner admin (Oren) has no access to others' strategies.
  const canEdit = (s: any) => (s?.owner ? s.owner === myUser : isOwner());
  const mainAdmin = isOwner();
  // Load a built-in 770 bot into the lab (run-only — no Pine source to expose).
  const loadBuiltin = (bot: { id: string; name: string }) => {
    setSource("");
    setConfig({ strategyId: bot.id });
    setLoadedId(null);
    setEditorOpen(false);
    const lbl = strategyLabel(bot.id, lang);
    flash(TT(`Loaded built-in “${lbl}” — press Run to backtest it.`, `נטענה אסטרטגיה מובנית “${lbl}” — לחצו הרצה לבדיקה.`));
  };
  const loadedStrat = saved.find((s) => s.id === loadedId) || null;
  const delM = useMutation({ mutationFn: (id: number) => api.deleteSavedStrategy(id), onSuccess: () => { flash(TT("Removed", "הוסר")); qc.invalidateQueries({ queryKey: ["savedStrategies"] }); }, onError: fail });
  const renameM = useMutation({ mutationFn: (v: { id: number; name: string }) => api.updateSavedStrategy(v.id, { name: v.name }), onSuccess: () => { flash(TT("Renamed ✓ — updated everywhere.", "שונה השם ✓ — עודכן בכל המסכים.")); qc.invalidateQueries({ queryKey: ["savedStrategies"] }); }, onError: fail });
  const updateM = useMutation({
    mutationFn: async () => {
      let cfg: any = config;
      if (!cfg) cfg = await api.parsePine(source);
      return api.updateSavedStrategy(loadedId!, { config: { ...cfg, ...props }, pineSource: source });
    },
    onSuccess: () => { flash(TT("Updated ✓ — the change applies across the app.", "עודכן ✓ — השינוי חל בכל האפליקציה.")); qc.invalidateQueries({ queryKey: ["savedStrategies"] }); },
    onError: fail,
  });
  const myHelpQ = useQuery({ queryKey: ["myHelp"], queryFn: () => api.myHelp() });
  const myHelp = (myHelpQ.data || []) as any[];
  const helpM = useMutation({
    mutationFn: () => api.submitHelp(source, helpMsg.trim()),
    onSuccess: () => { setHelpOpen(false); setHelpMsg(""); flash(TT("Sent to admin ✓ — your answer will show here.", "נשלח למנהל ✓ — התשובה תופיע כאן.")); qc.invalidateQueries({ queryKey: ["myHelp"] }); },
    onError: fail,
  });
  const loadStrategy = (s: any) => {
    setSource(s?.pineSource || "");
    const cfg = s?.config || {};
    setConfig(cfg);
    setLoadedId(s?.id ?? null);
    setEditorOpen(true); // open the editor so the user sees & can edit the loaded code
    setProps((p) => ({ ...p, commissionPct: cfg.commissionPct ?? p.commissionPct, slippageTicks: cfg.slippageTicks ?? p.slippageTicks, positionPct: cfg.positionPct ?? p.positionPct, pyramiding: cfg.pyramiding ?? p.pyramiding }));
    flash(TT(`Loaded “${s?.name || "strategy"}” — code & settings are in the editor.`, `נטענה “${s?.name || "אסטרטגיה"}” — הקוד וההגדרות בעורך.`));
  };

  const runsQ = useQuery({ queryKey: ["runs"], queryFn: () => api.listRuns() });
  // The lab run is EPHEMERAL (not saved), so it isn't in the saved-only list_runs.
  // Poll it directly by id for status; stops once it reaches a terminal state.
  const runByIdQ = useQuery({
    queryKey: ["run", runId],
    queryFn: () => api.getRun(runId!),
    enabled: !!runId,
    refetchInterval: (query: any) => {
      const s = (query?.state?.data as any)?.status;
      return (s === "completed" || s === "failed" || s === "cancelled") ? false : 4000;
    },
  });
  const run = (runByIdQ.data as any) || null;
  const runDone = run?.status === "completed";
  // For the top chart: use the lab's run if completed, else the most recent completed run.
  const latestRun = ((runsQ.data as any[]) || []).filter((r) => r.status === "completed")
    .slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
  const chartRunId: string | null = (runId && runDone ? runId : null) || latestRun?.id || null;
  const resultsQ = useQuery({ queryKey: ["labResults", runId], queryFn: () => api.results(runId!), enabled: !!runId && runDone });
  const detailQ = useQuery({ queryKey: ["labDetail", runId, selSym], queryFn: () => api.symbolDetail(runId!, selSym!), enabled: !!runId && !!selSym });

  const breakoutResults = (previewM.data as any)?.results || [];
  const runResults = (resultsQ.data as any[]) || [];
  const checked = !!config;
  // Results currently on screen for the chosen target, plus an all-failed signal
  // so the real per-symbol error is surfaced instead of an empty/zeroed table.
  const shownResults = (target === "market10" ? runResults : breakoutResults) as any[];
  const allFailed = shownResults.length > 0 && shownResults.every((r: any) => r.errorMessage);
  const firstErr = (shownResults.find((r: any) => r.errorMessage)?.errorMessage as string | undefined);

  function runBacktest() {
    setErr("");
    if (!config) { fail(new Error(TT("Press “Check strategy” first.", "לחצו “בדוק אסטרטגיה” קודם."))); return; }
    if (target === "breakouts") { previewM.mutate(); } else { createM.mutate(); }
  }

  // Chart data: equity curve of the chosen symbol from the current run.
  const chartDetail = useQuery({
    queryKey: ["labChart", chartRunId, chartSym],
    queryFn: () => api.symbolDetail(chartRunId!, chartSym),
    enabled: !!chartRunId && chartOpen,
  });
  const equity = ((chartDetail.data as any)?.equityCurve || []).map((p: any) => ({ date: p.date, value: p.value }));
  // Symbols available in the chart's run (e.g. "BTC/USDT") — populate the picker + default sensibly.
  const chartResultsQ = useQuery({ queryKey: ["chartSyms", chartRunId], queryFn: () => api.results(chartRunId!), enabled: !!chartRunId && chartOpen });
  const chartSymbols: string[] = ((chartResultsQ.data as any[]) || []).map((r: any) => r.symbol);
  React.useEffect(() => {
    if (chartSymbols.length && !chartSymbols.includes(chartSym)) {
      setChartSym(chartSymbols.find((s) => s.toUpperCase().startsWith("BTC")) || chartSymbols[0]);
    }
  }, [chartSymbols.join(",")]); // eslint-disable-line

  // ── THE FRONT DOOR: build your own strategy ────────────────────────────────
  // StrateTeach's premise is that you LEARN by building. So the lab opens on the
  // guided builder — every user assembles their own strategy — and the advanced
  // surface (Pine editor, properties, run) sits one click behind it for people who
  // already know what they're doing. Nothing was removed; only re-ordered.
  if (mode === "builder") {
    const built = saved.length > 0 && !buildNew;
    return (
      <div style={{ direction: rtl ? "rtl" : "ltr", fontFamily: UI, color: C.text, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
        <FramedTitle
          text={t.strategy}
          subtitle={built
            ? (he ? `${saved.length} אסטרטגיות שבנית` : `${saved.length} strategies you built`)
            : (he ? "צעד 1 · בנה את האסטרטגיה שלך" : "Step 1 · build your strategy")} />

        {/* The lab's own square row — the entry points, at the TOP where they belong. */}
        <SquareRow screenKey="strategy-front" mobile={mobile} editable={false} liquid
          squares={[
            { id: "build", variant: "primary", Icon: GraduationCap,
              label: he ? (built ? "בנה עוד אחת" : "בנה אסטרטגיה") : (built ? "Build another" : "Build a strategy"),
              sub: he ? "לומד · בוחר · מאשר" : "learn · choose · approve",
              onClick: () => setBuildNew(true) },
            { id: "advanced", variant: "secondary", Icon: SlidersHorizontal,
              label: he ? "מתקדם" : "Advanced",
              sub: he ? "Pine · מאפיינים · הרצה" : "Pine · properties · run",
              onClick: () => setMode("advanced") },
          ]} />

        {built
          ? <MyStrategies rows={saved} he={he} rtl={rtl} onBuildNew={() => setBuildNew(true)} />
          : <GuidedBuilder />}

        <div style={{ fontSize: 11.5, color: C.faint, textAlign: "center", marginTop: 4, lineHeight: 1.5 }}>
          {he ? "כבר יש לך סקריפט Pine מוכן? ב'מתקדם' אפשר להדביק אותו והמערכת תמיר אותו לאסטרטגיה."
              : "Already have a Pine script? In Advanced you can paste it and we'll convert it into a strategy."}
        </div>
        <ScreenBottom />
      </div>
    );
  }

  return (
    <div style={{ direction: rtl ? "rtl" : "ltr", fontFamily: UI, color: C.text, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>

      {/* Advanced is a SUB-screen: a persistent, unmissable way back to the main lab.
          Sticky so it stays reachable however far the user scrolls into the editor. */}
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: C.bg,
        borderBottom: `1px solid ${C.line}`, padding: "8px 0", marginBottom: 2 }}>
        <button onClick={() => { setMode("builder"); setSsec(""); }} className="tap44"
          style={{ display: "inline-flex", alignItems: "center", gap: 8,
            background: C.surface, border: `1px solid ${C.gold}55`, color: C.gold, borderRadius: 999,
            fontSize: 13, fontWeight: 900, cursor: "pointer", fontFamily: UI, padding: "9px 16px" }}>
          {rtl ? <ChevronRight size={16} /> : <ArrowLeft size={16} />}
          {he ? "חזרה למסך האסטרטגיות" : "Back to strategies"}
        </button>
        <span style={{ marginInlineStart: 10, fontSize: 12, fontWeight: 800, color: C.faint }}>
          {he ? "מתקדם" : "Advanced"}
        </span>
      </div>

      {ssec === "" && (
        <>
          <FramedTitle text={he ? "מתקדם" : "Advanced"}
            subtitle={he ? "עורך Pine · מאפיינים · הרצה ותוצאות" : "Pine editor · properties · run & results"} />

          {/* Editable top shortcuts — the "עוד במערכת" chip opens the More CHILD (not a modal).
              "All strategies" is deliberately absent: the strategy list is the MAIN screen's
              job now, and repeating it here was the duplication Dan flagged. */}
          <ScreenShortcuts
            screenKey="strategy"
            defaultKeys={["editor", "props", "explain", "perf"]}
            onMore={() => setSsec("more")}
            catalog={[
              { key: "editor", label: he ? "עורך" : "Editor", Icon: Pencil, onClick: () => setSsec("editor") },
              { key: "props", label: he ? "מאפיינים" : "Properties", Icon: SlidersHorizontal, onClick: () => setSsec("props") },
              { key: "explain", label: he ? "הסבר" : "Explain", Icon: GraduationCap, onClick: () => nav("/university") },
              { key: "perf", label: he ? "ביצועים" : "Performance", Icon: BarChart3, onClick: () => setSsec("run") },
            ]}
          />

          {/* The TWO things Advanced is actually for. The "Strategies" square was removed:
              listing strategies is the main screen's job, and duplicating it here is what
              made this screen feel like the old one. Run & results is where the user's own
              strategies get executed and compared. */}
          <SquareRow screenKey="strategy-central-v2" mobile={mobile} defaultShown={["editor", "run"]}
            squares={[
              { id: "editor", variant: "primary", Icon: Pencil, label: he ? "עורך Pine" : "Pine editor", sub: he ? "הדבק והמר לאסטרטגיה" : "paste & convert", onClick: () => setSsec("editor") },
              { id: "run", variant: "primary", Icon: Play, label: he ? "הרצה ותוצאות" : "Run & results", sub: he ? "האסטרטגיות שלך · בקטסט" : "your strategies · backtest", onClick: () => setSsec("run") },
              ...centralExtras(he, nav, { exclude: ["strategy"] }),
            ]} />

          {/* Entitlement gate — the Strategy-Lab upgrade prompt stays prominent on the launcher. */}
          {!labGate.loading && !labGate.allowed && (
            <div style={{ marginTop: 6 }}>
              <UpgradeCard requiredPlan={labGate.requiredPlan}
                title={TT("Strategy Lab unlocks on Middle", "מעבדת האסטרטגיות נפתחת ב-Middle")}
                note={TT("Upgrade to Middle ($29.99/mo), or add a single strategy slot for $50 on the Plans screen.", "שדרגו ל-Middle ($29.99/חודש), או הוסיפו סלוט אסטרטגיה אחד ב-$50.")} />
            </div>
          )}
        </>
      )}

      {/* ── "עוד במערכת" CHILD — the lab areas as a tile grid with a rows/tiles toggle. ── */}
      {ssec === "more" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FramedTitle text={he ? "עוד במערכת" : "More"} subtitle={he ? "כל אזורי המעבדה" : "All lab areas"} />
          <div style={{ display: "flex", justifyContent: "flex-end", margin: "2px 2px 0" }}>
            <ViewToggle view={moreView} onChange={setMoreView} he={he} />
          </div>
          <TileGrid screenKey="strategy-more" view={moreView} columns={3} aspect={1.08} tiles={[
            { id: "strategies", label: he ? "אסטרטגיות" : "Strategies", Icon: Layers, onClick: () => setSsec("strategies") },
            { id: "editor", label: he ? "עורך" : "Editor", Icon: Pencil, onClick: () => setSsec("editor") },
            { id: "props", label: he ? "מאפיינים" : "Properties", Icon: SlidersHorizontal, onClick: () => setSsec("props") },
            { id: "run", label: he ? "הרצה ותוצאות" : "Run & results", Icon: Play, onClick: () => setSsec("run") },
            { id: "explain", label: he ? "הסבר (למידה)" : "Explain (Learn)", Icon: GraduationCap, onClick: () => nav("/university") },
            { id: "backtests", label: he ? "בדיקות" : "Backtests", Icon: FlaskConical, onClick: () => nav("/backtests") },
          ]} />
        </div>
      )}

      <div ref={sectionRef} aria-hidden style={{ scrollMarginTop: 8 }} />

      {ssec === "strategies" && (<HubPanel alwaysOpen ns="strategy" id="strategies" title={he ? "אסטרטגיות" : "Strategies"} icon={<Layers size={15} />} onClose={() => setSsec("")}>
      {/* P&L card + guidance banner lead the strategies list. The live TradingView chart
          was removed from here: on a screen whose job is picking a strategy it just pushed
          the list far below the fold without informing the choice. Live charting lives in
          the trading screens, where it's actionable. */}
      <HomeTop />
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", background: `${C.gain}14`, border: `1px solid ${C.gain}4d`, borderRadius: 12, padding: "11px 14px", marginBottom: 14 }}>
        <span style={{ display: "flex", gap: 9, alignItems: "center", fontSize: 12.5, color: C.text, lineHeight: 1.5 }}>
          <Info size={16} color={C.gain} style={{ flexShrink: 0 }} />
          {TT("Bring a strategy that actually works on this engine. New to writing one?", "הביאו אסטרטגיה שבאמת עובדת על המנוע. חדשים בכתיבה?")}
        </span>
        <button onClick={() => nav("/reels")} style={{ ...btn(), color: C.gain, borderColor: `${C.gain}80`, whiteSpace: "nowrap" }}>
          <GraduationCap size={14} /> {TT("Reels school", "בית ספר רילס")}
        </button>
      </div>
      {err && <div style={errBox}>{err}</div>}
      {ok && <div style={okBox}>{ok}</div>}
      {/* Demo strategy — a proven BOT1 strategy anyone can run to see results (view-only) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", background: `${C.gain}1a`, border: `1px solid ${C.gain}59`, borderRadius: 14, padding: "14px 16px", marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: C.text, display: "flex", alignItems: "center", gap: 8 }}><Sparkles size={16} color={C.gain} /> {TT("Demo strategy", "אסטרטטיית דמו")}</div>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3, maxWidth: 560 }}>{TT("See a proven strategy working — runs our Strategy 1 on the top market and shows the results. View-only.", "ראו אסטרטגיה מנצחת בפעולה — מריצה את אסטרטגיה 1 על השוק המוביל ומציגה תוצאות. לצפייה בלבד.")}</div>
        </div>
        <button onClick={() => runDemoM.mutate()} disabled={runDemoM.isPending} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: "var(--btn-gain-bg)", color: "var(--btn-gain-ink)", border: "1.5px solid var(--btn-gain-bd)", borderRadius: 14, padding: "11px 18px", fontWeight: 800, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -10px 20px -14px rgba(0,0,0,0.30), 0 9px 22px -13px rgba(0,0,0,0.30)" }}>
          {runDemoM.isPending ? <Loader2 size={15} className="spin" /> : <Play size={15} />} {TT("See it work", "ראו שזה עובד")}
        </button>
      </div>

      {/* Your strategies — the built-in 770 bots (read-only) + your own saved customs.
          The main admin also sees other users' strategies here, labelled by owner. */}
      <Card title={<span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><FolderOpen size={15} color={C.gold} /> {TT("Your strategies", "האסטרטגיות שלך")} <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 500 }}>· {visBots.length + saved.length}</span></span> as any}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* Built-in 770 bots — run-only (no edit/delete, no Pine). Regular users see
              only strategy 1 & 8; admins see all (visBots is already gated). */}
          {visBots.map((bot) => {
            const on = !loadedId && config?.strategyId === bot.id && !source;
            return (
              <span key={bot.id} title={bot.desc[lang]} style={{ display: "inline-flex", alignItems: "center", background: on ? `${C.gold}1f` : C.surface2, border: `1.5px solid ${on ? C.gold : C.line}`, borderRadius: 11, paddingInlineStart: 10, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.20)" }}>
                <button onClick={() => loadBuiltin(bot)} title={TT("Load to run a backtest", "טען להרצת בקטסט")} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", color: C.text, fontSize: 12.5, fontWeight: 700, padding: "8px 2px", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <ShieldCheck size={11} color={C.gold} />
                  {strategyLabel(bot.id, lang)}
                </button>
                <span style={{ fontSize: 9.5, fontWeight: 700, color: C.gold, padding: "0 10px 0 6px" }}>{TT("built-in", "מובנה")}</span>
              </span>
            );
          })}
          {saved.map((s) => {
            const editable = canEdit(s);
            const on = loadedId === s.id;
            const otherOwner = !!s?.owner && s.owner !== myUser; // main-admin cross-view
            return (
              <span key={s.id} style={{ display: "inline-flex", alignItems: "center", background: on ? `${C.gold}1f` : C.surface2, border: `1.5px solid ${on ? C.gold : C.line}`, borderRadius: 11, paddingInlineStart: 10, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.20)" }}>
                <button onClick={() => loadStrategy(s)} title={TT("Load code + settings", "טען קוד והגדרות")} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", color: C.text, fontSize: 12.5, fontWeight: 700, padding: "8px 2px", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  {!editable && <Lock size={11} color={C.faint} />}
                  {s.name && s.name !== "Strategy" ? s.name : `${strategyLabel(s.config?.strategyId || s.strategyId || "770", lang)} #${s.id}`}
                </button>
                {otherOwner && <span style={{ fontSize: 9.5, color: C.faint, padding: "0 6px 0 5px" }}>{TT(`owner: ${s.owner}`, `בעלים: ${s.owner}`)}</span>}
                {editable ? (
                  <>
                    <button onClick={() => { const n = window.prompt(TT("Rename strategy", "שם חדש לאסטרטגיה"), s.name || ""); if (n && n.trim()) renameM.mutate({ id: s.id, name: n.trim() }); }} title={TT("Rename", "שנה שם")} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, padding: "8px 3px", display: "inline-flex" }}><Pencil size={12} /></button>
                    <button onClick={() => { if (window.confirm(TT("Remove this strategy?", "להסיר את האסטרטגיה?"))) delM.mutate(s.id); }} title={TT("Remove", "הסר")} style={{ background: "none", border: "none", cursor: "pointer", color: C.faint, padding: "8px 9px 8px 4px", display: "inline-flex" }}><Trash2 size={12} /></button>
                  </>
                ) : <span style={{ fontSize: 9.5, color: C.faint, padding: "0 10px 0 5px" }}>{TT("read-only", "לקריאה בלבד")}</span>}
              </span>
            );
          })}
        </div>
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8 }}>{TT("The 770 bots are built-in (run-only). Click any to load it; you can rename/update your own saved strategies.", "בוטי ה-770 מובנים (להרצה בלבד). לחצו לטעינה; ניתן לערוך/לשנות שם לאסטרטגיות שלכם.")}{mainAdmin ? TT(" Strategies marked with an owner belong to other users and are read-only.", " אסטרטגיות עם תווית בעלים שייכות למשתמשים אחרים והן לקריאה בלבד.") : ""}</div>
      </Card>

      {/* Your help requests — admin answers show here */}
      {myHelp.length > 0 && (
        <Card title={<span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><LifeBuoy size={15} color={C.gold} /> {TT("Your help requests", "בקשות העזרה שלך")}</span> as any}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "56svh", overflowY: "auto", paddingInlineEnd: 4 }}>
            {myHelp.map((h: any) => (
              <div key={h.id} style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 12.5, color: C.text }}>{h.message || TT("(no note)", "(ללא הערה)")}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: h.status === "answered" ? C.gain : C.gold, border: `1px solid ${h.status === "answered" ? C.gain : C.goldDim}`, borderRadius: 7, padding: "1px 8px" }}>{h.status === "answered" ? TT("answered", "נענה") : TT("open", "פתוח")}</span>
                </div>
                {h.answer && (
                  <div style={{ marginTop: 8, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.gain }}>✅ {TT("Admin's answer — ready to use", "תשובת המנהל — מוכן לשימוש")}</span>
                      <span style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => { try { navigator.clipboard?.writeText(h.answer); flash(TT("Copied ✓", "הועתק ✓")); } catch { /* */ } }} style={btn()}><Copy size={13} /> {TT("Copy", "העתק")}</button>
                        <button onClick={() => { setSource(h.answer); setConfig(null); setEditorOpen(true); flash(TT("Loaded into the editor", "נטען לעורך")); }} style={btn()}><FolderOpen size={13} /> {TT("Use it", "השתמש")}</button>
                      </span>
                    </div>
                    <pre style={{ margin: 0, maxHeight: 220, overflow: "auto", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: 10, fontFamily: MONO, fontSize: 11.5, color: C.text, whiteSpace: "pre-wrap", direction: "ltr" }}>{h.answer}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
      </HubPanel>)}

      {/* Top chart — collapsed by default, BTC by default */}
      {ssec === "run" && (
      <HubPanel ns="strategy" id="chart">
      <Card title={
        <button onClick={() => setChartOpen((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", color: C.text, fontSize: 15, fontWeight: 700, padding: 0 }}>
          {chartOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />} {TT("Chart", "גרף")}
          <select value={chartSym} onChange={(e) => setChartSym(e.target.value)} onClick={(e) => e.stopPropagation()} style={{ ...input, width: "auto", padding: "4px 8px", fontSize: 12 }}>
            {chartSymbols.length === 0 ? <option value={chartSym}>{chartSym}</option> : chartSymbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </button> as any}>
        {chartOpen && (
          !chartRunId ? <div style={{ color: C.muted, fontSize: 13 }}>{TT("Run a backtest (below) once — then this charts a symbol's equity curve.", "הריצו בקטסט פעם אחת — ואז כאן תופיע עקומת ההון של נכס.")}</div>
          : chartDetail.isLoading ? <div style={{ color: C.muted, fontSize: 13 }}><Loader2 size={15} className="spin" /></div>
          : equity.length === 0 ? <div style={{ color: C.muted, fontSize: 13 }}>{TT(`No data for ${chartSym} in this run.`, `אין נתונים ל-${chartSym} בריצה זו.`)}</div>
          : <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equity} margin={{ top: 6, right: 10, left: -6, bottom: 4 }}>
                  <CartesianGrid stroke={C.line} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 9.5, fill: C.muted }} minTickGap={28} />
                  <YAxis tick={{ fontSize: 9.5, fill: C.muted }} width={48} />
                  <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12 }} />
                  <Line type="monotone" dataKey="value" stroke={C.gold} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
        )}
      </Card>
      </HubPanel>
      )}

      {/* Pine editor + actions — editor can be minimized */}
      {ssec === "editor" && (
      <HubPanel ns="strategy" id="editor">
      <Card title={
        <button onClick={() => setEditorOpen((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", color: C.text, fontSize: 15, fontWeight: 700, padding: 0 }}>
          {editorOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />} {t.pineSource}
          {!editorOpen && <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 500 }}>· {TT("minimized — click to expand", "ממוזער — לחצו להרחבה")}</span>}
        </button> as any}>
        {editorOpen && <CodeEditor value={source} onChange={(v: string) => { setSource(v); setConfig(null); }} minRows={7} />}
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button onClick={() => checkM.mutate()} disabled={checkM.isPending} className="gbtn ptile" style={btn(true)}>
            {checkM.isPending ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />} {TT("Check strategy", "בדוק אסטרטגיה")}
          </button>
          <button onClick={() => setAiOpen((v) => !v)} style={btn()}>
            <Sparkles size={14} /> {TT("Ask AI to fix it", "בקשו מ-AI לתקן")}
          </button>
          <button onClick={() => { setHelpMsg(""); setHelpOpen(true); }} style={btn()}>
            <LifeBuoy size={14} /> {TT("Send to admin for help", "שלח למנהל לעזרה")}
          </button>
          <button onClick={() => { setSaveName(""); setSaveOpen(true); }} style={btn()}>
            <Save size={14} /> {TT("Add strategy", "הוסף אסטרטגיה")}
          </button>
          {loadedStrat && canEdit(loadedStrat) && (
            <button onClick={() => updateM.mutate()} disabled={updateM.isPending} style={btn()}>
              {updateM.isPending ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {TT(`Update “${loadedStrat.name}”`, `עדכן “${loadedStrat.name}”`)}
            </button>
          )}
          {checked && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: C.gain, fontWeight: 700 }}>
              <ShieldCheck size={13} /> {TT("Checked — recognized:", "נבדק — זוהה:")} <span style={{ fontFamily: MONO, color: C.muted }}>{strategyLabel(config.strategyId || "bot8c", lang)} · {config.timeframe || "1d"}</span>
            </span>
          )}
        </div>
        {aiOpen && (
          <div style={{ marginTop: 12, border: `1px solid ${C.line}`, borderRadius: 10, padding: 12, background: C.surface2 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>{TT("Ready-made order for an AI agent", "הוראה מוכנה לסוכן AI")}</span>
              <button onClick={() => { try { navigator.clipboard?.writeText(aiFixPrompt(source, lang)); flash(TT("Copied ✓", "הועתק ✓")); } catch { /* */ } }} style={btn()}><Copy size={13} /> {TT("Copy", "העתק")}</button>
            </div>
            <textarea readOnly value={aiFixPrompt(source, lang)} style={{ width: "100%", minHeight: 150, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8, color: C.muted, fontFamily: MONO, fontSize: 11.5, padding: 10, resize: "vertical" }} />
            <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6 }}>{TT("Paste this into our AI guide (or any AI). It returns the supported settings — then load them above and rebuild.", "הדביקו במדריך ה-AI שלנו (או בכל AI). הוא יחזיר את ההגדרות הנתמכות — טענו אותן ובנו מחדש.")}</div>
          </div>
        )}
      </Card>
      </HubPanel>
      )}

      {/* Backtest properties (TradingView strategy() settings) — drive the engine */}
      {ssec === "props" && (
      <HubPanel ns="strategy" id="props">
      <Card title={
        <button onClick={() => setPropsOpen((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", color: C.text, fontSize: 15, fontWeight: 700, padding: 0, flexWrap: "wrap" }}>
          {propsOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />} <SlidersHorizontal size={15} color={C.gold} /> {TT("Properties", "מאפיינים")}
          <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 500 }}>· {TT("commission", "עמלה")} {props.commissionPct}% · {TT("size", "גודל")} {props.positionPct}% · {TT("slippage", "החלקה")} {props.slippageTicks}</span>
        </button> as any}>
        {propsOpen && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
            <Prop label={TT("Initial capital", "הון התחלתי")} value="$1,000" />
            <Prop label={TT("Base currency", "מטבע בסיס")} value="USD" />
            <EditProp label={TT("Order size %", "גודל הזמנה %")} value={props.positionPct} onChange={(v) => setProp("positionPct", v)} />
            <EditProp label={TT("Pyramiding", "פירמידינג")} value={props.pyramiding} onChange={(v) => setProp("pyramiding", v)} />
            <EditProp label={TT("Commission %", "עמלה %")} value={props.commissionPct} onChange={(v) => setProp("commissionPct", v)} step={0.01} />
            <EditProp label={TT("Slippage (ticks)", "החלקה (טיקים)")} value={props.slippageTicks} onChange={(v) => setProp("slippageTicks", v)} />
            <Prop label={TT("Margin long %", "מרג'ין לונג %")} value="0" />
            <Prop label={TT("Margin short %", "מרג'ין שורט %")} value="0" />
            <Prop label={TT("Fill orders using", "מילוי הזמנות")} value="OHLC" />
          </div>
        )}
      </Card>
      </HubPanel>
      )}

      {/* Run backtest — choose target */}
      {ssec === "run" && (
      <HubPanel ns="strategy" id="backtest">
      <Card title={TT("Backtest", "בקטסט")}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: C.muted }}>{TT("Run on:", "הרץ על:")}</span>
          <button onClick={() => setTarget("breakouts")} style={chip(target === "breakouts")}>{TT("Today's breakouts", "הפריצות של היום")}</button>
          <button onClick={() => setTarget("market10")} style={chip(target === "market10")}>{TT("Top 10 market", "טופ 10 שוק")}</button>
        </div>
        <button onClick={runBacktest} disabled={!checked || previewM.isPending || createM.isPending} className="gbtn ptile" style={btn(true)}>
          {(previewM.isPending || createM.isPending) ? <Loader2 size={14} className="spin" /> : <Play size={14} />} {TT("Run backtest", "הרץ בקטסט")}
        </button>
        {!checked && <span style={{ fontSize: 11.5, color: C.faint, marginInlineStart: 10 }}>{TT("Check the strategy first.", "בדקו את האסטרטגיה קודם.")}</span>}
        {run && !runDone && target === "market10" && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: C.muted, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Loader2 size={14} className="spin" /> {TT("Running", "רץ")} — {run.status} {run.completedSymbols != null ? `(${run.completedSymbols}${run.totalSymbols ? "/" + run.totalSymbols : ""})` : ""}
          </div>
        )}
        {run?.status === "failed" && <div style={{ ...errBox, marginTop: 10 }}>{TT("Backtest failed:", "הבקטסט נכשל:")} {run.errorMessage || "error"}</div>}
      </Card>
      </HubPanel>
      )}

      {/* Results + trades */}
      {ssec === "run" && (<HubPanel ns="strategy" id="results">{selSym && runId ? (
        <Card title={<button onClick={() => setSelSym(null)} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", color: C.text, fontSize: 15, fontWeight: 700, padding: 0 }}><ArrowLeft size={15} /> {selSym} · {TT("trades", "עסקאות")}</button> as any}>
          {detailQ.isLoading ? <div style={{ color: C.muted, fontSize: 13 }}><Loader2 size={15} className="spin" /></div> : (() => {
            const d: any = detailQ.data || {}; const trades = d.trades || [];
            return (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead><tr>{[TT("Entry", "כניסה"), TT("Exit", "יציאה"), TT("Side", "כיוון"), TT("In", "מחיר כניסה"), TT("Out", "מחיר יציאה"), TT("Return", "תשואה")].map((h, i) => <th key={i} style={th(rtl)}>{h}</th>)}</tr></thead>
                  <tbody>
                    {trades.length === 0 ? <tr><td colSpan={6} style={{ ...td(rtl), color: C.muted }}>{TT("No trades.", "אין עסקאות.")}</td></tr>
                    : trades.map((tr: any, i: number) => (
                      <tr key={i}>
                        <td style={td(rtl)}>{String(tr.entryDate || "").slice(0, 10)}</td>
                        <td style={td(rtl)}>{String(tr.exitDate || "—").slice(0, 10)}</td>
                        <td style={td(rtl)}>{tr.side}</td>
                        <td style={{ ...td(rtl), fontFamily: MONO }}>{tr.entryPrice}</td>
                        <td style={{ ...td(rtl), fontFamily: MONO }}>{tr.exitPrice ?? "—"}</td>
                        <td style={{ ...td(rtl), fontFamily: MONO, color: Number(tr.returnPct) >= 0 ? C.gain : C.loss }}>{tr.returnPct != null ? `${Number(tr.returnPct).toFixed(1)}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </Card>
      ) : (breakoutResults.length > 0 || runResults.length > 0) && (
        <Card title={TT("Results", "תוצאות") + (target === "market10" ? " — " + TT("top 10 market", "טופ 10 שוק") : " — " + TT("today's breakouts", "הפריצות של היום"))}>
          {allFailed && <div style={{ ...errBox, marginBottom: 10 }}>{TT("Every symbol failed: ", "כל הסמלים נכשלו: ")}{firstErr || TT("unknown error", "שגיאה לא ידועה")}</div>}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr>{[t.asset, t.ret, t.cagr, t.maxdd, t.winrate, t.sharpe, t.trades].map((h, i) => <th key={i} style={th(rtl)}>{h}</th>)}</tr></thead>
              <tbody>
                {shownResults.map((r: any) => (
                  r.errorMessage ? (
                    // Surface the REAL backend reason this symbol produced no result
                    // (e.g. insufficient warm-up data) instead of showing 0/0/0.
                    <tr key={r.symbol}>
                      <td style={td(rtl)}>{r.symbol}</td>
                      <td colSpan={6} style={{ ...td(rtl), color: C.loss, fontSize: 12 }}>{r.errorMessage}</td>
                    </tr>
                  ) : (
                  <tr key={r.symbol} onClick={() => { if (target === "market10") setSelSym(r.symbol); }} style={{ cursor: target === "market10" ? "pointer" : "default" }}>
                    <td style={td(rtl)}>{target === "market10" && <ChevronRight size={12} color={C.faint} style={{ marginInlineEnd: 4, verticalAlign: "middle" }} />}{r.symbol}</td>
                    <td style={{ ...td(rtl), fontFamily: MONO, color: r.totalReturn >= 0 ? C.gain : C.loss }}>{pct(r.totalReturn)}</td>
                    <td style={{ ...td(rtl), fontFamily: MONO }}>{pct(r.cagr)}</td>
                    <td style={{ ...td(rtl), fontFamily: MONO, color: C.loss }}>{pct(r.maxDrawdown)}</td>
                    <td style={{ ...td(rtl), fontFamily: MONO }}>{pct(r.winRate)}</td>
                    <td style={{ ...td(rtl), fontFamily: MONO }}>{(r.sharpe ?? 0).toFixed(2)}</td>
                    <td style={{ ...td(rtl), fontFamily: MONO }}>{r.tradeCount}</td>
                  </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
          {target === "market10" && <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8 }}>{TT("Tap a row to see its trades.", "הקליקו על שורה כדי לראות עסקאות.")}</div>}
        </Card>
      )}
      </HubPanel>
      )}

      {/* Save strategy popup */}
      {saveOpen && (
        <div onClick={() => setSaveOpen(false)} style={modalOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard}>
            <div style={{ padding: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}><Save size={17} color={C.gold} /> {TT("Save strategy", "שמירת אסטרטגיה")}</div>
              <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4, marginBottom: 16 }}>{TT("Name it and save — it'll be in your saved strategies, with these properties.", "תנו שם ושמרו — היא תופיע ברשימת האסטרטגיות עם המאפיינים האלו.")}</div>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 12, color: C.muted }}>{TT("Strategy name", "שם האסטרטגיה")}</span>
                <input autoFocus value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder={TT("My breakout strategy", "האסטרטגיה שלי")} style={input} />
              </label>
              <div style={{ marginTop: 12, fontSize: 11.5, color: C.faint, fontFamily: MONO, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px" }}>
                {strategyLabel(config?.strategyId || "bot8c", lang)} · {config?.timeframe || "1d"} · {TT("commission", "עמלה")} {props.commissionPct}% · {TT("size", "גודל")} {props.positionPct}% · {TT("slippage", "החלקה")} {props.slippageTicks}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
                <button onClick={() => setSaveOpen(false)} style={btn()}>{TT("Cancel", "ביטול")}</button>
                <button onClick={() => saveM.mutate()} disabled={saveM.isPending} className="gbtn ptile" style={btn(true)}>{saveM.isPending ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {TT("Save", "שמור")}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Send-to-admin help popup */}
      {helpOpen && (
        <div onClick={() => setHelpOpen(false)} style={modalOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard}>
            <div style={{ padding: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}><LifeBuoy size={17} color={C.gold} /> {TT("Send to admin for help", "שליחה למנהל לעזרה")}</div>
              <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4, marginBottom: 14 }}>{TT("Your current Pine code is attached automatically. Add a note about what you need.", "הקוד הנוכחי שלכם מצורף אוטומטית. הוסיפו הערה על מה שצריך.")}</div>
              <textarea autoFocus value={helpMsg} onChange={(e) => setHelpMsg(e.target.value)} placeholder={TT("e.g. it won't pass Check — can you adapt it to the engine?", "למשל: לא עובר בדיקה — אפשר להתאים למנוע?")} style={{ width: "100%", minHeight: 92, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, color: C.text, fontFamily: "inherit", fontSize: 13, padding: 10, resize: "vertical" }} />
              <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
                <button onClick={() => setHelpOpen(false)} style={btn()}>{TT("Cancel", "ביטול")}</button>
                <button onClick={() => helpM.mutate()} disabled={helpM.isPending} className="gbtn ptile" style={btn(true)}>{helpM.isPending ? <Loader2 size={14} className="spin" /> : <LifeBuoy size={14} />} {TT("Send", "שלח")}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Persistent bottom cluster (like Home): live/demo P&L + Help-Portal, above the tab bar. */}
      <ScreenBottom />
      <Spin />
    </div>
  );
}

function Prop({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><div style={{ fontSize: 11.5, color: C.muted }}>{label}</div><div style={{ fontSize: 14, fontWeight: 700, fontFamily: MONO, color: C.text, marginTop: 3 }}>{value}</div></div>;
}
function EditProp({ label, value, onChange, step = 1 }: { label: string; value: any; onChange: (v: number) => void; step?: number }) {
  return <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={{ fontSize: 11.5, color: C.muted }}>{label}</span><input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={input} /></label>;
}
const modalOverlay: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 9990, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(0,0,0,0.66)", backdropFilter: "blur(4px)" };
const modalCard: React.CSSProperties = { width: "100%", maxWidth: 440, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, boxShadow: "0 24px 64px rgba(0,0,0,0.6)" };

// Premium builder chip — tile-family finish: rounder corners, a 1.5px accent border
// when active, a soft inner top-highlight (idle) / accent glow (active). nowrap keeps
// the run-target labels ("Today's breakouts" / "הפריצות של היום", "Top 10 market" /
// "טופ 10 שוק") on one line, centered with comfortable padding.
function chip(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    background: active ? "var(--btn-bg)" : `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
    color: active ? "var(--btn-ink)" : C.muted, border: `1.5px solid ${active ? C.gold : C.line}`,
    borderRadius: 11, padding: "7px 13px", fontWeight: 700, fontSize: 12.5, whiteSpace: "nowrap",
    cursor: "pointer", fontFamily: "inherit",
    boxShadow: active ? "inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px -12px rgba(0,0,0,0.35)" : "inset 0 1px 0 rgba(255,255,255,0.20)",
  };
}
const pct = (v: any) => `${(typeof v === "number" ? v : 0).toFixed(1)}%`;
const th = (rtl: boolean): React.CSSProperties => ({ padding: "8px 10px", borderBottom: `1px solid ${C.line}`, textAlign: rtl ? "right" : "left", color: C.muted, fontWeight: 500 });
const td = (rtl: boolean): React.CSSProperties => ({ padding: "8px 10px", borderBottom: `1px solid ${C.line}`, textAlign: rtl ? "right" : "left" });
