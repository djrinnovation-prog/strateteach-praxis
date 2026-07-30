// Design system. Colours are served through getters that read the *active*
// palette, so switching skin/mode re-themes the whole app at the next render
// while keeping the `${C.color}aa` alpha-append pattern working (values stay hex).

type Palette = {
  bg: string; surface: string; surface2: string; line: string;
  text: string; muted: string; faint: string;
  // gold = primary accent, accent = secondary, blue = tertiary → each skin is a
  // 2–3 colour design. gain/loss stay green/red everywhere for P&L legibility.
  gold: string; goldDim: string; gain: string; loss: string; blue: string; accent: string;
  // OPTIONAL override for FRAME/BORDER lines only (not text/icons). When set, framed containers
  // (headline frame, tiles, cards) draw their border in this colour while keeping the accent glow.
  // Omitted ⇒ borders use `gold`. Used by Navy DARK to try a WHITE frame with the same gold glow.
  frameAccent?: string;
  // OPTIONAL explicit tonal fan (light→deep) for the accent gradient / glass sweep. When a
  // skin is built from a fixed set of brand tones (e.g. the Peach Pantone palette) this
  // carries all of them so accentGrad reads as that exact fan instead of a value derived
  // from `gold` alone. Omitted ⇒ the fan is derived from `gold` (lighten→base→darken).
  fan?: string[];
};

// Light mode is a soft, eye-friendly OFF-WHITE with just a hint of the skin hue
// (never a glaring pure white). Dark mode is "dark metallic chrome": a neutral
// charcoal with a faint cool/warm cast per skin, lifted by a subtle gradient in
// applyThemePrefs() so it reads as brushed metal with depth, not flat black.

// gain (profit) and loss are SEMANTIC tokens — a fixed green / red kept identical
// across every skin so P&L always reads clearly and never blends into the accent
// (matters most on the red & green skins). They are intentionally NOT the accent.
const GAIN_L = "#0E9E63", LOSS_L = "#DB3B49"; // light mode
const GAIN_D = "#16C77E", LOSS_D = "#F0616D"; // dark mode

// ══ OFFICIAL BRAND SKINS ══════════════════════════════════════════════════════
// Four brand palettes, each with a DARK (the natural/brand look — dark bg, light
// text) and a LIGHT variant. The brand identity lives in the DARK mode; LIGHT is a
// soft off-white companion that keeps the same accent hue but stays readable (dark
// text on white). gain/loss stay a semantic green/red on every skin so P&L is never
// invisible — even where the accent itself is green or blue.

// Each skin is ANCHORED to its main brand colour but enriched with DISTINCT tonal
// surface steps (bg → surface → surface2 read as separate layers, not one flat wall)
// and a tasteful IN-FAMILY secondary accent (`accent`) + tertiary (`blue`) for depth
// and variety — modelled on Aurora, which already spans several greens. gain/loss stay
// semantic; AA contrast preserved (text/bg 14–17:1, buttons ≥4.6:1).

