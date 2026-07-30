import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ticket, UserCog, Inbox, Plus, Copy, Ban, Check, CreditCard, Clock, Lightbulb, MessageCircle, Link2, KeyRound, ChevronDown, UserPlus } from "lucide-react";
import { api, isMainAdmin, isAdminOrOwner, isOwner } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI, SHADOW } from "../theme";
import type { GrantSpec } from "../lib/client";
import TeamRolesPanel from "../components/TeamRolesPanel";
import CreateUserForm from "../components/CreateUserForm";
const tr = (lang: string, en: string, he: string) => (lang === "he" ? he : en);

// The access presets the admin picks from (maps to a GrantSpec).
const PRESETS: { id: string; en: string; he: string; grant: GrantSpec }[] = [
  { id: "basic", en: "Basic plan", he: "מסלול Basic", grant: { plan: "basic" } },
  { id: "middle", en: "Middle plan", he: "מסלול Middle", grant: { plan: "middle" } },
  { id: "pro", en: "Pro plan", he: "מסלול Pro", grant: { plan: "pro" } },
  { id: "all", en: "Full access", he: "גישה מלאה", grant: { all: true } },
  { id: "profit", en: "Trading Engine unlock", he: "פתיחת מנוע המסחר", grant: { profitUnlock: true } },
  { id: "none", en: "Lock (none)", he: "נעילה (ללא)", grant: { none: true } },
];

const inp: React.CSSProperties = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 9, padding: "9px 11px", fontFamily: UI, fontSize: 13 };
const btn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer", background: "var(--btn-bg)", color: "var(--btn-ink)", fontWeight: 800, fontSize: 13, borderRadius: 9, padding: "9px 14px", fontFamily: UI };
const ghost: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontFamily: UI, fontSize: 12 };

// A small count badge shown on a closed section header (e.g. pending requests) so the
// admin sees what needs attention WITHOUT having to open every section.
function pill(n: number): React.ReactNode {
  if (!n) return null;
  return <span style={{ fontSize: 11, color: "var(--btn-ink)", background: "var(--btn-bg)", borderRadius: 999, padding: "1px 8px", fontWeight: 800, flexShrink: 0 }}>{n}</span>;
}

// Single-open accordion section — mirrors the About Us (AboutContent) accordion: a
// tappable header (icon · title · optional count badge · chevron) that expands its
// body; opening one collapses the others; all collapsed by default so the screen opens
// compact. flexShrink:0 keeps a closed header at full height (never clips in RTL/LTR).
function Section({ id, open, setOpen, icon, title, badge, rtl, children }: {
  id: string; open: string; setOpen: (v: string) => void; icon: React.ReactNode; title: string;
  badge?: React.ReactNode; rtl: boolean; children: React.ReactNode;
}) {
  const isOpen = open === id;
  return (
    <div style={{ flexShrink: 0, marginTop: 14, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
      border: `1.5px solid ${isOpen ? C.gold : C.line}`, borderRadius: 14, overflow: "hidden",
      boxShadow: isOpen ? `inset 0 1px 0 rgba(255,255,255,0.25), ${SHADOW}` : "inset 0 1px 0 rgba(255,255,255,0.18)" }}>
      <button type="button" onClick={() => setOpen(isOpen ? "" : id)} aria-expanded={isOpen}
        style={{ width: "100%", minHeight: 50, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 10, background: "none", border: "none", cursor: "pointer", padding: "13px 15px", color: C.text, fontFamily: UI, textAlign: rtl ? "right" : "left" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 800, minWidth: 0 }}>
          <span style={{ display: "inline-flex", flexShrink: 0 }}>{icon}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
          {badge}
        </span>
        <ChevronDown size={17} color={C.muted} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }} />
      </button>
      {isOpen && <div style={{ padding: "0 15px 15px" }}>{children}</div>}
    </div>
  );
}

