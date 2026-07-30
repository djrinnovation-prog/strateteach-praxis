import React, { useState } from "react";
import { Diamond, AlertTriangle, Phone, ArrowLeft, Loader2 } from "lucide-react";
import { api } from "../app/api";
import { C, UI, MONO, SHADOW, onAccent } from "../theme";

// Branded "ראה הוזהרת" landing reached via the one-time ?welcome=<token> link.
// By the time this renders the visitor is already authenticated into the target
// account (the token was redeemed in App). It shows the notice verbatim, then
// captures a phone number (the account has none) before entering the app. No SMS.
const NOTICE =
  "אורי רק שתדע שאחיך הגדול רפי אישר לתת לך להמשיך למרות שלא הקדשת מזמנך ... אנחנו מצפים ממך להשתפר ונשלח לך כל יום קצב התקדמות - זה ישפיע על כמה אחוז הנחה תקבל במשתמש האמיתי שלך .. שים לב";

export default function WelcomeWarning({ onContinue }: { onContinue: () => void }) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const p = phone.trim();
      if (p) await api.setMyPhone(p);   // store the phone on the account (no SMS sent)
      onContinue();
    } catch (e2: any) {
      setErr(e2?.message || "שמירת הטלפון נכשלה");
      setBusy(false);
    }
  }

  const input: React.CSSProperties = { background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 14, padding: "13px 15px", color: C.text, fontSize: 16, fontFamily: UI, outline: "none", width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: UI, direction: "rtl",
      background: `radial-gradient(120% 120% at 50% 0%, ${C.surface} 0%, ${C.bg} 55%)` }}>
      <div style={{ width: "100%", maxWidth: 460, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, border: `1px solid ${C.line}`, borderRadius: 24, padding: 28, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -18px 36px -24px rgba(0,0,0,0.30), ${SHADOW}` }}>
        {/* brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
            background: C.accentGrad }}>
            <Diamond size={18} color={onAccent(C.gold)} fill={onAccent(C.gold)} />
          </span>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>Strateteach</div>
        </div>

        {/* warning header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 14, marginBottom: 16,
          background: "rgba(240,97,109,0.12)", border: `1px solid rgba(240,97,109,0.4)` }}>
          <AlertTriangle size={22} color={C.loss} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: 19, fontWeight: 900, color: C.loss }}>ראה הוזהרת</div>
        </div>

        {/* the notice — verbatim */}
        <p style={{ fontSize: 15.5, lineHeight: 1.85, color: C.text, margin: "0 0 22px", whiteSpace: "pre-wrap" }}>{NOTICE}</p>

        {/* phone capture (the account has none) */}
        <form onSubmit={submit}>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 700, color: C.muted, margin: "0 0 8px" }}>
            <Phone size={15} color={C.gold} /> מספר טלפון לעדכוני קצב ההתקדמות
          </label>
          {err && <div style={{ marginBottom: 10, background: "rgba(240,97,109,0.12)", border: "1px solid rgba(240,97,109,0.4)", color: "#d9536a", borderRadius: 9, padding: "9px 11px", fontSize: 13, fontFamily: MONO }}>{err}</div>}
          <input style={input} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoFocus placeholder="+972501234567" />
          <button type="submit" disabled={busy} className="gbtn ptile"
            style={{ marginTop: 18, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: 800, fontSize: 16, fontFamily: UI, padding: "14px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
            {busy ? <Loader2 size={16} className="spin" /> : <ArrowLeft size={16} />} הבנתי, המשך לאפליקציה
          </button>
        </form>
      </div>
    </div>
  );
}
