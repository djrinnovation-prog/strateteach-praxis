import React, { useEffect, useState } from "react";
import { Sparkles, FlaskConical, Compass, LineChart, GraduationCap, Link2, User, HelpCircle, Check, Play, X, Globe } from "lucide-react";
import { useI18n } from "../i18n";
import { C, UI, onAccent } from "../theme";
import { track } from "../lib/analytics";
import { brandLogoSrc } from "../lib/brandLogo";

// ── First-run WELCOME onboarding ────────────────────────────────────────────
// A short, friendly 3-step welcome shown ONCE to brand-new users. It is the
// high-level "what is this / how do I get around" greeting; the detailed,
// element-by-element walkthrough stays in the existing coach-marks tour
// (TourLauncher + lib/tours.ts). The two complement each other and coexist:
//   • Primary CTA "בוא נתחיל / Let's go"  → just dismisses into the app.
//   • Secondary  "התחל סיור / Take the tour" → dismisses AND fires the existing
//     Home guided tour via a window event the Home TourLauncher listens for.
//   • "דלג / Skip" (✕ / link)            → dismisses; never shown again.
//
// Once-only is tracked with a localStorage flag in the same style as the app's
// other one-time intros (algo770_demo_intro, algo770_risk_ack, the WelcomeWarning
// notice): once set, this never renders again — for any user, admins included.
const FLAG = "algo770_onboarded";
// Event the Home TourLauncher listens for to start the coach-marks tour.
export const START_TOUR_EVENT = "algo770-start-tour";

const tr = (he: boolean, en: string, heTxt: string) => (he ? heTxt : en);

type Slide = {
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  title: { he: string; en: string };
  body: { he: string; en: string };
};

const SLIDES: Slide[] = [
  {
    Icon: Sparkles,
    title: { he: "ברוכים הבאים ל-Strateteach", en: "Welcome to Strateteach" },
    body: {
      he: "פלטפורמה ללמוד ולתרגל מסחר אלגוריתמי — ולסחור בביטחון, צעד אחר צעד.",
      en: "Learn and practise algorithmic trading — and trade with confidence, one step at a time.",
    },
  },
  {
    Icon: FlaskConical,
    title: { he: "דמו וגם לייב", en: "Demo and Live" },
    body: {
      he: "שתי דרכים לסחור — ושתיהן תמיד זמינות לכם. דמו הוא סימולציה מלאה: כסף וירטואלי, אפס סיכון — תרגלו כמה שתרצו. לייב מבצע פקודות אמיתיות בכסף אמיתי בבורסה שלכם. הבחירה שלכם, בכל רגע.",
      en: "Two ways to trade — and both are always open to you. DEMO is a full simulation: virtual money, zero risk — practise all you like. LIVE places real orders with real money on your exchange. Your choice, anytime.",
    },
  },
  {
    Icon: Compass,
    title: { he: "איפה כל דבר", en: "Where everything lives" },
    body: {
      he: "ארבעת האזורים הראשיים מחכים במסך הבית — והעזרה תמיד בהישג יד.",
      en: "Four main areas wait on the Home screen — and help is always one tap away.",
    },
  },
];

// The four main areas, shown on the orientation slide.
const AREAS: { Icon: React.ComponentType<{ size?: number; color?: string }>; he: string; en: string }[] = [
  { Icon: LineChart, he: "מסחר וניתוח", en: "Trading & Analysis" },
  { Icon: GraduationCap, he: "למידה", en: "Learn" },
  { Icon: Link2, he: "חיבורים", en: "Connect" },
  { Icon: User, he: "חשבון", en: "Account" },
];

