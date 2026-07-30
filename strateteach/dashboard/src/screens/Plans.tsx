import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Crown, Zap, Diamond, CreditCard, Settings2, Ticket, Mail, Loader2, AlertTriangle, UserRound, LifeBuoy, TrendingUp, GraduationCap } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI, SHADOW } from "../theme";
import { premSoft, RiskDisclaimer } from "../ui";
import ScreenShortcuts from "../components/ScreenShortcuts";
import FramedTitle from "../components/FramedTitle";
import ScreenBottom from "../components/ScreenBottom";
import HomeTop from "../components/HomeTop";
import AdminAccess from "./AdminAccess";
import CommitmentDisclosure from "../components/CommitmentDisclosure";
import type { ConfirmRow } from "../components/ConfirmModal";

const T = (en: string, he: string, lang: string) => (lang === "he" ? he : en);

// Per-tier accent hues route through the THEME (getters → stay live on skin-switch), so
// the three tiers read as distinct skin-adaptive accents instead of fixed blue/purple/orange.
const PLAN_META: Record<string, { Icon: any; accent: string; tagEn: string; tagHe: string }> = {
  basic: { Icon: Zap, get accent() { return C.blue; }, tagEn: "Get started", tagHe: "להתחלה" },
  middle: { Icon: Diamond, get accent() { return C.accent; }, tagEn: "Most popular", tagHe: "הכי פופולרי" },
  pro: { Icon: Crown, get accent() { return C.gold; }, tagEn: "Full power", tagHe: "עוצמה מלאה" },
};

const FEATURES: Record<string, { en: string; he: string }[]> = {
  basic: [
    { en: "Connect 1 strategy to an exchange", he: "חיבור אסטרטגיה אחת לבורסה" },
    { en: "Up to 5 bots", he: "עד 5 בוטים" },
    { en: "Top 10 daily breakouts", he: "10 הפריצות המובילות ביום" },
    { en: "Chat, dashboard & Learn", he: "צ'אט, דאשבורד ולמידה" },
  ],
  middle: [
    { en: "Everything in Basic", he: "כל מה שב-Basic" },
    { en: "Daily scan up to 1,000 assets", he: "סריקה יומית עד 1,000 נכסים" },
    { en: "Up to 15 bots", he: "עד 15 בוטים" },
    { en: "Backtest: 5/day, 100 assets each", he: "בקטסט: 5 ביום, 100 נכסים" },
    { en: "Strategy Lab — build custom strategies", he: "מעבדת אסטרטגיות — בניית אסטרטגיות" },
  ],
  pro: [
    { en: "Everything in Middle", he: "כל מה שב-Middle" },
    { en: "Full daily scan (largest universe)", he: "סריקה יומית מלאה" },
    { en: "Up to 30 bots, 3 strategies", he: "עד 30 בוטים, 3 אסטרטגיות" },
    { en: "Backtest: 10/day, 2,500 assets", he: "בקטסט: 10 ביום, 2,500 נכסים" },
    { en: "Strategy Lab + Trading Engine (2/day, $20k)", he: "מעבדת אסטרטגיות + מנוע מסחר (2 ביום, $20k)" },
  ],
};

function go(url: string) { window.location.href = url; }

