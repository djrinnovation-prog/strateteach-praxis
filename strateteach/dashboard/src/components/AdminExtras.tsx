import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck, Mail, Send, Users, ScrollText, Megaphone, UserCheck, Radio, Wifi, ChevronDown, ChevronRight, UserCog } from "lucide-react";
import { api, isAdminOrOwner } from "../app/api";
import { useI18n } from "../i18n";
import { C, MONO, onAccent } from "../theme";
import { Empty, Field, input, btn, errBox, okBox, premSoft } from "../ui";
import { SignupRequestsPanel, BroadcastPanel, WhatsAppRecipientPanel } from "./Notifications";
import CreateUserForm from "./CreateUserForm";
import UserManageModal, { type ManageUser } from "./UserManageModal";

// ── AdminExtras — the MAIN-ADMIN management panels that used to live in the Settings
// screen's "Admin" group, now consolidated into the /admin panel so admin management is
// ONE place (Dan: "the whole admin management panel should be one place"). Content is
// unchanged; it's simply mounted here instead of Settings. Main-admin-gated in the UI to
// match the backend (require_main_admin); secondary admins never reach it.
const SECTIONS = [
  { p: "/scanner", k: "scanner" }, { p: "/backtests", k: "backtests" }, { p: "/overview", k: "dashboard" },
  { p: "/strategy", k: "strategy" }, { p: "/exchange", k: "exchange" }, { p: "/profit", k: "profit" },
  { p: "/analytics", k: "analytics" }, { p: "/chat", k: "chat" }, { p: "/telegram", k: "telegram" }, { p: "/university", k: "university" },
];

const L = {
  he: {
    users: "ניהול משתמשים", username: "שם משתמש", role: "תפקיד", user: "משתמש", admin: "מנהל", created: "נוצר",
    actions: "פעולות", resetLink: "קישור איפוס", unlock: "שחרר נעילה", del: "מחק", noUsers: "אין משתמשים", save: "שמור", saved: "נשמר",
    resetPin: "איפוס קוד PIN", pinCleared: "קוד ה-PIN של המשתמש נוקה — הוא יכול להגדיר קוד חדש",
    resetPinConfirm: (u: string) => `לאפס את קוד ה-PIN הלייב של ${u}? הקוד שלו יימחק והוא יגדיר קוד חדש (למשל כדי לשחזר את יואב).`,
    audit: "יומן ביקורת", when: "מתי", actor: "מבצע", action: "פעולה", target: "יעד", ip: "IP", noAudit: "אין רשומות",
    copyHint: "העתק את הקישור ושלח למשתמש (תקף 24 שעות):", copied: "הועתק",
    confirmDel: (u: string) => `למחוק את ${u}?`, email: "אימייל", phone: "טלפון", savePhone: "שמור טלפון", sendTest: "שלח מייל בדיקה", testTo: "אימייל לבדיקה",
    emailedTo: (e: string) => `נשלח מייל איפוס ל-${e}`, smtpHint: "דורש הגדרת SMTP בשרת",
    connected: "משתמשים מחוברים", online: "מחובר", since: "מאז", duration: "משך", lastSeen: "פעילות אחרונה", noOne: "אין משתמשים מחוברים",
    sectionAccess: "גישת משתמשים לאזורים", sectionAccessHint: "בחרו משתמש ואז אילו אזורים הוא רשאי לראות. אזור חסום מוסתר ממנו (אתם תמיד רואים הכול).",
    allowed: "מותר", blocked: "חסום", pickUser: "בחרו משתמש", choose: "בחרו…", editScreens: "מסכים", screensFor: "אילו מסכים רואה", closeEdit: "סגור",
    signup: "בקשות הרשמה", broadcast: "שידור", waRecipient: "נמען וואטסאפ", addUser: "הוסף משתמש",
    intro: "כל ניהול המנהל במקום אחד. פעולות רגישות מוגנות בשרת (מנהל ראשי בלבד).",
    manage: "ניהול", rowHint: "לחצו על משתמש כדי לפתוח את פאנל הניהול שלו — תפקיד, אימייל, נייד, איפוס סיסמה/קוד PIN, שחרור נעילה ומחיקה.",
  },
  en: {
    users: "User management", username: "Username", role: "Role", user: "user", admin: "admin", created: "Created",
    actions: "Actions", resetLink: "Reset link", unlock: "Unlock", del: "Delete", noUsers: "No users", save: "Save", saved: "Saved",
    resetPin: "Reset PIN", pinCleared: "User's PIN cleared — they can set a fresh one",
    resetPinConfirm: (u: string) => `Reset ${u}'s live PIN? Their code is cleared and they set a fresh one (e.g. to recover Yoav).`,
    audit: "Audit log", when: "When", actor: "Actor", action: "Action", target: "Target", ip: "IP", noAudit: "No entries",
    copyHint: "Copy this link and send it to the user (valid 24h):", copied: "Copied",
    confirmDel: (u: string) => `Delete ${u}?`, email: "Email", phone: "Phone", savePhone: "Save phone", sendTest: "Send test email", testTo: "Test recipient",
    emailedTo: (e: string) => `Reset email sent to ${e}`, smtpHint: "Requires SMTP configured on the server",
    connected: "Connected users", online: "online", since: "Since", duration: "Duration", lastSeen: "Last seen", noOne: "No one connected",
    sectionAccess: "User section access", sectionAccessHint: "Pick a user, then which sections they may see. A blocked section is hidden from that user (you always see everything).",
    allowed: "allowed", blocked: "blocked", pickUser: "Pick a user", choose: "Choose…", editScreens: "Screens", screensFor: "Screens visible to", closeEdit: "Close",
    signup: "Signup requests", broadcast: "Broadcast", waRecipient: "WhatsApp recipient", addUser: "Add user",
    intro: "All admin management in one place. Sensitive actions are guarded server-side (main admin only).",
    manage: "Manage", rowHint: "Click a user to open their management panel — role, email, mobile, reset password/PIN, unlock and delete.",
  },
} as const;

