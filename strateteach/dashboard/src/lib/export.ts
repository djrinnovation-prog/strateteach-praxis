// Dependency-free exports: CSV (opens in Excel) + print-to-PDF (browser dialog).
// No external libs so the build can never break on a missing dependency.

export type Cell = string | number | null | undefined;

function ts(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Download rows as a UTF-8 CSV (with BOM so Excel reads Hebrew + symbols correctly). */
export function downloadCsv(name: string, headers: string[], rows: Cell[][]): void {
  const esc = (v: Cell) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${name}_${ts()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Multi-section report exports (same lib, same brand — for reports with several
// tables like the Finance screen: summary + budget + expenses + wallets + …). ──
export type ReportSection = { title: string; headers?: string[]; rows: Cell[][] };

/** Download a multi-section report as one UTF-8 CSV (BOM for Excel). Each section is a
 *  title row + optional header row + its data rows, separated by a blank line. */
export function downloadReportCsv(name: string, sections: ReportSection[]): void {
  const esc = (v: Cell) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines: string[] = [];
  sections.forEach((s, i) => {
    if (i) lines.push("");
    lines.push(esc(s.title));
    if (s.headers && s.headers.length) lines.push(s.headers.map(esc).join(","));
    s.rows.forEach((r) => lines.push(r.map(esc).join(",")));
  });
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${name}_${ts()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Branded multi-section print (→ "Save as PDF") — one titled table per section. Same
 *  ALGO770 brand bar + gold-header style as printPdf. */
export function printReportPdf(title: string, sections: ReportSection[], rtl = false): void {
  const esc = (v: Cell) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const win = window.open("", "_blank");
  if (!win) { alert("Allow pop-ups to export PDF."); return; }
  const tableFor = (s: ReportSection) => `
    <h2>${esc(s.title)}</h2>
    <table>${s.headers && s.headers.length ? `<thead><tr>${s.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>` : ""}
    <tbody>${s.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const html = `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#14171F;margin:0;padding:28px}
    .brand{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #F7931A;padding-bottom:10px;margin-bottom:16px}
    .brand b{font-size:18px;letter-spacing:.5px} .brand span{color:#8B93A1;font-size:12px}
    h1{font-size:17px;margin:0 0 4px} h2{font-size:13px;margin:18px 0 6px;color:#a65a00;border-bottom:1px solid #eadfce;padding-bottom:3px}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:6px}
    th,td{border:1px solid #d6d9df;padding:6px 9px;text-align:${rtl ? "right" : "left"};white-space:nowrap}
    th{background:#F7931A;color:#1a1206;font-weight:700} tr:nth-child(even) td{background:#f6f7f9}
    @media print{body{padding:0}.brand{padding:12px}h2{break-after:avoid}table{break-inside:auto}}
  </style></head><body>
  <div class="brand"><b>ALGO770 · STRATETEACH</b><span>${esc(new Date().toLocaleString())}</span></div>
  <h1>${esc(title)}</h1>
  ${sections.map(tableFor).join("")}
  <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
  </body></html>`;
  win.document.write(html);
  win.document.close();
}

/** Open a clean printable table in a new tab and trigger print → "Save as PDF". */
export function printPdf(title: string, headers: string[], rows: Cell[][], rtl = false): void {
  const esc = (v: Cell) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const win = window.open("", "_blank");
  if (!win) { alert("Allow pop-ups to export PDF."); return; }
  const html = `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#14171F;margin:0;padding:28px}
    .brand{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #F7931A;padding-bottom:10px;margin-bottom:16px}
    .brand b{font-size:18px;letter-spacing:.5px} .brand span{color:#8B93A1;font-size:12px}
    h1{font-size:16px;margin:0 0 12px} table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{border:1px solid #d6d9df;padding:6px 9px;text-align:${rtl ? "right" : "left"};white-space:nowrap}
    th{background:#F7931A;color:#1a1206;font-weight:700} tr:nth-child(even) td{background:#f6f7f9}
    @media print{body{padding:0}.brand{padding:12px}}
  </style></head><body>
  <div class="brand"><b>ALGO770 · STRATETEACH</b><span>${esc(new Date().toLocaleString())}</span></div>
  <h1>${esc(title)}</h1>
  <table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>
  <script>window.onload=function(){setTimeout(function(){window.print();},200);};<\/script>
  </body></html>`;
  win.document.write(html);
  win.document.close();
}
