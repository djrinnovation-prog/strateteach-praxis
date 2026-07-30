import React, { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Bot as BotIcon, ShieldAlert, Plus, Copy, Check, Pause, Play, Power, Trash2,
  ChevronDown, ChevronRight, Crown, Lock, LifeBuoy, X, KeyRound, AlertTriangle,
  Webhook, Braces, Sparkles, BadgeCheck,
} from "lucide-react";
import { api } from "../app/api";
import type { Bot, BotLog } from "../lib/client";
import { useI18n } from "../i18n";
import { C, UI, MONO, SHADOW, RADIUS, onAccent } from "../theme";
import { input, PasswordInput, premSoft } from "../ui";
import ScreenShortcuts from "../components/ScreenShortcuts";
import FramedTitle from "../components/FramedTitle";
import { ClosedLogButton } from "../components/ClosedPositionsLog";
import { GlassTile, TileGrid, homeDim } from "../components/GlassTile";
import SquareRow from "../components/SquareRow";
import { centralExtras } from "../lib/centralExtras";
import ScreenBottom from "../components/ScreenBottom";
import { HubPanel } from "../components/HubScreen";
import { useIsMobile } from "../lib/useIsMobile";
import { ErrorState } from "../components/StateBlock";
import { track } from "../lib/analytics";
import HomeTop from "../components/HomeTop";
import { useViewMode, ViewToggle, type ViewMode } from "../components/ViewToggle";
import { useSearchParams } from "react-router-dom";

const T = (en: string, he: string, lang: string) => (lang === "he" ? he : en);

const EXCHANGES = ["binance", "bybit", "coinbase"] as const;

// ── Illustrative examples for the "How it works" guide ────────────────────────
// The REAL, per-bot Webhook URL + alert JSON are returned by api.createBot and shown
// on the success card / each BotCard (see `r.webhookUrl` / `r.alertTemplate` and
// `bot.webhookUrl`). These two constants mirror that exact shape — same base + path,
// same fixed JSON template with TradingView placeholders — but with a clearly-marked
// <your-bot-token> placeholder, so a user can SEE what they'll paste before creating a
// bot. They are display-only examples, never sent anywhere.
const EXAMPLE_WEBHOOK_URL = "https://app.strateteach.com/signals/webhook/<your-bot-token>";
// Canonical alert Message. The bot is identified by the webhook URL token — NOT a body
// field — so the JSON only needs `action` (buy|sell|close) + `ticker`/`symbol`. The
// backend ignores body `token`/`bot_id`/`qty`/`price`. `"quote": <usdt>` is optional
// (omit → uses the bot's "max per order"). Backend `_alert_template()` returns this exact
// same JSON, so the guide, the create-success screen and every bot card stay consistent.
const ALERT_JSON = [
  "{",
  '  "action": "{{strategy.order.action}}",',
  '  "ticker": "{{ticker}}",',
  '  "position": "{{strategy.market_position}}"',
  "}",
].join("\n");

// One small copy-to-clipboard button with a transient "copied ✓" state. Reused for
// the webhook URL + alert template + per-bot webhook copy.
function CopyBtn({ value, label, lang, block }: { value: string; label?: string; lang: string; block?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); }
    catch { /* clipboard blocked — best effort */ }
    setDone(true); setTimeout(() => setDone(false), 1800);
  };
  return (
    <button onClick={copy} className="tap44" style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
      background: done ? "var(--btn-gain-bg)" : C.surface2, border: `1px solid ${done ? "var(--btn-gain-bd)" : C.line}`,
      color: done ? "var(--btn-gain-ink)" : C.text, borderRadius: 10, padding: "7px 12px",
      fontSize: 12, fontWeight: 700, fontFamily: UI, cursor: "pointer", whiteSpace: "nowrap",
      width: block ? "100%" : undefined,
    }}>
      {done ? <Check size={13} /> : <Copy size={13} />}
      {done ? T("Copied", "הועתק", lang) : (label || T("Copy", "העתק", lang))}
    </button>
  );
}

