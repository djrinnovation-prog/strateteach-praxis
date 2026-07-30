// ── Owners Portal — structured content config ────────────────────────────────
// PHASE 1 of the Owners + project-management system. All the portal's copy lives
// here as pure, bilingual (HE/EN) data so the LATER phases (a per-partner task
// board, an audit + voting flow, a daily-summary portal) can build on the SAME
// source of truth without touching the presentation. Icons are referenced by a
// stable string key and mapped to lucide components in the screen, so this module
// stays free of React/JSX imports.

export type Bi = { he: string; en: string };

// ── 1) OVERVIEW — "What we built" (professional showcase) ────────────────────
// Each section becomes a card; `points` are the bullet lines within it.
export type ShowcaseSection = {
  id: string;
  icon: string;          // lucide key, resolved in the screen
  title: Bi;
  lead?: Bi;             // optional one-line emphasis under the title
  points: Bi[];
};

export const SHOWCASE: ShowcaseSection[] = [
  {
    id: "product",
    icon: "Gem",
    title: { he: "המוצר — Strateteach", en: "Product — Strateteach" },
    lead: {
      he: "מערכת מסחר ואוטומציה אלגוריתמית. חזון: \"לסחור במקום אחד\" — מהשקה רכה ועד מוצר מוכן למכירה.",
      en: "An algorithmic trading & automation system. Vision: \"trade in one place\" — from soft-launch to a sellable product.",
    },
    points: [
      { he: "פלטפורמה אחת לסריקה, מסחר, בדיקות ואוטומציה — לכל סוגי הנכסים.", en: "One platform for scanning, trading, backtesting and automation — across every asset class." },
      { he: "בנויה לצמיחה: מהתנסות בדמו ועד חשבון חי אמיתי, באותה חוויה.", en: "Built to grow: from a demo try-out to a real live account, in one continuous experience." },
    ],
  },
  {
    id: "ux",
    icon: "LayoutDashboard",
    title: { he: "בית וחוויית משתמש", en: "Home & UX" },
    lead: {
      he: "עיצוב מחדש נקי — כל 12 המסכים על מתודולוגיה אחת: 2 פעולות מרכזיות + שורת אפשרויות.",
      en: "A clean redesign — all 12 screens on one methodology: 2 central actions + an options row.",
    },
    points: [
      { he: "הבית מציג רווח/הפסד אמיתי של התיק (צמיחה מול ההון שהופקד — למשל 250$→281$ = 12.5%+).", en: "Home shows real portfolio P&L (growth vs deposited capital — e.g. $250→$281 = +12.5%)." },
      { he: "מתג לייב/דמו מאוחד, רווח/הפסד כן לכל פוזיציה, גיבור זכוכית (glassmorphic) ואריחים.", en: "A unified live/demo toggle, honest per-position P&L, a glassmorphic hero + tiles." },
      { he: "4 סקינים ממותגים (Navy + אפרסק/ים/ניוד) ממניפות גוונים של Pantone, זכוכית מוקצפת, בהיר+כהה.", en: "4 brand skins (Navy + Peach/Sea/Nude) from Pantone tone-fans with frosted glass, light + dark." },
      { he: "רב-לשוני עברית/אנגלית + RTL; נגישות (WCAG, לא-רק-צבע, פאנל ♿); כל 7 מצבי המסך.", en: "Multi-language HE/EN + RTL; accessibility (WCAG, not-color-only, ♿ panel); all 7 screen states." },
    ],
  },
  {
    id: "core",
    icon: "TrendingUp",
    title: { he: "ליבת המסחר", en: "Trading core" },
    lead: {
      he: "סריקה יומית אוטומטית של כל הנכסים → 10 הפריצות המובילות מזינות את מנוע המסחר (חי + דמו).",
      en: "A daily automatic scan across all assets → top-10 breakouts feeding the Trading Engine (live + demo).",
    },
    points: [
      { he: "מנוע מסחר, סיגנל בוט (Webhooks של TradingView), בדיקות (סימבול יחיד, ארעיות), מעבדת אסטרטגיות.", en: "Trading Engine, Signal Bot (TradingView webhooks), Backtests (single-symbol, ephemeral), Strategy Lab." },
      { he: "נתוני שוק: קריפטו דרך CCXT (רב-בורסות), מניות/מתכות/סחורות דרך yfinance.", en: "Market data: crypto via CCXT (multi-exchange), stocks/metals/commodities via yfinance." },
    ],
  },
  {
    id: "trust",
    icon: "ShieldCheck",
    title: { he: "אמון ובטיחות", en: "Trust & safety" },
    lead: {
      he: "שכבת בטיחות פיננסית: תצוגה מקדימה + אישור לפני כל פעולה בכסף אמיתי, סטטוס ושגיאות כנים, ולידציות ומגבלות.",
      en: "A financial-safety layer: preview + confirm before real-money actions, honest status + error copy, validations + limits.",
    },
    points: [
      { he: "מפתחות בורסה מוצפנים בצד השרת (החיבור עוקב אחרי המשתמש, שורד ניקוי מטמון), בידוד קפדני לכל משתמש.", en: "Exchange keys encrypted server-side (connection follows the user, survives cache-clear), strict per-user isolation." },
      { he: "שער תחזוקה, אימות ובקרת גישה.", en: "Maintenance gate, auth + access control." },
      { he: "משפטי — מדיניות פרטיות + הבהרות סיכון/סימולציה + קונסולת משפט חיה (רז עורך את כל הטקסטים, ללא deploy).", en: "Legal — privacy policy + risk/simulation disclaimers + a live Legal Console (Raz edits all legal texts, no deploy)." },
    ],
  },
  {
    id: "growth",
    icon: "BarChart3",
    title: { he: "צמיחה ותפעול", en: "Growth & ops" },
    points: [
      { he: "אנליטיקה ומדידת KPI; מדריך למתחילים + onboarding + סיורים מודרכים.", en: "Analytics + KPI measurement; beginner guide + onboarding + guided tours." },
      { he: "פורטל עזרה + צ'אט תמיכה בתוך האפליקציה + מענה מנהל.", en: "Help Portal + in-app support chat + admin reply." },
      { he: "התראות רב-ערוציות (SMS חי דרך Twilio, WhatsApp, דוחות מתוזמנים; אימייל ממתין למפתח).", en: "Multi-channel notifications (SMS live via Twilio, WhatsApp, scheduled reports; email pending key)." },
      { he: "תפקידי צוות (מנהל/משפטי/תוכן/בעלים); \"עדכון לגרסה האחרונה\" בהקשה + חותמת בנייה בשעון ישראל.", en: "Team roles (admin/legal/content/owner); one-tap \"update to latest\" + Israel-time build stamp." },
    ],
  },
  {
    id: "open",
    icon: "Rocket",
    title: { he: "פתוח / עסקי (להשקה)", en: "Open / business (to launch)" },
    lead: {
      he: "מה שנותר כדי לצאת לשוק — רובו תלוי בגורמים חיצוניים (מפתחות, רישום, אישורים).",
      en: "What's left to go to market — most of it depends on external parties (keys, registration, approvals).",
    },
    points: [
      { he: "תשלומים (Stripe מוכן בתשתית, צריך מפתחות), אימייל (מפתח SendGrid), WhatsApp פרודקשן (Meta).", en: "Payments (Stripe scaffolded, needs keys), email (SendGrid key), WhatsApp prod (Meta)." },
      { he: "רישום חברה, IP/מקוריות המנוע, Apple IAP, והסרת שער התחזוקה.", en: "Company registration, engine IP/provenance, Apple IAP, and lifting the maintenance gate." },
    ],
  },
];

