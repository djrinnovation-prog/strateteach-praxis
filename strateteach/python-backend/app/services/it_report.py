"""IT Summary Report — Oren's IT/technical side with the owners, in the Owners Daily Report look.

The IT counterpart of :mod:`app.services.legal_report`: same branded, bilingual, WeasyPrint
design (all fragment helpers + PDF path reused from :mod:`app.services.owners_report`), scoped
to the IT side — Oren's PM tasks (partner=oren) + the IT Portal's sections/notes/chat activity
+ the "ניהול ועריכה" store (docs + system links). Sent to the THREE OWNERS ONLY (Dan/Rafi/Yoav),
exactly the rule the legal report uses — a collaborator's report goes UP to the owners.

  • build_report_data() -> the IT payload (tasks + portal activity + docs/links).
  • render_html(d)      -> full bilingual HTML (web view + emailed PDF source).
  • render_pdf(d)       -> PDF bytes via WeasyPrint.
  • send_report(actor)  -> render once, email each owner the PDF + an HTML link, + SMS link.
"""
from __future__ import annotations

import logging
from datetime import datetime
from statistics import mean

from app import database as db
from app.services import email as email_svc
from app.services import sms
from app.services import owners_report as orr  # brand tokens + fragment helpers + PDF path
from app.services.legal_report import owner_report_recipients  # SAME 3-owners rule, reused

logger = logging.getLogger("algo770")

_IT_PARTNER = "oren"

# Reuse the exact brand tokens (so all three reports stay identical in style).
BG, SURFACE2, LINE = orr.BG, orr.SURFACE2, orr.LINE
TEXT, MUTED, FAINT = orr.TEXT, orr.MUTED, orr.FAINT
ACCENT, GOLD, GOLDDIM, GAIN, LOSS = orr.ACCENT, orr.GOLD, orr.GOLDDIM, orr.GAIN, orr.LOSS


def _il_dates() -> tuple[str, str]:
    now = datetime.now(orr._IL)
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return f"{now.day}/{now.month}/{now.year}", f"{now.day} {months[now.month - 1]} {now.year}"


# ── data ─────────────────────────────────────────────────────────────────────
def build_report_data() -> dict:
    """Assemble the IT payload from LIVE data — Oren's PM tasks + the IT portal activity + store.
    Uses the same "assigned to them" set as the portal Tasks tab (partner-set OR assignee), so the
    report matches what Oren sees — including tasks an owner entered for him."""
    tasks = db.list_pm_tasks_assigned_to(_IT_PARTNER)
    goal = db.get_pm_goal(_IT_PARTNER)
    counts = {k: sum(1 for t in tasks if orr._bucket(t) == k) for k in orr.ORDER}
    overall = round(mean(int(t.get("progress") or 0) for t in tasks)) if tasks else 0

    sections = db.list_legal_sections(domain="it")
    open_n = sum(1 for s in sections if (s.get("status") or "open") == "open")
    resolved_n = sum(1 for s in sections if s.get("status") == "resolved")
    notes_total = sum(int(s.get("note_count") or 0) for s in sections)
    chat_total = len(db.list_legal_chat(0, domain="it"))
    docs = db.list_it_docs()
    links = db.list_it_links()
    dateHe, dateEn = _il_dates()
    return {
        "dateHe": dateHe, "dateEn": dateEn,
        "goalHe": (goal or {}).get("goalHe", ""), "goalEn": (goal or {}).get("goalEn", ""),
        "overall": overall, "total": len(tasks), "counts": counts, "tasks": tasks,
        "portal": {
            "open": open_n, "resolved": resolved_n, "sectionsTotal": len(sections),
            "notes": notes_total, "chat": chat_total,
            "docs": len(docs), "links": len(links),
            "sections": sections[:8],
            "linkRows": links[:8],
        },
    }


