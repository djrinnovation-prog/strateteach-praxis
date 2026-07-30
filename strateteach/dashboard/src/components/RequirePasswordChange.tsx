import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Languages, CheckCircle2, LogOut } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";
import BootSplash from "./BootSplash";
import { PasswordInput, input, errBox } from "../ui";

/** Mandatory gate: when an admin resets a user's password with "force change on
 * next login", the account is flagged server-side. On the next login this gate
 * sends the user STRAIGHT to a set-new-password screen and blocks everything
 * else until they pick one (which clears the flag on the server). Clean and
 * direct — they enter a new password twice and they're in. */
export default function RequirePasswordChange({ onLogout, children }: { onLogout?: () => void; children: React.ReactNode }) {
  const { lang, rtl, setLang } = useI18n();
  const qc = useQueryClient();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");

  // The authoritative source for the flag — covers every login path (password,
  // demo link, welcome link, refresh), since they all resolve through /auth/me.
  // staleTime matches the boot warm-up so this reuses the single /auth/me already
  // fetched at startup instead of firing a duplicate on mount.
  const q = useQuery({ queryKey: ["mustChangePw"], queryFn: () => api.me(), retry: false, staleTime: 60_000 });

  const m = useMutation({
    mutationFn: () => api.setNewPassword(pw),
    onSuccess: () => { setErr(""); setPw(""); setPw2(""); qc.invalidateQueries({ queryKey: ["mustChangePw"] }); },
    onError: (e: any) => setErr(e?.message || String(e)),
  });

  if (q.isLoading) return <BootSplash />;
  // Pass straight through unless the account is in the forced state.
  if (!q.data || !(q.data as any).mustChangePassword) return <>{children}</>;

  const t = rtl
    ? { title: "בחרו סיסמה חדשה", sub: "מנהל איפס את הסיסמה שלך. כדי להמשיך, בחרו סיסמה חדשה.",
        ph1: "סיסמה חדשה", ph2: "אימות סיסמה חדשה", save: "שמירת סיסמה והמשך",
        tooShort: "הסיסמה חייבת להכיל לפחות 4 תווים.", mismatch: "הסיסמאות אינן תואמות.", logout: "התנתקות" }
    : { title: "Set a new password", sub: "An admin reset your password. Pick a new one to continue.",
        ph1: "New password", ph2: "Confirm new password", save: "Save & continue",
        tooShort: "Password must be at least 4 characters.", mismatch: "Passwords don't match.", logout: "Sign out" };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 4) { setErr(t.tooShort); return; }
    if (pw !== pw2) { setErr(t.mismatch); return; }
    m.mutate();
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: UI, direction: rtl ? "rtl" : "ltr", background: C.bg }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ fontSize: 13, color: C.muted }}>{t.sub}</div>
        <button type="button" onClick={() => setLang(lang === "he" ? "en" : "he")}
          style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: `1px solid ${C.line}`, color: C.muted, borderRadius: 8, padding: "5px 9px", cursor: "pointer", fontFamily: UI, fontSize: 12 }}>
          <Languages size={14} /> {lang === "he" ? "EN" : "עב"}
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 18px" }}>
        <form onSubmit={submit} style={{ width: "100%", maxWidth: 380, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 22, boxShadow: "0 18px 40px rgba(0,0,0,0.35)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ width: 34, height: 34, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
              background: "linear-gradient(135deg,#FBC02D,#F7931A 55%,#7CC04E)" }}>
              <KeyRound size={17} color="#0B0613" />
            </span>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>{t.title}</div>
          </div>
          <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 16 }}>{t.sub}</div>

          {err && <div style={errBox}>{err}</div>}

          <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t.ph1} autoFocus
            style={{ ...input, marginBottom: 10 }} />
          <PasswordInput value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder={t.ph2}
            style={{ ...input, marginBottom: 16 }} />

          <button type="submit" disabled={m.isPending}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, background: "#1faa55", border: "none", color: "#fff", fontWeight: 800, fontSize: 15, fontFamily: UI, borderRadius: 12, padding: "13px", cursor: m.isPending ? "default" : "pointer", opacity: m.isPending ? 0.7 : 1 }}>
            {m.isPending ? <Loader2 size={18} className="spin" /> : <CheckCircle2 size={19} />} {t.save}
          </button>

          {onLogout && (
            <button type="button" onClick={onLogout}
              style={{ width: "100%", marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: "none", border: `1px solid ${C.line}`, color: C.muted, fontWeight: 700, fontSize: 13, fontFamily: UI, borderRadius: 12, padding: "10px", cursor: "pointer" }}>
              <LogOut size={15} /> {t.logout}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