// ── 2) TEAM ──────────────────────────────────────────────────────────────────
export type Partner = {
  id: string;
  name: string;
  icon: string;          // lucide key
  role: Bi;
  emphasis: Bi;
  // Optional personal SUMMARY grounded in the audit (the fintech-spec + technical/legal
  // gap review) — rendered on the partner's personal screen to frame their open items.
  auditSummary?: Bi;
};

export const TEAM: Partner[] = [
  { id: "dan", name: "Dan", icon: "Crown",
    role: { he: "בעלים ומנהל", en: "Owner & Admin" },
    emphasis: { he: "מייסד-מפעיל.", en: "Founder-operator." } },
  { id: "rafi", name: "Rafi", icon: "Gem",
    role: { he: "משקיע ובעלים", en: "Investor & Owner" },
    emphasis: { he: "תפיסת השקעה מדורגת.", en: "Phased investment outlook." } },
  { id: "yoav", name: "Yoav", icon: "Clapperboard",
    role: { he: "בעלים וראש קריאייטיב", en: "Owner & Head of Creative" },
    emphasis: { he: "רילים וקורסים.", en: "Reels & Courses." } },
  { id: "oren", name: "Oren", icon: "Code2",
    role: { he: "מפתח ראשי וראש IT", en: "Lead Developer & Head of IT" },
    emphasis: { he: "פיתוח וטכנולוגיה.", en: "Engineering & technology." },
    auditSummary: {
      he: "על בסיס האודיט (מפרט הפינטק + סקירת הפערים הטכניים): הפריטים הפתוחים הטכניים ומוכנות לפרודקשן — רשימת פערים, פריסה/תשתית (reload של /legal ב-Caddy, חיווט משתני סביבה, צנרת פריסה), IP/מקוריות המנוע (המנוע המוטמע ופורט ה-PineScript — אישור בעלות/מסלול כתיבה מחדש), סקיילינג והקשחת אבטחה להשקה.",
      en: "Based on the audit (the fintech-spec + technical gap review): the open TECHNICAL / production-readiness items — the gap list, deploy/infra (Caddy /legal reload, prod env wiring, deploy pipeline), engine IP/provenance (the vendored engine + PineScript port — confirm ownership / rewrite path), plus scaling + security hardening for launch.",
    } },
  { id: "raz", name: "Raz", icon: "Scale",
    role: { he: "יועצת משפטית, ריטיינר", en: "Legal Counsel, retainer" },
    emphasis: { he: "רישום זכויות ופטנטים תחילה.", en: "Rights registration + patents first." },
    auditSummary: {
      he: "על בסיס האודיט (מפרט הפינטק + סקירת הפערים המשפטיים): הפריטים הפתוחים המשפטיים/רגולטוריים — השלמת הטקסטים המשפטיים בקונסולת המשפט (פרטיות כולל גילוי המפתחות המוצפנים, תנאי שימוש, הבהרות סיכון/סימולציה), גילויים ורגולציה ישראלית (אזהרות סיכון ועמלות לפני פעולות בכסף אמיתי), עמדה רגולטורית למפתחות מסחר-בלבד בשרת, תנאי מקדים ל-IP של המנוע (סקירת מקוריות/בעלות), ורישום זכויות/פטנטים + רישוי נתונים.",
      en: "Based on the audit (the fintech-spec + legal gap review): the open LEGAL / regulatory items — finalizing the legal texts in the Legal Console (privacy incl. the encrypted-keys disclosure, terms of use, risk + simulation disclaimers), disclosures + Israeli regulation (risk warnings + fees before real-money actions), the regulatory posture for server-held trade-only keys, the engine-IP precondition (provenance/ownership review), plus rights registration + patents and data licensing.",
    } },
  { id: "raful", name: "Raful", icon: "Briefcase",
    role: { he: "מנהל פיתוח עסקי", en: "Head of Business Development" },
    emphasis: { he: "שותפויות והזדמנויות צמיחה.", en: "Partnerships & growth opportunities." } },
];

