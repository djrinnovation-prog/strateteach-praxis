"""First-run onboarding: the AI-agent quiz scoring + a personalised plan.

Maps the 5 quiz answers to a "strat score" (0-100), a trader level, and a
step-by-step starting plan that points at the app's REAL features/routes. All
copy is bilingual (he/en) so the frontend just renders by language.

The five questions (answer ids: "yes" | "some" | "no"):
  q1 familiar_trading      – Familiar with trading?
  q2 has_wallet            – Opened a wallet on an exchange?      (yes | no)
  q3 familiar_algo         – Familiar with algo trading?
  q4 lost_unsure           – Lost money trading, unsure why?      (yes | no)
  q5 familiar_strategy     – Familiar with strategy trading?
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

# Points per answer. Max base+sum == 100.
_SCORE = {
    "q1": {"yes": 20, "some": 10, "no": 0},
    "q2": {"yes": 15, "some": 7, "no": 0},
    "q3": {"yes": 25, "some": 12, "no": 0},
    "q4": {"no": 10, "some": 5, "yes": 0},   # "yes, lost & unsure" => needs guidance
    "q5": {"yes": 20, "some": 10, "no": 0},
}
_BASE = 10

# Step library — each references a real route in the dashboard.
STEPS = {
    "learn":     {"path": "/university", "en": ("Read the Explanations", "Learn how the Gaussian-channel signals and tiers actually work — a short guided tour."),
                                          "he": ("קראו את ההסברים", "הבינו איך עובדים האותות (ערוץ גאוס) והדרגות — סיור קצר ומודרך.")},
    "wallet":    {"path": "/exchange",   "en": ("Open & connect an exchange wallet", "Create a wallet on Binance/Bybit/Coinbase/KuCoin/Crypto.com, then connect it (PIN-protected)."),
                                          "he": ("פתחו וחברו ארנק בבורסה", "פתחו ארנק ב-Binance/Bybit/Coinbase/KuCoin/Crypto.com וחברו אותו (מוגן בקוד).")},
    "scan":      {"path": "/scanner",    "en": ("Run today's Daily scan", "See today's hottest breakouts across the market."),
                                          "he": ("הריצו את הסריקה היומית", "ראו את הפריצות החמות של היום בכל השוק.")},
    "demo":      {"path": "/profit",     "en": ("Open a demo run in the Profit Engine", "Virtual money, zero risk — watch the engine pick, size and manage trades."),
                                          "he": ("פתחו הרצת דמו במנוע הרווח", "כסף וירטואלי, אפס סיכון — צפו במנוע בוחר, מתמחר ומנהל עסקאות.")},
    "backtest":  {"path": "/backtests",  "en": ("Backtest a strategy", "Prove an edge on history before risking anything live."),
                                          "he": ("הריצו בקטסט לאסטרטגיה", "הוכיחו יתרון על נתוני עבר לפני סיכון אמיתי.")},
    "lab":       {"path": "/strategy",   "en": ("Build in the Strategy Lab", "Tune or import a Pine strategy and make it your own."),
                                          "he": ("בנו ב-Strategy Lab", "כווננו או ייבאו אסטרטגיית Pine והפכו אותה לשלכם.")},
    "why_lose":  {"path": "/university", "en": ("Understand why trades fail", "A short module on risk, position sizing and the mistakes that cost most traders."),
                                          "he": ("הבינו למה עסקאות נכשלות", "מודול קצר על סיכון, גודל פוזיציה והטעויות שעולות ביוקר.")},
    "reels":     {"path": "/reels",      "en": ("Watch a quick lesson", "Short learning clips for your next step — free previews, full lessons unlock with Pro."),
                                          "he": ("צפו בשיעור קצר", "קליפים קצרים לשלב הבא — תצוגה חינם, השיעור המלא נפתח עם Pro.")},
    "go_pro":    {"path": "/plans",      "en": ("Go Pro — unlock every feature", "Full scan, the Profit Engine, big backtests and all lessons. Your fast track to the full app."),
                                          "he": ("שדרגו ל-Pro — פתחו הכל", "סריקה מלאה, מנוע הרווח, בקטסטים גדולים וכל השיעורים. הדרך המהירה לאפליקציה המלאה.")},
}

_LEVELS = {
    "beginner": {"en": "Beginner", "he": "מתחיל",
                 "headline_en": "We'll start with the fundamentals and build up.",
                 "headline_he": "נתחיל מהיסודות ונתקדם משם."},
    "intermediate": {"en": "Intermediate", "he": "מתקדם",
                 "headline_en": "You know the basics — let's sharpen the edge.",
                 "headline_he": "אתם מכירים את הבסיס — בואו נחדד את היתרון."},
    "advanced": {"en": "Advanced", "he": "מקצוען",
                 "headline_en": "Straight to the powerful tools — strategies, backtests and the engine.",
                 "headline_he": "ישר לכלים החזקים — אסטרטגיות, בקטסטים והמנוע."},
}

# Recommended plan per level (id matches plans.PLAN_ORDER).
_PLAN_BY_LEVEL = {"beginner": "basic", "intermediate": "middle", "advanced": "pro"}


def _norm(answers: dict) -> dict:
    out = {}
    for q in _SCORE:
        v = str((answers or {}).get(q, "no")).lower()
        out[q] = v if v in _SCORE[q] else "no"
    return out


def score(answers: dict) -> int:
    a = _norm(answers)
    total = _BASE + sum(_SCORE[q].get(a[q], 0) for q in _SCORE)
    return max(0, min(100, total))


def _level(s: int) -> str:
    # Thresholds as a % of the 100-point max (see _SCORE/_BASE). The old 35/70
    # cutoffs mislabelled a low 35/100 as "intermediate" (shown as "מתקדם"); a
    # genuinely low score must read as Beginner. Now: <50% Beginner, 50–79%
    # Intermediate, >=80% Advanced.
    if s < 50:
        return "beginner"
    if s < 80:
        return "intermediate"
    return "advanced"


def _plan_for_level(level: str, answers: dict) -> list[str]:
    a = _norm(answers)
    if level == "beginner":
        plan = ["learn", "scan", "demo"]
    elif level == "intermediate":
        plan = ["scan", "backtest", "lab", "demo"]
    else:
        plan = ["lab", "backtest", "exchange_or_demo"]
        plan = ["lab", "backtest", "demo"]
    # Personalisation tweaks.
    if a["q4"] == "yes" and "why_lose" not in plan:
        plan.insert(1 if len(plan) > 1 else 0, "why_lose")
    if a["q2"] == "no" and "wallet" not in plan:
        plan.append("wallet")
    # De-dup, keep order, cap at 5.
    seen, ordered = set(), []
    for k in plan:
        if k in STEPS and k not in seen:
            seen.add(k); ordered.append(k)
    return ordered[:5]


def build_profile(answers: dict) -> dict[str, Any]:
    s = score(answers)
    level = _level(s)
    # The AI agent builds the full tailored checklist: every relevant step for
    # this user's level + situation, a quick lesson, then the path to Pro.
    keys = _plan_for_level(level, answers)  # already personalised + capped at 5
    if "reels" not in keys:
        keys.append("reels")
    if "go_pro" not in keys:
        keys.append("go_pro")
    keys = keys[:6]
    lvl = _LEVELS[level]
    steps = []
    for k in keys:
        st = STEPS[k]
        steps.append({
            "key": k, "path": st["path"],
            "titleEn": st["en"][0], "titleHe": st["he"][0],
            "descEn": st["en"][1], "descHe": st["he"][1],
        })
    return {
        "answers": _norm(answers),
        "stratScore": s,
        "level": level,
        "levelLabelEn": lvl["en"], "levelLabelHe": lvl["he"],
        "headlineEn": lvl["headline_en"], "headlineHe": lvl["headline_he"],
        "recommendedPlan": _PLAN_BY_LEVEL[level],
        "steps": steps,
        "computedAt": datetime.now(timezone.utc).isoformat(),
    }
