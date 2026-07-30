"""Stripe billing endpoints: checkout, customer portal, and the webhook.

All money flows through Stripe-hosted pages — we never see card data. The
webhook is the source of truth for entitlement changes and is the only public
billing route (it's signature-verified, not bearer-gated).
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.security import current_user
from app.services import billing, plans

logger = logging.getLogger("algo770")

router = APIRouter(tags=["billing"])


@router.get("/auth/billing/config")
def billing_config(_: str = Depends(current_user)):
    """Pricing data + whether billing is live, for the upgrade screen."""
    return {
        "configured": billing.is_configured(),
        "plans": plans.plans_public(),
        "profitUnlockPrice": plans.PROFIT_UNLOCK_PRICE_CENTS / 100.0,
        "creditPacks": [
            {"kind": k, "label": v["label"], "price": v["cents"] / 100.0, "units": v["units"]}
            for k, v in billing.CREDIT_PACKS.items()
        ],
    }


@router.post("/auth/billing/checkout")
def billing_checkout(body: dict, username: str = Depends(current_user)):
    if not billing.is_configured():
        raise HTTPException(503, "Billing isn't set up yet. Please try again later.")
    plan = (body or {}).get("plan", "")
    if plan not in plans.PLAN_ORDER:
        raise HTTPException(400, "Unknown plan.")
    try:
        url = billing.checkout_subscription(username, plan)
    except Exception as exc:  # noqa: BLE001
        logger.warning("checkout failed: %s", exc)
        raise HTTPException(502, "Couldn't start checkout. Please try again.")
    return {"url": url}


@router.post("/auth/billing/profit-unlock")
def billing_profit_unlock(username: str = Depends(current_user)):
    if not billing.is_configured():
        raise HTTPException(503, "Billing isn't set up yet. Please try again later.")
    try:
        url = billing.checkout_profit_unlock(username)
    except Exception as exc:  # noqa: BLE001
        logger.warning("profit-unlock checkout failed: %s", exc)
        raise HTTPException(502, "Couldn't start checkout. Please try again.")
    return {"url": url}


@router.post("/auth/billing/credits")
def billing_credits(body: dict, username: str = Depends(current_user)):
    if not billing.is_configured():
        raise HTTPException(503, "Billing isn't set up yet. Please try again later.")
    kind = (body or {}).get("kind", "")
    packs = int((body or {}).get("packs", 1) or 1)
    if kind not in billing.CREDIT_PACKS:
        raise HTTPException(400, "Unknown credit pack.")
    try:
        url = billing.checkout_credits(username, kind, packs)
    except Exception as exc:  # noqa: BLE001
        logger.warning("credits checkout failed: %s", exc)
        raise HTTPException(502, "Couldn't start checkout. Please try again.")
    return {"url": url}


@router.post("/auth/billing/portal")
def billing_portal(username: str = Depends(current_user)):
    if not billing.is_configured():
        raise HTTPException(503, "Billing isn't set up yet. Please try again later.")
    try:
        url = billing.customer_portal(username)
    except Exception as exc:  # noqa: BLE001
        logger.warning("portal failed: %s", exc)
        raise HTTPException(502, "Couldn't open the billing portal. Please try again.")
    return {"url": url}


@router.post("/auth/billing/webhook")
async def billing_webhook(request: Request):
    """Stripe webhook. PUBLIC but signature-verified — never trust the body
    without a valid Stripe-Signature."""
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    if not billing.verify_signature(payload, sig):
        raise HTTPException(400, "Invalid signature")
    try:
        event = json.loads(payload.decode("utf-8"))
    except Exception:
        raise HTTPException(400, "Invalid payload")
    try:
        billing.handle_event(event)
    except Exception as exc:  # noqa: BLE001
        logger.warning("webhook handling error: %s", exc)
        # Return 200 so Stripe doesn't hammer retries on a non-signature bug.
    return {"received": True}