export const GOVERNANCE: Bi = {
  he: "החלטות הבעלים מתקבלות לאחר התייעצות עם רז (משפטי) ואורן (טכני).",
  en: "Owners' decisions are made after feedback from Raz (legal) + Oren (technical).",
};

// ── 3) PROGRESS — roadmap toward a sellable product ──────────────────────────
export type PhaseStatus = "current" | "in_progress" | "upcoming";
export type Phase = {
  id: string;
  label: Bi;
  status: PhaseStatus;
  pct: number;           // 0..100 — a simple headline progress per phase
  blurb: Bi;
};

export const PHASES: Phase[] = [
  { id: "p0", status: "current", pct: 90,
    label: { he: "שלב 0 · השקה רכה (דמו)", en: "Phase 0 · Soft-launch (demo)" },
    blurb: { he: "מוצר חי בדמו, נבדק על ידי הצוות והמשתמשים הראשונים.", en: "Live in demo, exercised by the team + first users." } },
  { id: "p1", status: "in_progress", pct: 75,
    label: { he: "שלב 1 · בטיחות + משפטי", en: "Phase 1 · Safety + legal" },
    blurb: { he: "שכבת בטיחות פיננסית, בידוד משתמשים, וטקסטים משפטיים חיים.", en: "Financial-safety layer, per-user isolation, and live legal texts." } },
  { id: "p2", status: "upcoming", pct: 20,
    label: { he: "שלב 2 · הרחבה (Scaling)", en: "Phase 2 · Scaling" },
    blurb: { he: "תשלומים, אימייל, WhatsApp פרודקשן, ורישום חברה.", en: "Payments, email, WhatsApp prod, and company registration." } },
  { id: "p3", status: "upcoming", pct: 10,
    label: { he: "שלב 3 · צמיחה", en: "Phase 3 · Growth" },
    blurb: { he: "שיווק, קורסים, Apple IAP, והסרת שער התחזוקה.", en: "Marketing, courses, Apple IAP, and lifting the maintenance gate." } },
];

// A cross-phase status board — the short done / in-progress / blocked-on-external list.
export const STATUS_BOARD: { key: "done" | "in_progress" | "blocked"; items: Bi[] }[] = [
  { key: "done", items: [
    { he: "עיצוב מחדש של הבית + כל המסכים", en: "Home + all-screens redesign" },
    { he: "ליבת מסחר: סריקה, מנוע, בוט, בדיקות", en: "Trading core: scan, engine, bot, backtests" },
    { he: "שכבת בטיחות פיננסית + בידוד משתמשים", en: "Financial-safety layer + per-user isolation" },
    { he: "מפתחות בורסה מוצפנים בצד השרת", en: "Server-side encrypted exchange keys" },
    { he: "קונסולת משפט חיה + תפקידי צוות", en: "Live Legal Console + team roles" },
    { he: "אנליטיקה + מדידת KPI", en: "Analytics + KPI measurement" },
    { he: "SMS חי דרך Twilio", en: "SMS live via Twilio" },
  ] },
  { key: "in_progress", items: [
    { he: "אונבורדינג וסיורים מודרכים", en: "Onboarding + guided tours" },
    { he: "פורטל בעלים + ניהול פרויקט", en: "Owners Portal + project management" },
    { he: "דוחות מתוזמנים לבעלים", en: "Scheduled owner reports" },
  ] },
  { key: "blocked", items: [
    { he: "תשלומים — מפתחות Stripe", en: "Payments — Stripe keys" },
    { he: "אימייל — מפתח SendGrid", en: "Email — SendGrid key" },
    { he: "WhatsApp פרודקשן — אישור Meta", en: "WhatsApp prod — Meta approval" },
    { he: "רישום חברה", en: "Company registration" },
    { he: "IP/מקוריות המנוע", en: "Engine IP / provenance" },
    { he: "Apple IAP", en: "Apple IAP" },
  ] },
];

