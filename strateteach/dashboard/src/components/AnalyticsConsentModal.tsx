import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { BarChart3, Check, X, Loader2 } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI, SHADOW } from "../theme";
import { setAnalyticsConsentCache, ev as track12 } from "../lib/analytics";
import {
  DraftBadge, CONSENT_TITLE, CONSENT_ACCEPT, CONSENT_DECLINE, CONSENT_PRIVACY_LINK, useLegalCopy,
} from "../lib/legalCopy";

/**
 * One-time analytics-consent notice (Item 3). Shown once after login, BEFORE any
 * tracking, while the server reports the choice as undecided. NOT a hard gate:
 * Decline leaves the app fully usable — it only keeps analytics off. Accept flips
 * the server flag + the client cache so the 12 canonical events may emit. The choice
 * is re-toggleable later in "My Data" (Item 7). Renders nothing once decided.
 */
export default function AnalyticsConsentModal() {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["analyticsConsent"], queryFn: () => api.getAnalyticsConsent(), retry: false, staleTime: 60_000 });
  const consentCopy = useLegalCopy().get("consent", he);   // live, Raz-editable consent copy (Block D)

  const decide = useMutation({
    mutationFn: (consent: boolean) => api.setAnalyticsConsent(consent),
    onSuccess: (_r, consent) => {
      setAnalyticsConsentCache(consent);
      if (consent) track12.userLoggedIn();     // first emit once consent is granted
      qc.setQueryData(["analyticsConsent"], { consent, decided: true });
    },
  });

  // Nothing to show until we know the state, or once the user has already chosen.
  if (q.isLoading || !q.data || q.data.decided) return null;

  const tr = (b: { he: string; en: string }) => (he ? b.he : b.en);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(3,8,24,0.62)", backdropFilter: "blur(3px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: UI, direction: rtl ? "rtl" : "ltr" }}>
      <div role="dialog" aria-modal="true" style={{ width: "100%", maxWidth: 440, background: C.surface, border: `1px solid ${C.line}`,
        borderRadius: 18, boxShadow: SHADOW, overflow: "hidden" }}>
        <div style={{ padding: "18px 20px 12px", display: "flex", alignItems: "center", gap: 11 }}>
          <div style={{ width: 40, height: 40, borderRadius: 11, background: C.surface2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <BarChart3 size={21} color={C.blue} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 17, color: C.text }}>{tr(CONSENT_TITLE)}</div>
          </div>
          {!consentCopy.approved && <DraftBadge item="consent" he={he} />}
        </div>

        <div style={{ padding: "0 20px 8px", color: C.muted, fontSize: 13.5, lineHeight: 1.65, whiteSpace: "pre-line" }}>
          {consentCopy.text}
          <div style={{ marginTop: 12 }}>
            <button type="button" onClick={() => nav("/privacy")}
              style={{ background: "none", border: "none", padding: 0, color: C.blue, fontFamily: UI, fontSize: 13.5, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>
              {tr(CONSENT_PRIVACY_LINK)} →
            </button>
          </div>
        </div>

        <div style={{ padding: "14px 20px 18px", display: "flex", flexDirection: "column", gap: 9 }}>
          <button onClick={() => decide.mutate(true)} disabled={decide.isPending}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: C.accent,
              border: "none", color: "#fff", fontWeight: 800, fontSize: 15, fontFamily: UI, borderRadius: 12, padding: "13px", cursor: "pointer" }}>
            {decide.isPending ? <Loader2 size={17} className="spin" /> : <Check size={18} />} {tr(CONSENT_ACCEPT)}
          </button>
          <button onClick={() => decide.mutate(false)} disabled={decide.isPending}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "none",
              border: `1px solid ${C.line}`, color: C.muted, fontWeight: 700, fontSize: 14, fontFamily: UI, borderRadius: 12, padding: "11px", cursor: "pointer" }}>
            <X size={16} /> {tr(CONSENT_DECLINE)}
          </button>
        </div>
      </div>
    </div>
  );
}
