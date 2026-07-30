import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, ShieldCheck, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";

// ── PinModal — the branded, app-styled replacement for window.prompt on real-money PIN
// gates. Same glass/skin look as ConfirmModal (portal to <body>, dismissible backdrop,
// gold border, Rubik). Renders ABOVE ConfirmModal (zIndex 2100 > 2000) so it fully covers
// the batch-preview modal while the user types the PIN.
//
// It does NOT touch order execution. `usePinGate()` gives a promise-based `requestPin()`
// that resolves with the entered PIN (or null on cancel); the CALLER still runs the exact
// existing logic — api.setPin(pin) → its api.placeOrder / withdraw action — unchanged.
// So the confirm → PIN → placeOrder safety flow is identical; only the PIN UI changes.

export type PinRequestOpts = { title?: string; intro?: string; confirmLabel?: string };

export function usePinGate() {
  const [opts, setOpts] = useState<PinRequestOpts | null>(null);
  const [open, setOpen] = useState(false);
  const resolverRef = useRef<((v: string | null) => void) | null>(null);

  const requestPin = useCallback((o?: PinRequestOpts) => {
    setOpts(o || null);
    setOpen(true);
    return new Promise<string | null>((resolve) => { resolverRef.current = resolve; });
  }, []);

  const settle = useCallback((v: string | null) => {
    setOpen(false);
    const r = resolverRef.current; resolverRef.current = null;
    if (r) r(v);
  }, []);

  const pinModal = open ? <PinModal opts={opts} onSubmit={(p) => settle(p)} onCancel={() => settle(null)} /> : null;
  return { pinModal, requestPin };
}

const forgotLink: React.CSSProperties = { background: "none", border: "none", color: C.gold, fontWeight: 800, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit", padding: 0, textAlign: "center", width: "100%" };
const fieldBox: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "var(--surface2, #f5f5f5)", borderRadius: 12, padding: "11px 14px", fontFamily: "inherit", fontSize: 15 };