// Overall completion — a simple weighted headline across the phases (all equal weight).
// Used as the STATIC fallback headline before the live PM task rollup loads.
export function overallPct(): number {
  return Math.round(PHASES.reduce((s, p) => s + p.pct, 0) / PHASES.length);
}

// ── Phase 2 · project-management lookups ─────────────────────────────────────
export function partnerById(id?: string | null): Partner | undefined {
  return TEAM.find((p) => p.id === id);
}
export function phaseById(id?: string | null): Phase | undefined {
  return PHASES.find((p) => p.id === id);
}

// Task status labels + a semantic tone key (mapped to C.* in the screen).
export type TaskTone = "muted" | "info" | "warn" | "ok";
export const TASK_STATUS: Record<string, { he: string; en: string; tone: TaskTone }> = {
  todo: { he: "לביצוע", en: "To do", tone: "muted" },
  in_progress: { he: "בתהליך", en: "In progress", tone: "info" },
  blocked: { he: "חסום", en: "Blocked", tone: "warn" },
  done: { he: "הושלם", en: "Done", tone: "ok" },
};

// Honest implementation-status slugs (mirrors the backend impl_status values).
export const IMPL_STATUS: Record<string, { he: string; en: string }> = {
  not_started: { he: "טרם החל", en: "Not started" },
  scaffolded: { he: "תשתית מוכנה", en: "Scaffolded" },
  blocked_external: { he: "ממתין לגורם חיצוני", en: "Blocked — external" },
  in_review: { he: "בבדיקה", en: "In review" },
  in_progress: { he: "בתהליך", en: "In progress" },
  live: { he: "חי", en: "Live" },
};

// The final milestone the whole roadmap rolls up to (Dan's framing).
export const LAUNCH_MILESTONE: Bi = {
  he: "השלמה = שחרור גרסה 1 למשתמשים למכירה",
  en: "Completion = releasing v1 to users for sale",
};

// ── PHASE 3 · VOTING catalog ─────────────────────────────────────────────────
// The curated, extensible list the owner votes on. Two static groups live here as
// bilingual data — the app's SCREENS and the KEY DECISIONS — each keyed by a stable
// `key` (screen:… / decision:…). The THIRD group (the live PM tasks, task:{id}) is
// enumerated by the backend from pm_tasks, so it stays in lock-step with the board.
// The backend stores votes keyed by these ids and tallies generically, so adding an
// item here (or a task on the board) is all it takes to make it votable. Icons are
// lucide keys resolved in the screen (kept JSX-free like the rest of this module).
export type VoteItemType = "screen" | "decision" | "task";
// A DECISION carries competing OPTIONS — the voter picks ONE (a real dilemma), instead of
// approve/change/reject. `question` frames the pick; each option is id + label + one-liner.
export type VoteOption = { id: string; label: Bi; desc: Bi };
export type VoteItem = { key: string; type: VoteItemType; icon: string; title: Bi; desc: Bi; question?: Bi; options?: VoteOption[] };

