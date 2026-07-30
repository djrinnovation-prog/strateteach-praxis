"""Owners Daily Report — branded bilingual PDF + HTML, from the real PM data.

This is the server-side renderer for the report Dan approved as a design sample. It
produces the SAME design (masthead + big launch-% hero + page-1 owners overview table
+ per-owner task detail, light-PEACH skin, no page cut-offs) from the live PM data:
``build_daily()`` for the aggregates + voting and ``list_pm_tasks(partner=pid)`` for
each owner's real task list.

  • render_html(data)  -> a full bilingual HTML string (used for BOTH the emailed PDF
                          and the owner-only web view; weasyprint-compatible markup).
  • render_pdf(data)   -> PDF bytes via WeasyPrint (pure-Python, container-friendly).
  • build_report_data()-> the real data dict (mockable via _sample_data() for tests).
  • owner_recipients() -> the OWNERS with an email on file, staff-eligible WITHOUT the
                          marketing consent opt-in (same rule as pm.compose_report).
  • send_daily_report()-> render once, email each owner the PDF attached + a link to
                          the HTML view; idempotent — one send per owner per IL day.

Design tokens = dashboard/src/theme.ts PEACH_LIGHT; logo = components/Shell.tsx.
"""
from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from statistics import mean

from app import database as db
from app.core import security
from app.services import email as email_svc
from app.services import sms as sms_svc
from app.services import telegram as tg_svc

logger = logging.getLogger("algo770")

# ── Brand tokens — PEACH_LIGHT (theme.ts) ────────────────────────────────────
BG, SURFACE, SURFACE2 = "#FDF1E8", "#FFFFFF", "#F9E3D4"
LINE, TEXT, MUTED, FAINT = "#EDC7B0", "#3A1D10", "#8B5942", "#BE9077"
GOLD, ACCENT, GOLDDIM = "#E5988A", "#CB6E54", "#FBE3D6"  # accent = coral/terracotta (presentation --gold)
GAIN, LOSS = "#0E9E63", "#DB3B49"
FAN = ["#F6DBC7", "#F2C4A9", "#EDA88F", "#E5988A"]
# The owners-presentation brand gradients (dashboard/public/owners-guide/index.html):
FAN_GRAD = "linear-gradient(135deg,#F6DBC7 0%,#EDA88F 52%,#E5988A 100%)"   # marks / bars / avatars
WORD_GRAD = "linear-gradient(135deg,#CB6E54 0%,#E5988A 55%,#D98A6E 100%)"  # brand wordmark
# UNIFORM page wash — soft radial glows on a solid peach base (NOT a patchy diagonal),
# exactly the presentation's body background so every page reads even/consistent.
PAGE_BG = ("radial-gradient(1100px 520px at 82% -8%, rgba(229,152,138,0.18), transparent 60%),"
           "radial-gradient(900px 480px at 8% 6%, rgba(246,219,199,0.38), transparent 55%),"
           f"{BG}")

STATUS = {
    "blocked":     {"he": "חסום",       "en": "Blocked",     "c": LOSS},
    "in_progress": {"he": "בתהליך",     "en": "In progress", "c": ACCENT},
    "near_done":   {"he": "קרוב לסיום", "en": "Near done",   "c": GOLD},
    "done":        {"he": "הושלם",      "en": "Done",        "c": GAIN},
    "todo":        {"he": "לביצוע",     "en": "To do",       "c": FAINT},
}
ORDER = ["blocked", "in_progress", "near_done", "done", "todo"]

try:
    from zoneinfo import ZoneInfo
    _IL = ZoneInfo("Asia/Jerusalem")
except Exception:  # noqa: BLE001
    _IL = timezone(timedelta(hours=3))


def _esc(s) -> str:
    import html as _h
    return _h.escape(str(s if s is not None else ""))


def _bucket(tk: dict) -> str:
    if tk.get("status") == "in_progress" and int(tk.get("progress") or 0) >= 70:
        return "near_done"
    return tk.get("status") or "todo"


# ── data ─────────────────────────────────────────────────────────────────────

def build_report_data() -> dict:
    """Assemble the report payload from the LIVE PM data (build_daily + pm_tasks)."""
    from app.api.routes.pm import build_daily, _PM_NAME, _PM_ROLE  # lazy: avoid import cycle
    daily = build_daily()
    owners = []
    for pid in db.PM_PARTNERS:
        role = _PM_ROLE.get(pid, ("", ""))
        owners.append({
            "pid": pid, "name": _PM_NAME.get(pid, pid), "roleHe": role[0], "roleEn": role[1],
            "tasks": db.list_pm_tasks(partner=pid),
        })
    all_tasks = [t for o in owners for t in o["tasks"]]
    counts = {k: sum(1 for t in all_tasks if _bucket(t) == k) for k in ORDER}
    # Attach the latest OWNER comments to each task so the per-owner detail can surface the
    # owners' direction/feedback (Dan's "הערות בעלים על משימות תציג הדוח היומי"). Owner-authored
    # only (is_owner), most-recent last; bulk-loaded in one query.
    from app.core import security as _sec
    cmts = db.comments_by_task([int(t["id"]) for t in all_tasks if t.get("id")])
    for t in all_tasks:
        rows = cmts.get(int(t["id"]), []) if t.get("id") else []
        owner_rows = [c for c in rows if _sec.is_owner(c.get("author") or "")]
        t["ownerComments"] = owner_rows[-2:]  # the latest two owner comments
    vp = daily.get("votingPulse", {}) or {}
    return {
        "dateHe": daily.get("dateHe", ""), "dateEn": daily.get("dateEn", ""),
        "overall": int(daily.get("overall") or 0), "total": len(all_tasks), "counts": counts,
        "voting": {"settled": len(vp.get("decisions", [])), "contested": len(vp.get("contested", []))},
        "owners": owners,
    }


