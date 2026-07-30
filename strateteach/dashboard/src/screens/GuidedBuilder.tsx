import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  GraduationCap, Check, ChevronLeft, ChevronRight, RotateCcw, Sparkles, Info,
  TrendingUp, Activity, Shield, Target, Clock, Coins, PlayCircle, BookOpen, Loader2, FlaskConical,
} from "lucide-react";
import { C, UI, MONO } from "../theme";
import { SimBadge, RiskDisclaimer } from "../ui";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import ScreenBottom from "../components/ScreenBottom";

// Map the user's transparent choices → real demo-session settings.
const STOP_PCT: Record<string, number> = { tight: 2, normal: 4, wide: 7 };
const TP_PCT: Record<string, number> = { quick: 3, balanced: 6, runner: 9 };
const MAX_POS: Record<string, number> = { small: 1, moderate: 2, bold: 3 };

// ── THE USER'S CHOICES → THE REAL ENGINE PARAMETERS ──────────────────────────
// Every step below drives an ACTUAL parameter of the Gaussian-channel engine
// (strategy 1 / bot1), not a cosmetic label. This is what makes the built
// strategy genuinely the user's own: their answers change how the engine
// behaves, and the backtest then runs THOSE parameters over real history.
//
//  trend     → Gaussian channel width + poles + the SMA regime filter
//  momentum  → reductionLevel, which drives bot1's real ADX/RSI thresholds
//              (High → ADX 35 / RSI 60 strict … Low → ADX 20 / RSI 80 loose)
//  timeframe → chart interval + the Gaussian sampling period that suits it
//  stop      → ATR-multiple hard stop      target → risk:reward multiple of it
//  size      → order size as % of equity
const TREND_CFG: Record<string, Record<string, unknown>> = {
  strong: { useSmaFilter: true, ftrMultiplier: 1.9, poles: 8 },
  medium: { useSmaFilter: true, ftrMultiplier: 1.414, poles: 6 },
  any: { useSmaFilter: false, ftrMultiplier: 1.1, poles: 4 },
};
// bot8c reads useAdxFilter + adxThreshold directly (reductionLevel is a bot1/bot4
// shorthand), so momentum is expressed as a real ADX gate: a higher threshold means
// the engine only enters on a genuinely strong thrust.
const MOMENTUM_CFG: Record<string, Record<string, unknown>> = {
  confirmed: { useAdxFilter: true, adxThreshold: 30, confirmBarsLong: 2 },
  early: { useAdxFilter: false, adxThreshold: 20, confirmBarsLong: 1 },
};
const TF_CFG: Record<string, Record<string, unknown>> = {
  "15m": { timeframe: "15m", samplingPeriod: 60 },
  "1h": { timeframe: "1h", samplingPeriod: 100 },
  "1d": { timeframe: "1d", samplingPeriod: 143 }, // bot1's published default
};
const STOP_MULT: Record<string, number> = { tight: 1.2, normal: 2.0, wide: 3.0 };
const RR_MULT: Record<string, number> = { quick: 1.0, balanced: 2.0, runner: 3.0 };
const SIZE_PCT: Record<string, number> = { small: 5, moderate: 10, bold: 20 };

// The market universe the breakout scan runs over. Breadth is the whole point of a
// breakout strategy — a single symbol has almost nothing to break out of.
// NOTE: this does NOT bypass compliance. When the owner-controlled "BTC-only" switch
// is ON, the backend still narrows restricted clients to BTC (paper.py, bots.py,
// exchange.py all enforce it), so this stays a product choice, not a legal one.
const BUCKETS: Record<string, string[]> = {
  crypto: ["crypto"],
  stocks: ["stocks"],
  all: ["crypto", "stocks", "metals", "commodities"],
};

/** Build the REAL StrategyConfig the backtest engine runs, from the user's picks. */
function buildStrategyConfig(picks: Record<string, string>): Record<string, unknown> {
  const stopMult = STOP_MULT[picks.stop] ?? 2.0;
  return {
    strategyId: "bot8c",         // the client-facing Gaussian-channel engine ("Strategy 1")
    enableShorts: false,         // long-only for the client-built strategy
    ...(TREND_CFG[picks.trend] ?? TREND_CFG.medium),
    ...(MOMENTUM_CFG[picks.momentum] ?? MOMENTUM_CFG.confirmed),
    ...(TF_CFG[picks.timeframe] ?? TF_CFG["1d"]),
    useHardStop: true,
    longStopMult: stopMult,
    useLongTP: true,
    longTpMult: stopMult * (RR_MULT[picks.target] ?? 2.0),
    positionPct: SIZE_PCT[picks.size] ?? 10,
  };
}

// ── GUIDED STRATEGY BUILDER — learn-and-approve, TRANSPARENT, DEMO-ONLY ───────
// The regulatory posture (Raz meeting, 16.7): a platform must not DECIDE for the
// user — the USER must exercise judgment. This screen makes that real and honest:
// at every step the user LEARNS a concept in plain language, makes an informed
// CHOICE, and explicitly APPROVES it. The result is a strategy THE USER ASSEMBLED,
// shown back to them in full ("the strategy you built") with every choice and the
// reason for it. Nothing is hidden; the user is never told they are "just picking"
// while secretly reproducing a built-in strategy — that concealment is exactly the
// deception that would turn a licensing question into a fraud exposure, so it is
// deliberately absent. This is education + self-directed configuration, in DEMO /
// simulation only — no real money, no live order path.

type Choice = { id: string; he: string; en: string; heWhy: string; enWhy: string };
type Step = {
  key: string; Icon: any;
  heTitle: string; enTitle: string;
  heLearn: string; enLearn: string;   // the teaching — what this concept IS, plainly
  heWhy: string; enWhy: string;       // why it matters to YOUR decision
  choices: Choice[];
};

