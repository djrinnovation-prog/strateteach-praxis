import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, UserPlus, Check, Loader2, Crown, Scale, Clapperboard, Gem, Wrench, Briefcase } from "lucide-react";
import { api, isMainAdmin } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI, SHADOW } from "../theme";
import { input, btn } from "../ui";
import type { TeamRoleUser } from "../lib/client";

// ── Team roles — main-admin-only access management for the partners. Assign a user a role
// via a USER PICKER (from the real user list → the exact username, never free-typed / "not
// found") + a role selector + Grant. Shows who currently holds each role. Shared by the
// Legal Console and the Admin access-control area. Per-user isolated, gated server-side too.
const ROLES = [
  { id: "admin", he: "מנהל (מלא)", en: "Admin (full)", Icon: Crown },
  { id: "owner", he: "בעלים", en: "Owner", Icon: Gem },
  { id: "legal_editor", he: "עורך משפטי", en: "Legal editor", Icon: Scale },
  { id: "it_editor", he: "עורך IT", en: "IT editor", Icon: Wrench },
  { id: "biz_editor", he: "פיתוח עסקי", en: "Biz-dev editor", Icon: Briefcase },
  { id: "content_editor", he: "עורך תוכן", en: "Content editor", Icon: Clapperboard },
] as const;
type RoleId = (typeof ROLES)[number]["id"];

export default function TeamRolesPanel() {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const qc = useQueryClient();
  const main = isMainAdmin();
  const [pick, setPick] = useState("");
  const [role, setRole] = useState<RoleId>("legal_editor");
  const [msg, setMsg] = useState("");
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg((c) => (c === m ? "" : c)), 2600); };

  const q = useQuery({ queryKey: ["teamRoles"], queryFn: () => api.teamRoles(), enabled: main });
  const users = (q.data?.users || []) as TeamRoleUser[];

  const setM = useMutation({
    mutationFn: (v: { username: string; role: RoleId; enabled: boolean }) => api.setTeamRole(v.username, v.role, v.enabled),
    onSuccess: (_r, v) => { flash(he ? "עודכן ✓" : "Updated ✓"); if (!v.enabled) { /* keep pick */ } qc.invalidateQueries({ queryKey: ["teamRoles"] }); qc.invalidateQueries({ queryKey: ["adminUsers"] }); qc.invalidateQueries({ queryKey: ["legalEditors"] }); },
    onError: (e: any) => flash((he ? "שגיאה: " : "Error: ") + String(e?.message || e)),
  });

  if (!main) return null;

  const holders = (r: RoleId) => users.filter((u) =>
    r === "admin" ? (u.role === "admin" || u.isMain)
    : r === "owner" ? (u.owner || u.isMain)
    : r === "legal_editor" ? (u.legalEditor || u.isMain)
    : r === "it_editor" ? (u.itEditor || u.isMain)
    : r === "biz_editor" ? (u.bizEditor || u.isMain)
    : (u.contentEditor || u.role === "admin" || u.isMain));

  const roleLbl = (r: RoleId) => { const x = ROLES.find((z) => z.id === r)!; return he ? x.he : x.en; };

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, boxShadow: SHADOW, marginTop: 16, direction: rtl ? "rtl" : "ltr" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 800, color: C.text, marginBottom: 4 }}>
        <ShieldCheck size={16} color={C.gold} /> {he ? "תפקידי צוות" : "Team roles"}
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
        {he ? "הענקת גישה לשותפים — בחר משתמש ותפקיד. רק מנהל ראשי." : "Grant partners access — pick a user + a role. Main admin only."}
      </div>

      {msg && <div style={{ marginBottom: 12, background: `${C.gold}1a`, border: `1px solid ${C.goldDim}`, color: C.gold, borderRadius: 9, padding: "8px 11px", fontSize: 12.5 }}>{msg}</div>}

      {/* current holders per role */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
        {ROLES.map((r) => {
          const list = holders(r.id);
          return (
            <div key={r.id}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 6 }}>
                <r.Icon size={13} color={C.gold} /> {roleLbl(r.id)}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {list.length === 0 && <span style={{ fontSize: 12, color: C.faint }}>{he ? "— אין —" : "— none —"}</span>}
                {list.map((u) => {
                  const implicit = u.isMain || (r.id === "content_editor" && u.role === "admin" && !u.contentEditor);
                  return (
                    <span key={u.username} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: C.text,
                      background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: "4px 10px" }}>
                      <Check size={12} color={C.gain} /> {u.username}
                      {implicit
                        ? <span style={{ fontSize: 10, color: C.faint }}>{u.isMain ? (he ? "· ראשי" : "· main") : (he ? "· מנהל" : "· admin")}</span>
                        : <button onClick={() => setM.mutate({ username: u.username, role: r.id, enabled: false })} title={he ? "בטל" : "Revoke"}
                            style={{ background: "none", border: "none", color: C.loss, cursor: "pointer", fontSize: 11, fontWeight: 800, padding: 0 }}>✕</button>}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* assign: user picker + role selector + grant */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
        <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ ...input, flex: "1 1 180px", minWidth: 150, cursor: "pointer", fontFamily: UI }}>
          <option value="">{he ? "בחר משתמש…" : "Pick a user…"}</option>
          {users.map((u) => (
            <option key={u.username} value={u.username}>{u.username}{u.isMain ? " · main" : u.role === "admin" ? " · admin" : ""}</option>
          ))}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value as RoleId)} style={{ ...input, flex: "0 1 160px", cursor: "pointer", fontFamily: UI }}>
          {ROLES.map((r) => <option key={r.id} value={r.id}>{he ? r.he : r.en}</option>)}
        </select>
        <button onClick={() => pick && setM.mutate({ username: pick, role, enabled: true })} disabled={setM.isPending || !pick} style={btn(true)}>
          {setM.isPending ? <Loader2 size={15} className="spin" /> : <UserPlus size={15} />} {he ? "הענק" : "Grant"}
        </button>
      </div>
      <div style={{ fontSize: 11, color: C.faint, marginTop: 10, lineHeight: 1.6 }}>
        {he
          ? "מנהל = גישה מלאה · בעלים = פורטל הבעלים ופורטל הפניות המלא · עורך משפטי = הפורטל המשפטי · עורך IT = פורטל ה-IT · פיתוח עסקי = פורטל הפיתוח העסקי · עורך תוכן = עורך הרילים (קורסים בהמשך)."
          : "Admin = full access · Owner = Owners Portal + full Requests portal · Legal editor = Legal Portal · IT editor = IT Portal · Biz-dev editor = Business Dev Portal · Content editor = Reels editor (Courses next)."}
      </div>
    </div>
  );
}
