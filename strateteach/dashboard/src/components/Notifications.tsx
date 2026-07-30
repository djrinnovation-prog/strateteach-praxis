import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Send, MessageCircle, Smartphone, Loader2, CheckCircle2, ShieldCheck, UserPlus, Check, X } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";
import { Card, Collapsible, Field, input, btn, errBox, okBox } from "../ui";
import type { NotifPrefs } from "../lib/client";

const STR = {
  he: {
    title: "התראות", hint: "בחרו איך לקבל התראות ועל מה.",
    phone: "מספר טלפון", phonePh: "+972501234567",
    emailAddr: "כתובת אימייל", emailPh: "you@example.com",
    channels: "ערוצים", alerts: "סוגי התראות",
    sms: "SMS", whatsapp: "וואטסאפ", email: "אימייל", whatsappTo: "מספר וואטסאפ (אם שונה)",
    breakout: "פריצת מחיר (Breakout)", takeProfit: "הגעה ליעד רווח", stopLoss: "סטופ-לוס (הגנה)", botTrade: "בוט איתות ביצע עסקה", digest: "סיכום סריקה יומי", chat: "הודעות צ'אט (SMS/וואטסאפ/אימייל)",
    save: "שמירה", saved: "נשמר", test: "שלח התראת בדיקה", testSent: "נשלחה התראת בדיקה!",
    smsOff: "SMS לא מוגדר בשרת", waOff: "וואטסאפ לא מוגדר בשרת", emailOff: "אימייל לא מוגדר בשרת",
    emailNeedsAddr: "הוסיפו כתובת אימייל למעלה כדי לקבל התראות במייל.",
    waHelp: "להפעלת וואטסאפ: שלחו פעם אחת \"join <code>\" למספר הוואטסאפ של Twilio כדי לאשר קבלת הודעות.",
    consent: "בהפעלת ערוץ אתם מאשרים קבלת התראות בערוץ זה. עלויות הודעה עשויות לחול. הפסקה/ניהול — דרך המתגים כאן באפליקציה (שולח ה-SMS הוא חד-כיווני, ולכן \"השב STOP\" אינו פועל).",
    // broadcast
    bTitle: "שליחה לכל המשתמשים (SMS / וואטסאפ)", bHint: "שלחו הודעה למשתמשים נבחרים. לוגיקת אדמין בלבד.",
    message: "הודעה", channel: "ערוץ", target: "נמענים",
    tAll: "כולם (עם טלפון)", tDemo: "משתמשי דמו", tCustom: "שמות משתמש (מופרדים בפסיק)",
    send: "שליחה", sentN: (n: number, total: number) => `נשלח ל-${n} מתוך ${total}`,
    remindersBtn: "שלח תזכורות לדמו עכשיו", remindersN: (n: number) => `נשלחו ${n} תזכורות`,
  },
  en: {
    title: "Notifications", hint: "Choose how you get alerts and what about.",
    phone: "Phone number", phonePh: "+14155551234",
    emailAddr: "Email address", emailPh: "you@example.com",
    channels: "Channels", alerts: "Alert types",
    sms: "SMS", whatsapp: "WhatsApp", email: "Email", whatsappTo: "WhatsApp number (if different)",
    breakout: "Price breakout", takeProfit: "Take-profit hit", stopLoss: "Stop-loss (protection)", botTrade: "Signal Bot executed a trade", digest: "Daily scan digest", chat: "Chat messages (SMS/WhatsApp/email)",
    save: "Save", saved: "Saved", test: "Send test alert", testSent: "Test alert sent!",
    smsOff: "SMS not configured on the server", waOff: "WhatsApp not configured on the server", emailOff: "Email not configured on the server",
    emailNeedsAddr: "Add an email address above to receive email alerts.",
    waHelp: "To enable WhatsApp: send \"join <code>\" once to Twilio's WhatsApp number to opt in to messages.",
    consent: "Turning a channel on opts you in to receive alerts there. Message rates may apply. To stop or manage alerts, use these toggles in the app — the SMS sender is one-way, so replying STOP won't work.",
    // broadcast
    bTitle: "Broadcast to users (SMS / WhatsApp)", bHint: "Send a message to selected users. Admin only.",
    message: "Message", channel: "Channel", target: "Recipients",
    tAll: "Everyone (with a phone)", tDemo: "Demo testers", tCustom: "Usernames (comma-separated)",
    send: "Send", sentN: (n: number, total: number) => `Sent to ${n} of ${total}`,
    remindersBtn: "Send demo reminders now", remindersN: (n: number) => `Sent ${n} reminders`,
  },
};

