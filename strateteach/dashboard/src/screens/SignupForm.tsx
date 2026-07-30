import React, { useState } from "react";
import { Diamond, LogIn, Loader2, Sparkles } from "lucide-react";
import { api, saveToken, setRole } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI, MONO, SHADOW } from "../theme";
import { Segmented, RiskDisclaimer } from "../ui";

// Public self-signup page (no login). Reached at the universal /join link. The
// visitor picks their own username + password and gets an INSTANT 1-week demo
// account (onboarded, email/phone stored), then is logged straight in. An optional
// "Request upgrade" files an access-request the admin approves from Access requests.
export default function SignupForm() {
  const { lang, rtl, setLang } = useI18n();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // Anti-bot honeypot: hidden from humans, so it should always stay empty. A bot
  // that auto-fills every field will populate it → the server silently drops it.
  const [website, setWebsite] = useState("");
  const [wantUpgrade, setWantUpgrade] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const T = rtl
    ? { title: "הצטרפות ל-ALGO770", lead: "פותחים חשבון דמו לשבוע — בחינם, בלי בורסה, בלי סיכון. בחרו שם משתמש וסיסמה כדי שתוכלו לחזור.",
        name: "שם מלא", email: "אימייל", phone: "טלפון", username: "שם משתמש", password: "סיסמה (6+ תווים)",
        upgrade: "אני רוצה גם לבקש שדרוג ל-Pro (מנהל יאשר)", submit: "פתחו חשבון דמו והיכנסו",
        haveAcct: "כבר יש לכם חשבון?", signin: "להתחברות" }
    : { title: "Join ALGO770", lead: "Open a free 1-week demo account — no exchange, no risk. Pick a username & password so you can come back.",
        name: "Full name", email: "Email", phone: "Phone", username: "Username", password: "Password (6+ chars)",
        upgrade: "Also request a Pro upgrade (an admin approves)", submit: "Create demo account & enter",
        haveAcct: "Already have an account?", signin: "Sign in" };

  const input: React.CSSProperties = { background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 14, padding: "13px 15px", color: C.text, fontSize: 15, fontFamily: UI, outline: "none", width: "100%", boxSizing: "border-box" };
  const label: React.CSSProperties = { fontSize: 13, color: C.muted, display: "block", margin: "13px 0 6px" };

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const out = await api.selfSignup({ name: name.trim(), email: email.trim(), phone: phone.trim(), username: username.trim(), password, website });
      saveToken(out.token); setRole(out.role);
      // Best-effort upgrade request now that we're authenticated (never blocks entry).
      if (wantUpgrade) { try { await api.requestAccess(rtl ? "בקשת שדרוג ל-Pro מההרשמה" : "Pro upgrade requested at signup"); } catch (_e) { /* */ } }
      sessionStorage.setItem("algo770_landed", "1");
      window.location.assign("/");   // full reload → App boots logged in
    } catch (e2: any) { setErr(e2?.message || "Failed"); setBusy(false); }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: UI, direction: rtl ? "rtl" : "ltr",
      background: `linear-gradient(170deg, ${C.surface} 0%, ${C.bg} 52%)` }}>
      <div style={{ width: "100%", maxWidth: 430, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, border: `1px solid ${C.line}`, borderRadius: 24, padding: 30, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -18px 36px -24px rgba(0,0,0,0.30), ${SHADOW}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Diamond size={26} color={C.gold} fill={C.gold} />
            <div style={{ fontSize: 18, fontWeight: 800 }}>{T.title}</div>
          </div>
          <Segmented small value={lang} onChange={(v) => setLang(v as any)} options={[{ value: "he", label: "עב" }, { value: "en", label: "EN" }]} style={{ width: 88 }} />
        </div>

        <form onSubmit={submit}>
          <p style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.6, margin: "0 0 16px" }}>{T.lead}</p>
          {err && <div style={{ marginBottom: 12, background: "rgba(240,97,109,0.12)", border: "1px solid rgba(240,97,109,0.4)", color: "#d9536a", borderRadius: 9, padding: "9px 11px", fontSize: 13, fontFamily: MONO }}>{err}</div>}

          <label style={{ ...label, marginTop: 0 }}>{T.name}</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="name" />
          <label style={label}>{T.email}</label>
          <input style={input} value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="email" placeholder="name@example.com" />
          <label style={label}>{T.phone}</label>
          <input style={input} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="+972501234567" />
          <label style={label}>{T.username}</label>
          <input style={input} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="my_name" />
          <label style={label}>{T.password}</label>
          <input style={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />

          {/* Honeypot — invisible to humans, irresistible to form-filling bots. Kept out
              of the tab order and off autofill; any value here trips the server-side
              anti-bot check. Not type="hidden" (bots skip those) — visually removed. */}
          <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
            <label htmlFor="website">Website</label>
            <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off"
              value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 16, cursor: "pointer", fontSize: 13, color: C.text }}>
            <input type="checkbox" checked={wantUpgrade} onChange={(e) => setWantUpgrade(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.gold }} />
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Sparkles size={14} color={C.gold} /> {T.upgrade}</span>
          </label>

          <button type="submit" disabled={busy} className="gbtn ptile"
            style={{ marginTop: 20, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: 800, fontSize: 16, fontFamily: UI, padding: "14px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
            {busy ? <Loader2 size={16} className="spin" /> : <LogIn size={16} />} {T.submit}
          </button>

          <div style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: C.muted }}>
            {T.haveAcct} <a href="/" style={{ color: C.gold, fontWeight: 700, textDecoration: "none" }}>{T.signin}</a>
          </div>

          <RiskDisclaimer icon={false} style={{ marginTop: 16, justifyContent: "center", textAlign: "center" }} />
        </form>
      </div>
    </div>
  );
}
