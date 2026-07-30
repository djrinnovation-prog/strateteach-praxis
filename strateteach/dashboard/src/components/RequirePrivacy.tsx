import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Languages } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";
import BootSplash from "./BootSplash";
import { PrivacyBody, LAST_UPDATED } from "../screens/Privacy";

/** One-time mandatory gate: every user must read + accept the privacy policy
 * before using the app. The accepted version (date) is stored per-user on the
 * server, so it doesn't repeat — and re-prompts only if the policy is updated. */
export default function RequirePrivacy({ children }: { children: React.ReactNode }) {
  const { lang, rtl, setLang } = useI18n();
  const qc = useQueryClient();
  const [err, setErr] = useState("");
  // staleTime matches the boot warm-up so this reuses the prefetched result instead
  // of firing a second /auth/me/privacy on mount.
  const q = useQuery({ queryKey: ["privacyAck"], queryFn: () => api.getPrivacyAck(), retry: false, staleTime: 60_000 });

  const acceptM = useMutation({
    mutationFn: () => api.acceptPrivacy(LAST_UPDATED),
    onSuccess: () => { setErr(""); qc.invalidateQueries({ queryKey: ["privacyAck"] }); },
    onError: (e: any) => setErr(e?.message || String(e)),
  });

  if (q.isLoading) return <BootSplash />;
  // Pass through once the user has accepted the current version.
  if (q.data && q.data.acked === LAST_UPDATED) return <>{children}</>;

  const t = rtl
    ? { agree: "קראתי ואני מסכים/ה", sub: "כדי להמשיך, יש לקרוא ולאשר את מדיניות הפרטיות." }
    : { agree: "I have read and I agree", sub: "To continue, please read and accept the privacy policy." };

  return (
    // ZOOM-SAFE: `position:fixed; inset:0` pins the gate to the ACTUAL viewport regardless of
    // html{zoom:1.15}. The old `minHeight:100vh` rendered ~15% TALLER than the real viewport
    // under zoom (vh doesn't scale with zoom — see index.html), pushing the footer + its accept
    // button BELOW the fold, off-screen & unclickable → users stuck on the consent gate. Fixed
    // + inset:0 also doesn't depend on every wrapper carrying height:100%. Header + footer are
    // pinned (flexShrink:0); ONLY the policy body scrolls (flex:1 + minHeight:0), so the green
    // "I have read and I agree" button is ALWAYS visible + reachable at any zoom and on mobile.
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", fontFamily: UI, direction: rtl ? "rtl" : "ltr", background: C.bg }}>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ fontSize: 13, color: C.muted }}>{t.sub}</div>
        <button type="button" onClick={() => setLang(lang === "he" ? "en" : "he")}
          style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: `1px solid ${C.line}`, color: C.muted, borderRadius: 8, padding: "5px 9px", cursor: "pointer", fontFamily: UI, fontSize: 12 }}>
          <Languages size={14} /> {lang === "he" ? "EN" : "עב"}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 18px", maxWidth: 760, width: "100%", margin: "0 auto" }}>
        <PrivacyBody />
      </div>

      <div style={{ flexShrink: 0, borderTop: `1px solid ${C.line}`, padding: "14px 18px calc(14px + env(safe-area-inset-bottom, 0px))", background: C.surface }}>
        {err && <div style={{ marginBottom: 10, color: "#f3a3a3", fontSize: 13 }}>{err}</div>}
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <button onClick={() => acceptM.mutate()} disabled={acceptM.isPending}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, background: "#1faa55", border: "none", color: "#fff", fontWeight: 800, fontSize: 16, fontFamily: UI, borderRadius: 12, padding: "14px", cursor: "pointer" }}>
            {acceptM.isPending ? <Loader2 size={18} className="spin" /> : <CheckCircle2 size={20} />} {t.agree}
          </button>
        </div>
      </div>
    </div>
  );
}
