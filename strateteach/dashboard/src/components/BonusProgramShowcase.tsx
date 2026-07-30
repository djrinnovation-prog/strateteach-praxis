import React from "react";
import {
  Gift, TrendingUp, KeyRound, Sparkles, Coins, Wallet, Rocket, LineChart,
  PiggyBank, HandCoins, ShieldCheck, ChevronDown,
} from "lucide-react";
import { C } from "../theme";
import type { BonusProgramDef, BonusProgram } from "../lib/client";

// ── BonusProgramShowcase — the "מרהיב ויפה" read-only presentation of how the bonus program
// works. Driven ENTIRELY by the owner-editable definition (title/intro/steps/benefit/terms) so
// owners preview exactly what employees see. Optional `mine` overlays the viewer's own live
// numbers (deposit/accrued/capital/P&L/total + bonus history) when they've joined. Peach theme,
// bilingual HE/EN, RTL-correct. Pure presentation — no mutations, no actions.
const STEP_ICONS: Record<string, any> = {
  TrendingUp, KeyRound, Sparkles, Coins, Wallet, Rocket, LineChart, PiggyBank, HandCoins, Gift,
};
export const BONUS_STEP_ICON_KEYS = Object.keys(STEP_ICONS);

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function BonusProgramShowcase({ def, he, rtl, mine }: {
  def: BonusProgramDef; he: boolean; rtl: boolean; mine?: BonusProgram | null;
}) {
  const T = (hev: string, env: string) => (he ? hev : env);
  const steps = def.steps || [];
  const joined = !!mine && mine.status === "active";

  return (
    <div style={{ direction: rtl ? "rtl" : "ltr", display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{`@keyframes bpsGlow{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}`}</style>

      {/* ── hero ── */}
      <div style={{ position: "relative", overflow: "hidden", borderRadius: 20, padding: "28px 24px",
        background: `radial-gradient(120% 120% at 100% 0%, ${C.gold}2e 0%, ${C.surface} 55%)`,
        border: `1px solid ${C.gold}66`, boxShadow: `0 14px 40px ${C.gold}22`, textAlign: "center" }}>
        <div style={{ display: "inline-grid", placeItems: "center", width: 58, height: 58, borderRadius: 18,
          background: C.accentGrad, boxShadow: `0 10px 26px ${C.gold}66`, animation: "bpsGlow 3s ease-in-out infinite" }}>
          <Gift size={30} color="#0B0613" />
        </div>
        <div style={{ fontSize: 24, fontWeight: 900, color: C.text, marginTop: 12, letterSpacing: "-0.01em" }}>
          {T(def.titleHe, def.titleEn) || (he ? "תוכנית הבונוס" : "The Bonus Program")}
        </div>
        <p style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.75, margin: "10px auto 0", maxWidth: 560 }}>
          {T(def.introHe, def.introEn)}
        </p>
      </div>

      {/* ── how it works: the step flow ── */}
      {steps.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: C.gold, marginBottom: 12, textAlign: "center" }}>
            {he ? "איך זה עובד" : "How it works"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
            {steps.map((s, i) => {
              const Icon = STEP_ICONS[s.icon || ""] || Sparkles;
              return (
                <div key={i} style={{ position: "relative", background: C.surface, border: `1px solid ${C.line}`,
                  borderRadius: 16, padding: "18px 16px 16px", boxShadow: "0 6px 20px rgba(0,0,0,.05)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <span style={{ display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                      background: `${C.gold}1a`, border: `1px solid ${C.gold}55` }}>
                      <Icon size={19} color={C.gold} />
                    </span>
                    <span style={{ display: "grid", placeItems: "center", width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                      background: C.accentGrad, color: "#0B0613", fontSize: 12, fontWeight: 900 }}>{i + 1}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: C.text, lineHeight: 1.35 }}>{T(s.titleHe, s.titleEn)}</div>
                  <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, marginTop: 5 }}>{T(s.bodyHe, s.bodyEn)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── the capital-growth visual (concept, or the viewer's live numbers) ── */}
      <GrowthVisual he={he} mine={joined ? mine! : null} />

      {/* ── benefit callout ── */}
      {(def.benefitHe || def.benefitEn) && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, borderRadius: 16, padding: "16px 18px",
          background: `linear-gradient(165deg, ${C.gold}1f 0%, ${C.surface} 100%)`, border: `1px solid ${C.gold}66` }}>
          <span style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: C.accentGrad }}>
            <Sparkles size={17} color="#0B0613" />
          </span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 900, color: C.gold, marginBottom: 3 }}>{he ? "הערך שלך" : "Your upside"}</div>
            <div style={{ fontSize: 13.5, color: C.text, fontWeight: 600, lineHeight: 1.65 }}>{T(def.benefitHe, def.benefitEn)}</div>
          </div>
        </div>
      )}

      {/* ── the viewer's own numbers (only when active) ── */}
      {joined && <MyNumbers prog={mine!} he={he} />}

      {/* ── terms ── */}
      {(def.termsHe || def.termsEn) && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 11.5, color: C.faint, lineHeight: 1.7,
          borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
          <ShieldCheck size={14} color={C.faint} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{T(def.termsHe, def.termsEn)}</span>
        </div>
      )}
    </div>
  );
}

