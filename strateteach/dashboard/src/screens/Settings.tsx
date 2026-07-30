import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, KeyRound, ShieldCheck, Send, Download, UserX, Users, Settings as Cog, Lock, Diamond } from "lucide-react";
import { api, saveToken, isAdminOrOwner } from "../app/api";
import { useI18n } from "../i18n";
import { C } from "../theme";
import { Empty, Field, input, btn, errBox, okBox, Spin, PasswordInput, premSoft } from "../ui";
import { EXPLAIN } from "../lib/explain";
import { NotificationSettings, TwoFactorCard, TotpCard } from "../components/Notifications";
import HubScreen, { type HubFather } from "../components/HubScreen";
import { ScreenHeader } from "../components/ScreenHeader";
import HomeTop from "../components/HomeTop";

const STR = {
  he: {
    settings: "הגדרות", changePw: "שינוי סיסמה", current: "סיסמה נוכחית", newPw: "סיסמה חדשה", save: "שמור",
    users: "ניהול משתמשים", adminOnly: "אזור מנהל בלבד — רק מנהל יכול לנהל משתמשים.", addUser: "הוסף משתמש",
    username: "שם משתמש", password: "סיסמה", role: "תפקיד", user: "משתמש", admin: "מנהל", created: "נוצר",
    actions: "פעולות", resetLink: "קישור איפוס", unlock: "שחרר נעילה", del: "מחק", noUsers: "אין משתמשים",
    audit: "יומן ביקורת", when: "מתי", actor: "מבצע", action: "פעולה", target: "יעד", ip: "IP", noAudit: "אין רשומות",
    copyHint: "העתק את הקישור ושלח למשתמש (תקף 24 שעות):", copied: "הועתק", saved: "נשמר",
    confirmDel: (u: string) => `למחוק את ${u}?`,
    email: "אימייל", optional: "(אופציונלי)", sendTest: "שלח מייל בדיקה", testTo: "אימייל לבדיקה",
    emailedTo: (e: string) => `נשלח מייל איפוס ל-${e}`, smtpHint: "דורש הגדרת SMTP בשרת",
    connected: "משתמשים מחוברים", online: "מחובר", since: "מאז", duration: "משך", lastSeen: "פעילות אחרונה", noOne: "אין משתמשים מחוברים",
    yourData: "הנתונים שלך (GDPR)", downloadData: "הורד את הנתונים שלי", deleteAccount: "מחיקת חשבון",
    deleteWarn: "פעולה בלתי הפיכה — החשבון שלך יימחק. הזן סיסמה לאישור.", confirmPw: "סיסמה לאישור", deleteBtn: "מחק לצמיתות",
    nickname: "כינוי", nicknameHint: "השם שלך בצ'אט (ברירת מחדל: שם המשתמש)", nicknamePh: "איך שיקראו לך",
    sectionAccess: "גישת משתמשים לאזורים", sectionAccessHint: "בחרו משתמש ואז אילו אזורים הוא רשאי לראות. אזור חסום מוסתר ממנו (אתם תמיד רואים הכול).", allowed: "מותר", blocked: "חסום", pickUser: "בחרו משתמש", choose: "בחרו…",
    editScreens: "מסכים", screensFor: "אילו מסכים רואה", closeEdit: "סגור",
    protection: "קוד הגנה אישי", protHint: "קוד אישי משלך (לא משותף) שמגן על פעולות רגישות. כל משתמש מגדיר את שלו בהגדרות.",
    protOn: "פעיל", protOff: "כבוי", protCurrent: "קוד נוכחי", protNew: "קוד חדש", protPh: "לפחות 4 תווים", protClear: "ביטול הקוד",
    fProfile: "פרופיל", fSecurity: "אבטחה", fData: "נתונים", fAdmin: "ניהול",
    notifications: "התראות", twofa: "אימות דו-שלבי", signup: "בקשות הרשמה", broadcast: "שידור", waRecipient: "נמען וואטסאפ",
    adminPanel: "פאנל ניהול", openAdmin: "פתח את פאנל הניהול →",
    adminPanelHint: "כל ניהול המנהל מרוכז כעת בפאנל הניהול — משתמשים והרשאות, גישה לאזורים, יומן ביקורת, בקשות הרשמה, שידור ונמען וואטסאפ — הכל במקום אחד.",
  },
  en: {
    settings: "Settings", changePw: "Change password", current: "Current password", newPw: "New password", save: "Save",
    users: "User management", adminOnly: "Admin area — only an admin can manage users.", addUser: "Add user",
    username: "Username", password: "Password", role: "Role", user: "user", admin: "admin", created: "Created",
    actions: "Actions", resetLink: "Reset link", unlock: "Unlock", del: "Delete", noUsers: "No users",
    audit: "Audit log", when: "When", actor: "Actor", action: "Action", target: "Target", ip: "IP", noAudit: "No entries",
    copyHint: "Copy this link and send it to the user (valid 24h):", copied: "Copied", saved: "Saved",
    confirmDel: (u: string) => `Delete ${u}?`,
    email: "Email", optional: "(optional)", sendTest: "Send test email", testTo: "Test recipient",
    emailedTo: (e: string) => `Reset email sent to ${e}`, smtpHint: "Requires SMTP configured on the server",
    connected: "Connected users", online: "online", since: "Since", duration: "Duration", lastSeen: "Last seen", noOne: "No one connected",
    yourData: "Your data (GDPR)", downloadData: "Download my data", deleteAccount: "Delete account",
    deleteWarn: "Irreversible — your account will be deleted. Enter your password to confirm.", confirmPw: "Password to confirm", deleteBtn: "Delete permanently",
    nickname: "Nickname", nicknameHint: "Your name in chat (default: your username)", nicknamePh: "What people see",
    sectionAccess: "User section access", sectionAccessHint: "Pick a user, then which sections they may see. A blocked section is hidden from that user (you always see everything).", allowed: "allowed", blocked: "blocked", pickUser: "Pick a user", choose: "Choose…",
    editScreens: "Screens", screensFor: "Screens visible to", closeEdit: "Close",
    protection: "Personal protection code", protHint: "Your own private code (not shared) that guards sensitive actions. Each user sets their own here.",
    protOn: "active", protOff: "off", protCurrent: "Current code", protNew: "New code", protPh: "at least 4 chars", protClear: "Remove code",
    fProfile: "Profile", fSecurity: "Security", fData: "Data", fAdmin: "Admin",
    notifications: "Notifications", twofa: "Two-factor", signup: "Signup requests", broadcast: "Broadcast", waRecipient: "WhatsApp recipient",
    adminPanel: "Admin panel", openAdmin: "Open the Admin panel →",
    adminPanelHint: "All admin management now lives in the Admin panel — users & roles, section access, audit log, signup requests, broadcast, and the WhatsApp recipient — in one place.",
  },
};

