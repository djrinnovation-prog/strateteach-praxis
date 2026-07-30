import React, { useState, useEffect } from "react";
import { Minus, Maximize2, X } from "lucide-react";
import { useI18n } from "../i18n";
import { C, UI, onAccent } from "../theme";
import { InfoTip } from "../ui";
import TileNav from "./TileNav";

// Shared screen scaffold for the app's design language (same as Admin/Home/Profit):
//   top = Back + Home (provided by Shell) · a compact title · up to 4 square FATHER
//   tiles · each father pulls a sub-menu DOWN to its child screens (a chip row when
//   it has more than one child) and renders the active child in a collapsible Panel.
// Locked to one mobile screen — only the open child's content scrolls if it must.
export type HubChild = { key: string; label: string; Icon: React.FC<any>; render: () => React.ReactNode };
export type HubFather = { key: string; label: string; Icon: React.FC<any>; children: HubChild[]; tour?: string };

export default function HubScreen({ ns, title, Icon, sub, info, banner, header, topCard, fathers, renderNav, initial }: {
  ns: string;                    // localStorage namespace for the per-panel collapse memory
  title: string;
  initial?: string;              // optional father key to open on mount (deep-link, e.g. ?sec=management)
  Icon?: React.FC<any>;          // small title chip icon
  sub?: string;                  // optional faint one-liner under the title
  info?: string;                 // optional "i" explainer next to the title
  banner?: React.ReactNode;      // err/ok banners, rendered under the title (above the tiles)
  header?: React.ReactNode;      // optional home-like top: a <ScreenHeader/> wordmark that
                                 // REPLACES the compact title (and sub) when provided.
  topCard?: React.ReactNode;     // optional P&L (תיק) card (<HomeTop/>) under the header.
  fathers: HubFather[];
  // Optional: replace the colourful father-tile springboard (TileNav) with a custom nav
  // — e.g. the shared ScreenHero (related-options row + 2 central buttons). Receives the
  // section opener + the active father key so its tiles/buttons drive the SAME sections.
  renderNav?: (open: (k: string) => void, active: string) => React.ReactNode;
}) {
  const { lang } = useI18n();
  // A deep-link (`initial`) opens that father on mount — but only if it actually
  // exists in `fathers` (a role-gated section absent for this user stays closed).
  const initFather = initial && fathers.some((f) => f.key === initial) ? initial : "";
  const [father, setFather] = useState<string>(initFather);
  const [child, setChild] = useState<string>(() => {
    if (!initFather) return "";
    return fathers.find((f) => f.key === initFather)?.children[0]?.key || "";
  });
  // Re-open on a deep-link change even when this screen is already mounted (e.g. the
  // sidebar "ניהול" row while already on /me). Fires only when `initial` actually
  // changes; a user's manual close (same URL) is left alone.
  useEffect(() => {
    if (initial && fathers.some((f) => f.key === initial)) {
      setFather(initial);
      setChild(fathers.find((f) => f.key === initial)?.children[0]?.key || "");
    }
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFather = (k: string) => {
    if (father === k) { setFather(""); setChild(""); return; }
    const f = fathers.find((x) => x.key === k);
    setFather(k);
    setChild(f?.children[0]?.key || "");
  };
  const close = () => { setFather(""); setChild(""); };
  const fa = fathers.find((f) => f.key === father) || null;
  const ch = fa?.children.find((c) => c.key === child) || null;

  return (
    <div style={{ fontFamily: UI }}>
      <style>{"@keyframes hubScrDrop{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}"}</style>

      {header != null ? (
        // Home-like top: the wordmark ScreenHeader + the P&L (תיק) card replace the
        // compact title/sub, so this screen matches Home and the other inner screens.
        <>
          <div style={{ marginBottom: 16 }}>{header}</div>
          {topCard}
        </>
      ) : (
        <>
          {/* compact title — kept small so the 4 father tiles stay in one locked screen */}
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: sub ? 2 : 12 }}>
            {Icon && (
              <span style={{ width: 28, height: 28, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                background: C.accentGrad }}>
                <Icon size={15} color={onAccent(C.gold)} />
              </span>
            )}
            <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{title}</div>
            {info && <InfoTip text={info} />}
          </div>
          {sub && <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>{sub}</div>}
        </>
      )}

      {banner}

      {/* Section nav: the custom ScreenHero (renderNav) REPLACES the old colourful father-
          tile springboard when provided; otherwise the default TileNav springboard. */}
      {renderNav ? renderNav(openFather, father) : (
      <TileNav
        active={father}
        onSelect={openFather}
        topAligned={header != null}
        hub
        items={fathers.map((f) => ({
          key: f.key,
          label: f.label,
          Icon: f.Icon,
          grad: `linear-gradient(140deg, ${C.gold}, ${C.accent} 52%, ${C.blue})`,
          tour: f.tour,
        }))}
      />
      )}

      {/* pull-down: the open father's child screens (chips) + the active child panel */}
      {fa && (
        <div style={{ animation: "hubScrDrop .3s cubic-bezier(.22,.61,.36,1) both" }}>
          <div style={subRow}>
            {fa.children.length > 1 && fa.children.map((c) => (
              <button key={c.key} onClick={() => setChild(c.key)} style={chip(child === c.key)}>
                <c.Icon size={13} /> {c.label}
              </button>
            ))}
            <button onClick={close} style={{ ...chip(false), marginInlineStart: "auto" }} title={lang === "he" ? "סגור" : "Close"}>
              <X size={13} /> {lang === "he" ? "סגור" : "Close"}
            </button>
          </div>
          {ch && (
            <Panel key={`${ns}:${fa.key}:${ch.key}`} ns={ns} id={`${fa.key}_${ch.key}`} title={ch.label} icon={<ch.Icon size={14} />}>
              {ch.render()}
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

// A minimize / maximize wrapper around each child screen. Loads expanded; can be
// collapsed to a slim title bar and the choice is remembered per (screen, child).
function Panel({ ns, id, title, icon, children }: { ns: string; id: string; title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  const { lang } = useI18n();
  const key = `algo770_hub_${ns}_${id}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) !== "0"; } catch { return true; } });
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem(key, v ? "1" : "0"); } catch (_e) { /* */ } };
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginBottom: 14 }}>
      <button onClick={toggle} style={{ width: "100%", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 10, padding: "11px 14px", background: open ? C.surface2 : "transparent", border: "none", borderBottom: open ? `1px solid ${C.line}` : "none",
        cursor: "pointer", fontFamily: UI, color: C.text }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 13.5 }}>
          <span style={{ color: C.gold, display: "inline-flex" }}>{icon}</span> {title}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.muted, fontSize: 11.5, fontWeight: 700 }}>
          {open ? (lang === "he" ? "מזער" : "Minimize") : (lang === "he" ? "הצג" : "Maximize")}
          {open ? <Minus size={15} /> : <Maximize2 size={14} />}
        </span>
      </button>
      {open && <div style={{ padding: 16 }}>{children}</div>}
    </div>
  );
}

// Standalone pull-down panel for screens that keep their OWN TileNav + tile state
// (Exchange, Strategy, Scanner, Backtests). With a `title` it renders the same
// collapsible Admin-style panel (Minimize/Maximize + optional Close). Without a
// title it's a "bare" drop-in wrapper that just slides its child down — used to wrap
// a section that already brings its own card/header (so we don't double up headers).
export function HubPanel({ ns, id, title, icon, onClose, children, alwaysOpen }: {
  ns?: string; id?: string; title?: React.ReactNode; icon?: React.ReactNode; onClose?: () => void; children: React.ReactNode;
  // `alwaysOpen` — for DRILL-IN sections (the non-scroll functions-as-buttons pattern): the
  // section IS the whole screen, so it must always show its content. Ignores any remembered
  // collapse state and hides the minimize control (keeps ✕ close). Without it, a stale
  // per-panel "collapsed" flag in localStorage would render the drilled-in section EMPTY.
  alwaysOpen?: boolean;
}) {
  const { lang } = useI18n();
  const storeKey = ns && id ? `algo770_hub_${ns}_${id}` : null;
  const [open, setOpen] = useState(() => { if (alwaysOpen) return true; try { return storeKey ? localStorage.getItem(storeKey) !== "0" : true; } catch { return true; } });
  const toggle = () => { if (alwaysOpen) return; const v = !open; setOpen(v); if (storeKey) try { localStorage.setItem(storeKey, v ? "1" : "0"); } catch (_e) { /* */ } };
  const kf = "@keyframes hubScrDrop{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}";
  const drop: React.CSSProperties = { animation: "hubScrDrop .3s cubic-bezier(.22,.61,.36,1) both" };
  if (!title) return <div style={{ ...drop, marginBottom: 14 }}><style>{kf}</style>{children}</div>;
  const ctl: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 26, borderRadius: 8, background: C.surface2, border: `1px solid ${C.line}`, color: C.muted, cursor: "pointer" };
  return (
    <div style={{ ...drop, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginBottom: 14 }}>
      <style>{kf}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 14px", background: open ? C.surface2 : "transparent", borderBottom: open ? `1px solid ${C.line}` : "none" }}>
        <button onClick={toggle} style={{ flex: 1, minWidth: 0, display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 13.5, background: "none", border: "none", cursor: alwaysOpen ? "default" : "pointer", fontFamily: UI, color: C.text, textAlign: "start", padding: 0 }}>
          {icon && <span style={{ color: C.gold, display: "inline-flex", flexShrink: 0 }}>{icon}</span>}
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
        </button>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {!alwaysOpen && <button onClick={toggle} style={ctl} title={open ? (lang === "he" ? "מזער" : "Minimize") : (lang === "he" ? "הצג" : "Maximize")}>{open ? <Minus size={15} /> : <Maximize2 size={14} />}</button>}
          {onClose && <button onClick={onClose} style={ctl} title={lang === "he" ? "סגור" : "Close"}><X size={15} /></button>}
        </span>
      </div>
      {open && <div style={{ padding: 16 }}>{children}</div>}
    </div>
  );
}

export const subRow: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${C.line}` };

export function chip(active: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 6, background: active ? "var(--btn-bg)" : C.surface2,
    color: active ? "var(--btn-ink)" : C.muted, border: `1px solid ${active ? C.gold : C.line}`, borderRadius: 9,
    padding: "8px 12px", fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: UI };
}
