import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, Ban, AlertTriangle, Rocket, Radar, FlaskConical, PowerOff } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI, MONO } from "../theme";
import { EmptyState, ErrorState } from "./StateBlock";
import type { SafetyBreakdown } from "../lib/client";

// ── Admin SAFETY dashboard (Item 6 / M4) ────────────────────────────────────────
// Reads GET /analytics/safety. Aggregate safety counters over time from the analytics
// events: blocked actions by reason/kind, validation errors by screen, the go-live
// funnel + kill-switch count, and scanner/backtest volumes. AGGREGATE ONLY — every
// figure is a count; no per-user identities, no balances. Admin-only surface.

// Friendly labels for the enum keys the events carry (fallback = the raw key).
const REASON_LABEL: Record<string, { he: string; en: string }> = {
  no_keys: { he: "אין מפתחות", en: "No keys" },
  cap_out_of_range: { he: "תקרה מחוץ לטווח", en: "Cap out of range" },
  confirm_incomplete: { he: "אישור לא הושלם", en: "Confirm incomplete" },
  rejected: { he: "נדחה בשרת", en: "Rejected (server)" },
  invalid_amount: { he: "סכום לא תקין", en: "Invalid amount" },
  account_limit: { he: "מגבלת חשבונות", en: "Account limit" },
  test_rejected: { he: "בדיקת חיבור נכשלה", en: "Connection test failed" },
  cap_exceeded: { he: "חריגה מתקרה", en: "Cap exceeded" },
};
const ACTION_LABEL: Record<string, { he: string; en: string }> = {
  go_live: { he: "מעבר ללייב", en: "Go live" },
  edit_capital: { he: "עריכת הון", en: "Edit capital" },
  exchange_connect: { he: "חיבור בורסה", en: "Exchange connect" },
};
const SCREEN_LABEL: Record<string, { he: string; en: string }> = {
  strategy: { he: "אסטרטגיה", en: "Strategy" },
  backtest: { he: "בקטסט", en: "Backtest" },
};

export default function SafetyDashboard() {
  const { lang } = useI18n();
  const he = lang === "he";
  const [days, setDays] = useState(14);
  const q = useQuery({ queryKey: ["analyticsSafety", days], queryFn: () => api.analyticsSafety(days), retry: 0, refetchInterval: 60000 });
  const d = q.data;

  const dayBtn = (n: number) => (
    <button key={n} onClick={() => setDays(n)} className="tap44"
      style={{ background: days === n ? "var(--btn-bg)" : C.surface2, color: days === n ? "var(--btn-ink)" : C.muted,
        border: `1px solid ${days === n ? C.gold : C.line}`, borderRadius: 999, padding: "6px 13px",
        fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: UI }}>
      {n}{he ? " ימים" : "d"}
    </button>
  );

  const total = (rows?: SafetyBreakdown[]) => (rows || []).reduce((s, r) => s + r.n, 0);
  const label = (map: Record<string, { he: string; en: string }>, k: string) => (map[k]?.[lang] || k);

  const stat = (Icon: React.FC<any>, tone: string, n: number, he_: string, en_: string) => (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderInlineStart: `4px solid ${tone}`, borderRadius: 14, padding: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 800, color: C.muted, marginBottom: 8 }}>
        <Icon size={15} color={tone} /> <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{he ? he_ : en_}</span>
      </div>
      <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 900, color: tone }}>{n.toLocaleString()}</div>
    </div>
  );

  const breakdownCard = (Icon: React.FC<any>, tone: string, titleHe: string, titleEn: string,
    rows: SafetyBreakdown[] | undefined, map: Record<string, { he: string; en: string }>) => (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderInlineStart: `4px solid ${tone}`, borderRadius: 14, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 800 }}>
          <Icon size={16} color={tone} /> {he ? titleHe : titleEn}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 18, fontWeight: 900, color: tone }}>{total(rows).toLocaleString()}</span>
      </div>
      {(!rows || rows.length === 0) ? (
        <div style={{ fontSize: 12, color: C.faint }}>{he ? "אין אירועים בטווח" : "No events in range"}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {rows.map((r) => (
            <div key={r.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
              <span style={{ color: C.muted, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(map, r.key)}</span>
              <span style={{ fontFamily: MONO, fontWeight: 800, flexShrink: 0 }}>{r.n.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const empty = d && total(d.blocked_by_reason) === 0 && total(d.validation_by_screen) === 0 &&
    d.go_live.attempts === 0 && d.volumes.scanner_runs === 0 && d.volumes.backtests === 0;

  return (
    <div style={{ fontFamily: UI, color: C.text }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 900 }}>
          <ShieldAlert size={17} color={C.loss} /> {he ? "בטיחות — מונים מצטברים" : "Safety — aggregate counters"}
        </span>
        <span style={{ display: "inline-flex", gap: 6 }}>{[7, 14, 30].map(dayBtn)}</span>
      </div>

      {q.isError ? (
        <ErrorState onRetry={() => q.refetch()} retrying={q.isFetching} />
      ) : q.isLoading ? (
        <div style={{ color: C.muted, fontSize: 13, padding: "24px 0", textAlign: "center" }}>{he ? "טוען…" : "Loading…"}</div>
      ) : !d ? null : empty ? (
        <EmptyState title={he ? "אין עדיין נתוני בטיחות" : "No safety data yet"}
          hint={he ? "כשמשתמשים ייתקלו בחסימות/אימותים או ירוצו סורק/בקטסט, המונים יופיעו כאן." : "As users hit blocks/validations or run scans/backtests, counters appear here."} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Go-live funnel + volumes */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            {stat(Rocket, C.gold, d.go_live.attempts, "ניסיונות מעבר ללייב", "Go-live attempts")}
            {stat(ShieldAlert, C.gain, d.go_live.confirmed, "אישורי לייב", "Go-live confirmed")}
            {stat(Ban, C.loss, d.go_live.blocked, "לייב שנחסם", "Go-live blocked")}
            {stat(PowerOff, C.loss, d.go_live.kill_switch, "הפעלות מתג-חירום", "Kill-switch activations")}
            {stat(Radar, C.blue, d.volumes.scanner_runs, "הרצות סורק", "Scanner runs")}
            {stat(FlaskConical, C.blue, d.volumes.backtests, "בקטסטים", "Backtests")}
          </div>
          {/* Breakdowns */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            {breakdownCard(Ban, C.loss, "חסימות לפי סיבה", "Blocked by reason", d.blocked_by_reason, REASON_LABEL)}
            {breakdownCard(Ban, C.gold, "חסימות לפי פעולה", "Blocked by action", d.blocked_by_action, ACTION_LABEL)}
            {breakdownCard(AlertTriangle, C.loss, "שגיאות אימות לפי מסך", "Validation errors by screen", d.validation_by_screen, SCREEN_LABEL)}
          </div>
          <div style={{ fontSize: 11, color: C.faint }}>
            {he ? "מצטבר בלבד · ללא זהויות · ללא סכומים." : "Aggregate only · no identities · no balances."}
          </div>
        </div>
      )}
    </div>
  );
}
