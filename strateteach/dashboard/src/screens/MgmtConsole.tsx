import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Building2, Users, ClipboardCheck, FileText, Coins, Rocket, Lock,
  ShieldCheck, Landmark, Scale, Megaphone, ChevronLeft, ChevronRight, Sunrise, Trophy,
  Plus, Check, X, ThumbsDown,
} from "lucide-react";
import { C, UI, MONO } from "../theme";
import { Segmented } from "../ui";
import { api } from "../app/api";
import type { MgmtApproval, MgmtConsole as MgmtData, MgmtProject, MgmtTeamRow } from "../lib/client";

// ── Compliance switches card (owner-only) — BTC-only + client-autopilot freeze ──
// The regulatory levers from the Raz meeting, flippable here. BTC-only default OFF
// (no change until enabled); autopilot freeze default ON (risky client path closed).
// Owners are exempt from both, so flipping never affects owner testing.
function ComplianceCard({ he, rtl }: { he: boolean; rtl: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["mgmtCompliance"], queryFn: () => api.mgmtCompliance(), staleTime: 20000, retry: false });
  const set = useMutation({
    mutationFn: (b: { btcOnly?: boolean; clientAutopilotFrozen?: boolean }) => api.mgmtComplianceSet(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mgmtCompliance"] }),
  });
  const d = q.data;
  const Row = ({ title, sub, on, tint, onToggle }: { title: string; sub: string; on: boolean; tint: string; onToggle: () => void }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: `1px solid ${C.line}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 900, color: C.text }}>{title}</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 1 }}>{sub}</div>
      </div>
      <button onClick={onToggle} disabled={set.isPending} className="tap44"
        style={{ position: "relative", width: 50, height: 28, borderRadius: 999, flexShrink: 0, cursor: "pointer",
          background: on ? tint : C.surface2, border: `1px solid ${on ? tint : C.line}`, transition: "background .2s" }}>
        <span style={{ position: "absolute", top: 2, insetInlineStart: on ? 24 : 2, width: 22, height: 22, borderRadius: 999,
          background: "#fff", transition: "inset-inline-start .2s" }} />
      </button>
    </div>
  );
  return (
    <div style={card()}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <ShieldCheck size={16} color={C.gold} />
        <span style={{ fontSize: 14.5, fontWeight: 900, color: C.text }}>{he ? "מתגי תאימות" : "Compliance switches"}</span>
      </div>
      {q.isLoading ? <div style={{ padding: "10px 0" }}><Loader2 size={16} className="spin" color={C.gold} /></div> : d && (
        <>
          <Row title={he ? "מסחר בביטקוין בלבד" : "Bitcoin-only trading"}
            sub={he ? "מגביל לקוחות ל-BTC (בעלים פטורים). כבוי = ללא הגבלה." : "Limits clients to BTC (owners exempt). Off = no limit."}
            on={d.btcOnly} tint={C.gold} onToggle={() => set.mutate({ btcOnly: !d.btcOnly })} />
          <Row title={he ? "הקפאת AutoPilot ללקוחות" : "Freeze client AutoPilot"}
            sub={he ? "חוסם מסלול-ביצוע אוטונומי ללקוח (בעלים פטורים). דלוק = חסום." : "Blocks client autonomous execution (owners exempt). On = blocked."}
            on={d.clientAutopilotFrozen} tint={C.gain} onToggle={() => set.mutate({ clientAutopilotFrozen: !d.clientAutopilotFrozen })} />
          <div style={{ fontSize: 11, fontWeight: 600, color: C.faint, marginTop: 9, lineHeight: 1.5 }}>
            {he ? "המתגים נאכפים בצד-השרת בכל הזמנה/דמו/בקטסט. שינוי חל תוך שניות." : "Enforced server-side on every order/demo/backtest. Takes effect within seconds."}
          </div>
        </>
      )}
    </div>
  );
}

// ── MANAGEMENT CONSOLE (SheraCore pattern) · P2.2 — the shell, READ-ONLY ──────
// Owner-approved mapping (2026-07-16): one console, five screens — Dashboard /
// Team / Approvals / Reports / Budget. This slice is DISPLAY ONLY:
//   * No grant buttons — granting a scope stays an owner's click in the Team
//     roles panel; this screen only SHOWS who has what.
//   * Approvals is an honest empty state — the 3-of-3 queue lives in the
//     ISOLATED execution-service DB, wired in P2.4 through a proper boundary.
//   * Budget/Reports route into the EXISTING owner surfaces (Finance/Daily) —
//     nothing here reads or moves money itself.
// Skin-adaptive light board (C.* tokens, same language as the /owners landing).

type Section = "dashboard" | "team" | "approvals" | "reports" | "budget";

const LAYER_META: Record<string, { he: string; en: string; tint: () => string }> = {
  "3_owner":                { he: "בעלים", en: "Owner", tint: () => C.gold },
  "2a_execution_operator":  { he: "מפעיל ביצוע", en: "Exec operator", tint: () => C.blue },
  "2b_team":                { he: "צוות", en: "Team", tint: () => C.gain },
  "1_client":               { he: "לקוח", en: "Client", tint: () => C.muted },
};

const PROJECT_ICON: Record<string, any> = {
  execution: Rocket, "owners-fund": Landmark, legal: Scale, content: Megaphone,
};

function card(extra?: React.CSSProperties): React.CSSProperties {
  return {
    background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: 16,
    boxShadow: "0 12px 30px -24px rgba(0,0,0,0.55)", ...extra,
  };
}

function Chip({ text, tint }: { text: string; tint: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 900, color: tint,
      background: `${tint}16`, border: `1px solid ${tint}44`, borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>
      {text}
    </span>
  );
}

function EmptyNote({ Icon, title, sub }: { Icon: any; title: string; sub: string }) {
  return (
    <div style={{ ...card(), display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "28px 18px", textAlign: "center" }}>
      <span style={{ width: 52, height: 52, borderRadius: 16, display: "grid", placeItems: "center",
        background: `${C.gold}16`, border: `1px solid ${C.gold}44` }}>
        <Icon size={24} color={C.gold} />
      </span>
      <span style={{ fontSize: 14.5, fontWeight: 900, color: C.text }}>{title}</span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, lineHeight: 1.6, maxWidth: 460 }}>{sub}</span>
    </div>
  );
}

function ProjectCard({ p, he }: { p: MgmtProject; he: boolean }) {
  const Icon = PROJECT_ICON[p.slug] || Building2;
  const statusHe = p.status === "active" ? "פעיל" : p.status === "paused" ? "מושהה" : "בארכיון";
  const statusTint = p.status === "active" ? C.gain : p.status === "paused" ? C.gold : C.faint;
  return (
    <div style={card()}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <span style={{ width: 42, height: 42, borderRadius: 13, flexShrink: 0, display: "grid", placeItems: "center",
          background: `${C.blue}16`, border: `1px solid ${C.blue}40` }}>
          <Icon size={20} color={C.blue} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14.5, fontWeight: 900, color: C.text }}>{he ? p.nameHe : p.nameEn}</span>
          <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: C.faint, direction: "ltr", textAlign: he ? "right" : "left" }}>
            {he ? p.nameEn : p.nameHe}
          </span>
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 11 }}>
        <Chip text={he ? statusHe : p.status} tint={statusTint} />
        {p.ownerOnly && <Chip text={he ? "בעלים בלבד · 3-מ-3" : "Owner-only · 3-of-3"} tint={C.gold} />}
        {p.slug === "execution" && <Chip text={he ? "פרויקט #1 · DISARMED" : "Project #1 · DISARMED"} tint={C.blue} />}
        <Chip text={p.members.length
          ? (he ? `${p.members.length} משויכים` : `${p.members.length} scoped`)
          : (he ? "אין שיוכים עדיין" : "no scopes yet")} tint={p.members.length ? C.gain : C.faint} />
      </div>
      {p.members.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {p.members.map((m) => (
            <Chip key={m.username} text={`${m.username} · ${m.scopeRole}`} tint={C.blue} />
          ))}
        </div>
      )}
    </div>
  );
}

const SCOPE_ROLE_META: Record<string, { he: string; en: string }> = {
  operator: { he: "מפעיל", en: "operator" }, editor: { he: "עורך", en: "editor" }, viewer: { he: "צופה", en: "viewer" },
};

function TeamRows({ team, projects, he, rtl }: { team: MgmtTeamRow[]; projects: MgmtProject[]; he: boolean; rtl: boolean }) {
  const qc = useQueryClient();
  const inval = () => qc.invalidateQueries({ queryKey: ["mgmtConsole"] });
  const [err, setErr] = useState("");
  const grant = useMutation({ mutationFn: (b: { username: string; projectId: number; scopeRole: string }) => api.mgmtScopeGrant(b),
    onSuccess: () => { setErr(""); inval(); }, onError: (e: any) => setErr(e?.message || "Failed") });
  const revoke = useMutation({ mutationFn: (v: { username: string; projectId: number }) => api.mgmtScopeRevoke(v.username, v.projectId),
    onSuccess: inval, onError: (e: any) => setErr(e?.message || "Failed") });

  // Grant form state
  const grantable = projects.filter((p) => !p.ownerOnly);   // owner-only projects aren't scope-granted
  const [gUser, setGUser] = useState("");
  const [gProj, setGProj] = useState<number>(grantable[0]?.id || 0);
  const [gRole, setGRole] = useState("viewer");
  const projName = (id: number) => { const p = projects.find((x) => x.id === id); return p ? (he ? p.nameHe : p.nameEn) : `#${id}`; };

  const sel: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 10px", color: C.text, fontFamily: UI, fontSize: 13 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {err && <div style={{ ...card({ padding: "10px 13px" }), color: C.loss, fontSize: 12.5, fontWeight: 700 }}>{err}</div>}

      {/* GRANT form — owner assigns a user to a project with a role */}
      <div style={{ ...card(), display: "flex", flexWrap: "wrap", gap: 9, alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 140 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.muted }}>{he ? "משתמש" : "User"}</span>
          <select value={gUser} onChange={(e) => setGUser(e.target.value)} style={sel}>
            <option value="">{he ? "בחר…" : "Select…"}</option>
            {team.map((t) => <option key={t.username} value={t.username}>{t.username}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.muted }}>{he ? "פרויקט" : "Project"}</span>
          <select value={gProj} onChange={(e) => setGProj(Number(e.target.value))} style={sel}>
            {grantable.map((p) => <option key={p.id} value={p.id}>{he ? p.nameHe : p.nameEn}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.muted }}>{he ? "תפקיד" : "Role"}</span>
          <select value={gRole} onChange={(e) => setGRole(e.target.value)} style={sel}>
            {["operator", "editor", "viewer"].map((r) => <option key={r} value={r}>{he ? SCOPE_ROLE_META[r].he : SCOPE_ROLE_META[r].en}</option>)}
          </select>
        </label>
        <button disabled={!gUser || !gProj || grant.isPending} className="tap44"
          onClick={() => grant.mutate({ username: gUser, projectId: gProj, scopeRole: gRole })}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: gUser ? C.gold : C.surface2,
            color: gUser ? "#16110a" : C.faint, border: `1px solid ${gUser ? C.gold : C.line}`, borderRadius: 10, padding: "9px 15px",
            fontWeight: 900, fontSize: 12.5, cursor: gUser ? "pointer" : "not-allowed", fontFamily: UI }}>
          {grant.isPending ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} {he ? "שייך" : "Grant"}
        </button>
      </div>

      {team.map((t) => {
        const meta = LAYER_META[t.layer] || LAYER_META["1_client"];
        const tint = meta.tint();
        return (
          <div key={t.username} style={{ ...card({ padding: "11px 13px" }), display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text, direction: "ltr" }}>{t.username}</span>
            <span style={{ marginInlineStart: "auto", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {t.scopes.map((s) => (
                <button key={s.projectId} onClick={() => revoke.mutate({ username: t.username, projectId: s.projectId })}
                  title={he ? "לחץ להסרה" : "click to revoke"} className="tap44"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 900, color: C.blue,
                    background: `${C.blue}16`, border: `1px solid ${C.blue}44`, borderRadius: 999, padding: "3px 9px", cursor: "pointer", fontFamily: UI }}>
                  {projName(s.projectId)} · {he ? (SCOPE_ROLE_META[s.scopeRole]?.he || s.scopeRole) : s.scopeRole} <X size={11} />
                </button>
              ))}
              <Chip text={he ? meta.he : meta.en} tint={tint} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Approvals (P2.4) — the 3-of-3 queue over the isolated exec DB ────────────
// Governance records ONLY: creating/approving/rejecting a request changes a row +
// an audit line. NOTHING executes from here — an approved request just waits for
// the (future, gated) worker. When the exec DB isn't wired (available:false) the
// tab shows the honest empty state.

const ACTION_META: Record<string, { he: string; en: string }> = {
  fund_deposit: { he: "הפקדה לקרן", en: "Fund deposit" },
  fund_withdrawal: { he: "משיכה מהקרן", en: "Fund withdrawal" },
  arm_testnet: { he: "חימוש טסטנט", en: "Arm testnet" },
  policy_change: { he: "שינוי מדיניות/caps", en: "Policy change" },
  other: { he: "אחר", en: "Other" },
};
const STATUS_META: Record<string, { he: string; en: string; tint: () => string }> = {
  pending: { he: "ממתין", en: "Pending", tint: () => C.gold },
  approved: { he: "מאושר 3-מ-3", en: "Approved 3-of-3", tint: () => C.gain },
  rejected: { he: "נדחה", en: "Rejected", tint: () => C.loss },
  expired: { he: "פג תוקף", en: "Expired", tint: () => C.faint },
  executed: { he: "בוצע", en: "Executed", tint: () => C.blue },
};

function ApprovalsTab({ he, rtl }: { he: boolean; rtl: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["mgmtApprovals"], queryFn: () => api.mgmtApprovals(), staleTime: 15000, retry: false });
  const inval = () => qc.invalidateQueries({ queryKey: ["mgmtApprovals"] });
  const [err, setErr] = useState("");
  const onErr = (e: any) => setErr(e?.message || "Failed");
  const ok = () => { setErr(""); inval(); };
  const approve = useMutation({ mutationFn: (ref: string) => api.mgmtApprovalApprove(ref), onSuccess: ok, onError: onErr });
  const rejectM = useMutation({ mutationFn: (ref: string) => api.mgmtApprovalReject(ref), onSuccess: ok, onError: onErr });
  const create = useMutation({ mutationFn: (b: { action: string; payload?: Record<string, unknown>; expiresHours?: number }) => api.mgmtApprovalCreate(b), onSuccess: () => { ok(); setAdding(false); }, onError: onErr });
  const [adding, setAdding] = useState(false);
  const [action, setAction] = useState("fund_deposit");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  if (q.isLoading) return <div style={{ display: "grid", placeItems: "center", minHeight: 120 }}><Loader2 size={20} className="spin" color={C.gold} /></div>;
  const data = q.data;

  if (!data || data.available === false) {
    return (
      <EmptyNote Icon={ShieldCheck}
        title={he ? "תור ה-3-מ-3 מוכן — ממתין לחיבור שירות-הביצוע" : "The 3-of-3 queue is ready — waiting for the execution service"}
        sub={he
          ? "הממשק והחיווט קיימים. ברגע שבסיס-הנתונים המבודד של שירות-הביצוע יוקם בפרודקשן (משתנה סביבה ייעודי, הרשאות governance בלבד), הבקשות יופיעו כאן. שום דבר לא מבוצע מהמסך הזה — אישור הוא רישום בלבד."
          : "The UI + wiring exist. Once the isolated execution-service DB is provisioned in production (dedicated env var, governance-only grants), requests appear here. Nothing executes from this screen — approval is a record only."} />
    );
  }

  const actLbl = (a: string) => { const m = ACTION_META[a]; return m ? (he ? m.he : m.en) : a; };
  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString(he ? "he-IL" : "en-GB", { dateStyle: "short", timeStyle: "short" }) : "—");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {err && <div style={{ ...card({ padding: "10px 13px" }), color: C.loss, fontSize: 12.5, fontWeight: 700 }}>{err}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>
          {he ? "אישור = רישום בלבד. שום ביצוע לא יוצא מהמסך הזה; דחייה של בעלים אחד סוגרת בקשה." : "Approval = a record only. Nothing executes from here; one owner's rejection closes a request."}
        </span>
        <button onClick={() => setAdding((v) => !v)} className="tap44"
          style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 6, background: `${C.gold}16`,
            border: `1px solid ${C.gold}55`, color: C.gold, borderRadius: 999, padding: "8px 14px", fontSize: 12.5, fontWeight: 900, cursor: "pointer", fontFamily: UI }}>
          <Plus size={14} /> {he ? "בקשה חדשה" : "New request"}
        </button>
      </div>

      {adding && (
        <div style={{ ...card(), display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: C.muted }}>{he ? "פעולה" : "Action"}</span>
            <select value={action} onChange={(e) => setAction(e.target.value)}
              style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 10px", color: C.text, fontFamily: UI, fontSize: 13 }}>
              {(data.actions || Object.keys(ACTION_META)).map((a) => <option key={a} value={a}>{actLbl(a)}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: C.muted }}>{he ? "סכום $ (אופציונלי)" : "Amount $ (optional)"}</span>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
              style={{ width: 110, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 10px", color: C.text, fontFamily: MONO, fontSize: 13 }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 160 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: C.muted }}>{he ? "הערה" : "Note"}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)}
              style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 10px", color: C.text, fontFamily: UI, fontSize: 13 }} />
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            <button disabled={create.isPending} className="tap44"
              onClick={() => create.mutate({ action, payload: { ...(amount ? { amountUsd: Number(amount) } : {}), ...(note ? { note } : {}) }, expiresHours: 72 })}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: `${C.gain}16`, border: `1px solid ${C.gain}55`, color: C.gain, borderRadius: 10, padding: "9px 14px", fontWeight: 900, fontSize: 12.5, cursor: "pointer", fontFamily: UI }}>
              {create.isPending ? <Loader2 size={14} className="spin" /> : <Check size={14} />} {he ? "פתח בקשה (תוקף 72ש')" : "Open request (72h)"}
            </button>
            <button onClick={() => setAdding(false)} className="tap44"
              style={{ display: "inline-flex", alignItems: "center", background: C.surface, border: `1px solid ${C.line}`, color: C.muted, borderRadius: 10, padding: "9px 11px", cursor: "pointer" }}><X size={14} /></button>
          </div>
        </div>
      )}

      {data.requests.length === 0 && !adding && (
        <EmptyNote Icon={ShieldCheck} title={he ? "אין בקשות" : "No requests"}
          sub={he ? "כשבעלים יפתח בקשה על הון-הבעלים היא תופיע כאן ותמתין ל-3 אישורים." : "When an owner opens an owner-capital request it appears here awaiting 3 approvals."} />
      )}

      {data.requests.map((r: MgmtApproval) => {
        const sm = STATUS_META[r.status] || STATUS_META.pending;
        const tint = sm.tint();
        const amountUsd = (r.payload as any)?.amountUsd;
        return (
          <div key={r.ref} style={card()}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, fontWeight: 900, color: C.text }}>{actLbl(r.action)}</span>
              {amountUsd != null && <span style={{ fontFamily: MONO, fontWeight: 900, color: C.gold, fontSize: 13.5 }}>${Number(amountUsd).toLocaleString()}</span>}
              <span style={{ marginInlineStart: "auto" }}><Chip text={he ? sm.he : sm.en} tint={tint} /></span>
            </div>
            <div style={{ marginTop: 7, fontSize: 11.5, fontWeight: 600, color: C.muted, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <span>{he ? "ביקש:" : "By:"} <b style={{ color: C.text }}>{r.requestedBy}</b></span>
              <span>{fmtDate(r.requestedAt)}</span>
              {r.expiresAt && r.status === "pending" && <span>{he ? "פג:" : "Expires:"} {fmtDate(r.expiresAt)}</span>}
              {(r.payload as any)?.note && <span style={{ color: C.faint }}>{String((r.payload as any).note)}</span>}
            </div>
            <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {[0, 1, 2].map((i) => {
                const a = r.approvals[i];
                return a ? <Chip key={i} text={`✓ ${a.owner}`} tint={C.gain} />
                  : <Chip key={i} text={he ? "ממתין" : "waiting"} tint={C.faint} />;
              })}
              {r.status === "pending" && (
                <span style={{ marginInlineStart: "auto", display: "flex", gap: 6 }}>
                  <button onClick={() => approve.mutate(r.ref)} disabled={approve.isPending} className="tap44"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, background: `${C.gain}16`, border: `1px solid ${C.gain}55`, color: C.gain, borderRadius: 999, padding: "7px 13px", fontSize: 12, fontWeight: 900, cursor: "pointer", fontFamily: UI }}>
                    <Check size={13} /> {he ? "אשר" : "Approve"}
                  </button>
                  <button onClick={() => rejectM.mutate(r.ref)} disabled={rejectM.isPending} className="tap44"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, background: `${C.loss}12`, border: `1px solid ${C.loss}55`, color: C.loss, borderRadius: 999, padding: "7px 13px", fontSize: 12, fontWeight: 900, cursor: "pointer", fontFamily: UI }}>
                    <ThumbsDown size={13} /> {he ? "דחה" : "Reject"}
                  </button>
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function MgmtConsole({ he, rtl, goto }: { he: boolean; rtl: boolean; goto: (tab: string) => void }) {
  const [section, setSection] = useState<Section>("dashboard");
  const q = useQuery({ queryKey: ["mgmtConsole"], queryFn: () => api.mgmtConsole(), staleTime: 30000 });

  if (q.isLoading) {
    return <div style={{ display: "grid", placeItems: "center", minHeight: 180 }}><Loader2 size={22} className="spin" color={C.gold} /></div>;
  }
  const data = (q.data || { projects: [], team: [] }) as MgmtData;
  // Layer-1 clients stay OUT of the console's team list — this is the management
  // shell, not the user base. (They still exist in the data model as layer 1.)
  const staff = data.team.filter((t) => t.layer !== "1_client");
  const clients = data.team.length - staff.length;

  const SECTIONS: { id: Section; he: string; en: string; Icon: any }[] = [
    { id: "dashboard", he: "לוח", en: "Dashboard", Icon: Building2 },
    { id: "team", he: "צוות", en: "Team", Icon: Users },
    { id: "approvals", he: "אישורים", en: "Approvals", Icon: ClipboardCheck },
    { id: "reports", he: "דוחות", en: "Reports", Icon: FileText },
    { id: "budget", he: "תקציב", en: "Budget", Icon: Coins },
  ];

  // Link-cards that route into EXISTING owner surfaces (no duplicated data here).
  const linkCard = (Icon: any, title: string, sub: string, onClick: () => void) => (
    <button onClick={onClick} className="tap44"
      style={{ ...card({ padding: "13px 14px" }), display: "flex", alignItems: "center", gap: 11, width: "100%",
        textAlign: rtl ? "right" : "left", cursor: "pointer", fontFamily: UI }}>
      <span style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, display: "grid", placeItems: "center",
        background: `${C.gold}16`, border: `1px solid ${C.gold}44` }}>
        <Icon size={19} color={C.gold} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 900, color: C.text }}>{title}</span>
        <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: C.muted }}>{sub}</span>
      </span>
      {rtl ? <ChevronLeft size={16} color={C.faint} /> : <ChevronRight size={16} color={C.faint} />}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: UI }}>
      <Segmented<Section> value={section} onChange={setSection}
        options={SECTIONS.map((s) => ({
          value: s.id,
          label: (<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><s.Icon size={14} /> {he ? s.he : s.en}</span>),
        }))} />

      {section === "dashboard" && (
        <>
          {/* HUB — the console is the central home; quick access to every owner area. */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.faint, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 9 }}>
              {he ? "גישה מהירה" : "Quick access"}
            </div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 104px), 1fr))" }}>
              {([
                { id: "fund", he: "הקרן", en: "Fund", Icon: Landmark, tint: C.gold },
                { id: "finance", he: "כספים", en: "Finance", Icon: Coins, tint: C.gain },
                { id: "daily", he: "עדכון יומי", en: "Daily", Icon: Sunrise, tint: C.blue },
                { id: "board", he: "לוח משימות", en: "Board", Icon: FileText, tint: C.blue },
                { id: "results", he: "תוצאות", en: "Results", Icon: Trophy, tint: C.gold },
                { id: "employees", he: "עובדים", en: "Employees", Icon: Users, tint: C.gain },
                { id: "autopilots", he: "טייסים", en: "AutoPilots", Icon: Rocket, tint: C.blue },
                { id: "all", he: "כל המערכת", en: "All", Icon: Building2, tint: C.faint },
              ] as const).map((t) => (
                <button key={t.id} onClick={() => goto(t.id)} className="tap44"
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, background: C.surface,
                    border: `1px solid ${C.line}`, borderRadius: 16, padding: "13px 8px", cursor: "pointer", fontFamily: UI,
                    boxShadow: "0 10px 24px -22px rgba(0,0,0,0.5)" }}>
                  <span style={{ width: 42, height: 42, borderRadius: 13, display: "grid", placeItems: "center",
                    background: `${t.tint}1e`, border: `1px solid ${t.tint}44` }}>
                    <t.Icon size={19} color={t.tint} />
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: C.text, textAlign: "center", lineHeight: 1.2 }}>{he ? t.he : t.en}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Chip text={he ? `${data.projects.length} פרויקטים` : `${data.projects.length} projects`} tint={C.blue} />
            <Chip text={he ? `${staff.length} בצוות` : `${staff.length} staff`} tint={C.gain} />
            <Chip text={he ? `${clients} לקוחות (שכבה 1)` : `${clients} clients (layer 1)`} tint={C.muted} />
          </div>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))" }}>
            {data.projects.map((p) => <ProjectCard key={p.id} p={p} he={he} />)}
          </div>
          <ComplianceCard he={he} rtl={rtl} />
        </>
      )}

      {section === "team" && (
        <>
          <TeamRows team={staff} projects={data.projects} he={he} rtl={rtl} />
          <div style={{ ...card({ padding: "12px 14px" }), display: "flex", alignItems: "center", gap: 10 }}>
            <Lock size={16} color={C.gold} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.55 }}>
              {he ? "שיוך לפרויקט הוא קליק של בעלים (למעלה). לחיצה על תג-שיוך מסירה אותו. פרויקטים 'בעלים בלבד' אינם ניתנים לשיוך — הגישה אליהם לפי שכבת-הבעלים."
                  : "Scoping is an owner's click (above). Tap a scope chip to revoke it. Owner-only projects aren't grantable — access there is by owner layer."}
            </span>
          </div>
        </>
      )}

      {section === "approvals" && <ApprovalsTab he={he} rtl={rtl} />}

      {section === "reports" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {linkCard(Sunrise, he ? "עדכון יומי" : "Daily update", he ? "סיכום בוקר + פריטים לטיפול" : "Morning summary + attention items", () => goto("daily"))}
          {linkCard(Trophy, he ? "תוצאות הצבעות" : "Vote results", he ? "החלטות והצבעות השותפים" : "Partners' decisions + votes", () => goto("results"))}
          {linkCard(Coins, he ? "דוח כספים" : "Finance report", he ? "תקציב, הוצאות, הכנסות והשקעות" : "Budget, expenses, revenue + investments", () => goto("finance"))}
          <div style={{ ...card({ padding: "12px 14px" }), fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.55 }}>
            {he ? "דוחות ביצוע/reconciliation לפרויקט הביצוע יתווספו כשהשירות יחובר (P2.4+); דוחות הקרן — owner-only — ב-P3."
                : "Execution/reconciliation reports join when the service is wired (P2.4+); fund reports — owner-only — in P3."}
          </div>
        </div>
      )}

      {section === "budget" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {linkCard(Coins, he ? "כספי החברה" : "Company finance", he ? "תקציב והוצאות — המודול הקיים" : "Budget + expenses — the existing module", () => goto("finance"))}
          <div style={{ ...card({ padding: "12px 14px" }), display: "flex", alignItems: "center", gap: 10 }}>
            <Lock size={16} color={C.gold} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.55 }}>
              {he ? "תקרות ביצוע (caps) לפרויקט הביצוע מנוהלות בצד-השרת של השירות המבודד ויוצגו כאן בשלב P4 — קריאה בלבד, בלי מגע בכסף."
                  : "Execution caps live server-side in the isolated service and will surface here (read-only) in P4 — nothing touches money."}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