# ── IT-specific fragments (reuse owners_report helpers for the shared bits) ────
def _hero(d: dict, he: bool) -> str:
    date = d["dateHe"] if he else d["dateEn"]
    kicker = "דוח סיכום IT" if he else "IT Summary Report"
    sub = (f"אורן · הצד הטכני מול הבעלים · {date}" if he else f"Oren · the IT side with the owners · {date}")
    lang = "עברית" if he else "English"
    return (
        f'<div style="background:linear-gradient(165deg,#FFFFFF 0%,{BG} 52%,{SURFACE2} 100%);'
        f'border-bottom:1px solid rgba(203,110,84,0.20);padding:30px 34px 26px;text-align:center">'
        f'<div style="margin-bottom:14px">{orr._mark(46)}'
        f'<span style="display:inline-block;vertical-align:middle;margin:0 10px;font-size:11px;font-weight:800;'
        f'letter-spacing:.16em;color:{ACCENT}">{lang}</span></div>'
        f'<div style="font-size:11px;font-weight:800;letter-spacing:.3em;text-transform:uppercase;color:{ACCENT}">{kicker}</div>'
        f'<div style="font-size:56px;font-weight:900;letter-spacing:.01em;color:{ACCENT};line-height:1.02;margin:6px 0 4px">strateteach</div>'
        f'<div style="font-size:14px;font-weight:700;color:{MUTED}">{sub}</div>'
        f'</div>'
    )


def _launch(d: dict, he: bool) -> str:
    label = "התקדמות IT לקראת השקה" if he else "IT progress to launch"
    done_lbl, blocked_lbl, remain_lbl = ("הושלמו", "חסומים", "נותרו") if he else ("done", "blocked", "to go")
    done_n, blocked_n = d["counts"]["done"], d["counts"]["blocked"]
    remain_n = d["total"] - done_n
    a = "right" if he else "left"
    z = "left" if he else "right"
    mini = (
        f'<span style="font-size:18px;font-weight:900;color:{GAIN}">{done_n}</span> '
        f'<span style="font-size:11px;font-weight:700;color:{MUTED}">{done_lbl}</span>'
        f'<span style="display:inline-block;width:20px"></span>'
        f'<span style="font-size:18px;font-weight:900;color:{LOSS}">{blocked_n}</span> '
        f'<span style="font-size:11px;font-weight:700;color:{MUTED}">{blocked_lbl}</span>'
        f'<span style="display:inline-block;width:20px"></span>'
        f'<span style="font-size:18px;font-weight:900;color:{ACCENT}">{remain_n}</span> '
        f'<span style="font-size:11px;font-weight:700;color:{MUTED}">{remain_lbl}</span>'
    )
    txt = (
        f'<td style="vertical-align:middle;text-align:{a}">'
        f'<div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:{ACCENT}">{label}</div>'
        f'<div style="font-size:62px;font-weight:900;color:{TEXT};line-height:1;margin:4px 0 12px">{d["overall"]}%</div>'
        f'{orr._pbar(d["overall"], ACCENT, 12)}<div style="margin-top:13px">{mini}</div></td>'
    )
    ring = f'<td style="vertical-align:middle;text-align:{z};width:150px">{orr._ring(d["overall"])}</td>'
    cells = (ring + txt) if he else (txt + ring)
    return (
        f'<div style="page-break-inside:avoid;padding:22px 4px 6px">'
        f'<table style="width:100%;border-collapse:collapse"><tr>{cells}</tr></table></div>'
    )


def _tasks_table(d: dict, he: bool) -> str:
    if not d["tasks"]:
        return (f'<div style="font-size:12.5px;color:{MUTED};padding:6px 4px">'
                f'{"אין משימות IT משויכות." if he else "No IT tasks assigned."}</div>')
    rows = orr._task_rows({"tasks": d["tasks"]}, he)
    return (f'<div style="page-break-inside:avoid"><table style="width:100%;border-collapse:collapse">{rows}</table></div>')


def _stat_tile(n, label: str, color: str, a: str) -> str:
    return (f'<td style="text-align:center;padding:2px 4px">'
            f'<div style="font-size:22px;font-weight:900;color:{color}">{n}</div>'
            f'<div style="font-size:10px;font-weight:700;color:{MUTED}">{label}</div></td>')


