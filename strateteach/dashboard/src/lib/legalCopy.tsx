import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../app/api";
import { C, UI } from "../theme";

// ── DRAFT legal copy — PENDING RAZ ──────────────────────────────────────────────
// These are REAL bilingual DRAFTS grounded in Israeli law (open-source research), not
// blanks: Raz reviews & edits rather than writing from scratch. Every surface that
// shows one keeps a visible amber DRAFT badge — nothing here is final legal text until
// Raz signs off in /legal-portal. [PLACEHOLDER …] markers are left verbatim wherever a
// human decision is required (entity name, retention periods, DPO, contact); do not
// invent those. When Raz approves, this ONE file is edited and every surface updates.
//
// Block → key map (matches Raz's 4 /legal-portal tasks):
//   Block A · Regulatory status/disclaimer  → REGULATORY_DISCLAIMER   (task legal_entity_reg / 1a)
//   Block B · Risk disclosure                → RISK_DISCLOSURE + RISK_POINTS (task legal_risk_disclosure_copy / 1b)
//   Block C · Privacy + retention + rights   → PRIVACY_POLICY + RETENTION_TEXT (task legal_privacy_retention / 1c)
//   Block D · Analytics consent              → CONSENT_TITLE + CONSENT_BODY (task legal_analytics_consent_copy / 1d)

export type Bi = { he: string; en: string };

// Which Raz task backs a given placeholder (shown in the badge tooltip).
export const RAZ_ITEMS = {
  entity: { he: "טיוטה לאישור רז · זהות הישות והרגולציה (1a)", en: "Draft for Raz · legal entity + regulatory status (1a)" },
  risk: { he: "טיוטה לאישור רז · נוסח גילוי סיכונים (1b)", en: "Draft for Raz · risk-disclosure copy (1b)" },
  privacy: { he: "טיוטה לאישור רז · פרטיות + שמירה + מחיקה (1c)", en: "Draft for Raz · privacy + retention + deletion (1c)" },
  consent: { he: "טיוטה לאישור רז · נוסח הסכמת אנליטיקס (1d)", en: "Draft for Raz · analytics-consent copy (1d)" },
} as const;
export type RazItem = keyof typeof RAZ_ITEMS;

/** A small amber "DRAFT — pending Raz" chip rendered beside draft legal copy. */
export function DraftBadge({ item, he }: { item: RazItem; he: boolean }) {
  const label = he ? RAZ_ITEMS[item].he : RAZ_ITEMS[item].en;
  return (
    <span
      title={label}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, fontFamily: UI, fontSize: 11, fontWeight: 700,
        color: "#8a5a00", background: "#ffe6a8", border: "1px solid #e6b84d", borderRadius: 999,
        padding: "2px 9px", lineHeight: 1.4, whiteSpace: "nowrap",
      }}
    >
      ⚖︎ {he ? "טיוטה — ממתין לאישור רז" : "DRAFT — pending Raz"}
    </span>
  );
}

// ── BLOCK A · Regulatory status / disclaimer (footer + before money actions · 1a) ──
export const REGULATORY_DISCLAIMER: Bi = {
  en:
    "Strateteach (operated by [PLACEHOLDER — registered legal entity name + company no.]) provides " +
    "technology tools: market scanning, educational content, backtesting, and automated strategy " +
    "simulations. Strateteach does not provide personalized investment advice, investment marketing, " +
    "or portfolio management within the meaning of the Regulation of Investment Advice, Investment " +
    "Marketing and Portfolio Management Law, 5755-1995, is not licensed under that law, and nothing " +
    "on the platform is a recommendation tailored to your personal circumstances to buy, sell, or " +
    "hold any security or financial asset. Strateteach does not hold, custody, or transfer your funds " +
    "or assets — any trading takes place in your own account at a third-party exchange, using API " +
    "keys you control. You are solely responsible for your trading decisions. Consider consulting a " +
    "licensed investment advisor before making decisions.",
  he:
    "Strateteach (מופעל על-ידי [PLACEHOLDER — שם הישות המשפטית הרשומה ומספר ח.פ.]) מספק כלים " +
    "טכנולוגיים: סריקת שווקים, תוכן לימודי, בדיקות היסטוריות (בקטסטים) והדמיות של אסטרטגיות אוטומטיות. " +
    "Strateteach אינו מספק ייעוץ השקעות, שיווק השקעות או ניהול תיקי השקעות כהגדרתם בחוק הסדרת העיסוק " +
    "בייעוץ השקעות, בשיווק השקעות ובניהול תיקי השקעות, התשנ״ה-1995, אינו בעל רישיון לפי חוק זה, ואין " +
    "באמור בפלטפורמה משום המלצה המותאמת לנסיבותיך האישיות לקנות, למכור או להחזיק נייר ערך או נכס " +
    "פיננסי כלשהו. Strateteach אינו מחזיק, שומר או מעביר את כספך או נכסיך — כל מסחר מתבצע בחשבונך שלך " +
    "אצל זירת מסחר צד-שלישי, באמצעות מפתחות API שבשליטתך. האחריות להחלטות המסחר היא עליך בלבד. מומלץ " +
    "לשקול התייעצות עם יועץ השקעות בעל רישיון לפני קבלת החלטות.",
};

