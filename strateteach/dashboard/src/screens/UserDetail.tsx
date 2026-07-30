import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { UserSearch, Loader2, Clock, Shield, Activity as ActivityIcon, History, FileSpreadsheet, Printer, KeyRound, CheckCircle2, Bot, UserCog } from "lucide-react";
import { api } from "../app/api";
import { type UserDetail as UD } from "../lib/client";
import { useI18n } from "../i18n";
import { C, UI, MONO, SHADOW } from "../theme";
import { downloadCsv, printPdf, type Cell } from "../lib/export";
import { btn, premSoft, PasswordInput, input as inputStyle, errBox, okBox } from "../ui";
import UserManageModal from "../components/UserManageModal";

// Admin "User lookup" — pick a user, see one consolidated profile: account, access,
// logins, demo stats, an audit timeline, and their runs. Read-only. Rendered inside
// the Admin hub's panel (Users & access), so it's child content.
export default function UserDetail() {
  const { lang, rtl } = useI18n();
  const TT = (en: string, he: string) => (lang === "he" ? he : en);
  const [user, setUser] = useState<string>("");
  const [manageOpen, setManageOpen] = useState(false);

  const usersQ = useQuery({ queryKey: ["adminUsers"], queryFn: () => api.listUsers() });
  const users = (usersQ.data || []) as any[];
  const q = useQuery({ queryKey: ["userDetail", user], queryFn: () => api.adminUserDetail(user), enabled: !!user });
  const d = q.data as UD | undefined;

  const fmt = (iso: string | null | undefined) => { if (!iso) return "—"; try { return new Date(iso).toLocaleString(lang === "he" ? "he-IL" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return "—"; } };
  const money = (v: number | null | undefined) => v == null ? "—" : `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const fmtDur = (s: number | null) => s == null ? "—" : s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 86400)}d`;

  const inp: React.CSSProperties = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 9, padding: "9px 11px", fontFamily: UI, fontSize: 13, maxWidth: 280 };
  const card: React.CSSProperties = { background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px", marginBottom: 12, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.14), ${SHADOW}` };
  const secTitle: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: C.gold, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 };
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5, padding: "3px 0" }}>
      <span style={{ color: C.muted }}>{k}</span><span style={{ color: C.text, fontWeight: 600, textAlign: "end", minWidth: 0 }}>{v}</span>
    </div>
  );
  // A compact headline stat tile for the summary grid.
  const Stat = ({ k, v, color }: { k: string; v: React.ReactNode; color?: string }) => (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 9, padding: "7px 9px", minWidth: 0 }}>
      <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k}</div>
      <div style={{ fontSize: 13.5, fontWeight: 800, color: color || C.text, fontFamily: MONO, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</div>
    </div>
  );

  // ── Export the currently-shown user as a flat key/value table (dependency-free:
  // CSV for Excel + print-to-PDF, shared with the rest of the app). ──
  const status = (x: UD) => x.account.isDemo ? TT("demo", "דמו") : (x.account.subscriptionStatus || TT("active", "פעיל"));
  const exportHeaders = [TT("Field", "שדה"), TT("Value", "ערך")];
  const exportRows = (x: UD): Cell[][] => [
    [TT("Username", "שם משתמש"), x.account.username],
    [TT("Nickname", "כינוי"), x.account.nickname || "—"],
    [TT("Email", "אימייל"), x.account.email || "—"],
    [TT("Phone", "טלפון"), x.account.phone || "—"],
    [TT("Role", "תפקיד"), `${x.account.role}${x.account.isMain ? " · main" : ""}`],
    [TT("Plan", "מסלול"), x.account.plan],
    [TT("Status", "סטטוס"), status(x)],
    [TT("Trading Engine", "מנוע מסחר"), x.account.profitEngineUnlocked ? TT("unlocked", "פתוח") : "—"],
    [TT("Onboarded", "אונבורדינג"), x.account.onboarded ? "✓" : "—"],
    [TT("Loyalty points", "נקודות נאמנות"), x.account.loyaltyPoints],
    [TT("Created", "נוצר"), fmt(x.account.createdAt)],
    [TT("First seen", "נראה לראשונה"), fmt(x.logins.since)],
    [TT("Last seen", "נראה לאחרונה"), fmt(x.logins.last_seen)],
    [TT("Login sessions", "התחברויות"), x.logins.sessions],
    [TT("Runs", "ריצות"), x.runs.length],
    [TT("Demo score", "ניקוד דמו"), x.demo ? `${x.demo.score ?? 0}/100` : "—"],
    [TT("Demo P&L", "רווח דמו"), x.demo ? money(x.demo.pnl) : "—"],
    [TT("Blocked screens", "מסכים חסומים"), x.access.locked.length ? x.access.locked.join(", ") : TT("none", "אין")],
    [TT("Audit entries", "רשומות ביקורת"), x.audit.length],
  ];
  const exportTitle = () => TT(`User lookup — ${user}`, `פירוט משתמש — ${user}`);
  const onExcel = () => { if (d) downloadCsv(`user_${user}`, exportHeaders, exportRows(d)); };
  const onPdf = () => { if (d) printPdf(exportTitle(), exportHeaders, exportRows(d), rtl); };

  return (
    <div style={{ fontFamily: UI, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <UserSearch size={17} color={C.gold} />
        <div style={{ fontSize: 15, fontWeight: 800 }}>{TT("User lookup", "פירוט משתמש")}</div>
        {/* Manage + export the currently-shown user (enabled once their data loads) */}
        <div style={{ marginInlineStart: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setManageOpen(true)} disabled={!d} title={TT("Manage user", "ניהול משתמש")} className="gbtn ptile"
            style={{ ...btn(true), padding: "8px 14px", fontSize: 12.5, whiteSpace: "nowrap", opacity: d ? 1 : 0.5, cursor: d ? "pointer" : "default" }}>
            <UserCog size={14} /> {TT("Manage user", "ניהול משתמש")}
          </button>
          <button onClick={onExcel} disabled={!d} title={TT("Export Excel", "ייצוא אקסל")}
            style={{ ...premSoft(), color: C.text, padding: "8px 14px", fontSize: 12.5, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 7, fontFamily: UI, opacity: d ? 1 : 0.5, cursor: d ? "pointer" : "default" }}>
            <FileSpreadsheet size={14} /> {TT("Export Excel", "ייצוא אקסל")}
          </button>
          <button onClick={onPdf} disabled={!d} title={TT("Export PDF", "ייצוא PDF")}
            style={{ ...premSoft(), color: C.text, padding: "8px 14px", fontSize: 12.5, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 7, fontFamily: UI, opacity: d ? 1 : 0.5, cursor: d ? "pointer" : "default" }}>
            <Printer size={14} /> {TT("Export PDF", "ייצוא PDF")}
          </button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>{TT("Pick a user to see their full profile, activity and runs.", "בחרו משתמש לצפייה בפרופיל, בפעילות ובריצות שלו.")}</div>

      <select value={user} onChange={(e) => setUser(e.target.value)} style={{ ...inp, marginBottom: 14 }}>
        <option value="">{TT("Choose a user…", "בחרו משתמש…")}</option>
        {users.map((u) => <option key={u.username} value={u.username}>{u.username}{u.role === "admin" ? " · admin" : ""}</option>)}
      </select>

      {!user ? null : q.isLoading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.muted, fontSize: 13, padding: "16px 0" }}><Loader2 size={15} className="spin" /> {TT("Loading…", "טוען…")}</div>
      ) : !d ? (
        <div style={{ ...card, textAlign: "center", color: C.muted }}>{TT("No data.", "אין נתונים.")}</div>
      ) : (
        <div style={{ maxHeight: "70svh", overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch", paddingInlineEnd: 2 }}>
          {/* Summary — key stats at a glance */}
          <div style={{ ...card, background: `linear-gradient(135deg, ${C.gold}14, ${C.surface2})`, borderColor: `${C.gold}55` }}>
            <div style={secTitle}><UserSearch size={13} /> {TT("Summary", "סיכום")}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{d.account.nickname || d.account.username}</div>
            <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 10 }}>{d.account.email || d.account.username}{d.account.role === "admin" ? " · admin" : ""}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(94px, 1fr))", gap: 8 }}>
              <Stat k={TT("Plan", "מסלול")} v={d.account.plan} />
              <Stat k={TT("Status", "סטטוס")} v={status(d)} />
              <Stat k={TT("Runs", "ריצות")} v={String(d.runs.length)} />
              <Stat k={TT("Demo P&L", "רווח דמו")} v={d.demo ? money(d.demo.pnl) : "—"} color={d.demo ? ((d.demo.pnl ?? 0) >= 0 ? C.gain : C.loss) : undefined} />
              <Stat k={TT("Score", "ניקוד")} v={d.demo ? String(d.demo.score ?? 0) : "—"} />
              <Stat k={TT("Sessions", "התחברויות")} v={String(d.logins.sessions)} />
              <Stat k={TT("Last seen", "נראה לאחרונה")} v={fmt(d.logins.last_seen)} />
            </div>
          </div>

          {/* Account */}
          <div style={card}>
            <div style={secTitle}><Shield size={13} /> {TT("Account", "חשבון")}</div>
            <Row k={TT("Role", "תפקיד")} v={`${d.account.role}${d.account.isMain ? " · main" : ""}`} />
            <Row k={TT("Plan", "מסלול")} v={d.account.plan} />
            <Row k={TT("Created", "נוצר")} v={`${fmt(d.account.createdAt)}${d.account.createdBy ? ` · ${d.account.createdBy}` : ""}`} />
            <Row k={TT("Email", "אימייל")} v={d.account.email || "—"} />
            {d.account.phone && <Row k={TT("Phone", "טלפון")} v={d.account.phone} />}
            {d.account.nickname && <Row k={TT("Nickname", "כינוי")} v={d.account.nickname} />}
            <Row k={TT("Trading Engine", "מנוע מסחר")} v={d.account.profitEngineUnlocked ? TT("unlocked ✓", "פתוח ✓") : "—"} />
            <Row k={TT("Onboarded", "סיים אונבורדינג")} v={d.account.onboarded ? "✓" : "—"} />
            <Row k={TT("Loyalty", "נאמנות")} v={String(d.account.loyaltyPoints)} />
            {d.account.subscriptionStatus && <Row k={TT("Subscription", "מנוי")} v={d.account.subscriptionStatus} />}
            {d.account.isDemo && <Row k={TT("Demo expires", "דמו פג")} v={fmt(d.account.demoExpires)} />}
          </div>

          {/* Reset password — admin types a new password for this user. Keyed by
              username so the fields reset when a different user is picked. */}
          {d.account.role !== "admin" && <ResetPasswordCard key={user} username={user} />}

          {/* Signal Bots — admin sees ONLY the count + sets the create limit
              (privacy-scoped: never keys, funds, balances or bot details). */}
          <SignalBotsCard key={`bots-${user}`} username={user} />

          {/* Access */}
          <div style={card}>
            <div style={secTitle}><Shield size={13} /> {TT("Screen access", "גישת מסכים")}</div>
            {d.access.locked.length === 0
              ? <div style={{ fontSize: 12.5, color: C.gain, fontWeight: 700 }}>{TT("Full access (nothing blocked)", "גישה מלאה (אין חסימות)")}</div>
              : <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{d.access.locked.map((p) => <span key={p} style={{ fontSize: 11, fontWeight: 700, color: C.loss, background: `${C.loss}1a`, border: `1px solid ${C.loss}55`, borderRadius: 7, padding: "2px 8px" }}>{p}</span>)}</div>}
          </div>

          {/* Logins + demo */}
          <div style={card}>
            <div style={secTitle}><Clock size={13} /> {TT("Activity", "פעילות")}</div>
            <Row k={TT("First seen", "נראה לראשונה")} v={fmt(d.logins.since)} />
            <Row k={TT("Last seen", "נראה לאחרונה")} v={fmt(d.logins.last_seen)} />
            <Row k={TT("Login sessions", "התחברויות")} v={String(d.logins.sessions)} />
            {d.demo && <Row k={TT("Demo score", "ניקוד דמו")} v={`${d.demo.score ?? 0}/100`} />}
            {d.demo && <Row k={TT("Demo P&L", "רווח דמו")} v={<span style={{ color: (d.demo.pnl ?? 0) >= 0 ? C.gain : C.loss, fontFamily: MONO }}>{money(d.demo.pnl)}</span>} />}
          </div>

          {/* Runs */}
          <div style={card}>
            <div style={secTitle}><ActivityIcon size={13} /> {TT("Runs", "ריצות")} · {d.runs.length}</div>
            {d.runs.length === 0 ? <div style={{ fontSize: 12, color: C.muted }}>{TT("No runs logged.", "אין ריצות מתועדות.")}</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {d.runs.slice(0, 60).map((r) => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 11.5, fontFamily: MONO }}>
                    <span style={{ fontWeight: 800, color: C.text }}>{r.symbol || "—"}</span>
                    <span style={{ color: C.faint }}>{r.mode}</span>
                    <span style={{ color: C.faint }}>{fmt(r.opened_at)} · {fmtDur(r.duration_seconds)}</span>
                    <span style={{ marginInlineStart: "auto", fontWeight: 800, color: (r.pnl ?? 0) >= 0 ? C.gain : C.loss }}>{money(r.pnl)}{r.pnl_pct != null ? ` (${r.pnl_pct >= 0 ? "+" : ""}${r.pnl_pct.toFixed(1)}%)` : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Audit timeline */}
          <div style={card}>
            <div style={secTitle}><History size={13} /> {TT("Audit timeline", "ציר זמן (ביקורת)")} · {d.audit.length}</div>
            {d.audit.length === 0 ? <div style={{ fontSize: 12, color: C.muted }}>{TT("No audit entries.", "אין רשומות ביקורת.")}</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {d.audit.slice(0, 60).map((a) => (
                  <div key={a.id} style={{ fontSize: 11.5, color: C.muted, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ color: C.faint, fontFamily: MONO, whiteSpace: "nowrap" }}>{fmt(a.ts)}</span>
                    <span style={{ color: C.text, fontWeight: 700 }}>{a.action}</span>
                    {a.actor && a.actor !== user && <span>· {TT("by", "ע\"י")} {a.actor}</span>}
                    {a.target && a.target !== user && <span>→ {a.target}</span>}
                    {a.ip && <span style={{ color: C.faint }}>· {a.ip}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reusable per-user management panel (same modal as the users table). */}
      {manageOpen && d && (
        <UserManageModal
          user={{ username: user, role: d.account.role, email: d.account.email, phone: d.account.phone }}
          onClose={() => setManageOpen(false)}
          onChanged={() => { q.refetch(); usersQ.refetch(); }}
        />
      )}
    </div>
  );
}

// Admin control: directly set a NEW password for the selected user. The admin
// types it (twice), optionally forces a change on the user's next login (default
// on), and confirms. Calls POST /auth/users/{username}/reset-password. The
// plaintext is sent over the wire to be hashed server-side — never stored here.
function ResetPasswordCard({ username }: { username: string }) {
  const { lang } = useI18n();
  const TT = (en: string, he: string) => (lang === "he" ? he : en);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [force, setForce] = useState(true);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const m = useMutation({
    mutationFn: () => api.resetUserPassword(username, pw, force),
    onSuccess: () => { setErr(""); setPw(""); setPw2(""); setOk(TT(`Password reset for ${username}.`, `הסיסמה אופסה עבור ${username}.`)); },
    onError: (e: any) => { setOk(""); setErr(e?.message || String(e)); },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setOk("");
    if (pw.length < 4) { setErr(TT("Password must be at least 4 characters.", "הסיסמה חייבת להכיל לפחות 4 תווים.")); return; }
    if (pw !== pw2) { setErr(TT("Passwords don't match.", "הסיסמאות אינן תואמות.")); return; }
    const note = force
      ? TT(`Set a new password for "${username}"? They'll be asked to choose their own on next login.`,
            `להגדיר סיסמה חדשה ל-"${username}"? הוא יתבקש לבחור סיסמה משלו בהתחברות הבאה.`)
      : TT(`Set a new password for "${username}"?`, `להגדיר סיסמה חדשה ל-"${username}"?`);
    if (!confirm(note)) return;
    setErr("");
    m.mutate();
  };

  const card: React.CSSProperties = { background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px", marginBottom: 12, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.14), ${SHADOW}` };
  const secTitle: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: C.gold, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 };

  return (
    <form onSubmit={submit} style={card}>
      <div style={secTitle}><KeyRound size={13} /> {TT("Reset password", "איפוס סיסמה")}</div>
      <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 10 }}>
        {TT("Type a new password for this user. With \"force change\" on, they pick their own on next login.",
            "הקלידו סיסמה חדשה למשתמש. כש\"חיוב החלפה\" פעיל — הוא יבחר סיסמה משלו בהתחברות הבאה.")}
      </div>

      {err && <div style={errBox}>{err}</div>}
      {ok && <div style={okBox}>{ok}</div>}

      <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} placeholder={TT("New password", "סיסמה חדשה")}
        autoComplete="new-password" style={{ ...inputStyle, marginBottom: 8 }} />
      <PasswordInput value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder={TT("Confirm new password", "אימות סיסמה חדשה")}
        autoComplete="new-password" style={{ ...inputStyle, marginBottom: 10 }} />

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.text, marginBottom: 12, cursor: "pointer" }}>
        <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.gold }} />
        {TT("Force change on next login", "חיוב החלפה בהתחברות הבאה")}
      </label>

      <button type="submit" disabled={m.isPending} className="gbtn ptile"
        style={{ ...btn(true), padding: "9px 16px", fontSize: 13, whiteSpace: "nowrap", opacity: m.isPending ? 0.6 : 1, cursor: m.isPending ? "default" : "pointer" }}>
        {m.isPending ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={15} />} {TT("Reset password", "איפוס סיסמה")}
      </button>
    </form>
  );
}

