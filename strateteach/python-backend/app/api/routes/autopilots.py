"""AutoPilots — owners-only DRY-RUN / SIMULATION endpoints.

STRICT MONEY-SAFETY: every endpoint here is SIMULATION only. Arming a pilot records an
owner's approved config and runs a paper/dry-run pass over the live Trend Radar scan;
NOTHING places an order or moves money. Gated by ``require_owner`` (Dan / Rafi / Yoav).
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app import database as db
from app.core.security import require_owner, require_it_editor, assert_legacy_engine_enabled
from app.services import autopilot_sim as sim
from app.services import autopilot_live as live

router = APIRouter(tags=["autopilots"])


class ArmInput(BaseModel):
    pilotId: str
    direction: Optional[str] = None       # 'long-only' | 'long-short'
    market: Optional[str] = None          # 'crypto' | 'stocks'
    nav: float = 1000.0
    perTradePct: float = 10.0
    accountLabel: Optional[str] = None


class DrModeInput(BaseModel):
    mode: str                             # 'aggressive' | 'smooth' | 'safe'


@router.get("/autopilots/dr-mode")
async def dr_mode_get(user: str = Depends(require_it_editor)):
    """READ: the caller's operational DR-Crypto risk mode (drives the SIM engine's sizing).
    Viewable by an owner OR the IT editor (Oren) — per-caller, no cross-user leak. SETTING the
    mode (POST below) stays owner-only."""
    return {"mode": db.get_dr_mode(user)}


@router.post("/autopilots/dr-mode")
async def dr_mode_set(body: DrModeInput, owner: str = Depends(require_owner)):
    """Set the DR-Crypto risk mode. SIMULATION only — sets HOW the paper pilot sizes/risk-manages
    (aggressive/smooth/safe); never touches the live executor, gate, or any order path."""
    from app.services import dr_strategies as dr
    if body.mode not in dr.DR_MODE_CONFIGS:
        raise HTTPException(400, f"Unknown mode: {body.mode}")
    db.set_dr_mode(owner, body.mode)
    return {"ok": True, "mode": body.mode}


class PilotRef(BaseModel):
    pilotId: Optional[str] = None         # None on /run ⇒ run every armed pilot


# ── REAL-MONEY (Bybit) — heavily-safeguarded, gated. See app/services/autopilot_live.py ──
class KeysInput(BaseModel):
    apiKey: str
    apiSecret: str
    environment: Optional[str] = "testnet"   # 'testnet' | 'live'
    exchange: Optional[str] = "bybit"        # 'bybit' | 'binance' (owner's choice)


class GoLiveInput(BaseModel):
    pilotId: str
    cap: float                                # mandatory low starting-capital cap
    confirm: str                              # must equal the GO-LIVE phrase
    ackReal: bool = False                     # explicit real-money acknowledgement


class EditCapitalInput(BaseModel):
    pilotId: str
    nav: float                                # new sizing capital (per-trade $ re-derives)


# ── Run-plan review gate ("Run now" → plan → approve) ────────────────────────────────────
class PlanInput(BaseModel):
    pilotId: str


class ApproveItem(BaseModel):
    action: str                               # 'enter' | 'exit'
    symbol: str


class ApproveInput(BaseModel):
    pilotId: str
    approved: list[ApproveItem] = []          # ONLY these proposed items are executed


def _valid_pilot(pilot_id: str) -> None:
    if pilot_id not in sim.PILOT_META:
        raise HTTPException(400, f"Unknown pilot: {pilot_id}")


@router.get("/autopilots/state")
async def autopilots_state(user: str = Depends(require_it_editor)):
    """READ: the SIMULATED status of every armed pilot — open positions marked to REAL live
    prices (status + positions + P&L + activity). Viewable by an owner OR the IT editor (Oren):
    the state is scoped to the CALLER (their own sim/keys), so a non-owner viewer only ever sees
    their own — never the owner's positions/keys/balance. MANAGING pilots (arm/run/keys/go-live)
    stays owner-only. Live pricing runs in a threadpool so the fetch never blocks the loop."""
    state = await run_in_threadpool(sim.pilot_state, user, True)
    return {"ok": True, **state}


@router.post("/autopilots/arm")
async def autopilots_arm(body: ArmInput, owner: str = Depends(require_owner)):
    """Owner-only: arm (or re-arm) a pilot in SIMULATION, then run one dry-run pass."""
    _valid_pilot(body.pilotId)
    meta = sim.PILOT_META[body.pilotId]
    direction = body.direction or meta["direction"]
    market = body.market or meta["market"]
    nav = max(0.0, float(body.nav or 0.0))
    pct = float(body.perTradePct or 0.0)
    if pct <= 0 or pct > 100:
        raise HTTPException(400, "perTradePct must be between 0 and 100")
    if nav <= 0:
        raise HTTPException(400, "nav must be positive")
    db.autopilot_arm(username=owner, pilot_id=body.pilotId, direction=direction, market=market,
                     nav=nav, per_trade_pct=pct, account_label=(body.accountLabel or None),
                     next_run_at=sim._next_run_iso())
    # HONEST LOAD: start FLAT — 0 positions, 0 P&L, equity = the defined capital. Nothing is
    # bought at load; real (simulated) positions open only on the next run/scan. No
    # fabricated pre-load history.
    armed = db.get_autopilot_armed(owner, body.pilotId)
    sim.initialize_pilot(owner, armed)
    state = await run_in_threadpool(sim.pilot_state, owner, True)
    return {"ok": True, **state}


@router.post("/autopilots/edit-capital")
async def autopilots_edit_capital(body: EditCapitalInput, owner: str = Depends(require_owner)):
    """Owner-only: change ONLY the sizing capital (nav) of a loaded pilot WITHOUT
    disarming/reloading — positions + history are preserved and the per-trade $ re-derives
    from nav × per_trade_pct%. Does NOT touch live_cap (the separate real-money cap governs
    live spend). Simulation-safe."""
    _valid_pilot(body.pilotId)
    if not db.get_autopilot_armed(owner, body.pilotId):
        raise HTTPException(404, "That pilot is not loaded.")
    nav = float(body.nav or 0.0)
    if nav <= 0:
        raise HTTPException(400, "Capital must be positive.")
    db.set_autopilot_capital(owner, body.pilotId, nav)
    state = await run_in_threadpool(sim.pilot_state, owner, True)
    return {"ok": True, **state}


@router.post("/autopilots/disarm")
async def autopilots_disarm(body: PilotRef, owner: str = Depends(require_owner)):
    """Owner-only: disarm a pilot and clear its simulated positions + activity."""
    if not body.pilotId:
        raise HTTPException(400, "pilotId required")
    db.autopilot_disarm(owner, body.pilotId)
    return {"ok": True, **sim.pilot_state(owner)}


@router.post("/autopilots/run")
async def autopilots_run(body: PilotRef, owner: str = Depends(require_owner)):
    """Owner-only: apply-all run — one armed pilot, or all of them (pilotId omitted).
    The manual per-pilot UI now goes through /plan → /approve (review-then-approve); this
    endpoint remains for 'run all' and is still fully gated for any live pilot."""
    if body.pilotId:
        _valid_pilot(body.pilotId)
        if not db.get_autopilot_armed(owner, body.pilotId):
            raise HTTPException(404, "That pilot is not armed.")
        await run_in_threadpool(sim.run_one, owner, body.pilotId)
    else:
        await run_in_threadpool(sim.run_all_for_user, owner)
    state = await run_in_threadpool(sim.pilot_state, owner, True)
    return {"ok": True, **state}


@router.post("/autopilots/plan")
async def autopilots_plan(body: PlanInput, owner: str = Depends(require_owner)):
    """Owner-only: compute the READ-ONLY run plan for one pilot — which exits/entries the
    run proposes against the current scan. Places NOTHING and writes NOTHING; this is what
    the review panel shows before the owner approves. For a live pilot it also reports
    eligibility + budget so the owner sees exactly what Approve would attempt."""
    _valid_pilot(body.pilotId)
    if not db.get_autopilot_armed(owner, body.pilotId):
        raise HTTPException(404, "That pilot is not loaded.")
    plan = await run_in_threadpool(sim.plan_pilot_run, owner, body.pilotId)
    return {"ok": True, "plan": plan}


@router.post("/autopilots/approve")
async def autopilots_approve(body: ApproveInput, owner: str = Depends(require_owner)):
    """Owner-only: execute ONLY the owner-approved items from the run plan. The server
    RECOMPUTES the plan from the current scan and applies just the approved
    'enter:<sym>'/'exit:<sym>' items — so the client can never make it execute anything the
    server's own fresh plan doesn't propose. Empty approval → nothing executes. For a live
    pilot every real-money safeguard (master gate, cap, budget, min-notional, max positions,
    long-only spot) is re-checked per order inside the executor."""
    _valid_pilot(body.pilotId)
    if not db.get_autopilot_armed(owner, body.pilotId):
        raise HTTPException(404, "That pilot is not loaded.")
    approved_keys = {f"{i.action}:{i.symbol}" for i in (body.approved or [])}
    result = await run_in_threadpool(sim.apply_pilot_run, owner, body.pilotId, approved_keys)
    state = await run_in_threadpool(sim.pilot_state, owner, True)
    return {"ok": True, "result": result, **state}


# ══ REAL-MONEY (Bybit) — owner-only, heavily safeguarded, MASTER-GATED ══════════════════
# NOTE: no endpoint here can place an order. Orders happen only inside the executor's daily
# pass / run-now, and ONLY when the server-side master gate (AUTOPILOT_LIVE_ENABLED) is on.

@router.get("/autopilots/keys")
async def autopilots_keys_status(owner: str = Depends(require_owner)):
    """Owner-only: masked status of the owner's connected exchange keys, Bybit or Binance (never raw)."""
    return {"ok": True, **live.keys_status(owner)}


