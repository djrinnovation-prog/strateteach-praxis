import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Inbox, RefreshCw, LifeBuoy } from "lucide-react";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";
import { track } from "../lib/analytics";

// Reusable EMPTY + ERROR screen-state blocks (screen-states audit item). Additive,
// C.* all skins, Rubik, accessible. EmptyState = role="status" (calm, informative);
// ErrorState = role="alert" with an honest message + a Retry (refetch) + the support
// path to the Help Portal (/requests). Never a bare "Error".

export function EmptyState({ icon, title, hint, action, compact }: {
  icon?: React.ReactNode; title: string; hint?: string; action?: React.ReactNode; compact?: boolean;
}) {
  return (
    <div role="status" style={{ background: C.surface, border: `1px dashed ${C.line}`, borderRadius: 14,
      padding: compact ? "20px 16px" : "28px 20px", textAlign: "center", color: C.muted, fontFamily: UI }}>
      <div aria-hidden style={{ marginBottom: 8, opacity: 0.75, display: "flex", justifyContent: "center", color: C.gold }}>{icon || <Inbox size={22} />}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{title}</div>
      {hint && <div style={{ fontSize: 12.5, marginTop: 5, lineHeight: 1.5, maxWidth: 340, marginInline: "auto" }}>{hint}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

export function ErrorState({ title, hint, onRetry, retrying, compact, screen }: {
  title?: string; hint?: string; onRetry?: () => void; retrying?: boolean; compact?: boolean;
  screen?: string;  // when set, fires a `data_load_error` analytics event once on mount
}) {
  const { lang } = useI18n();
  const he = lang === "he";
  const nav = useNavigate();
  // Errors KPI — record that a data load failed on this screen (non-sensitive).
  useEffect(() => { if (screen) track("data_load_error", { screen }); }, [screen]);
  return (
    <div role="alert" style={{ background: C.surface, border: `1px solid ${C.loss}55`, borderInlineStart: `4px solid ${C.loss}`,
      borderRadius: 14, padding: compact ? "16px 14px" : "22px 18px", textAlign: "center", fontFamily: UI }}>
      <div aria-hidden style={{ display: "flex", justifyContent: "center", marginBottom: 8, color: C.loss }}><AlertTriangle size={22} /></div>
      <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{title || (he ? "לא הצלחנו לטעון את הנתונים" : "Couldn't load the data")}</div>
      <div style={{ fontSize: 12.5, color: C.muted, marginTop: 5, lineHeight: 1.5, maxWidth: 340, marginInline: "auto" }}>
        {hint || (he ? "ייתכן שזו תקלה זמנית או בעיית חיבור. נסו שוב." : "This may be a temporary hiccup or your connection. Try again.")}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 14 }}>
        {onRetry && (
          <button onClick={onRetry} disabled={retrying} className="tap44"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--btn-bg)", color: "var(--btn-ink)",
              border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 800,
              cursor: retrying ? "default" : "pointer", fontFamily: UI, opacity: retrying ? 0.6 : 1 }}>
            <RefreshCw size={14} className={retrying ? "spin" : undefined} /> {he ? "נסה שוב" : "Try again"}
          </button>
        )}
        <button onClick={() => nav("/requests")} className="tap44"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.surface2, color: C.text,
            border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 14px", fontSize: 12.5, fontWeight: 800,
            cursor: "pointer", fontFamily: UI }}>
          <LifeBuoy size={14} color={C.gold} /> {he ? "עזרה מהתמיכה" : "Get help"}
        </button>
      </div>
    </div>
  );
}