// ── BLOCK D · Analytics consent (explicit / granular · 1d) ───────────────────────
export const CONSENT_TITLE: Bi = {
  he: "עזרו לנו לשפר את Strateteach (רשות)",
  en: "Help us improve Strateteach (optional)",
};
export const CONSENT_BODY: Bi = {
  he:
    "באישורך, נאסוף מידע שימוש אנונימי — באילו מסכים ותכונות אתה משתמש — כדי לשפר את האפליקציה.\n\n" +
    "מה נאסף: אירועי מסך ותכונה המשויכים למזהה אקראי (לא שמך).\n\n" +
    "מה לעולם לא נאסף כאן: פרטי ההתחברות למסחר, מפתחות הבורסה, תוכן אסטרטגיות או סכומי כסף כלשהם.\n\n" +
    "זו בחירה שברשות — האפליקציה עובדת במלואה בין אם תאשר ובין אם לא, וניתן לשנות את הבחירה בכל עת " +
    "בהגדרות ← המידע שלי.",
  en:
    "With your permission, we'll collect anonymous usage data — which screens and features you use — " +
    "to make the app better.\n\n" +
    "What we collect: screen and feature events tied to a random ID (not your name).\n\n" +
    "What we never collect here: your trading credentials, exchange keys, strategy content, or any " +
    "money amounts.\n\n" +
    "This is optional — the app works fully whether you accept or not, and you can change your choice " +
    "anytime in Settings → My Data.",
};
export const CONSENT_ACCEPT: Bi = { he: "מאשר/ת איסוף נתוני שימוש", en: "Accept usage analytics" };
export const CONSENT_DECLINE: Bi = { he: "לא, תודה", en: "No thanks" };
export const CONSENT_PRIVACY_LINK: Bi = { he: "מדיניות הפרטיות", en: "Privacy policy" };