const SEC = {
  he: {
    title: "אבטחה — אימות דו-שלבי (2FA)",
    hint: "בכל התחברות נשלח קוד חד-פעמי לטלגרם (אם מחובר) או לאימייל שלך, בנוסף לסיסמה. ללא SMS.",
    noPhone: "חברו טלגרם או הוסיפו כתובת אימייל כדי להפעיל 2FA — הקוד נשלח לשם.",
    notAvail: "חברו טלגרם או הוסיפו אימייל כדי להפעיל 2FA (הקוד נשלח לשם — ללא SMS).",
    on: "פעיל", off: "כבוי",
    enable: "הפעלת 2FA", disable: "כיבוי 2FA",
    sent: "שלחנו קוד ל", code: "קוד אימות", confirm: "אישור והפעלה", cancel: "ביטול",
    enabled: "אימות דו-שלבי הופעל!", disabled: "אימות דו-שלבי כובה.",
  },
  en: {
    title: "Security — Two-factor (2FA)",
    hint: "On every login we send a one-time code to your Telegram (if linked) or your email, in addition to your password. No SMS.",
    noPhone: "Link your Telegram or add an email address to enable 2FA — the code is sent there.",
    notAvail: "Link your Telegram or add an email to enable 2FA (the code is sent there — no SMS).",
    on: "On", off: "Off",
    enable: "Enable 2FA", disable: "Disable 2FA",
    sent: "We sent a code to", code: "Verification code", confirm: "Confirm & enable", cancel: "Cancel",
    enabled: "Two-factor enabled!", disabled: "Two-factor disabled.",
  },
};

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={disabled ? undefined : onClick} aria-pressed={on} disabled={disabled}
      style={{
        width: 44, height: 26, borderRadius: 999, border: "none", position: "relative", flexShrink: 0,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1,
        background: on ? "var(--btn-bg)" : C.surface2, transition: "background .15s",
      }}>
      <span style={{
        position: "absolute", top: 3, insetInlineStart: on ? 21 : 3, width: 20, height: 20, borderRadius: "50%",
        background: on ? "var(--btn-ink)" : C.muted, transition: "inset-inline-start .15s",
      }} />
    </button>
  );
}

