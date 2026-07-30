"""Stripe billing — hosted Checkout + Customer Portal + webhooks.

Most secure model per the brief: card data NEVER touches our servers. We only
create Stripe-hosted Checkout Sessions and a Customer Portal, and react to
signed webhooks. No Stripe SDK — plain httpx against the REST API, and manual
HMAC-SHA256 verification of the webhook signature.

Configured via env (set in the server's .env):
  STRIPE_SECRET                 sk_live_... / sk_test_...   (required)
  STRIPE_WEBHOOK_SECRET         whsec_...                   (required for webhooks)
  STRIPE_PRICE_BASIC            price_...  (recurring $10/mo)
  STRIPE_PRICE_MIDDLE           price_...  (recurring $29.99/mo)
  STRIPE_PRICE_PRO              price_...  (recurring $99.99/mo)
  STRIPE_PRICE_PROFIT_UNLOCK    price_...  (one-time $500)   [optional; inline fallback]
  APP_URL or DOMAIN             where to send users back after checkout

If STRIPE_SECRET is missing every entry point raises a clear "not configured"
error, so the rest of the app runs fine without billing wired up.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
from typing import Any, Optional

from app import database as db
from app.services import plans

logger = logging.getLogger("algo770")

_API = "https://api.stripe.com"

# Credit packs: kind -> (label, unit_amount_cents, units_per_pack)
CREDIT_PACKS = {
    "breakouts":       {"label": "Extra breakouts (50)",        "cents": 500,  "units": 50},
    "backtest_scans":  {"label": "Extra backtest scans (10)",   "cents": 500,  "units": 10},
    "backtest_assets": {"label": "Extra backtest assets (500)",  "cents": 1000, "units": 500},
    "bots":            {"label": "Extra bots (5)",               "cents": 1000, "units": 5},
    "strategies":      {"label": "Add 1 strategy slot",           "cents": 5000, "units": 1},
}


def is_configured() -> bool:
    return bool(os.environ.get("STRIPE_SECRET"))


def _secret() -> str:
    s = os.environ.get("STRIPE_SECRET")
    if not s:
        raise RuntimeError("Stripe is not configured (STRIPE_SECRET missing).")
    return s


def _base_url() -> str:
    dom = os.environ.get("APP_URL") or os.environ.get("DOMAIN") or "app.strateteach.com"
    if dom.startswith("http"):
        return dom.rstrip("/")
    return f"https://{dom}".rstrip("/")


def _price_for_plan(plan: str) -> Optional[str]:
    return os.environ.get(f"STRIPE_PRICE_{plan.upper()}")


def _plan_for_price(price_id: str) -> Optional[str]:
    if not price_id:
        return None
    for p in plans.PLAN_ORDER:
        if os.environ.get(f"STRIPE_PRICE_{p.upper()}") == price_id:
            return p
    return None


def _post(path: str, data: dict[str, Any]) -> dict[str, Any]:
    """POST form-encoded to the Stripe API. Supports nested keys via a[b]=c."""
    import httpx

    flat: dict[str, str] = {}

    def _flatten(prefix: str, value: Any) -> None:
        if isinstance(value, dict):
            for k, v in value.items():
                _flatten(f"{prefix}[{k}]" if prefix else k, v)
        elif isinstance(value, (list, tuple)):
            for i, v in enumerate(value):
                _flatten(f"{prefix}[{i}]", v)
        elif value is not None:
            flat[prefix] = str(value)

    _flatten("", data)
    r = httpx.post(f"{_API}{path}", data=flat, auth=(_secret(), ""), timeout=20)
    if r.status_code >= 300:
        logger.warning("Stripe %s failed: %s %s", path, r.status_code, r.text[:300])
        raise RuntimeError(f"Stripe error: {r.text[:200]}")
    return r.json()


# ── Customer ───────────────────────────────────────────────────────────────

def _ensure_customer(username: str) -> str:
    user = db.get_user(username) or {}
    cid = user.get("stripe_customer_id")
    if cid:
        return cid
    payload: dict[str, Any] = {"metadata": {"username": username}}
    if user.get("email"):
        payload["email"] = user["email"]
    cust = _post("/v1/customers", payload)
    cid = cust["id"]
    db.set_stripe_customer(username, cid)
    return cid


# ── Checkout sessions ────────────────────────────────────────────────────────

def checkout_subscription(username: str, plan: str) -> str:
    if plan not in plans.PLAN_ORDER:
        raise ValueError(f"Unknown plan: {plan}")
    price = _price_for_plan(plan)
    if not price:
        raise RuntimeError(f"No Stripe price configured for the {plan} plan (set STRIPE_PRICE_{plan.upper()}).")
    cid = _ensure_customer(username)
    base = _base_url()
    sess = _post("/v1/checkout/sessions", {
        "mode": "subscription",
        "customer": cid,
        "client_reference_id": username,
        "line_items": [{"price": price, "quantity": 1}],
        "success_url": f"{base}/?billing=success",
        "cancel_url": f"{base}/?billing=cancel",
        "metadata": {"username": username, "plan": plan, "kind": "subscription"},
        "subscription_data": {"metadata": {"username": username, "plan": plan}},
        "allow_promotion_codes": "true",
    })
    return sess["url"]


def checkout_profit_unlock(username: str) -> str:
    cid = _ensure_customer(username)
    base = _base_url()
    price = os.environ.get("STRIPE_PRICE_PROFIT_UNLOCK")
    if price:
        line = {"price": price, "quantity": 1}
    else:
        line = {
            "price_data": {
                "currency": "usd",
                "unit_amount": plans.PROFIT_UNLOCK_PRICE_CENTS,
                "product_data": {"name": "Trading Engine — full access (one-time)"},
            },
            "quantity": 1,
        }
    sess = _post("/v1/checkout/sessions", {
        "mode": "payment",
        "customer": cid,
        "client_reference_id": username,
        "line_items": [line],
        "success_url": f"{base}/?billing=unlock_success",
        "cancel_url": f"{base}/?billing=cancel",
        "metadata": {"username": username, "kind": "profit_unlock"},
        "payment_intent_data": {"metadata": {"username": username, "kind": "profit_unlock"}},
    })
    return sess["url"]


def checkout_credits(username: str, kind: str, packs: int = 1) -> str:
    pack = CREDIT_PACKS.get(kind)
    if not pack:
        raise ValueError(f"Unknown credit kind: {kind}")
    packs = max(1, min(50, int(packs)))
    cid = _ensure_customer(username)
    base = _base_url()
    units = pack["units"] * packs
    sess = _post("/v1/checkout/sessions", {
        "mode": "payment",
        "customer": cid,
        "client_reference_id": username,
        "line_items": [{
            "price_data": {
                "currency": "usd",
                "unit_amount": pack["cents"],
                "product_data": {"name": pack["label"]},
            },
            "quantity": packs,
        }],
        "success_url": f"{base}/?billing=credits_success",
        "cancel_url": f"{base}/?billing=cancel",
        "metadata": {"username": username, "kind": "credits", "credit_kind": kind, "units": units},
        "payment_intent_data": {"metadata": {"username": username, "kind": "credits", "credit_kind": kind, "units": units}},
    })
    return sess["url"]


def customer_portal(username: str) -> str:
    cid = _ensure_customer(username)
    base = _base_url()
    sess = _post("/v1/billing_portal/sessions", {
        "customer": cid,
        "return_url": f"{base}/?billing=portal",
    })
    return sess["url"]


# ── Webhooks ─────────────────────────────────────────────────────────────────

def verify_signature(payload: bytes, sig_header: str) -> bool:
    """Verify Stripe's 'Stripe-Signature' header (t=...,v1=...). Returns True on
    a valid HMAC-SHA256 match with STRIPE_WEBHOOK_SECRET."""
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET")
    if not secret or not sig_header:
        return False
    parts = dict(
        kv.split("=", 1) for kv in sig_header.split(",") if "=" in kv
    )
    t = parts.get("t")
    v1 = parts.get("v1")
    if not t or not v1:
        return False
    signed = f"{t}.{payload.decode('utf-8', 'replace')}".encode()
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)


def handle_event(event: dict[str, Any]) -> None:
    """Apply a verified Stripe event to the user's account state. Idempotent via
    billing_events (each Stripe event id is recorded once)."""
    eid = event.get("id")
    etype = event.get("type", "")
    if eid and db.billing_event_exists(eid):
        return
    obj = (event.get("data") or {}).get("object") or {}

    if etype == "checkout.session.completed":
        _on_checkout_completed(obj)
    elif etype in ("customer.subscription.updated", "customer.subscription.created"):
        _on_subscription_change(obj)
    elif etype == "customer.subscription.deleted":
        _on_subscription_deleted(obj)

    if eid:
        db.record_billing_event(etype, stripe_id=eid, raw=event)


def _username_from(obj: dict[str, Any]) -> Optional[str]:
    meta = obj.get("metadata") or {}
    uname = meta.get("username") or obj.get("client_reference_id")
    if uname:
        return uname
    cust = obj.get("customer")
    if cust:
        row = db.get_user_by_stripe_customer(cust)
        if row:
            return row["username"]
    return None


def _on_checkout_completed(obj: dict[str, Any]) -> None:
    username = _username_from(obj)
    if not username:
        return
    meta = obj.get("metadata") or {}
    kind = meta.get("kind") or ("subscription" if obj.get("mode") == "subscription" else "payment")
    cust = obj.get("customer")
    if cust:
        db.set_stripe_customer(username, cust)

    if kind == "subscription":
        plan = meta.get("plan")
        if plan in plans.PLAN_ORDER:
            db.set_user_plan(username, plan, status="active")
    elif kind == "profit_unlock":
        db.set_profit_engine_unlocked(username, True)
    elif kind == "credits":
        ckind = meta.get("credit_kind")
        try:
            units = int(meta.get("units") or 0)
        except (TypeError, ValueError):
            units = 0
        if ckind and units:
            db.add_credits(username, ckind, units)


def _on_subscription_change(obj: dict[str, Any]) -> None:
    username = _username_from(obj)
    if not username:
        return
    status = obj.get("status")  # active, trialing, past_due, canceled, ...
    period_end = obj.get("current_period_end")
    period_iso = None
    if period_end:
        from datetime import datetime, timezone
        period_iso = datetime.fromtimestamp(int(period_end), tz=timezone.utc).isoformat()
    # Resolve the plan from the subscription's price.
    plan = None
    items = ((obj.get("items") or {}).get("data") or [])
    if items:
        price_id = ((items[0] or {}).get("price") or {}).get("id")
        plan = _plan_for_price(price_id)
    if plan and status in ("active", "trialing"):
        db.set_user_plan(username, plan, status=status, period_end=period_iso)
    else:
        db.set_subscription_state(username, status, period_iso)


def _on_subscription_deleted(obj: dict[str, Any]) -> None:
    username = _username_from(obj)
    if not username:
        return
    # Subscription ended → downgrade to Basic.
    db.set_user_plan(username, "basic", status="canceled")