export default function AdminAccess() {
  const { lang, rtl } = useI18n();
  const qc = useQueryClient();
  // Single-open accordion: which section is expanded ("" = all collapsed by default,
  // so the screen opens compact — just the section headers).
  const [open, setOpen] = useState<string>("");
  const [flash, setFlash] = useState("");
  const note = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 3000); };
  // Universal self-signup link — one static URL to share freely (NOT a per-user
  // pre-created account); opens the instant 1-week demo signup at /join.
  const joinUrl = (typeof window !== "undefined" ? window.location.origin : "https://app.strateteach.com") + "/join";
  // Welcome link (super-admin): a one-time passwordless link into an EXISTING account.
  const [wlUser, setWlUser] = useState("");
  const [wlLink, setWlLink] = useState("");
  async function genWelcome() {
    if (!wlUser) return;
    try { const r = await api.welcomeLink(wlUser); setWlLink(r.link); try { await navigator.clipboard?.writeText(r.link); } catch (_e) { /* */ } note(tr(lang, "Welcome link created + copied", "לינק נוצר והועתק")); }
    catch (e: any) { note(tr(lang, "Couldn't create link", "יצירת הלינק נכשלה")); }
  }

  const couponsQ = useQuery({ queryKey: ["coupons"], queryFn: () => api.listCoupons() });
  const reqsQ = useQuery({ queryKey: ["accessReqs"], queryFn: () => api.listAccessRequests(), refetchInterval: 20000 });
  const pwReqsQ = useQuery({ queryKey: ["pwResetReqs"], queryFn: () => api.listPasswordResetRequests(), refetchInterval: 20000 });
  const usersQ = useQuery({ queryKey: ["adminUsers"], queryFn: () => api.listUsers() });
  const demoQ = useQuery({ queryKey: ["demoUsers"], queryFn: () => api.listDemoUsers(), refetchInterval: 30000 });
  const fbQ = useQuery({ queryKey: ["feedback"], queryFn: () => api.listFeedback(), refetchInterval: 30000 });

  async function newDemo() {
    try { const d = await api.createDemoUser(); qc.invalidateQueries({ queryKey: ["demoUsers"] }); try { await navigator.clipboard?.writeText(d.link); } catch (_e) { /* */ } note(tr(lang, "Demo link created + copied", "קישור דמו נוצר והועתק")); }
    catch { note(tr(lang, "Couldn't create demo", "יצירת דמו נכשלה")); }
  }
  async function demoAction(username: string, action: "extend" | "revoke") {
    try { action === "extend" ? await api.extendDemo(username) : await api.revokeDemo(username); qc.invalidateQueries({ queryKey: ["demoUsers"] }); } catch {}
  }
  // Assign / update a user's plan (basic / middle / pro). Reuses the admin grant
  // pipeline; a plan grant now also unlocks that user's screens (see access.py).
  async function setUserPlan(username: string, plan: "basic" | "middle" | "pro") {
    try {
      const r = await api.adminGrantUser(username, { plan });
      qc.invalidateQueries({ queryKey: ["demoUsers"] });
      qc.invalidateQueries({ queryKey: ["adminUsers"] });
      note(tr(lang, `${username}: ${r.summary}`, `${username}: ${r.summary}`));
    } catch { note(tr(lang, "Plan update failed", "עדכון המסלול נכשל")); }
  }

  // create-coupon form
  const [preset, setPreset] = useState("pro");
  const [maxUses, setMaxUses] = useState("0");
  const [note2, setNote2] = useState("");
  // per-user grant
  const [targetUser, setTargetUser] = useState("");
  const [userPreset, setUserPreset] = useState("pro");

  function grantOf(id: string): GrantSpec { return (PRESETS.find((p) => p.id === id) || PRESETS[2]).grant; }

  async function createCoupon() {
    try {
      const c = await api.createCoupon({ grant: grantOf(preset), maxUses: Number(maxUses) || 0, note: note2 || undefined });
      qc.invalidateQueries({ queryKey: ["coupons"] });
      note(tr(lang, `Code created: ${c.code}`, `נוצר קוד: ${c.code}`));
    } catch { note(tr(lang, "Couldn't create code", "יצירת הקוד נכשלה")); }
  }
  async function disable(code: string) {
    try { await api.disableCoupon(code); qc.invalidateQueries({ queryKey: ["coupons"] }); } catch {}
  }
  async function grantUser() {
    if (!targetUser) return;
    try {
      const r = await api.adminGrantUser(targetUser, grantOf(userPreset));
      note(tr(lang, `${targetUser}: ${r.summary}`, `${targetUser}: ${r.summary}`));
    } catch { note(tr(lang, "Grant failed", "ההענקה נכשלה")); }
  }
  async function handleReq(id: number, action: "grant" | "payment") {
    try {
      if (action === "grant") await api.grantAccessRequest(id);
      else await api.denyAccessRequest(id, true);
      qc.invalidateQueries({ queryKey: ["accessReqs"] });
    } catch {}
  }
  // "Can't log in / forgot password" requests → approve flips the account into a
  // passwordless-renewal state (the user then renews from the login screen).
  async function handlePwReq(id: number, action: "approve" | "reject") {
    try {
      if (action === "approve") { const r = await api.approvePasswordReset(id); note(tr(lang, `Reset approved for ${r.username}`, `אופס אושר ל-${r.username}`)); }
      else await api.rejectPasswordReset(id);
      qc.invalidateQueries({ queryKey: ["pwResetReqs"] });
    } catch { note(tr(lang, "Action failed", "הפעולה נכשלה")); }
  }

  const presetLabel = (id: string) => { const p = PRESETS.find((x) => x.id === id)!; return tr(lang, p.en, p.he); };
  const coupons = couponsQ.data || [];
  const reqs = reqsQ.data || [];
  const pending = reqs.filter((r) => r.status === "pending");
  const pwPending = (pwReqsQ.data || []).filter((r) => r.status === "pending");

  return (
    <div style={{ marginTop: 26, borderTop: `1px solid ${C.line}`, paddingTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <UserCog size={18} color={C.gold} />
        <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>{tr(lang, "Admin · access control", "ניהול · בקרת גישה")}</h2>
      </div>
      {flash && <div style={{ marginTop: 8, fontSize: 12.5, color: C.gain }}>{flash}</div>}

      {/* Create a user — the SAME form as Settings (shared component), mounted HERE so admins
          add users where they expect (inside Users & access), not only in Settings. Owner OR
          admin (matches the backend require_admin add-user endpoint; assert_can_manage_user
          still blocks a non-owner admin from creating an admin account). */}
      {isAdminOrOwner() && (
        <div style={{ marginTop: 16, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, boxShadow: SHADOW }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <UserPlus size={17} color={C.gold} />
            <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{tr(lang, "Add a user", "הוסף משתמש")}</h3>
          </div>
          <CreateUserForm />
        </div>
      )}

      {/* Team roles — assign partners full-admin / legal-editor / content-editor via a user
          picker (main-admin only; the panel gates itself too). */}
      <TeamRolesPanel />

      {/* Universal signup link — one static URL, share freely; opens an instant
          1-week demo signup (each visitor picks their own username + password). */}
      <Section id="signup" open={open} setOpen={setOpen} rtl={rtl} icon={<Link2 size={16} color={C.gold} />}
        title={tr(lang, "Universal signup link", "לינק הרשמה אוניברסלי")}>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>{tr(lang, "Share freely — opens an instant 1-week demo signup; visitors choose their own login and land straight in.", "לשיתוף חופשי — פותח הרשמת דמו מיידית לשבוע; כל אחד בוחר שם משתמש וסיסמה ונכנס ישר.")}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <code style={{ fontSize: 13, fontWeight: 700, color: C.gold, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 11px", flex: 1, minWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{joinUrl}</code>
          <button onClick={() => { navigator.clipboard?.writeText(joinUrl); note(tr(lang, "Link copied", "הקישור הועתק")); }} style={btn}><Copy size={13} /> {tr(lang, "Copy", "העתק")}</button>
          <button onClick={() => { const msg = tr(lang, `Join ALGO770 — a free 1-week demo. Sign up here: ${joinUrl}`, `הצטרפו ל-ALGO770 — דמו חינם לשבוע. הרשמה כאן: ${joinUrl}`); window.open("https://wa.me/?text=" + encodeURIComponent(msg), "_blank"); }} style={{ ...btn, background: C.gain, color: "#06281c" }}><MessageCircle size={13} /> WhatsApp</button>
        </div>
      </Section>

      {/* Welcome link — super-admin only: one-time passwordless link into an EXISTING
          account (lands on a branded notice + phone capture). 48h, single use. */}
      {isMainAdmin() && (
        <Section id="welcome" open={open} setOpen={setOpen} rtl={rtl} icon={<Link2 size={16} color={C.loss} />}
          title={tr(lang, "Welcome link (one-time, into an existing account)", "לינק כניסה חד-פעמי (לחשבון קיים)")}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>{tr(lang, "Logs the visitor straight into the chosen account, then shows a branded notice + phone capture. Valid 48h, single use.", "מכניס ישר לחשבון הנבחר, מציג מסך הודעה ממותג + חיבור טלפון. תוקף 48ש', שימוש יחיד.")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <select value={wlUser} onChange={(e) => { setWlUser(e.target.value); setWlLink(""); }} style={inp}>
              <option value="">{tr(lang, "Choose account…", "בחרו חשבון…")}</option>
              {(usersQ.data || []).map((u) => <option key={u.username} value={u.username}>{u.username}{u.role === "admin" ? " · admin" : ""}</option>)}
            </select>
            <button onClick={genWelcome} disabled={!wlUser} style={btn}><Plus size={14} /> {tr(lang, "Generate link", "צרו לינק")}</button>
          </div>
          {wlLink && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 10 }}>
              <code style={{ fontSize: 12.5, fontWeight: 700, color: C.gold, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 11px", flex: 1, minWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{wlLink}</code>
              <button onClick={() => { navigator.clipboard?.writeText(wlLink); note(tr(lang, "Copied", "הועתק")); }} style={ghost}><Copy size={12} /> {tr(lang, "Copy", "העתק")}</button>
              <button onClick={() => { const msg = tr(lang, `Your ALGO770 access: ${wlLink}`, `הכניסה שלך ל-ALGO770: ${wlLink}`); window.open("https://wa.me/?text=" + encodeURIComponent(msg), "_blank"); }} style={{ ...ghost, color: C.gain, borderColor: `${C.gain}66` }}><MessageCircle size={12} /> WhatsApp</button>
            </div>
          )}
        </Section>
      )}

      {/* Access requests inbox */}
      <Section id="accessreq" open={open} setOpen={setOpen} rtl={rtl} icon={<Inbox size={16} color={C.blue} />}
        title={tr(lang, "Access requests", "בקשות גישה")} badge={pill(pending.length)}>
        {pending.length === 0 && <div style={{ fontSize: 12.5, color: C.muted }}>{tr(lang, "No pending requests.", "אין בקשות ממתינות.")}</div>}
        {pending.map((r) => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{r.username}</div>
              {r.message && <div style={{ fontSize: 11.5, color: C.muted }}>{r.message}</div>}
            </div>
            <button onClick={() => handleReq(r.id, "grant")} style={btn}><Check size={13} /> {tr(lang, "Grant free", "אשר חינם")}</button>
            <button onClick={() => handleReq(r.id, "payment")} style={ghost}><CreditCard size={12} /> {tr(lang, "Require payment", "דרוש תשלום")}</button>
          </div>
        ))}
      </Section>

      {/* Password reset requests inbox — "can't log in / forgot password" flow.
          Approve flips the account into a passwordless-renewal state so the user
          can set a new password from the login screen WITHOUT the old one. */}
      <Section id="pwreq" open={open} setOpen={setOpen} rtl={rtl} icon={<KeyRound size={16} color={C.loss} />}
        title={tr(lang, "Password reset requests", "בקשות איפוס סיסמה")} badge={pill(pwPending.length)}>
        <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 8 }}>{tr(lang, "Approving lets the user renew their password from the login screen — without the old one.", "אישור מאפשר למשתמש לחדש סיסמה ממסך הכניסה — בלי הסיסמה הישנה.")}</div>
        {pwPending.length === 0 && <div style={{ fontSize: 12.5, color: C.muted }}>{tr(lang, "No pending requests.", "אין בקשות ממתינות.")}</div>}
        {pwPending.map((r) => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${C.line}`, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{r.username}</div>
              {r.contact && <div style={{ fontSize: 11.5, color: C.muted }}>{r.contact}</div>}
              <div style={{ fontSize: 10.5, color: C.faint }}>{new Date(r.created_at).toLocaleString(lang === "he" ? "he-IL" : "en-US")}</div>
            </div>
            <button onClick={() => handlePwReq(r.id, "approve")} style={btn}><Check size={13} /> {tr(lang, "Approve", "אשר")}</button>
            <button onClick={() => handlePwReq(r.id, "reject")} style={{ ...ghost, color: C.loss }}><Ban size={12} /> {tr(lang, "Reject", "דחה")}</button>
          </div>
        ))}
      </Section>

      {/* Per-user grant */}
      <Section id="grant" open={open} setOpen={setOpen} rtl={rtl} icon={<UserCog size={16} color={C.gold} />}
        title={tr(lang, "Set a user's access", "הגדרת גישה למשתמש")}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <select value={targetUser} onChange={(e) => setTargetUser(e.target.value)} style={inp}>
            <option value="">{tr(lang, "Choose user…", "בחרו משתמש…")}</option>
            {(usersQ.data || []).filter((u) => isOwner() || u.role !== "admin").map((u) => <option key={u.username} value={u.username}>{u.username}{u.role === "admin" ? " · admin" : ""}</option>)}
          </select>
          <select value={userPreset} onChange={(e) => setUserPreset(e.target.value)} style={inp}>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{presetLabel(p.id)}</option>)}
          </select>
          <button onClick={grantUser} style={btn}><Check size={13} /> {tr(lang, "Apply", "החל")}</button>
        </div>
      </Section>

      {/* Coupons */}
      <Section id="coupons" open={open} setOpen={setOpen} rtl={rtl} icon={<Ticket size={16} color={C.gold} />}
        title={tr(lang, "Coupon codes (100% off → free access)", "קודי קופון (100% הנחה → גישה חינם)")}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <select value={preset} onChange={(e) => setPreset(e.target.value)} style={inp}>
            {PRESETS.filter((p) => p.id !== "none").map((p) => <option key={p.id} value={p.id}>{presetLabel(p.id)}</option>)}
          </select>
          <input value={maxUses} onChange={(e) => setMaxUses(e.target.value)} style={{ ...inp, width: 120 }} placeholder={tr(lang, "Max uses (0=∞)", "מקס' שימושים")} />
          <input value={note2} onChange={(e) => setNote2(e.target.value)} style={{ ...inp, width: 160 }} placeholder={tr(lang, "Note (optional)", "הערה")} />
          <button onClick={createCoupon} style={btn}><Plus size={14} /> {tr(lang, "Generate code", "צרו קוד")}</button>
        </div>
        {coupons.length === 0 && <div style={{ fontSize: 12.5, color: C.muted }}>{tr(lang, "No codes yet.", "אין קודים עדיין.")}</div>}
        {coupons.map((c) => (
          <div key={c.code} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${C.line}`, opacity: c.active ? 1 : 0.5 }}>
            <code style={{ fontSize: 13, fontWeight: 800, color: C.gold, letterSpacing: "0.04em" }}>{c.code}</code>
            <span style={{ fontSize: 11.5, color: C.muted, flex: 1, minWidth: 0 }}>
              {c.summary} · {c.usedCount}/{c.maxUses || "∞"}{c.active ? "" : ` · ${tr(lang, "disabled", "מושבת")}`}
            </span>
            <button onClick={() => { navigator.clipboard?.writeText(c.code); note(tr(lang, "Copied", "הועתק")); }} style={ghost}><Copy size={12} /></button>
            {c.active && <button onClick={() => { const msg = tr(lang, `Hi! Your ALGO770 access code: ${c.code}. Go to app.strateteach.com and enter it on the Plans screen.`, `היי! קוד הזמנה ל-ALGO770 (גישה חינם): ${c.code}. היכנס ל-app.strateteach.com והזן אותו במסך התוכניות.`); window.open("https://wa.me/?text=" + encodeURIComponent(msg), "_blank"); }} style={{ ...ghost, color: C.gain, borderColor: `${C.gain}66` }}><MessageCircle size={12} /> WhatsApp</button>}
            {c.active && <button onClick={() => disable(c.code)} style={ghost}><Ban size={12} /> {tr(lang, "Disable", "השבת")}</button>}
          </div>
        ))}
      </Section>

      {/* Demo testers — one-tap, 30-min, Pro features */}
      <Section id="demo" open={open} setOpen={setOpen} rtl={rtl} icon={<Clock size={16} color={C.gold} />}
        title={tr(lang, "Demo testers (1 week)", "בודקי דמו (שבוע)")} badge={pill((demoQ.data || []).length)}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <button onClick={newDemo} style={btn}><Plus size={14} /> {tr(lang, "Create demo link", "צרו קישור דמו")}</button>
        </div>
        {(demoQ.data || []).length === 0 && <div style={{ fontSize: 12.5, color: C.muted }}>{tr(lang, "No demo testers yet.", "אין בודקי דמו עדיין.")}</div>}
        {(demoQ.data || []).map((d) => (
          <div key={d.username} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: `1px solid ${C.line}`, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 90 }}>{d.username}</span>
            <span style={{ fontSize: 11.5, color: d.active ? C.gain : C.faint, flex: 1, minWidth: 80 }}>
              {d.active ? `● ${Math.floor((d.minutesLeft || 0) / 1440)}d ${Math.floor(((d.minutesLeft || 0) % 1440) / 60)}h ${tr(lang, "left", "נותרו")}` : tr(lang, "○ inactive / expired", "○ לא פעיל / פג")}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: C.gold, minWidth: 56 }}>⭐ {d.score ?? 0}/100</span>
            <select value={d.plan || "basic"} onChange={(e) => setUserPlan(d.username, e.target.value as any)}
              title={tr(lang, "Plan", "מסלול")} style={{ ...inp, padding: "5px 8px", fontSize: 12 }}>
              <option value="basic">{tr(lang, "Basic", "בסיס")}</option>
              <option value="middle">{tr(lang, "Middle", "מדיום")}</option>
              <option value="pro">{tr(lang, "Pro", "פרו")}</option>
            </select>
            <button onClick={() => { navigator.clipboard?.writeText(d.link); note(tr(lang, "Link copied", "הקישור הועתק")); }} style={ghost}><Copy size={12} /> {tr(lang, "Link", "קישור")}</button>
            <button onClick={() => { if (!d.link) { note(tr(lang, "No link yet", "אין לינק עדיין")); return; } const msg = tr(lang, "Hi! Here's your link to join ALGO770 — a one-week demo, no signup needed: ", "היי! הנה לינק להתחבר ל-ALGO770 — גישת דמו לשבוע, בלי הרשמה: ") + d.link; window.open("https://wa.me/?text=" + encodeURIComponent(msg), "_blank"); }} style={{ ...ghost, color: C.gain, borderColor: `${C.gain}66` }}><MessageCircle size={12} /> WhatsApp</button>
            <button onClick={() => demoAction(d.username, "extend")} style={ghost}>+1wk</button>
            <button onClick={() => demoAction(d.username, "revoke")} style={{ ...ghost, color: C.loss }}><Ban size={12} /></button>
          </div>
        ))}
      </Section>

      {/* Tester suggestions inbox */}
      <Section id="suggestions" open={open} setOpen={setOpen} rtl={rtl} icon={<Lightbulb size={16} color={C.gold} />}
        title={tr(lang, "Tester suggestions", "הצעות מבודקים")} badge={pill((fbQ.data || []).length)}>
        {(fbQ.data || []).length === 0 && <div style={{ fontSize: 12.5, color: C.muted }}>{tr(lang, "No suggestions yet.", "אין הצעות עדיין.")}</div>}
        {(fbQ.data || []).map((f) => (
          <div key={f.id} style={{ padding: "10px 0", borderTop: `1px solid ${C.line}`, display: "flex", gap: 10 }}>
            {(f as any).image && (
              <a href={(f as any).image} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }} title={tr(lang, "Open full image", "פתח תמונה מלאה")}>
                <img src={(f as any).image} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.line}` }} />
              </a>
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, color: C.text, whiteSpace: "pre-wrap" }}>{f.text || ((f as any).image ? tr(lang, "(screenshot)", "(צילום מסך)") : "")}</div>
              <div style={{ fontSize: 10.5, color: C.faint, marginTop: 3 }}>{f.username}{f.route ? ` · ${f.route}` : ""} · {new Date(f.created_at).toLocaleString(lang === "he" ? "he-IL" : "en-US")}</div>
            </div>
          </div>
        ))}
      </Section>
    </div>
  );
}