// ── Skin 1 · NAVY (BRAND, default) — Dan's restyle ────────────────────────────
// Two DIFFERENT accent families, one per mode (so each carries its OWN tonal fan):
//   • DARK  = rich DARK-BROWN surfaces + warm GOLD accent — "dark brown, gold". A warm
//     brown chrome with a pale-gold → deep-bronze fan driving accentGrad + glass sweep.
//   • LIGHT = warm BEIGE / SAND surfaces + LIGHT METALLIC-NAVY accent — "beige back, metal
//     light navy". A refined sand wash with a steel-navy fan as the brand/accent colour.
// gain/loss stay the semantic green/red; AA contrast preserved (dark cream-on-brown &
// dark-navy-ink-on-sand both high-contrast; buttons take white/dark ink via onAccent()).
const NAVY_GOLD_FAN  = ["#F6E6BC", "#EFD183", "#E9B84C", "#D6982B", "#B5771E", "#875416"]; // pale gold → deep bronze (dark)
const NAVY_STEEL_FAN = ["#DFE7F5", "#BAC9E9", "#8FA6D6", "#5E7EC0", "#3E62A6", "#2A487F"]; // pale steel → deep navy (light)
const NAVY_DARK: Palette = {
  // DEEP DARK NAVY-BLUE surface stack (Dan revision: true dark navy, NOT brown). bg → surface →
  // surface2 read as separate navy layers; GOLD accents kept (classic navy + gold). The antique
  // cracked texture is still overlaid by HomeBackdrop but kept SUBTLE (not shiny) — see there.
  bg: "#131F38", surface: "#1D2C4C", surface2: "#2A3E68", line: "#3E568A",
  text: "#F7EFDD", muted: "#C7D2E6", faint: "#8493B2",
  // gold = warm GOLD accent (buttons/pills/active); accent = deep amber secondary; blue = pale-gold tertiary.
  gold: "#E9B84C", goldDim: "#1B2A47", gain: GAIN_D, loss: LOSS_D, blue: "#F2D488", accent: "#D6982B",
  fan: NAVY_GOLD_FAN,
  // EXPERIMENT (Dan): WHITE frame/border on Navy DARK, keeping the gold glow. Borders only — text
  // and icons stay gold (they read C.gold, not C.frameAccent).
  frameAccent: "#F4F6FB",
};
const NAVY_LIGHT: Palette = {
  // ANTIQUE AGED-SILVER wash (Dan: warm metallic silver, aged/broken) + the same antique cracked
  // texture overlaid by HomeBackdrop. bg = aged warm silver; surface = a brighter polished-silver
  // card so cards pop off the aged bg; dark-navy ink keeps AA contrast on the silver.
  bg: "#C6C2B8", surface: "#E7E4DD", surface2: "#D2CEC4", line: "#B0AB9F",
  text: "#20304F", muted: "#4E5F86", faint: "#9A8F73",
  // gold = LIGHT METALLIC-NAVY accent (buttons/pills/active); accent = deep navy secondary;
  // blue = mid steel tertiary; goldDim = a pale navy tint for accent-tinted fills.
  gold: "#3F63A8", goldDim: "#E3EAF6", gain: GAIN_L, loss: LOSS_L, blue: "#5E7EC0", accent: "#2A487F",
  fan: NAVY_STEEL_FAN,
};
// ── Skin 2 · PEACH (warm Pantone peach fan) ──────────────────────────────────
// Built from the four Pantone PEACH tones (light → deep): Tender Peach #F6DBC7 →
// Peach Parfait #F2C4A9 → Peach Nectar #EDA88F → Peach Pink #E5988A. These four are
// the skin's tonal fan (`fan`) that drives accentGrad + the frosted-glass sweep, so the
// whole skin reads as a warm peach spectrum. DARK = a warm charcoal-brown bg (NOT peach)
// lit by the peach accent glow; LIGHT = a soft cream/peach wash with peach surfaces.
const PEACH_FAN = ["#FBEEE3", "#F6DBC7", "#F2C4A9", "#EDA88F", "#E5988A"]; // pale→Tender→Parfait→Nectar→Pink (5-tone, richer)
const PEACH_DARK: Palette = {
  bg: "#1B100B", surface: "#2B1A12", surface2: "#3E271B", line: "#66412E",
  text: "#FCEAE0", muted: "#DBB4A2", faint: "#A17A66",
  // Base accent = Peach Nectar (bright glow on the warm dark bg); secondary = Peach Pink,
  // tertiary = Peach Parfait (a lighter peach) so the glass frost reads multi-tonal.
  gold: "#EDA88F", goldDim: "#341F15", gain: GAIN_D, loss: LOSS_D, blue: "#F2C4A9", accent: "#E5988A",
  fan: PEACH_FAN,
};
const PEACH_LIGHT: Palette = {
  bg: "#FDF1E8", surface: "#FFFFFF", surface2: "#F9E3D4", line: "#EDC7B0",
  text: "#3A1D10", muted: "#8B5942", faint: "#BE9077",
  // Base accent = Peach Pink (reads with presence on the cream bg); secondary/tertiary are
  // slightly deeper coral tones for contrast variety while staying in the peach family.
  gold: "#E5988A", goldDim: "#FBE3D6", gain: GAIN_L, loss: LOSS_L, blue: "#D98A6E", accent: "#CB6E54",
  fan: PEACH_FAN,
};
// ── Skin 3 · NUDE (warm ORANGE / tan / caramel fan) ──────────────────────────
// Nude = warm ORANGE-nude (NOT peach/pink — Dan: "ניוד = כתום ניוד, לא אפרסק"). Six-tone
// tan→caramel fan (light → deep): #F7E5CE · #EFCFA3 · #E4B172 · #D5934A · #BE7A32 · #986018
// → drives accentGrad + the glass sweep so the skin reads as a warm orange-tan-caramel
// spectrum, CLEARLY distinct from PEACH (pink-coral). DARK = a warm amber-brown near-black
// lit by the tan accent glow; LIGHT = a soft tan-cream wash. gain/loss stay semantic green/
// red. (Skin KEY stays `amber` so saved prefs + the amber aliases keep working.)
// VIVID warm amber/orange (Dan: the old tan→brown was "too brown"). Pale gold → vivid
// orange → deep burnt, matching the new Nude logo. Lively, not muddy.
const NUDE_FAN = ["#FFE0A8", "#FFCB6E", "#FF9528", "#F06420", "#C94E18", "#8A3410"]; // pale gold → vivid orange → deep
const NUDE_DARK: Palette = {
  bg: "#160C04", surface: "#291706", surface2: "#3E2410", line: "#7A421A",
  text: "#FFF1DD", muted: "#F2C78C", faint: "#B98A54",
  // Base accent = VIVID orange (glows on the dark amber bg); secondary = warm gold,
  // tertiary = deep burnt-orange → the frosted glass reads as a lively amber-orange fan.
  gold: "#FF9528", goldDim: "#3A1E08", gain: GAIN_D, loss: LOSS_D, blue: "#FFCB6E", accent: "#F06420",
  fan: NUDE_FAN,
};
const NUDE_LIGHT: Palette = {
  bg: "#FFF4E4", surface: "#FFFFFF", surface2: "#FFE7C6", line: "#FFC98A",
  text: "#4A2410", muted: "#B4571A", faint: "#D98A45",
  // Vivid orange base — still legible on the warm cream wash; deeper burnt-orange accent.
  gold: "#F06420", goldDim: "#FFE2C0", gain: GAIN_L, loss: LOSS_L, blue: "#E4820F", accent: "#C94E18",
  fan: NUDE_FAN,
};
// ── Skin 4 · SEA (rich BEACH / ocean-at-sunset fan) ──────────────────────────
// Beach vibe: cool ocean aqua→teal (the Sea identity) woven with warm sand / cream /
// dusty-rose (sunset). Six-tone fan (light → deep): cream #F0E6D2 · dusty-rose #E0B5AB ·
// aqua #A9D8D0 · teal #7FC0BA · sea #4F9D8F · deep teal #356E63 → drives accentGrad + the
// glass sweep so it reads as a layered cool-aqua-meets-warm-sand spectrum, not flat teal.
// DARK = deep ocean bg + aqua glow + warm-sand secondary; LIGHT = a light beach wash + deep
// teal accent + dusty-rose warmth. gain/loss stay semantic. (Skin KEY stays `aurora`.)
const SEA_FAN = ["#F0E6D2", "#E0B5AB", "#A9D8D0", "#7FC0BA", "#4F9D8F", "#356E63"]; // cream·rose·aqua·teal·sea·deep
const AURORA_DARK: Palette = {
  bg: "#04231F", surface: "#0B372F", surface2: "#13564A", line: "#2C7E6A",
  text: "#E7F6EF", muted: "#A2C9BB", faint: "#628C7C",
  // Base = bright aqua-teal glow; secondary = warm SAND (beach warmth); tertiary = aqua →
  // the frosted glass reads as a beachy cool-aqua-meets-warm-sand fan.
  gold: "#7FC0BA", goldDim: "#0A2E28", gain: GAIN_D, loss: LOSS_D, blue: "#A9D8D0", accent: "#DCC6A8",
  fan: SEA_FAN,
};
const AURORA_LIGHT: Palette = {
  bg: "#EDF4EF", surface: "#FFFFFF", surface2: "#DEEAE2", line: "#B6DACD",
  text: "#06231D", muted: "#3F7166", faint: "#85AEA2",
  // Deep teal base (legible on the light beach wash); secondary = dusty-ROSE (sunset warmth).
  gold: "#2F8878", goldDim: "#DCEFE8", gain: GAIN_L, loss: LOSS_L, blue: "#4F9D8F", accent: "#C98A7E",
  fan: SEA_FAN,
};