export default function Settings() {
  const { lang } = useI18n();
  const t = STR[lang];
  const qc = useQueryClient();
  const nav = useNavigate();
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const fail = (e: any) => { setOk(""); setErr(e?.message || String(e)); };
  const done = (m: string) => { setErr(""); setOk(m); };

  // ── Premium control finishes (Home design language) ────────────────────────
  // soft = quiet SECONDARY button (skin-accent surface + accent border + soft depth).
  // whiteSpace:nowrap keeps multi-word EN/HE labels from breaking. (The admin-only
  // iconChip/toggleTile helpers moved to the /admin panel with their views.)
  const soft: React.CSSProperties = { ...premSoft(), color: C.text, display: "inline-flex", alignItems: "center",
    justifyContent: "center", gap: 7, padding: "9px 14px", fontSize: 13, fontFamily: "inherit", whiteSpace: "nowrap" };

  // change own password
  const [cur, setCur] = useState(""); const [nw, setNw] = useState("");
  const pwM = useMutation({ mutationFn: () => api.changePassword(cur, nw), onSuccess: () => { setCur(""); setNw(""); done(t.saved); }, onError: fail });

  // nickname (used as your name in chat)
  const [nick, setNick] = useState(""); const [nickLoaded, setNickLoaded] = useState(false);
  const profileQ = useQuery({ queryKey: ["myProfile"], queryFn: () => api.myProfile(), retry: false });
  useEffect(() => { if (profileQ.data && !nickLoaded) { setNick((profileQ.data as any).nickname || ""); setNickLoaded(true); } }, [profileQ.data]); // eslint-disable-line
  const nickM = useMutation({ mutationFn: () => api.setNickname(nick.trim()), onSuccess: () => { done(t.saved); qc.invalidateQueries({ queryKey: ["myProfile"] }); qc.invalidateQueries({ queryKey: ["chatContacts"] }); }, onError: fail });

  // per-user protection code (each user sets their own; gates sensitive actions)
  const [protCur, setProtCur] = useState(""); const [protNew, setProtNew] = useState("");
  const protQ = useQuery({ queryKey: ["protection"], queryFn: () => api.protectionStatus(), retry: false });
  const protSet = (api as any).setProtection;
  const protM = useMutation({ mutationFn: (code: string) => protSet(code, protCur), onSuccess: () => { setProtCur(""); setProtNew(""); done(t.saved); qc.invalidateQueries({ queryKey: ["protection"] }); }, onError: fail });
  const protOn = !!(protQ.data as any)?.set;

  // GDPR self-service: export + delete own account
  const [delPw, setDelPw] = useState("");
  const exportM = useMutation({
    mutationFn: () => api.exportMyData(),
    onSuccess: (data: any) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "algo770-my-data.json"; a.click();
      URL.revokeObjectURL(url); done(t.saved);
    }, onError: fail,
  });
  const delMeM = useMutation({
    mutationFn: () => api.deleteMyAccount(delPw),
    onSuccess: () => { saveToken(null); window.location.href = "/"; }, onError: fail,
  });

  // Admin MANAGEMENT (user CRUD, section access, audit, sessions, signup, broadcast,
  // WhatsApp recipient) now lives ENTIRELY in the /admin panel (one place). Settings only
  // keeps a link to it. `isAdmin` (main-admin) gates showing that link + the backend
  // endpoints stay require_main_admin.
  const isAdmin = isAdminOrOwner();

  // ── child screens ──────────────────────────────────────────────────────────
  const nickView = () => (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
      <Field label={t.nicknameHint}>
        <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={32} placeholder={t.nicknamePh} style={{ ...input, width: 240 }} />
      </Field>
      <button onClick={() => { setErr(""); nickM.mutate(); }} disabled={nickM.isPending} className="gbtn ptile" style={btn(true)}>
        {nickM.isPending ? <Loader2 size={14} className="spin" /> : <Users size={14} />} {t.save}
      </button>
    </div>
  );

  const protView = () => (
    <>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 10 }}>{t.protHint}</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
        {protOn && <Field label={t.protCurrent}><PasswordInput value={protCur} onChange={(e) => setProtCur(e.target.value)} style={{ ...input, width: 160 }} /></Field>}
        <Field label={t.protNew}><PasswordInput value={protNew} onChange={(e) => setProtNew(e.target.value)} placeholder={t.protPh} style={{ ...input, width: 180 }} /></Field>
        <button onClick={() => { setErr(""); protM.mutate(protNew); }} disabled={protM.isPending || !protNew} className="gbtn ptile" style={btn(true)}>
          {protM.isPending ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />} {t.save}
        </button>
        {protOn && <button onClick={() => { setErr(""); protM.mutate(""); }} disabled={protM.isPending} style={soft}>{t.protClear}</button>}
      </div>
    </>
  );

  const pwView = () => (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
      <Field label={t.current}><PasswordInput value={cur} onChange={(e) => setCur(e.target.value)} style={{ ...input, width: 200 }} /></Field>
      <Field label={t.newPw}><PasswordInput value={nw} onChange={(e) => setNw(e.target.value)} style={{ ...input, width: 200 }} /></Field>
      <button onClick={() => { setErr(""); pwM.mutate(); }} disabled={pwM.isPending || !cur || !nw} className="gbtn ptile" style={btn(true)}>
        {pwM.isPending ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />} {t.save}
      </button>
    </div>
  );

  const dataView = () => (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <button onClick={() => { setErr(""); exportM.mutate(); }} disabled={exportM.isPending} style={soft}>
          {exportM.isPending ? <Loader2 size={14} className="spin" /> : <Download size={14} />} {t.downloadData}
        </button>
      </div>
      <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
        <div style={{ fontSize: 13, color: C.loss, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}><UserX size={14} /> {t.deleteAccount}</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>{t.deleteWarn}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <PasswordInput value={delPw} onChange={(e) => setDelPw(e.target.value)} placeholder={t.confirmPw} style={{ ...input, width: 200 }} />
          <button onClick={() => { setErr(""); if (confirm(t.deleteWarn)) delMeM.mutate(); }} disabled={delMeM.isPending || !delPw}
            className="gbtn gbtn-loss ptile" style={{ ...btn(), whiteSpace: "nowrap" }}>
            {delMeM.isPending ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} {t.deleteBtn}
          </button>
        </div>
      </div>
    </>
  );

  // Admin management moved to the /admin panel — Settings shows a single link there.
  const adminLinkView = () => (
    <div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 14, lineHeight: 1.6 }}>{t.adminPanelHint}</div>
      <button onClick={() => nav("/admin")} className="gbtn ptile" style={btn(true)}>
        <Cog size={15} /> {t.openAdmin}
      </button>
    </div>
  );

  const fathers: HubFather[] = [
    { key: "profile", label: t.fProfile, Icon: Users, children: [
      { key: "nick", label: t.nickname, Icon: Users, render: nickView },
      { key: "notify", label: t.notifications, Icon: Send, render: () => <NotificationSettings /> },
    ] },
    { key: "security", label: t.fSecurity, Icon: ShieldCheck, children: [
      { key: "twofa", label: t.twofa, Icon: ShieldCheck, render: () => <><TotpCard /><TwoFactorCard /></> },
      { key: "prot", label: t.protection, Icon: Lock, render: protView },
      { key: "pw", label: t.changePw, Icon: KeyRound, render: pwView },
    ] },
    { key: "data", label: t.fData, Icon: Download, children: [
      { key: "data", label: t.yourData, Icon: Download, render: dataView },
    ] },
  ];
  // ONE place for admin management: the /admin panel. Settings just links to it.
  if (isAdmin) fathers.push({ key: "admin", label: t.fAdmin, Icon: Cog, children: [
    { key: "adminlink", label: t.adminPanel, Icon: Cog, render: adminLinkView },
  ] });

  return (
    <>
      <HubScreen
        ns="settings"
        title={t.settings}
        header={
          <ScreenHeader
            hub
            icon={<Diamond size={20} color={C.gold} fill={C.gold} />}
            title={t.settings}
            info={EXPLAIN.settings[lang]}
            subtitle={lang === "he" ? "פרופיל, אבטחה והעדפות" : "Profile, security & preferences"}
          />
        }
        topCard={<HomeTop />}
        banner={<>{err && <div style={errBox}>{err}</div>}{ok && <div style={okBox}>{ok}</div>}</>}
        fathers={fathers}
      />
      <Spin />
    </>
  );
}

