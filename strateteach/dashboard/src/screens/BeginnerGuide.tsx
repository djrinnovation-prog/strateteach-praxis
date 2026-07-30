import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, LineChart, ArrowLeftRight, Wand2, Cpu, Play, ShieldCheck, Rocket, Search, Bot, ShieldAlert } from "lucide-react";
import { useI18n } from "../i18n";
import { C, onAccent } from "../theme";
import { ScreenHeader } from "../components/ScreenHeader";

// ── "חדש כאן?" — the persistent, re-openable BEGINNER GUIDE ─────────────────────
// A friendly, plain-language library for a TOTAL beginner: five collapsible glass cards,
// bilingual HE/EN, RTL-correct, accessible. This is the ALWAYS-accessible companion to the
// first-run WelcomeOnboarding (not a duplicate of it) — reached from Home's "חדש כאן?" and
// the ☰ menu. Deeper reference material still lives in University (/university); this is
// the gentle on-ramp. Styled in the app's glass + skin design language (C.* tokens).

type Action = { label: { he: string; en: string }; onClick: () => void; primary?: boolean };
type Card = {
  id: string;
  Icon: any;
  title: { he: string; en: string };
  lead: { he: string; en: string };            // one-line summary shown under the title
  body: { he: string[]; en: string[] };
  note?: { he: string; en: string };           // optional highlighted callout (e.g. the keys note)
  actions?: Action[];
};

