import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck, Cake, Contact, Wallet, Gift, Loader2, Save, Check,
  ChevronDown, ExternalLink, Send,
} from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C } from "../theme";
import { input, btn } from "../ui";
import BonusProgramShowcase from "./BonusProgramShowcase";
import type { Employee, EmployeePayment } from "../lib/client";

// ── EmployeeMiniPanel — the employee's OWN card, shown in /me. They self-edit birthday /
// contact / sub-account, VIEW their payments (read-only ledger the owners recorded), and can
// join the bonus program (glowing CTA → explainer → sub-account setup + send wallet to owners).
// Owner-managed fields (role/domains/status/salary) are read-only here. Renders nothing for a
// non-employee. Money-safe: records only — no funding moves (that's phase 3).
const PTYPE: Record<string, { he: string; en: string }> = {
  salary: { he: "משכורת", en: "Salary" }, bonus: { he: "בונוס", en: "Bonus" },
  expense: { he: "הוצאה", en: "Expense" }, addition: { he: "תוספת", en: "Addition" },
};
const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function EmployeeMiniPanel() {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["myEmployee"], queryFn: () => api.myEmployee(), retry: false });
  const emp = q.data?.employee || null;
  const payments = (q.data?.payments || []) as EmployeePayment[];

  const [birthday, setBirthday] = useState("");
  const [contact, setContact] = useState("");
  const [sub, setSub] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showBonus, setShowBonus] = useState(false);
  React.useEffect(() => {
    if (emp && !loaded) { setBirthday(emp.birthday || ""); setContact(emp.contact || ""); setSub(emp.subaccountDetails || ""); setLoaded(true); }
  }, [emp, loaded]);

  const inval = () => qc.invalidateQueries({ queryKey: ["myEmployee"] });
  const save = useMutation({ mutationFn: () => api.myEmployeeUpdate({ birthday, contact, subaccountDetails: sub }), onSuccess: inval });

  if (q.isLoading || !emp) return null; // not an employee → nothing

  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 5, display: "block" };
  const paid = payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const pending = payments.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount, 0);
  const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, boxShadow: "0 8px 26px rgba(0,0,0,.07)" };

  return (
    <div style={{ direction: rtl ? "rtl" : "ltr", display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{`@keyframes empBonusGlow{0%,100%{box-shadow:0 0 0 0 ${C.gold}66, 0 8px 22px ${C.gold}3d}50%{box-shadow:0 0 22px 5px ${C.gold}a6, 0 10px 30px ${C.gold}66}}`}</style>

      {/* header + read-only owner fields */}
      <div style={card}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 900, color: C.text, marginBottom: 12 }}>
          <BadgeCheck size={18} color={C.gold} /> {he ? "כרטיס העובד שלי" : "My employee card"}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          <ReadOnly label={he ? "תפקיד" : "Role"} value={emp.role || "—"} />
          <ReadOnly label={he ? "תחומים" : "Domains"} value={(emp.workDomains || []).join(", ") || "—"} />
          <ReadOnly label={he ? "סטטוס" : "Status"} value={emp.status} />
          <ReadOnly label={he ? "משכורת חודשית" : "Monthly salary"} value={money(emp.monthlySalary) + (emp.bonusAccount ? (he ? " · בונוס" : " · bonus") : "")} />
        </div>
        <div style={{ fontSize: 10.5, color: C.faint, marginTop: 10 }}>{he ? "שדות אלה מנוהלים ע\"י הבעלים (לצפייה בלבד)." : "These fields are owner-managed (read-only)."}</div>
      </div>

      {/* self-edit: birthday / contact / sub-account */}
      <div style={card}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 800, color: C.text, marginBottom: 14 }}>
          <Contact size={16} color={C.gold} /> {he ? "הפרטים שלי" : "My details"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <div><label style={lbl}><Cake size={12} /> {he ? "יום הולדת" : "Birthday"}</label>
            <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} style={{ ...input, width: "100%", boxSizing: "border-box" }} /></div>
          <div><label style={lbl}>{he ? "פרטי קשר" : "Contact details"}</label>
            <input value={contact} onChange={(e) => setContact(e.target.value)} dir={rtl ? "rtl" : "ltr"} placeholder={he ? "טלפון / אימייל" : "Phone / email"} style={{ ...input, width: "100%", boxSizing: "border-box" }} /></div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={lbl}>{he ? "פרטי תת-חשבון (מסחר)" : "Sub-account details (trading)"}</label>
          <textarea value={sub} onChange={(e) => setSub(e.target.value)} dir={rtl ? "rtl" : "ltr"} rows={2}
            placeholder={he ? "מזהה תת-חשבון / הערות" : "Sub-account id / notes"} style={{ ...input, width: "100%", boxSizing: "border-box", lineHeight: 1.5, resize: "vertical" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
          <button onClick={() => save.mutate()} disabled={save.isPending} style={{ ...btn(true) }}>
            {save.isPending ? <Loader2 size={15} className="spin" /> : <Save size={15} />} {he ? "שמור" : "Save"}
          </button>
          {save.isSuccess && <span style={{ fontSize: 12.5, fontWeight: 700, color: C.gain }}>{he ? "נשמר ✓" : "Saved ✓"}</span>}
        </div>
      </div>

      {/* payments — read-only ledger */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 800, color: C.text }}>
            <Wallet size={16} color={C.gold} /> {he ? "התשלומים שלי" : "My payments"}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.faint }}>{he ? "שולם" : "Paid"} <b style={{ color: C.gain }}>{money(paid)}</b> · {he ? "ממתין" : "Pending"} <b style={{ color: C.gold }}>{money(pending)}</b></div>
        </div>
        {payments.length === 0 ? <div style={{ fontSize: 12.5, color: C.faint }}>{he ? "אין עדיין תשלומים." : "No payments yet."}</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {payments.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 11px", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: C.text, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 999, padding: "2px 9px" }}>{he ? (PTYPE[p.type]?.he || p.type) : (PTYPE[p.type]?.en || p.type)}</span>
                <span style={{ fontSize: 13.5, fontWeight: 900, color: C.gold }}>{money(p.amount)}</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: p.status === "paid" ? C.gain : C.gold }}>{p.status === "paid" ? (he ? "שולם" : "Paid") : (he ? "ממתין" : "Pending")}</span>
                <span style={{ fontSize: 11, color: C.faint }}>{p.date || "—"}</span>
                {p.note && <span style={{ fontSize: 11.5, color: C.muted }}>· {p.note}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bonus program — the stunning owner-defined presentation shown TOGETHER with the
          status-aware join CTA (or, once active, the member's own live numbers). */}
      <BonusSection emp={emp} he={he} rtl={rtl} showBonus={showBonus} setShowBonus={setShowBonus} onSaved={inval} />
    </div>
  );
}

