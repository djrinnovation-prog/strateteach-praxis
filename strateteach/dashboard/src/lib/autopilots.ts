// ── AutoPilots — pilot (paid auto-trading strategy) definitions ──────────────────
// PHASE 1: presentation + safety framework ONLY. This module is a pure, bilingual
// (HE/EN) config — no React, no execution, no order calls. It is the single source of
// truth for the 5 pilots shown in the OWNER-ONLY AutoPilots tab of the Owners Portal.
//
// MONEY-SAFETY: nothing here places a trade or moves money. The `rules` field is the
// (stubbed) strategy definition text that a LATER phase's execution engine will consume;
// for now it holds a skeleton so the shape is fixed and the real rule-text can slot in.
//
// BACKTEST NUMBERS ARE SELF-VALIDATED. Each pilot (1–5) is an independently reproduced
// strategy, each backtested in our own engine on the same curated large-cap universe
// (the "Curated-9") with NO parameter tuning. Every card's headline number equals what
// that pilot's own trade log reproduces (net = Σ trade pnl, MaxDD = NAV mark-to-market
// from the nav curve, trades = row count). We label the source honestly as a
// "self-validated backtest" and keep two caveats visible everywhere: slippage was set to
// 0 (not simulated — live fills are slightly worse) and the 5 pilots share one universe /
// one long trend-family, so they draw down together in a crypto bear.

import type { Bi } from "./owners";

// The numbers below are SELF-VALIDATED backtest results — each independently reproduced in
// our own engine on the Curated-9. Not placeholders. Kept false so the UI never shows a
// "sample" tag.
export const AUTOPILOTS_SAMPLE = false;

// Honest provenance label shown on every card + report: these are our-engine numbers,
// each reproduced from the pilot's own downloadable trade log.
export const SELF_VALIDATED_LABEL: Bi = { he: "בקטסט שאומת עצמאית", en: "Self-validated backtest" };
export const VALIDATED_LABEL: Bi = { he: "✓ אומת עצמאית במנוע שלנו", en: "✓ Self-validated in our engine" };
// The two caveats kept visible everywhere (card + report), per the honest framing.
export const SLIPPAGE_NOTE: Bi = {
  he: "החלקה (slippage) לא הודמתה — הוגדרה 0; מילויים חיים יהיו מעט גרועים יותר.",
  en: "Slippage is NOT simulated — set to 0; live fills will be slightly worse.",
};
export const CORRELATION_CAVEAT: Bi = {
  he: "טייסים שחולקים אותו שוק (למשל כמה טייסי קריפטו) עשויים לרדת יחד בירידת שוק. כל טייס שונה בלוגיקה ובתזמון — לא בהכרח בשוק. ביצועי עבר אינם ערובה לעתיד.",
  en: "Pilots that share a market (e.g. several crypto pilots) can draw down together in a downturn. Each is distinct by logic and timing — not necessarily by market. Past performance is not a guarantee of future results.",
};
export const PERF_DISCLAIMER: Bi = {
  he: "ביצועי עבר אינם ערובה לתוצאות עתידיות",
  en: "Past performance is not a guarantee of future results",
};
// Honesty note (Dan): the backtest is a HISTORICAL run of the named strategy over a fixed
// window — it is NOT a forecast of the loaded pilot's forward dry-run simulation, which
// opens/closes on the daily Gaussian-channel breakout scanner (breaking_out / near_breakout /
// in_uptrend) and will differ. Keeps the two things clearly separate.
export const BACKTEST_VS_SIM_NOTE: Bi = {
  he: "אלה תוצאות בקטסט היסטורי של האסטרטגיה על החלון שלמטה — לא תחזית להרצת הסימולציה של טייס טעון (שנפתחת/נסגרת לפי סורק הפריצה היומי: breaking_out / near_breakout / in_uptrend) ולכן תיתכן שונות.",
  en: "These are historical backtest results of the strategy over the window below — NOT a forecast of a loaded pilot's forward simulation (which opens/closes on the daily breakout scanner: breaking_out / near_breakout / in_uptrend) and will differ.",
};

