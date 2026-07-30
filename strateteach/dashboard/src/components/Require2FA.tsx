import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Loader2, Languages, LogOut, Smartphone, KeyRound } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI, MONO } from "../theme";
import BootSplash from "./BootSplash";
import type { User } from "../App";

const STR = {
  he: {
    title: "אבטחת החשבון נדרשת", lead: "כדי להגן על החשבון והכספים שלך, האפליקציה דורשת אימות דו-שלבי (2FA) ב-SMS.",
    why1: "בכל כניסה תזין קוד חד-פעמי שנשלח לטלפון שלך.", why2: "כך, גם אם הסיסמה נחשפת, אף אחד לא ייכנס בלעדיך.", why3: "הטלפון שלך משמש גם להתראות מסחר (ניתן לכבות בהגדרות).",
    phone: "מספר טלפון", phonePh: "+972501234567", send: "שליחת קוד",
    code: "קוד מ-SMS", confirm: "אישור והפעלה", sentTo: "שלחנו קוד ל",
    needPhone: "הזינו מספר טלפון לקבלת הקוד.", resend: "שליחה חוזרת",
    logout: "כניסה עם חשבון אחר", done: "האבטחה הופעלה!", skip: "אדלג לבינתיים",
  },
  en: {
    title: "Account security required", lead: "To protect your account and funds, the app requires two-factor (2FA) verification by SMS.",
    why1: "On each sign-in you'll enter a one-time code sent to your phone.", why2: "Even if your password leaks, no one gets in without your phone.", why3: "Your phone also powers trade alerts (you can turn those off in Settings).",
    phone: "Phone number", phonePh: "+14155551234", send: "Send code",
    code: "Code from SMS", confirm: "Confirm & enable", sentTo: "We texted a code to",
    needPhone: "Enter a phone number to get the code.", resend: "Resend",
    logout: "Use a different account", done: "Security enabled!", skip: "Skip for now",
  },
};

/** Hard gate: non-admins must enable SMS 2FA before using the app.
 * Admins, or installs where Twilio Verify isn't configured, pass straight through. */