def _sample_data() -> dict:
    """Representative mock (same shape) — for container render tests without a DB."""
    T = lambda he, en, s, p, ph, due=None: {"titleHe": he, "titleEn": en, "status": s, "progress": p, "phase": ph, "due": due}
    owners = [
        {"pid": "dan", "name": "Dan", "roleHe": "בעלים ומנהל", "roleEn": "Owner & Admin", "tasks": [
            T("השקת גרסת ה-Beta הציבורית", "Ship the public Beta", "in_progress", 65, "P0", "12/7"),
            T("אישור מבנה תמחור סופי", "Finalize pricing tiers", "blocked", 30, "P0"),
            T("סקירת אבטחה לפני השקה", "Pre-launch security review", "in_progress", 82, "P1"),
            T("גיוס 50 משתמשי ביתא", "Recruit 50 beta users", "todo", 5, "P1")]},
        {"pid": "rafi", "name": "Rafi", "roleHe": "משקיע ובעלים", "roleEn": "Investor & Owner", "tasks": [
            T("סגירת סבב הגיוס (Seed)", "Close the Seed round", "in_progress", 70, "P0", "31/7"),
            T("עדכון Deck למשקיעים", "Update investor deck", "done", 100, "P1"),
            T("מודל פיננסי 2026", "2026 financial model", "in_progress", 45, "P1")]},
        {"pid": "yoav", "name": "Yoav", "roleHe": "בעלים וראש קריאייטיב", "roleEn": "Owner & Head of Creative", "tasks": [
            T("נכסי מיתוג להשקה", "Brand & launch assets", "in_progress", 60, "P0"),
            T("וידאו הדגמה למוצר", "Product demo video", "blocked", 25, "P1"),
            T("עמוד נחיתה חדש", "New landing page", "in_progress", 78, "P1"),
            T("קמפיין רשתות חברתיות", "Social launch campaign", "todo", 0, "P2")]},
        {"pid": "oren", "name": "Oren", "roleHe": "מפתח ראשי", "roleEn": "Lead Developer", "tasks": [
            T("יציבות פרודקשן ותשתיות", "Production stability & infra", "in_progress", 55, "P0"),
            T("אינטגרציית תשלומים (Stripe)", "Payments integration (Stripe)", "blocked", 40, "P0", "10/7"),
            T("צנרת CI/CD", "CI/CD pipeline", "done", 100, "P1"),
            T("אופטימיזציית ביצועי API", "API performance tuning", "in_progress", 72, "P1"),
            T("ניטור והתראות", "Monitoring & alerts", "todo", 15, "P2")]},
        {"pid": "raz", "name": "Raz", "roleHe": "יועצת משפטית", "roleEn": "Legal Counsel", "tasks": [
            T("תנאי שימוש ומדיניות פרטיות", "Terms & privacy policy", "in_progress", 85, "P0"),
            T("בדיקת רגולציה (רשות ני״ע)", "Compliance review (securities)", "blocked", 20, "P1")]},
    ]
    all_tasks = [t for o in owners for t in o["tasks"]]
    counts = {k: sum(1 for t in all_tasks if _bucket(t) == k) for k in ORDER}
    return {"dateHe": "5/7/2026", "dateEn": "5 Jul 2026",
            "overall": round(mean(t["progress"] for t in all_tasks)), "total": len(all_tasks),
            "counts": counts, "voting": {"settled": 6, "contested": 2}, "owners": owners}


# ── HTML fragments (weasyprint-safe: tables + blocks, minimal flex) ──────────

def _mark(px: int = 44) -> str:
    """The presentation's brand mark: a peach-fan rounded square + an ink diamond."""
    d = int(px * 0.36)
    return (
        f'<span style="display:inline-block;width:{px}px;height:{px}px;border-radius:{int(px*0.3)}px;'
        f'background:{FAN_GRAD};text-align:center;line-height:{px}px;vertical-align:middle">'
        f'<svg width="{d}" height="{d}" viewBox="0 0 24 24" fill="{TEXT}" style="vertical-align:middle">'
        f'<rect x="5" y="5" width="14" height="14" rx="3" transform="rotate(45 12 12)"/></svg></span>'
    )


def _pbar(pct: int, color: str = ACCENT, h: int = 8) -> str:
    pct = max(2, min(100, int(pct)))
    return (
        f'<span style="display:block;height:{h}px;border-radius:99px;background:{GOLDDIM};overflow:hidden">'
        f'<span style="display:block;height:100%;width:{pct}%;border-radius:99px;'
        f'background:{FAN_GRAD}"></span></span>'
    )


def _ring(pct: int, size: int = 128) -> str:
    import math
    r = size / 2 - 11
    circ = 2 * math.pi * r
    dash = circ * max(0, min(100, pct)) / 100
    cx = size / 2
    return (
        f'<span style="position:relative;display:inline-block;width:{size}px;height:{size}px">'
        f'<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
        f'<defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{FAN[1]}"/><stop offset="1" stop-color="{ACCENT}"/></linearGradient></defs>'
        f'<circle cx="{cx}" cy="{cx}" r="{r}" fill="none" stroke="{GOLDDIM}" stroke-width="13"/>'
        f'<circle cx="{cx}" cy="{cx}" r="{r}" fill="none" stroke="url(#rg)" stroke-width="13" stroke-linecap="round" '
        f'stroke-dasharray="{dash:.1f} {circ:.1f}" transform="rotate(-90 {cx} {cx})"/></svg>'
        f'<span style="position:absolute;top:0;left:0;width:{size}px;height:{size}px;line-height:{size}px;'
        f'text-align:center;font-size:29px;font-weight:900;color:{TEXT}">{pct}%</span></span>'
    )


