import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Wallet } from "lucide-react";
import { api, loadExchangeCreds } from "../app/api";
import { useI18n } from "../i18n";
import { C, MONO } from "../theme";

const HIDE_KEY = "algo770_hide_funds";

// Main-dashboard "Live — real money" card: shows the connected exchange's real
// balance, with a hide/show toggle so the amounts can be masked for privacy
// (remembered across reloads). Not connected → a prompt to connect.
export default function LiveFundsCard() {
  const nav = useNavigate();
  const { lang } = useI18n();
  const he = lang === "he";
  const creds = loadExchangeCreds();
  const connected = !!(creds && creds.key && creds.secret);
  const live = creds?.env === "live";

  const [hidden, setHidden] = useState(() => localStorage.getItem(HIDE_KEY) === "1");
  const toggle = () => { const v = !hidden; setHidden(v); localStorage.setItem(HIDE_KEY, v ? "1" : "0"); };

  const balQ = useQuery({ queryKey: ["exBalanceOv"], queryFn: () => api.balance(), enabled: connected, retry: false, refetchInterval: 30000 });
  const posQ = useQuery({ queryKey: ["exPositionsOv"], queryFn: () => api.positions(), enabled: connected, retry: false, refetchInterval: 30000 });
  const pnlQ = useQuery({ queryKey: ["livePnl"], queryFn: () => api.livePnl(), enabled: connected, retry: false, refetchInterval: 30000 });
  const pnl: any = pnlQ.data;
  const totalPnl = pnl?.ok ? Number(pnl.totalPnl) : null;
  const totalPnlPct = pnl?.ok && pnl.totalPnlPct != null ? Number(pnl.totalPnlPct) : null;
  const liveCount = pnl?.ok && pnl.count != null ? Number(pnl.count) : null;  // non-dust positions
  const bal: any = balQ.data;
  const usdt = (bal?.balances || []).find((b: any) => String(b.asset || "").toUpperCase() === "USDT");
  const total = usdt ? Number(usdt.total) : null;
  const free = usdt ? Number(usdt.free) : null;
  const pos: any = posQ.data;
  const posN = pos?.ok ? (pos.positions || []).length : null;
  const holds = (bal?.balances || []).filter((b: any) => String(b.asset || "").toUpperCase() !== "USDT" && Number(b.total) > 0).length;
  const posU = pos?.ok ? Number(pos.totalUnrealized || 0) : null;
  const mask = (n: number | null) =>
    hidden ? "••••" : (n == null || isNaN(n as number) ? "—" : "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));

  if (!connected) {
    return (
      <div onClick={() => nav("/exchange")} style={{ cursor: "pointer", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9, color: C.muted, fontWeight: 700, fontSize: 13.5 }}><Wallet size={16} /> {he ? "חברו בורסה לכספי לייב" : "Connect an exchange for live funds"}</span>
        <span style={{ fontSize: 12, color: C.gold, fontWeight: 700 }}>{he ? "חבר ←" : "Connect →"}</span>
      </div>
    );
  }

  const tag = live ? C.loss : C.gold;
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9, fontWeight: 800, fontSize: 14 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: C.gain }} />
          {he ? "לייב — כסף אמיתי" : "Live — real money"}
          <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 7, background: `${tag}1f`, color: tag }}>{live ? (he ? "חי" : "LIVE") : "TESTNET"}</span>
        </span>
        <button onClick={toggle} title={he ? "הסתר/הצג סכומים" : "Hide/show amounts"} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: C.surface2, border: `1px solid ${C.line}`, color: C.muted, borderRadius: 8, padding: "5px 9px", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>
          {hidden ? <Eye size={13} /> : <EyeOff size={13} />} {hidden ? (he ? "הצג" : "Show") : (he ? "הסתר" : "Hide")}
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{he ? "סך הכל (USDT)" : "Total (USDT)"}</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: MONO, color: C.text }}>{balQ.isLoading ? "…" : mask(total)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{he ? "זמין" : "Available"}</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: MONO, color: C.gain }}>{balQ.isLoading ? "…" : mask(free)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{he ? "בפוזיציות" : "In positions"}</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: MONO, color: C.text }}>{balQ.isLoading || (pnlQ.isLoading && liveCount == null) ? "…" : (hidden ? "••••" : String(liveCount != null ? liveCount : ((posN && posN > 0) ? posN : 0)))}</div>
          {posU != null && posN ? <div style={{ fontSize: 11, color: posU >= 0 ? C.gain : C.loss, fontFamily: MONO }}>{hidden ? "" : (posU >= 0 ? "+" : "") + "$" + Math.abs(posU).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div> : null}
        </div>
      </div>
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{he ? "רווח/הפסד כולל" : "Total P&L"}</span>
        <span style={{ fontSize: 18, fontWeight: 800, fontFamily: MONO, color: totalPnl == null ? C.muted : (totalPnl >= 0 ? C.gain : C.loss) }}>{pnlQ.isLoading ? "…" : (hidden ? "••••" : (totalPnl == null ? "—" : (totalPnl >= 0 ? "+" : "") + "$" + Math.abs(totalPnl).toLocaleString(undefined, { maximumFractionDigits: 2 }) + (totalPnlPct != null ? ` (${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}%)` : "")))}</span>
      </div>
    </div>
  );
}
