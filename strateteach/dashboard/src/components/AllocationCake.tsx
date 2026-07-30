import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus, Globe2 } from "lucide-react";
import { api, loadAccounts, activeAccountId, setActiveAccount } from "../app/api";
import { useI18n } from "../i18n";
import { useIsMobile } from "../lib/useIsMobile";
import { C, MONO } from "../theme";

const CIRC = 2 * Math.PI * 40;
type Row = { id: string; label: string; env?: string; ok: boolean; value: number; today: number; open: number; count: number };

// Funds allocation across ALL sub-accounts, drawn as an Earth-styled cake (donut)
// with a glowing rim + a slow orbit ring. Tap an account to calculate it on its
// own; tap "All" to return to the combined view. Account picker uses the same
// square-tile logic as the front page.
export default function AllocationCake() {
  const { lang } = useI18n();
  const nav = useNavigate();
  const mobile = useIsMobile();
  const accounts = loadAccounts();
  const [focus, setFocus] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(activeAccountId());

  const q = useQuery({
    queryKey: ["allAccountsPnl", accounts.map((a) => a.id).join(",")],
    enabled: accounts.length > 0, retry: false, refetchInterval: 30000,
    queryFn: async (): Promise<Row[]> => Promise.all(accounts.map(async (a): Promise<Row> => {
      try {
        const p: any = await api.livePnl({ key: a.key, secret: a.secret, passphrase: a.passphrase, name: a.name, env: a.env });
        return { id: a.id, label: a.label, env: a.env, ok: p?.ok !== false, value: Number(p?.totalValue) || 0, today: Number(p?.period?.today ?? p?.totalPnl) || 0, open: Number(p?.totalPnl) || 0, count: Number(p?.count) || 0 };
      } catch { return { id: a.id, label: a.label, env: a.env, ok: false, value: 0, today: 0, open: 0, count: 0 }; }
    })),
  });
  const rows = (q.data || []) as Row[];
  const PAL = [C.gold, C.accent, C.blue, C.gain, "#9b6dff", C.loss, "#22d3ee", "#f59e0b"];
  const total = rows.reduce((s, r) => s + (r.value || 0), 0);
  const combinedToday = rows.reduce((s, r) => s + (r.today || 0), 0);
  const focused = focus ? rows.find((r) => r.id === focus) : null;
  const shownValue = focused ? focused.value : total;
  const shownToday = focused ? focused.today : combinedToday;
  const usd = (v: number) => "$" + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const signed = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  // Today's P&L as a % of that account's value, shown beside the $ figure.
  const pctOf = (v: number, base: number) => base > 0 ? ` (${v >= 0 ? "+" : ""}${(v / base * 100).toFixed(2)}%)` : "";

  const card: React.CSSProperties = { background: `${C.gold}10`, border: `1px solid ${C.gold}3a`, borderRadius: 16, padding: 14, backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" };
  const addTileSm: React.CSSProperties = { display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, background: `${C.gold}14`, border: `1px dashed ${C.gold}80`, color: C.gold, borderRadius: 12, padding: "9px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" };

  if (accounts.length === 0) {
    return (
      <div style={card}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 800, color: C.text, marginBottom: 4 }}><Globe2 size={16} color={C.gold} /> {lang === "he" ? "החשבונות שלי" : "My accounts"}</div>
        <div style={{ fontSize: 12.5, color: C.muted, margin: "6px 0 12px" }}>{lang === "he" ? "חברו חשבון בורסה כדי לראות הקצאת כספים ורווח חי מכל החשבונות." : "Connect an exchange account to see fund allocation and combined live P&L."}</div>
        <button onClick={() => nav("/exchange")} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: `${C.gold}1f`, border: `1px dashed ${C.gold}88`, color: C.gold, borderRadius: 12, padding: "12px 16px", fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}><Plus size={18} /> {lang === "he" ? "הוסיפו חשבון" : "Add account"}</button>
      </div>
    );
  }

  let acc = 0;
  const slices = rows.map((r, i) => {
    const frac = total > 0 ? r.value / total : 0;
    const dash = frac * CIRC;
    const dim = !!focus && focus !== r.id;
    const el = (
      <circle key={r.id} cx="50" cy="50" r="40" fill="none" stroke={PAL[i % PAL.length]} strokeWidth={focus === r.id ? 16 : 13}
        strokeDasharray={`${dash} ${CIRC - dash}`} strokeDashoffset={-acc} transform="rotate(-90 50 50)"
        style={{ opacity: dim ? 0.22 : 0.95, transition: "opacity .2s, stroke-width .2s" }} />
    );
    acc += dash;
    return el;
  });

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 800, color: C.text }}>
          <Globe2 size={16} color={C.gold} /> {lang === "he" ? "הקצאת כספים · כל החשבונות" : "Fund allocation · all accounts"}
        </span>
        {focus && <button onClick={() => setFocus(null)} style={{ background: "transparent", border: `1px solid ${C.line}`, color: C.muted, borderRadius: 999, padding: "4px 11px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{lang === "he" ? "כל החשבונות" : "All accounts"}</button>}
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
        {/* the cake — Earth-styled donut */}
        <div style={{ position: "relative", width: mobile ? 176 : 206, height: mobile ? 176 : 206, flexShrink: 0 }}>
          <style>{"@keyframes cakeSpin{to{transform:rotate(360deg)}}"}</style>
          <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", transformOrigin: "center", animation: "cakeSpin 80s linear infinite", overflow: "visible" }}>
            <circle cx="50" cy="50" r="47.5" fill="none" stroke={`${C.gold}40`} strokeWidth="0.7" strokeDasharray="2 5" strokeLinecap="round" />
          </svg>
          <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
            <defs><filter id="cakeGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.0" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
            <circle cx="50" cy="50" r="40" fill="none" stroke={C.line} strokeWidth="13" style={{ opacity: 0.22 }} />
            {slices}
            <circle cx="50" cy="50" r="46.5" fill="none" stroke={C.gold} strokeWidth="0.9" style={{ opacity: 0.65, filter: "url(#cakeGlow)" }} />
          </svg>
          {/* Center label — width is clamped to the donut hole so nothing spills past
              the ring; the today line wraps inside the hole on every screen width. */}
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", width: mobile ? 104 : 122, maxWidth: "64%" }}>
              <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", width: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{focused ? focused.label : (lang === "he" ? "סך הכל" : "Total")}</div>
              <div style={{ fontSize: mobile ? 15 : 18, fontWeight: 800, fontFamily: MONO, color: C.gold, marginTop: 1, lineHeight: 1.1, width: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{q.isLoading ? "…" : usd(shownValue)}</div>
              <div style={{ fontSize: 9.5, fontFamily: MONO, color: shownToday >= 0 ? C.gain : C.loss, marginTop: 2, lineHeight: 1.2, width: "100%" }}>{q.isLoading ? "" : `${signed(shownToday)}${pctOf(shownToday, shownValue)} ${lang === "he" ? "היום" : "today"}`}</div>
            </div>
          </div>
        </div>

        {/* per-account tiles — same square logic as the front page */}
        <div style={{ flex: 1, minWidth: 220, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {rows.map((r, i) => {
            const on = active === r.id || focus === r.id;
            return (
              <button key={r.id} onClick={() => { setFocus((f) => (f === r.id ? null : r.id)); setActiveAccount(r.id); setActive(r.id); }} title={r.label}
                style={{ position: "relative", textAlign: "start", cursor: "pointer", fontFamily: "inherit", color: "#fff", borderRadius: 12, padding: "9px 10px",
                  background: `linear-gradient(140deg, ${PAL[i % PAL.length]}, ${PAL[(i + 2) % PAL.length]})`,
                  border: on ? "2px solid #fff" : "1px solid rgba(255,255,255,0.2)", boxShadow: "none" }}>
                <span style={{ display: "block", fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.03em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textShadow: "0 1px 2px rgba(0,0,0,0.45)" }}>{r.label}</span>
                <span style={{ display: "block", fontSize: 13, fontWeight: 800, fontFamily: MONO, marginTop: 2, textShadow: "0 1px 2px rgba(0,0,0,0.45)" }}>{r.ok ? usd(r.value) : "—"}</span>
                <span style={{ display: "block", fontSize: 10, fontFamily: MONO, opacity: 0.95, textShadow: "0 1px 2px rgba(0,0,0,0.45)" }}>{r.ok ? signed(r.today) + pctOf(r.today, r.value) : (lang === "he" ? "לא מחובר" : "n/a")}</span>
              </button>
            );
          })}
          <button onClick={() => nav("/exchange")} style={addTileSm}><Plus size={18} /> {lang === "he" ? "הוסף חשבון" : "Add account"}</button>
        </div>
      </div>
    </div>
  );
}