def _status_pill(k: str, he: bool) -> str:
    s = STATUS[k]
    return (
        f'<span style="display:inline-block;padding:3px 11px;border-radius:99px;font-size:10px;font-weight:800;'
        f'color:{s["c"]};background:{s["c"]}16">{s["he"] if he else s["en"]}</span>'
    )


def _avatar(letter: str, px: int = 34) -> str:
    return (
        f'<span style="display:inline-block;width:{px}px;height:{px}px;border-radius:{int(px*0.3)}px;'
        f'background:{FAN_GRAD};color:{TEXT};font-weight:900;font-size:{int(px*0.44)}px;'
        f'text-align:center;line-height:{px}px;vertical-align:middle">{letter}</span>'
    )


def _sec_title(he: bool, num: str, he_lbl: str, en_lbl: str) -> str:
    """Frameless section header — the presentation's fan bar + number + title (no box)."""
    a = "right" if he else "left"
    return (
        f'<div style="display:flex;align-items:center;gap:11px;margin:26px 0 14px;text-align:{a}">'
        f'<span style="width:5px;height:24px;border-radius:3px;background:{FAN_GRAD};flex:0 0 auto"></span>'
        f'<span style="font-family:ui-monospace,Menlo,monospace;font-size:12px;font-weight:800;color:{ACCENT}">{num}</span>'
        f'<span style="font-size:17px;font-weight:900;color:{TEXT}">{he_lbl if he else en_lbl}</span></div>'
    )


def _hero(d: dict, he: bool) -> str:
    """Full-bleed brand hero: big striking 'strateteach', report subtitle + date, then the
    warm morning greeting — the presentation's centered hero band (no card frame)."""
    date = d["dateHe"] if he else d["dateEn"]
    kicker = "דוח יומי לבעלים" if he else "Owners Daily Report"
    sub = (f"סקירת בוקר · {date}" if he else f"Morning scan · {date}")
    heart = f'<span style="color:{ACCENT}">♥</span>'  # U+2665 (in Noto/DejaVu) — no color-emoji tofu
    greet = ("בוקר טוב לכל הצוות ותודה על כל העבודה הקשה. "
             f"אוהבים אתכם {heart} strateteach"
             if he else
             "Good morning, team — thank you for all your hard work. "
             f"We love you {heart} strateteach")
    lang = "עברית" if he else "English"
    return (
        f'<div style="background:linear-gradient(165deg,#FFFFFF 0%,{BG} 52%,{SURFACE2} 100%);'
        f'border-bottom:1px solid rgba(203,110,84,0.20);padding:30px 34px 26px;text-align:center">'
        f'<div style="margin-bottom:14px">{_mark(46)}'
        f'<span style="display:inline-block;vertical-align:middle;margin:0 10px;font-size:11px;font-weight:800;'
        f'letter-spacing:.16em;color:{ACCENT}">{lang}</span></div>'
        f'<div style="font-size:11px;font-weight:800;letter-spacing:.3em;text-transform:uppercase;color:{ACCENT}">{kicker}</div>'
        f'<div style="font-size:56px;font-weight:900;letter-spacing:.01em;color:{ACCENT};line-height:1.02;margin:6px 0 4px">strateteach</div>'
        f'<div style="font-size:14px;font-weight:700;color:{MUTED}">{sub}</div>'
        f'<div style="max-width:600px;margin:16px auto 0;font-size:13.5px;font-weight:600;color:{TEXT};line-height:1.65;word-wrap:break-word">{greet}</div>'
        f'</div>'
    )


def _launch(d: dict, he: bool) -> str:
    """Big prominent launch-% — frameless, centered, right under the hero."""
    label = "התקדמות לקראת השקה" if he else "Progress to launch"
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
        f'{_pbar(d["overall"], ACCENT, 12)}<div style="margin-top:13px">{mini}</div></td>'
    )
    ring = f'<td style="vertical-align:middle;text-align:{z};width:150px">{_ring(d["overall"])}</td>'
    cells = (ring + txt) if he else (txt + ring)
    return (
        f'<div style="page-break-inside:avoid;padding:22px 4px 6px">'
        f'<table style="width:100%;border-collapse:collapse"><tr>{cells}</tr></table></div>'
    )


def _owner_stats(o: dict) -> dict:
    lst = o["tasks"]
    return {"open": sum(1 for t in lst if t.get("status") != "done"), "total": len(lst),
            "workload": round(mean(int(t.get("progress") or 0) for t in lst)) if lst else 0,
            "blocked": sum(1 for t in lst if t.get("status") == "blocked")}


