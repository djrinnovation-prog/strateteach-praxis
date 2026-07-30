"""Best-effort Pine Script -> engine StrategyConfig extractor.

We do NOT execute Pine Script (it is a full, proprietary TradingView language).
Instead we scan the source *text* for the handful of parameters our backtest
engine actually supports — the Gaussian channel (poles / sampling period /
filtered-true-range multiplier / source / reduced-lag / fast-response), the
SMA / ADX / RSI / Volume filters, and the ATR stop-loss / take-profit settings —
and map them onto ``StrategyConfig`` fields.

Anything we cannot map is returned as a structured warning so the caller can
tell the user it was ignored. A strategy is only considered engine-compatible
(``valid=True``) when the source clearly looks like a Gaussian-channel
("770"-family) strategy, because that is the only family this engine can run.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

_NUM = r"([0-9]+(?:\.[0-9]+)?)"


def _num_for(text: str, names: List[str]) -> Optional[str]:
    """Find the first numeric value associated with any of ``names``.

    Tries, in order: ``name = input.int/float(VALUE``, ``name = VALUE`` and
    ``input.int/float(VALUE, "...name...")`` (value carried by the input title).
    """
    for name in names:
        for pat in (
            rf"\b{name}\b[^\n=]*=\s*input\.(?:int|float)\s*\(\s*{_NUM}",
            rf"\b{name}\b\s*=\s*{_NUM}",
            rf'''input\.(?:int|float)\s*\(\s*{_NUM}\s*,\s*["'][^"']*{name}[^"']*["']''',
        ):
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                return m.group(1)
    return None


def _bool_present(text: str, *needles: str) -> bool:
    return any(re.search(n, text, re.IGNORECASE) for n in needles)


_BOOL_DECL = re.compile(r"(?:(\w+)\s*=\s*)?input\.bool\s*\(([^)]*)\)", re.IGNORECASE)


def _bool_value(text: str, *keywords: str) -> Optional[bool]:
    """Return the explicit ``input.bool(...)`` default whose variable name or
    title matches any keyword, or ``None`` when no such declaration exists.

    This reads the *actual* boolean the Pine author chose (``input.bool(false …)``
    must stay False) instead of inferring True from keyword presence.
    """
    for m in _BOOL_DECL.finditer(text):
        var = m.group(1) or ""
        args = m.group(2) or ""
        vm = re.search(r"\b(true|false)\b", args, re.IGNORECASE)
        if not vm:
            continue
        tm = re.search(r"""["']([^"']*)["']""", args)
        hay = f"{var} {tm.group(1) if tm else ''}".lower()
        if any(re.search(k, hay, re.IGNORECASE) for k in keywords):
            return vm.group(1).lower() == "true"
    return None


def _resolve_flag(text: str, *keywords: str) -> Optional[bool]:
    """Resolve a boolean filter flag: prefer the explicit ``input.bool`` default,
    fall back to keyword presence, else ``None`` (concept not referenced)."""
    v = _bool_value(text, *keywords)
    if v is not None:
        return v
    if _bool_present(text, *keywords):
        return True
    return None


def _detect_source(text: str) -> Optional[str]:
    """Detect the Gaussian channel price source if one is declared."""
    m = re.search(
        r'(?:src|source)\b[^\n=]*=\s*input\.source\s*\(\s*([a-z0-9]+)',
        text, re.IGNORECASE,
    )
    if m:
        return m.group(1).lower()
    m = re.search(r'(?:src|source)\b\s*=\s*(hlc3|ohlc4|hl2|close|open|high|low)\b',
                  text, re.IGNORECASE)
    if m:
        return m.group(1).lower()
    return None


def parse_pine_script(source: str) -> Dict[str, Any]:
    """Parse Pine Script text into a partial engine config + warnings.

    Returns a dict: ``{valid, strategyId, applied, recognized, warnings}`` where
    ``applied`` is the subset of ``StrategyConfig`` fields we recognized,
    ``recognized`` is a display list ``[{key, value}]`` (config-field keys the
    frontend localizes), and ``warnings`` is ``[{code, detail}]``.
    """
    text = source or ""
    applied: Dict[str, Any] = {}
    recognized: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []

    def add_int(field: str, raw: Optional[str]):
        if raw is None:
            return
        try:
            applied[field] = int(float(raw))
            recognized.append({"key": field, "value": applied[field]})
        except ValueError:
            pass

    def add_float(field: str, raw: Optional[str]):
        if raw is None:
            return
        try:
            applied[field] = float(raw)
            recognized.append({"key": field, "value": applied[field]})
        except ValueError:
            pass

    def add_bool(field: str, value: bool):
        applied[field] = value
        recognized.append({"key": field, "value": value})

    # ── Gaussian channel core ────────────────────────────────────────────────
    add_int("poles", _num_for(text, ["poles", "pole", "npoles"]))
    add_int("samplingPeriod", _num_for(
        text, ["sampling ?period", "samplingperiod", "sampling", "period", "length", "per"]))
    add_float("ftrMultiplier", _num_for(
        text, ["multiplier", "mult", "ftr", "trmult"]))

    rl = _resolve_flag(text, r"reduced[ _]?lag", r"\blag\b")
    if rl is not None:
        add_bool("reducedLag", rl)
    fr = _resolve_flag(text, r"fast[ _]?response", r"\bfastresp")
    if fr is not None:
        add_bool("fastResponse", fr)

    source_kind = _detect_source(text)
    if source_kind:
        recognized.append({"key": "source", "value": source_kind})
        if source_kind not in ("close", "ohlc4", "hlc3", "hl2"):
            warnings.append({"code": "source_unsupported", "detail": source_kind})

    # ── Filters ──────────────────────────────────────────────────────────────
    sma = _resolve_flag(text, r"\bsma\b", r"sma200", r"200[ _]?sma")
    if sma is not None:
        add_bool("useSmaFilter", sma)

    adx = _resolve_flag(text, r"\badx\b", r"\bdmi\b")
    if adx is not None:
        add_bool("useAdxFilter", adx)
        if adx:
            add_int("adxLength", _num_for(
                text, ["adx ?length", "adxlen", "di ?length", "dilen", "adx ?len"]))
            thr = _num_for(text, ["adx ?threshold", "adxthresh"])
            if thr is None:
                m = re.search(rf"adx[^\n]*?[><]=?\s*{_NUM}", text, re.IGNORECASE)
                thr = m.group(1) if m else None
            add_float("adxThreshold", thr)

    rsi = _resolve_flag(text, r"\brsi\b")
    if rsi is not None:
        add_bool("useRsiFilter", rsi)
        if rsi:
            add_int("rsiLength", _num_for(text, ["rsi ?length", "rsilen", "rsi ?len"]))

    if _bool_present(text, r"\bvolume\b", r"\bvol\b") and _bool_present(
        text, r"volume[^\n]*(?:sma|ma|average|avg)", r"(?:sma|ma|average|avg)[^\n]*volume",
    ):
        volf = _resolve_flag(text, r"volume", r"\bvol\b")
        if volf is not None:
            add_bool("useVolumeFilter", volf)
            if volf:
                add_int("volumeMaLength", _num_for(
                    text, ["volume ?ma ?length", "volume ?length", "vol ?ma", "volume ?ma"]))

    # ── Risk: ATR stop / take profit ─────────────────────────────────────────
    has_atr = _bool_present(text, r"\batr\b")
    stop_flag = _resolve_flag(text, r"stop ?loss", r"stoploss", r"stop", r"\bsl\b")
    if has_atr and stop_flag:
        add_bool("useHardStop", True)
        atr_len = _num_for(text, ["atr ?length", "atrlen", "atr ?period", "atrperiod"])
        if atr_len is None:
            m = re.search(rf"atr\s*\(\s*{_NUM}", text, re.IGNORECASE)
            atr_len = m.group(1) if m else None
        add_int("stopAtrLength", atr_len)
        sl_mult = _num_for(text, ["stop ?mult", "sl ?mult", "stop ?multiplier", "stoploss ?mult"])
        if sl_mult is not None:
            add_float("longStopMult", sl_mult)
            add_float("shortStopMult", sl_mult)

    tp_flag = _resolve_flag(text, r"take[ _]?profit", r"takeprofit", r"\btp\b")
    if tp_flag:
        tp_mult = _num_for(text, ["tp ?mult", "take ?profit ?mult", "profit ?mult", "tpmult"])
        add_bool("useLongTP", True)
        add_bool("useShortTP", True)
        if tp_mult is not None:
            add_float("longTpMult", tp_mult)
            add_float("shortTpMult", tp_mult)

    # ── Direction (shorts) ───────────────────────────────────────────────────
    has_short = _bool_present(text, r"strategy\.entry[^\n]*short", r"strategy\.short")
    short_flag = _bool_value(text, r"enable[ _]?short", r"allow[ _]?short", r"\bshort\b")
    if short_flag is not None:
        add_bool("enableShorts", short_flag)
        has_short = has_short or short_flag
    elif has_short:
        add_bool("enableShorts", True)

    # ── Engine compatibility ────────────────────────────────────────────────
    is_gaussian = (
        "poles" in applied
        or _bool_present(text, r"gaussian", r"\b770\b", r"f_?filt", r"filtered true range")
    )
    valid = bool(is_gaussian)
    if not valid:
        warnings.append({"code": "not_gaussian", "detail": ""})

    # ── Strategy guess (user can override in the UI) ─────────────────────────
    if source_kind == "hlc3" and not has_short:
        strategy_id = "bot1"
    elif has_short and has_atr:
        strategy_id = "bot4"
    else:
        strategy_id = "bot8c"

    # ── Unmapped inputs -> warnings ──────────────────────────────────────────
    mapped_keywords = (
        "pole", "sampling", "period", "length", "len", "mult", "ftr", "source", "src",
        "lag", "fast", "sma", "adx", "dmi", "rsi", "volume", "vol", "atr", "stop",
        "sl", "tp", "take", "profit", "threshold", "short",
    )
    for title in re.findall(r'''input\.\w+\s*\([^)]*?["']([^"']+)["']''', text):
        low = title.lower()
        if not any(k in low for k in mapped_keywords):
            warnings.append({"code": "unmapped_input", "detail": title})

    if _bool_present(text, r"trail"):
        warnings.append({"code": "trailing_note", "detail": ""})

    return {
        "valid": valid,
        "strategyId": strategy_id,
        "applied": applied,
        "recognized": recognized,
        "warnings": warnings,
    }