// 1) SCREENS — the app's surfaces (mirrors the redesign's 15 screens).
export const VOTE_SCREENS: VoteItem[] = [
  { key: "screen:home", type: "screen", icon: "LayoutDashboard",
    title: { he: "בית", en: "Home" },
    desc: { he: "מרכז \"לסחור במקום אחד\" — רווח/הפסד אמיתי, מתג לייב/דמו מאוחד, גיבור זכוכית.", en: "The \"trade in one place\" centrepiece — real P&L, unified live/demo toggle, glass hero." } },
  { key: "screen:engine", type: "screen", icon: "TrendingUp",
    title: { he: "מנוע מסחר", en: "Trading Engine" },
    desc: { he: "הרצת אוטומציה חיה/דמו על 10 הפריצות המובילות מהסריקה היומית.", en: "Runs live/demo automation over the daily scan's top-10 breakouts." } },
  { key: "screen:signal_bot", type: "screen", icon: "Radio",
    title: { he: "סיגנל בוט", en: "Signal Bot" },
    desc: { he: "בוטים מבוססי Webhooks של TradingView, אשף יצירה + webhook.", en: "TradingView-webhook bots, a create→webhook wizard." } },
  { key: "screen:scanner", type: "screen", icon: "Radar",
    title: { he: "סורק / סריקה יומית", en: "Scanner / Daily scan" },
    desc: { he: "סריקה יומית אוטומטית של כל הנכסים → פריצות מובילות למנוע.", en: "Daily automatic scan across all assets → top breakouts to the engine." } },
  { key: "screen:exchange", type: "screen", icon: "Wallet",
    title: { he: "בורסה", en: "Exchange" },
    desc: { he: "חיבור מפתחות בורסה, מוצפנים בצד השרת ועוקבים אחרי המשתמש.", en: "Exchange-key connect, encrypted server-side and following the user." } },
  { key: "screen:backtest", type: "screen", icon: "FlaskConical",
    title: { he: "בדיקות (Backtest)", en: "Backtest" },
    desc: { he: "בדיקות היסטוריות — סימבול יחיד, ריצות ארעיות עם שמירה אופציונלית.", en: "Historical backtests — single-symbol, ephemeral runs with opt-in save." } },
  { key: "screen:strategy_lab", type: "screen", icon: "Beaker",
    title: { he: "מעבדת אסטרטגיות", en: "Strategy Lab" },
    desc: { he: "בניית/כוונון אסטרטגיות (כולל ייבוא PineScript).", en: "Build/tune strategies (incl. PineScript import)." } },
  { key: "screen:dashboard", type: "screen", icon: "Gauge",
    title: { he: "דשבורד", en: "Dashboard" },
    desc: { he: "מבט-על על התיק, הפעילות והביצועים.", en: "The at-a-glance view of portfolio, activity and performance." } },
  { key: "screen:chat", type: "screen", icon: "MessagesSquare",
    title: { he: "צ'אט", en: "Chat" },
    desc: { he: "צ'אט חברתי + תמיכה בתוך האפליקציה עם מענה מנהל.", en: "Social + in-app support chat with admin reply." } },
  { key: "screen:account", type: "screen", icon: "UserCircle",
    title: { he: "חשבון", en: "Account" },
    desc: { he: "פרופיל, העדפות, ערוצי התראה והסכמות.", en: "Profile, preferences, notification channels + consent." } },
  { key: "screen:university", type: "screen", icon: "GraduationCap",
    title: { he: "לימוד / אוניברסיטה", en: "Learn / University" },
    desc: { he: "מדריך למתחילים, אונבורדינג וקורסים.", en: "Beginner guide, onboarding + courses." } },
  { key: "screen:reels", type: "screen", icon: "Clapperboard",
    title: { he: "רילים", en: "Reels" },
    desc: { he: "תוכן וידאו קצר + עורך תוכן לצוות הקריאייטיב.", en: "Short-form video content + a content editor for the creative team." } },
  { key: "screen:plans", type: "screen", icon: "CreditCard",
    title: { he: "תוכניות", en: "Plans" },
    desc: { he: "מסלולים והרשאות (Stripe בתשתית, ממתין למפתחות).", en: "Plans + entitlements (Stripe scaffolded, pending keys)." } },
  { key: "screen:legal_console", type: "screen", icon: "Scale",
    title: { he: "קונסולת משפט", en: "Legal Console" },
    desc: { he: "עריכה חיה של כל הטקסטים המשפטיים ללא deploy (רז).", en: "Live editing of all legal copy, no deploy (Raz)." } },
  { key: "screen:owners_portal", type: "screen", icon: "Diamond",
    title: { he: "פורטל בעלים", en: "Owners Portal" },
    desc: { he: "המסך שלפניך — showcase, צוות, לוח משימות, הצבעה ותוצאות.", en: "This very screen — showcase, team, board, voting + results." } },
];

