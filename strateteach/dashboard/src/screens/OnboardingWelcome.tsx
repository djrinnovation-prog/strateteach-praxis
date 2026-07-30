import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, PartyPopper, Users, Sparkles, ArrowRight, CheckCircle2, LogIn } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C } from "../theme";

// ── OnboardingWelcome — the login-free team-joining / explanation screen a new hire opens from
// their onboarding link (`/?onboard=<token>`). Rendered by App BEFORE the auth gate, so it must
// stand alone (no session, self-contained styling). Warm welcome + who the team is + what's next.
export default function OnboardingWelcome({ token }: { token: string }) {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const q = useQuery({ queryKey: ["onboard", token], queryFn: () => api.onboardInfo(token), retry: false });

  const wrap: React.CSSProperties = {
    minHeight: "100vh", direction: rtl ? "rtl" : "ltr", display: "flex", flexDirection: "column",
    alignItems: "center", padding: "0 18px 40px",
    background: `linear-gradient(165deg, #FFFFFF 0%, ${C.bg} 55%, ${C.surface2} 100%)`,
    fontFamily: "'Rubik','Noto Sans Hebrew',system-ui,-apple-system,Arial,sans-serif",
  };
  const card: React.CSSProperties = {
    background: C.surface, border: `1px solid ${C.line}`, borderRadius: 20, padding: 24,
    width: "100%", maxWidth: 640, boxShadow: "0 18px 50px rgba(0,0,0,.10)",
  };

  if (q.isLoading) return <div style={{ ...wrap, justifyContent: "center" }}><Loader2 size={26} className="spin" color={C.gold} /></div>;

  if (q.isError || !q.data) {
    return (
      <div style={{ ...wrap, justifyContent: "center" }}>
        <div style={{ ...card, textAlign: "center", maxWidth: 460 }}>
          <div style={{ fontSize: 17, fontWeight: 900, color: C.text, marginBottom: 8 }}>{he ? "הקישור אינו תקף" : "Link not valid"}</div>
          <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.6 }}>
            {he ? "קישור ההצטרפות אינו תקף או פג תוקפו. בקש מהבעלים קישור חדש." : "This onboarding link is invalid or has expired. Ask the owners for a fresh one."}
          </div>
        </div>
      </div>
    );
  }

  const d = q.data;
  const enter = () => { window.location.href = "/"; };

  return (
    <div style={wrap}>
      {/* brand hero */}
      <div style={{ textAlign: "center", padding: "40px 0 22px" }}>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".32em", textTransform: "uppercase", color: C.gold }}>{he ? "ברוך הבא לצוות" : "Welcome to the team"}</div>
        <div style={{ fontSize: 46, fontWeight: 900, letterSpacing: ".01em", color: C.gold, lineHeight: 1.05, margin: "4px 0" }}>strateteach</div>
      </div>

      <div style={{ ...card, textAlign: "center", marginBottom: 16 }}>
        <PartyPopper size={34} color={C.gold} style={{ marginBottom: 10 }} />
        <div style={{ fontSize: 22, fontWeight: 900, color: C.text }}>
          {he ? `ברוך הבא, ${d.name}! 👋` : `Welcome, ${d.name}! 👋`}
        </div>
        {d.role && <div style={{ fontSize: 14, fontWeight: 800, color: C.gold, marginTop: 4 }}>{d.role}</div>}
        {d.workDomains.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 10 }}>
            {d.workDomains.map((w) => <span key={w} style={{ fontSize: 11, fontWeight: 700, color: C.muted, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "2px 9px" }}>{w}</span>)}
          </div>
        )}
        <p style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.7, margin: "16px auto 0", maxWidth: 480 }}>
          {he
            ? "שמחים שהצטרפת! strateteach בונה מערכת מסחר וחינוך פיננסי — מנוע מסחר, סריקות, בוטים, אוניברסיטה ורילים. הצטרפת לצוות שבונה את כל זה יחד."
            : "We're thrilled to have you! strateteach builds a trading + financial-education platform — a trading engine, scans, bots, a university and reels. You're joining the team building it all, together."}
        </p>
      </div>

      {/* the team */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 900, color: C.text, marginBottom: 14 }}>
          <Users size={17} color={C.gold} /> {he ? "הכירו את הצוות" : "Meet the team"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
          {d.team.map((m) => (
            <div key={m.name} style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "9px 11px" }}>
              <span style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center", background: C.accentGrad, color: "#0B0613", fontSize: 15, fontWeight: 900 }}>{m.name.charAt(0)}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: C.text }}>{m.name}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.gold }}>{he ? m.role_he : m.role_en}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* what's next */}
      <div style={{ ...card, marginBottom: 20 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 900, color: C.text, marginBottom: 12 }}>
          <Sparkles size={17} color={C.gold} /> {he ? "מה הלאה" : "What's next"}
        </div>
        {[
          he ? "תקבל פרטי כניסה אישיים לאפליקציה." : "You'll get personal login details for the app.",
          d.hasPortal
            ? (he ? "פתחנו לך פורטל אישי — צ'אט עם הבעלים, המשימות שלך והתקדמות." : "We've opened a private portal for you — chat with the owners, your tasks and progress.")
            : (he ? "המשימות שלך והמסך האישי יופיעו באפליקציה." : "Your tasks and personal screen live inside the app."),
          he ? "בפאנל שלך תוכל לעדכן פרטים, לראות תשלומים ולהצטרף לתוכנית הבונוס." : "In your panel you can update your details, view payments and join the bonus program.",
        ].map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9, marginBottom: 9 }}>
            <CheckCircle2 size={16} color={C.gain} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 13, color: C.text, lineHeight: 1.55 }}>{s}</span>
          </div>
        ))}
      </div>

      <button onClick={enter} style={{
        display: "inline-flex", alignItems: "center", gap: 8, background: C.accentGrad, color: "#0B0613",
        border: "none", borderRadius: 12, padding: "13px 26px", fontSize: 15, fontWeight: 900, cursor: "pointer",
        boxShadow: "0 10px 26px rgba(203,110,84,.32)", fontFamily: "inherit",
      }}>
        <LogIn size={17} /> {he ? "כניסה לאפליקציה" : "Enter the app"} {rtl ? null : <ArrowRight size={16} />}
      </button>
    </div>
  );
}
