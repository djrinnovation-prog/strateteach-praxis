import React from "react";
import { FileSpreadsheet, Printer, Info, Mail, Eye, EyeOff, ChevronDown, FlaskConical, AlertTriangle } from "lucide-react";
import { C, UI, MONO, RADIUS, SHADOW } from "./theme";
import { downloadCsv, printPdf, type Cell } from "./lib/export";
import { api, isAdmin } from "./app/api";
import { useI18n } from "./i18n";

export const input: React.CSSProperties = {
  background: C.surface2, border: `1px solid ${C.line}`, borderRadius: RADIUS.md,
  padding: "11px 14px", color: C.text, fontSize: 14, fontFamily: UI, outline: "none", width: "100%",
};

// A password input with a built-in show/hide (eye) toggle. Drop-in replacement
// for <input type="password" .../> — pass the same value/onChange/style/placeholder.
export function PasswordInput({ style, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = React.useState(false);
  const w = (style as any)?.width;
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", width: w ?? "100%", maxWidth: "100%" }}>
      <input {...rest} type={show ? "text" : "password"}
        style={{ ...style, width: "100%", paddingInlineEnd: 36, boxSizing: "border-box" }} />
      <button type="button" tabIndex={-1} aria-label={show ? "Hide password" : "Show password"} className="tap44"
        onClick={() => setShow((s) => !s)}
        style={{ position: "absolute", insetInlineEnd: 9, background: "none", border: "none", cursor: "pointer", color: C.muted, display: "inline-flex", padding: 0 }}>
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </span>
  );
}

// Primary = the one clean flat accent look (cyan/red/yellow/green per skin) via the
// shared --btn-* vars: solid fill + darker border, no gloss/glow. Secondary stays a
// quiet outline. (className="gbtn" enforces the same look on inline-styled buttons.)
export const btn = (primary = false): React.CSSProperties => primary ? {
  display: "inline-flex", alignItems: "center", gap: 7,
  background: "var(--btn-bg)", border: "1px solid var(--btn-bd)", color: "var(--btn-ink)",
  borderRadius: RADIUS.pill, padding: "9px 16px",
  fontSize: 13, fontFamily: UI, fontWeight: 700, cursor: "pointer", boxShadow: "none",
} : {
  display: "inline-flex", alignItems: "center", gap: 7,
  background: C.surface2, border: `1px solid ${C.line}`,
  color: C.text, borderRadius: RADIUS.pill, padding: "9px 16px",
  fontSize: 13, fontFamily: UI, fontWeight: 500, cursor: "pointer", boxShadow: "none",
};

// ── Home design-language primitives, promoted to shared helpers so EVERY screen
// restyle can drop them in (the rollout's secondary-button + icon-chip finish).
// Skin- & mode-aware via C.* (never a brand colour); primary actions still use
// `className="gbtn ptile"` (see ui-global.css) — this is the quieter premium tier.

// premSoft — a SECONDARY premium button: a skin-accent surface gradient + a 1.5px
// accent border + soft depth (inner top highlight, inner bottom shade, soft drop
// shadow). Mirrors Home's `premSoft`. Pair with inline padding/font-size.
export const premSoft = (): React.CSSProperties => ({
  background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
  border: `1.5px solid ${C.gold}`, color: C.text, borderRadius: 14,
  fontFamily: UI, fontWeight: 800, cursor: "pointer",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.30), inset 0 -11px 22px -14px rgba(0,0,0,0.30), 0 9px 22px -13px rgba(0,0,0,0.30)",
});

// ctrlChip — a small bordered surface square for icon controls (eye / pencil / cog),
// with a soft inner top highlight so they read as their own pressable chips. Mirrors
// HomeTop's `ctrlChip`. Pass width/height inline (defaults to a comfy 22px square).
export const ctrlChip = (extra?: React.CSSProperties): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22,
  background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, color: C.muted,
  cursor: "pointer", flexShrink: 0, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22)", ...extra,
});

