import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import {
  X, UserCog, Mail, Smartphone, KeyRound, ShieldOff, Unlock, Link2, Copy,
  Trash2, Loader2, Check, ShieldCheck, UserRound,
} from "lucide-react";
import { api, isOwner } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI, MONO, onAccent } from "../theme";
import { btn, premSoft, PasswordInput, input as inputStyle, errBox, okBox } from "../ui";

// ── Reusable per-user MANAGEMENT panel (Dan): one clean, LABELED place that gathers
// every admin action for a single user — role, email, mobile, reset password, reset
// PIN, unlock, reset link, delete. Opened from the users table AND the user-lookup
// screen ("click a user from any screen"). Every action hits the SAME existing
// endpoint (backend still enforces require_admin + assert_can_manage_user); the UI
// just mirrors the gates (main "admin" row: no role change / no delete; PIN reset:
// owners only). Rendered as a centred modal in the app's design language.
export type ManageUser = { username: string; role?: string; email?: string | null; phone?: string | null };

const AV = ["#F7931A", "#7CC04E", "#36C5F0", "#E8438F", "#FBC02D", "#2DD4BF", "#A78BFA", "#FB7185"];
const colorFor = (s: string) => AV[Math.abs([...(s || "?")].reduce((a, c) => a + c.charCodeAt(0), 0)) % AV.length];

