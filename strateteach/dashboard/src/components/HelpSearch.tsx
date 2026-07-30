import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HelpCircle, Search, X, CornerDownLeft } from "lucide-react";
import { useI18n } from "../i18n";
import { C } from "../theme";

// Static, bilingual feature index. Each entry = a place + the words that should find it.
type Entry = { path: string; he: string; en: string; kw: string };
const INDEX: Entry[] = [
  { path: "/", he: "בית · מסך ראשי", en: "Home · springboard", kw: "home main start בית ראשי iphone" },
  { path: "/scanner", he: "סורק · 10 המובילים של היום", en: "Scanner · today's top 10", kw: "scanner top10 top 10 breakout signals diamonds סורק עשירייה איתותים פריצה" },
  { path: "/backtests", he: "בדיקות · תאריכים + Pine", en: "Backtests · dates + Pine", kw: "backtest pine strategy dates start end בדיקה היסטורי פיין אסטרטגיה תאריך" },
  { path: "/overview", he: "לוח מחוונים", en: "Dashboard · KPIs", kw: "dashboard kpi overview לוח מחוונים" },
  { path: "/strategy", he: "מעבדת אסטרטגיות", en: "Strategy lab", kw: "strategy lab parameters מעבדה אסטרטגיה" },
  { path: "/exchange", he: "בורסה · מפתחות API", en: "Exchange · API keys", kw: "exchange api key secret binance non-custodial בורסה מפתח חיבור" },
  { path: "/profit", he: "מנוע מסחר · דמו/לייב, סכום השקעה, יעד $/%", en: "Trading engine · demo/live, invest amount, $/% target, top-N", kw: "trading engine demo live invest amount target top picks harvest session מנוע מסחר דמו לייב סכום יעד פוזיציות מימוש" },
  { path: "/analytics", he: "ביצועים · יעד אחוז הצלחה", en: "Performance · win-rate target", kw: "analytics performance win rate target gauge improve ביצועים אחוז הצלחה יעד שיפור" },
  { path: "/chat", he: "צ'אט · משתמשים מחוברים, כינוי", en: "Chat · connected users, nickname", kw: "chat message users nickname צ'אט הודעה כינוי משתמשים" },
  { path: "/telegram", he: "טלגרם · התראות", en: "Telegram · alerts", kw: "telegram bot alerts notify טלגרם בוט התראות" },
  { path: "/university", he: "אוניברסיטה · מדריך מלא", en: "University · full guide", kw: "university guide help learn explain steps אוניברסיטה מדריך עזרה הסבר שלבים" },
  { path: "/settings", he: "הגדרות · משתמשים, אימייל, כינוי, קוד הגנה, נתונים", en: "Settings · users, email, nickname, protection code, your data", kw: "settings users email nickname protection code password export delete gdpr connected הגדרות משתמשים אימייל קוד סיסמה נתונים מחיקה" },
  { path: "/activity", he: "פעילות", en: "Activity", kw: "activity log feed פעילות יומן" },
];

const L = {
  he: { open: "עזרה / חיפוש", title: "חיפוש בכל האפליקציה", ph: "חפש מסך או תכונה…", none: "לא נמצא — נסה מילה אחרת", hint: "Enter כדי לפתוח" },
  en: { open: "Help / Search", title: "Search the whole app", ph: "Search a screen or feature…", none: "Nothing found — try another word", hint: "Enter to open" },
};

export default function HelpSearch({ compact }: { compact?: boolean }) {
  const { lang, rtl } = useI18n();
  const t = L[lang];
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return INDEX;
    return INDEX.filter((e) => (e.he + " " + e.en + " " + e.kw + " " + e.path).toLowerCase().includes(s));
  }, [q]);

  const go = (p: string) => { setOpen(false); setQ(""); nav(p); };

  // Allow opening this search from anywhere via a global event — used by the
  // "Help / Search" quick option in the sidebar (which can't call setOpen directly).
  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener("algo770-help-open", openIt);
    return () => window.removeEventListener("algo770-help-open", openIt);
  }, []);

  return (
    <>
      <button onClick={() => setOpen(true)} title={t.open} style={{
        display: "flex", alignItems: "center", gap: 7, background: "none", border: `1px solid ${C.line}`,
        color: C.muted, borderRadius: 8, padding: compact ? "6px 9px" : "7px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 13,
      }}>
        <HelpCircle size={14} /> {!compact && t.open}
      </button>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 120,
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh" }}>
          <div onClick={(e) => e.stopPropagation()} dir={rtl ? "rtl" : "ltr"} style={{
            width: "min(560px, 92vw)", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.6)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: `1px solid ${C.line}` }}>
              <Search size={16} color={C.gold} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.ph}
                onKeyDown={(e) => { if (e.key === "Enter" && results[0]) go(results[0].path); if (e.key === "Escape") setOpen(false); }}
                style={{ flex: 1, background: "none", border: "none", outline: "none", color: C.text, fontFamily: "inherit", fontSize: 15 }} />
              <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={16} color={C.muted} /></button>
            </div>
            <div style={{ maxHeight: "52vh", overflowY: "auto" }}>
              {results.length === 0 ? <div style={{ padding: 24, color: C.muted, textAlign: "center", fontSize: 14 }}>{t.none}</div>
                : results.map((e) => (
                  <button key={e.path} onClick={() => go(e.path)} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", textAlign: rtl ? "right" : "left",
                    gap: 10, background: "none", border: "none", borderBottom: `1px solid ${C.line}`, color: C.text,
                    padding: "11px 16px", cursor: "pointer", fontFamily: "inherit", fontSize: 14 }}>
                    <span>{lang === "he" ? e.he : e.en}</span>
                    <CornerDownLeft size={13} color={C.faint} />
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