def _overview_table(d: dict, he: bool) -> str:
    """Frameless owners overview — hairline header + rows, NO box border."""
    cols = ("בעלים", "תפקיד", "משימות פתוחות", "עומס עבודה") if he else ("Owner", "Role", "Open tasks", "Workload")
    a = "right" if he else "left"
    z = "left" if he else "right"
    th = f'font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:{FAINT};padding:0 4px 10px;border-bottom:1px solid {LINE}'
    rows = ""
    for i, o in enumerate(d["owners"]):
        st = _owner_stats(o)
        name = _esc(o["name"]); role = _esc(o["roleHe"] if he else o["roleEn"])
        blk = (f'<span style="font-size:9px;font-weight:800;color:{LOSS};background:{LOSS}14;border-radius:6px;'
               f'padding:1px 6px;margin:0 6px">{st["blocked"]} {"חסום" if he else "blocked"}</span>') if st["blocked"] else ""
        bb = "" if i == len(d["owners"]) - 1 else f"border-bottom:1px solid {LINE}66"
        load = (f'<table style="width:150px;border-collapse:collapse"><tr>'
                f'<td style="padding:0 6px 0 0;width:108px">{_pbar(st["workload"], ACCENT, 7)}</td>'
                f'<td style="font-size:12px;font-weight:800;color:{TEXT};white-space:nowrap">{st["workload"]}%</td></tr></table>')
        rows += (
            f'<tr>'
            f'<td style="padding:12px 4px;text-align:{a};{bb}">{_avatar(name[0], 30)}'
            f'<b style="font-size:14px;font-weight:900;color:{TEXT};margin:0 9px;vertical-align:middle">{name}</b></td>'
            f'<td style="padding:12px 4px;text-align:{a};font-size:12px;font-weight:800;color:{ACCENT};{bb}">{role}</td>'
            f'<td style="padding:12px 4px;text-align:center;white-space:nowrap;{bb}">'
            f'<b style="font-size:19px;font-weight:900;color:{ACCENT}">{st["open"]}</b>'
            f'<span style="font-size:11px;color:{FAINT};font-weight:700"> / {st["total"]}</span>{blk}</td>'
            f'<td style="padding:12px 4px;text-align:{z};{bb}">{load}</td></tr>'
        )
    return (
        f'<div style="page-break-inside:avoid">'
        f'<table style="width:100%;border-collapse:collapse">'
        f'<tr><th style="{th};text-align:{a}">{cols[0]}</th><th style="{th};text-align:{a}">{cols[1]}</th>'
        f'<th style="{th};text-align:center">{cols[2]}</th><th style="{th};text-align:{z}">{cols[3]}</th></tr>'
        f'{rows}</table></div>'
    )


def _status_strip(d: dict, he: bool) -> str:
    """Compact frameless status counts + voting — hairline top, no box."""
    a = "right" if he else "left"
    cells = ""
    for i, k in enumerate(ORDER):
        br = "" if i == len(ORDER) - 1 else f"border-right:1px solid {LINE}66"
        cells += (
            f'<td style="text-align:center;padding:2px 4px;{br}">'
            f'<div style="font-size:19px;font-weight:900;color:{STATUS[k]["c"]}">{d["counts"][k]}</div>'
            f'<div style="font-size:10px;font-weight:700;color:{MUTED}">{STATUS[k]["he"] if he else STATUS[k]["en"]}</div></td>'
        )
    tt = "סטטוס משימות" if he else "Task status"
    vt = "הצבעות" if he else "Voting"
    settled, contested = ("הוכרעו", "במחלוקת") if he else ("settled", "contested")
    return (
        f'<div style="page-break-inside:avoid;margin-top:16px;padding-top:14px;border-top:1px solid {LINE}">'
        f'<table style="width:100%;border-collapse:collapse"><tr>'
        f'<td style="vertical-align:top;width:64%">'
        f'<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:{FAINT};margin-bottom:9px;text-align:{a}">{tt} · {d["total"]}</div>'
        f'<table style="width:100%;border-collapse:collapse"><tr>{cells}</tr></table></td>'
        f'<td style="vertical-align:top;text-align:{a};padding-inline-start:24px">'
        f'<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:{FAINT};margin-bottom:9px">{vt}</div>'
        f'<span style="font-size:19px;font-weight:900;color:{GAIN}">{d["voting"]["settled"]}</span> '
        f'<span style="font-size:10px;font-weight:700;color:{MUTED}">{settled}</span>'
        f'<span style="display:inline-block;width:16px"></span>'
        f'<span style="font-size:19px;font-weight:900;color:{ACCENT}">{d["voting"]["contested"]}</span> '
        f'<span style="font-size:10px;font-weight:700;color:{MUTED}">{contested}</span></td>'
        f'</tr></table></div>'
    )


