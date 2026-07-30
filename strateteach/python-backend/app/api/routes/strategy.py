"""Symbols, default config, and strategy management (parse / preview / saved)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from app import database as db
from app.backtest import runner
from app.core.security import current_user, is_owner
from app.data.symbols import BUCKET_MAP, get_symbols
from app.models import StrategyConfig, SymbolInfo
from app.services import pinescript_parser
from app.services import signals as sig_scanner

router = APIRouter()


@router.get("/symbols/{bucket}", response_model=List[SymbolInfo], tags=["symbols"])
def get_symbols_endpoint(bucket: str, limit: Optional[int] = None, _: str = Depends(current_user)):
    # `limit` (optional) bounds the universe for the single-symbol backtest picker
    # so it doesn't pull the full ~1000-coin list. Omitted = the bucket's default max.
    if bucket not in BUCKET_MAP:
        raise HTTPException(404, f"Unknown bucket: {bucket}")
    n = limit if (limit and limit > 0) else None
    return [SymbolInfo(symbol=s, name=n2, bucket=bucket) for s, n2 in get_symbols(bucket, n)]


@router.get("/config/defaults", response_model=StrategyConfig, tags=["config"])
def config_defaults(_: str = Depends(current_user)):
    # Defaults come straight from the model — safe to serve now.
    return StrategyConfig()


@router.post("/strategy/parse-pine", tags=["strategy"])
def parse_pine(body: dict, _: str = Depends(current_user)):
    return pinescript_parser.parse_pine_script((body or {}).get("source", ""))


@router.post("/strategy/preview-top10", tags=["strategy"])
async def preview_top10(body: dict, _: str = Depends(current_user)):
    cfg = StrategyConfig(**(body or {}).get("config", {}))
    limit = max(1, min(int((body or {}).get("limit", 10) or 10), 25))
    symbols = sig_scanner.get_top_crypto_by_volume(limit)
    if not symbols:
        raise HTTPException(status_code=503, detail="Could not fetch top crypto symbols")
    results = await runner.run_preview(cfg, symbols)
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "results": [r.model_dump() for r in results],
    }


@router.get("/strategy/saved", tags=["strategy"])
def saved_strategies(username: str = Depends(current_user)):
    all_s = db.list_saved_strategies()
    # ONLY an OWNER (Dan/Rafi/Yoav) may see other users' strategies (and their Pine source).
    # A non-owner admin (Oren) and every regular user see strictly their own.
    if is_owner(username):
        return all_s                                  # owners see everyone's strategies
    return [s for s in all_s if s.get("owner") == username]  # everyone else: only their own


def _can_edit_strategy(strategy_id: int, username: str) -> dict:
    """Return the strategy if the caller may edit it — its creator, or an OWNER (who has
    access to all strategies, incl. legacy ownerless ones). A non-owner admin may edit only
    their own. Else raise 403/404."""
    s = db.get_saved_strategy(strategy_id)
    if not s:
        raise HTTPException(status_code=404, detail="Strategy not found.")
    owner = s.get("owner")
    if is_owner(username) or (owner and owner == username):
        return s
    raise HTTPException(status_code=403, detail="You can only edit strategies you created.")


@router.post("/strategy/saved", status_code=201, tags=["strategy"])
def save_strategy(body: dict, username: str = Depends(current_user)):
    name = ((body or {}).get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Strategy name is required")
    cfg = StrategyConfig(**(body or {}).get("config", {}))
    return db.save_strategy(name, cfg.strategyId, cfg.model_dump(), (body or {}).get("pineSource"), owner=username)


@router.patch("/strategy/saved/{strategy_id}", tags=["strategy"])
def update_saved_strategy(strategy_id: int, body: dict, username: str = Depends(current_user)):
    _can_edit_strategy(strategy_id, username)
    name = (body or {}).get("name")
    name = name.strip() if isinstance(name, str) else None
    cfg = None
    if (body or {}).get("config") is not None:
        cfg = StrategyConfig(**body["config"]).model_dump()
    return db.update_saved_strategy(strategy_id, name=name or None, config=cfg, pine_source=(body or {}).get("pineSource"))


@router.delete("/strategy/saved/{strategy_id}", tags=["strategy"])
def delete_saved_strategy(strategy_id: int, username: str = Depends(current_user)):
    _can_edit_strategy(strategy_id, username)
    db.delete_saved_strategy(strategy_id)
    return {"ok": True}


# ── Strategy help requests (user → admin → answer) ───────────────────────────

def _is_admin(username: str) -> bool:
    u = db.get_user(username)
    return bool(u and u.get("role") == "admin")


@router.post("/strategy/help", status_code=201, tags=["strategy"])
def submit_help(body: dict, username: str = Depends(current_user)):
    source = (body or {}).get("source") or ""
    message = ((body or {}).get("message") or "").strip()
    r = db.create_help_request(username, source, message)
    try:
        from app.services import telegram as tg
        who = db.display_name(username)
        tg.notify_admin(f"🆘 <b>Strategy help request</b> from {who}\n{message[:300]}\n\n<code>{(source or '')[:900]}</code>")
    except Exception:  # noqa: BLE001
        pass
    return r


@router.get("/strategy/help", tags=["strategy"])
def list_help(username: str = Depends(current_user)):
    if not _is_admin(username):
        raise HTTPException(403, "Admins only.")
    return db.list_help_requests()


@router.get("/strategy/help/mine", tags=["strategy"])
def my_help(username: str = Depends(current_user)):
    return db.list_my_help_requests(username)


@router.post("/strategy/help/{req_id}/answer", tags=["strategy"])
def answer_help(req_id: int, body: dict, username: str = Depends(current_user)):
    if not _is_admin(username):
        raise HTTPException(403, "Admins only.")
    answer = ((body or {}).get("answer") or "").strip()
    if not answer:
        raise HTTPException(400, "Answer text is required.")
    req = db.get_help_request(req_id)
    if not req:
        raise HTTPException(404, "Request not found.")
    db.answer_help_request(req_id, answer)
    try:
        from app.services import notify
        notify.notify_user(req.get("username"),
                           "✅ ALGO770: an admin answered your strategy help request — open the Strategy Lab to see it.")
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True}