// ── the accrual / growth flow: deposit + bonuses → capital → +P&L → total ─────────
function GrowthVisual({ he, mine }: { he: boolean; mine: BonusProgram | null }) {
  const chip = (label: string, value: string, color: string, strong = false) => (
    <div style={{ flex: "1 1 120px", minWidth: 108, textAlign: "center", background: strong ? `${C.gold}12` : C.surface,
      border: `1px solid ${strong ? C.gold + "66" : C.line}`, borderRadius: 12, padding: "11px 10px" }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: C.faint, lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: mine ? 16 : 13, fontWeight: 900, color, marginTop: 4 }}>{value}</div>
    </div>
  );
  const op = (sym: string) => (
    <span style={{ flexShrink: 0, fontSize: 18, fontWeight: 900, color: C.gold, alignSelf: "center", padding: "0 2px" }}>{sym}</span>
  );
  const v = (n: number, concept: string) => (mine ? money(n) : concept);
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 16, padding: "16px 16px 14px" }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 12, textAlign: "center" }}>
        {he ? "איך ההון גדל" : "How the capital grows"}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", alignItems: "stretch" }}>
        {chip(he ? "הפקדה (הלוואה)" : "Deposit (loan)", v(mine?.initialDeposit || 0, he ? "הון התחלתי" : "seed"), C.gold)}
        {op("+")}
        {chip(he ? "בונוסים שנצברו" : "Bonuses accrued", v(mine?.bonusAccrued || 0, he ? "חודשי" : "monthly"), C.gain)}
        {op("=")}
        {chip(he ? "הון מצטבר" : "Accrued capital", v(mine?.capital || 0, he ? "גדל" : "grows"), C.text, true)}
        {op("+")}
        {chip(he ? "רווח מסחר" : "Trading P&L", v(mine?.tradingPnl || 0, he ? "שלך" : "yours"), (mine?.tradingPnl || 0) >= 0 ? C.gain : C.loss)}
        {op("=")}
        {chip(he ? "שווי כולל" : "Total value", v(mine?.totalValue || 0, he ? "שווי" : "value"), C.gold, true)}
      </div>
    </div>
  );
}

// ── the viewer's live figures + monthly bonus history (active only) ──────────────
function MyNumbers({ prog, he }: { prog: BonusProgram; he: boolean }) {
  return (
    <div style={{ background: `linear-gradient(165deg, ${C.surface} 0%, ${C.gold}12 100%)`, border: `1px solid ${C.gold}66`,
      borderRadius: 16, padding: 18, boxShadow: `0 10px 30px ${C.gold}1f` }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 900, color: C.text, marginBottom: 12 }}>
        <Gift size={16} color={C.gold} /> {he ? "המספרים שלי" : "My numbers"}
        <span style={{ fontSize: 10, fontWeight: 800, color: C.gain, background: `${C.gain}1a`, border: `1px solid ${C.gain}55`, borderRadius: 999, padding: "2px 9px" }}>{he ? "פעיל" : "Active"}</span>
      </div>
      {prog.bonusHistory.length > 0 && (
        <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 7 }}>{he ? "היסטוריית בונוסים חודשיים" : "Monthly bonus history"}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {prog.bonusHistory.map((b) => (
              <span key={b.id} style={{ fontSize: 11, fontWeight: 700, color: C.text, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "3px 9px" }}>
                <b style={{ color: C.gain }}>{money(b.amount)}</b> <span style={{ color: C.faint }}>{b.date || "—"}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div style={{ fontSize: 10.5, color: C.faint, marginTop: 12 }}>{he ? "מעקב בלבד — המימון מתבצע בבורסה מול הבעלים." : "Tracking only — funding happens on the exchange with the owners."}</div>
    </div>
  );
}
