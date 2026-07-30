import React from "react";
import { AlertTriangle } from "lucide-react";
import { C, UI } from "../theme";

// Reusable inline field-error line for money/amount inputs (financial-safety Step 3).
// role="alert" so screen readers announce it; pair with aria-invalid + aria-describedby
// on the input (use the same `id`). Renders nothing when there's no message. C.* skins.
export default function FieldError({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;
  return (
    <div id={id} role="alert" style={{ marginTop: 5, fontSize: 11.5, fontWeight: 700, color: C.loss,
      display: "flex", alignItems: "center", gap: 5, lineHeight: 1.4, fontFamily: UI }}>
      <AlertTriangle size={12} style={{ flexShrink: 0 }} /> {message}
    </div>
  );
}
