import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Wrench, ShieldCheck, AlertTriangle, BarChart3 } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI, MONO } from "../theme";
import { EmptyState, ErrorState } from "./StateBlock";

// ── Admin measurement dashboard (Part F) — reads GET /analytics/summary and shows
//   the KPI buckets (Activation / Feature use / Trust / Errors) as count cards + a
//   small daily-total trend. Admin-only surface (mounted inside the Admin springboard).
//   Privacy-safe: it only ever displays aggregate counts of non-sensitive events.

type Bucket = { key: string; he: string; en: string; Icon: React.FC<any>; tone: string; events: string[] };
const BUCKETS: Bucket[] = [
  { key: "activation", he: "אקטיבציה", en: "Activation", Icon: Activity, tone: "gold",
    events: ["app_open", "screen_view", "first_value_action", "onboarding_completed"] },
  { key: "feature", he: "שימוש בפיצ׳רים", en: "Feature use", Icon: Wrench, tone: "blue",
    events: ["engine_start", "exchange_connect_attempt", "exchange_connect_result", "position_close", "bot_create", "backtest_run", "scan_run", "skin_change", "a11y_open"] },
  { key: "trust", he: "אמון", en: "Trust", Icon: ShieldCheck, tone: "gain",
    events: ["confirm_modal_shown", "confirm_modal_confirmed", "confirm_modal_cancelled", "transaction_status_viewed", "help_portal_opened", "support_request_submitted"] },
  { key: "errors", he: "שגיאות", en: "Errors", Icon: AlertTriangle, tone: "loss",
    events: ["money_error", "connection_test_failed", "data_load_error"] },
];

const EV_LABEL: Record<string, { he: string; en: string }> = {
  app_open: { he: "פתיחות אפליקציה", en: "App opens" },
  screen_view: { he: "צפיות מסך", en: "Screen views" },
  first_value_action: { he: "פעולת ערך ראשונה", en: "First value action" },
  onboarding_completed: { he: "סיום אונבורדינג", en: "Onboarding done" },
  engine_start: { he: "הפעלת מנוע", en: "Engine starts" },
  exchange_connect_attempt: { he: "ניסיון חיבור בורסה", en: "Exchange connect (attempt)" },
  exchange_connect_result: { he: "תוצאת חיבור בורסה", en: "Exchange connect (result)" },
  position_close: { he: "סגירת פוזיציה", en: "Position closes" },
  bot_create: { he: "יצירת בוט", en: "Bot creates" },
  backtest_run: { he: "הרצת בקטסט", en: "Backtest runs" },
  scan_run: { he: "הרצת סריקה", en: "Scan runs" },
  skin_change: { he: "שינוי סקין", en: "Skin changes" },
  a11y_open: { he: "פתיחת נגישות", en: "Accessibility opens" },
  confirm_modal_shown: { he: "הצגת אישור", en: "Confirm shown" },
  confirm_modal_confirmed: { he: "אישור", en: "Confirmed" },
  confirm_modal_cancelled: { he: "ביטול", en: "Cancelled" },
  transaction_status_viewed: { he: "צפייה בסטטוס", en: "Status viewed" },
  help_portal_opened: { he: "פתיחת פורטל עזרה", en: "Help portal opens" },
  support_request_submitted: { he: "פניית תמיכה", en: "Support requests" },
  money_error: { he: "שגיאת כסף", en: "Money errors" },
  connection_test_failed: { he: "כשל בדיקת חיבור", en: "Connection test fails" },
  data_load_error: { he: "כשל טעינת נתונים", en: "Data load errors" },
};

const toneColor = (t: string) => t === "loss" ? C.loss : t === "gain" ? C.gain : t === "blue" ? C.blue : C.gold;

