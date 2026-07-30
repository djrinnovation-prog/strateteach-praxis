import React, { useEffect, useRef, useState, Suspense, lazy } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Check, UserRound, Settings as SettingsIcon, Send, Diamond, Mail, ChevronLeft, ChevronRight, ShieldCheck, Bell, Crown, Lock, KeyRound, Download, Trash2, UserX, Cog, Gem, Scale, Inbox, Coins, BadgeCheck } from "lucide-react";
import { api, isAdmin, isAdminOrOwner, isOwner, isLegalEditor } from "../app/api";
import { useI18n } from "../i18n";
import { C, MONO, onAccent } from "../theme";
import { btn, errBox, premSoft } from "../ui";
import { TwoFactorCard, TotpCard, NotificationSettings } from "../components/Notifications";
import HubScreen, { type HubFather, type HubChild } from "../components/HubScreen";
import EmployeeMiniPanel from "../components/EmployeeMiniPanel";

// Step 3 · fold Admin into /me. Reuse Admin's EXISTING lazy chunk — Shell already
// does lazy(() => import("../screens/Admin")), so this second reference resolves to
// the SAME chunk (no new chunk is emitted). Role-gated at the tile below.
const AdminPanel = lazy(() => import("./Admin"));
import ScreenHero from "../components/ScreenHero";
import FramedTitle from "../components/FramedTitle";
import HomeTop from "../components/HomeTop";
import TourLauncher from "../components/TourLauncher";
import { setAnalyticsConsentCache } from "../lib/analytics";
import { DraftBadge, useLegalCopy } from "../lib/legalCopy";

const AV = ["#F7931A", "#7CC04E", "#36C5F0", "#E8438F", "#FBC02D", "#2DD4BF", "#A78BFA", "#FB7185"];
const colorFor = (s: string) => AV[Math.abs([...(s || "?")].reduce((a, c) => a + c.charCodeAt(0), 0)) % AV.length];

// Downscale a chosen image to a small square-ish JPEG data URL.
function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const max = 256;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d"); if (!ctx) return reject(new Error("no canvas"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function Avatar({ name, color, size = 56, avatar }: { name: string; color: string; size?: number; avatar?: string | null }) {
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, display: "flex", overflow: "hidden",
      alignItems: "center", justifyContent: "center", background: color, color: onAccent(color), fontWeight: 800, fontSize: size * 0.42 }}>
      {avatar ? <img src={avatar} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (name || "#")[0].toUpperCase()}
    </div>
  );
}

