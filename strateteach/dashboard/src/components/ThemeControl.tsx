import React, { useState, useEffect } from "react";
import { Sun, Moon, Type, Palette as PaletteIcon, Check, X } from "lucide-react";
import { useI18n } from "../i18n";
import { C, UI, PALETTES, loadThemePrefs, applyThemePrefs, type ThemePrefs } from "../theme";
import { Segmented } from "../ui";
import { track } from "../lib/analytics";

// Every BRAND skin ships BOTH a light and a dark variant. Changing the COLOUR must
// PRESERVE the user's current light/dark preference (a light user stays light, a dark
// user stays dark) — the Mode toggle is the only thing that flips light↔dark. (We used
// to force each skin to its "natural" dark mode here, which yanked light users into
// dark on every colour change — see keepMode() below.)
const SKIN_HE: Record<string, string> = { navy: "נייבי", peach: "אפרסק", amber: "ניוד", aurora: "ים" };

// Pick the mode to use when switching to skin `v`: keep the CURRENT mode if that skin
// has the matching variant (all brand skins carry both, so this normally just returns
// `cur`). If a skin ever ships only one variant, fall back to whichever it has so the
// app never resolves to a missing palette — but keep the current mode wherever possible.
function keepMode(v: string, cur: "dark" | "light"): "dark" | "light" {
  const pal = PALETTES[v as keyof typeof PALETTES] as any;
  if (!pal) return cur;
  if (pal[cur]) return cur;              // preferred: stay on the user's light/dark choice
  return pal.dark ? "dark" : "light";    // graceful fallback if the skin lacks that variant
}

// Compact appearance control: Dark/Light mode, colour palette, and a large-text
// ("easy to read") mode. Changes apply app-wide instantly.
export default function ThemeControl({ compact }: { compact?: boolean }) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<ThemePrefs>(() => loadThemePrefs());
  const tr = (en: string, he: string) => (lang === "he" ? he : en);
  // Let the ☰ menu's "Skin" row open this picker from anywhere it's mounted (the Home
  // top bar + every inner-screen header carry a ThemeControl).
  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener("algo770-open-skin", openIt);
    return () => window.removeEventListener("algo770-open-skin", openIt);
  }, []);

  function set(p: Partial<ThemePrefs>) {
    const next = { ...prefs, ...p };
    setPrefs(next);
    applyThemePrefs(next);
    window.dispatchEvent(new Event("algo770-theme"));
  }

  const chip = (active: boolean): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, flex: 1, cursor: "pointer",
    border: `1px solid ${active ? C.gold : C.line}`, background: active ? "var(--btn-bg)" : "transparent", color: active ? "var(--btn-ink)" : C.text,
    borderRadius: 9, padding: "8px 6px", fontSize: 12.5, fontWeight: 700, fontFamily: UI,
  });

  return (
    <>
      <button onClick={() => setOpen((o) => !o)} aria-label="appearance" title={tr("Appearance", "מראה")} className="tap44"
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, background: C.surface2,
          border: `1px solid ${C.line}`, color: C.text, borderRadius: 12, cursor: "pointer",
          height: 30, padding: "0 11px", fontSize: 11, fontWeight: 800, fontFamily: UI, whiteSpace: "nowrap" }}>
        <PaletteIcon size={13} color={C.gold} />
        <span>{tr(PALETTES[prefs.skin].label, SKIN_HE[prefs.skin] || (PALETTES[prefs.skin]?.label ?? ""))}</span>
        {prefs.mode === "dark" ? <Moon size={11} color={C.muted} /> : <Sun size={11} color={C.muted} />}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9996 }} />
          <div style={{ position: "fixed", top: 84, insetInlineEnd: 12, zIndex: 9997, width: "min(300px,90vw)", background: C.surface,
            border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, boxShadow: "0 18px 44px rgba(0,0,0,0.5)", fontFamily: UI, color: C.text }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontWeight: 800, fontSize: 14, display: "inline-flex", alignItems: "center", gap: 7 }}><PaletteIcon size={15} color={C.gold} /> {tr("Appearance", "מראה")}</span>
              <button onClick={() => setOpen(false)} className="tap44" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={16} /></button>
            </div>

            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{tr("Mode", "מצב")}</div>
            <div style={{ marginBottom: 14 }}>
              <Segmented small value={prefs.mode} onChange={(v) => set({ mode: v as any })}
                options={[{ value: "dark", label: <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Moon size={12} /> {tr("Dark", "כהה")}</span> },
                          { value: "light", label: <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Sun size={12} /> {tr("Light", "בהיר")}</span> }]} />
            </div>

            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{tr("Colour theme", "ערכת צבע")}</div>
            <div style={{ marginBottom: 14 }}>
              <Segmented small value={prefs.skin as string} onChange={(v) => { track("skin_change", { skin: v }); set({ skin: v as any, mode: keepMode(v, prefs.mode) }); }}
                options={(Object.keys(PALETTES) as string[]).map((k) => ({ value: k, label: tr(PALETTES[k as keyof typeof PALETTES].label, SKIN_HE[k] || k) }))} />
            </div>

            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{tr("Text size", "גודל טקסט")}</div>
            {/* Toggling records an EXPLICIT choice (largeChoice) so it always wins over the
                display-size auto-default (desktop-on / mobile-off) resolved in loadThemePrefs. */}
            <button onClick={() => set({ large: !prefs.large, largeChoice: true })} style={{ ...chip(prefs.large), width: "100%" }}>
              <Type size={15} /> {prefs.large ? tr("Large text: ON", "טקסט גדול: פעיל") : tr("Large / easy-read", "טקסט גדול / קל לקריאה")}
              {prefs.large && <Check size={14} />}
            </button>
          </div>
        </>
      )}
    </>
  );
}