// Four BRAND skins, each with a light + dark mode. The DARK mode carries the brand
// identity (dark bg, light text); LIGHT is the soft off-white companion. gain/loss
// stay a semantic green/red on every skin.
//  • navy (default) · peach · nude (key `amber`) · sea (key `aurora`)
export const PALETTES: Record<string, { dark: Palette; light: Palette; label: string }> = {
  navy: { dark: NAVY_DARK, light: NAVY_LIGHT, label: "Navy" },
  peach: { dark: PEACH_DARK, light: PEACH_LIGHT, label: "Peach" },
  amber: { dark: NUDE_DARK, light: NUDE_LIGHT, label: "Nude" },
  aurora: { dark: AURORA_DARK, light: AURORA_LIGHT, label: "Sea" },
};

// ── Social-brand tile styles ─────────────────────────────────────────────────
// Each springboard / hub tile EVOKES a well-known social app's COLOUR · GRADIENT ·
// FINISH plus a close TYPOGRAPHIC treatment (font stack + weight + tracking + case),
// so the tile reads in that app's spirit. This is the SINGLE source of truth shared
// by the Home springboard (SectionHub) AND every in-screen hub (TileNav).
//
// These styles are an INTENTIONAL FIXED identity — they do NOT change with the skin
// (premium & consistent, like the apps themselves). Only the surrounding chrome
// (headers, panels, back bar) still follows the active skin via C.*.
//
// IP NOTE: we render NONE of these apps' real logos, wordmarks or brand names — we
// only echo each app's colour + typographic SPIRIT under OUR OWN labels & icons.
// The fills are dark / saturated, so the label + icon ink is WHITE/near-white
// (≥4.5:1) — this intentionally supersedes the old dark-ink tiles.
//
// Owner — tweak each app here: `from/to` (or `bg` for a multi-stop gradient) set the
// fill, `edge` the border, `glow` the drop shadow; `ink` is the light text/icon
// colour and `font`/`weight`/`tracking`/`upper`/`shadow` the typographic look.
export type TileSkin = {
  from: string; to: string; edge: string; glow: string;
  bg?: string;        // optional full gradient (Instagram's multi-stop) — overrides from→to
  ink: string;        // light label + icon colour (white/near-white on these dark fills)
  font: string;       // closest available font stack to that app (no trademarked brand font)
  weight: number; tracking: string; upper: boolean;
  shadow: string;     // label text-shadow tuned for legibility on that fill
};
export type TileKey = "trade" | "learn" | "connect" | "account";

// Web-safe / system font stacks chosen to sit close to each app's real typeface
// WITHOUT bundling the (trademarked) brand font. (Rubik is already loaded app-wide.)
const SANS_GROTESQUE = "'Helvetica Neue', Helvetica, Arial, sans-serif";              // Facebook / Instagram grotesque
const SANS_ROUNDED   = "'Avenir Next', 'Nunito', 'Segoe UI', system-ui, sans-serif";  // TikTok rounded sans
const SANS_NEO       = "'Helvetica Neue', 'Arial Narrow', Arial, sans-serif";         // X tight neo-grotesque
const SANS_ROBOTO    = "Roboto, 'Helvetica Neue', 'Segoe UI', system-ui, sans-serif"; // Telegram / WhatsApp clean sans

