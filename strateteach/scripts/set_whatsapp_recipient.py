#!/usr/bin/env python3
"""Add / update a WhatsApp alert recipient.

One-call setup: store the user's phone, point their WhatsApp channel at it, enable
WhatsApp, and turn ON every alert type — so ALL alerts (breakout, take-profit,
stop-loss, Signal-Bot fills, digest, chat, team messages) reach their WhatsApp.

Strictly per-user (never global). Consent is stamped server-side on the OFF→ON
transition by db.set_notif_prefs.

Run inside the backend environment (DATABASE_URL set), from python-backend/:

    # Configure Dan (username dan AND admin) → +972538821770
    python ../scripts/set_whatsapp_recipient.py dan   +972538821770
    python ../scripts/set_whatsapp_recipient.py admin +972538821770

    # Later, once we have their numbers:
    python ../scripts/set_whatsapp_recipient.py yoav +9725........
    python ../scripts/set_whatsapp_recipient.py rafi +9725........

Reminder: the Twilio SANDBOX only delivers to numbers that have first sent the
join code (e.g. "join edge-year") to the sandbox WhatsApp number. Dan's number
has joined; Yoav/Rafi must join before they'll receive anything.
"""
from __future__ import annotations

import sys

from app import database as db


def main(argv: list[str]) -> int:
    if len(argv) < 3 or argv[1] in ("-h", "--help"):
        print(__doc__)
        return 0 if len(argv) < 2 else 2
    username = argv[1].strip()
    phone = argv[2].strip()
    if not phone.startswith("+"):
        print(f"error: phone must be E.164 (start with +). Got: {phone!r}")
        return 2
    if not db.get_user(username):
        print(f"error: no such user: {username!r}")
        return 2
    prefs = db.set_whatsapp_recipient(username, phone, all_alerts=True)
    print(f"✅ {username}: WhatsApp recipient set")
    print(f"   phone      = {prefs.get('phone')}")
    print(f"   whatsappTo = {prefs.get('whatsappTo')}")
    print(f"   whatsapp   = {prefs.get('whatsapp')}")
    print(f"   alerts     = breakout/takeProfit/stopLoss/botTrade/digest/chat = ON")
    if not db.get_user(username):  # defensive; unreachable
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
