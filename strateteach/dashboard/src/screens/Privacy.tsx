import React from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useI18n } from "../i18n";
import { C, UI, SHADOW } from "../theme";
import FramedTitle from "../components/FramedTitle";
import ScreenBottom from "../components/ScreenBottom";
import HomeTop from "../components/HomeTop";
import LegalMarkdown from "../components/LegalMarkdown";
import { api } from "../app/api";

// Privacy screen — shown in the "Account" group of the main menu.
// Bilingual (Hebrew primary + English), driven by the app's i18n language.
// NOTE: This in-app screen satisfies the store requirement for an in-app
// privacy link. You ALSO need the SAME text at a public URL (no login) for
// the App Store / Play Console submission forms — e.g. served by Caddy at
// https://app.strateteach.com/privacy.

export const LAST_UPDATED = "2026-06-16"; // publish date — bump to re-prompt acknowledgement
const CONTACT = "privacy@strateteach.com";

type Section = { h: string; p: string[] };

const EN: Section[] = [
  {
    h: "Our core principle: non-custodial",
    p: [
      "Strateteach is non-custodial. We never take custody of your funds, and we do not store your exchange API keys on our servers. Your keys stay in your browser and are used only to perform the actions you initiate. We can never move your funds on our own.",
    ],
  },
  {
    h: "Information we collect",
    p: [
      "Account information you provide: username and password (stored only as a salted hash), email (if given, e.g. for password reset), and your per-user protection code (stored hashed).",
      "Information you generate: strategy configurations, backtest runs, signals, paper-trading sessions, profit-engine plans, exports, and suggestions/feedback you submit.",
      "Exchange & market data: your exchange API keys are used transiently in your browser to read balances/positions and place the orders you authorize — they are not stored on our servers. We fetch public market prices from third-party data sources.",
      "Technical data: IP address, device/browser type, and request logs for security, rate-limiting, and troubleshooting; optional error diagnostics via our monitoring provider.",
    ],
  },
  {
    h: "How we use your information",
    p: [
      "To provide and operate the Service, to keep it secure (rate limiting, lockout, audit trail), to communicate with you (e.g. password-reset emails), to deliver optional notifications you enable (e.g. Telegram alerts), and to diagnose and improve reliability.",
    ],
  },
  {
    h: "How your information is shared",
    p: [
      "We do not sell your personal information. We share data only with our hosting/infrastructure providers, an email provider (for transactional emails, if configured), an error-monitoring provider (if enabled), Telegram (for alerts you enable), and the exchanges/data sources needed to perform the actions you initiate — or where required by law.",
    ],
  },
  {
    h: "Data retention",
    p: [
      "We keep account and activity data while your account is active and as needed to operate the Service and meet legal obligations. When you delete your account, we delete or anonymize your personal data within a reasonable period, except where retention is legally required.",
    ],
  },
  {
    h: "Your rights",
    p: [
      "From Settings → Your data you can export your data and delete your account at any time. Depending on where you live (e.g. EU/UK GDPR, California CCPA/CPRA), you may also have rights to access, correct, restrict, or port your data, and to object to certain processing. Contact us to exercise any right.",
    ],
  },
  {
    h: "Security",
    p: [
      "We protect your data with HTTPS/TLS in transit, hashed passwords and protection codes, browser-only handling of exchange keys (never stored server-side), PIN-gating on money-moving actions, rate limiting, account lockout, and security logging. No method is 100% secure, but we use industry-standard measures.",
    ],
  },
  {
    h: "International, children, and changes",
    p: [
      "Your data may be processed outside your country with appropriate safeguards. The Service is not intended for anyone under 18. We may update this policy and will post the new version with an updated date.",
    ],
  },
  {
    h: "Contact",
    p: [`Questions? Email ${CONTACT}. Strateteach (company registration pending — Israel).`],
  },
];