// 2) DECISIONS — each is a real dilemma: the voter picks ONE competing option (not a
// thumbs up/down). `question` frames the pick; `options` are the genuine product/business
// alternatives currently on the table.
export const VOTE_DECISIONS: VoteItem[] = [
  { key: "decision:pnl_method", type: "decision", icon: "BarChart3",
    title: { he: "כותרת הרווח/הפסד בבית", en: "Home P&L headline" },
    desc: { he: "מה המספר הראשי שהמשתמש רואה בבית.", en: "The headline number the user sees on Home." },
    question: { he: "איך להציג את הרווח/הפסד בבית?", en: "How should the Home P&L headline be framed?" },
    options: [
      { id: "growth", label: { he: "צמיחה מול ההון שהופקד", en: "Growth vs deposited capital" }, desc: { he: "למשל 250$→281$ = 12.5%+ (הגישה הנוכחית).", en: "e.g. $250→$281 = +12.5% (current approach)." } },
      { id: "open_sum", label: { he: "סכום הפוזיציות הפתוחות", en: "Sum of open positions" }, desc: { he: "רווח/הפסד לא-ממומש של מה שפתוח כרגע.", en: "Unrealized P&L of what's open right now." } },
      { id: "both", label: { he: "להציג את שניהם", en: "Show both" }, desc: { he: "כותרת צמיחה + שורת פוזיציות פתוחות.", en: "Growth headline + an open-positions line." } },
    ] },
  { key: "decision:skins", type: "decision", icon: "Palette",
    title: { he: "סקין ברירת המחדל", en: "Default skin" },
    desc: { he: "איזה סקין ממותג ייטען כברירת מחדל למשתמש חדש.", en: "Which brand skin loads by default for a new user." },
    question: { he: "איזה סקין יהיה ברירת המחדל?", en: "Which skin should be the default?" },
    options: [
      { id: "navy", label: { he: "Navy (כהה, עמוק)", en: "Navy (deep, dark)" }, desc: { he: "ברירת המחדל הנוכחית.", en: "The current default." } },
      { id: "peach", label: { he: "אפרסק", en: "Peach" }, desc: { he: "מגנטה→אפרסק ממניפת Pantone.", en: "Magenta→Peach from the Pantone fan." } },
      { id: "sea", label: { he: "ים (טורקיז)", en: "Sea (teal)" }, desc: { he: "אורורה→ים.", en: "Aurora→Sea." } },
      { id: "yellow", label: { he: "ניוד", en: "Nude" }, desc: { he: "צהוב→ניוד (קורל רך).", en: "Yellow→Nude (soft coral)." } },
    ] },
  { key: "decision:live_demo_toggle", type: "decision", icon: "ToggleRight",
    title: { he: "מתג לייב/דמו", en: "Live/Demo toggle" },
    desc: { he: "איך המשתמש מחליף בין חי לדמו.", en: "How the user switches between live + demo." },
    question: { he: "איך לעצב את מתג לייב/דמו?", en: "How should the live/demo toggle work?" },
    options: [
      { id: "shared", label: { he: "מתג עליון אחד מאוחד", en: "One shared top toggle" }, desc: { he: "מתג אחד מחליף גם רווח/הפסד וגם פוזיציות (הגישה הנוכחית).", en: "One switch drives both P&L + positions (current)." } },
      { id: "per_panel", label: { he: "מתג לכל פאנל", en: "Per-panel toggle" }, desc: { he: "כל אזור מחליף לחוד.", en: "Each area switches independently." } },
    ] },
  { key: "decision:encrypted_keys", type: "decision", icon: "KeyRound",
    title: { he: "מפתחות בורסה", en: "Exchange keys" },
    desc: { he: "היכן נשמרים מפתחות הבורסה של המשתמש.", en: "Where the user's exchange keys are stored." },
    question: { he: "איך לשמור את מפתחות הבורסה?", en: "How should exchange keys be stored?" },
    options: [
      { id: "server", label: { he: "גיבוי מוצפן בשרת", en: "Server-encrypted backup" }, desc: { he: "עוקב אחרי המשתמש, שורד ניקוי מטמון (הנוכחי).", en: "Follows the user, survives cache-clear (current)." } },
      { id: "browser", label: { he: "בדפדפן בלבד", en: "Browser-only" }, desc: { he: "לא נשמר בשרת כלל.", en: "Never stored on the server." } },
    ] },
  { key: "decision:maintenance_gate", type: "decision", icon: "Wrench",
    title: { he: "שער התחזוקה", en: "Maintenance gate" },
    desc: { he: "מי רואה את שער \"בפיתוח\".", en: "Who sees the \"under development\" splash." },
    question: { he: "מה לעשות עם שער התחזוקה?", en: "What should we do with the maintenance gate?" },
    options: [
      { id: "keep", label: { he: "להשאיר חסום", en: "Keep gated" }, desc: { he: "רק צוות נכנס עד ההשקה.", en: "Team-only until launch." } },
      { id: "open", label: { he: "לפתוח לכולם", en: "Open to all" }, desc: { he: "להסיר את השער עכשיו.", en: "Lift the gate now." } },
      { id: "logged_out", label: { he: "לחסום רק מנותקים", en: "Gate logged-out only" }, desc: { he: "משתמשים מחוברים נכנסים, אורחים רואים שער.", en: "Signed-in users in, guests see the splash." } },
    ] },
  { key: "decision:payments", type: "decision", icon: "CreditCard",
    title: { he: "תשלומים", en: "Payments" },
    desc: { he: "דרך הגבייה מהמשתמשים.", en: "How we collect from users." },
    question: { he: "באיזה מסלול תשלומים לבחור?", en: "Which payments rail should we use?" },
    options: [
      { id: "stripe", label: { he: "Stripe", en: "Stripe" }, desc: { he: "בתשתית, צריך מפתחות.", en: "Scaffolded, needs keys." } },
      { id: "iap", label: { he: "Apple IAP", en: "Apple IAP" }, desc: { he: "רכישות מתוך האפליקציה.", en: "In-app purchases." } },
      { id: "both", label: { he: "שניהם", en: "Both" }, desc: { he: "Stripe בווב + IAP באפליקציה.", en: "Stripe on web + IAP in-app." } },
    ] },
  { key: "decision:whatsapp_meta", type: "decision", icon: "MessageCircle",
    title: { he: "WhatsApp למשתמשים", en: "WhatsApp to users" },
    desc: { he: "איך להגיע למשתמשים בהודעות.", en: "How to reach users with messages." },
    question: { he: "איך לשלוח הודעות למשתמשים?", en: "How should we message users?" },
    options: [
      { id: "meta", label: { he: "אימות עסקי ב-Meta", en: "Meta Business verification" }, desc: { he: "WhatsApp פרודקשן + תבנית מאושרת.", en: "WhatsApp prod + an approved template." } },
      { id: "sms", label: { he: "SMS לכולם במקום", en: "SMS-to-all instead" }, desc: { he: "להישאר על Twilio SMS (כבר חי).", en: "Stay on Twilio SMS (already live)." } },
    ] },
  { key: "decision:company_reg", type: "decision", icon: "Building2",
    title: { he: "רישום חברה", en: "Company registration" },
    desc: { he: "מתי ואיך לרשום ישות.", en: "When + how to register the entity." },
    question: { he: "מתי לרשום את החברה?", en: "When should we register the company?" },
    options: [
      { id: "now", label: { he: "עכשיו (טרם השקה)", en: "Register now (pre-launch)" }, desc: { he: "ישות מסודרת לפני תשלומים.", en: "Clean entity before payments." } },
      { id: "revenue", label: { he: "אחרי ההכנסה הראשונה", en: "After first revenue" }, desc: { he: "לרשום כשמתחילה גבייה.", en: "Register once money comes in." } },
      { id: "defer", label: { he: "לדחות / עוסק לבינתיים", en: "Defer / sole-trader for now" }, desc: { he: "להתחיל רזה, לרשום בהמשך.", en: "Start lean, register later." } },
    ] },
  { key: "decision:engine_ip", type: "decision", icon: "Cpu",
    title: { he: "IP / מקוריות המנוע", en: "Engine IP / provenance" },
    desc: { he: "בעלות/מקוריות המנוע ופורט ה-PineScript.", en: "Ownership/provenance of the engine + PineScript port." },
    question: { he: "איך לטפל ב-IP של המנוע?", en: "How should we handle the engine IP?" },
    options: [
      { id: "cleanroom", label: { he: "כתיבה מחדש נקייה", en: "Clean-room rewrite" }, desc: { he: "מנוע מקורי משלנו.", en: "Our own original engine." } },
      { id: "license", label: { he: "לרשות את המקור", en: "License the source" }, desc: { he: "הסכם רישוי מסודר.", en: "A proper licence agreement." } },
      { id: "asis", label: { he: "להשאיר מוטמע כמות שהוא", en: "Keep vendored as-is" }, desc: { he: "עם סקירה משפטית של רז.", en: "With Raz's legal review." } },
    ] },
];

