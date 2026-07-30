import React from "react";
import { C } from "../theme";

// Lightweight markdown renderer for legal bodies — the legal texts are authored in a small
// markdown subset: `## Heading` lines, blank-line-separated paragraphs, and **bold** inline.
// Kept intentionally minimal (no third-party markdown dep) and skin-aware via C.*. Shared by
// the Legal Console live-preview AND the public views (Privacy screen, exchange-keys note).

// Render **bold** inside a line → an array of React nodes.
function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<strong key={i++} style={{ fontWeight: 800 }}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function LegalMarkdown({ body, rtl }: { body: string; rtl?: boolean }) {
  const blocks = (body || "").replace(/\r\n/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div style={{ direction: rtl ? "rtl" : "ltr", color: C.text, lineHeight: 1.7 }}>
      {blocks.map((block, i) => {
        if (block.startsWith("## ")) {
          return (
            <h2 key={i} style={{ fontSize: 16, fontWeight: 700, color: C.gold, margin: i === 0 ? "0 0 6px" : "18px 0 6px" }}>
              {inline(block.slice(3).trim())}
            </h2>
          );
        }
        // A block may hold several single-newline lines → keep them as line breaks.
        const lines = block.split("\n");
        return (
          <p key={i} style={{ margin: "0 0 8px", fontSize: 14.5 }}>
            {lines.map((ln, j) => (
              <React.Fragment key={j}>{j > 0 && <br />}{inline(ln)}</React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
