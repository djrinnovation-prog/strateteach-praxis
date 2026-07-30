import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Rocket, FlaskConical, ChevronDown, ChevronUp, ChevronRight, ChevronLeft } from "lucide-react";
import { C } from "../theme";
import { api, isOwner } from "../app/api";
import { useI18n } from "../i18n";
import { AP_STATE_KEY, AutoPilotsDashboard, apSummary } from "./AutoPilots";
import type { ApSimPilot } from "../lib/client";

// ── Home "Loaded AutoPilots" panel — ALWAYS shows the loaded pilots on the main screen
// (Dan's ask), but MINIMIZED by default: a compact summary bar (count · total sim value ·
// P&L · SIMULATION tag) + an expand control that reveals the SAME one-line-per-pilot
// dashboard used on the AutoPilots screen. Owner-only, data-only (server dry-run state) —
// no orders, no money. Renders nothing for non-owners or when no pilot is loaded.

const fmtMoney = (n: number | null | undefined) =>
  `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtSigned = (n: number | null | undefined) => `${Number(n || 0) >= 0 ? "+" : "-"}${fmtMoney(Math.abs(Number(n || 0)))}`;
const pnlColor = (n: number | null | undefined) => (Number(n || 0) > 0 ? C.gain : Number(n || 0) < 0 ? C.loss : C.muted);

export default function ActiveAutoPilotsPanel() {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const nav = useNavigate();
  const owner = isOwner();
  const [expanded, setExpanded] = useState(false);
  const Fwd = rtl ? ChevronLeft : ChevronRight;

  const stateQ = useQuery({
    queryKey: AP_STATE_KEY,
    queryFn: () => api.autopilotsState(),
    enabled: owner,
    refetchInterval: 45000,
    staleTime: 15000,
  });

  const pilots = useMemo(() => (stateQ.data?.pilots || []) as ApSimPilot[], [stateQ.data]);
  const simByPilot = useMemo(() => {
    const m: Record<string, ApSimPilot> = {};
    for (const p of pilots) m[p.pilotId] = p;
    return m;
  }, [pilots]);

  if (!owner || pilots.length === 0) return null;

  const { loaded, totalPnl, totalValue, todayPnl } = apSummary(pilots);

  // Clean tile — soft rounded card with a light gradient fill + inner-highlight bevel.
  const card: React.CSSProperties = {
    background: C.glassTint, border: `1px solid ${C.glassBd}`, borderRadius: 16,
    boxShadow: `0 6px 16px -12px rgba(0,0,0,0.42), ${C.glassHi}`, direction: rtl ? "rtl" : "ltr", overflow: "hidden",
  };

  return (
    <div style={card}>
      {/* Summary bar (always visible) — click to expand/collapse. */}
      <button onClick={() => setExpanded((v) => !v)} className="tap44"
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "11px 13px",
          background: "transparent", border: "none", cursor: "pointer", textAlign: rtl ? "right" : "left", color: C.text }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0, display: "grid", placeItems: "center", background: C.accentGrad, boxShadow: C.glassHi }}>
          <Rocket size={17} color="#0B0613" />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 900, color: C.text, lineHeight: 1.1 }}>{he ? "טייסים טעונים" : "Loaded AutoPilots"}</span>
            <span style={{ fontSize: 10, fontWeight: 800, color: C.gold, background: `${C.gold}18`, border: `1px solid ${C.gold}55`, borderRadius: 999, padding: "1px 7px" }}>{loaded}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, fontWeight: 800, color: C.blue,
              background: `${C.blue}14`, border: `1px solid ${C.blue}44`, borderRadius: 999, padding: "1px 7px" }}>
              <FlaskConical size={10} /> {he ? "סימולציה" : "Simulation"}
            </span>
          </div>
          <div style={{ fontSize: 9.5, color: C.faint, fontWeight: 700, marginTop: 3 }}>
            {he ? "רווח/הפסד" : "P&L"} <span style={{ color: pnlColor(totalPnl) }}>{fmtSigned(totalPnl)}</span>
            {"  ·  "}{he ? "היום" : "today"} <span style={{ color: pnlColor(todayPnl) }}>{fmtSigned(todayPnl)}</span>
          </div>
        </div>
        {/* glanceable total value */}
        <div style={{ textAlign: rtl ? "left" : "right", flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: C.text, fontVariantNumeric: "tabular-nums", lineHeight: 1, direction: "ltr" }}>{fmtMoney(totalValue)}</div>
          <div style={{ fontSize: 8.5, fontWeight: 800, color: C.faint, marginTop: 2 }}>{he ? "שווי סים" : "sim value"}</div>
        </div>
        <span style={{ flexShrink: 0, display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 8, background: C.surface2, border: `1px solid ${C.line}`, color: C.muted }}>
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </span>
      </button>

      {/* Expanded — the same one-line-per-pilot dashboard, deep-linking each row. */}
      {expanded && (
        <div style={{ padding: "0 11px 11px", display: "flex", flexDirection: "column", gap: 9 }}>
          <AutoPilotsDashboard he={he} rtl={rtl} simByPilot={simByPilot}
            onOpenRow={(id) => nav(`/owners?tab=autopilots&pilot=${encodeURIComponent(id)}`)} />
          <button onClick={() => nav("/owners?tab=autopilots")} className="tap44"
            style={{ alignSelf: rtl ? "flex-start" : "flex-end", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 800,
              color: C.gold, background: `${C.gold}14`, border: `1px solid ${C.gold}55`, borderRadius: 999, padding: "4px 11px", cursor: "pointer" }}>
            {he ? "פתח מסך טייסים" : "Open AutoPilots"} <Fwd size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