// The six brand-inspired tile styles. Colour/gradient/finish + a close font look.
export const BRAND: Record<string, TileSkin> = {
  // Facebook → solid vivid blue, clean grotesque, bold, light text.
  facebook: {
    from: "#1877F2", to: "#0C5AD6", edge: "#0A4DB0", glow: "rgba(24,120,242,0.48)",
    ink: "#FFFFFF", font: SANS_GROTESQUE, weight: 800, tracking: "-0.01em", upper: false,
    shadow: "0 1px 2px rgba(0,0,0,0.32)",
  },
  // Instagram → signature multi-stop gradient, modern grotesque, light text.
  instagram: {
    from: "#515BD4", to: "#F58529", edge: "#C32B6B", glow: "rgba(221,42,123,0.46)",
    bg: "linear-gradient(135deg, #515BD4 0%, #8134AF 30%, #DD2A7B 62%, #F58529 100%)",
    ink: "#FFFFFF", font: SANS_GROTESQUE, weight: 700, tracking: "-0.005em", upper: false,
    shadow: "0 1px 3px rgba(0,0,0,0.45)", // subtle dark shadow keeps white legible over the gradient
  },
  // TikTok → near-black with the duotone cyan+magenta neon glow, bold rounded sans.
  tiktok: {
    from: "#161616", to: "#010101", edge: "#000000", glow: "rgba(37,244,238,0.42)",
    ink: "#FFFFFF", font: SANS_ROUNDED, weight: 700, tracking: "0", upper: false,
    shadow: "0 0 6px rgba(37,244,238,0.55), 0 0 11px rgba(254,44,85,0.45)", // cyan #25F4EE + magenta #FE2C55
  },
  // X / Twitter → black, tight neo-grotesque, minimal, white text.
  x: {
    from: "#15202B", to: "#000000", edge: "#000000", glow: "rgba(0,0,0,0.55)",
    ink: "#FFFFFF", font: SANS_NEO, weight: 800, tracking: "-0.02em", upper: false,
    shadow: "0 1px 2px rgba(0,0,0,0.5)",
  },
  // Telegram → sky-blue gradient, rounded clean (Roboto-like) sans, white text.
  telegram: {
    from: "#2AABEE", to: "#229ED9", edge: "#1B86BC", glow: "rgba(42,171,238,0.46)",
    ink: "#FFFFFF", font: SANS_ROBOTO, weight: 600, tracking: "0", upper: false,
    shadow: "0 1px 2px rgba(0,0,0,0.3)",
  },
  // WhatsApp → green, clean (Helvetica/Roboto-like) sans, white text.
  whatsapp: {
    from: "#25D366", to: "#075E54", edge: "#064E45", glow: "rgba(37,211,102,0.46)",
    ink: "#FFFFFF", font: SANS_ROBOTO, weight: 600, tracking: "0", upper: false,
    shadow: "0 1px 2px rgba(0,0,0,0.42)",
  },
  // Pinterest → feminine red→rose→pink gradient, clean rounded sans, white text.
  pinterest: {
    from: "#E60023", to: "#FF6FA0", edge: "#BD081C", glow: "rgba(230,0,35,0.46)",
    bg: "linear-gradient(150deg, #E60023 0%, #F2356B 52%, #FF6FA0 100%)",
    ink: "#FFFFFF", font: SANS_ROUNDED, weight: 700, tracking: "0", upper: false,
    shadow: "0 1px 3px rgba(0,0,0,0.40)",
  },
};

// HOME springboard assignment (fixed) — a stunning, colourful flow:
//   Trading & Analysis → WhatsApp (green) · Learn → Instagram (gradient) ·
//   Connect → Facebook (blue) · Account & Profile → TikTok (near-black neon).
// (green → multi-stop gradient → blue → black: one dark tile to round it out, per
// the owner's TikTok request. `pinterest` stays defined above for hub reuse.)
export const HOME_TILES: Record<TileKey, TileSkin> = {
  trade: BRAND.whatsapp,
  learn: BRAND.instagram,
  connect: BRAND.facebook,
  account: BRAND.tiktok,
};

// HUB tile flow (TileNav) — a pleasing, varied colour flow by grid position. The two
// darks (TikTok @2, X @6) are kept NON-ADJACENT so no two black tiles ever touch (their
// neighbours are all colourful). Literal Telegram / WhatsApp tiles override this by name
// (see literalBrand) on the Connect hub.
export const HUB_FLOW: TileSkin[] = [
  BRAND.facebook, BRAND.instagram, BRAND.tiktok, BRAND.whatsapp, BRAND.pinterest, BRAND.telegram, BRAND.x,
];

// Match a hub tile to its LITERAL brand by key/label (Connect hub: a Telegram tile →
// Telegram style, a WhatsApp tile → WhatsApp style). Checks EN + HE; null when no
// literal match (caller then falls back to the position-based HUB_FLOW).
export function literalBrand(...keys: (string | undefined)[]): TileSkin | null {
  const s = keys.filter(Boolean).join(" ").toLowerCase();
  if (s.includes("telegram") || s.includes("טלגרם")) return BRAND.telegram;
  if (s.includes("whatsapp") || s.includes("וואטסאפ") || s.includes("ואטסאפ")) return BRAND.whatsapp;
  return null;
}

// Common LIGHT ink shared by the brand tiles (each style also carries its own `ink`,
// which is what the tiles actually use; this remains the default for sub-tile icons
// drawn on a brand gradient in the mini-menu / info popover).
export const TILE_INK = "#FFFFFF";
// The four home tiles in grid order (kept for any positional consumers).
export const TILE_ORDER: TileKey[] = ["trade", "learn", "connect", "account"];

