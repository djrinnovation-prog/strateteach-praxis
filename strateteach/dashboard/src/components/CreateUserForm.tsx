import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserPlus } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C } from "../theme";
import { Field, input, btn, errBox, okBox, PasswordInput } from "../ui";

// Shared CREATE-user form (username / password / email / role / demo → api.addUser).
// Extracted so it can live in BOTH Settings (User management) AND the Admin panel's
// "Users & access" — one source of truth, no duplicated logic (step 1 of the "everything
// under one Settings" consolidation). Self-contained: own state + mutation; invalidates
// the ["users"] query so any user list refreshes. Main-admin gating is the PARENT's job
// (the backend endpoint stays require_main_admin regardless of the UI).
const L = {
  he: { username: "שם משתמש", password: "סיסמה", email: "אימייל", optional: "(אופציונלי)", role: "תפקיד",
        user: "משתמש", admin: "מנהל", demo: "דמו · שבוע גישה מלאה", addUser: "הוסף משתמש", added: "נוצר ✓" },
  en: { username: "Username", password: "Password", email: "Email", optional: "(optional)", role: "Role",
        user: "user", admin: "admin", demo: "Demo · 1-week full access", addUser: "Add user", added: "Created ✓" },
} as const;

export default function CreateUserForm({ onCreated }: { onCreated?: () => void } = {}) {
  const { lang } = useI18n();
  const t = L[lang];
  const qc = useQueryClient();
  const [nu, setNu] = useState(""); const [np, setNp] = useState(""); const [nr, setNr] = useState("user");
  const [nem, setNem] = useState(""); const [ndemo, setNdemo] = useState(false);
  const [ok, setOk] = useState(""); const [err, setErr] = useState("");

  const addM = useMutation({
    mutationFn: () => api.addUser(nu.trim(), np, nr, nem.trim() || undefined, ndemo),
    onSuccess: () => { setErr(""); setOk(t.added); setNu(""); setNp(""); setNem(""); setNdemo(false); qc.invalidateQueries({ queryKey: ["users"] }); onCreated?.(); },
    onError: (e: any) => { setOk(""); setErr(e?.message || "Failed"); },
  });

  return (
    <div>
      {err && <div style={errBox}>{err}</div>}
      {ok && <div style={okBox}>{ok}</div>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
        <Field label={t.username}><input value={nu} onChange={(e) => setNu(e.target.value)} style={{ ...input, width: 150 }} /></Field>
        <Field label={t.password}><PasswordInput value={np} onChange={(e) => setNp(e.target.value)} style={{ ...input, width: 150 }} /></Field>
        <Field label={`${t.email} ${t.optional}`}><input type="email" value={nem} onChange={(e) => setNem(e.target.value)} placeholder="name@example.com" style={{ ...input, width: 190 }} /></Field>
        <Field label={t.role}><select value={nr} onChange={(e) => setNr(e.target.value)} style={{ ...input, width: 110 }}><option value="user">{t.user}</option><option value="admin">{t.admin}</option></select></Field>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: nr === "admin" ? C.faint : C.text, cursor: nr === "admin" ? "not-allowed" : "pointer", paddingBottom: 8, fontWeight: 600 }}>
          <input type="checkbox" checked={ndemo && nr !== "admin"} disabled={nr === "admin"} onChange={(e) => setNdemo(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.gold }} />
          {t.demo}
        </label>
        <button onClick={() => { setErr(""); addM.mutate(); }} disabled={addM.isPending || !nu || !np} className="gbtn ptile" style={{ ...btn(true), whiteSpace: "nowrap" }}>
          {addM.isPending ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />} {t.addUser}
        </button>
      </div>
    </div>
  );
}
