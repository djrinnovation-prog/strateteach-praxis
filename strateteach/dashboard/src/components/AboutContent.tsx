import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  Cpu, Building2, TrendingUp, Link2, Zap, Radio, FlaskConical, History, ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "../i18n";
import { C, SHADOW } from "../theme";

// Exchanges named in the About-Us "Exchange integrations" section. Each name is an
// in-app hyperlink into OUR connect-exchange page (/exchange) — the connection is to
// the exchange, but always routed through our platform, never an outbound link to the
// exchange's own site.
const ABOUT_EXCHANGES = ["Binance", "Coinbase", "Bybit", "Crypto.com"];

// Shared "About Us / מי אנחנו" content — a fuller, professional company explanation
// organised as a single-open accordion of topic sections (welcome lead stays visible,
// the first topic opens by default). Rendered both inside the Explanations screen
// (University.tsx, the About tile) and from the Home wordmark click (as a modal), so
// the two always stay in sync. Bilingual HE/EN (Hebrew primary + a short English
// version), skin-dynamic (theme C.*), RTL-aware via the page direction. Copy is kept
// honest — no invented performance numbers; the "10+ years tested" framing is unchanged.
export const ABOUT_STR = {
  he: {
    aboutTitle: "מי אנחנו",
    aboutIntro: "ברוכים הבאים ל-Strateteach.",
    sections: [
      {
        id: "who",
        heading: "מי אנחנו",
        body: "Strateteach היא חברת מסחר אלגוריתמי שבונה ומפתחת אסטרטגיות מסחר על פני כל השווקים — מניות, קריפטו, מתכות, סחורות ועוד. אנחנו הופכים לוגיקת מסחר מוכחת לכלים פשוטים שכל אחד יכול להפעיל, בלי צורך לכתוב שורת קוד.",
      },
      {
        id: "algo",
        heading: "מה זה מסחר אלגוריתמי?",
        body: "מסחר אלגוריתמי הוא שימוש בכללים ובאלגוריתמים מוגדרים מראש כדי לזהות הזדמנויות בשוק ולקבל החלטות מסחר על בסיס נתונים — במקום תחושות בטן או רגש. האלגוריתם סורק את השוק לפי קריטריונים אובייקטיביים וחוזר על אותה לוגיקה בעקביות, בלי הטיות אנושיות.",
      },
      {
        id: "approach",
        heading: "הגישה שלנו",
        body: "הגישה שלנו שונה מהרגיל: היא מבוססת על זיהוי פריצות מגמה — לטווח הקצר ולטווח הארוך כאחד. במקום תחושת בטן, אנחנו נותנים קריאה אמיתית ואובייקטיבית של מה שבאמת פורץ או עומד לפרוץ. כאן לא מנחשים אילו נכסים ׳ירוויחו׳ — יש בדיקה אמיתית של מה שכבר בתנועה, בעזרת אסטרטגיות שנבדקו לאורך מעל 10 שנים (ואפשר לראות ולבדוק אותן בעצמכם במערכת). וזה כל החידוש שלנו.",
      },
      {
        id: "exchanges",
        heading: "חיבור לבורסות",
        body: "המערכת מתחברת ומשתלבת עם כל הפלטפורמות המובילות — Binance, Coinbase, Bybit, Crypto.com ועוד. מחברים את הארנק או חשבון המסחר פעם אחת, ומנהלים הכול ממקום אחד.",
      },
      {
        id: "engine",
        heading: "מנוע המסחר היומי",
        body: "מנוע המסחר היומי מציף עבורכם עסקאות יומיות ועסקאות הזדמנותיות — כולל בתקופות שוק רגועות יותר — על הנכסים המובילים. כך תמיד יש לאן להסתכל, גם כשהשוק לא סוער.",
      },
      {
        id: "tv",
        heading: "TradingView + Signal Bot",
        body: "אינטגרציה ישירה עם TradingView: מחברים Signal Bot באמצעות הודעת webhook ישירה, ומוסיפים חיבור לארנק/בורסה כדי לנהל אסטרטגיות ולסחור על פי הסיגנלים שלנו באופן מיידי — הכול בפלטפורמה אחת.",
      },
      {
        id: "lab",
        heading: "מעבדת האסטרטגיות (Strategy Lab)",
        body: "מעבדת האסטרטגיות היא המקום שבו בונים, מכווננים וחוקרים אסטרטגיות. אפשר להתאים פרמטרים, להשוות גישות ולמצוא את מה שמתאים לסגנון שלכם — לפני שמפעילים אותו בשוק.",
      },
      {
        id: "backtest",
        heading: "בדיקת עבר (Backtest)",
        body: "בדיקת עבר מריצה אסטרטגיה מול נתונים היסטוריים אמיתיים, ומראה את העסקאות והסימונים על הגרף. כך רואים איך אסטרטגיה הייתה מתנהגת בעבר — לפני שסומכים עליה קדימה.",
      },
    ],
  },
  en: {
    aboutTitle: "About Us",
    aboutIntro: "Welcome to Strateteach.",
    sections: [
      {
        id: "who",
        heading: "Who we are",
        body: "Strateteach is an algorithmic-trading company that builds and develops trading strategies across all markets — stocks, crypto, metals, commodities, and more. We turn proven trading logic into simple tools anyone can run, without writing a line of code.",
      },
      {
        id: "algo",
        heading: "What is algorithmic trading?",
        body: "Algorithmic trading means using predefined rules and algorithms to spot market opportunities and make data-driven trading decisions — instead of gut feelings or emotion. The algorithm scans the market by objective criteria and applies the same logic consistently, without human bias.",
      },
      {
        id: "approach",
        heading: "Our approach",
        body: "Our approach is different than usual: it's built on breakout trend detection — for both the short and the long term. Instead of gut feeling, we give a real, objective read of what is actually breaking out or about to break out. Here you don't guess which assets “will profit” — there's a real check of what is already in motion, using strategies tested over 10+ years (and you can view and verify them yourself in the system). That's our whole innovation.",
      },
      {
        id: "exchanges",
        heading: "Exchange integrations",
        body: "The platform connects and integrates with all the leading exchanges — Binance, Coinbase, Bybit, Crypto.com, and more. Connect your wallet or trading account once, and manage everything from one place.",
      },
      {
        id: "engine",
        heading: "Daily Trading Engine",
        body: "The Daily Trading Engine surfaces daily and opportunistic trades for you — including during calmer market periods — on leading assets. So there's always something to look at, even when the market is quiet.",
      },
      {
        id: "tv",
        heading: "TradingView + Signal Bot",
        body: "Direct TradingView integration: connect a Signal Bot via a direct webhook message, and add a wallet/exchange connection to manage strategies and trade on our signals immediately — all in one platform.",
      },
      {
        id: "lab",
        heading: "Strategy Lab",
        body: "The Strategy Lab is where you build, tune, and explore strategies. Adjust parameters, compare approaches, and find what fits your style — before putting it to work in the market.",
      },
      {
        id: "backtest",
        heading: "Backtest",
        body: "Backtest runs a strategy against real historical data and shows the trades and markers on the chart. See how a strategy would have behaved in the past — before you rely on it going forward.",
      },
    ],
  },
} as const;

