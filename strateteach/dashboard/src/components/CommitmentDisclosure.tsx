import React from "react";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";
import { track } from "../lib/analytics";
import ConfirmModal, { type ConfirmRow } from "./ConfirmModal";
import {
  DraftBadge, RISK_POINTS, NO_HIDDEN_FEES, PRELAUNCH_BILLING, useLegalCopy,
} from "../lib/legalCopy";

// ── CommitmentDisclosure — one consistent fee + risk gate before ANY commitment ──
// Wraps the financial-safety ConfirmModal so the THREE commitment points (a plan
// signup, the Trading-Engine unlock, an AutoPilot go-live) show identical wording:
//   • exactly what is charged (priceRows) + pre-launch billing note where relevant,
//   • "no hidden fees",
//   • the risk disclosure (placeholder copy, PENDING RAZ — Item 1b): trading loss,
//     simulation ≠ real money, past ≠ future, not investment advice.
// The user must acknowledge (the confirm button) before onConfirm runs. It does NOT
// change prices or enable billing — it only surfaces the disclosure. ConfirmModal
// gives the preview + honest status + double-submit guard for free (Item 5).

export default function CommitmentDisclosure({
  kind, title, intro, priceRows, prelaunch = false, confirmLabel, tone = "primary", onConfirm, onClose,
}: {
  kind: string;                       // action_kind for telemetry (plan | profit_unlock | go_live)
  title: string;
  intro?: React.ReactNode;
  priceRows: ConfirmRow[];
  prelaunch?: boolean;
  confirmLabel: string;
  tone?: "primary" | "gain" | "loss";
  onConfirm: () => Promise<any> | any;
  onClose: () => void;
}) {
  const { lang } = useI18n();
  const he = lang === "he";
  const legal = useLegalCopy();
  const risk = legal.get("risk", he);           // live, Raz-editable risk disclosure (Block B)
  const disc = legal.get("disclaimer", he);      // live regulatory disclaimer (Block A)

  // A "disclosure shown before commitment" is a viewed event (generic beacon — the 12
  // canonical events reserve blocked_action_seen for an action a LIMIT actually blocks).
  React.useEffect(() => { track("commitment_disclosure_shown", { kind }); }, [kind]);

  const disclosure = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {intro && <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.55 }}>{intro}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text }}>{he ? "גילוי לפני התחייבות" : "Before you commit"}</span>
        {!risk.approved && <DraftBadge item="risk" he={he} />}
      </div>
      <ul style={{ margin: 0, paddingInlineStart: 18, display: "flex", flexDirection: "column", gap: 5 }}>
        <li style={{ fontSize: 12.5, color: C.text, lineHeight: 1.5, fontWeight: 700 }}>{he ? NO_HIDDEN_FEES.he : NO_HIDDEN_FEES.en}</li>
        {prelaunch && (
          <li style={{ fontSize: 12.5, color: C.text, lineHeight: 1.5, fontWeight: 700 }}>{he ? PRELAUNCH_BILLING.he : PRELAUNCH_BILLING.en}</li>
        )}
        {RISK_POINTS.map((p, i) => (
          <li key={i} style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>{he ? p.he : p.en}</li>
        ))}
      </ul>
      {/* Regulatory status (Block A · live, Raz-editable) — shown before money actions. */}
      <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
        {!disc.approved && <div style={{ marginBottom: 4 }}><DraftBadge item="entity" he={he} /></div>}
        <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.5 }}>{disc.text}</div>
      </div>
    </div>
  );

  return (
    <ConfirmModal
      title={title}
      intro={disclosure}
      rows={priceRows}
      risk={risk.text}
      confirmLabel={confirmLabel}
      cancelLabel={he ? "ביטול" : "Cancel"}
      tone={tone}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