// The user picks the market universe themselves (breadth is the point of a breakout
// strategy). Narrowing to BTC is handled by the owner-controlled compliance switch on
// the server, NOT hard-coded here — so the legal posture stays a deliberate, auditable
// decision rather than an invisible product constraint.
// Each step teaches ONE real trading concept the user then decides on.
const STEPS: Step[] = [
  {
    key: "asset", Icon: Coins,
    heTitle: "השוק", enTitle: "The market",
    heLearn: "פריצה = מחיר שפורץ מטווח שבו נסחר לאורך זמן. ככל שסורקים יותר נכסים, כך מוצאים יותר פריצות אמיתיות — לכן רוחב השוק הוא לב האסטרטגיה הזו.",
    enLearn: "A breakout is price escaping a range it traded in for a long time. The more assets you scan, the more real breakouts you find — so market breadth is the heart of this strategy.",
    heWhy: "אתה בוחר איפה לחפש פריצות. יותר רוחב = יותר הזדמנויות, אבל גם יותר לעקוב.",
    enWhy: "You choose where to hunt for breakouts. More breadth = more opportunities, but more to follow.",
    choices: [
      { id: "crypto", he: "קריפטו", en: "Crypto", heWhy: "פעיל 24/7, תנודתי ונזיל", enWhy: "24/7, volatile and liquid" },
      { id: "stocks", he: "מניות", en: "Stocks", heWhy: "פריצות נקיות, שעות מסחר קבועות", enWhy: "clean breakouts, fixed hours" },
      { id: "all", he: "כל השווקים", en: "All markets", heWhy: "הכי הרבה פריצות — קריפטו, מניות, מתכות וסחורות", enWhy: "most breakouts — crypto, stocks, metals, commodities" },
    ],
  },
  {
    key: "trend", Icon: TrendingUp,
    heTitle: "מסנן מגמה", enTitle: "Trend filter",
    heLearn: "מגמה = לאן השוק נוטה לאורך זמן — עולה, יורד, או דשדוש. 'מסנן מגמה' אומר לך: לסחור רק כשהכיוון ברור. זה מקטין כניסות מבולבלות בשוק ללא כיוון.",
    enLearn: "A trend is where the market leans over time — up, down, or sideways. A 'trend filter' says: only trade when the direction is clear. It cuts noisy entries in a directionless market.",
    heWhy: "אתה מחליט כמה שמרן להיות: לסחור רק עם מגמה חזקה, או גם בתנועות קטנות.",
    enWhy: "You decide how conservative to be: trade only strong trends, or smaller moves too.",
    choices: [
      { id: "strong", he: "רק מגמה חזקה", en: "Strong trend only", heWhy: "פחות עסקאות, בטוח יותר", enWhy: "fewer trades, safer" },
      { id: "medium", he: "מגמה בינונית ומעלה", en: "Medium trend and up", heWhy: "איזון בין הזדמנויות לסיכון", enWhy: "balance of opportunity and risk" },
      { id: "any", he: "כל תנועה עם כיוון", en: "Any directional move", heWhy: "יותר עסקאות, יותר רעש", enWhy: "more trades, more noise" },
    ],
  },
  {
    key: "momentum", Icon: Activity,
    heTitle: "מומנטום (עוצמה)", enTitle: "Momentum",
    heLearn: "מומנטום = כמה 'חזק' המחיר זז כרגע. כשהמומנטום גבוה, תנועה נוטה להימשך; כשהוא נחלש, לרוב קרוב היפוך. זה עוזר לתזמן כניסה.",
    enLearn: "Momentum is how 'strongly' price is moving right now. High momentum tends to continue; fading momentum often precedes a reversal. It helps time an entry.",
    heWhy: "אתה בוחר אם להיכנס רק כשיש דחיפה ברורה, או גם מוקדם יותר.",
    enWhy: "You choose whether to enter only on clear thrust, or a bit earlier.",
    choices: [
      { id: "confirmed", he: "רק דחיפה מאושרת", en: "Confirmed thrust only", heWhy: "כניסה מאוחרת אך בטוחה", enWhy: "later but safer entry" },
      { id: "early", he: "כניסה מוקדמת", en: "Earlier entry", heWhy: "רווח פוטנציאלי גדול, סיכון גדול", enWhy: "bigger upside, bigger risk" },
    ],
  },
  {
    key: "stop", Icon: Shield,
    heTitle: "סטופ-לוס (הגנה)", enTitle: "Stop-loss",
    heLearn: "סטופ-לוס = הרשת שלך. זה הגבול שבו אתה יוצא מעסקה מפסידה כדי לא לתת להפסד לגדול. זה אולי הכלי הכי חשוב בניהול-סיכון.",
    enLearn: "A stop-loss is your safety net — the line where you exit a losing trade so the loss can't grow. It may be the single most important risk tool.",
    heWhy: "אתה מחליט כמה אתה מוכן להפסיד בכל עסקה. ההחלטה הזו היא כולה שלך.",
    enWhy: "You decide how much you're willing to lose per trade. This decision is entirely yours.",
    choices: [
      { id: "tight", he: "צמוד (‎1-2%‎)", en: "Tight (1-2%)", heWhy: "הפסד קטן, יוצא מהר", enWhy: "small loss, exits fast" },
      { id: "normal", he: "רגיל (‎3-5%‎)", en: "Normal (3-5%)", heWhy: "מרחב-נשימה סביר", enWhy: "reasonable breathing room" },
      { id: "wide", he: "רחב (‎6-8%‎)", en: "Wide (6-8%)", heWhy: "פחות יציאות שווא, הפסד גדול יותר", enWhy: "fewer false exits, larger loss" },
    ],
  },
  {
    key: "target", Icon: Target,
    heTitle: "יעד-רווח", enTitle: "Take-profit",
    heLearn: "יעד-רווח = מתי לקחת את הרווח הביתה. בלי יעד, קל להפוך עסקה מרוויחה למפסידה. זה מגדיר את 'המחיר של להצליח'.",
    enLearn: "A take-profit is when you bank the gain. Without one it's easy to turn a winner into a loser. It defines what 'winning' looks like.",
    heWhy: "אתה בוחר את היחס בין הסיכון לרווח שמתאים לך.",
    enWhy: "You choose the risk-to-reward ratio that suits you.",
    choices: [
      { id: "quick", he: "מהיר (יחס 1:1)", en: "Quick (1:1)", heWhy: "רווחים קטנים ותכופים", enWhy: "small frequent gains" },
      { id: "balanced", he: "מאוזן (יחס 1:2)", en: "Balanced (1:2)", heWhy: "רווח כפול מהסיכון", enWhy: "reward double the risk" },
      { id: "runner", he: "שאפתני (יחס 1:3)", en: "Ambitious (1:3)", heWhy: "פחות פגיעות, גדולות יותר", enWhy: "fewer hits, bigger ones" },
    ],
  },
  {
    key: "timeframe", Icon: Clock,
    heTitle: "מסגרת-זמן", enTitle: "Timeframe",
    heLearn: "מסגרת-הזמן = כמה 'מהר' האסטרטגיה חושבת. גרף של 15 דקות = הרבה עסקאות מהירות; גרף יומי = מעט עסקאות, איטיות ורגועות.",
    enLearn: "The timeframe is how 'fast' the strategy thinks. A 15-minute chart = many quick trades; a daily chart = few, slow, calm ones.",
    heWhy: "אתה מתאים את הקצב לזמן ולאופי שלך — לא כל אחד בנוי למסחר מהיר.",
    enWhy: "You match the pace to your time and temperament — fast trading isn't for everyone.",
    choices: [
      { id: "15m", he: "‎15 דקות‎", en: "15 minutes", heWhy: "מהיר, דורש תשומת-לב", enWhy: "fast, needs attention" },
      { id: "1h", he: "שעה", en: "1 hour", heWhy: "קצב בינוני", enWhy: "medium pace" },
      { id: "1d", he: "יומי", en: "Daily", heWhy: "רגוע, לטווח ארוך", enWhy: "calm, longer-term" },
    ],
  },
  {
    key: "size", Icon: Coins,
    heTitle: "גודל פוזיציה", enTitle: "Position size",
    heLearn: "גודל-פוזיציה = כמה מהתיק אתה שם בכל עסקה. זה הכפתור שהכי משפיע על הסיכון הכולל — יותר מכל אינדיקטור.",
    enLearn: "Position size is how much of your portfolio goes into each trade. It's the dial that affects total risk most — more than any indicator.",
    heWhy: "אתה קובע כמה חשיפה נוחה לך. שמרנות כאן היא לרוב ההחלטה החכמה.",
    enWhy: "You set the exposure you're comfortable with. Being conservative here is usually the smart call.",
    choices: [
      { id: "small", he: "קטן (‎5%‎ לעסקה)", en: "Small (5%/trade)", heWhy: "הגנה מקסימלית", enWhy: "maximum protection" },
      { id: "moderate", he: "בינוני (‎10%‎)", en: "Moderate (10%)", heWhy: "איזון נפוץ", enWhy: "common balance" },
      { id: "bold", he: "אגרסיבי (‎20%‎)", en: "Bold (20%)", heWhy: "חשיפה גבוהה — רק אם אתה מבין את הסיכון", enWhy: "high exposure — only if you understand the risk" },
    ],
  },
];