// The three vote choices (approve · needs-change · reject) — emoji + semantic tone (→ C.*).
export type VoteChoice = "approve" | "change" | "reject";
export const VOTE_CHOICES: { key: VoteChoice; he: string; en: string; emoji: string; tone: TaskTone }[] = [
  { key: "approve", he: "מאשר", en: "Approve", emoji: "👍", tone: "ok" },
  { key: "change", he: "צריך שינוי", en: "Needs change", emoji: "✎", tone: "warn" },
  { key: "reject", he: "דוחה", en: "Reject", emoji: "👎", tone: "muted" },
];
export const voteChoice = (k?: string | null) => VOTE_CHOICES.find((c) => c.key === k);

// Abstain — a neutral "no preference" option, available on any item (screens + decisions).
export const ABSTAIN: { he: string; en: string; emoji: string } = { he: "נמנע", en: "Abstain", emoji: "⊘" };

// Resolve a decision's chosen option label by ids (for tallies/results rendering).
export function voteOption(item?: VoteItem, optId?: string | null): VoteOption | undefined {
  return item?.options?.find((o) => o.id === optId);
}

// The two static vote groups, for the grouped Vote tab (Tasks come from the API).
export const VOTE_GROUPS: { id: VoteItemType; he: string; en: string; icon: string; items: VoteItem[] }[] = [
  { id: "screen", he: "מסכים", en: "Screens", icon: "LayoutDashboard", items: VOTE_SCREENS },
  { id: "decision", he: "החלטות", en: "Decisions", icon: "Milestone", items: VOTE_DECISIONS },
];

// Resolve any static item key → its catalog entry (screens + decisions); tasks resolve via the API.
const _VOTE_BY_KEY: Record<string, VoteItem> = Object.fromEntries(
  [...VOTE_SCREENS, ...VOTE_DECISIONS].map((i) => [i.key, i]),
);
export function voteItemByKey(key?: string | null): VoteItem | undefined {
  return key ? _VOTE_BY_KEY[key] : undefined;
}