// Icon per section id — same across both languages (the section ids are identical).
const SECTION_ICON: Record<string, LucideIcon> = {
  who: Building2,
  algo: Cpu,
  approach: TrendingUp,
  exchanges: Link2,
  engine: Zap,
  tv: Radio,
  lab: FlaskConical,
  backtest: History,
};

export default function AboutContent() {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const tt = ABOUT_STR[lang];
  // Single-open accordion: only one section expands at a time; the first topic
  // ("who") is open by default, the rest are collapsed. "" means all collapsed.
  const [open, setOpen] = useState<string>(tt.sections[0]?.id ?? "");
  return (
    // Comfortable internal scroll: the body scrolls within the viewport (70svh cap)
    // so a long open section never runs off-screen — works inside the Home modal and
    // the Explanations About tile alike. overscroll-contain keeps the page behind it still.
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "70svh", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch", paddingBottom: 6, textAlign: rtl ? "right" : "left" }}>
      {/* warm welcome lead — always visible opener */}
      <div style={{ flexShrink: 0, background: C.surface2, border: `1px solid ${C.goldDim}`, borderRadius: 12, padding: "14px 16px" }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text, lineHeight: 1.6 }}>{tt.aboutIntro}</p>
      </div>
      {/* topic accordion — single open, first section open by default */}
      {tt.sections.map((sec) => {
        const isOpen = open === sec.id;
        const Icon = SECTION_ICON[sec.id] ?? Cpu;
        return (
          <div key={sec.id} style={{ flexShrink: 0, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
            border: `1.5px solid ${isOpen ? C.gold : C.line}`, borderRadius: 12, overflow: "hidden",
            boxShadow: isOpen ? `inset 0 1px 0 rgba(255,255,255,0.25), ${SHADOW}` : "inset 0 1px 0 rgba(255,255,255,0.18)" }}>
            <button type="button" onClick={() => setOpen(isOpen ? "" : sec.id)} aria-expanded={isOpen}
              style={{ width: "100%", minHeight: 48, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "none", border: "none", cursor: "pointer", padding: "13px 15px", color: C.text, textAlign: rtl ? "right" : "left" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 14.5, fontWeight: 700, minWidth: 0 }}>
                <Icon size={17} color={C.gold} style={{ flexShrink: 0 }} /> {sec.heading}
              </span>
              <ChevronDown size={17} color={C.muted} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }} />
            </button>
            {isOpen && (
              <div style={{ padding: "0 15px 15px" }}>
                {sec.id === "exchanges" ? (
                  <>
                    {/* Leading model sentence — trading happens in sub-accounts inside
                        the exchanges, with spot buy/sell orders, per the exchange's own
                        instructions. Bilingual (HE primary + EN mirror). */}
                    <p style={{ margin: "0 0 10px", fontSize: 13.5, lineHeight: 1.7, color: C.text, fontWeight: 700 }}>
                      {he
                        ? "המסחר מתבצע בחשבונות סאב-אקאונט בתוך הבורסות, עם פקודות קנייה ומכירה בספוט על סמך הוראות הבורסה עצמה."
                        : "Trading takes place in sub-accounts inside the exchanges, with spot buy/sell orders, based on the exchange's own instructions."}
                    </p>
                    {/* Each exchange name → in-app link to our connect page (/exchange). */}
                    <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7, color: C.muted }}>
                      {he
                        ? "המערכת מתחברת ומשתלבת עם כל הפלטפורמות המובילות — "
                        : "The platform connects and integrates with all the leading exchanges — "}
                      {ABOUT_EXCHANGES.map((name, i) => (
                        <React.Fragment key={name}>
                          {i > 0 && " · "}
                          <Link to="/exchange" style={{ color: C.gold, fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 2 }}>{name}</Link>
                        </React.Fragment>
                      ))}
                      {he
                        ? " ועוד. מחברים את הארנק או חשבון המסחר פעם אחת, ומנהלים הכול ממקום אחד."
                        : ", and more. Connect your wallet or trading account once, and manage everything from one place."}
                    </p>
                  </>
                ) : (
                  <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7, color: C.muted }}>{sec.body}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