function card(extra?: React.CSSProperties): React.CSSProperties {
  return { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: 18,
    boxShadow: "0 14px 34px -26px rgba(0,0,0,0.5)", ...extra };
}

export default function GuidedBuilder() {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const nav = useNavigate();
  const [step, setStep] = useState(-1);                 // -1 = intro, STEPS.length = summary
  const [picks, setPicks] = useState<Record<string, string>>({ asset: "crypto" });
  const [approved, setApproved] = useState<Record<string, boolean>>({});

  const Fwd = rtl ? ChevronLeft : ChevronRight;
  const Back = rtl ? ChevronRight : ChevronLeft;
  const T = (h: string, e: string) => (he ? h : e);

  const total = STEPS.length;
  const inSteps = step >= 0 && step < total;
  const cur = inSteps ? STEPS[step] : null;
  const curPick = cur ? picks[cur.key] : undefined;
  const curApproved = cur ? approved[cur.key] : false;

  const reset = () => { setStep(-1); setPicks({ asset: "crypto" }); setApproved({}); };

  // ── INTRO ──────────────────────────────────────────────────────────────────
  if (step === -1) {
    return (
      <div style={{ maxWidth: 780, margin: "0 auto", direction: rtl ? "rtl" : "ltr", fontFamily: UI }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}><SimBadge /></div>
        <div style={{ ...card(), textAlign: "center" }}>
          <span style={{ width: 60, height: 60, borderRadius: 18, display: "inline-grid", placeItems: "center",
            background: `${C.gold}18`, border: `1px solid ${C.gold}44`, marginBottom: 12 }}>
            <GraduationCap size={28} color={C.gold} />
          </span>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, margin: "0 0 8px" }}>
            {T("בונה האסטרטגיה שלך", "Build your strategy")}
          </h1>
          <p style={{ fontSize: 14.5, lineHeight: 1.7, color: C.muted, margin: "0 0 6px" }}>
            {T("לא נבנה בשבילך אסטרטגיה — נלמד אותך צעד-צעד כל מרכיב, ואתה תבחר ותאשר כל אחד בעצמך. בסוף תקבל אסטרטגיה שאתה בנית, ותבין בדיוק למה.",
               "We won't build a strategy for you — we'll teach you each piece step by step, and you'll choose and approve each one yourself. At the end you get a strategy you built, and you'll understand exactly why.")}
          </p>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 800, color: C.gold,
            background: `${C.gold}12`, border: `1px solid ${C.gold}33`, borderRadius: 999, padding: "6px 13px", margin: "8px 0 4px" }}>
            <Info size={14} /> {T("אתה מקבל את ההחלטות — המערכת רק מלמדת ומנגישה", "You make the decisions — the system only teaches and enables")}
          </div>
        </div>

        <div style={{ ...card({ marginTop: 14 }) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <BookOpen size={17} color={C.gold} />
            <span style={{ fontSize: 15, fontWeight: 900, color: C.text }}>{T("מה נלמד יחד", "What we'll learn together")}</span>
          </div>
          <div style={{ display: "grid", gap: 9, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%,150px),1fr))" }}>
            {STEPS.map((s, i) => (
              <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 9, background: C.surface2,
                border: `1px solid ${C.line}`, borderRadius: 12, padding: "9px 11px" }}>
                <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center",
                  background: `${C.blue}16`, border: `1px solid ${C.blue}33`, flexShrink: 0 }}>
                  <s.Icon size={15} color={C.blue} />
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text }}>{i + 1}. {T(s.heTitle, s.enTitle)}</span>
              </div>
            ))}
          </div>
        </div>

        <button onClick={() => setStep(0)} className="tap44"
          style={{ marginTop: 16, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9,
            background: C.gold, color: onGold(), border: "none", borderRadius: 14, padding: "15px 18px",
            fontSize: 16, fontWeight: 900, cursor: "pointer", fontFamily: UI }}>
          <Sparkles size={18} /> {T("בוא נתחיל ללמוד", "Let's start learning")}
        </button>
        <div style={{ marginTop: 12 }}><RiskDisclaimer /></div>
        <ScreenBottom />
      </div>
    );
  }

  // ── SUMMARY — "the strategy YOU built" (once all steps are done) ────────────
  if (step >= total) {
    return <Summary he={he} rtl={rtl} picks={picks} nav={nav} reset={reset} T={T} />;
  }

  // ── A LEARN-AND-APPROVE STEP ────────────────────────────────────────────────
  // From here `cur` is guaranteed non-null (intro + summary are handled above).
  if (!cur) return null;
  return (
    <div style={{ maxWidth: 780, margin: "0 auto", direction: rtl ? "rtl" : "ltr", fontFamily: UI }}>
      {/* progress */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: C.muted }}>{T("שלב", "Step")} {step + 1}/{total}</span>
        <div style={{ flex: 1, height: 7, borderRadius: 999, background: C.surface2, overflow: "hidden", border: `1px solid ${C.line}` }}>
          <div style={{ width: `${((step + (curApproved ? 1 : 0)) / total) * 100}%`, height: "100%",
            background: `linear-gradient(90deg, ${C.gold}, ${C.gain})`, transition: "width .3s" }} />
        </div>
        <SimBadge />
      </div>

      <div style={card()}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12 }}>
          <span style={{ width: 44, height: 44, borderRadius: 13, display: "grid", placeItems: "center",
            background: `${C.gold}18`, border: `1px solid ${C.gold}44`, flexShrink: 0 }}>
            <cur.Icon size={21} color={C.gold} />
          </span>
          <h2 style={{ fontSize: 19, fontWeight: 900, color: C.text, margin: 0 }}>{T(cur.heTitle, cur.enTitle)}</h2>
        </div>

        {/* LEARN */}
        <div style={{ background: `${C.blue}0e`, border: `1px solid ${C.blue}33`, borderRadius: 14, padding: "13px 15px", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
            <BookOpen size={14} color={C.blue} />
            <span style={{ fontSize: 12.5, fontWeight: 900, color: C.blue }}>{T("מה זה", "What it is")}</span>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: C.text, margin: 0 }}>{T(cur.heLearn, cur.enLearn)}</p>
        </div>
        <div style={{ background: `${C.gold}0e`, border: `1px solid ${C.gold}33`, borderRadius: 14, padding: "12px 15px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
            <Info size={14} color={C.gold} />
            <span style={{ fontSize: 12.5, fontWeight: 900, color: C.gold }}>{T("למה זה ההחלטה שלך", "Why it's your call")}</span>
          </div>
          <p style={{ fontSize: 13.5, lineHeight: 1.65, color: C.muted, margin: 0 }}>{T(cur.heWhy, cur.enWhy)}</p>
        </div>

        {/* CHOOSE */}
        <div style={{ fontSize: 13, fontWeight: 900, color: C.text, marginBottom: 9 }}>{T("הבחירה שלך:", "Your choice:")}</div>
        <div style={{ display: "grid", gap: 9 }}>
          {cur.choices.map((c) => {
            const picked = curPick === c.id;
            const only = cur.choices.length === 1;
            return (
              <button key={c.id} onClick={() => { setPicks((p) => ({ ...p, [cur.key]: c.id })); setApproved((a) => ({ ...a, [cur.key]: false })); }}
                className="tap44"
                style={{ display: "flex", alignItems: "flex-start", gap: 11, textAlign: rtl ? "right" : "left", width: "100%",
                  background: picked ? `${C.gold}12` : C.surface2, border: `1.5px solid ${picked ? C.gold : C.line}`,
                  borderRadius: 13, padding: "12px 14px", cursor: only ? "default" : "pointer", fontFamily: UI }}>
                <span style={{ width: 22, height: 22, borderRadius: 999, flexShrink: 0, marginTop: 1, display: "grid", placeItems: "center",
                  background: picked ? C.gold : "transparent", border: `2px solid ${picked ? C.gold : C.faint}` }}>
                  {picked && <Check size={13} color={onGold()} />}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14.5, fontWeight: 900, color: C.text }}>{T(c.he, c.en)}</span>
                  <span style={{ display: "block", fontSize: 12.5, color: C.muted, marginTop: 1 }}>{T(c.heWhy, c.enWhy)}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* APPROVE — the explicit act of judgment */}
        <button onClick={() => setApproved((a) => ({ ...a, [cur.key]: true }))} disabled={!curPick} className="tap44"
          style={{ marginTop: 14, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
            background: curApproved ? `${C.gain}18` : (curPick ? C.gain : C.surface2),
            color: curApproved ? C.gain : (curPick ? onGain() : C.faint),
            border: `1px solid ${curApproved ? C.gain : (curPick ? C.gain : C.line)}`,
            borderRadius: 13, padding: "13px 16px", fontSize: 14.5, fontWeight: 900,
            cursor: curPick ? "pointer" : "not-allowed", fontFamily: UI }}>
          <Check size={16} /> {curApproved ? T("אישרת — הבנת ובחרת", "Approved — you understood and chose") : T("הבנתי, ואני מאשר את הבחירה", "I understand, and I approve my choice")}
        </button>
      </div>

      {/* nav */}
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button onClick={() => setStep((s) => s - 1)} className="tap44"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.surface, color: C.muted,
            border: `1px solid ${C.line}`, borderRadius: 13, padding: "12px 16px", fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: UI }}>
          <Back size={16} /> {T("חזור", "Back")}
        </button>
        <button onClick={() => setStep((s) => s + 1)} disabled={!curApproved} className="tap44"
          style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
            background: curApproved ? C.gold : C.surface2, color: curApproved ? onGold() : C.faint,
            border: `1px solid ${curApproved ? C.gold : C.line}`, borderRadius: 13, padding: "12px 16px",
            fontSize: 14.5, fontWeight: 900, cursor: curApproved ? "pointer" : "not-allowed", fontFamily: UI }}>
          {step === total - 1 ? T("סיים ובנה", "Finish + build") : T("הבא", "Next")} <Fwd size={16} />
        </button>
      </div>
      <ScreenBottom />
    </div>
  );
}