const HE: Section[] = [
  {
    h: "העיקרון המרכזי שלנו: ללא החזקת נכסים",
    p: [
      "Strateteach לעולם אינה מחזיקה בכספים שלכם ואינה שומרת את מפתחות ה‑API של הבורסה שלכם בשרתים שלנו. המפתחות נשארים בדפדפן שלכם ומשמשים אך ורק לביצוע הפעולות שאתם יוזמים. איננו יכולים להזיז את כספכם בעצמנו.",
    ],
  },
  {
    h: "מידע שאנו אוספים",
    p: [
      "מידע חשבון שאתם מספקים: שם משתמש וסיסמה (נשמרת רק כ‑hash מוצפן), אימייל (אם נמסר, למשל לאיפוס סיסמה), וקוד ההגנה האישי שלכם (נשמר כ‑hash).",
      "מידע שאתם יוצרים: הגדרות אסטרטגיה, בדיקות עבר, איתותים, סשנים של מסחר דמו, תוכניות מנוע מסחר, ייצואים והצעות/משוב ששלחתם.",
      "נתוני בורסה ושוק: מפתחות ה‑API שלכם משמשים באופן זמני בדפדפן כדי לקרוא יתרות/פוזיציות ולבצע את ההוראות שאתם מאשרים — הם אינם נשמרים בשרתים שלנו. אנו מושכים מחירי שוק ציבוריים ממקורות צד‑שלישי.",
      "נתונים טכניים: כתובת IP, סוג מכשיר/דפדפן, ויומני בקשות לצורכי אבטחה, הגבלת קצב ופתרון תקלות; אבחון שגיאות אופציונלי דרך ספק הניטור שלנו.",
    ],
  },
  {
    h: "כיצד אנו משתמשים במידע",
    p: [
      "כדי לספק ולהפעיל את השירות, לשמור על אבטחתו (הגבלת קצב, נעילת חשבון, יומן ביקורת), ליצור עמכם קשר (למשל אימייל לאיפוס סיסמה), לספק התראות אופציונליות שתפעילו (למשל טלגרם), ולשפר את היציבות.",
    ],
  },
  {
    h: "כיצד המידע משותף",
    p: [
      "איננו מוכרים את המידע האישי שלכם. אנו משתפים מידע רק עם ספקי האחסון/תשתית שלנו, ספק אימייל (לאימיילים תפעוליים, אם הוגדר), ספק ניטור שגיאות (אם הופעל), טלגרם (להתראות שתפעילו), והבורסות/מקורות הנתונים הדרושים לביצוע הפעולות שאתם יוזמים — או כאשר הדבר נדרש על פי חוק.",
    ],
  },
  {
    h: "שמירת נתונים",
    p: [
      "אנו שומרים נתוני חשבון ופעילות כל עוד החשבון פעיל וכנדרש להפעלת השירות ולעמידה בחובות חוקיות. כשאתם מוחקים את החשבון, אנו מוחקים או הופכים לאנונימי את המידע האישי שלכם בתוך פרק זמן סביר, אלא אם השמירה נדרשת על פי חוק.",
    ],
  },
  {
    h: "הזכויות שלכם",
    p: [
      "ב‑הגדרות ← הנתונים שלך תוכלו לייצא את הנתונים שלכם ולמחוק את החשבון בכל עת. בהתאם למקום מגוריכם (למשל GDPR באיחוד האירופי/בריטניה, CCPA/CPRA בקליפורניה), ייתכן שיש לכם גם זכויות גישה, תיקון, הגבלה או ניוד, וזכות להתנגד לעיבוד מסוים. פנו אלינו למימוש כל זכות.",
    ],
  },
  {
    h: "אבטחה",
    p: [
      "אנו מגנים על הנתונים בעזרת HTTPS/TLS בהעברה, סיסמאות וקודי הגנה מוצפנים (hash), טיפול במפתחות בורסה בדפדפן בלבד (לעולם לא בשרת), נעילת PIN על פעולות כספיות, הגבלת קצב, נעילת חשבון ורישום אבטחה. אף שיטה אינה מאובטחת ב‑100%, אך אנו נוקטים באמצעים מקובלים בתעשייה.",
    ],
  },
  {
    h: "בינלאומי, קטינים ושינויים",
    p: [
      "ייתכן שהנתונים שלכם יעובדו מחוץ למדינתכם עם אמצעי הגנה מתאימים. השירות אינו מיועד למי שמתחת לגיל 18. אנו עשויים לעדכן מדיניות זו ונפרסם גרסה חדשה עם תאריך מעודכן.",
    ],
  },
  {
    h: "יצירת קשר",
    p: [`שאלות? כתבו ל‑${CONTACT}. Strateteach (רישום חברה בהליך — ישראל).`],
  },
];