export type PilotMarket = "crypto" | "stocks";
export type PilotDirection = "long-short" | "long-only";

// The headline metrics shown on the tile + detail header. For every pilot these EQUAL the
// self-validated result (net / MaxDD / trades) so the card number always matches the log.
export type BacktestResult = {
  pnlPct: number;        // net PnL over the window (= Σ trade pnl, from the trade log)
  maxDrawdown: number;   // max drawdown magnitude, stored POSITIVE (NAV mark-to-market)
  trades: number;        // number of trades in the run
  chart: string;         // chart timeframe (e.g. "1D")
  range: Bi;             // the data window
  benchmark: string;     // the universe the strategy was run on
};

// The full SELF-VALIDATED result — our-engine numbers, each reproduced from the pilot's own
// downloadable trade log (see `tradesUrl`). This is the single source of truth for the card
// and the report modal.
export type ValidatedResult = {
  pnlPct: number;              // net return in our engine (= Σ trade pnl)
  maxDrawdown: number;         // max drawdown magnitude, POSITIVE (NAV mark-to-market)
  profitFactor: number;        // gross profit / gross loss
  trades: number;              // round-trips
  winPct: number;              // % of trades that closed in profit
  avgHoldDays: number;         // average holding period, in days
  direction: PilotDirection;   // the direction of the validated strategy
  symbols: string[];           // exact instruments the validation ran on (Curated-9)
  range: Bi;                   // the data window
  method: Bi;                  // one-line methodology (params · sizing · comm · fill · slippage)
  tradesUrl: string;           // /public path to the full validated trade log (JSON)
};

export type AutoPilot = {
  id: string;            // stable strategy id (Dan's TR-* codes) — shown as the card title
  code: string;          // short human code (e.g. "GC", "B2S")
  icon: string;          // lucide key, resolved in the screen
  name: Bi;              // short human subtitle
  market: PilotMarket;
  direction: PilotDirection;
  premium: boolean;      // paid-feature framing (no real payment yet)
  description: Bi;       // short paragraph
  // STUB strategy definition. A later phase replaces this with Dan's full rule-text.
  // Shape kept stable so the execution engine can read `rules` unchanged later.
  rules: string;
  backtest: BacktestResult;
  // The self-validated result — present on all 5 pilots (single source of truth).
  validated: ValidatedResult;
  // Max concurrent SIMULATED positions the dry-run engine holds (mirrors the backend
  // PILOT_META.maxPositions) — surfaced in the "how it operates" explainer so the user
  // can verify the position cap.
  maxPositions: number;
  // Phase 2c 4-pilot restructure: whether this pilot appears in the DEFAULT user-facing
  // lineup. Exactly 4 are visible (Pilots 1/2 + DR Crypto + DR Stocks); the older pilots
  // 3/4/5 are visible:false (hidden from users, owners can reveal). UI/catalog flag ONLY —
  // the backend PILOT_META / live registry for every pilot is fully preserved.
  visible?: boolean;
  // Optional grouping label for the user lineup ("long-term" | "dr").
  group?: "long-term" | "dr";
};

// Shared skeleton describing what every pilot's engine does (the common scaffolding from
// Dan's routines). The full, per-pilot rule-text will be pasted in to replace each stub.
const RULES_STUB = (specifics: string) =>
  [
    "// STUB — full rule-text pending (Phase 1 placeholder, no execution).",
    "// Common scaffolding (from the source routines):",
    "//   • get-bot / get-bot-assets / get-exchange / get-trendradar-daily",
    "//   • apply aiRules to the daily TrendRadar scan",
    "//   • size positions as a fraction of NAV (per-trade sizing)",
    "//   • open/close longs & shorts per the strategy below",
    "//   • email a run summary",
    "//",
    `// Strategy specifics: ${specifics}`,
  ].join("\n");

