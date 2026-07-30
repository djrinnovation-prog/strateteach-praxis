import React, { useState, useEffect } from "react";
import { Diamond, LogIn, KeyRound, Send } from "lucide-react";
import { api, saveToken } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI, MONO, SHADOW } from "../theme";
import { PasswordInput, Segmented, premSoft, RiskDisclaimer } from "../ui";
import { brandLogoSrc } from "../lib/brandLogo";
import type { User } from "../App";

export default function Login({ onLoggedIn }: { onLoggedIn: (u: User) => void }) {
  const { t, rtl, lang, setLang } = useI18n();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [twofa, setTwofa] = useState<{ method?: string; channel?: string; channelHint?: string; recoveryAvailable?: boolean } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false); // TOTP user switched to lost-device recovery code

  const [cooldown, setCooldown] = useState(0);
  const [info, setInfo] = useState("");

  // ── "Forgot password / can't log in" → admin approval → passwordless renewal ──
  const [forgot, setForgot] = useState(false);
  const [fUser, setFUser] = useState("");
  const [fContact, setFContact] = useState("");
  // Anti-bot honeypot — hidden, stays empty for humans; a filled value is dropped server-side.
  const [fWebsite, setFWebsite] = useState("");
  const [fBusy, setFBusy] = useState(false);
  const [fErr, setFErr] = useState("");
  const [showReq, setShowReq] = useState(false); // reveal the contact field after a failed renew
  const [sent, setSent] = useState(false);       // request submitted confirmation

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Channel-aware label: the code now arrives over Telegram or email (not SMS).
  const chanName = (c?: string) => c === "email" ? (rtl ? "אימייל" : "email") : c === "sms" ? (rtl ? "SMS" : "SMS") : (rtl ? "טלגרם" : "Telegram");
  const L = rtl
    ? { codeLabel: "קוד אימות", codeHint: (h?: string, c?: string) => `שלחנו קוד ל${chanName(c)}${h ? ` (${h})` : ""}`, verify: "אימות והתחברות", back: "חזרה", resend: "שליחת קוד חדש", resent: "קוד חדש נשלח", wait: (s: number) => `שליחה חוזרת בעוד ${s}ש׳`,
        totpLabel: "קוד מאפליקציית האימות", totpHint: "הזן/י את הקוד בן 6 הספרות מאפליקציית האימות (Google Authenticator / Authy).",
        lost: "איבדת גישה לאפליקציה? שליחת קוד שחזור", recoverySent: "קוד שחזור נשלח" }
    : { codeLabel: "Verification code", codeHint: (h?: string, c?: string) => `We sent a code to your ${chanName(c)}${h && c === "email" ? ` (${h})` : ""}`, verify: "Verify & sign in", back: "Back", resend: "Resend code", resent: "New code sent", wait: (s: number) => `Resend in ${s}s`,
        totpLabel: "Authenticator code", totpHint: "Enter the 6-digit code from your authenticator app (Google Authenticator / Authy).",
        lost: "Lost access to your app? Send a recovery code", recoverySent: "Recovery code sent" };
  const isTotp = twofa?.method === "totp" && !recovery; // pure-app code entry (no send)

  // Forgot/can't-log-in copy (HE/EN).
  const F = rtl
    ? { link: "שכחתי סיסמה / לא מצליח להתחבר", title: "שכחתי סיסמה", sub: "הזן/י את שם המשתמש. אם המנהל כבר אישר איפוס — תועבר/י ישר לבחירת סיסמה חדשה. אם לא, אפשר לשלוח בקשה למנהל.",
        user: "שם משתמש", cont: "המשך", noApproval: "עדיין אין אישור לחשבון הזה. מלא/י פרטים ושלח/י בקשה למנהל לאישור.",
        contact: "טלפון או אימייל (לזיהוי)", send: "שלח בקשה למנהל", sentTitle: "בקשתך נשלחה למנהל לאישור ✓", sentBody: "אפשר לסגור ולנסות שוב מאוחר יותר. לאחר אישור — חזור/י לכאן והזן/י את שם המשתמש כדי לבחור סיסמה חדשה.",
        back: "חזרה לכניסה", needUser: "הזן/י שם משתמש." }
    : { link: "Forgot password / can't log in", title: "Forgot password", sub: "Enter your username. If an admin already approved a reset, you'll go straight to choosing a new password. Otherwise you can send a request to the admin.",
        user: "Username", cont: "Continue", noApproval: "No approval for this account yet. Add your details and send a request to the admin.",
        contact: "Phone or email (to identify you)", send: "Send request to admin", sentTitle: "Your request was sent to the admin ✓", sentBody: "You can close this and try again later. Once it's approved, come back here and enter your username to pick a new password.",
        back: "Back to sign in", needUser: "Enter a username." };

  function openForgot() {
    setForgot(true); setFUser(username.trim()); setFContact("");
    setFErr(""); setShowReq(false); setSent(false); setError(""); setInfo("");
  }
  function closeForgot() {
    setForgot(false); setFErr(""); setShowReq(false); setSent(false); setFBusy(false);
  }

  // Try the passwordless renewal: works only once an admin has APPROVED the reset.
  async function tryRenew() {
    const u = fUser.trim();
    if (!u) { setFErr(F.needUser); return; }
    setFErr(""); setFBusy(true);
    try {
      const res = await api.resetApprovedLogin(u);
      saveToken(res.token);
      onLoggedIn({ username: res.username, role: res.role }); // lands on the set-new-password gate
    } catch {
      // Not approved (or unknown account) — same outcome either way; offer to request.
      setShowReq(true);
      setFErr(F.noApproval);
    } finally {
      setFBusy(false);
    }
  }

  // Send the admin a "can't log in" request (public; never reveals if the user exists).
  async function sendReq() {
    const u = fUser.trim();
    if (!u) { setFErr(F.needUser); return; }
    setFErr(""); setFBusy(true);
    try {
      await api.requestPasswordReset(u, fContact.trim() || undefined, fWebsite);
      setSent(true);
    } catch (err: any) {
      setFErr(err?.message || "Could not send the request.");
    } finally {
      setFBusy(false);
    }
  }

  async function resendCode() {
    if (cooldown > 0 || busy) return;
    setError(""); setInfo("");
    try {
      // In recovery mode, re-request a recovery code; otherwise re-issue the channel code.
      const res = recovery
        ? await api.loginRecovery(username.trim(), password)
        : await api.login(username.trim(), password);
      if ("twofa" in res && (res as any).twofa) {
        const r: any = res; setTwofa({ method: r.method, channel: r.channel, channelHint: r.channelHint, recoveryAvailable: r.recoveryAvailable });
      }
      setInfo(L.resent); setCooldown(30);
    } catch (err: any) {
      setError(err?.message || "Could not resend");
    }
  }

  // TOTP user lost their device → send a one-time recovery code over Telegram/email.
  async function sendRecovery() {
    if (busy) return;
    setError(""); setInfo("");
    try {
      const res = await api.loginRecovery(username.trim(), password);
      setRecovery(true); setCode("");
      setTwofa((tf) => ({ ...(tf || {}), channel: res.channel, channelHint: res.channelHint }));
      setInfo(L.recoverySent); setCooldown(30);
    } catch (err: any) {
      setError(err?.message || "Could not send a recovery code");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (twofa) {
        const res = await api.loginVerify(username.trim(), password, code.trim());
        saveToken(res.token);
        onLoggedIn({ username: res.username, role: res.role });
        return;
      }
      const res = await api.login(username.trim(), password);
      if ("twofa" in res && res.twofa) {
        setTwofa({ method: res.method, channel: res.channel, channelHint: res.channelHint, recoveryAvailable: res.recoveryAvailable });
        setRecovery(false);
        setCode("");
        return;
      }
      saveToken(res.token);
      onLoggedIn({ username: res.username, role: res.role });
    } catch (err: any) {
      setError(err?.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 14,
    padding: "13px 15px", color: C.text, fontSize: 15, fontFamily: UI, outline: "none", width: "100%",
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: UI, direction: rtl ? "rtl" : "ltr",
      // Skin-adaptive page: a soft gold accent glow at the top over the skin gradient.
      background: `radial-gradient(720px 420px at 50% -6%, ${C.gold}22, transparent 60%), linear-gradient(170deg, ${C.surface} 0%, ${C.bg} 52%)` }}>
      {busy && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16,
          background: `linear-gradient(170deg, ${C.surface} 0%, ${C.bg} 52%)` }}>
          <Diamond size={40} color={C.gold} fill={C.gold} />
          <div style={{ width: 34, height: 34, border: `3px solid ${C.line}`, borderTopColor: C.gold, borderRadius: "50%", animation: "algospin 0.8s linear infinite" }} />
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>{t.signingIn}</div>
          <div style={{ fontSize: 12.5, color: C.muted }}>{lang === "he" ? "מתחברים לשרת שלך — רגע…" : "Connecting to your server — one moment…"}</div>
          <style>{"@keyframes algospin{to{transform:rotate(360deg)}}"}</style>
        </div>
      )}
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 390,
        // On-design skin-adaptive card: the app's rounded gold frame + bevel over a warm
        // gold-tinted surface (matches Home's headline frame language), re-skinning via C.*.
        background: `linear-gradient(160deg, ${C.gold}1e 0%, ${C.surface} 44%, ${C.surface2} 100%)`,
        border: `2px solid ${C.gold}`, borderRadius: 24, padding: 30,
        boxShadow: `inset 2px 2px 6px ${C.accentHi}55, inset -3px -3px 9px ${C.gold}1f, ${SHADOW}` }}>
        {/* Language toggle sits top-end; the brand wordmark leads below it. */}
        <div style={{ display: "flex", justifyContent: rtl ? "flex-start" : "flex-end", marginBottom: 6 }}>
          <Segmented small value={lang} onChange={(v) => setLang(v as any)}
            options={[{ value: "he", label: "עב" }, { value: "en", label: "EN" }]} style={{ width: 88 }} />
        </div>
        {/* Branded StrateTeach PNG wordmark inside the rounded skin-adaptive frame. */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, marginBottom: 22 }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
            padding: "12px 22px 8px",
            background: `linear-gradient(145deg, ${C.gold}30, ${C.gold}0c 58%, ${C.gold}14)`,
            borderRadius: 16,
            borderTop: `2px solid ${C.gold}e0`, borderLeft: `2px solid ${C.gold}e0`,
            borderRight: `2px solid ${C.gold}55`, borderBottom: `2px solid ${C.gold}55`,
            boxShadow: `inset 2px 2px 4px ${C.accentHi}99, inset -3px -3px 7px ${C.gold}3a, 0 14px 34px -24px ${C.gold}55` }}>
            <img src={brandLogoSrc()} alt="StrateTeach" style={{ width: "min(220px, 62vw)", height: "auto", display: "block", marginBottom: -10 }} />
          </div>
          <div style={{ fontSize: 12.5, color: C.muted, textAlign: "center" }}>{t.loginHint}</div>
        </div>

        {forgot ? (
          <>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.text, marginBottom: 6 }}>{F.title}</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 14, lineHeight: 1.5 }}>{F.sub}</div>

            {sent ? (
              <div style={{ background: `${C.gain}1f`, border: `1px solid ${C.gain}66`, borderRadius: 12, padding: "14px 14px" }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.gain, marginBottom: 6 }}>{F.sentTitle}</div>
                <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>{F.sentBody}</div>
              </div>
            ) : (
              <>
                <label style={{ fontSize: 13, color: C.muted, display: "block", margin: "0 0 6px" }}>{F.user}</label>
                <input style={inputStyle} value={fUser} onChange={(e) => setFUser(e.target.value)} autoComplete="username" autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); showReq ? sendReq() : tryRenew(); } }} />

                {/* Honeypot — hidden from humans; a bot that fills it is silently rejected server-side. */}
                <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
                  <label htmlFor="website">Website</label>
                  <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off"
                    value={fWebsite} onChange={(e) => setFWebsite(e.target.value)} />
                </div>

                {showReq && (
                  <>
                    <label style={{ fontSize: 13, color: C.muted, display: "block", margin: "14px 0 6px" }}>{F.contact}</label>
                    <input style={inputStyle} value={fContact} onChange={(e) => setFContact(e.target.value)} placeholder="+972…  /  name@email.com"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendReq(); } }} />
                  </>
                )}

                {fErr && (
                  <div style={{ marginTop: 12, background: `${C.loss}1f`, border: `1px solid ${C.loss}66`, color: C.loss, borderRadius: 9, padding: "9px 11px", fontSize: 12.5, fontFamily: MONO, lineHeight: 1.5 }}>
                    {fErr}
                  </div>
                )}

                {!showReq ? (
                  <button type="button" onClick={tryRenew} disabled={fBusy} className="gbtn ptile"
                    style={{ marginTop: 18, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: 800, fontSize: 15, fontFamily: UI, padding: "13px", cursor: fBusy ? "default" : "pointer", opacity: fBusy ? 0.7 : 1 }}>
                    <KeyRound size={16} /> {F.cont}
                  </button>
                ) : (
                  <button type="button" onClick={sendReq} disabled={fBusy} className="gbtn ptile"
                    style={{ marginTop: 18, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: 800, fontSize: 15, fontFamily: UI, padding: "13px", cursor: fBusy ? "default" : "pointer", opacity: fBusy ? 0.7 : 1 }}>
                    <Send size={15} /> {F.send}
                  </button>
                )}
              </>
            )}

            <button type="button" onClick={closeForgot}
              style={{ marginTop: 14, width: "100%", background: "none", border: "none", color: C.muted, cursor: "pointer", fontFamily: UI, fontSize: 12.5, fontWeight: 600 }}>
              {rtl ? "→" : "←"} {F.back}
            </button>
          </>
        ) : !twofa ? (
          <>
            <label style={{ fontSize: 13, color: C.muted, display: "block", margin: "0 0 6px" }}>{t.username}</label>
            <input style={inputStyle} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />

            <label style={{ fontSize: 13, color: C.muted, display: "block", margin: "14px 0 6px" }}>{t.password}</label>
            <PasswordInput style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />

            <button type="button" onClick={openForgot}
              style={{ marginTop: 10, background: "none", border: "none", color: C.gold, cursor: "pointer", fontFamily: UI, fontSize: 12.5, fontWeight: 600, padding: 0 }}>
              {F.link}
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 10 }}>
              {isTotp ? L.totpHint : L.codeHint(twofa.channelHint, twofa.channel)}
            </div>
            <label style={{ fontSize: 13, color: C.muted, display: "block", margin: "0 0 6px" }}>{isTotp ? L.totpLabel : L.codeLabel}</label>
            <input style={{ ...inputStyle, letterSpacing: "0.3em", fontFamily: MONO, textAlign: "center" }} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="one-time-code" autoFocus placeholder="••••••" />
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <button type="button" onClick={() => { setTwofa(null); setCode(""); setRecovery(false); setError(""); setInfo(""); }}
                style={{ ...premSoft(), color: C.text, cursor: "pointer", fontFamily: UI, fontSize: 12.5, padding: "7px 14px", whiteSpace: "nowrap" }}>
                {rtl ? "→" : "←"} {L.back}
              </button>
              {isTotp ? (
                // Authenticator code is read from the app — no "resend". Offer recovery instead.
                twofa.recoveryAvailable ? (
                  <button type="button" onClick={sendRecovery} disabled={busy}
                    style={{ background: "none", border: "none", color: C.gold, cursor: busy ? "default" : "pointer", fontFamily: UI, fontSize: 12.5, padding: 0, fontWeight: 600 }}>
                    {L.lost}
                  </button>
                ) : <span />
              ) : (
                <button type="button" onClick={resendCode} disabled={cooldown > 0 || busy}
                  style={{ background: "none", border: "none", color: cooldown > 0 ? C.faint : C.gold, cursor: cooldown > 0 ? "default" : "pointer", fontFamily: UI, fontSize: 12.5, padding: 0, fontWeight: 600 }}>
                  {cooldown > 0 ? L.wait(cooldown) : `↻ ${L.resend}`}
                </button>
              )}
            </div>
            {info && <div style={{ marginTop: 8, fontSize: 12, color: C.gain }}>{info}</div>}
          </>
        )}

        {!forgot && error && (
          <div style={{ marginTop: 12, background: `${C.loss}1f`, border: `1px solid ${C.loss}66`, color: C.loss, borderRadius: 9, padding: "9px 11px", fontSize: 13, fontFamily: MONO }}>
            {error}
          </div>
        )}

        {!forgot && (
          <button type="submit" disabled={busy} className="gbtn ptile"
            style={{ marginTop: 22, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: 800, fontSize: 16, fontFamily: UI, padding: "14px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
            <LogIn size={16} /> {busy ? t.signingIn : (twofa ? L.verify : t.signIn)}
          </button>
        )}

        <p style={{ marginTop: 16, marginBottom: 8, fontSize: 11, color: C.faint, lineHeight: 1.5, textAlign: "center" }}>
          {rtl
            ? "כלי תוכנה — לא ייעוץ פיננסי. מסחר כרוך בסיכון לאובדן ההון."
            : "A software tool — not financial advice. Trading carries risk of losing your capital."}
        </p>
        <RiskDisclaimer icon={false} style={{ justifyContent: "center", textAlign: "center" }} />
      </form>
    </div>
  );
}