export default function WelcomeOnboarding() {
  const { lang, rtl, setLang } = useI18n();
  const he = lang === "he";
  const [done, setDone] = useState(() => {
    try { return localStorage.getItem(FLAG) === "1"; } catch { return true; }
  });
  const [idx, setIdx] = useState(0);

  // While this first-run welcome is live, suppress the existing per-open AI
  // greeting for THIS session (it reads sessionStorage.algo770_greeted when its
  // entitlements resolve a moment later) — so a brand-new user gets ONE welcome,
  // not two stacked overlays. The AI greeting returns on the next app open and
  // via its own "Start now" buttons; this only steps aside on the first session.
  useEffect(() => {
    if (done) return;
    try { sessionStorage.setItem("algo770_greeted", "1"); } catch (_e) { /* */ }
  }, [done]);

  if (done) return null;

  const ink = onAccent(C.gold);
  const accentFill = `linear-gradient(135deg, ${C.accent}, ${C.gold})`;
  const total = SLIDES.length;
  const isLast = idx === total - 1;
  const Fwd = rtl ? "‹" : "›";

  // Persist the once-only flag and unmount. Also suppress the existing per-open AI
  // greeting for THIS session only, so a brand-new user never sees two welcome
  // overlays stacked back-to-back on their very first login (it greets as usual
  // on the next app open).
  function finish(startTour: boolean) {
    try { localStorage.setItem(FLAG, "1"); } catch (_e) { /* */ }
    try { sessionStorage.setItem("algo770_greeted", "1"); } catch (_e) { /* */ }
    track("onboarding_completed", { action: startTour ? "tour" : "skip" });
    setDone(true);
    if (startTour) {
      // Let this overlay unmount first, then ask the Home TourLauncher to start.
      setTimeout(() => {
        try { window.dispatchEvent(new CustomEvent(START_TOUR_EVENT, { detail: { screen: "home" } })); } catch (_e) { /* */ }
      }, 80);
    }
  }

  const slide = SLIDES[idx];

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1200, direction: rtl ? "rtl" : "ltr", fontFamily: UI,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
        background: "rgba(0,0,0,0.62)", backdropFilter: "blur(6px)", animation: "woFade .35s ease" }}
      onClick={() => finish(false)}
    >
      <style>{`
        @keyframes woFade{from{opacity:0}to{opacity:1}}
        @keyframes woRise{from{opacity:0;transform:translateY(16px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes woSlide{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes woFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
      `}</style>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: "relative", width: "min(440px, 94vw)", maxHeight: "90vh", overflowY: "auto",
          // On-design skin-adaptive card: a warm gold-tinted surface behind the app's rounded
          // gold frame + bevel (the same brand frame language Home's headline uses), instead of
          // the old generic dark card. Re-skins via C.* across Navy / Peach / Nude / Sea.
          background: `linear-gradient(160deg, ${C.gold}22 0%, ${C.surface} 44%, ${C.surface2} 100%)`,
          border: `2px solid ${C.gold}`, borderRadius: 24, padding: "26px 22px 20px", textAlign: "center",
          color: C.text,
          boxShadow: `inset 2px 2px 6px ${C.accentHi}66, inset -3px -3px 9px ${C.gold}22, 0 28px 70px -18px rgba(0,0,0,0.62)`,
          animation: "woRise .45s cubic-bezier(0.22,0.61,0.36,1)" }}
      >
        {/* top row: language toggle + skip (✕) */}
        <div style={{ position: "absolute", top: 12, insetInlineStart: 12, insetInlineEnd: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={() => setLang(he ? "en" : "he")} aria-label={he ? "החלף שפה" : "Switch language"}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, background: C.surface2, border: `1px solid ${C.line}`,
              color: C.gold, borderRadius: 999, padding: "6px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: UI,
              minHeight: 44, minWidth: 44, justifyContent: "center" }}>
            <Globe size={13} /> {he ? "EN" : "עברית"}
          </button>
          <button onClick={() => finish(false)} aria-label={he ? "דלג" : "Skip"}
            style={{ width: 44, height: 44, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              background: C.surface2, border: `1px solid ${C.line}`, color: C.text, cursor: "pointer" }}>
            <X size={17} />
          </button>
        </div>

        {/* Branded StrateTeach PNG wordmark inside the app's rounded skin-adaptive frame
            (Home's headline-frame recipe) — the entry screen now leads with our logo. */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: 34, marginBottom: 2 }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
            padding: "12px 22px 8px",
            background: `linear-gradient(145deg, ${C.gold}30, ${C.gold}0c 58%, ${C.gold}14)`,
            borderRadius: 16,
            borderTop: `2px solid ${C.gold}e0`, borderLeft: `2px solid ${C.gold}e0`,
            borderRight: `2px solid ${C.gold}55`, borderBottom: `2px solid ${C.gold}55`,
            boxShadow: `inset 2px 2px 4px ${C.accentHi}99, inset -3px -3px 7px ${C.gold}3a, 0 14px 34px -24px ${C.gold}55` }}>
            <img src={brandLogoSrc()} alt="StrateTeach" style={{ width: "min(210px, 58vw)", height: "auto", display: "block", marginBottom: -10 }} />
          </div>
        </div>

        {/* halo step icon (smaller now the wordmark leads) */}
        <div style={{ position: "relative", width: 72, height: 72, margin: "10px auto 12px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `radial-gradient(circle at 50% 40%, ${C.gold}33, transparent 70%)` }} />
          <span style={{ width: 60, height: 60, borderRadius: "50%", background: accentFill,
            display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 10px 28px -10px ${C.gold}aa`,
            animation: "woFloat 3s ease-in-out infinite" }}>
            <slide.Icon size={28} color={ink} />
          </span>
        </div>

        {/* step label */}
        <div style={{ fontSize: 11, letterSpacing: "0.14em", color: C.muted, marginBottom: 6 }}>
          {tr(he, `STEP ${idx + 1} OF ${total}`, `שלב ${idx + 1} מתוך ${total}`)}
        </div>

        {/* slide content (re-keys to re-animate on change) */}
        <div key={idx} style={{ animation: "woSlide .35s ease" }}>
          <h1 style={{ fontSize: 23, fontWeight: 800, margin: "0 0 10px", letterSpacing: "0.01em" }}>{he ? slide.title.he : slide.title.en}</h1>
          <p style={{ color: C.muted, fontSize: 14.5, lineHeight: 1.6, margin: "0 auto", maxWidth: 360 }}>{he ? slide.body.he : slide.body.en}</p>

          {/* orientation slide: the four areas + a help line */}
          {idx === total - 1 && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, margin: "18px auto 0", maxWidth: 360 }}>
                {AREAS.map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", borderRadius: 12,
                    background: C.surface2, border: `1px solid ${C.line}`, textAlign: rtl ? "right" : "left" }}>
                    <span style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 9, background: C.surface,
                      border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <a.Icon size={15} color={C.gold} />
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{he ? a.he : a.en}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, margin: "14px auto 0", maxWidth: 360,
                color: C.muted, fontSize: 12.5, lineHeight: 1.5 }}>
                <HelpCircle size={15} color={C.gold} style={{ flexShrink: 0 }} />
                <span>{tr(he, "Need help? Look for the tour (?) button on any screen, or the support area.", "צריכים עזרה? חפשו את כפתור הסיור (?) בכל מסך, או את אזור התמיכה.")}</span>
              </div>
            </>
          )}
        </div>

        {/* progress dots */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, margin: "20px 0 16px" }}>
          {SLIDES.map((_, i) => (
            <span key={i} style={{ width: i === idx ? 22 : 8, height: 8, borderRadius: 999,
              background: i === idx ? accentFill : C.line, transition: "width .25s ease" }} />
          ))}
        </div>

        {/* actions */}
        {!isLast ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}
              style={{ ...ghostBtn, color: idx === 0 ? C.faint : C.muted, cursor: idx === 0 ? "default" : "pointer", visibility: idx === 0 ? "hidden" : "visible" }}>
              {tr(he, "Back", "חזרה")}
            </button>
            <button onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
              style={{ ...primaryBtn, background: accentFill, color: ink }}>
              {tr(he, "Next", "הבא")} <span style={{ fontSize: 18, lineHeight: 1 }}>{Fwd}</span>
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={() => finish(false)} style={{ ...primaryBtn, background: accentFill, color: ink, justifyContent: "center", width: "100%" }}>
              <Check size={17} /> {tr(he, "Let's go", "בוא נתחיל")}
            </button>
            <button onClick={() => finish(true)}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%",
                background: "transparent", border: `1px solid ${C.line}`, color: C.text, borderRadius: 12, padding: "11px 18px",
                fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: UI, minHeight: 44 }}>
              <Play size={15} color={C.gold} /> {tr(he, "Take the tour", "התחל סיור")}
            </button>
            <button onClick={() => finish(false)} style={{ background: "none", border: "none", color: C.muted, fontSize: 12.5, cursor: "pointer", fontFamily: UI, padding: 6 }}>
              {tr(he, "Skip", "דלג")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8, border: "none", cursor: "pointer",
  fontWeight: 800, fontSize: 15, borderRadius: 12, padding: "12px 24px", fontFamily: UI, minHeight: 44,
};
const ghostBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: `1px solid ${C.line}`,
  borderRadius: 12, padding: "11px 18px", fontSize: 14, fontWeight: 700, fontFamily: UI, minHeight: 44,
};