// Signal Bots — PRIVACY-SCOPED admin control. The admin sees ONLY how many
// automated bots a user has and sets their create LIMIT; keys, funds, balances
// and per-bot details stay private to the user (this never fetches or shows
// them). Count + limit come from GET /auth/admin/user/{username}/bots; Save posts
// the override to /bot-limit. Keyed by username so it resets per selected user.
function SignalBotsCard({ username }: { username: string }) {
  const { lang } = useI18n();
  const TT = (en: string, he: string) => (lang === "he" ? he : en);
  const q = useQuery({ queryKey: ["adminUserBots", username], queryFn: () => api.adminUserBots(username) });
  const [limit, setLimit] = useState<string>("");
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");

  // Seed the input from the fetched limit once it loads (and on user switch).
  React.useEffect(() => { if (q.data) setLimit(String(q.data.limit)); }, [q.data]);

  const m = useMutation({
    mutationFn: () => api.adminSetUserBotLimit(username, Math.max(0, parseInt(limit || "0", 10) || 0)),
    onSuccess: (r) => { setErr(""); setLimit(String(r.limit)); setOk(TT(`Limit set to ${r.limit}.`, `המגבלה הוגדרה ל-${r.limit}.`)); q.refetch(); },
    onError: (e: any) => { setOk(""); setErr(e?.message || String(e)); },
  });

  const card: React.CSSProperties = { background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px", marginBottom: 12, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.14), ${SHADOW}` };
  const secTitle: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: C.gold, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 };
  const count = q.data?.count ?? 0;
  const lim = q.data?.limit ?? 0;

  return (
    <div style={card}>
      <div style={secTitle}><Bot size={13} /> {TT("Signal Bots", "בוטים אוטומטיים")}</div>
      <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 10 }}>
        {TT("How many automated bots this user has, and the maximum they may create. Keys, funds and bot details stay private to the user.",
            "כמה בוטים אוטומטיים יש למשתמש, והמקסימום שמותר לו ליצור. מפתחות, כספים ופרטי הבוטים נשארים פרטיים למשתמש.")}
      </div>

      {err && <div style={errBox}>{err}</div>}
      {ok && <div style={okBox}>{ok}</div>}

      <div style={{ fontSize: 13, color: C.text, marginBottom: 10, fontWeight: 700 }}>
        {q.isLoading ? TT("Loading…", "טוען…")
          : <><span style={{ fontFamily: MONO, color: C.gold }}>{count}</span> {TT("used", "בשימוש")} · {TT("limit", "מגבלה")} <span style={{ fontFamily: MONO, color: C.gold }}>{lim}</span></>}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input type="number" min={0} max={9999} value={limit} onChange={(e) => setLimit(e.target.value)}
          aria-label={TT("Bot limit", "מגבלת בוטים")} placeholder={TT("Limit", "מגבלה")}
          style={{ ...inputStyle, width: 120, minHeight: 44 }} />
        <button type="button" onClick={() => { setOk(""); setErr(""); m.mutate(); }} disabled={m.isPending || q.isLoading} className="gbtn ptile"
          style={{ ...btn(true), padding: "9px 16px", fontSize: 13, minHeight: 44, whiteSpace: "nowrap", opacity: (m.isPending || q.isLoading) ? 0.6 : 1, cursor: (m.isPending || q.isLoading) ? "default" : "pointer" }}>
          {m.isPending ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={15} />} {TT("Save", "שמירה")}
        </button>
      </div>
    </div>
  );
}
