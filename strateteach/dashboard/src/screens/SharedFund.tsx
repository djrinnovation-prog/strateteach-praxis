import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Landmark, ShieldCheck, PieChart, Users, Info } from "lucide-react";
import { C, UI, MONO } from "../theme";
import { api } from "../app/api";
import type { SharedFund as FundData } from "../lib/client";

// ── SHARED FUND (P3) — the owners' one shared fund: proportional stake + NAV ──
// OWNER-ONLY. Derived from the owner-attributed investments the owners already
// entered — no duplicate data entry. Strictly separated from company and client
// money (only dan/rafi/yoav contributions count). READ-ONLY: it moves nothing;
// trading the fund stays a gated, owner-only 3-of-3 act elsewhere.

const money = (n: number | undefined) =>
  "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Fixed, distinct colours for the three owners (donut segments + cards).
const OWNER_COLOR: Record<string, string> = { dan: "#5cb3ff", rafi: "#39e08d", yoav: "#f7b500" };

function card(extra?: React.CSSProperties): React.CSSProperties {
  return { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: 18,
    boxShadow: "0 14px 34px -26px rgba(0,0,0,0.5)", ...extra };
}

// A pure-CSS conic donut of the ownership split.
function Donut({ segments }: { segments: { pct: number; color: string }[] }) {
  let acc = 0;
  const stops = segments.map((s) => { const from = acc; acc += s.pct; return `${s.color} ${from}% ${acc}%`; }).join(", ");
  return (
    <div style={{ position: "relative", width: 132, height: 132, flexShrink: 0 }}>
      <div style={{ width: "100%", height: "100%", borderRadius: "50%",
        background: segments.length && acc > 0 ? `conic-gradient(${stops})` : C.surface2 }} />
      <div style={{ position: "absolute", inset: 16, borderRadius: "50%", background: C.surface,
        display: "grid", placeItems: "center", border: `1px solid ${C.line}` }}>
        <PieChart size={26} color={C.gold} />
      </div>
    </div>
  );
}

export default function SharedFund({ he, rtl }: { he: boolean; rtl: boolean }) {
  const q = useQuery({ queryKey: ["sharedFund"], queryFn: () => api.sharedFund(), staleTime: 30000, retry: false });
  const T = (h: string, e: string) => (he ? h : e);

  if (q.isLoading) return <div style={{ display: "grid", placeItems: "center", minHeight: 180 }}><Loader2 size={22} className="spin" color={C.gold} /></div>;
  if (q.isError || !q.data) return <div style={{ ...card(), color: C.loss }}>{T("טעינת נתוני הקרן נכשלה.", "Couldn't load the fund.")}</div>;
  const d = q.data as FundData;
  const segments = d.byOwner.filter((o) => o.ownershipPct > 0).map((o) => ({ pct: o.ownershipPct, color: OWNER_COLOR[o.owner] || C.muted }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: UI, direction: rtl ? "rtl" : "ltr" }}>
      {/* NAV + donut */}
      <div style={{ ...card(), display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <Donut segments={segments} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Landmark size={18} color={C.gold} />
            <span style={{ fontSize: 15.5, fontWeight: 900, color: C.text }}>{T("הקרן המשותפת", "Shared fund")}</span>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>{T("שווי נכסי נטו (NAV)", "Net asset value (NAV)")}</div>
          <div style={{ fontSize: 30, fontWeight: 900, fontFamily: MONO, color: C.text, marginTop: 2 }}>{money(d.navUsd)}</div>
          <div style={{ fontSize: 12, color: C.faint, marginTop: 3 }}>
            {T("סה\"כ הופקד", "Total contributed")}: <b style={{ color: C.muted, fontFamily: MONO }}>{money(d.contributedTotal)}</b>
          </div>
        </div>
      </div>

      {/* per-owner stakes */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <Users size={16} color={C.gold} />
          <span style={{ fontSize: 14.5, fontWeight: 900, color: C.text }}>{T("חלוקת הבעלות", "Ownership split")}</span>
        </div>
        <div style={{ display: "grid", gap: 11, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))" }}>
          {d.byOwner.map((o) => {
            const col = OWNER_COLOR[o.owner] || C.muted;
            return (
              <div key={o.owner} style={card({ padding: 15 })}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 999, display: "grid", placeItems: "center",
                    background: col, color: "#0e1220", fontSize: 14, fontWeight: 900 }}>{o.name[0]}</span>
                  <span style={{ fontSize: 14.5, fontWeight: 900, color: C.text }}>{o.name}</span>
                  <span style={{ marginInlineStart: "auto", fontSize: 18, fontWeight: 900, fontFamily: MONO, color: col }}>{o.ownershipPct.toFixed(1)}%</span>
                </div>
                {/* stake bar */}
                <div style={{ height: 8, borderRadius: 999, background: C.surface2, overflow: "hidden", border: `1px solid ${C.line}` }}>
                  <div style={{ width: `${Math.min(100, o.ownershipPct)}%`, height: "100%", background: col }} />
                </div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 7 }}>
                  {T("הופקד", "Contributed")}: <b style={{ color: C.text, fontFamily: MONO }}>{money(o.contributed)}</b>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* separation + provenance note */}
      <div style={{ ...card({ padding: "13px 15px" }), display: "flex", gap: 10 }}>
        <ShieldCheck size={17} color={C.gain} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 900, color: C.text, marginBottom: 3 }}>
            {T("מופרד לחלוטין", "Fully separated")}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.6 }}>
            {T("הקרן נגזרת מהשקעות המיוחסות לבעלים בלבד — מנותקת מכספי-החברה ומכספי-לקוחות. מסחר על הון-הקרן דורש אישור 3-מ-3 (owner-only) ונשאר חסום עד הפעלה מפורשת.",
               "The fund is derived from owner-attributed investments only — separate from company and client money. Trading the fund requires 3-of-3 approval (owner-only) and stays gated until explicitly enabled.")}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: C.faint, paddingInlineStart: 4 }}>
        <Info size={13} /> {T("ה-NAV שווה להון-שהופקד — הקרן טרם סחרה.", "NAV equals contributed capital — the fund has not traded yet.")}
      </div>
    </div>
  );
}