// ── SUMMARY — "the strategy YOU built" + run it in a REAL demo session ────────
function Summary({ he, rtl, picks, nav, reset, T }: {
  he: boolean; rtl: boolean; picks: Record<string, string>; nav: (p: string) => void;
  reset: () => void; T: (h: string, e: string) => string;
}) {
  const slPct = STOP_PCT[picks.stop] ?? 4;
  const tpPct = TP_PCT[picks.target] ?? 6;
  const maxPos = MAX_POS[picks.size] ?? 1;
  const [done, setDone] = useState<null | { count: number; msg: string }>(null);

  // Run the built strategy as a REAL paper/demo session (simulation, no real money):
  // the user's transparent choices become the session's stop/target/size, focused on BTC.
  const run = useMutation({
    mutationFn: () => api.paperStart({
      capital: 1000, buckets: BUCKETS[picks.asset] ?? ["crypto"], maxPositions: maxPos,
      strategy: "bot8c",           // the client-facing Gaussian-channel engine ("Strategy 1")
      stopLossEnabled: true, stopLossMode: "pct", stopLossValue: slPct,
      takeProfitEnabled: true, takeProfitPct: tpPct,
      label: he ? "האסטרטגיה שבניתי" : "The strategy I built",
    }),
    onSuccess: (r: any) => setDone({ count: (r?.sessions || []).length, msg: "" }),
    onError: (e: any) => setDone({ count: 0, msg: e?.message || "" }),
  });

  // ── LIVE DEMO ENGINE (in-screen) ───────────────────────────────────────────
  // Once the demo session starts we poll it, so the user watches THEIR strategy
  // trade right here. This IS the trading engine as the client will see it.
  const live = useQuery({
    queryKey: ["gb-paper"],
    queryFn: () => api.paperSessions(),
    enabled: !!done && done.count > 0,
    refetchInterval: 5000,
  });

  // BACKTEST the strategy the user actually built: their answers become REAL
  // engine parameters (see buildStrategyConfig) and run over real history.
  // Results render INSIDE this screen — the user is never thrown out.
  const [btErr, setBtErr] = useState<string>("");
  const [runId, setRunId] = useState<string | null>(null);
  const [btRes, setBtRes] = useState<any[] | null>(null);

  const prog = useQuery({
    queryKey: ["gb-run", runId],
    queryFn: () => api.runProgress(runId as string),
    enabled: !!runId && !btRes,
    refetchInterval: 2000,
  });

  const progStatus = String((prog.data as any)?.status || "");
  useEffect(() => {
    if (!runId || btRes) return;
    if (progStatus === "completed" || progStatus === "failed" || progStatus === "cancelled") {
      api.results(runId, undefined, "totalReturn", "desc")
        .then((r: any) => setBtRes(Array.isArray(r) ? r : []))
        .catch(() => setBtRes([]));
    }
  }, [progStatus, runId, btRes]);

  // SAVE the built strategy so it becomes a real asset the user owns: it joins their
  // strategy list and can be re-run from the Trading Engine / Scanner any time. This
  // also strengthens the regulatory posture — the strategy is recorded as THEIRS.
  const [savedId, setSavedId] = useState<number | null>(null);
  const [saveErr, setSaveErr] = useState<string>("");
  const save = useMutation({
    mutationFn: () => api.saveStrategy(
      he ? "האסטרטגיה שבניתי" : "The strategy I built",
      buildStrategyConfig(picks) as any,
    ),
    onSuccess: (s: any) => setSavedId(Number(s?.id ?? 0) || 0),
    onError: (e: any) => setSaveErr(e?.message || T("השמירה נכשלה, נסה שוב.", "Saving failed, please try again.")),
  });

  const backtest = useMutation({
    mutationFn: () => api.createRun(
      BUCKETS[picks.asset] ?? ["crypto"],
      buildStrategyConfig(picks) as any,
      undefined,
      he ? "האסטרטגיה שבניתי" : "The strategy I built",
    ),
    onSuccess: (r: any) => { setBtRes(null); setRunId(String(r?.id ?? "")); },
    onError: (e: any) => setBtErr(
      String(e?.message || "").includes("403")
        ? T("בקטסט זמין במסלול בתשלום — שדרג כדי לבחון את האסטרטגיה על היסטוריה.",
            "Backtesting is available on a paid plan — upgrade to test your strategy on history.")
        : (e?.message || T("הבדיקה נכשלה, נסה שוב.", "The test failed, please try again.")),
    ),
  });

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", direction: rtl ? "rtl" : "ltr", fontFamily: UI }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}><SimBadge /></div>
      <div style={{ ...card(), textAlign: "center" }}>
        <span style={{ width: 56, height: 56, borderRadius: 16, display: "inline-grid", placeItems: "center",
          background: `${C.gain}18`, border: `1px solid ${C.gain}44`, marginBottom: 10 }}>
          <Check size={28} color={C.gain} />
        </span>
        <h1 style={{ fontSize: 21, fontWeight: 900, color: C.text, margin: "0 0 6px" }}>
          {T("האסטרטגיה שאתה בנית", "The strategy you built")}
        </h1>
        <p style={{ fontSize: 13.5, color: C.muted, margin: 0 }}>
          {T("כל בחירה כאן היא שלך — למדת אותה ואישרת אותה. זו האסטרטגיה שלך.",
             "Every choice here is yours — you learned it and approved it. This is your strategy.")}
        </p>
      </div>

      <div style={{ ...card({ marginTop: 14 }) }}>
        {STEPS.map((s) => {
          const ch = s.choices.find((c) => c.id === picks[s.key]);
          return (
            <div key={s.key} style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "11px 0", borderBottom: `1px solid ${C.line}` }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center",
                background: `${C.gold}16`, border: `1px solid ${C.gold}33`, flexShrink: 0 }}>
                <s.Icon size={16} color={C.gold} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.faint }}>{T(s.heTitle, s.enTitle)}</div>
                <div style={{ fontSize: 14.5, fontWeight: 900, color: C.text }}>{ch ? T(ch.he, ch.en) : "—"}</div>
                {ch && <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{T(ch.heWhy, ch.enWhy)}</div>}
              </div>
              <Check size={16} color={C.gain} style={{ flexShrink: 0, marginTop: 8 }} />
            </div>
          );
        })}
      </div>

      {/* THE READY (FREE) STRATEGY — the default bot every client gets, no build needed. */}
      <div style={{ marginTop: 14, background: `${C.gain}0d`, border: `1px solid ${C.gain}33`, borderRadius: 14, padding: "13px 15px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
          <Check size={14} color={C.gain} />
          <span style={{ fontSize: 12.5, fontWeight: 900, color: C.gain }}>{T("יש לך גם אסטרטגיה מוכנה — חינם", "You also get a ready strategy — free")}</span>
        </div>
        <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.55 }}>
          {T("אסטרטגיה 1 המוכנה שלנו (לזיהוי פריצות בשוק) פעילה עבורך כברירת-מחדל — לא חייבים לבנות. הבונה הזה הוא כדי לבנות אחת משלך, להוסיף אינדיקטורים ולבחון אותה.",
             "Our ready Strategy 1 (market-breakout detection) is active for you by default — no build required. This builder is for creating your own, adding indicators, and testing it.")}
        </div>
      </div>

      {/* HOW IT CONTINUES — always visible, so the flow to the engine is clear. */}
      <div style={{ marginTop: 14, background: `${C.blue}0d`, border: `1px solid ${C.blue}33`, borderRadius: 14, padding: "13px 15px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
          <Info size={14} color={C.blue} />
          <span style={{ fontSize: 12.5, fontWeight: 900, color: C.blue }}>{T("איך זה ממשיך", "How it continues")}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            T("1. הבחירות שלך הופכות לפרמטרים אמיתיים במנוע — רוחב הערוץ, ספי הכניסה, הסטופ והיעד.", "1. Your choices become real engine parameters — channel width, entry thresholds, stop and target."),
            T("2. 'בדוק על היסטוריה' מריץ בדיוק את הפרמטרים שלך על היסטוריה אמיתית של השוק שבחרת, ומראה מה היה קורה.", "2. 'Test on history' runs exactly your parameters over real history of the market you chose, and shows what would have happened."),
            T("3. 'הרץ בדמו' מכניס אותה למנוע המסחר בסימולציה — פתיחה, סטופ, יעד — בכסף וירטואלי.", "3. 'Run in demo' puts it into the Trading Engine in simulation — entry, stop, target — in virtual money."),
            T("4. מסחר בכסף אמיתי ייפתח רק אחרי אישור — עד אז הכל סימולציה בטוחה.", "4. Real-money trading opens only after approval — until then it's all safe simulation."),
          ].map((line, i) => (
            <div key={i} style={{ fontSize: 12.5, color: C.text, lineHeight: 1.55 }}>{line}</div>
          ))}
        </div>
      </div>

      {/* RESULT of the demo run, or the run button */}
      {done ? (
        <div style={{ ...card({ marginTop: 16 }), textAlign: "center" }}>
          {done.count > 0 ? (
            <LiveEngine live={live} rtl={rtl} T={T} nav={nav} />
          ) : (
            <>
              <div style={{ fontSize: 14, fontWeight: 900, color: C.text, marginBottom: 4 }}>
                {T("אין כרגע פריצה מתאימה לפתיחה", "No matching breakout to open right now")}
              </div>
              <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12 }}>
                {T("זה נורמלי — הדמו פותח פוזיציה רק כשיש הזדמנות. אפשר לנסות שוב מאוחר יותר, או לפתוח את מנוע המסחר עם ההגדרות שלך.",
                   "That's normal — the demo opens a position only on a real opportunity. Try again later, or open the Trading Engine with your settings.")}
              </div>
              <button onClick={() => nav("/profit")} className="tap44"
                style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                  background: C.surface, color: C.gold, border: `1px solid ${C.gold}66`, borderRadius: 14, padding: "13px 18px", fontSize: 14, fontWeight: 900, cursor: "pointer", fontFamily: UI }}>
                <PlayCircle size={16} /> {T("פתח את מנוע המסחר (דמו)", "Open the Trading Engine (demo)")}
              </button>
            </>
          )}
        </div>
      ) : (
        <button onClick={() => run.mutate()} disabled={run.isPending} className="tap44"
          style={{ marginTop: 16, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9,
            background: C.gold, color: onGold(), border: "none", borderRadius: 14, padding: "15px 18px",
            fontSize: 15.5, fontWeight: 900, cursor: "pointer", fontFamily: UI }}>
          {run.isPending ? <Loader2 size={18} className="spin" /> : <PlayCircle size={18} />}
          {T("הרץ בדמו (סימולציה)", "Run in demo (simulation)")}
        </button>
      )}
      <button onClick={() => { setBtErr(""); backtest.mutate(); }} disabled={backtest.isPending} className="tap44"
        style={{ marginTop: 10, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
          background: C.surface, color: C.blue, border: `1px solid ${C.blue}55`, borderRadius: 14, padding: "13px 18px",
          fontSize: 14, fontWeight: 900, cursor: "pointer", fontFamily: UI }}>
        {backtest.isPending ? <Loader2 size={16} className="spin" /> : <FlaskConical size={16} />}
        {T("בדוק את האסטרטגיה שלך על היסטוריה", "Test your strategy on real history")}
      </button>
      {btErr && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: C.loss, textAlign: "center", lineHeight: 1.5 }}>{btErr}</div>
      )}

      {/* BACKTEST — progress, then the numbers, all inside this screen. */}
      {runId && !btRes && (
        <div style={{ ...card({ marginTop: 12 }), textAlign: "center" }}>
          <Loader2 size={20} className="spin" color={C.blue} />
          <div style={{ fontSize: 13.5, fontWeight: 900, color: C.text, margin: "8px 0 3px" }}>
            {T("בודק את האסטרטגיה שלך על היסטוריה אמיתית…", "Testing your strategy on real history…")}
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>
            {(prog.data as any)?.totalSymbols
              ? T(`${(prog.data as any).completedSymbols ?? 0} מתוך ${(prog.data as any).totalSymbols} נכסים`,
                  `${(prog.data as any).completedSymbols ?? 0} of ${(prog.data as any).totalSymbols} assets`)
              : T("מכין את הנתונים…", "Preparing the data…")}
          </div>
        </div>
      )}
      {btRes && <BacktestPanel rows={btRes} rtl={rtl} T={T} nav={nav} />}

      {/* SAVE — turns the built strategy into something the user can come back to. */}
      {savedId ? (
        <div style={{ marginTop: 12, background: `${C.gain}0d`, border: `1px solid ${C.gain}33`,
          borderRadius: 14, padding: "13px 15px", textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "center", marginBottom: 4 }}>
            <Check size={15} color={C.gain} />
            <span style={{ fontSize: 13.5, fontWeight: 900, color: C.gain }}>
              {T("האסטרטגיה נשמרה אצלך", "Your strategy is saved")}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.55 }}>
            {T("היא מופיעה עכשיו ברשימת האסטרטגיות שלך — אפשר להפעיל, לעצור ולהריץ אותה שוב מתי שתרצה.",
               "It now appears in your strategy list — you can start, stop and re-run it whenever you want.")}
          </div>
        </div>
      ) : (
        <button onClick={() => { setSaveErr(""); save.mutate(); }} disabled={save.isPending} className="tap44"
          style={{ marginTop: 10, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
            background: C.gain, color: onGain(), border: "none", borderRadius: 14, padding: "13px 18px",
            fontSize: 14.5, fontWeight: 900, cursor: "pointer", fontFamily: UI }}>
          {save.isPending ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
          {T("שמור את האסטרטגיה שלי", "Save my strategy")}
        </button>
      )}
      {saveErr && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: C.loss, textAlign: "center", lineHeight: 1.5 }}>{saveErr}</div>
      )}

      <button onClick={reset} className="tap44"
        style={{ marginTop: 10, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
          background: C.surface, color: C.muted, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 18px",
          fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: UI }}>
        <RotateCcw size={15} /> {T("התחל מחדש", "Start over")}
      </button>
      <div style={{ marginTop: 12 }}><RiskDisclaimer /></div>
      <ScreenBottom />
    </div>
  );
}