def _task_rows(o: dict, he: bool) -> str:
    a = "right" if he else "left"
    z = "left" if he else "right"
    out = ""
    lst = o["tasks"]
    for i, tk in enumerate(lst):
        b = _bucket(tk)
        # Cross-language fallback: a task entered in only ONE language (newer tasks) would
        # otherwise render a BLANK row in the other language's report. Mirror the UI's
        # `titleHe || titleEn` so the subject always shows.
        title = _esc((tk.get("titleHe") or tk.get("titleEn")) if he else (tk.get("titleEn") or tk.get("titleHe")))
        phase = _esc(tk.get("phase") or "")
        due = tk.get("due")
        bb = "" if i == len(lst) - 1 else f"border-bottom:1px solid {LINE}55"
        tags = ""
        if phase:
            tags += (f'<span style="font-size:9px;font-weight:800;color:{FAINT};background:{GOLDDIM}88;'
                     f'border-radius:6px;padding:1px 6px;margin:0 3px">{phase}</span>')
        if due:
            tags += (f'<span style="font-size:9px;font-weight:800;color:{ACCENT};background:{GOLDDIM};'
                     f'border-radius:6px;padding:1px 6px;margin:0 3px">{("עד " if he else "due ")}{_esc(due)}</span>')
        pct = int(tk.get("progress") or 0)
        # An owner comment on this task carries to the next row so its border isn't drawn between
        # the task and its comment line.
        oc = tk.get("ownerComments") or []
        row_bb = "" if oc else bb
        out += (
            f'<tr>'
            f'<td style="padding:9px 4px;{row_bb};text-align:{a};width:92px">{_status_pill(b, he)}</td>'
            f'<td style="padding:9px 4px;{row_bb};text-align:{a};font-size:12.5px;font-weight:700;color:{TEXT}">{title}</td>'
            f'<td style="padding:9px 4px;{row_bb};text-align:{z};white-space:nowrap">{tags}</td>'
            f'<td style="padding:9px 4px;{row_bb};width:92px">{_pbar(pct, STATUS[b]["c"], 6)}</td>'
            f'<td style="padding:9px 4px;{row_bb};text-align:{z};font-size:11.5px;font-weight:800;color:{MUTED};width:38px">{pct}%</td>'
            f'</tr>'
        )
        out += _owner_comment_row(oc, he, a, bb)
    return out


def _owner_comment_row(comments: "list[dict]", he: bool, a: str, bb: str) -> str:
    """A sub-row under a task showing the latest owner comment(s) — the owners' direction on it.
    Rendered only when an owner has commented; spans the full task row width."""
    if not comments:
        return ""
    lbl = "הערת בעלים" if he else "Owner note"
    items = ""
    for c in comments:
        who = _esc(c.get("author_name") or c.get("author") or "")
        txt = _esc(c.get("text") or "")
        when = _esc(str(c.get("created_at") or "")[:16].replace("T", " "))
        items += (
            f'<div style="margin-top:3px">'
            f'<span style="font-size:9.5px;font-weight:800;color:{ACCENT};background:{GOLDDIM}66;border-radius:6px;padding:1px 6px">{lbl}</span> '
            f'<span style="font-size:11px;font-weight:800;color:{TEXT}">{who}</span> '
            f'<span style="font-size:10px;color:{FAINT}">{when}</span>'
            f'<div style="font-size:11.5px;color:{MUTED};line-height:1.5;margin-top:1px">{txt}</div>'
            f'</div>'
        )
    return (
        f'<tr><td colspan="5" style="padding:0 4px 9px;{bb};text-align:{a}">{items}</td></tr>'
    )


def _owner_block(o: dict, he: bool) -> str:
    """Frameless per-owner detail — presentation .partner look (avatar + name + role in gold,
    hairline divider, task rows). NO card border/box."""
    st = _owner_stats(o)
    name = _esc(o["name"]); role = _esc(o["roleHe"] if he else o["roleEn"])
    a = "right" if he else "left"
    z = "left" if he else "right"
    open_lbl, load_lbl = ("פתוחות", "עומס") if he else ("open", "load")
    total_lbl = (f'{st["total"]} משימות' if he else f'{st["total"]} tasks')
    head = (
        f'<table style="width:100%;border-collapse:collapse;border-bottom:1px solid {LINE};margin-bottom:2px"><tr>'
        f'<td style="text-align:{a};vertical-align:middle;padding-bottom:11px">{_avatar(name[0], 40)}'
        f'<span style="display:inline-block;vertical-align:middle;margin:0 12px">'
        f'<span style="display:block;font-size:17px;font-weight:900;color:{TEXT}">{name}</span>'
        f'<span style="display:block;font-size:11.5px;font-weight:800;color:{ACCENT}">{role} · {total_lbl}</span></span></td>'
        f'<td style="text-align:{z};vertical-align:middle;padding-bottom:11px;white-space:nowrap">'
        f'<span style="font-size:20px;font-weight:900;color:{ACCENT}">{st["open"]}</span>'
        f'<span style="font-size:9px;font-weight:700;color:{MUTED}"> {open_lbl}</span>'
        f'<span style="display:inline-block;width:100px;vertical-align:middle;margin:0 10px">'
        f'<span style="display:block;font-size:9px;font-weight:800;color:{MUTED};text-align:{a}">{load_lbl} {st["workload"]}%</span>'
        f'{_pbar(st["workload"], ACCENT, 6)}</span></td></tr></table>'
    )
    return (
        f'<div style="page-break-inside:avoid;margin-bottom:20px">{head}'
        f'<table style="width:100%;border-collapse:collapse">{_task_rows(o, he)}</table></div>'
    )


def _foot(he: bool) -> str:
    return (f'<div style="margin-top:20px;padding-top:14px;border-top:1px solid {LINE};text-align:center;'
            f'font-size:11px;color:{FAINT};line-height:1.7">strateteach · '
            f'{"דוח בעלים יומי — נוצר אוטומטית מהמערכת" if he else "Owners Daily Report — auto-generated by the system"}</div>')


def _lang_block(d: dict, he: bool, first: bool) -> str:
    dir_attr = "rtl" if he else "ltr"
    a = "right" if he else "left"
    detail_title_he, detail_title_en = "פירוט משימות לכל בעלים", "Per-owner task detail"
    overview_he, overview_en = "סקירת בעלים", "Owners overview"
    brk = "" if first else "page-break-before:always;"
    overview = (
        f'<section dir="{dir_attr}" style="{brk}">{_hero(d, he)}'
        f'<div style="padding:0 34px 20px">{_launch(d, he)}'
        f'{_sec_title(he, "01", overview_he, overview_en)}{_overview_table(d, he)}{_status_strip(d, he)}</div></section>'
    )
    cards = "".join(_owner_block(o, he) for o in d["owners"])
    detail = (
        f'<section dir="{dir_attr}" style="page-break-before:always"><div style="padding:34px 34px 24px">'
        f'{_sec_title(he, "02", detail_title_he, detail_title_en)}{cards}{_foot(he)}</div></section>'
    )
    return overview + detail