def _portal_summary(d: dict, he: bool) -> str:
    """IT-portal activity — open/resolved sections, notes, chat, docs + system links, then the
    recent system-links list (the 'link your system to us' area)."""
    p = d["portal"]
    a = "right" if he else "left"
    z = "left" if he else "right"
    open_l, res_l, docs_l, links_l = (("סקשנים פתוחים", "טופלו", "מסמכים", "קישורי מערכת")
                                      if he else ("Open sections", "Resolved", "Docs", "System links"))
    tiles = (_stat_tile(p["open"], open_l, ACCENT, a) + _stat_tile(p["resolved"], res_l, GAIN, a)
             + _stat_tile(p["docs"], docs_l, TEXT, a) + _stat_tile(p["links"], links_l, GOLD, a))
    strip = (f'<div style="page-break-inside:avoid;padding-top:6px">'
             f'<table style="width:100%;border-collapse:collapse"><tr>{tiles}</tr></table></div>')

    link_rows = ""
    links = p.get("linkRows") or []
    for i, l in enumerate(links):
        label = orr._esc(l.get("label") or l.get("url") or "")
        url = orr._esc(l.get("url") or "")
        note = orr._esc(l.get("note") or "")
        bb = "" if i == len(links) - 1 else f"border-bottom:1px solid {LINE}55"
        note_div = f'<div style="font-size:10.5px;color:{FAINT}">{note}</div>' if note else ""
        link_rows += (
            f'<tr>'
            f'<td style="padding:9px 4px;{bb};text-align:{a};font-size:12.5px;font-weight:700;color:{TEXT}">{label}{note_div}</td>'
            f'<td style="padding:9px 4px;{bb};text-align:{z};font-size:10.5px;color:{MUTED};word-break:break-all">{url}</td>'
            f'</tr>'
        )
    if not links:
        link_rows = (f'<tr><td style="padding:9px 4px;font-size:12.5px;color:{MUTED}">'
                     f'{"אין עדיין קישורי מערכת." if he else "No system links yet."}</td></tr>')
    table = (f'<div style="page-break-inside:avoid;margin-top:14px"><table style="width:100%;border-collapse:collapse">{link_rows}</table></div>')
    return strip + table


def _foot(he: bool) -> str:
    return (f'<div style="margin-top:20px;padding-top:14px;border-top:1px solid {LINE};text-align:center;'
            f'font-size:11px;color:{FAINT};line-height:1.7">strateteach · '
            f'{"דוח סיכום IT — נוצר אוטומטית מהפורטל" if he else "IT Summary Report — auto-generated from the portal"}</div>')


def _lang_block(d: dict, he: bool, first: bool) -> str:
    dir_attr = "rtl" if he else "ltr"
    brk = "" if first else "page-break-before:always;"
    goal = orr._esc((d.get("goalHe") or d.get("goalEn")) if he else (d.get("goalEn") or d.get("goalHe")))
    goal_row = ""
    if goal:
        goal_lbl = "יעד IT" if he else "IT goal"
        goal_row = (f'<div style="margin:2px 0 4px;font-size:12.5px;color:{MUTED}">'
                    f'<b style="color:{ACCENT}">{goal_lbl}:</b> {goal}</div>')
    return (
        f'<section dir="{dir_attr}" style="{brk}">{_hero(d, he)}'
        f'<div style="padding:0 34px 24px">{_launch(d, he)}{goal_row}'
        f'{orr._sec_title(he, "01", "משימות IT", "IT tasks")}{_tasks_table(d, he)}'
        f'{orr._sec_title(he, "02", "פעילות בפורטל ה-IT", "IT portal activity")}{_portal_summary(d, he)}'
        f'{_foot(he)}</div></section>'
    )


def render_html(d: dict) -> str:
    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<title>strateteach · IT Summary Report</title><style>'
        '@page{size:A4;margin:0}'
        '*{margin:0;padding:0;box-sizing:border-box}'
        f'html{{background:{orr.PAGE_BG};'
        'font-family:"Rubik","Noto Sans Hebrew","Noto Sans","DejaVu Sans",system-ui,-apple-system,"Arial Hebrew",Arial,sans-serif}'
        f'body{{color:{TEXT}}}'
        '@media screen{body{max-width:860px;margin:0 auto}}'
        '</style></head><body>'
        + _lang_block(d, he=True, first=True) + _lang_block(d, he=False, first=False)
        + '</body></html>'
    )


def render_pdf(d: dict) -> bytes:
    from weasyprint import HTML  # lazy import so the app boots even without the dep
    return HTML(string=render_html(d)).write_pdf()


# ── email + SMS send (PDF attached + tokenized HTML link) — to the 3 owners ───
def _email_bodies(d: dict, link: str | None) -> tuple[str, str, str]:
    subj = f"דוח סיכום IT · IT Summary Report — {d.get('dateEn') or ''}"
    link_html = (f'<p style="margin:18px 0"><a href="{link}" '
                 f'style="display:inline-block;background:{ACCENT};color:#fff;text-decoration:none;'
                 f'font-weight:800;padding:11px 20px;border-radius:10px">צפייה בדוח (HTML) · View report</a></p>'
                 f'<p style="font-size:12px;color:{MUTED}">{link}</p>') if link else ""
    html = (
        f'<div style="font-family:Arial,sans-serif;color:{TEXT};max-width:560px">'
        f'<p style="font-weight:800;font-size:16px">שלום 👋 · Hello</p>'
        f'<p>מצורף דוח הסיכום של ה-IT כ-PDF. התקדמות IT: <b>{d["overall"]}%</b>.</p>'
        f'<p>The IT summary report is attached as a PDF. IT progress: <b>{d["overall"]}%</b>.</p>'
        f'{link_html}'
        f'<p style="font-size:12px;color:{MUTED}">ALGO770 · STRATETEACH · IT</p></div>'
    )
    text = (f"דוח הסיכום של ה-IT מצורף כ-PDF. התקדמות IT: {d['overall']}%.\n"
            f"The IT summary report is attached as a PDF. IT progress: {d['overall']}%.")
    if link:
        text += f"\n\nצפייה בדוח (HTML) · View report:\n{link}"
    return subj, html, text


