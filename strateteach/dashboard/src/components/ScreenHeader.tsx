import React, { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";
import { InfoTip, ExportBar } from "../ui";
import WordmarkTitle from "./WordmarkTitle";

// The ⋯ More popover is a NARROW, column-stacked menu. ExportBar, however, lays its
// Excel / PDF / Email buttons out as a horizontal toolbar — which crams and clips
// in the dropdown. So any ExportBar rendered inside the menu is auto-switched to its
// full-width vertical `stack` layout here, recursing through fragments. This keeps
// EVERY screen's More menu (current + future) tidy without a per-screen opt-in;
// horizontal header ExportBar usages (outside MoreMenu) are untouched.
function stackExportBars(node: React.ReactNode): React.ReactNode {
  return React.Children.map(node, (child) => {
    if (!React.isValidElement(child)) return child;
    if (child.type === ExportBar) {
      return React.cloneElement(child, { stack: (child.props as any).stack ?? true } as any);
    }
    if (child.type === React.Fragment) {
      return React.cloneElement(child, {}, stackExportBars((child.props as any).children));
    }
    return child;
  });
}

// ── Reusable clean screen-header pattern (the "home-like" tidy top) ───────────
// One calm, breathable top for every inner screen, so the cluttered "title +
// subtitle stack + 3 exports + how-it-works + status block + refresh" rows are
// replaced by a single organized structure:
//   • START side  — the wordmark TITLE (icon + InfoTip) + ONE compact subtitle line.
//   • END side    — a small status chip, the ONE primary action (e.g. Refresh),
//                   and a "⋯ More / עוד" popover that tucks the SECONDARY actions
//                   (Excel / PDF / Email / How-it-works) out of the way.
// Built on Scanner first as the template; other screens adopt it by passing their
// own title / subtitle / primary / menu. Skin-themed via C.*, RTL-correct
// (insetInline*), 44px tap targets (.tap44). All actions keep working — only
// reorganized: the secondary ones move into the popover, the primary stays out.
export function ScreenHeader({ icon, title, info, subtitle, status, primary, menu, classic, hub }: {
  icon?: React.ReactNode;          // small wordmark icon (e.g. the gold Diamond)
  title: string;                   // screen title, in the existing wordmark style
  info?: string;                   // optional "i" explainer next to the title
  subtitle?: React.ReactNode;      // ONE compact line (e.g. model · symbols · updated)
  status?: React.ReactNode;        // small, unobtrusive status chip (e.g. ExchangeStatus)
  primary?: React.ReactNode;       // the single primary action, kept visible (Refresh)
  menu?: React.ReactNode;          // secondary actions, tucked into the ⋯ popover
  classic?: boolean;               // opt OUT to the old left-aligned header (ProfitEngine only)
  hub?: boolean;                   // legacy no-op — the clean header below is the DEFAULT now.
}) {
  void hub;
  // ── Clean shared header (the DEFAULT for every screen that uses ScreenHeader) ─
  // Every screen leads with the BIG SPACED wordmark title at the TOP as the page's
  // leading title (the styled title that used to sit wasted as a watermark under the
  // orb on hub screens), a small subtitle under it, and ALL the auxiliary actions
  // folded into ONE compact, centred, wrapping toolbar row of small buttons (Signal
  // Bot · status · primary · ⋯ More) — instead of the old cluttered stack. On the
  // orb-hub screens the orb + 4 colour tiles then become the centred centrepiece
  // below (their TileNav drops its now-duplicate bottom title); on non-hub screens
  // (Signal Bots, Plans, Chat, …) the body content stays exactly as-is under this
  // header. Everything is the SAME nodes/actions/labels — only restructured. Skin-
  // aware (C.*), RTL/LTR-safe (centred + logical padding), 44px tap targets.
  // ProfitEngine opts OUT via `classic` to keep its own layout untouched.
  if (!classic) {
    return (
      <div style={{ fontFamily: UI, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
        <h1 style={{ margin: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
          {icon && <span style={{ display: "inline-flex", flexShrink: 0 }}>{icon}</span>}
          {/* The screen's OWN NAME in Home's StrateTeach-wordmark visual design — the
              reusable WordmarkTitle (skin-adaptive gradient + title colours + font, per
              Dan). The TEXT is this screen's name; only the styling is shared. */}
          <WordmarkTitle text={title} />
          {info && <InfoTip text={info} />}
        </h1>
        {subtitle != null && (
          <p style={{ margin: 0, fontSize: 12.5, color: C.muted, maxWidth: 520 }}>{subtitle}</p>
        )}
        {/* compact toolbar — the auxiliary actions as a tidy, centred, wrapping row.
            (The Signal Bot quick-access pill was removed from inner screens per owner —
            Signal Bot stays on Home + in the side menu only.) */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
          {status}
          {primary}
          {menu && <MoreMenu>{menu}</MoreMenu>}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", fontFamily: UI }}>
      <div style={{ minWidth: 0 }}>
        <h1 style={{ fontSize: 20, fontWeight: 900, display: "flex", alignItems: "center", gap: 9, margin: 0 }}>
          {icon && <span style={{ display: "inline-flex", flexShrink: 0 }}>{icon}</span>}
          {title}
          {info && <InfoTip text={info} />}
        </h1>
        {subtitle != null && (
          <p style={{ fontSize: 12.5, color: C.muted, marginTop: 4, marginBottom: 0 }}>{subtitle}</p>
        )}
      </div>
      {/* End cluster — per-screen status / primary / ⋯More. (The premium "Signal Bot"
          quick-access pill was removed from inner screens per owner — Signal Bot stays on
          Home + in the side menu only.) */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {status}
        {primary}
        {menu && <MoreMenu>{menu}</MoreMenu>}
      </div>
    </div>
  );
}

// "⋯ More / עוד" popover — tucks the secondary actions away so the top stays
// clean. Reusable on any screen: drop the screen's secondary action nodes
// (export buttons, how-it-works, share, …) in as children and they render in a
// tidy stacked menu. The menu stays open while you use it (so children that open
// their own overlays — e.g. How-it-works — keep working); tap the backdrop to close.
export function MoreMenu({ children, label }: { children: React.ReactNode; label?: string }) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const text = label ?? (lang === "he" ? "עוד" : "More");
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
        title={text} className="tap44"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.surface2, border: `1px solid ${C.line}`,
          color: C.muted, borderRadius: 10, padding: "7px 12px", fontWeight: 700, fontSize: 12.5, cursor: "pointer",
          fontFamily: UI, whiteSpace: "nowrap" }}>
        <MoreHorizontal size={15} /> {text}
      </button>
      {open && (
        <>
          {/* click-away backdrop (below the popover) */}
          <span onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div role="menu" style={{ position: "absolute", top: "calc(100% + 8px)", insetInlineEnd: 0, zIndex: 41,
            minWidth: 180, maxWidth: "82vw", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12,
            padding: 10, boxShadow: "0 12px 34px rgba(0,0,0,0.45)", display: "flex", flexDirection: "column", gap: 8,
            alignItems: "stretch" }}>
            {stackExportBars(children)}
          </div>
        </>
      )}
    </span>
  );
}