// Every pilot is self-validated on the same window / universe.
const RANGE_VALIDATED: Bi = { he: "01/2018 → 2026", en: "2018-01 → 2026" };
const CURATED_9 = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "FET", "SUI"];
const CURATED_9_LABEL = "Curated-9";

export const AUTOPILOTS: AutoPilot[] = [
  {
    id: "TR-GC-Crypto-LS-9",
    visible: true, group: "long-term",
    code: "GC",
    icon: "HeartPulse",
    name: { he: "ד״ר לונג", en: "Dr Long Pilot" },
    market: "crypto",
    direction: "long-only",
    premium: true,
    description: {
      he: "ערוץ גאוסיאני (hlc3, N=4, period=144, mult=1.414): כניסת לונג בפריצת הרצועה העליונה, יציאה בירידה מתחתיה. לונג בלבד על 9 שווי-שוק גדולים.",
      en: "Gaussian channel (hlc3, N=4, period=144, mult=1.414): long entry on upper-band breakout, exit on close back under it. Long-only on 9 large-caps.",
    },
    rules: RULES_STUB("Gaussian-channel (hlc3, N=4, period=144, mult=1.414) long breakout / exit under hband; long-only; Curated-9; capital-fraction sized."),
    // Headline = the self-validated result (matches pilot1-validated-trades.json exactly).
    backtest: {
      pnlPct: 8795.4, maxDrawdown: 32.7, trades: 486, chart: "1D", range: RANGE_VALIDATED, benchmark: CURATED_9_LABEL,
    },
    validated: {
      pnlPct: 8795.4, maxDrawdown: 32.7, profitFactor: 2.34, trades: 486,
      winPct: 20.8, avgHoldDays: 15,
      direction: "long-only",
      symbols: CURATED_9,
      range: RANGE_VALIDATED,
      tradesUrl: "/pilot1-validated-trades.json",
      method: {
        he: "פריצת ערוץ גאוסיאני לונג-בלבד (hlc3, N=4, period=144, mult=1.414), 10% מההון לפוזיציה, עמלה 0.05%, החלקה 0 (לא הודמתה), איתות בסגירה/ביצוע בפתיחה הבאה, ללא כיוונון פרמטרים.",
        en: "Long-only Gaussian-channel breakout (hlc3, N=4, period=144, mult=1.414), 10% capital/position, 0.05% commission, slippage 0 (not simulated), signal@close / fill@next-open, no parameter tuning.",
      },
    },
    maxPositions: 8,
  },
  {
    id: "TR-B2S-Crypto-17",
    visible: true, group: "long-term",
    code: "GC-LS",
    icon: "GraduationCap",
    name: { he: "פרופסור שורט", en: "Short Professor" },
    market: "crypto",
    direction: "long-short",
    premium: true,
    description: {
      he: "ערוץ גאוסיאני (hl2, N=4, period=140, mult=1.42): פריצת לונג + שורטים מותנים-רג'ים עם קופסת ATR (SL ×4 / TP ×5.6 על atr12). כולל שורטים — נדרש בוט חוזים עתידיים.",
      en: "Gaussian channel (hl2, N=4, period=140, mult=1.42): long breakout + regime-gated shorts with an ATR box (SL 4× / TP 5.6× on atr12). Includes shorts — Perpetual Futures Bot required.",
    },
    rules: RULES_STUB("Gaussian-channel (hl2, N=4, period=140, mult=1.42) long breakout + regime shorts w/ ATR box SL4x/TP5.6x(atr12); Curated-9; capital-fraction sized; perpetual-futures required."),
    backtest: {
      pnlPct: 7706.4, maxDrawdown: 34.2, trades: 529, chart: "1D", range: RANGE_VALIDATED, benchmark: CURATED_9_LABEL,
    },
    validated: {
      pnlPct: 7706.4, maxDrawdown: 34.2, profitFactor: 2.21, trades: 529,
      winPct: 22.1, avgHoldDays: 15,
      direction: "long-short",
      symbols: CURATED_9,
      range: RANGE_VALIDATED,
      tradesUrl: "/pilot2-validated-trades.json",
      method: {
        he: "ערוץ גאוסיאני לונג/שורט (hl2, N=4, period=140, mult=1.42) + שורטים ברג'ים עם קופסת ATR (SL ×4 / TP ×5.6, atr12), 10% מההון לפוזיציה, עמלה 0.05%, החלקה 0 (לא הודמתה), איתות בסגירה/ביצוע בפתיחה הבאה, ללא כיוונון פרמטרים.",
        en: "Long/short Gaussian channel (hl2, N=4, period=140, mult=1.42) + regime ATR-box shorts (SL 4× / TP 5.6×, atr12), 10% capital/position, 0.05% commission, slippage 0 (not simulated), signal@close / fill@next-open, no parameter tuning.",
      },
    },
    maxPositions: 8,
  },
  {
    // Phase 2c · NEW "DR Crypto" — SIMULATION pilot. Provenance-clean published TA
    // (Donchian(20) breakout + 200-SMA regime + rolling Chandelier(22,3) trailing stop),
    // long-only crypto trend-rider: rides winners, cuts losers. Our-engine validated on real
    // 2018→2026 crypto (net of 0.2% RT fees + 5 bps/side slippage) — a genuine selling point.
    id: "DR-Crypto-Trend",
    visible: true, group: "dr",
    code: "DR-CR",
    icon: "Bitcoin",
    name: { he: "DR קריפטו", en: "DR Crypto" },
    market: "crypto",
    direction: "long-only",
    premium: true,
    description: {
      he: "רוכב-מגמה לונג-בלבד על קריפטו (דונקיאן(20) מעל SMA200, יציאה בעצירה נגררת Chandelier 22/3). קומפאונד עם 3 מצבי-סיכון: אגרסיבי / מאוזן (ברירת מחדל) / בטוח — לכל מצב תשואה ו-drawdown אמיתיים יחד. סימולציה, נטו אחרי עמלות+החלקה.",
      en: "Long-only crypto trend-rider (Donchian(20) above the 200-SMA, exit on a Chandelier 22/3 trailing stop). Compounding, with 3 risk modes — Aggressive / Smooth (default) / Safe — each showing its REAL return AND drawdown together. Simulation, net of fees + slippage.",
    },
    rules: RULES_STUB("Donchian(20) breakout + close>200-SMA entry; exit close<rolling Chandelier(22,3) OR close<200-SMA; long-only; crypto universe; COMPOUNDING with 3 risk modes (vol-target + drawdown-guard). NEW · simulation only."),
    backtest: {
      // Default = SMOOTH mode (compound + vol-target + drawdown-guard 25%). Aggressive/Safe in the report.
      pnlPct: 2440.6, maxDrawdown: 34.8, trades: 585, chart: "1D",
      range: RANGE_VALIDATED, benchmark: "Crypto top-80",
    },
    validated: {
      pnlPct: 2440.6, maxDrawdown: 34.8, profitFactor: 1.50, trades: 585,
      winPct: 35.4, avgHoldDays: 20,
      direction: "long-only",
      symbols: ["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "AVAX", "LINK", "DOT", "LTC", "crypto top-80"],
      range: RANGE_VALIDATED,
      tradesUrl: "/dr-crypto-smooth-trades.json?v=1",   // SMOOTH mode (default); Aggressive/Safe swap in the report
      method: {
        he: "Donchian(20)+SMA200+Chandelier(22,3) לונג-בלבד, קומפאונד · מצב מאוזן (vol-target + drawdown-guard 25%). נטו אחרי עמלות 0.2% + החלקה 5 נ\"ב/צד. ~+46%/שנה · drawdown מקס' 34%. ללא כיוונון פרמטרים.",
        en: "Long-only Donchian(20)+200-SMA+Chandelier(22,3), compounding · Smooth mode (vol-target + drawdown-guard 25%). Net of 0.2% fees + 5 bps/side slippage. ~+46%/yr · max drawdown 34%. No parameter tuning.",
      },
    },
    maxPositions: 8,
  },
  {
    id: "TR-B2S-Crypto-LS-13",
    visible: false,   // hidden from user lineup (Phase 2c 4-pilot); backend preserved
    code: "DON18",
    icon: "Zap",
    name: { he: "טייס 3 · Donchian-18 (לונג בלבד)", en: "Pilot 3 · Donchian-18 (long-only)" },
    market: "crypto",
    direction: "long-only",
    premium: true,
    description: {
      he: "פריצת Donchian(18) מעל הרצועה העליונה[1] + פילטר מגמה close>EMA(172) + קירור 34 נרות; יציאה בירידה מתחת לרצועה התחתונה[1]. לונג בלבד (שורטים נבדקו ונדחו).",
      en: "Donchian(18) breakout of upper[1] + close>EMA(172) trend filter + 34-bar cooldown; exit on cross under lower[1]. Long-only (a long/short variant was tested and rejected).",
    },
    rules: RULES_STUB("Donchian(18) breakout of upper[1] + close>EMA(172) trend filter + 34-bar cooldown; exit under lower[1]; long-only; Curated-9; capital-fraction sized."),
    backtest: {
      pnlPct: 3582.5, maxDrawdown: 33.5, trades: 137, chart: "1D", range: RANGE_VALIDATED, benchmark: CURATED_9_LABEL,
    },
    validated: {
      pnlPct: 3582.5, maxDrawdown: 33.5, profitFactor: 2.33, trades: 137,
      winPct: 40.1, avgHoldDays: 49,
      direction: "long-only",
      symbols: CURATED_9,
      range: RANGE_VALIDATED,
      tradesUrl: "/pilot3-validated-trades.json",
      method: {
        he: "פריצת Donchian(18) לונג-בלבד מעל upper[1] + פילטר EMA(172) + קירור 34 נרות, 10% מההון לפוזיציה, עמלה 0.05%, החלקה 0 (לא הודמתה), איתות בסגירה/ביצוע בפתיחה הבאה, ללא כיוונון. שורט long/short נבדק ונדחה (הוריד ל-+656%/−52%).",
        en: "Long-only Donchian(18) breakout of upper[1] + EMA(172) filter + 34-bar cooldown, 10% capital/position, 0.05% commission, slippage 0 (not simulated), signal@close / fill@next-open, no tuning. A long/short variant was tested and rejected (dropped it to +656%/−52%).",
      },
    },
    maxPositions: 8,
  },
  {
    // Un-hidden + rebranded "Free Student" (Dan) — fits the Dr / Professor / Student theme.
    // id / engine / strategy / behavior UNCHANGED (still the Bollinger-LowDD crypto pilot).
    id: "TR-B2S-Crypto-LowDD-12",
    visible: true,
    code: "BOLL20",
    icon: "Backpack",
    name: { he: "הסטודנט", en: "Free Student" },
    market: "crypto",
    direction: "long-only",
    premium: true,
    description: {
      he: "Bollinger(20,2): כניסת לונג בפריצת הרצועה העליונה, יציאה בירידה מתחת לקו האמצע (SMA20). לונג בלבד על 9 שווי-שוק גדולים.",
      en: "Bollinger(20,2): long entry on upper-band breakout, exit on close under the 20-SMA midline. Long-only on 9 large-caps.",
    },
    rules: RULES_STUB("Bollinger(20,2) long breakout of the upper band / exit under the 20-SMA midline; long-only; Curated-9; capital-fraction sized."),
    backtest: {
      pnlPct: 5538.9, maxDrawdown: 33.4, trades: 415, chart: "1D", range: RANGE_VALIDATED, benchmark: CURATED_9_LABEL,
    },
    validated: {
      pnlPct: 5538.9, maxDrawdown: 33.4, profitFactor: 1.94, trades: 415,
      winPct: 40.5, avgHoldDays: 16,
      direction: "long-only",
      symbols: CURATED_9,
      range: RANGE_VALIDATED,
      tradesUrl: "/pilot4-validated-trades.json",
      method: {
        he: "Bollinger(20,2) לונג-בלבד: פריצת רצועה עליונה / יציאה מתחת ל-SMA20, 10% מההון לפוזיציה, עמלה 0.05%, החלקה 0 (לא הודמתה), איתות בסגירה/ביצוע בפתיחה הבאה, ללא כיוונון פרמטרים.",
        en: "Long-only Bollinger(20,2): upper-band breakout / exit under the 20-SMA, 10% capital/position, 0.05% commission, slippage 0 (not simulated), signal@close / fill@next-open, no parameter tuning.",
      },
    },
    maxPositions: 5,
  },
  {
    // NOTE: the `id` keeps the legacy "Stocks" token (stable arm/PILOT_META/tradesUrl
    // contract — do not change it), but this pilot has ALWAYS traded CRYPTO (Keltner on the
    // Curated-9 crypto universe). The human-facing name/subtitle/copy say "Crypto" explicitly
    // so the id token can't mislead. All backtest numbers below are the crypto Curated-9 run.
    id: "TR-B2S-Stocks-14",
    visible: false,   // hidden from user lineup (Phase 2c 4-pilot); backend preserved
    code: "KELT20",
    icon: "LineChart",
    name: { he: "טייס 5 · Keltner קריפטו (EMA20, 2×ATR10)", en: "Pilot 5 · Keltner Crypto (EMA20, 2×ATR10)" },
    market: "crypto",
    direction: "long-only",
    premium: true,
    description: {
      he: "Keltner (EMA20 ± 2×ATR10) על יוניברס הקריפטו Curated-9: כניסת לונג בפריצת הרצועה העליונה, יציאה בירידה מתחת ל-EMA20. לונג בלבד — ה-drawdown הנמוך ביותר מבין החמישה.",
      en: "Keltner (EMA20 ± 2×ATR10) on the Curated-9 crypto universe: long entry on upper-band breakout, exit on close under the EMA20 basis. Long-only — the lowest drawdown of the five.",
    },
    rules: RULES_STUB("Keltner (EMA20 ± 2×ATR10) long breakout of the upper band / exit under the EMA20 basis; long-only; Curated-9; capital-fraction sized."),
    backtest: {
      pnlPct: 3606.0, maxDrawdown: 20.6, trades: 250, chart: "1D", range: RANGE_VALIDATED, benchmark: CURATED_9_LABEL,
    },
    validated: {
      pnlPct: 3606.0, maxDrawdown: 20.6, profitFactor: 2.75, trades: 250,
      winPct: 48.0, avgHoldDays: 20,
      direction: "long-only",
      symbols: CURATED_9,
      range: RANGE_VALIDATED,
      tradesUrl: "/pilot5-validated-trades.json",
      method: {
        he: "Keltner לונג-בלבד (EMA20 ± 2×ATR10): פריצת רצועה עליונה / יציאה מתחת ל-EMA20, 10% מההון לפוזיציה, עמלה 0.05%, החלקה 0 (לא הודמתה), איתות בסגירה/ביצוע בפתיחה הבאה, ללא כיוונון פרמטרים.",
        en: "Long-only Keltner (EMA20 ± 2×ATR10): upper-band breakout / exit under the EMA20 basis, 10% capital/position, 0.05% commission, slippage 0 (not simulated), signal@close / fill@next-open, no parameter tuning.",
      },
    },
    maxPositions: 6,
  },
  {
    // Phase 2b · NEW — the first STOCKS pilot and the first mean-reversion pilot.
    // PROVENANCE-CLEAN: canonical published TA (Connors-style RSI2 was dropped after CP3; this
    // is Bollinger(20,2) + the 200-SMA regime guard), implemented by us from the public spec.
    // Numbers below are the Phase-2b PAPER-SIM (Checkpoint 3) result NET of fees AND modeled
    // slippage — not a bull-run crypto backtest. SIMULATION ONLY, like the other pilots.
    // Phase 2c · rebranded to "DR Stocks" in the 4-pilot lineup (id + engine UNCHANGED — same
    // validated Bollinger(20,2)+200-SMA mean-reversion, same numbers/trade log).
    id: "MR-BB-Stocks",
    visible: true, group: "dr",
    code: "DR-ST",
    icon: "CandlestickChart",
    name: { he: "DR מניות", en: "DR Stocks" },
    market: "stocks",
    direction: "long-only",
    premium: true,
    description: {
      he: "היפוך ממוצע לונג-בלבד על ~150 מניות שווי-שוק גדול: כניסה מתחת לרצועת בולינגר התחתונה (20,2) רק כשהמחיר מעל ה-SMA200 (שומר-מגמה), יציאה בחזרה לקו האמצע (SMA20) או עצירת-זמן 10 ברים. TA קנוני שפורסם; סימולציה בלבד, נטו אחרי עמלות.",
      en: "Long-only mean-reversion on ~150 large-cap stocks: buy below the lower Bollinger band (20,2) ONLY when price is above its 200-SMA (regime guard), exit back at the 20-SMA midline or a 10-bar time-stop. Published canonical TA; simulation only, net of fees.",
    },
    rules: RULES_STUB("Bollinger(20,2) lower-band mean-reversion + 200-SMA regime guard (longs only when price>200-SMA); exit close>=20-SMA (mid) or 10-bar time-stop; long-only; ~150 US large-caps; capital-fraction sized. NEW · simulation only."),
    backtest: {
      pnlPct: 50.74, maxDrawdown: 29.11, trades: 1057, chart: "1D",
      range: RANGE_VALIDATED, benchmark: "150 US large-caps",
    },
    validated: {
      pnlPct: 50.74, maxDrawdown: 29.11, profitFactor: 1.15, trades: 1057,
      winPct: 57.1, avgHoldDays: 8.2,
      direction: "long-only",
      symbols: ["AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "AMZN", "META", "GOOGL", "JPM", "V", "150 US large-caps"],
      range: RANGE_VALIDATED,
      tradesUrl: "/pilot-mr-bb-validated-trades.json",
      method: {
        he: "Bollinger(20,2)+SMA200 לונג-בלבד, פ2b PAPER-SIM נטו אחרי עמלות 0.2% הלוך-ושוב + החלקה מודלית 5 נ\"ב לצד, איתות בסגירה/ביצוע בפתיחה הבאה, מכסת 8 פוזיציות, ללא כיוונון פרמטרים (ברירות-מחדל שפורסמו).",
        en: "Long-only Bollinger(20,2)+200-SMA, Phase-2b PAPER-SIM net of 0.2% round-trip fees + 5 bps/side MODELED slippage, signal@close / fill@next-open, 8-position cap, no parameter tuning (published defaults).",
      },
    },
    maxPositions: 8,
  },
];

export const pilotById = (id?: string | null): AutoPilot | undefined =>
  AUTOPILOTS.find((p) => p.id === id);

// ── Armed state — LOCAL ONLY, SIMULATION ONLY ────────────────────────────────────
// Phase 1 has NO execution engine and NO server state: "arming" a pilot only records the
// user's approved config in this browser so the card can show an ARMED — SIMULATION badge.
// No order is ever placed. A later phase moves this to the server + a real dry-run engine.
export type ArmedPilot = {
  armedAt: string;       // ISO timestamp
  accountLabel: string;  // the exchange/account the user confirmed
  nav: number;           // confirmed NAV
  perTradePct: number;   // confirmed per-trade sizing (% of NAV)
  mode: "simulation";    // Phase 1 is ALWAYS simulation
};

const ARMED_KEY = "algo770_autopilots_armed_v1";

export function loadArmed(): Record<string, ArmedPilot> {
  try { const raw = localStorage.getItem(ARMED_KEY); return raw ? JSON.parse(raw) as Record<string, ArmedPilot> : {}; }
  catch { return {}; }
}
export function saveArmed(map: Record<string, ArmedPilot>): void {
  try { localStorage.setItem(ARMED_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}
