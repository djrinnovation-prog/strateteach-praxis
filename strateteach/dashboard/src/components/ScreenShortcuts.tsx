import React, { useMemo, useState, useRef, useLayoutEffect } from "react";
import { Pencil, MoreHorizontal } from "lucide-react";
import { useI18n } from "../i18n";
import { useIsMobile } from "../lib/useIsMobile";
import { C, UI, onAccent } from "../theme";
import { sqTile } from "../screens/Home";
import LayoutEditor, { type EditorItem } from "./LayoutEditor";
import { useLayout, applyArrangement, legacyShortcutKeys, type LayoutArrangement } from "../lib/layout";

// ── Width-based auto-fit tile label ───────────────────────────────────────────
// Fixes the shortcut-tile labels being cut / broken mid-word (Dan). History: keep-all didn't stop
// the Hebrew break; then nowrap stopped the break but the STEPPING-loop shrink never applied (it
// measured scrollWidth on the visible span, which is unreliable for inline/overflowing text — it
// didn't report the overflow, so the loop never shrank and the word CLIPPED to "אסטרטגי").
//
// This version measures the NATURAL word width at the FULL base font via a dedicated HIDDEN,
// content-sized measuring span (getBoundingClientRect — reliable), then applies ONE direct ratio:
//   fontSize = clamp(min, base × (innerWidth − 3) / widestWordWidth, base)
// No loop, no reliance on scrollWidth. Guaranteed to compute and apply via state.
//   • SINGLE-word (no space) → the visible span is white-space:NOWRAP, so it can only be ONE line;
//     the ratio shrinks the font so that one line fits — never a mid-word break, never a clip.
//   • MULTI-word ("סריקה יומית" / "Daily scan") → white-space:normal wraps at the SPACE; the
//     "widest word" metric ⇒ we shrink only if the longer word itself overflows.
// WIDTH-only (never height → can't collapse to 0); fixed-height 2-line slot stays. Re-fits on text
// change, tile resize (ResizeObserver), and web-font load (document.fonts.ready) — and the
// not-laid-out guard only SKIPS that pass (RO/fonts re-fire), it never permanently disables the fit.
function FitWidthLabel({ text, color, max, min }: { text: string; color: string; max: number; min: number }) {
  const oneWord = !/\s/.test(text.trim());   // no space ⇒ a single word that must never break
  const measRef = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(max);
  useLayoutEffect(() => {
    const meas = measRef.current;
    const host = meas?.parentElement;         // the caller's labelSlot → clientWidth = tile inner width
    if (!meas || !host) return;
    let raf = 0, alive = true;
    const fit = () => {
      if (!alive) return;
      const inner = host.clientWidth;
      if (inner < 4) return;                  // not laid out yet — RO / fonts.ready will re-fire
      const words = text.trim().split(/\s+/).filter(Boolean);
      if (!words.length) { setSize(max); return; }
      meas.style.fontSize = `${max}px`;       // measure at the FULL base font
      let widest = 0;
      for (const w of words) { meas.textContent = w; widest = Math.max(widest, meas.getBoundingClientRect().width); }
      const target = widest > 0 ? Math.max(min, Math.min(max, (max * (inner - 3)) / widest)) : max;
      setSize(Math.round(target * 10) / 10);  // 0.1px precision — always ≤ base, so it truly shrinks
    };
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); };
    fit();
    let ro: ResizeObserver | null = null;
    try { if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(schedule); ro.observe(host); } } catch { /* */ }
    try { (document as any).fonts?.ready?.then?.(() => { if (alive) schedule(); }); } catch { /* */ }
    return () => { alive = false; cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [text, max, min]);
  return (
    <>
      {/* Hidden, content-sized measuring span — base font, nowrap; getBoundingClientRect().width
          gives each word's NATURAL width reliably (unlike scrollWidth on the visible span). */}
      <span ref={measRef} aria-hidden style={{ position: "absolute", left: -9999, top: 0, visibility: "hidden",
        whiteSpace: "nowrap", display: "inline-block", fontWeight: 900, fontFamily: UI, pointerEvents: "none" }} />
      <span style={{ display: "block", width: "100%", fontWeight: 900, lineHeight: 1.1, textAlign: "center",
        whiteSpace: oneWord ? "nowrap" : "normal", overflowWrap: "normal", wordBreak: "keep-all", hyphens: "none",
        fontSize: size, color }}>
        {text}
      </span>
    </>
  );
}