export default function BeginnerGuide() {
  const { lang, rtl } = useI18n();
  const nav = useNavigate();
  const he = lang === "he";
  // Independent collapsibles (a browsable mini-library) — the first card opens by default.
  const [open, setOpen] = useState<Record<string, boolean>>({ market: true });
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  // Launch the EXISTING guided tour: its anchors live on Home, so navigate there and then
  // re-fire the algo770-start-tour event on a short interval. The event reaches whatever
  // Home TourLauncher is CURRENTLY mounted+listening (a single delayed dispatch missed it
  // if Home hadn't finished mounting); repeating for a few seconds guarantees it lands, and
  // setTour is idempotent so extra fires are harmless.
  const startTour = () => {
    nav("/");
    let n = 0;
    const iv = window.setInterval(() => {
      n++;
      try { window.dispatchEvent(new CustomEvent("algo770-start-tour", { detail: { screen: "home" } })); } catch { /* */ }
      if (n >= 12) window.clearInterval(iv);   // ~12 × 350ms ≈ 4s window
    }, 350);
  };

  const cards: Card[] = [
    {
      id: "market", Icon: LineChart,
      title: { he: "הבנת השוק", en: "Understand the market" },
      lead: { he: "מה זה בכלל שוק — ומאיפה נוצר רווח.", en: "What a market is — and where profit comes from." },
      body: {
        he: [
          "שוק הוא פשוט מקום שבו קונים ומוכרים. כאן מדובר בעיקר במטבעות קריפטו (כמו ביטקוין ואית'ריום), שהמחיר שלהם עולה ויורד לאורך היום.",
          "רווח נוצר כשקונים בזול ומוכרים ביוקר; הפסד הוא ההפך. בקריפטו התנודתיות (כמה המחיר \"קופץ\") גבוהה — יותר הזדמנות, אבל גם יותר סיכון.",
          "מונחי יסוד: מחיר = כמה שווה מטבע עכשיו · פוזיציה = החזקה פתוחה שלכם · רווח/הפסד = ההפרש מאז שקניתם.",
          "אין צורך להיות מומחים — המערכת מסבירה כל צעד, ואתם מאשרים כל פעולה בעצמכם.",
        ],
        en: [
          "A market is simply where people buy and sell. Here it's mostly crypto coins (like Bitcoin and Ethereum) whose price rises and falls through the day.",
          "You profit by buying low and selling high; a loss is the opposite. Crypto is volatile (the price \"jumps\" a lot) — more opportunity, but also more risk.",
          "Basic terms: price = what a coin is worth right now · position = a holding you have open · P&L = the difference since you bought.",
          "You don't need to be an expert — the app explains each step, and you approve every action yourself.",
        ],
      },
    },
    {
      id: "connect", Icon: ArrowLeftRight,
      title: { he: "חיבור ארנק / בורסה", en: "Connect a wallet / exchange" },
      lead: { he: "איך מחברים — והמפתחות נשארים רק אצלכם.", en: "How to connect — and your keys stay only with you." },
      body: {
        he: [
          "כדי לסחור בכסף אמיתי מחברים בורסה (למשל Bybit או Binance) באמצעות \"מפתחות API\" — קוד שמאפשר למערכת לבצע פקודות בחשבון שלכם, בלי סיסמה.",
          "המפתחות לא-משמורתיים: הם נשמרים רק בדפדפן של המכשיר הזה, ולעולם לא נשלחים לשרתים שלנו. אנחנו לא רואים אותם ולא יכולים למשוך את הכסף שלכם.",
          "אפשר להתחיל גם בלי לחבר — במצב דמו (כסף מדומה) — וללמוד את המערכת בלי סיכון.",
        ],
        en: [
          "To trade real money you connect an exchange (e.g. Bybit or Binance) using \"API keys\" — a code that lets the app place orders in your account, without a password.",
          "The keys are non-custodial: they're stored only in THIS device's browser and are never sent to our servers. We can't see them and can't withdraw your money.",
          "You can also start without connecting — in Demo mode (simulated money) — and learn the app risk-free.",
        ],
      },
      note: {
        he: "חשוב: לכל מכשיר יש עותק מפתחות משלו. אם תנקו את נתוני הדפדפן או תעברו מכשיר — תצטרכו לחבר מחדש. החשבון והכסף בבורסה נשארים בטוחים; רק החיבור המקומי נמחק.",
        en: "Important: each device keeps its OWN copy of the keys. If you clear your browser data or switch devices, you'll need to reconnect. Your exchange account and funds stay safe — only the local connection is cleared.",
      },
      actions: [{ label: { he: "חבר בורסה ←", en: "Connect exchange →" }, onClick: () => nav("/exchange?sec=connect"), primary: true }],
    },
    {
      id: "strategy", Icon: Wand2,
      title: { he: "בניית אסטרטגיה", en: "Build a strategy" },
      lead: { he: "בוחרים חוקים לקנייה ומכירה — מוכן או משלכם.", en: "Pick rules for buying & selling — ready-made or your own." },
      body: {
        he: [
          "אסטרטגיה = חוקים שמחליטים מתי לקנות ומתי למכור. אפשר לבחור אחת מוכנה, או לכוונן אחת משלכם.",
          "ב\"מעבדת האסטרטגיות\" בונים, בודקים על נתוני עבר ומשווים. ב\"מנוע המסחר\" מריצים תוכנית יומית — ואתם מאשרים כל פקודה.",
          "מתחילים? התחילו בקטן ובמצב דמו, ורק כשמרגישים בנוח עוברים לכסף אמיתי.",
        ],
        en: [
          "A strategy = the rules that decide when to buy and when to sell. Pick a ready-made one, or tune your own.",
          "In the Strategy Lab you build, test on history and compare. In the Trading Engine you run a daily plan — and you approve every order.",
          "New? Start small and in Demo mode, and only move to real money once you're comfortable.",
        ],
      },
      actions: [
        { label: { he: "מעבדת אסטרטגיות ←", en: "Strategy Lab →" }, onClick: () => nav("/strategy"), primary: true },
        { label: { he: "מנוע מסחר ←", en: "Trading Engine →" }, onClick: () => nav("/profit") },
      ],
    },
    {
      id: "logic", Icon: Cpu,
      title: { he: "הלוגיקה שלנו", en: "Our logic" },
      lead: { he: "איך הסריקה, המנוע והבוט עובדים יחד.", en: "How the scan, engine and bot work together." },
      body: {
        he: [
          "הסריקה היומית עוברת על הנכסים ומסמנת מי \"פורץ\": ירוק = הזדמנות פתיחה, אפור = החזקה, אדום = סגירה.",
          "מנוע המסחר לוקח את הסיגנלים החמים, בונה תוכנית קנייה יומית עם יעד רווח — ואתם מאשרים כל עסקה.",
          "סיגנל בוט מחבר התראות מ-TradingView כדי להפעיל פעולות לפי הכללים שהגדרתם.",
          "הכול שקוף: אתם רואים כל סיגנל וכל פעולה, ושולטים בכל החלטה. זה כלי — לא קופסה שחורה.",
        ],
        en: [
          "The daily scan sweeps the assets and flags which are \"breaking out\": green = an opening opportunity, grey = hold, red = close.",
          "The Trading Engine takes the hot signals, builds a daily buy plan with a profit target — and you approve every trade.",
          "Signal Bot connects TradingView alerts to trigger actions by the rules you set.",
          "It's all transparent: you see every signal and every action, and you control every decision. It's a tool — not a black box.",
        ],
      },
      actions: [
        { label: { he: "סריקה יומית ←", en: "Daily Scan →" }, onClick: () => nav("/scanner"), primary: true },
        // (Signal Bot action link removed from inner screens per owner — it stays on Home + the side menu.)
      ],
    },
    {
      id: "tour", Icon: Play,
      title: { he: "סיור מסכים", en: "Screen tour" },
      lead: { he: "היכרות מודרכת עם מסך הבית, חלק אחר חלק.", en: "A guided walkthrough of the Home screen, part by part." },
      body: {
        he: [
          "רוצים היכרות מודרכת? הסיור עובר על מסך הבית ומראה לכם איפה כל דבר — אפשר לדלג בכל רגע.",
          "מומלץ אחרי שקראתם את הסעיפים למעלה, כדי לחבר בין ההסבר למסך עצמו.",
        ],
        en: [
          "Want a guided intro? The tour walks the Home screen and shows you where everything is — skip anytime.",
          "Best right after reading the sections above, to connect the explanation to the screen itself.",
        ],
      },
      actions: [{ label: { he: "התחל סיור מסכים ←", en: "Start the screen tour →" }, onClick: startTour, primary: true }],
    },
  ];

  return (
    <div style={{ direction: rtl ? "rtl" : "ltr" }}>
      <ScreenHeader
        icon={<Rocket size={20} color={C.gold} fill={C.gold} />}
        title={he ? "חדש כאן?" : "New here?"}
        subtitle={he ? "מדריך למתחילים — כל מה שצריך כדי להתחיל, בשפה פשוטה." : "A beginner's guide — everything you need to start, in plain language."}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760, margin: "0 auto" }}>
        {cards.map((card) => {
          const isOpen = !!open[card.id];
          return (
            <div key={card.id} style={{
              background: C.glassTint, backdropFilter: C.glassBlur, WebkitBackdropFilter: C.glassBlur as any,
              border: `1px solid ${isOpen ? C.gold : C.glassBd}`, borderRadius: 16,
              boxShadow: isOpen ? `${C.glassHi}, 0 14px 30px -18px rgba(0,0,0,0.4)` : C.glassHi, overflow: "hidden" }}>
              {/* Header row — icon tile + title + one-line lead + chevron */}
              <button onClick={() => toggle(card.id)} aria-expanded={isOpen} className="tap44"
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, background: "none", border: "none", cursor: "pointer",
                  fontFamily: "inherit", padding: "13px 15px", color: C.text, textAlign: rtl ? "right" : "left" }}>
                <span style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 11, display: "inline-flex", alignItems: "center", justifyContent: "center",
                  background: C.accentGrad, boxShadow: `${C.glassHi}, 0 6px 14px -8px ${C.gold}88` }}>
                  <card.Icon size={19} color={onAccent(C.gold)} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 15.5, fontWeight: 800, lineHeight: 1.2 }}>{card.title[lang]}</span>
                  <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.35, marginTop: 2 }}>{card.lead[lang]}</span>
                </span>
                <ChevronDown size={19} color={C.muted} style={{ flexShrink: 0, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
              </button>

              {isOpen && (
                <div style={{ padding: "0 15px 15px", display: "flex", flexDirection: "column", gap: 9 }}>
                  {card.body[lang].map((p, i) => (
                    <p key={i} style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: C.text, opacity: 0.92 }}>{p}</p>
                  ))}
                  {card.note && (
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 2,
                      background: `${C.gold}14`, border: `1px solid ${C.gold}55`, borderRadius: 11, padding: "9px 11px" }}>
                      <ShieldCheck size={15} color={C.gold} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span style={{ fontSize: 12.5, lineHeight: 1.55, color: C.text, fontWeight: 600 }}>{card.note[lang]}</span>
                    </div>
                  )}
                  {card.actions && card.actions.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                      {card.actions.map((a, i) => (
                        <button key={i} onClick={a.onClick} className="tap44"
                          style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontFamily: "inherit",
                            fontSize: 12.5, fontWeight: 800, borderRadius: 11, padding: "9px 14px",
                            ...(a.primary
                              ? { background: C.accentGrad, color: onAccent(C.gold), border: "none", boxShadow: `${C.glassHi}, 0 8px 18px -10px ${C.gold}88` }
                              : { background: C.glass, backdropFilter: C.glassBlur, WebkitBackdropFilter: C.glassBlur as any, color: C.text, border: `1px solid ${C.glassBd}`, boxShadow: C.glassHi }) }}>
                          {a.label[lang]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Risk reminder — plain, honest footnote (mirrors the University risk line). */}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 2,
          background: "rgba(240,97,109,0.10)", border: "1px solid rgba(240,97,109,0.35)", borderRadius: 12, padding: "10px 13px" }}>
          <ShieldAlert size={15} color="#f0616d" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 12.5, lineHeight: 1.55, color: C.text, opacity: 0.9 }}>
            {he
              ? "תזכורת: זהו כלי תוכנה, לא ייעוץ פיננסי. מסחר כרוך בסיכון לאובדן ההון. אתם מאשרים כל פקודה ואחראים לכל החלטה."
              : "Reminder: this is a software tool, not financial advice. Trading can lose your capital. You approve every order and own every decision."}
          </span>
        </div>

        {/* Deeper reference — the full explanations library. */}
        <button onClick={() => nav("/university")} className="tap44"
          style={{ alignSelf: "center", marginTop: 2, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontFamily: "inherit",
            fontSize: 12.5, fontWeight: 800, color: C.gold, background: "none", border: "none", padding: "6px 10px" }}>
          <Search size={14} color={C.gold} /> {he ? "רוצים לעומק? המדריך המלא וההסברים ←" : "Want more depth? The full guide & glossary →"}
        </button>
      </div>
    </div>
  );
}