// ── BLOCK B · Risk disclosure (before every commitment · 1b) ─────────────────────
export const RISK_TITLE: Bi = { he: "אזהרת סיכון", en: "Risk warning" };
export const RISK_DISCLOSURE: Bi = {
  en:
    "Trading in securities, cryptocurrencies, and other financial assets involves a high risk of loss " +
    "and is not suitable for everyone. You may lose some or all of your capital. Cryptocurrency markets " +
    "are highly volatile and only partially regulated in Israel. Demo, simulation, and backtest results " +
    "are hypothetical, do not represent real trading, and are not a promise or indication of future " +
    "results — past performance does not guarantee future performance. Automated strategies " +
    "('AutoPilots') can and do incur losses; they run on your own exchange account and you remain " +
    "responsible for it. Strateteach does not guarantee any profit. Only trade with money you can " +
    "afford to lose. This is not personalized investment advice.",
  he:
    "מסחר בניירות ערך, במטבעות קריפטוגרפיים ובנכסים פיננסיים אחרים כרוך בסיכון גבוה להפסד ואינו מתאים " +
    "לכל אדם. אתה עלול לאבד חלק מכספך או את כולו. שוקי הקריפטו תנודתיים מאוד ומוסדרים באופן חלקי בלבד " +
    "בישראל. תוצאות דמו, הדמיה ובדיקות היסטוריות (בקטסט) הן תיאורטיות, אינן משקפות מסחר אמיתי, ואינן " +
    "הבטחה או אינדיקציה לתוצאות עתידיות — ביצועי עבר אינם מבטיחים ביצועים עתידיים. אסטרטגיות אוטומטיות " +
    "('טייסים אוטומטיים') עלולות לגרום להפסדים; הן פועלות בחשבון המסחר שלך והאחריות עליו נותרת שלך. " +
    "Strateteach אינו מבטיח רווח כלשהו. סחור אך ורק בכסף שאתה יכול להרשות לעצמך להפסיד. אין באמור ייעוץ " +
    "השקעות אישי.",
};
// Short bullets derived from the disclosure above — used where a compact list reads better.
export const RISK_POINTS: Bi[] = [
  { he: "מסחר כרוך בסיכון גבוה — אתה עלול לאבד חלק מכספך או את כולו.", en: "Trading carries high risk — you may lose part or all of your capital." },
  { he: "דמו/הדמיה/בקטסט הם תיאורטיים ואינם מסחר אמיתי.", en: "Demo/simulation/backtest are hypothetical, not real trading." },
  { he: "ביצועי עבר אינם מבטיחים ביצועים עתידיים.", en: "Past performance does not guarantee future performance." },
  { he: "אין באמור ייעוץ השקעות אישי. האחריות עליך בלבד.", en: "This is not personalized investment advice. You are responsible." },
];
export const NO_HIDDEN_FEES: Bi = {
  he: "אין עמלות נסתרות — המחיר המוצג הוא המחיר שתחויבו בו.",
  en: "No hidden fees — the price shown is what you are charged.",
};
export const PRELAUNCH_BILLING: Bi = {
  he: "החיוב הוא טרום-השקה: ההרשמה נרשמת עכשיו, וגבייה בפועל תחל עם ההשקה.",
  en: "Billing is pre-launch: your signup is recorded now; actual charging begins at launch.",
};

// ── BLOCK C · Privacy policy + retention + rights (Amendment 13 · 1c) ─────────────
export const PRIVACY_POLICY: Bi = {
  en:
    "Privacy Policy (draft). What we collect: account details (name, email, phone); your exchange API " +
    "keys (trade-only, used to run the service); trading and backtest activity; support messages; and " +
    "— only if you consent — pseudonymous product-usage analytics (which screens/features you use). " +
    "Especially-sensitive data: financial details are treated as 'especially sensitive' under the " +
    "Protection of Privacy Law, 5741-1981 (as amended by Amendment 13, in force 14 Aug 2025) and " +
    "protected accordingly. Why we use it: to operate and secure the service, to provide the features " +
    "you request, and to improve the product. We do not sell your data. Who we share it with: the " +
    "third-party exchange you connect; service providers who help us operate (e.g., messaging/email " +
    "and hosting providers); and authorities where required by law. Your rights: access the data we " +
    "hold about you and receive a copy (in Hebrew or English), correct inaccuracies, request deletion " +
    "when the data is no longer needed, and withdraw analytics consent at any time — from Settings → " +
    "My Data. Retention: we keep data only as long as necessary. [PLACEHOLDER — Raz/Dan to set " +
    "periods]. Security: [PLACEHOLDER — summary of measures]. Questions about your data: [PLACEHOLDER " +
    "— contact + whether a Data Protection Officer is appointed].",
  he:
    "מדיניות פרטיות (טיוטה). מה אנו אוספים: פרטי חשבון (שם, אימייל, טלפון); מפתחות ה-API של הבורסה שלך " +
    "(למסחר בלבד, לצורך הפעלת השירות); פעילות מסחר ובדיקות היסטוריות; פניות תמיכה; ורק אם נתת הסכמה — " +
    "נתוני שימוש פסאודונימיים על אילו מסכים/תכונות אתה משתמש. מידע רגיש במיוחד: פרטים פיננסיים נחשבים " +
    "'מידע בעל רגישות גבוהה' לפי חוק הגנת הפרטיות, התשמ״א-1981 (כפי שתוקן בתיקון 13, שנכנס לתוקף ב-14 " +
    "באוגוסט 2025) ומוגנים בהתאם. מדוע אנו משתמשים בו: להפעלת השירות ואבטחתו, לאספקת התכונות שביקשת, " +
    "ולשיפור המוצר. איננו מוכרים את המידע שלך. עם מי אנו חולקים: זירת המסחר של צד שלישי שאליה התחברת; " +
    "ספקי שירות המסייעים בהפעלה (למשל ספקי הודעות/דוא״ל ואירוח); ורשויות ככל שנדרש על-פי דין. זכויותיך: " +
    "לעיין במידע שאנו מחזיקים אודותיך ולקבל עותק (בעברית או באנגלית), לתקן אי-דיוקים, לבקש מחיקה כאשר " +
    "המידע אינו נחוץ עוד, ולחזור בך מהסכמה לאנליטיקס בכל עת — דרך הגדרות ← המידע שלי. שמירת מידע: אנו " +
    "שומרים מידע רק כל עוד נחוץ. [PLACEHOLDER — רז/דן לקביעת תקופות]. אבטחה: [PLACEHOLDER — תמצית " +
    "אמצעים]. שאלות על המידע שלך: [PLACEHOLDER — פרטי קשר והאם מונה ממונה הגנת פרטיות].",
};
// ── Runtime override: read the live, Raz-editable copy from the DB (lib defaults are the
// fallback). Each block also carries an `approved` flag — the DRAFT badge shows only while
// a block is NOT approved, and Raz's Confirm & Approve clears it app-wide automatically.
export type LegalBlockKey = "disclaimer" | "risk" | "privacy" | "consent";