export default function Require2FA({ user, onLogout, children }: { user: User; onLogout: () => void; children: React.ReactNode }) {
  const { lang, rtl, setLang } = useI18n();
  const t = STR[lang];
  const qc = useQueryClient();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [err, setErr] = useState("");
  const [skipped, setSkipped] = useState(() => { try { return sessionStorage.getItem("algo770_2fa_skip") === "1"; } catch { return false; } });

  // staleTime matches the boot warm-up so this reuses the prefetched result instead
  // of firing a second /auth/me/2fa on mount.
  const q = useQuery({ queryKey: ["my2fa"], queryFn: () => api.get2fa(), retry: false, staleTime: 60_000, enabled: user.role !== "admin" });

  const sendM = useMutation({
    mutationFn: async () => {
      const ph = (phone || q.data?.phone || "").trim();
      if (ph) await api.setMyPhone(ph);
      await api.start2fa();
    },
    onSuccess: () => { setErr(""); setStep("code"); setCode(""); },
    onError: (e: any) => setErr(e?.message || String(e)),
  });
  const enableM = useMutation({
    mutationFn: () => api.enable2fa(code.trim()),
    onSuccess: () => { setErr(""); qc.invalidateQueries({ queryKey: ["my2fa"] }); },
    onError: (e: any) => setErr(e?.message || String(e)),
  });

  // Pass through: admins, skipped-this-session, while loading, Verify unavailable, or already enabled.
  if (user.role === "admin" || skipped) return <>{children}</>;
  if (q.isLoading) return <BootSplash />;
  if (!q.data || !q.data.available || q.data.enabled) return <>{children}</>;

  const inputStyle: React.CSSProperties = {
    background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10,
    padding: "11px 13px", color: C.text, fontSize: 15, fontFamily: UI, outline: "none", width: "100%",
  };
  const hasPhone = !!(phone || q.data.phone);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: UI, direction: rtl ? "rtl" : "ltr" }}>
      <div style={{ width: "100%", maxWidth: 420, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 28 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: `${C.gold}1f`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <ShieldCheck size={24} color={C.gold} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{t.title}</div>
          </div>
          <button type="button" onClick={() => setLang(lang === "he" ? "en" : "he")}
            style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: `1px solid ${C.line}`, color: C.muted, borderRadius: 8, padding: "5px 9px", cursor: "pointer", fontFamily: UI, fontSize: 12 }}>
            <Languages size={14} /> {lang === "he" ? "EN" : "עב"}
          </button>
        </div>

        <p style={{ fontSize: 13.5, color: C.text, lineHeight: 1.6, margin: "0 0 12px" }}>{t.lead}</p>
        <ul style={{ margin: "0 0 18px", paddingInlineStart: 20, color: C.muted, fontSize: 12.5, lineHeight: 1.8 }}>
          <li>{t.why1}</li><li>{t.why2}</li><li>{t.why3}</li>
        </ul>

        {err && <div style={{ marginBottom: 12, background: "rgba(240,97,109,0.12)", border: "1px solid rgba(240,97,109,0.4)", color: "#f3a3a3", borderRadius: 9, padding: "9px 11px", fontSize: 13, fontFamily: MONO }}>{err}</div>}

        {step === "phone" ? (
          <>
            <label style={{ fontSize: 13, color: C.muted, display: "block", margin: "0 0 6px" }}>{t.phone}</label>
            <input style={inputStyle} value={phone || q.data.phone || ""} onChange={(e) => setPhone(e.target.value)} placeholder={t.phonePh} inputMode="tel" autoFocus />
            <button onClick={() => { setErr(""); if (!hasPhone) { setErr(t.needPhone); return; } sendM.mutate(); }} disabled={sendM.isPending} className="gbtn"
              style={{ marginTop: 16, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: 700, fontSize: 15, fontFamily: UI, borderRadius: 10, padding: "12px", cursor: "pointer" }}>
              {sendM.isPending ? <Loader2 size={16} className="spin" /> : <Smartphone size={16} />} {t.send}
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 8 }}>{t.sentTo} {phone || q.data.phone}</div>
            <label style={{ fontSize: 13, color: C.muted, display: "block", margin: "0 0 6px" }}>{t.code}</label>
            <input style={{ ...inputStyle, letterSpacing: "0.3em", fontFamily: MONO, textAlign: "center" }} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="one-time-code" autoFocus placeholder="••••••" />
            <button onClick={() => { setErr(""); enableM.mutate(); }} disabled={enableM.isPending || code.length < 4} className="gbtn"
              style={{ marginTop: 16, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: 700, fontSize: 15, fontFamily: UI, borderRadius: 10, padding: "12px", cursor: "pointer" }}>
              {enableM.isPending ? <Loader2 size={16} className="spin" /> : <KeyRound size={16} />} {t.confirm}
            </button>
            <button type="button" onClick={() => { setErr(""); sendM.mutate(); }} disabled={sendM.isPending}
              style={{ marginTop: 10, background: "none", border: "none", color: C.muted, cursor: "pointer", fontFamily: UI, fontSize: 12.5 }}>↻ {t.resend}</button>
          </>
        )}

        <button type="button" onClick={() => { try { sessionStorage.setItem("algo770_2fa_skip", "1"); } catch { /* */ } setSkipped(true); }}
          style={{ marginTop: 16, width: "100%", background: "none", border: "none", color: C.gold, cursor: "pointer", fontFamily: UI, fontSize: 13.5, fontWeight: 700 }}>
          {t.skip} →
        </button>
        <button type="button" onClick={onLogout}
          style={{ marginTop: 10, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: "none", border: `1px solid ${C.line}`, color: C.muted, borderRadius: 10, padding: "9px", cursor: "pointer", fontFamily: UI, fontSize: 13 }}>
          <LogOut size={14} /> {t.logout}
        </button>
      </div>
    </div>
  );
}
