import React from "react";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";

// ── Shared inner-screen HERO — the approved "Home methodology" for inner screens:
//   • a ROW of the screen's RELATED actions at the top (like Home's 5-tool tiles), and
//   • TWO CENTRAL, STRONG buttons = the screen's 2 MAIN actions (bold SOLID fills, the
//     biggest tap targets on the screen; the primary is bigger). No globe — that stays
//     Home's signature. Skin-aware via C.* tokens only; RTL inherited.
//
// It's a pure presentational block: every onClick is a REAL existing action passed in
// by the screen, so nothing is removed — this is a re-layout, not a feature change.

export type HeroTile = { key: string; label: string; Icon: React.FC<any>; onClick: () => void; tour?: string };
export type HeroMain = { label: string; sub?: string; Icon: React.FC<any>; onClick: () => void; disabled?: boolean; tour?: string };

export default function ScreenHero({ related, primary, secondary, tertiary }: {
  related: HeroTile[];
  primary: HeroMain;
  secondary?: HeroMain;   // optional — when omitted, only the primary button renders (centred)
  tertiary?: HeroMain;    // optional 3rd central button (e.g. Trading's 3 children) — same
                          // SIZE HIERARCHY as secondary (primary stays the biggest tap target)
}) {
  const { lang } = useI18n(); // re-render on language change (labels are passed in already-localised)
  const he = lang === "he";
  return (
    <div style={{ marginBottom: 16 }}>
      {/* related-actions row — tiles, like Home's tools row */}
      {related.length > 0 && (
        <div role="group" aria-label={he ? "פעולות נוספות במסך" : "More actions on this screen"}
          className="hero-related-row"
          style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", justifyContent: "center", gap: 8, marginBottom: 12 }}>
          {related.map((r) => (
            <button key={r.key} onClick={r.onClick} data-tour={r.tour} className="tap44 hero-related-btn"
              style={{ flex: "1 1 0", minWidth: 76, minHeight: 46, display: "inline-flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 4, padding: "7px 6px",
                background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 12,
                fontSize: 11.5, fontWeight: 800, lineHeight: 1.05, whiteSpace: "nowrap", cursor: "pointer",
                fontFamily: UI, boxShadow: "0 4px 12px -9px rgba(0,0,0,0.35)" }}>
              <r.Icon size={16} color={C.gold} /> {r.label}
            </button>
          ))}
        </div>
      )}

      {/* two central STRONG buttons — FRAMELESS, matching the approved clean Home hero
          (the two frosted-glass squares sit in a plain centred row, NO bordered/tinted
          wrapper). Only the framing changed here; the buttons + their actions are kept. */}
      <div style={{ display: "flex", justifyContent: "center" }}>
      <div role="group" aria-label={he ? "פעולות ראשיות" : "Primary actions"}
        style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", justifyContent: "center", gap: 12,
        maxWidth: 560, width: "100%", boxSizing: "border-box" }}>
        {([{ ...primary, i: 0 }, ...(secondary ? [{ ...secondary, i: 1 }] : []), ...(tertiary ? [{ ...tertiary, i: 2 }] : [])]).map((b) => {
          const isPrimary = b.i === 0;
          return (
            <button key={b.i} onClick={b.onClick} disabled={b.disabled} data-tour={b.tour}
              aria-label={b.sub ? `${b.label} — ${b.sub}` : b.label}
              className={isPrimary ? "gbtn tap44" : "tap44"}
              style={{ flex: isPrimary ? "1.2 1 180px" : "1 1 150px", maxWidth: isPrimary ? 300 : 260,
                height: isPrimary ? 54 : 48, borderRadius: 13,
                cursor: b.disabled ? "default" : "pointer", opacity: b.disabled ? 0.55 : 1,
                display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1,
                padding: "6px 14px", fontFamily: UI,
                ...(isPrimary
                  ? { boxShadow: `0 8px 20px -8px ${C.gold}88, inset 0 1px 0 rgba(255,255,255,0.28)` }
                  : { background: C.surface, color: C.text, border: `1.5px solid ${C.gold}`,
                      boxShadow: `0 8px 18px -10px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12)` }) }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: isPrimary ? 14.5 : 13.5, fontWeight: 800, lineHeight: 1.1, whiteSpace: "nowrap" }}>
                <b.Icon size={isPrimary ? 17 : 16} /> {b.label}
              </span>
              {b.sub && <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.78, lineHeight: 1.1, whiteSpace: "nowrap" }}>{b.sub}</span>}
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}