// ── the bonus block: always-on beautiful presentation + status-aware action zone ──
function BonusSection({ emp, he, rtl, showBonus, setShowBonus, onSaved }: {
  emp: Employee; he: boolean; rtl: boolean; showBonus: boolean; setShowBonus: (v: boolean) => void; onSaved: () => void;
}) {
  const defQ = useQuery({ queryKey: ["bonusProgramDef"], queryFn: () => api.bonusProgramDef() });
  const def = defQ.data?.definition;
  const status = emp.program.status;
  const active = status === "active";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* the read-only presentation (owner-editable) — overlays the member's own numbers when active */}
      {def && <BonusProgramShowcase def={def} he={he} rtl={rtl} mine={active ? emp.program : null} />}

      {/* action zone */}
      {active ? null : status === "requested" ? (
        <div style={{ background: `${C.gold}12`, border: `1px solid ${C.gold}66`, borderRadius: 16, padding: 18 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 900, color: C.gold, marginBottom: 6 }}>
            <Gift size={17} /> {he ? "בקשת ההצטרפות נשלחה — ממתינה לאישור הבעלים" : "Join request sent — pending owner approval"}
          </div>
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6 }}>
            {he ? "מסרת את פרטי תת-החשבון והארנק. הבעלים יאשרו, ירשמו את ההפקדה ההתחלתית והתוכנית תופעל." : "You've submitted your sub-account + wallet. The owners will approve, record the initial deposit, and the program will activate."}
          </div>
          <button onClick={() => setShowBonus(!showBonus)} style={{ marginTop: 12, ...linkBtn }}>{he ? (showBonus ? "הסתר פרטים" : "עדכון פרטים / שליחה מחדש") : (showBonus ? "Hide" : "Update details / re-send")}</button>
          {showBonus && <div style={{ marginTop: 12 }}><JoinAction emp={emp} he={he} rtl={rtl} onSaved={onSaved} /></div>}
        </div>
      ) : !showBonus ? (
        <button onClick={() => setShowBonus(true)}
          style={{ animation: "empBonusGlow 2.2s ease-in-out infinite", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9,
            background: C.accentGrad, color: "#0B0613", border: "none", borderRadius: 14, padding: "16px 22px", fontSize: 15.5, fontWeight: 900,
            cursor: "pointer", fontFamily: "inherit", alignSelf: "stretch" }}>
          <Gift size={19} /> {he ? "הצטרפות לתוכנית הבונוס ✨" : "Join the bonus program ✨"}
        </button>
      ) : (
        <JoinAction emp={emp} he={he} rtl={rtl} onSaved={onSaved} onClose={() => setShowBonus(false)} />
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = { background: "none", border: "none", color: C.gold, fontWeight: 800, fontSize: 12.5, cursor: "pointer", padding: 0, fontFamily: "inherit" };

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, color: C.faint, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{value}</div>
    </div>
  );
}