// block → (file draft default, which Raz task backs it) — used as fallback + badge tooltip.
const BLOCK_DEFAULT: Record<LegalBlockKey, { def: Bi; item: RazItem }> = {
  disclaimer: { def: REGULATORY_DISCLAIMER, item: "entity" },
  risk: { def: RISK_DISCLOSURE, item: "risk" },
  privacy: { def: PRIVACY_POLICY, item: "privacy" },
  consent: { def: CONSENT_BODY, item: "consent" },
};

export type LegalBlockView = { text: string; approved: boolean; item: RazItem };

/** Fetch the live legal-copy blocks (cached) and resolve each to the current text +
 * approval, falling back to the file drafts. `approved` defaults to false until a row
 * is loaded, so unapproved / not-yet-loaded copy always shows the DRAFT badge. */
export function useLegalCopy() {
  const q = useQuery({ queryKey: ["legalCopy"], queryFn: () => api.legalCopyList(), retry: false, staleTime: 300_000 });
  const byBlock: Record<string, { he: string; en: string; approved: boolean }> = {};
  for (const b of (q.data?.blocks || [])) byBlock[b.block] = { he: b.he, en: b.en, approved: b.approved };
  const get = (block: LegalBlockKey, he: boolean): LegalBlockView => {
    const { def, item } = BLOCK_DEFAULT[block];
    const row = byBlock[block];
    if (row) return { text: (he ? row.he : row.en) || (he ? def.he : def.en), approved: row.approved, item };
    return { text: he ? def.he : def.en, approved: false, item };
  };
  return { get, isLoading: q.isLoading };
}

// Retention shown in Settings → My Data. Suggested defaults (pending Raz/Dan confirmation),
// not blanks — so the user sees a concrete answer while the exact AML period is confirmed.
export const RETENTION_TEXT: Bi = {
  he:
    "אנו שומרים מידע רק כל עוד נחוץ. ברירות מחדל מוצעות (בכפוף לאישור): מידע של חשבון פעיל נשמר כל עוד " +
    "החשבון פעיל; לאחר סגירת החשבון — עד 12 חודשים, אלא אם הדין מחייב תקופה ארוכה יותר; אנליטיקס " +
    "פסאודונימי — עד כ-14 חודשים; רשומות אבטחה/ביקורת ואיסור הלבנת הון — לתקופה הנדרשת בדין " +
    "[PLACEHOLDER — לאשר תקופה מדויקת]; מפתחות ה-API של הבורסה נמחקים מיד עם הניתוק.",
  en:
    "We keep data only as long as necessary. Suggested defaults (pending confirmation): active-account " +
    "data is kept while your account is active; after closure — up to 12 months, unless a longer " +
    "period is required by law; pseudonymous analytics — up to ~14 months; security/audit and " +
    "anti-money-laundering records — for the period required by law [PLACEHOLDER — confirm exact]; " +
    "exchange API keys are deleted immediately on disconnect.",
};