const th = (rtl: boolean): React.CSSProperties => ({ padding: "8px 10px", borderBottom: `1px solid ${C.line}`, textAlign: rtl ? "right" : "left", color: C.muted, fontWeight: 500 });
const td = (rtl: boolean): React.CSSProperties => ({ padding: "8px 10px", borderBottom: `1px solid ${C.line}`, textAlign: rtl ? "right" : "left" });
const actionColor = (a: string) => (a?.includes("fail") || a?.includes("lock") || a?.includes("delete") ? C.loss : a?.includes("success") || a?.includes("create") ? C.gain : C.muted);
const dur = (since: string) => {
  if (!since) return "—";
  const ms = Date.now() - new Date(since).getTime(); const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};
const rel = (ts: string) => {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s`; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

// Single-open accordion section (compact header · chevron), like the /admin AdminAccess pattern.
function Section({ id, open, setOpen, icon, title, children }: { id: string; open: string; setOpen: (v: string) => void; icon: React.ReactNode; title: string; rtl?: boolean; children: React.ReactNode }) {
  const isOpen = open === id;
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden", marginBottom: 10 }}>
      <button onClick={() => setOpen(isOpen ? "" : id)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "12px 14px", color: C.text, textAlign: "start" }}>
        {icon}
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        {isOpen ? <ChevronDown size={16} color={C.muted} /> : <ChevronRight size={16} color={C.muted} />}
      </button>
      {isOpen && <div style={{ padding: "0 14px 14px", borderTop: `1px solid ${C.line}` }}><div style={{ paddingTop: 12 }}>{children}</div></div>}
    </div>
  );
}

export default function AdminExtras() {
  const { lang, rtl, t: navT } = useI18n();
  const t = L[lang];
  const qc = useQueryClient();
  const [err, setErr] = useState(""); const [ok, setOk] = useState("");
  const [open, setOpen] = useState<string>("users");
  const fail = (e: any) => { setOk(""); setErr(e?.message || String(e)); };
  const done = (m: string) => { setErr(""); setOk(m); };

  const usersQ = useQuery({ queryKey: ["users"], queryFn: () => api.listUsers(), retry: false });
  const users = (usersQ.data ?? []) as any[];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["users"] });
  const [testTo, setTestTo] = useState("");
  const testM = useMutation({ mutationFn: () => api.emailTest(testTo.trim()), onSuccess: (r: any) => done(r?.message || t.saved), onError: fail });
  // The reusable per-user MANAGEMENT panel: clicking any user row opens this modal,
  // which gathers ALL that user's actions (role/email/mobile/reset-pw/reset-PIN/
  // unlock/reset-link/delete), each clearly labeled. Replaces the old cramped
  // icon-only actions row. Every action keeps its existing endpoint + backend gates.
  const [manageUser, setManageUser] = useState<ManageUser | null>(null);

  const auditQ = useQuery({ queryKey: ["audit"], queryFn: () => api.auditLog(100), retry: false });
  const audit = (auditQ.data ?? []) as any[];
  const sessionsQ = useQuery({ queryKey: ["sessions"], queryFn: () => api.listSessions(), retry: false, refetchInterval: 15000 });
  const sessions = (sessionsQ.data ?? []) as any[];

  const [accessUser, setAccessUser] = useState<string>("");
  const [userLocked, setUserLocked] = useState<string[]>([]);
  const loadAccess = (u: string) => {
    setAccessUser(u);
    if (!u) { setUserLocked([]); return; }
    api.userAccess(u).then((r: any) => setUserLocked(r.locked || [])).catch(() => setUserLocked([]));
  };
  const accessM = useMutation({ mutationFn: () => api.setUserAccess(accessUser, userLocked), onSuccess: () => { done(t.saved); qc.invalidateQueries({ queryKey: ["sectionAccess"] }); }, onError: fail });
  const toggleLock = (p: string) => setUserLocked((s) => s.includes(p) ? s.filter((x) => x !== p) : [...s, p]);

  const soft: React.CSSProperties = { ...premSoft(), color: C.text, display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", padding: "8px 12px", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer" };
  const toggleTile = (blocked: boolean, bg: string): React.CSSProperties => ({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: bg, border: `1px solid ${blocked ? `${C.loss}55` : C.line}`, borderRadius: 9, padding: "8px 11px", fontSize: 13, fontWeight: 700, color: C.text, cursor: "pointer", fontFamily: "inherit", textAlign: "start" });
  // Small colored avatar for a user row (initial), matching the design language.
  const AV = ["#F7931A", "#7CC04E", "#36C5F0", "#E8438F", "#FBC02D", "#2DD4BF", "#A78BFA", "#FB7185"];
  const colorFor = (s: string) => AV[Math.abs([...(s || "?")].reduce((a, c) => a + c.charCodeAt(0), 0)) % AV.length];

  // UI gate mirrors the backend (require_main_admin). Secondary admins can open /admin but
  // never these panels — same as when they lived in Settings.
  if (!isAdminOrOwner()) {
    return <div style={{ fontSize: 13, color: C.muted, padding: "10px 2px" }}>{lang === "he" ? "אזור מנהל ראשי בלבד." : "Main-admin only area."}</div>;
  }

  return (
    <div>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>{t.intro}</div>
      {err && <div style={errBox}>{err}</div>}
      {ok && <div style={okBox}>{ok}</div>}

      {/* User management: create · test-email · reset link · roles · per-user screen access */}
      <Section id="users" open={open} setOpen={setOpen} rtl={rtl} icon={<Users size={16} color={C.gold} />} title={t.users}>
        <div style={{ marginBottom: 12 }}><CreateUserForm /></div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginBottom: 14, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
          <Field label={<span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Mail size={12} /> {t.testTo}</span> as any}>
            <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" style={{ ...input, width: 220 }} />
          </Field>
          <button onClick={() => { setErr(""); testM.mutate(); }} disabled={testM.isPending || !testTo} style={soft}>
            {testM.isPending ? <Loader2 size={14} className="spin" /> : <Send size={14} />} {t.sendTest}
          </button>
          <span style={{ fontSize: 11, color: C.faint, alignSelf: "center" }}>{t.smtpHint}</span>
        </div>

        {usersQ.isLoading ? <Empty><Loader2 size={16} className="spin" /></Empty>
          : users.length === 0 ? <Empty>{t.noUsers}</Empty> : (
          <>
            <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 8 }}>{t.rowHint}</div>
            <div style={{ maxHeight: "55svh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
              {users.map((u) => (
                <button key={u.username} onClick={() => setManageUser({ username: u.username, role: u.role, email: u.email, phone: u.phone })}
                  className="tap44"
                  style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", boxSizing: "border-box", textAlign: "start", cursor: "pointer",
                    background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 12px", fontFamily: "inherit" }}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: colorFor(u.username), color: onAccent(colorFor(u.username)), fontWeight: 800, fontSize: 15 }}>{(u.username || "#")[0].toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.username}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 7px", borderRadius: 999, whiteSpace: "nowrap",
                        background: u.role === "admin" ? `${C.gold}22` : C.surface, color: u.role === "admin" ? C.gold : C.muted, border: `1px solid ${u.role === "admin" ? `${C.gold}55` : C.line}` }}>{u.role === "admin" ? t.admin : t.user}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                      {u.email || (lang === "he" ? "ללא אימייל" : "no email")}{u.phone ? ` · ${u.phone}` : ""}
                    </div>
                  </div>
                  <span style={{ ...soft, flexShrink: 0, pointerEvents: "none", background: "var(--btn-bg)", color: "var(--btn-ink)", border: "none" }}>
                    <UserCog size={14} /> {t.manage}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </Section>

      {/* Per-user section access (pick a user → which screens they may see) */}
      <Section id="access" open={open} setOpen={setOpen} rtl={rtl} icon={<ShieldCheck size={16} color={C.gold} />} title={t.sectionAccess}>
        <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12 }}>{t.sectionAccessHint}</div>
        <Field label={t.pickUser}>
          <select value={accessUser} onChange={(e) => loadAccess(e.target.value)} style={{ ...input, maxWidth: 260 }}>
            <option value="">{t.choose}</option>
            {users.filter((u) => u.role !== "admin").map((u) => <option key={u.username} value={u.username}>{u.username}</option>)}
          </select>
        </Field>
        {accessUser && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8, marginTop: 12 }}>
              {SECTIONS.map((sec) => {
                const blocked = userLocked.includes(sec.p);
                return (
                  <button key={sec.p} onClick={() => toggleLock(sec.p)} style={toggleTile(blocked, C.surface2)}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(navT as any)[sec.k] || sec.k}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: blocked ? C.loss : C.gain, whiteSpace: "nowrap", flexShrink: 0 }}>{blocked ? "✕ " + t.blocked : "✓ " + t.allowed}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={() => { setErr(""); accessM.mutate(); }} disabled={accessM.isPending} className="gbtn ptile" style={{ ...btn(true), marginTop: 14 }}>
              {accessM.isPending ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />} {t.save}
            </button>
          </>
        )}
      </Section>

      {/* Connected / active sessions */}
      <Section id="connected" open={open} setOpen={setOpen} rtl={rtl} icon={<Wifi size={16} color={C.gold} />} title={t.connected}>
        {sessionsQ.isLoading ? <Empty><Loader2 size={16} className="spin" /></Empty>
          : sessions.length === 0 ? <Empty>{t.noOne}</Empty> : (
          <div style={{ overflowX: "auto", maxHeight: "55svh", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr>{["", t.username, t.since, t.duration, t.lastSeen].map((h, i) => <th key={i} style={th(rtl)}>{h}</th>)}</tr></thead>
              <tbody>
                {sessions.map((s) => {
                  const onlineNow = s.last_seen && (Date.now() - new Date(s.last_seen).getTime() < 5 * 60 * 1000);
                  return (
                    <tr key={s.username}>
                      <td style={{ ...td(rtl), width: 18 }}><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: onlineNow ? C.gain : C.faint }} title={onlineNow ? t.online : ""} /></td>
                      <td style={{ ...td(rtl), fontWeight: 600 }}>{s.username}</td>
                      <td style={{ ...td(rtl), color: C.muted, fontFamily: MONO }}>{s.since ? new Date(s.since).toLocaleString() : "—"}</td>
                      <td style={{ ...td(rtl), fontFamily: MONO }}>{dur(s.since)}</td>
                      <td style={{ ...td(rtl), color: C.muted, fontFamily: MONO }}>{s.last_seen ? rel(s.last_seen) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Audit log */}
      <Section id="audit" open={open} setOpen={setOpen} rtl={rtl} icon={<ScrollText size={16} color={C.gold} />} title={t.audit}>
        {auditQ.isLoading ? <Empty><Loader2 size={16} className="spin" /></Empty>
          : audit.length === 0 ? <Empty>{t.noAudit}</Empty> : (
          <div style={{ overflowX: "auto", maxHeight: "60svh", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr>{[t.when, t.actor, t.action, t.target, t.ip].map((h, i) => <th key={i} style={th(rtl)}>{h}</th>)}</tr></thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td style={{ ...td(rtl), color: C.muted, fontFamily: MONO, whiteSpace: "nowrap" }}>{a.ts ? new Date(a.ts).toLocaleString() : "—"}</td>
                    <td style={td(rtl)}>{a.actor || "—"}</td>
                    <td style={{ ...td(rtl), fontFamily: MONO, color: actionColor(a.action) }}>{a.action}</td>
                    <td style={td(rtl)}>{a.target || "—"}</td>
                    <td style={{ ...td(rtl), color: C.muted, fontFamily: MONO }}>{a.ip || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Signup requests · Broadcast · WhatsApp recipient (existing shared panels) */}
      <Section id="signup" open={open} setOpen={setOpen} rtl={rtl} icon={<UserCheck size={16} color={C.gold} />} title={t.signup}><SignupRequestsPanel /></Section>
      <Section id="broadcast" open={open} setOpen={setOpen} rtl={rtl} icon={<Radio size={16} color={C.gold} />} title={t.broadcast}><BroadcastPanel /></Section>
      <Section id="wa" open={open} setOpen={setOpen} rtl={rtl} icon={<Megaphone size={16} color={C.gold} />} title={t.waRecipient}><WhatsAppRecipientPanel /></Section>

      {/* Reusable per-user management panel (opened from any user row). */}
      {manageUser && <UserManageModal user={manageUser} onClose={() => setManageUser(null)} onChanged={invalidate} />}
    </div>
  );
}