export type ThemePrefs = {
  skin: keyof typeof PALETTES; mode: "dark" | "light"; large: boolean;
  // ── Accessibility (♿) — all OPTIONAL + fail-safe (undefined ⇒ off / 1). None of
  // these use `zoom` or any full-screen overlay (a past overlay froze prod):
  //   • contrast     — high-contrast: strengthens the resolved palette so every C.*
  //                    token jumps to max separation (pure ink, strong borders).
  //   • fontScale    — root font-size multiplier (NO zoom; scales inheriting text).
  //   • reduceMotion — sets an opt-in <html> class; a scoped CSS rule neutralises
  //                    animation/transition ONLY (never layout/pointer — can't trap).
  contrast?: boolean; fontScale?: number; reduceMotion?: boolean;
  // Marks that the user made an EXPLICIT large-text (zoom) choice via the toggle. When ABSENT,
  // `large` is DEFAULTED from the display size (desktop ON / mobile OFF) each load; once the user
  // toggles it, this is set so their choice always wins over the auto-default.
  largeChoice?: boolean;
};
// Default = the brand NAVY skin in its natural DARK mode (the brand identity look).
const DEFAULTS: ThemePrefs = { skin: "navy", mode: "dark", large: false, contrast: false, fontScale: 1, reduceMotion: false };

// ── DEFAULT text size: bigger on LARGE / DESKTOP displays ─────────────────────────────
// The whole UI is px-sized, so the only reliable way to enlarge ALL of it is the display
// zoom (`large` → html{zoom:1.15}). On a large desktop the base 1.0 reads tiny, so we DEFAULT
// the zoom ON for large displays and keep MOBILE at 1.0 (zoom on mobile has a history of
// overflow bugs). Captured ONCE here at module init — BEFORE any zoom is applied (index.html
// ships no zoom) — so window.innerWidth is the true physical width and the decision is STABLE:
// it never flips when the applied zoom later changes innerWidth. Threshold 1024 is chosen so
// that even WITH 1.15 applied, innerWidth (≈1024/1.15 ≈ 890) stays above the 860 desktop/mobile
// breakpoint — the layout never flips to mobile just because the zoom shrank innerWidth.
const _bootLargeDisplay: boolean = typeof window !== "undefined" && window.innerWidth >= 1024;

// High-contrast transform of a resolved palette — keeps the skin's ACCENT hue
// (gold/gain/loss stay recognisable) but pushes background/ink/borders to maximum
// separation. Applied on top of resolve() when prefs.contrast is on, so every C.*
// getter returns the boosted value and the whole tree re-skins via the existing
// "algo770-theme" re-render. No overlay, no layout change — purely token values.
function highContrast(pal: Palette, mode: "dark" | "light"): Palette {
  const light = mode === "light";
  return {
    ...pal,
    bg: light ? "#FFFFFF" : "#000000",
    surface: light ? "#FFFFFF" : "#0A0A0A",
    surface2: light ? "#F0F0F0" : "#171717",
    line: light ? "#000000" : "#FFFFFF",
    text: light ? "#000000" : "#FFFFFF",
    muted: light ? "#1B1B1B" : "#EAEAEA",
    faint: light ? "#333333" : "#C8C8C8",
  };
}

// Shared shape language (rounded, airy) — used by the shared UI primitives.
export const RADIUS = { sm: 10, md: 14, lg: 20, pill: 999 } as const;
export const SHADOW = "0 12px 30px -14px rgba(16,46,40,0.20)";

// Migrate retired/old skin names so users with an old saved theme don't break — the
// previous skins + all earlier retired names map onto the current BRAND skins by closest
// hue (blue→navy, red/pink/purple/magenta→peach, yellow/gold→amber, green/mint→aurora).
// `magenta` is the retired slot the Peach skin replaced, so old "magenta" prefs land on
// peach. Anything unknown falls back to the default (navy).
const SKIN_ALIASES: Record<string, keyof typeof PALETTES> = {
  cyan: "navy", blue: "navy", ocean: "navy",
  magenta: "peach", red: "peach", pink: "peach", purple: "peach", violet: "peach", crimson: "peach",
  yellow: "amber", gold: "amber", wild: "amber", crypto: "amber", cream: "amber", banana: "amber",
  nude: "amber", coral: "amber", // the Yellow skin was recoloured into "Nude" (key kept)
  green: "aurora", mint: "aurora", emerald: "aurora",
};

export function loadThemePrefs(): ThemePrefs {
  try {
    const p = JSON.parse(localStorage.getItem("algo770_theme") || "{}");
    let skin = p.skin as string;
    if (skin && SKIN_ALIASES[skin]) skin = SKIN_ALIASES[skin];
    if (!skin || !(PALETTES as any)[skin]) skin = DEFAULTS.skin;
    const mode = p.mode === "dark" || p.mode === "light" ? p.mode : DEFAULTS.mode;
    const prefs: ThemePrefs = { ...DEFAULTS, ...p, skin: skin as keyof typeof PALETTES, mode };
    // Until the user makes an EXPLICIT large-text choice, DEFAULT the zoom from the display size
    // (desktop ON / mobile OFF). Re-evaluated each load, so it's correct per device without
    // forcing zoom on mobile; an explicit toggle (largeChoice) always overrides this.
    if (prefs.largeChoice !== true) prefs.large = _bootLargeDisplay;
    return prefs;
  } catch { return { ...DEFAULTS, large: _bootLargeDisplay }; }
}

function resolve(p: ThemePrefs): Palette {
  const pal = (PALETTES as any)[p.skin] || PALETTES.navy;
  return pal[p.mode] || pal.dark || NAVY_DARK;
}

