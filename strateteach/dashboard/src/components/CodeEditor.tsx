import React, { useRef } from "react";
import { C, MONO } from "../theme";

// A dependency-free code editor: a transparent <textarea> over a syntax-highlighted
// <pre> overlay, with line numbers. Enough Pine-Script colouring to feel like an IDE
// without bundling CodeMirror/Monaco.

const KEYWORDS = ["strategy", "indicator", "study", "input", "int", "float", "bool", "string", "source", "plot", "plotshape", "hline", "fill", "if", "else", "for", "to", "while", "var", "varip", "and", "or", "not", "true", "false", "na", "color", "request", "ta", "math", "barstate", "syminfo", "close", "open", "high", "low", "volume", "overlay", "title", "defval", "minval", "maxval"];
const KW = new Set(KEYWORDS);

function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// Single-pass tokenizer — colours each token once, never re-processing inserted markup.
function highlight(code: string): string {
  const TOKEN = /(\/\/[^\n]*)|(".*?")|('.*?')|(\b\d+\.?\d*\b)|([A-Za-z_]\w*)/g;
  return code.split("\n").map((line) => {
    let out = "", last = 0;
    let m: RegExpExecArray | null;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(line)) !== null) {
      out += esc(line.slice(last, m.index));
      const tok = m[0];
      let color = "";
      if (m[1]) color = "#5f6b7a";              // comment
      else if (m[2] || m[3]) color = "#7CC04E";  // string
      else if (m[4]) color = "#36C5F0";          // number
      else if (m[5] && KW.has(tok)) color = "#F7931A"; // keyword
      out += color ? `<span style="color:${color}">${esc(tok)}</span>` : esc(tok);
      last = m.index + tok.length;
    }
    out += esc(line.slice(last));
    return out || "&nbsp;";
  }).join("\n");
}

export default function CodeEditor({ value, onChange, minRows = 6, placeholder }: {
  value: string; onChange: (v: string) => void; minRows?: number; placeholder?: string;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const gutRef = useRef<HTMLDivElement | null>(null);
  const lineCount = Math.max(minRows, value.split("\n").length);

  const sync = () => {
    if (preRef.current && taRef.current) { preRef.current.scrollTop = taRef.current.scrollTop; preRef.current.scrollLeft = taRef.current.scrollLeft; }
    if (gutRef.current && taRef.current) gutRef.current.scrollTop = taRef.current.scrollTop;
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget; const s = ta.selectionStart, en = ta.selectionEnd;
      const next = value.slice(0, s) + "  " + value.slice(en);
      onChange(next);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2; });
    }
  };

  const shared: React.CSSProperties = {
    margin: 0, padding: "10px 12px", fontFamily: MONO, fontSize: 13, lineHeight: "20px",
    whiteSpace: "pre", overflow: "auto", border: "none", tabSize: 2 as any,
  };

  return (
    <div style={{ display: "flex", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden", direction: "ltr" }}>
      <div ref={gutRef} aria-hidden style={{ ...shared, overflow: "hidden", textAlign: "right", color: C.faint, background: "rgba(255,255,255,0.03)", userSelect: "none", paddingInline: 8, minWidth: 38, flexShrink: 0 }}>
        {Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")}
      </div>
      <div style={{ position: "relative", flex: 1, minWidth: 0, height: lineCount * 20 + 20, maxHeight: 360 }}>
        <pre ref={preRef} aria-hidden style={{ ...shared, position: "absolute", inset: 0, color: C.text, pointerEvents: "none" }}
          dangerouslySetInnerHTML={{ __html: highlight(value) + "\n" }} />
        <textarea ref={taRef} value={value} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)} onScroll={sync} onKeyDown={onKey} spellCheck={false}
          style={{ ...shared, position: "absolute", inset: 0, width: "100%", height: "100%", resize: "none",
            color: "transparent", background: "transparent", caretColor: C.gold, outline: "none" }} />
      </div>
    </div>
  );
}