def render_html(d: dict) -> str:
    """Full bilingual report HTML — presentation-matched, frameless, uniform wash.
    weasyprint-safe; also the web-view body."""
    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<title>strateteach · Owners Daily Report</title><style>'
        '@page{size:A4;margin:0}'
        '*{margin:0;padding:0;box-sizing:border-box}'
        f'html{{background:{PAGE_BG};'
        'font-family:"Rubik","Noto Sans Hebrew","Noto Sans","DejaVu Sans",system-ui,-apple-system,"Arial Hebrew",Arial,sans-serif}'
        f'body{{color:{TEXT}}}'
        '@media screen{body{max-width:860px;margin:0 auto}}'
        '</style></head><body>'
        + _lang_block(d, he=True, first=True) + _lang_block(d, he=False, first=False)
        + '</body></html>'
    )


def render_pdf(d: dict) -> bytes:
    """Render the report to PDF bytes via WeasyPrint."""
    from weasyprint import HTML  # imported lazily so the app boots even if the dep is absent
    return HTML(string=render_html(d)).write_pdf()


# ── recipients (owners with an email; staff bypass consent — same as pm.compose_report) ─

def _is_staff(acct: str | None) -> bool:
    if not acct:
        return False
    if security.is_owner(acct) or db.is_legal_editor(acct):
        return True
    return (db.get_user(acct) or {}).get("role") == "admin"


def owner_recipients() -> list[dict]:
    """OWNERS (PM partners) with an email on file, eligible for the email channel WITHOUT
    the marketing consent opt-in — the internal business team. Never end-users."""
    from app.api.routes.pm import _PM_NAME  # lazy
    out, seen = [], set()
    for pid in db.PM_PARTNERS:
        acct = db.account_for_partner(pid)
        if not acct:
            continue
        prefs = db.get_notif_prefs(acct)
        email = (prefs.get("emailTo") or "").strip()
        if not email or email.lower() in seen:
            continue
        allowed = bool(prefs.get("email")) or _is_staff(acct)   # staff bypass consent
        if not allowed:
            continue
        seen.add(email.lower())
        out.append({"pid": pid, "name": _PM_NAME.get(pid, pid), "account": acct, "email": email})
    return out


def owner_sms_recipients() -> list[dict]:
    """OWNERS (PM partners) with a PHONE on file, eligible for SMS WITHOUT the marketing
    consent opt-in (staff bypass) — same phone-eligibility rule as the owners team report.
    SMS can't carry the PDF, so these owners get the tokenized report link by text."""
    from app.api.routes.pm import _PM_NAME  # lazy
    out, seen = [], set()
    for pid in db.PM_PARTNERS:
        acct = db.account_for_partner(pid)
        if not acct:
            continue
        prefs = db.get_notif_prefs(acct)
        phone = (prefs.get("phone") or "").strip()
        if not phone or phone in seen:
            continue
        allowed = bool(prefs.get("sms")) or _is_staff(acct)   # staff bypass consent
        if not allowed:
            continue
        seen.add(phone)
        out.append({"pid": pid, "name": _PM_NAME.get(pid, pid), "account": acct, "phone": phone})
    return out


def owner_telegram_recipients() -> list[dict]:
    """OWNERS with a personal Telegram connection (enabled + bot token + chat id), via the
    app's existing per-user Telegram integration. They get the PDF as a Telegram document
    with the report link in the caption."""
    from app.api.routes.pm import _PM_NAME  # lazy
    out, seen = [], set()
    for pid in db.PM_PARTNERS:
        acct = db.account_for_partner(pid)
        if not acct or acct in seen:
            continue
        c = db.get_user_telegram(acct) or {}
        if not (c.get("enabled") and c.get("botToken") and c.get("chatId")):
            continue
        seen.add(acct)
        out.append({"pid": pid, "name": _PM_NAME.get(pid, pid), "account": acct,
                    "botToken": c["botToken"], "chatId": c["chatId"]})
    return out


# ── HTML web-view auth token (device-independent email link; DB-backed, no new table) ─

def mint_report_token(ttl_days: int = 14) -> str:
    tok = secrets.token_urlsafe(24)
    exp = (datetime.now(timezone.utc) + timedelta(days=ttl_days)).isoformat()
    db._set_singleton(f"reportview:{tok}", exp)
    return tok


def check_report_token(tok: str | None) -> bool:
    if not tok:
        return False
    exp = db._get_singleton(f"reportview:{tok}", None)
    if not exp:
        return False
    try:
        return datetime.fromisoformat(str(exp)) > datetime.now(timezone.utc)
    except Exception:  # noqa: BLE001
        return False


def _report_link(token: str | None) -> str | None:
    base = (os.environ.get("PUBLIC_BASE_URL") or os.environ.get("OWNERS_REPORT_BASE_URL") or "").rstrip("/")
    if not base:
        return None
    return f"{base}/auth/pm/report.html" + (f"?t={token}" if token else "")


# ── email send (PDF attached + HTML link), idempotent one/owner/day ──────────