@router.post("/autopilots/keys", dependencies=[Depends(assert_legacy_engine_enabled)])  # M7: legacy engine retired
async def autopilots_keys_connect(body: KeysInput, owner: str = Depends(require_owner)):
    """Owner-only: connect the owner's OWN exchange keys (Bybit or Binance — their choice).
    Encrypted server-side; never logged or returned raw. Only a masked hint is echoed back."""
    res = live.connect_keys(owner, body.apiKey, body.apiSecret, body.environment or "testnet",
                            exchange=body.exchange or "bybit")
    if res.get("ok") is False:
        raise HTTPException(400, res.get("message") or "Could not connect keys.")
    return {"ok": True, **res}


@router.post("/autopilots/keys/test", dependencies=[Depends(assert_legacy_engine_enabled)])  # M7: legacy engine retired
async def autopilots_keys_test(owner: str = Depends(require_owner)):
    """Owner-only: READ-ONLY connectivity check (fetch_balance). Places NO order."""
    return {"ok": True, **await run_in_threadpool(live.test_keys, owner)}


@router.get("/autopilots/balance")
async def autopilots_balance(owner: str = Depends(require_owner)):
    """Owner-only: READ-ONLY spot wallet balance for the connected exchange, Bybit or Binance
    (fetch_balance only). NO trading."""
    return await run_in_threadpool(live.wallet_balance, owner)