// ── the join ACTION — sub-account setup link + send-wallet to owners. The "how it works"
// explanation now lives in the shared BonusProgramShowcase (owner-editable), so this is just
// the actionable step: set up the sub-account, then send your wallet address to the owners. ──
function JoinAction({ emp, he, rtl, onSaved, onClose }: { emp: Employee; he: boolean; rtl: boolean; onSaved: () => void; onClose?: () => void }) {
  const [wallet, setWallet] = useState(emp.walletAddress || "");
  const [sent, setSent] = useState(false);
  const send = useMutation({ mutationFn: () => api.myEmployeeWallet(wallet.trim()), onSuccess: () => { setSent(true); onSaved(); } });

  return (
    <div style={{ direction: rtl ? "rtl" : "ltr", background: `linear-gradient(165deg, ${C.surface} 0%, ${C.gold}0f 100%)`, border: `1px solid ${C.gold}66`, borderRadius: 18, padding: 20, boxShadow: `0 12px 34px ${C.gold}2e` }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 900, color: C.text, marginBottom: 14 }}>
        <Gift size={18} color={C.gold} /> {he ? "הצטרפות — שני צעדים" : "Join — two steps"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <a href="/exchange" style={{ ...btn(false), textDecoration: "none", justifyContent: "center" }}>
          <ExternalLink size={15} /> {he ? "1 · הגדרת תת-החשבון (בורסה)" : "1 · Set up your sub-account (Exchange)"}
        </a>
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 800, color: C.muted, marginBottom: 6, display: "block" }}>{he ? "2 · כתובת ארנק — לשליחה לבעלים" : "2 · Wallet address — to send to the owners"}</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={wallet} onChange={(e) => { setWallet(e.target.value); setSent(false); }} dir="ltr" placeholder="0x… / wallet address"
              style={{ ...input, flex: 1, minWidth: 200, boxSizing: "border-box", fontSize: 12.5 }} />
            <button onClick={() => send.mutate()} disabled={send.isPending || !wallet.trim()} style={{ ...btn(true) }}>
              {send.isPending ? <Loader2 size={15} className="spin" /> : sent ? <Check size={15} /> : <Send size={15} />} {sent ? (he ? "נשלח" : "Sent") : (he ? "שלח לבעלים" : "Send to owners")}
            </button>
          </div>
          {sent && <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, color: C.gain }}>{he ? "הכתובת נשלחה לבעלים ✓ — הם יחזרו אליך להמשך." : "Sent to the owners ✓ — they'll follow up to continue."}</div>}
          <div style={{ fontSize: 10.5, color: C.faint, marginTop: 8 }}>{he ? "בשלב זה רק רישום הכתובת — אין העברת כספים. המימון בפועל יתואם מול הבעלים." : "For now this only records the address — no funds move. Actual funding is coordinated with the owners."}</div>
        </div>
      </div>
      {onClose && <button onClick={onClose} style={{ ...btn(false), marginTop: 14 }}><ChevronDown size={15} /> {he ? "סגור" : "Close"}</button>}
    </div>
  );
}