def _email_bodies(d: dict, link: str | None) -> tuple[str, str, str]:
    subj = f"דוח בעלים יומי · Owners Daily Report — {d.get('dateEn') or ''}"
    link_html = (f'<p style="margin:18px 0"><a href="{link}" '
                 f'style="display:inline-block;background:{ACCENT};color:#fff;text-decoration:none;'
                 f'font-weight:800;padding:11px 20px;border-radius:10px">צפייה בדוח (HTML) · View report</a></p>'
                 f'<p style="font-size:12px;color:#8B5942">{link}</p>') if link else ""
    html = (
        f'<div style="font-family:Arial,sans-serif;color:{TEXT};max-width:560px">'
        f'<p style="font-weight:800;font-size:16px">בוקר טוב 👋 · Good morning</p>'
        f'<p>מצורף דוח הבעלים היומי כ-PDF. התקדמות לקראת השקה: <b>{d["overall"]}%</b>.</p>'
        f'<p>The daily owners report is attached as a PDF. Progress to launch: <b>{d["overall"]}%</b>.</p>'
        f'{link_html}'
        f'<p style="font-size:12px;color:#8B5942">ALGO770 · STRATETEACH</p></div>'
    )
    text = (f"בוקר טוב — דוח הבעלים היומי מצורף כ-PDF. התקדמות לקראת השקה: {d['overall']}%.\n"
            f"Good morning — the daily owners report is attached as a PDF. Progress to launch: {d['overall']}%.")
    if link:
        text += f"\n\nצפייה בדוח (HTML) · View report:\n{link}"
    return subj, html, text


def _sms_body(link: str) -> str:
    """Short SMS — the tokenized report link IS the payload (SMS can't attach the PDF).
    The link opens the report page WITHOUT login (same token as the email link)."""
    return f"Strateteach — דוח בעלים יומי:\n{link}"


def _tg_caption(d: dict, link: str | None) -> str:
    """Caption for the Telegram PDF document — a short bilingual line + the report link
    (Telegram carries the PDF itself as the document, so this is the message body)."""
    cap = (f"Strateteach — דוח בעלים יומי · Owners Daily Report\n"
           f"התקדמות לקראת השקה · Progress to launch: {d.get('overall', 0)}%")
    if link:
        cap += f"\n\nצפייה בדוח · View report:\n{link}"
    return cap


def send_daily_report(*, force: bool = False, actor: str | None = None) -> dict:
    """Render once, then deliver to each owner over EVERY channel they have on file:
    EMAIL (the branded PDF attached + the HTML link), SMS (the tokenized report link, since
    SMS can't carry the PDF), and TELEGRAM (the PDF as a document, caption carries the link).
    Idempotent per IL day unless ``force`` (manual trigger): one delivery per owner per
    channel per day. Per-recipient results on every channel are surfaced, not swallowed."""
    today_il = datetime.now(_IL).date().isoformat()
    if not force and db._get_singleton("owners_report_email_last", None) == today_il:
        return {"skipped": "already_sent_today", "date": today_il}

    email_ready = email_svc.email_configured()
    sms_ready = sms_svc.is_configured()
    tg_recipients = owner_telegram_recipients()  # per-user Telegram (each owner links their own bot)
    if not email_ready and not sms_ready and not tg_recipients:
        logger.warning("owners daily report: no channel available (email/SMS/Telegram) — skipping")
        return {"error": "no_channel_configured", "sent": 0, "total": 0,
                "smsSent": 0, "smsTotal": 0, "tgSent": 0, "tgTotal": 0}

    # Build data + render the PDF (same WeasyPrint path verified in-container). Any failure
    # here is SURFACED (never a silent success) so the button / logs show the real reason.
    try:
        data = build_report_data()
        pdf = render_pdf(data)
    except Exception as exc:  # noqa: BLE001
        logger.warning("owners daily report: render failed: %s", exc)
        return {"error": f"render_failed: {exc}", "sent": 0, "total": 0, "smsSent": 0, "smsTotal": 0}

    token = mint_report_token()
    link = _report_link(token)  # tokenized report.html URL — opens without login (all channels)
    fname = f"owners-report-{data.get('dateEn','').replace(' ', '-') or today_il}.pdf"

    # ── EMAIL: PDF attached + link ──
    results: list[dict] = []
    if email_ready:
        subj, body_html, body_text = _email_bodies(data, link)
        attachments = [{"filename": fname, "content_bytes": pdf, "type": "application/pdf"}]
        for r in owner_recipients():
            try:
                res = email_svc.send_email(r["email"], subj, body_text, body_html, attachments=attachments)
                ok = bool(res.get("ok"))
                results.append({"name": r["name"], "email": r["email"], "ok": ok, "message": res.get("message")})
                logger.info("owners report email to=%s ok=%s msg=%s", r["email"], ok, res.get("message"))
            except Exception as exc:  # noqa: BLE001 — one bad recipient must not abort the batch
                results.append({"name": r["name"], "email": r["email"], "ok": False, "message": str(exc)})
                logger.warning("owners report email to=%s raised: %s", r["email"], exc)

    # ── SMS: the tokenized report link (no PDF over SMS). Needs a public link. ──
    sms_results: list[dict] = []
    if sms_ready and link:
        sms_text = _sms_body(link)
        for r in owner_sms_recipients():
            try:
                ok = bool(sms_svc.send_sms(r["phone"], sms_text))
                sms_results.append({"name": r["name"], "phone": r["phone"], "ok": ok,
                                    "message": "queued" if ok else "not queued (SMS unconfigured or no number)"})
                logger.info("owners report SMS to=%s queued=%s", r["phone"], ok)
            except Exception as exc:  # noqa: BLE001
                sms_results.append({"name": r["name"], "phone": r["phone"], "ok": False, "message": str(exc)})
                logger.warning("owners report SMS to=%s raised: %s", r["phone"], exc)

    # ── TELEGRAM: the PDF as a document; the caption carries the report link. Per-user
    # connection (each owner links their own bot) — unconnected owners are simply skipped. ──
    tg_results: list[dict] = []
    if tg_recipients:
        cap = _tg_caption(data, link)
        for r in tg_recipients:
            try:
                res = tg_svc.send_document_sync(r["botToken"], r["chatId"], fname, pdf, cap, "application/pdf")
                ok = bool(res.get("ok"))
                tg_results.append({"name": r["name"], "account": r["account"], "ok": ok, "message": res.get("message")})
                logger.info("owners report telegram to=%s ok=%s msg=%s", r["account"], ok, res.get("message"))
            except Exception as exc:  # noqa: BLE001 — one bad recipient must not abort the batch
                tg_results.append({"name": r["name"], "account": r["account"], "ok": False, "message": str(exc)})
                logger.warning("owners report telegram to=%s raised: %s", r["account"], exc)

    sent = sum(1 for x in results if x["ok"])
    sms_sent = sum(1 for x in sms_results if x["ok"])
    tg_sent = sum(1 for x in tg_results if x["ok"])
    # Idempotent: stamp the day only after at least one real delivery on ANY channel.
    if (sent or sms_sent or tg_sent) and not force:
        db._set_singleton("owners_report_email_last", today_il)

    out = {"date": today_il, "sent": sent, "total": len(results), "recipients": results,
           "smsSent": sms_sent, "smsTotal": len(sms_results), "smsRecipients": sms_results,
           "tgSent": tg_sent, "tgTotal": len(tg_results), "tgRecipients": tg_results,
           "link": link, "pdfBytes": len(pdf)}
    # SURFACE failures on any channel (partial/total) — a rejected send never looks OK.
    errs = []
    if not results and not sms_results and not tg_results:
        errs.append("no_recipients")  # nobody has an email, phone, OR Telegram on file
    if results and sent < len(results):
        f = next((x.get("message") for x in results if not x["ok"] and x.get("message")), "send failed")
        errs.append(f"email {len(results) - sent}/{len(results)} failed: {f}")
    if sms_ready and not link:
        errs.append("SMS skipped: no PUBLIC_BASE_URL for the report link")
    if sms_results and sms_sent < len(sms_results):
        f = next((x.get("message") for x in sms_results if not x["ok"] and x.get("message")), "sms failed")
        errs.append(f"sms {len(sms_results) - sms_sent}/{len(sms_results)} failed: {f}")
    if tg_results and tg_sent < len(tg_results):
        f = next((x.get("message") for x in tg_results if not x["ok"] and x.get("message")), "telegram failed")
        errs.append(f"telegram {len(tg_results) - tg_sent}/{len(tg_results)} failed: {f}")
    if errs:
        out["error"] = " · ".join(errs)[:400]
    return out