const usd = (v: number | null | undefined) =>
  v == null || isNaN(v) ? "—" : `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function SignalBots() {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const nav = useNavigate();
  const qc = useQueryClient();
  const mobile = useIsMobile();
  const [sp, setSp] = useSearchParams();
  const sec = sp.get("sec") || "";
  const setSec = (v: string) => setSp(v ? { sec: v } : {});
  const [moreView, setMoreView] = useViewMode("algo770_signalbots_more_view_v1", "cards");

  const entQ = useQuery({ queryKey: ["entitlements"], queryFn: () => api.entitlements() });
  const ent = entQ.data;
  const signalBots = !!(ent as any)?.signalBots || !!(ent?.features || []).includes("signalBots");
  const cap = typeof ent?.bots === "number" ? ent!.bots : null;

  // Only fetch the user's bots once we know they're entitled (avoids a needless 403
  // on the locked upsell state). Polls so P&L / open-position counts stay fresh.
  const botsQ = useQuery({
    queryKey: ["signalBots"],
    queryFn: () => api.listBots(),
    enabled: signalBots,
    refetchInterval: 20000,
    retry: 0,
  });
  const bots: Bot[] = (botsQ.data as any)?.bots || [];
  const totalPnl = bots.reduce((s, b) => s + (Number(b.pnl) || 0), 0);
  const used = bots.length;
  const atCap = cap != null && used >= cap;

  const [showGuide, setShowGuide] = useState(false);
  const [helpSent, setHelpSent] = useState(false);
  const [helpBusy, setHelpBusy] = useState(false);
  // Shared rows/squares view toggle (default cards — bots were card-only before).
  const [view, setView] = useViewMode("algo770_signalbots_view_v1", "cards");
  // Home-methodology hero wiring (re-layout; every target is a REAL existing action).
  const listRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const scrollTo = (r: React.RefObject<HTMLDivElement>) => setTimeout(() => r.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);

  // The global black "Signal Bot" pill (rendered in every ScreenHeader) navigates
  // to /bots from anywhere — but when you're ALREADY here, clicking it dispatches
  // "open-signalbot-guide" instead (see SignalBotButton). We listen for that and
  // pop the premium connect guide. Decoupled via window event → no prop-drilling
  // through ScreenHeader.
  useEffect(() => {
    const open = () => setShowGuide(true);
    window.addEventListener("open-signalbot-guide", open);
    return () => window.removeEventListener("open-signalbot-guide", open);
  }, []);

  const refresh = () => qc.invalidateQueries({ queryKey: ["signalBots"] });

  // Help → the app's built-in user→admin support channel (lands in the admin inbox,
  // private, with a clear ack). chatSend needs a specific recipient username and
  // there's no reliable "admin" account constant, so we use submitFeedback — the
  // existing "message the team" method — tagged to this screen's route.
  async function sendHelp() {
    setHelpBusy(true);
    try {
      await api.submitFeedback(
        T("I need help with Signal Bots", "אני צריך/ה עזרה עם בוטי הסיגנל", lang),
        "/bots",
      );
      setHelpSent(true);
    } catch { /* surface nothing destructive — user can retry */ }
    finally { setHelpBusy(false); }
  }

  // Wait for entitlements before deciding gate-vs-screen (avoids flashing the full
  // UI to a non-entitled user for a frame).
  if (entQ.isLoading) {
    return <div style={{ textAlign: "center", color: C.muted, padding: "60px 0", fontFamily: UI, fontSize: 13 }}>…</div>;
  }

  // ── Locked / upsell state — no create, just explain + route to /plans ──
  if (!signalBots) {
    return (
      <div style={{ direction: rtl ? "rtl" : "ltr", fontFamily: UI, color: C.text }}>
        <FramedTitle text={T("Signal Bots", "בוטי סיגנל", lang)}
          subtitle={T("Automated bots that trade your account from TradingView signals.",
                      "בוטים אוטומטיים שמבצעים מסחר בחשבונך לפי סיגנלים מ-TradingView.", lang)} />
        <div style={{ marginTop: 8, borderRadius: 16, padding: 22, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, border: `1.5px solid ${C.gold}`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.24), ${SHADOW}`, textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 52, height: 52, borderRadius: 14, background: `${C.gold}22`, marginBottom: 12 }}>
            <Lock size={24} color={C.gold} />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 900, margin: "0 0 8px" }}>{T("Signal Bots are a premium feature", "בוטי סיגנל הם פיצ'ר פרימיום", lang)}</h2>
          <p style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.6, margin: "0 auto 16px", maxWidth: 460 }}>
            {T("Connect a trade-only exchange key and let server-side bots place orders automatically whenever your TradingView strategy fires an alert — no computer needed. Upgrade your plan to unlock.",
               "חברו מפתח מסחר-בלבד לבורסה ותנו לבוטים בצד השרת לבצע פקודות אוטומטית בכל פעם שהאסטרטגיה ב-TradingView שולחת התראה — בלי צורך במחשב פתוח. שדרגו את המסלול כדי לפתוח.", lang)}
          </p>
          <button onClick={() => nav("/plans")} className="gbtn ptile" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 22px", border: "none", background: "var(--btn-bg)", color: "var(--btn-ink)", borderRadius: 999, fontWeight: 800, fontSize: 14, fontFamily: UI, cursor: "pointer" }}>
            <Crown size={16} /> {T("View plans & upgrade", "מסלולים ושדרוג", lang)}
          </button>
          <div style={{ marginTop: 14 }}>
            <button onClick={() => setShowGuide(true)} style={{ background: "none", border: "none", color: C.gold, fontWeight: 800, cursor: "pointer", fontFamily: UI, fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Sparkles size={14} /> {T("See how Signal Bots work", "ראו איך בוטי הסיגנל עובדים", lang)}
            </button>
          </div>
        </div>
        {showGuide && <SignalBotGuide lang={lang} rtl={rtl} onClose={() => setShowGuide(false)} />}
      </div>
    );
  }

  const guideHint = (
    <button
      onClick={() => setShowGuide(true)}
      className="tap44"
      aria-label={T("Open the Signal Bot guide", "פתחו את מדריך הסיגנל בוט", lang)}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 44,
        marginBottom: 4, padding: "10px 14px", textAlign: "start", cursor: "pointer",
        background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
        border: `1px solid ${C.goldDim}`, borderRadius: 12, color: C.text, fontFamily: UI,
      }}
    >
      <span aria-hidden style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 30, height: 30, borderRadius: 9, background: `${C.gold}1f`, border: `1px solid ${C.goldDim}` }}>
        <Sparkles size={15} color={C.gold} />
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.5 }}>
        <span style={{ fontWeight: 800 }}>{T("What is this & how do I connect?", "מה זה ואיך מחברים?", lang)}</span>{" "}
        <span style={{ color: C.muted, fontWeight: 600 }}>{T("Tap for a guide", "לחץ להסבר ומדריך חיבור", lang)}</span>
      </span>
      <ChevronRight size={16} color={C.gold} style={{ flexShrink: 0, transform: rtl ? "scaleX(-1)" : "none" }} />
    </button>
  );

  return (
    <div style={{ direction: rtl ? "rtl" : "ltr", fontFamily: UI, color: C.text, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>

      {sec === "" && (
        <>
          <FramedTitle text={T("Signal Bots", "בוטי סיגנל", lang)}
            subtitle={T("Automated · TradingView → your exchange · real orders",
                        "אוטומטי · TradingView ← הבורסה שלך · פקודות אמיתיות", lang)} />

          {/* Closed-log — defaults to this screen's source (Signal Bots), toggles to others. */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}><ClosedLogButton defaultSource="signal_bot" /></div>

          {/* Editable top shortcuts — the "עוד במערכת" chip opens the More CHILD (not a modal). */}
          <ScreenShortcuts
            screenKey="signalbots"
            defaultKeys={["mybots", "guide", "plans", "exchange"]}
            onMore={() => setSec("more")}
            catalog={[
              { key: "mybots", label: T("My bots", "הבוטים שלי", lang), Icon: BotIcon, onClick: () => setSec("list") },
              { key: "webhook", label: "Webhook", Icon: Webhook, onClick: () => (bots.length ? setSec("list") : setShowGuide(true)) },
              { key: "guide", label: T("Guide", "מדריך", lang), Icon: Sparkles, onClick: () => setShowGuide(true) },
              { key: "plans", label: T("Plans", "מסלולים", lang), Icon: Crown, onClick: () => nav("/plans") },
              { key: "help", label: T("Help", "עזרה", lang), Icon: LifeBuoy, onClick: () => sendHelp() },
              { key: "exchange", label: T("Exchange", "בורסה", lang), Icon: KeyRound, onClick: () => nav("/exchange") },
            ]}
          />

          {/* 2 central glass buttons — now EDITABLE via SquareRow (choose which appear + order +
              APPROVE + reset). The screen's own 2 are shown by default; the shared app-destinations
              pool is addable from the ✎ editor. New bot is the bigger primary. */}
          <SquareRow screenKey="signalbots-central" mobile={mobile} defaultShown={["create", "list"]}
            squares={[
              { id: "create", variant: "primary", Icon: Plus, disabled: atCap, label: T("New bot", "בוט חדש", lang), sub: atCap ? T("limit reached", "הגעת למגבלה", lang) : T("webhook bot", "בוט webhook", lang), onClick: () => { if (!atCap) setSec("create"); } },
              { id: "list", variant: "secondary", Icon: BotIcon, label: T("My bots", "הבוטים שלי", lang), sub: T("view & manage", "צפייה וניהול", lang), onClick: () => setSec("list") },
              ...centralExtras(he, nav, { exclude: ["signalbot"] }),
            ]} />

          {guideHint}
          {helpSent && <div style={{ fontSize: 12.5, color: C.gain, fontWeight: 700, textAlign: "center" }}>{T("Help request sent ✓", "בקשת העזרה נשלחה ✓", lang)}</div>}
        </>
      )}

      {/* ── "עוד במערכת" CHILD — the bot areas as a tile grid with a rows/tiles toggle. ── */}
      {sec === "more" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FramedTitle text={he ? "עוד במערכת" : "More"} subtitle={he ? "כל אזורי הבוטים" : "All bot areas"} />
          <div style={{ display: "flex", justifyContent: "flex-end", margin: "2px 2px 0" }}>
            <ViewToggle view={moreView} onChange={setMoreView} he={he} />
          </div>
          <TileGrid screenKey="signalbots-more" view={moreView} columns={3} aspect={1.08} tiles={[
            { id: "create", label: T("New bot", "בוט חדש", lang), Icon: Plus, onClick: () => { if (!atCap) setSec("create"); } },
            { id: "list", label: T("My bots", "הבוטים שלי", lang), Icon: BotIcon, onClick: () => setSec("list") },
            { id: "guide", label: T("Guide", "מדריך", lang), Icon: Sparkles, onClick: () => setShowGuide(true) },
            { id: "plans", label: T("Plans", "מסלולים", lang), Icon: Crown, onClick: () => nav("/plans") },
            { id: "exchange", label: T("Exchange", "בורסה", lang), Icon: KeyRound, onClick: () => nav("/exchange") },
            { id: "help", label: T("Help", "עזרה", lang), Icon: LifeBuoy, onClick: () => sendHelp() },
          ]} />
        </div>
      )}

      {/* ── CREATE CHILD — the webhook-bot create wizard. ── */}
      {sec === "create" && (
        <HubPanel alwaysOpen ns="signalbots" id="create" title={T("New bot", "בוט חדש", lang)} icon={<Plus size={15} />} onClose={() => setSec("list")}>
          <CreateBot lang={lang} onClose={() => setSec("list")} onCreated={refresh} />
        </HubPanel>
      )}

      {/* ── MY-BOTS CHILD — P&L + real-money disclaimer + summary + the bots list. ── */}
      {sec === "list" && (
      <HubPanel alwaysOpen ns="signalbots" id="list" title={T("My bots", "הבוטים שלי", lang)} icon={<BotIcon size={15} />} onClose={() => setSec("")}>
      {guideHint}
      {/* P&L (תיק) card — same home balance card, collapsed by default. */}
      <HomeTop />

      {/* Persistent real-money disclaimer (not dismissible). */}
      <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "11px 14px", borderRadius: 12, marginBottom: 14,
        background: "rgba(240,97,109,0.10)", border: "1px solid rgba(240,97,109,0.45)", color: C.text }}>
        <ShieldAlert size={18} style={{ color: C.loss, flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
          <strong>{T("These bots place REAL orders on your connected exchange account.",
                     "הבוטים האלה מבצעים פקודות אמיתיות בחשבון הבורסה המחובר שלך.", lang)}</strong>{" "}
          {T("Use a dedicated, trade-only API key with withdrawals DISABLED (ideally a separate sub-account). Algorithmic trading involves risk; past performance does not guarantee future results.",
             "השתמשו במפתח API ייעודי למסחר-בלבד עם משיכות מושבתות (רצוי בתת-חשבון נפרד). מסחר אלגוריתמי כרוך בסיכון; ביצועי עבר אינם מבטיחים תוצאות עתידיות.", lang)}
        </div>
      </div>

      {/* Summary — total P&L · count · X / cap used */}
      <div ref={summaryRef} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16, scrollMarginTop: 8 }}>
        <SummaryCell label={T("Total P&L", "רווח/הפסד כולל", lang)}
          value={bots.length ? usd(totalPnl) : "—"} color={bots.length ? (totalPnl >= 0 ? C.gain : C.loss) : C.muted} />
        <SummaryCell label={T("Active bots", "בוטים פעילים", lang)}
          value={String(bots.filter((b) => b.status === "active").length)} />
        <SummaryCell label={T("Bots used", "בוטים בשימוש", lang)}
          value={cap != null ? `${used} / ${cap}` : String(used)}
          color={atCap ? C.loss : undefined} />
      </div>

      {/* The create wizard now lives in its own ?sec=create child (reached from "New bot"). */}
      {atCap && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: `${C.gold}14`, border: `1px solid ${C.goldDim}`, color: C.muted, fontSize: 12.5, marginBottom: 14 }}>
          {T(`You've reached your plan's bot limit (${cap}). Upgrade for more, or delete a bot to free a slot.`,
             `הגעת למגבלת הבוטים של המסלול (${cap}). שדרגו לעוד, או מחקו בוט כדי לפנות מקום.`, lang)}{" "}
          <button onClick={() => nav("/plans")} style={{ background: "none", border: "none", color: C.gold, fontWeight: 800, cursor: "pointer", fontFamily: UI, fontSize: 12.5, padding: 0 }}>{T("View plans →", "למסלולים →", lang)}</button>
        </div>
      )}

      {/* Bots list */}
      <div ref={listRef} aria-hidden style={{ scrollMarginTop: 8 }} />
      {botsQ.isError ? (
        <ErrorState onRetry={() => botsQ.refetch()} retrying={botsQ.isFetching} screen="signalbots"
          title={T("Couldn't load your bots", "לא הצלחנו לטעון את הבוטים", lang)} />
      ) : botsQ.isLoading ? (
        <div style={{ textAlign: "center", color: C.muted, padding: "40px 0", fontSize: 13 }}>{T("Loading your bots…", "טוען את הבוטים שלך…", lang)}</div>
      ) : bots.length === 0 ? (
        <div style={{ background: C.surface, border: `1px dashed ${C.line}`, borderRadius: 14, padding: 32, textAlign: "center", color: C.muted }}>
          <BotIcon size={28} style={{ opacity: 0.6, marginBottom: 8 }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>{T("No bots yet", "אין בוטים עדיין", lang)}</div>
          <div style={{ fontSize: 12.5 }}>{T("Create your first bot to get a TradingView webhook URL.", "צרו את הבוט הראשון כדי לקבל כתובת webhook ל-TradingView.", lang)}</div>
          <button onClick={() => setShowGuide(true)} style={{ marginTop: 12, background: "none", border: `1px solid ${C.goldDim}`, color: C.gold, fontWeight: 800, cursor: "pointer", fontFamily: UI, fontSize: 12.5, borderRadius: 999, padding: "8px 16px", display: "inline-flex", alignItems: "center", gap: 7 }} className="tap44">
            <Sparkles size={14} /> {T("How it works", "איך זה עובד", lang)}
          </button>
        </div>
      ) : (
        <>
          {/* Rows/squares toggle — sits just above the list. */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
            <ViewToggle view={view} onChange={setView} he={lang === "he"} />
          </div>
          <div style={view === "cards"
            ? { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", alignItems: "start" }
            : { display: "flex", flexDirection: "column", gap: 12 }}>
            {bots.map((b) => <BotCard key={String(b.id)} bot={b} lang={lang} rtl={rtl} view={view} onChanged={refresh} />)}
          </div>
        </>
      )}
      </HubPanel>
      )}

      {showGuide && (
        <SignalBotGuide
          lang={lang}
          rtl={rtl}
          onClose={() => setShowGuide(false)}
          onNewBot={atCap ? undefined : () => { setShowGuide(false); setSec("create"); }}
        />
      )}

      {/* Persistent bottom cluster (like Home): live/demo P&L + Help-Portal, above the tab bar. */}
      <ScreenBottom />
    </div>
  );
}