// ── Shared EDITABLE top-shortcuts row ─────────────────────────────────────────
// A horizontally-scrolling row of up to FIVE user-chosen shortcut pills, an accent
// "עוד במערכת / More" chip that opens the screen's extras child, and a ✎ pencil
// that opens the shared LayoutEditor (choose-from-list + ↑/↓ + APPROVE) to pick
// which of the screen's real actions fill the five slots + their order. The chosen
// arrangement is SERVER-BACKED (per user, resolving user → role → default → code),
// so a user's picks follow them across devices and owners can set a default/role
// layout for everyone. localStorage stays a fast-path + offline fallback. Every
// pill's onClick is a REAL existing action the screen passes in — this is a
// re-layout, nothing is added or removed. Skin-aware (C.*), RTL-correct.
//
// The consuming screen is responsible for role-gating: pass into `catalog` ONLY the
// shortcuts the current user (user / employee / owner) is allowed to see. Mark any
// safety-critical shortcut `locked` and the editor can reorder but never hide it.

export type Shortcut = { key: string; label: string; Icon: React.FC<any>; onClick: () => void; locked?: boolean };
const MAX = 5;

export default function ScreenShortcuts({ screenKey, catalog, defaultKeys, onMore, moreItems, moreLabel, label, onEditOverride, liquid }: {
  screenKey: string;                 // layout namespace, e.g. "exchange"
  catalog: Shortcut[];               // ALL available shortcuts (already role-filtered by the screen)
  defaultKeys?: string[];            // initial 5 (defaults to the first 5 of the catalog)
  onMore?: () => void;               // override: "עוד במערכת" chip → run this instead of the launcher sheet
  moreItems?: Shortcut[];            // extras child contents (defaults to the full catalog) — launched from "עוד במערכת"
  moreLabel?: string;                // override the More chip label
  label?: string;                    // section label (defaults to "קיצורים / Shortcuts")
  onEditOverride?: () => void;       // route the ✎ pencil to an external editor (e.g. Home's combined modal)
  liquid?: boolean;                  // opt-in LIQUID-GLASS finish on the shortcut tiles (STAGE-1 preview)
}) {
  const { lang } = useI18n();
  const he = lang === "he";
  void label; void moreItems;
  const byKey = useMemo(() => new Map(catalog.map((c) => [c.key, c])), [catalog]);
  const catalogKeys = useMemo(() => catalog.map((c) => c.key), [catalog]);
  const items: EditorItem[] = useMemo(() => catalog.map((c) => ({ id: c.key, label: c.label, Icon: c.Icon, locked: c.locked })), [catalog]);
  const lockedIds = useMemo(() => items.filter((i) => i.locked).map((i) => i.id), [items]);

  const { arr, canEditShared, role, save } = useLayout(screenKey);
  const [editOpen, setEditOpen] = useState(false);

  // The code default = the screen's defaultKeys SHOWN (capped at 5), everything else
  // hidden — so an untouched screen looks exactly as the screen author intended.
  const codeDefault: LayoutArrangement = useMemo(() => {
    const def = (defaultKeys && defaultKeys.length ? defaultKeys : catalogKeys).filter((k) => byKey.has(k)).slice(0, MAX);
    const defSet = new Set(def);
    const rest = catalogKeys.filter((k) => !defSet.has(k));
    return { order: [...def, ...rest], hidden: rest.filter((k) => !byKey.get(k)?.locked) };
  }, [catalogKeys, defaultKeys, byKey]);

  // Legacy migration: fold a pre-editor localStorage shortcut selection into an
  // arrangement so an existing user doesn't lose their picks on first load.
  const legacy: LayoutArrangement | null = useMemo(() => {
    const keys = legacyShortcutKeys(screenKey);
    if (!keys) return null;
    const sel = keys.filter((k) => byKey.has(k)).slice(0, MAX);
    const selSet = new Set(sel);
    const rest = catalogKeys.filter((k) => !selSet.has(k));
    return { order: [...sel, ...rest], hidden: rest.filter((k) => !byKey.get(k)?.locked) };
  }, [screenKey, catalogKeys, byKey]);

  const eff = arr ?? legacy ?? codeDefault;
  const { shown } = applyArrangement(items, eff, { lockedIds, maxShown: MAX });

  const mobile = useIsMobile();
  const ink = onAccent(C.gold);
  const openMore = onMore;
  if (catalog.length === 0) return null;

  // Home's EXACT shortcut-tile look (reuses Home's sqTile): glassTint tile + gold rim +
  // glass bevel, icon-OVER-label with a PLAIN gold icon (no chip). Equal-flex, one row.
  const tile: React.CSSProperties = {
    // Tiles enlarged on BOTH sizes so the labels read clearly (Dan: too small on mobile) and the
    // row reads as prominent tools, not tiny chips. A trimmed horizontal padding still gives an
    // 8-char label ("Exchange") room to fit un-clipped.
    // On MOBILE tiles GROW to fill but never SHRINK below a readable min-width (flex "1 0 auto" +
    // minWidth) — the old flex:"1 1 0" let 5 tiles + More + pencil squeeze every label down to a
    // tiny, unreadable size. Now labels stay full-size; if the row genuinely can't fit them all it
    // SCROLLS horizontally (see liveRowStyle) instead of shrinking the text. Desktop keeps equal
    // flex fill (5 short labels fit the 600 column at full size — the desktop issue was contrast).
    // TALLER tile (minHeight 50/68, was 44/56) so the flexible-width tiles read as a WIDE SQUARE
    // (aspect ~1.3–1.4) instead of a thin wide rectangle — identical proportions on Home AND every
    // inner screen (Dan: Home tiles looked rectangular; match the inner-screen wide-square look).
    // Tiles SHRINK to fit the row (flex 1 1 0, minWidth 0) so the row can NEVER overflow the
    // viewport / clip a tile at the edges (Dan: Exchange cut left, Learn cut right); FitLabel shrinks
    // the label so the full word still shows. Height trimmed (46/60, was 50/68) so the taller
    // wide-square tiles don't over-grow the launcher screens' one-viewport fit.
    // minWidth FLOOR on mobile: at very narrow widths (~390px) six flex:"1 1 0" items squeezed
    // each tile so small that even FitLabel's min font couldn't fit "Exchange" → the tile's
    // overflow:hidden clipped it to "Exchang". A minWidth stops the squeeze at a width that fits
    // the widest 8-char label at a readable size; if they then can't ALL fit, the row (overflowX
    // :auto, contained) SCROLLS rather than clipping. Tiles still grow to fill on wider screens.
    // DESKTOP square (Dan: the tiles rendered as TALL PORTRAIT rectangles). aspect-ratio:1 makes
    // the height follow the flex-distributed WIDTH → a clean square regardless of how the 600px row
    // divides; maxWidth caps the square to a sensible size (so it never balloons on a wide row) and
    // alignSelf:center stops the row's align-stretch from overriding the aspect height. MOBILE is
    // untouched — fixed minHeight + the flex-wrap behavior stay exactly as before.
    // minWidth FLOOR on desktop too (Dan #tiles-cut): with minWidth:0 the 5 tiles + edit chip got
    // squeezed into the 600px nowrap row at ~93px each (inner ~74px), so the LONGEST label
    // ("אסטרטגיות", ~72–80px @11) had to SHRINK to fit while the short labels stayed at 11 — the
    // "one label looks small/cut" look. A ~100px floor + the wider row below keep every tile wide
    // enough that "אסטרטגיות" renders at the FULL base size (FitWidthLabel becomes a no-op), matching
    // the good mobile look. Mobile keeps its 68 floor + wrap.
    ...sqTile(), flex: "1 1 0", minWidth: mobile ? 68 : 100, display: "inline-flex", flexDirection: "column",
    ...(mobile
      // minHeight 54→66 (Dan: icons were TOUCHING the top edge). With box-sizing:border-box the 54px
      // tile's content box was 54−3(border)−16(padding)=35, but icon(18)+gap(3)+labelSlot(24)=45 →
      // the stack OVERFLOWED by 10px, so justify-center pushed the icon up against the top border.
      // 66px gives content box 47 ≥ 45, so the 8px padding is REAL breathing room top/bottom + slack.
      ? { minHeight: 66 }
      // DESKTOP: a WIDE rectangle (like mobile), NOT the old aspect-ratio square that forced the tile
      // narrow. Fixed 76px height (content 54 + 9px padding fits with room); width comes from the flex
      // fill of the wider row, so labels get ~90px+ inner and render full-size, no shrink.
      // maxWidth 112 (was 76): a 76px square was too tight — the icon left the label slot only
      // its ~15px content height and overflow:hidden clipped the text out. At 112 the row's flex
      // makes each tile ~98×98, giving the (grown) label slot room. Still capped so it never
      // balloons on a very wide row; shrinks to a smaller square on a narrow one.
      // maxWidth 132→114 (Dan, wide/zoom 1.15): at 132 the 5 filled tiles (~660px) + the ✎ Edit chip
      // overflowed the 720 row, wrapping the chip to a LONE centred line below — the "edit button floats
      // oddly." At 114 the 5 tiles cap at ~570px so tiles + chip (~712px) fit ONE line, and because the
      // tiles hit their cap there's leftover space → justify-content:center centres the whole block
      // (tools row reads as one tidy, balanced, centred group). Labels still fit (inner ~99px ≫ needed).
      : { minHeight: 76, maxWidth: 114 }),
    // Padding: 8px top/bottom (real breathing room now the tile is tall enough) + 7px sides so the
    // icon clears the top edge and the label clears the side/bottom edges (Dan: content was touching
    // the borders). FitWidthLabel still width-fits the label to whatever inner width remains.
    alignItems: "center", justifyContent: "center", gap: mobile ? 3 : 4, padding: mobile ? "8px 7px" : "9px 8px",
    cursor: "pointer", fontFamily: UI, overflow: "hidden",
  };
  // Icon sized toward the big buttons' icon-to-tile PROPORTION (GlassTile secondary ≈ 27px in a
  // ~110px square). Same treatment as the big buttons — DEFAULT lucide stroke + color C.gold — so
  // only the scale differs, matching Dan's "make the icon look like the big buttons' icons."
  const iz = mobile ? 18 : 22;
  // STATIC label font size — deliberately NOT FitLabel/fitHeight. fitHeight measured this SMALL
  // square's slot as ~0 and shrank the label to nothing → invisible labels (the regression). The
  // big GlassTile buttons have the vertical room for FitLabel; these small squares do NOT. Instead
  // the size is FIXED, chosen by MEASURING the real Heebo-900 widths of the longest labels against
  // the tile's inner width (tileW − 15px for padding+border):
  //   • desktop — standard 600px row → ~80px tiles → ~65px inner. "אסטרטגיות" @11px ≈ 54px (incl. a
  //     Black-weight safety margin) → fits ONE line with ~11px clearance (12px read slightly tight to
  //     Dan → dropped 1px; it's a single spaceless word so it CAN'T wrap at a space, hence smaller).
  //   • mobile  — minWidth 68 → ~53px inner. "אסטרטגיות" @10px ≈ 49px → fits. All 5 render FULLY.
  // Label font: a MAX start size (weight 900, matching the big buttons) that WIDTH-fits down to an
  // ~8px floor via FitWidthLabel — so the longest single word ("אסטרטגיות") always fits ONE line
  // with no mid-word break, on any tile width, while shorter labels keep the full size.
  const labelMax = mobile ? 10 : 11;
  const labelMin = 8;
  const slotH = mobile ? 24 : 28;   // fixed 2-line box (reserves room; never height-fit → never collapses)
  // The FILLED accent "More" tile needs readable INK (white/dark per skin via onAccent), not C.text.
  const renderLabel = (text: string, color: string) => (
    <FitWidthLabel text={text} color={color} max={labelMax} min={labelMin} />
  );
  // A REAL fixed-height 2-line slot directly below the icon: flexShrink:0 (height:slotH) so it's
  // never crushed — it RESERVES exactly the room 2 lines need and centers the label inside it, so
  // icon and label stay cleanly STACKED (no bleed). overflow:hidden is only a belt-and-braces guard;
  // because the font size is chosen to fit the inner width + this height, it never actually clips.
  const labelSlot: React.CSSProperties = { flex: "0 0 auto", height: slotH, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" };
  const rowBase: React.CSSProperties = { display: "flex", flexWrap: "nowrap", alignItems: "stretch", justifyContent: "center",
    gap: mobile ? 4 : 12, boxSizing: "border-box" };
  // CONTAINED row — used ONLY by the built-in LayoutEditor modal's live PREVIEW, which must stay
  // inside the modal, so it keeps a modest max-width.
  const rowStyle: React.CSSProperties = { ...rowBase, width: "100%", maxWidth: 500, marginInline: "auto", paddingInline: mobile ? 4 : 0 };
  // LIVE on-screen row — spans the FULL page width on MOBILE. Fixed negative margins can't work
  // here because the parent's inline padding DIFFERS per screen (Home's container ≠ the Shell
  // inner-screen gutter), so a VIEWPORT-ANCHORED full-bleed is used instead: `calc(50% - 50vw +
  // inset)` reclaims each side out to the viewport edge REGARDLESS of the parent's padding, then
  // pulls back a small safe inset (+ the notch's safe-area) — the tiles reach edge-to-edge with no
  // dead side-margins. Tiles grow to distribute across the width; if the labels can't ALL fit at
  // full size the row scrolls horizontally (never shrinks the text). DESKTOP = centered 600 column.
  const liveRowStyle: React.CSSProperties = mobile
    // CONTAINED, FIXED, NO horizontal scroll (Dan hated the left-right scroll the overflowX:auto
    // introduced). The row WRAPS to a second line when the tiles + More + ✎ can't all fit one line
    // at readable size: flexWrap:"wrap" + width:100% can NEVER overflow the viewport, and each
    // tile's minWidth keeps "Exchange" un-clipped. Everything stays visible + fixed, no scroller.
    // rowGap kept TIGHT (3) so when the ✎ pencil (or a 6th item) wraps to a 2nd line it hugs the
    // tiles instead of opening a tall empty band beneath the row (Dan: Home had a wasted vertical
    // gap between the tools row and the big buttons).
    ? { ...rowBase, flexWrap: "wrap", width: "100%", maxWidth: "100%", marginInline: 0, paddingInline: 2, rowGap: 3 }
    // DESKTOP live row — WIDENED 600→720 so the 5 tiles + edit chip each get ~110px (inner ~90px),
    // enough for "אסטרטגיות" to render at the FULL base font with no shrink (the 600px row squeezed
    // them to ~93px / inner ~74px, which forced the shrink). flexWrap:"wrap" + the tile min-width
    // floor mean that if a screen with MORE items can't fit them at that width, the row WRAPS to a
    // 2nd line (like mobile) instead of squeezing the tiles narrow again.
    : { ...rowBase, flexWrap: "wrap", rowGap: 10, width: "100%", maxWidth: 720, marginInline: "auto", paddingInline: 0 };

  // One shortcut pill (a real action). Reused by the live row AND the editor's live
  // preview, so the preview is pixel-faithful to the real row.
  const pill = (it: { id: string }) => {
    const s = byKey.get(it.id); if (!s) return null;
    return (
      <button key={it.id} onClick={s.onClick} className={`tap44${liquid ? " lqglass" : ""}`} title={s.label} style={tile}>
        <s.Icon size={iz} color={C.gold} style={{ flexShrink: 0 }} />
        <span style={labelSlot}>
          {renderLabel(s.label, C.text)}
        </span>
      </button>
    );
  };
  const moreTile = openMore ? (
    <button onClick={openMore} className="tap44" title={moreLabel ?? (he ? "עוד במערכת" : "More")}
      // Same size as the shortcut pills: on desktop the tiles are aspect-ratio squares, so the old
      // wider flex ("1.2") made the "More" tile TALLER than the pills and it protruded above/below
      // the row — reading as a stray tile floating outside it (esp. with its accent fill). Equal
      // flex ("1 1 0") → equal square → it sits cleanly IN the row.
      style={{ ...tile, flex: "1 1 0", minWidth: mobile ? 68 : 0, background: "var(--btn-bg)", color: "var(--btn-ink)", border: "1.5px solid var(--btn-bd)",
        boxShadow: `0 6px 16px -10px ${C.gold}, ${C.glassHi}` }}>
      <MoreHorizontal size={iz} color={ink} style={{ flexShrink: 0 }} />
      <span style={labelSlot}>
        {renderLabel(moreLabel ?? (he ? "עוד במערכת" : "More"), ink)}
      </span>
    </button>
  ) : null;
  // Render the whole row for a given SHOWN list. `withEdit` adds the ✎ edit control (live row
  // only — the preview omits it since it IS the edit control).
  const renderRow = (list: { id: string }[], withEdit: boolean) => (
    // Live on-screen row → full-width (mobile); the editor PREVIEW (withEdit=false) → contained.
    <div className={withEdit ? "a770-srow" : undefined} style={withEdit ? liveRowStyle : rowStyle}>
      {list.map(pill)}
      {moreTile}
      {withEdit && (
        // Edit control = a LABELED rounded-RECT chip that belongs to the shortcuts panel (Dan #8CFI:
        // the old icon-only square with SQ_RADIUS read as a floating ROUND circle in the gap). It now
        // wears the SAME tile visual language as the pills — sqTile()'s glassTint fill + solid skin
        // frame — plus a pencil + "ערוך/Edit" label, so it reads as part of the bank, not a stray
        // circle. Compact height (no extra tile-row height); borderRadius 10 keeps it a clear rounded
        // rectangle (not a pill/circle) at this short height.
        <button onClick={() => (onEditOverride ? onEditOverride() : setEditOpen(true))} className="tap44" aria-label={he ? "ערוך קיצורים" : "Edit shortcuts"} title={he ? "ערוך קיצורים" : "Edit shortcuts"}
          style={{ ...sqTile(), borderRadius: 10, flex: "0 0 auto",
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
            padding: mobile ? "0 10px" : "0 13px", height: mobile ? 30 : 44,
            // DESKTOP: centre it in the row (alignSelf:center stops the align-stretch from pulling it
            // as tall as the shortcut squares). Mobile keeps its own compact height.
            ...(mobile ? {} : { alignSelf: "center" }),
            color: C.gold, cursor: "pointer", fontFamily: UI, fontSize: mobile ? 10.5 : 12.5, fontWeight: 800, whiteSpace: "nowrap" }}>
          <Pencil size={mobile ? 13 : 16} color={C.gold} /> {he ? "ערוך" : "Edit"}
        </button>
      )}
    </div>
  );

  return (
    // marginBottom trimmed 8→2: the row sat too far above the next block (Home: the empty band
    // between the tools row and the two big buttons). 2px keeps a hairline separation without the gap.
    <div style={{ marginBottom: 2 }}>
      {/* Hide the mobile shortcut-row scrollbar (WebKit) — the row scrolls when labels can't all fit. */}
      <style>{".a770-srow::-webkit-scrollbar{display:none}"}</style>
      {renderRow(shown, true)}
      {editOpen && !onEditOverride && (
        <LayoutEditor
          he={he} title={he ? "עריכת קיצורים" : "Edit shortcuts"} items={items} arrangement={eff}
          maxShown={MAX} canEditShared={canEditShared} role={role}
          defaultArrangement={codeDefault}
          renderPreview={(a) => renderRow(applyArrangement(items, a, { lockedIds, maxShown: MAX }).shown, false)}
          onApprove={(a, scope) => { void save(a, scope); }}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  );
}