function PinModal({ opts, onSubmit, onCancel }: { opts: PinRequestOpts | null; onSubmit: (pin: string) => void; onCancel: () => void }) {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const [mode, setMode] = useState<"enter" | "reset">("enter");
  const [pin, setPin] = useState("");
  const [pw, setPw] = useState(""); const [np, setNp] = useState(""); const [np2, setNp2] = useState("");
  const [busy, setBusy] = useState(false); const [errMsg, setErrMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the field on open / on mode switch; Escape cancels (nothing fires).
  useEffect(() => { const id = setTimeout(() => inputRef.current?.focus(), 40); return () => clearTimeout(id); }, [mode]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const canSubmit = pin.trim().length > 0;
  const submit = () => { if (canSubmit) onSubmit(pin.trim()); };
  // Forgot-PIN: prove the ACCOUNT PASSWORD → set a new PIN → resolve with it so the pending
  // real-money action continues with the fresh PIN (the caller runs api.setPin(pin) as usual).
  const doReset = async () => {
    setErrMsg("");
    if (!pw.trim()) { setErrMsg(he ? "הזינו את סיסמת החשבון." : "Enter your account password."); return; }
    if (np.trim().length < 4) { setErrMsg(he ? "הקוד חייב להיות באורך 4 תווים לפחות." : "The code must be at least 4 characters."); return; }
    if (np !== np2) { setErrMsg(he ? "הקודים אינם תואמים." : "The codes don't match."); return; }
    setBusy(true);
    try {
      const r: any = await api.resetPinCode(pw.trim(), np.trim());
      if (r?.ok === false) throw new Error(r?.message || "");
      onSubmit(np.trim());
    } catch (e: any) { setErrMsg(e?.message || (he ? "האיפוס נכשל" : "Reset failed")); }
    finally { setBusy(false); }
  };

  const resetMode = mode === "reset";
  const title = resetMode ? (he ? "איפוס קוד אישור" : "Reset your PIN")
    : (opts?.title || (he ? "הזן קוד אישור לפקודות לייב" : "Enter your live PIN"));
  const intro = resetMode ? (he ? "שכחתם את הקוד? אמתו את סיסמת החשבון והגדירו קוד חדש." : "Forgot it? Verify your account password and set a new PIN.")
    : (opts?.intro || (he ? "הקוד מאבטח פקודות בכסף אמיתי בבורסה המחוברת." : "Your PIN secures real-money orders on your connected exchange."));
  const confirmLabel = opts?.confirmLabel || (he ? "אישור" : "Confirm");
  const fs = { ...fieldBox, background: C.surface2, border: `1px solid ${C.line}`, color: C.text };

  return createPortal(
    <div onClick={onCancel}
      style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16, direction: rtl ? "rtl" : "ltr" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title} dir={rtl ? "rtl" : "ltr"}
        style={{ width: "min(400px, 94vw)", background: C.surface, border: `1.5px solid ${C.gold}`, borderRadius: 18,
          boxShadow: "0 28px 80px rgba(0,0,0,0.6)", fontFamily: UI, overflow: "hidden" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 16px",
          borderBottom: `1px solid ${C.line}`, background: `linear-gradient(135deg, ${C.gold}26, ${C.gold}0f), ${C.surface}` }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 9, minWidth: 0, fontSize: 15.5, fontWeight: 900, color: C.text }}>
            <ShieldCheck size={18} color={C.gold} style={{ flexShrink: 0 }} />
            <span style={{ minWidth: 0 }}>{title}</span>
          </span>
          <button onClick={onCancel} aria-label={he ? "סגור" : "Close"} className="tap44"
            style={{ flexShrink: 0, background: "none", border: "none", color: C.muted, cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        {/* body */}
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.55 }}>{intro}</div>

          {!resetMode ? (
            <>
              <input ref={inputRef} type="password" inputMode="numeric" autoComplete="off" aria-label={title}
                value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                placeholder={he ? "קוד PIN" : "PIN code"}
                style={{ ...fs, fontSize: 18, fontWeight: 800, letterSpacing: "0.3em", textAlign: "center" }} />
              <div style={{ display: "flex", gap: 10, marginTop: 2, flexDirection: rtl ? "row-reverse" : "row" }}>
                <button onClick={submit} disabled={!canSubmit} className="gbtn tap44"
                  style={{ flex: "1.4 1 0", minHeight: 46, borderRadius: 12, border: "none", fontFamily: UI, fontSize: 14.5, fontWeight: 900,
                    cursor: canSubmit ? "pointer" : "default", opacity: canSubmit ? 1 : 0.6, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  {confirmLabel}
                </button>
                <button onClick={onCancel} className="tap44"
                  style={{ flex: "1 1 0", minHeight: 46, borderRadius: 12, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, fontFamily: UI, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                  {he ? "ביטול" : "Cancel"}
                </button>
              </div>
              <button onClick={() => { setMode("reset"); setErrMsg(""); }} style={forgotLink}>{he ? "שכחתי את הקוד" : "Forgot your PIN?"}</button>
            </>
          ) : (
            <>
              <input ref={inputRef} type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)}
                placeholder={he ? "סיסמת החשבון" : "Account password"} style={fs} />
              <input type="password" inputMode="numeric" autoComplete="off" value={np} onChange={(e) => setNp(e.target.value)}
                placeholder={he ? "קוד PIN חדש (4+ תווים)" : "New PIN (4+ chars)"} style={{ ...fs, letterSpacing: "0.2em", textAlign: "center" }} />
              <input type="password" inputMode="numeric" autoComplete="off" value={np2} onChange={(e) => setNp2(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") doReset(); }}
                placeholder={he ? "אישור הקוד החדש" : "Confirm new PIN"} style={{ ...fs, letterSpacing: "0.2em", textAlign: "center" }} />
              {errMsg && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, lineHeight: 1.5, fontWeight: 700,
                  color: C.loss, background: `${C.loss}12`, border: `1px solid ${C.loss}55`, borderRadius: 10, padding: "9px 12px" }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span>{errMsg}</span>
                </div>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 2, flexDirection: rtl ? "row-reverse" : "row" }}>
                <button onClick={doReset} disabled={busy} className="gbtn tap44"
                  style={{ flex: "1.4 1 0", minHeight: 46, borderRadius: 12, border: "none", fontFamily: UI, fontSize: 14.5, fontWeight: 900,
                    cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  {busy ? <Loader2 size={16} className="spin" /> : null}{he ? "אפס והמשך" : "Reset & continue"}
                </button>
                <button onClick={() => { setMode("enter"); setErrMsg(""); }} className="tap44"
                  style={{ flex: "1 1 0", minHeight: 46, borderRadius: 12, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, fontFamily: UI, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                  {he ? "חזרה" : "Back"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── SetPinModal — branded create/change flow for the live PIN (POST /exchange/pin via
// api.setPinCode). Same glass/skin shell as the entry modal. When a PIN already exists
// it asks for the current one (the backend verifies it). It ONLY manages the PIN — it
// never touches order execution. On success it invalidates ["exchangeConfig"] so the
// status chip flips to "set ✓".
export function SetPinModal({ pinSet, onClose }: { pinSet: boolean; onClose: () => void }) {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const qc = useQueryClient();
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");         // account password (forgot-PIN mode)
  const [forgot, setForgot] = useState(false);
  const [np, setNp] = useState("");
  const [np2, setNp2] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const id = setTimeout(() => firstRef.current?.focus(), 40); return () => clearTimeout(id); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); if (!saveM.isPending) onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }); // eslint-disable-line

  const saveM = useMutation({
    // Forgot mode proves the ACCOUNT PASSWORD (reset endpoint); otherwise the normal
    // set/change path (needs the current PIN when one already exists).
    mutationFn: () => forgot ? api.resetPinCode(pw.trim(), np.trim()) : api.setPinCode(np.trim(), pinSet ? cur.trim() : undefined),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["exchangeConfig"] }); setTimeout(onClose, 1100); },
    onError: (e: any) => setErrMsg(e?.message || (he ? "השמירה נכשלה" : "Couldn't save")),
  });
  const done = saveM.isSuccess;

  const submit = () => {
    setErrMsg("");
    if (np.trim().length < 4) { setErrMsg(he ? "הקוד חייב להיות באורך 4 תווים לפחות." : "The code must be at least 4 characters."); return; }
    if (np !== np2) { setErrMsg(he ? "הקודים אינם תואמים." : "The codes don't match."); return; }
    if (forgot) { if (!pw.trim()) { setErrMsg(he ? "הזינו את סיסמת החשבון." : "Enter your account password."); return; } }
    else if (pinSet && !cur.trim()) { setErrMsg(he ? "הזן את הקוד הנוכחי כדי לשנות." : "Enter your current code to change it."); return; }
    saveM.mutate();
  };

  const fieldStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: C.surface2, border: `1px solid ${C.line}`,
    borderRadius: 12, padding: "11px 14px", color: C.text, fontFamily: UI, fontSize: 16, fontWeight: 700, letterSpacing: "0.25em", textAlign: "center" };
  const labelStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: C.muted, marginBottom: 5, display: "block" };
  const title = forgot ? (he ? "איפוס קוד אישור" : "Reset your PIN")
    : pinSet ? (he ? "שינוי קוד אישור לייב" : "Change your live PIN") : (he ? "הגדרת קוד אישור לייב" : "Set up your live PIN");

  return createPortal(
    <div onClick={() => { if (!saveM.isPending) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16, direction: rtl ? "rtl" : "ltr" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title} dir={rtl ? "rtl" : "ltr"}
        style={{ width: "min(400px, 94vw)", background: C.surface, border: `1.5px solid ${C.gold}`, borderRadius: 18,
          boxShadow: "0 28px 80px rgba(0,0,0,0.6)", fontFamily: UI, overflow: "hidden" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 16px",
          borderBottom: `1px solid ${C.line}`, background: `linear-gradient(135deg, ${C.gold}26, ${C.gold}0f), ${C.surface}` }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 9, minWidth: 0, fontSize: 15.5, fontWeight: 900, color: C.text }}>
            <ShieldCheck size={18} color={C.gold} style={{ flexShrink: 0 }} />
            <span style={{ minWidth: 0 }}>{title}</span>
          </span>
          <button onClick={() => { if (!saveM.isPending) onClose(); }} aria-label={he ? "סגור" : "Close"} className="tap44"
            style={{ flexShrink: 0, background: "none", border: "none", color: C.muted, cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        {/* body */}
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55 }}>
            {he
              ? "קוד קצר שמאבטח את פקודות הכסף-האמיתי שלך. מגדירים אותו פעם אחת — ואז מזינים אותו כדי לאשר עסקאות לייב ומשיכות."
              : "A short code that secures your real-money orders. Set it once — then enter it to confirm live trades and withdrawals."}
          </div>

          {pinSet && (forgot ? (
            <div>
              <label style={labelStyle}>{he ? "סיסמת החשבון (לאימות זהות)" : "Account password (to verify you)"}</label>
              <input ref={firstRef} type="password" autoComplete="current-password" value={pw}
                onChange={(e) => setPw(e.target.value)} placeholder={he ? "סיסמת החשבון" : "account password"}
                style={{ ...fieldStyle, letterSpacing: "normal", fontWeight: 600, textAlign: "start" }} />
            </div>
          ) : (
            <div>
              <label style={labelStyle}>{he ? "קוד נוכחי" : "Current code"}</label>
              <input ref={firstRef} type="password" inputMode="numeric" autoComplete="off" value={cur}
                onChange={(e) => setCur(e.target.value)} placeholder={he ? "הקוד הנוכחי" : "current code"} style={fieldStyle} />
            </div>
          ))}
          <div>
            <label style={labelStyle}>{pinSet ? (he ? "קוד חדש" : "New code") : (he ? "קוד חדש (4+ תווים)" : "New code (4+ chars)")}</label>
            <input ref={pinSet ? undefined : firstRef} type="password" inputMode="numeric" autoComplete="off" value={np}
              onChange={(e) => setNp(e.target.value)} placeholder={he ? "קוד חדש" : "new code"} style={fieldStyle} />
          </div>
          <div>
            <label style={labelStyle}>{he ? "אישור הקוד החדש" : "Confirm new code"}</label>
            <input type="password" inputMode="numeric" autoComplete="off" value={np2}
              onChange={(e) => setNp2(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder={he ? "הקלד שוב" : "re-enter"} style={fieldStyle} />
          </div>

          {errMsg && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, lineHeight: 1.5, fontWeight: 700,
              color: C.loss, background: `${C.loss}12`, border: `1px solid ${C.loss}55`, borderRadius: 10, padding: "9px 12px" }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span>{errMsg}</span>
            </div>
          )}
          {done && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800, color: C.gain }}>
              <CheckCircle2 size={16} /> {he ? "הקוד נשמר ✓" : "Code saved ✓"}
            </div>
          )}

          {/* actions */}
          <div style={{ display: "flex", gap: 10, marginTop: 2, flexDirection: rtl ? "row-reverse" : "row" }}>
            <button onClick={submit} disabled={saveM.isPending || done} className="gbtn tap44"
              style={{ flex: "1.4 1 0", minHeight: 46, borderRadius: 12, border: "none", fontFamily: UI, fontSize: 14.5, fontWeight: 900,
                cursor: (saveM.isPending || done) ? "default" : "pointer", opacity: (saveM.isPending || done) ? 0.6 : 1,
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {saveM.isPending ? <Loader2 size={16} className="spin" /> : null}
              {forgot ? (he ? "אפס קוד" : "Reset PIN") : pinSet ? (he ? "שמור קוד חדש" : "Save new code") : (he ? "הגדר קוד" : "Set code")}
            </button>
            <button onClick={() => { if (!saveM.isPending) onClose(); }} className="tap44"
              style={{ flex: "1 1 0", minHeight: 46, borderRadius: 12, background: C.surface2, color: C.text,
                border: `1px solid ${C.line}`, fontFamily: UI, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
              {done ? (he ? "סגור" : "Close") : (he ? "ביטול" : "Cancel")}
            </button>
          </div>
          {/* Forgot-PIN: only meaningful when a PIN already exists. */}
          {pinSet && !done && (
            <button onClick={() => { setForgot((v) => !v); setErrMsg(""); }} style={forgotLink}>
              {forgot ? (he ? "חזרה לשינוי עם הקוד הנוכחי" : "Back — change with current PIN") : (he ? "שכחתי את הקוד" : "Forgot your PIN?")}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default PinModal;
