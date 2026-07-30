import React, { useEffect, useRef, useState } from "react";
import { useIsMobile } from "../lib/useIsMobile";
import { skinTileFlow, literalBrand } from "../theme";
import FitLabel from "./FitLabel";
import ScreenCenterpiece from "./ScreenCenterpiece";

// `grad` is kept for backward-compat with existing callers but is no longer used to
// colour the tile: TileNav now draws every hub's tile colour from the shared PER-SKIN
// palette (theme.ts) by grid position, so all hubs match Home and re-skin together.
export type TileItem = { key: string; label: string; Icon: React.FC<any>; grad: string; tour?: string };

// In-screen tile hub for every INNER hub screen — Profit, Admin and all HubScreen-based
// screens. Unlike the HOME springboard (SectionHub: a big centred turning-Earth circle),
// the inner screens render the four father tiles as a COMPACT horizontal ROW. Tapping a
// tile selects that section (the parent renders the matching panel below). The compact row
// deliberately drops the orbit decoration (that stays on Home only).
//
// VERTICAL placement adapts to whether a sub-panel is open (Dan's "don't leave it
// disconnected at the top" note):
//   • NO panel open (a pure hub — My profile / Explanations / Settings / Account, where the
//     tile row is the only thing showing): the row is VERTICALLY CENTRED in the free space
//     between the content above (header + P&L card / chart) and the bottom TabBar — so it
//     doesn't float up at the top with a big void beneath. We measure the row's live top
//     offset and grow the wrapper down to just above the TabBar, then flex-centre the tiles.
//   • A panel IS open (or the screen already has tall content): the row stays in normal
//     TOP-aligned flow so the panel below gets the room — it simply centres within whatever
//     space is actually free, which on a busy screen is small, so it reads as top-aligned.
// It never floats over the screen header (the old #371 overlap can't come back) because the
// fill height is measured FROM the row's own top, never from the viewport top.
export default function TileNav({ items, active, onSelect, mobile: mobileProp, centerTitle, hub }: {
  items: TileItem[]; active: string; onSelect: (k: string) => void; mobile?: boolean;
  // "Section-hub" screens lead with the big spaced title at the TOP (in ScreenHeader),
  // so the empty-center orb drops its now-duplicate title and shows the globe ALONE.
  hub?: boolean;
  // Still ACCEPTED for backward-compat with callers (HubScreen passes it) but intentionally
  // not read: the compact row is ALWAYS in normal top-aligned flow now, so it no longer
  // changes the layout. Left in the prop type so existing `topAligned={…}` callers compile.
  topAligned?: boolean;
  // Optional explicit title for the empty-center branded centerpiece (globe + wordmark).
  // When omitted, ScreenCenterpiece derives the screen's own title from the route.
  centerTitle?: string;
}) {
  const detected = useIsMobile();
  const mobile = mobileProp ?? detected;

  // "No sub-panel open" = no section is selected (`active` falsy). HubScreen passes
  // `active={father}` ("" until a tile is tapped); the other inner screens (Profit, Admin,
  // Exchange, …) keep their own ssec/psec tile state and likewise pass "" while nothing's
  // open. In that state the tile row is the ONLY thing showing, so we vertically centre it.
  const centered = !active;

  // When centred, grow the wrapper to fill the space from the row's own top down to just
  // above the bottom TabBar, so the flex column can centre the tiles in that gap instead of
  // pinning them at the top. Measured from the LIVE top offset, so it self-adjusts to
  // however much content (header + P&L card + chart) sits above on each screen.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [fillH, setFillH] = useState<number | null>(null);
  useEffect(() => {
    if (!centered) { setFillH(null); return; }
    // TabBar height + a comfortable margin so the centred row never hides behind it (mobile
    // also leaves room for the home-indicator safe area).
    const TABBAR = mobile ? 96 : 72;
    const measure = () => {
      const el = wrapRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const avail = window.innerHeight - top - TABBAR;
      // Only take over the height when there's MORE room than the row needs; on a busy
      // screen (little free space) we leave it in natural top-aligned flow.
      setFillH(avail > TILEH + 24 ? avail : null);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("algo770-theme", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("algo770-theme", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centered, mobile, active]);

  // Re-render on skin/mode change so the PER-SKIN tile palette re-colours live.
  const [, themeTick] = useState(0);
  useEffect(() => {
    const on = () => themeTick((n) => n + 1);
    window.addEventListener("algo770-theme", on);
    return () => window.removeEventListener("algo770-theme", on);
  }, []);
  // Hub tile styles now DERIVE FROM THE ACTIVE SKIN (skinTileFlow → a peach/teal/gold/blue
  // tone-fan by grid position) so the father tiles re-skin with the rest of the app and can
  // never clash (the old fixed social-brand rainbow was green/black/magenta/blue — the
  // magenta no longer exists as a skin). A tile that maps to a LITERAL app (a Telegram tile
  // → Telegram style, WhatsApp → WhatsApp) still overrides by name, since that colour is
  // meaningful brand identity, not a random hue. Re-computed each render → re-skins live.
  const flow = skinTileFlow();
  const tileFor = (it: TileItem, i: number) =>
    literalBrand(it.key, it.label) || flow[i % flow.length];

  // Compact-row tile metrics — small, slightly RECTANGULAR buttons (wider-than-tall),
  // NOT big squares (Dan). A short fixed HEIGHT (≥44px tap target) with the chip + label
  // laid out side-by-side (icon LEFT of label) keeps each tile a tidy rectangle. On
  // desktop the tile width is CAPPED (TILEW) so 2 tiles can't blow up to fill the row;
  // on mobile each tile takes a hair under half the row so they sit 2-up.
  const GAP = mobile ? 10 : 12;
  const TILEH = mobile ? 54 : 62;   // short rectangle; stays ≥44px for tap targets
  const TILEW = mobile ? 0 : 172;   // desktop: capped tile width (mobile uses a 2-up basis)
  const BIGICON = mobile ? 52 : 70; // faint background illustration, scaled to the small tile
  const CHIP = mobile ? 30 : 36;
  const CHIPI = mobile ? 17 : 20;
  // Label a notch SMALLER so it reads neat in BOTH en + he/RTL while the longest words
  // still fit; FitLabel auto-shrinks a too-long label to the tile.
  const LBL = mobile ? 11.5 : 13.5;
  const PADX = mobile ? 10 : 14;    // horizontal padding (height is fixed via TILEH)
  const RAD = mobile ? 14 : 16;
  const TGAP = mobile ? 8 : 10;     // gap between the chip and the label

  // One compact-row tile — a short rectangle with the chip LEFT of the label. Labels wrap
  // ONLY at word boundaries (FitLabel keeps whole words atomic) and auto-shrink to fit.
  const renderTile = (it: TileItem, i: number) => {
    const on = active === it.key;
    const th = tileFor(it, i);
    return (
      <button key={it.key} onClick={() => onSelect(it.key)} data-tour={it.tour}
        style={{ position: "relative", overflow: "hidden",
          // Sizing: mobile sits 2-up (basis = half-row minus half-gap, no grow so a lone
          // 3rd/odd tile stays compact instead of stretching); desktop is a capped fixed
          // width so 2 tiles stay small & centred rather than ballooning to fill the row.
          flex: mobile ? "0 1 calc(50% - 5px)" : "0 0 auto", width: mobile ? "auto" : TILEW,
          minWidth: 0, height: TILEH,
          // Brand-inspired fill by grid position (HUB_FLOW) or literal app match — the
          // same social-brand styles as the Home springboard, FIXED across skins. The
          // fills are dark/saturated → WHITE ink + light icon. The hub chrome AROUND the
          // tiles (headers, panels, back bar) still follows the skin (C.*).
          background: th.bg || `linear-gradient(160deg, ${th.from} 0%, ${th.to} 100%)`,
          border: on ? `2px solid ${th.ink}` : `1.5px solid ${th.edge}`, borderRadius: RAD, padding: `0 ${PADX}px`,
          cursor: "pointer", fontFamily: "inherit", color: th.ink, textAlign: "start",
          display: "flex", flexDirection: "row", justifyContent: "flex-start", alignItems: "center", gap: TGAP,
          // Depth: coloured drop glow + a top inner highlight + a bottom inner shade; the
          // selected tile gets a LIGHT ring + a small lift (white reads on these dark tiles).
          boxShadow: on
            ? `0 0 0 2px ${th.ink}, 0 12px 24px -12px ${th.glow}`
            : `0 8px 20px -14px ${th.glow}, inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -10px 22px -16px rgba(0,0,0,0.34)`,
          transform: on ? "translateY(-1px)" : "none", transition: "transform .15s ease, box-shadow .18s ease" }}>
        {/* glossy top sheen — the Apple-style light catch */}
        <span aria-hidden style={{ position: "absolute", insetInline: 0, top: 0, height: "56%", borderRadius: `${RAD}px ${RAD}px 0 0`,
          background: "linear-gradient(180deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0) 100%)", pointerEvents: "none", zIndex: 1 }} />
        {/* faint icon illustration behind the chip/label → per-tile depth & identity */}
        <it.Icon aria-hidden size={BIGICON} color={th.ink} strokeWidth={1.2} style={{ position: "absolute", insetInlineEnd: -12, bottom: -12, opacity: 0.1, pointerEvents: "none", zIndex: 1 }} />
        {/* app-icon chip — frosted DARK-glass plate so the LIGHT icon reads on the brand fill */}
        <span style={{ position: "relative", zIndex: 2, width: CHIP, height: CHIP, flexShrink: 0, borderRadius: 11, background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.34)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 12px -5px rgba(0,0,0,0.5)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <it.Icon size={CHIPI} color={th.ink} strokeWidth={2.3} />
        </span>
        {/* label — WHITE brand ink in the app's typographic spirit (font + weight + tracking
            + case per brand) with a per-brand shadow. FitLabel wraps ONLY at word
            boundaries (whole words stay atomic — never a mid-word break that orphans a
            lone trailing letter like "ת"/"ם"/"s") and auto-shrinks a too-long label
            (e.g. "אסטרטגיות") so it fits the small tile in both he + en. */}
        <span style={{ position: "relative", zIndex: 2, flex: 1, minWidth: 0, display: "block" }}>
          <FitLabel text={it.label} size={LBL} maxLines={2}
            style={{ fontFamily: th.font, fontWeight: th.weight, textTransform: th.upper ? "uppercase" : "none", letterSpacing: th.tracking, color: th.ink, textShadow: th.shadow, textAlign: "start" }} />
        </span>
      </button>
    );
  };

  // Compact horizontal ROW of small rectangular buttons (no orbit). It WRAPS (mobile sits
  // 2-up; desktop flows capped-width tiles) and is horizontally centred, so 2 tiles stay
  // compact instead of stretching. When nothing is open (`centered` + a measured `fillH`)
  // the wrapper becomes a flex column that grows to fill the free space and centres the row
  // VERTICALLY; otherwise it's normal top-aligned flow and the parent renders the selected
  // section's panel directly BELOW this row.
  return (
    <div ref={wrapRef} style={{ marginBottom: 16,
      ...(centered && fillH ? { minHeight: fillH, display: "flex", flexDirection: "column", justifyContent: "center", position: "relative" } : null) }}>
      {/* Empty-center branded centerpiece: the boot-splash globe + this screen's own
          title (wordmark style), CENTRED in the gap, BEHIND the tile row (pointer-events
          off) so it never blocks the floating action buttons. Only when the center is
          actually empty (nothing selected + measured free space). */}
      {centered && fillH ? <ScreenCenterpiece title={centerTitle} showTitle={!hub} /> : null}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: GAP, position: "relative", zIndex: 1 }}>
        {items.map(renderTile)}
      </div>
    </div>
  );
}