export default function Plans() {
  const { lang, rtl } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string>("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [reqSent, setReqSent] = useState(false);
  // Item 4: a commitment shows the fee + risk disclosure FIRST; on acknowledge it runs
  // the real checkout. Held here so plan-switch and the Trading-Engine unlock reuse it.
  const [pending, setPending] = useState<null | {
    kind: string; title: string; priceRows: ConfirmRow[]; prelaunch: boolean; confirmLabel: string;
    run: () => Promise<{ url: string }>;
  }>(null);

  const entQ = useQuery({ queryKey: ["entitlements"], queryFn: () => api.entitlements() });
  const cfgQ = useQuery({ queryKey: ["billingConfig"], queryFn: () => api.billingConfig() });

  async function redeem() {
    if (!code.trim()) return;
    setBusy("redeem");
    try {
      const r = await api.redeemCode(code.trim());
      setMsg(T("Unlocked: ", "נפתח: ", lang) + r.summary);
      setCode("");
      qc.invalidateQueries({ queryKey: ["entitlements"] });
    } catch (e: any) {
      setMsg(e?.message || T("Invalid code", "קוד לא תקין", lang));
    } finally { setBusy(""); setTimeout(() => setMsg(""), 4000); }
  }
  async function requestAccess() {
    setBusy("request");
    try { await api.requestAccess(); setReqSent(true); }
    catch {} finally { setBusy(""); }
  }

  const ent = entQ.data;
  const cfg = cfgQ.data;
  const configured = !!cfg?.configured;
  const currentPlan = ent?.plan || "basic";
  const order = ["basic", "middle", "pro"];

  async function start(fn: () => Promise<{ url: string }>, key: string) {
    if (!configured) return;
    setBusy(key);
    try { const { url } = await fn(); go(url); }
    catch { setBusy(""); alert(T("Couldn't start checkout. Please try again.", "לא ניתן להתחיל תשלום, נסה שוב.", lang)); }
  }

  const plans = cfg?.plans || [];

  return (
    <div style={{ direction: rtl ? "rtl" : "ltr", fontFamily: UI, color: C.text }}>
      <FramedTitle text={T("Plans & billing", "מסלולים ותשלום", lang)}
        subtitle={T("Upgrade any time · secure Stripe checkout — your card never touches our servers.",
                    "ניתן לשדרג בכל עת · תשלום מאובטח דרך Stripe — פרטי הכרטיס לא נשמרים אצלנו.", lang)} />
      {/* Editable top shortcuts — quick jumps to the account areas around billing,
          user-customizable (up to 5) with an "עוד במערכת" launcher for the rest. */}
      <ScreenShortcuts
        screenKey="plans"
        defaultKeys={["account", "help", "trading", "learn"]}
        catalog={[
          { key: "account", label: T("Account", "החשבון", lang), Icon: UserRound, onClick: () => nav("/me") },
          { key: "help", label: T("Help", "עזרה", lang), Icon: LifeBuoy, onClick: () => nav("/requests") },
          { key: "trading", label: T("Trading", "מסחר", lang), Icon: TrendingUp, onClick: () => nav("/profit") },
          { key: "learn", label: T("Learn", "למידה", lang), Icon: GraduationCap, onClick: () => nav("/university") },
          { key: "billing", label: T("Billing", "תשלום", lang), Icon: CreditCard, onClick: () => nav("/me?sec=management") },
        ]}
      />
      {/* P&L (תיק) card at the top — the SAME home balance card, collapsed by default. */}
      <HomeTop />
      <RiskDisclaimer style={{ margin: "0 0 14px" }} />

      {ent && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", margin: "10px 0 18px" }}>
          <span style={{ fontSize: 12, color: C.muted }}>{T("Your plan", "המסלול שלך", lang)}:</span>
          <span style={{ padding: "4px 12px", borderRadius: 999, background: "var(--btn-bg)", color: "var(--btn-ink)", fontWeight: 800, fontSize: 12 }}>
            {ent.planLabel}{ent.isAdmin ? " · admin" : ""}
          </span>
          <span style={{ fontSize: 12, color: C.muted }}>★ {ent.loyaltyPoints} {T("points", "נקודות", lang)}</span>
          {ent.badge && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 800, color: "var(--btn-ink)",
              background: "var(--btn-bg)", borderRadius: 999, padding: "3px 10px", textTransform: "capitalize" }}>
              🏅 {ent.badge}
            </span>
          )}
          {ent.profitUnlocked && <span style={{ fontSize: 12, color: C.gain }}>✓ {T("Trading Engine unlocked", "מנוע המסחר פתוח", lang)}</span>}
          {configured && (
            <button onClick={() => start(() => api.billingPortal(), "portal")} style={ghostBtn()}>
              <Settings2 size={13} /> {T("Manage billing", "ניהול תשלום", lang)}
            </button>
          )}
        </div>
      )}

      {/* LOADING — don't flash the "billing off" notice while the config is still loading. */}
      {cfgQ.isLoading && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: C.surface2, border: `1px solid ${C.line}`, color: C.muted, fontSize: 13, marginBottom: 16, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Loader2 size={14} className="spin" /> {T("Loading plans…", "טוען מסלולים…", lang)}
        </div>
      )}
      {/* ERROR — billing config couldn't load. */}
      {cfgQ.isError && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: `${C.loss}12`, border: `1px solid ${C.loss}55`, color: C.text, fontSize: 13, marginBottom: 16, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <AlertTriangle size={14} color={C.loss} /> {T("Couldn't load plans.", "טעינת המסלולים נכשלה.", lang)}
          <button onClick={() => cfgQ.refetch()} style={{ ...premSoft(), color: C.text, padding: "5px 12px", fontSize: 12, cursor: "pointer", fontFamily: UI }}>{T("Retry", "נסה שוב", lang)}</button>
        </div>
      )}
      {!configured && !cfgQ.isLoading && !cfgQ.isError && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: `${C.gold}14`, border: `1px solid ${C.line}`, color: C.muted, fontSize: 13, marginBottom: 16 }}>
          {T("Billing isn't switched on yet — pricing is shown for preview. Checkout activates once Stripe keys are added.",
             "התשלום עדיין לא פעיל — המחירים מוצגים לתצוגה. התשלום יופעל לאחר הוספת מפתחות Stripe.", lang)}
        </div>
      )}

      {/* Redeem a code + request access */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Ticket size={16} color={C.gold} />
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={T("Have a code?", "יש לכם קוד?", lang)}
            style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 9, padding: "9px 11px", fontFamily: UI, fontSize: 13, width: 170, letterSpacing: "0.04em" }} />
          <button onClick={redeem} disabled={busy === "redeem"} style={{ ...premSoft(), cursor: "pointer", color: C.text, padding: "9px 16px", fontSize: 12.5, fontFamily: UI, whiteSpace: "nowrap" }}>
            {busy === "redeem" ? "…" : T("Redeem", "ממש", lang)}
          </button>
        </div>
        {!ent?.isAdmin && (
          reqSent
            ? <span style={{ fontSize: 12.5, color: C.gain }}>✓ {T("Request sent to the admin", "הבקשה נשלחה למנהל", lang)}</span>
            : <button onClick={requestAccess} disabled={busy === "request"} style={{ ...premSoft(), display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", color: C.text, padding: "9px 16px", fontSize: 12.5, fontFamily: UI }}>
                <Mail size={14} /> {T("Contact admin for access", "פנו למנהל לקבלת גישה", lang)}
              </button>
        )}
        {msg && <span style={{ fontSize: 12.5, color: msg.startsWith(T("Unlocked", "נפתח", lang)) ? C.gain : C.loss }}>{msg}</span>}
      </div>

      {/* Plan cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 14 }}>
        {order.map((pid) => {
          const info = plans.find((p) => p.id === pid);
          const meta = PLAN_META[pid];
          const Icon = meta.Icon;
          const isCurrent = currentPlan === pid;
          const idx = order.indexOf(pid);
          const curIdx = order.indexOf(currentPlan);
          const isUpgrade = idx > curIdx;
          return (
            <div key={pid} style={{
              position: "relative", borderRadius: 16, padding: 18,
              background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
              border: `${isCurrent || pid === "middle" ? 1.5 : 1}px solid ${isCurrent ? meta.accent : C.line}`,
              boxShadow: pid === "middle"
                ? `inset 0 1px 0 rgba(255,255,255,0.26), 0 0 0 1px ${meta.accent}55, 0 16px 36px -18px ${meta.accent}`
                : `inset 0 1px 0 rgba(255,255,255,0.24), ${SHADOW}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: `${meta.accent}22` }}>
                    <Icon size={18} color={meta.accent} />
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 800 }}>{info?.label || pid}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: meta.accent }}>{T(meta.tagEn, meta.tagHe, lang)}</span>
              </div>

              <div style={{ margin: "14px 0 4px", display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ fontSize: 30, fontWeight: 800 }}>${info ? info.price.toFixed(info.price % 1 ? 2 : 0) : "—"}</span>
                <span style={{ fontSize: 13, color: C.muted }}>/{T("mo", "חודש", lang)}</span>
              </div>

              <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                {(FEATURES[pid] || []).map((f, i) => (
                  <li key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, color: C.text }}>
                    <Check size={15} color={meta.accent} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>{lang === "he" ? f.he : f.en}</span>
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <div style={{ textAlign: "center", padding: "10px", borderRadius: 10, background: C.surface2, color: C.muted, fontWeight: 700, fontSize: 13 }}>
                  {T("Current plan", "המסלול הנוכחי", lang)}
                </div>
              ) : (
                <button
                  disabled={!configured || busy === pid}
                  onClick={() => setPending({
                    kind: "plan",
                    title: (isUpgrade ? T("Upgrade plan", "שדרוג מסלול", lang) : T("Switch plan", "החלפת מסלול", lang)) + ` — ${info?.label || pid}`,
                    priceRows: [
                      { label: T("Plan", "מסלול", lang), value: info?.label || pid },
                      { label: T("Price", "מחיר", lang), value: `$${info ? info.price.toFixed(info.price % 1 ? 2 : 0) : "—"}/${T("mo", "חודש", lang)}` },
                    ],
                    prelaunch: true,
                    confirmLabel: isUpgrade ? T("Upgrade", "שדרג", lang) : T("Switch", "החלף", lang),
                    run: () => api.billingCheckout(pid),
                  })}
                  className={isUpgrade ? "gbtn ptile" : "ptile"}
                  style={{
                    width: "100%", padding: "12px", border: isUpgrade ? undefined : `1.5px solid ${C.line}`,
                    cursor: configured ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 800, fontSize: 13.5, fontFamily: UI, whiteSpace: "nowrap", opacity: configured ? 1 : 0.5,
                    background: isUpgrade ? "var(--btn-bg)" : C.surface2, color: isUpgrade ? "var(--btn-ink)" : C.text,
                  }}>
                  {busy === pid ? "…" : isUpgrade ? T("Upgrade", "שדרג", lang) : T("Switch", "החלף", lang)}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Trading Engine one-time unlock */}
      <div style={{ marginTop: 22, borderRadius: 16, padding: 18, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, border: `1px solid ${C.line}`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.24), ${SHADOW}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Diamond size={18} color={C.gold} />
          <div style={{ fontSize: 16, fontWeight: 800 }}>{T("Trading Engine — full access", "מנוע המסחר — גישה מלאה", lang)}</div>
          {ent?.profitUnlocked && <span style={{ fontSize: 11, color: C.gain, marginInlineStart: "auto" }}>✓ {T("Unlocked", "פתוח", lang)}</span>}
        </div>
        <p style={{ color: C.muted, fontSize: 12.5, margin: "0 0 12px" }}>
          {T(`One-time payment to remove the $20k run cap and unlock the Trading Engine on any plan.`,
             `תשלום חד-פעמי להסרת תקרת ה-$20k ולפתיחת מנוע המסחר בכל מסלול.`, lang)}
        </p>
        {!ent?.profitUnlocked && (
          <button
            disabled={!configured || busy === "unlock"}
            onClick={() => setPending({
              kind: "profit_unlock",
              title: T("Trading Engine — full access", "מנוע המסחר — גישה מלאה", lang),
              priceRows: [
                { label: T("One-time payment", "תשלום חד-פעמי", lang), value: `$${(cfg?.profitUnlockPrice ?? 500).toFixed(0)}` },
                { label: T("What you get", "מה מקבלים", lang), value: T("Remove the $20k cap · unlock the Trading Engine", "הסרת תקרת $20k · פתיחת מנוע המסחר", lang) },
              ],
              prelaunch: true,
              confirmLabel: `${T("Unlock", "פתח", lang)} · $${(cfg?.profitUnlockPrice ?? 500).toFixed(0)}`,
              run: () => api.billingProfitUnlock(),
            })}
            className="ptile"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "11px 24px", border: `1.5px solid ${C.line}`,
              background: C.surface2, color: C.text, cursor: configured ? "pointer" : "not-allowed",
              fontWeight: 700, fontSize: 14, fontFamily: UI, whiteSpace: "nowrap", opacity: configured ? 1 : 0.5 }}>
            {busy === "unlock" ? "…" : `${T("Unlock", "פתח", lang)} · $${(cfg?.profitUnlockPrice ?? 500).toFixed(0)}`}
          </button>
        )}
      </div>

      {/* Credits */}
      {(cfg?.creditPacks?.length ?? 0) > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
            <CreditCard size={17} color={C.blue} />
            <div style={{ fontSize: 16, fontWeight: 800 }}>{T("Credits — top up beyond your plan", "קרדיטים — הרחבה מעבר למסלול", lang)}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
            {cfg!.creditPacks.map((p) => (
              <div key={p.kind} style={{ borderRadius: 12, padding: 14, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, border: `1px solid ${C.line}`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.22), ${SHADOW}` }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{p.label}</div>
                <div style={{ fontSize: 12, color: C.muted, margin: "2px 0 10px" }}>
                  {ent ? `${T("You have", "ברשותך", lang)}: ${ent.credits?.[p.kind] || 0}` : ""}
                </div>
                <button
                  disabled={!configured || busy === `c_${p.kind}`}
                  onClick={() => setPending({
                    kind: "credits",
                    title: `${T("Buy credits", "רכישת קרדיטים", lang)} — ${p.label || p.kind}`,
                    priceRows: [
                      { label: T("Pack", "חבילה", lang), value: p.label || p.kind },
                      { label: T("Price", "מחיר", lang), value: `$${p.price.toFixed(p.price % 1 ? 2 : 0)}` },
                    ],
                    prelaunch: true,
                    confirmLabel: `${T("Buy", "קנה", lang)} · $${p.price.toFixed(p.price % 1 ? 2 : 0)}`,
                    run: () => api.billingCredits(p.kind, 1),
                  })}
                  className="ptile"
                  style={{ width: "100%", padding: "10px", border: `1.5px solid ${C.line}`, cursor: configured ? "pointer" : "not-allowed",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 700, fontSize: 12.5, fontFamily: UI, whiteSpace: "nowrap", background: C.surface2, color: C.text, opacity: configured ? 1 : 0.5 }}>
                  {busy === `c_${p.kind}` ? "…" : `${T("Buy", "קנה", lang)} · $${p.price.toFixed(p.price % 1 ? 2 : 0)}`}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin access control (coupons, per-user grants, requests) */}
      {ent?.isAdmin && <AdminAccess />}

      {/* Item 4: fee + risk disclosure before ANY billing commitment. Acknowledge →
          the real Stripe checkout runs; the modal shows honest status + guards a
          double-submit. Does not change prices or enable billing. */}
      {pending && (
        <CommitmentDisclosure
          kind={pending.kind}
          title={pending.title}
          priceRows={pending.priceRows}
          prelaunch={pending.prelaunch}
          confirmLabel={pending.confirmLabel}
          onClose={() => setPending(null)}
          onConfirm={async () => { const { url } = await pending.run(); go(url); }}
        />
      )}
      {/* Persistent bottom cluster (like Home): live/demo P&L + Help-Portal, above the tab bar. */}
      <ScreenBottom />
    </div>
  );
}

// Secondary premium pill (read C.* at call time so it re-themes with the skin).
const ghostBtn = (): React.CSSProperties => ({
  ...premSoft(), display: "inline-flex", alignItems: "center", gap: 6,
  color: C.muted, padding: "6px 12px", cursor: "pointer", fontFamily: UI, fontSize: 12, whiteSpace: "nowrap",
});