// ── Phone → E.164 helpers. SMS/WhatsApp need a full international number
// (+<countrycode><national>), e.g. Rafi's "8434504783" must become "+18434504783".
// We strip spaces/punctuation, convert a leading "00" to "+", and validate E.164.
const E164 = /^\+[1-9]\d{6,14}$/;
function normalizePhone(raw: string): string {
  let s = (raw || "").replace(/[\s()\-.]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  return s;
}
// Prepend a country code to a bare/local number (dropping a leading national "0").
function withCountryCode(raw: string, cc: string): string {
  const local = (raw || "").replace(/[^\d]/g, "").replace(/^0+/, "");
  return cc + local;
}

export default function UserManageModal({ user, onClose, onChanged }: {
  user: ManageUser;
  onClose: () => void;
  onChanged?: () => void;   // called after a change that affects the user list (role/email/phone/delete)
}) {
  const { lang, rtl } = useI18n();
  const TT = (en: string, he: string) => (lang === "he" ? he : en);
  const u = user.username;
  const isMainAdminRow = u === "admin";

  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const fail = (e: any) => { setOk(""); setErr(e?.message || String(e)); };
  const done = (m: string) => { setErr(""); setOk(m); };
  const changed = (m: string) => { done(m); onChanged?.(); };

  const [role, setRole] = useState(user.role || "user");
  const [email, setEmail] = useState(user.email || "");
  const [phone, setPhone] = useState(user.phone || "");
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [force, setForce] = useState(true);
  const [link, setLink] = useState("");

  const roleM = useMutation({ mutationFn: (r: string) => api.setUserRole(u, r), onSuccess: (_d, r) => changed(TT(`Role set to ${r}.`, `התפקיד עודכן ל-${r}.`)), onError: fail });
  const emailM = useMutation({ mutationFn: () => api.setUserEmail(u, email.trim()), onSuccess: () => changed(TT("Email saved.", "האימייל נשמר.")), onError: fail });
  const phoneM = useMutation({ mutationFn: () => api.setUserPhone(u, normalizePhone(phone)), onSuccess: () => { setPhone(normalizePhone(phone)); changed(TT("Mobile saved (SMS/WhatsApp).", "הנייד נשמר (SMS/וואטסאפ).")); }, onError: fail });
  const pwM = useMutation({ mutationFn: () => api.resetUserPassword(u, pw, force), onSuccess: () => { setPw(""); setPw2(""); done(TT(`Password reset for ${u}.`, `הסיסמה אופסה עבור ${u}.`)); }, onError: fail });
  const linkM = useMutation({ mutationFn: () => api.resetLink(u), onSuccess: (r: any) => { setLink(`${window.location.origin}${r.path}`); if (r.emailed) done(TT(`Reset email sent to ${r.email}.`, `נשלח מייל איפוס ל-${r.email}.`)); else done(TT("Reset link created.", "נוצר קישור איפוס.")); }, onError: fail });
  const unlockM = useMutation({ mutationFn: () => api.unlockUser(u), onSuccess: () => done(TT("Account unlocked.", "הנעילה שוחררה.")), onError: fail });
  const pinM = useMutation({ mutationFn: () => api.adminResetPin(u), onSuccess: () => done(TT("Live PIN cleared — the user sets a fresh one.", "קוד ה-PIN נוקה — המשתמש יגדיר קוד חדש.")), onError: fail });
  const delM = useMutation({ mutationFn: () => api.deleteUser(u), onSuccess: () => { onChanged?.(); onClose(); }, onError: fail });

  const submitPw = () => {
    setErr(""); setOk("");
    if (pw.length < 4) { setErr(TT("Password must be at least 4 characters.", "הסיסמה חייבת להכיל לפחות 4 תווים.")); return; }
    if (pw !== pw2) { setErr(TT("Passwords don't match.", "הסיסמאות אינן תואמות.")); return; }
    if (!confirm(force
      ? TT(`Set a new password for "${u}"? They'll pick their own on next login.`, `להגדיר סיסמה חדשה ל-"${u}"? הוא יבחר סיסמה משלו בהתחברות הבאה.`)
      : TT(`Set a new password for "${u}"?`, `להגדיר סיסמה חדשה ל-"${u}"?`))) return;
    pwM.mutate();
  };

  const busy = roleM.isPending || emailM.isPending || phoneM.isPending || pwM.isPending || linkM.isPending || unlockM.isPending || pinM.isPending || delM.isPending;

  // ── shared bits ──
  const secTitle = (Icon: React.FC<any>, text: string): React.CSSProperties | any => (
    <div style={{ fontSize: 12, fontWeight: 800, color: C.gold, margin: "0 0 10px", display: "inline-flex", alignItems: "center", gap: 7 }}>
      <Icon size={14} /> {text}
    </div>
  );
  const card: React.CSSProperties = { background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 13, padding: "13px 14px", marginBottom: 12 };
  const lbl: React.CSSProperties = { fontSize: 11, color: C.muted, marginBottom: 4 };
  const soft: React.CSSProperties = { ...premSoft(), color: C.text, display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap", padding: "9px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: UI };
  const saveBtn = (onClick: () => void, pending: boolean, disabled?: boolean) => (
    <button onClick={onClick} disabled={pending || disabled} className="gbtn ptile" style={{ ...btn(true), padding: "9px 13px", whiteSpace: "nowrap", opacity: (pending || disabled) ? 0.6 : 1 }}>
      {pending ? <Loader2 size={14} className="spin" /> : <Check size={14} />} {TT("Save", "שמור")}
    </button>
  );

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overflowY: "auto", direction: rtl ? "rtl" : "ltr", fontFamily: UI }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 540, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, boxShadow: "0 24px 70px rgba(0,0,0,0.55)", maxHeight: "calc(100dvh - 32px)", overflowY: "auto" }}>
        {/* Header — avatar + username + role, close */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 18px", borderBottom: `1px solid ${C.line}`, position: "sticky", top: 0, background: C.surface, zIndex: 1 }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: colorFor(u), color: onAccent(colorFor(u)), fontWeight: 800, fontSize: 18 }}>{(u || "#")[0].toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.text, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <UserCog size={16} color={C.gold} /> {u}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{TT("Manage this user", "ניהול המשתמש")} · <b style={{ color: C.text }}>{role}</b></div>
          </div>
          <button onClick={onClose} aria-label="close" className="tap44" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", flexShrink: 0 }}><X size={20} /></button>
        </div>

        <div style={{ padding: 16 }}>
          {err && <div style={errBox}>{err}</div>}
          {ok && <div style={okBox}>{ok}</div>}

          {/* Identity — role, email, mobile */}
          <div style={card}>
            {secTitle(UserRound, TT("Identity", "זהות"))}
            <div style={{ marginBottom: 12 }}>
              <div style={lbl}>{TT("Role", "תפקיד")}</div>
              <select value={role} disabled={isMainAdminRow || roleM.isPending}
                onChange={(e) => { setRole(e.target.value); roleM.mutate(e.target.value); }}
                style={{ ...inputStyle, width: 160, opacity: isMainAdminRow ? 0.6 : 1 }}>
                <option value="user">{TT("user", "משתמש")}</option>
                <option value="admin">{TT("admin", "מנהל")}</option>
              </select>
              {isMainAdminRow && <div style={{ fontSize: 10.5, color: C.faint, marginTop: 4 }}>{TT("The main admin's role can't be changed here.", "אי אפשר לשנות את תפקיד המנהל הראשי כאן.")}</div>}
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={lbl}><Mail size={11} style={{ verticalAlign: "-1px" }} /> {TT("Email", "אימייל")}</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={TT("no email set", "ללא אימייל")} style={{ ...inputStyle, flex: 1 }} />
                {saveBtn(() => emailM.mutate(), emailM.isPending)}
              </div>
            </div>
            {(() => {
              const norm = normalizePhone(phone);
              const empty = norm === "";
              const hasCC = norm.startsWith("+");
              const valid = empty || E164.test(norm);
              const chip = (label: string, cc: string) => (
                <button type="button" onClick={() => setPhone(withCountryCode(phone, cc))}
                  style={{ ...premSoft(), color: C.text, padding: "5px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 800, cursor: "pointer", fontFamily: UI, whiteSpace: "nowrap" }}>{label}</button>
              );
              return (
                <div>
                  <div style={lbl}><Smartphone size={11} style={{ verticalAlign: "-1px" }} /> {TT("Mobile (SMS / WhatsApp)", "נייד (SMS / וואטסאפ)")}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+18434504783"
                      style={{ ...inputStyle, flex: 1, fontFamily: MONO, borderColor: valid ? C.line : C.loss }} />
                    <button onClick={() => phoneM.mutate()} disabled={phoneM.isPending || !valid} className="gbtn ptile"
                      style={{ ...btn(true), padding: "9px 13px", whiteSpace: "nowrap", opacity: (phoneM.isPending || !valid) ? 0.6 : 1 }}>
                      {phoneM.isPending ? <Loader2 size={14} className="spin" /> : <Check size={14} />} {TT("Save", "שמור")}
                    </button>
                  </div>
                  {/* Flag a number missing its country code (breaks SMS/WhatsApp) + quick fixers. */}
                  {!empty && !valid && (
                    <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, color: C.loss, fontWeight: 700 }}>
                        {hasCC ? TT("Not a valid international number.", "מספר בינלאומי לא תקין.")
                               : TT("Missing country code (e.g. +1 / +972) — SMS/WhatsApp will fail.", "חסרה קידומת מדינה (למשל +1 / +972) — SMS/וואטסאפ ייכשלו.")}
                      </span>
                      {!hasCC && <>{chip("+972", "+972")}{chip("+1 (US)", "+1")}</>}
                    </div>
                  )}
                  {!empty && valid && norm !== (user.phone || "") && (
                    <div style={{ fontSize: 10.5, color: C.gain, marginTop: 5, fontWeight: 700 }}>{TT("Will be saved as", "יישמר כ")} <span style={{ fontFamily: MONO }}>{norm}</span></div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Security — reset password, reset link, unlock, reset PIN */}
          <div style={card}>
            {secTitle(ShieldCheck, TT("Security", "אבטחה"))}
            <div style={{ marginBottom: 6 }}>
              <div style={lbl}><KeyRound size={11} style={{ verticalAlign: "-1px" }} /> {TT("Reset password", "איפוס סיסמה")}</div>
              <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} placeholder={TT("New password", "סיסמה חדשה")} autoComplete="new-password" style={{ ...inputStyle, width: "100%", marginBottom: 6 }} />
              <PasswordInput value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder={TT("Confirm new password", "אימות סיסמה חדשה")} autoComplete="new-password" style={{ ...inputStyle, width: "100%", marginBottom: 8 }} />
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.text, marginBottom: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.gold }} />
                {TT("Force change on next login", "חיוב החלפה בהתחברות הבאה")}
              </label>
              <button onClick={submitPw} disabled={pwM.isPending} className="gbtn ptile" style={{ ...btn(true), padding: "9px 14px", whiteSpace: "nowrap", opacity: pwM.isPending ? 0.6 : 1 }}>
                {pwM.isPending ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />} {TT("Reset password", "איפוס סיסמה")}
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
              <button onClick={() => linkM.mutate()} disabled={linkM.isPending} style={soft}>
                {linkM.isPending ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />} {TT("Reset link", "קישור איפוס")}
              </button>
              <button onClick={() => unlockM.mutate()} disabled={unlockM.isPending} style={soft}>
                {unlockM.isPending ? <Loader2 size={14} className="spin" /> : <Unlock size={14} />} {TT("Unlock account", "שחרר נעילה")}
              </button>
              {isOwner() && (
                <button onClick={() => { if (confirm(TT(`Reset ${u}'s live PIN? Their code is cleared and they set a fresh one.`, `לאפס את קוד ה-PIN הלייב של ${u}? הקוד יימחק והוא יגדיר קוד חדש.`))) pinM.mutate(); }}
                  disabled={pinM.isPending} style={{ ...soft, color: C.gold, borderColor: `${C.gold}66` }}>
                  {pinM.isPending ? <Loader2 size={14} className="spin" /> : <ShieldOff size={14} />} {TT("Reset PIN", "איפוס קוד PIN")}
                </button>
              )}
            </div>

            {link && (
              <div style={{ ...okBox, display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                <span style={{ fontSize: 11.5 }}>{TT("Copy this link and send it to the user (valid 24h):", "העתק את הקישור ושלח למשתמש (תקף 24 שעות):")}</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <code style={{ flex: 1, fontFamily: MONO, fontSize: 11.5, color: C.text, overflowX: "auto", whiteSpace: "nowrap" }}>{link}</code>
                  <button onClick={() => { navigator.clipboard?.writeText(link); done(TT("Copied", "הועתק")); }} style={soft}><Copy size={13} /> {TT("Copy", "העתק")}</button>
                </div>
              </div>
            )}
          </div>

          {/* Danger — delete (hidden for the main admin) */}
          {!isMainAdminRow && (
            <div style={{ ...card, borderColor: `${C.loss}44` }}>
              {secTitle(Trash2, TT("Danger zone", "אזור מסוכן"))}
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>{TT("Permanently delete this user and their data. This can't be undone.", "מחיקה לצמיתות של המשתמש והנתונים שלו. לא ניתן לשחזר.")}</div>
              <button onClick={() => { if (confirm(TT(`Delete ${u}? This can't be undone.`, `למחוק את ${u}? לא ניתן לשחזר.`))) delM.mutate(); }}
                disabled={delM.isPending} className="gbtn gbtn-loss ptile" style={{ ...btn(), padding: "9px 14px", whiteSpace: "nowrap", opacity: delM.isPending ? 0.6 : 1 }}>
                {delM.isPending ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} {TT("Delete user", "מחק משתמש")}
              </button>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <button onClick={onClose} disabled={busy} style={soft}>{TT("Close", "סגור")}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