// ── PORTAL GUIDE — "How this works" mini-deck ────────────────────────────────
// A detailed, honest explanation of the owners interface itself: one card per portal
// area (Daily / Overview / Team / Board / Vote / Results / Progress) stating what it's
// FOR, what you can DO there, and who it's for. Bilingual data (rendered skin+glass in
// the screen). `tab` links a card to the tab it describes so the deck can jump there.
export type GuideCard = { id: string; tab: string; icon: string; title: Bi; forWhat: Bi; canDo: Bi[]; audience: Bi };
export const PORTAL_GUIDE: GuideCard[] = [
  { id: "daily", tab: "daily", icon: "Sunrise",
    title: { he: "עדכון יומי", en: "Daily update" },
    forWhat: { he: "הסריקה של הבוקר — מבט מהיר על מה שדורש החלטה או ביצוע היום.", en: "The morning scan — a quick read on what needs a decision or action today." },
    canDo: [
      { he: "לראות את אחוז ההתקדמות עד להשקה ואת מצב המשימות.", en: "See the % to launch + the task status counts." },
      { he: "לעבור על 'דורש תשומת לב' ולקפוץ ישר ללוח או להצבעה.", en: "Scan 'needs attention' and jump straight to Board or Vote." },
      { he: "לקרוא את דופק ההצבעה ולהעתיק את סיכום הבוקר.", en: "Read the voting pulse + copy the morning summary." },
    ],
    audience: { he: "בעלים ומנהלים — נקודת הפתיחה של הבוקר.", en: "Owners & admins — the morning starting point." } },
  { id: "overview", tab: "overview", icon: "Sparkles",
    title: { he: "מה בנינו", en: "Overview" },
    forWhat: { he: "התצוגה המקצועית של מה שנבנה — להתמצאות ולהצגה לשותף/משקיע.", en: "The professional showcase of what's been built — for orientation + presenting." },
    canDo: [
      { he: "לקרוא את סיפור המוצר לפי תחומים (מוצר, חוויה, ליבה, אמון, צמיחה).", en: "Read the product story by area (product, UX, core, trust, growth)." },
      { he: "להראות במהירות מה כבר קיים ומה פתוח להשקה.", en: "Quickly show what exists + what's open to launch." },
    ],
    audience: { he: "כולם — כרטיס הביקור של המערכת.", en: "Everyone — the system's calling card." } },
  { id: "team", tab: "team", icon: "Users",
    title: { he: "צוות", en: "Team" },
    forWhat: { he: "מי השותפים, התפקידים, והיעד האישי של כל אחד.", en: "Who the partners are, their roles, and each one's headline goal." },
    canDo: [
      { he: "לראות כל שותף ואת היעד שלו.", en: "See each partner + their goal." },
      { he: "להיכנס למסך האישי של שותף.", en: "Open a partner's personal screen." },
      { he: "לנהל הרשאות צוות (מנהל ראשי).", en: "Manage team access (main admin)." },
    ],
    audience: { he: "בעלים ומנהלים.", en: "Owners & admins." } },
  { id: "board", tab: "board", icon: "ClipboardList",
    title: { he: "לוח משימות", en: "Board" },
    forWhat: { he: "לוח המשימות החי — כל העבודה עד להשקה, מקובצת לפי שותף.", en: "The live task board — all the work toward launch, grouped by partner." },
    canDo: [
      { he: "ליצור משימה ולשייך אותה לכמה שותפים.", en: "Create a task + assign it to several partners." },
      { he: "לעדכן סטטוס, אחוז התקדמות והערות.", en: "Update status, progress % and notes." },
      { he: "לראות התקדמות מקובצת לכל שותף.", en: "See progress grouped per partner." },
    ],
    audience: { he: "בעלים ומנהלים מנהלים; שותף מעדכן את המשימות שלו.", en: "Owners/admins manage; a partner updates their own tasks." } },
  { id: "vote", tab: "vote", icon: "Vote",
    title: { he: "הצבעה", en: "Vote" },
    forWhat: { he: "להכריע — מסכים ומשימות בשיפוט, והחלטות כבחירה אמיתית בין אפשרויות מתחרות.", en: "To decide — screens + tasks by judgement, and decisions as a real pick between competing options." },
    canDo: [
      { he: "לשפוט מסך: מאשר · צריך שינוי · דוחה.", en: "Judge a screen: approve · needs-change · reject." },
      { he: "לבחור אפשרות אחת בכל החלטה (למשל סקין ברירת מחדל).", en: "Pick one option per decision (e.g. the default skin)." },
      { he: "להוסיף הערה, להימנע, או לשנות את ההצבעה בכל עת.", en: "Comment, abstain, or change your vote anytime." },
    ],
    audience: { he: "בעלים ומנהלים מצביעים.", en: "Owners & admins cast." } },
  { id: "results", tab: "results", icon: "Trophy",
    title: { he: "תוצאות", en: "Results" },
    forWhat: { he: "התוצאה המצטברת — אחוז אישור, האפשרות המנצחת בכל החלטה, ומה שדורש עבודה.", en: "The aggregate outcome — approval %, the winning option per decision, and what needs work." },
    canDo: [
      { he: "לראות את האפשרות המנצחת בכל החלטה.", en: "See each decision's winning option." },
      { he: "לזהות מסכים שסומנו 'דורש עבודה'.", en: "Spot screens flagged 'needs work'." },
      { he: "להפוך פריט למשימה בלוח בלחיצה.", en: "Promote an item into a board task in one click." },
    ],
    audience: { he: "בעלים רואים הכל; שותפים — לקריאה בלבד.", en: "Owners see all; partners read-only." } },
  { id: "progress", tab: "progress", icon: "Milestone",
    title: { he: "התקדמות", en: "Progress" },
    forWhat: { he: "התמונה הגדולה — אחוז עד להשקה, לפי שלבים במפת הדרכים ולפי סטטוס.", en: "The big picture — % to launch, by roadmap phase and by status." },
    canDo: [
      { he: "לראות אחוז כולל עד לשחרור למכירה.", en: "See the overall % to releasing for sale." },
      { he: "התקדמות לכל שלב במפת הדרכים.", en: "Progress for each roadmap phase." },
      { he: "פירוט המשימות לפי סטטוס.", en: "A breakdown of tasks by status." },
    ],
    audience: { he: "בעלים ומנהלים.", en: "Owners & admins." } },
];