def _report_link(token: str | None) -> str | None:
    import os
    base = (os.environ.get("PUBLIC_BASE_URL") or os.environ.get("OWNERS_REPORT_BASE_URL") or "").rstrip("/")
    if not base:
        return None
    return f"{base}/it/portal/report.html" + (f"?t={token}" if token else "")


def _sms_body(d: dict, link: str | None) -> str:
    head = f"strateteach · דוח סיכום IT · התקדמות {d['overall']}%"
    return f"{head}\n{link}" if link else head


def send_report(*, actor: str | None = None) -> dict:
    """Render once, then send the IT summary to the THREE OWNERS ONLY (Dan/Rafi/Yoav): the PDF +
    HTML link by email, AND an SMS with the login-free tokenized link. On demand (Oren or an owner
    presses send). Per-recipient email + SMS status is SURFACED (never a silent success)."""
    try:
        data = build_report_data()
        pdf = render_pdf(data)
    except Exception as exc:  # noqa: BLE001
        logger.warning("it report: render failed: %s", exc)
        return {"error": f"render_failed: {exc}", "sent": 0, "total": 0}

    fname = f"it-summary-{(data.get('dateEn') or '').replace(' ', '-')}.pdf"
    token = orr.mint_report_token()          # reuse the generic report-view token (login-free link)
    link = _report_link(token)
    subj, body_html, body_text = _email_bodies(data, link)
    sms_body = _sms_body(data, link)
    attachments = [{"filename": fname, "content_bytes": pdf, "type": "application/pdf"}]

    recipients = owner_report_recipients()   # the 3 OWNERS only — not the other collaborators
    if not recipients:
        logger.warning("it report: no eligible owner recipients")
        return {"error": "no_recipients", "sent": 0, "total": 0, "link": link}

    email_ready = email_svc.email_configured()
    sms_ready = sms.is_configured()
    results, email_ok, sms_ok, sms_total = [], 0, 0, 0
    for r in recipients:
        em_ok = None; sm_ok = None; msg = None
        if r["email"] and email_ready:
            try:
                res = email_svc.send_email(r["email"], subj, body_text, body_html, attachments=attachments)
                em_ok = bool(res.get("ok")); msg = res.get("message")
            except Exception as exc:  # noqa: BLE001 — one bad recipient must not abort the batch
                em_ok = False; msg = str(exc)
            if em_ok:
                email_ok += 1
        if r["phone"] and link and sms_ready:
            sms_total += 1
            try:
                sm_ok = bool(sms.send_sms(r["phone"], sms_body))
            except Exception as exc:  # noqa: BLE001
                sm_ok = False; msg = msg or str(exc)
            if sm_ok:
                sms_ok += 1
        results.append({"name": r["name"], "email": r["email"], "emailOk": em_ok,
                        "phone": r["phone"], "smsOk": sm_ok, "message": msg})
        logger.info("it report to=%s email=%s sms=%s", r["name"], em_ok, sm_ok)

    out = {"sent": email_ok, "total": len(recipients), "smsSent": sms_ok, "smsTotal": sms_total,
           "recipients": results, "link": link, "pdfBytes": len(pdf)}
    if not email_ready and not sms_ready:
        out["error"] = "no channel configured (email + SMS both off)"
    else:
        fails = []
        if email_ready and email_ok < len(recipients):
            fails.append(f"email {email_ok}/{len(recipients)}")
        if sms_total and sms_ok < sms_total:
            fails.append(f"sms {sms_ok}/{sms_total}")
        if fails:
            first_fail = next((x.get("message") for x in results if x.get("message")), "")
            out["error"] = ("; ".join(fails) + (f": {first_fail}" if first_fail else ""))[:400]
    return out
