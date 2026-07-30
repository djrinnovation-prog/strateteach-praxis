import React from "react";
import { useI18n } from "../i18n";
import { C, RADIUS, SHADOW } from "../theme";

export default function Placeholder({ title }: { title: string }) {
  const { t } = useI18n();
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 16px" }}>{title}</h1>
      <div style={{ background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, border: `1px solid ${C.line}`, borderRadius: RADIUS.lg, padding: 40, textAlign: "center", color: C.muted,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.20), ${SHADOW}` }}>
        {t.comingSoon}
      </div>
    </div>
  );
}
