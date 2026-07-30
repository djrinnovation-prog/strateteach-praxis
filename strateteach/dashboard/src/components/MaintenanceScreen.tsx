import React from "react";
import { Construction, X, LogOut } from "lucide-react";
import { C, UI } from "../theme";
import { useI18n } from "../i18n";
import EarthGlobe from "./EarthGlobe";

// Bilingual "under development" copy (HE + EN), shown on the maintenance splash.
const HE = "גרסה חדשה בפיתוח. לאחר שלב 1 של הדמו נעדכן אתכם, ונודיע לכם ברגע שנסיים.";
const EN = "A new version is in development. After stage 1 of the demo we'll update you, and we'll let you know the moment we're done.";

/** Full-screen "under development" gate shown to NON-admin users while the global
 * maintenance flag is ON. Reuses the app's boot-splash globe, centered on a clean
 * skin-aware background, with a card carrying the message in Hebrew + English.
 * No app access by design — there is no nav and nothing to click into, EXCEPT a
 * "Log out" escape hatch so a logged-in non-admin (e.g. an admin previewing as a
 * regular user) is never trapped and can return to the login screen. */
export default function MaintenanceScreen({ onLogout }: { onLogout?: () => void }) {
  const { lang } = useI18n();
  const rtl = lang === "he";
  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      style={{
        position: "fixed", inset: 0, zIndex: 70, overflow: "auto",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 26, padding: 24, boxSizing: "border-box", fontFamily: UI, background: C.bg, color: C.text,
      }}
    >
      {/* The slowly-turning globe — same visual as the boot splash, with a soft halo. */}
      <div style={{ position: "relative", width: "min(48vw, 220px)", height: "min(48vw, 220px)" }}>
        <div style={{
          position: "absolute", inset: "-16%", borderRadius: "50%",
          background: `radial-gradient(circle at 50% 46%, ${C.gold}22, transparent 70%)`,
        }} />
        <EarthGlobe spin={64} />
      </div>

      <div
        style={{
          width: "min(92vw, 480px)", boxSizing: "border-box",
          background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18,
          padding: "26px 24px", textAlign: "center",
          boxShadow: "0 18px 50px rgba(0,0,0,.28)",
        }}
      >
        {/* 🚧 "in development" badge */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: `${C.gold}1a`, color: C.gold, border: `1px solid ${C.gold}55`,
          borderRadius: 999, padding: "6px 14px", fontWeight: 800, fontSize: 12.5,
          letterSpacing: "0.02em", marginBottom: 16,
        }}>
          <Construction size={15} /> 🚧 {rtl ? "בפיתוח" : "In development"}
        </div>

        <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 14, color: C.text }}>
          {rtl ? "גרסה חדשה בדרך" : "A new version is on the way"}
        </div>

        {/* Both languages, each in its own reading direction. */}
        <p dir="rtl" style={{ margin: "0 0 12px", fontSize: 15, lineHeight: 1.65, color: C.text }}>{HE}</p>
        <div style={{ height: 1, background: C.line, margin: "14px auto", width: "70%" }} />
        <p dir="ltr" style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: C.muted }}>{EN}</p>
      </div>

      {/* Escape hatch: log out → clears the token (App.logout) and returns to the
          login screen, so a non-admin previewing maintenance can switch accounts. */}
      {onLogout && (
        <button
          onClick={onLogout}
          style={{
            display: "inline-flex", alignItems: "center", gap: 9, cursor: "pointer", fontFamily: UI,
            background: `${C.gold}1a`, color: C.gold, border: `1px solid ${C.gold}55`,
            borderRadius: 12, padding: "11px 22px", fontWeight: 800, fontSize: 14.5,
            flexDirection: rtl ? "row-reverse" : "row",
          }}
        >
          <LogOut size={17} style={{ transform: rtl ? "scaleX(-1)" : "none" }} />
          {rtl ? "התנתק" : "Log out"}
        </button>
      )}
    </div>
  );
}

/** Slim, dismissible banner shown to ADMINS while maintenance is ON, so they know
 * regular users are gated. The "turn off" switch is reserved for the MAIN admin
 * (canTurnOff): other admins see the heads-up + info but not the off button, so
 * they can't re-open the app to users mid-redesign (mirrors the backend, which
 * 403s a non-main admin's OFF request). */
export function MaintenanceBanner({ onTurnOff, canTurnOff = true }: { onTurnOff: () => void | Promise<void>; canTurnOff?: boolean }) {
  const { lang } = useI18n();
  const [dismissed, setDismissed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  if (dismissed) return null;
  const rtl = lang === "he";
  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      style={{
        position: "fixed", insetInlineStart: 0, insetInlineEnd: 0, top: 0, zIndex: 55,
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        padding: "8px 14px", fontFamily: UI, fontSize: 12.5, fontWeight: 700,
        background: `linear-gradient(90deg, ${C.gold}, ${C.accent})`, color: "#0B0613",
        boxShadow: "0 2px 12px rgba(0,0,0,.25)",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        <Construction size={15} /> 🚧 {rtl ? "מצב תחזוקה פעיל למשתמשים" : "Maintenance mode is ON for users"}
      </span>
      {/* OFF switch — only the main admin sees it; other admins get just the info. */}
      {canTurnOff && (
        <button
          onClick={async () => { setBusy(true); try { await onTurnOff(); } finally { setBusy(false); } }}
          disabled={busy}
          style={{
            marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 6,
            background: "rgba(11,6,19,.14)", color: "#0B0613", border: "1px solid rgba(11,6,19,.35)",
            borderRadius: 8, padding: "5px 12px", fontWeight: 800, fontSize: 12, cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1, fontFamily: UI,
          }}
        >
          {busy ? (rtl ? "מכבה…" : "Turning off…") : (rtl ? "כבה עכשיו" : "Turn off")}
        </button>
      )}
      <button
        onClick={() => setDismissed(true)}
        title={rtl ? "סגור" : "Dismiss"}
        style={{ display: "inline-flex", background: "transparent", border: "none", color: "#0B0613", cursor: "pointer", padding: 2,
          // When the OFF switch is hidden, the dismiss "X" takes the trailing slot.
          ...(canTurnOff ? {} : { marginInlineStart: "auto" }) }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