@router.delete("/autopilots/keys")
async def autopilots_keys_disconnect(owner: str = Depends(require_owner)):
    """Owner-only: disconnect keys and force all the owner's pilots back to simulation."""
    return await run_in_threadpool(live.disconnect_keys, owner)


@router.post("/autopilots/go-live", dependencies=[Depends(assert_legacy_engine_enabled)])  # M7: legacy engine retired
async def autopilots_go_live(body: GoLiveInput, owner: str = Depends(require_owner)):
    """Owner-only: switch ONE pilot to LIVE after the multi-step confirm (keys connected +
    typed phrase + real-money ack + a low starting-capital cap). Records intent only —
    real orders still require the server master gate."""
    _valid_pilot(body.pilotId)
    res = live.go_live(owner, body.pilotId, body.cap, body.confirm, body.ackReal)
    if res.get("ok") is False:
        raise HTTPException(400, res.get("message") or "Could not go live.")
    state = await run_in_threadpool(sim.pilot_state, owner, True)
    return {"ok": True, "message": res.get("message"), "masterGate": res.get("masterGate"), **state}


@router.post("/autopilots/stop-live")
async def autopilots_stop_live(body: PilotRef, owner: str = Depends(require_owner)):
    """Owner-only KILL-SWITCH: instantly flip a pilot back to simulation (stops new live
    orders). Does NOT auto-liquidate open positions (that would itself be a real order)."""
    if not body.pilotId:
        raise HTTPException(400, "pilotId required")
    _valid_pilot(body.pilotId)
    res = live.stop_live(owner, body.pilotId)
    if res.get("ok") is False:
        raise HTTPException(400, res.get("message") or "Could not stop live.")
    state = await run_in_threadpool(sim.pilot_state, owner, True)
    return {"ok": True, "message": res.get("message"), **state}


@router.get("/autopilots/audit")
async def autopilots_audit(owner: str = Depends(require_owner)):
    """Owner-only: the live audit trail (every real-money action). No secrets are stored."""
    return {"ok": True, "audit": db.list_autopilot_live_audit(owner, 100)}