/** The policy body, reused by the Privacy screen and the acknowledgement gate.
 *  Reads the LIVE, editable copy from the legal store (so the legal counsel's edits in the
 *  Legal Console publish here immediately) and falls back to the shipped HE/EN sections while
 *  loading or if the store is unreachable — so the page is never blank. */
export function PrivacyBody() {
  const { lang, rtl } = useI18n();
  // Public, unauthenticated fetch of the live `privacy` text; cached a while (it changes rarely).
  const q = useQuery({ queryKey: ["legalPublic", "privacy"], queryFn: () => api.legalGet("privacy"), retry: false, staleTime: 60_000 });
  const live = q.data;
  const title = live ? (lang === "he" ? live.titleHe : live.titleEn)
    : (lang === "he" ? "מדיניות פרטיות" : "Privacy Policy");
  const updated = live?.updatedAt
    ? (lang === "he" ? `עודכן לאחרונה: ${String(live.updatedAt).slice(0, 10)}` : `Last updated: ${String(live.updatedAt).slice(0, 10)}`)
    : (lang === "he" ? `עודכן לאחרונה: ${LAST_UPDATED}` : `Last updated: ${LAST_UPDATED}`);
  const sections = lang === "he" ? HE : EN;
  const liveBody = live ? (lang === "he" ? live.bodyHe : live.bodyEn) : "";
  return (
    <div style={{ fontFamily: UI, color: C.text, direction: rtl ? "rtl" : "ltr", lineHeight: 1.7 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <ShieldCheck size={22} color={C.gold} />
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{title}</h1>
      </div>
      <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 20 }}>{updated}</div>

      {liveBody
        // LIVE copy from the store, rendered from markdown.
        ? <LegalMarkdown body={liveBody} rtl={rtl} />
        // Fallback: the shipped sections (while loading / offline).
        : sections.map((s, i) => (
          <section key={i} style={{ marginBottom: 18 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: C.gold, margin: "0 0 6px" }}>{s.h}</h2>
            {s.p.map((para, j) => (
              <p key={j} style={{ margin: "0 0 8px", fontSize: 14.5 }}>{para}</p>
            ))}
          </section>
        ))}

      <div style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${C.line}`, fontSize: 12.5, opacity: 0.6 }}>
        {lang === "he"
          ? "מסמך זה אינו מהווה ייעוץ משפטי. גרסה רשמית מלאה זמינה בכתובת הציבורית של מדיניות הפרטיות."
          : "This document is not legal advice. The full official version is available at our public privacy-policy URL."}
      </div>
    </div>
  );
}

export default function Privacy() {
  const { lang } = useI18n();
  // A readable measure on desktop; full-width and naturally scrolling on mobile
  // (it's a long legal document — internal/page scroll is expected here). The body
  // sits inside a premium rounded card with depth (inner top-highlight + soft drop
  // shadow) so it reads as the same design family as the rest of the app. The shared
  // PrivacyBody stays untouched (the acknowledgement gate reuses it as-is).
  return (
    <div style={{ fontFamily: UI, color: C.text, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <FramedTitle text={lang === "he" ? "פרטיות" : "Privacy"}
        subtitle={lang === "he" ? "המדיניות שלנו · ללא החזקת נכסים" : "Our policy · non-custodial"} />
      <div style={{ maxWidth: 760, width: "100%", margin: "0 auto" }}>
        {/* P&L (תיק) card at the top — the SAME home balance card, collapsed by default. */}
        <HomeTop />
        <div style={{
          background: C.surface, border: `1px solid ${C.line}`, borderRadius: 20,
          padding: "clamp(18px, 4vw, 28px)", marginTop: 8,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.22), ${SHADOW}`,
        }}>
          <PrivacyBody />
        </div>
      </div>
      {/* Persistent bottom cluster (like Home): live/demo P&L + Help-Portal, above the tab bar. */}
      <ScreenBottom />
    </div>
  );
}