export default function Account() {
  const { lang } = useI18n();
  const nav = useNavigate();
  // Deep-link: /me?sec=<father> opens straight to a section (e.g. ?sec=management
  // from the retired /admin redirect + the sidebar "ניהול" group).
  const [sp] = useSearchParams();
  const initialSec = sp.get("sec") || undefined;
  const qc = useQueryClient();
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg((c) => (c === m ? "" : c)), 2600); };
  const inv = (k: string) => qc.invalidateQueries({ queryKey: [k] });
  const fail = (e: any) => setErr(e?.message || String(e));

  const profQ = useQuery({ queryKey: ["myProfile"], queryFn: () => api.myProfile() });
  // Is the caller an employee? Shares the ["myEmployee"] query with the mini-panel (deduped).
  const empQ = useQuery({ queryKey: ["myEmployee"], queryFn: () => api.myEmployee(), retry: false });
  const isEmployee = !!empQ.data?.employee;
  const unreadQ = useQuery({ queryKey: ["myMessagesUnread"], queryFn: () => api.myMessagesUnreadCount(), refetchInterval: 30000 });
  const unread = (unreadQ.data as any)?.count || 0;
  const p: any = profQ.data || {};

  const [nick, setNick] = useState("");
  const [pwCur, setPwCur] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [notifyOn, setNotifyOn] = useState(() => { try { return localStorage.getItem("algo770_notify") !== "0"; } catch (_e) { return true; } });
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (profQ.data) { setNick((d) => d || (p.nickname ?? "")); } }, [profQ.data]);

  const exConnected = (() => { try { return !!localStorage.getItem("algo770_exchange_creds"); } catch (_e) { return false; } })();
  const avatarM = useMutation({ mutationFn: (d: string | null) => api.setAvatar(d), onSuccess: () => { inv("myProfile"); inv("chatContacts"); flash(lang === "he" ? "התמונה עודכנה ✓" : "Photo updated ✓"); }, onError: fail });
  const nickM = useMutation({ mutationFn: (n: string) => api.setNickname(n), onSuccess: () => { inv("myProfile"); inv("chatContacts"); flash(lang === "he" ? "הכינוי נשמר ✓" : "Nickname saved ✓"); }, onError: fail });
  const pwM = useMutation({ mutationFn: () => api.changeMyPassword(pwCur, pwNew), onSuccess: () => { setPwCur(""); setPwNew(""); flash(lang === "he" ? "הסיסמה שונתה ✓" : "Password changed ✓"); }, onError: fail });

  // ── Security · personal protection code (folded in from the old Settings screen).
  // Each user sets their OWN private code that gates sensitive actions.
  const [protCur, setProtCur] = useState(""); const [protNew, setProtNew] = useState("");
  const protQ = useQuery({ queryKey: ["protection"], queryFn: () => api.protectionStatus(), retry: false });
  const protSet = (api as any).setProtection;
  const protM = useMutation({ mutationFn: (code: string) => protSet(code, protCur), onSuccess: () => { setProtCur(""); setProtNew(""); inv("protection"); flash(lang === "he" ? "הקוד נשמר ✓" : "Code saved ✓"); }, onError: fail });
  const protOn = !!(protQ.data as any)?.set;

  // ── My Data · GDPR self-service (Item 7). Deletion is a SOFT request (below), not a
  // destructive self-action; the export includes the user's own analytics events.
  const exportM = useMutation({
    mutationFn: () => api.exportMyData(),
    onSuccess: (data: any) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "algo770-my-data.json"; a.click();
      URL.revokeObjectURL(url); flash(lang === "he" ? "הנתונים הורדו ✓" : "Data downloaded ✓");
    }, onError: fail,
  });
  // Item 7 · analytics-consent toggle (shares the modal's ["analyticsConsent"] cache).
  const consentQ = useQuery({ queryKey: ["analyticsConsent"], queryFn: () => api.getAnalyticsConsent(), retry: false });
  const consentM = useMutation({
    mutationFn: (v: boolean) => api.setAnalyticsConsent(v),
    onSuccess: (_r, v) => { setAnalyticsConsentCache(v); qc.setQueryData(["analyticsConsent"], { consent: v, decided: true }); flash(lang === "he" ? "העדפת המדידה נשמרה ✓" : "Analytics preference saved ✓"); },
    onError: fail,
  });
  const analyticsOn = !!(consentQ.data as any)?.consent;
  // Item 7 · SOFT deletion REQUEST (marks account + notifies owners; no hard delete).
  const dataStatusQ = useQuery({ queryKey: ["myDataStatus"], queryFn: () => api.myDataStatus(), retry: false });
  const delReqPending = !!(dataStatusQ.data as any)?.deletionRequestedAt;
  const delReqM = useMutation({ mutationFn: () => api.requestMyDeletion(), onSuccess: () => { inv("myDataStatus"); flash(lang === "he" ? "בקשת המחיקה נשלחה ✓" : "Deletion request sent ✓"); }, onError: fail });
  const delWithdrawM = useMutation({ mutationFn: () => api.withdrawMyDeletion(), onSuccess: () => { inv("myDataStatus"); flash(lang === "he" ? "הבקשה בוטלה" : "Request withdrawn"); }, onError: fail });

  // Per-admin Telegram: each admin connects their own bot + chat for their own alerts.
  const [tgTok, setTgTok] = useState("");
  const [tgChat, setTgChat] = useState("");
  const myTgQ = useQuery({ queryKey: ["myTelegram"], queryFn: () => api.myTelegram(), enabled: isAdmin() });
  useEffect(() => { const c: any = myTgQ.data; if (c) setTgChat((v) => v || c.chatId || ""); }, [myTgQ.data]);
  const saveMyTgM = useMutation({ mutationFn: () => api.saveMyTelegram(tgTok, tgChat.trim()), onSuccess: () => { setTgTok(""); inv("myTelegram"); flash(lang === "he" ? "טלגרם חובר ✓" : "Telegram connected ✓"); }, onError: fail });
  const testMyTgM = useMutation({ mutationFn: () => api.testMyTelegram(), onSuccess: (r: any) => flash(r?.message || "Sent ✓"), onError: fail });
  const discMyTgM = useMutation({ mutationFn: () => api.disconnectMyTelegram(), onSuccess: () => { inv("myTelegram"); setTgChat(""); flash(lang === "he" ? "נותק" : "Disconnected"); }, onError: fail });

  const onPick = async (f?: File | null) => { if (!f) return; try { avatarM.mutate(await fileToAvatar(f)); } catch { setErr(lang === "he" ? "טעינת התמונה נכשלה" : "Couldn't load image"); } };
  const toggleNotify = () => { const n = !notifyOn; setNotifyOn(n); try { localStorage.setItem("algo770_notify", n ? "1" : "0"); } catch (_e) { /* */ } if (n && "Notification" in window && Notification.permission === "default") { try { Notification.requestPermission(); } catch (_e) { /* */ } } };

  const lbl = { fontSize: 11, color: C.muted, marginBottom: 4 } as React.CSSProperties;
  const inp = { width: "100%", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 11px", color: C.text, fontFamily: "inherit", fontSize: 13 } as React.CSSProperties;
  // A block separator + small heading, so the few grouped sections read cleanly when
  // several ex-tiles are stacked inside one panel (channels; security+privacy).
  const sepTop = { borderTop: `1px solid ${C.line}`, marginTop: 16, paddingTop: 16 } as React.CSSProperties;
  const subHead = (text: string, Icon?: React.FC<any>) => (
    <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text, margin: "0 0 10px", display: "inline-flex", alignItems: "center", gap: 7 }}>
      {Icon && <Icon size={14} color={C.gold} />} {text}
    </div>
  );

  // ── child screens ──────────────────────────────────────────────────────────
  const profileView = () => (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ position: "relative" }}>
        <Avatar name={nick || p.username || "?"} color={colorFor(p.username || "?")} size={72} avatar={p.avatar} />
        <button onClick={() => fileRef.current?.click()} title={lang === "he" ? "החלף תמונה" : "Change photo"}
          style={{ position: "absolute", bottom: 0, insetInlineEnd: 0, width: 28, height: 28, borderRadius: "50%", background: "var(--btn-bg)", color: "var(--btn-ink)", border: `2px solid ${C.surface}`, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Camera size={14} /></button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { onPick(e.target.files?.[0]); e.currentTarget.value = ""; }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={lbl}>{lang === "he" ? "כינוי בצ'אט" : "Chat nickname"}</div>
        <div style={{ display: "flex", gap: 6 }}>
          <input value={nick} onChange={(e) => setNick(e.target.value)} placeholder={p.username} style={inp} />
          <button onClick={() => nickM.mutate(nick.trim())} disabled={nickM.isPending || !nick.trim()} className="gbtn ptile" style={btn(true)}><Check size={14} /></button>
        </div>
        {p.avatar && <button onClick={() => avatarM.mutate(null)} style={{ background: "none", border: "none", color: C.muted, fontSize: 12, cursor: "pointer", marginTop: 6, padding: 0 }}>{lang === "he" ? "הסר תמונה" : "Remove photo"}</button>}
      </div>
    </div>
  );

  const accountView = () => (
    <>
      <button onClick={() => nav("/team-messages")} className="tap44"
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", boxSizing: "border-box", minHeight: 44, textAlign: "start",
          cursor: "pointer", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px", fontFamily: "inherit", marginBottom: 14 }}>
        <Mail size={16} color={C.gold} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: C.text }}>{lang === "he" ? "הודעות מהצוות" : "Messages from the team"}</span>
        {unread > 0 && <span style={{ minWidth: 20, height: 20, borderRadius: 999, background: C.loss, color: "#fff", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 6px", flexShrink: 0 }}>{unread}</span>}
        {lang === "he" ? <ChevronLeft size={16} color={C.muted} style={{ flexShrink: 0 }} /> : <ChevronRight size={16} color={C.muted} style={{ flexShrink: 0 }} />}
      </button>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>{lang === "he" ? "שם משתמש" : "Username"}: <b style={{ color: C.text }}>{p.username}</b></div>
      {/* Email + phone are edited in the notification-channels block below (one place,
          no duplication). Here we keep the account basics: exchange + plan. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 13, color: C.muted }}>{lang === "he" ? "בורסה" : "Exchange"}: <b style={{ color: exConnected ? C.gain : C.loss }}>{exConnected ? (lang === "he" ? "מחוברת ✓" : "Connected ✓") : (lang === "he" ? "לא מחוברת" : "Not connected")}</b></span>
        <button onClick={() => nav("/exchange")} style={{ ...premSoft(), color: C.text, padding: "7px 14px", fontSize: 12.5, whiteSpace: "nowrap", cursor: "pointer", fontFamily: "inherit" }}>{lang === "he" ? "נהל" : "Manage"}</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 12, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
        <span style={{ fontSize: 13, color: C.muted, display: "inline-flex", alignItems: "center", gap: 7 }}><Crown size={14} color={C.gold} /> {lang === "he" ? "מסלול ומנוי" : "Plan & subscription"}</span>
        <button onClick={() => nav("/plans")} style={{ ...premSoft(), color: C.text, padding: "7px 14px", fontSize: 12.5, whiteSpace: "nowrap", cursor: "pointer", fontFamily: "inherit" }}>{lang === "he" ? "נהל" : "Manage"}</button>
      </div>
    </>
  );

  // Notification channels: browser-push toggle + the full per-channel
  // NotificationSettings (email / SMS / WhatsApp consent + alert types). One home.
  const notifyView = () => (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${C.line}` }}>
        <span style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 7 }}><Bell size={15} color={C.gold} /> {lang === "he" ? "התראות דפדפן" : "Browser notifications"}</span>
        <button onClick={toggleNotify} aria-label="browser notifications" style={{ width: 46, height: 26, borderRadius: 999, border: "none", cursor: "pointer", background: notifyOn ? C.gain : C.surface2, position: "relative", flexShrink: 0 }}>
          <span style={{ position: "absolute", top: 3, [notifyOn ? "right" : "left"]: 3, width: 20, height: 20, borderRadius: "50%", background: "#fff" } as React.CSSProperties} />
        </button>
      </div>
      <NotificationSettings />
    </>
  );

  const telegramView = () => { const c: any = myTgQ.data || {}; const tgConnected = !!(c.connected ?? c.configured); return (
    <>
      {/* Prominent connection status — driven by a saved bot token + chat ID, so the
          panel reads the real state at a glance (a small footer line was too easy to miss). */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14,
        padding: "10px 14px", borderRadius: 12,
        background: tgConnected ? `${C.gain}1f` : C.surface2,
        border: `1px solid ${tgConnected ? C.gain : C.line}`,
        color: tgConnected ? C.gain : C.muted }}>
        {tgConnected ? <Check size={17} /> : <Send size={15} />}
        <span style={{ fontSize: 14, fontWeight: 800 }}>
          {tgConnected ? (lang === "he" ? "✓ מחובר לטלגרם" : "✓ Connected to Telegram") : (lang === "he" ? "לא מחובר" : "Not connected")}
        </span>
        {tgConnected && c.botTokenMasked && <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, opacity: 0.9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }}>· {c.botTokenMasked}</span>}
        {tgConnected && c.chatId && <span style={{ fontFamily: MONO, fontSize: 12, opacity: 0.85, whiteSpace: "nowrap" }}>· {lang === "he" ? "צ'אט" : "chat"} {c.chatId}</span>}
        {tgConnected && c.lastTestOk && <span style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.95 }}>· {lang === "he" ? "אומת ✓" : "verified ✓"}</span>}
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>{lang === "he" ? "כל מנהל מחבר טלגרם משלו ומקבל רק את ההתראות שלו (היעדים והפוזיציות שלך בלבד)." : "Each admin connects their own Telegram and receives only their own alerts (your runs only)."}</div>
      <div style={{ marginBottom: 10 }}>
        <div style={lbl}>Bot token</div>
        <input value={tgTok} onChange={(e) => setTgTok(e.target.value)} placeholder={c.configured ? (c.botTokenMasked || "••••••") : "123456:ABC-DEF…"} style={{ ...inp, fontFamily: MONO }} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={lbl}>Chat ID</div>
        <input value={tgChat} onChange={(e) => setTgChat(e.target.value)} placeholder="123456789" style={{ ...inp, fontFamily: MONO }} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => saveMyTgM.mutate()} disabled={saveMyTgM.isPending || !tgChat.trim()} className="gbtn ptile" style={{ ...btn(true), whiteSpace: "nowrap" }}><Check size={14} /> {lang === "he" ? "שמור" : "Save"}</button>
        <button onClick={() => testMyTgM.mutate()} disabled={testMyTgM.isPending || !tgConnected} style={{ ...premSoft(), color: C.text, padding: "9px 16px", fontSize: 13, whiteSpace: "nowrap" }}>{lang === "he" ? "בדיקה" : "Send test"}</button>
        {tgConnected && <button onClick={() => discMyTgM.mutate()} disabled={discMyTgM.isPending} style={{ ...premSoft(), borderColor: `${C.loss}80`, color: C.loss, padding: "9px 16px", fontSize: 13, whiteSpace: "nowrap" }}>{lang === "he" ? "נתק" : "Disconnect"}</button>}
      </div>
    </>
  ); };

  // ── Security views (folded in from Settings) ────────────────────────────────
  const pwView = () => (
    <>
      <input type="password" value={pwCur} onChange={(e) => setPwCur(e.target.value)} placeholder={lang === "he" ? "סיסמה נוכחית" : "Current password"} style={{ ...inp, marginBottom: 6 }} />
      <div style={{ display: "flex", gap: 6 }}>
        <input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} placeholder={lang === "he" ? "סיסמה חדשה (6+)" : "New password (6+)"} style={inp} />
        <button onClick={() => pwM.mutate()} disabled={pwM.isPending || !pwCur || pwNew.length < 6} className="gbtn ptile" style={btn(true)}><Check size={14} /></button>
      </div>
    </>
  );

  const protView = () => (
    <>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>{lang === "he" ? "קוד אישי משלך (לא משותף) שמגן על פעולות רגישות." : "Your own private code (not shared) that guards sensitive actions."}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        {protOn && (<div><div style={lbl}>{lang === "he" ? "קוד נוכחי" : "Current code"}</div><input type="password" value={protCur} onChange={(e) => setProtCur(e.target.value)} style={{ ...inp, width: 150 }} /></div>)}
        <div><div style={lbl}>{lang === "he" ? "קוד חדש" : "New code"}</div><input type="password" value={protNew} onChange={(e) => setProtNew(e.target.value)} placeholder={lang === "he" ? "לפחות 4 תווים" : "at least 4 chars"} style={{ ...inp, width: 170 }} /></div>
        <button onClick={() => protM.mutate(protNew)} disabled={protM.isPending || !protNew} className="gbtn ptile" style={btn(true)}><Check size={14} /> {lang === "he" ? "שמור" : "Save"}</button>
        {protOn && <button onClick={() => protM.mutate("")} disabled={protM.isPending} style={{ ...premSoft(), color: C.text, padding: "9px 14px", fontSize: 12.5, whiteSpace: "nowrap", cursor: "pointer", fontFamily: "inherit" }}>{lang === "he" ? "ביטול הקוד" : "Remove code"}</button>}
      </div>
    </>
  );

  // ── My Data view (Item 7): export · analytics consent · retention · deletion request.
  const he = lang === "he";
  const privacyCopy = useLegalCopy().get("privacy", he);   // live, Raz-editable privacy copy (Block C)
  const dataView = () => (
    <>
      {/* (a) EXPORT — includes profile, settings, audit + the user's own analytics events */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>
          {he ? "הורדת כל המידע שנשמר עליך: פרופיל, הגדרות, יומן פעילות ואירועי השימוש שלך (בכינוי). מפתחות בורסה אינם נשמרים אצלנו." : "Download everything we hold about you: profile, settings, activity log, and your usage events (pseudonymous). Exchange keys are never held on our servers."}
        </div>
        <button onClick={() => exportM.mutate()} disabled={exportM.isPending} style={{ ...premSoft(), color: C.text, padding: "9px 14px", fontSize: 13, whiteSpace: "nowrap", cursor: exportM.isPending ? "default" : "pointer", opacity: exportM.isPending ? 0.7 : 1, fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 7 }}>
          <Download size={14} /> {exportM.isPending ? (he ? "מכין ייצוא…" : "Preparing export…") : (he ? "הורד את הנתונים שלי" : "Download my data")}
        </button>
      </div>

      {/* (d) ANALYTICS-CONSENT toggle (from Item 3) */}
      <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{he ? "מדידת שימוש (אנליטיקס)" : "Usage analytics"}</div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginTop: 2 }}>{he ? "נתוני שימוש מצטברים בלבד · ללא PII, מפתחות או תוכן אסטרטגיה." : "Aggregate usage only · no PII, keys, or strategy content."}</div>
          </div>
          <button onClick={() => consentM.mutate(!analyticsOn)} disabled={consentM.isPending || consentQ.isLoading}
            aria-pressed={analyticsOn}
            style={{ flexShrink: 0, width: 52, height: 30, borderRadius: 999, border: `1px solid ${analyticsOn ? C.gain : C.line}`, background: analyticsOn ? C.gain : C.surface2, position: "relative", cursor: "pointer", transition: "all .15s" }}>
            <span style={{ position: "absolute", top: 3, insetInlineStart: analyticsOn ? 25 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "inset-inline-start .15s" }} />
          </button>
        </div>
      </div>

      {/* (c) PRIVACY + RETENTION — live, Raz-editable (Block C / Item 1c) */}
      <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{he ? "פרטיות ושמירת מידע" : "Privacy & data retention"}</span>
          {!privacyCopy.approved && <DraftBadge item="privacy" he={he} />}
        </div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.55, whiteSpace: "pre-line" }}>{privacyCopy.text}</div>
      </div>

      {/* (b) DELETION REQUEST — soft (marks account + notifies owners); NOT a hard delete */}
      <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
        <div style={{ fontSize: 13, color: C.loss, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}><UserX size={14} /> {he ? "בקשת מחיקת חשבון" : "Request account deletion"}</div>
        {delReqPending ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, background: `${C.gold}12`, border: `1px solid ${C.gold}55`, borderRadius: 10, padding: "9px 12px" }}>
              {he ? "בקשת המחיקה שלך התקבלה וממתינה לטיפול הצוות. אפשר לבטל אותה עד לביצוע." : "Your deletion request is received and pending the team's action. You can withdraw it until it's actioned."}
            </div>
            <button onClick={() => delWithdrawM.mutate()} disabled={delWithdrawM.isPending} className="ptile" style={{ ...btn(), whiteSpace: "nowrap", alignSelf: "flex-start" }}>
              {delWithdrawM.isPending ? (he ? "מבטל…" : "Withdrawing…") : (he ? "בטל את הבקשה" : "Withdraw request")}
            </button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>{he ? "שליחת בקשה לצוות לסמן את החשבון למחיקה. המידע אינו נמחק מיד — הצוות מטפל בבקשה. תוכל להוריד קודם את הנתונים שלך." : "Files a request for the team to mark your account for deletion. Nothing is erased immediately — the team actions it. You can download your data first."}</div>
            <button onClick={() => { if (confirm(he ? "לשלוח בקשה למחיקת החשבון?" : "Send a request to delete your account?")) delReqM.mutate(); }} disabled={delReqM.isPending}
              className="ptile" style={{ ...btn(), whiteSpace: "nowrap", color: C.loss, borderColor: `${C.loss}66` }}>
              <Trash2 size={14} /> {delReqM.isPending ? (he ? "שולח…" : "Sending…") : (he ? "בקש מחיקה" : "Request deletion")}
            </button>
          </>
        )}
      </div>
    </>
  );

  // ── חשבון grouped sections (Dan's simplification: identity + channels together;
  // security + privacy + data together). No tile row — the חשבון button opens these.
  // "פרופיל ותקשורת": nickname + photo + account basics + ALL channels (Telegram admin,
  // + WhatsApp/Email/SMS/consent/alert-prefs via NotificationSettings).
  const profileCommsView = () => (
    <>
      {profileView()}
      <div style={sepTop}>{accountView()}</div>
      {isAdmin() && <div style={sepTop}>{subHead(lang === "he" ? "טלגרם (מנהל)" : "Telegram (admin)", Send)}{telegramView()}</div>}
      <div style={sepTop}>{subHead(lang === "he" ? "ערוצים והתראות" : "Channels & notifications", Bell)}{notifyView()}</div>
    </>
  );

  // "אבטחה ופרטיות": password + 2FA + protection code + privacy link + GDPR data (tucked in).
  const securityPrivacyView = () => (
    <>
      <div>{subHead(lang === "he" ? "שינוי סיסמה" : "Change password", KeyRound)}{pwView()}</div>
      <div style={sepTop}>{subHead(lang === "he" ? "אימות דו-שלבי" : "Two-factor", ShieldCheck)}<TotpCard /><TwoFactorCard /></div>
      <div style={sepTop}>{subHead(lang === "he" ? "קוד הגנה אישי" : "Personal protection code", Lock)}{protView()}</div>
      <div style={sepTop}>{subHead(lang === "he" ? "פרטיות" : "Privacy", Lock)}
        {ownerLink(lang === "he" ? "הגדרות פרטיות" : "Privacy settings", ShieldCheck, () => nav("/privacy"))}
      </div>
      <div style={sepTop}>{subHead(lang === "he" ? "נתונים (GDPR)" : "Data (GDPR)", Download)}{dataView()}</div>
    </>
  );

  const fathers: HubFather[] = [
    // ONE "חשבון" section, two clean grouped children (Dan): identity+channels, and
    // security+privacy+data. No tile row; friends/groups removed (they belong with chat).
    { key: "account", label: lang === "he" ? "חשבון" : "Account", Icon: SettingsIcon, tour: "account-settings",
      children: [
        { key: "profile", label: lang === "he" ? "פרופיל ותקשורת" : "Profile & channels", Icon: UserRound, render: profileCommsView },
        { key: "security", label: lang === "he" ? "אבטחה ופרטיות" : "Security & privacy", Icon: ShieldCheck, render: securityPrivacyView },
      ] },
  ];

  // ── Owner deep-link row helper + views (Step 4). To avoid a chunk burst we do NOT
  // embed these full screens inline — we navigate to their EXISTING routes (which keep
  // working standalone). Each row/section is role-gated by the caller below.
  // MODERN tile treatment (Dan #UCW9: the old flat surface2 rows read as legacy) — reuse the shared
  // premSoft() gold-framed tile (skin-adaptive gradient surface + 1.5px gold rim + soft depth), the
  // same look as the "נהל / Manage" buttons above and the ScreenHero tiles. Icon sits in a small
  // accent chip; label bolder. Behaviour is unchanged — still a deep-link to the existing route.
  const ownerLink = (label: string, Icon: React.FC<any>, onClick: () => void) => (
    <button key={label} onClick={onClick} className="tap44"
      style={{ ...premSoft(), display: "flex", alignItems: "center", gap: 11, width: "100%", boxSizing: "border-box", minHeight: 50, textAlign: "start",
        color: C.text, padding: "12px 14px", fontFamily: "inherit", marginBottom: 10 }}>
      <span style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: C.goldDim, border: `1px solid ${C.gold}55` }}>
        <Icon size={16} color={C.gold} />
      </span>
      <span style={{ flex: 1, fontSize: 14.5, fontWeight: 800, color: C.text }}>{label}</span>
      {lang === "he" ? <ChevronLeft size={17} color={C.gold} style={{ flexShrink: 0 }} /> : <ChevronRight size={17} color={C.gold} style={{ flexShrink: 0 }} />}
    </button>
  );

  // Owners-only section: Owners Portal + Requests portal + owner-only Finance (a gated
  // tab inside /owners, reached via ?tab=finance which Owners honours only for owners).
  const ownersView = () => (
    <>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>{lang === "he" ? "אזורי בעלים — פורטל הבעלים, פורטל הפניות והכספים." : "Owner areas — Owners Portal, the requests portal and finance."}</div>
      {ownerLink(lang === "he" ? "פורטל בעלים" : "Owners Portal", Gem, () => nav("/owners"))}
      {ownerLink(lang === "he" ? "פורטל פניות" : "Requests portal", Inbox, () => nav("/requests"))}
      {ownerLink(lang === "he" ? "כספים (בעלים בלבד)" : "Finance (owners only)", Coins, () => nav("/owners?tab=finance"))}
    </>
  );

  // Legal section: the Legal Portal (gated to a legal editor OR an owner — keeps Raz's access).
  // The legal-text editor is now the portal's "עריכה" tab, so this points at the portal.
  const legalView = () => (
    <>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>{lang === "he" ? "פורטל משפטי — צ'אט, סקשנים, עריכת הטקסטים, משימות ודוח (חי)." : "Legal Portal — chat, sections, legal-text editing, tasks & report (live)."}</div>
      {ownerLink(lang === "he" ? "פורטל משפטי" : "Legal Portal", Scale, () => nav("/legal-portal"))}
    </>
  );

  // Step 3 · role-gated Management: admins/owners get the FULL existing Admin panel
  // folded into /me (reusing Admin's existing lazy chunk — no new chunk). A regular
  // user never gets this father, so the ניהול tile below is never rendered for them.
  // Admin's own internal sub-gating (main-admin-only children, maintenance OFF, etc.)
  // is untouched — we just embed the whole component.
  // Step 4 nests the owner areas as EXTRA children (chips) inside this same father, so
  // the top actions row stays clean (no new top-row tiles).
  const canManage = isAdminOrOwner();
  if (canManage) {
    const mgmtKids: HubChild[] = [
      { key: "panel", label: lang === "he" ? "לוח ניהול" : "Admin panel", Icon: Cog,
        render: () => (
          <Suspense fallback={<div style={{ color: C.muted, fontSize: 13, padding: 12 }}>…</div>}>
            <AdminPanel />
          </Suspense>
        ) },
    ];
    // Owners only (Dan/Rafi/Yoav) — Owners Portal + Requests + owner-only Finance.
    if (isOwner()) mgmtKids.push({ key: "owners", label: lang === "he" ? "בעלים" : "Owners", Icon: Gem, render: ownersView });
    // Legal editor (Raz) OR an owner — the Legal Console.
    if (isLegalEditor() || isOwner()) mgmtKids.push({ key: "legal", label: lang === "he" ? "משפטי" : "Legal", Icon: Scale, render: legalView });
    // Dan: surface "נתונים" (GDPR export/delete) in management too, for admins.
    mgmtKids.push({ key: "data", label: lang === "he" ? "נתונים" : "Data", Icon: Download, render: dataView });
    fathers.push({ key: "management", label: lang === "he" ? "ניהול" : "Management", Icon: Cog, children: mgmtKids });
  }

  // Employee mini-panel — every employee gets a "העובד שלי" section (self-edit details,
  // view their payments, join the bonus program). Non-employees never get this father.
  if (isEmployee) {
    fathers.push({ key: "employment", label: lang === "he" ? "העובד שלי" : "My employment", Icon: BadgeCheck,
      children: [{ key: "card", label: lang === "he" ? "כרטיס העובד" : "Employee card", Icon: BadgeCheck, render: () => <EmployeeMiniPanel /> }] });
  }

  return (
    <>
      <TourLauncher screen="account" />
      <HubScreen
        ns="account"
        initial={initialSec}
        title={lang === "he" ? "החשבון שלי" : "My Account"}
        header={
          <FramedTitle
            text={lang === "he" ? "החשבון שלי" : "My Account"}
            subtitle={lang === "he" ? "פרופיל · אבטחה · ניהול" : "Profile · Security · Management"}
          />
        }
        topCard={<HomeTop />}
        banner={<>
          {err && <div style={errBox}>{err}</div>}
          {msg && <div style={{ background: `${C.gain}1f`, border: `1px solid ${C.gain}`, color: C.gain, borderRadius: 9, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>{msg}</div>}
          {/* מסלולים demoted to a subtle chip near the portfolio bar (not a big tile). */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <button onClick={() => nav("/plans")} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.surface2, border: `1px solid ${C.line}`, color: C.muted, borderRadius: 999, padding: "5px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              <Crown size={13} color={C.gold} /> {lang === "he" ? "מסלול ומנוי" : "Plan & subscription"}
            </button>
          </div>
        </>}
        fathers={fathers}
        renderNav={(open) => {
          const he = lang === "he";
          // Dan's final IA: HERO = portfolio bar + just TWO big buttons, NO tile row.
          // admin/owner → [ ניהול (center/primary) | חשבון ]; regular user → [ חשבון ].
          // Everything else lives inside חשבון's two grouped child sections.
          const acctBtn = { label: he ? "חשבון" : "Account", sub: he ? "כל הפרטים שלך" : "all your info", Icon: SettingsIcon, onClick: () => open("account") };
          const mgmtBtn = { label: he ? "ניהול" : "Management", sub: he ? "בקרת מערכת" : "system controls", Icon: Cog, onClick: () => open("management") };
          // Employees get a related tile to their own employment card.
          const related = isEmployee ? [{ key: "employment", label: he ? "העובד שלי" : "My employment", Icon: BadgeCheck, onClick: () => open("employment") }] : [];
          return (
            <ScreenHero
              related={related}
              primary={canManage ? mgmtBtn : acctBtn}
              secondary={canManage ? acctBtn : undefined}
            />
          );
        }}
      />
    </>
  );
}