export default function MeasurementDashboard() {
  const { lang } = useI18n();
  const he = lang === "he";
  const [days, setDays] = useState(14);
  const q = useQuery({ queryKey: ["analyticsSummary", days], queryFn: () => api.analyticsSummary(days), retry: 0, refetchInterval: 60000 });
  const data = q.data;
  const counts = (data?.counts || {}) as Record<string, { n: number; users: number }>;
  const trend = (data?.trend || []) as { day: string; n: number }[];
  const maxTrend = trend.reduce((m, d) => Math.max(m, d.n), 0) || 1;

  const dayBtn = (d: number) => (
    <button key={d} onClick={() => setDays(d)} className="tap44"
      style={{ background: days === d ? "var(--btn-bg)" : C.surface2, color: days === d ? "var(--btn-ink)" : C.muted,
        border: `1px solid ${days === d ? C.gold : C.line}`, borderRadius: 999, padding: "6px 13px",
        fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: UI }}>
      {d}{he ? " ימים" : "d"}
    </button>
  );

  return (
    <div style={{ fontFamily: UI, color: C.text }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 900 }}>
          <BarChart3 size={17} color={C.gold} /> {he ? "מדידה — KPI" : "Measurement — KPIs"}
        </span>
        <span style={{ display: "inline-flex", gap: 6 }}>{[7, 14, 30].map(dayBtn)}</span>
      </div>

      {q.isError ? (
        <ErrorState onRetry={() => q.refetch()} retrying={q.isFetching} />
      ) : q.isLoading ? (
        <div style={{ color: C.muted, fontSize: 13, padding: "24px 0", textAlign: "center" }}>{he ? "טוען…" : "Loading…"}</div>
      ) : (data?.total || 0) === 0 ? (
        <EmptyState title={he ? "אין עדיין נתוני מדידה" : "No measurement data yet"}
          hint={he ? "ברגע שמשתמשים יתחילו להשתמש באפליקציה, האירועים יופיעו כאן." : "As people start using the app, events will show up here."} />
      ) : (
        <>
          {/* KPI buckets — each with its total + the per-event breakdown */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginBottom: 16 }}>
            {BUCKETS.map((b) => {
              const col = toneColor(b.tone);
              const rows = b.events.map((e) => ({ e, n: counts[e]?.n || 0, users: counts[e]?.users || 0 })).filter((r) => r.n > 0);
              const total = rows.reduce((s, r) => s + r.n, 0);
              return (
                <div key={b.key} style={{ background: C.surface, border: `1px solid ${C.line}`, borderInlineStart: `4px solid ${col}`, borderRadius: 14, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 800 }}>
                      <b.Icon size={16} color={col} /> {he ? b.he : b.en}
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 18, fontWeight: 900, color: col }}>{total.toLocaleString()}</span>
                  </div>
                  {rows.length === 0 ? (
                    <div style={{ fontSize: 12, color: C.faint }}>{he ? "אין אירועים בטווח" : "No events in range"}</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {rows.map((r) => (
                        <div key={r.e} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
                          <span style={{ color: C.muted, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {EV_LABEL[r.e]?.[lang] || r.e}
                          </span>
                          <span style={{ fontFamily: MONO, fontWeight: 800, flexShrink: 0 }}>
                            {r.n.toLocaleString()}<span style={{ color: C.faint, fontWeight: 600 }}> · {r.users} {he ? "מש׳" : "u"}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Daily total trend — simple skin-safe bars */}
          <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 800 }}>{he ? "מגמה יומית (סה״כ אירועים)" : "Daily trend (total events)"}</span>
              <span style={{ fontFamily: MONO, fontSize: 12, color: C.muted }}>{(data?.total || 0).toLocaleString()} {he ? "סה״כ" : "total"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 90 }}>
              {trend.map((d) => (
                <div key={d.day} title={`${d.day}: ${d.n}`} style={{ flex: 1, minWidth: 4, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
                  <div style={{ height: `${Math.max(3, Math.round((d.n / maxTrend) * 100))}%`, background: `linear-gradient(180deg, ${C.gold}, ${C.gold}66)`, borderRadius: "4px 4px 0 0" }} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: C.faint, fontFamily: MONO }}>
              <span>{trend[0]?.day?.slice(5) || ""}</span>
              <span>{trend[trend.length - 1]?.day?.slice(5) || ""}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