# Feature flag key for the DAILY 09:00 auto-send. Stored as a DB singleton so it can be
# flipped LIVE (no redeploy) once Dan approves — default OFF (absent = disabled).
_AUTOSEND_FLAG = "owners_report_auto_enabled"


def autosend_enabled() -> bool:
    """Whether the DAILY 09:00 auto-send may fire. OFF by DEFAULT until Dan approves the
    final design. Enabled if EITHER the DB flag ``owners_report_auto_enabled`` is truthy
    (flip live via set_autosend / the owner toggle) OR the env var OWNERS_REPORT_AUTOSEND
    is set. The manual 'send now' test (send_daily_report(force=True)) is NEVER gated."""
    try:
        if str(db._get_singleton(_AUTOSEND_FLAG, "")).strip().lower() in ("1", "true", "yes", "on"):
            return True
    except Exception:  # noqa: BLE001 — a DB hiccup must never accidentally ENABLE sending
        pass
    return (os.environ.get("OWNERS_REPORT_AUTOSEND", "") or "").strip().lower() in ("1", "true", "yes", "on")


def set_autosend(enabled: bool) -> bool:
    """Flip the daily auto-send flag ON/OFF (persisted DB singleton). Returns the new state."""
    db._set_singleton(_AUTOSEND_FLAG, "1" if enabled else "0")
    return bool(enabled)


async def owners_report_email_loop() -> None:
    """Daily 09:00 Israel time; de-duped per IL calendar day across restarts. The actual
    email is gated behind the OWNERS_REPORT_AUTOSEND flag (OFF until approval) — the loop
    still runs/schedules so it's ready to flip on, but sends NOTHING while disabled."""
    from app.services.scheduled_reports import _next_daily_il, _sleep_until  # reuse the #430 helpers
    while True:
        await _sleep_until(_next_daily_il(9, 0, datetime.now(timezone.utc)))
        try:
            if not autosend_enabled():
                logger.info("owners daily report (09:00 IL): auto-send DISABLED (owners_report_auto_enabled off) — skipping")
                continue
            out = send_daily_report()
            logger.info("owners daily report (09:00 IL): %s", {k: out.get(k) for k in ("date", "sent", "total", "skipped", "error")})
        except Exception as exc:  # noqa: BLE001
            logger.warning("owners report loop error: %s", str(exc)[:200])