function Row({ label, sub, on, set, disabled }: { label: string; sub?: string; on: boolean; set: () => void; disabled?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: `1px solid ${C.line}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, color: C.text, fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{sub}</div>}
      </div>
      <Toggle on={on} onClick={set} disabled={disabled} />
    </div>
  );
}

/** User-facing: channels + alert types + a test button. */
export function NotificationSettings() {
  const { lang } = useI18n();
  const t = STR[lang];
  const qc = useQueryClient();
  const [err, setErr] = useState(""); const [ok, setOk] = useState("");
  const q = useQuery({ queryKey: ["myNotifications"], queryFn: () => api.myNotifications(), retry: false });
  const [p, setP] = useState<NotifPrefs | null>(null);
  useEffect(() => { if (q.data && !p) setP({ ...q.data.prefs }); }, [q.data]); // eslint-disable-line

  const smsOn = !!q.data?.smsConfigured;
  const waOn = !!q.data?.whatsappConfigured;
  const emOn = !!q.data?.emailConfigured;
  const upd = (patch: Partial<NotifPrefs>) => setP((cur) => cur ? { ...cur, ...patch } : cur);

  const saveM = useMutation({
    mutationFn: async () => {
      if (!p) return;
      await api.setMyPhone(p.phone || "");
      await api.setMyEmail(p.emailTo || "");
      await api.setMyNotifications(p);
    },
    onSuccess: () => { setErr(""); setOk(t.saved); qc.invalidateQueries({ queryKey: ["myNotifications"] }); qc.invalidateQueries({ queryKey: ["myProfile"] }); },
    onError: (e: any) => { setOk(""); setErr(e?.message || String(e)); },
  });
  const testM = useMutation({
    mutationFn: () => api.testMyNotification(),
    onSuccess: () => { setErr(""); setOk(t.testSent); },
    onError: (e: any) => { setOk(""); setErr(e?.message || String(e)); },
  });

  if (!p) return <Collapsible id="notif" title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Bell size={16} /> {t.title}</span>}><div style={{ color: C.muted, fontSize: 13 }}>…</div></Collapsible>;

  return (
    <Collapsible id="notif" title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Bell size={16} /> {t.title}</span>}>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12 }}>{t.hint}</div>
      {err && <div style={errBox}>{err}</div>}
      {ok && <div style={okBox}>{ok}</div>}

      <div style={{ marginBottom: 12, maxWidth: 320, display: "grid", gap: 10 }}>
        <Field label={t.phone}><input style={input} value={p.phone || ""} placeholder={t.phonePh} onChange={(e) => upd({ phone: e.target.value })} /></Field>
        <Field label={t.emailAddr}><input style={input} type="email" value={p.emailTo || ""} placeholder={t.emailPh} onChange={(e) => upd({ emailTo: e.target.value })} /></Field>
      </div>

      <div style={{ fontSize: 12, color: C.muted, textTransform: "uppercase", letterSpacing: "0.04em", margin: "6px 0" }}>{t.channels}</div>
      <Row label={t.sms} sub={smsOn ? undefined : t.smsOff} on={p.sms} set={() => upd({ sms: !p.sms })} disabled={!smsOn} />
      <Row label={t.whatsapp} sub={waOn ? t.waHelp : t.waOff} on={p.whatsapp} set={() => upd({ whatsapp: !p.whatsapp })} disabled={!waOn} />
      {p.whatsapp && (
        <div style={{ margin: "10px 0", maxWidth: 320 }}>
          <Field label={t.whatsappTo}><input style={input} value={p.whatsappTo || ""} placeholder={t.phonePh} onChange={(e) => upd({ whatsappTo: e.target.value })} /></Field>
        </div>
      )}
      <Row label={t.email} sub={!emOn ? t.emailOff : (!(p.emailTo || "").trim() ? t.emailNeedsAddr : undefined)} on={p.email} set={() => upd({ email: !p.email })} disabled={!emOn} />

      <div style={{ fontSize: 11, color: C.faint, marginTop: 10, lineHeight: 1.5 }}>{t.consent}</div>

      <div style={{ fontSize: 12, color: C.muted, textTransform: "uppercase", letterSpacing: "0.04em", margin: "14px 0 6px" }}>{t.alerts}</div>
      <Row label={t.breakout} on={p.breakout} set={() => upd({ breakout: !p.breakout })} />
      <Row label={t.takeProfit} on={p.takeProfit} set={() => upd({ takeProfit: !p.takeProfit })} />
      <Row label={t.stopLoss} on={p.stopLoss} set={() => upd({ stopLoss: !p.stopLoss })} />
      <Row label={t.botTrade} on={p.botTrade} set={() => upd({ botTrade: !p.botTrade })} />
      <Row label={t.digest} on={p.digest} set={() => upd({ digest: !p.digest })} />
      <Row label={t.chat} on={p.chat} set={() => upd({ chat: !p.chat })} />

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button style={btn(true)} onClick={() => saveM.mutate()} disabled={saveM.isPending}>
          {saveM.isPending ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />} {t.save}
        </button>
        <button style={btn(false)} onClick={() => testM.mutate()} disabled={testM.isPending || (!p.sms && !p.whatsapp && !p.email)}>
          {testM.isPending ? <Loader2 size={14} className="spin" /> : <Send size={14} />} {t.test}
        </button>
      </div>
    </Collapsible>
  );
}

/** User-facing: SMS login 2FA enable/disable with code confirm. */
export function TwoFactorCard() {
  const { lang } = useI18n();
  const t = SEC[lang];
  const qc = useQueryClient();
  const [err, setErr] = useState(""); const [ok, setOk] = useState("");
  const [step, setStep] = useState<"idle" | "code">("idle");
  const [code, setCode] = useState("");
  const q = useQuery({ queryKey: ["my2fa"], queryFn: () => api.get2fa(), retry: false });

  const startM = useMutation({
    mutationFn: () => api.start2fa(),
    onSuccess: () => { setErr(""); setOk(""); setStep("code"); setCode(""); },
    onError: (e: any) => { setOk(""); setErr(e?.message || String(e)); },
  });
  const enableM = useMutation({
    mutationFn: () => api.enable2fa(code.trim()),
    onSuccess: () => { setErr(""); setOk(t.enabled); setStep("idle"); qc.invalidateQueries({ queryKey: ["my2fa"] }); },
    onError: (e: any) => { setOk(""); setErr(e?.message || String(e)); },
  });
  const disableM = useMutation({
    mutationFn: () => api.disable2fa(),
    onSuccess: () => { setErr(""); setOk(t.disabled); qc.invalidateQueries({ queryKey: ["my2fa"] }); },
    onError: (e: any) => { setOk(""); setErr(e?.message || String(e)); },
  });

  const enabled = !!q.data?.enabled;
  const available = !!q.data?.available;   // true when a free channel (Telegram/email) exists
  const channelHint = q.data?.channelHint || "";

  return (
    <Collapsible id="2fa" title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <ShieldCheck size={16} color={C.gold} /> {t.title}{" "}
      <span style={{ fontSize: 11, color: enabled ? "#5bd07f" : C.faint }}>{enabled ? "● " + t.on : "○ " + t.off}</span>
    </span>}>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12 }}>{t.hint}</div>
      {err && <div style={errBox}>{err}</div>}
      {ok && <div style={okBox}>{ok}</div>}

      {!available ? (
        <div style={{ fontSize: 13, color: C.muted }}>{t.notAvail}</div>
      ) : enabled ? (
        <button style={btn(false)} onClick={() => disableM.mutate()} disabled={disableM.isPending}>
          {disableM.isPending ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />} {t.disable}
        </button>
      ) : step === "idle" ? (
        <button style={btn(true)} onClick={() => startM.mutate()} disabled={startM.isPending}>
          {startM.isPending ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />} {t.enable}
        </button>
      ) : (
        <div style={{ display: "grid", gap: 10, maxWidth: 280 }}>
          <div style={{ fontSize: 12.5, color: C.muted }}>{t.sent} {channelHint}</div>
          <Field label={t.code}>
            <input style={{ ...input, letterSpacing: "0.25em", textAlign: "center" }} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoFocus placeholder="••••••" />
          </Field>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btn(true)} onClick={() => enableM.mutate()} disabled={enableM.isPending || code.length < 4}>
              {enableM.isPending ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />} {t.confirm}
            </button>
            <button style={btn(false)} onClick={() => { setStep("idle"); setCode(""); setErr(""); }}>{t.cancel}</button>
          </div>
        </div>
      )}
    </Collapsible>
  );
}

const TOTP = {
  he: {
    title: "אפליקציית אימות (TOTP)",
    hint: "השיטה המומלצת והבטוחה ביותר: קוד מתחלף שנוצר באפליקציה שלך (Google Authenticator / Authy). ללא עלות, עובד גם ללא אינטרנט. כשמופעל — זו שיטת האימות הראשית בכניסה.",
    on: "פעיל", off: "כבוי",
    enable: "הפעלת אפליקציית אימות", disable: "כיבוי אפליקציית אימות",
    step1: "1. סרקו את קוד ה-QR באפליקציית האימות (או הזינו את המפתח ידנית):",
    manual: "מפתח ידני", step2: "2. הזינו את הקוד בן 6 הספרות שמופיע באפליקציה:",
    code: "קוד מהאפליקציה", confirm: "אישור והפעלה", cancel: "ביטול",
    enabled: "אפליקציית האימות הופעלה!", disabled: "אפליקציית האימות כובתה.",
    recovery: (h: string) => `שחזור במקרה של אובדן מכשיר: קוד חד-פעמי יישלח ל${h}.`,
    noRecovery: "מומלץ לחבר טלגרם או להוסיף אימייל — כדי שנוכל לשלוח קוד שחזור אם תאבד/י את המכשיר.",
  },
  en: {
    title: "Authenticator app (TOTP)",
    hint: "The most secure, recommended method: a rotating code generated in your app (Google Authenticator / Authy). Zero cost, works offline. When on, it's your primary factor at login.",
    on: "On", off: "Off",
    enable: "Enable authenticator app", disable: "Disable authenticator app",
    step1: "1. Scan the QR in your authenticator app (or enter the key manually):",
    manual: "Manual key", step2: "2. Enter the 6-digit code your app shows:",
    code: "Code from app", confirm: "Confirm & enable", cancel: "Cancel",
    enabled: "Authenticator enabled!", disabled: "Authenticator disabled.",
    recovery: (h: string) => `Lost-device recovery: a one-time code will be sent to your ${h}.`,
    noRecovery: "Tip: link Telegram or add an email so we can send a recovery code if you lose your device.",
  },
};

/** TOTP (RFC 6238) authenticator-app 2FA — the primary, zero-cost login factor. */
export function TotpCard() {
  const { lang } = useI18n();
  const t = TOTP[lang];
  const qc = useQueryClient();
  const [err, setErr] = useState(""); const [ok, setOk] = useState("");
  const [step, setStep] = useState<"idle" | "scan">("idle");
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState("");
  const q = useQuery({ queryKey: ["mytotp"], queryFn: () => api.getTotp(), retry: false });

  const startM = useMutation({
    mutationFn: () => api.startTotp(),
    onSuccess: (r) => { setErr(""); setOk(""); setSetup({ secret: r.secret, qrSvg: r.qrSvg }); setStep("scan"); setCode(""); },
    onError: (e: any) => { setOk(""); setErr(e?.message || String(e)); },
  });
  const enableM = useMutation({
    mutationFn: () => api.enableTotp(code.trim()),
    onSuccess: () => { setErr(""); setOk(t.enabled); setStep("idle"); setSetup(null); qc.invalidateQueries({ queryKey: ["mytotp"] }); },
    onError: (e: any) => { setOk(""); setErr(e?.message || String(e)); },
  });
  const disableM = useMutation({
    mutationFn: () => api.disableTotp(),
    onSuccess: () => { setErr(""); setOk(t.disabled); qc.invalidateQueries({ queryKey: ["mytotp"] }); },
    onError: (e: any) => { setOk(""); setErr(e?.message || String(e)); },
  });

  const enabled = !!q.data?.enabled;
  const recoveryHint = q.data?.recoveryHint || "";
  const recoveryAvailable = !!q.data?.recoveryAvailable;

  return (
    <Collapsible id="totp" title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <ShieldCheck size={16} color={C.gold} /> {t.title}{" "}
      <span style={{ fontSize: 11, color: enabled ? "#5bd07f" : C.faint }}>{enabled ? "● " + t.on : "○ " + t.off}</span>
    </span>}>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12 }}>{t.hint}</div>
      {err && <div style={errBox}>{err}</div>}
      {ok && <div style={okBox}>{ok}</div>}

      {enabled ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, color: recoveryAvailable ? C.muted : "#e0a44a" }}>
            {recoveryAvailable ? t.recovery(recoveryHint) : t.noRecovery}
          </div>
          <button style={btn(false)} onClick={() => disableM.mutate()} disabled={disableM.isPending}>
            {disableM.isPending ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />} {t.disable}
          </button>
        </div>
      ) : step === "idle" ? (
        <button style={btn(true)} onClick={() => startM.mutate()} disabled={startM.isPending}>
          {startM.isPending ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />} {t.enable}
        </button>
      ) : (
        <div style={{ display: "grid", gap: 12, maxWidth: 300 }}>
          <div style={{ fontSize: 12.5, color: C.muted }}>{t.step1}</div>
          {setup?.qrSvg && (
            <img src={setup.qrSvg} alt="TOTP QR" width={160} height={160}
              style={{ alignSelf: "center", background: "#fff", padding: 8, borderRadius: 10 }} />
          )}
          <div style={{ fontSize: 11, color: C.muted }}>{t.manual}:</div>
          <div style={{ fontFamily: "monospace", fontSize: 13, letterSpacing: "0.06em", wordBreak: "break-all",
            background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", color: C.text }}>{setup?.secret}</div>
          <div style={{ fontSize: 12.5, color: C.muted }}>{t.step2}</div>
          <Field label={t.code}>
            <input style={{ ...input, letterSpacing: "0.25em", textAlign: "center" }} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoFocus placeholder="••••••" />
          </Field>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btn(true)} onClick={() => enableM.mutate()} disabled={enableM.isPending || code.length < 6}>
              {enableM.isPending ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />} {t.confirm}
            </button>
            <button style={btn(false)} onClick={() => { setStep("idle"); setSetup(null); setCode(""); setErr(""); }}>{t.cancel}</button>
          </div>
        </div>
      )}
    </Collapsible>
  );
}

/** Admin-only: SMS/WhatsApp broadcast + a "send demo reminders now" button. */
export function BroadcastPanel() {
  const { lang } = useI18n();
  const t = STR[lang];
  const [err, setErr] = useState(""); const [ok, setOk] = useState("");
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<"sms" | "whatsapp">("sms");
  const [targetKind, setTargetKind] = useState<"all" | "demo" | "custom">("demo");
  const [custom, setCustom] = useState("");

  const sendM = useMutation({
    mutationFn: () => api.broadcast(text.trim(), channel, targetKind === "custom" ? custom : targetKind),
    onSuccess: (r) => { setErr(""); setOk(t.sentN(r.sent, r.total) + (r.skipped.length ? ` · skipped: ${r.skipped.join(", ")}` : "")); },
    onError: (e: any) => { setOk(""); setErr(e?.message || String(e)); },
  });
  const remM = useMutation({
    mutationFn: () => api.sendDemoReminders(),
    onSuccess: (r) => { setErr(""); setOk(t.remindersN(r.sent)); },
    onError: (e: any) => { setOk(""); setErr(e?.message || String(e)); },
  });

  const sel: React.CSSProperties = { ...input, cursor: "pointer" };

  return (
    <Collapsible id="broadcast" title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><MessageCircle size={16} /> {t.bTitle}</span>}>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12 }}>{t.bHint}</div>
      {err && <div style={errBox}>{err}</div>}
      {ok && <div style={okBox}>{ok}</div>}

      <div style={{ display: "grid", gap: 10 }}>
        <Field label={t.message}>
          <textarea style={{ ...input, minHeight: 90, resize: "vertical", fontFamily: UI }} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
        </Field>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ minWidth: 150 }}>
            <Field label={t.channel}>
              <select style={sel} value={channel} onChange={(e) => setChannel(e.target.value as any)}>
                <option value="sms">{t.sms}</option>
                <option value="whatsapp">{t.whatsapp}</option>
              </select>
            </Field>
          </div>
          <div style={{ minWidth: 180 }}>
            <Field label={t.target}>
              <select style={sel} value={targetKind} onChange={(e) => setTargetKind(e.target.value as any)}>
                <option value="all">{t.tAll}</option>
                <option value="demo">{t.tDemo}</option>
                <option value="custom">{t.tCustom}</option>
              </select>
            </Field>
          </div>
        </div>
        {targetKind === "custom" && (
          <Field label={t.tCustom}><input style={input} value={custom} placeholder="momosan, elior, dvir" onChange={(e) => setCustom(e.target.value)} /></Field>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btn(true)} onClick={() => sendM.mutate()} disabled={sendM.isPending || !text.trim()}>
            {sendM.isPending ? <Loader2 size={14} className="spin" /> : <Send size={14} />} {t.send}
          </button>
          <button style={btn(false)} onClick={() => remM.mutate()} disabled={remM.isPending}>
            {remM.isPending ? <Loader2 size={14} className="spin" /> : <Smartphone size={14} />} {t.remindersBtn}
          </button>
        </div>
      </div>
    </Collapsible>
  );
}

/** Owner-only: turn any user into a WhatsApp alert recipient in one step —
 *  set their phone + enable WhatsApp + all alert types. */
export function WhatsAppRecipientPanel() {
  const { lang } = useI18n();
  const he = lang === "he";
  const qc = useQueryClient();
  const [err, setErr] = useState(""); const [ok, setOk] = useState("");
  const [uname, setUname] = useState("");
  const [phone, setPhone] = useState("");

  const T = he ? {
    title: "נמען וואטסאפ להתראות", hint: "הגדירו משתמש קיים כנמען וואטסאפ: מספר טלפון + הפעלת וואטסאפ + כל סוגי ההתראות — בבת אחת.",
    user: "שם משתמש", phone: "מספר וואטסאפ (E.164)", phonePh: "+972538821770",
    save: "הגדרת נמען", saved: (u: string) => `${u} — וואטסאפ הופעל וכל ההתראות פעילות`,
    note: "בסביבת הבדיקה (Sandbox) הנמען חייב לשלוח פעם אחת את קוד ההצטרפות (למשל \"join edge-year\") למספר הוואטסאפ של Twilio לפני שיקבל הודעות.",
    off: "וואטסאפ אינו מוגדר בשרת.",
  } : {
    title: "WhatsApp alert recipient", hint: "Turn an existing user into a WhatsApp recipient: phone + enable WhatsApp + all alert types — in one step.",
    user: "Username", phone: "WhatsApp number (E.164)", phonePh: "+972538821770",
    save: "Set recipient", saved: (u: string) => `${u} — WhatsApp enabled with all alerts on`,
    note: "On the Twilio sandbox the recipient must first send the join code (e.g. \"join edge-year\") to Twilio's WhatsApp number before they'll receive anything.",
    off: "WhatsApp is not configured on the server.",
  };

  const notifQ = useQuery({ queryKey: ["myNotifications"], queryFn: () => api.myNotifications(), retry: false });
  const waConfigured = !!notifQ.data?.whatsappConfigured;

  const saveM = useMutation({
    mutationFn: () => api.setWhatsappRecipient(uname.trim(), phone.trim(), true),
    onSuccess: (r) => { setErr(""); setOk(T.saved(r.username)); qc.invalidateQueries({ queryKey: ["myNotifications"] }); },
    onError: (e: any) => { setOk(""); setErr(e?.message || String(e)); },
  });

  return (
    <Collapsible id="wa_recipient" title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Smartphone size={16} color={C.gold} /> {T.title}</span>}>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12 }}>{T.hint}</div>
      {!waConfigured && <div style={{ ...errBox, opacity: 0.9 }}>{T.off}</div>}
      {err && <div style={errBox}>{err}</div>}
      {ok && <div style={okBox}>{ok}</div>}
      <div style={{ display: "grid", gap: 10, maxWidth: 340 }}>
        <Field label={T.user}><input style={input} value={uname} placeholder="dan" onChange={(e) => setUname(e.target.value)} /></Field>
        <Field label={T.phone}><input style={input} value={phone} placeholder={T.phonePh} onChange={(e) => setPhone(e.target.value)} /></Field>
        <button style={btn(true)} onClick={() => saveM.mutate()} disabled={saveM.isPending || !uname.trim() || !phone.trim()}>
          {saveM.isPending ? <Loader2 size={14} className="spin" /> : <MessageCircle size={14} />} {T.save}
        </button>
      </div>
      <div style={{ fontSize: 11, color: C.faint, marginTop: 12, lineHeight: 1.5 }}>{T.note}</div>
    </Collapsible>
  );
}

/** Admin-only: review public self-signup requests; approve sends login by SMS/email. */
export function SignupRequestsPanel() {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const qc = useQueryClient();
  const [msg, setMsg] = useState("");
  const q = useQuery({ queryKey: ["signupReqs"], queryFn: () => api.listSignupRequests(), retry: false, refetchInterval: 30000 });
  const approveM = useMutation({
    mutationFn: (id: number) => api.approveSignup(id),
    onSuccess: (r) => { setMsg(he ? `אושר → ${r.username} · נשלחה הודעה` : `Approved → ${r.username} · message sent`); qc.invalidateQueries({ queryKey: ["signupReqs"] }); },
    onError: (e: any) => setMsg(e?.message || String(e)),
  });
  const denyM = useMutation({ mutationFn: (id: number) => api.denySignup(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["signupReqs"] }) });
  const reqs = q.data || [];
  const title = <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
    <UserPlus size={16} color={C.gold} /> {he ? "בקשות הצטרפות חדשות" : "New access requests"}
    {reqs.length > 0 && <span style={{ background: "var(--btn-bg)", color: "var(--btn-ink)", fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "1px 8px" }}>{reqs.length}</span>}
  </span>;
  return (
    <Collapsible id="signup_reqs" defaultOpen title={title}>
      {msg && <div style={okBox}>{msg}</div>}
      <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 12 }}>
        {he ? "רוצים לאשר/לדחות בקשות מהנייד? הפעילו אישורי מנהל במסך טלגרם." : "Want to Approve/Deny from your phone? Turn on admin approvals in the Telegram screen."}
      </div>
      {reqs.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 13 }}>{he ? "אין בקשות ממתינות." : "No pending requests."}</div>
      ) : reqs.map((r) => (
        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${C.line}`, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, textAlign: rtl ? "right" : "left" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{r.name}</div>
            <div style={{ fontSize: 12, color: C.muted }}>{[r.phone, r.email].filter(Boolean).join(" · ") || "—"}</div>
            {r.note && <div style={{ fontSize: 12, color: C.muted, marginTop: 2, fontStyle: "italic" }}>“{r.note}”</div>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btn(true)} onClick={() => approveM.mutate(r.id)} disabled={approveM.isPending}>
              {approveM.isPending ? <Loader2 size={13} className="spin" /> : <Check size={14} />} {he ? "אישור" : "Approve"}
            </button>
            <button style={btn(false)} onClick={() => denyM.mutate(r.id)} disabled={denyM.isPending}>
              <X size={14} /> {he ? "דחייה" : "Deny"}
            </button>
          </div>
        </div>
      ))}
    </Collapsible>
  );
}