// ── Small colour maths so the one glossy "primary button" look adapts per skin ──
function hexToRgb(h: string): [number, number, number] {
  const m = h.replace("#", ""); const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const i = parseInt(n, 16); return [(i >> 16) & 255, (i >> 8) & 255, i & 255];
}
const toHex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
function darken(h: string, amt: number) { const [r, g, b] = hexToRgb(h); return `#${toHex(r * (1 - amt))}${toHex(g * (1 - amt))}${toHex(b * (1 - amt))}`; }
// Mix a hue toward white (amt 0..1) — the light end of a skin's tonal fan.
function lighten(h: string, amt: number) { const [r, g, b] = hexToRgb(h); return `#${toHex(r + (255 - r) * amt)}${toHex(g + (255 - g) * amt)}${toHex(b + (255 - b) * amt)}`; }
// Hex → rgba() so a hue can be laid down translucently (for frosted-glass fills).
function rgba(h: string, a: number) { const [r, g, b] = hexToRgb(h); return `rgba(${r}, ${g}, ${b}, ${a})`; }
function relLum([r, g, b]: [number, number, number]) {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
// Readable ink on top of an accent fill: warm near-black on the lighter accents
// (cyan, cream — matches the look Dan liked on the Start button), white on the
// darker ones (purple). Threshold tuned so each skin lands on its better contrast.
export function onAccent(h: string) { return relLum(hexToRgb(h)) > 0.3 ? "#16110a" : "#ffffff"; }

let _active: Palette = resolve(loadThemePrefs());
// Current mode is needed by the glass/tonal getters below (they tune translucency &
// highlights differently for dark vs light). Kept in sync by applyThemePrefs().
let _mode: "dark" | "light" = loadThemePrefs().mode;

export function applyThemePrefs(p: ThemePrefs) {
  _active = resolve(p);
  _mode = p.mode;
  // ♿ High-contrast — boost the resolved palette so every C.* token maximises
  // separation. Done here (after resolve) so it composes with any skin/mode.
  if (p.contrast) _active = highContrast(_active, p.mode);
  try {
    // ♿ Font scale — NO zoom: a root font-size multiplier (scales inheriting text).
    const fs = p.fontScale && p.fontScale > 0 ? p.fontScale : 1;
    document.documentElement.style.fontSize = fs !== 1 ? `${Math.round(fs * 100)}%` : "";
    // ♿ Reduce motion — opt-in <html> class; the scoped CSS rule (ui-global.css)
    // only neutralises animation/transition, so it can never cover the page or
    // trap clicks. Also flags high-contrast on the root for any CSS that needs it.
    document.documentElement.classList.toggle("a11y-reduce-motion", !!p.reduceMotion);
    document.documentElement.classList.toggle("a11y-contrast", !!p.contrast);
    localStorage.setItem("algo770_theme", JSON.stringify(p));
    // Base background/text flip with the theme so EVERY screen gets the right
    // backdrop (cards/text already read C). This is what makes light mode work.
    // Light = soft airy off-white wash; dark = brushed "metallic chrome": a lighter
    // metal band up top easing into the charcoal base, so it has depth, not flat black.
    const grad = p.mode === "light"
      ? `linear-gradient(170deg, ${_active.surface} 0%, ${_active.bg} 55%)`
      : `linear-gradient(152deg, ${_active.surface2} 0%, ${_active.bg} 50%, ${_active.bg} 100%)`;
    document.body.style.background = grad;
    document.body.style.color = _active.text;
    document.documentElement.style.background = _active.bg;
    // The #root mount has a hardcoded dark bg in index.html that otherwise covers
    // the themed body on screens that don't paint a full background → dark edges.
    const root = document.getElementById("root");
    if (root) root.style.background = grad;
    // Large-text "senior" mode: zoom the whole app up a notch.
    (document.documentElement.style as any).zoom = p.large ? "1.15" : "";
    document.documentElement.style.setProperty("color-scheme", p.mode);
    // Styling hook: expose the active light/dark mode as an attribute so mode-aware CSS
    // (e.g. the liquid-glass finish, which needs a dark base in dark mode and a bright
    // frosted base in light mode) can select on it. Presentation only — no behaviour change.
    document.documentElement.setAttribute("data-mode", p.mode);
    // ── One CLEAN, FLAT button look, driven by CSS vars so the .gbtn class
    // re-themes per skin (cyan / red / yellow / green) and per mode automatically:
    // a solid accent fill + a darker accent border so the button pops — no gloss,
    // no sheen, no glow. The accent (default) plus the semantic red/green variants
    // share the identical structure; only the hue changes. ──
    const rs = document.documentElement.style;
    const bdAmt = p.mode === "dark" ? 0.3 : 0.36;
    const setBtn = (name: string, base: string) => {
      const sfx = name ? `-${name}` : "";
      rs.setProperty(`--btn${sfx}-bg`, base);                 // flat solid fill
      rs.setProperty(`--btn${sfx}-bd`, darken(base, bdAmt));  // darker border
      rs.setProperty(`--btn${sfx}-ink`, onAccent(base));      // readable ink
    };
    setBtn("", _active.gold);     // primary accent (cyan / red / yellow / green per skin)
    setBtn("loss", _active.loss); // destructive — stays the semantic red, same structure
    setBtn("gain", _active.gain); // success — stays the semantic green, same structure
  } catch (_e) { /* */ }
}
// apply persisted prefs immediately (zoom etc.)
try { applyThemePrefs(loadThemePrefs()); } catch (_e) { /* */ }

// Colours read the active palette on every access → switching re-themes live.
export const C = {
  get bg() { return _active.bg; }, get surface() { return _active.surface; }, get surface2() { return _active.surface2; },
  get line() { return _active.line; }, get text() { return _active.text; }, get muted() { return _active.muted; },
  get faint() { return _active.faint; }, get gold() { return _active.gold; }, get goldDim() { return _active.goldDim; },
  // FRAME/BORDER accent — the skin's frameAccent override if set (Navy DARK = white), else gold.
  // Use for the BORDER colour of framed containers; text/icons keep C.gold.
  get frameAccent() { return _active.frameAccent || _active.gold; },
  get gain() { return _active.gain; }, get loss() { return _active.loss; }, get blue() { return _active.blue; },
  get accent() { return _active.accent; },

  // ── Multi-tonal / GLASS design tokens (skin spectrum + glassmorphism) ─────────
  // Each skin now reads as a FAN of tones around its base hue rather than one flat
  // fill: `accentHi`/`accentLo` are the light/dark ends of the accent, `accentGrad`
  // a ready 3-stop sweep across them, and the `glass*` tokens a frosted-glass surface
  // (translucent skin tones + a soft top highlight + hairline) that floats over the
  // ambient backdrop. All derived from the ACTIVE palette, so every skin (navy /
  // peach / amber / aurora) and both modes get a tuned, consistent treatment.
  // PRONOUNCED, unmistakable glass + a wide fan of tones. Tuned to be obvious at a glance
  // (the subtle version didn't register): strong translucency + heavy backdrop blur + a
  // clearly-visible light→base→dark accent sweep + a two-hue tint + a bright lit edge.
  // Light/dark ends of the accent. A skin with an explicit tonal `fan` uses its lightest
  // and deepest tones directly (so e.g. Peach reads as its true Pantone ends); otherwise
  // they're derived from the base accent (lighten/darken).
  get accentHi() { const f = _active.fan; return f && f.length ? f[0] : lighten(_active.gold, 0.34); },
  get accentLo() { const f = _active.fan; return f && f.length ? f[f.length - 1] : darken(_active.gold, 0.36); },
  // A WIDE, obvious sweep across the skin hue (light top-left → base → dark bottom-right).
  // When the skin carries an explicit `fan` (any length ≥2), sweep across ALL of its tones
  // evenly so the gradient IS the brand tonal fan (Peach 4-stop, Sea 3-stop, Yellow 6-stop);
  // else derive a 3-stop sweep from the base accent.
  get accentGrad() {
    const f = _active.fan;
    if (f && f.length >= 2) {
      const stops = f.map((c, i) => `${c} ${Math.round((i / (f.length - 1)) * 100)}%`).join(", ");
      return `linear-gradient(140deg, ${stops})`;
    }
    return `linear-gradient(140deg, ${lighten(_active.gold, 0.34)} 0%, ${_active.gold} 44%, ${darken(_active.gold, 0.36)} 100%)`;
  },
  // Neutral frosted glass — MORE translucent so the backdrop clearly shows through (obvious
  // frost), with a visible diagonal tonal sweep + a lighter top corner.
  get glass() { const d = _mode === "dark"; return `linear-gradient(150deg, ${rgba(lighten(_active.surface2, 0.28), d ? 0.46 : 0.62)} 0%, ${rgba(_active.surface, d ? 0.20 : 0.38)} 55%, ${rgba(_active.surface2, d ? 0.34 : 0.52)} 100%)`; },
  // Skin-tinted frosted glass — a STRONG accent bleed PLUS a secondary-hue (blue/tertiary)
  // tone → a visibly multi-tonal frost (a real fan of tones, not one flat wash).
  get glassTint() { const d = _mode === "dark"; return `linear-gradient(146deg, ${rgba(_active.gold, d ? 0.36 : 0.28)} 0%, ${rgba(_active.blue, d ? 0.18 : 0.14)} 40%, ${rgba(_active.surface2, d ? 0.34 : 0.52)} 100%)`; },
  // High-opacity frosted panel — for large text-heavy surfaces (the side drawer) that must
  // stay fully legible while still reading as frosted glass over the backdrop behind them.
  get glassPanel() { const d = _mode === "dark"; return `linear-gradient(158deg, ${rgba(_active.surface2, d ? 0.84 : 0.9)} 0%, ${rgba(_active.surface, d ? 0.76 : 0.85)} 100%)`; },
  // Brighter hairline so the frosted edge is clearly visible (a lit glass rim).
  get glassBd() { return _mode === "dark" ? "rgba(255,255,255,0.30)" : rgba(_active.gold, 0.40); },
  // Bright top highlight + a soft inner bottom shade → reads as a lit, curved glass surface.
  // Dimensional bevel: a white top HIGHLIGHT + a soft bottom SHADOW tinted with THIS skin's
  // own deep accent tone (a darkened skin colour) rather than flat black — so every skin (on
  // its light base + in dark mode) reads as rich, layered shading in its own hues, not static.
  get glassHi() {
    const shade = darken(_active.gold, _mode === "dark" ? 0.62 : 0.30);
    return _mode === "dark"
      ? `inset 0 1.5px 0 rgba(255,255,255,0.42), inset 0 -11px 24px -13px ${rgba(shade, 0.5)}`
      : `inset 0 1.5px 0 rgba(255,255,255,0.92), inset 0 -11px 24px -16px ${rgba(shade, 0.17)}`;
  },
  // Heavy blur so it is unmistakably frosted.
  get glassBlur() { return "blur(20px) saturate(1.7)"; },
  // Wordmark / title colour with STRONG contrast on every skin & mode. The bright
  // accent (C.gold) washes out on light backdrops — e.g. banana-yellow on yellow-
  // light — so on a light backdrop we use a deeply darkened version of the accent
  // (keeps the skin hue, but readable); on a dark backdrop we keep the bright accent.
  get titleInk() { return relLum(hexToRgb(_active.bg)) > 0.5 ? darken(_active.gold, 0.5) : _active.gold; },
  // Wordmark TITLE gradient — the skin-adaptive gradient that clips into the per-screen
  // title text so every inner screen wears the SAME gradient treatment as Home's
  // StrateTeach wordmark (Dan: "צבעי הכותרת" — identical title colours). On DARK we sweep
  // the skin's full tonal `fan` (the exact accentGrad fan); on a LIGHT backdrop the pale
  // fan tones wash out, so we sweep DARKENED accent tones (mirrors titleInk's logic) so
  // the title stays richly legible. Consumed via background-clip:text (see ScreenHeader).
  get titleGrad() {
    if (_mode === "light") return `linear-gradient(135deg, ${darken(_active.gold, 0.12)} 0%, ${darken(_active.gold, 0.5)} 100%)`;
    const f = _active.fan;
    if (f && f.length >= 2) {
      const stops = f.map((c, i) => `${c} ${Math.round((i / (f.length - 1)) * 100)}%`).join(", ");
      return `linear-gradient(140deg, ${stops})`;
    }
    return `linear-gradient(140deg, ${lighten(_active.gold, 0.34)} 0%, ${_active.gold} 44%, ${darken(_active.gold, 0.36)} 100%)`;
  },
};

// The four Home springboard tiles — now drawn from the ACTIVE SKIN's tone-fan (the SAME
// generator as the inner-hub tiles, skinTileFlow), so Home re-skins with the rest of the
// app: peach on Peach, teal on Sea, gold on Yellow, blue on Navy. Ink is onAccent(base)
// per tile so icons + labels stay legible on the LIGHT skins (no invisible white ink on a
// pale peach/yellow tile). Each section keeps its own illustration + identity; only the
// hue changes. (The old fixed social-brand styles live on in HOME_TILES/BRAND for
// reference but are no longer applied.)
export function activeTiles(): Record<TileKey, TileSkin> {
  const b = skinTileBases();
  return {
    trade: tileFromBase(b[0]),
    learn: tileFromBase(b[1]),
    connect: tileFromBase(b[2]),
    account: tileFromBase(b[3]),
  };
}

// ── Skin-derived hub tiles ────────────────────────────────────────────────────
// The inner hub screens (TileNav — Analytics/Trading-engine/… "father" tiles) draw
// their colour from the ACTIVE skin instead of a fixed social-brand rainbow, so the
// tiles read as the skin's own tone-fan (peach on Peach, teal on Sea, gold on Yellow,
// blue on Navy) and can never clash with the palette. Ink is onAccent(base) so text is
// legible on both light and dark accents. Each tile is a gradient across one saturated
// skin tone; positions cycle through gold → accent → blue → deep-gold.
function tileFromBase(base: string): TileSkin {
  const ink = onAccent(base);
  return {
    from: lighten(base, 0.12), to: darken(base, 0.30),
    edge: darken(base, 0.42), glow: rgba(base, 0.46),
    ink,
    font: "'Rubik', 'Heebo', system-ui, -apple-system, 'Segoe UI', sans-serif",
    weight: 800, tracking: "-0.005em", upper: false,
    // Light text (white ink on a dark accent) → dark shadow; dark ink on a light accent
    // → a soft light shadow. Keeps the label crisp on either.
    shadow: ink === "#ffffff" ? "0 1px 2px rgba(0,0,0,0.34)" : "0 1px 1px rgba(255,255,255,0.4)",
  };
}
// The saturated in-family skin tones used, in order, for hub tiles.
function skinTileBases(): string[] {
  return [_active.gold, _active.accent, _active.blue, darken(_active.gold, 0.26)];
}
// A per-skin tone-fan of hub tiles (replaces the fixed HUB_FLOW social-brand rainbow for
// the inner hub father tiles). Re-computed on each render so it re-skins live.
export function skinTileFlow(): TileSkin[] {
  return skinTileBases().map(tileFromBase);
}

// Primary UI font — reverted from the Jost (AvantGarde) experiment back to "Rubik"
// (the previous font) for readability, per the owner. Rubik renders HE + EN cleanly;
// "Heebo" rides as an extra geometric Hebrew fallback. Applied app-wide via
// document.body.style.fontFamily = UI (main.tsx).
export const UI = "'Rubik', 'Heebo', system-ui, -apple-system, 'Segoe UI', sans-serif"; // renders HE + EN
export const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace"; // numbers/tickers stay mono

// The diamond = signal strength. fill=solid diamond, outline=hollow.
export const TIERS = {
  breaking_out: { c: "#F7931A", fill: true, he: "פורץ", en: "Breaking out" },
  near_breakout: { c: "#F7931A", fill: false, he: "קרוב לפריצה", en: "Near breakout" },
  in_uptrend: { c: "#16C77E", fill: true, he: "במגמת עלייה", en: "In uptrend" },
  building: { c: "#5AA6FF", fill: false, he: "מתבסס", en: "Building" },
  in_downtrend: { c: "#F0616D", fill: true, he: "במגמת ירידה", en: "In downtrend" },
  near_breakdown: { c: "#F0616D", fill: false, he: "קרוב לשבירה", en: "Near breakdown" },
  breaking_down: { c: "#F0616D", fill: true, he: "שובר", en: "Breaking down" },
  neutral: { c: "#5C636F", fill: false, he: "ניטרלי", en: "Neutral" },
} as const;

export type TierKey = keyof typeof TIERS;
export const tierInfo = (t: string) =>
  (TIERS as Record<string, (typeof TIERS)[TierKey]>)[t] || TIERS.neutral;