// ── SHARED BITS FOR THE RESULT PANELS ────────────────────────────────────────
function fmtPct(n: number | null | undefined, digits = 1): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}
function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ flex: "1 1 44%", minWidth: 120, background: C.surface, border: `1px solid ${C.line}`,
      borderRadius: 12, padding: "10px 12px" }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.faint, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 900, color: tone || C.text, fontFamily: MONO }}>{value}</div>
    </div>
  );
}

// ── THE TRADING ENGINE, IN-SCREEN — what the client actually sees running ─────
function LiveEngine({ live, rtl, T, nav }: {
  live: any; rtl: boolean; T: (h: string, e: string) => string; nav: (p: string) => void;
}) {
  const sessions: any[] = (live?.data as any)?.sessions || [];
  // The session this builder just started = the newest one.
  const s = sessions.length ? sessions.reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a)) : null;
  const open: any[] = (s?.positions || []).filter((p: any) => p.status === "open");
  const pnlTone = Number(s?.totalPnl) >= 0 ? C.gain : C.loss;

  return (
    <div style={{ textAlign: rtl ? "right" : "left" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, justifyContent: "center" }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: C.gain, display: "inline-block" }} />
        <span style={{ fontSize: 14.5, fontWeight: 900, color: C.text }}>
          {T("מנוע המסחר — האסטרטגיה שלך פועלת", "Trading Engine — your strategy is running")}
        </span>
      </div>

      {s ? (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            <Kpi label={T("שווי תיק", "Portfolio value")} value={`$${Number(s.totalValue ?? 0).toFixed(2)}`} />
            <Kpi label={T("רווח/הפסד", "P&L")} value={`${Number(s.totalPnl ?? 0) >= 0 ? "+" : ""}$${Number(s.totalPnl ?? 0).toFixed(2)}`} tone={pnlTone} />
            <Kpi label={T("תשואה", "Return")} value={fmtPct(s.totalPnlPct, 2)} tone={pnlTone} />
            <Kpi label={T("פוזיציות פתוחות", "Open positions")} value={String(open.length)} />
          </div>

          {open.length > 0 ? (
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
              {open.map((p: any) => {
                const tone = Number(p.pnlPct ?? 0) >= 0 ? C.gain : C.loss;
                return (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                    borderBottom: `1px solid ${C.line}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 900, color: C.text }}>{p.symbol}</div>
                      <div style={{ fontSize: 11.5, color: C.muted, fontFamily: MONO }}>
                        {T("כניסה", "Entry")} {Number(p.entryPrice ?? 0).toLocaleString()}
                        {p.currentPrice != null && <> · {T("נוכחי", "Now")} {Number(p.currentPrice).toLocaleString()}</>}
                      </div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 900, color: tone, fontFamily: MONO, flexShrink: 0 }}>
                      {fmtPct(p.pnlPct, 2)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: C.muted, textAlign: "center", padding: "10px 0" }}>
              {T("הסשן פעיל — ממתין לפריצה מתאימה כדי לפתוח פוזיציה.",
                 "The session is live — waiting for a matching breakout to open a position.")}
            </div>
          )}

          <div style={{ fontSize: 11.5, color: C.faint, textAlign: "center", marginTop: 9 }}>
            {T("מתעדכן אוטומטית · כסף וירטואלי בלבד", "Auto-refreshing · virtual money only")}
          </div>
        </>
      ) : (
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <Loader2 size={18} className="spin" color={C.gold} />
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6 }}>{T("טוען את הסשן…", "Loading the session…")}</div>
        </div>
      )}

      <button onClick={() => nav("/profit")} className="tap44"
        style={{ marginTop: 12, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
          background: C.surface, color: C.gold, border: `1px solid ${C.gold}66`, borderRadius: 14, padding: "12px 18px",
          fontSize: 13.5, fontWeight: 900, cursor: "pointer", fontFamily: UI }}>
        <PlayCircle size={16} /> {T("פתח את מנוע המסחר המלא", "Open the full Trading Engine")}
      </button>
    </div>
  );
}

// ── BACKTEST RESULTS, IN-SCREEN — "what your strategy would have done" ────────
function BacktestPanel({ rows, rtl, T, nav }: {
  rows: any[]; rtl: boolean; T: (h: string, e: string) => string; nav: (p: string) => void;
}) {
  const ok = rows.filter((r) => !r.errorMessage && Number.isFinite(Number(r.totalReturn)));
  if (!ok.length) {
    return (
      <div style={{ ...card({ marginTop: 12 }), textAlign: "center" }}>
        <div style={{ fontSize: 13.5, fontWeight: 900, color: C.text, marginBottom: 3 }}>
          {T("הבדיקה הסתיימה בלי תוצאות", "The test finished with no results")}
        </div>
        <div style={{ fontSize: 12.5, color: C.muted }}>
          {T("ייתכן שאין מספיק היסטוריה לפרמטרים שבחרת. נסה מסגרת-זמן ארוכה יותר או מסנן מגמה רך יותר.",
             "There may not be enough history for your parameters. Try a longer timeframe or a softer trend filter.")}
        </div>
      </div>
    );
  }
  const avg = (f: (r: any) => number) => ok.reduce((s, r) => s + (Number(f(r)) || 0), 0) / ok.length;
  const avgRet = avg((r) => r.totalReturn);
  const avgWin = avg((r) => r.winRate);
  const trades = ok.reduce((s, r) => s + (Number(r.tradeCount) || 0), 0);
  const worstDD = Math.max(...ok.map((r) => Math.abs(Number(r.maxDrawdown) || 0)));
  const top = [...ok].sort((a, b) => Number(b.totalReturn) - Number(a.totalReturn)).slice(0, 3);
  const tone = avgRet >= 0 ? C.gain : C.loss;

  return (
    <div style={{ ...card({ marginTop: 12 }), textAlign: rtl ? "right" : "left" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, justifyContent: "center" }}>
        <FlaskConical size={15} color={C.blue} />
        <span style={{ fontSize: 14, fontWeight: 900, color: C.text }}>
          {T("מה האסטרטגיה שלך הייתה עושה", "What your strategy would have done")}
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Kpi label={T("תשואה ממוצעת", "Average return")} value={fmtPct(avgRet)} tone={tone} />
        <Kpi label={T("אחוז הצלחה", "Win rate")} value={`${(Number(avgWin) || 0).toFixed(0)}%`} />
        <Kpi label={T("סה״כ עסקאות", "Total trades")} value={String(trades)} />
        <Kpi label={T("ירידה מקסימלית", "Max drawdown")} value={`-${worstDD.toFixed(1)}%`} tone={C.loss} />
      </div>

      <div style={{ fontSize: 12, fontWeight: 800, color: C.faint, margin: "12px 0 6px" }}>
        {T(`הנכסים החזקים ביותר (מתוך ${ok.length})`, `Strongest assets (of ${ok.length})`)}
      </div>
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
        {top.map((r) => (
          <div key={r.symbol} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
            borderBottom: `1px solid ${C.line}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: C.text }}>{r.symbol}</div>
              <div style={{ fontSize: 11.5, color: C.muted }}>
                {T(`${r.tradeCount ?? 0} עסקאות`, `${r.tradeCount ?? 0} trades`)}
              </div>
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 900, fontFamily: MONO, flexShrink: 0,
              color: Number(r.totalReturn) >= 0 ? C.gain : C.loss }}>
              {fmtPct(r.totalReturn)}
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11.5, color: C.faint, marginTop: 9, lineHeight: 1.5, textAlign: "center" }}>
        {T("תוצאות עבר על נתונים היסטוריים — אינן מבטיחות תוצאות עתידיות.",
           "Past results on historical data — they do not guarantee future results.")}
      </div>

      <button onClick={() => nav("/backtests")} className="tap44"
        style={{ marginTop: 11, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
          background: C.surface, color: C.blue, border: `1px solid ${C.blue}55`, borderRadius: 14, padding: "11px 18px",
          fontSize: 13, fontWeight: 900, cursor: "pointer", fontFamily: UI }}>
        <FlaskConical size={15} /> {T("פתח את הדוח המלא", "Open the full report")}
      </button>
    </div>
  );
}

// Readable ink on the gold / gain fills (local, mirrors theme onAccent).
function onInk(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6 ? "#16110a" : "#ffffff";
}
function onGold(): string { return onInk(C.gold); }
function onGain(): string { return onInk(C.gain); }