// ── Premium "How it works" connect guide (modal) ──────────────────────────────
// Opened by clicking the global black Signal Bot pill while ALREADY on /bots, or
// from the empty-state / locked "How it works" affordance. On-brand glossy-black +
// gold-star header to match SignalBotButton, with a numbered 5-step connect flow.
// Skinned via C.*, bilingual HE/EN, RTL-correct (direction + logical insets),
// scrollable, 44px tap targets.
function SignalBotGuide({ lang, rtl, onClose, onNewBot }: {
  lang: string; rtl: boolean; onClose: () => void; onNewBot?: () => void;
}) {
  // Close on Escape (mobile + desktop nicety).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const steps: { icon: React.ReactNode; title: string; body: string; extra?: React.ReactNode }[] = [
    {
      icon: <BotIcon size={15} color="#fff" />,
      title: T("What is a Signal Bot?", "מה זה סיגנל בוט?", lang),
      body: T(
        "A server-side bot that receives your TradingView signal and opens REAL positions for you — isolated in a dedicated sub-account with a trade-only key.",
        "בוט בצד השרת שמקבל את הסיגנל שלך מ-TradingView ופותח עבורך פוזיציות אמיתיות — מבודד בתת-חשבון ייעודי עם מפתח למסחר-בלבד.",
        lang),
    },
    {
      icon: <KeyRound size={15} color="#fff" />,
      title: T("Connect a sub-account", "חיבור תת-חשבון", lang),
      body: T(
        "Open a separate sub-account at your exchange, create a trade-only API key (withdrawals OFF), and fund it with the capital the bot should manage.",
        "פתחו תת-חשבון נפרד בבורסה, צרו מפתח API למסחר-בלבד (משיכות מושבתות), ומממנו אותו בהון שהבוט אמור לנהל.",
        lang),
    },
    {
      icon: <Webhook size={15} color="#fff" />,
      title: T("Paste the Webhook", "הדבקת ה-Webhook", lang),
      body: T(
        "Copy the bot's Webhook URL and paste it into your TradingView alert. Each bot's Webhook lives on its own bot card below.",
        "העתיקו את כתובת ה-Webhook של הבוט והדביקו אותה בהתראה ב-TradingView. ה-Webhook של כל בוט נמצא בכרטיס הבוט שלו למטה.",
        lang),
      extra: (
        <>
          <GuideCodeBox value={EXAMPLE_WEBHOOK_URL} lang={lang} caption={T("Example format", "פורמט לדוגמה", lang)} />
          <div style={{ marginTop: 7, fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
            {T("Your real, unique webhook appears on the bot card right after you create the bot.",
               "ה-Webhook הייחודי האמיתי שלך מופיע בכרטיס הבוט מיד אחרי שתיצור אותו.", lang)}
          </div>
        </>
      ),
    },
    {
      icon: <Braces size={15} color="#fff" />,
      title: T("Set the alert message", "הגדרת ההודעה", lang),
      body: T(
        "Copy the JSON alert message and paste it into the alert's Message field — it tells the bot exactly what to buy or sell. Also on the bot card.",
        "העתיקו את הודעת ה-JSON והדביקו אותה בשדה ההודעה של ההתראה — היא אומרת לבוט בדיוק מה לקנות או למכור. גם כן בכרטיס הבוט.",
        lang),
      extra: (
        <>
          <GuideCodeBox value={ALERT_JSON} lang={lang} copy caption={T("Alert message (JSON)", "הודעת התראה (JSON)", lang)} />
          <div style={{ marginTop: 7, fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
            {T("Fixed template — paste once; TradingView auto-fills symbol/side. Order size is chosen on the bot: Fixed ($ per order) or 100% of balance (each BUY spends ~all your free USDT — spot, long-only). You can still add an optional \"quote\": <usdt> line to override a single alert.",
               "תבנית קבועה — מדביקים פעם אחת; TradingView ממלא אוטומטית את הסימבול/הכיוון. גודל הפקודה נקבע על הבוט: קבוע ($ לפקודה) או 100% מהיתרה (כל קנייה משתמשת ב~כל ה-USDT הפנוי — ספוט, לונג בלבד). אפשר עדיין להוסיף שורת \"quote\": <usdt> אופציונלית לעקיפת התראה בודדת.", lang)}
          </div>
        </>
      ),
    },
    {
      icon: <BadgeCheck size={15} color="#fff" />,
      title: T("Done & verify", "סיום ובדיקה", lang),
      body: T(
        "Save the alert. Once it fires you'll see ✓ Connected with the last-signal time, and the trades log fills in automatically.",
        "שמרו את ההתראה. ברגע שהיא תופעל תראו ✓ מחובר עם זמן הסיגנל האחרון, ויומן העסקאות יתמלא אוטומטית.",
        lang),
    },
  ];

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 60, direction: rtl ? "rtl" : "ltr",
        background: "rgba(4,4,6,0.62)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: UI }}
      role="dialog" aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto", borderRadius: 20,
          background: C.surface, border: `1px solid ${C.gold}55`, color: C.text,
          boxShadow: `0 24px 64px -16px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.4)` }}
      >
        {/* Glossy-black hero — mirrors the SignalBotButton brand (deep gloss + gold star). */}
        <div style={{ position: "relative", overflow: "hidden", padding: "20px 20px 22px",
          background: "linear-gradient(180deg, #34343a 0%, #161619 42%, #050506 100%)",
          borderBottom: `1px solid ${C.gold}55` }}>
          <style>{
            "@keyframes sbgTwinkle{0%,100%{opacity:.55;transform:scale(.82) rotate(0deg)}50%{opacity:1;transform:scale(1.18) rotate(10deg)}}" +
            ".sbg-star{animation:sbgTwinkle 1.9s ease-in-out infinite}" +
            "@media (prefers-reduced-motion:reduce){.sbg-star{animation:none!important;opacity:1!important;transform:none!important}}"
          }</style>
          {/* top gloss sheen */}
          <span aria-hidden style={{ position: "absolute", insetInlineStart: 0, insetInlineEnd: 0, top: 0, height: "46%",
            background: "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 100%)", pointerEvents: "none" }} />
          <button onClick={onClose} className="tap44" aria-label={T("Close", "סגור", lang)}
            style={{ position: "absolute", top: 12, insetInlineEnd: 12, display: "flex", alignItems: "center", justifyContent: "center",
              width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.18)", cursor: "pointer" }}>
            <X size={16} color="#fff" />
          </button>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span aria-hidden className="sbg-star" style={{ color: C.gold, fontSize: 20, lineHeight: 1,
              textShadow: `0 0 6px ${C.gold}, 0 0 12px ${C.gold}aa` }}>★</span>
            <span style={{ color: "#fff", fontSize: 19, fontWeight: 900, letterSpacing: "0.01em" }}>
              {T("Signal Bot", "סיגנל בוט", lang)}
            </span>
          </div>
          <p style={{ position: "relative", margin: "9px 0 0", color: "rgba(255,255,255,0.74)", fontSize: 13, lineHeight: 1.55, maxWidth: 440 }}>
            {T("Turn your TradingView alerts into real trades — automatically, even while your computer is off. Here's how to connect one in 5 steps.",
               "הפכו את ההתראות שלכם מ-TradingView לעסקאות אמיתיות — אוטומטית, גם כשהמחשב כבוי. כך מחברים בוט ב-5 שלבים.", lang)}
          </p>
        </div>

        {/* Steps */}
        <div style={{ padding: "18px 18px 8px", display: "flex", flexDirection: "column", gap: 14 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
              <div style={{ position: "relative", flexShrink: 0, width: 38, height: 38, borderRadius: 12,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "linear-gradient(180deg, #2c2c31 0%, #0c0c0e 100%)",
                border: `1px solid ${C.gold}66`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.18), 0 0 14px -4px ${C.gold}66` }}>
                {s.icon}
                <span style={{ position: "absolute", top: -7, insetInlineEnd: -7, minWidth: 19, height: 19, padding: "0 4px",
                  borderRadius: 999, background: C.gold, color: onAccent(C.gold), fontSize: 11, fontWeight: 900,
                  display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }}>{i + 1}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 3 }}>{s.title}</div>
                <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6 }}>{s.body}</div>
                {s.extra}
              </div>
            </div>
          ))}
        </div>

        {/* Target state — a mock "connected & healthy" bot card so the user sees the
            finish line: exactly what a working bot looks like after step 5. */}
        <div style={{ padding: "14px 18px 0" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 9, display: "flex", alignItems: "center", gap: 7 }}>
            <BadgeCheck size={15} color={C.gold} style={{ flexShrink: 0 }} />
            {T("This is what a connected, working bot looks like after setup",
               "כך נראה בוט מחובר ותקין אחרי הקמה", lang)}
          </div>
          <MockHealthyBotCard lang={lang} />
        </div>

        {/* Trade-only safety reminder */}
        <div style={{ margin: "14px 18px 0", display: "flex", gap: 9, alignItems: "flex-start", padding: "10px 13px", borderRadius: 12,
          background: "rgba(240,97,109,0.10)", border: "1px solid rgba(240,97,109,0.40)" }}>
          <ShieldAlert size={16} style={{ color: C.loss, flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 11.5, lineHeight: 1.5, color: C.text }}>
            {T("Bots place REAL orders. Always use a trade-only key with withdrawals disabled, on a dedicated sub-account.",
               "הבוטים מבצעים פקודות אמיתיות. השתמשו תמיד במפתח למסחר-בלבד עם משיכות מושבתות, בתת-חשבון ייעודי.", lang)}
          </div>
        </div>

        {/* Footer actions */}
        <div style={{ padding: 18, display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {onNewBot && (
            <button onClick={onNewBot} className="gbtn ptile tap44"
              style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 20px", border: "none",
                background: "var(--btn-bg)", color: "var(--btn-ink)", borderRadius: 999, fontWeight: 800, fontSize: 13, fontFamily: UI, cursor: "pointer" }}>
              <Plus size={15} /> {T("Create a bot", "צרו בוט", lang)}
            </button>
          )}
          <button onClick={onClose} className="tap44"
            style={{ ...premSoft(), color: C.text, padding: "10px 20px", fontSize: 13, fontWeight: 800, fontFamily: UI, cursor: "pointer" }}>
            {T("Got it", "הבנתי", lang)}
          </button>
        </div>
      </div>
    </div>
  );
}

// A monospace example/code box used inside the guide (LTR + break-all so URLs/JSON
// stay readable even in RTL). Optional caption label + copy button.
function GuideCodeBox({ value, lang, copy, caption }: {
  value: string; lang: string; copy?: boolean; caption?: string;
}) {
  return (
    <div style={{ marginTop: 9, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 11, padding: 10 }}>
      {(caption || copy) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
          {caption ? <span style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{caption}</span> : <span />}
          {copy && <CopyBtn value={value} lang={lang} />}
        </div>
      )}
      <div style={{
        fontFamily: MONO, fontSize: 11.5, color: C.text, lineHeight: 1.55,
        whiteSpace: "pre-wrap", wordBreak: "break-all", direction: "ltr", textAlign: "left",
        background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px",
      }}>{value}</div>
    </div>
  );
}

// A faux "connected & healthy" bot card shown in the guide so the user sees the target
// state. ILLUSTRATIVE ONLY — clearly badged "Example", not real data. Mirrors the real
// BotCard layout (icon + name + green status pill + exchange · sub-account) with a
// last-signal line and a compact trades log.
function MockHealthyBotCard({ lang }: { lang: string }) {
  const trades = [
    { side: "BUY", symbol: "BTCUSDT", pct: "+1.2%" },
    { side: "SELL", symbol: "ETHUSDT", pct: "+0.6%" },
    { side: "BUY", symbol: "SOLUSDT", pct: "+2.1%" },
  ];
  return (
    <div style={{ position: "relative", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: RADIUS.lg, padding: 14, boxShadow: SHADOW }}>
      {/* Clearly-marked example badge so this is never mistaken for a live bot */}
      <span style={{ position: "absolute", top: 10, insetInlineEnd: 10, fontSize: 9.5, fontWeight: 900, letterSpacing: "0.05em",
        textTransform: "uppercase", color: C.gold, background: `${C.gold}1f`, border: `1px solid ${C.goldDim}`, borderRadius: 999, padding: "2px 8px" }}>
        {T("Example", "דוגמה", lang)}
      </span>

      {/* Header: icon + name + green Connected pill */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", paddingInlineEnd: 66 }}>
        <BotIcon size={16} color={C.gold} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 14.5, fontWeight: 800 }}>BTC Breakout Bot</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.04em",
          textTransform: "uppercase", padding: "3px 9px", borderRadius: 999,
          color: "var(--btn-gain-ink)", background: "var(--btn-gain-bg)", border: "1px solid var(--btn-gain-bd)" }}>
          <Check size={11} /> {T("Connected", "מחובר", lang)}
        </span>
      </div>

      {/* Exchange · sub-account + last-signal line */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", margin: "9px 0 12px" }}>
        <span style={{ fontSize: 11.5, color: C.muted }}>Binance · Bot-1</span>
        <span style={{ fontSize: 11.5, color: C.gain, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: C.gain, boxShadow: `0 0 7px ${C.gain}` }} />
          {T("last signal: 2m ago", "סיגנל אחרון: לפני 2 דק׳", lang)}
        </span>
      </div>

      {/* Mini trades log */}
      <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 7 }}>
        {trades.map((t, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12, direction: "ltr", textAlign: "left" }}>
            <span style={{ minWidth: 38, fontFamily: MONO, fontWeight: 800, fontSize: 10.5, letterSpacing: "0.03em",
              color: t.side === "BUY" ? C.gain : C.loss }}>{t.side}</span>
            <span style={{ fontFamily: MONO, color: C.text }}>{t.symbol}</span>
            <Check size={12} color={C.gain} style={{ flexShrink: 0 }} />
            <span style={{ marginInlineStart: "auto", fontFamily: MONO, fontWeight: 700, color: C.gain }}>{t.pct}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryCell({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "13px 15px" }}>
      <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || C.text, fontFamily: MONO }}>{value}</div>
    </div>
  );
}

// ── Create-bot wizard (inline card) ───────────────────────────────────────────
function CreateBot({ lang, onClose, onCreated }: {
  lang: string; onClose: () => void; onCreated: () => void;
}) {
  const [label, setLabel] = useState("");
  const [exchange, setExchange] = useState<typeof EXCHANGES[number]>("binance");
  const [market, setMarket] = useState("spot");
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [subAccount, setSubAccount] = useState("");
  const [maxQuote, setMaxQuote] = useState("");
  const [maxOpen, setMaxOpen] = useState("");
  // Order-size mode: 'fixed' (maxQuote per order) or 'balance_pct' (100% of the free
  // USDT balance per BUY — SPOT LONG-ONLY). Default keeps the existing fixed behaviour.
  const [sizeMode, setSizeMode] = useState<"fixed" | "balance_pct">("fixed");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ webhookUrl: string; alertTemplate: string; note?: string } | null>(null);

  const needsPassphrase = exchange === "coinbase";
  const canSubmit = label.trim() && key.trim() && secret.trim() && (!needsPassphrase || passphrase.trim());

  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setErr("");
    try {
      const r = await api.createBot({
        label: label.trim(),
        key: key.trim(),
        secret: secret.trim(),
        passphrase: needsPassphrase ? passphrase.trim() : undefined,
        exchange,
        market: market || undefined,
        subAccount: subAccount.trim() || undefined,
        maxQuote: maxQuote ? Number(maxQuote) : undefined,
        maxOpen: maxOpen ? Number(maxOpen) : undefined,
        sizeMode,
        sizePct: sizeMode === "balance_pct" ? 100 : undefined,
      });
      setResult({ webhookUrl: r.webhookUrl, alertTemplate: r.alertTemplate, note: r.note });
      track("bot_create", { source: "webhook" });
      try { if (!localStorage.getItem("algo770_first_value")) { localStorage.setItem("algo770_first_value", "bot"); track("first_value_action", { action: "bot_create" }); } } catch (_e) { /* */ }
      onCreated();
    } catch (e: any) {
      setErr(e?.message || T("Couldn't create the bot. Check your keys and try again.", "לא ניתן ליצור את הבוט. בדקו את המפתחות ונסו שוב.", lang));
    } finally { setBusy(false); }
  }

  const card: React.CSSProperties = {
    background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
    border: `1.5px solid ${C.gold}`, borderRadius: 16, padding: 18, marginBottom: 16,
    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.24), ${SHADOW}`,
  };

  // ── Success: prominently show the webhook URL + alert template + paste steps ──
  if (result) {
    return (
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
            <Check size={18} color={C.gain} />
            <span style={{ fontSize: 16, fontWeight: 900 }}>{T("Bot created — connect it to TradingView", "הבוט נוצר — חברו אותו ל-TradingView", lang)}</span>
          </div>
          <button onClick={onClose} className="tap44" style={iconBtn}><X size={16} color={C.muted} /></button>
        </div>

        <ol style={{ margin: "0 0 14px", paddingInlineStart: 20, fontSize: 13, color: C.text, lineHeight: 1.7 }}>
          <li>{T("In TradingView, open your alert and turn on", "ב-TradingView פתחו את ההתראה והפעילו את", lang)} <strong>“Webhook URL”</strong>.</li>
          <li>{T("Paste this URL as the Webhook URL:", "הדביקו כתובת זו כ-Webhook URL:", lang)}</li>
        </ol>
        <FieldBox label={T("Webhook URL", "כתובת Webhook", lang)} value={result.webhookUrl} lang={lang} />

        <ol start={3} style={{ margin: "12px 0 14px", paddingInlineStart: 20, fontSize: 13, color: C.text, lineHeight: 1.7 }}>
          <li>{T("Paste this JSON as the alert Message:", "הדביקו JSON זה כהודעת ההתראה:", lang)}</li>
        </ol>
        <FieldBox label={T("Alert message (JSON)", "הודעת התראה (JSON)", lang)} value={result.alertTemplate} lang={lang} multiline />

        {result.note && (
          <div style={{ marginTop: 12, fontSize: 12, color: C.muted, lineHeight: 1.55, display: "flex", gap: 7 }}>
            <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{result.note}</span>
          </div>
        )}

        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} className="gbtn ptile" style={{ padding: "10px 22px", border: "none", background: "var(--btn-bg)", color: "var(--btn-ink)", borderRadius: 999, fontWeight: 800, fontSize: 13.5, fontFamily: UI, cursor: "pointer" }}>
            {T("Done", "סיום", lang)}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 16, fontWeight: 900, display: "inline-flex", alignItems: "center", gap: 8 }}><Plus size={17} color={C.gold} /> {T("New Signal Bot", "בוט סיגנל חדש", lang)}</span>
        <button onClick={onClose} className="tap44" style={iconBtn}><X size={16} color={C.muted} /></button>
      </div>

      {/* Strong, non-dismissible safety note on the form itself */}
      <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "11px 13px", borderRadius: 11, marginBottom: 16,
        background: "rgba(240,97,109,0.10)", border: "1px solid rgba(240,97,109,0.45)" }}>
        <KeyRound size={17} style={{ color: C.loss, flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12, lineHeight: 1.55, color: C.text }}>
          <strong>{T("Use a trade-only API key with withdrawals DISABLED.", "השתמשו במפתח API למסחר-בלבד עם משיכות מושבתות.", lang)}</strong>{" "}
          {T("This bot places REAL orders. Create a dedicated key (ideally on a separate sub-account) with trading enabled but withdrawals and transfers turned off. Your keys are stored securely and never shown again.",
             "הבוט הזה מבצע פקודות אמיתיות. צרו מפתח ייעודי (רצוי בתת-חשבון נפרד) עם מסחר מאופשר אך משיכות והעברות מושבתות. המפתחות נשמרים בבטחה ולא יוצגו שוב.", lang)}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <Lbl label={T("Label", "שם", lang)}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={T("e.g. BTC swing bot", "למשל בוט BTC", lang)} style={input} />
        </Lbl>
        <Lbl label={T("Exchange", "בורסה", lang)}>
          <select value={exchange} onChange={(e) => setExchange(e.target.value as any)} style={{ ...input, cursor: "pointer" }}>
            {EXCHANGES.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
          </select>
        </Lbl>
        <Lbl label={T("Market", "שוק", lang)}>
          <select value={market} onChange={(e) => setMarket(e.target.value)} style={{ ...input, cursor: "pointer" }}>
            <option value="spot">{T("Spot", "ספוט", lang)}</option>
          </select>
        </Lbl>
        <Lbl label={T("Sub-account (optional)", "תת-חשבון (אופציונלי)", lang)}>
          <input value={subAccount} onChange={(e) => setSubAccount(e.target.value)} placeholder={T("dedicated sub-account", "תת-חשבון ייעודי", lang)} style={input} />
        </Lbl>
        <Lbl label={T("API key", "מפתח API", lang)}>
          <input value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder="API key" style={{ ...input, fontFamily: MONO, fontSize: 12.5 }} />
        </Lbl>
        <Lbl label={T("API secret", "סוד API", lang)}>
          <PasswordInput value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} placeholder="API secret" style={{ ...input, fontFamily: MONO, fontSize: 12.5 }} />
        </Lbl>
        {needsPassphrase && (
          <Lbl label={T("Passphrase (Coinbase)", "Passphrase (Coinbase)", lang)}>
            <PasswordInput value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="off" spellCheck={false} placeholder="passphrase" style={{ ...input, fontFamily: MONO, fontSize: 12.5 }} />
          </Lbl>
        )}
        <Lbl label={T("Order size", "גודל פקודה", lang)}>
          <div style={{ display: "flex", gap: 8 }}>
            {([["fixed", T("Fixed ($)", "קבוע ($)", lang)], ["balance_pct", T("100% of balance", "100% מהיתרה", lang)]] as const).map(([m, lbl]) => (
              <button key={m} type="button" onClick={() => setSizeMode(m)} className="tap44"
                style={{ flex: 1, minHeight: 44, borderRadius: 10, cursor: "pointer", fontFamily: UI, fontSize: 12, fontWeight: 800, lineHeight: 1.15,
                  border: `1.5px solid ${sizeMode === m ? C.gold : C.line}`,
                  background: sizeMode === m ? `${C.gold}1f` : C.surface2, color: sizeMode === m ? C.text : C.muted }}>
                {lbl}
              </button>
            ))}
          </div>
        </Lbl>
        {sizeMode === "fixed" ? (
          <Lbl label={T("Max quote per order ($)", "מקס׳ לפקודה ($)", lang)}>
            <input value={maxQuote} onChange={(e) => setMaxQuote(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder={T("e.g. 100", "למשל 100", lang)} style={{ ...input, fontFamily: MONO }} />
          </Lbl>
        ) : (
          <Lbl label={T("How much per buy", "כמה בכל קנייה", lang)}>
            <div style={{ minHeight: 44, boxSizing: "border-box", display: "flex", alignItems: "center", padding: "8px 12px", borderRadius: 10, border: `1px solid ${C.gold}66`, background: `${C.gold}12`, color: C.text, fontSize: 11.5, lineHeight: 1.4 }}>
              {T("Each BUY spends ~100% of your free USDT (a small fee buffer is kept). Sell/close exits the whole position. Spot, long-only.",
                 "כל קנייה משתמשת ב~100% מיתרת ה-USDT הפנויה (נשמר באפר קטן לעמלות). מכירה/סגירה סוגרת את כל הפוזיציה. ספוט, לונג בלבד.", lang)}
            </div>
          </Lbl>
        )}
        <Lbl label={T("Max open positions", "מקס׳ פוזיציות פתוחות", lang)}>
          <input value={maxOpen} onChange={(e) => setMaxOpen(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder={T("e.g. 3", "למשל 3", lang)} style={{ ...input, fontFamily: MONO }} />
        </Lbl>
      </div>

      {err && <div style={{ marginTop: 14, background: `${C.loss}1f`, border: `1px solid ${C.loss}66`, color: C.loss, borderRadius: 9, padding: "9px 12px", fontSize: 12.5, fontFamily: MONO }}>{err}</div>}

      <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button onClick={onClose} style={{ ...premSoft(), color: C.text, padding: "10px 18px", fontSize: 13, fontFamily: UI, cursor: "pointer" }}>{T("Cancel", "ביטול", lang)}</button>
        <button onClick={submit} disabled={!canSubmit || busy} className="gbtn ptile"
          style={{ padding: "10px 22px", border: "none", background: "var(--btn-bg)", color: "var(--btn-ink)", borderRadius: 999, fontWeight: 800, fontSize: 13.5, fontFamily: UI, cursor: (!canSubmit || busy) ? "not-allowed" : "pointer", opacity: (!canSubmit || busy) ? 0.55 : 1 }}>
          {busy ? "…" : T("Create bot", "צור בוט", lang)}
        </button>
      </div>
    </div>
  );
}

function Lbl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}

// A read-only value box with a copy button (and optional multiline for the JSON).
function FieldBox({ label, value, lang, multiline }: {
  label: string; value: string; lang: string; multiline?: boolean;
}) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
        <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 700 }}>{label}</span>
        <CopyBtn value={value} lang={lang} />
      </div>
      <div style={{
        fontFamily: MONO, fontSize: 12, color: C.text, wordBreak: "break-all",
        whiteSpace: multiline ? "pre-wrap" : "nowrap", overflowX: multiline ? "visible" : "auto",
        background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", direction: "ltr", textAlign: "left",
      }}>{value}</div>
    </div>
  );
}