// Partner-style sliding segmented control: a pill track with a thumb that
// slides to the active option. Reusable anywhere (language, mode, choices).
export function Segmented<T extends string>({ options, value, onChange, style, small }: {
  options: { value: T; label: React.ReactNode }[]; value: T; onChange: (v: T) => void; style?: React.CSSProperties; small?: boolean;
}) {
  const n = Math.max(1, options.length);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div style={{ position: "relative", display: "flex", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: 3, ...style }}>
      <div aria-hidden style={{ position: "absolute", top: 3, bottom: 3,
        insetInlineStart: `calc(${idx} * ((100% - 6px) / ${n}) + 3px)`, width: `calc((100% - 6px) / ${n})`,
        background: "var(--btn-bg)", borderRadius: 999, transition: "inset-inline-start .2s ease", boxShadow: "none" }} />
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} className="seg-opt"
          style={{ position: "relative", zIndex: 1, flex: 1, background: "none", border: "none", cursor: "pointer",
            padding: small ? "6px 8px" : "7px 14px", fontSize: small ? 11.5 : 13, fontWeight: 700, fontFamily: UI, whiteSpace: "nowrap",
            color: o.value === value ? "var(--btn-ink)" : C.muted }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Consumer-protection helpers ──────────────────────────────────────────────
// SimBadge — a subtle-but-unmistakable chip that marks a figure as DEMO / simulated
// money, so a user never mistakes a practice number for real funds. Reused on EVERY
// demo surface (Home demo line, the demo Trading engine, the demo leaderboard, demo
// positions) so the labelling is identical everywhere. Skin-aware via C.*, HE/EN via
// the shared i18n. `compact` shows just "סימולציה / Simulation" where space is tight
// (the full wording stays in the tooltip).
export function SimBadge({ style, compact }: { style?: React.CSSProperties; compact?: boolean }) {
  const { lang } = useI18n();
  const full = lang === "he" ? "סימולציה · לא כסף אמיתי" : "Simulation · not real money";
  const label = compact ? (lang === "he" ? "סימולציה" : "Simulation") : full;
  return (
    <span title={full} aria-label={full} style={{ display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 9, fontWeight: 800, letterSpacing: "0.02em", lineHeight: 1.25, textTransform: "none",
      color: C.muted, background: C.surface2, border: `1px solid ${C.line}`,
      borderRadius: 999, padding: "2px 7px", whiteSpace: "nowrap", flexShrink: 0, ...style }}>
      <FlaskConical size={10} style={{ flexShrink: 0 }} /> {label}
    </span>
  );
}

// RiskDisclaimer — one concise, professional trading-risk line shared across the
// Plans screen, the Login/Signup screens and as a persistent note near any P&L /
// balance figure, so the wording stays consistent everywhere. HE/EN via i18n.
export function RiskDisclaimer({ style, icon = true }: { style?: React.CSSProperties; icon?: boolean }) {
  const { lang } = useI18n();
  const text = lang === "he"
    ? "מסחר באלגוריתמים כרוך בסיכון; ביצועי עבר אינם מבטיחים תוצאות עתידיות."
    : "Algorithmic trading involves risk; past performance does not guarantee future results.";
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11, lineHeight: 1.5, color: C.faint, ...style }}>
      {icon && <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />}
      <span>{text}</span>
    </div>
  );
}

export const errBox: React.CSSProperties = { background: "rgba(240,97,109,0.12)", border: "1px solid rgba(240,97,109,0.4)", color: "#f3a3a3", borderRadius: 9, padding: "9px 12px", fontSize: 13, marginBottom: 12, fontFamily: MONO };
export const okBox: React.CSSProperties = { background: "rgba(247,147,26,0.1)", border: `1px solid ${C.goldDim}`, color: C.gold, borderRadius: 9, padding: "9px 12px", fontSize: 13, marginBottom: 12 };

export function H1({ children, right, info }: { children: React.ReactNode; right?: React.ReactNode; info?: string }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{children}</h1>
      {info && <InfoTip text={info} />}
    </span>
    {right}
  </div>;
}

// An "i" button that reveals a short explanation popover. Used on every screen.
export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label="info" className="tap44"
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "50%", border: `1px solid ${C.line}`, background: C.surface2, color: C.gold, cursor: "pointer", padding: 0 }}>
        <Info size={13} />
      </button>
      {open && (
        <>
          <span onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <span style={{ position: "absolute", top: "calc(100% + 8px)", insetInlineStart: 0, zIndex: 41, width: 280, maxWidth: "78vw", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 10, padding: "11px 13px", fontSize: 12.5, color: C.text, lineHeight: 1.6, boxShadow: "0 12px 34px rgba(0,0,0,0.45)", fontWeight: 400 }}>
            {text}
          </span>
        </>
      )}
    </span>
  );
}
export function Card({ title, action, children, tour }: any) {
  return <div data-tour={tour} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: RADIUS.lg, padding: 18, marginBottom: 14, boxShadow: SHADOW }}>
    {(title || action) && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 10 }}><div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>{action}</div>}{children}</div>;
}
export function Empty({ children }: any) { return <div style={{ background: C.surface, border: `1px dashed ${C.line}`, borderRadius: 12, padding: 32, textAlign: "center", color: C.muted, display: "flex", alignItems: "center", justifyContent: "center" }}>{children}</div>; }

/** A card whose body collapses behind a chevron. Open state is remembered per
 * `id` (localStorage), so users keep their preferred layout between visits. */
export function Collapsible({ title, action, children, defaultOpen = false, id }: {
  title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; id?: string;
}) {
  const key = id ? `algo770_open_${id}` : "";
  const [open, setOpen] = React.useState<boolean>(() => {
    if (key) { try { const v = localStorage.getItem(key); if (v != null) return v === "1"; } catch { /* ignore */ } }
    return defaultOpen;
  });
  const toggle = () => setOpen((o) => { const n = !o; if (key) { try { localStorage.setItem(key, n ? "1" : "0"); } catch { /* ignore */ } } return n; });
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: RADIUS.lg, marginBottom: 12, overflow: "hidden", boxShadow: SHADOW }}>
      <button type="button" onClick={toggle} aria-expanded={open} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
        background: "none", border: "none", color: C.text, cursor: "pointer", padding: "14px 16px",
        fontFamily: UI, fontSize: 15, fontWeight: 600, textAlign: "start",
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>{title}</span>
        <ChevronDown size={18} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", flexShrink: 0, color: C.muted }} />
      </button>
      {open && <div style={{ padding: "0 16px 16px" }}>{action && <div style={{ marginBottom: 12 }}>{action}</div>}{children}</div>}
    </div>
  );
}
export function Field({ label, children }: any) { return <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={{ fontSize: 12, color: C.muted }}>{label}</span>{children}</label>; }
export const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 };
export function Metric({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return <div style={{ background: C.surface2, borderRadius: 9, padding: "13px 15px" }}><div style={{ fontSize: 12, color: C.muted, marginBottom: 5 }}>{label}</div><div style={{ fontSize: 22, fontWeight: 600, color: color || C.text, fontFamily: MONO }}>{value}</div></div>;
}
export const Spin = () => <style>{".spin{animation:spin 0.8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}"}</style>;

// Reusable Excel (CSV) + PDF export buttons. Pass the current view's data.
// `stack`: lay the buttons out as full-width vertical rows instead of a horizontal
// toolbar — use this when dropping the bar inside the ⋯ More popover (a narrow,
// column-stacked menu), so the pills don't cram into one row and clip.
export function ExportBar({ name, title, headers, rows, rtl, stack }: {
  name: string; title: string; headers: string[]; rows: Cell[][]; rtl?: boolean; stack?: boolean;
}) {
  const disabled = !rows || rows.length === 0;
  const [busy, setBusy] = React.useState(false);
  // In stacked (menu) mode each button fills the row and left-aligns its label so
  // the actions read as tidy menu items; otherwise they keep their natural width.
  const itemStyle: React.CSSProperties = stack ? { width: "100%", justifyContent: "flex-start" } : {};

  async function emailToUsers() {
    if (!confirm(rtl ? "לשלוח את הנתונים האלה במייל לכל המשתמשים?" : "Email this data to all users with an address?")) return;
    setBusy(true);
    try {
      const esc = (v: Cell) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
      const html = `<h2 style="font-family:Arial">${esc(title)}</h2>`
        + `<table cellpadding="6" style="border-collapse:collapse;font-family:Arial;font-size:13px">`
        + `<thead><tr>${headers.map((h) => `<th style="border:1px solid #ccc;background:#F7931A;color:#1a1206">${esc(h)}</th>`).join("")}</tr></thead>`
        + `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td style="border:1px solid #ccc">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      const r = await api.emailData({ subject: `ALGO770 — ${title}`, text: title, html, recipients: "all" });
      alert((rtl ? "נשלח ל-" : "Sent to ") + `${r.sent}/${r.recipients}`);
    } catch (e: any) {
      alert(e?.message || "Email failed");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display: stack ? "flex" : "inline-flex", flexDirection: stack ? "column" : "row", gap: 8, width: stack ? "100%" : undefined }}>
      <button onClick={() => downloadCsv(name, headers, rows)} disabled={disabled} className="tap44" style={{ ...btn(), ...itemStyle, opacity: disabled ? 0.5 : 1 }} title="Excel / CSV">
        <FileSpreadsheet size={14} /> Excel
      </button>
      <button onClick={() => printPdf(title, headers, rows, rtl)} disabled={disabled} className="tap44" style={{ ...btn(), ...itemStyle, opacity: disabled ? 0.5 : 1 }} title="PDF">
        <Printer size={14} /> PDF
      </button>
      {isAdmin() && (
        <button onClick={emailToUsers} disabled={disabled || busy} className="tap44" style={{ ...btn(), ...itemStyle, opacity: disabled || busy ? 0.5 : 1 }} title="Email to users (admin)">
          <Mail size={14} /> {busy ? "…" : "Email"}
        </button>
      )}
    </div>
  );
}