const iconBtn: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8, background: C.surface2, border: `1px solid ${C.line}`, cursor: "pointer" };

// ── Single bot card ───────────────────────────────────────────────────────────
function BotCard({ bot, lang, rtl, view = "cards", onChanged }: { bot: Bot; lang: string; rtl: boolean; view?: ViewMode; onChanged: () => void }) {
  const [busy, setBusy] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  // LIST view = compact tap-to-open row (mirrors AutoPilots' list, and stays distinct from the
  // cards grid on mobile). CARDS view = the full detail card, always expanded (prior behavior).
  const listMode = view === "list";
  const [open, setOpen] = useState(false);
  const active = bot.status === "active";
  const pnlColor = (Number(bot.pnl) || 0) >= 0 ? C.gain : C.loss;

  const logsQ = useQuery({
    queryKey: ["botLogs", bot.id],
    queryFn: () => api.botLogs(bot.id),
    enabled: showLogs,
  });
  const logs: BotLog[] = (logsQ.data as any)?.logs || [];

  async function run(kind: string, fn: () => Promise<any>) {
    setBusy(kind);
    try { await fn(); onChanged(); }
    catch (e: any) { alert(e?.message || T("Action failed", "הפעולה נכשלה", lang)); }
    finally { setBusy(""); }
  }

  const toggleStatus = () => run("status", () => api.updateBot(bot.id, { status: active ? "paused" : "active" }));
  const kill = () => {
    if (!confirm(T("Kill this bot? It will be paused and stop placing new orders.", "להרוג את הבוט? הוא יושהה ויפסיק לבצע פקודות חדשות.", lang))) return;
    run("kill", () => api.killBot(bot.id));
  };
  const del = () => {
    if (!confirm(T(`Delete "${bot.label}"? This removes the bot and its keys permanently.`, `למחוק את "${bot.label}"? הפעולה מסירה את הבוט והמפתחות לצמיתות.`, lang))) return;
    run("del", () => api.deleteBot(bot.id));
  };

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: RADIUS.lg, padding: listMode && !open ? "11px 14px" : 16, boxShadow: SHADOW }}>
      {/* LIST view: compact tap-to-open summary row (label · status · P&L · chevron). */}
      {listMode && (
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="tap44"
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: UI, textAlign: rtl ? "right" : "left" }}>
          <BotIcon size={16} color={C.gold} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 14.5, fontWeight: 800, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bot.label}</span>
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", padding: "2px 8px", borderRadius: 999, flexShrink: 0,
            color: active ? "var(--btn-gain-ink)" : C.muted, background: active ? "var(--btn-gain-bg)" : C.surface2, border: `1px solid ${active ? "var(--btn-gain-bd)" : C.line}` }}>
            {active ? T("Active", "פעיל", lang) : T("Paused", "מושהה", lang)}
          </span>
          <span style={{ marginInlineStart: "auto", fontSize: 14, fontWeight: 800, fontFamily: MONO, color: pnlColor, flexShrink: 0 }}>{usd(bot.pnl)}</span>
          {open ? <ChevronDown size={16} color={C.muted} style={{ flexShrink: 0 }} /> : <ChevronRight size={16} color={C.muted} style={{ flexShrink: 0, transform: rtl ? "scaleX(-1)" : "none" }} />}
        </button>
      )}

      {(!listMode || open) && (
      <>
      {/* Header row: label + status pill — CARDS view only (list uses the summary row above). */}
      {!listMode && (
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <BotIcon size={17} color={C.gold} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 15.5, fontWeight: 800, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{bot.label}</span>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", padding: "3px 9px", borderRadius: 999,
          color: active ? "var(--btn-gain-ink)" : C.muted, background: active ? "var(--btn-gain-bg)" : C.surface2, border: `1px solid ${active ? "var(--btn-gain-bd)" : C.line}` }}>
          {active ? T("Active", "פעיל", lang) : T("Paused", "מושהה", lang)}
        </span>
        <span style={{ fontSize: 11.5, color: C.muted, marginInlineStart: "auto" }}>
          {bot.exchange}{bot.market ? ` · ${bot.market}` : ""}{bot.subAccount ? ` · ${bot.subAccount}` : ""}
        </span>
      </div>
      )}
      {/* LIST expanded: keep the exchange context the compact row omits. */}
      {listMode && (
        <div style={{ fontSize: 11, color: C.muted, marginTop: 10 }}>
          {bot.exchange}{bot.market ? ` · ${bot.market}` : ""}{bot.subAccount ? ` · ${bot.subAccount}` : ""}
        </div>
      )}

      {/* Metrics row */}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", margin: "13px 0" }}>
        <Metric label={T("P&L", "רווח/הפסד", lang)} value={usd(bot.pnl)} color={pnlColor} />
        <Metric label={T("Trades", "עסקאות", lang)} value={String(bot.trades ?? 0)} />
        <Metric label={T("Open positions", "פוזיציות פתוחות", lang)} value={String(bot.openPositions ?? 0)} />
        <Metric label={T("Order size", "גודל פקודה", lang)}
          value={bot.sizeMode === "balance_pct"
            ? T("100% balance", "100% מהיתרה", lang)
            : (bot.maxQuote ? usd(bot.maxQuote) : T("Fixed", "קבוע", lang))}
          color={bot.sizeMode === "balance_pct" ? C.gold : undefined} />
        <Metric label={T("Keys", "מפתחות", lang)}
          value={bot.hasKey && bot.hasSecret ? T("Set ✓", "מוגדר ✓", lang) : T("Missing", "חסר", lang)}
          color={bot.hasKey && bot.hasSecret ? C.gain : C.loss} />
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={toggleStatus} disabled={!!busy} className="tap44" style={actBtn()}>
          {active ? <Pause size={14} /> : <Play size={14} />} {busy === "status" ? "…" : (active ? T("Pause", "השהה", lang) : T("Resume", "המשך", lang))}
        </button>
        {bot.webhookUrl && <CopyBtn value={bot.webhookUrl} label={T("Copy webhook URL", "העתק webhook", lang)} lang={lang} />}
        {/* Canonical alert JSON is token-independent (the URL identifies the bot), so it's
            available on every card — Dan can grab the ready-to-paste TradingView Message
            from any existing bot, not just the create-success screen. */}
        <CopyBtn value={ALERT_JSON} label={T("Copy alert JSON", "העתק JSON התראה", lang)} lang={lang} />
        {/* Trades-log / P&L table is COLLAPSED by default (showLogs starts false); this
            is the explicit enlarge/collapse toggle. The persistent metrics row above
            (P&L · Trades · Open positions) stays visible as the one-line summary when
            collapsed. Matches the in-file chevron collapsible pattern. */}
        <button onClick={() => setShowLogs((v) => !v)} className="tap44" style={actBtn()}
          aria-expanded={showLogs}
          title={showLogs ? T("Collapse trades log", "הקטן יומן עסקאות", lang) : T("Expand trades log", "הגדל יומן עסקאות", lang)}>
          {showLogs ? <ChevronDown size={14} /> : <ChevronRight size={14} style={{ transform: rtl ? "scaleX(-1)" : "none" }} />}
          {showLogs
            ? T("Collapse", "הקטן", lang)
            : T(`Trades log (${bot.trades ?? 0}) · Expand`, `יומן עסקאות (${bot.trades ?? 0}) · הגדל`, lang)}
        </button>
        <button onClick={kill} disabled={!!busy} className="tap44" style={actBtn(C.gold)}>
          <Power size={14} /> {busy === "kill" ? "…" : T("Kill", "עצור", lang)}
        </button>
        <button onClick={del} disabled={!!busy} className="tap44" style={{ ...actBtn(), color: C.loss, borderColor: "rgba(240,97,109,0.4)", marginInlineStart: "auto" }}>
          <Trash2 size={14} /> {busy === "del" ? "…" : T("Delete", "מחק", lang)}
        </button>
      </div>

      {/* Logs expander */}
      {showLogs && (
        <div style={{ marginTop: 14, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
          {logsQ.isLoading ? (
            <div style={{ color: C.muted, fontSize: 12.5, padding: "8px 0" }}>{T("Loading trades…", "טוען עסקאות…", lang)}</div>
          ) : logs.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 12.5, padding: "8px 0" }}>{T("No trades yet for this bot.", "אין עסקאות עדיין לבוט זה.", lang)}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, direction: rtl ? "rtl" : "ltr" }}>
                <thead>
                  <tr style={{ color: C.muted, textAlign: rtl ? "right" : "left" }}>
                    <Th>{T("Symbol", "נכס", lang)}</Th>
                    <Th>{T("Side", "כיוון", lang)}</Th>
                    <Th>{T("Opened", "נפתח", lang)}</Th>
                    <Th>{T("Closed", "נסגר", lang)}</Th>
                    <Th>{T("P&L", "רווח/הפסד", lang)}</Th>
                    <Th>{T("Status", "סטטוס", lang)}</Th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l, i) => {
                    const p = l.pnl == null ? null : Number(l.pnl);
                    return (
                      <tr key={i} style={{ borderTop: `1px solid ${C.line}` }}>
                        <Td mono>{l.symbol || "—"}</Td>
                        <Td>{l.side || "—"}</Td>
                        <Td>{fmt(l.opened_at)}</Td>
                        <Td>{fmt(l.closed_at)}</Td>
                        <Td mono color={p == null ? C.muted : p >= 0 ? C.gain : C.loss}>
                          {p == null ? "—" : usd(p)}{l.pnl_pct != null ? ` (${Number(l.pnl_pct) >= 0 ? "+" : ""}${Number(l.pnl_pct).toFixed(2)}%)` : ""}
                        </Td>
                        <Td>{l.status || "—"}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: color || C.text, fontFamily: MONO }}>{value}</div>
    </div>
  );
}

const actBtn = (accent?: string): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 6, background: C.surface2,
  border: `1px solid ${accent ? `${accent}66` : C.line}`, color: accent || C.text,
  borderRadius: 10, padding: "7px 12px", fontSize: 12, fontWeight: 700, fontFamily: UI, cursor: "pointer", whiteSpace: "nowrap",
});

const Th = ({ children }: { children: React.ReactNode }) => (
  <th style={{ padding: "6px 10px", fontWeight: 700, fontSize: 11, whiteSpace: "nowrap" }}>{children}</th>
);
const Td = ({ children, mono, color }: { children: React.ReactNode; mono?: boolean; color?: string }) => (
  <td style={{ padding: "6px 10px", color: color || C.text, fontFamily: mono ? MONO : UI, whiteSpace: "nowrap" }}>{children}</td>
);

function fmt(ts?: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(+d)) return "—";
  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
